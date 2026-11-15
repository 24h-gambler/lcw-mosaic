import {
  CONNECTORS,
  CONTENT_FILTERS,
  LEXICON_L1_KO_EN,
  OPEN_ENDED_PROMPTS,
  UI_STRINGS_KO,
  VOICE_SKILL_DATA,
  type LangLevel
} from '@lcw/content';
import type { NpcContext, UtteranceMode } from '@lcw/schemas';
import { normalizeMixedUtterance } from './normalizer.js';
import { tokenizeForScoring } from './scoring.js';

const LEVELS_ORDERED: readonly LangLevel[] = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'];

const CONTEXT_KEYWORDS: Record<string, string[]> = {
  cafe: ['drink', 'water', 'juice', 'tea', 'milk', 'smoothie', 'thirsty', 'hot', 'cold', 'sweet', 'tasty'],
  makers_lab: ['fly', 'build', 'space', 'fast', 'strong', 'mine', 'explore', 'fuel', 'jetpack', 'tool'],
  boutique: ['rain', 'wear', 'warm', 'cold', 'color', 'coat', 'style', 'look'],
  exchange: ['sell', 'gold', 'coin', 'ore', 'mine', 'price', 'more']
};

export function classifyUtteranceMode(params: {
  screenHasTargetSentence: boolean;
  usedBoardOrHintTags: boolean;
  isReviewRecall: boolean;
}): UtteranceMode {
  if (params.isReviewRecall) return 'recall';
  if (params.screenHasTargetSentence) return 'read';
  if (params.usedBoardOrHintTags) return 'guided';
  return 'free';
}

export function shouldTriggerOpenEndedQuestion(completedTurnsCount: number): boolean {
  return completedTurnsCount > 0 && completedTurnsCount % 5 === 0;
}

export function pickOpenEndedPrompt(completedTurnsCount: number): string {
  return OPEN_ENDED_PROMPTS[completedTurnsCount % OPEN_ENDED_PROMPTS.length]!;
}

/**
 * Evaluates optional open-ended follow-up ("한 마디 더", docs/04 4.10).
 * Always recorded as `free` mode; awards tip coins = min(40, targetWords * 2).
 */
export function evaluateOpenEndedAnswer(params: {
  level: LangLevel;
  ctx: NpcContext;
  transcript: string;
}): { pass: boolean; tipCoins: number; targetWordCount: number; mode: 'free' } {
  const tokens = tokenizeForScoring(params.transcript);
  const minWords = params.level === 'L1' || params.level === 'L2' ? 2 : 4;
  const ctxWords = CONTEXT_KEYWORDS[params.ctx] ?? [];
  const hasContextVocab =
    ctxWords.length === 0 || tokens.some((t) => ctxWords.includes(t)) || tokens.length >= minWords;

  const pass = tokens.length >= minWords && hasContextVocab;
  const tipCoins = pass ? Math.min(40, tokens.length * 2) : 0;
  return {
    pass,
    tipCoins,
    targetWordCount: tokens.length,
    mode: 'free'
  };
}

export interface AttemptOutcome {
  chosenStars: 1 | 2 | 3;
  attempts: number;
  passed: boolean;
}

/**
 * Automatic level adjustment across rolling 20 attempts (docs/04 4.3, WP-410).
 */
export function computeLevelAdjustment(params: {
  currentLevel: LangLevel;
  recent20: AttemptOutcome[];
  locked: boolean;
}): LangLevel {
  if (params.locked || params.recent20.length < 20) return params.currentLevel;

  const window = params.recent20.slice(-20);
  const threeStarFirstTry = window.filter(
    (a) => a.passed && a.chosenStars === 3 && a.attempts === 1
  ).length;
  const failedCount = window.filter((a) => !a.passed).length;

  const idx = LEVELS_ORDERED.indexOf(params.currentLevel);
  if (threeStarFirstTry / 20 >= 0.7 && idx < LEVELS_ORDERED.length - 1) {
    return LEVELS_ORDERED[idx + 1]!;
  }
  if (failedCount / 20 >= 0.4 && idx > 0) {
    return LEVELS_ORDERED[idx - 1]!;
  }
  return params.currentLevel;
}

export function initialLevelPlacement(params: {
  isAdult: boolean;
  firstThreeWordCounts?: number[];
}): LangLevel {
  if (params.isAdult) return 'L3';
  const counts = params.firstThreeWordCounts ?? [];
  if (counts.length < 3) return 'L1';
  const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
  if (avg >= 9) return 'L3';
  if (avg >= 4) return 'L2';
  return 'L1';
}

export interface VoiceSkillMatch {
  matched: boolean;
  verb: string | null;
  target: string | null;
  adjective: string | null;
  grade: 'word' | 'phrase' | 'sentence' | null;
}

/**
 * Rule-only voice skill matcher (docs/04 4.11 & WP-508). Zero server calls, <1ms latency.
 */
