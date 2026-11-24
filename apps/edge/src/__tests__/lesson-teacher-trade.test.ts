import { afterEach, describe, expect, it, vi } from 'vitest';
import { FIRST_LESSON_PLAN, TEACHER_STOCK, tradeOffers } from '@lcw/content';
import { PlatformDO, type LcwEnv } from '../platform.js';
import { fakeDurableStorage } from './fake-do.js';

/**
 * R325 (Dan 11-19, during a real lesson): the teacher walks with the child, speaks in the world, holds the stages while
 * in the world, and trades things with the child — the server moves things only after the trade sentence passes, once
 * per client id. docs/18 §11.
 */

const TOKEN = 'op-token-0123456789abcdef';
const op = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
const T0 = Date.parse('2026-11-19T08:00:00Z');
let now = T0;
afterEach(() => vi.restoreAllMocks());

function platform() {
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  return new PlatformDO({ storage: fakeDurableStorage() }, { PLATFORM: undefined as never, LCW_OPERATOR_TOKEN: TOKEN } as LcwEnv);
}
async function call(p: PlatformDO, method: string, path: string, body?: unknown, headers: Record<string, string> = op) {
  const res = await p.fetch(new Request(`https://x${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
  return { status: res.status, body: (await res.json()) as any };
}
async function lesson(p: PlatformDO) {
  await call(p, 'POST', '/v1/admin/players', { family_id: 'fam-1', guardian_id: 'g-1', player_id: 'kid-1', nickname: 'Kid', birth_year: 2016, level: 'L1' });
  const s = await call(p, 'POST', '/v1/admin/lessons/start', { player_id: 'kid-1', presence: true });
  const j = await call(p, 'POST', '/v1/join', { code: s.body.join_code }, { 'content-type': 'application/json' });
  return { lessonId: s.body.lesson_id as string, st: { authorization: `Bearer ${j.body.student_token}`, 'content-type': 'application/json' } };
}
const STAGES = FIRST_LESSON_PLAN.stages;
const cid = (n: number) => `c${T0}-${String(n).padStart(4, '0')}`;
const items = (p: PlatformDO, st: Record<string, string>) => call(p, 'GET', '/v1/items', undefined, st).then((r) => r.body.items as Array<{ item_id: string; item_key: string; location: string }>);

describe('trading with the teacher (R325)', () => {
  it('the client id is the shape the outbox ids have', () => {
    expect(cid(1)).toMatch(/^c\d+-\d{4}$/);
  });

  it('a passed trade sentence puts the teacher\'s thing in the bag once; a resend moves nothing again', async () => {
    now = T0;
    const p = platform();
    const { lessonId, st } = await lesson(p);
    const open = await call(p, 'GET', '/v1/lesson/trade', undefined, st);
    expect(open.status).toBe(200);
    expect(open.body.stock.length).toBe(TEACHER_STOCK.length);
    expect(open.body.stock.length).toBeGreaterThanOrEqual(20);
    const offer = tradeOffers({ getKey: 'lantern', level: 'L1' })[1]!;
    const body = { client_id: cid(1), get_key: 'lantern', target_text: offer.text, transcript: offer.text.toLowerCase(), chosen_stars: 2 };
    const a = await call(p, 'POST', '/v1/lesson/trade', body, st);
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ pass: true, trade: { done: true, get_key: 'lantern', location: 'bag' } });
    expect(a.body.feedback_en).toMatch(/lantern/);
    const again = await call(p, 'POST', '/v1/lesson/trade', body, st);
    expect(again.body).toMatchObject({ replayed: true, trade: { done: true } });
    const bag = await items(p, st);
    expect(bag.filter((x) => x.item_key === 'lantern')).toHaveLength(1);
    // the teacher's reply reaches the child's world as the teacher's line; the console lists the trade
    const s = await call(p, 'GET', '/v1/lesson/state', undefined, st);
    expect(s.body.npc_lines.some((l: any) => l.npc_id === 'teacher' && /lantern/.test(l.text))).toBe(true);
    const feed = await call(p, 'GET', `/v1/admin/lessons/${lessonId}/feed`);
    expect(feed.body.trades[0]).toMatchObject({ kind: 'trade', get_key: 'lantern', ok: true, transcript: offer.text.toLowerCase() });
    // a trade sentence is the lesson's talk, never a stage pass
    expect(feed.body.lesson.stage_id).toBe(STAGES[0]!.id);
  });

  it('R326 review: one trade per dialog window — saying it again for more stars (a new client id) moves nothing again', async () => {
    now = T0;
    const p = platform();
    const { st } = await lesson(p);
    const offers = tradeOffers({ getKey: 'lantern', level: 'L1' });
    const win = 'dlg_window00001';
    const one = await call(p, 'POST', '/v1/lesson/trade', { client_id: cid(11), window_id: win, get_key: 'lantern', target_text: offers[0]!.text, transcript: offers[0]!.text, chosen_stars: 1 }, st);
    expect(one.body.trade).toMatchObject({ done: true });
    const more = await call(p, 'POST', '/v1/lesson/trade', { client_id: cid(12), window_id: win, get_key: 'lantern', target_text: offers[1]!.text, transcript: offers[1]!.text, chosen_stars: 2 }, st);
    expect(more.body).toMatchObject({ replayed: true, trade: { done: true } });
    expect((await items(p, st)).filter((x) => x.item_key === 'lantern')).toHaveLength(1);
    // a new window is a new trade
    const next = await call(p, 'POST', '/v1/lesson/trade', { client_id: cid(13), window_id: 'dlg_window00002', get_key: 'lantern', target_text: '', transcript: offers[0]!.text }, st);
    expect(next.body.trade).toMatchObject({ done: true });
    expect((await items(p, st)).filter((x) => x.item_key === 'lantern')).toHaveLength(2);
  });

  it('a wrong sentence moves nothing; a sentence that is not this trade\'s is refused; the child gives only their own things', async () => {
    now = T0;
    const p = platform();
    const { st } = await lesson(p);
    const offer = tradeOffers({ getKey: 'map', level: 'L1' })[0]!;
    const bad = await call(p, 'POST', '/v1/lesson/trade', { client_id: cid(2), get_key: 'map', target_text: offer.text, transcript: 'banana' }, st);
    expect(bad.body).toMatchObject({ pass: false, trade: { done: false } });
    expect((await items(p, st)).some((x) => x.item_key === 'map')).toBe(false);
    const hi = await call(p, 'POST', '/v1/lesson/trade', { client_id: cid(3), get_key: 'map', target_text: 'Hi.', transcript: 'hi' }, st);
    expect(hi.status).toBe(400);
    expect(hi.body.error).toBe('not_a_trade_sentence');
    const notMine = await call(p, 'POST', '/v1/lesson/trade', { client_id: cid(4), get_key: 'map', give_item_id: 'buy-x|apple', target_text: 'x', transcript: 'x' }, st);
    expect(notMine.status).toBe(409);
    expect(notMine.body.error).toBe('item_not_owned');
  });

  it('a swap: the child\'s thing goes to the teacher, the teacher\'s comes to the child', async () => {
    now = T0;
    const p = platform();
    const { lessonId, st } = await lesson(p);
    // the teacher gives a rope first (console or 3D page), then the child trades the rope for boots
    const g = await call(p, 'POST', `/v1/admin/lessons/${lessonId}/give`, { item_key: 'rope', client_id: cid(5) });
    expect(g.status).toBe(201);
    expect((await call(p, 'POST', `/v1/admin/lessons/${lessonId}/give`, { item_key: 'rope', client_id: cid(5) })).body.replayed).toBe(true);
    const rope = (await items(p, st)).filter((x) => x.item_key === 'rope');
    expect(rope).toHaveLength(1);
    const s = await call(p, 'GET', '/v1/lesson/state', undefined, st);
    expect(s.body.npc_lines.some((l: any) => l.npc_id === 'teacher' && /rope/.test(l.text))).toBe(true);
    const offer = tradeOffers({ getKey: 'boots', giveKey: 'rope', level: 'L1' })[1]!;
    expect(offer.text).toBe('Can I trade my rope for the boots?');
    const t = await call(p, 'POST', '/v1/lesson/trade', { client_id: cid(6), get_key: 'boots', give_item_id: rope[0]!.item_id, target_text: offer.text, transcript: offer.text, chosen_stars: 2 }, st);
    expect(t.body.trade).toMatchObject({ done: true, get_key: 'boots', give_key: 'rope' });
    const after = await items(p, st);
    expect(after.some((x) => x.item_key === 'rope')).toBe(false);
    expect(after.filter((x) => x.item_key === 'boots')).toHaveLength(1);
  });

  it('the cursor poll brings the gift once (the world puts it in hand)', async () => {
    now = T0;
    const p = platform();
    const { lessonId, st } = await lesson(p);
    const s0 = await call(p, 'GET', '/v1/lesson/state', undefined, st);
    await call(p, 'POST', `/v1/admin/lessons/${lessonId}/give`, { item_key: 'compass', client_id: cid(7) });
    const s1 = await call(p, 'GET', `/v1/lesson/state?cursor=${s0.body.cursor}`, undefined, st);
    expect(s1.body.gifts.map((x: any) => x.item_key)).toEqual(['compass']);
    const s2 = await call(p, 'GET', `/v1/lesson/state?cursor=${s1.body.cursor}`, undefined, st);
    expect(s2.body.gifts).toEqual([]);
  });
});

describe('the teacher in the world (R325)', () => {
  it('speaks as the teacher (no NPC possessed)', async () => {
    now = T0;
    const p = platform();
    const { lessonId, st } = await lesson(p);
    const r = await call(p, 'POST', `/v1/admin/lessons/${lessonId}/npc-say`, { npc_id: 'teacher', text: 'Follow me to the cafe!' });
    expect(r.status).toBe(201);
    const s = await call(p, 'GET', '/v1/lesson/state', undefined, st);
    expect(s.body.npc_lines.map((l: any) => [l.npc_id, l.text])).toContainEqual(['teacher', 'Follow me to the cafe!']);
    expect(s.body.possessed_npc_id).toBeNull();
  });

  it("R2861①: with the teacher in the world the child's talk still moves the stage; only the planned minutes wait for the teacher", async () => {
    now = T0;
    const p = platform();
    const { lessonId, st } = await lesson(p);
    const beat = () => call(p, 'POST', `/v1/admin/lessons/${lessonId}/presence`, { source: 'world' });
    await beat();
    const s0 = await call(p, 'GET', '/v1/lesson/state', undefined, st);
    expect(s0.body.teacher.in_world).toBe(true);
    now += 30_000;
    const say = (t: string) => call(p, 'POST', '/v1/lesson/utterance', { target_text: t, transcript: t, chosen_stars: 1 }, st);
    await say(STAGES[0]!.targets[1]!.text);
    now += 10_000;
    const b = await say(STAGES[0]!.targets[2]!.text);
    expect(b.body.pass).toBe(true);
    expect(b.body.auto_advanced).toMatchObject({ from: STAGES[0]!.id, to: STAGES[1]!.id, why: 'passes' });
    // own words with the teacher there move it too (Dan 11-23: "학생 회화가 다음 단계로 안 감")
    await beat();
    now += 10_000;
    await call(p, 'POST', '/v1/lesson/utterance', { transcript: 'i want to buy something to eat', chosen_stars: 1 }, st);
    now += 10_000;
    const c = await call(p, 'POST', '/v1/lesson/utterance', { transcript: 'do you have any cookies today', chosen_stars: 1 }, st);
    expect(c.body.auto_advanced).toMatchObject({ from: STAGES[1]!.id, to: STAGES[2]!.id });
    // the minutes alone wait for the teacher while the teacher walks in the world
    const mins = STAGES[2]!.minutes * 60_000;
    await beat();
    await call(p, 'POST', '/v1/lesson/utterance', { transcript: 'ok', chosen_stars: 1 }, st);
    let s: any = null;
    for (let t = 0; t < mins + 6000; t += 3000) {
      now += 3000;
      if (t % 9000 === 0) await beat();
      s = await call(p, 'GET', '/v1/lesson/state', undefined, st);
    }
    expect(s.body.stage_id).toBe(STAGES[2]!.id);
    const f = await call(p, 'GET', `/v1/admin/lessons/${lessonId}/feed`);
    expect(f.body.stage_hold).toEqual({ held: true, ready: 'time', next_stage_id: STAGES[3]!.id, quiet: false });
  }, 30_000); // many stored talks through the real routes: slow on a loaded machine (full run, 11-24)
});
