/**
 * The /try session the server judges (docs/01 §3, edge free-play.ts): the server stamps the start and the end
 * (3 minutes) and counts the one voice order. This side only shows the time the server gave, corrected by the clock
 * offset of the answer, and asks the server before it serves the drink.
 */
import { FREE_PLAY_LIMITS, type TryOrderResponse, type TrySession } from '@lcw/schemas';
import type { TryOrderPath } from '@lcw/content';

export const TRY_DEVICE_KEY = 'lcw.tryDevice';

export type TryStartResult =
  | { kind: 'ok'; session: TrySession; offsetMs: number }
  | { kind: 'used_today'; last: TrySession | null }
  | { kind: 'error' };

export type TryOrderResult =
  | { kind: 'granted'; stars: 1 | 2 | 3 }
  | { kind: 'missed' }
  | { kind: 'ended' }
  | { kind: 'used'; stars: 1 | 2 | 3 | null }
  | { kind: 'too_many' }
  | { kind: 'error' };

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

interface KeyStore {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

let memoryDevice: string | null = null;

/** A random id kept on this device (never sent anywhere but the try routes, hashed there). */
export function tryDeviceId(store: KeyStore | null, random: () => string = randomHex): string {
  try {
    const have = store?.getItem(TRY_DEVICE_KEY);
    if (have && have.length >= 16) return have;
    const id = random();
    store?.setItem(TRY_DEVICE_KEY, id);
    return id;
  } catch {
    memoryDevice ??= random();
    return memoryDevice;
  }
}

function randomHex(): string {
  const b = new Uint8Array(16);
  globalThis.crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export async function startTrySession(fetcher: Fetcher, device: string, clientNow: () => number = Date.now): Promise<TryStartResult> {
  try {
    const sent = clientNow();
    const r = await fetcher('/v1/try/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ device }), credentials: 'omit' });
    const body = (await r.json().catch(() => null)) as (TrySession & { error?: string; last?: TrySession | null }) | null;
    if (r.status === 429 && body?.error === 'try_used_today') return { kind: 'used_today', last: body.last ?? null };
    if (!r.ok || !body || typeof body.ends_at !== 'number') return { kind: 'error' };
    // Half the round trip: the server stamped server_now about then.
    const mid = (sent + clientNow()) / 2;
    return { kind: 'ok', session: body, offsetMs: body.server_now - mid };
  } catch {
    return { kind: 'error' };
  }
}

export async function orderTry(
  fetcher: Fetcher,
  p: { tryId: string; aim: 1 | 2 | 3; text: string; path: TryOrderPath; spoke?: boolean }
): Promise<TryOrderResult> {
  try {
    const r = await fetcher('/v1/try/order', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ try_id: p.tryId, aim: p.aim, text: p.text.slice(0, 300), path: p.path, ...(p.spoke !== undefined ? { spoke: p.spoke } : {}) }),
      credentials: 'omit'
    });
    const body = (await r.json().catch(() => null)) as (TryOrderResponse & { error?: string; order?: { stars: 1 | 2 | 3 } | null }) | null;
    if (r.status === 410) return { kind: 'ended' };
    if (r.status === 409 && body?.error === 'try_order_used') return { kind: 'used', stars: body.order?.stars ?? null };
    if (r.status === 429) return { kind: 'too_many' };
    if (!r.ok || !body) return { kind: 'error' };
    return body.granted && body.stars > 0 ? { kind: 'granted', stars: body.stars as 1 | 2 | 3 } : { kind: 'missed' };
  } catch {
    return { kind: 'error' };
  }
}

/** Milliseconds left on the server clock (never below zero). */
export function tryRemainingMs(endsAt: number, offsetMs: number, clientNow: number): number {
  return Math.max(0, endsAt - (clientNow + offsetMs));
}

/** "2:05" */
export function formatClock(ms: number): string {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export const TRY_MINUTES = FREE_PLAY_LIMITS.tryMinutes;
