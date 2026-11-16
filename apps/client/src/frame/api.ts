/**
 * Frame domain → server (docs/19, server authority AGENTS 4.7): the child's things, collection and repair shop.
 * The server owns coins, items, sockets and memory cards; this file only reads them and asks for moves. A network
 * failure raises the HUD connection band (`reportServerUnreachable`), an HTTP answer never does.
 */
import { noteSeatResponse } from '../world/seat.js';
import { reportServerUnreachable } from './connection.js';
import type { FrameAuth, Fetch } from './menu/types.js';
import type { ReviewSignView } from '../dialog/review.js';

export type SocketName = 'Head_Socket' | 'Body_Socket' | 'Back_Socket' | 'Feet_Socket' | 'RightHand_Socket' | 'Mount_Socket';
export const SOCKET_NAMES: readonly SocketName[] = ['Head_Socket', 'Body_Socket', 'Back_Socket', 'Feet_Socket', 'RightHand_Socket', 'Mount_Socket'];

export interface ThingView {
  item_id: string;
  item_key: string;
  item_name_ko: string;
  emoji: string;
  location: 'bag' | 'chest' | 'socket';
  socket: SocketName | null;
  durability: number;
  card: { box: number; due: boolean; mastered: boolean } | null;
}

export interface ItemsView {
  bag_slots: number;
  coins_total: number | null;
  items: ThingView[];
}

export interface CollectionBook {
  id: string;
  total: number;
  found: number;
  entries: Array<{ key: string; name_ko: string; emoji?: string; found: boolean }>;
}

export interface CollectionView {
  books: CollectionBook[];
  achievements?: Array<{ id: string; name_ko: string; done: boolean; progress?: number; goal?: number }>;
}

export interface RepairGearView {
  item_id: string;
  item_key: string;
  item_name_ko: string;
  emoji: string;
  due: boolean;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: 'guest' | 'network' | 'auth' | 'seat' | 'bag_full' | 'not_found' | 'not_due' | 'server' };

async function call<T>(auth: FrameAuth, path: string, init: RequestInit | undefined, f: Fetch | undefined, parse: (j: unknown) => T): Promise<ApiResult<T>> {
  if (!auth.token) return { ok: false, error: 'guest' };
  const fx = f ?? ((i: string, x?: RequestInit) => globalThis.fetch(i, x));
  let res: Response;
  try {
    res = await fx(path, { ...init, headers: { ...(init?.body ? { 'content-type': 'application/json' } : {}), authorization: `Bearer ${auth.token}` } });
  } catch {
    reportServerUnreachable();
    return { ok: false, error: 'network' };
  }
  if (res.status === 403 && auth.kind === 'child' && (await noteSeatResponse(res))) return { ok: false, error: 'seat' };
  if (res.status === 401 || res.status === 403) return { ok: false, error: 'auth' };
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 404) return { ok: false, error: 'not_found' };
  if (res.status === 409) return { ok: false, error: j.error === 'bag_full' ? 'bag_full' : 'not_due' };
  if (!res.ok) return { ok: false, error: 'server' };
  return { ok: true, data: parse(j) };
}

const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export function parseThing(v: unknown): ThingView | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const loc = o.location === 'chest' ? 'chest' : o.location === 'socket' ? 'socket' : o.location === 'bag' ? 'bag' : null;
  if (!loc || typeof o.item_id !== 'string') return null;
  const socket = SOCKET_NAMES.includes(o.socket as SocketName) ? (o.socket as SocketName) : null;
  const c = o.card && typeof o.card === 'object' ? (o.card as Record<string, unknown>) : null;
  return {
    item_id: o.item_id,
    item_key: str(o.item_key),
    item_name_ko: str(o.item_name_ko, str(o.item_key)),
    emoji: str(o.emoji, '🎁'),
    location: loc,
    socket,
    durability: num(o.durability, 100),
    card: c ? { box: num(c.box), due: c.due === true, mastered: c.mastered === true } : null
  };
}

