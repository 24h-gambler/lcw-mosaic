import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LessonDirectorConsole, autoCloseFocus } from '../LessonDirector.js';
import { A, micIssueLine } from '../autoCloseStrings.js';
import { createLessonApi, recordFromAutoClosed, type AutoClosedLessonRow, type LessonFeed } from '../lessonApi.js';
import type { FeedLiveExtra } from '../directorLiveState.js';

/** Console side of lessons the server closed as 'left without ending' (edge lesson-mode.ts LESSON_IDLE_CLOSE_MS). */

const T0 = Date.parse('2026-11-16T16:38:00+09:00');
const ROW: AutoClosedLessonRow = {
  lesson_id: 'les-20261116-fdbe87bf',
  player_id: 'stu-29ddc960',
  nickname: 'Oreo',
  plan_id: 'first_lesson_v1',
  started_at: T0,
  ended_at: T0 + 25 * 60_000,
  closed_at: T0 + 41 * 60_000,
  stage_id: 'warmup_anchor',
  utterances: 2,
  passes: 2,
  draft_summary_ko: '이번 수업에서 영어로 2번 말했고 그중 2번 통과했습니다. 직접 말한 시간은 4초입니다.'
};

function feedFor(lesson: Partial<LessonFeed['lesson']>, studentView: Record<string, unknown> = {}): LessonFeed & FeedLiveExtra {
  return {
    lesson: {
      id: ROW.lesson_id,
      player_id: ROW.player_id,
      nickname: 'Oreo',
      started_at: T0,
      ended_at: null,
      stage_id: 'warmup_anchor',
      targets: [],
      ...lesson
    } as LessonFeed['lesson'],
    utterances: [],
    pins: [],
    live: { utterances: 0, passes: 0, stars_total: 0, words_total: 0, student_speaking_ms: 0 },
    student_view: {
      connected: true,
      last_seen_at: T0 + 60_000,
      scene_id: null,
      ui: '3d',
      expected_scene_id: null,
      goal_ko: '',
      targets: [],
      last_utterance: null,
      ...studentView
    },
    server_now: T0 + 61_000
  } as LessonFeed & FeedLiveExtra;
}

describe('first screen: auto-closed lessons (report not sent)', () => {
  it('lists them under the resume card with report and continue buttons; the resume card stays as it was', () => {
    const html = renderToStaticMarkup(
      React.createElement(LessonDirectorConsole, {
        initialToken: 'op',
        initialLesson: null,
        initialLive: { lessons: [], auto_closed: [ROW], server_now: T0 + 50 * 60_000 },
        initialStudents: [],
        initialSeats: [],
        signupQueue: false,
        now: () => T0 + 50 * 60_000
      })
    );
    expect(html).toContain('data-testid="director-auto-closed"');
    expect(html).toContain(A.boxTitle);
    expect(html).toContain('Oreo · ');
    expect(html).toContain('16:38');
    expect(html).toContain('17:03');
    expect(html).toContain('말 2번 · 통과 2');
    expect(html).toContain(ROW.draft_summary_ko!);
    expect(html).toContain(`data-testid="auto-report-${ROW.lesson_id}"`);
    expect(html).toContain(`data-testid="auto-continue-${ROW.lesson_id}"`);
    expect(html).not.toContain('data-testid="director-live-lessons"');
  });

  it('no auto-closed rows (or an older server): no box', () => {
    const html = renderToStaticMarkup(
      React.createElement(LessonDirectorConsole, {
        initialToken: 'op',
        initialLesson: null,
        initialLive: { lessons: [], server_now: T0 },
        initialStudents: [],
        initialSeats: [],
        signupQueue: false,
        now: () => T0
      })
    );
    expect(html).not.toContain('director-auto-closed');
  });

  it('?auto=<id> from the hub card marks the row; &next=continue picks the continue button', () => {
    expect(autoCloseFocus('?auto=les-20261116-fdbe87bf')).toEqual({ lessonId: 'les-20261116-fdbe87bf', next: 'report' });
    expect(autoCloseFocus('?auto=les-20261116-fdbe87bf&next=continue')).toEqual({ lessonId: 'les-20261116-fdbe87bf', next: 'continue' });
    expect(autoCloseFocus('?auto=<script>')).toBeNull();
    expect(autoCloseFocus('')).toBeNull();
  });
});

