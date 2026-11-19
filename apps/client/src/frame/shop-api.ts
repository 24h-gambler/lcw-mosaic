/**
 * Town shop, daily quests and child-to-child trades → server (apps/edge/src/shop.ts, Dan R326 ⑤⑪⑫). The server owns
 * prices, coins and things; this file reads them and asks for moves. One GET when a window opens, one POST per press
 * (Cloudflare request budget, coordinator 11-19): nothing here polls.
 */
import { noteSeatResponse } from '../world/seat.js';
import { reportServerUnreachable } from './connection.js';
import type { FrameAuth, Fetch } from './menu/types.js';

export interface QuestView {
  key: 'talk5' | 'buy_english' | 'build_today' | 'show_build';
  progress: number;
  goal: number;
  reward: number;
  claimed: boolean;
}
export interface ShopView {
  coins_total: number;
  prices: Record<string, number>;
  owned: Record<string, number>;
  earned_today: number;
  earn_cap: number;
  sell_back_pct: number;
  day: string;
  challenge: { key: string; placed: number; goal: number };
  quests: QuestView[];
}
export interface OfferView {
  id: string;
  mine: boolean;
  seller_name: string;
  item_key: string;
  name_ko: string;
  emoji: string;
  label: string;
  price: number;
  state: 'open' | 'sold' | 'cancelled' | 'lapsed';
}
export interface OffersView {
  offers: OfferView[];
  my_recent: OfferView[];
  paid_out: number;
  coins_total: number;
}

export type ShopError = 'guest' | 'network' | 'auth' | 'seat' | 'short_of_coins' | 'not_found' | 'closed' | 'not_done' | 'too_many' | 'say_again' | 'server';
export type ShopResult<T> = { ok: true; data: T } | { ok: false; error: ShopError; need?: number };

async function call<T>(auth: FrameAuth, path: string, body: unknown | undefined, f: Fetch | undefined): Promise<ShopResult<T>> {
  if (!auth.token) return { ok: false, error: 'guest' };
  const fx = f ?? ((i: string, x?: RequestInit) => globalThis.fetch(i, x));
  let res: Response;
  try {
    res = await fx(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), authorization: `Bearer ${auth.token}` },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    });
  } catch {
    reportServerUnreachable();
    return { ok: false, error: 'network' };
  }
  if (res.status === 403 && auth.kind === 'child' && (await noteSeatResponse(res))) return { ok: false, error: 'seat' };
  if (res.status === 401 || res.status === 403) return { ok: false, error: 'auth' };
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 404) return { ok: false, error: 'not_found' };
  if (res.status === 422 && j.error === 'say_it_again') return { ok: false, error: 'say_again' };
  if (res.status === 409) {
    const e = j.error;
    const error: ShopError =
      e === 'short_of_coins' ? 'short_of_coins' : e === 'not_done' ? 'not_done' : e === 'too_many_offers' ? 'too_many' : 'closed';
    return { ok: false, error, ...(typeof j.need === 'number' ? { need: j.need } : {}) };
  }
  if (!res.ok) return { ok: false, error: 'server' };
  return { ok: true, data: j as T };
}

/** A fresh id per press: a resend of the same press is the same purchase on the server (no double charge). */
export function newRequestId(): string {
  const b = new Uint8Array(12);
  globalThis.crypto.getRandomValues(b);
  return `r${Array.from(b, (x) => (x % 36).toString(36)).join('')}`;
}

export const fetchShop = (auth: FrameAuth, f?: Fetch) => call<ShopView>(auth, '/v1/shop', undefined, f);
export const buyThing = (auth: FrameAuth, itemKey: string, requestId: string, f?: Fetch) =>
  call<{ ok: true; item_id: string; paid: number; coins_total: number; location?: 'bag' | 'chest' }>(auth, '/v1/shop/buy', { item_key: itemKey, request_id: requestId }, f);
export const sellThing = (auth: FrameAuth, itemId: string, f?: Fetch) =>
  call<{ ok: true; paid: number; coins_total: number }>(auth, '/v1/shop/sell', { item_id: itemId }, f);
export const claimQuest = (auth: FrameAuth, quest: QuestView['key'], f?: Fetch) =>
  call<{ ok: true; reward: number; repeated: boolean; coins_total: number }>(auth, '/v1/quests/claim', { quest }, f);
/** The room is the server's call from the token (the lesson's or the family's room, same as the multi room). */
export const fetchOffers = (auth: FrameAuth, f?: Fetch) => call<OffersView>(auth, '/v1/p2p/offers', undefined, f);
export interface SaidLine {
  transcript: string;
  stt_source: string;
  confidence: number;
}
/** WP-509: the seller's English line goes with the offer, the buyer's with the accept (scored by the server). */
export const makeOffer = (auth: FrameAuth, itemId: string, price: number, said: SaidLine, f?: Fetch) =>
  call<{ ok: true; offer_id: string }>(auth, '/v1/p2p/offer', { item_id: itemId, price, said }, f);
export const acceptOffer = (auth: FrameAuth, offerId: string, said: SaidLine, f?: Fetch) =>
  call<{ ok: true; item_id: string; paid: number; coins_total: number }>(auth, '/v1/p2p/accept', { offer_id: offerId, said }, f);
export const cancelOffer = (auth: FrameAuth, offerId: string, f?: Fetch) => call<{ ok: true; coins_total: number }>(auth, '/v1/p2p/cancel', { offer_id: offerId }, f);

/**
 * "Say it in English" from the shop window: the App opens the shopkeeper's dialog with this thing's order lines (the
 * server's star price, up to 50% off). The world lane may send the same event from a shop counter.
 */
export const SHOP_SAY_EVENT = 'lcw:shop-say';
export function askShopkeeper(itemKey: string): void {
  window.dispatchEvent(new CustomEvent(SHOP_SAY_EVENT, { detail: { itemKey } }));
}

/**
 * Open the trade window (another player tapped in the world, or the shop's Trade button). The world lane dispatches
 * it on a peer tap with that peer's name; the frame opens the shop's trade view.
 */
export const OPEN_TRADE_EVENT = 'lcw:open-trade';
/** Open the shop window on a category (the HUD coin help, a first-coin tip). */
export const OPEN_SHOP_EVENT = 'lcw:open-shop';
