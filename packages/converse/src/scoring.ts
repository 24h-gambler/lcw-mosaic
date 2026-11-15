import { FUNCTION_WORDS, LEVEL_DEFINITIONS, type LangLevel } from '@lcw/content';
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
  [/\bisn't\b/gi, 'is not']
];

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
}

/**
 * Deterministic scoring formula from docs/04 4.6:
 * score = 0.8 * contentWordMatch + 0.2 * functionWordMatch
 */
export function scoreUtterance(params: {
  targetText: string;
  spokenTranscript: string;
  level: LangLevel;
  hintLevel?: HintLevel;
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
      functionMatchRate: 0
    };
  }

  // Monotone subsequence alignment so word order matters while tolerating minor filler words
  let spokenCursor = 0;
  const matchedFlags = new Array<boolean>(targetTokens.length).fill(false);

  for (let ti = 0; ti < targetTokens.length; ti++) {
    const targetWord = targetTokens[ti]!;
    for (let si = spokenCursor; si < spokenTokens.length; si++) {
      if (spokenTokens[si] === targetWord) {
        matchedFlags[ti] = true;
        spokenCursor = si + 1;
        break;
      }
    }
  }

  // Second pass for any out-of-order exact token matches (helps children with minor transposition)
  const spokenPool = [...spokenTokens];
  for (let ti = 0; ti < targetTokens.length; ti++) {
    if (matchedFlags[ti]) {
      const idx = spokenPool.indexOf(targetTokens[ti]!);
      if (idx >= 0) spokenPool.splice(idx, 1);
    }
  }
  for (let ti = 0; ti < targetTokens.length; ti++) {
    if (!matchedFlags[ti]) {
      const idx = spokenPool.indexOf(targetTokens[ti]!);
      if (idx >= 0) {
        matchedFlags[ti] = true;
        spokenPool.splice(idx, 1);
      }
    }
  }

  let contentTotal = 0;
  let contentHit = 0;
  let functionTotal = 0;
  let functionHit = 0;
  const missed: string[] = [];

  for (let ti = 0; ti < targetTokens.length; ti++) {
    const word = targetTokens[ti]!;
    const hit = matchedFlags[ti]!;
    if (!hit) missed.push(word);

    if (FUNCTION_WORDS.has(word)) {
      functionTotal++;
      if (hit) functionHit++;
    } else {
      contentTotal++;
      if (hit) contentHit++;
    }
  }

  const contentMatchRate = contentTotal > 0 ? contentHit / contentTotal : 1;
  const functionMatchRate = functionTotal > 0 ? functionHit / functionTotal : 1;

  let rawScore: number;
  if (contentTotal === 0) rawScore = functionMatchRate;
  else if (functionTotal === 0) rawScore = contentMatchRate;
  else rawScore = 0.8 * contentMatchRate + 0.2 * functionMatchRate;

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
    functionMatchRate: Number(functionMatchRate.toFixed(4))
  };
}
