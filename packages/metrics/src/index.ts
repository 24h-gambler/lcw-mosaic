import type { HintLevel, Interlocutor, SessionKind, UtteranceMode } from '@lcw/schemas';

export const METRICS_MIN_STT_CONFIDENCE = 0.5;
export const THINK_SPEAK_MIN_FREE_UTTERANCES = 30;
export const THINK_SPEAK_RATIO_MIN = 0.5;
export const THINK_SPEAK_RATIO_MAX = 2.0;
/** Per-word prep time floor (ms/word) so near-zero latencies cannot blow up the ratio. */
export const THINK_SPEAK_MIN_LATENCY_PER_WORD_MS = 50;
const DAY_MS = 86_400_000;
export const SOLO_TRANSFER_WINDOW_MS = 14 * DAY_MS;
export const MASTERY_RETENTION_WINDOW_MS = 35 * DAY_MS;

export interface UtteranceMetricInput {
  id: string;
  player_id: string;
  session_id: string;
  session_kind: SessionKind;
  ctx: string;
  mode: UtteranceMode;
  interlocutor: Interlocutor;
  final_text: string;
  words: number;
  l1_words: number;
  dur_ms: number;
  latency_ms: number;
  stars: number;
  hint_level: HintLevel;
  attempts: number;
  score: number;
  confidence: number;
  created_at: number;
  lesson_id?: string | null;
}

export interface LessonMinuteInput {
  lesson_id: string;
  minute: number;
  student_ms: number;
  teacher_ms: number;
  exchanges: number;
  activity: string;
}

export interface MemoryCardMetricInput {
  id: string;
  player_id: string;
  origin: string;
  lesson_id?: string | null;
  box: number;
  next_review_at: number;
  lapses: number;
  created_at: number;
  mastered_at: number | null;
}

export interface ExpressionMetricInput {
  id: string;
  player_id: string;
  lemma_key: string;
  first_seen_at: number;
  born_in: string;
  lesson_id: string | null;
  reuse_solo: number;
  reuse_in_lesson?: number;
  last_used_at: number | null;
}

export interface AnchorTaskSample {
  prompt_id: string;
  week: string;
  words: number;
  latency_ms: number;
  free_ratio: number;
  unique_lemmas: number;
}

/** 14 weekly growth metrics defined by docs/07 */
export interface WeeklyGrowthMetrics {
  weekly_free_ratio: number;
  free_utterance_count: number;
  total_valid_utterances: number;
  excluded_low_confidence_count: number;
  mean_words_per_utterance: number;
  lexical_diversity: number;
  mean_response_latency_ms: number;
  /** Mean of latency_ms / max(1, words) per utterance (docs/07 2.1: preparation time per word). */
  mean_latency_per_word_ms: number;
  first_try_pass_rate: number;
  mean_stars: number;
  recall_retention_rate: number;
  l1_mixing_ratio: number;
  peer_dialogue_count: number;
  repair_success_rate: number;
  hint_independence_rate: number;
  active_speaking_minutes: number;
}

export interface ThinkSpeakBaseline {
  free_ratio: number;
  mean_words: number;
  lexical_diversity: number;
  mean_latency_ms: number;
  /** Baseline preparation time per word. Derived from mean_latency_ms / mean_words when absent. */
  mean_latency_per_word_ms?: number;
}

export interface ThinkAndSpeakResult {
  status: 'insufficient_sample' | 'ready';
  index: number | null;
  freeCount: number;
  requiredFreeCount: number;
  components: {
    freeRatioClamped: number;
    wordsClamped: number;
    lexicalClamped: number;
    latencyClamped: number;
  } | null;
}

export interface LessonMetrics {
  lesson_id: string;
  student_ms: number;
  teacher_ms: number;
  student_talk_ratio: number;
  exchanges: number;
  long_silence_minutes: number;
  mode_breakdown: Record<UtteranceMode, number>;
  anchor_deltas: Array<{
    prompt_id: string;
    from_week: string;
    to_week: string;
    words_delta: number;
    latency_ms_delta: number;
    free_ratio_delta: number;
    unique_lemmas_delta: number;
  }>;
}

export interface TeacherContributionMetrics {
  lesson_born_expressions: number;
  in_lesson_reuse_count: number;
  solo_transfer_14d_rate: number;
  mastery_retention_35d_rate: number;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function roundTo(v: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(v * factor) / factor;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid] ?? 0;
  }
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

