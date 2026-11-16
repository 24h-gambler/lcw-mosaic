import { scoreUtterance } from '@lcw/converse';
import { adventureLangLevel, type AdventureLevel } from '@lcw/content';
import { ADV } from './tuning.js';

/**
 * Grading a TALK (docs/22 1.3). Spoken and typed sentences go through the world's own scorer (`scoreUtterance`, the
 * level's pass threshold), so a sentence that earns stars here earns them in /world/ too. Built and spelled answers are
 * exact; picks cap at 2 stars.
 */
export type Stars = 0 | 1 | 2 | 3;

export interface Graded {
  stars: Stars;
  score: number;
  pass: boolean;
  missed: string[];
}

export function gradeSpoken(target: string, transcripts: readonly string[], level: AdventureLevel): Graded {
  let best: Graded = { stars: 0, score: 0, pass: false, missed: [] };
  for (const t of transcripts) {
    if (!t.trim()) continue;
    const r = scoreUtterance({ targetText: target, spokenTranscript: t, level: adventureLangLevel(level) });
    const stars: Stars = !r.pass ? 0 : r.score >= ADV.stars.three ? 3 : r.score >= ADV.stars.two ? 2 : 1;
    if (r.score > best.score || (stars > best.stars)) best = { stars, score: r.score, pass: r.pass, missed: r.missed };
  }
  return best;
}

const norm = (s: string) => s.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z' ]/g, ' ').replace(/\s+/g, ' ').trim();

/** 🧩 build / 🔤 spell: right on the first try = 3 stars, second = 2, later = 1. */
export function gradeExact(target: string, answer: string, tries: number): Graded {
  const ok = norm(target) === norm(answer);
  const stars: Stars = !ok ? 0 : tries <= 1 ? 3 : tries === 2 ? 2 : 1;
  return { stars, score: ok ? 1 : 0, pass: ok, missed: [] };
}

/** ✅ pick: the right reply = 2 stars (first try) or 1. */
export function gradePick(target: string, choice: string, tries: number): Graded {
  const ok = norm(target) === norm(choice);
  const stars: Stars = !ok ? 0 : tries <= 1 ? ADV.pickStarCap : 1;
  return { stars, score: ok ? 1 : 0, pass: ok, missed: [] };
}

export function calmFor(stars: Stars): number {
  return ADV.calmByStars[stars];
}
