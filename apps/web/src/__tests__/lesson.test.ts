import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { FIRST_LESSON_PLAN } from '@lcw/content';
import { FORBIDDEN_PLAYER_UI_PATTERNS } from '@lcw/ui';
import { App } from '../App.js';
import { handleDirectorKeydown } from '../director.js';
import { LessonDirectorConsole, loadPlanChoice } from '../LessonDirector.js';
import { ParentReportPage } from '../ParentReportPage.js';
import { StudentJoin } from '../StudentJoin.js';
import {
  LessonApiError,
  NETWORK_ERROR_CODE,
  OPERATOR_TOKEN_KEY,
  STUDENT_TOKEN_KEY,
  createLessonApi,
  loadDirectorLesson,
  loadOperatorToken,
  loadStudentSession,
  saveDirectorLesson,
  saveOperatorToken,
  saveStudentSession,
  type DirectorLessonRecord,
  type FetchLike,
  type KeyValue,
  type LessonFeed
} from '../lessonApi.js';
import {
  INITIAL_JOIN_STATE,
  applyStagePush,
  buildPin,
  buildStagePush,
  displayTarget,
  formatClock,
  heardWordMask,
  hintLevelFor,
  joinReducer,
  mergeFeed,
  newStudentIds,
  pickAlternative,
  pinKindForKey,
  recallHint,
  reportFactRows,
  reportTokenFromPath,
  joinCodeFromSearch,
  studentJoinLinks,
  stageElapsedMs,
  stageStatus,
  targetCards,
  validateNewStudent,
  EMPTY_FEED_VIEW,
  type JoinState
} from '../lessonFlow.js';
import { routeFromPath } from '../main.js';
import { LESSON_STRINGS_KO } from '../strings.js';

/* ---------- helpers ---------- */

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function mockFetch(respond: (c: Call) => { status: number; body?: unknown; raw?: string }): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    const c: Call = {
      url,
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? JSON.parse(String(init.body)) : undefined
    };
    calls.push(c);
    const r = respond(c);
    const text = r.raw ?? (r.body === undefined ? '' : JSON.stringify(r.body));
    return new Response(text, { status: r.status, headers: { 'content-type': 'application/json' } });
  };
  return { fetch, calls };
}

function memStore(): KeyValue & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k)
  };
}

const throwingStore: KeyValue = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceeded');
  },
  removeItem: () => {
    throw new Error('SecurityError');
  }
};

const PRICE_RE = /[0-9,]+\s*원|결제|할인|구독|만료|가격|요금/;

function expectNoPriceCopy(html: string): void {
  for (const p of FORBIDDEN_PLAYER_UI_PATTERNS) expect(html).not.toContain(p);
  expect(PRICE_RE.test(html)).toBe(false);
}

const LESSON_REC: DirectorLessonRecord = {
  lesson_id: 'les-20261116-abcd',
  join_code: '482913',
  expires_at: 1_763_300_000_000,
  plan_id: 'first_lesson_v1',
  player_id: 'stu-1',
  nickname: '지우',
  started_at: 1_763_270_000_000,
  stage_id: 'cafe_order',
  stage_started_at: 1_763_270_900_000,
  stage_ms: { warmup_anchor: 900_000 },
  report_path: null
};

const FEED: LessonFeed = {
  lesson: {
    id: LESSON_REC.lesson_id,
    player_id: 'stu-1',
    nickname: '지우',
    started_at: 1_763_270_000_000,
    ended_at: null,
    stage_id: 'cafe_order',
    targets: ['Honey tea, please.', 'Can I have a warm honey tea?']
  },
  utterances: [
    {
      id: 'u1',
      at: 1_763_270_960_000,
      target_text: 'Can I have a warm honey tea?',
      transcript: 'can I have a warm honey tea',
      stars: 2,
      score: 0.92,
      pass: true,
      hint_level: 'full',
      mode: 'guided'
    },
    {
      id: 'u2',
      at: 1_763_270_990_000,
      target_text: 'Can I have a warm honey tea so that I stay warm?',
      transcript: 'can I have honey',
      stars: 0,
      score: 0.3,
      pass: false,
      hint_level: 'full',
      mode: 'guided'
    }
  ],
  pins: [{ id: 'pin-1', kind: 'expression', at_ms: 965_000, note: 'can I have a warm honey tea' }],
  live: { utterances: 2, passes: 1, stars_total: 2, words_total: 11, student_speaking_ms: 4_200 }
};

