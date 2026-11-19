import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { QuotaMeter } from '@lcw/quota';
import { CAFE_MENU, FIRST_ERRAND, lookupPhraseBank, starPrice } from '@lcw/content';
import { TUNING } from '@lcw/sim-core';
import { createNodeSqliteExecutor } from '../node-sqlite.js';
import { createEdgeApp } from '../app.js';
import { EdgePlatformDb, InMemoryR2Store, WorldDO } from '../storage.js';
import { PlatformDO, type LcwEnv } from '../platform.js';
import { fakeDurableStorage } from './fake-do.js';

/** WP-111 / docs/03 D1: the first-visit 1-minute errand through the real score route, paid once from the ledger. */

const T0 = Date.UTC(2026, 10, 16, 6, 0, 0);
const line = (step: 'errand_accept' | 'errand_deliver', stars: 1 | 2 | 3, level: 'L1' | 'L2' | 'L3' = 'L2') =>
  lookupPhraseBank({ ctx: 'errand', level, item: step })!.offers[stars - 1]!.text;
const water = (stars: 1 | 2 | 3) => lookupPhraseBank({ ctx: 'cafe', level: 'L2', item: FIRST_ERRAND.item, modifiers: [FIRST_ERRAND.mod] })!.offers[stars - 1]!.text;

function env() {
  let now = T0;
  const db = new EdgePlatformDb(createNodeSqliteExecutor(':memory:'));
  db.ensureFamilyAndPlayer({ familyId: 'f', guardianId: 'g', playerId: 'kid', nickname: 'Kid', level: 'L2', nowMs: 1 });
  const world = new WorldDO({ sql: createNodeSqliteExecutor(':memory:'), r2: new InMemoryR2Store(), seed: 's' });
  world.appendLedger('kid', 200, 'starter', 'starter', 1);
  const app = createEdgeApp({ db, worlds: new Map([['w', world]]), lessons: new Map(), quota: new QuotaMeter('2026-11-16'), nowMs: () => now });
  const say = async (dialog: string, ctx: string, text: string, stars: 1 | 2 | 3, extra: Record<string, unknown> = {}) => {
    const res = await app.request('/v1/converse/score', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dialog_id: dialog, hint_level: 'full', player_id: 'kid', world_id: 'w', session_id: 's', npc_ctx: ctx, level: 'L2', chosen_stars: stars, target_text: text, transcript: text, strict_bank: true, ...extra })
    });
    return (await res.json()) as Record<string, any>;
  };
  const get = async () => (await (await app.request('/v1/errand?player_id=kid')).json()) as Record<string, any>;
  return { db, world, say, get, tick: (ms: number) => (now += ms) };
}