export function extractUniqueTokens(text: string): string[] {
  const matches = text.toLowerCase().match(/[a-z0-9']+/g);
  return matches ?? [];
}

/**
 * Excludes any utterance whose STT confidence is below 0.5 (docs/07 2.1).
 */
export function filterValidUtterances(
  utterances: readonly UtteranceMetricInput[]
): {
  valid: UtteranceMetricInput[];
  excludedCount: number;
} {
  const valid: UtteranceMetricInput[] = [];
  let excludedCount = 0;
  for (const u of utterances) {
    if (u.confidence >= METRICS_MIN_STT_CONFIDENCE) {
      valid.push(u);
    } else {
      excludedCount += 1;
    }
  }
  return { valid, excludedCount };
}

export function computeWeeklyMetrics(
  utterances: readonly UtteranceMetricInput[],
  cards: readonly MemoryCardMetricInput[] = []
): WeeklyGrowthMetrics {
  const { valid, excludedCount } = filterValidUtterances(utterances);
  const total = valid.length;
  if (total === 0) {
    return {
      weekly_free_ratio: 0,
      free_utterance_count: 0,
      total_valid_utterances: 0,
      excluded_low_confidence_count: excludedCount,
      mean_words_per_utterance: 0,
      lexical_diversity: 0,
      mean_response_latency_ms: 0,
      mean_latency_per_word_ms: 0,
      first_try_pass_rate: 0,
      mean_stars: 0,
      recall_retention_rate: 0,
      l1_mixing_ratio: 0,
      peer_dialogue_count: 0,
      repair_success_rate: 0,
      hint_independence_rate: 0,
      active_speaking_minutes: 0
    };
  }

  let freeCount = 0;
  let sumWords = 0;
  let sumL1Words = 0;
  let sumLatency = 0;
  let sumLatencyPerWord = 0;
  let sumDur = 0;
  let firstTryTotal = 0;
  let firstTryPass = 0;
  let starredCount = 0;
  let sumStars = 0;
  let recallTotal = 0;
  let recallPass = 0;
  let peerCount = 0;
  let retryTotal = 0;
  let retrySuccess = 0;
  let independentCount = 0;

  const uniqueTokens = new Set<string>();
  let totalTokens = 0;

  for (const u of valid) {
    if (u.mode === 'free') freeCount += 1;
    if (u.interlocutor === 'peer') peerCount += 1;
    if (u.hint_level === 'none' || u.hint_level === 'picture') independentCount += 1;

    sumWords += Math.max(0, u.words);
    sumL1Words += Math.max(0, u.l1_words);
    sumLatency += Math.max(0, u.latency_ms);
    sumLatencyPerWord += Math.max(0, u.latency_ms) / Math.max(1, u.words);
    sumDur += Math.max(0, u.dur_ms);

    const tokens = extractUniqueTokens(u.final_text);
    for (const tok of tokens) {
      uniqueTokens.add(tok);
    }
    totalTokens += tokens.length > 0 ? tokens.length : Math.max(0, u.words);

    if (u.attempts >= 1) {
      if (u.attempts === 1) {
        firstTryTotal += 1;
        if (u.stars >= 1 || u.score >= 0.6) firstTryPass += 1;
      } else {
        retryTotal += 1;
        if (u.stars >= 1 || u.score >= 0.6) retrySuccess += 1;
      }
    }

    if (u.stars > 0) {
      starredCount += 1;
      sumStars += u.stars;
    }

    if (u.mode === 'recall') {
      recallTotal += 1;
      if (u.stars >= 1 || u.score >= 0.6) recallPass += 1;
    }
  }

  // Incorporate card review retention when recall utterances aren't recorded separately
  let recallRate = recallTotal > 0 ? recallPass / recallTotal : 0;
  if (recallTotal === 0 && cards.length > 0) {
    const cleanCards = cards.filter((c) => c.lapses === 0 || c.mastered_at !== null).length;
    recallRate = cleanCards / cards.length;
  }

  return {
    weekly_free_ratio: roundTo(freeCount / total, 4),
    free_utterance_count: freeCount,
    total_valid_utterances: total,
    excluded_low_confidence_count: excludedCount,
    mean_words_per_utterance: roundTo(sumWords / total, 2),
    lexical_diversity: totalTokens > 0 ? roundTo(uniqueTokens.size / totalTokens, 4) : 0,
    mean_response_latency_ms: Math.round(sumLatency / total),
    mean_latency_per_word_ms: Math.round(sumLatencyPerWord / total),
    first_try_pass_rate: firstTryTotal > 0 ? roundTo(firstTryPass / firstTryTotal, 4) : 0,
    mean_stars: starredCount > 0 ? roundTo(sumStars / starredCount, 2) : 0,
    recall_retention_rate: roundTo(recallRate, 4),
    l1_mixing_ratio:
      sumWords + sumL1Words > 0 ? roundTo(sumL1Words / (sumWords + sumL1Words), 4) : 0,
    peer_dialogue_count: peerCount,
    repair_success_rate: retryTotal > 0 ? roundTo(retrySuccess / retryTotal, 4) : 0,
    hint_independence_rate: roundTo(independentCount / total, 4),
    active_speaking_minutes: roundTo(sumDur / 60_000, 2)
  };
}

export function computeTwoWeekBaseline(
  firstTwoWeeks: readonly WeeklyGrowthMetrics[]
): ThinkSpeakBaseline {
  if (firstTwoWeeks.length === 0) {
    return {
      free_ratio: 0.4,
      mean_words: 4,
      lexical_diversity: 0.5,
      mean_latency_ms: 3000,
      mean_latency_per_word_ms: 750
    };
  }
  const slice = firstTwoWeeks.slice(0, 2);
  return {
    free_ratio: Math.max(0.05, median(slice.map((w) => w.weekly_free_ratio))),
    mean_words: Math.max(1, median(slice.map((w) => w.mean_words_per_utterance))),
    lexical_diversity: Math.max(0.1, median(slice.map((w) => w.lexical_diversity))),
    mean_latency_ms: Math.max(300, median(slice.map((w) => w.mean_response_latency_ms))),
    mean_latency_per_word_ms: Math.max(
      THINK_SPEAK_MIN_LATENCY_PER_WORD_MS,
      median(slice.map((w) => w.mean_latency_per_word_ms))
    )
  };
}

/**
 * Think-and-Speak Index (docs/07 2.1):
 * - Excludes confidence < 0.5
 * - Requires >= 30 valid 'free' utterances; otherwise returns insufficient_sample
 * - Latency term uses per-word preparation time (latency_ms / words), not raw latency
 * - Clamps component ratios against first-2-week baseline to [0.5, 2.0]
 */
export function computeThinkAndSpeakIndex(
  utterances: readonly UtteranceMetricInput[],
  baseline: ThinkSpeakBaseline
): ThinkAndSpeakResult {
  const weekly = computeWeeklyMetrics(utterances);
  if (weekly.free_utterance_count < THINK_SPEAK_MIN_FREE_UTTERANCES) {
    return {
      status: 'insufficient_sample',
      index: null,
      freeCount: weekly.free_utterance_count,
      requiredFreeCount: THINK_SPEAK_MIN_FREE_UTTERANCES,
      components: null
    };
  }

  const freeRatioClamped = clamp(
    weekly.weekly_free_ratio / Math.max(0.05, baseline.free_ratio),
    THINK_SPEAK_RATIO_MIN,
    THINK_SPEAK_RATIO_MAX
  );
  const wordsClamped = clamp(
    weekly.mean_words_per_utterance / Math.max(1, baseline.mean_words),
    THINK_SPEAK_RATIO_MIN,
    THINK_SPEAK_RATIO_MAX
  );
  const lexicalClamped = clamp(
    weekly.lexical_diversity / Math.max(0.1, baseline.lexical_diversity),
    THINK_SPEAK_RATIO_MIN,
    THINK_SPEAK_RATIO_MAX
  );
  // Preparation time PER WORD, not raw latency: longer, harder sentences must not be penalised.
  const baselinePerWord = Math.max(
    THINK_SPEAK_MIN_LATENCY_PER_WORD_MS,
    baseline.mean_latency_per_word_ms ??
      baseline.mean_latency_ms / Math.max(1, baseline.mean_words)
  );
  const latencyClamped = clamp(
    baselinePerWord /
      Math.max(THINK_SPEAK_MIN_LATENCY_PER_WORD_MS, weekly.mean_latency_per_word_ms),
    THINK_SPEAK_RATIO_MIN,
    THINK_SPEAK_RATIO_MAX
  );

  const composite =
    0.35 * freeRatioClamped +
    0.25 * wordsClamped +
    0.2 * lexicalClamped +
    0.2 * latencyClamped;

  return {
    status: 'ready',
    index: roundTo(composite * 100, 1),
    freeCount: weekly.free_utterance_count,
    requiredFreeCount: THINK_SPEAK_MIN_FREE_UTTERANCES,
    components: {
      freeRatioClamped: roundTo(freeRatioClamped, 3),
      wordsClamped: roundTo(wordsClamped, 3),
      lexicalClamped: roundTo(lexicalClamped, 3),
      latencyClamped: roundTo(latencyClamped, 3)
    }
  };
}

export function computeLessonMetrics(
  lessonId: string,
  minutes: readonly LessonMinuteInput[],
  utterances: readonly UtteranceMetricInput[],
  anchorSamples: readonly AnchorTaskSample[] = []
): LessonMetrics {
  const lessonMinutes = minutes.filter((m) => m.lesson_id === lessonId);
  let studentMs = 0;
  let teacherMs = 0;
  let exchanges = 0;
  let longSilenceMinutes = 0;

  for (const m of lessonMinutes) {
    studentMs += Math.max(0, m.student_ms);
    teacherMs += Math.max(0, m.teacher_ms);
    exchanges += Math.max(0, m.exchanges);
    if (m.exchanges === 0 && m.student_ms === 0) {
      longSilenceMinutes += 1;
    }
  }

  const { valid } = filterValidUtterances(
    utterances.filter((u) => u.lesson_id === lessonId || u.session_kind === 'lesson')
  );
  const modeBreakdown: Record<UtteranceMode, number> = {
    free: 0,
    guided: 0,
    read: 0,
    recall: 0
  };
  for (const u of valid) {
    modeBreakdown[u.mode] += 1;
  }

  const byPrompt = new Map<string, AnchorTaskSample[]>();
  for (const sample of anchorSamples) {
    const arr = byPrompt.get(sample.prompt_id) ?? [];
    arr.push(sample);
    byPrompt.set(sample.prompt_id, arr);
  }
  const anchorDeltas: LessonMetrics['anchor_deltas'] = [];
  for (const [promptId, list] of byPrompt) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => a.week.localeCompare(b.week));
    const first = sorted[0]!;
    const last = sorted[sorted.length - 1]!;
    anchorDeltas.push({
      prompt_id: promptId,
      from_week: first.week,
      to_week: last.week,
      words_delta: roundTo(last.words - first.words, 2),
      latency_ms_delta: Math.round(last.latency_ms - first.latency_ms),
      free_ratio_delta: roundTo(last.free_ratio - first.free_ratio, 4),
      unique_lemmas_delta: last.unique_lemmas - first.unique_lemmas
    });
  }

  const totalVoiceMs = studentMs + teacherMs;
  return {
    lesson_id: lessonId,
    student_ms: studentMs,
    teacher_ms: teacherMs,
    student_talk_ratio: totalVoiceMs > 0 ? roundTo(studentMs / totalVoiceMs, 4) : 0,
    exchanges,
    long_silence_minutes: longSilenceMinutes,
    mode_breakdown: modeBreakdown,
    anchor_deltas: anchorDeltas
  };
}

