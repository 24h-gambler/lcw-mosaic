import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { QuotaMeter } from '@lcw/quota';
import { TUNING } from '@lcw/sim-core';
import { findBankOffer, bankItemKey, PHRASE_BANK } from '@lcw/content';
import { createNodeSqliteExecutor } from '../node-sqlite.js';
import { createEdgeApp } from '../app.js';
import { EdgePlatformDb, InMemoryR2Store, WorldDO } from '../storage.js';
import { PlatformDO, type LcwEnv } from '../platform.js';
import { createMemoryCard, recordItemUse } from '../review.js';
import { fakeDurableStorage } from './fake-do.js';

/**
 * WP-310 (20 min · 1 day reviews) and WP-406 (review signs: equipped / recently used gear first, 3 per session,
 * chest gear only at the repair pick), docs/03 D8, docs/09 P4 — through the real routes.
 */

const MIN = 60_000;
const DAY = 86_400_000;
const T0 = 1_763_300_000_000;
const L2_3STAR = 'Can I get a cold smoothie because I am thirsty?';
const L2_2STAR = 'Can I get a cold smoothie?';
const L2_1STAR = 'I want a cold smoothie, please.';

function env(startCoins = 500) {
  let now = T0;
  const db = new EdgePlatformDb(createNodeSqliteExecutor(':memory:'));
  db.ensureFamilyAndPlayer({ familyId: 'f', guardianId: 'g', playerId: 'kid', nickname: 'Kid', level: 'L2', nowMs: 1 });
  const world = new WorldDO({ sql: createNodeSqliteExecutor(':memory:'), r2: new InMemoryR2Store(), seed: 's' });
  world.appendLedger('kid', startCoins, 'starter', 'starter', 1);
  const app = createEdgeApp({
    db,
    worlds: new Map([['w', world]]),
    lessons: new Map(),
    quota: new QuotaMeter('2026-11-16'),
    nowMs: () => now
  });
  const post = async (path: string, body: Record<string, unknown>) => {
    const res = await app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    return { status: res.status, body: (await res.json()) as Record<string, any> };
  };
  const order = (dialog: string, text: string, stars: 1 | 2 | 3) =>
    post('/v1/converse/score', {
      dialog_id: dialog,
      hint_level: 'full',
      player_id: 'kid',
      world_id: 'w',
      session_id: 's',
      npc_ctx: 'cafe',
      level: 'L2',
      chosen_stars: stars,
      target_text: text,
      transcript: text
    });
  const due = async () => {
    const res = await app.request('/v1/review/due?player_id=kid&world_id=w');
    return (await res.json()) as { signs: Array<Record<string, any>>; next_due_at: number | null; mastered: number };
  };
  const attempt = (card: string, transcript: string) =>
    post('/v1/review/attempt', { player_id: 'kid', world_id: 'w', card_id: card, transcript, level: 'L2' });
  const ledgerSum = () =>
    Number(world.sql.get<{ s: number }>('select coalesce(sum(delta),0) as s from ledger where player = ?', ['kid'])?.s ?? 0);
  return {
    db,
    world,
    order,
    due,
    attempt,
    ledgerSum,
    advance: (ms: number) => (now += ms),
    now: () => now
  };
}

describe('memory cards from orders (docs/03 D8)', () => {
  it('a 2+ star order makes one card due in 20 minutes; a 1-star order makes none', async () => {
    const e = env();
    const one = await e.order('d1', L2_1STAR, 1);
    expect(one.body.pass).toBe(true);
    expect(one.body.memory_card).toBeNull();

    const two = await e.order('d2', L2_2STAR, 2);
    expect(two.body.stars).toBe(2);
    expect(two.body.memory_card.id).toBe('mc-d2');
    expect(Date.parse(two.body.memory_card.next_review_at)).toBe(e.now() + 20 * MIN);
    // "One more star" in the same window points the same card at the better sentence.
    const three = await e.order('d2', L2_3STAR, 3);
    expect(three.body.memory_card.id).toBe('mc-d2');
    const rows = e.db.sql.all<{ id: string }>('select id from memory_cards where player_id = ?', ['kid']);
    expect(rows.map((r) => r.id)).toEqual(['mc-d2']);
    // The bought item carries the card.
    const item = e.world.sql.get<{ card_id: string }>('select card_id from items where id = ?', ['buy-d2|smoothie']);
    expect(item?.card_id).toBe('mc-d2');
  });

  it('no item bought (short of coins) → no card', async () => {
    const e = env(1);
    const r = await e.order('poor', L2_2STAR, 2);
    expect(r.body.pass).toBe(true);
    expect(r.body.granted).toBeNull();
    expect(r.body.memory_card).toBeNull();
  });
});

