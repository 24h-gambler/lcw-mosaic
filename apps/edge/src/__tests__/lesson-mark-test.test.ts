import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlatformDO, type LcwEnv } from '../platform.js';
import { COINS_PER_STAR, LESSON_IDLE_CLOSE_MS, LESSON_SWEEP_CRON, TEACHER_PRESENT_MS } from '../lesson-mode.js';
import { fakeDurableStorage } from './fake-do.js';
import { reportClips } from '../voice.js';

/**
 * 11-19: someone ran a session on Oreo's real id at 15:55 (no teacher, 9 of 11 lines typed, the plan he had finished).
 * The sweep closed it as his abandoned lesson; his 17:30 lesson would continue it and one report would cover both.
 * mark-test moves that session to a test id, takes its coins back off and writes the report it was folded into again
 * under the same link and dates. Nothing is deleted.
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
type Sql = { all<T>(q: string, a?: unknown[]): T[]; get<T>(q: string, a?: unknown[]): T | undefined; run(q: string, a?: unknown[]): void };
const sqlOf = (p: PlatformDO) => (p as unknown as { sql: Sql }).sql;
const count = (p: PlatformDO, q: string, a: unknown[] = []) => Number(sqlOf(p).get<{ n: number }>(q, a)?.n ?? 0);
const balance = (p: PlatformDO, id = 'kid-1') => (p as unknown as { coinBalance(id: string): number }).coinBalance(id);
/** Every row of the tables mark-test may touch, to prove a dry run writes nothing. */
const dump = (p: PlatformDO) =>
  JSON.stringify(
    ['lessons', 'utterances', 'expressions', 'memory_cards', 'voice_clips', 'student_tokens', 'lesson_joins', 'lesson_auto_close', 'reports', 'report_deliveries', 'ops_card_outbox', 'push_outbox'].map(
      (t) => {
        try {
          return sqlOf(p).all(`select * from ${t} order by rowid`);
        } catch {
          return null;
        }
      }
    )
  ) + balance(p);

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

/** 11-16: his real first lesson, one line, ended by the teacher. */
async function realFirstLesson(p: PlatformDO) {
  now = Date.parse('2026-11-16T07:38:00Z');
  const r = await startLesson(p);
  await say(p, r.st);
  now += 60_000;
  await call(p, 'POST', `/v1/admin/lessons/${r.lessonId}/end`, {});
  return r;
}
/** The 15:55 session: lines in the cafe (or none: the screen only polled), then everyone gone; the sweep closes it. */
async function testSession(p: PlatformDO, lines = 2) {
  now = T0;
  const a = await startLesson(p);
  await call(p, 'POST', `/v1/admin/lessons/${a.lessonId}/stage`, { stage_id: 'cafe_order', targets: ['Can I have a warm honey tea?'] });
  await call(p, 'GET', '/v1/lesson/state', undefined, a.st);
  for (let i = 0; i < lines; i++) {
    now += 60_000;
    expect((await say(p, a.st, i % 2 ? 'I want the red helmet.' : 'Can I have a warm honey tea?')).status).toBe(200);
  }
  now += LESSON_IDLE_CLOSE_MS + TEACHER_PRESENT_MS;
  expect((await cron(p)).body.lessons.closed).toEqual([a.lessonId]);
  return a;
}
const summaryRef = (lessonId: string) => `outsourcing:lcw:lesson:${lessonId}:summary`;
const outboxCard = (p: PlatformDO, ref: string) => JSON.parse(sqlOf(p).get<{ card: string }>('select card from ops_card_outbox where ref = ?', [ref])!.card);

