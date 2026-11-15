import { CONNECTORS, FUNCTION_WORDS, LEVEL_DEFINITIONS, type LangLevel } from '@lcw/content';
import type { HintLevel } from '@lcw/schemas';

const CONTRACTION_MAP: Array<[RegExp, string]> = [
  [/\bi'm\b/gi, 'i am'],
  [/\bi'd\b/gi, 'i would'],
  [/\bi'll\b/gi, 'i will'],
  [/\bi've\b/gi, 'i have'],
  [/\bcan't\b/gi, 'cannot'],
  [/\bdon't\b/gi, 'do not'],
  [/\bdidn't\b/gi, 'did not'],
  [/\bwon't\b/gi, 'will not'],
  [/\bit's\b/gi, 'it is'],
  [/\bthat's\b/gi, 'that is'],
  [/\bwe'll\b/gi, 'we will'],
  [/\byou're\b/gi, 'you are'],
  [/\bisn't\b/gi, 'is not'],
  // Spoken forms speech recognisers write for children (docs/04 4.6 leniency, measured with Workers AI Whisper).
  [/\bwanna\b/gi, 'want to'],
  [/\bgonna\b/gi, 'going to'],
  [/\bgotta\b/gi, 'got to'],
  [/\bgimme\b/gi, 'give me'],
  [/\blemme\b/gi, 'let me'],
  [/\b(?:'cause|cuz|coz|becuz)\b/gi, 'because'],
  [/\b(?:plz|pls)\b/gi, 'please']
];

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

/**
 * How close a spoken word must be to the target word to count (docs/04 4.6 "관대하게"): Korean children and the
 * recogniser blur the same sounds (cold → "code"/"colt"/"gold", water → "warter", thirsty → "tursty"), and a plural
 * or third-person -s on the item word ("smoothies") must not lose the item. One edit on a sound key of 4+ letters.
 */
export const LENIENT_MATCH = { minKeyLength: 4, shortKeyLength: 3, maxEdits: 1, minFunctionWordLength: 5 } as const;

/** Sound key for Korean-English confusions: f/p, v/b, r/l, z/j/s, th → t, c/ck/q → k, silent final e, doubles. */
export function soundKey(word: string): string {
  let w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (w.length > 3 && /[^aeiou]e$/.test(w)) w = w.slice(0, -1);
  // final vowel sounds: smoothie / smoothy / smoothi; water / wata (a Korean 워터)
  w = w.replace(/(?:ie|ee|ey|y)$/, 'i');
  if (w.length >= 5) w = w.replace(/(?:er|or|ar)$/, 'a');
  w = w
    .replace(/ph/g, 'f')
    .replace(/th/g, 't')
    .replace(/ck|q/g, 'k')
    .replace(/c(?=[eiy])/g, 's')
    .replace(/c/g, 'k')
    .replace(/f/g, 'p')
    .replace(/v/g, 'b')
    .replace(/r/g, 'l')
    .replace(/[zj]/g, 's')
    .replace(/x/g, 'ks')
    .replace(/(.)\1+/g, '$1');
  return w;
}

function within(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    let rowMin = prev[0];
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j]!;
      prev[j] = Math.min(up + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
      rowMin = Math.min(rowMin, prev[j]!);
    }
    if (rowMin > max) return false;
  }
  return prev[b.length]! <= max;
}

function singular(w: string): string {
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && /(ches|shes|sses|xes)$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

/**
 * Does a spoken token count as the target token? Exact, the same number as a digit, the same word without a plural
 * -s, or one sound edit apart (keys of 4+ letters on one side, 3+ on the other, same first sound). Function words
 * shorter than 5 letters stay exact: "a"/"I" must not stand in for each other.
 */
export function wordsMatch(target: string, spoken: string): boolean {
  if (target === spoken) return true;
  const ti = NUMBER_WORDS.indexOf(target);
  if (ti >= 0 && spoken === String(ti)) return true;
  const si = NUMBER_WORDS.indexOf(spoken);
  if (si >= 0 && target === String(si)) return true;
  // short function words stay exact ("a"/"I", "is"/"it"); long ones blur like content words ("please", "because")
  const fn = (w: string) => FUNCTION_WORDS.has(w) && w.length < LENIENT_MATCH.minFunctionWordLength;
  if (fn(target) || fn(spoken)) return false;
  if (singular(target) === singular(spoken)) return true;
  const a = soundKey(singular(target));
  const b = soundKey(singular(spoken));
  if (a === b) return a.length >= LENIENT_MATCH.shortKeyLength;
  // one side may be a 3-letter key ("code" → kod for "cold" → kold), never both
  if (Math.max(a.length, b.length) < LENIENT_MATCH.minKeyLength || Math.min(a.length, b.length) < LENIENT_MATCH.shortKeyLength) return false;
  // the first sound must agree (or be a k/g, t/d, p/b pair): "cold"/"gold" yes, "water"/"later" no
  const pair = (x: string, y: string) => x === y || [x, y].sort().join('') === 'gk' || [x, y].sort().join('') === 'dt' || [x, y].sort().join('') === 'bp';
  if (!pair(a[0]!, b[0]!)) return false;
  return within(a, b, LENIENT_MATCH.maxEdits);
}

export function tokenizeForScoring(text: string): string[] {
  let out = text.toLowerCase();
  for (const [pattern, replacement] of CONTRACTION_MAP) {
    out = out.replace(pattern, replacement);
  }
  return out
    .replace(/-/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

export interface ScoringResult {
  pass: boolean;
  score: number;
  threshold: number;
  missed: string[];
  contentMatchRate: number;
  functionMatchRate: number;
  /** Core-pattern (hint_tags / connector / modal) match rate; 1 when the target has none. */
  coreMatchRate: number;
  /** Number of core-pattern tokens in the target sentence (0 => fallback weighting). */
  coreTotal: number;
  /** Highest star grade this utterance may be granted (docs/04 4.6: 3-star without core pattern caps at 2). */
  starCap: 1 | 2 | 3;
}

/** Score weights (docs/04 4.6). With no core-pattern tokens the legacy 0.8/0.2 split is used. */
export const SCORE_WEIGHTS = {
  core: 0.45,
  content: 0.45,
  function: 0.1,
  fallbackContent: 0.8,
  fallbackFunction: 0.2
} as const;

/** Modal openers that carry the politeness pattern even when hint_tags omit them. */
const MODAL_CORE_TOKENS = new Set(['could', 'would']);

function findPhrase(tokens: string[], phrase: string[]): number {
  outer: for (let i = 0; i + phrase.length <= tokens.length; i++) {
    for (let j = 0; j < phrase.length; j++) if (tokens[i + j] !== phrase[j]) continue outer;
    return i;
  }
  return -1;
}

/**
 * Marks which target token positions are core-pattern tokens.
 * - hint_tags that occur contiguously in the target and contain a function word or connector
 *   (e.g. "so that", "could you", "because", "if you offer") are core; pure content tags
 *   ("red jetpack") are not, since content words are already scored separately.
 * - Always core: CONNECTORS phrases and could/would found in the target (so a missing hint_tags
 *   list still protects connectors and polite modals).
 */
export function findCorePatternPositions(targetTokens: string[], hintTags: readonly string[] = []): Set<number> {
  const core = new Set<number>();
  const mark = (phrase: string[]) => {
    const at = findPhrase(targetTokens, phrase);
    if (at >= 0) for (let k = 0; k < phrase.length; k++) core.add(at + k);
  };
  for (const tag of hintTags) {
    const phrase = tokenizeForScoring(tag);
    if (phrase.length === 0) continue;
    if (phrase.some((w) => FUNCTION_WORDS.has(w) || CONNECTORS.some((c) => c.split(' ').includes(w)))) mark(phrase);
  }
  for (const c of CONNECTORS) {
    // single-word 'so'/'that' alone are too common; only multi-word connectors and the clear subordinators
    const phrase = c.split(' ');
    if (phrase.length === 1 && !['because', 'if', 'although', 'unless', 'when', 'before', 'after'].includes(c)) continue;
    mark(phrase);
  }
  targetTokens.forEach((w, i) => {
    if (MODAL_CORE_TOKENS.has(w)) core.add(i);
  });
  return core;
}

/**
 * Deterministic scoring formula from docs/04 4.6:
 * score = 0.45 * corePatternMatch + 0.45 * contentWordMatch + 0.10 * otherFunctionWordMatch
 * A 3-star target spoken without any core-pattern token is capped at 2 stars (starCap).
 */
export function scoreUtterance(params: {
  targetText: string;
  spokenTranscript: string;
  level: LangLevel;
  hintLevel?: HintLevel;
  /** Star grade of the target sentence being attempted (enables the 3-star core-pattern cap). */
  stars?: 1 | 2 | 3;
  /** hint_tags of the offer; their function/connector phrases are the core patterns. */
  hintTags?: readonly string[];
}): ScoringResult {
  const targetTokens = tokenizeForScoring(params.targetText);
  const spokenTokens = tokenizeForScoring(params.spokenTranscript);

  if (targetTokens.length === 0) {
    return {
      pass: false,
      score: 0,
      threshold: LEVEL_DEFINITIONS[params.level].passThreshold,
      missed: [],
      contentMatchRate: 0,
      functionMatchRate: 0,
      coreMatchRate: 0,
      coreTotal: 0,
      starCap: 1
    };
  }

  // Monotone subsequence alignment so word order matters while tolerating minor filler words
  let spokenCursor = 0;
  const matchedFlags = new Array<boolean>(targetTokens.length).fill(false);

  for (let ti = 0; ti < targetTokens.length; ti++) {
    const targetWord = targetTokens[ti]!;
    // the same word first, then a near one (a near match must not take a word another target word is spoken as)
    let at = spokenTokens.indexOf(targetWord, spokenCursor);
    if (at < 0) {
      for (let si = spokenCursor; si < spokenTokens.length; si++) {
        if (wordsMatch(targetWord, spokenTokens[si]!) && !targetTokens.includes(spokenTokens[si]!)) {
          at = si;
          break;
        }
      }
    }
    if (at >= 0) {
      matchedFlags[ti] = true;
      spokenCursor = at + 1;
    }
  }

  // Second pass for any out-of-order exact token matches (helps children with minor transposition)
  const spokenPool = [...spokenTokens];
  for (let ti = 0; ti < targetTokens.length; ti++) {
    if (matchedFlags[ti]) {
      const idx = spokenPool.findIndex((s) => wordsMatch(targetTokens[ti]!, s));
      if (idx >= 0) spokenPool.splice(idx, 1);
    }
  }
  for (let ti = 0; ti < targetTokens.length; ti++) {
    if (!matchedFlags[ti]) {
      const idx = spokenPool.findIndex((s) => wordsMatch(targetTokens[ti]!, s));
      if (idx >= 0) {
        matchedFlags[ti] = true;
        spokenPool.splice(idx, 1);
      }
    }
  }

  const corePositions = findCorePatternPositions(targetTokens, params.hintTags);
  let coreTotal = 0;
  let coreHit = 0;
  let contentTotal = 0;
  let contentHit = 0;
  let functionTotal = 0;
  let functionHit = 0;
  const missed: string[] = [];

  for (let ti = 0; ti < targetTokens.length; ti++) {
    const word = targetTokens[ti]!;
    const hit = matchedFlags[ti]!;
    if (!hit) missed.push(word);

    if (corePositions.has(ti)) {
      coreTotal++;
      if (hit) coreHit++;
    } else if (FUNCTION_WORDS.has(word)) {
      functionTotal++;
      if (hit) functionHit++;
    } else {
      contentTotal++;
      if (hit) contentHit++;
    }
  }

  const contentMatchRate = contentTotal > 0 ? contentHit / contentTotal : 1;
  const functionMatchRate = functionTotal > 0 ? functionHit / functionTotal : 1;
  const coreMatchRate = coreTotal > 0 ? coreHit / coreTotal : 1;

  let rawScore: number;
  if (coreTotal > 0) {
    // Redistribute the weight of an empty category to the others so a sentence is never capped by absence.
    const parts: Array<[number, number, number]> = [[SCORE_WEIGHTS.core, coreMatchRate, coreTotal]];
    parts.push([SCORE_WEIGHTS.content, contentMatchRate, contentTotal]);
    parts.push([SCORE_WEIGHTS.function, functionMatchRate, functionTotal]);
    const live = parts.filter((p) => p[2] > 0);
    const wsum = live.reduce((a, p) => a + p[0], 0);
    rawScore = live.reduce((a, p) => a + (p[0] / wsum) * p[1], 0);
  } else if (contentTotal === 0) rawScore = functionMatchRate;
  else if (functionTotal === 0) rawScore = contentMatchRate;
  else rawScore = SCORE_WEIGHTS.fallbackContent * contentMatchRate + SCORE_WEIGHTS.fallbackFunction * functionMatchRate;

  // docs/04 4.6: a 3-star attempt that says none of the core-pattern tokens earns at most 2 stars.
  const starCap: 1 | 2 | 3 = params.stars === 3 && coreTotal > 0 && coreHit === 0 ? 2 : 3;

  const score = Number(rawScore.toFixed(4));
  let threshold = LEVEL_DEFINITIONS[params.level].passThreshold;
  if (params.hintLevel === 'picture' || params.hintLevel === 'none') {
    threshold = Math.min(threshold, 0.6);
  }

  return {
    pass: score >= threshold,
    score,
    threshold,
    missed,
    contentMatchRate: Number(contentMatchRate.toFixed(4)),
    functionMatchRate: Number(functionMatchRate.toFixed(4)),
    coreMatchRate: Number(coreMatchRate.toFixed(4)),
    coreTotal,
    starCap
  };
}
