import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { QuotaMeter } from '@lcw/quota';
import { FURNITURE_SHOP_GOODS, PHRASE_BANK, lookupPhraseBank, starPrice } from '@lcw/content';
import { ROOM_MISSING_SENTENCES, applyReadAloudDiscount } from '@lcw/sim-core';
import { createNodeSqliteExecutor } from '../node-sqlite.js';
import { createEdgeApp } from '../app.js';
import { EdgePlatformDb, InMemoryR2Store, WorldDO } from '../storage.js';
import { PlatformDO, type LcwEnv } from '../platform.js';
import { fakeDurableStorage } from './fake-do.js';

/**
 * WP-405 "소리 내어 읽기 할인은 가구 종류당 하루 1회" through the real routes: reading the room's missing-condition
 * sentence aloud gives 10% off that furniture kind once per KST day per player; the server spends it on the next
 * furniture purchase of that kind at the trade shop.
 */

// 2026-11-16 14:00 KST = 05:00 UTC
const T0 = Date.UTC(2026, 10, 16, 5, 0, 0);
const lamp = FURNITURE_SHOP_GOODS.find((g) => g.key === 'furn_lamp_table')!;
const L2 = (key: string) => PHRASE_BANK.find((b) => b.ctx === 'trade_shop' && b.level === 'L2' && b.slotsKey.startsWith(`item=${key}|`))!;

function env() {
  let now = T0;
  const db = new EdgePlatformDb(createNodeSqliteExecutor(':memory:'));
  for (const p of ['kid', 'other']) db.ensureFamilyAndPlayer({ familyId: 'f', guardianId: 'g', playerId: p, nickname: p, level: 'L2', nowMs: 1 });
  const world = new WorldDO({ sql: createNodeSqliteExecutor(':memory:'), r2: new InMemoryR2Store(), seed: 's' });
  world.appendLedger('kid', 1000, 'starter', 'starter', 1);
  world.appendLedger('other', 1000, 'starter', 'starter', 1);
  const app = createEdgeApp({ db, worlds: new Map([['w', world]]), lessons: new Map(), quota: new QuotaMeter('2026-11-16'), nowMs: () => now });
  const post = async (path: string, body: Record<string, unknown>) => {
    const res = await app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, body: (await res.json()) as Record<string, any> };
  };
  const read = (kind: string, transcript: string, extra: Record<string, unknown> = {}) =>
    post('/v1/furniture/read-aloud', { player_id: 'kid', world_id: 'w', level: 'L2', kind, transcript, ...extra });
  const buy = (dialog: string, text: string, stars: 1 | 2 | 3, player = 'kid') =>
    post('/v1/converse/score', {
      dialog_id: dialog,
      hint_level: 'full',
      player_id: player,
      world_id: 'w',
      session_id: 's',
      npc_ctx: 'trade_shop',
      level: 'L2',
      chosen_stars: stars,
      target_text: text,
      transcript: text
    });
  return { db, world, read, buy, setNow: (t: number) => (now = t), app };
}

describe('read-aloud discount: once per furniture kind per day (docs/03 D13)', () => {
  it('reading the sentence gives 10% once; reading again the same day gives nothing; another kind is separate', async () => {
    const e = env();
    const first = await e.read('light', ROOM_MISSING_SENTENCES.light);
    expect(first.body).toMatchObject({ pass: true, discount_pct: 0.1, already_claimed: false, sentence: 'This room needs a light source.' });
    expect(first.body.feedback_ko).toContain('10%');
    const again = await e.read('light', ROOM_MISSING_SENTENCES.light);
    expect(again.body).toMatchObject({ pass: true, discount_pct: 0, already_claimed: true });
    const rest = await e.read('rest', ROOM_MISSING_SENTENCES.rest);
    expect(rest.body.discount_pct).toBe(0.1);
    const st = await e.app.request('/v1/furniture/discounts?player_id=kid');
    expect(((await st.json()) as { kinds: unknown }).kinds).toEqual({ light: { pct: 0.1, used: false }, rest: { pct: 0.1, used: false } });
  });

  it('the day turns at KST midnight, not UTC midnight', async () => {
    const e = env();
    e.setNow(Date.UTC(2026, 10, 16, 14, 59, 0)); // 23:59 KST
    expect((await e.read('flat', ROOM_MISSING_SENTENCES.flat)).body.discount_pct).toBe(0.1);
    e.setNow(Date.UTC(2026, 10, 16, 14, 59, 59));
    expect((await e.read('flat', ROOM_MISSING_SENTENCES.flat)).body.discount_pct).toBe(0);
    e.setNow(Date.UTC(2026, 10, 16, 15, 0, 1)); // 00:00 KST next day (still 16th in UTC)
    expect((await e.read('flat', ROOM_MISSING_SENTENCES.flat)).body.discount_pct).toBe(0.1);
  });

  it('a mumbled reading, a typed or card-built sentence, or a non-furniture condition earns nothing', async () => {
    const e = env();
    expect((await e.read('light', 'room')).body).toMatchObject({ pass: false, discount_pct: 0 });
    const typed = await e.read('light', ROOM_MISSING_SENTENCES.light, { stt_source: 'keyboard' });
    expect(typed.body).toMatchObject({ pass: false, discount_pct: 0 });
    expect((await e.read('door', ROOM_MISSING_SENTENCES.door)).status).toBe(400);
    // The failed tries did not use up today's discount.
    expect((await e.read('light', ROOM_MISSING_SENTENCES.light)).body.discount_pct).toBe(0.1);
    const logged = e.db.sql.all<{ mode: string; target_text: string }>("select mode, target_text from utterances where ctx = 'resident'");
    expect(logged).toHaveLength(3); // the door request was refused before scoring
    expect(logged.every((l) => l.mode === 'read')).toBe(true);
  });
});

