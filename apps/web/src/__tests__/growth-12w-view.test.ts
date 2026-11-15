/**
 * The guardian screen on 12 weeks of synthetic children (docs/07 §3–§5, WP-309): what a parent reads — the
 * headline, the card sentences, the index table, the six components, the estimate rows — is checked against the
 * simulated child, not against hand-written fixtures.
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { buildDashboardSeries } from '@lcw/metrics';
import { SIM_WEEK, simTruth, simulate, type SimPersona } from '../../../../packages/metrics/src/synthetic.js';
import { DashboardView, weekLabel } from '../DashboardPage.js';
import type { DashboardPayload } from '../familyApi.js';
import { PARENT_STRINGS_KO } from '../parentStrings.js';

const D = PARENT_STRINGS_KO.dashboard;
const START = Date.parse('2026-08-16T15:00:00Z'); // Monday 2026-08-17 00:00 KST
const NOW = START + 12 * SIM_WEEK - 2 * 3_600_000;
const weekdays = [0, 1, 2, 3, 4];

const persona = (over: Partial<SimPersona> & Pick<SimPersona, 'name'>): SimPersona => ({
  seed: 3,
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
  masterShare: 0.5,
  lessonWeekday: 2,
  lessonFromWeek: 1,
  lessonFree: 6,
  ...over
});

function payload(p: SimPersona, nowMs = NOW): { data: DashboardPayload; truth: ReturnType<typeof simTruth> } {
  const run = simulate(p);
  const keep = <T,>(xs: T[], t: (x: T) => number | null) => xs.filter((x) => (t(x) ?? Infinity) < nowMs);
  const series = buildDashboardSeries({
    utterances: keep(run.utterances, (u) => u.created_at),
    masteredAt: run.masteredAt.map((t) => (t !== null && t < nowMs ? t : null)),
    lessonStarts: keep(run.lessonStarts, (t) => t),
    nowMs
  });
  const data: DashboardPayload = {
    child: { nickname: 'Sora', level: 'L3' },
    series: JSON.parse(JSON.stringify(series)),
    week_line: null,
    review: [],
    lessons: [],
    next_lesson_at: null,
    lesson_live: false,
    lesson_window_on: false,
    voice_store_on: false,
    server_now: nowMs
  };
  return { data, truth: simTruth(run) };
}

const render = (data: DashboardPayload, initialTables = true) => renderToStaticMarkup(React.createElement(DashboardView, { data, initialTables }));
const fmt = (n: number) => (Number.isInteger(n) ? n.toLocaleString('ko-KR') : n.toFixed(1));

describe('guardian screen on 12 simulated weeks (docs/07, WP-309)', () => {
  it('grower: headline and the index table say what the child did; six components and the 12 estimate rows are there', () => {
    const { data, truth } = payload(
      persona({ name: 'grower', wordsPerFree: (w) => 4 + w * 0.4, wpm: (w) => 90 + w * 3, vocab: (w) => 60 + w * 25, connectorShare: (w) => 0.1 + w * 0.04 })
    );
    const html = render(data);
    const now = truth.weeks[11]!;
    const before = truth.weeks[7]!;
    expect(html).toContain(D.headline('Sora', now.free_words) + D.headlineRatio((Math.round((now.free_words / before.free_words) * 10) / 10).toFixed(1)));
    // index table: one row per week, dot and 4-week values as computed
    for (const w of data.series.weeks) {
      expect(html).toContain(`<td style="padding:8px;white-space:nowrap">${weekLabel(w.week_start)}</td><td style="padding:8px;white-space:nowrap">${fmt(w.think_speak!)}</td>`);
    }
    // "어떻게 계산하나요": the formula in words and one small graph per component, the start dashed
    expect(html).toContain(D.parts.how);
    for (const k of ['words', 'speed', 'prep', 'connectors', 'target', 'hintFree']) expect(html).toContain(`data-testid="think-part-${k}"`);
    expect(html).toContain(D.parts.legendBase);
    // cumulative table: 12 measured weeks + 12 estimate rows
    expect(html.split(`(${D.estimate})`).length - 1).toBe(12);
    expect(html).toContain(`<td style="padding:8px;white-space:nowrap">${now.cum_free_words}</td>`);
  });

  it('plateau: the free-words card says "비슷합니다" while the cumulative line still rises', () => {
    const { data } = payload(persona({ name: 'plateau', wordsPerFree: (w) => 4 + Math.min(w, 3) }));
    const html = render(data, false);
    const w = data.series.weeks;
    expect(w[11]!.free_words).toBe(w[7]!.free_words);
    expect(html).toContain(D.lineFlat(`${fmt(w[7]!.free_words)}${D.units.words}`));
    expect(w[11]!.cum_free_words).toBeGreaterThan(w[7]!.cum_free_words);
  });

  it('a two-day last week: the card explains the dip by the days played, not as decline', () => {
    const { data } = payload(persona({ name: 'busy', playDays: (w) => (w === 11 ? [0, 1] : weekdays), lessonWeekday: null }));
    const html = render(data, false);
    const w = data.series.weeks;
    expect(html).toContain(D.lineFewDays(2));
    expect(html).not.toContain(D.lineDown(`${fmt(w[7]!.free_words)}${D.units.words}`, `${fmt(w[11]!.free_words)}${D.units.words}`));
  });

  it('before the start exists: the index card says it is being prepared, not "표본 부족" or a number', () => {
    const { data } = payload(persona({ name: 'new', playDays: (w) => (w >= 10 ? weekdays : []), lessonWeekday: null }), START + 11 * SIM_WEEK - 3_600_000);
    expect(data.series.baseline).toBeNull();
    const html = render(data, false);
    expect(html).toContain(D.baselinePending);
    expect(html).toContain(D.thinkBaseline);
    expect(html).toContain('data-testid="think-baseline-pending"');
  });
});