describe('review 20 min → 1 day (WP-310) and the 35-day path (WP-406)', () => {
  it('the sign appears at 20 minutes with the full sentence and voice, then at 1 day without voice', async () => {
    const e = env();
    await e.order('d1', L2_3STAR, 3);
    let d = await e.due();
    expect(d.signs).toHaveLength(0);
    expect(d.next_due_at).toBe(e.now() + 20 * MIN);

    e.advance(20 * MIN);
    d = await e.due();
    expect(d.signs).toHaveLength(1);
    const s = d.signs[0]!;
    expect(s).toMatchObject({ card_id: 'mc-d1', item_key: 'smoothie', text: L2_3STAR, hint: 'full', listen: true, box: 0 });
    expect(s.label_ko).toContain('스무디');

    // Saying it again before it is due does not push the box.
    const ok = await e.attempt('mc-d1', L2_3STAR);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ pass: true, box: 1, mastered: false });
    expect(ok.body.next_review_at).toBe(e.now() + DAY);
    expect(ok.body.feedback_ko).toContain('내일');
    const early = await e.attempt('mc-d1', L2_3STAR);
    expect(early.status).toBe(409);
    expect(early.body.error).toBe('not_due');

    e.advance(DAY);
    d = await e.due();
    expect(d.signs[0]).toMatchObject({ hint: 'full', listen: false, box: 1 });
  });

  it('time-accelerated: passing every due review reaches the master blueprint after 35 days; the bonus is paid once into the ledger', async () => {
    const e = env();
    await e.order('d1', L2_3STAR, 3);
    const hints: string[] = [];
    let elapsed = 0;
    for (let i = 0; i < TUNING.memory.intervalsMs.length; i++) {
      const wait = TUNING.memory.intervalsMs[i]!;
      e.advance(wait);
      elapsed += wait;
      // The item is used now and then so it keeps its sign priority (equipped/used within 7 days).
      recordItemUse(e.db, 'kid', 'buy-d1|smoothie', e.now());
      const d = await e.due();
      expect(d.signs).toHaveLength(1);
      hints.push(d.signs[0]!.hint);
      const r = await e.attempt('mc-d1', L2_3STAR);
      expect(r.body.pass).toBe(true);
    }
    expect(hints).toEqual(['full', 'full', 'keyword', 'initial', 'picture', 'none']);
    expect(Math.round(elapsed / DAY)).toBe(62); // 20 min + 1 + 3 + 7 + 16 + 35 days
    const after = await e.due();
    expect(after.mastered).toBe(1);
    expect(after.next_due_at).toBeNull();
    const masters = e.world.sql.all<{ delta: number }>("select delta from ledger where reason = 'memory_master'");
    expect(masters).toEqual([{ delta: TUNING.memory.masterBonusCoins }]);
    expect(e.world.getPlayerBalance('kid')).toBe(e.ledgerSum());
    const again = await e.attempt('mc-d1', L2_3STAR);
    expect(again.status).toBe(409);
  });

  it('a missed review moves back one box only and counts a lapse; the utterance is logged as a review', async () => {
    const e = env();
    await e.order('d1', L2_3STAR, 3);
    e.advance(20 * MIN);
    await e.attempt('mc-d1', L2_3STAR); // box 1
    e.advance(DAY);
    await e.attempt('mc-d1', L2_3STAR); // box 2
    e.advance(3 * DAY);
    const miss = await e.attempt('mc-d1', 'smoothie');
    expect(miss.body.pass).toBe(false);
    expect(miss.body.box).toBe(1);
    expect(miss.body.feedback_ko).toContain('한 번 더');
    const card = e.db.sql.get<{ lapses: number; box: number }>('select lapses, box from memory_cards where id = ?', ['mc-d1']);
    expect(card).toEqual({ lapses: 1, box: 1 });
    const logs = e.db.sql.all<{ mode: string; stars: number }>(
      "select mode, stars from utterances where session_id = 'review-mc-d1' order by created_at"
    );
    expect(logs.map((l) => l.mode)).toEqual(['read', 'read', 'recall']);
    expect(logs[2]!.stars).toBe(0);
  });

  it('the 16-day review accepts another bank sentence for the same thing (same meaning, other words)', async () => {
    const e = env();
    await e.order('d1', L2_3STAR, 3);
    const set = (box: number) =>
      e.db.sql.run('update memory_cards set box = ?, next_review_at = ? where id = ?', [box, e.now(), 'mc-d1']);
    const smoothieKey = bankItemKey(findBankOffer({ ctx: 'cafe', text: L2_3STAR })!.entry);
    const other = PHRASE_BANK.find((b) => b.ctx === 'cafe' && b.level === 'L3' && bankItemKey(b) === smoothieKey)!.offers[1].text;
    set(3);
    expect((await e.attempt('mc-d1', other)).body.pass).toBe(false); // 7-day review: its own sentence only
    set(4);
    const r = await e.attempt('mc-d1', other);
    expect(r.body.pass).toBe(true);
    expect(r.body.matched_text).toBe(other);
  });
});