/* ---------- 1. API client ---------- */

describe('lessonApi client (docs/18 §2)', () => {
  it('sends the operator token as Bearer, JSON bodies, and returns parsed JSON', async () => {
    const { fetch, calls } = mockFetch(() => ({ status: 201, body: { lesson_id: 'les-1', join_code: '123456', expires_at: 1, plan: FIRST_LESSON_PLAN } }));
    const api = createLessonApi({ fetch });
    const r = await api.startLesson('op-secret', { player_id: 'stu-1', plan_id: 'first_lesson_v1' });
    expect(r.join_code).toBe('123456');
    expect(calls[0]!.url).toBe('/v1/admin/lessons/start');
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.headers.authorization).toBe('Bearer op-secret');
    expect(calls[0]!.headers['content-type']).toBe('application/json');
    expect(calls[0]!.body).toEqual({ player_id: 'stu-1', plan_id: 'first_lesson_v1' });
  });

  it('throws LessonApiError carrying the server error code on non-2xx', async () => {
    const api = createLessonApi({ fetch: mockFetch(() => ({ status: 401, body: { error: 'operator_only' } })).fetch });
    const err = await api.listStudents('wrong').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LessonApiError);
    expect((err as LessonApiError).code).toBe('operator_only');
    expect((err as LessonApiError).message).toBe('operator_only');
    expect((err as LessonApiError).status).toBe(401);
  });

  it('uses http_<status> when the error body is not JSON, and "network" when fetch itself fails', async () => {
    const html = createLessonApi({ fetch: mockFetch(() => ({ status: 502, raw: '<html>bad gateway</html>' })).fetch });
    await expect(html.lessonState('t')).rejects.toMatchObject({ code: 'http_502', status: 502 });
    const down = createLessonApi({
      fetch: async () => {
        throw new TypeError('Failed to fetch');
      }
    });
    await expect(down.join('123456')).rejects.toMatchObject({ code: NETWORK_ERROR_CODE, status: 0 });
  });

  it('join is public (no Authorization) and student calls carry the student token', async () => {
    const { fetch, calls } = mockFetch((c) =>
      c.url === '/v1/join'
        ? { status: 200, body: { student_token: 's'.repeat(48), lesson_id: 'les-1', player_id: 'stu-1', nickname: '지우', level: 'L1' } }
        : { status: 200, body: { pass: true, score: 1, stars: 2, feedback_ko: '통과!', coins_total: 20, utterances_today: 1 } }
    );
    const api = createLessonApi({ fetch });
    const j = await api.join('123456');
    expect(calls[0]!.headers.authorization).toBeUndefined();
    expect(calls[0]!.body).toEqual({ code: '123456' });
    await api.postUtterance(j.student_token, {
      target_text: 'Honey tea, please.',
      transcript: 'honey tea please',
      chosen_stars: 1,
      hint_level: 'full',
      latency_ms: 1200,
      dur_ms: 1500,
      stt_source: 'browser',
      confidence: 0.9
    });
    expect(calls[1]!.url).toBe('/v1/lesson/utterance');
    expect(calls[1]!.headers.authorization).toBe(`Bearer ${'s'.repeat(48)}`);
  });

  it('builds feed/pins/end/daily URLs with the lesson id and since', async () => {
    const { fetch, calls } = mockFetch(() => ({ status: 200, body: {} }));
    const api = createLessonApi({ fetch });
    await api.feed('op', 'les-1', 1234.9);
    await api.addPin('op', 'les-1', { kind: 'coaching', at_ms: 5000, note: '' });
    await api.endLesson('op', 'les-1', { teacher_comment: '잘했어요', next_lesson_at: '다음 주' });
    await api.studentDaily('op', 'stu-1');
    await api.daily('op', '2026-11-16');
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET /v1/admin/lessons/les-1/feed?since=1234&live_cursor=0',
      'POST /v1/admin/lessons/les-1/pins',
      'POST /v1/admin/lessons/les-1/end',
      'GET /v1/admin/students/stu-1/daily?days=14',
      'GET /v1/admin/daily?day=2026-11-16'
    ]);
  });

  it('getReport accepts facts stored as JSON text and 404 maps to report_not_found', async () => {
    const ok = createLessonApi({
      fetch: mockFetch(() => ({
        status: 200,
        body: { kind: 'lesson', ref_id: 'les-1', facts: '{"active_speaking_minutes":12}', body: '요약', clips: '[]', created_at: 1 }
      })).fetch
    });
    const r = await ok.getReport('tok');
    expect(r.facts).toEqual({ active_speaking_minutes: 12 });
    expect(r.clips).toEqual([]);
    const missing = createLessonApi({ fetch: mockFetch(() => ({ status: 404, body: { error: 'report_not_found' } })).fetch });
    await expect(missing.getReport('nope')).rejects.toMatchObject({ code: 'report_not_found' });
  });

  it('keeps tokens in the right storage and survives storage that throws', () => {
    const local = memStore();
    expect(saveOperatorToken('  op-key  ', local)).toBe(true);
    expect(local.data.get(OPERATOR_TOKEN_KEY)).toBe('op-key');
    expect(loadOperatorToken(local)).toBe('op-key');
    const session = memStore();
    saveStudentSession({ token: 'stok', lessonId: 'les-1', nickname: '지우' }, session);
    expect(session.data.get(STUDENT_TOKEN_KEY)).toBe('stok');
    expect(loadStudentSession(session)).toEqual({ token: 'stok', lessonId: 'les-1', nickname: '지우' });
    saveStudentSession(null, session);
    expect(loadStudentSession(session)).toBeNull();
    saveDirectorLesson(LESSON_REC, local);
    expect(loadDirectorLesson(local)).toEqual(LESSON_REC);
    // private mode / blocked storage: no throw, just "nothing stored"
    expect(saveOperatorToken('x', throwingStore)).toBe(false);
    expect(loadOperatorToken(throwingStore)).toBeNull();
    expect(loadStudentSession(throwingStore)).toBeNull();
    expect(loadDirectorLesson(throwingStore)).toBeNull();
    expect(loadOperatorToken(null)).toBeNull();
  });
});