export function parseItems(j: unknown): ItemsView {
  const o = (j ?? {}) as Record<string, unknown>;
  const items = Array.isArray(o.items) ? o.items.map(parseThing).filter((x): x is ThingView => x !== null) : [];
  return { bag_slots: num(o.bag_slots, 5), coins_total: typeof o.coins_total === 'number' ? o.coins_total : null, items };
}

export function parseCollection(j: unknown): CollectionView {
  const o = (j ?? {}) as Record<string, unknown>;
  const books = Array.isArray(o.books)
    ? o.books
        .filter((b): b is Record<string, unknown> => !!b && typeof b === 'object' && typeof (b as { id?: unknown }).id === 'string')
        .map((b) => {
          const entries = Array.isArray(b.entries)
            ? b.entries
                .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
                .map((e) => ({ key: str(e.key), name_ko: str(e.name_ko, str(e.key)), ...(typeof e.emoji === 'string' ? { emoji: e.emoji } : {}), found: e.found === true }))
            : [];
          return { id: b.id as string, total: num(b.total, entries.length), found: num(b.found, entries.filter((e) => e.found).length), entries };
        })
    : [];
  const achievements = Array.isArray(o.achievements)
    ? o.achievements
        .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object')
        .map((a) => ({
          id: str(a.id),
          name_ko: str(a.name_ko, str(a.id)),
          done: a.done === true,
          ...(typeof a.progress === 'number' ? { progress: a.progress } : {}),
          ...(typeof a.goal === 'number' ? { goal: a.goal } : {})
        }))
    : undefined;
  return { books, ...(achievements ? { achievements } : {}) };
}

export function fetchItems(auth: FrameAuth, f?: Fetch): Promise<ApiResult<ItemsView>> {
  return call(auth, '/v1/items', undefined, f, parseItems);
}

/** Carry (bag) or store (chest) one of the child's own things. The server checks owner and the 5-slot bag. */
export function moveThing(auth: FrameAuth, itemId: string, to: 'bag' | 'chest', f?: Fetch): Promise<ApiResult<{ item_id: string; location: string }>> {
  return call(auth, '/v1/items/equip', { method: 'POST', body: JSON.stringify({ item_id: itemId, to }) }, f, (j) => {
    const o = j as Record<string, unknown>;
    return { item_id: str(o.item_id, itemId), location: str(o.location, to) };
  });
}

/** Holding a thing in hand counts as using it (docs/09 P4); the server decides whether it does. */
export function holdThing(auth: FrameAuth, itemKey: string, f?: Fetch): Promise<ApiResult<{ uses: number }>> {
  return call(auth, '/v1/items/use', { method: 'POST', body: JSON.stringify({ item_key: itemKey }) }, f, (j) => ({ uses: num((j as Record<string, unknown>).uses) }));
}

export function fetchCollection(auth: FrameAuth, f?: Fetch): Promise<ApiResult<CollectionView>> {
  return call(auth, '/v1/collection', undefined, f, parseCollection);
}

export function fetchRepairGear(auth: FrameAuth, f?: Fetch): Promise<ApiResult<RepairGearView[]>> {
  return call(auth, '/v1/review/repair', undefined, f, (j) => {
    const items = (j as Record<string, unknown>).items;
    return Array.isArray(items)
      ? items
          .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && typeof (x as { item_id?: unknown }).item_id === 'string')
          .map((x) => ({ item_id: x.item_id as string, item_key: str(x.item_key), item_name_ko: str(x.item_name_ko, str(x.item_key)), emoji: str(x.emoji, '🎁'), due: x.due === true }))
      : [];
  });
}

/** The child picked a stored thing: the server returns its review sign (scored later by POST /v1/review/attempt). */
export function pickRepair(auth: FrameAuth, itemId: string, f?: Fetch): Promise<ApiResult<ReviewSignView>> {
  return call(auth, '/v1/review/repair/pick', { method: 'POST', body: JSON.stringify({ item_id: itemId }) }, f, (j) => (j as { sign: ReviewSignView }).sign);
}
