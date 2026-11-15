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
    };
  };
  const ledgerSum = () =>
    Number(world.sql.get<{ s: number }>('select coalesce(sum(delta),0) as s from ledger where player = ?', ['kid'])?.s ?? 0);
  return { app, db, world, score, ledgerSum };
}

const smoothie = CAFE_MENU.find((d) => d.key === 'smoothie')!;
const L2_3STAR = 'Can I get a cold smoothie because I am thirsty?';
const L2_2STAR = 'Can I get a cold smoothie?';

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
    expect(e.ledgerSum()).toBe(100);
    expect(r.feedback_ko).toContain('연결하는 말');
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
    expect(r.coins_total).toBe(100 - starPrice(smoothie.basePrice, 2));
    expect(e.ledgerSum()).toBe(r.coins_total);
  });

  it('a full 3-star order is charged the 50% price from the bank', async () => {
    const e = env(100);
    const r = await e.score({ chosen_stars: 3, target_text: L2_3STAR, transcript: L2_3STAR, price: 999 });
    expect(r.stars).toBe(3);
    expect(r.granted?.coins_delta).toBe(-starPrice(smoothie.basePrice, 3));
    expect(r.granted?.slot_or_socket).toBe('RightHand_Socket');
    expect(e.ledgerSum()).toBe(100 - 25);
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
    expect(e.ledgerSum()).toBe(100);
  });

  it('keyboard or word-card input counts for at most 2 stars (docs/04 4.1)', async () => {
    const e = env(100);
    const r = await e.score({ chosen_stars: 3, target_text: L2_3STAR, transcript: L2_3STAR, stt_source: 'board' });
    expect(r.stars).toBe(2);
    expect(r.granted?.coins_delta).toBe(-starPrice(smoothie.basePrice, 2));
    expect(r.feedback_ko).toContain('목소리');
  });

  it('ECHO grants one star lower and never leaves empty-handed (docs/04 4.1)', async () => {
    const e = env(100);
    const r = await e.score({ chosen_stars: 1, target_text: 'I want cold smoothie, please.', transcript: 'I want cold smoothie please', echo: true });
    expect(r.pass).toBe(true);
    expect(r.stars).toBe(1);
    const r3 = await e.score({ chosen_stars: 3, target_text: L2_3STAR, transcript: 'can I get a cold smoothie because I am thirsty', echo: true });
    expect(r3.stars).toBe(2);
  });

  it('not enough coins: passes, keeps the stars, buys nothing, writes no ledger row', async () => {
    const e = env(0);
    const r = await e.score({ chosen_stars: 1, target_text: 'I want cold smoothie, please.', transcript: 'I want cold smoothie please' });
    expect(r.pass).toBe(true);
    expect(r.stars).toBe(1);
    expect(r.granted).toBeNull();
    expect(r.coins_total).toBe(0);
    expect(e.ledgerSum()).toBe(0);
    expect(r.feedback_ko).toContain('코인');
  });

  it('same input gives the same score, and ledger sum equals balance over many orders', async () => {
    const e = env(1000);
    const a = await e.score({ chosen_stars: 2, target_text: L2_2STAR, transcript: 'can I get cold smoothie' });
    const b = await e.score({ chosen_stars: 2, target_text: L2_2STAR, transcript: 'can I get cold smoothie' });
    expect(a).toEqual({ ...b, coins_total: a.coins_total });
    for (let i = 0; i < 5; i++) await e.score({ chosen_stars: 3, target_text: L2_3STAR, transcript: L2_3STAR });
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
      transcript: 'Can I have cold water, please?',
      target_text: 'Can I have cold water, please?',
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
    expect(r.body.coins_total).toBe(200 - starPrice(water.basePrice, 3));
    const utt = p.db.listUtterancesForPlayer('kid-1');
    expect(utt).toHaveLength(1);
    expect(utt[0]!.world_id).toBe(homeWorldId('kid-1'));
    expect(utt[0]!.session_kind).toBe('solo');
    expect(p.db.listUtterancesForPlayer('someone-else')).toHaveLength(0);

    // The starting purse is granted once only.
    const again = await call(p, '/v1/converse/score', { ...body, dialog_id: 'solo-2' }, st);
    expect(again.body.coins_total).toBe(200 - 2 * starPrice(water.basePrice, 3));
  });
});
