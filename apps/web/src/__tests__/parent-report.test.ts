import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ParentReportPage, lessonDayLabel, lessonFactsOf, speakingTimeLabel } from '../ParentReportPage.js';
import { PARENT_STRINGS_KO } from '../parentStrings.js';
import type { SharedReport } from '../lessonApi.js';
import { describe, expect, it } from 'vitest';
import { createLessonApi, type FetchLike } from '../lessonApi.js';
import { reportFactRows } from '../lessonFlow.js';

describe('report preview (director) is not a parent open', () => {
  it('getReport with the operator token asks for ?preview=1 and sends the token; without it, neither', async () => {
    const seen: Array<{ url: string; auth: string | null }> = [];
    const fetch: FetchLike = async (url, init) => {
      seen.push({ url, auth: new Headers(init?.headers).get('authorization') });
      return new Response(JSON.stringify({ kind: 'lesson', ref_id: 'l', facts: {}, body: '', clips: [], created_at: 1 }));
    };
    const api = createLessonApi({ fetch });
    await api.getReport('tok123', 'op-secret');
    await api.getReport('tok123');
    expect(seen).toEqual([
      { url: '/v1/reports/tok123?preview=1', auth: 'Bearer op-secret' },
      { url: '/v1/reports/tok123', auth: null }
    ]);
  });
});

