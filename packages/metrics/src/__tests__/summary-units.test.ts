import { describe, expect, it } from 'vitest';
import { buildFactualWeeklySummary, verifyOrReplaceReportBody, type ReportFacts } from '../index.js';

const facts = (active_speaking_minutes: number): ReportFacts => ({
  free_utterances: 1,
  total_valid_utterances: 3,
  weekly_free_ratio: 0.33,
  active_speaking_minutes,
  mean_words_per_utterance: 4,
  think_speak_index: null
});

describe('fact sentence uses the same unit as the fact table (docs/07 §5)', () => {
  it('under one minute it speaks in seconds, never "총 0분"', () => {
    const s = buildFactualWeeklySummary(facts(2 / 60));
    expect(s).toContain('총 2초');
    expect(s).not.toContain('0분');
  });
  it('a minute or more stays in minutes', () => {
    expect(buildFactualWeeklySummary(facts(12.4))).toContain('총 12분');
  });
  it('the template it falls back to passes its own number check', () => {
    for (const m of [0.04, 0.7, 3.2]) {
      const body = buildFactualWeeklySummary(facts(m));
      expect(verifyOrReplaceReportBody(facts(m), body).ok).toBe(true);
    }
  });
});