describe('a test session on a real child is marked and leaves everything of his', () => {
  it('after his lesson continued it: same link, same dates, his numbers alone; coins, records, box, card', async () => {
    const p = platform();
    await addStudent(p);
    await realFirstLesson(p);
    const a = await testSession(p);
    // a voice clip of the session: it stays with the child (a test id has no voice consent; the 03:00 retention would purge it)
    const clipUtt = sqlOf(p).get<{ id: string }>('select id from utterances where session_id = ? order by created_at limit 1', [a.lessonId])!.id;
    sqlOf(p).run("insert into voice_clips (id, utterance_id, player_id, r2_key, mime, bytes, created_at) values ('vc-1', ?, 'kid-1', 'voice/kid-1/vc-1.webm', 'audio/webm', 10, ?)", [clipUtt, now]);
    const coinsA = Number(sqlOf(p).get<{ s: number }>('select coalesce(sum(stars), 0) as s from utterances where session_id = ?', [a.lessonId])!.s) * COINS_PER_STAR;
    expect(coinsA).toBeGreaterThan(0);

    // 17:30: his real lesson picks the session up (the same-day rule) and ends with one report over both parts
    now = Date.parse('2026-11-19T08:30:00Z');
    const b = await startLesson(p);
    expect(b.start.continues_from).toBe(a.lessonId);
    now += 60_000;
    await say(p, b.st);
    now += 60_000;
    const end = await call(p, 'POST', `/v1/admin/lessons/${b.lessonId}/end`, { teacher_comment: '잘했어요', next_lesson_at: '11-26' });
    expect(end.status).toBe(200);
    expect(end.body.facts.lesson.utterances).toBe(3);
    const weeklyBefore = end.body.facts.total_valid_utterances;
    // the guardian opened the link at 19:40
    now = Date.parse('2026-11-19T10:40:00Z');
    const token = String(end.body.report_path).slice(3);
    expect((await call(p, 'GET', `/v1/reports/${token}`, undefined, {})).status).toBe(200);
    const delBefore = sqlOf(p).get('select * from report_deliveries where report_id = ?', [`rep-${b.lessonId}`]);
    const repBefore = sqlOf(p).get<{ created_at: number; opened_at: number }>('select created_at, opened_at from reports where id = ?', [`rep-${b.lessonId}`])!;
    expect(repBefore.opened_at).toBe(now);
    const coinsBefore = balance(p);
    const pushBefore = JSON.stringify(sqlOf(p).all('select * from push_outbox order by rowid'));

    // a look first: nothing at all moves
    const snap = dump(p);
    const dry = await call(p, 'POST', `/v1/admin/lessons/${a.lessonId}/mark-test`, { note: 'lane test on a real id', dry_run: true });
    expect(dry.body).toMatchObject({
      dry_run: true,
      player_id: 'kid-1',
      test_player_id: `smoke-test-${a.lessonId}`,
      report_exists: true,
      moved: { coins: coinsA, folded_into: b.lessonId, voice_clips_kept: ['vc-1'] }
    });
    expect(dry.body.moved.utterances).toHaveLength(2);
    expect(dump(p)).toBe(snap);

    // the next morning
    now = Date.parse('2026-11-20T00:00:00Z');
    const r = await call(p, 'POST', `/v1/admin/lessons/${a.lessonId}/mark-test`, { note: 'lane test on a real id' });
    expect(r.status).toBe(200);
    expect(r.body.report).toEqual({ rebuilt: b.lessonId, report_path: end.body.report_path });
    // his records hold only his own lessons now
    expect(count(p, "select count(*) as n from utterances where player_id = 'kid-1'")).toBe(2);
    expect(count(p, 'select count(*) as n from utterances where player_id = ?', [`smoke-test-${a.lessonId}`])).toBe(2);
    expect(sqlOf(p).get<{ player_id: string }>('select player_id from lessons where id = ?', [a.lessonId])!.player_id).toBe(`smoke-test-${a.lessonId}`);
    expect(count(p, "select count(*) as n from memory_cards where player_id = 'kid-1' and utterance_id in (select id from utterances where session_id = ?)", [a.lessonId])).toBe(0);
    expect(sqlOf(p).get<{ player_id: string }>("select player_id from voice_clips where id = 'vc-1'")!.player_id).toBe('kid-1');
    // ...and never in his weekly report's clips (the line it hangs off is the test id's now)
    const weekly = { player_id: 'kid-1', kind: 'weekly', ref_id: 'w', created_at: now };
    const deps = { sql: sqlOf(p) as never, randomBytes: (n: number) => new Uint8Array(n) };
    expect((await reportClips(deps, weekly, now)).map((x) => x.id)).toEqual([]);
    // the coins the session earned come off his balance (reversal rows, nothing deleted)
    expect(balance(p)).toBe(coinsBefore - coinsA);
    // the same link and delivery, the same dates; no second notice
    expect(sqlOf(p).get('select * from report_deliveries where report_id = ?', [`rep-${b.lessonId}`])).toEqual(delBefore);
    expect(sqlOf(p).get('select created_at, opened_at from reports where id = ?', [`rep-${b.lessonId}`])).toEqual(repBefore);
    expect(JSON.stringify(sqlOf(p).all('select * from push_outbox order by rowid'))).toBe(pushBefore);
    // the numbers of his lesson alone: the lesson, the week, and 'previous' is his 11-16 lesson, not the session
    const facts = JSON.parse(sqlOf(p).get<{ facts: string }>('select facts from reports where id = ?', [`rep-${b.lessonId}`])!.facts);
    expect(facts.lesson.utterances).toBe(1);
    expect(facts.lesson.duration_min).toBeLessThan(10);
    expect(facts.total_valid_utterances).toBe(weeklyBefore - 2);
    expect(facts.lesson.previous).toMatchObject({ utterances: 1 });
    // the session's hub card says it was a test, once, without keep and without a send button
    const card = outboxCard(p, summaryRef(a.lessonId));
    expect(card.title).toMatch(/^🧪 LCW 시험 세션으로 표시함 · Oreo · 2026-11-19 15:55/);
    expect(card.keep).toBeUndefined();
    expect(JSON.stringify(card.actions)).not.toContain('auto=');
    // never in his box, his day list or a continuation again
    expect((await call(p, 'GET', '/v1/admin/lessons/live')).body.auto_closed).toEqual([]);
    const day = await call(p, 'GET', '/v1/admin/lessons?day=2026-11-19');
    expect(day.body.lessons.map((l: any) => l.id)).toEqual([b.lessonId]);
    // the record of what moved and of the report as it was; a second call changes nothing
    const mark = sqlOf(p).get<{ player_id: string; moved: string }>('select player_id, moved from lesson_test_marks where lesson_id = ?', [a.lessonId])!;
    expect(mark.player_id).toBe('kid-1');
    expect(JSON.parse(mark.moved)).toMatchObject({
      report_done: true,
      card_done: true,
      report_before: { created_at: repBefore.created_at, delivery: { sent_at: (delBefore as any).sent_at, opened_at: (delBefore as any).opened_at } }
    });
    expect(JSON.parse(JSON.parse(mark.moved).report_before.facts).lesson.utterances).toBe(3);
    const after = dump(p);
    const again = await call(p, 'POST', `/v1/admin/lessons/${a.lessonId}/mark-test`, { note: 'again' });
    expect(again.body).toMatchObject({ already: true, player_id: 'kid-1', test_player_id: `smoke-test-${a.lessonId}`, report: null });
    expect(dump(p)).toBe(after);
  });

  it('a rebuild that did not get through is finished by calling again', async () => {
    const p = platform();
    await addStudent(p);
    const a = await testSession(p);
    now = Date.parse('2026-11-19T08:30:00Z');
    const b = await startLesson(p);
    await say(p, b.st);
    const end = await call(p, 'POST', `/v1/admin/lessons/${b.lessonId}/end`, {});
    expect((await call(p, 'POST', `/v1/admin/lessons/${a.lessonId}/mark-test`, { note: 'x' })).body.report.rebuilt).toBe(b.lessonId);
    // as if the rebuild had failed: the record says not done, the report still has the session in it
    const rec = JSON.parse(sqlOf(p).get<{ moved: string }>('select moved from lesson_test_marks where lesson_id = ?', [a.lessonId])!.moved);
    sqlOf(p).run('update lesson_test_marks set moved = ? where lesson_id = ?', [JSON.stringify({ ...rec, report_done: false }), a.lessonId]);
    sqlOf(p).run('update reports set facts = ? where id = ?', [rec.report_before.facts, `rep-${b.lessonId}`]);
    // and as if it broke between the rewrite and the restore: the delivery row shows the rewrite's time
    sqlOf(p).run('update report_deliveries set sent_at = ? where report_id = ?', [now + 999, `rep-${b.lessonId}`]);
    const coins = balance(p);
    const again = await call(p, 'POST', `/v1/admin/lessons/${a.lessonId}/mark-test`, { note: 'x' });
    expect(again.body).toMatchObject({ already: true, report: { rebuilt: b.lessonId, report_path: end.body.report_path } });
    expect(JSON.parse(sqlOf(p).get<{ facts: string }>('select facts from reports where id = ?', [`rep-${b.lessonId}`])!.facts).lesson.utterances).toBe(1);
    expect(balance(p)).toBe(coins); // the coin reversal is not taken twice
    expect(sqlOf(p).get<{ sent_at: number }>('select sent_at from report_deliveries where report_id = ?', [`rep-${b.lessonId}`])!.sent_at).toBe(
      rec.report_before.delivery.sent_at
    );
  });

  it('marked before his lesson: no continuation, no box row, the card says test, the hourly resend leaves it', async () => {
    const p = platform();
    await addStudent(p);
    const a = await testSession(p);
    const ref = summaryRef(a.lessonId);
    expect(outboxCard(p, ref).keep).toBe('until_acted');
    expect((await call(p, 'POST', `/v1/admin/lessons/${a.lessonId}/mark-test`, { note: 'lane test' })).status).toBe(200);
    expect(outboxCard(p, ref).title).toMatch(/^🧪/);
    expect((await call(p, 'GET', '/v1/admin/lessons/live')).body.auto_closed).toEqual([]);
    const was = sqlOf(p).get<{ updated_at: number }>('select updated_at from ops_card_outbox where ref = ?', [ref])!.updated_at;
    now = Date.parse('2026-11-19T09:00:00Z'); // the hourly cron
    await cron(p, '0 * * * *');
    expect(sqlOf(p).get<{ updated_at: number }>('select updated_at from ops_card_outbox where ref = ?', [ref])!.updated_at).toBe(was);
    now = Date.parse('2026-11-19T09:30:00Z');
    const b = await startLesson(p);
    expect(b.start.continues_from).toBeNull();
    expect(b.start.stage_id).toBe(b.start.plan.stages[0].id);
  });

  it('marked while his continuing lesson is still running: his end joins only his own part', async () => {
    const p = platform();
    await addStudent(p);
    const a = await testSession(p);
    now = Date.parse('2026-11-19T08:30:00Z');
    const b = await startLesson(p);
    expect(b.start.continues_from).toBe(a.lessonId);
    await say(p, b.st);
    expect((await call(p, 'POST', `/v1/admin/lessons/${a.lessonId}/mark-test`, { note: 'x' })).body.report).toBeNull();
    now += 60_000;
    const end = await call(p, 'POST', `/v1/admin/lessons/${b.lessonId}/end`, {});
    expect(end.body.facts.lesson.utterances).toBe(1);
    expect(sqlOf(p).get<{ folded_into: string | null }>('select folded_into from lesson_auto_close where lesson_id = ?', [a.lessonId])!.folded_into).toBeNull();
  });

  it('a session with no lines (the screen only polled) marks fine', async () => {
    const p = platform();
    await addStudent(p);
    const a = await testSession(p, 0);
    const r = await call(p, 'POST', `/v1/admin/lessons/${a.lessonId}/mark-test`, { note: 'x' });
    expect(r.status).toBe(200);
    expect(r.body.moved).toMatchObject({ utterances: [], coins: 0, voice_clips_kept: [] });
  });

  it('refuses a live lesson, a test student, a lesson whose own report went out; note required; operator only', async () => {
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
    expect((await call(p, 'POST', `/v1/admin/lessons/${live.lessonId}/mark-test`, { note: 'x' }, { 'content-type': 'application/json' })).status).toBe(401);
  });
});
