/**
 * Guardian dashboard series (WP-309, docs/07 §2–§4, docs/08 §9.1–9.2). One place computes every number the
 * dashboard draws so home cards, graphs and their tables never disagree (docs/07 §6).
 *
 * Weeks are KST weeks starting Monday 00:00. Utterances under the STT confidence floor are excluded everywhere.
 */
import {
  computeThinkAndSpeakIndex,
  computeTwoWeekBaseline,
  computeWeeklyMetrics,
  extractUniqueTokens,
  filterValidUtterances,
  type UtteranceMetricInput,
  type WeeklyGrowthMetrics
} from './index.js';

const DAY = 86_400_000;
const WEEK = 7 * DAY;
const KST = 9 * 3_600_000;

export const DASHBOARD_WEEKS = 12;
export const DASHBOARD_CALENDAR_DAYS = 84;
export const DASHBOARD_PROJECTION_WEEKS = 12;
/** Projection uses the average weekly increase of the last 8 weeks with data (docs/07 §3). */
export const DASHBOARD_TREND_WEEKS = 8;

/** docs/07 §2 connector list (language pack, English): counted in `free` utterances. Longest phrases first. */
export const CONNECTOR_EXPRESSIONS = ['so that', 'instead of', 'because', 'although', 'when', 'if', 'so', 'but', 'that', 'after', 'before'] as const;

export type ModeCounts = { free: number; guided: number; read: number; recall: number };

export interface DashboardWeek {
  /** KST Monday 00:00 as epoch ms. */
  week_start: number;
  free_words: number;
  speaking_min: number;
  free_utterances: number;
  /** free words ÷ free speaking minutes; null without free speech time. */
  speech_wpm: number | null;
  /** Median free response time (s); null when not recorded. */
  response_sec: number | null;
  /** Mean words per free utterance; null without free utterances. */
  mean_words: number | null;
  /** Connectors per 100 free words; null without free words. */
  connectors_per_100: number | null;
  /** Weekly think-and-speak index (dot); null = sample too small. */
  think_speak: number | null;
  /** 4-week window index (line); null = sample too small. */
  think_speak_4w: number | null;
  modes: { lesson: ModeCounts; solo: ModeCounts };
  lesson_days: number;
  play_days: number;
  cum_free_words: number;
  cum_vocab: number;
  cum_mastered: number;
}

export interface ProjectionPoint {
  week_start: number;
  value: number;
}

