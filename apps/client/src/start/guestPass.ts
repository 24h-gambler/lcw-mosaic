/**
 * Guest pass in the world (docs/19 §8, edge free-play.ts, PR #79): `/world/?pass=XXXX-XXXX` redeems once on this
 * device (the server starts the 30-minute clock at the first entry and binds the code to the device), later
 * requests carry `x-lcw-guest-pass`, the remaining time comes from `GET /v1/guest-pass/status` (counted on the
 * server clock), and the end sends the child to `/guest-end`. Pure functions over a fetch and a key store.
 */
import { GUEST_PASS_HEADER, normalizeGuestPassCode } from '@lcw/schemas';
import { readWorldSetup, type WorldSetupChoice } from '@lcw/content';
import type { FetchLike, KeyStore } from './api.js';

/** The same device id /try keeps (docs/19 §8: a random value on the device; the server stores only a hash). */
export const PASS_DEVICE_KEY = 'lcw.tryDevice';
/** This tab's pass session (a reload asks the status first instead of spending a lookup on redeem). */
export const PASS_SESSION_KEY = 'lcw.guestPass';
export const PASS_END_PATH = '/guest-end';
/** How often the remaining time is read again from the server (the countdown in between is local). */
export const PASS_STATUS_POLL_MS = 30_000;

export interface PassSession {
  code: string;
  token: string;
  worldId: string;
  hostNickname: string;
  /** server ends_at, and the local clock offset (server_now - local now) when it was read */
  endsAt: number;
  skewMs: number;
}

/**
 * `?pass=` from the address: the 8-character code, '' when the address carries a pass that cannot be a code (the
 * layer shows "not found" instead of dropping the child on the title), or null when there is no pass at all.
 */
export function passFromSearch(search: string): string | null {
  const raw = new URLSearchParams(search).get('pass');
  if (raw === null) return null;
  return normalizeGuestPassCode(raw) ?? '';
}

/**
 * Without storage (private window, blocked site data) the id is held for the page's life: a retry after a lost answer
 * must send the same device, or the server, which already bound the pass to the first one, answers pass_in_use.
 */
let memoryDevice: string | null = null;

/** Tests only: forget the page-life device id. */
export function resetPassDeviceForTest(): void {
  memoryDevice = null;
}

export function passDevice(store: KeyStore | null, rand: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  const make = () => (memoryDevice ??= Array.from(rand(16), (b) => b.toString(16).padStart(2, '0')).join(''));
  try {
    const have = store?.getItem(PASS_DEVICE_KEY);
    if (have && have.length >= 16 && have.length <= 64) return have;
    const v = make();
    store?.setItem(PASS_DEVICE_KEY, v);
    return v;
  } catch {
    return make();
  }
}

export function readPassSession(store: KeyStore | null, code: string): PassSession | null {
  try {
    const raw = store?.getItem(PASS_SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as PassSession;
    return s && s.code === code && typeof s.token === 'string' && typeof s.endsAt === 'number' ? s : null;
  } catch {
    return null;
  }
}

export function savePassSession(store: KeyStore | null, s: PassSession | null): void {
  try {
    if (!s) store?.removeItem(PASS_SESSION_KEY);
    else store?.setItem(PASS_SESSION_KEY, JSON.stringify(s));
  } catch {
    /* private window: the session lasts as long as the page */
  }
}

/**
 * Why a pass cannot be entered: ended (→ /guest-end), in use on another device, not found (or not a code), too many
 * lookups from this network (the hour window, docs/19 §8), or try again (offline, server trouble).
 */
export type PassRefusal = 'ended' | 'in_use' | 'not_found' | 'busy' | 'retry';

// monthly_limit: the seat already played its passes this KST month (docs/19 §8) — nothing to retry today.
const ENDED = new Set(['pass_ended', 'pass_expired', 'pass_revoked', 'seat_inactive', 'monthly_limit']);

export async function redeemPass(
  code: string,
  device: string,
  fetchFn: FetchLike,
  now: () => number = Date.now,
  base = ''
): Promise<{ ok: true; session: PassSession } | { ok: false; why: PassRefusal }> {
  try {
    const res = await fetchFn(`${base}/v1/guest-pass/redeem`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ code, device })
    });
    const b = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const error = typeof b.error === 'string' ? b.error : '';
      if (res.status === 410 || ENDED.has(error)) return { ok: false, why: 'ended' };
      if (error === 'pass_in_use') return { ok: false, why: 'in_use' };
      if (res.status === 404 || res.status === 400 || error === 'pass_not_found') return { ok: false, why: 'not_found' };
      if (res.status === 429) return { ok: false, why: 'busy' };
      return { ok: false, why: 'retry' };
    }
    if (typeof b.token !== 'string' || typeof b.ends_at !== 'number' || typeof b.server_now !== 'number') return { ok: false, why: 'retry' };
    return {
      ok: true,
      session: {
        code,
        token: b.token,
        worldId: typeof b.world_id === 'string' ? b.world_id : '',
        hostNickname: typeof b.host_nickname === 'string' ? b.host_nickname : '',
        endsAt: b.ends_at,
        skewMs: b.server_now - now()
      }
    };
  } catch {
    return { ok: false, why: 'retry' };
  }
}