/* ---------- 2. stage push ---------- */

describe('director stage push', () => {
  const cafe = FIRST_LESSON_PLAN.stages.find((s) => s.id === 'cafe_order')!;

  it('sends chosen plan sentences in plan order, then trimmed unique teacher lines, max 6', () => {
    const chosen = new Set(['Can I have a warm honey tea?', 'Honey tea, please.']);
    const p = buildStagePush(cafe, chosen, ['  Can I have   a cookie? ', 'Honey tea, please.', '', 'a', 'b', 'c', 'd']);
    expect(p).toEqual({
      stage_id: 'cafe_order',
      targets: ['Honey tea, please.', 'Can I have a warm honey tea?', 'Can I have a cookie?', 'a', 'b', 'c']
    });
  });

  it('posts exactly that payload to /stage', async () => {
    const { fetch, calls } = mockFetch(() => ({ status: 200, body: { ok: true } }));
    const api = createLessonApi({ fetch });
    const payload = buildStagePush(cafe, new Set(cafe.targets.map((t) => t.text)));
    await api.pushStage('op', 'les-1', payload);
    expect(calls[0]!.url).toBe('/v1/admin/lessons/les-1/stage');
    expect(calls[0]!.body).toEqual({ stage_id: 'cafe_order', targets: cafe.targets.map((t) => t.text) });
  });

  it('banks the time of the stage being left and keeps the clock on a re-push', () => {
    const t = LESSON_REC.stage_started_at!;
    const moved = applyStagePush(LESSON_REC, 'trade_roleplay', t + 120_000);
    expect(moved.stage_id).toBe('trade_roleplay');
    expect(moved.stage_ms.cafe_order).toBe(120_000);
    expect(moved.stage_started_at).toBe(t + 120_000);
    expect(applyStagePush(moved, 'trade_roleplay', t + 999_000)).toBe(moved);
    expect(stageElapsedMs(moved, 'trade_roleplay', t + 180_000)).toBe(60_000);
    expect(stageElapsedMs(moved, 'warmup_anchor', t + 180_000)).toBe(900_000);
    expect(stageStatus(FIRST_LESSON_PLAN, moved, 'cafe_order')).toBe('done');
    expect(stageStatus(FIRST_LESSON_PLAN, moved, 'trade_roleplay')).toBe('now');
    expect(stageStatus(FIRST_LESSON_PLAN, moved, 'wrap_up')).toBe('next');
  });
});