export function recognizeVoiceSkill(transcript: string): VoiceSkillMatch {
  const lower = transcript.toLowerCase();
  const tokens = tokenizeForScoring(transcript);

  const verb = VOICE_SKILL_DATA.verbs.find((v) => tokens.includes(v)) ?? null;
  if (!verb) {
    return { matched: false, verb: null, target: null, adjective: null, grade: null };
  }
  const target = VOICE_SKILL_DATA.targets.find((t) => tokens.includes(t)) ?? null;
  const adjective = VOICE_SKILL_DATA.adjectives.find((a) => tokens.includes(a)) ?? null;

  let hasConnectorClause = false;
  for (const conn of CONNECTORS) {
    const idx = lower.indexOf(conn);
    if (idx !== -1) {
      const after = tokenizeForScoring(lower.slice(idx + conn.length));
      if (after.length >= 3) {
        hasConnectorClause = true;
        break;
      }
    }
  }

  let grade: 'word' | 'phrase' | 'sentence' = 'word';
  if (hasConnectorClause && target) grade = 'sentence';
  else if (target) grade = 'phrase';

  return { matched: true, verb, target, adjective, grade };
}

/** Korean name + vocative suffix (지우야, 민준아): addressing a friend, not a language-mix. */
const VOCATIVE_NAME_RE = /^[가-힣]{1,4}[야아]$/;

export interface SpeechBubbleCheckResult {
  allowed: boolean;
  text: string;
  targetLangRatio: number;
  reason?: string;
  hintKo?: string;
  /** True when Korean words were swapped for English via the dictionary before sending. */
  substituted?: boolean;
  /** Shown on the sender's own screen when the text was substituted (language-pack string). */
  noticeKo?: string;
}

/**
 * Multiplayer speech bubble filter (docs/04 4.12 & WP-502).
 * Profanity and PII are hard blocks. Korean words are first substituted with English via the
 * 4.4 dictionary (normalizeMixedUtterance) and the substituted text is sent with a notice for
 * the sender; only a bubble still <70% target language after substitution is blocked.
 * Korean vocative names (e.g. 지우야) are left as-is and excluded from the ratio.
 */
export function filterSpeechBubble(transcript: string): SpeechBubbleCheckResult {
  const trimmed = transcript.trim();
  if (!trimmed) {
    return { allowed: false, text: '', targetLangRatio: 0, reason: 'empty', hintKo: '말을 입력해 주세요.' };
  }

  for (const pat of CONTENT_FILTERS.piiPatterns) {
    if (pat.test(trimmed)) {
      return {
        allowed: false,
        text: '',
        targetLangRatio: 0,
        reason: 'pii',
        hintKo: '전화번호나 이메일 같은 개인정보는 보낼 수 없어요.'
      };
    }
  }

  const lower = trimmed.toLowerCase();
  for (const bad of CONTENT_FILTERS.profanity) {
    if (lower.includes(bad)) {
      return {
        allowed: false,
        text: '',
        targetLangRatio: 0,
        reason: 'profanity',
        hintKo: '바르고 고운 말로 다시 말해 주세요.'
      };
    }
  }

  const norm = normalizeMixedUtterance(trimmed, { keepUnknownKorean: true });
  const substituted = norm.replacedCount > 0;
  const endPunct = /[.!?]+$/.exec(trimmed)?.[0] ?? '';
  const sendText = norm.normalized + (substituted ? endPunct : '');
  const outText = substituted ? sendText : trimmed;

  const words = (substituted ? norm.tokens : trimmed.replace(/[.,!?]+/g, ' ').split(/\s+/).filter(Boolean));
  let englishCount = 0;
  let counted = 0;
  let firstKoWord: string | null = null;
  for (const w of words) {
    if (/^[A-Za-z0-9'-]+$/.test(w)) {
      englishCount++;
      counted++;
    } else if (VOCATIVE_NAME_RE.test(w)) {
      continue;
    } else {
      counted++;
      if (firstKoWord === null) firstKoWord = w;
    }
  }

  const ratio = counted > 0 ? Number((englishCount / counted).toFixed(4)) : 0;
  if (ratio < 0.7) {
    const suggestion = firstKoWord ? LEXICON_L1_KO_EN[firstKoWord] : undefined;
    return {
      allowed: false,
      text: '',
      targetLangRatio: ratio,
      reason: 'target_language_ratio_below_70',
      hintKo: suggestion
        ? `목표 언어로 말해 보세요 (${firstKoWord} → ${suggestion})`
        : '목표 언어로 말해 보세요'
    };
  }

  return substituted
    ? {
        allowed: true,
        text: outText,
        targetLangRatio: ratio,
        substituted: true,
        noticeKo: UI_STRINGS_KO.player.bubbleSubstituted
      }
    : { allowed: true, text: outText, targetLangRatio: ratio };
}
