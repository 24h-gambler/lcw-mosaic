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
  });
});