/* ---------- 3. F1/F2 pins ---------- */

describe('F1/F2 pins', () => {
  it('maps F1 → coaching, F2 → expression, nothing else', () => {
    expect(pinKindForKey('F1')).toBe('coaching');
    expect(pinKindForKey('F2')).toBe('expression');
    expect(pinKindForKey('F3')).toBeNull();
    expect(pinKindForKey('a')).toBeNull();
  });

  it('prevents the browser default (F1 help) only for F1/F2', () => {
    const push = vi.fn();
    const f1 = { key: 'F1', preventDefault: vi.fn() };
    const other = { key: 'Enter', preventDefault: vi.fn() };
    expect(handleDirectorKeydown(f1, 0, push)).toBe(true);
    expect(f1.preventDefault).toHaveBeenCalledOnce();
    expect(push).toHaveBeenCalledWith({ kind: 'coaching', at_ms: 0 });
    expect(handleDirectorKeydown(other, 0, push)).toBe(false);
    expect(other.preventDefault).not.toHaveBeenCalled();
  });

  it('stamps ms since lesson start and fills the note from context', () => {
    const ctx = { note: '', lastTranscript: 'can I have a warm honey tea', stageTitle: '② 카페 주문' };
    expect(buildPin('expression', 10_000_500, 10_000_000, ctx)).toEqual({ kind: 'expression', at_ms: 500, note: 'can I have a warm honey tea' });
    expect(buildPin('coaching', 10_000_000, 10_000_000, ctx).note).toBe('② 카페 주문');
    expect(buildPin('coaching', 5, 10, { ...ctx, note: '  발음 칭찬 ' })).toEqual({ kind: 'coaching', at_ms: 0, note: '발음 칭찬' });
    expect(buildPin('coaching', 0, 0, { ...ctx, note: 'x'.repeat(500) }).note).toHaveLength(300);
  });
});

/* ---------- feed ---------- */

describe('feed merge', () => {
  it('dedupes by id, keeps time order and advances since', () => {
    const a = mergeFeed(EMPTY_FEED_VIEW, FEED);
    expect(a.utterances.map((u) => u.id)).toEqual(['u1', 'u2']);
    expect(a.since).toBe(1_763_270_990_000);
    const b = mergeFeed(a, { utterances: [FEED.utterances[1]!], pins: [] });
    expect(b.utterances).toHaveLength(2);
    expect(b.pins).toEqual([]);
    expect(formatClock(3_725_000)).toBe('1:02:05');
    expect(formatClock(65_000)).toBe('01:05');
  });
});

/* ---------- 4. join state machine ---------- */

