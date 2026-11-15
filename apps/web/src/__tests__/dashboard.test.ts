import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { App } from '../App.js';
import { FamilyPage } from '../FamilyPage.js';
import { DashboardPage, DashboardView, changeBadge, changeLine, fourWeekChange, headline, weekLabel } from '../DashboardPage.js';
import { createFamilyApi, type DashboardPayload, type DashboardWeek, type FamilyChild } from '../familyApi.js';
import type { FetchLike } from '../lessonApi.js';
import { PARENT_STRINGS_KO } from '../parentStrings.js';

const D = PARENT_STRINGS_KO.dashboard;
const WEEK = 7 * 86_400_000;
const W0 = Date.parse('2026-08-30T15:00:00Z'); // KST Monday 2026-08-31
const zero = { free: 0, guided: 0, read: 0, recall: 0 };
const week = (i: number, over: Partial<DashboardWeek> = {}): DashboardWeek => ({
  week_start: W0 + i * WEEK,
  free_words: 0,
  speaking_min: 0,
  free_utterances: 0,
  speech_wpm: null,
  response_sec: null,
  mean_words: null,
  connectors_per_100: null,
  prep_per_word_ms: null,
  target_lang_ratio: null,
  hint_free_ratio: null,
  think_speak: null,
  think_speak_4w: null,
  think_status: 'short',
  modes: { lesson: { ...zero }, solo: { ...zero } },
  lesson_days: 0,
  play_days: 0,
  cum_free_words: 0,
  cum_vocab: 0,
  cum_mastered: 0,
  ...over
});
const weeks = Array.from({ length: 12 }, (_, i) =>
  i < 6
    ? week(i)
    : week(i, {
        free_words: [150, 180, 200, 230, 240, 255][i - 6]!,
        speaking_min: [10, 12, 14, 15, 16, 18][i - 6]!,
        free_utterances: 30 + i,
        speech_wpm: 60 + i,
        response_sec: 2.5 - i * 0.1,
        mean_words: 5 + i * 0.2,
        think_speak: i >= 9 ? 100 + i : null,
        think_speak_4w: i >= 9 ? 98 + i : null,
        think_status: i >= 9 ? 'ready' : 'short',
        prep_per_word_ms: 600 - i * 10,
        target_lang_ratio: 1,
        hint_free_ratio: 0.4 + i * 0.02,
        modes: { lesson: { free: 5, guided: 3, read: 1, recall: 1 }, solo: { free: 10, guided: 0, read: 0, recall: 2 } },
        lesson_days: i % 2,
        play_days: 4,
        cum_free_words: 150 * (i - 5),
        cum_vocab: 20 * (i - 5),
        cum_mastered: i - 5
      })
);
const data: DashboardPayload = {
  child: { nickname: 'Jiwoo', level: 'L2' },
  series: {
    weeks,
    baseline: { week_starts: [W0 + 9 * WEEK, W0 + 10 * WEEK], mean_words: 6.9, speech_wpm: 69.5, latency_per_word_ms: 505, connectors_per_100: 2, target_lang_ratio: 1, hint_free_ratio: 0.59 },
    projection: {
      cum_free_words: [{ week_start: W0 + 12 * WEEK, value: 1100 }],
      cum_vocab: [{ week_start: W0 + 12 * WEEK, value: 140 }],
      cum_mastered: [{ week_start: W0 + 12 * WEEK, value: 8 }]
    },
    calendar: [
      { day: '2026-11-15', free_words: 0 },
      { day: '2026-11-16', free_words: 42 }
    ],
    connectors: [
      { expr: 'because', count: 7 },
      { expr: 'so that', count: 3 }
    ],
    has_data: true
  },
  week_line: { text: 'I think we should go down instead because it is faster', words: 11, at: W0 + 11 * WEEK + 1000 },
  review: [{ text: 'so that I can fly', due_at: 1 }],
  lessons: [
    { id: 'l1', started_at: W0 + 11 * WEEK, ended_at: W0 + 11 * WEEK + 7_200_000, duration_min: 120, student_min: 28, teacher_min: 40, student_share: 0.41, utterances: 64, passes: 50, report_path: '/r/abc' }
  ],
  next_lesson_at: '11월 19일 목요일 17:30',
  lesson_live: false,
  lesson_window_on: true,
  voice_store_on: false,
  server_now: W0 + 11 * WEEK + 3 * 86_400_000
};

