import { LEXICON_L1_KO_EN } from '@lcw/content';

const SORTED_LEXICON_ENTRIES = Object.entries(LEXICON_L1_KO_EN).sort(
  (a, b) => b[0].length - a[0].length
);

const KOREAN_PARTICLE_SUFFIXES = [
  '으로',
  '에서',
  '에게',
  '부터',
  '까지',
  '을',
  '를',
  '이',
  '가',
  '은',
  '는',
  '로',
  '에',
  '도',
  '만',
  '랑',
  '하고',
  '잔',
  '개',
  '벌',
  '병'
];

const HANGUL_RE = /[\uAC00-\uD7A3]+/;

export interface NormalizationResult {
  original: string;
  normalized: string;
  tokens: string[];
  replacedCount: number;
  unknownKoreanTokens: string[];
}

function stripKoreanParticle(token: string): string {
  for (const suffix of KOREAN_PARTICLE_SUFFIXES) {
    if (token.length > suffix.length && token.endsWith(suffix)) {
      const stem = token.slice(0, token.length - suffix.length);
      if (LEXICON_L1_KO_EN[stem] !== undefined) {
        return stem;
      }
    }
  }
  return token;
}

/**
 * Normalizes mixed Korean-English transcripts into clean target-language tokens (WP-105).
 */
export function normalizeMixedUtterance(
  rawTranscript: string,
  opts: { keepUnknownKorean?: boolean } = {}
): NormalizationResult {
  const cleaned = rawTranscript.trim().replace(/\s+/g, ' ');
  if (!cleaned) {
    return {
      original: rawTranscript,
      normalized: '',
      tokens: [],
      replacedCount: 0,
      unknownKoreanTokens: []
    };
  }

  let replacedCount = 0;
  const unknownKoreanTokens: string[] = [];

  // First replace known multi-word Korean phrases (length >= 2, longest match first)
  let working = cleaned;
  for (const [ko, en] of SORTED_LEXICON_ENTRIES) {
    if (ko.length < 2) continue;
    if (working.includes(ko)) {
      const regex = new RegExp(ko.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
      const next = working.replace(regex, ` ${en} `);
      if (next !== working) {
        replacedCount++;
        working = next;
      }
    }
  }

  const rawWords = working
    .replace(/[.,!?]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  const outputTokens: string[] = [];
  for (const w of rawWords) {
    if (HANGUL_RE.test(w)) {
      const stripped = stripKoreanParticle(w);
      const mapped = LEXICON_L1_KO_EN[stripped];
      if (mapped) {
        outputTokens.push(...mapped.split(/\s+/));
        replacedCount++;
      } else if (KOREAN_PARTICLE_SUFFIXES.includes(w)) {
        // Standalone measure counter/particle left over after Korean stem replacement -> skip
        continue;
      } else {
        unknownKoreanTokens.push(w);
        if (opts.keepUnknownKorean) outputTokens.push(w);
      }
    } else {
      outputTokens.push(w.toLowerCase());
    }
  }

  // Collapse duplicate adjacent "please"
  const deduped: string[] = [];
  for (const t of outputTokens) {
    if (t === 'please' && deduped[deduped.length - 1] === 'please') continue;
    deduped.push(t);
  }

  const joined = deduped.join(' ');
  const normalized =
    joined.length > 0 ? joined[0]!.toUpperCase() + joined.slice(1) : '';

  return {
    original: rawTranscript,
    normalized,
    tokens: deduped,
    replacedCount,
    unknownKoreanTokens
  };
}