describe('review signs: equipped / recently used gear first, at most 3, chest gear never (WP-406)', () => {
  it('picks equipped and recently used cards by 10 + days overdue; chest gear gets no sign', async () => {
    const e = env(5000);
    const drinks = ['water', 'milk', 'juice', 'lemonade', 'smoothie'];
    const dialogs: string[] = [];
    for (const [i, d] of drinks.entries()) {
      const entry = PHRASE_BANK.find((b) => b.ctx === 'cafe' && b.level === 'L2' && b.slotsKey.startsWith(`item=${d}|`));
      if (!entry) continue;
      const r = await e.order(`d${i}`, entry.offers[1].text, 2);
      expect(r.body.memory_card).not.toBeNull();
      dialogs.push(`d${i}`);
    }
    expect(dialogs.length).toBeGreaterThanOrEqual(5);
    // 30 days later: everything is overdue, nothing was used since the purchase. The 10 is a priority, not a gate:
    // things carried in the bag still come up (at most 3).
    e.advance(30 * DAY);
    expect((await e.due()).signs).toHaveLength(TUNING.memory.maxDuePerSession);
    const itemId = (i: number) =>
      e.db.sql.get<{ item_id: string }>('select item_id from memory_cards where id = ?', [`mc-${dialogs[i]}`])!.item_id;
    // Stored in the chest and not used for 30 days: no sign at all (the repair NPC reviews them).
    for (const i of dialogs.keys()) e.world.sql.run("update items set location = 'chest' where id = ?", [itemId(i)]);
    expect((await e.due()).signs).toHaveLength(0);

    // Card 0 is in the hotbar (equipped); cards 1-3 (in the chest) were used yesterday; card 4 sits in the chest unused.
    e.world.sql.run("update items set location = 'hotbar' where id = ?", [itemId(0)]);
    for (const i of [1, 2, 3]) recordItemUse(e.db, 'kid', itemId(i), e.now() - DAY);
    // Card 2 is the most overdue of the used ones.
    e.db.sql.run('update memory_cards set next_review_at = next_review_at - ? where id = ?', [5 * DAY, `mc-${dialogs[2]}`]);
    const d = await e.due();
    expect(d.signs).toHaveLength(TUNING.memory.maxDuePerSession);
    const ids = d.signs.map((s) => s.card_id);
    expect(ids[0]).toBe(`mc-${dialogs[2]}`);
    expect(ids).not.toContain(`mc-${dialogs[4]}`);
  });
});

