/**
 * Saving my plot (WP-205/207): the client applies each op at once (optimistic) and queues it here; the queue goes
 * to POST /v1/plot/ops in small batches with the child's device token, and the server's answer is the truth
 * (AGENTS 4: saves never trust the client). Unsent ops survive a reload (`lcw.plotQueue`) and are sent first, before
 * the plot is loaded again, so a closed tab loses nothing. Batches carry an id so a resend is answered, not redone.
 * The queue is kept per token (`plotQueueKey`): ops built under one child's token never go out under another's.
 */
import type { PlotOp, PlotSnapshotLike } from './build.js';
import { DEVICE_TOKEN_KEY, type FetchLike, type KeyStore } from './identity.js';
import { noteSeatResponse } from './seat.js';
import { GUEST_PASS_HEADER } from '@lcw/schemas';

/** The queue key before it was kept per token; only ever written under this device's own linked token. */
export const PLOT_QUEUE_KEY = 'lcw.plotQueue';

/** Where the unsent ops of one token live (a short hash, never the token itself). */
export function plotQueueKey(token: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${PLOT_QUEUE_KEY}.${h.toString(16).padStart(8, '0')}`;
}
const FLUSH_MS = 350;
const MAX_BATCH = 32;

export type SyncStatus = 'idle' | 'saving' | 'saved' | 'offline' | 'paused';

/**
 * The plot answered a guest pass with 410 (the pass ended, or the host's seat stopped): the pass layer checks the pass
 * at once instead of waiting for its next poll, so the friend reaches /guest-end without a dead half-minute.
 */
export const PASS_CHECK_EVENT = 'lcw:pass-check';

export interface PlotSyncOptions {
  token: string;
  /** the token is a guest-pass session (docs/19 §8): sent as `x-lcw-guest-pass`, the plot is the host's */
  pass?: boolean;
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

/**
 * R326: something outside the build screen changed this child's build stock on the server (a block bundle bought in
 * the shop, frame/shop-api.ts): the world reads its plot again once nothing is waiting to go up.
 */
export const PLOT_REFRESH_EVENT = 'lcw:plot-refresh';

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
  private readonly key: string;

  constructor(private readonly o: PlotSyncOptions) {
    this.key = plotQueueKey(o.token);
    this.adoptLegacyQueue();
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
    if (this.o.pass) return { [GUEST_PASS_HEADER]: this.o.token, 'content-type': 'application/json', accept: 'application/json' };
    return { authorization: `Bearer ${this.o.token}`, 'content-type': 'application/json', accept: 'application/json' };
  }

  /**
   * A queue saved before the per-token key came from this device's own linked token (lessons used it too, which is
   * the leak the per-token key closes): only that token takes it over, any other token leaves it alone.
   */
  private adoptLegacyQueue(): void {
    try {
      const store = this.o.store;
      const legacy = store?.getItem(PLOT_QUEUE_KEY);
      if (!store || !legacy || store.getItem(DEVICE_TOKEN_KEY) !== this.o.token) return;
      if (!store.getItem(this.key)) store.setItem(this.key, legacy);
      store.removeItem(PLOT_QUEUE_KEY);
    } catch {
      /* storage blocked: nothing was saved either */
    }
  }

  private read(): { inFlight: Batch | null; queue: PlotOp[] } | null {
    try {
      const raw = this.o.store?.getItem(this.key);
      if (!raw) return null;
      const v = JSON.parse(raw) as { inFlight?: Batch | null; queue?: PlotOp[] };
      return { inFlight: v.inFlight && Array.isArray(v.inFlight.ops) ? v.inFlight : null, queue: Array.isArray(v.queue) ? v.queue : [] };
    } catch {
      return null;
    }
  }

  private persist(): void {
    try {
      if (!this.inFlight && this.queue.length === 0) this.o.store?.removeItem(this.key);
      else this.o.store?.setItem(this.key, JSON.stringify({ inFlight: this.inFlight, queue: this.queue }));
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

  /** Nothing on its way and no snapshot being read: what this device shows is what the server holds (R326 relay). */
  get settled(): boolean {
    return this.pending === 0 && !this.reading;
  }
  private reading = false;

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
      // 410: the guest pass ran out (the pass layer sends the friend to /guest-end)
      if (res.status === 401 || res.status === 410) {
        if (res.status === 410) this.passOver();
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
    if (!this.stopped) this.setStatus('saved');
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
    // Only the seat answer (403 seat_inactive: the shell swaps to the seat card) or a dead token (401) stops saving.
    // Any other 403 refuses this batch alone: drop it and take the server's plot, like a refused op.
    const seatStopped = res.status === 403 && (await noteSeatResponse(res, this.o.store));
    if (seatStopped || res.status === 401 || res.status === 410) {
      if (res.status === 410) this.passOver();
      this.inFlight = null;
      this.queue = [];
      this.persist();
      this.stopped = true;
      this.setStatus('paused');
      this.o.onDenied?.(seatStopped ? 'paused' : 'unlinked');
      return true;
    }
    if (res.status === 403) {
      this.inFlight = null;
      this.refused += batch.ops.length;
      this.queue = [];
      this.persist();
      await this.resync();
      return true;
    }
    if (res.status >= 500 || res.status === 429) return false;
    const body = (await res.json().catch(() => null)) as { results?: Array<{ ok: boolean; reason?: string }>; processed?: number; unpacked?: number } | null;
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
    } else if (typeof body.unpacked === 'number' && body.unpacked > 0) this.refreshWanted = true;
    if (this.refreshWanted && !this.inFlight && this.queue.length === 0) {
      // a bundle opened into the stock on the server (R326): the hand and the chest come from the server again
      this.refreshWanted = false;
      await this.resync();
    }
    return true;
  }

  private refreshWanted = false;

  /**
   * Read the plot again for a change made elsewhere (R326 shop bundles). With edits still waiting, after they went up:
   * a snapshot read in between would hide them on this device.
   */
  async refresh(): Promise<void> {
    if (this.stopped) return;
    if (this.inFlight || this.queue.length > 0) {
      this.refreshWanted = true;
      return;
    }
    await this.resync();
  }

  private async resync(): Promise<void> {
    this.reading = true;
    try {
      const snap = await this.load();
      if (snap) this.o.onResync(snap);
    } finally {
      this.reading = false;
    }
  }

  private passOver(): void {
    if (!this.o.pass) return;
    try {
      if (typeof window !== 'undefined') window.dispatchEvent(new Event(PASS_CHECK_EVENT));
    } catch {
      /* no window (tests, workers): the pass layer's own poll still ends it */
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