describe('first-visit errand (docs/03 D1, WP-111)', () => {
  it('ask -> accept -> buy the cold water at the cafe -> hand it over: +50 once, the drink leaves the bag', async () => {
    const e = env();
    const first = await e.get();
    expect(first).toMatchObject({ state: 'offered', item_key: 'water', reward_coins: 0, npc_line: FIRST_ERRAND.lines.ask, started_at: T0 });

    e.tick(20_000);
    const acc = await e.say('d-acc', 'errand', line('errand_accept', 2), 2);
    expect(acc.pass).toBe(true);
    expect(acc.errand).toEqual({ state: 'accepted' });
    expect(acc.granted).toBeNull();
    expect(acc.memory_card).toBeNull(); // errand lines are not memory cards

    e.tick(30_000);
    const order = await e.say('d-cafe', 'cafe', water(2), 2);
    const price = starPrice(CAFE_MENU.find((d) => d.key === 'water')!.basePrice, 2);
    expect(order.granted).toMatchObject({ item_id: 'water', coins_delta: -price });
    expect(order.errand).toEqual({ state: 'carrying' });

    e.tick(25_000);
    const give = await e.say('d-give', 'errand', line('errand_deliver', 3), 3);
    expect(give.errand).toEqual({ state: 'done', reward_coins: TUNING.economy.errandRewardCoins });
    // + the errand's 50, + what the three passed sentences earned (R326 ⑤: 2★, 2★, 3★ × 5)
    expect(give.coins_total).toBe(200 - price + 50 + (2 + 2 + 3) * 5);
    expect(e.world.sql.get<{ location: string }>("select location from items where id = 'buy-d-cafe|water'")?.location).toBe('given');

    // saying it again pays nothing more
    const again = await e.say('d-give2', 'errand', line('errand_deliver', 3), 3);
    expect(again.errand).toEqual({ state: 'done' });
    // the errand pays nothing more, and the same sentence earns once a day (R326 ⑤)
    expect(e.world.getPlayerBalance('kid')).toBe(give.coins_total);
    const paid = e.world.sql.all<{ reason: string; delta: number }>("select reason, delta from ledger where reason = 'errand:first'");
    expect(paid).toEqual([{ reason: 'errand:first', delta: 50 }]);

    const v = await e.get();
    expect(v).toMatchObject({ state: 'done', reward_coins: 50, first_pass_at: T0 + 20_000, first_order_at: T0 + 50_000, done_at: T0 + 75_000 });
    // the activation clock: first passed sentence 20 s and first order 50 s after the first visit (target: 3 min)
    expect(v.first_order_at - v.started_at).toBeLessThanOrEqual(180_000);
  });

  it('no shortcuts: handing over before buying pays nothing; another drink does not count; a failed line does not accept', async () => {
    const e = env();
    await e.get();
    expect((await e.say('d1', 'errand', 'banana', 1)).errand).toEqual({ state: 'offered' });
    expect((await e.say('d2', 'errand', line('errand_deliver', 2), 2)).errand).toEqual({ state: 'offered' });
    await e.say('d3', 'errand', line('errand_accept', 1), 1);
    const juice = lookupPhraseBank({ ctx: 'cafe', level: 'L2', item: 'smoothie', modifiers: ['cold'] })!.offers[1]!.text;
    expect((await e.say('d4', 'cafe', juice, 2)).errand).toBeUndefined();
    expect((await e.say('d5', 'errand', line('errand_deliver', 2), 2)).errand).toEqual({ state: 'accepted' });
    expect(e.world.sql.all("select * from ledger where reason = 'errand:first'")).toHaveLength(0);
  });

  it('lesson sentences never move the errand', async () => {
    const e = env();
    await e.get();
    const r = await e.say('d1', 'errand', line('errand_accept', 2), 2, { session_kind: 'lesson' });
    expect(r.errand).toBeUndefined();
    expect((await e.get()).state).toBe('offered');
  });
});

describe('platform: the device token reaches /v1/errand', () => {
  it('returns the child own errand; anonymous callers are refused', async () => {
    const TOKEN = 'op-token-0123456789abcdef';
    const p = new PlatformDO({ storage: fakeDurableStorage() }, { PLATFORM: undefined as never, LCW_OPERATOR_TOKEN: TOKEN } as LcwEnv);
    await p.fetch(
      new Request('https://lcw.test/v1/admin/players', {
        method: 'POST',
        headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ family_id: 'fam', guardian_id: 'g', player_id: 'kid', nickname: 'Kid', level: 'L2' })
      })
    );
    const tok = 'e'.repeat(48);
    p.sql.run(
      'insert into devices (id, player_id, family_id, token_hash, label, created_at, last_seen_at, revoked_at) values (?, ?, ?, ?, ?, ?, ?, null)',
      ['dev-1', 'kid', 'fam', createHash('sha256').update(tok).digest('hex'), 'tablet', Date.now(), Date.now()]
    );
    const anon = await p.fetch(new Request('https://lcw.test/v1/errand'));
    expect(anon.status).toBe(401);
    const res = await p.fetch(new Request('https://lcw.test/v1/errand?player_id=someone-else', { headers: { authorization: `Bearer ${tok}` } }));
    expect(((await res.json()) as { id: string }).id).toBe('errand-first-kid');
  });
});
