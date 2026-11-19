import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { QuotaMeter } from '@lcw/quota';
import { CAFE_MENU, PHRASE_BANK, findBankOffer, starPrice } from '@lcw/content';
import { createNodeSqliteExecutor } from '../node-sqlite.js';
import { createEdgeApp } from '../app.js';
import { EdgePlatformDb, InMemoryR2Store, WorldDO } from '../storage.js';
import { PlatformDO, homeWorldId, type LcwEnv } from '../platform.js';
import { fakeDurableStorage } from './fake-do.js';

/**
 * /v1/converse/score: stars, price and item come from the server bank (AGENTS 4.7, docs/04 4.2 / 4.6).
 * Regression for the defect where the client-sent `price` (the 3-star price) was charged even when the server
 * granted fewer stars.
 */

function env(startCoins = 100) {
  const db = new EdgePlatformDb(createNodeSqliteExecutor(':memory:'));
  db.ensureFamilyAndPlayer({ familyId: 'f', guardianId: 'g', playerId: 'kid', nickname: 'Kid', nowMs: 1 });
  const world = new WorldDO({ sql: createNodeSqliteExecutor(':memory:'), r2: new InMemoryR2Store(), seed: 's' });
  if (startCoins > 0) world.appendLedger('kid', startCoins, 'starter', 'starter', 1);
  const app = createEdgeApp({
    db,
    worlds: new Map([['w', world]]),
    lessons: new Map(),
    quota: new QuotaMeter('2026-11-16'),
    nowMs: () => 1_763_300_000_000
  });
  const score = async (body: Record<string, unknown>) => {
    const res = await app.request('/v1/converse/score', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        dialog_id: 'd1',
        hint_level: 'full',
        player_id: 'kid',
        world_id: 'w',
        session_id: 's1',
        npc_ctx: 'cafe',
        level: 'L2',
        ...body
      })
    });
    expect(res.status).toBe(200);
    return (await res.json()) as {
      pass: boolean;
      stars: number;
      target_stars: number;
      coins_total: number;
      feedback_ko: string;
      granted: { item_id: string; coins_delta: number; slot_or_socket: string } | null;
      memory_card: { id: string; next_review_at: string } | null;
      asked_key?: string;
    };
  };
  const ledgerSum = () =>
    Number(world.sql.get<{ s: number }>('select coalesce(sum(delta),0) as s from ledger where player = ?', ['kid'])?.s ?? 0);
  // R326 ⑤: a passed solo sentence also earns coins (shop.ts creditSoloEarn); the price checks add what was earned.
  const earned = () =>
    Number(world.sql.get<{ s: number }>("select coalesce(sum(delta),0) as s from ledger where player = ? and reason = 'earn_solo'", ['kid'])?.s ?? 0);
  return { app, db, world, score, ledgerSum, earned };
}

const smoothie = CAFE_MENU.find((d) => d.key === 'smoothie')!;
const L2_3STAR = 'Can I get a cold smoothie because I am thirsty?';
const L2_2STAR = 'Can I get a cold smoothie?';
const L2_1STAR = 'I want a cold smoothie, please.';

