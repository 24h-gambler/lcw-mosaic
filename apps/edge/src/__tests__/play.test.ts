import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { QuotaMeter } from '@lcw/quota';
import { INTERVIEW_TURNS, lookupPhraseBank } from '@lcw/content';
import { TUNING, clockOf, mineVeins, miningBudget } from '@lcw/sim-core';
import { createNodeSqliteExecutor } from '../node-sqlite.js';
import { createEdgeApp } from '../app.js';
import { EdgePlatformDb, InMemoryR2Store, WorldDO } from '../storage.js';
import { PlatformDO, type LcwEnv } from '../platform.js';
import { fakeDurableStorage } from './fake-do.js';

/** Play modes on the server (edge play.ts): the office day, the mine and the exchange through the real routes. */

const T0 = Date.UTC(2026, 10, 16, 6, 0, 0);
const line = (ctx: string, item: string, stars: 1 | 2 | 3, level: 'L1' | 'L2' | 'L3' = 'L2'): string => {
  const e = lookupPhraseBank({ ctx, level, item });
  if (!e) throw new Error(`no bank entry ${ctx} ${item} ${level}`);
  return e.offers[stars - 1]!.text;
};

function env(startCoins = 1000) {
  let now = T0;
  const db = new EdgePlatformDb(createNodeSqliteExecutor(':memory:'));
  db.ensureFamilyAndPlayer({ familyId: 'f', guardianId: 'g', playerId: 'kid', nickname: 'Kid', level: 'L2', nowMs: 1 });
  const world = new WorldDO({ sql: createNodeSqliteExecutor(':memory:'), r2: new InMemoryR2Store(), seed: 's' });
  world.appendLedger('kid', startCoins, 'starter', 'starter', 1);
  const app = createEdgeApp({ db, worlds: new Map([['w', world]]), lessons: new Map(), quota: new QuotaMeter('2026-11-16'), nowMs: () => now });
  db.ensureFamilyAndPlayer({ familyId: 'f2', guardianId: 'g2', playerId: 'kid2', nickname: 'Kid2', level: 'L2', nowMs: 1 });
  const say = async (dialog: string, ctx: string, text: string, stars: 1 | 2 | 3, extra: Record<string, unknown> = {}) => {
    const res = await app.request('/v1/converse/score', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dialog_id: dialog, hint_level: 'full', player_id: 'kid', world_id: 'w', session_id: 's', npc_ctx: ctx, level: 'L2', chosen_stars: stars, target_text: text, transcript: text, strict_bank: true, ...extra })
    });
    expect(res.status).toBe(200);
    return (await res.json()) as Record<string, any>;
  };
  const state = async () => (await (await app.request('/v1/play/state?player_id=kid&world_id=w')).json()) as Record<string, any>;
  const beat = async () =>
    (await (
      await app.request('/v1/play/beat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ player_id: 'kid', world_id: 'w' }) })
    ).json()) as Record<string, any>;
  const mine = async (vein_id: string) => {
    const res = await app.request('/v1/play/mine', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ player_id: 'kid', world_id: 'w', vein_id }) });
    return { status: res.status, body: (await res.json()) as Record<string, any> };
  };
  /** Plays on for `minutes` of the work clock (heartbeats every 15 s like the client). */
  const playFor = async (minutes: number) => {
    const ms = minutes * TUNING.play.realMsPerGameMinute;
    await beat();
    for (let t = 0; t < ms; t += 15_000) {
      now += Math.min(15_000, ms - t);
      await beat();
    }
  };
  return { db, world, say, state, beat, mine, playFor, tick: (ms: number) => (now += ms), now: () => now };
}

