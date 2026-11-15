/**
 * Who is playing (docs/19 5장): a lesson join code wins, then a linked child device, else a guest.
 * The device token is written by the guardian domain's /link screen (apps/web familyApi: `lcw.deviceToken`)
 * and checked here with GET /v1/device/me. Storage access is wrapped: a private window is simply a guest.
 */
import type { Level } from '@lcw/schemas';

export const DEVICE_TOKEN_KEY = 'lcw.deviceToken';
export const DEVICE_NICKNAME_KEY = 'lcw.deviceNickname';

export type PlayerIdentity =
  | { kind: 'lesson'; code: string }
  | { kind: 'child'; token: string; nickname: string; level: Level; voiceStore: boolean; offline: boolean }
  | { kind: 'guest' };

export interface KeyStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const LEVELS: readonly string[] = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'];

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
  let res: Response;
  try {
    res = await fetchFn(`${base}/v1/device/me`, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' }, cache: 'no-store' });
  } catch {
    // Offline: keep playing as the linked child with the name saved at link time; the server checks again later.
    return { kind: 'child', token, nickname: cachedName, level: 'L1', voiceStore: false, offline: true };
  }
  if (res.status === 401) {
    // Revoked by the guardian or expired: the token can never work again, so the device starts as a guest.
    try {
      store?.removeItem(DEVICE_TOKEN_KEY);
    } catch {
      /* storage blocked */
    }
    return { kind: 'guest' };
  }
  if (!res.ok) return { kind: 'child', token, nickname: cachedName, level: 'L1', voiceStore: false, offline: true };
  const body = (await res.json().catch(() => ({}))) as { nickname?: unknown; level?: unknown; voice_store?: unknown };
  const nickname = typeof body.nickname === 'string' ? body.nickname : cachedName;
  const level = (typeof body.level === 'string' && LEVELS.includes(body.level) ? body.level : 'L1') as Level;
  if (nickname && nickname !== cachedName) {
    try {
      store?.setItem(DEVICE_NICKNAME_KEY, nickname);
    } catch {
      /* storage blocked */
    }
  }
  return { kind: 'child', token, nickname, level, voiceStore: body.voice_store === true, offline: false };
}

/** Browser storage, or null when the accessor itself throws (blocked site data). */
export function browserStore(): KeyStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
