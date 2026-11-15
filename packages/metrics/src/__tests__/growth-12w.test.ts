/**
 * 12-week curves on synthetic children (docs/07 §2–§4, WP-309): every number the guardian dashboard draws is checked
 * against plain sums of what the simulated child said (packages/metrics/src/synthetic.ts), and the shapes a parent
 * reads are checked against how each child was made to grow.
 */
import { describe, expect, it } from 'vitest';
import {
  DASHBOARD_PROJECTION_WEEKS,
  DASHBOARD_TREND_WEEKS,
  buildDashboardSeries,
  type DashboardSeries
} from '../index.js';
import { SIM_DAY, SIM_WEEK, simKstDay, simTruth, simulate, type SimPersona, type SimRun } from '../synthetic.js';

// Monday 2026-08-17 00:00 KST; the dashboard is opened on the last Sunday of week 12, 22:00 KST.
const START = Date.parse('2026-08-16T15:00:00Z');
const NOW = START + 12 * SIM_WEEK - 2 * 3_600_000;
const weekdays = [0, 1, 2, 3, 4];

const persona = (over: Partial<SimPersona> & Pick<SimPersona, 'name'>): SimPersona => ({
  seed: 11,
  start: START,
  weeks: 12,
  playDays: () => weekdays,
  freePerDay: () => 8,
  wordsPerFree: () => 6,
  prepMsPerWord: () => 600,
  wpm: () => 100,
  connectorShare: () => 0.25,
  vocab: () => 120,
  guidedPerDay: 2,
  readPerDay: 1,
  masterShare: 0.5,
  lessonWeekday: 2,
  lessonFromWeek: 1,
  lessonFree: 6,
  ...over
});

/** What the server holds at `nowMs`: only what was said (mastered, lessons started) before then. */
const series = (run: SimRun, nowMs = NOW): DashboardSeries =>
  buildDashboardSeries({
    utterances: run.utterances.filter((u) => u.created_at < nowMs),
    masteredAt: run.masteredAt.map((t) => (t !== null && t < nowMs ? t : null)),
    lessonStarts: run.lessonStarts.filter((t) => t < nowMs),
    nowMs
  });

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Every drawn number equals the plain sum over what the child said; cumulative curves never go down. */
function expectMatchesTruth(run: SimRun, s: DashboardSeries): void {
  const t = simTruth(run);
  expect(s.weeks.map((w) => w.week_start)).toEqual(t.weeks.map((w) => w.week_start));
  s.weeks.forEach((w, i) => {
    const x = t.weeks[i]!;
    const at = `${run.persona.name} week ${i + 1}`;
    expect({ at, v: [w.free_words, w.free_utterances, w.play_days, w.lesson_days] }).toEqual({ at, v: [x.free_words, x.free_utterances, x.play_days, x.lesson_days] });
    expect({ at, v: [w.cum_free_words, w.cum_vocab, w.cum_mastered] }).toEqual({ at, v: [x.cum_free_words, x.cum_vocab, x.cum_mastered] });
    expect({ at, v: w.speaking_min }).toEqual({ at, v: r1(x.speaking_ms / 60_000) });
    expect({ at, v: w.mean_words }).toEqual({ at, v: x.mean_words === null ? null : r1(x.mean_words) });
    expect({ at, v: w.speech_wpm }).toEqual({ at, v: x.free_dur_ms > 0 ? r1(x.free_words / (x.free_dur_ms / 60_000)) : null });
    expect({ at, v: w.connectors_per_100 }).toEqual({ at, v: x.free_words > 0 ? r1((x.connectors / x.free_words) * 100) : null });
    expect({ at, v: w.prep_per_word_ms }).toEqual({ at, v: x.prep_per_word === null ? null : Math.round(x.prep_per_word) });
    expect({ at, v: w.think_status === 'short' }).toEqual({ at, v: x.free_utterances < 30 });
    if (i > 0) {
      const p = s.weeks[i - 1]!;
      expect(w.cum_free_words).toBeGreaterThanOrEqual(p.cum_free_words);
      expect(w.cum_vocab).toBeGreaterThanOrEqual(p.cum_vocab);
      expect(w.cum_mastered).toBeGreaterThanOrEqual(p.cum_mastered);
    }
  });
  // Calendar: 84 KST days ending today, each day's free words as said.
  expect(s.calendar).toHaveLength(84);
  expect(s.calendar[83]!.day).toBe(simKstDay(NOW));
  for (const d of s.calendar) expect({ day: d.day, v: d.free_words }).toEqual({ day: d.day, v: t.perDay.get(d.day) ?? 0 });
  // Projection: average weekly rise over the last 8 weeks (from the first of them with speech), 12 weeks on.
  for (const key of ['cum_free_words', 'cum_vocab', 'cum_mastered'] as const) {
    const trend = s.weeks.slice(-DASHBOARD_TREND_WEEKS);
    const first = trend.findIndex((w) => w.play_days > 0);
    const last = trend[trend.length - 1]!;
    const proj = s.projection[key];
    if (s.weeks.filter((w) => w.play_days > 0).length < 2 || first < 0 || trend.length - 1 - first < 1) {
      expect(proj).toEqual([]);
      continue;
    }
    const slope = (last[key] - trend[first]![key]) / (trend.length - 1 - first);
    expect(proj).toHaveLength(DASHBOARD_PROJECTION_WEEKS);
    proj.forEach((p, k) => {
      expect(p.week_start).toBe(last.week_start + (k + 1) * SIM_WEEK);
      expect(p.value).toBe(Math.round(last[key] + slope * (k + 1)));
      expect(p.value).toBeGreaterThanOrEqual(k ? proj[k - 1]!.value : last[key]);
    });
  }
}

