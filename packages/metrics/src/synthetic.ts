/**
 * Synthetic children for the 12-week curve test (docs/07 §3–§4, WP-309). Deterministic (seeded).
 *
 * A persona says how a child grows week by week (play days, how many free sentences, how long, how fast to start,
 * speech rate, connectors, vocabulary, lessons). The generator emits utterances whose words, connectors, timing and
 * validity are known by construction, and `simTruth` adds them up the plain way, so the tests compare the dashboard
 * with numbers the dashboard code did not compute. Test-only: not exported from the package index.
 */
import type { UtteranceMetricInput } from './index.js';

export const SIM_DAY = 86_400_000;
export const SIM_WEEK = 7 * SIM_DAY;
const KST = 9 * 3_600_000;

/** Single-word connectors so the word count stays exact (docs/07 §2 list). */
export const SIM_CONNECTORS = ['because', 'so', 'but', 'when', 'if'] as const;

export interface SimPersona {
  name: string;
  seed: number;
  /** KST Monday 00:00 of week 1 (epoch ms). */
  start: number;
  weeks: number;
  /** Weekdays played in week w (0 = Monday … 6 = Sunday). */
  playDays: (w: number) => number[];
  freePerDay: (w: number) => number;
  /** Words in every free sentence of week w (integer). */
  wordsPerFree: (w: number) => number;
  /** Time to start speaking per word (ms): latency = words × this. */
  prepMsPerWord: (w: number) => number;
  /** Speech rate (words per minute): dur = words ÷ wpm. */
  wpm: (w: number) => number;
  /** Share of free sentences that carry one connector (0..1). */
  connectorShare: (w: number) => number;
  /** Size of the word pool the child draws from in week w. */
  vocab: (w: number) => number;
  guidedPerDay?: number;
  readPerDay?: number;
  /** Utterances under the STT floor (confidence 0.3) per play day; they must change nothing. */
  lowConfPerDay?: number;
  /** KST hour of the first sentence of a play day (default 17). Late hours spill past midnight on purpose. */
  hour?: number;
  /** Seconds between sentences (default 90). */
  gapSec?: number;
  /** Weekly lesson on this weekday (0 = Monday), from week `lessonFromWeek` (0-based). */
  lessonWeekday?: number | null;
  lessonFromWeek?: number;
  /** Skip the lesson in some weeks (a family holiday). */
  lessonOn?: (w: number) => boolean;
  /** Free sentences inside a lesson. */
  lessonFree?: number;
  /** Share of guided sentences that become mastered cards 35 days later (deterministic by seed). */
  masterShare?: number;
}

export interface SimUtterance extends UtteranceMetricInput {
  connectors: number;
  /** For truth: the KST day index from persona.start (0-based). */
  day_index: number;
}

export interface SimRun {
  persona: SimPersona;
  utterances: SimUtterance[];
  lessonStarts: number[];
  masteredAt: Array<number | null>;
  /** End of the simulated period (exclusive): start + weeks. */
  end: number;
}

/** mulberry32 */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const word = (i: number) => `v${i}`;

export function simulate(p: SimPersona): SimRun {
  const r = rng(p.seed);
  // Noise draws from its own stream so adding it leaves every clean sentence exactly as it was.
  const rNoise = rng(p.seed ^ 0x9e3779b9);
  const out: SimUtterance[] = [];
  const lessonStarts: number[] = [];
  const masteredAt: Array<number | null> = [];
  const end = p.start + p.weeks * SIM_WEEK;
  let n = 0;
  const gap = (p.gapSec ?? 90) * 1000;

  const sentence = (w: number, words: number, connector: boolean, rand: () => number = r): string => {
    const pool = Math.max(1, Math.round(p.vocab(w)));
    const toks = Array.from({ length: words }, () => word(Math.floor(rand() * pool)));
    if (connector && words >= 2) toks[Math.max(1, Math.floor(words / 2))] = SIM_CONNECTORS[Math.floor(rand() * SIM_CONNECTORS.length)]!;
    return toks.join(' ');
  };

  const push = (at: number, w: number, dayIndex: number, over: Partial<SimUtterance> & Pick<SimUtterance, 'mode' | 'final_text'>) => {
    const words = over.final_text.split(' ').filter(Boolean).length;
    const connectors = over.final_text.split(' ').filter((t) => (SIM_CONNECTORS as readonly string[]).includes(t)).length;
    out.push({
      id: `${p.name}-${n++}`,
      player_id: p.name,
      session_id: `s-${p.name}-${dayIndex}`,
      session_kind: 'solo',
      ctx: 'cafe',
      interlocutor: 'npc',
      words,
      l1_words: 0,
      dur_ms: Math.round((words / p.wpm(w)) * 60_000),
      latency_ms: Math.round(words * p.prepMsPerWord(w)),
      stars: 2,
      hint_level: 'none',
      attempts: 1,
      score: 0.8,
      confidence: 0.92,
      created_at: at,
      connectors,
      day_index: dayIndex,
      ...over
    });
  };

  for (let w = 0; w < p.weeks; w++) {
    const days = [...new Set(p.playDays(w))].filter((d) => d >= 0 && d <= 6).sort((a, b) => a - b);
    for (const d of days) {
      const dayIndex = w * 7 + d;
      let t = p.start + dayIndex * SIM_DAY + (p.hour ?? 17) * 3_600_000;
      const words = Math.max(1, Math.round(p.wordsPerFree(w)));
      const nFree = Math.max(0, Math.round(p.freePerDay(w)));
      const withConn = Math.round(nFree * p.connectorShare(w));
      for (let i = 0; i < nFree; i++) {
        push(t, w, dayIndex, { mode: 'free', final_text: sentence(w, words, i < withConn) });
        t += gap;
      }
      for (let i = 0; i < (p.lowConfPerDay ?? 0); i++) {
        // Long, fast, connector-heavy noise: if it leaked into any number, that number would jump.
        push(t, w, dayIndex, { mode: 'free', final_text: sentence(w, 25, true, rNoise) + ' because so', confidence: 0.3, latency_ms: 50 });
        t += gap;
      }
      for (let i = 0; i < (p.guidedPerDay ?? 0); i++) {
        push(t, w, dayIndex, { mode: 'guided', final_text: sentence(w, 5, false), hint_level: 'keyword' });
        if (r() < (p.masterShare ?? 0)) masteredAt.push(t + 35 * SIM_DAY < end ? t + 35 * SIM_DAY : null);
        else masteredAt.push(null);
        t += gap;
      }
      for (let i = 0; i < (p.readPerDay ?? 0); i++) {
        push(t, w, dayIndex, { mode: 'read', final_text: sentence(w, 6, false), hint_level: 'full' });
        t += gap;
      }
    }
    if (p.lessonWeekday !== undefined && p.lessonWeekday !== null && w >= (p.lessonFromWeek ?? 0) && (p.lessonOn?.(w) ?? true)) {
      const dayIndex = w * 7 + p.lessonWeekday;
      const t0 = p.start + dayIndex * SIM_DAY + 19 * 3_600_000;
      lessonStarts.push(t0);
      const words = Math.max(1, Math.round(p.wordsPerFree(w)) + 2);
      for (let i = 0; i < (p.lessonFree ?? 0); i++) {
        push(t0 + (i + 1) * 60_000, w, dayIndex, {
          mode: 'free',
          final_text: sentence(w, words, i % 2 === 0),
          session_kind: 'lesson',
          session_id: `les-${p.name}-${w}`,
          interlocutor: 'teacher'
        });
      }
    }
  }
  out.sort((a, b) => a.created_at - b.created_at);
  return { persona: p, utterances: out, lessonStarts, masteredAt, end };
}

