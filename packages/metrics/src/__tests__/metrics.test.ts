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

  it('computes clamped Think-and-Speak Index when >= 30 free utterances exist', () => {
    const samples = Array.from({ length: 35 }, (_, idx) =>
      makeUtterance(`u-${idx}`, {
        mode: 'free',
        final_text: idx % 2 === 0 ? 'Can I buy honey tea please' : 'I want a wooden shelter block',
        words: 6,
        latency_ms: 1500
      })
    );
    const baseline = {
      free_ratio: 0.5,
      mean_words: 3,
      lexical_diversity: 0.25,
      mean_latency_ms: 3000
    };

    const res = computeThinkAndSpeakIndex(samples, baseline);
    expect(res.status).toBe('ready');
    expect(res.freeCount).toBe(35);
    expect(res.index).not.toBeNull();
    // All component ratios are clamped to 2.0 max
    expect(res.components?.freeRatioClamped).toBe(2);
    expect(res.index).toBeLessThanOrEqual(200);
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
