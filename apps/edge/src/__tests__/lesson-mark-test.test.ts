import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlatformDO, type LcwEnv } from '../platform.js';
import { COINS_PER_STAR, LESSON_IDLE_CLOSE_MS, LESSON_SWEEP_CRON, TEACHER_PRESENT_MS } from '../lesson-mode.js';
import { fakeDurableStorage } from './fake-do.js';

/**
 * 11-19: someone ran a session on Oreo's real id at 15:55 (no teacher, 9 of 11 lines typed, the plan he had finished).
 * The sweep closed it as his abandoned lesson; his 17:30 lesson would continue it and one report would cover both.
 * mark-test moves that session to a test id, takes its coins back off and writes the report it was folded into again
 * under the same link. Nothing is deleted.
 */

const TOKEN = 'op-token-0123456789abcdef';
const op = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
const T0 = Date.parse('2026-11-19T06:55:00Z'); // 15:55 KST
let now = T0;
afterEach(() => vi.restoreAllMocks());

function platform() {
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  return new PlatformDO({ storage: fakeDurableStorage() }, { PLATFORM: undefined as never, LCW_OPERATOR_TOKEN: TOKEN, LCW_PUBLIC_ORIGIN: 'https://lcw.example' } as LcwEnv);
}
async function call(p: PlatformDO, method: string, path: string, body?: unknown, headers: Record<string, string> = op) {
  const res = await p.fetch(new Request(`https://x${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
  return { status: res.status, body: (await res.json()) as any };
}
const cron = (p: PlatformDO, c = LESSON_SWEEP_CRON) => call(p, 'POST', '/internal/cron', { cron: c }, { 'x-lcw-internal': 'cron', 'content-type': 'application/json' });
const sqlOf = (p: PlatformDO) => (p as unknown as { sql: { all<T>(q: string, a?: unknown[]): T[]; get<T>(q: string, a?: unknown[]): T | undefined } }).sql;
const count = (p: PlatformDO, q: string, a: unknown[] = []) => Number(sqlOf(p).get<{ n: number }>(q, a)?.n ?? 0);
const balance = (p: PlatformDO, id = 'kid-1') => (p as unknown as { coinBalance(id: string): number }).coinBalance(id);

async function addStudent(p: PlatformDO, id = 'kid-1', nickname = 'Oreo') {
  await call(p, 'POST', '/v1/admin/players', { family_id: `fam-${id}`, guardian_id: `g-${id}`, player_id: id, nickname, birth_year: 2016, level: 'L1' });
}
async function startLesson(p: PlatformDO, playerId = 'kid-1') {
  const s = await call(p, 'POST', '/v1/admin/lessons/start', { player_id: playerId, presence: true });
  expect(s.status).toBe(201);
  const j = await call(p, 'POST', '/v1/join', { code: s.body.join_code }, { 'content-type': 'application/json' });
  const st = { authorization: `Bearer ${j.body.student_token}`, 'content-type': 'application/json' };
  return { lessonId: s.body.lesson_id as string, st, start: s.body };
}
const say = (p: PlatformDO, st: Record<string, string>, target = 'Can I have a warm honey tea?') =>
  call(p, 'POST', '/v1/lesson/utterance', { target_text: target, transcript: target.toLowerCase(), chosen_stars: 2, dur_ms: 2000 }, st);

/** The 15:55 session: two answers in the cafe, then everyone gone; the sweep closes it as Oreo's abandoned lesson. */
async function testSession(p: PlatformDO) {
  now = T0;
  const a = await startLesson(p);
  await call(p, 'POST', `/v1/admin/lessons/${a.lessonId}/stage`, { stage_id: 'cafe_order', targets: ['Can I have a warm honey tea?'] });
  now += 60_000;
  expect((await say(p, a.st)).status).toBe(200);
  now += 60_000;
  expect((await say(p, a.st, 'I want the red helmet.')).status).toBe(200);
  now += LESSON_IDLE_CLOSE_MS + TEACHER_PRESENT_MS;
  expect((await cron(p)).body.lessons.closed).toEqual([a.lessonId]);
  return a;
}

describe('a test session on a real child is marked and leaves everything of his', () => {
  it('after his lesson continued it: the report is written again without it under the same link; coins, records, box', async () => {
    const p = platform();
    await addStudent(p);
    const a = await testSession(p);
    const coinsA = Number(sqlOf(p).get<{ s: number }>('select coalesce(sum(stars), 0) as s from utterances where session_id = ?', [a.lessonId])!.s) * COINS_PER_STAR;
    expect(coinsA).toBeGreaterThan(0);

    // 17:30: his real lesson picks the session up (today's rule) and ends with one report over both parts
    now = Date.parse('2026-11-19T08:30:00Z');
    const b = await startLesson(p);
    expect(b.start.continues_from).toBe(a.lessonId);
    now += 60_000;
    await say(p, b.st);
    now += 60_000;
    const end = await call(p, 'POST', `/v1/admin/lessons/${b.lessonId}/end`, { teacher_comment: '잘했어요', next_lesson_at: '11-26' });
    expect(end.status).toBe(200);
    expect(end.body.facts.lesson.utterances).toBe(3);
    const sentAt = sqlOf(p).get<{ sent_at: number }>('select sent_at from report_deliveries where report_id = ?', [`rep-${b.lessonId}`])!.sent_at;
    const before = balance(p);

    // a look first: nothing moves
    const dry = await call(p, 'POST', `/v1/admin/lessons/${a.lessonId}/mark-test`, { note: 'lane test on a real id', dry_run: true });
    expect(dry.body).toMatchObject({ dry_run: true, player_id: 'kid-1', test_player_id: `smoke-test-${a.lessonId}`, moved: { coins: coinsA, folded_into: b.lessonId } });
    expect(dry.body.moved.utterances).toHaveLength(2);
    expect(count(p, "select count(*) as n from utterances where player_id = 'kid-1'")).toBe(3);

    now += 60 * 60_000;
    const r = await call(p, 'POST', `/v1/admin/lessons/${a.lessonId}/mark-test`, { note: 'lane test on a real id' });
    expect(r.status).toBe(200);
    expect(r.body.report).toEqual({ rebuilt: b.lessonId, report_path: end.body.report_path });
    // his records hold only his own lesson now
    expect(count(p, "select count(*) as n from utterances where player_id = 'kid-1'")).toBe(1);
    expect(count(p, 'select count(*) as n from utterances where player_id = ?', [`smoke-test-${a.lessonId}`])).toBe(2);
    expect(sqlOf(p).get<{ player_id: string }>('select player_id from lessons where id = ?', [a.lessonId])!.player_id).toBe(`smoke-test-${a.lessonId}`);
    expect(count(p, "select count(*) as n from memory_cards where player_id = 'kid-1' and utterance_id in (select id from utterances where session_id = ?)", [a.lessonId])).toBe(0);
    // the coins the session earned come off his balance (reversal rows, nothing deleted)
    expect(balance(p)).toBe(before - coinsA);
    // the same link, the same delivery, the numbers of his lesson alone
    expect(count(p, 'select count(*) as n from report_deliveries')).toBe(1);
    expect(sqlOf(p).get<{ sent_at: number }>('select sent_at from report_deliveries where report_id = ?', [`rep-${b.lessonId}`])!.sent_at).toBe(sentAt);
    const token = String(end.body.report_path).slice(3);
    const rep = await call(p, 'GET', `/v1/reports/${token}`, undefined, {});
    expect(rep.status).toBe(200);
    const facts = (rep.body.facts ?? rep.body.report?.facts) as any;
    expect(facts.lesson.utterances).toBe(1);
    expect(facts.lesson.duration_min).toBeLessThan(10); // not 15:55 to 17:32
    // and the test session is not his 'previous lesson' either
    expect(facts.lesson.previous ?? null).toBeNull();
    expect(sqlOf(p).get<{ folded_into: string | null }>('select folded_into from lesson_auto_close where lesson_id = ?', [a.lessonId])!.folded_into).toBeNull();
    // never in his box, his day list or a continuation again
    expect((await call(p, 'GET', '/v1/admin/lessons/live')).body.auto_closed).toEqual([]);
    const day = await call(p, 'GET', '/v1/admin/lessons?day=2026-11-19');
    expect(day.body.lessons.map((l: any) => l.id)).toEqual([b.lessonId]);
    // the record of what moved, and a second call changes nothing
    const again = await call(p, 'POST', `/v1/admin/lessons/${a.lessonId}/mark-test`, { note: 'again' });
    expect(again.body).toMatchObject({ already: true, player_id: 'kid-1', test_player_id: `smoke-test-${a.lessonId}` });
    expect(balance(p)).toBe(before - coinsA);
  });

  it('marked before his lesson: no continuation, no box row, and the hourly resend writes no card for it', async () => {
    const p = platform();
    await addStudent(p);
    const a = await testSession(p);
    const ref = `outsourcing:lcw:lesson:${a.lessonId}:summary`;
    expect(count(p, 'select count(*) as n from ops_card_outbox where ref = ?', [ref])).toBe(1);
    expect((await call(p, 'POST', `/v1/admin/lessons/${a.lessonId}/mark-test`, { note: 'lane test' })).status).toBe(200);
    expect((await call(p, 'GET', '/v1/admin/lessons/live')).body.auto_closed).toEqual([]);
    const card = () => sqlOf(p).get<{ updated_at: number }>('select updated_at from ops_card_outbox where ref = ?', [ref])!.updated_at;
    const was = card();
    now = Date.parse('2026-11-19T09:00:00Z'); // the hourly cron
    await cron(p, '0 * * * *');
    expect(card()).toBe(was);
    now = Date.parse('2026-11-19T08:30:00Z') + 3_600_000;
    const b = await startLesson(p);
    expect(b.start.continues_from).toBeNull();
    expect(b.start.stage_id).toBe(b.start.plan.stages[0].id);
  });

  it('refuses a live lesson, a test student, a lesson whose own report went out; dry run and note are checked', async () => {
    const p = platform();
    await addStudent(p);
    await addStudent(p, 'smoke-x', 'Smokey');
    now = T0;
    const live = await startLesson(p);
    expect((await call(p, 'POST', `/v1/admin/lessons/${live.lessonId}/mark-test`, { note: 'x' })).body.error).toBe('lesson_live');
    expect((await call(p, 'POST', `/v1/admin/lessons/${live.lessonId}/mark-test`, {})).status).toBe(400);
    await say(p, live.st);
    await call(p, 'POST', `/v1/admin/lessons/${live.lessonId}/end`, {});
    expect((await call(p, 'POST', `/v1/admin/lessons/${live.lessonId}/mark-test`, { note: 'x' })).body.error).toBe('report_sent');
    const smoke = await startLesson(p, 'smoke-x');
    await call(p, 'POST', `/v1/admin/lessons/${smoke.lessonId}/end`, {});
    expect((await call(p, 'POST', `/v1/admin/lessons/${smoke.lessonId}/mark-test`, { note: 'x' })).body.error).toBe('already_test_student');
    expect((await call(p, 'POST', '/v1/admin/lessons/les-none/mark-test', { note: 'x' })).status).toBe(404);
    // operator only
    expect((await call(p, 'POST', `/v1/admin/lessons/${live.lessonId}/mark-test`, { note: 'x' }, { 'content-type': 'application/json' })).status).toBe(401);
  });
});
