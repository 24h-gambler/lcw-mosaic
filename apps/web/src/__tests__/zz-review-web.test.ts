// THROWAWAY review probe (scratch clone only)
import { describe, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReportBody, growthLine, lessonFactsOf } from '../ParentReportPage.js';

const strip = (h: string) => h.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, '|').replace(/\|+/g, '|');
const mk = (lesson: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  ({ kind: 'lesson', ref_id: 'x', facts: { lesson }, body: '', clips: [], created_at: Date.UTC(2026, 10, 16), expires_at: Date.UTC(2026, 11, 16), teacher_comment: '', next_lesson_at: '', ...extra }) as any;
const base = { lesson_day: '2026-11-16', lesson_number: 3, duration_min: 40, utterances: 8, passes: 6, free_words: 12, speaking_sec: 65, quotes: [], expressions: [], stages: [], summary_ko: '', previous: { utterances: 8, passes: 6, speaking_sec: 65, free_words: 12 }, home_practice: [] };
describe('web probe', () => {
  it('render', () => {
    const cases: Record<string, any> = {
      'all-same-as-prev': mk(base),
      'empty-everything(utt0)': mk({ ...base, utterances: 0, passes: 0, speaking_sec: 0, free_words: 0, previous: null }),
      'first': mk({ ...base, lesson_number: 1, previous: null }),
      'noPrevField(old report)': mk({ ...base, previous: undefined }),
      'prev-zero-free': mk({ ...base, free_words: 0, previous: { utterances: 9, passes: 7, speaking_sec: 62, free_words: 0 } })
    };
    for (const [k, r] of Object.entries(cases)) {
      const html = renderToStaticMarkup(React.createElement(ReportBody, { report: r }));
      const L = lessonFactsOf(r.facts)!;
      console.log(`### ${k}\nGROWTH: ${growthLine(L)}\n${strip(html).slice(0, 1400)}`);
    }
  });
});