export function computeTeacherContribution(
  expressions: readonly ExpressionMetricInput[],
  cards: readonly MemoryCardMetricInput[],
  nowMs: number
): TeacherContributionMetrics {
  const lessonBorn = expressions.filter((e) => e.born_in === 'lesson' || e.lesson_id !== null);
  const inLessonReuseCount = lessonBorn.filter((e) => (e.reuse_in_lesson ?? 0) >= 1).length;

  const soloTransferred = lessonBorn.filter(
    (e) =>
      e.reuse_solo >= 1 &&
      e.last_used_at !== null &&
      e.last_used_at >= e.first_seen_at &&
      e.last_used_at - e.first_seen_at <= SOLO_TRANSFER_WINDOW_MS
  ).length;

  const lessonCards = cards.filter((c) => c.origin === 'lesson' || Boolean(c.lesson_id));
  const retained35d = lessonCards.filter(
    (c) =>
      c.mastered_at !== null ||
      (c.box >= 3 && c.lapses === 0 && nowMs - c.created_at >= MASTERY_RETENTION_WINDOW_MS)
  ).length;

  return {
    lesson_born_expressions: lessonBorn.length,
    in_lesson_reuse_count: inLessonReuseCount,
    solo_transfer_14d_rate:
      lessonBorn.length > 0 ? roundTo(soloTransferred / lessonBorn.length, 4) : 0,
    mastery_retention_35d_rate:
      lessonCards.length > 0 ? roundTo(retained35d / lessonCards.length, 4) : 0
  };
}