/**
 * The pass on the server clock: 'ended' (state ended, or the session is gone), the new ends_at and clock skew while
 * active, or null when the server could not be asked (the local countdown carries on).
 */
export async function passStatus(
  token: string,
  fetchFn: FetchLike,
  now: () => number = Date.now,
  base = ''
): Promise<'ended' | { endsAt: number; skewMs: number } | null> {
  try {
    const res = await fetchFn(`${base}/v1/guest-pass/status`, { headers: { [GUEST_PASS_HEADER]: token, accept: 'application/json' }, cache: 'no-store' });
    if (res.status === 404 || res.status === 410) return 'ended';
    if (!res.ok) return null;
    const b = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (b.state === 'ended') return 'ended';
    if (b.state !== 'active' || typeof b.ends_at !== 'number' || typeof b.server_now !== 'number') return null;
    return { endsAt: b.ends_at, skewMs: b.server_now - now() };
  } catch {
    return null;
  }
}

/**
 * The host child's world as the host made it (season, sky, animal friend), read with the pass (GET /v1/my-world answers
 * a running pass with the host's setup). null when not made, not answered or offline: the town's own look then.
 */
export async function passHostWorld(token: string, fetchFn: FetchLike, base = ''): Promise<WorldSetupChoice | null> {
  try {
    const res = await fetchFn(`${base}/v1/my-world`, { headers: { [GUEST_PASS_HEADER]: token, accept: 'application/json' }, cache: 'no-store' });
    if (!res.ok) return null;
    const b = (await res.json().catch(() => ({}))) as { made?: unknown; world?: unknown };
    const w = b.made === true ? readWorldSetup(b.world) : null;
    return w ? { season: w.season, time: w.time, buddy: w.buddy } : null;
  } catch {
    return null;
  }
}

/** Milliseconds left by the server clock (endsAt) read through the local clock and the last known skew. */
export function passLeftMs(s: Pick<PassSession, 'endsAt' | 'skewMs'>, localNow: number): number {
  return Math.max(0, s.endsAt - (localNow + s.skewMs));
}

/** m:ss ("29:41"), never negative; not shown to the child (AGENTS §4.9), kept for the end timer's logs and tests. */
export function mmss(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** Is this request ours (same origin, /v1/…)? Only those get the pass header. */
export function isOwnApi(url: string, origin: string): boolean {
  try {
    const u = new URL(url, origin);
    return u.origin === origin && u.pathname.startsWith('/v1/');
  } catch {
    return false;
  }
}

/**
 * Every later request of this page to our own API carries the pass (docs/19 §8: `x-lcw-guest-pass`), so a route that
 * takes guests (`guestPassFromRequest`) sees it without each caller knowing. Returns the undo.
 */
export function installPassHeader(token: string, target: { fetch: typeof fetch } = globalThis, origin = globalThis.location?.origin ?? ''): () => void {
  const inner = target.fetch;
  const wrapped: typeof fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!isOwnApi(url, origin)) return inner.call(target, input, init);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (!headers.has(GUEST_PASS_HEADER)) headers.set(GUEST_PASS_HEADER, token);
    return inner.call(target, input, { ...init, headers });
  };
  target.fetch = wrapped;
  return () => {
    if (target.fetch === wrapped) target.fetch = inner;
  };
}