describe('/v1/converse/score uses the server price table (WP-108)', () => {
  it('a 3-star target said without its connector does not pass and costs nothing, whatever the client sends', async () => {
    const e = env(100);
    const r = await e.score({
      chosen_stars: 3,
      target_text: L2_3STAR,
      transcript: 'can I get a cold smoothie I am thirsty',
      price: 0, // forged
      item_id: 'diamond_sword' // forged
    });
    expect(r.pass).toBe(false);
    expect(r.stars).toBe(0);
    expect(r.granted).toBeNull();
    expect(e.ledgerSum()).toBe(100 + e.earned());
    expect(r.feedback_ko).toContain('because');
  });

  it('a client claiming the 3-star price on a 2-star grant pays the 2-star price', async () => {
    const e = env(100);
    const r = await e.score({
      chosen_stars: 3,
      target_text: L2_3STAR,
      transcript: L2_3STAR,
      stt_source: 'keyboard',
      price: starPrice(smoothie.basePrice, 3)
    });
    expect(r.stars).toBe(2);
    expect(r.granted?.item_id).toBe('smoothie');
    expect(r.granted?.coins_delta).toBe(-starPrice(smoothie.basePrice, 2));
    expect(r.coins_total).toBe(100 - starPrice(smoothie.basePrice, 2) + e.earned());
    expect(e.ledgerSum()).toBe(r.coins_total);
  });

  it('a full 3-star order is charged the 50% price from the bank', async () => {
    const e = env(100);
    const r = await e.score({ chosen_stars: 3, target_text: L2_3STAR, transcript: L2_3STAR, price: 999 });
    expect(r.stars).toBe(3);
    expect(r.granted?.coins_delta).toBe(-starPrice(smoothie.basePrice, 3));
    expect(r.granted?.slot_or_socket).toBe('RightHand_Socket');
    expect(e.ledgerSum()).toBe(100 - 25 + e.earned());
  });

  it('the star grade comes from the bank sentence, not from chosen_stars', async () => {
    const e = env(100);
    const r = await e.score({ chosen_stars: 3, target_text: L2_2STAR, transcript: L2_2STAR });
    expect(r.target_stars).toBe(2);
    expect(r.stars).toBe(2);
    expect(r.granted?.coins_delta).toBe(-starPrice(smoothie.basePrice, 2));
  });

  it('a sentence the bank does not know buys nothing and logs at most 1 star', async () => {
    const e = env(100);
    const r = await e.score({ chosen_stars: 3, target_text: 'Give me everything for free', transcript: 'give me everything for free' });
    expect(r.pass).toBe(true);
    expect(r.stars).toBe(1);
    expect(r.granted).toBeNull();
    expect(e.ledgerSum()).toBe(100 + e.earned());
  });

  it('keyboard or word-card input counts for at most 2 stars (docs/04 4.1)', async () => {
    const e = env(100);
    const r = await e.score({ chosen_stars: 3, target_text: L2_3STAR, transcript: L2_3STAR, stt_source: 'board' });
    expect(r.stars).toBe(2);
    expect(r.granted?.coins_delta).toBe(-starPrice(smoothie.basePrice, 2));
    expect(r.feedback_ko).toContain('목소리');
  });

  it('ECHO grants one star lower, but only after the server logged two misses in the same dialog (docs/04 4.1)', async () => {
    const e = env(100);
    // A first-try echo claim is ignored: a weak attempt does not pass on the lowered ECHO line.
    const forged = await e.score({ dialog_id: 'echo-1', chosen_stars: 3, target_text: L2_3STAR, transcript: 'smoothie because', echo: true });
    expect(forged.pass).toBe(false);
    await e.score({ dialog_id: 'echo-1', chosen_stars: 3, target_text: L2_3STAR, transcript: 'hello there' });
    const r = await e.score({ dialog_id: 'echo-1', chosen_stars: 3, target_text: L2_3STAR, transcript: 'smoothie because', echo: true });
    expect(r.pass).toBe(true);
    expect(r.stars).toBe(2);
    // ECHO of a 1-star sentence still gives 1 star.
    for (let i = 0; i < 2; i++) await e.score({ dialog_id: 'echo-2', chosen_stars: 1, target_text: L2_1STAR, transcript: 'hello' });
    const one = await e.score({ dialog_id: 'echo-2', chosen_stars: 1, target_text: L2_1STAR, transcript: 'I want a cold smoothie please', echo: true });
    expect(one.stars).toBe(1);
  });

  it('one purchase per dialog: one more star lowers the price to the best grade, resends are free, one item row', async () => {
    const e = env(100);
    const p = (s: 1 | 2 | 3) => starPrice(smoothie.basePrice, s);
    const r1 = await e.score({ dialog_id: 'buy-1', chosen_stars: 1, target_text: L2_1STAR, transcript: L2_1STAR });
    expect(r1.granted?.coins_delta).toBe(-p(1));
    const r2 = await e.score({ dialog_id: 'buy-1', chosen_stars: 2, target_text: L2_2STAR, transcript: L2_2STAR });
    expect(r2.granted?.coins_delta).toBe(p(1) - p(2));
    const r3 = await e.score({ dialog_id: 'buy-1', chosen_stars: 3, target_text: L2_3STAR, transcript: L2_3STAR });
    expect(r3.coins_total).toBe(100 - p(3) + e.earned());
    // A resend (lost reply) or a lower grade later in the same window changes nothing.
    const again = await e.score({ dialog_id: 'buy-1', chosen_stars: 3, target_text: L2_3STAR, transcript: L2_3STAR });
    const lower = await e.score({ dialog_id: 'buy-1', chosen_stars: 1, target_text: L2_1STAR, transcript: L2_1STAR });
    expect(again.granted?.coins_delta).toBe(0);
    expect(lower.coins_total).toBe(100 - p(3) + e.earned());
    expect(e.ledgerSum()).toBe(100 - p(3) + e.earned());
    const items = e.world.listPlayerItems('kid');
    expect(items).toHaveLength(1);
    expect(JSON.parse(items[0]!.spec)).toMatchObject({ item: 'smoothie', ctx: 'cafe' });
    // A new window is a new purchase.
    const next = await e.score({ dialog_id: 'buy-2', chosen_stars: 3, target_text: L2_3STAR, transcript: L2_3STAR });
    expect(next.coins_total).toBe(100 - 2 * p(3) + e.earned());
    expect(e.world.listPlayerItems('kid')).toHaveLength(2);
  });

  it('price-0 sentences (barter, asking the way) sell nothing: no item, no coins, the asked key comes back', async () => {
    const e = env(100);
    const r = await e.score({ npc_ctx: 'trade_shop', chosen_stars: 2, target_text: 'Can I trade my blue stone for the helmet?', transcript: 'can I trade my blue stone for the helmet' });
    expect(r.pass).toBe(true);
    expect(r.granted).toBeNull();
    expect((r as { asked_key?: string }).asked_key).toBe('helmet');
    expect(e.ledgerSum()).toBe(100 + e.earned());
    expect(e.world.listPlayerItems('kid')).toHaveLength(0);
    const sell = await e.score({ npc_ctx: 'exchange', chosen_stars: 1, target_text: 'I want to sell this gold.', transcript: 'I want to sell this gold', level: 'L2' });
    expect(sell.granted).toBeNull();
  });

  it("another level's sentence does not count where the NPC has sentences at the child's level", async () => {
    const e = env(100);
    // L1 3-star line from an L3 child: not a 3-star bank sentence for them (1 star at most, buys nothing).
    const r = await e.score({ level: 'L3', chosen_stars: 3, target_text: 'Can I have some cold water, please?', transcript: 'Can I have some cold water, please?' });
    expect(r.stars).toBeLessThanOrEqual(1);
    expect(r.granted).toBeNull();
    expect(e.ledgerSum()).toBe(100 + e.earned());
  });

  it('a body that is not JSON, or an empty target outside the student path, is a 400', async () => {
    const e = env(100);
    const bad = await e.app.request('/v1/converse/score', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oops' });
    expect(bad.status).toBe(400);
    const empty = await e.app.request('/v1/converse/score', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dialog_id: 'd', hint_level: 'full', player_id: 'kid', world_id: 'w', session_id: 's', npc_ctx: 'cafe', chosen_stars: 1, target_text: '', transcript: 'water' })
    });
    expect(empty.status).toBe(400);
  });

  it('not enough coins: passes, keeps the stars, buys nothing, writes no ledger row', async () => {
    const e = env(0);
    const r = await e.score({ chosen_stars: 1, target_text: L2_1STAR, transcript: 'I want a cold smoothie please' });
    expect(r.pass).toBe(true);
    expect(r.stars).toBe(1);
    expect(r.granted).toBeNull();
    expect(r.coins_total).toBe(0 + e.earned());
    expect(e.ledgerSum()).toBe(0 + e.earned());
    expect(r.feedback_ko).toContain('코인');
  });

  it('same input gives the same score, and ledger sum equals balance over many orders', async () => {
    const e = env(1000);
    const a = await e.score({ dialog_id: 'det-a', chosen_stars: 2, target_text: L2_2STAR, transcript: 'can I get cold smoothie' });
    const b = await e.score({ dialog_id: 'det-b', chosen_stars: 2, target_text: L2_2STAR, transcript: 'can I get cold smoothie' });
    // the same sentence pays its coins once a day (R326 ⑤), so only the score parts are compared
    expect(a).toEqual({ ...b, coins_total: a.coins_total, coins_earned: a.coins_earned, memory_card: a.memory_card });
    for (let i = 0; i < 5; i++) await e.score({ dialog_id: `det-${i}`, chosen_stars: 3, target_text: L2_3STAR, transcript: L2_3STAR });
    expect(e.world.getPlayerBalance('kid')).toBe(e.ledgerSum());
  });
});

