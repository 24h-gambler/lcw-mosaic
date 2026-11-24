import { afterEach, describe, expect, it, vi } from 'vitest';
import { TEACHER_STOCK, tradeOffers } from '@lcw/content';
import { PlatformDO, type LcwEnv } from '../platform.js';
import { fakeDurableStorage } from './fake-do.js';

/**
 * R331 (LCW 함께 진행): the teacher runs the lesson from a panel inside the world instead of the director window. That
 * panel calls the same operator endpoints the console did, so a student's token (which the same world holds) must never
 * open them; the student enters with the join number (or the engday table) only. A trade with the teacher counts its
 * stars by the existing scoring (item name only = ⭐1, more = ⭐2·⭐3) and shows in the feed, the parent report and the
 * hub's lesson card.
 */

const TOKEN = 'op-token-0123456789abcdef';
const op = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
const T0 = Date.parse('2026-11-24T08:00:00Z');
let now = T0;
afterEach(() => vi.restoreAllMocks());

function platform() {
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  return new PlatformDO({ storage: fakeDurableStorage() }, { PLATFORM: undefined as never, LCW_OPERATOR_TOKEN: TOKEN } as LcwEnv);
}
async function call(p: PlatformDO, method: string, path: string, body?: unknown, headers: Record<string, string> = op) {
  const res = await p.fetch(new Request(`https://x${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}
async function lesson(p: PlatformDO) {
  await call(p, 'POST', '/v1/admin/players', { family_id: 'fam-1', guardian_id: 'g-1', player_id: 'kid-1', nickname: 'Kid', birth_year: 2016, level: 'L1' });
  const s = await call(p, 'POST', '/v1/admin/lessons/start', { player_id: 'kid-1', presence: true });
  const j = await call(p, 'POST', '/v1/join', { code: s.body.join_code }, { 'content-type': 'application/json' });
  return { lessonId: s.body.lesson_id as string, st: { authorization: `Bearer ${j.body.student_token}`, 'content-type': 'application/json' } };
}
const cid = (n: number) => `c${T0}-${String(n).padStart(4, '0')}`;

describe('R331 teacher panel in the world', () => {
  it('every panel call refuses a student token and no token; the registered teacher token opens it', async () => {
    now = T0;
    const p = platform();
    const { lessonId, st } = await lesson(p);
    const L = `/v1/admin/lessons/${lessonId}`;
    const panel: Array<[string, string, unknown]> = [
      ['GET', '/v1/admin/students', undefined],
      ['POST', '/v1/admin/lessons/start', { player_id: 'kid-1', presence: true }],
      ['POST', `${L}/stage`, { stage_id: 'warm_up', targets: ['Hello!'], only_if_stage: true }],
      ['POST', `${L}/npc-say`, { npc_id: 'teacher', text: 'Say "The lantern, please." and the lantern is yours!' }],
      ['POST', `${L}/pins`, { kind: 'coaching', at_ms: now, note: '' }],
      ['POST', `${L}/give`, { item_key: 'lantern', client_id: cid(90) }],
      ['GET', `${L}/feed`, undefined],
      ['POST', `${L}/end`, {}]
    ];
    const plain: Record<string, string> = { 'content-type': 'application/json' };
    const wrong: Record<string, string> = { authorization: 'Bearer not-the-operator-token-000', 'content-type': 'application/json' };
    for (const [m, path, body] of panel) {
      for (const h of [st, plain, wrong]) {
        const r = await call(p, m, path, body, h);
        expect([401, 403], `${m} ${path} with ${h.authorization ? 'student/wrong token' : 'no token'}`).toContain(r.status);
      }
    }
    // Still running: nothing above reached the lesson.
    const feed = await call(p, 'GET', `${L}/feed`);
    expect(feed.status).toBe(200);
    expect(feed.body.pins ?? []).toHaveLength(0);
    // The panel shows the join number from the feed (no start response to keep in the world).
    expect(String(feed.body.lesson.join_code)).toMatch(/^\d{4,8}$/);
    // The teacher's panel calls work with the teacher token (the start one opens a second lesson for the same child).
    expect((await call(p, 'POST', `${L}/pins`, { kind: 'coaching', at_ms: now, note: '' })).status).toBeLessThan(300);
    expect((await call(p, 'POST', `${L}/npc-say`, { npc_id: 'teacher', text: 'Hello!' })).status).toBeLessThan(300);
    expect((await call(p, 'GET', '/v1/admin/students')).status).toBe(200);
  });

  it('the student enters with the join number only: a wrong number is refused, the right one gives a student token', async () => {
    now = T0;
    const p = platform();
    const s = await call(p, 'POST', '/v1/admin/players', { family_id: 'fam-1', guardian_id: 'g-1', player_id: 'kid-1', nickname: 'Kid', birth_year: 2016, level: 'L1' });
    expect(s.status).toBeLessThan(300);
    const started = await call(p, 'POST', '/v1/admin/lessons/start', { player_id: 'kid-1', presence: true });
    const code = String(started.body.join_code);
    const bad = code === '000000' ? '111111' : '000000';
    const no = await call(p, 'POST', '/v1/join', { code: bad.slice(0, code.length) }, { 'content-type': 'application/json' });
    expect(no.status).toBeGreaterThanOrEqual(400);
    const yes = await call(p, 'POST', '/v1/join', { code }, { 'content-type': 'application/json' });
    expect(yes.status).toBe(200);
    expect(yes.body.lesson_id).toBe(started.body.lesson_id);
    expect(String(yes.body.student_token).length).toBeGreaterThanOrEqual(16);
  });

  it('trade stars come from the existing scoring: the item name only is ⭐1, the whole sentence ⭐2·⭐3', async () => {
    now = T0;
    const p = platform();
    const { st } = await lesson(p);
    const offers = tradeOffers({ getKey: 'lantern', level: 'L1' });
    expect(offers.map((o) => o.stars)).toEqual([1, 2, 3]);
    const say = async (n: number, win: string, chosen: number, transcript: string, key = 'lantern') =>
      (await call(p, 'POST', '/v1/lesson/trade', { client_id: cid(n), window_id: win, get_key: key, target_text: tradeOffers({ getKey: key, level: 'L1' })[chosen - 1]!.text, transcript, chosen_stars: chosen }, st)).body;
    const one = await say(1, 'dlg_r331_000001', 1, 'the lantern please');
    expect(one).toMatchObject({ pass: true, stars: 1, trade: { done: true } });
    const k2 = TEACHER_STOCK.find((x) => x.adj && x.key !== 'lantern')!.key;
    const three = await say(2, 'dlg_r331_000002', 3, tradeOffers({ getKey: k2, level: 'L1' })[2]!.text.toLowerCase(), k2);
    expect(three).toMatchObject({ pass: true, stars: 3, trade: { done: true } });
    // An empty or off-topic line moves nothing.
    const k3 = TEACHER_STOCK.find((x) => x.key !== 'lantern' && x.key !== k2)!.key;
    const off = await say(3, 'dlg_r331_000003', 2, 'banana', k3);
    expect(off.trade?.done ?? false).toBe(false);
  });

  it('a trade is in the feed, the parent report (teacher_trades) and the hub lesson card', async () => {
    now = T0;
    const p = platform();
    const { lessonId, st } = await lesson(p);
    const offer = tradeOffers({ getKey: 'lantern', level: 'L1' })[1]!;
    now = T0 + 60_000;
    const t = await call(p, 'POST', '/v1/lesson/trade', { client_id: cid(1), window_id: 'dlg_r331_000010', get_key: 'lantern', target_text: offer.text, transcript: offer.text.toLowerCase(), chosen_stars: 2 }, st);
    expect(t.body).toMatchObject({ pass: true, trade: { done: true } });
    const feed = await call(p, 'GET', `/v1/admin/lessons/${lessonId}/feed`);
    expect(feed.body.trades.filter((x: any) => x.kind === 'trade' && x.ok)).toHaveLength(1);
    now = T0 + 20 * 60_000;
    const end = await call(p, 'POST', `/v1/admin/lessons/${lessonId}/end`, { teacher_comment: '', next_lesson_at: '' });
    expect(end.status).toBe(200);
    expect(end.body.facts.lesson.teacher_trades).toBe(1);
    expect((await call(p, 'GET', `/v1/admin/lessons/${lessonId}/feed`)).body.lesson.join_code).toBeNull();
    // The public share view keeps the number (allow-list).
    const pub = await call(p, 'GET', `/v1/reports/${end.body.share_token}`, undefined, {});
    expect(pub.status).toBe(200);
    expect(pub.body.facts.lesson.teacher_trades).toBe(1);
    // The hub's after-lesson card says it, without the child's words.
    const sql = (p as any).sql as { get<T>(q: string, a?: unknown[]): T | undefined };
    const summary = sql.get<{ card: string }>('select card from ops_card_outbox where ref like ?', [`%:lcw:lesson:${lessonId}:summary`]);
    expect(summary?.card).toContain('물건 바꾸기 1번');
    expect(summary?.card).not.toContain(offer.text.toLowerCase());
    const daily = sql.get<{ card: string }>('select card from ops_card_outbox where ref like ?', ['%:lcw:student:kid-1:%']);
    expect(daily?.card).toContain('선생님과 교환 1번');
  });
});