describe('platform: the child reviews with the device or lesson token, own cards only', () => {
  it('device token reaches /v1/review/due and /v1/review/attempt; another player cannot touch the card', async () => {
    const TOKEN = 'op-token-0123456789abcdef';
    const p = new PlatformDO({ storage: fakeDurableStorage() }, { PLATFORM: undefined as never, LCW_OPERATOR_TOKEN: TOKEN } as LcwEnv);
    const op = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
    const call = async (path: string, init: RequestInit) => {
      const res = await p.fetch(new Request(`https://lcw.test${path}`, init));
      return { status: res.status, body: (await res.json()) as Record<string, any> };
    };
    for (const id of ['kid-a', 'kid-b']) {
      await call('/v1/admin/players', {
        method: 'POST',
        headers: op,
        body: JSON.stringify({ family_id: 'fam', guardian_id: 'g', player_id: id, nickname: id, level: 'L2' })
      });
    }
    const tok = (c: string) => c.repeat(48);
    for (const [id, c] of [['kid-a', 'a'], ['kid-b', 'b']] as const) {
      p.sql.run(
        'insert into devices (id, player_id, family_id, token_hash, label, created_at, last_seen_at, revoked_at) values (?, ?, ?, ?, ?, ?, ?, null)',
        [`dev-${id}`, id, 'fam', createHash('sha256').update(tok(c)).digest('hex'), 'tablet', Date.now(), Date.now()]
      );
    }
    const dev = (c: string) => ({ authorization: `Bearer ${tok(c)}`, 'content-type': 'application/json' });
    const order = await call('/v1/converse/score', {
      method: 'POST',
      headers: dev('a'),
      body: JSON.stringify({ dialog_id: 'home-1', chosen_stars: 2, hint_level: 'full', npc_ctx: 'cafe', target_text: L2_2STAR, transcript: L2_2STAR })
    });
    expect(order.body.memory_card.id).toBe('mc-home-1');
    // Make it due now (the platform uses the wall clock).
    p.sql.run('update memory_cards set next_review_at = ? where id = ?', [Date.now() - 1000, 'mc-home-1']);

    const anon = await call('/v1/review/due', { method: 'GET' });
    expect(anon.status).toBe(401);
    const due = await call('/v1/review/due?player_id=kid-b', { method: 'GET', headers: dev('a') });
    expect(due.status).toBe(200);
    expect(due.body.signs.map((s: { card_id: string }) => s.card_id)).toEqual(['mc-home-1']);
    const theirs = await call('/v1/review/due', { method: 'GET', headers: dev('b') });
    expect(theirs.body.signs).toEqual([]);
    const steal = await call('/v1/review/attempt', {
      method: 'POST',
      headers: dev('b'),
      body: JSON.stringify({ card_id: 'mc-home-1', transcript: L2_2STAR, player_id: 'kid-a' })
    });
    expect(steal.status).toBe(404);
    const fix = await call('/v1/review/attempt', {
      method: 'POST',
      headers: dev('a'),
      body: JSON.stringify({ card_id: 'mc-home-1', transcript: L2_2STAR, stt_source: 'browser', confidence: 0.9 })
    });
    expect(fix.status).toBe(200);
    expect(fix.body).toMatchObject({ pass: true, box: 1 });
  });

  it('a lesson line passed with 2+ stars becomes one lesson card the child later reviews with the same token', async () => {
    const TOKEN = 'op-token-0123456789abcdef';
    const p = new PlatformDO({ storage: fakeDurableStorage() }, { PLATFORM: undefined as never, LCW_OPERATOR_TOKEN: TOKEN } as LcwEnv);
    const call = async (path: string, body: unknown, headers: Record<string, string>, method = 'POST') => {
      const res = await p.fetch(new Request(`https://lcw.test${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }));
      return { status: res.status, body: (await res.json()) as Record<string, any> };
    };
    const op = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
    await call('/v1/admin/players', { family_id: 'fam', guardian_id: 'g', player_id: 'kid-l', nickname: 'Juno', level: 'L1' }, op);
    const start = await call('/v1/admin/lessons/start', { player_id: 'kid-l' }, op);
    const lessonId = start.body.lesson_id as string;
    const join = await call('/v1/join', { code: start.body.join_code }, { 'content-type': 'application/json' });
    const st = { authorization: `Bearer ${join.body.student_token}`, 'content-type': 'application/json' };
    const line = 'Can I have a warm honey tea?';
    // two sentences on screen: the same one passed three times does not move the stage on (docs/18 §9)
    await call(`/v1/admin/lessons/${lessonId}/stage`, { stage_id: 'cafe_order', targets: [line, 'Can I have a cookie?'] }, op);
    for (const stars of [1, 2, 2]) {
      const r = await call('/v1/lesson/utterance', { target_text: line, transcript: line, chosen_stars: stars }, st);
      expect(r.body.pass).toBe(true);
    }
    const cards = p.sql.all<{ id: string; origin: string; item_id: string }>("select id, origin, item_id from memory_cards where player_id = 'kid-l'");
    expect(cards).toHaveLength(1);
    expect(cards[0]!.origin).toBe('lesson');
    expect(cards[0]!.item_id.endsWith('|cafe_order')).toBe(true);
    p.sql.run('update memory_cards set next_review_at = ? where player_id = ?', [Date.now() - 1, 'kid-l']);
    const due = await call('/v1/review/due', null, st, 'GET');
    expect(due.body.signs.map((s: { text: string }) => s.text)).toEqual([line]);
  });

  it('createMemoryCard is the same entry for lesson lines (origin lesson, no world item)', () => {
    const db = new EdgePlatformDb(createNodeSqliteExecutor(':memory:'));
    expect(createMemoryCard(db, { cardId: 'mc-l1', playerId: 'p', utteranceId: 'u', itemId: 'lesson-u|tea', origin: 'lesson', stars: 1, nowMs: T0 })).toBeNull();
    const c = createMemoryCard(db, { cardId: 'mc-l2', playerId: 'p', utteranceId: 'u', itemId: 'lesson-u|tea', origin: 'lesson', stars: 2, nowMs: T0 });
    expect(c).toEqual({ id: 'mc-l2', next_review_at: T0 + 20 * MIN });
  });
});
