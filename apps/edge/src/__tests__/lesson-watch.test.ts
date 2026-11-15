import { describe, expect, it } from 'vitest';
// The live-lesson watch tool (tools/lesson-watch.mjs): importing it touches no token and no disk.
import {
  LESSON_CARD_IMPORTANCE,
  SUMMARY_IMPORTANCE,
  TEST_CARD_IMPORTANCE,
  WATCH_LIMITS,
  checkLesson,
  emptyCardState,
  maskUrl,
  planTick,
  planWindowEnd,
  scopeRef,
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

  it('lesson cards: one card per lesson rewritten in place, importance 1 (hub, the phone does not ring), nothing a child said', () => {
    const ctx = { base: 'https://lcw.example', out: 'Z:/tmp/lcw-watch' };
    const st = emptyCardState('20261116', 'https://spine.example');
    const at1 = new Date(now).toISOString();
    const { alerts } = checkLesson(
      lesson,
      feed({ connected: false, last_seen_at: now - WATCH_LIMITS.studentGoneMs - 1_000, last_utterance: { at: now - 1_000, transcript: 'secret words' } }),
      now,
      undefined
    );
    expect(alerts).toEqual([expect.objectContaining({ key: 'student_gone', lesson: 'les-1' })]);
    const t1 = planTick(st, [...alerts, { key: 'http', msg: '/v1/admin/health 응답 500' }], at1, ctx);
    expect(t1.map((x) => x.card.ref).sort()).toEqual(['outsourcing:lcw:watch:les-1:alerts', 'outsourcing:lcw:watch:site-20261116:alerts']);
    const card = t1.find((x) => x.card.ref === scopeRef('les-1'))!.card;
    expect(card).toMatchObject({ source: 'outsourcing', importance: LESSON_CARD_IMPORTANCE });
    expect(LESSON_CARD_IMPORTANCE).toBe(1);
    expect(TEST_CARD_IMPORTANCE).toBe(1);
    expect(card.title).toContain('지금 경보 1건');
    expect(card.actions[0]).toEqual({ type: 'open', url: 'https://lcw.example/director', label: '디렉터 콘솔 열기' });
    expect(card).not.toHaveProperty('priority');
    expect(JSON.stringify(t1)).not.toContain('secret words');
    // posted: the same alerts next tick change nothing, so nothing is posted again
    for (const x of t1) st.posted[x.card.ref] = { id: 'p_x', sig: x.sig, at: at1 };
    const at2 = new Date(now + 15 * 60_000).toISOString();
    expect(planTick(st, [...alerts, { key: 'http', msg: '/v1/admin/health 응답 500' }], at2, ctx)).toEqual([]);
    // a new kind in the same lesson rewrites the same card; the cleared site alert rewrites its card as cleared
    const t3 = planTick(st, [...alerts, { key: 'quiet', msg: 'les-1: 16분째 답 없음', lesson: 'les-1' }], at2, ctx);
    expect(t3.map((x) => x.card.ref).sort()).toEqual(['outsourcing:lcw:watch:les-1:alerts', 'outsourcing:lcw:watch:site-20261116:alerts']);
    expect(t3.find((x) => x.card.ref === scopeRef('les-1'))!.card.title).toContain('지금 경보 2건');
    expect(t3.find((x) => x.card.ref === scopeRef('site-20261116'))!.card.title).toContain('모두 풀림');
    // a card that failed to post (old signature kept) comes back next tick
    expect(planTick(st, [...alerts, { key: 'quiet', msg: 'les-1: 31분째 답 없음', lesson: 'les-1' }], at2, ctx).length).toBe(2);
    expect(st.seen['les-1:student_gone']).toMatchObject({ count: 4 });
  });

  it('after the window: one P2 summary of what still stands (last tick, or any worker error), every lesson card closes', () => {
    const ctx = { base: 'https://lcw.example', from: '15:00', to: '17:00', out: 'Z:/tmp/lcw-watch' };
    const st = emptyCardState('20261116', 'https://spine.example');
    const at = new Date(now).toISOString();
    planTick(st, [{ key: 'student_gone', msg: 'a', lesson: 'les-1' }, { key: 'worker_errors', msg: '5xx 1건' }], at, { base: ctx.base, out: ctx.out });
    planTick(st, [{ key: 'quiet', msg: 'b', lesson: 'les-1' }], at, { base: ctx.base, out: ctx.out });
    st.posted[scopeRef('les-1')] = { id: 'p_1', sig: 'x', at };
    st.posted[scopeRef('site-20261116')] = { id: 'p_2', sig: 'y', at, closed: at };
    const end = planWindowEnd(st, ctx);
    expect(end).toMatchObject({ standing: 2, cleared: 1, closeRefs: [scopeRef('les-1')] });
    expect(end.summary).toMatchObject({ ref: 'outsourcing:lcw:watch:site-20261116:summary', importance: SUMMARY_IMPORTANCE });
    expect(SUMMARY_IMPORTANCE).toBe(2);
    expect(end.summary!.title).toContain('남은 경보 2건');
    expect(end.summary!.body).toContain('스스로 풀린 경보 1건');
    // nothing standing: no summary, the cards still close
    const calm = emptyCardState('20261116', 'https://spine.example');
    planTick(calm, [{ key: 'student_gone', msg: 'a', lesson: 'les-1' }], at, { base: ctx.base, out: ctx.out });
    planTick(calm, [], at, { base: ctx.base, out: ctx.out });
    calm.posted[scopeRef('les-1')] = { id: 'p_1', sig: 'x', at };
    expect(planWindowEnd(calm, ctx)).toMatchObject({ summary: null, standing: 0, cleared: 1, closeRefs: [scopeRef('les-1')] });
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
    // an 'exception' outcome counts once (through its exception), a dropped client stream is not a fault,
    // and only the exception name is kept for the card
    const ex = tailVerdict({ outcome: 'exception', exceptions: [{ name: 'SyntaxError', message: 'Unexpected token in "honey tea please"' }] });
    expect(ex).toMatchObject({ killed: false, serverBad: true, exceptionNames: ['SyntaxError'] });
    expect(tailVerdict({ outcome: 'responseStreamDisconnected' })).toMatchObject({ killed: false, serverBad: false });
  });

  it('masks share tokens, join codes and long ids in logged URLs', () => {
    expect(maskUrl('https://lcw.worldwidesomething.com/r/abcdefghijklmnopqrstuvwxyz0123')).toBe('https://lcw.worldwidesomething.com/r/***');
    expect(maskUrl('https://x/game/?code=123456&scene=plaza')).toBe('https://x/game/?code=***&scene=plaza');
    expect(maskUrl('/v1/lesson/state?cursor=3')).toBe('/v1/lesson/state?cursor=3');
  });
});
