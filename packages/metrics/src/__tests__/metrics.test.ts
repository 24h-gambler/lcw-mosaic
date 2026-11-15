import { describe, expect, it } from 'vitest';
import {
  computeLessonMetrics,
  computeTeacherContribution,
  computeThinkAndSpeakIndex,
  computeTwoWeekBaseline,
  computeWeeklyMetrics,
  filterValidUtterances,
  verifyOrReplaceReportBody,
  type ExpressionMetricInput,
  type MemoryCardMetricInput,
  type UtteranceMetricInput
} from '../index.js';

function makeUtterance(
  id: string,
  overrides: Partial<UtteranceMetricInput> = {}
): UtteranceMetricInput {
  return {
    id,
    player_id: 'p1',
    session_id: 's1',
    session_kind: 'solo',
    ctx: 'cafe',
    mode: 'free',
    interlocutor: 'npc',
    final_text: 'May I have warm honey tea please',
    words: 7,
    l1_words: 0,
    dur_ms: 4000,
    latency_ms: 1500,
    stars: 3,
    hint_level: 'none',
    attempts: 1,
    score: 0.9,
    confidence: 0.92,
    created_at: 1_700_000_000_000,
    ...overrides
  };
}

describe('packages/metrics (WP-303, WP-308, WP-310)', () => {
  it('excludes STT confidence < 0.5 from counts, numerators, and denominators (docs/07 2.1)', () => {
    const samples: UtteranceMetricInput[] = [
      makeUtterance('u1', { mode: 'free', words: 6, confidence: 0.85 }),
      makeUtterance('u2', { mode: 'read', words: 2, confidence: 0.49 }),
      makeUtterance('u3', { mode: 'free', words: 8, confidence: 0.5 })
    ];

    const filtered = filterValidUtterances(samples);
    expect(filtered.valid).toHaveLength(2);
    expect(filtered.excludedCount).toBe(1);

    const metrics = computeWeeklyMetrics(samples);
    expect(metrics.total_valid_utterances).toBe(2);
    expect(metrics.excluded_low_confidence_count).toBe(1);
    expect(metrics.mean_words_per_utterance).toBe(7);
    expect(metrics.weekly_free_ratio).toBe(1);
  });

  it('returns insufficient_sample when fewer than 30 free utterances exist', () => {
    const samples = Array.from({ length: 29 }, (_, idx) =>
      makeUtterance(`u-${idx}`, { mode: 'free' })
    ).concat([makeUtterance('u-read', { mode: 'read' })]);

    const baseline = computeTwoWeekBaseline([]);
    const res = computeThinkAndSpeakIndex(samples, baseline);

    expect(res.status).toBe('insufficient_sample');
    expect(res.index).toBeNull();
    expect(res.freeCount).toBe(29);
    expect(res.requiredFreeCount).toBe(30);
  });

  it('computes the docs/07 2.1 index (six components, clamped) when >= 30 free utterances exist', () => {
    const samples = Array.from({ length: 35 }, (_, idx) =>
      makeUtterance(`u-${idx}`, {
        mode: 'free',
        final_text: idx % 2 === 0 ? 'Can I buy honey tea because I am cold' : 'I want a wooden shelter block',
        words: 6,
        latency_ms: 1500
      })
    );
    const baseline = { mean_words: 3, speech_wpm: 30, latency_per_word_ms: 500, connectors_per_100: 0, target_lang_ratio: 1, hint_free_ratio: 1, weeks: 2 };

    const res = computeThinkAndSpeakIndex(samples, baseline);
    expect(res.status).toBe('ready');
    expect(res.freeCount).toBe(35);
    // length 6 vs 3 → 2.0 (cap); speed 90 vs 30 wpm → 2.0 (cap); prep 250 vs 500 ms/word → 2.0; connectors vs a
    // floor of 1 per 100 words; target language and no-hint unchanged → 1.
    expect(res.components?.words.ratio).toBe(2);
    expect(res.components?.speed.ratio).toBe(2);
    expect(res.components?.prep.ratio).toBe(2);
    expect(res.components?.target_lang.ratio).toBe(1);
    expect(res.components?.hint_free.ratio).toBe(1);
    expect(res.index).toBeLessThanOrEqual(200);
    const c = res.components!;
    const expected = 100 * (0.3 * 2 + 0.2 * 2 + 0.15 * 2 + 0.15 * c.connectors.ratio + 0.1 + 0.1);
    expect(res.index).toBeCloseTo(expected, 0);
  });

  it('the week that sets the baseline scores 100; a component at zero in both stays neutral', () => {
    const week = Array.from({ length: 40 }, (_, i) => makeUtterance(`w-${i}`, { final_text: 'I want a wooden shelter block', words: 6 }));
    const baseline = computeTwoWeekBaseline([computeWeeklyMetrics(week), computeWeeklyMetrics(week)]);
    expect(baseline.connectors_per_100).toBe(0);
    const res = computeThinkAndSpeakIndex(week, baseline);
    expect(res.index).toBe(100);
    expect(res.components?.connectors.ratio).toBe(1);
  });

  it('does not lower the prep-time term when sentences get longer at the same per-word latency (L1 -> L3)', () => {
    const l1 = Array.from({ length: 40 }, (_, i) =>
      makeUtterance(`a-${i}`, { mode: 'free', words: 3, latency_ms: 1200 })
    );
    const l3 = Array.from({ length: 40 }, (_, i) =>
      makeUtterance(`b-${i}`, { mode: 'free', words: 10, latency_ms: 4000 })
    );
    const baseline = computeTwoWeekBaseline([computeWeeklyMetrics(l1), computeWeeklyMetrics(l1)]);
    expect(baseline.latency_per_word_ms).toBe(400);

    const before = computeThinkAndSpeakIndex(l1, baseline);
    const after = computeThinkAndSpeakIndex(l3, baseline);
    expect(after.components?.prep.ratio).toBeGreaterThanOrEqual(before.components?.prep.ratio ?? 0);
    expect(after.components?.prep.ratio).toBe(1);
    // total index must not fall either: the length component rose
    expect(after.index ?? 0).toBeGreaterThanOrEqual(before.index ?? 0);
  });

  it('still rewards genuinely faster per-word preparation; no history → the neutral default baseline', () => {
    const fast = Array.from({ length: 35 }, (_, i) =>
      makeUtterance(`f-${i}`, { mode: 'free', words: 5, latency_ms: 500 })
    );
    const res = computeThinkAndSpeakIndex(fast, { ...computeTwoWeekBaseline([]), latency_per_word_ms: 500 });
    // baseline 500 ms/word vs now 100 ms/word -> ratio clamped to 2
    expect(res.components?.prep.ratio).toBe(2);
    expect(computeTwoWeekBaseline([]).weeks).toBe(0);
  });

  it('calculates teacher contribution rates: 14-day solo transfer and 35-day retention', () => {
    const t0 = 1_700_000_000_000;
    const day = 86_400_000;
    const expressions: ExpressionMetricInput[] = [
      {
        id: 'e1',
        player_id: 'p1',
        lemma_key: 'would_like',
        first_seen_at: t0,
        born_in: 'lesson',
        lesson_id: 'L1',
        reuse_solo: 2,
        reuse_in_lesson: 1,
        last_used_at: t0 + 5 * day
      },
      {
        id: 'e2',
        player_id: 'p1',
        lemma_key: 'extra_sweet',
        first_seen_at: t0,
        born_in: 'lesson',
        lesson_id: 'L1',
        reuse_solo: 1,
        reuse_in_lesson: 0,
        last_used_at: t0 + 20 * day // outside 14d window
      }
    ];
    const cards: MemoryCardMetricInput[] = [
      {
        id: 'c1',
        player_id: 'p1',
        origin: 'lesson',
        lesson_id: 'L1',
        box: 4,
        next_review_at: t0 + 40 * day,
        lapses: 0,
        created_at: t0,
        mastered_at: t0 + 36 * day
      },
      {
        id: 'c2',
        player_id: 'p1',
        origin: 'lesson',
        lesson_id: 'L1',
        box: 1,
        next_review_at: t0 + 2 * day,
        lapses: 2,
        created_at: t0,
        mastered_at: null
      }
    ];

    const contrib = computeTeacherContribution(expressions, cards, t0 + 40 * day);
    expect(contrib.lesson_born_expressions).toBe(2);
    expect(contrib.in_lesson_reuse_count).toBe(1);
    expect(contrib.solo_transfer_14d_rate).toBe(0.5);
    expect(contrib.mastery_retention_35d_rate).toBe(0.5);
  });

  it('computes lesson talk ratio, long silence minutes, and anchor task delta', () => {
    const lm = computeLessonMetrics(
      'L1',
      [
        { lesson_id: 'L1', minute: 1, student_ms: 40_000, teacher_ms: 20_000, exchanges: 6, activity: 'intro' },
        { lesson_id: 'L1', minute: 2, student_ms: 0, teacher_ms: 0, exchanges: 0, activity: 'pause' }
      ],
      [makeUtterance('u-lesson', { lesson_id: 'L1', session_kind: 'lesson', mode: 'recall' })],
      [
        { prompt_id: 'anchor-cafe', week: '2026-W10', words: 4, latency_ms: 3000, free_ratio: 0.4, unique_lemmas: 5 },
        { prompt_id: 'anchor-cafe', week: '2026-W14', words: 7, latency_ms: 1800, free_ratio: 0.75, unique_lemmas: 11 }
      ]
    );
    expect(lm.student_talk_ratio).toBeCloseTo(40_000 / 60_000, 4);
    expect(lm.long_silence_minutes).toBe(1);
    expect(lm.mode_breakdown.recall).toBe(1);
    expect(lm.anchor_deltas[0]?.words_delta).toBe(3);
    expect(lm.anchor_deltas[0]?.latency_ms_delta).toBe(-1200);
  });

  it('replaces report body if numbers are fabricated or causal claims appear (WP-308)', () => {
    const facts = {
      free_utterances: 42,
      total_valid_utterances: 60,
      weekly_free_ratio: 0.7,
      active_speaking_minutes: 18,
      mean_words_per_utterance: 5.5,
      think_speak_index: 124.5
    };

    const badNumber = verifyOrReplaceReportBody(
      facts,
      '이번 주 직접 말한 문장은 99건으로 크게 늘었습니다.'
    );
    expect(badNumber.ok).toBe(false);
    expect(badNumber.replaced).toBe(true);
    expect(badNumber.reasons).toContain('unverified_number:99');
    expect(badNumber.body).toContain('42건');

    const badCausal = verifyOrReplaceReportBody(
      facts,
      '선생님 덕분에 아이 지능이 좋아져 42건 말했습니다.'
    );
    expect(badCausal.ok).toBe(false);
    expect(badCausal.replaced).toBe(true);

    const good = verifyOrReplaceReportBody(
      facts,
      '이번 주 직접 만든 발화는 42건(70%)이며, 평균 단어 수는 5.5단어입니다.'
    );
    expect(good.ok).toBe(true);
    expect(good.replaced).toBe(false);
  });
});
