import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlatformDO, workerHandler, type LcwEnv } from '../platform.js';
import {
  FEEDBACK_EN,
  FEEDBACK_KO,
  LCW_SITE_ORIGIN,
  LESSON_EMPTY_GRACE_MS,
  LESSON_IDLE_CLOSE_MS,
  LESSON_SWEEP_CRON,
  TEACHER_PRESENT_MS
} from '../lesson-mode.js';
import { mergeLessonParentFacts, type LessonParentFacts } from '../parent-report.js';
import { fakeDurableStorage } from './fake-do.js';

/**
 * Abandoned lessons (Oreo lesson 11-16: the child's screen and the console went away and nobody pressed '수업 끝').
 * The cron sweep closes them as 'left without ending'; nothing reaches the guardian until the teacher sends it.
 */

const TOKEN = 'op-token-0123456789abcdef';
const ORIGIN = 'https://lcw.example';
const op = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
const T0 = Date.parse('2026-11-16T07:38:00Z'); // 16:38 KST

let now = T0;
afterEach(() => vi.restoreAllMocks());

function platform(publicOrigin: string | null = ORIGIN) {
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  return new PlatformDO(
    { storage: fakeDurableStorage() },
    { PLATFORM: undefined as never, LCW_OPERATOR_TOKEN: TOKEN, ...(publicOrigin ? { LCW_PUBLIC_ORIGIN: publicOrigin } : {}) } as LcwEnv
  );
}
let host = 'https://x';
async function call(p: PlatformDO, method: string, path: string, body?: unknown, headers: Record<string, string> = op) {
  const res = await p.fetch(new Request(`${host}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
  return { status: res.status, body: (await res.json()) as any };
}
const cron = (p: PlatformDO, c = LESSON_SWEEP_CRON) => call(p, 'POST', '/internal/cron', { cron: c }, { 'x-lcw-internal': 'cron', 'content-type': 'application/json' });
const sqlOf = (p: PlatformDO) => (p as unknown as { sql: { all<T>(q: string, a?: unknown[]): T[]; get<T>(q: string, a?: unknown[]): T | undefined } }).sql;
const count = (p: PlatformDO, q: string, a: unknown[] = []) => Number(sqlOf(p).get<{ n: number }>(q, a)?.n ?? 0);

async function addStudent(p: PlatformDO, id = 'kid-1', nickname = 'Oreo') {
  await call(p, 'POST', '/v1/admin/players', { family_id: `fam-${id}`, guardian_id: `g-${id}`, player_id: id, nickname, birth_year: 2016, level: 'L1' });
}
async function startLesson(p: PlatformDO, playerId = 'kid-1', planId?: string) {
  const s = await call(p, 'POST', '/v1/admin/lessons/start', { player_id: playerId, presence: true, ...(planId ? { plan_id: planId } : {}) });
  expect(s.status).toBe(201);
  const j = await call(p, 'POST', '/v1/join', { code: s.body.join_code }, { 'content-type': 'application/json' });
  expect(j.status).toBe(200);
  const st = { authorization: `Bearer ${j.body.student_token}`, 'content-type': 'application/json' };
  return { lessonId: s.body.lesson_id as string, st, start: s.body };
}
const say = (p: PlatformDO, st: Record<string, string>, text = 'can I have a warm honey tea') =>
  call(p, 'POST', '/v1/lesson/utterance', { target_text: 'Can I have a warm honey tea?', transcript: text, chosen_stars: 2, dur_ms: 2000 }, st);

describe('abandoned lessons close by themselves (cron sweep)', () => {
  it('both gone for 15 min: closed at the last sign of life, draft and cards made, nothing sent to the guardian', async () => {
    now = T0;
    const p = platform();
    await addStudent(p);
    const { lessonId, st } = await startLesson(p);
    await call(p, 'POST', `/v1/admin/lessons/${lessonId}/stage`, { stage_id: 'cafe_order', targets: ['Can I have a warm honey tea?'] });
    now = T0 + 2 * 60_000;
    expect((await say(p, st)).status).toBe(200);
    now = T0 + 25 * 60_000; // 17:03 KST: the last poll and the last beat
    await call(p, 'GET', '/v1/lesson/state', undefined, st);
    await call(p, 'POST', `/v1/admin/lessons/${lessonId}/presence`, { source: 'console' });
    const lastSign = now;

    // 14 minutes later: still open (the teacher may be thinking, the child may be back)
    now = lastSign + LESSON_IDLE_CLOSE_MS - 60_000;
    let r = await cron(p);
    expect(r.body).toMatchObject({ task: 'lesson_idle_sweep', ok: true, lessons: { closed: [] } });
    expect(count(p, 'select count(*) as n from lessons where ended_at is null')).toBe(1);

    now = lastSign + LESSON_IDLE_CLOSE_MS + 60_000;
    r = await cron(p);
    expect(r.body.lessons.closed).toEqual([lessonId]);
    const l = sqlOf(p).get<{ ended_at: number }>('select ended_at from lessons where id = ?', [lessonId])!;
    expect(l.ended_at).toBe(lastSign);
    // no report, no delivery, no push notice: the guardian gets nothing yet
    expect(count(p, 'select count(*) as n from reports')).toBe(0);
    expect(count(p, 'select count(*) as n from report_deliveries')).toBe(0);
    // push_outbox is made when the first notice is queued: no table is no notice
    const pushTable = count(p, "select count(*) as n from sqlite_master where type = 'table' and name = 'push_outbox'");
    expect(pushTable ? count(p, "select count(*) as n from push_outbox where kind like '%report%'") : 0).toBe(0);
    // the student token and the join code are closed
    expect((await call(p, 'GET', '/v1/lesson/state', undefined, st)).status).toBe(401);
    expect(count(p, 'select count(*) as n from lesson_joins where lesson_id = ?', [lessonId])).toBe(0);
    // the progress table runs to the last sign of life, not to the sweep
    const feed = await call(p, 'GET', `/v1/admin/lessons/${lessonId}/feed`);
    expect(feed.body.minutes).toHaveLength(26);
    expect(feed.body.lesson).toMatchObject({ end_reason: 'auto_idle', report_pending: true });
    expect(feed.body.lesson.draft_summary_ko).toContain('1번 말했고');

    // hub cards: the summary says it was auto-closed with the two CTAs, no share token anywhere
    const box = await call(p, 'GET', '/v1/admin/outbox/cards');
    const summary = box.body.cards.find((c: any) => c.ref.endsWith(`${lessonId}:summary`)).card;
    expect(summary.title).toMatch(/^⏸ LCW 수업 자동 마무리됨 · Oreo · 25분 · 말 1번 · 통과 1 · 리포트 보내기\/이어 하기$/);
    expect(summary.body).toContain('보호자에게는 아직 아무것도 가지 않았습니다');
    expect(summary.actions).toEqual([
      { type: 'open', url: `${ORIGIN}/director?auto=${lessonId}`, label: '리포트 확인·보내기' },
      { type: 'open', url: `${ORIGIN}/director?auto=${lessonId}&next=continue`, label: '이어 하기' },
      { type: 'dismiss' }
    ]);
    expect(box.body.cards.some((c: any) => c.ref === 'outsourcing:lcw:student:kid-1:2026-11-16')).toBe(true);
    expect(JSON.stringify(box.body)).not.toMatch(/share_token|\/r\//);

    // the console's first screen lists it; the resume card does not
    const live = await call(p, 'GET', '/v1/admin/lessons/live');
    expect(live.body.lessons).toEqual([]);
    expect(live.body.auto_closed).toMatchObject([{ lesson_id: lessonId, nickname: 'Oreo', ended_at: lastSign, utterances: 1, passes: 1 }]);
    const day = await call(p, 'GET', '/v1/admin/lessons?day=2026-11-16');
    expect(day.body.lessons[0]).toMatchObject({ id: lessonId, end_reason: 'auto_idle', report_pending: 1, report_path: null });

    // a second sweep changes nothing
    expect((await cron(p)).body.lessons.closed).toEqual([]);
  });

  it("the report goes out only on the teacher's send; an old console's '리포트 가져오기' gets the draft, not a send", async () => {
    now = T0;
    const p = platform();
    await addStudent(p);
    const { lessonId, st } = await startLesson(p);
    await say(p, st);
    now += LESSON_IDLE_CLOSE_MS + TEACHER_PRESENT_MS;
    await cron(p);
    const endedAt = sqlOf(p).get<{ ended_at: number }>('select ended_at from lessons where id = ?', [lessonId])!.ended_at;

    const old = await call(p, 'POST', `/v1/admin/lessons/${lessonId}/end`, {});
    expect(old.status).toBe(409);
    expect(old.body.error).toBe('auto_closed_unsent');
    expect(count(p, 'select count(*) as n from report_deliveries')).toBe(0);

    now += 3 * 3_600_000; // the teacher looks in the evening
    const sent = await call(p, 'POST', `/v1/admin/lessons/${lessonId}/end`, { teacher_comment: '잘했어요', send: true });
    expect(sent.status).toBe(200);
    expect(sent.body.report_path).toMatch(/^\/r\//);
    // the report's lesson time is the lesson's, not the evening's
    expect(sent.body.facts.lesson).toMatchObject({ ended_at: endedAt, utterances: 1 });
    expect(count(p, 'select count(*) as n from report_deliveries')).toBe(1);
    const feed = await call(p, 'GET', `/v1/admin/lessons/${lessonId}/feed`);
    expect(feed.body.lesson.report_pending).toBe(false);
    // the hub card turns into the normal 'lesson over' card in place (same ref)
    const box = await call(p, 'GET', '/v1/admin/outbox/cards');
    const summary = box.body.cards.find((c: any) => c.ref.endsWith(`${lessonId}:summary`)).card;
    expect(summary.title).toMatch(/^📚 LCW 수업 끝 · Oreo/);
    expect(summary.body).toContain('보호자 보고서 만듦');
    // gone from the console's auto box; a double tap hands back the same link
    expect((await call(p, 'GET', '/v1/admin/lessons/live')).body.auto_closed).toEqual([]);
    const again = await call(p, 'POST', `/v1/admin/lessons/${lessonId}/end`, { send: true });
    expect(again.body).toMatchObject({ report_path: sent.body.report_path, already_ended: true });
  });

  it('any sign of life keeps it open: the child polling, the console beating, an answer', async () => {
    now = T0;
    const p = platform();
    await addStudent(p);
    const { lessonId, st } = await startLesson(p);
    for (let i = 0; i < 6; i++) {
      now += 10 * 60_000;
      if (i % 3 === 0) await call(p, 'GET', '/v1/lesson/state', undefined, st);
      else if (i % 3 === 1) await call(p, 'POST', `/v1/admin/lessons/${lessonId}/presence`, { source: 'console' });
      else await say(p, st);
      expect((await cron(p)).body.lessons.closed).toEqual([]);
    }
    expect(count(p, 'select count(*) as n from lessons where ended_at is null')).toBe(1);
  });

  it('smoke students close too but make no hub card; every cron sweeps, the hourly tasks still run', async () => {
    now = T0;
    const p = platform();
    await addStudent(p, 'smoke-auto-1', 'Smoky');
    const { lessonId, st } = await startLesson(p, 'smoke-auto-1');
    await say(p, st);
    now += LESSON_IDLE_CLOSE_MS + TEACHER_PRESENT_MS;
    const r = await cron(p, '0 * * * *');
    expect(r.body.task).toBe('hourly_quota_rollup');
    expect(r.body.lessons.closed).toEqual([lessonId]);
    expect(r.body.lessons.cards).toEqual([{ lesson_id: lessonId, card: 'test' }]);
    expect((await call(p, 'GET', '/v1/admin/outbox/cards')).body.cards).toEqual([]);
    expect((await call(p, 'GET', '/v1/admin/lessons/live')).body.auto_closed).toEqual([]);
    expect((await call(p, 'GET', '/v1/admin/lessons/live?include_test=1')).body.auto_closed).toHaveLength(1);
  });

  it('the operator can look first (dry run) and run the sweep on demand', async () => {
    now = T0;
    const p = platform();
    await addStudent(p);
    const { lessonId, st } = await startLesson(p);
    await say(p, st);
    now += LESSON_IDLE_CLOSE_MS + TEACHER_PRESENT_MS;
    const dry = await call(p, 'POST', '/v1/admin/lessons/sweep-idle', { dry_run: true });
    expect(dry.body).toMatchObject({ open: 1, closed: [], dry_run: true, idle: [{ lesson_id: lessonId, test: false }] });
    expect(count(p, 'select count(*) as n from lessons where ended_at is null')).toBe(1);
    expect((await call(p, 'POST', '/v1/admin/lessons/sweep-idle', {}, { 'content-type': 'application/json' })).status).toBe(401);
    expect((await call(p, 'POST', '/v1/admin/lessons/sweep-idle', {})).body.closed).toEqual([lessonId]);
  });
});

describe('review of PR 129: the card never goes missing, old and empty lessons are not to-dos', () => {
  const cardActions = async (p: PlatformDO, lessonId: string) =>
    (await call(p, 'GET', '/v1/admin/outbox/cards')).body.cards.find((c: any) => c.ref.endsWith(`${lessonId}:summary`))?.card.actions ?? null;

  it('no LCW_PUBLIC_ORIGIN on the deploy: the card links to where the lesson was started (and the run lists it)', async () => {
    now = T0;
    host = 'https://lcw.started-here';
    const p = platform(null);
    await addStudent(p);
    const { lessonId, st } = await startLesson(p);
    await say(p, st);
    host = 'https://x';
    now += LESSON_IDLE_CLOSE_MS + TEACHER_PRESENT_MS;
    const r = await cron(p);
    expect(r.body.lessons.cards).toEqual([{ lesson_id: lessonId, card: 'sent' }]);
    expect((await cardActions(p, lessonId))[0].url).toBe(`https://lcw.started-here/director?auto=${lessonId}`);
    const run = sqlOf(p).get<{ ok: number; detail: string }>("select ok, detail from ops_runs where task = 'lesson_idle_sweep' order by rowid desc limit 1")!;
    expect(Number(run.ok)).toBe(1);
    expect(JSON.parse(run.detail).cards).toEqual([{ lesson_id: lessonId, card: 'sent' }]);
  });

  it('no origin anywhere (a lesson from before this release): the production site', async () => {
    now = T0;
    const p = platform(null);
    await addStudent(p);
    const { lessonId, st } = await startLesson(p);
    await say(p, st);
    sqlOf(p).all('delete from lesson_origins');
    now += LESSON_IDLE_CLOSE_MS + TEACHER_PRESENT_MS;
    await cron(p);
    expect((await cardActions(p, lessonId))[0].url).toBe(`${LCW_SITE_ORIGIN}/director?auto=${lessonId}`);
  });

  it('a lesson left open for a month closes with no card and stays out of the console box', async () => {
    now = T0 - 30 * 86_400_000;
    const p = platform();
    await addStudent(p);
    const { lessonId, st } = await startLesson(p);
    await say(p, st);
    now = T0;
    const r = await cron(p);
    expect(r.body.lessons.cards).toEqual([{ lesson_id: lessonId, card: 'stale' }]);
    expect(await cardActions(p, lessonId)).toBeNull();
    expect((await call(p, 'GET', '/v1/admin/lessons/live')).body.auto_closed).toEqual([]);
  });

  it('the child never came: open for the grace hour while the code works, then closed as empty, no card, no box row', async () => {
    now = T0;
    const p = platform();
    await addStudent(p);
    const s = await call(p, 'POST', '/v1/admin/lessons/start', { player_id: 'kid-1', presence: true });
    const lessonId = s.body.lesson_id as string;
    // the teacher closed the console right away; the child is late
    now = T0 + LESSON_EMPTY_GRACE_MS - 60_000;
    expect((await cron(p)).body.lessons.closed).toEqual([]);
    now = T0 + LESSON_EMPTY_GRACE_MS + 60_000;
    const r = await cron(p);
    expect(r.body.lessons.cards).toEqual([{ lesson_id: lessonId, card: 'empty' }]);
    expect(await cardActions(p, lessonId)).toBeNull();
    expect((await call(p, 'GET', '/v1/admin/lessons/live')).body.auto_closed).toEqual([]);
    const again = await call(p, 'POST', '/v1/admin/lessons/start', { player_id: 'kid-1', presence: true });
    expect(again.body.continues_from).toBeNull();
  });

  it('a late child within the grace hour joins and the lesson runs (the code was never closed)', async () => {
    now = T0;
    const p = platform();
    await addStudent(p);
    const s = await call(p, 'POST', '/v1/admin/lessons/start', { player_id: 'kid-1', presence: true });
    now = T0 + 40 * 60_000;
    await cron(p);
    const j = await call(p, 'POST', '/v1/join', { code: s.body.join_code }, { 'content-type': 'application/json' });
    expect(j.status).toBe(200);
    const st = { authorization: `Bearer ${j.body.student_token}`, 'content-type': 'application/json' };
    expect((await say(p, st)).status).toBe(200);
    now += LESSON_IDLE_CLOSE_MS - 60_000;
    expect((await cron(p)).body.lessons.closed).toEqual([]);
  });

  it("1PC '선생님 나가기': the child's screen and answers keep the lesson open; it closes 15 min after the last of them", async () => {
    now = T0;
    const p = platform();
    await addStudent(p);
    const { lessonId, st } = await startLesson(p);
    await say(p, st);
    expect((await call(p, 'POST', `/v1/admin/lessons/${lessonId}/presence/leave`, {})).status).toBe(200);
    // 40 minutes alone: the child keeps talking and the screen keeps polling
    for (let m = 1; m <= 40; m++) {
      now = T0 + m * 60_000;
      await call(p, 'GET', '/v1/lesson/state', undefined, st);
      if (m % 5 === 0) await say(p, st);
      if (m % 5 === 0) expect((await cron(p)).body.lessons.closed).toEqual([]);
    }
    const last = now;
    now = last + LESSON_IDLE_CLOSE_MS - 60_000;
    expect((await cron(p)).body.lessons.closed).toEqual([]);
    now = last + LESSON_IDLE_CLOSE_MS + 60_000;
    expect((await cron(p)).body.lessons.closed).toEqual([lessonId]);
    expect(sqlOf(p).get<{ ended_at: number }>('select ended_at from lessons where id = ?', [lessonId])!.ended_at).toBe(last);
  });

  it("1PC '선생님 나가기': a console still open on the lesson keeps it open even with the child's screen gone", async () => {
    now = T0;
    const p = platform();
    await addStudent(p);
    const { lessonId, st } = await startLesson(p);
    await say(p, st);
    await call(p, 'POST', `/v1/admin/lessons/${lessonId}/presence/leave`, {});
    for (let m = 1; m <= 30; m++) {
      now = T0 + m * 60_000;
      const b = await call(p, 'POST', `/v1/admin/lessons/${lessonId}/presence`, { source: 'console' });
      expect(b.body.left).toBe(true); // still not 'present' for the child's screen
    }
    expect((await cron(p)).body.lessons.closed).toEqual([]);
    now += LESSON_IDLE_CLOSE_MS + 60_000;
    expect((await cron(p)).body.lessons.closed).toEqual([lessonId]);
  });

  it('a possession is a sign of life', async () => {
    now = T0;
    const p = platform();
    await addStudent(p);
    const { lessonId, st } = await startLesson(p);
    await say(p, st);
    now += LESSON_IDLE_CLOSE_MS - 60_000;
    sqlOf(p).all('insert or replace into lesson_director (lesson_id, possessed_npc_id, updated_at) values (?, ?, ?)', [lessonId, 'cafe_owner', now]);
    now += 2 * 60_000;
    expect((await cron(p)).body.lessons.closed).toEqual([]);
  });
});