describe('an auto-closed lesson opened on the console', () => {
  it('shows the draft and a two-step send instead of the old 리포트 가져오기', () => {
    const html = renderToStaticMarkup(
      React.createElement(LessonDirectorConsole, {
        initialToken: 'op',
        initialLesson: recordFromAutoClosed(ROW),
        initialFeed: feedFor({ ended_at: ROW.ended_at, end_reason: 'auto_idle', report_pending: true, draft_summary_ko: ROW.draft_summary_ko }),
        now: () => T0 + 50 * 60_000
      })
    );
    expect(html).toContain('data-testid="director-ended-auto"');
    expect(html).toContain(A.endedAutoTitle);
    expect(html).toContain(ROW.draft_summary_ko!);
    expect(html).toContain('data-testid="send-auto-report"');
    expect(html).toContain(A.send);
    expect(html).not.toContain('data-testid="fetch-report"');
    expect(html).not.toContain('다른 기기에서 끝낸 수업이에요');
  });

  it('send posts send: true with the comment', async () => {
    const bodies: unknown[] = [];
    const api = createLessonApi({
      fetch: async (_u, init) => {
        bodies.push(JSON.parse(String((init as RequestInit).body)));
        return new Response(JSON.stringify({ report_path: '/r/x', share_token: 'x', facts: {} }), { status: 200 });
      }
    });
    await api.endLesson('op', ROW.lesson_id, { teacher_comment: '잘했어요', send: true });
    expect(bodies).toEqual([{ teacher_comment: '잘했어요', send: true }]);
  });

  it('a continued lesson says so while it runs', () => {
    const html = renderToStaticMarkup(
      React.createElement(LessonDirectorConsole, {
        initialToken: 'op',
        initialLesson: { ...recordFromAutoClosed(ROW), lesson_id: 'les-20261116-next', join_code: '204816', expires_at: T0 + 12 * 3_600_000 },
        initialFeed: feedFor({ id: 'les-20261116-next', continues_from: ROW.lesson_id, started_at: T0 + 90 * 60_000 }),
        now: () => T0 + 91 * 60_000
      })
    );
    expect(html).toContain('data-testid="continued-note"');
    expect(html).toContain('자동 마무리된 수업을 이어 가요');
  });
});

describe("the child's mic issue on the student screen box (talk lane PR 122)", () => {
  it('one line with what to do while the mic is not ok', () => {
    const html = renderToStaticMarkup(
      React.createElement(LessonDirectorConsole, {
        initialToken: 'op',
        initialLesson: { ...recordFromAutoClosed(ROW), join_code: '204816', expires_at: T0 + 12 * 3_600_000 },
        initialFeed: feedFor({}, { mic: 'none', mic_issue: { issue: 'denied', raw: 'not-allowed', at: T0 } }),
        now: () => T0 + 61_000
      })
    );
    expect(html).toContain('data-testid="student-mic-issue"');
    expect(html).toContain('마이크 권한이 막혔어요 — 학생 화면 주소창 자물쇠');
    const ok = renderToStaticMarkup(
      React.createElement(LessonDirectorConsole, {
        initialToken: 'op',
        initialLesson: { ...recordFromAutoClosed(ROW), join_code: '204816', expires_at: T0 + 12 * 3_600_000 },
        initialFeed: feedFor({}, { mic: 'ok', mic_issue: { issue: 'denied', raw: 'not-allowed', at: T0 } }),
        now: () => T0 + 61_000
      })
    );
    expect(ok).not.toContain('student-mic-issue');
  });

  it('every issue the talk lane records has an action line; a cut-off turn says nothing', () => {
    for (const issue of ['unsupported', 'in_app', 'insecure', 'denied', 'no_speech', 'network']) {
      const line = micIssueLine(issue, issue);
      expect(line).toMatch(/^🎤 .+ — .+/);
    }
    expect(micIssueLine('denied', 'audio-capture')).toContain('다른 앱');
    expect(micIssueLine('aborted', 'aborted')).toBeNull();
    expect(micIssueLine('whatever', '')).toBeNull();
  });
});