describe('the discount is spent by the server on the next furniture purchase of that kind', () => {
  it('first lamp is 10% off, the second lamp that day is full price; the ledger matches', async () => {
    const e = env();
    await e.read('light', ROOM_MISSING_SENTENCES.light);
    const entry = L2(lamp.key);
    const full2 = starPrice(lamp.basePrice, 2);
    const a = await e.buy('d1', entry.offers[1].text, 2);
    expect(a.body.granted.item_id).toBe(lamp.key);
    expect(a.body.granted.coins_delta).toBe(-applyReadAloudDiscount(full2, 0.1));
    expect(a.body.read_aloud_discount_pct).toBe(0.1);
    const b = await e.buy('d2', entry.offers[1].text, 2);
    expect(b.body.granted.coins_delta).toBe(-full2);
    expect(b.body.read_aloud_discount_pct).toBeUndefined();
    // + two passed 2★ sentences × 5 coins (R326 ⑤)
    expect(e.world.getPlayerBalance('kid')).toBe(1000 - applyReadAloudDiscount(full2, 0.1) - full2 + 20);
  });

  it('"one more star" in the same window keeps the discount on the better price (refund of the difference)', async () => {
    const e = env();
    await e.read('light', ROOM_MISSING_SENTENCES.light);
    const entry = L2(lamp.key);
    await e.buy('d1', entry.offers[1].text, 2);
    const up = await e.buy('d1', entry.offers[2].text, 3);
    expect(up.body.stars).toBe(3);
    // + one window earning up to 3★ × 5 coins (R326 ⑤)
    expect(e.world.getPlayerBalance('kid')).toBe(1000 - applyReadAloudDiscount(starPrice(lamp.basePrice, 3), 0.1) + 15);
  });

  it('a light discount does not apply to a chair, to drinks, or to another player', async () => {
    const e = env();
    await e.read('light', ROOM_MISSING_SENTENCES.light);
    const chair = FURNITURE_SHOP_GOODS.find((g) => g.role === 'rest')!;
    const c = await e.buy('d1', L2(chair.key).offers[0].text, 1);
    expect(c.body.granted.coins_delta).toBe(-starPrice(chair.basePrice, 1));
    const o = await e.buy('d2', L2(lamp.key).offers[0].text, 1, 'other');
    expect(o.body.granted.coins_delta).toBe(-starPrice(lamp.basePrice, 1));
  });

  it('the shop keeps its barter lines as the default offers (first lesson trade role-play unchanged)', () => {
    const def = lookupPhraseBank({ ctx: 'trade_shop', level: 'L1' })!;
    expect(def.intent).toBe('trade_item');
    expect(def.offers.every((o) => o.price === 0)).toBe(true);
  });
});

describe('platform: the child claims with the device token', () => {
  it('device token reaches /v1/furniture/read-aloud; anonymous callers do not', async () => {
    const TOKEN = 'op-token-0123456789abcdef';
    const p = new PlatformDO({ storage: fakeDurableStorage() }, { PLATFORM: undefined as never, LCW_OPERATOR_TOKEN: TOKEN } as LcwEnv);
    const call = async (path: string, body: unknown, headers: Record<string, string>, method = 'POST') => {
      const res = await p.fetch(new Request(`https://lcw.test${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }));
      return { status: res.status, body: (await res.json()) as Record<string, any> };
    };
    await call('/v1/admin/players', { family_id: 'fam', guardian_id: 'g', player_id: 'kid', nickname: 'Kid', level: 'L2' }, { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' });
    const tok = 'f'.repeat(48);
    p.sql.run(
      'insert into devices (id, player_id, family_id, token_hash, label, created_at, last_seen_at, revoked_at) values (?, ?, ?, ?, ?, ?, ?, null)',
      ['dev-1', 'kid', 'fam', createHash('sha256').update(tok).digest('hex'), 'tablet', Date.now(), Date.now()]
    );
    const dev = { authorization: `Bearer ${tok}`, 'content-type': 'application/json' };
    const anon = await call('/v1/furniture/read-aloud', { kind: 'light', transcript: ROOM_MISSING_SENTENCES.light }, { 'content-type': 'application/json' });
    expect(anon.status).toBe(401);
    const r = await call('/v1/furniture/read-aloud', { kind: 'light', transcript: ROOM_MISSING_SENTENCES.light, player_id: 'someone' }, dev);
    expect(r.body.discount_pct).toBe(0.1);
    const st = await call('/v1/furniture/discounts', null, dev, 'GET');
    expect(st.body.kinds.light).toEqual({ pct: 0.1, used: false });
  });
});