export interface ReportFacts {
  free_utterances: number;
  total_valid_utterances: number;
  weekly_free_ratio: number;
  active_speaking_minutes: number;
  mean_words_per_utterance: number;
  think_speak_index: number | null;
  new_expressions?: number;
  solo_reused_expressions?: number;
  notes?: string;
}

const BANNED_CAUSAL_OR_DIAGNOSTIC_TERMS = [
  '덕분에',
  '때문에 향상',
  '천재',
  '영재',
  '지능',
  '치료',
  '결함',
  '장애',
  '무조건',
  '100% 보장',
  '완벽 마스터'
];

export function buildFactualWeeklySummary(facts: ReportFacts): string {
  const freePct = Math.round(facts.weekly_free_ratio * 100);
  const mins = Math.round(facts.active_speaking_minutes);
  const indexPart =
    facts.think_speak_index !== null
      ? `스스로 문장 지수는 ${facts.think_speak_index}입니다.`
      : '스스로 발화 표본이 30문장 미만이라 지수는 표본 수집 중입니다.';

  return [
    `이번 주 인식된 발화는 ${facts.total_valid_utterances}건(총 ${mins}분)이며, 직접 만들어 말한 발화는 ${facts.free_utterances}건(${freePct}%)입니다.`,
    `문장당 평균 단어 수는 ${facts.mean_words_per_utterance}단어입니다.`,
    indexPart
  ].join(' ');
}