describe('the office day (docs/03 D4, docs/04 4.2 면접·상사·고객)', () => {
  it('suit -> interview (3 turns) -> clock in on time -> two customers -> day pay once', async () => {
    const e = env();
    let s = await e.state();
    expect(s.clock).toMatchObject({ day: 0, hhmm: '07:30', hours: 'before_open' });
    expect(s.job).toMatchObject({ rank: null, has_suit: false, interview_turn: 'interview_intro' });
    expect(s.next).toEqual({ ctx: 'interview', key: 'interview_intro' });

    // no suit: the interview does not start
    const early = await e.say('d-i0', 'interview', line('interview', 'interview_intro', 2), 2);
    expect(early.play).toEqual({ kind: 'interview', blocked: 'no_suit' });

    // the tailor sells the suit on the normal purchase path
    const suit = await e.say('d-suit', 'boutique', line('boutique', 'suit', 2), 2);
    expect(suit.granted).toMatchObject({ item_id: 'suit' });
    expect((await e.state()).job.has_suit).toBe(true);

    // 07:30 -> 08:10: the office is open
    expect((await e.say('d-i1', 'interview', line('interview', 'interview_intro', 2), 2)).play).toEqual({ kind: 'interview', blocked: 'before_open' });
    await e.playFor(40);
    s = await e.state();
    expect(s.clock.hours).toBe('on_time');

    // answers out of turn are not counted
    expect((await e.say('d-i2', 'interview', line('interview', 'interview_why', 3), 3)).play).toMatchObject({ blocked: 'wrong_turn', interview_turn: 'interview_intro' });
    const coinsBefore = e.world.getPlayerBalance('kid');
    const turns: Array<1 | 2 | 3> = [3, 2, 3];
    let last: Record<string, any> = {};
    for (let i = 0; i < INTERVIEW_TURNS.length; i++) last = await e.say(`d-int${i}`, 'interview', line('interview', INTERVIEW_TURNS[i]!, turns[i]!), turns[i]!);
    // the weakest turn decides: 2 stars = intern with a contract bonus (25% of a day's pay)
    const bonus = Math.round(TUNING.career.ranks.intern.dailyPay * TUNING.play.contractBonusPct);
    expect(last.play).toMatchObject({ kind: 'interview', hired: 'intern', coins: bonus });
    expect(e.world.getPlayerBalance('kid')).toBe(coinsBefore + bonus);
    // a second hire pays nothing
    expect((await e.say('d-int9', 'interview', line('interview', 'interview_intro', 3), 3)).play).toMatchObject({ blocked: 'done' });
    expect(e.world.sql.all("select * from ledger where reason = 'play:contract'")).toHaveLength(1);

    s = await e.state();
    expect(s.job).toMatchObject({ rank: 'intern', pay: TUNING.career.ranks.intern.dailyPay });
    expect(s.next).toEqual({ ctx: 'boss', key: 'boss_report' });
    // customers wait for the clock-in
    expect((await e.say('d-c0', 'customer', line('customer', 'customer_cold_coffee', 2), 2)).play).toEqual({ kind: 'customer', blocked: 'no_shift' });
    expect((await e.say('d-b1', 'boss', line('boss', 'boss_report', 2), 2)).play).toEqual({ kind: 'shift', late: false });
    expect((await e.say('d-b2', 'boss', line('boss', 'boss_report', 2), 2)).play).toMatchObject({ blocked: 'done' });

    const paidBefore = e.world.getPlayerBalance('kid');
    let tips = 0;
    let pay = 0;
    for (let n = 0; n < TUNING.play.shift.customersPerShift; n++) {
      const st = await e.state();
      expect(st.next.ctx).toBe('customer');
      // a different claim than the one waiting is not counted
      const wrong = st.next.key === 'customer_lost_umbrella' ? 'customer_cold_coffee' : 'customer_lost_umbrella';
      expect((await e.say(`d-w${n}`, 'customer', line('customer', wrong, 2), 2)).play).toMatchObject({ blocked: 'wrong_turn' });
      const r = await e.say(`d-c${n + 1}`, 'customer', line('customer', st.next.key, 3), 3);
      expect(r.play).toMatchObject({ kind: 'customer', tip: TUNING.play.customerTipByStars[3], served: n + 1 });
      tips += r.play.tip;
      pay += r.play.pay ?? 0;
    }
    expect(pay).toBe(TUNING.career.ranks.intern.dailyPay);
    expect(e.world.getPlayerBalance('kid')).toBe(paidBefore + tips + pay);
    s = await e.state();
    expect(s.shift).toMatchObject({ served: 2, paid: true });
    expect(s.next).toBeNull();
    expect(s.job.progress).toEqual({ have: 1, need: TUNING.career.ranks.intern.promoDaysRequired, next: 'staff' });
    // the day is done: nobody else pays today
    expect((await e.say('d-c9', 'customer', line('customer', 'customer_cold_coffee', 3), 3)).play).toMatchObject({ blocked: 'done' });
    expect(e.world.sql.all("select * from ledger where reason like 'play:pay:%'")).toHaveLength(1);
  });

  it('late: the boss asks why; a 1-star excuse halves the pay, after 17:00 the office is closed', async () => {
    const e = env();
    await e.say('d-suit', 'boutique', line('boutique', 'suit', 3), 3);
    await e.playFor(40);
    for (const [i, t] of INTERVIEW_TURNS.entries()) await e.say(`d-i${i}`, 'interview', line('interview', t, 1), 1);
    expect((await e.state()).job.rank).toBe('intern');
    // 08:10 -> 09:30 (late)
    await e.playFor(80);
    const s = await e.state();
    expect(s.clock.hours).toBe('late');
    expect(s.next).toEqual({ ctx: 'boss', key: 'boss_late' });
    expect((await e.say('d-b0', 'boss', line('boss', 'boss_report', 2), 2)).play).toMatchObject({ blocked: 'wrong_turn' });
    expect((await e.say('d-b1', 'boss', line('boss', 'boss_late', 1), 1)).play).toEqual({ kind: 'shift', late: true });
    let pay = 0;
    for (let n = 0; n < 2; n++) {
      const st = await e.state();
      pay += (await e.say(`d-c${n}`, 'customer', line('customer', st.next.key, 1), 1)).play.pay ?? 0;
    }
    expect(pay).toBe(Math.round(TUNING.career.ranks.intern.dailyPay * TUNING.play.lateOneStarPayFactor));
    expect((await e.state()).job.progress.have).toBe(1);
    // 09:30 -> 17:10
    await e.playFor(460);
    expect((await e.state()).clock.hours).toBe('closed');
    expect((await e.say('d-b2', 'boss', line('boss', 'boss_late', 3), 3)).play).toMatchObject({ blocked: 'closed' });
  });

  it('the next morning is a new work day: clock in again and both customers pay (every day, not only day 0)', async () => {
    const e = env();
    await e.say('d-suit', 'boutique', line('boutique', 'suit', 2), 2);
    await e.playFor(40);
    for (const [i, t] of INTERVIEW_TURNS.entries()) await e.say(`d-i${i}`, 'interview', line('interview', t, 2), 2);
    for (let day = 0; day < 3; day++) {
      if (day > 0) {
        // to 08:10 of the next day
        const s0 = await e.state();
        await e.playFor((day * 1440 + 490 - (s0.clock.day * 1440 + s0.clock.minute)) as number);
      }
      const s = await e.state();
      expect(s.clock).toMatchObject({ day, hours: 'on_time' });
      expect(s.next).toEqual({ ctx: 'boss', key: 'boss_report' });
      await e.say(`d-b${day}`, 'boss', line('boss', 'boss_report', 2), 2);
      const keys: string[] = [];
      for (let n = 0; n < 2; n++) {
        const st = await e.state();
        keys.push(st.next.key);
        expect((await e.say(`d-c${day}-${n}`, 'customer', line('customer', st.next.key, 2), 2)).play).toMatchObject({ kind: 'customer', served: n + 1 });
      }
      expect(keys[0]).not.toBe(keys[1]);
      expect((await e.state()).shift).toMatchObject({ day, paid: true });
    }
    expect(e.world.sql.all("select * from ledger where reason like 'play:pay:%'")).toHaveLength(3);
  });

  it('the clock moves only while the world is open: a long gap adds nothing', async () => {
    const e = env();
    await e.beat();
    e.tick(10 * 60_000);
    const s = await e.beat();
    expect(s.clock.hhmm).toBe('07:30');
    // one real second = one minute of the work clock (docs/03 3.1 하루 = 24분)
    e.tick(15_000);
    expect((await e.beat()).clock.hhmm).toBe('07:45');
    e.tick(15_000);
    expect((await e.beat()).clock).toMatchObject(clockOf(30_000));
  });

  it('lesson sentences never move the job', async () => {
    const e = env();
    await e.say('d-suit', 'boutique', line('boutique', 'suit', 2), 2);
    await e.playFor(40);
    const r = await e.say('d-i0', 'interview', line('interview', 'interview_intro', 3), 3, { session_kind: 'lesson' });
    expect(r.play).toBeUndefined();
    expect((await e.state()).job.interview_turn).toBe('interview_intro');
  });
});

