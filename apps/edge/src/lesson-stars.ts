/**
 * Stars once per goal in a lesson (R2627, Dan 11-16 "반복으로 별 먹으며 반복하며 멈춰 있는 점").
 *
 * Oreo lesson 11-16 (les-20261116-fdbe87bf): the child said the same three sentences twice in the warm-up and got
 * ★3 (and the coins) both times; nothing told her the second time bought nothing, so saying it again was the game.
 * A goal is one sentence of the stage: a guided/read/recall target (its target_text), or in free talk one thing
 * said (a transcript). Saying a goal again after it passed tops up to its best stars only: the same stars again give
 * 0 (pass stays true, `repeat` tells the child to say something new), more stars give the difference. The stage's
 * pass count (lesson lane, distinct target_text with stars > 0) never counts a repeat, so a repeat never advances.
 */

export type PassedBefore = {
  target_text: string;
  transcript: string;
  stars: number;
};

/** Word-set overlap at or above which two free-talk answers are the same thing said again. */
export const FREE_REPEAT_OVERLAP = 0.7;

function words(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** Overlap of two answers' word sets (|A∩B| / |A∪B|), 0 when either is empty. */
export function wordOverlap(a: string, b: string): number {
  const A = new Set(words(a));
  const B = new Set(words(b));
  if (A.size === 0 || B.size === 0) return 0;
  let both = 0;
  for (const w of A) if (B.has(w)) both++;
  return both / (A.size + B.size - both);
}

/**
 * The best stars this goal already reached in the stage, or 0 when it is new. Rows keep what each answer added
 * (a top-up row holds the difference), so the goal's best is the sum of its rows.
 */
export function bestBefore(prev: readonly PassedBefore[], targetText: string, transcript: string): number {
  let best = 0;
  for (const p of prev) {
    if (p.stars <= 0) continue;
    const same = targetText
      ? p.target_text === targetText
      : !p.target_text && wordOverlap(p.transcript, transcript) >= FREE_REPEAT_OVERLAP;
    if (same) best += p.stars;
  }
  return Math.min(3, best);
}

/** The stars this answer adds: only what beats the goal's best so far. `repeat` = it added nothing. */
export function starsOnce(prev: readonly PassedBefore[], a: { pass: boolean; stars: number; targetText: string; transcript: string }): {
  stars: number;
  repeat: boolean;
} {
  if (!a.pass || a.stars <= 0) return { stars: a.stars, repeat: false };
  const best = bestBefore(prev, a.targetText, a.transcript);
  const add = Math.max(0, a.stars - best);
  return { stars: add, repeat: best > 0 && add === 0 };
}