describe('student join state machine', () => {
  const ok = { student_token: 't'.repeat(48), lesson_id: 'les-1', player_id: 'stu-1', nickname: '지우', level: 'L1' };

  it('code → joining → lesson → ended', () => {
    let s = joinReducer(INITIAL_JOIN_STATE, { type: 'code_changed', value: '48 29-13x9' });
    expect(s.code).toBe('482913');
    s = joinReducer(s, { type: 'submit' });
    expect(s.phase).toBe('joining');
    s = joinReducer(s, { type: 'join_ok', result: ok });
    expect(s).toMatchObject({ phase: 'lesson', token: ok.student_token, nickname: '지우', lessonId: 'les-1' });
    s = joinReducer(s, { type: 'state', state: { lesson_id: 'les-1', stage_id: 'cafe_order', targets: ['Honey tea, please.'], ended: false } });
    expect(s.phase).toBe('lesson');
    s = joinReducer(s, { type: 'utterance_result', result: { pass: true, score: 1, stars: 2, feedback_ko: '통과!', coins_total: 20, utterances_today: 1 } });
    s = joinReducer(s, { type: 'utterance_result', result: { pass: false, score: 0.2, stars: 0, feedback_ko: '한 번 더', coins_total: 20, utterances_today: 2 } });
    expect(s).toMatchObject({ saidCount: 2, starsEarned: 2 });
    s = joinReducer(s, { type: 'state', state: { lesson_id: 'les-1', stage_id: 'wrap_up', targets: [], ended: true } });
    expect(s.phase).toBe('ended');
  });

  it('short codes and wrong codes stay on the code box with child-friendly copy', () => {
    let s = joinReducer(INITIAL_JOIN_STATE, { type: 'code_changed', value: '123' });
    s = joinReducer(s, { type: 'submit' });
    expect(s.phase).toBe('code');
    expect(s.error).toBe(LESSON_STRINGS_KO.join.errSixDigits);
    s = joinReducer(joinReducer(s, { type: 'code_changed', value: '123456' }), { type: 'submit' });
    s = joinReducer(s, { type: 'join_failed', code: 'invalid_code' });
    expect(s).toMatchObject({ phase: 'code', code: '', error: LESSON_STRINGS_KO.join.errCode });
    s = joinReducer(joinReducer(s, { type: 'code_changed', value: '123456' }), { type: 'submit' });
    s = joinReducer(s, { type: 'join_failed', code: 'too_many_attempts' });
    expect(s).toMatchObject({ phase: 'code', code: '123456', error: LESSON_STRINGS_KO.join.errTooMany });
  });

  it('a lost poll only counts failures; a dead token sends the child back to the code box', () => {
    let s = joinReducer(INITIAL_JOIN_STATE, { type: 'resume', token: 'tok', lessonId: 'les-1', nickname: '지우' });
    expect(s.phase).toBe('lesson');
    s = joinReducer(s, { type: 'state_failed', code: 'network' });
    s = joinReducer(s, { type: 'state_failed', code: 'http_502' });
    expect(s).toMatchObject({ phase: 'lesson', pollFailures: 2, token: 'tok' });
    s = joinReducer(s, { type: 'state', state: { lesson_id: 'les-1', stage_id: null, targets: [], ended: false } });
    expect(s.pollFailures).toBe(0);
    s = joinReducer(s, { type: 'state_failed', code: 'student_only' });
    expect(s).toMatchObject({ phase: 'code', token: null, error: LESSON_STRINGS_KO.join.errSessionGone });
  });
});

/* ---------- 5. recall hint + target cards ---------- */

describe('recall hint and target cards', () => {
  it('recall shows only the first word', () => {
    expect(recallHint('Can I have a warm honey tea?')).toBe('Can …');
    expect(displayTarget('Can I have a warm honey tea?', 'recall')).toBe('Can …');
    expect(displayTarget('Can I have a warm honey tea?', 'guided')).toBe('Can I have a warm honey tea?');
    expect(hintLevelFor('recall')).toBe('initial');
    expect(hintLevelFor('guided')).toBe('full');
  });

  it('star level comes from the plan, else from position', () => {
    expect(targetCards(['Can I have a warm honey tea?', 'My own line', 'Another', 'Fourth'])).toEqual([
      { text: 'Can I have a warm honey tea?', stars: 2 },
      { text: 'My own line', stars: 2 },
      { text: 'Another', stars: 3 },
      { text: 'Fourth', stars: 3 }
    ]);
  });

  it('the recall screen never prints the whole sentence', () => {
    const state: JoinState = {
      ...INITIAL_JOIN_STATE,
      phase: 'lesson',
      token: 'tok',
      lessonId: 'les-1',
      nickname: '지우',
      lesson: {
        lesson_id: 'les-1',
        stage_id: 'recall_today',
        mode: 'recall',
        stage_goal_ko: '오늘 배운 문장을 기억해서 말해요',
        targets: ['Can I have a warm honey tea?', 'I want to trade my blue stone because I need a helmet for the cave.'],
        ended: false
      }
    };
    const html = renderToStaticMarkup(React.createElement(StudentJoin, { initialState: state, recognition: null, userAgent: 'Chrome' }));
    expect(html).toContain('Can …');
    expect(html).toContain('I …');
    expect(html).not.toContain('warm honey tea');
    expect(html).not.toContain('blue stone');
    expect(html).toContain(LESSON_STRINGS_KO.join.recallNote);
  });

  it('picks the recognizer hypothesis closest to the chosen sentence (free talk: top guess)', () => {
    const alts = [
      { transcript: 'can I have a worm honey', confidence: 0.8 },
      { transcript: 'can I have a warm honey tea', confidence: 0.5 }
    ];
    expect(pickAlternative(alts, 'Can I have a warm honey tea?', 'guided')).toEqual(alts[1]);
    expect(pickAlternative(alts, 'Can I have a warm honey tea?', 'free')).toEqual(alts[0]);
    expect(pickAlternative([{ transcript: '  ', confidence: 1 }], 'x', 'guided')).toBeNull();
    expect(heardWordMask('can I have honey', 'Can I have a warm honey tea?')).toEqual([true, true, true, false, false, true, false]);
  });
});