describe('the mine and the exchange (docs/03 D2, docs/04 4.2 환전소)', () => {
  it('dig coal, rest the vein on play time, sell with a sentence; a better retry tops up once', async () => {
    const e = env(0);
    const veins = mineVeins().filter((v) => v.floor === 'mine' && v.ore === 'coal');
    const a = await e.mine(veins[0]!.id);
    expect(a.body).toMatchObject({ ok: true, ore: 'coal', count: 1 });
    expect((await e.mine(veins[1]!.id)).body).toMatchObject({ ok: false, reason: 'too_fast' });
    e.tick(TUNING.play.mine.minIntervalMs);
    expect((await e.mine(veins[1]!.id)).body).toMatchObject({ ok: true, count: 2 });
    e.tick(TUNING.play.mine.minIntervalMs);
    const rest = await e.mine(veins[0]!.id);
    // every swing is a heartbeat: the two 1.2 s waits were play time
    expect(rest.body).toMatchObject({ ok: false, reason: 'resting', wait_ms: TUNING.play.mine.veinRespawnPlayMs - 2 * TUNING.play.mine.minIntervalMs });
    expect((await e.mine('nowhere.9')).status).toBe(400);
    const s = await e.state();
    expect(s.ores).toEqual({ coal: 2 });
    expect(Object.keys(s.resting).sort()).toEqual([veins[0]!.id, veins[1]!.id].sort());
    expect(s.market.coal).toBe(TUNING.mining.ores.coal!.price);

    // gold needs an iron pickaxe (tier 2)
    const gold = mineVeins().find((v) => v.ore === 'gold')!;
    e.tick(TUNING.play.mine.minIntervalMs);
    expect((await e.mine(gold.id)).body).toMatchObject({ ok: false, reason: 'tool', need_tier: 2 });

    const sold = await e.say('d-ex', 'exchange', line('exchange', 'coal', 2), 2);
    const two = Math.round(TUNING.mining.ores.coal!.price * 2 * (1 + TUNING.play.exchangeBonusByStars[2]));
    expect(sold.play).toEqual({ kind: 'exchange', ore: 'coal', units: 2, coins: two });
    expect(sold.coins_total).toBe(two);
    const three = Math.round(TUNING.mining.ores.coal!.price * 2 * (1 + TUNING.play.exchangeBonusByStars[3]));
    const better = await e.say('d-ex', 'exchange', line('exchange', 'coal', 3), 3);
    expect(better.play).toEqual({ kind: 'exchange', ore: 'coal', units: 2, coins: three - two, retry: 'better' });
    expect((await e.say('d-ex', 'exchange', line('exchange', 'coal', 3), 3)).play).toMatchObject({ coins: 0, retry: 'same' });
    expect(e.world.getPlayerBalance('kid')).toBe(three);
    // the ore left the bag; selling again finds none; the world's price dipped
    expect((await e.say('d-ex2', 'exchange', line('exchange', 'coal', 2), 2)).play).toEqual({ kind: 'exchange', blocked: 'no_ore', ore: 'coal', units: 0 });
    const after = await e.state();
    expect(after.ores).toEqual({});
    expect(after.exchange_total).toBe(three);
    expect(after.market.coal).toBeLessThanOrEqual(TUNING.mining.ores.coal!.price);

    // the vein grows back after 10 minutes of play
    await e.playFor(TUNING.play.mine.veinRespawnPlayMs / TUNING.play.realMsPerGameMinute);
    expect((await e.mine(veins[0]!.id)).body).toMatchObject({ ok: true });
  });
});