function collectAllowedFactNumbers(facts: ReportFacts): Set<string> {
  const nums = [
    facts.free_utterances,
    facts.total_valid_utterances,
    facts.weekly_free_ratio,
    Math.round(facts.weekly_free_ratio * 100),
    roundTo(facts.weekly_free_ratio * 100, 1),
    facts.active_speaking_minutes,
    Math.round(facts.active_speaking_minutes),
    facts.mean_words_per_utterance,
    Math.round(facts.mean_words_per_utterance),
    THINK_SPEAK_MIN_FREE_UTTERANCES
  ];
  if (facts.think_speak_index !== null) {
    nums.push(facts.think_speak_index, Math.round(facts.think_speak_index));
  }
  if (facts.new_expressions !== undefined) nums.push(facts.new_expressions);
  if (facts.solo_reused_expressions !== undefined) nums.push(facts.solo_reused_expressions);

  const allowed = new Set<string>();
  for (const n of nums) {
    if (Number.isFinite(n)) {
      allowed.add(String(n));
    }
  }
  return allowed;
}

/**
 * Verifies LLM-drafted report prose against numerical facts and non-causal language rules (WP-308, docs/07 5).
 * Automatically replaces any unverified or causal draft with deterministic factual Korean prose.
 */
export function verifyOrReplaceReportBody(
  facts: ReportFacts,
  draftBody: string
): {
  ok: boolean;
  replaced: boolean;
  reasons: string[];
  body: string;
} {
  const reasons: string[] = [];
  const trimmed = draftBody.trim();
  if (trimmed.length < 10) {
    reasons.push('draft_too_short');
  }

  for (const banned of BANNED_CAUSAL_OR_DIAGNOSTIC_TERMS) {
    if (trimmed.includes(banned)) {
      reasons.push(`banned_term:${banned}`);
    }
  }

  const allowedNumbers = collectAllowedFactNumbers(facts);
  const numericMatches = trimmed.match(/\d+(?:\.\d+)?/g) ?? [];
  for (const numStr of numericMatches) {
    if (!allowedNumbers.has(numStr)) {
      reasons.push(`unverified_number:${numStr}`);
    }
  }

  if (reasons.length > 0) {
    return {
      ok: false,
      replaced: true,
      reasons,
      body: buildFactualWeeklySummary(facts)
    };
  }

  return {
    ok: true,
    replaced: false,
    reasons: [],
    body: trimmed
  };
}

export * from './bookmarks.js';
