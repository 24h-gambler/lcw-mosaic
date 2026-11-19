/**
 * The town shop, coin earning, daily quests and child-to-child trades (Dan 11-19 R326 ⑤⑪⑫).
 *
 * Coins live in the child's home-world ledger (one balance, platform.creditCoins). Everything here is decided by the
 * server from the catalog (`@lcw/content` shop-catalog.ts) and server records; the client sends only which thing.
 *
 * - Earning (`creditSoloEarn`, called from /v1/converse/score): a passed solo sentence pays stars × soloPerStar, once
 *   per dialog window (a better grade in the same window tops up the difference), at most soloDailyCap per KST day.
 * - Shop (`GET /v1/shop`, `POST /v1/shop/buy`, `POST /v1/shop/sell`): buying with the button costs the list price
 *   (× the world's weekly index); saying the order in English to the shopkeeper is the /v1/converse/score purchase
 *   path at the star price (up to 50% off). A `request_id` makes a buy idempotent (a resend after a network error
 *   neither charges nor grants twice); the balance is checked and written in one transaction, so it never goes
 *   below zero. Selling back (the NPC trade) pays sellBackPct of the list price once per item.
 * - Quests (`POST /v1/quests/claim`): checked against server counts of today (KST) — passed solo sentences, an
 *   English purchase, blocks placed for today's build challenge (plot journal), a showroom publish — and paid once a
 *   day each (`quest:<day>:<key>` ref).
 * - Trades between children (`/v1/p2p/*`, WP-509): both sides say their line in English (scored here, logged as the
 *   child's utterance) before anything moves. An offer puts the seller's thing in escrow (out of their items, into
 *   `p2p_offers`) for a coin price, visible to the others in the same room. Accepting moves the coins and the thing
 *   in one transaction on the buyer's request; the seller's coins wait in the offer row and land in their ledger the
 *   next time they open the trade list (so no request ever loads another child's world). Cancel or lapse returns the
 *   thing. Each step is guarded by the offer's state, so nothing doubles.
 *
 * Request budget (Cloudflare free limits, coordinator 11-19): the window makes one GET when it opens and one POST per
 * press; nothing polls.
 */
import type { Hono } from 'hono';
import { z } from 'zod';
import {
  COIN_RULES,
  DAILY_QUESTS,
  SHOP_CATALOG,
  challengeOfDay,
  kstDay,
  kstDayStart,
  shopItem,
  starPrice,
  tradeLines,
  type DailyQuestKey,
  type ShopItemDef
} from '@lcw/content';
import { scoreUtterance } from '@lcw/converse';
import { indexedPrice } from './economy.js';
import { itemKeyOfCard, landingPlace } from './review.js';
import { runInTransaction, type EdgePlatformDb, type SqliteExecutor, type WorldDO } from './storage.js';

export const P2P_SCHEMA_SQL = `
create table if not exists p2p_offers (id text primary key, room text not null, seller text not null, seller_name text not null, item_id text not null, item_key text not null, spec text not null, price integer not null, state text not null, buyer text, created_at integer not null, expires_at integer not null, settled_at integer, paid_out integer not null default 0);
create index if not exists p2p_offers_room on p2p_offers (room, state);
create index if not exists p2p_offers_seller on p2p_offers (seller, state);
`;

export interface ShopDeps {
  db: EdgePlatformDb;
  worlds: Map<string, WorldDO>;
  nowMs: () => number;
  priceIndex?: (worldId: string) => number;
  randomId?: () => string;
}

const SOLO_EARN_REASON = 'earn_solo';

/** Today's solo earnings in this ledger. */
function earnedToday(world: WorldDO, playerId: string, nowMs: number): number {
  const r = world.sql.get<{ s: number | null }>('select sum(delta) as s from ledger where player = ? and reason = ? and at >= ?', [
    playerId,
    SOLO_EARN_REASON,
    kstDayStart(nowMs)
  ]);
  return Math.max(0, Number(r?.s ?? 0));
}

/**
 * A passed solo sentence pays coins (Dan R326 ⑤ "코인이 안 쌓인다": before this only lessons and the one errand paid).
 * Returns the coins added now (0 when the window already paid this grade or the day's cap is reached).
 */