export interface DashboardSeries {
  weeks: DashboardWeek[];
  /** Dashed "추정" continuation of the three cumulative curves; empty with fewer than 2 weeks of data. */
  projection: { cum_free_words: ProjectionPoint[]; cum_vocab: ProjectionPoint[]; cum_mastered: ProjectionPoint[] };
  calendar: Array<{ day: string; free_words: number }>;
  connectors: Array<{ expr: string; count: number }>;
  has_data: boolean;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

export function kstDay(ms: number): string {
  return new Date(ms + KST).toISOString().slice(0, 10);
}

/** KST Monday 00:00 (epoch ms) of the week containing `ms`. */
export function kstWeekStart(ms: number): number {
  const k = ms + KST;
  const dayStart = Math.floor(k / DAY) * DAY;
  const dow = new Date(dayStart).getUTCDay(); // 0 = Sunday
  const back = (dow + 6) % 7;
  return dayStart - back * DAY - KST;
}

const emptyModes = (): ModeCounts => ({ free: 0, guided: 0, read: 0, recall: 0 });

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Occurrences of each connector in one text; "so that" is not also counted as "so" or "that". */
export function countConnectors(text: string): Map<string, number> {
  let t = ` ${text.toLowerCase().replace(/[^a-z']+/g, ' ')} `;
  const out = new Map<string, number>();
  for (const expr of CONNECTOR_EXPRESSIONS) {
    const needle = ` ${expr} `;
    let n = 0;
    let i = t.indexOf(needle);
    while (i >= 0) {
      n++;
      t = `${t.slice(0, i)} ${'#'.repeat(expr.length)} ${t.slice(i + needle.length)}`;
      i = t.indexOf(needle);
    }
    if (n > 0) out.set(expr, n);
  }
  return out;
}

const indexOf = (rows: readonly UtteranceMetricInput[], baseline: ReturnType<typeof computeTwoWeekBaseline>) => {
  const r = computeThinkAndSpeakIndex(rows, baseline);
  return r.status === 'ready' && r.index !== null ? Math.round(r.index) : null;
};

export function buildDashboardSeries(input: {
  utterances: readonly UtteranceMetricInput[];
  /** mastered_at of memory cards (null = not mastered). */
  masteredAt: ReadonlyArray<number | null>;
  /** started_at of lessons. */
  lessonStarts: readonly number[];
  nowMs: number;
  weeks?: number;
}): DashboardSeries {
  const nWeeks = input.weeks ?? DASHBOARD_WEEKS;
  const { valid } = filterValidUtterances(input.utterances);
  const sorted = [...valid].sort((a, b) => a.created_at - b.created_at);
  const thisWeek = kstWeekStart(input.nowMs);
  const firstWeek = thisWeek - (nWeeks - 1) * WEEK;

  // Baseline: the first two weeks that have any valid speech (docs/07 §2.1), from the whole history.
  const byWeek = new Map<number, UtteranceMetricInput[]>();
  for (const u of sorted) {
    const w = kstWeekStart(u.created_at);
    const list = byWeek.get(w) ?? [];
    list.push(u);
    byWeek.set(w, list);
  }
  const dataWeeks = [...byWeek.keys()].sort((a, b) => a - b);
  const baseline = computeTwoWeekBaseline(dataWeeks.slice(0, 2).map((w) => computeWeeklyMetrics(byWeek.get(w)!)) as WeeklyGrowthMetrics[]);

  // Cumulative vocabulary: a token counts once used outside `read` on two different KST days.
  const tokenDays = new Map<string, Set<string>>();
  const vocabReachedAt: number[] = [];
  for (const u of sorted) {
    if (u.mode === 'read') continue;
    const day = kstDay(u.created_at);
    for (const tok of new Set(extractUniqueTokens(u.final_text))) {
      const days = tokenDays.get(tok) ?? new Set<string>();
      if (days.size < 2 && !days.has(day)) {
        days.add(day);
        if (days.size === 2) vocabReachedAt.push(u.created_at);
      }
      tokenDays.set(tok, days);
    }
  }
  const mastered = input.masteredAt.filter((x): x is number => typeof x === 'number').sort((a, b) => a - b);
  const countUpTo = (xs: readonly number[], t: number) => {
    let n = 0;
    for (const x of xs) if (x < t) n++;
    return n;
  };
  const freeWordsBefore = (t: number) => sorted.reduce((a, u) => (u.mode === 'free' && u.created_at < t ? a + Math.max(0, u.words) : a), 0);

  const weeks: DashboardWeek[] = [];
  for (let i = 0; i < nWeeks; i++) {
    const ws = firstWeek + i * WEEK;
    const we = ws + WEEK;
    const rows = byWeek.get(ws) ?? [];
    const free = rows.filter((u) => u.mode === 'free');
    const freeWords = free.reduce((a, u) => a + Math.max(0, u.words), 0);
    const freeDurMin = free.reduce((a, u) => a + Math.max(0, u.dur_ms), 0) / 60_000;
    const latencies = free.map((u) => u.latency_ms).filter((x) => x > 0);
    const connectors = free.reduce((a, u) => a + [...countConnectors(u.final_text).values()].reduce((x, y) => x + y, 0), 0);
    const modes = { lesson: emptyModes(), solo: emptyModes() };
    for (const u of rows) {
      const m = modes[u.session_kind === 'lesson' ? 'lesson' : 'solo'];
      if (u.mode in m) m[u.mode as keyof ModeCounts] += 1;
    }
    const window4 = sorted.filter((u) => u.created_at >= we - 4 * WEEK && u.created_at < we);
    weeks.push({
      week_start: ws,
      free_words: freeWords,
      speaking_min: r1(rows.reduce((a, u) => a + Math.max(0, u.dur_ms), 0) / 60_000),
      free_utterances: free.length,
      speech_wpm: freeDurMin > 0 ? r1(freeWords / freeDurMin) : null,
      response_sec: latencies.length ? r1(median(latencies)! / 1000) : null,
      mean_words: free.length ? r1(freeWords / free.length) : null,
      connectors_per_100: freeWords > 0 ? r1((connectors / freeWords) * 100) : null,
      think_speak: indexOf(rows, baseline),
      think_speak_4w: indexOf(window4, baseline),
      modes,
      lesson_days: new Set(input.lessonStarts.filter((t) => t >= ws && t < we).map(kstDay)).size,
      play_days: new Set(rows.map((u) => kstDay(u.created_at))).size,
      cum_free_words: freeWordsBefore(we),
      cum_vocab: countUpTo(vocabReachedAt, we),
      cum_mastered: countUpTo(mastered, we)
    });
  }

  // Projection: average weekly increase over the last up-to-8 weeks that had speech, extended 12 weeks.
  const project = (key: 'cum_free_words' | 'cum_vocab' | 'cum_mastered'): ProjectionPoint[] => {
    const active = weeks.filter((w) => w.play_days > 0);
    if (active.length < 2) return [];
    const trend = weeks.slice(-DASHBOARD_TREND_WEEKS);
    const firstIdx = trend.findIndex((w) => w.play_days > 0);
    if (firstIdx < 0 || trend.length - firstIdx < 2) return [];
    const from = trend[firstIdx]!;
    const to = trend[trend.length - 1]!;
    const steps = trend.length - 1 - firstIdx;
    const slope = (to[key] - from[key]) / steps;
    return Array.from({ length: DASHBOARD_PROJECTION_WEEKS }, (_, k) => ({
      week_start: to.week_start + (k + 1) * WEEK,
      value: Math.round(to[key] + slope * (k + 1))
    }));
  };

  const calStart = Math.floor((input.nowMs + KST) / DAY) * DAY - KST - (DASHBOARD_CALENDAR_DAYS - 1) * DAY;
  const perDay = new Map<string, number>();
  for (const u of sorted) {
    if (u.mode !== 'free' || u.created_at < calStart) continue;
    const d = kstDay(u.created_at);
    perDay.set(d, (perDay.get(d) ?? 0) + Math.max(0, u.words));
  }
  const calendar = Array.from({ length: DASHBOARD_CALENDAR_DAYS }, (_, i) => {
    const day = kstDay(calStart + i * DAY);
    return { day, free_words: perDay.get(day) ?? 0 };
  });

  const conn = new Map<string, number>();
  for (const u of sorted) {
    if (u.mode !== 'free' || u.created_at < firstWeek) continue;
    for (const [k, v] of countConnectors(u.final_text)) conn.set(k, (conn.get(k) ?? 0) + v);
  }
  const connectors = [...conn.entries()].map(([expr, count]) => ({ expr, count })).sort((a, b) => b.count - a.count || a.expr.localeCompare(b.expr));

  return {
    weeks,
    projection: { cum_free_words: project('cum_free_words'), cum_vocab: project('cum_vocab'), cum_mastered: project('cum_mastered') },
    calendar,
    connectors,
    has_data: sorted.length > 0
  };
}
