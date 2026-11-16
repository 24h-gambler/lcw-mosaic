/**
 * Who is playing (docs/19 5장): a lesson join code wins, then a linked child device, else a guest.
 * The device token is written by the guardian domain's /link screen (apps/web familyApi: `lcw.deviceToken`)
 * and checked here with GET /v1/device/me. Storage access is wrapped: a private window is simply a guest.
 */
import type { Level } from '@lcw/schemas';

export const DEVICE_TOKEN_KEY = 'lcw.deviceToken';
export const DEVICE_NICKNAME_KEY = 'lcw.deviceNickname';
/** Last seat answer seen online ('1' = solo play stopped), so an offline start keeps the guardian's seat state. */
export const DEVICE_PLAY_BLOCKED_KEY = 'lcw.devicePlayBlocked';

export type SeatState = 'active' | 'expiring' | 'read_only' | 'archived' | 'refunded';
export interface SeatInfo {
  state: SeatState;
  endsAt: number | null;
}

export type PlayerIdentity =
  | { kind: 'lesson'; code: string }
  | {
      kind: 'child';
      token: string;
      nickname: string;
      level: Level;
      voiceStore: boolean;
      offline: boolean;
      /** docs/19 6장: false = the seat is read-only / archived / refunded, solo play stops (lessons never gated) */
      playAllowed: boolean;
      /** null = never had a seat (before sales): plays as before */
      seat: SeatInfo | null;
    }
  | { kind: 'guest' };

export interface KeyStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const LEVELS: readonly string[] = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'];
const SEAT_STATES: readonly string[] = ['active', 'expiring', 'read_only', 'archived', 'refunded'];

function parseSeat(raw: unknown): SeatInfo | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { state?: unknown; ends_at?: unknown };
  if (typeof r.state !== 'string' || !SEAT_STATES.includes(r.state)) return null;
  return { state: r.state as SeatState, endsAt: typeof r.ends_at === 'number' ? r.ends_at : null };
}

function write(store: KeyStore | null, key: string, value: string | null): void {
  try {
    if (value === null) store?.removeItem(key);
    else store?.setItem(key, value);
  } catch {
    /* storage blocked */
  }
}

function read(store: KeyStore | null, key: string): string | null {
  try {
    return store?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** A join code from the address (`?code=123456`), digits only. */
export function joinCodeFrom(search: string): string | null {
  const raw = new URLSearchParams(search).get('code');
  const code = raw?.replace(/\D/g, '') ?? '';
  return code.length === 6 ? code : null;
}

export async function resolveIdentity(search: string, store: KeyStore | null, fetchFn: FetchLike, base = ''): Promise<PlayerIdentity> {
  const code = joinCodeFrom(search);
  if (code) return { kind: 'lesson', code };
  const token = read(store, DEVICE_TOKEN_KEY);
  if (!token || token.length < 32) return { kind: 'guest' };
  const cachedName = read(store, DEVICE_NICKNAME_KEY) ?? '';
  const offlineChild = (): PlayerIdentity => ({
    kind: 'child',
    token,
    nickname: cachedName,
    level: 'L1',
    voiceStore: false,
    offline: true,
    playAllowed: read(store, DEVICE_PLAY_BLOCKED_KEY) !== '1',
    seat: null
  });
  let res: Response;
  try {
    res = await fetchFn(`${base}/v1/device/me`, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' }, cache: 'no-store' });
  } catch {
    // Offline: keep playing as the linked child with the name saved at link time (and the last seat answer);
    // the server checks again on every scored line.
    return offlineChild();
  }
  if (res.status === 401) {
    // Revoked by the guardian or expired: the token can never work again, so the device starts as a guest.
    // The saved name goes with it (the sign-up page does the same), so the next child on this device never sees it.
    try {
      store?.removeItem(DEVICE_TOKEN_KEY);
      store?.removeItem(DEVICE_NICKNAME_KEY);
    } catch {
      /* storage blocked */
    }
    return { kind: 'guest' };
  }
  if (!res.ok) return offlineChild();
  const body = (await res.json().catch(() => ({}))) as { nickname?: unknown; level?: unknown; voice_store?: unknown; play_allowed?: unknown; seat?: unknown };
  const nickname = typeof body.nickname === 'string' ? body.nickname : cachedName;
  const level = (typeof body.level === 'string' && LEVELS.includes(body.level) ? body.level : 'L1') as Level;
  if (nickname && nickname !== cachedName) {
    try {
      store?.setItem(DEVICE_NICKNAME_KEY, nickname);
    } catch {
      /* storage blocked */
    }
  }
  // Only an explicit false stops solo play (an older server without the field keeps playing).
  const playAllowed = body.play_allowed !== false;
  write(store, DEVICE_PLAY_BLOCKED_KEY, playAllowed ? null : '1');
  return { kind: 'child', token, nickname, level, voiceStore: body.voice_store === true, offline: false, playAllowed, seat: parseSeat(body.seat) };
}

/** Where the lesson layer (and apps/web /join) keeps this tab's student token after /v1/join (lesson/api.ts). */
export const STUDENT_TOKEN_KEY = 'lcw.studentToken';

/** This tab's lesson student token, or null before the join (or when storage is blocked). */
export function storedStudentToken(): string | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage.getItem(STUDENT_TOKEN_KEY);
  } catch {
    return null;
  }
}

/** Browser storage, or null when the accessor itself throws (blocked site data). */
export function browserStore(): KeyStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