export function creditSoloEarn(world: WorldDO, p: { playerId: string; dialogId: string; stars: number; nowMs: number; sentence?: string }): number {
  if (p.stars <= 0) return 0;
  const target = Math.min(3, p.stars) * COIN_RULES.soloPerStar;
  const prefix = `earn:${p.dialogId}:`;
  const paid = Number(
    world.sql.get<{ s: number | null }>('select sum(delta) as s from ledger where player = ? and substr(ref, 1, ?) = ?', [p.playerId, prefix.length, prefix])
      ?.s ?? 0
  );
  // The dialog id comes from the client: the same sentence in a fresh window pays nothing more today (review of PR 189).
  const said = sentenceTag(p.sentence ?? '');
  if (paid === 0 && said && world.sql.get("select 1 as x from ledger where player = ? and reason = ? and at >= ? and ref like ?", [p.playerId, SOLO_EARN_REASON, kstDayStart(p.nowMs), `%|s:${said}`])) return 0;
  const room = COIN_RULES.soloDailyCap - earnedToday(world, p.playerId, p.nowMs);
  const add = Math.min(target - paid, room);
  if (add <= 0) return 0;
  const ref = `${prefix}${p.stars}${said ? `|s:${said}` : ''}`;
  if (world.sql.get('select 1 as x from ledger where player = ? and ref = ?', [p.playerId, ref])) return 0;
  world.appendLedger(p.playerId, add, SOLO_EARN_REASON, ref, p.nowMs);
  return add;
}

/** A short tag of a sentence (letters only, lower case, FNV-1a): the same words with other punctuation are the same. */
export function sentenceTag(text: string): string {
  const t = text.toLowerCase().replace(/[^a-z]+/g, '');
  if (!t) return '';
  let h = 0x811c9dc5;
  for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(36);
}

/**
 * What a sold-back thing pays: half of what was paid for it (kept on the thing itself, also across a trade), never
 * half of today's price — buying at three stars and selling back can never make coins. Things from before this record
 * count as bought at the lowest price (three stars).
 */
function sellBackPay(spec: string | null, item: ShopItemDef): number {
  let paid = NaN;
  try {
    paid = Number((JSON.parse(spec ?? '{}') as { paid?: unknown }).paid);
  } catch {
    /* old spec */
  }
  const base = Number.isFinite(paid) && paid >= 0 ? paid : starPrice(item.price, 3);
  return Math.floor((base * COIN_RULES.sellBackPct) / 100);
}

function listPrice(deps: ShopDeps, worldId: string, base: number): number {
  return indexedPrice(base, deps.priceIndex?.(worldId) ?? 1);
}

/** What each owned shop thing sells back for (by item id), for the trade view. */
function sellPrices(world: WorldDO, playerId: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of world.sql.all<{ id: string; spec: string | null }>(
    "select id, spec from items where owner = ? and location in ('bag', 'hotbar', 'socket', 'equipped', 'chest')",
    [playerId]
  )) {
    const item = shopItem(itemKeyOfCard(r.id));
    if (item) out[r.id] = sellBackPay(r.spec, item);
  }
  return out;
}