describe('SQL that runs on Cloudflare', () => {
  it('no compound SELECT has more than five terms (workerd refuses it; the test SQLite does not)', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const dir = fileURLToPath(new URL('..', import.meta.url));
    const offenders: string[] = [];
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.ts'))) {
      const src = readFileSync(join(dir, f), 'utf8');
      // each SQL literal (backtick or quote) on its own: count the UNION / INTERSECT / EXCEPT joints inside it
      for (const m of src.matchAll(/`[^`]*`|'[^'\n]*'|"[^"\n]*"/g)) {
        const joints = (m[0].match(/\b(union(\s+all)?|intersect|except)\s+select\b/gi) ?? []).length;
        if (joints + 1 > 5) offenders.push(`${f}: ${joints + 1} terms`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('the same student back the same day continues the auto-closed lesson', () => {
  it('starts where the child left off, one report covers both parts, the first part folds into it', async () => {
    now = T0;
    const p = platform();
    await addStudent(p);
    const first = await startLesson(p);
    await call(p, 'POST', `/v1/admin/lessons/${first.lessonId}/stage`, { stage_id: 'cafe_order', targets: ['Can I have a warm honey tea?'] });
    now += 60_000;
    await say(p, first.st);
    now += 4 * 60_000;
    await say(p, first.st);
    now += LESSON_IDLE_CLOSE_MS + TEACHER_PRESENT_MS;
    await cron(p);

    now += 30 * 60_000;
    const second = await startLesson(p, 'kid-1', first.start.plan.id);
    expect(second.start).toMatchObject({ continues_from: first.lessonId, stage_id: 'cafe_order' });
    const st2 = await call(p, 'GET', '/v1/lesson/state', undefined, second.st);
    expect(st2.body.stage_id).toBe('cafe_order');
    // while the continuation runs, the first part leaves the auto box (it is being picked up)
    expect((await call(p, 'GET', '/v1/admin/lessons/live')).body.auto_closed).toEqual([]);
    const feed = await call(p, 'GET', `/v1/admin/lessons/${second.lessonId}/feed`);
    expect(feed.body.lesson.continues_from).toBe(first.lessonId);
    now += 60_000;
    await say(p, second.st);
    now += 3 * 60_000;

    const end = await call(p, 'POST', `/v1/admin/lessons/${second.lessonId}/end`, { teacher_comment: '이어서 잘했어요' });
    expect(end.status).toBe(200);
    // both parts' answers, both parts' minutes (5 + 4), not the gap between them
    expect(end.body.facts.lesson).toMatchObject({ utterances: 3, passes: 3, duration_min: 9 });
    expect(count(p, 'select count(*) as n from report_deliveries')).toBe(1);
    // the first part shows the one report it went out in; ending it again hands that report back
    const day = await call(p, 'GET', '/v1/admin/lessons?day=2026-11-16');
    const rows = Object.fromEntries(day.body.lessons.map((l: any) => [l.id, l]));
    expect(rows[first.lessonId]).toMatchObject({ report_path: end.body.report_path, report_pending: 0 });
    const firstAgain = await call(p, 'POST', `/v1/admin/lessons/${first.lessonId}/end`, { send: true });
    expect(firstAgain.body).toMatchObject({ report_path: end.body.report_path, already_ended: true });
    // its hub card says where the report went
    const box = await call(p, 'GET', '/v1/admin/outbox/cards');
    const c1 = box.body.cards.find((c: any) => c.ref.endsWith(`${first.lessonId}:summary`)).card;
    expect(c1.body).toContain(`이어 한 수업 ${second.lessonId} 의 보고서에 합쳐 보냄`);
    expect(c1.title).toMatch(/^📚/);
  });

  it('a lesson the teacher ended, another day, or another plan: no stage carried over', async () => {
    now = T0;
    const p = platform();
    await addStudent(p);
    const a = await startLesson(p);
    await call(p, 'POST', `/v1/admin/lessons/${a.lessonId}/end`, {});
    const b = await startLesson(p);
    expect(b.start.continues_from).toBeNull();
    now += LESSON_IDLE_CLOSE_MS + TEACHER_PRESENT_MS;
    await cron(p);
    // the next KST day: a new lesson, not a continuation
    now = Date.parse('2026-11-17T00:30:00Z');
    const c = await startLesson(p);
    expect(c.start.continues_from).toBeNull();
  });
});

describe('the mic issue reaches the console (talk lane PR 122 lcw.micIssue)', () => {
  it('the state poll stores it and the feed hands it to the console; a malformed value is dropped', async () => {
    now = T0;
    const p = platform();
    await addStudent(p);
    const { lessonId, st } = await startLesson(p);
    await call(p, 'GET', `/v1/lesson/state?mic=none&mic_issue=${encodeURIComponent('denied:audio-capture|1794812345678')}`, undefined, st);
    let feed = await call(p, 'GET', `/v1/admin/lessons/${lessonId}/feed`);
    expect(feed.body.student_view).toMatchObject({ mic: 'none', mic_issue: { issue: 'denied', raw: 'audio-capture', at: 1794812345678 } });
    await call(p, 'GET', `/v1/lesson/state?mic=ok&mic_issue=${encodeURIComponent('<script>|x')}`, undefined, st);
    feed = await call(p, 'GET', `/v1/admin/lessons/${lessonId}/feed`);
    expect(feed.body.student_view).toMatchObject({ mic: 'ok', mic_issue: { issue: 'denied', raw: 'audio-capture' } });
  });
});

describe('scheduled: the 5-minute trigger carries the hourly tasks at minute 0', () => {
  it('sends the sweep at :05 and the hourly cron (which sweeps too) at :00', async () => {
    const sent: string[] = [];
    const env = {
      PLATFORM: {
        idFromName: () => 'id',
        get: () => ({
          fetch: async (_u: string, init: { body: string }) => {
            sent.push((JSON.parse(init.body) as { cron: string }).cron);
            return new Response('{}');
          }
        })
      }
    } as unknown as LcwEnv;
    await workerHandler.scheduled({ cron: LESSON_SWEEP_CRON, scheduledTime: Date.parse('2026-11-16T08:05:00Z') }, env);
    await workerHandler.scheduled({ cron: LESSON_SWEEP_CRON, scheduledTime: Date.parse('2026-11-16T09:00:00Z') }, env);
    await workerHandler.scheduled({ cron: '0 3 * * *', scheduledTime: Date.parse('2026-11-16T03:00:00Z') }, env);
    expect(sent).toEqual([LESSON_SWEEP_CRON, '0 * * * *', '0 3 * * *']);
  });
});

describe('mergeLessonParentFacts', () => {
  const part = (o: Partial<LessonParentFacts>): LessonParentFacts => ({
    lesson_day: '2026-11-16',
    lesson_number: 3,
    started_at: 0,
    ended_at: 0,
    duration_min: 0,
    utterances: 0,
    passes: 0,
    stars_total: 0,
    three_star_passes: 0,
    hintless_passes: 0,
    words_spoken: 0,
    free_words: 0,
    speaking_sec: 0,
    longest_words: 0,
    quotes: [],
    expressions: [],
    coaching_moments: 0,
    stages: [],
    summary_ko: '',
    ...o
  });
  it('adds counts, spans first start to last end, keeps limits and rebuilds the one-liner', () => {
    const a = part({ started_at: 1000, ended_at: 2000, duration_min: 5, utterances: 2, passes: 2, speaking_sec: 4, longest_words: 6, expressions: ['Can I have'], stages: [{ id: 's1', title_ko: '카페', utterances: 2, passes: 2 }], quotes: [{ text: 'A b', stars: 1, mode: 'echo', stage_title_ko: '', hintless: false }] });
    const b = part({ started_at: 9000, ended_at: 9900, duration_min: 4, utterances: 1, passes: 1, speaking_sec: 2, longest_words: 4, expressions: ['can I have.', 'Thank you'], stages: [{ id: 's1', title_ko: '카페', utterances: 1, passes: 1 }], quotes: [{ text: 'C d', stars: 3, mode: 'echo', stage_title_ko: '', hintless: true }] });
    const m = mergeLessonParentFacts([b, a])!;
    expect(m).toMatchObject({ started_at: 1000, ended_at: 9900, duration_min: 9, utterances: 3, passes: 3, speaking_sec: 6, longest_words: 6, lesson_number: 3 });
    expect(m.expressions).toEqual(['Can I have', 'Thank you']);
    expect(m.stages).toEqual([{ id: 's1', title_ko: '카페', utterances: 3, passes: 3 }]);
    expect(m.quotes.map((q) => q.text)).toEqual(['A b', 'C d']);
    expect(m.summary_ko).toBe('이번 수업에서 영어로 3번 말했고 그중 3번 통과했습니다. 직접 말한 시간은 6초입니다.');
    expect(mergeLessonParentFacts([])).toBeNull();
  });
});

describe('review #121 follow-up: a resend of an answer stored before feedback_en gets the English line', () => {
  it('finds feedback_en from the stored Korean line', async () => {
    now = T0;
    const p = platform();
    await addStudent(p);
    const { lessonId, st } = await startLesson(p);
    const sql = (p as unknown as { sql: { run(q: string, a?: unknown[]): void } }).sql;
    const old = { pass: true, score: 1, stars: 3, feedback_ko: FEEDBACK_KO.perfect, coins_total: 30 };
    sql.run('insert into lesson_utterance_clients (lesson_id, client_id, response, at) values (?, ?, ?, ?)', [lessonId, 'c-old-0001', JSON.stringify(old), now]);
    const r = await call(p, 'POST', '/v1/lesson/utterance', { target_text: 'Hi', transcript: 'hi', client_id: 'c-old-0001' }, st);
    expect(r.body).toMatchObject({ replayed: true, feedback_ko: FEEDBACK_KO.perfect, feedback_en: FEEDBACK_EN.perfect });
  });
});
