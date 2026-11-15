import { describe, expect, it } from 'vitest';
import { QuotaMeter } from '@lcw/quota';
import { CAFE_MENU, starPrice } from '@lcw/content';
import { TUNING } from '@lcw/sim-core';
import { createNodeSqliteExecutor } from '../node-sqlite.js';
import { createEdgeApp } from '../app.js';
import { prefixedExecutor, worldPrefix } from '../do-sqlite.js';
import { EdgePlatformDb, InMemoryR2Store, WorldDO, type SqliteExecutor } from '../storage.js';
import { PlatformDO, type LcwEnv } from '../platform.js';
import { indexedPrice, priceIndexOf, runWeeklyPriceIndexes, worldFlow } from '../economy.js';
import { fakeDurableStorage } from './fake-do.js';

/**
 * WP-405 / docs/09 P7: the weekly cron moves each world's price index from that world's own ledger only
 * ("다른 월드의 수입 변화가 영향 0"), ±5% a week inside 0.8~1.25, and shop prices in that world follow it.
 */

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 16, 6, 0, 0); // Monday 06:00 UTC (cron)

function platformSql() {
  const sql = createNodeSqliteExecutor(':memory:');
  const db = new EdgePlatformDb(sql);
  const world = (id: string) => {
    sql.run("insert or ignore into worlds (id, owner_id, name, seed, gen_version, mode, lang) values (?, 'o', ?, ?, 1, 'survival_city', 'en')", [id, id, id]);
    return new WorldDO({ sql: prefixedExecutor(sql, worldPrefix(id)), r2: new InMemoryR2Store(), seed: id });
  };
  return { sql, db, world };
}

function earn(w: WorldDO, coins: number, at: number) {
  w.appendLedger('p', coins, 'job_pay', `pay-${at}-${coins}`, at);
}
function spend(w: WorldDO, coins: number, at: number) {
  w.appendLedger('p', -coins, 'purchase:cafe:tea:1', `buy-${at}-${coins}`, at);
}