describe('guardian dashboard page (WP-309, docs/07 §4, docs/08 §9)', () => {
  it('home: headline with the 4-week ratio, four cards whose numbers equal this week, interpretation lines', () => {
    const html = renderToStaticMarkup(React.createElement(DashboardView, { data }));
    // 255 this week vs 180 four weeks earlier (index 7) → 1.4배
    expect(html).toContain(D.headline('Jiwoo', 255) + D.headlineRatio('1.4'));
    expect(html).toMatch(/data-testid="card-free".*?255/);
    expect(html).toMatch(/data-testid="card-time".*?18/);
    expect(html).toMatch(/data-testid="card-think".*?109/);
    expect(html).toMatch(/data-testid="card-mastered".*?6/);
    expect(html).toContain(D.lineUp('180단어', '255단어'));
    expect(html).toContain(D.thinkNote);
    expect(html).toContain('I think we should go down instead because it is faster');
    expect(html).toContain('so that I can fly');
    // no comparison with other children, no causal praise, no money (docs/07 §5, docs/16)
    expect(html).not.toMatch(/다른 아이보다|평균보다|상위 \d|덕분에|결제|\d+원/);
  });

  it('every graph has a table view (7 graphs → 7 tables when tables are on)', () => {
    const charts = renderToStaticMarkup(React.createElement(DashboardView, { data }));
    expect(charts.match(/aria-pressed="false"[^>]*>표로 보기|표로 보기/g)?.length).toBeGreaterThanOrEqual(7);
    const tables = renderToStaticMarkup(React.createElement(DashboardView, { data, initialTables: true }));
    for (const id of ['chart-think', 'chart-cumulative', 'chart-weekly', 'chart-fluency', 'chart-connectors', 'chart-ladder', 'chart-calendar']) {
      expect(tables).toContain(`data-testid="${id}-table"`);
    }
    // short-sample weeks are named in the table, estimates are labelled
    expect(tables).toContain(D.shortSample);
    expect(tables).toContain(`(${D.estimate})`);
  });

  it('graph rules: 100 reference line, hollow circles for short samples, dashed estimate with "추정", mode patterns, lesson ticks', () => {
    const html = renderToStaticMarkup(React.createElement(DashboardView, { data }));
    expect(html).toContain('stroke-dasharray="5 4"'); // index reference line
    expect(html).toContain(`· ${D.shortSample}`); // hollow circle tooltip
    expect(html).toContain('stroke-dasharray="6 4"'); // estimate
    expect(html).toContain(`>${D.estimate}<`);
    expect(html).toContain('url(#lcw-p-guided)');
    expect(html).toContain(D.lessonTick);
    expect(html).not.toMatch(/<video|<audio/);
  });

  it('lessons list: duration, student share meter, report link; window button only with consent', () => {
    const html = renderToStaticMarkup(React.createElement(DashboardView, { data }));
    expect(html).toContain(D.lessonRow(120, 64, 50));
    expect(html).toContain('aria-valuenow="41"');
    expect(html).toContain('href="/r/abc"');
  });

  it('waiting, no session, /dashboard route, family link', () => {
    const waiting = renderToStaticMarkup(React.createElement(DashboardView, { data: { ...data, series: { ...data.series, has_data: false } } }));
    expect(waiting).toContain(D.waiting);
    const none = renderToStaticMarkup(React.createElement(DashboardPage, { initial: { state: 'no_session' } }));
    expect(none).toContain('href="/family"');
    const ok = renderToStaticMarkup(
      React.createElement(DashboardPage, { initial: { state: 'ok', data, childId: 'kid-1', children: [{ id: 'kid-1', nickname: 'Jiwoo' }] } })
    );
    expect(ok).toContain(D.title('Jiwoo'));
    expect(ok).toContain('href="/window?child=kid-1"');
    expect(ok).toContain(D.nextLesson('11월 19일 목요일 17:30'));
    const noWin = renderToStaticMarkup(
      React.createElement(DashboardPage, { initial: { state: 'ok', data: { ...data, lesson_window_on: false }, childId: 'kid-1', children: [{ id: 'kid-1', nickname: 'Jiwoo' }] } })
    );
    expect(noWin).not.toContain('/window?child=');
    expect(renderToStaticMarkup(React.createElement(App, { initialRoute: '/dashboard' }))).toContain('dashboard-page');
    const child: FamilyChild = {
      player_id: 'kid-1', nickname: 'Jiwoo', level: 'L2', birth_year: 2016,
      consents: { voice_store: false, lesson_window: false, showroom_public: false, public_server: false, friend_voice: false },
      devices: [], lessons: 1, last_lesson_at: null, reports: []
    };
    const fam = renderToStaticMarkup(React.createElement(FamilyPage, { initial: { status: 'ok', me: { service_consented: true, children: [child] } }, initialToken: 'g' }));
    expect(fam).toContain('href="/dashboard?child=kid-1"');
  });

  it('helpers: 4-week change kinds and sentences, badges, headline without a base, KST week label', () => {
    expect(fourWeekChange(255, 150)).toEqual({ kind: 'up', from: 150, to: 255 });
    expect(fourWeekChange(100, 102)).toEqual({ kind: 'flat', from: 102, to: 100 });
    expect(fourWeekChange(50, 100).kind).toBe('down');
    expect(fourWeekChange(20, null).kind).toBe('new');
    expect(fourWeekChange(null, 100).kind).toBe('short');
    expect(changeLine({ kind: 'down', from: 100, to: 50 }, '단어')).toBe(D.lineDown('100단어', '50단어'));
    expect(changeBadge({ kind: 'up', from: 150, to: 255 }, '단어')).toBe(D.change4w('▲ 105단어'));
    expect(changeBadge({ kind: 'new' }, '단어')).toBe(D.changeNone);
    expect(headline('Jiwoo', [week(0, { free_words: 40 })])).toBe(D.headline('Jiwoo', 40));
    expect(headline('Jiwoo', [week(0)])).toBe(D.headlineNone);
    expect(weekLabel(W0)).toBe('8/31');
  });

  it('api: guardian bearer on the dashboard route', async () => {
    const seen: string[] = [];
    const fetch: FetchLike = async (url, init) => {
      seen.push(`${url} ${new Headers(init?.headers).get('authorization')}`);
      return new Response(JSON.stringify(data));
    };
    await createFamilyApi({ fetch }).dashboard('gtok', 'kid-1');
    expect(seen).toEqual(['/v1/family/children/kid-1/dashboard Bearer gtok']);
  });
});