describe('review fixes: every level, saying it again, one child per sale', () => {
  const hireAndClockIn = async (e: ReturnType<typeof env>, level: 'L1' | 'L2' | 'L3') => {
    await e.say('d-suit', 'boutique', line('boutique', 'suit', 2), 2);
    await e.playFor(40);
    for (const [i, t] of INTERVIEW_TURNS.entries()) await e.say(`d-i${i}`, 'interview', line('interview', t, 2, level), 2, { level });
    expect((await e.state()).job.rank).toBe('intern');
    await e.say('d-b', 'boss', line('boss', 'boss_report', 1, level), 1, { level });
  };

  for (const level of ['L1', 'L3'] as const)
    it(`${level}: a 1-star sorry reaches the customer who is waiting (H1: no claim shares a sentence)`, async () => {
      const e = env();
      await hireAndClockIn(e, level);
      for (let n = 0; n < 2; n++) {
        const st = await e.state();
        const r = await e.say(`d-c${n}`, 'customer', line('customer', st.next.key, 1, level), 1, { level });
        expect(r.play, `${level} ${st.next.key}`).toMatchObject({ kind: 'customer', served: n + 1 });
      }
      expect((await e.state()).shift).toMatchObject({ served: 2, paid: true });
    });

  it('the same window said better raises that turn once: interview stars, the customer tip difference (M4)', async () => {
    const e = env();
    await e.say('d-suit', 'boutique', line('boutique', 'suit', 2), 2);
    await e.playFor(40);
    // turn 1 at 1 star, then the same window at 3 stars
    await e.say('d-i0', 'interview', line('interview', INTERVIEW_TURNS[0]!, 1), 1);
    expect((await e.say('d-i0', 'interview', line('interview', INTERVIEW_TURNS[0]!, 3), 3)).play).toMatchObject({ kind: 'interview', retry: 'better' });
    expect((await e.say('d-i0', 'interview', line('interview', INTERVIEW_TURNS[0]!, 3), 3)).play).toMatchObject({ retry: 'same' });
    await e.say('d-i1', 'interview', line('interview', INTERVIEW_TURNS[1]!, 3), 3);
    const hired = await e.say('d-i2', 'interview', line('interview', INTERVIEW_TURNS[2]!, 3), 3);
    // the weakest turn is now 3 stars: staff, not the intern the first 1-star answer would have made
    expect(hired.play).toMatchObject({ hired: 'staff' });
    await e.say('d-b', 'boss', line('boss', 'boss_report', 3), 3);
    const st = await e.state();
    const first = await e.say('d-c0', 'customer', line('customer', st.next.key, 1), 1);
    expect(first.play).toMatchObject({ served: 1, tip: TUNING.play.customerTipByStars[1] });
    const before = e.world.getPlayerBalance('kid');
    const again = await e.say('d-c0', 'customer', line('customer', st.next.key, 3), 3);
    expect(again.play).toMatchObject({ retry: 'better', coins: TUNING.play.customerTipByStars[3] - TUNING.play.customerTipByStars[1] });
    expect(e.world.getPlayerBalance('kid')).toBe(before + TUNING.play.customerTipByStars[3] - TUNING.play.customerTipByStars[1]);
    expect((await e.say('d-c0', 'customer', line('customer', st.next.key, 3), 3)).play).toMatchObject({ retry: 'same' });
    // the retry did not count as the second customer
    expect((await e.state()).shift).toMatchObject({ served: 1, paid: false });
  });

  it('one digging budget across all floors: past it the child rests, the vein stays (M5)', async () => {
    const e = env(0);
    const coal = mineVeins().filter((v) => v.floor === 'mine' && v.ore === 'coal');
    expect((await e.mine(coal[0]!.id)).body).toMatchObject({ ok: true });
    // as if the other floors were dug just now, up to the budget
    e.db.sql.run('insert into play_dig (player_id, world_id, play_ms, value) values (?, ?, ?, ?)', ['kid', 'w', 0, miningBudget() - TUNING.mining.ores.coal!.price]);
    e.tick(TUNING.play.mine.minIntervalMs);
    const r = await e.mine(coal[1]!.id);
    expect(r.body).toMatchObject({ ok: false, reason: 'tired' });
    expect(r.body.wait_ms).toBeGreaterThan(0);
    expect((await e.state()).ores).toEqual({ coal: 1 });
  });

  it("another child sending my sale's dialog id gets no top-up (M1)", async () => {
    const e = env(0);
    const coal = mineVeins().find((v) => v.floor === 'mine' && v.ore === 'coal')!;
    expect((await e.mine(coal.id)).body).toMatchObject({ ok: true });
    await e.say('d-ex', 'exchange', line('exchange', 'coal', 2), 2);
    const other = await e.say('d-ex', 'exchange', line('exchange', 'coal', 3), 3, { player_id: 'kid2' });
    expect(other.play).toMatchObject({ kind: 'exchange', blocked: 'no_ore' });
    expect(e.world.getPlayerBalance('kid2')).toBe(0);
  });
});