/* ---------- truth: plain sums over what was generated ---------- */

export interface SimWeekTruth {
  week_start: number;
  free_words: number;
  free_utterances: number;
  free_dur_ms: number;
  speaking_ms: number;
  play_days: number;
  lesson_days: number;
  connectors: number;
  /** Mean words per free sentence; null without free sentences. */
  mean_words: number | null;
  /** Mean of latency ÷ words over free sentences. */
  prep_per_word: number | null;
  cum_free_words: number;
  cum_vocab: number;
  cum_mastered: number;
}

export interface SimTruth {
  weeks: SimWeekTruth[];
  /** KST date → free words, for every day of the run. */
  perDay: Map<string, number>;
}

export const simKstDay = (ms: number) => new Date(ms + KST).toISOString().slice(0, 10);

export function simTruth(run: SimRun): SimTruth {
  const valid = run.utterances.filter((u) => u.confidence >= 0.5);
  const weeks: SimWeekTruth[] = [];
  const firstDay = new Map<string, string>();
  const vocabAt: number[] = [];
  for (const u of valid) {
    if (u.mode === 'read') continue;
    const day = simKstDay(u.created_at);
    // Same token rule as the dashboard's definition (lowercase letters, digits, apostrophes); real sentences in the
    // end-to-end run carry capitals and punctuation.
    for (const tok of new Set(u.final_text.toLowerCase().match(/[a-z0-9']+/g) ?? [])) {
      const f = firstDay.get(tok);
      if (f === undefined) firstDay.set(tok, day);
      else if (f !== day && f !== '*') {
        vocabAt.push(u.created_at);
        firstDay.set(tok, '*');
      }
    }
  }
  const perDay = new Map<string, number>();
  for (const u of valid) if (u.mode === 'free') perDay.set(simKstDay(u.created_at), (perDay.get(simKstDay(u.created_at)) ?? 0) + u.words);
  let cum = 0;
  for (let w = 0; w < run.persona.weeks; w++) {
    const ws = run.persona.start + w * SIM_WEEK;
    const we = ws + SIM_WEEK;
    const rows = valid.filter((u) => u.created_at >= ws && u.created_at < we);
    const free = rows.filter((u) => u.mode === 'free');
    const words = free.reduce((a, u) => a + u.words, 0);
    cum += words;
    weeks.push({
      week_start: ws,
      free_words: words,
      free_utterances: free.length,
      free_dur_ms: free.reduce((a, u) => a + u.dur_ms, 0),
      speaking_ms: rows.reduce((a, u) => a + u.dur_ms, 0),
      play_days: new Set(rows.map((u) => simKstDay(u.created_at))).size,
      lesson_days: new Set(run.lessonStarts.filter((t) => t >= ws && t < we).map(simKstDay)).size,
      connectors: free.reduce((a, u) => a + u.connectors, 0),
      mean_words: free.length ? words / free.length : null,
      prep_per_word: free.length ? free.reduce((a, u) => a + u.latency_ms / Math.max(1, u.words), 0) / free.length : null,
      cum_free_words: cum,
      cum_vocab: vocabAt.filter((t) => t < we).length,
      cum_mastered: run.masteredAt.filter((t): t is number => t !== null && t < we).length
    });
  }
  return { weeks, perDay };
}