describe('weekly price index per world (docs/09 P7)', () => {
  it('coins piling up raise only that world; a spending world falls; the starter purse is not income', () => {
    const { sql, world } = platformSql();
    const a = world('town-a');
    const b = world('town-b');
    a.appendLedger('p', 200, 'starter', 'starter', NOW - DAY);
    earn(a, 1000, NOW - 2 * DAY);
    spend(a, 100, NOW - DAY);
    earn(b, 100, NOW - 3 * DAY);
    spend(b, 900, NOW - 2 * DAY);
    expect(worldFlow(sql, 'town-a', NOW - 7 * DAY, NOW)).toEqual({ worldId: 'town-a', income: 1000, spend: 100 });
    const run = runWeeklyPriceIndexes(sql, NOW);
    expect(run.worlds).toBe(2);
    expect(priceIndexOf(sql, 'town-a')).toBeCloseTo(1 + TUNING.economy.priceIndexWeeklyStepMax, 4);
    expect(priceIndexOf(sql, 'town-b')).toBeLessThan(1);
  });

  it("another world's income changing has zero effect (fault check: a server-wide sum would move it)", () => {
    const run = (extraIncomeInA: number) => {
      const { sql, world } = platformSql();
      const a = world('roleplay');
      const b = world('survival');
      earn(a, 500 + extraIncomeInA, NOW - DAY);
      earn(b, 300, NOW - DAY);
      spend(b, 280, NOW - DAY);
      runWeeklyPriceIndexes(sql, NOW);
      return priceIndexOf(sql, 'survival');
    };
    expect(run(0)).toBe(run(100_000));
  });

  it('a retried weekly run does not step a world twice; next week steps again; the index stops at 1.25', () => {
    const { sql, world } = platformSql();
    const a = world('rich');
    for (let wk = 0; wk < 8; wk++) earn(a, 10_000, NOW + wk * 7 * DAY - DAY);
    const first = runWeeklyPriceIndexes(sql, NOW);
    const again = runWeeklyPriceIndexes(sql, NOW + 3_600_000);
    expect(again.worlds).toBe(0);
    expect(again.skipped_already_run).toBe(1);
    expect(priceIndexOf(sql, 'rich')).toBeCloseTo(1.05, 4);
    let last = first;
    for (let wk = 1; wk < 8; wk++) last = runWeeklyPriceIndexes(sql, NOW + wk * 7 * DAY);
    expect(priceIndexOf(sql, 'rich')).toBe(TUNING.economy.marketIndexMax);
    expect(last.at_limit).toEqual(['rich']);
    const hist = sql.all<{ week: string }>("select week from price_index_history where world_id = 'rich'");
    expect(hist).toHaveLength(8);
  });

  it("shop prices in a world follow that world's index (server price, never the client's)", async () => {
    const db = new EdgePlatformDb(createNodeSqliteExecutor(':memory:'));
    db.ensureFamilyAndPlayer({ familyId: 'f', guardianId: 'g', playerId: 'kid', nickname: 'Kid', level: 'L2', nowMs: 1 });
    const w = new WorldDO({ sql: createNodeSqliteExecutor(':memory:'), r2: new InMemoryR2Store(), seed: 's' });
    w.appendLedger('kid', 500, 'starter', 'starter', 1);
    const app = createEdgeApp({
      db,
      worlds: new Map([['w', w]]),
      lessons: new Map(),
      quota: new QuotaMeter('2026-11-16'),
      nowMs: () => NOW,
      priceIndex: (id) => (id === 'w' ? 1.2 : 1)
    });
    const text = 'Can I get a cold smoothie?';
    const res = await app.request('/v1/converse/score', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dialog_id: 'd', hint_level: 'full', player_id: 'kid', world_id: 'w', session_id: 's', npc_ctx: 'cafe', level: 'L2', chosen_stars: 2, target_text: text, transcript: text, price: 1 })
    });
    const j = (await res.json()) as { granted: { coins_delta: number } };
    const smoothie = CAFE_MENU.find((d) => d.key === 'smoothie')!;
    expect(j.granted.coins_delta).toBe(-indexedPrice(starPrice(smoothie.basePrice, 2), 1.2));
    expect(j.granted.coins_delta).not.toBe(-starPrice(smoothie.basePrice, 2));
  });
});

describe('platform weekly cron (0 6 * * 1) runs the balancer', () => {
  it('writes each world index from its own ledger and records the run', async () => {
    const TOKEN = 'op-token-0123456789abcdef';
    const p = new PlatformDO({ storage: fakeDurableStorage() }, { PLATFORM: undefined as never, LCW_OPERATOR_TOKEN: TOKEN } as LcwEnv);
    const sql = p.sql as SqliteExecutor;
    sql.run("insert into worlds (id, owner_id, name, seed, gen_version, mode, lang) values ('busy-town', 'o', 'Busy', 'busy', 1, 'roleplay_town', 'en')");
    const w = new WorldDO({ sql: prefixedExecutor(sql, worldPrefix('busy-town')), r2: new InMemoryR2Store(), seed: 'busy' });
    w.appendLedger('p', 5000, 'job_pay', 'pay-1', Date.now() - DAY);
    const res = await p.fetch(
      new Request('https://platform/internal/cron', {
        method: 'POST',
        headers: { 'x-lcw-internal': 'cron', 'content-type': 'application/json' },
        body: JSON.stringify({ cron: '0 6 * * 1' })
      })
    );
    const body = (await res.json()) as { task: string; ok: boolean; detail: { price_index: { changed: Array<{ world_id: string }> } } };
    expect(body.ok).toBe(true);
    expect(body.task).toBe('weekly_parent_reports');
    expect(body.detail.price_index.changed.map((c) => c.world_id)).toEqual(['busy-town']);
    expect(priceIndexOf(sql, 'busy-town')).toBeCloseTo(1.05, 4);
    expect(priceIndexOf(sql, 'world-demo')).toBe(1);
    const run = sql.get<{ detail: string }>("select detail from ops_runs where task = 'weekly_parent_reports'");
    expect(run?.detail).toContain('price_index');
  });
});
