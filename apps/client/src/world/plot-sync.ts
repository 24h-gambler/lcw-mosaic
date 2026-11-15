/**
 * Saving my plot (WP-205/207): the client applies each op at once (optimistic) and queues it here; the queue goes
 * to POST /v1/plot/ops in small batches with the child's device token, and the server's answer is the truth
 * (AGENTS 4: saves never trust the client). Unsent ops survive a reload (`lcw.plotQueue`) and are sent first, before
 * the plot is loaded again, so a closed tab loses nothing. Batches carry an id so a resend is answered, not redone.
 */
import type { PlotOp, PlotSnapshotLike } from './build.js';
import type { FetchLike, KeyStore } from './identity.js';

export const PLOT_QUEUE_KEY = 'lcw.plotQueue';
const FLUSH_MS = 350;
const MAX_BATCH = 32;

export type SyncStatus = 'idle' | 'saving' | 'saved' | 'offline' | 'paused';

export interface PlotSyncOptions {
  token: string;
  base?: string;
  fetchFn?: FetchLike;
  store?: KeyStore | null;
  /** The server refused an op the client had already shown: reload the plot from the server. */
  onResync(snapshot: PlotSnapshotLike): void;
  onStatus?(s: SyncStatus): void;
  /** Building is paused for this device (seat stopped) or the token no longer works. */
  onDenied?(kind: 'paused' | 'unlinked'): void;
}

interface Batch {
  id: string;
  ops: PlotOp[];
}

function batchId(): string {
  const a = new Uint8Array(12);
  globalThis.crypto?.getRandomValues?.(a);
  let s = '';
  for (const b of a) s += (b % 36).toString(36);
  return `${Date.now().toString(36)}-${s}`;
}

export class PlotSync {
  private queue: PlotOp[] = [];
  private inFlight: Batch | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private backoff = 0;
  private stopped = false;
  status: SyncStatus = 'idle';
  /** ops the server refused (for stats / checks) */
  refused = 0;
  sent = 0;

  constructor(private readonly o: PlotSyncOptions) {
    // Ops left from a closed tab: they go out first (in-flight batch with its id, then the rest).
    const saved = this.read();
    if (saved) {
      this.inFlight = saved.inFlight;
      this.queue = saved.queue;
    }
  }

  private get fetchFn(): FetchLike {
    return this.o.fetchFn ?? ((i, init) => globalThis.fetch(i, init));
  }

  private headers(): Record<string, string> {
    return { authorization: `Bearer ${this.o.token}`, 'content-type': 'application/json', accept: 'application/json' };
  }

  private read(): { inFlight: Batch | null; queue: PlotOp[] } | null {
    try {
      const raw = this.o.store?.getItem(PLOT_QUEUE_KEY);
      if (!raw) return null;
      const v = JSON.parse(raw) as { inFlight?: Batch | null; queue?: PlotOp[] };
      return { inFlight: v.inFlight && Array.isArray(v.inFlight.ops) ? v.inFlight : null, queue: Array.isArray(v.queue) ? v.queue : [] };
    } catch {
      return null;
    }
  }

  private persist(): void {
    try {
      if (!this.inFlight && this.queue.length === 0) this.o.store?.removeItem(PLOT_QUEUE_KEY);
      else this.o.store?.setItem(PLOT_QUEUE_KEY, JSON.stringify({ inFlight: this.inFlight, queue: this.queue }));
    } catch {
      /* storage blocked: the queue still lives in memory */
    }
  }

  private setStatus(s: SyncStatus): void {
    if (this.status === s) return;
    this.status = s;
    this.o.onStatus?.(s);
  }

  get pending(): number {
    return this.queue.length + (this.inFlight?.ops.length ?? 0);
  }

  /** Send what a closed tab left behind, then fetch the plot. null: no plot for this token (guest from now on). */
  async start(): Promise<PlotSnapshotLike | null> {
    for (let tries = 0; this.inFlight || this.queue.length > 0; tries++) {
      const ok = await this.sendOnce();
      if (this.stopped) return null;
      if (!ok) {
        if (tries >= 2) break; // offline: load what the server has; the leftovers keep retrying in the background
        await new Promise((r) => setTimeout(r, 600));
      }
    }
    return this.load();
  }

  async load(): Promise<PlotSnapshotLike | null> {
    try {
      const res = await this.fetchFn(`${this.o.base ?? ''}/v1/plot`, { headers: this.headers(), cache: 'no-store' });
      if (res.status === 401 || res.status === 403) {
        this.o.onDenied?.('unlinked');
        return null;
      }
      if (!res.ok) return null;
      return (await res.json()) as PlotSnapshotLike;
    } catch {
      this.setStatus('offline');
      return null;
    }
  }

  push(op: PlotOp): void {
    if (this.stopped) return;
    this.queue.push(op);
    this.persist();
    this.setStatus('saving');
    this.schedule(FLUSH_MS);
  }

  private schedule(ms: number): void {
    if (this.timer || this.stopped) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, ms);
  }

  async flush(): Promise<void> {
    if (this.stopped) return;
    while (this.inFlight || this.queue.length > 0) {
      const ok = await this.sendOnce();
      if (!ok) {
        // offline or server busy: keep everything, try again later (2 s, 4 s ... 30 s)
        this.backoff = Math.min(30_000, this.backoff ? this.backoff * 2 : 2000);
        this.setStatus('offline');
        this.schedule(this.backoff);
        return;
      }
      this.backoff = 0;
    }
    this.setStatus('saved');
  }

  /** One request. Returns false when it should be retried later. */
  private async sendOnce(): Promise<boolean> {
    if (!this.inFlight) {
      if (this.queue.length === 0) return true;
      this.inFlight = { id: batchId(), ops: this.queue.splice(0, MAX_BATCH) };
      this.persist();
    }
    const batch = this.inFlight;
    let res: Response;
    try {
      res = await this.fetchFn(`${this.o.base ?? ''}/v1/plot/ops`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ ops: batch.ops, batch: batch.id })
      });
    } catch {
      return false;
    }
    if (res.status === 403 || res.status === 401) {
      // seat paused or token revoked: these ops can never be saved; stop and tell the world
      this.inFlight = null;
      this.queue = [];
      this.persist();
      this.stopped = true;
      this.setStatus('paused');
      this.o.onDenied?.(res.status === 403 ? 'paused' : 'unlinked');
      return true;
    }
    if (res.status >= 500 || res.status === 429) return false;
    const body = (await res.json().catch(() => null)) as { results?: Array<{ ok: boolean; reason?: string }>; processed?: number } | null;
    this.inFlight = null;
    if (!body || !Array.isArray(body.results)) {
      // 400: the batch itself was malformed; drop it and take the server's plot
      this.queue = [];
      this.persist();
      await this.resync();
      return true;
    }
    const processed = typeof body.processed === 'number' ? body.processed : body.results.length;
    this.sent += processed;
    if (processed < batch.ops.length) {
      // the server's pace ran out: the rest goes again shortly, in the same order
      this.queue.unshift(...batch.ops.slice(processed));
      this.persist();
      await new Promise((r) => setTimeout(r, 1200));
    } else this.persist();
    const refused = body.results.filter((r) => !r.ok).length;
    if (refused > 0) {
      this.refused += refused;
      // The client showed something the server did not accept. Later local ops were built on it, so they go too;
      // the plot comes back exactly as the server keeps it.
      this.queue = [];
      this.persist();
      await this.resync();
    }
    return true;
  }

  private async resync(): Promise<void> {
    const snap = await this.load();
    if (snap) this.o.onResync(snap);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