describe('report table never contradicts the summary sentence', () => {
  // Shape the server sends for a first lesson: weekly aggregates count only valid utterances
  // (7 s, 4 sentences) while this lesson's facts count every attempt (10 s, 5 times).
  const facts = {
    active_speaking_minutes: 0.12,
    total_valid_utterances: 4,
    free_utterances: 4,
    weekly_free_ratio: 1,
    lesson: { utterances: 5, passes: 3, speaking_sec: 10, free_words: 19, hintless_passes: 2, stars_total: 7, longest_words: 9 }
  };
  const body = '이번 수업에서 영어로 5번 말했고 그중 3번 통과했습니다. 직접 말한 시간은 10초입니다. 대본 없이 말한 단어는 19개입니다.';

  it('with facts.lesson the table shows only this lesson, and its shared numbers equal the sentence', () => {
    const rows = reportFactRows(facts);
    const by = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    expect(rows.every((r) => r.key.startsWith('lesson.'))).toBe(true);
    expect(by['lesson.speaking_sec']).toBe('10초');
    expect(by['lesson.utterances']).toBe('5번');
    expect(by['lesson.passes']).toBe('3번');
    expect(by['lesson.free_words']).toBe('19단어');
    for (const k of ['speaking_sec', 'utterances', 'passes', 'free_words'] as const) {
      expect(body).toContain(String(facts.lesson[k]));
    }
    expect(rows.map((r) => r.value).join(' ')).not.toContain('7초');
  });

  it('minutes read the same way as the sentence (N분 M초)', () => {
    const v = (s: number) => reportFactRows({ lesson: { ...facts.lesson, speaking_sec: s } }).find((r) => r.key === 'lesson.speaking_sec')!.value;
    expect(v(125)).toBe('2분 5초');
    expect(v(120)).toBe('2분');
    expect(v(0)).toBe('0초');
  });

  it('a report without lesson facts (weekly) keeps the weekly table', () => {
    expect(reportFactRows({ active_speaking_minutes: 0.04 })[0]!.key).toBe('active_speaking_minutes');
const P = PARENT_STRINGS_KO.report;
const lessonReport = (over: Record<string, unknown> = {}): SharedReport => ({
  kind: 'lesson',
  ref_id: 'les-1',
  facts: {
    free_utterances: 5,
    total_valid_utterances: 8,
    weekly_free_ratio: 0.625,
    active_speaking_minutes: 2.08,
    mean_words_per_utterance: 6.25,
    think_speak_index: null,
    lesson: {
      lesson_day: '2026-11-16',
      lesson_number: 1,
      duration_min: 118,
      utterances: 8,
      passes: 7,
      free_words: 28,
      speaking_sec: 125,
      quotes: [
        { text: 'I like drawing because it makes me happy', stars: 3, stage_title_ko: '인사와 고정 과제', hintless: true },
        { text: 'Can I have a warm honey tea', stars: 2, stage_title_ko: '카페 주문', hintless: false }
      ],
      expressions: ['so that'],
      stages: [{ id: 'cafe_order', title_ko: '카페 주문', utterances: 3, passes: 2 }],
      summary_ko: '이번 수업에서 영어로 8번 말했고 그중 7번 통과했습니다. 직접 말한 시간은 2분 5초입니다. 대본 없이 말한 단어는 28개입니다.',
      ...over
    }
  },
  body: '이번 수업에서 영어로 8번 말했고 그중 7번 통과했습니다. 직접 말한 시간은 2분 5초입니다. 대본 없이 말한 단어는 28개입니다.',
  clips: [],
  created_at: Date.parse('2026-11-16T08:10:00Z'),
  expires_at: Date.parse('2026-12-16T08:10:00Z'),
  teacher_comment: '카페 주문을 끝까지 영어로 했습니다.',
  next_lesson_at: '11월 19일 목요일 17:30'
});

describe('parent lesson report page (docs/08 §9.3)', () => {
  it('quotes first in the target-language font, stars as shapes + text, the numbers exactly as the fact sheet', () => {
    const html = renderToStaticMarkup(React.createElement(ParentReportPage, { token: 't', initial: { status: 'ok', report: lessonReport() } }));
    expect(html.indexOf(P.quotesTitle)).toBeLessThan(html.indexOf(P.numbersTitle));
    expect(html).toContain('<blockquote lang="en"');
    expect(html).toContain('I like drawing because it makes me happy');
    expect(html).toContain(`aria-label="${P.starsLabel(3)}"`);
    expect(html).toContain(P.hintless);
    // The page's time label is the same text the summary sentence uses
    expect(html).toContain('2분 5초');
    expect(html).toContain('8번');
    expect(html).toContain(P.attemptsNote(7));
    expect(html).toContain('28개');
    expect(html).toContain(P.firstLessonNote);
    expect(html).toContain('11월 16일 (월) 영어 수업');
    expect(html).toContain('카페 주문을 끝까지 영어로 했습니다.');
    expect(html).toContain('11월 19일 목요일 17:30');
    expect(html).toContain('role="meter"');
    expect(html).toContain('<details');
    expect(html).toContain(P.footerExpires('2026년 12월 16일'));
    const summary = lessonReport().body;
    for (const n of summary.match(/\d+/g) ?? []) expect(['8', '7', '2', '5', '28']).toContain(n);
  });

  it('no first-lesson note after the first lesson; no quotes → explicit line, not an empty box', () => {
    const html = renderToStaticMarkup(
      React.createElement(ParentReportPage, { token: 't', initial: { status: 'ok', report: lessonReport({ lesson_number: 2, quotes: [] }) } })
    );
    expect(html).not.toContain(P.firstLessonNote);
    expect(html).toContain(P.quotesEmpty);
  });

  it('preview banner only in preview; gone (410) has its own message', () => {
    const pv = renderToStaticMarkup(React.createElement(ParentReportPage, { token: 't', initial: { status: 'ok', report: lessonReport(), preview: true } }));
    expect(pv).toContain(P.previewBanner);
    const normal = renderToStaticMarkup(React.createElement(ParentReportPage, { token: 't', initial: { status: 'ok', report: lessonReport() } }));
    expect(normal).not.toContain(P.previewBanner);
    const gone = renderToStaticMarkup(React.createElement(ParentReportPage, { token: 't', initial: { status: 'gone' } }));
    expect(gone).toContain(P.goneTitle);
  });

  it('helpers: seconds split like the server, weekday label, old reports without facts.lesson fall back', () => {
    expect([2, 59, 60, 125, 1680].map(speakingTimeLabel)).toEqual(['2초', '59초', '1분', '2분 5초', '28분']);
    expect(lessonDayLabel('2026-11-19')).toBe('11월 19일 (목)');
    expect(lessonFactsOf({ free_utterances: 1 })).toBeNull();
    expect(lessonFactsOf({ lesson: { quotes: [{ text: '' }, { text: 'Hi there' }] } })!.quotes).toHaveLength(1);
  });
});