/* ---------- 6. student screen: no price words ---------- */

describe('/join child screen copy (AGENTS 4.9)', () => {
  it('code box, lesson with a result, typing fallback and the ending carry no price/payment/deadline words', () => {
    const codeHtml = renderToStaticMarkup(React.createElement(App, { initialRoute: '/join' }));
    expect(codeHtml).toContain(LESSON_STRINGS_KO.join.codePrompt);
    expect(codeHtml).not.toContain('주요 메뉴');
    expectNoPriceCopy(codeHtml);

    const lessonState: JoinState = {
      ...INITIAL_JOIN_STATE,
      phase: 'lesson',
      token: 'tok',
      lessonId: 'les-1',
      nickname: '지우',
      saidCount: 3,
      starsEarned: 5,
      last: { pass: true, score: 1, stars: 3, feedback_ko: '완벽해요! 별 3개!', coins_total: 1250, utterances_today: 3 },
      lesson: {
        lesson_id: 'les-1',
        stage_id: 'cafe_order',
        mode: 'guided',
        stage_goal_ko: '카페에서 영어로 음료를 주문해요. 별 3개에 도전!',
        targets: FIRST_LESSON_PLAN.stages[1]!.targets.map((t) => t.text),
        ended: false
      }
    };
    const lessonHtml = renderToStaticMarkup(React.createElement(StudentJoin, { initialState: lessonState, recognition: null, userAgent: 'Chrome' }));
    expect(lessonHtml).toContain('Can I have a warm honey tea so that I stay warm?');
    expect(lessonHtml).toContain(LESSON_STRINGS_KO.join.noMic);
    expect(lessonHtml).toContain('코인 1,250');
    expectNoPriceCopy(lessonHtml);

    const micHtml = renderToStaticMarkup(
      React.createElement(StudentJoin, {
        initialState: lessonState,
        recognition: class {} as unknown as NonNullable<Parameters<typeof StudentJoin>[0]['recognition']>,
        userAgent: 'Chrome'
      })
    );
    expect(micHtml).toContain('data-testid="mic-button"');
    expect(micHtml).toContain(LESSON_STRINGS_KO.join.typeInstead);
    expectNoPriceCopy(micHtml);

    const endHtml = renderToStaticMarkup(
      React.createElement(StudentJoin, { initialState: { ...lessonState, phase: 'ended' }, recognition: null, userAgent: 'Chrome' })
    );
    expect(endHtml).toContain(LESSON_STRINGS_KO.join.endTitle('지우'));
    expect(endHtml).toContain(LESSON_STRINGS_KO.join.endSaid(3));
    expectNoPriceCopy(endHtml);
  });

  it('every child string in the lesson pack is free of forbidden words', () => {
    const flat = JSON.stringify(LESSON_STRINGS_KO.join, (_k, v) => (typeof v === 'function' ? v('지우') : v));
    expectNoPriceCopy(flat);
  });
});

/* ---------- 7. parent report page ---------- */

