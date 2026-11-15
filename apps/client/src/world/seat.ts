/**
 * Seat stopped while playing (docs/19 6장, WP-704): the server answers a linked device's solo writes
 * (converse/score, review/attempt, showroom, plot ops) with 403 `{error:'seat_inactive'}`. Whoever made the request
 * hands the response here; the device remembers it (`lcw.devicePlayBlocked`, read at the next start even offline)
 * and the shell swaps to the same "혼자 놀기 쉬는 중" card as play_allowed=false — never an error message.
 */
import { DEVICE_PLAY_BLOCKED_KEY, browserStore, type KeyStore } from './identity.js';

export const SEAT_INACTIVE_EVENT = 'lcw:seat-inactive';

/** True when the body is the server's seat answer (not a plain auth failure). */
export function isSeatInactiveBody(body: unknown): boolean {
  return !!body && typeof body === 'object' && (body as { error?: unknown }).error === 'seat_inactive';
}

/** Remember the paused seat on this device and tell the shell (window event). */
export function markSeatInactive(store: KeyStore | null = browserStore()): void {
  try {
    store?.setItem(DEVICE_PLAY_BLOCKED_KEY, '1');
  } catch {
    /* storage blocked: the shell still switches for this session */
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(SEAT_INACTIVE_EVENT));
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
  markSeatInactive(store === undefined ? browserStore() : store);
  return true;
}

/** Shell side: run `cb` whenever any request reported a paused seat. */
export function onSeatInactive(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const h = (): void => cb();
  window.addEventListener(SEAT_INACTIVE_EVENT, h);
  return () => window.removeEventListener(SEAT_INACTIVE_EVENT, h);
}