describe('12-week curves on synthetic children (docs/07, WP-309)', () => {
  it('steady grower with a level-up in week 7: numbers match, the index climbs and the longer sentences of L3 do not cost it', () => {
    const run = simulate(
      persona({
        name: 'grower',
        // longer sentences each week, jump at the level-up; time to start per word stays the same
        wordsPerFree: (w) => (w < 6 ? 4 + w * 0.4 : 7 + (w - 6) * 0.3),
        wpm: (w) => 90 + w * 3,
        connectorShare: (w) => 0.1 + w * 0.04,
        vocab: (w) => 60 + w * 25
      })
    );
    const s = series(run);
    expectMatchesTruth(run, s);
    const dots = s.weeks.map((w) => w.think_speak!);
    expect(dots.every((d) => typeof d === 'number')).toBe(true);
    expect(s.baseline?.week_starts).toEqual([START, START + SIM_WEEK]);
    expect(dots[0]).toBeGreaterThanOrEqual(97);
    expect(dots[1]).toBeLessThanOrEqual(103);
    // connectors are counted per 100 words, so a week of longer sentences can nudge a dot down a little; never more
    for (let i = 1; i < 12; i++) expect(dots[i]!).toBeGreaterThanOrEqual(dots[i - 1]! - 3);
    // level-up week: longer sentences at the same per-word start time → the index does not dip
    expect(dots[6]!).toBeGreaterThan(dots[5]!);
    expect(s.weeks.map((w) => w.prep_per_word_ms)).toEqual(Array(12).fill(600));
    expect(dots[11]!).toBeGreaterThanOrEqual(130);
    // the 4-week line trails the dots but goes the same way
    const line = s.weeks.map((w) => w.think_speak_4w!);
    for (let i = 4; i < 12; i++) expect(line[i]!).toBeGreaterThanOrEqual(line[i - 1]!);
    expect(line[11]!).toBeLessThan(dots[11]!);
  });

  it('a child who only talks more (same length, speed, start time): the index stays at 100 — volume is not quality', () => {
    const run = simulate(persona({ name: 'talkative', freePerDay: (w) => 6 + w * 2, connectorShare: () => 0.5, guidedPerDay: 0, readPerDay: 0 }));
    const s = series(run);
    expectMatchesTruth(run, s);
    for (const w of s.weeks) {
      expect(w.think_speak!).toBeGreaterThanOrEqual(98);
      expect(w.think_speak!).toBeLessThanOrEqual(102);
      expect(w.think_speak_4w!).toBeGreaterThanOrEqual(98);
      expect(w.think_speak_4w!).toBeLessThanOrEqual(102);
    }
    // while the amount curves do show the extra talking
    expect(s.weeks[11]!.free_words).toBeGreaterThan(s.weeks[0]!.free_words * 3);
  });

  it('plateau after week 4: the index flattens while the cumulative curves keep rising (why both sit side by side)', () => {
    const grow = (w: number) => Math.min(w, 3);
    const run = simulate(persona({ name: 'plateau', wordsPerFree: (w) => 4 + grow(w), wpm: (w) => 90 + grow(w) * 5, vocab: (w) => 80 + grow(w) * 20 }));
    const s = series(run);
    expectMatchesTruth(run, s);
    const late = s.weeks.slice(4).map((w) => w.think_speak!);
    expect(Math.max(...late) - Math.min(...late)).toBeLessThanOrEqual(4);
    const late4w = s.weeks.slice(7).map((w) => w.think_speak_4w!);
    expect(Math.max(...late4w) - Math.min(...late4w)).toBeLessThanOrEqual(3);
    expect(s.weeks[11]!.cum_free_words).toBeGreaterThan(s.weeks[4]!.cum_free_words * 2);
    expect(s.weeks[11]!.cum_free_words - s.weeks[10]!.cum_free_words).toBe(s.weeks[11]!.free_words);
  });

  it('two-week holiday and a two-day week: no dots there (not zeros), flat cumulative steps, empty calendar days, honest projection', () => {
    const run = simulate(persona({ name: 'holiday', playDays: (w) => (w === 4 || w === 5 ? [] : w === 8 ? [1, 3] : weekdays), lessonWeekday: null }));
    const s = series(run);
    expectMatchesTruth(run, s);
    for (const i of [4, 5]) {
      expect(s.weeks[i]).toMatchObject({ free_words: 0, play_days: 0, think_speak: null, think_status: 'short', speech_wpm: null, mean_words: null });
      expect(s.weeks[i]!.cum_free_words).toBe(s.weeks[3]!.cum_free_words);
    }
    expect(s.weeks[8]).toMatchObject({ play_days: 2, free_utterances: 16, think_speak: null, think_status: 'short' });
    // the 4-week line still has a number where the window holds enough free sentences
    expect(s.weeks[8]!.think_speak_4w).not.toBeNull();
    const holiday = s.calendar.filter((d) => d.day >= simKstDay(START + 28 * SIM_DAY) && d.day <= simKstDay(START + 41 * SIM_DAY));
    expect(holiday).toHaveLength(14);
    expect(holiday.every((d) => d.free_words === 0)).toBe(true);
  });

  it('late starter with a 5-sentence trial in week 3: the trial is not the start; the start is the first two full weeks', () => {
    const run = simulate(
      persona({
        name: 'late',
        playDays: (w) => (w === 2 ? [5] : w >= 9 ? weekdays : []),
        freePerDay: (w) => (w === 2 ? 5 : 8),
        wordsPerFree: (w) => (w === 2 ? 2 : 5 + (w - 9)),
        lessonWeekday: null,
        guidedPerDay: 0,
        readPerDay: 0
      })
    );
    const s = series(run);
    expectMatchesTruth(run, s);
    expect(s.baseline?.week_starts).toEqual([START + 9 * SIM_WEEK, START + 10 * SIM_WEEK]);
    expect(s.weeks[2]).toMatchObject({ free_utterances: 5, think_speak: null, think_status: 'short' });
    expect(s.weeks[9]!.think_speak!).toBeLessThan(100);
    expect(s.weeks[10]!.think_speak!).toBeGreaterThan(100);
    expect(s.weeks[11]!.think_speak!).toBeGreaterThan(s.weeks[10]!.think_speak!);
    // before the start existed (week 10 alone) there is no index: shown as "준비 중", not as a number
    const early = series(run, START + 10 * SIM_WEEK - 3_600_000);
    expect(early.baseline).toBeNull();
    expect(early.weeks[11]).toMatchObject({ think_speak: null, think_status: 'baseline' });
  });

  it('recognition noise (confidence < 0.5) changes nothing anywhere: same series as the clean child', () => {
    const clean = simulate(persona({ name: 'kid', seed: 5 }));
    const noisy = simulate(persona({ name: 'kid', seed: 5, lowConfPerDay: 6 }));
    expect(noisy.utterances.length).toBeGreaterThan(clean.utterances.length);
    // the noise sits after each day's free sentences, so the clean sentences keep their times and texts
    const sc = series(clean);
    const sn = series(noisy);
    expect(sn).toEqual(sc);
    expectMatchesTruth(noisy, sn);
  });

  it('late-night talker: sentences after midnight and on Sunday 23:xx land on the right KST day and week', () => {
    const run = simulate(persona({ name: 'night', hour: 23, freePerDay: () => 40, gapSec: 120, playDays: (w) => (w === 11 ? [5] : [2, 6]), lessonWeekday: null }));
    const s = series(run);
    expectMatchesTruth(run, s);
    // Sunday 23:00 + 40 × 2 min runs into Monday: some of every Sunday's talk belongs to the next week
    const sun = s.calendar.find((d) => d.day === simKstDay(START + 6 * SIM_DAY))!;
    const mon = s.calendar.find((d) => d.day === simKstDay(START + 7 * SIM_DAY))!;
    expect(sun.free_words).toBeGreaterThan(0);
    expect(mon.free_words).toBeGreaterThan(0);
    // week 2 holds Monday (spill from week 1's Sunday), Wednesday, Thursday (spill) and Sunday
    expect(s.weeks[1]!.play_days).toBe(4);
  });
});