describe('/r/<token> parent report', () => {
  it('routes /r/<token> and parses the token', () => {
    expect(routeFromPath('/r/9f8e7d6c5b4a39281706f5e4d3c2b1a0')).toBe('/r');
    expect(reportTokenFromPath('/r/9f8e7d6c5b4a39281706f5e4d3c2b1a0/')).toBe('9f8e7d6c5b4a39281706f5e4d3c2b1a0');
    expect(reportTokenFromPath('/r/')).toBeNull();
    expect(reportTokenFromPath('/report')).toBeNull();
    expect(routeFromPath('/join')).toBe('/join');
    expect(routeFromPath('/join/')).toBe('/join');
    expect(routeFromPath('/nope')).toBe('/');
  });

  it('renders facts as a table, the verified body and the date', () => {
    const report = {
      kind: 'lesson',
      ref_id: 'les-1',
      facts: {
        free_utterances: 12,
        total_valid_utterances: 20,
        weekly_free_ratio: 0.6,
        active_speaking_minutes: 7.5,
        mean_words_per_utterance: 5.25,
        think_speak_index: null,
        new_expressions: 4,
        solo_reused_expressions: 1
      },
      body: '이번 주 인식된 발화는 20건이며 직접 만들어 말한 발화는 12건(60%)입니다.',
      clips: [],
      created_at: Date.parse('2026-11-16T08:10:00Z')
    };
    const html = renderToStaticMarkup(
      React.createElement(ParentReportPage, { token: 'tok', initial: { status: 'ok', report } })
    );
    expect(html).toContain('<table');
    expect(html).toContain('2026년 11월 16일');
    expect(html).toContain('직접 말한 시간');
    expect(html).toContain('7.5분');
    expect(html).toContain('60%');
    expect(html).toContain('5.3단어');
    expect(html).toContain('기준선 수집 중');
    expect(html).toContain(report.body);
    expect(reportFactRows({ active_speaking_minutes: 0.04 })[0]!.value).toBe('2초');
    expect(reportFactRows({ active_speaking_minutes: 0 })[0]!.value).toBe('0분');
    const rows = reportFactRows(report.facts);
    expect(rows[0]!.key).toBe('active_speaking_minutes');
    expect(rows).toHaveLength(8);
  });

  it('404 shows a friendly message; App /r without a token does too', () => {
    const html = renderToStaticMarkup(React.createElement(ParentReportPage, { token: 'x', initial: { status: 'not_found' } }));
    expect(html).toContain(LESSON_STRINGS_KO.report.notFoundTitle);
    const appHtml = renderToStaticMarkup(React.createElement(App, { initialRoute: '/r', initialReportToken: null }));
    expect(appHtml).toContain(LESSON_STRINGS_KO.report.notFoundTitle);
    const loading = renderToStaticMarkup(React.createElement(App, { initialRoute: '/r', initialReportToken: 'abc' }));
    expect(loading).toContain(LESSON_STRINGS_KO.report.loading);
  });
});

/* ---------- 8. director console ---------- */