describe('platform: the device token reaches /v1/play/*', () => {
  it('state, beat and mine run on the child own home world; anonymous callers are refused', async () => {
    const TOKEN = 'op-token-0123456789abcdef';
    const p = new PlatformDO({ storage: fakeDurableStorage() }, { PLATFORM: undefined as never, LCW_OPERATOR_TOKEN: TOKEN } as LcwEnv);
    await p.fetch(
      new Request('https://lcw.test/v1/admin/players', {
        method: 'POST',
        headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ family_id: 'fam', guardian_id: 'g', player_id: 'kid', nickname: 'Kid', level: 'L2' })
      })
    );
    const tok = 'p'.repeat(48);
    p.sql.run(
      'insert into devices (id, player_id, family_id, token_hash, label, created_at, last_seen_at, revoked_at) values (?, ?, ?, ?, ?, ?, ?, null)',
      ['dev-1', 'kid', 'fam', createHash('sha256').update(tok).digest('hex'), 'tablet', Date.now(), Date.now()]
    );
    expect((await p.fetch(new Request('https://lcw.test/v1/play/state'))).status).toBe(401);
    const st = await p.fetch(new Request('https://lcw.test/v1/play/state?player_id=someone-else', { headers: { authorization: `Bearer ${tok}` } }));
    expect(st.status).toBe(200);
    expect(((await st.json()) as { clock: { hhmm: string } }).clock.hhmm).toBe('07:30');
    const auth = { authorization: `Bearer ${tok}`, 'content-type': 'application/json' };
    expect((await p.fetch(new Request('https://lcw.test/v1/play/beat', { method: 'POST', headers: auth, body: '{}' }))).status).toBe(200);
    const coal = mineVeins().find((v) => v.ore === 'coal')!;
    const m = await p.fetch(new Request('https://lcw.test/v1/play/mine', { method: 'POST', headers: auth, body: JSON.stringify({ vein_id: coal.id, player_id: 'someone-else' }) }));
    expect(await m.json()).toMatchObject({ ok: true, ore: 'coal' });
    const after = (await (await p.fetch(new Request('https://lcw.test/v1/play/state', { headers: { authorization: `Bearer ${tok}` } }))).json()) as { ores: Record<string, number> };
    expect(after.ores).toEqual({ coal: 1 });
  });
});
