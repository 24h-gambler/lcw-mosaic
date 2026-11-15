import { FIRST_ERRAND } from '@lcw/content';
import { TUNING } from '@lcw/sim-core';
import type { EdgePlatformDb, WorldDO } from './storage.js';

/**
 * The first-visit 1-minute errand (docs/03 D1, D3 "+50 coins", WP-111) and the activation clock (docs/09 "첫 문장까지
 * 시간(신규) 3분 이내"). One errand per player, moved only by the server from scored sentences:
 *
 *   offered --(errand giver, accept line)--> accepted --(buys the asked drink at the cafe)--> carrying
 *           --(errand giver, hand-over line)--> done (+50 coins to the ledger, once, ref errand:<id>)
 *
 * The child's sentences are scored like any other line (`/v1/converse/score`, ctx `errand`, price 0); the drink is a
 * normal cafe purchase (the first order). Handing it over moves that drink out of the bag.
 */

export type ErrandState = 'offered' | 'accepted' | 'carrying' | 'done';

export interface ErrandView {
  id: string;
  state: ErrandState;
  item_key: string;
  item_mod: string;
  item_ko: string;
  reward_coins: number;
  npc_line: string;
  /** Activation clock: first seen, first passed sentence, first purchase (ms since epoch). */
  started_at: number;
  first_pass_at: number | null;
  first_order_at: number | null;
  done_at: number | null;
}

type ErrandRow = {
  id: string;
  player_id: string;
  kind: string;
  item_key: string;
  state: ErrandState;
  created_at: number;
  accepted_at: number | null;
  carried_at: number | null;
  done_at: number | null;
  first_pass_at: number | null;
  first_order_at: number | null;
  reward: number;
};

export function ensureErrandSchema(db: EdgePlatformDb): void {
  db.sql.exec(
    `create table if not exists errands (id text primary key, player_id text not null, kind text not null, item_key text not null,
      state text not null, created_at integer not null, accepted_at integer, carried_at integer, done_at integer,
      first_pass_at integer, first_order_at integer, reward integer not null default 0, unique (player_id, kind))`
  );
}

function rowOf(db: EdgePlatformDb, playerId: string): ErrandRow | null {
  ensureErrandSchema(db);
  return db.sql.get<ErrandRow>("select * from errands where player_id = ? and kind = 'first'", [playerId]) ?? null;
}

function view(r: ErrandRow): ErrandView {
  const lines = FIRST_ERRAND.lines;
  return {
    id: r.id,
    state: r.state,
    item_key: FIRST_ERRAND.item,
    item_mod: FIRST_ERRAND.mod,
    item_ko: FIRST_ERRAND.itemKo,
    reward_coins: r.reward,
    npc_line: r.state === 'offered' ? lines.ask : r.state === 'accepted' ? lines.waiting : r.state === 'carrying' ? lines.deliver : lines.thanks,
    started_at: r.created_at,
    first_pass_at: r.first_pass_at,
    first_order_at: r.first_order_at,
    done_at: r.done_at
  };
}

/** The player's first errand, created the first time the game asks (that moment starts the activation clock). */
export function getErrand(db: EdgePlatformDb, playerId: string, nowMs: number): ErrandView {
  const r = rowOf(db, playerId);
  if (r) return view(r);
  db.sql.run(
    "insert or ignore into errands (id, player_id, kind, item_key, state, created_at, reward) values (?, ?, 'first', ?, 'offered', ?, 0)",
    [`errand-first-${playerId}`, playerId, FIRST_ERRAND.item, nowMs]
  );
  return view(rowOf(db, playerId)!);
}

export interface ErrandStepResult {
  state: ErrandState;
  /** Coins paid by this step (only the hand-over). */
  reward_coins?: number;
}

/**
 * Called by `/v1/converse/score` after the sentence is decided (solo play only). Returns the errand state when this
 * sentence concerned the errand, else undefined. Never pays twice: the ledger ref is the errand id.
 */
export function applyErrandStep(
  db: EdgePlatformDb,
  world: WorldDO | undefined,
  s: { playerId: string; ctx: string; pass: boolean; askedKey?: string; grantedItem: string | null; nowMs: number }
): ErrandStepResult | undefined {
  if (s.ctx !== 'errand' && !s.pass && !s.grantedItem) return undefined;
  let r = rowOf(db, s.playerId);
  if (!r && s.ctx === 'errand') {
    getErrand(db, s.playerId, s.nowMs);
    r = rowOf(db, s.playerId);
  }
  if (!r) return undefined;
  if (s.pass && r.first_pass_at === null) db.sql.run('update errands set first_pass_at = ? where id = ?', [s.nowMs, r.id]);
  if (s.grantedItem && r.first_order_at === null) db.sql.run('update errands set first_order_at = ? where id = ?', [s.nowMs, r.id]);

  if (s.ctx === 'errand' && s.pass && s.askedKey === 'errand_accept' && r.state === 'offered') {
    db.sql.run("update errands set state = 'accepted', accepted_at = ? where id = ?", [s.nowMs, r.id]);
    return { state: 'accepted' };
  }
  if (s.grantedItem === r.item_key && r.state === 'accepted') {
    db.sql.run("update errands set state = 'carrying', carried_at = ? where id = ?", [s.nowMs, r.id]);
    return { state: 'carrying' };
  }
  if (s.ctx === 'errand' && s.pass && s.askedKey === 'errand_deliver' && r.state === 'carrying') {
    const reward = TUNING.economy.errandRewardCoins;
    const ref = `errand:${r.id}`;
    if (world) {
      const paid = world.sql.get<{ n: number }>('select count(*) as n from ledger where player = ? and ref = ?', [s.playerId, ref]);
      if (Number(paid?.n ?? 0) === 0) world.appendLedger(s.playerId, reward, 'errand:first', ref, s.nowMs);
      // The drink leaves the bag: it was handed over (the newest one of that kind the child bought).
      const drink = world.sql.get<{ id: string }>(
        "select id from items where owner = ? and location = 'bag' and id like ? order by rowid desc limit 1",
        [s.playerId, `buy-%|${r.item_key}`]
      );
      if (drink) world.sql.run("update items set location = 'given' where id = ?", [drink.id]);
    }
    db.sql.run("update errands set state = 'done', done_at = ?, reward = ? where id = ?", [s.nowMs, reward, r.id]);
    return { state: 'done', reward_coins: reward };
  }
  return s.ctx === 'errand' ? { state: r.state } : undefined;
}