describe('/director live console', () => {
  it('without a key: key box plus the old demo console tucked away', () => {
    const html = renderToStaticMarkup(React.createElement(App, { initialRoute: '/director' }));
    expect(html).toContain(LESSON_STRINGS_KO.director.keyTitle);
    expect(html).toContain('data-testid="director-demo"');
    expect(html).toContain('<details');
  });

  it('with a key: student list with a start button and the registration form', () => {
    const html = renderToStaticMarkup(
      React.createElement(LessonDirectorConsole, {
        initialToken: 'op',
        initialLesson: null,
        initialStudents: [
          { player_id: 'stu-1', nickname: '지우', level: 'L1', birth_year: 2017, family_id: 'fam-1', last_lesson_at: null, utterances_7d: 0 }
        ]
      })
    );
    expect(html).toContain('지우');
    expect(html).toContain(LESSON_STRINGS_KO.director.startLesson);
    expect(html).toContain(LESSON_STRINGS_KO.director.newStudentTitle);
    expect(html).not.toContain('director-demo');
  });

  it('plan choice: both lessons offered, the remembered one is picked, unknown or blocked storage falls back to the first', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) });
    try {
      expect(loadPlanChoice()).toBe('first_lesson_v1');
      store.set('lcw.director.plan', 'second_lesson_v1');
      expect(loadPlanChoice()).toBe('second_lesson_v1');
      const html = renderToStaticMarkup(
        React.createElement(LessonDirectorConsole, { initialToken: 'op', initialLesson: null, initialStudents: [] })
      );
      expect(html).toContain('data-testid="plan-first_lesson_v1"');
      expect(html).toMatch(/aria-checked="true"[^>]*data-testid="plan-second_lesson_v1"/);
      store.set('lcw.director.plan', 'gone_plan');
      expect(loadPlanChoice()).toBe('first_lesson_v1');
      vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => undefined });
      expect(loadPlanChoice()).toBe('first_lesson_v1');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('live lesson: huge join code, /join, stage rail with the current stage, guide, script, feed and counters', () => {
    const html = renderToStaticMarkup(
      React.createElement(LessonDirectorConsole, {
        initialToken: 'op',
        initialLesson: LESSON_REC,
        initialFeed: FEED,
        now: () => LESSON_REC.stage_started_at! + 75_000
      })
    );
    expect(html).toContain('data-testid="join-code"');
    expect(html).toMatch(/482<span[^>]*><\/span>913/);
    expect(html).toContain('/join');
    expect(html).toMatch(/data-testid="stage-cafe_order" data-status="now"/);
    expect(html).toMatch(/data-testid="stage-warmup_anchor" data-status="done"/);
    expect(html).toContain(LESSON_STRINGS_KO.director.guideLabel);
    const cafe = FIRST_LESSON_PLAN.stages[1]!;
    expect(html).toContain(cafe.teacherGuideKo);
    expect(html).toContain(cafe.teacherScriptEn);
    expect(html).toContain('can I have a warm honey tea');
    expect((html.match(/data-testid="feed-item"/g) ?? []).length).toBe(2);
    expect(html).toContain(LESSON_STRINGS_KO.director.pinCoaching);
    expect(html).toContain(LESSON_STRINGS_KO.director.pinExpression);
    expect(html).toContain(LESSON_STRINGS_KO.director.endButton);
    // per-stage elapsed: 75 s on the current stage, 15:00 banked on the first
    expect(html).toContain('01:15');
    expect(html).toContain('15:00');
  });

  it('after the lesson ends the report link and preview are shown', () => {
    const html = renderToStaticMarkup(
      React.createElement(LessonDirectorConsole, {
        initialToken: 'op',
        initialLesson: { ...LESSON_REC, report_path: '/r/abcdef0123456789abcdef0123456789' },
        initialFeed: FEED
      })
    );
    expect(html).toContain(LESSON_STRINGS_KO.director.reportReady);
    expect(html).toContain('/r/abcdef0123456789abcdef0123456789');
    expect(html).toContain(LESSON_STRINGS_KO.director.copyReport);
    expect(html).toContain(LESSON_STRINGS_KO.director.previewReport);
  });

  it('new student form: ids are generated client-side with the right prefixes; input is validated', () => {
    let i = 0;
    const ids = newStudentIds(() => ((i++ * 7) % 36) / 36);
    expect(ids.player_id).toMatch(/^stu-[0-9a-z]{10}$/);
    expect(ids.family_id).toMatch(/^fam-[0-9a-z]{10}$/);
    expect(ids.guardian_id).toMatch(/^gdn-[0-9a-z]{10}$/);
    expect(validateNewStudent({ nickname: ' ', birthYear: '', level: 'L1' })).toBe(LESSON_STRINGS_KO.director.errNicknameEmpty);
    expect(validateNewStudent({ nickname: '지우', birthYear: '1999', level: 'L1' })).toBe(LESSON_STRINGS_KO.director.errBirthYear);
    expect(validateNewStudent({ nickname: '지우', birthYear: '2017', level: 'L2' })).toBeNull();
    expect(validateNewStudent({ nickname: '지우', birthYear: '', level: 'L3' })).toBeNull();
  });
});

/* ---------- 10. docs/19: 3D default, /join fallback ---------- */

describe('join links (docs/19 §4)', () => {
  it('lists /game/?code= and /join?code=, fallback first until the 3D lesson join is ready', () => {
    expect(studentJoinLinks('https://x', '482913', false).map((l) => l.url)).toEqual([
      'https://x/join?code=482913',
      'https://x/game/?code=482913'
    ]);
    expect(studentJoinLinks('https://x', '482913', true)[0]).toEqual({ kind: '3d', url: 'https://x/game/?code=482913' });
  });

  it('reads ?code= on /join and the screen says it is the fallback', () => {
    expect(joinCodeFromSearch('?code=482913')).toBe('482913');
    expect(joinCodeFromSearch('?x=1&code=482913&y=2')).toBe('482913');
    expect(joinCodeFromSearch('?code=12345')).toBeNull();
    expect(joinCodeFromSearch('')).toBeNull();
    const html = renderToStaticMarkup(React.createElement(App, { initialRoute: '/join' }));
    expect(html).toContain(LESSON_STRINGS_KO.join.fallbackNote);
    const dir = renderToStaticMarkup(
      React.createElement(LessonDirectorConsole, { initialToken: 'op', initialLesson: LESSON_REC, initialFeed: FEED })
    );
    expect(dir).toContain('/join?code=482913');
    expect(dir).toContain('/game/?code=482913');
  });
});
