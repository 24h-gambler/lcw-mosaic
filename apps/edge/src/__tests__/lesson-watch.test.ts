import { describe, expect, it } from 'vitest';
// The live-lesson watch tool (tools/lesson-watch.mjs): importing it touches no token and no disk.
import {
  CARD_IMPORTANCE,
  TEST_CARD_IMPORTANCE,
  WATCH_LIMITS,
  alertCard,
  alertRef,
  checkLesson,
  maskUrl,
  standingAlerts,
  summaryCard,
  tailVerdict
} from '../../../../tools/lesson-watch.mjs';

const now = Date.parse('2026-11-16T15:30:00+09:00');
const lesson = { lesson_id: 'les-1', player_id: 'kid-1', plan_id: 'first_lesson_v1', stage_id: 'cafe_order', started_at: now - 30 * 60_000, stage_started_at: now - 5 * 60_000 };
const feed = (sv: Record<string, unknown>, utterances = 4) => ({
  status: 200,
  body: { lesson: { stage_id: 'cafe_order' }, live: { utterances, passes: 3, stars_total: 6 }, student_view: sv }
});

describe('live-lesson watch (tools/lesson-watch.mjs)', () => {
  it('a healthy lesson: a summary row with counts only, no alert', () => {
    const { row, alerts } = checkLesson(
      lesson,
      feed({ connected: true, last_seen_at: now - 2_000, scene_id: 'honey_cafe', expected_scene_id: 'honey_cafe', ui: '3d', last_utterance: { at: now - 40_000, transcript: 'secret words', stars: 2 } }),
      now,
      1
    );
    expect(alerts).toEqual([]);
    expect(row).toMatchObject({ stage: 'cafe_order', utterances: 4, new_utterances: 3, last_answer_s: 40, student_connected: true, lesson_min: 30, stage_min: 5 });
    // nothing a child said goes into the log row
    expect(JSON.stringify(row)).not.toContain('secret words');
  });

  it('alerts when the student screen stops polling, sits in another scene, or no answer comes for 15 minutes', () => {
    const { alerts } = checkLesson(
      lesson,
      feed({ connected: false, last_seen_at: now - WATCH_LIMITS.studentGoneMs - 1_000, scene_id: 'plaza', expected_scene_id: 'honey_cafe', last_utterance: { at: now - WATCH_LIMITS.quietMs - 1_000 } }),
      now,
      undefined
    );
    expect(alerts.map((a) => a.key)).toEqual(['student_gone', 'scene', 'quiet']);
    // a lesson in its first minutes is not "quiet" yet
    const young = { ...lesson, started_at: now - 5 * 60_000 };
    expect(checkLesson(young, feed({ connected: true, last_seen_at: now }), now, undefined).alerts).toEqual([]);
  });

  it('alert cards: one ref per (lesson, kind), P2, no push field, and nothing a child said', () => {
    const { alerts } = checkLesson(
      lesson,
      feed({ connected: false, last_seen_at: now - WATCH_LIMITS.studentGoneMs - 1_000, last_utterance: { at: now - 1_000, transcript: 'secret words' } }),
      now,
      undefined
    );
    expect(alerts).toEqual([expect.objectContaining({ key: 'student_gone', lesson: 'les-1' })]);
    const first = alerts[0]!;
    const card = alertCard(first, { base: 'https://lcw.example', dayStr: '20261116', at: new Date(now).toISOString(), out: 'Z:/tmp/lcw-watch' });
    expect(card).toMatchObject({ source: 'outsourcing', ref: 'outsourcing:lcw:watch:les-1:student_gone', importance: CARD_IMPORTANCE });
    expect(CARD_IMPORTANCE).toBe(2);
    expect(TEST_CARD_IMPORTANCE).toBe(1);
    expect(card.actions[0]).toEqual({ type: 'open', url: 'https://lcw.example/director', label: '디렉터 콘솔 열기' });
    expect(card).not.toHaveProperty('priority');
    expect(JSON.stringify(card)).not.toContain('secret words');
    // site-wide alerts get a ref per day; the same alert twice is the same ref
    expect(alertRef({ key: 'http', msg: 'x' }, '20261116')).toBe('outsourcing:lcw:watch:site-20261116:http');
    expect(alertRef(first, '20261116')).toBe(card.ref);
  });

  it('summary after the window: standing = in the last tick or a worker error; the rest cleared', () => {
    const s = (key: string, lesson: string | null = null) => ({ key, lesson, msg: `${key} msg`, first: 'a', last: 'b', count: 2 });
    const seen = {
      'outsourcing:lcw:watch:les-1:student_gone': s('student_gone', 'les-1'),
      'outsourcing:lcw:watch:les-1:quiet': s('quiet', 'les-1'),
      'outsourcing:lcw:watch:site-20261116:worker_errors': s('worker_errors')
    };
    const { standing, cleared } = standingAlerts(seen, ['outsourcing:lcw:watch:les-1:quiet']);
    expect(standing.map((x) => x.key).sort()).toEqual(['quiet', 'worker_errors']);
    expect(cleared.map((x) => x.key)).toEqual(['student_gone']);
    const card = summaryCard(standing, cleared, { base: 'https://lcw.example', dayStr: '20261116', from: '15:00', to: '17:00', out: 'Z:/tmp/lcw-watch' });
    expect(card).toMatchObject({ source: 'outsourcing', ref: 'outsourcing:lcw:watch:site-20261116:summary', importance: 2 });
    expect(card.title).toContain('남은 경보 2건');
    expect(card.body).toContain('스스로 풀린 경보 1건');
  });

  it('tail: a worker killed for CPU/memory counts as a server fault; a client hang-up does not', () => {
    const cpu = tailVerdict({ outcome: 'exceededCpu', event: { request: { method: 'POST', url: 'https://x/v1/lesson/utterance' } }, exceptions: [], logs: [] });
    expect(cpu).toMatchObject({ killed: true, serverBad: true, status: null });
    const gone = tailVerdict({ outcome: 'canceled', event: { request: { method: 'GET', url: 'https://x/v1/lesson/state' } } });
    expect(gone).toMatchObject({ killed: false, serverBad: false });
    const e500 = tailVerdict({
      outcome: 'ok',
      event: { request: { method: 'GET', url: 'https://x/r/abcdefghijklmnopqrstuvwxyz0123' }, response: { status: 500 } },
      exceptions: [{ name: 'Error', message: 'bad token abcdefghijklmnopqrstuvwxyz0123' }]
    });
    expect(e500).toMatchObject({ s5xx: true, serverBad: true, url: 'https://x/r/***' });
    expect(e500.exceptions[0]).toBe('Error: bad token ***');
    expect(tailVerdict({ outcome: 'ok', event: { response: { status: 404 } } })).toMatchObject({ s4xx: true, serverBad: false });
  });

  it('masks share tokens, join codes and long ids in logged URLs', () => {
    expect(maskUrl('https://lcw.worldwidesomething.com/r/abcdefghijklmnopqrstuvwxyz0123')).toBe('https://lcw.worldwidesomething.com/r/***');
    expect(maskUrl('https://x/game/?code=123456&scene=plaza')).toBe('https://x/game/?code=***&scene=plaza');
    expect(maskUrl('/v1/lesson/state?cursor=3')).toBe('/v1/lesson/state?cursor=3');
  });
});
