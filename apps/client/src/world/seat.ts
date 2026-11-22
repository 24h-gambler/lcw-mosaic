/**
 * Seat stopped while playing (docs/19 6장, WP-704): the server answers a linked device's solo writes
 * (converse/score, review/attempt, showroom, plot ops) with 403 `{error:'seat_inactive'}`. Whoever made the request
 * hands the response here; the device remembers it (`lcw.devicePlayBlocked`, read at the next start even offline)
 * and the shell swaps to the same "혼자 놀기 쉬는 중" card as play_allowed=false — never an error message.
 */
import { DEVICE_PLAY_BLOCKED_KEY, browserStore, type KeyStore } from './identity.js';

export const SEAT_INACTIVE_EVENT = 'lcw:seat-inactive';

/** True when the body is the server's seat answer (not a plain auth failure): a paused seat or, R326, the free 3 minutes spent. */
export function isSeatInactiveBody(body: unknown): boolean {
  const e = !!body && typeof body === 'object' ? (body as { error?: unknown }).error : null;
  return e === 'seat_inactive' || e === 'trial_ended';
}

/** True when the server said the free trial is over (R326): the shell shows the pay card, not the paused-seat card. */
export function isTrialEndedBody(body: unknown): boolean {
  return !!body && typeof body === 'object' && (body as { error?: unknown }).error === 'trial_ended';
}

/** Remember the paused seat (or the spent trial) on this device and tell the shell (window event, `detail.trial`). */
export function markSeatInactive(store: KeyStore | null = browserStore(), trial = false): void {
  try {
    store?.setItem(DEVICE_PLAY_BLOCKED_KEY, trial ? 'trial' : '1');
  } catch {
    /* storage blocked: the shell still switches for this session */
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(SEAT_INACTIVE_EVENT, { detail: { trial } }));
}

/**
 * Look at a child-token response: a 403 seat_inactive is marked and reported (true). Reads a clone, so the caller can
 * still read the body itself.
 */
export async function noteSeatResponse(res: Response, store?: KeyStore | null): Promise<boolean> {
  if (res.status !== 403) return false;
  const body = (await res
    .clone()
    .json()
    .catch(() => null)) as unknown;
  if (!isSeatInactiveBody(body)) return false;
  markSeatInactive(store === undefined ? browserStore() : store, isTrialEndedBody(body));
  return true;
}

/** Shell side: run `cb` whenever any request reported a paused seat (`trial` = the free trial is what ended). */
export function onSeatInactive(cb: (trial: boolean) => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const h = (e: Event): void => cb((e as CustomEvent<{ trial?: boolean }>).detail?.trial === true);
  window.addEventListener(SEAT_INACTIVE_EVENT, h);
  return () => window.removeEventListener(SEAT_INACTIVE_EVENT, h);
}

/**
 * R326 free-trial beat: while a trial child's world is open and visible the device tells the server every
 * FREE_PLAY_LIMITS.worldTrialBeatMs (60 s) — one small request a minute, only for this child; a seat, a lesson or a
 * guest never beats. A hidden tab does not beat (the server counts the gap after a break as nothing). Stops itself when
 * the server answers that the trial is over (`onEnded`). Returns the stop function.
 */
export function startTrialBeat(opts: {
  token: string;
  everyMs: number;
  onEnded: () => void;
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
  doc?: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'> | null;
  timers?: { setInterval: typeof setInterval; clearInterval: typeof clearInterval };
}): () => void {
  const f = opts.fetchImpl ?? ((i: string, x?: RequestInit) => globalThis.fetch(i, x));
  const doc = opts.doc === undefined ? (typeof document === 'undefined' ? null : document) : opts.doc;
  const t = opts.timers ?? { setInterval: globalThis.setInterval.bind(globalThis), clearInterval: globalThis.clearInterval.bind(globalThis) };
  let stopped = false;
  let id: ReturnType<typeof setInterval> | null = null;
  const beat = async (): Promise<void> => {
    if (stopped || (doc && doc.visibilityState === 'hidden')) return;
    try {
      const res = await f('/v1/device/heartbeat', { method: 'POST', headers: { authorization: `Bearer ${opts.token}` } });
      if (!res.ok) return;
      const j = (await res.json().catch(() => ({}))) as { trial?: unknown; play_allowed?: unknown };
      if (j.trial === 'ended' || j.play_allowed === false) {
        stop();
        markSeatInactive(browserStore(), true);
        opts.onEnded();
      } else if (j.trial !== 'running') {
        // a seat arrived meanwhile: nothing more to count
        stop();
      }
    } catch {
      /* offline: the next beat (or the next solo write) counts again */
    }
  };
  const onVis = (): void => {
    if (doc?.visibilityState === 'visible') void beat();
  };
  const stop = (): void => {
    stopped = true;
    if (id !== null) t.clearInterval(id);
    id = null;
    doc?.removeEventListener('visibilitychange', onVis);
  };
  void beat();
  id = t.setInterval(() => void beat(), opts.everyMs);
  doc?.addEventListener('visibilitychange', onVis);
  return stop;
}
