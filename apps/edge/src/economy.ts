import { TUNING, computeWeeklyPriceIndexes, type WorldEconomyFlow } from '@lcw/sim-core';
import { prefixedExecutor, worldPrefix } from './do-sqlite.js';
import type { SqliteExecutor } from './storage.js';

/**
 * docs/09 P7 economy balancer (weekly cron, WP-405): each world's price index moves from THAT world's own coin
 * income vs spend over the week (`computeWeeklyPriceIndexes`), never from server-wide totals, so a role-play town
 * that pays double cannot raise prices in a survival city. The index then multiplies that world's shop prices in
 * /v1/converse/score. The ledger is the only coin record, so flows are read from each world's ledger.
 */

const WEEK_MS = 7 * 86_400_000;
const KST_MS = 9 * 3_600_000;

export function ensurePriceIndexSchema(sql: SqliteExecutor): void {
  sql.exec('create table if not exists world_price_index (world_id text primary key, idx real not null, updated_at integer not null)');
  sql.exec(
    'create table if not exists price_index_history (world_id text not null, week text not null, idx_before real not null, idx real not null, income integer not null, spend integer not null, at integer not null, primary key (world_id, week))'
  );
}

/** KST date of the run, the key that keeps a retried weekly run from stepping a world twice. */
export function priceWeekKey(nowMs: number): string {
  return new Date(nowMs + KST_MS).toISOString().slice(0, 10);
}

/**
 * Income = coins that came into players in this world (rewards, refunds of overpayment are netted out of spend);
 * the starting purse is a one-off grant, not income. Spend = coins paid out (purchases, fees, fines).
 */
export function worldFlow(sql: SqliteExecutor, worldId: string, fromMs: number, toMs: number): WorldEconomyFlow {
  const prefix = worldPrefix(worldId);
  const exists = sql.get<{ n: number }>("select count(*) as n from sqlite_master where type = 'table' and name = ?", [
    `${prefix}_ledger`
  ]);
  if (!exists || Number(exists.n) === 0) return { worldId, income: 0, spend: 0 };
  const w = prefixedExecutor(sql, prefix);
  const row = w.get<{ income: number; spend: number; refunds: number }>(
    `select
       coalesce(sum(case when delta > 0 and reason <> 'starter' and reason not like '%:better_stars' then delta else 0 end), 0) as income,
       coalesce(sum(case when delta < 0 then -delta else 0 end), 0) as spend,
       coalesce(sum(case when delta > 0 and reason like '%:better_stars' then delta else 0 end), 0) as refunds
     from ledger where at >= ? and at < ?`,
    [fromMs, toMs]
  );
  return {
    worldId,
    income: Number(row?.income ?? 0),
    spend: Math.max(0, Number(row?.spend ?? 0) - Number(row?.refunds ?? 0))
  };
}

export function priceIndexOf(sql: SqliteExecutor, worldId: string): number {
  ensurePriceIndexSchema(sql);
  const r = sql.get<{ idx: number }>('select idx from world_price_index where world_id = ?', [worldId]);
  return r ? Number(r.idx) : 1;
}

/** Shop price in a world: the bank (star) price times the world's index, rounded to whole coins. */
export function indexedPrice(price: number, index: number): number {
  if (price <= 0) return price;
  return Math.max(1, Math.round(price * index));
}

export interface WeeklyPriceIndexRun {
  week: string;
  worlds: number;
  changed: Array<{ world_id: string; from: number; to: number; income: number; spend: number }>;
  /** docs/09 P7: worlds whose index reached 0.8 or 1.25; the cron run detail (ops_runs) carries them to the operator. */
  at_limit: string[];
  skipped_already_run: number;
}

export function runWeeklyPriceIndexes(sql: SqliteExecutor, nowMs: number): WeeklyPriceIndexRun {
  ensurePriceIndexSchema(sql);
  const week = priceWeekKey(nowMs);
  const worlds = sql.all<{ id: string }>('select id from worlds where archived = 0 order by id');
  const done = new Set(
    sql.all<{ world_id: string }>('select world_id from price_index_history where week = ?', [week]).map((r) => r.world_id)
  );
  const todo = worlds.filter((w) => !done.has(w.id));
  const flows = todo.map((w) => worldFlow(sql, w.id, nowMs - WEEK_MS, nowMs));
  const current = new Map(todo.map((w) => [w.id, priceIndexOf(sql, w.id)]));
  const next = computeWeeklyPriceIndexes(current, flows);
  const changed: WeeklyPriceIndexRun['changed'] = [];
  const atLimit: string[] = [];
  for (const f of flows) {
    const from = current.get(f.worldId) ?? 1;
    const to = next.get(f.worldId) ?? from;
    sql.run(
      `insert into world_price_index (world_id, idx, updated_at) values (?, ?, ?)
       on conflict(world_id) do update set idx = excluded.idx, updated_at = excluded.updated_at`,
      [f.worldId, to, nowMs]
    );
    sql.run(
      'insert or ignore into price_index_history (world_id, week, idx_before, idx, income, spend, at) values (?, ?, ?, ?, ?, ?, ?)',
      [f.worldId, week, from, to, f.income, f.spend, nowMs]
    );
    if (to !== from) changed.push({ world_id: f.worldId, from, to, income: f.income, spend: f.spend });
    if (to <= TUNING.economy.marketIndexMin || to >= TUNING.economy.marketIndexMax) atLimit.push(f.worldId);
  }
  return { week, worlds: todo.length, changed, at_limit: atLimit, skipped_already_run: done.size };
}