/** Owned shop things by key (bag, chest, worn), from the child's items. */
function ownedCounts(world: WorldDO, playerId: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of world.sql.all<{ id: string }>(
    "select id from items where owner = ? and location in ('bag', 'hotbar', 'socket', 'equipped', 'chest')",
    [playerId]
  )) {
    const k = itemKeyOfCard(r.id);
    if (shopItem(k)) out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

function tableExists(sql: SqliteExecutor, name: string): boolean {
  return Boolean(sql.get("select 1 as x from sqlite_master where type = 'table' and name = ?", [name]));
}

/** Blocks the child placed on their plot today (KST): the plot journal (plot.ts) of the same home world. */
function placedToday(world: WorldDO, playerId: string, nowMs: number): number {
  let placed = 0;
  // a child with no plot yet has no journal table
  try {
    for (const r of world.sql.all<{ ops: string; results: string }>('select ops, results from plot_journal where actor = ? and at >= ?', [playerId, kstDayStart(nowMs)])) {
      const ops = JSON.parse(r.ops) as Array<{ op?: string }>;
      const res = JSON.parse(r.results) as Array<{ ok?: boolean }>;
      ops.forEach((o, i) => {
        if (o?.op === 'place' && res[i]?.ok === true) placed++;
      });
    }
  } catch {
    return 0;
  }
  return placed;
}

/** Server counts behind each daily quest (KST today). */
function questProgress(deps: ShopDeps, world: WorldDO, playerId: string, nowMs: number, placedNow?: number): Record<DailyQuestKey, number> {
  const from = kstDayStart(nowMs);
  const talk = Number(
    deps.db.sql.get<{ n: number }>(
      "select count(*) as n from utterances where player_id = ? and created_at >= ? and stars > 0 and session_kind <> 'lesson' and ctx <> 'trade'",
      [playerId, from]
    )?.n ?? 0
  );
  const bought = Number(
    world.sql.get<{ n: number }>("select count(*) as n from ledger where player = ? and at >= ? and substr(reason, 1, 9) = 'purchase:' and delta < 0", [
      playerId,
      from
    ])?.n ?? 0
  );
  const placed = placedNow ?? placedToday(world, playerId, nowMs);
  const shown =
    tableExists(deps.db.sql, 'showrooms') &&
    deps.db.sql.get('select 1 as x from showrooms where player_id = ? and updated_at >= ?', [playerId, from])
      ? 1
      : 0;
  return {
    talk5: talk,
    buy_english: bought,
    build_today: placed >= challengeOfDay(nowMs).placeGoal ? 1 : 0,
    show_build: shown
  };
}

function questsView(deps: ShopDeps, world: WorldDO, playerId: string, nowMs: number) {
  const placed = placedToday(world, playerId, nowMs);
  const prog = questProgress(deps, world, playerId, nowMs, placed);
  const day = kstDay(nowMs);
  const challenge = challengeOfDay(nowMs);
  return {
    day,
    challenge: { key: challenge.key, placed, goal: challenge.placeGoal },
    quests: DAILY_QUESTS.map((q) => ({
      key: q.key,
      progress: Math.min(prog[q.key], q.goal),
      goal: q.goal,
      reward: q.reward,
      claimed: Boolean(world.sql.get('select 1 as x from ledger where player = ? and ref = ?', [playerId, `quest:${day}:${q.key}`]))
    }))
  };
}

const BuySchema = z.object({
  player_id: z.string().min(1).max(64),
  world_id: z.string().min(1).max(96),
  item_key: z.string().min(1).max(48),
  request_id: z.string().regex(/^[A-Za-z0-9_-]{8,48}$/)
});
const SellSchema = z.object({ player_id: z.string().min(1).max(64), world_id: z.string().min(1).max(96), item_id: z.string().min(1).max(200) });
const ClaimSchema = z.object({
  player_id: z.string().min(1).max(64),
  world_id: z.string().min(1).max(96),
  quest: z.enum(['talk5', 'buy_english', 'build_today', 'show_build'])
});
const RoomSchema = z.string().regex(/^[A-Za-z0-9_:.-]{1,96}$/);
/** What the child said for a trade step (WP-509: both sides speak before a trade goes through). */
const SaidSchema = z.object({ transcript: z.string().max(300), stt_source: z.string().max(24).default('device'), confidence: z.number().min(0).max(1).default(0.9) });
const OfferSchema = z.object({
  player_id: z.string().min(1).max(64),
  world_id: z.string().min(1).max(96),
  room: RoomSchema,
  item_id: z.string().min(1).max(200),
  price: z.number().int().min(0).max(COIN_RULES.tradeMaxCoins),
  said: SaidSchema
});
const OfferActSchema = z.object({ player_id: z.string().min(1).max(64), world_id: z.string().min(1).max(96), offer_id: z.string().regex(/^p2p-[a-z0-9]{6,32}$/) });
const AcceptSchema = OfferActSchema.extend({ room: RoomSchema, said: SaidSchema });

/**
 * Scores a trade line on the server (no AI call) and logs it as the child's utterance, so it counts like any other
 * sentence (the talk goal, the parent's numbers). Returns whether it passed.
 */
function scoreTradeLine(deps: ShopDeps, p: { playerId: string; worldId: string; room: string; target: string; said: z.infer<typeof SaidSchema>; nowMs: number }): { pass: boolean; missed: string[] } {
  const level = (deps.db.sql.get<{ level: string }>('select level from players where id = ?', [p.playerId])?.level ?? 'L1') as 'L1';
  const r = scoreUtterance({ targetText: p.target, spokenTranscript: p.said.transcript, level, hintLevel: 'full' });
  const words = p.said.transcript.trim().split(/\s+/).filter(Boolean).length;
  deps.db.logUtterance({
    id: `utt-p2p-${p.nowMs}-${newId(deps)}`,
    player_id: p.playerId,
    world_id: p.worldId,
    session_id: `trade-${p.room}`,
    session_kind: 'multi',
    ctx: 'trade',
    mode: 'read',
    interlocutor: 'peer',
    first_text: p.said.transcript,
    target_text: p.target,
    final_text: p.said.transcript,
    words,
    l1_words: 0,
    dur_ms: 2000,
    latency_ms: 800,
    stars: r.pass ? 1 : 0,
    hint_level: 'full',
    attempts: 1,
    score: r.score,
    confidence: p.said.confidence,
    source: p.said.stt_source,
    audio_first: null,
    audio_final: null,
    created_at: p.nowMs
  });
  return { pass: r.pass, missed: r.missed };
}

type OfferRow = {
  id: string;
  room: string;
  seller: string;
  seller_name: string;
  item_id: string;
  item_key: string;
  spec: string;
  price: number;
  state: 'open' | 'sold' | 'cancelled' | 'lapsed';
  buyer: string | null;
  created_at: number;
  expires_at: number;
  settled_at: number | null;
  paid_out: number;
};

function newId(deps: ShopDeps): string {
  if (deps.randomId) return deps.randomId();
  const b = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(b, (x) => (x % 36).toString(36)).join('');
}

function itemLabel(key: string): { name_ko: string; emoji: string; label: string } {
  const s = shopItem(key);
  return s ? { name_ko: s.nameKo, emoji: s.emoji, label: `${s.adj} ${s.label}` } : { name_ko: key.replace(/_/g, ' '), emoji: '🧩', label: key.replace(/_/g, ' ') };
}

/**
 * The seller's side, run on their own requests only: lapsed offers give the thing back, sold ones pay out once.
 * Returns the coins paid out now.
 */
function settleSellerSide(deps: ShopDeps, world: WorldDO, playerId: string, nowMs: number): number {
  let paid = 0;
  const rows = deps.db.sql.all<OfferRow>(
    "select * from p2p_offers where seller = ? and ((state = 'open' and expires_at <= ?) or (state = 'sold' and paid_out = 0) or (state in ('cancelled', 'lapsed') and paid_out = 0))",
    [playerId, nowMs]
  );
  for (const o of rows) {
    runInTransaction(deps.db.sql, () => {
      if (o.state === 'sold') {
        const ref = `p2p:${o.id}:seller`;
        if (!world.sql.get('select 1 as x from ledger where player = ? and ref = ?', [playerId, ref])) {
          if (o.price > 0) world.appendLedger(playerId, o.price, 'trade_sold', ref, nowMs);
          paid += o.price;
        }
        deps.db.sql.run('update p2p_offers set paid_out = 1 where id = ?', [o.id]);
        return;
      }
      // open-but-lapsed, cancelled or lapsed and not yet returned: the thing goes back to the seller
      if (!world.sql.get('select 1 as x from items where id = ?', [o.item_id])) {
        world.grantOrSetItem(playerId, o.item_id, o.spec, landingPlace(world, playerId, o.item_id));
      }
      deps.db.sql.run("update p2p_offers set state = case when state = 'open' then 'lapsed' else state end, paid_out = 1, settled_at = coalesce(settled_at, ?) where id = ?", [
        nowMs,
        o.id
      ]);
    });
  }
  return paid;
}

function offerView(o: OfferRow, me: string) {
  return {
    id: o.id,
    mine: o.seller === me,
    seller_name: o.seller_name,
    item_key: o.item_key,
    ...itemLabel(o.item_key),
    price: o.price,
    state: o.state,
    expires_at: o.expires_at
  };
}

export function mountShopRoutes(app: Hono, deps: ShopDeps): void {
  deps.db.sql.exec(P2P_SCHEMA_SQL);

  /** One read when the shop window opens: prices, what the child owns, today's earnings and quests. */
  app.get('/v1/shop', (c) => {
    const playerId = c.req.query('player_id') ?? '';
    const worldId = c.req.query('world_id') ?? '';
    const world = deps.worlds.get(worldId);
    if (!playerId || !world) return c.json({ error: 'player_id_required' }, 400);
    const now = deps.nowMs();
    return c.json({
      coins_total: world.getPlayerBalance(playerId),
      prices: Object.fromEntries(SHOP_CATALOG.map((i) => [i.key, listPrice(deps, worldId, i.price)])),
      owned: ownedCounts(world, playerId),
      earned_today: earnedToday(world, playerId, now),
      earn_cap: COIN_RULES.soloDailyCap,
      sell_back_pct: COIN_RULES.sellBackPct,
      sell_prices: sellPrices(world, playerId),
      ...questsView(deps, world, playerId, now)
    });
  });

  app.post('/v1/shop/buy', async (c) => {
    const p = BuySchema.safeParse(await c.req.json().catch(() => undefined));
    if (!p.success) return c.json({ error: 'invalid_buy_request' }, 400);
    const { player_id: playerId, world_id: worldId, item_key: key, request_id: rid } = p.data;
    const item = shopItem(key);
    const world = deps.worlds.get(worldId);
    if (!item || !world) return c.json({ error: 'unknown_item' }, 404);
    const now = deps.nowMs();
    const ref = `shop:${rid}`;
    const itemId = `shop-${rid}|${key}`;
    const out = runInTransaction(deps.db.sql, () => {
      const done = world.sql.get<{ delta: number }>('select delta from ledger where player = ? and ref = ?', [playerId, ref]);
      if (done) {
        const same = world.sql.get<{ reason: string }>('select reason from ledger where player = ? and ref = ?', [playerId, ref])?.reason === `shop:${key}`;
        if (!same) return { status: 409 as const, body: { error: 'request_reused' } };
        return { status: 200 as const, body: { ok: true, repeated: true, item_id: itemId, paid: -Number(done.delta) } };
      }
      const price = listPrice(deps, worldId, item.price);
      const balance = world.getPlayerBalance(playerId);
      if (balance < price) return { status: 409 as const, body: { error: 'short_of_coins', need: price - balance, coins_total: balance } };
      world.appendLedger(playerId, -price, `shop:${key}`, ref, now);
      const place = landingPlace(world, playerId, itemId);
      world.grantOrSetItem(playerId, itemId, JSON.stringify({ kind: 'shop', item: key, cat: item.cat, paid: price, ...(item.block ? { block: item.block.key, count: item.block.count } : {}) }), place);
      return { status: 201 as const, body: { ok: true, item_id: itemId, paid: price, location: place === 'chest' ? 'chest' : 'bag' } };
    });
    return c.json({ ...out.body, coins_total: world.getPlayerBalance(playerId) }, out.status);
  });

  /** Selling one owned shop thing back to the shopkeeper (the NPC side of trading). */
  app.post('/v1/shop/sell', async (c) => {
    const p = SellSchema.safeParse(await c.req.json().catch(() => undefined));
    if (!p.success) return c.json({ error: 'invalid_sell_request' }, 400);
    const { player_id: playerId, world_id: worldId, item_id: itemId } = p.data;
    const world = deps.worlds.get(worldId);
    if (!world) return c.json({ error: 'item_not_found' }, 404);
    const key = itemKeyOfCard(itemId);
    const item = shopItem(key);
    const now = deps.nowMs();
    const out = runInTransaction(deps.db.sql, () => {
      const row = world.sql.get<{ spec: string | null }>('select spec from items where id = ? and owner = ?', [itemId, playerId]);
      if (!row || !item) return { status: 404 as const, body: { error: 'item_not_found' } };
      // one thing sells once, even if it came back some other way (review of PR 189)
      if (world.sql.get('select 1 as x from ledger where player = ? and ref = ?', [playerId, `sell:${itemId}`])) {
        return { status: 409 as const, body: { error: 'already_sold' } };
      }
      const pay = sellBackPay(row.spec, item);
      world.sql.run('delete from items where id = ? and owner = ?', [itemId, playerId]);
      world.appendLedger(playerId, pay, `sell:${key}`, `sell:${itemId}`, now);
      return { status: 200 as const, body: { ok: true, paid: pay } };
    });
    return c.json({ ...out.body, coins_total: world.getPlayerBalance(playerId) }, out.status);
  });

  app.post('/v1/quests/claim', async (c) => {
    const p = ClaimSchema.safeParse(await c.req.json().catch(() => undefined));
    if (!p.success) return c.json({ error: 'invalid_claim' }, 400);
    const { player_id: playerId, world_id: worldId, quest } = p.data;
    const world = deps.worlds.get(worldId);
    if (!world) return c.json({ error: 'invalid_claim' }, 400);
    const now = deps.nowMs();
    const def = DAILY_QUESTS.find((q) => q.key === quest)!;
    const prog = questProgress(deps, world, playerId, now)[quest];
    if (prog < def.goal) return c.json({ error: 'not_done', progress: prog, goal: def.goal }, 409);
    const ref = `quest:${kstDay(now)}:${quest}`;
    const fresh = runInTransaction(deps.db.sql, () => {
      if (world.sql.get('select 1 as x from ledger where player = ? and ref = ?', [playerId, ref])) return false;
      world.appendLedger(playerId, def.reward, `quest:${quest}`, ref, now);
      return true;
    });
    return c.json({ ok: true, repeated: !fresh, reward: fresh ? def.reward : 0, coins_total: world.getPlayerBalance(playerId) });
  });

  /** Offers in my room (others' open ones, and mine), after settling my own side. */
  app.get('/v1/p2p/offers', (c) => {
    const playerId = c.req.query('player_id') ?? '';
    const world = deps.worlds.get(c.req.query('world_id') ?? '');
    const room = RoomSchema.safeParse(c.req.query('room') ?? '');
    if (!playerId || !world || !room.success) return c.json({ error: 'invalid_offer_list' }, 400);
    const now = deps.nowMs();
    const paidOut = settleSellerSide(deps, world, playerId, now);
    const rows = deps.db.sql.all<OfferRow>(
      "select * from p2p_offers where room = ? and state = 'open' and expires_at > ? order by created_at desc limit 40",
      [room.data, now]
    );
    const mineDone = deps.db.sql.all<OfferRow>(
      "select * from p2p_offers where seller = ? and state <> 'open' and settled_at >= ? order by settled_at desc limit 10",
      [playerId, now - COIN_RULES.tradeTtlMs]
    );
    return c.json({
      offers: rows.map((o) => offerView(o, playerId)),
      my_recent: mineDone.map((o) => offerView(o, playerId)),
      paid_out: paidOut,
      coins_total: world.getPlayerBalance(playerId)
    });
  });

  app.post('/v1/p2p/offer', async (c) => {
    const p = OfferSchema.safeParse(await c.req.json().catch(() => undefined));
    if (!p.success) return c.json({ error: 'invalid_offer' }, 400);
    const { player_id: playerId, world_id: worldId, room, item_id: itemId, price, said } = p.data;
    const world = deps.worlds.get(worldId);
    if (!world) return c.json({ error: 'item_not_found' }, 404);
    const now = deps.nowMs();
    if (!world.sql.get('select 1 as x from items where id = ? and owner = ?', [itemId, playerId])) return c.json({ error: 'item_not_found' }, 404);
    const line = tradeLines(itemKeyOfCard(itemId)).offer;
    const spoken = scoreTradeLine(deps, { playerId, worldId, room, target: line, said, nowMs: now });
    if (!spoken.pass) return c.json({ error: 'say_it_again', target: line, missed: spoken.missed }, 422);
    const open = Number(deps.db.sql.get<{ n: number }>("select count(*) as n from p2p_offers where seller = ? and state = 'open' and expires_at > ?", [playerId, now])?.n ?? 0);
    if (open >= COIN_RULES.tradeOpenMax) return c.json({ error: 'too_many_offers', max: COIN_RULES.tradeOpenMax }, 409);
    const nick = deps.db.sql.get<{ nickname: string }>('select nickname from players where id = ?', [playerId])?.nickname ?? '';
    const id = `p2p-${newId(deps)}`;
    const out = runInTransaction(deps.db.sql, () => {
      const row = world.sql.get<{ spec: string }>('select spec from items where id = ? and owner = ?', [itemId, playerId]);
      if (!row) return { status: 404 as const, body: { error: 'item_not_found' } };
      // escrow: the thing leaves the seller's items until it is sold, cancelled or lapses
      world.sql.run('delete from items where id = ? and owner = ?', [itemId, playerId]);
      deps.db.sql.run(
        "insert into p2p_offers (id, room, seller, seller_name, item_id, item_key, spec, price, state, buyer, created_at, expires_at, settled_at, paid_out) values (?, ?, ?, ?, ?, ?, ?, ?, 'open', null, ?, ?, null, 0)",
        [id, room, playerId, nick.slice(0, 24), itemId, itemKeyOfCard(itemId), row.spec, price, now, now + COIN_RULES.tradeTtlMs]
      );
      return { status: 201 as const, body: { ok: true, offer_id: id, expires_at: now + COIN_RULES.tradeTtlMs } };
    });
    return c.json(out.body, out.status);
  });

  app.post('/v1/p2p/accept', async (c) => {
    const p = AcceptSchema.safeParse(await c.req.json().catch(() => undefined));
    if (!p.success) return c.json({ error: 'invalid_accept' }, 400);
    const { player_id: playerId, world_id: worldId, offer_id: offerId, said, room } = p.data;
    const world = deps.worlds.get(worldId);
    if (!world) return c.json({ error: 'offer_not_found' }, 404);
    const now = deps.nowMs();
    // only an offer of the buyer's own room (review of PR 189: an offer id from elsewhere is not a way in)
    const pre = deps.db.sql.get<OfferRow>('select * from p2p_offers where id = ? and room = ?', [offerId, room]);
    if (pre && pre.state === 'open' && pre.seller !== playerId && pre.expires_at > now) {
      const line = tradeLines(pre.item_key).accept;
      const spoken = scoreTradeLine(deps, { playerId, worldId, room: pre.room, target: line, said, nowMs: now });
      if (!spoken.pass) return c.json({ error: 'say_it_again', target: line, missed: spoken.missed }, 422);
    }
    const out = runInTransaction(deps.db.sql, () => {
      const o = deps.db.sql.get<OfferRow>('select * from p2p_offers where id = ? and room = ?', [offerId, room]);
      if (!o) return { status: 404 as const, body: { error: 'offer_not_found' } };
      if (o.state === 'sold' && o.buyer === playerId) return { status: 200 as const, body: { ok: true, repeated: true, item_id: o.item_id } };
      if (o.state !== 'open' || o.expires_at <= now) return { status: 409 as const, body: { error: 'offer_closed' } };
      if (o.seller === playerId) return { status: 409 as const, body: { error: 'own_offer' } };
      const balance = world.getPlayerBalance(playerId);
      if (balance < o.price) return { status: 409 as const, body: { error: 'short_of_coins', need: o.price - balance } };
      if (o.price > 0) world.appendLedger(playerId, -o.price, 'trade_bought', `p2p:${o.id}:buyer`, now);
      const place = landingPlace(world, playerId, o.item_id);
      world.grantOrSetItem(playerId, o.item_id, o.spec, place);
      deps.db.sql.run("update p2p_offers set state = 'sold', buyer = ?, settled_at = ? where id = ? and state = 'open'", [playerId, now, o.id]);
      return { status: 200 as const, body: { ok: true, item_id: o.item_id, paid: o.price, location: place === 'chest' ? 'chest' : 'bag' } };
    });
    return c.json({ ...out.body, coins_total: world.getPlayerBalance(playerId) }, out.status);
  });

  app.post('/v1/p2p/cancel', async (c) => {
    const p = OfferActSchema.safeParse(await c.req.json().catch(() => undefined));
    if (!p.success) return c.json({ error: 'invalid_cancel' }, 400);
    const { player_id: playerId, world_id: worldId, offer_id: offerId } = p.data;
    const world = deps.worlds.get(worldId);
    if (!world) return c.json({ error: 'offer_not_found' }, 404);
    const now = deps.nowMs();
    const changed = runInTransaction(deps.db.sql, () => {
      const o = deps.db.sql.get<OfferRow>("select * from p2p_offers where id = ? and seller = ? and state = 'open'", [offerId, playerId]);
      if (!o) return false;
      deps.db.sql.run("update p2p_offers set state = 'cancelled', settled_at = ? where id = ?", [now, o.id]);
      return true;
    });
    if (!changed) return c.json({ error: 'offer_closed' }, 409);
    settleSellerSide(deps, world, playerId, now);
    return c.json({ ok: true, coins_total: world.getPlayerBalance(playerId) });
  });
}