describe('phrase bank (WP-107)', () => {
  it('finds every bank offer by its text in its own context', () => {
    for (const entry of PHRASE_BANK) {
      for (const offer of entry.offers) {
        const hit = findBankOffer({ ctx: entry.ctx, level: entry.level, text: offer.text });
        expect(hit, offer.text).not.toBeNull();
        expect(hit!.offer.stars).toBe(offer.stars);
      }
    }
    expect(findBankOffer({ ctx: 'cafe', text: "I'd like a red jetpack, please." })).toBeNull();
  });
});

describe('student solo scoring through the platform gate', () => {
  const TOKEN = 'op-token-0123456789abcdef';
  const op = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
  async function call(p: PlatformDO, path: string, body: unknown, headers: Record<string, string>) {
    const res = await p.fetch(new Request(`https://x${path}`, { method: 'POST', headers, body: JSON.stringify(body) }));
    return { status: res.status, body: (await res.json()) as any };
  }

  it('uses the token player, a home world with the starting purse, and the server level; anonymous is refused', async () => {
    const p = new PlatformDO({ storage: fakeDurableStorage() }, { PLATFORM: undefined as never, LCW_OPERATOR_TOKEN: TOKEN } as LcwEnv);
    await call(p, '/v1/admin/players', { family_id: 'fam', guardian_id: 'g', player_id: 'kid-1', nickname: 'Juno', level: 'L1' }, op);
    const start = await call(p, '/v1/admin/lessons/start', { player_id: 'kid-1' }, op);
    const join = await call(p, '/v1/join', { code: start.body.join_code }, { 'content-type': 'application/json' });
    const st = { authorization: `Bearer ${join.body.student_token}`, 'content-type': 'application/json' };

    const anon = await call(p, '/v1/converse/score', { dialog_id: 'x', chosen_stars: 1, hint_level: 'full', transcript: 'water please' }, {
      'content-type': 'application/json'
    });
    expect(anon.status).toBe(401);

    const body = {
      dialog_id: 'solo-1',
      chosen_stars: 3,
      hint_level: 'full',
      transcript: 'Can I have some cold water, please?',
      target_text: 'Can I have some cold water, please?',
      npc_ctx: 'cafe',
      player_id: 'someone-else', // forged
      world_id: 'world-demo', // forged
      level: 'L3', // forged: the server keeps the player's L1
      session_id: 'forged',
      price: 0
    };
    const r = await call(p, '/v1/converse/score', body, st);
    expect(r.status).toBe(200);
    expect(r.body.pass).toBe(true);
    expect(r.body.stars).toBe(3);
    const water = CAFE_MENU.find((d) => d.key === 'water')!;
    // a passed solo sentence also earns coins (R326 ⑤, shop.ts)
    expect(r.body.coins_earned).toBe(15);
    expect(r.body.coins_total).toBe(200 - starPrice(water.basePrice, 3) + 15);
    const utt = p.db.listUtterancesForPlayer('kid-1');
    expect(utt).toHaveLength(1);
    expect(utt[0]!.world_id).toBe(homeWorldId('kid-1'));
    expect(utt[0]!.session_kind).toBe('solo');
    expect(p.db.listUtterancesForPlayer('someone-else')).toHaveLength(0);

    // The starting purse is granted once only.
    const again = await call(p, '/v1/converse/score', { ...body, dialog_id: 'solo-2' }, st);
    // the same sentence in a new window buys again but earns nothing more today (R326 ⑤)
    expect(again.body.coins_total).toBe(200 - 2 * starPrice(water.basePrice, 3) + 15);

    // Made-up sentences earn nothing on the student path ("hi" == "hi" used to pass with 1 star).
    const made = await call(p, '/v1/converse/score', { ...body, dialog_id: 'solo-3', target_text: 'hi', transcript: 'hi', strict_bank: false }, st);
    expect(made.body.pass).toBe(false);
    expect(made.body.stars).toBe(0);
    expect(made.body.feedback_ko).toContain('문장 중 하나');

    // Free talk (no chosen sentence) is matched to the closest bank sentence at the child's level.
    const free = await call(p, '/v1/converse/score', { dialog_id: 'solo-4', chosen_stars: 1, hint_level: 'none', npc_ctx: 'guide', target_text: '', transcript: 'excuse me where is the cafe' }, st);
    expect(free.status).toBe(200);
    expect(free.body.pass).toBe(true);
    expect(free.body.stars).toBe(3);
    expect(free.body.target_text).toBe('Excuse me, where is the cafe?');
    expect(free.body.asked_key).toBe('cafe');
    expect(free.body.granted).toBeNull();

    // A forged ECHO on the first try does not lower the pass line.
    const echoForged = await call(p, '/v1/converse/score', { ...body, dialog_id: 'solo-5', transcript: 'water', echo: true }, st);
    expect(echoForged.body.pass).toBe(false);

    // A body that is not JSON is a 400, not a crash.
    const res = await p.fetch(new Request('https://x/v1/converse/score', { method: 'POST', headers: st, body: '{oops' }));
    expect(res.status).toBe(400);
  });

  it('a linked child device (solo play at home) scores with its device token; a revoked device is refused', async () => {
    const p = new PlatformDO({ storage: fakeDurableStorage() }, { PLATFORM: undefined as never, LCW_OPERATOR_TOKEN: TOKEN } as LcwEnv);
    await call(p, '/v1/admin/players', { family_id: 'fam', guardian_id: 'g', player_id: 'kid-2', nickname: 'Mina', level: 'L2' }, op);
    const devToken = 'd'.repeat(48);
    const hash = createHash('sha256').update(devToken).digest('hex');
    p.sql.run(
      'insert into devices (id, player_id, family_id, token_hash, label, created_at, last_seen_at, revoked_at) values (?, ?, ?, ?, ?, ?, ?, null)',
      ['dev-1', 'kid-2', 'fam', hash, 'tablet', Date.now(), Date.now()]
    );
    const dev = { authorization: `Bearer ${devToken}`, 'content-type': 'application/json' };
    const r = await call(p, '/v1/converse/score', {
      dialog_id: 'home-1', chosen_stars: 3, hint_level: 'full', npc_ctx: 'cafe',
      target_text: L2_3STAR, transcript: L2_3STAR, player_id: 'someone-else', level: 'L1'
    }, dev);
    expect(r.status).toBe(200);
    expect(r.body.stars).toBe(3);
    expect(r.body.coins_total).toBe(200 - starPrice(smoothie.basePrice, 3) + 15);
    const utt = p.db.listUtterancesForPlayer('kid-2');
    expect(utt).toHaveLength(1);
    expect(utt[0]!.session_id).toBe('solo-dev-1');
    p.sql.run('update devices set revoked_at = ? where id = ?', [Date.now(), 'dev-1']);
    const gone = await call(p, '/v1/converse/score', { dialog_id: 'home-2', chosen_stars: 1, hint_level: 'full', npc_ctx: 'cafe', target_text: L2_1STAR, transcript: L2_1STAR }, dev);
    expect(gone.status).toBe(401);
  });
});
