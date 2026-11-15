/**
 * Guardian dashboard (WP-309, docs/07 §4.1–4.3, docs/08 §9.1–9.2). Every graph has a table view. Numbers come
 * from one server payload (`buildDashboardSeries` in packages/metrics), so cards, graphs and tables agree.
 * Rules: weekly dots light + 4-week line 3px, lesson weeks ticked, estimates dashed at 50% with "추정",
 * amounts start at 0, the index shows the 100 line, no dual axes (small multiples), cumulative curves sit next to
 * a weekly-change graph, short samples are hollow circles labelled "표본 부족", modes use colour + pattern.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, TOKENS } from '@lcw/ui';
import { createFamilyApi, loadGuardianToken, type DashboardPayload, type DashboardWeek, type FamilyApi } from './familyApi.js';
import { errorCodeOf } from './lessonApi.js';
import { Box, LessonStyle, Notice, border, sp } from './lessonUi.js';
import { PARENT_STRINGS_KO } from './parentStrings.js';

const D = PARENT_STRINGS_KO.dashboard;
const C = TOKENS.colors;
const T = TOKENS.typography;
const px = (n: number) => `${n}px`;
const small: React.CSSProperties = { fontSize: px(T.scale.small.sizePx), lineHeight: px(T.scale.small.lineHeightPx), color: C['ink-700'] };
const h2: React.CSSProperties = { margin: 0, fontSize: px(T.scale.h2.sizePx), lineHeight: px(T.scale.h2.lineHeightPx) };
const h3: React.CSSProperties = { margin: 0, fontSize: px(T.scale.h3.sizePx), lineHeight: px(T.scale.h3.lineHeightPx) };
const KST = 9 * 3_600_000;

/* ---------- pure helpers (tested) ---------- */

/** "11/16" for a KST week start. */
export function weekLabel(ms: number): string {
  const d = new Date(ms + KST);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

const fmt = (n: number) => (Number.isInteger(n) ? n.toLocaleString('ko-KR') : n.toFixed(1));

/** 4-week change of a card value: this week vs the week four weeks earlier (docs/07 §5). */
export type Change = { kind: 'up' | 'down' | 'flat'; from: number; to: number } | { kind: 'new' } | { kind: 'short' };

export function fourWeekChange(now: number | null, before: number | null, flatBand = 0.05): Change {
  if (now === null) return { kind: 'short' };
  if (before === null || before === 0) return before === 0 && now === 0 ? { kind: 'flat', from: 0, to: 0 } : { kind: 'new' };
  const rel = (now - before) / Math.abs(before);
  if (Math.abs(rel) <= flatBand) return { kind: 'flat', from: before, to: now };
  return { kind: rel > 0 ? 'up' : 'down', from: before, to: now };
}

export function changeLine(c: Change, unit: string): string {
  switch (c.kind) {
    case 'up':
      return D.lineUp(`${fmt(c.from)}${unit}`, `${fmt(c.to)}${unit}`);
    case 'down':
      return D.lineDown(`${fmt(c.from)}${unit}`, `${fmt(c.to)}${unit}`);
    case 'flat':
      return D.lineFlat(`${fmt(c.from)}${unit}`);
    case 'new':
      return D.lineNew;
    default:
      return D.thinkShort;
  }
}

export function changeBadge(c: Change, unit: string): string {
  if (c.kind === 'up' || c.kind === 'down' || c.kind === 'flat') {
    const diff = c.to - c.from;
    const arrow = diff > 0 ? '▲' : diff < 0 ? '▼' : '＝';
    return D.change4w(`${arrow} ${fmt(Math.abs(Math.round(diff * 10) / 10))}${unit}`);
  }
  return D.changeNone;
}

/** Headline (docs/07 4.1): this week's free words and, when there is a base, the ratio to four weeks ago. */
export function headline(nick: string, weeks: readonly DashboardWeek[]): string {
  const now = weeks[weeks.length - 1];
  const before = weeks[weeks.length - 5];
  if (!now || now.free_words === 0) return D.headlineNone;
  const base = D.headline(nick, now.free_words);
  if (!before || before.free_words === 0) return base;
  return base + D.headlineRatio((Math.round((now.free_words / before.free_words) * 10) / 10).toFixed(1));
}

/* ---------- chart pieces ---------- */

interface TableSpec {
  cols: string[];
  rows: Array<Array<string | number>>;
}

function DataTable({ spec, testId }: { spec: TableSpec; testId?: string }): React.ReactElement {
  return (
    <div style={{ maxHeight: '320px', overflow: 'auto', border, borderRadius: px(TOKENS.shape.radiusCardPx) }}>
      <table data-testid={testId} style={{ width: '100%', borderCollapse: 'collapse', fontSize: px(T.scale.small.sizePx) }}>
        <thead>
          <tr>
            {spec.cols.map((c) => (
              <th key={c} scope="col" style={{ textAlign: 'left', padding: sp(1), borderBottom: border, position: 'sticky', top: 0, background: C['paper-50'], whiteSpace: 'nowrap' }}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {spec.rows.map((r, i) => (
            <tr key={i} style={{ borderTop: i ? `1px solid ${C['line-200']}` : undefined }}>
              {r.map((v, j) => (
                <td key={j} style={{ padding: sp(1), whiteSpace: 'nowrap' }}>
                  {v}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ChartCard({
  title,
  note,
  legend,
  table,
  testId,
  initialTable = false,
  controls,
  footer,
  children
}: {
  title: string;
  note?: string;
  legend?: React.ReactNode;
  table: TableSpec;
  testId: string;
  initialTable?: boolean;
  controls?: React.ReactNode;
  /** Shown under the graph or table in both views (the index card's component breakdown). */
  footer?: React.ReactNode;
  children: React.ReactNode;
}): React.ReactElement {
  const [showTable, setShowTable] = useState(initialTable);
  return (
    <Box testId={testId}>
      <div style={{ display: 'grid', gap: sp(2) }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: sp(2), flexWrap: 'wrap' }}>
          <h3 style={h3}>{title}</h3>
          <Button type="button" variant="paper" aria-pressed={showTable} onClick={() => setShowTable((v) => !v)}>
            {showTable ? D.showChart : D.showTable}
          </Button>
        </div>
        {controls}
        {showTable ? <DataTable spec={table} testId={`${testId}-table`} /> : children}
        {legend ? <div style={{ display: 'flex', gap: sp(3), flexWrap: 'wrap', ...small }}>{legend}</div> : null}
        {note ? <p style={{ ...small, margin: 0 }}>{note}</p> : null}
        {footer}
      </div>
    </Box>
  );
}

function Swatch({ color, dashed, hollow, pattern }: { color: string; dashed?: boolean; hollow?: boolean; pattern?: string }): React.ReactElement {
  return (
    <svg width="22" height="12" aria-hidden="true" style={{ verticalAlign: 'middle', marginRight: 4 }}>
      {pattern ? <PatternDefs /> : null}
      {hollow ? (
        <circle cx="11" cy="6" r="4" fill={C['paper-0']} stroke={color} strokeWidth="2" />
      ) : dashed !== undefined ? (
        <line x1="1" y1="6" x2="21" y2="6" stroke={color} strokeWidth="3" strokeDasharray={dashed ? '4 3' : undefined} opacity={dashed ? 0.5 : 1} />
      ) : (
        <rect x="1" y="1" width="20" height="10" rx="2" fill={pattern ? `url(#${pattern})` : color} stroke={C['ink-900']} strokeWidth="1" />
      )}
    </svg>
  );
}

const W = 640;
const H = 210;
const PAD = { l: 44, r: 12, t: 12, b: 30 };

interface LinePoint {
  label: string;
  y: number | null;
  tick?: boolean;
}

/** One series line chart: optional weekly dots + bold line, dashed estimate, reference line, lesson ticks. */
export function LineChart({
  points,
  line,
  projection = [],
  reference,
  color = C['sky-d'],
  unit,
  zeroBased = true,
  dots = false,
  height = H,
  width = W,
  ariaLabel
}: {
  points: LinePoint[];
  line?: Array<number | null>;
  projection?: Array<{ label: string; y: number }>;
  reference?: number;
  color?: string;
  unit: string;
  zeroBased?: boolean;
  dots?: boolean;
  height?: number;
  /** viewBox width: small multiples use a narrower box so their text stays readable. */
  width?: number;
  ariaLabel: string;
}): React.ReactElement {
  const all = [...points.map((p) => p.y), ...(line ?? []), ...projection.map((p) => p.y), reference ?? null].filter(
    (v): v is number => typeof v === 'number'
  );
  const maxV = Math.max(1, ...all);
  const minV = zeroBased ? 0 : Math.min(...all, reference ?? Infinity);
  const lo = zeroBased ? 0 : Math.floor(minV * 0.9);
  const hi = Math.ceil(maxV * 1.1);
  const n = points.length + projection.length;
  const x = (i: number) => PAD.l + (n <= 1 ? 0 : (i * (width - PAD.l - PAD.r)) / (n - 1));
  const labelStep = width < 400 ? 3 : 2;
  const y = (v: number) => height - PAD.b - ((v - lo) / Math.max(1e-9, hi - lo)) * (height - PAD.t - PAD.b);
  const path = (vals: Array<number | null>, offset = 0) => {
    let d = '';
    let pen = false;
    vals.forEach((v, i) => {
      if (v === null) {
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'}${x(i + offset).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  const mainLine = line ?? (dots ? null : points.map((p) => p.y));
  const lastIdx = points.length - 1;
  const lastVal = points[lastIdx]?.y ?? null;
  const yTicks = [...new Set([lo, reference ?? Math.round((lo + hi) / 2), hi])];
  return (
    <svg role="img" aria-label={ariaLabel} viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 'auto', display: 'block', overflow: 'visible' }}>
      {yTicks.map((v) => (
        <g key={v}>
          <line x1={PAD.l} x2={width - PAD.r} y1={y(v)} y2={y(v)} stroke={C['line-200']} strokeWidth="1" />
          <text x={PAD.l - 6} y={y(v) + 4} textAnchor="end" fontSize="11" fill={C['ink-700']}>
            {fmt(v)}
          </text>
        </g>
      ))}
      {reference !== undefined ? (
        <line x1={PAD.l} x2={width - PAD.r} y1={y(reference)} y2={y(reference)} stroke={C['ink-500']} strokeWidth="1.5" strokeDasharray="5 4" />
      ) : null}
      {points.map((p, i) =>
        (points.length - 1 - i) % labelStep === 0 ? (
          <text key={`l${i}`} x={x(i)} y={height - 10} textAnchor="middle" fontSize="11" fill={C['ink-700']}>
            {p.label}
          </text>
        ) : null
      )}
      {points.map((p, i) =>
        p.tick ? (
          <g key={`t${i}`}>
            <line x1={x(i)} x2={x(i)} y1={height - PAD.b} y2={height - PAD.b + 6} stroke={C['ink-900']} strokeWidth="2" />
            <title>{D.lessonTick}</title>
          </g>
        ) : null
      )}
      {projection.length > 0 && lastVal !== null ? (
        <path
          d={`M${x(lastIdx)},${y(lastVal)}${projection.map((p, k) => `L${x(lastIdx + 1 + k)},${y(p.y)}`).join('')}`}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeDasharray="6 4"
          opacity="0.5"
        />
      ) : null}
      {projection.length > 0 ? (
        <text x={x(n - 1)} y={y(projection[projection.length - 1]!.y) - 8} textAnchor="end" fontSize="11" fill={C['ink-700']}>
          {D.estimate}
        </text>
      ) : null}
      {mainLine ? <path d={path(mainLine)} fill="none" stroke={color} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" /> : null}
      {points.map((p, i) =>
        p.y === null ? (
          dots ? (
            <g key={`d${i}`}>
              <circle cx={x(i)} cy={height - PAD.b - 8} r="4" fill={C['paper-0']} stroke={C['ink-500']} strokeWidth="1.5" />
              <title>{`${p.label} · ${D.shortSample}`}</title>
            </g>
          ) : null
        ) : (
          <g key={`d${i}`}>
            <circle cx={x(i)} cy={y(p.y)} r={dots ? 5 : 3.5} fill={color} fillOpacity={dots ? 0.45 : 1} stroke={C['paper-0']} strokeWidth="2" />
            <circle cx={x(i)} cy={y(p.y)} r="12" fill="transparent">
              <title>{`${p.label} · ${fmt(p.y)}${unit}`}</title>
            </circle>
          </g>
        )
      )}
    </svg>
  );
}

type ModeKey = 'free' | 'guided' | 'read' | 'recall';
const MODE_KEYS: ModeKey[] = ['free', 'guided', 'read', 'recall'];
const MODE_FILL: Record<ModeKey, string> = { free: C.brand, guided: C.sun, read: C.silver, recall: C.grape };
const MODE_PATTERN: Record<ModeKey, string> = { free: 'lcw-p-free', guided: 'lcw-p-guided', read: 'lcw-p-read', recall: 'lcw-p-recall' };

function PatternDefs(): React.ReactElement {
  return (
    <defs>
      <pattern id="lcw-p-free" width="6" height="6" patternUnits="userSpaceOnUse">
        <rect width="6" height="6" fill={C.brand} />
      </pattern>
      <pattern id="lcw-p-guided" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="6" height="6" fill={C.sun} />
        <line x1="0" y1="0" x2="0" y2="6" stroke={C['sun-d']} strokeWidth="2" />
      </pattern>
      <pattern id="lcw-p-read" width="6" height="6" patternUnits="userSpaceOnUse">
        <rect width="6" height="6" fill={C.silver} />
        <circle cx="3" cy="3" r="1.2" fill={C['ink-500']} />
      </pattern>
      <pattern id="lcw-p-recall" width="6" height="6" patternUnits="userSpaceOnUse">
        <rect width="6" height="6" fill={C.grape} />
        <path d="M0 3H6M3 0V6" stroke={C['grape-l']} strokeWidth="1" />
      </pattern>
    </defs>
  );
}

/** Narrow screens draw charts in a narrower box so axis text stays readable at phone width (390px). */
export const NARROW_CHART_WIDTH = 340;
export function useChartWidth(): number {
  const query = '(max-width: 600px)';
  const read = () => {
    try {
      return typeof window !== 'undefined' && window.matchMedia(query).matches;
    } catch {
      return false;
    }
  };
  const [narrow, setNarrow] = useState(read);
  useEffect(() => {
    try {
      const m = window.matchMedia(query);
      const on = () => setNarrow(m.matches);
      m.addEventListener('change', on);
      return () => m.removeEventListener('change', on);
    } catch {
      return undefined;
    }
  }, []);
  return narrow ? NARROW_CHART_WIDTH : W;
}

export function ModeBars({ weeks, scope, width = W }: { weeks: readonly DashboardWeek[]; scope: 'lesson' | 'solo' | 'both'; width?: number }): React.ReactElement {
  const counts = weeks.map((w) =>
    MODE_KEYS.map((k) => (scope === 'both' ? w.modes.lesson[k] + w.modes.solo[k] : w.modes[scope][k]))
  );
  const maxV = Math.max(1, ...counts.map((c) => c.reduce((a, b) => a + b, 0)));
  const hi = Math.ceil(maxV * 1.1);
  const slot = (width - PAD.l - PAD.r) / weeks.length;
  const bw = Math.max(6, slot - (width < 400 ? 4 : 8));
  const labelStep = width < 400 ? 3 : 2;
  const y = (v: number) => H - PAD.b - (v / hi) * (H - PAD.t - PAD.b);
  return (
    <svg role="img" aria-label={D.charts.weekly.title} viewBox={`0 0 ${width} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      <PatternDefs />
      {[0, Math.round(hi / 2), hi].map((v) => (
        <g key={v}>
          <line x1={PAD.l} x2={width - PAD.r} y1={y(v)} y2={y(v)} stroke={C['line-200']} />
          <text x={PAD.l - 6} y={y(v) + 4} textAnchor="end" fontSize="11" fill={C['ink-700']}>
            {v}
          </text>
        </g>
      ))}
      {weeks.map((w, i) => {
        let acc = 0;
        const x0 = PAD.l + i * slot + (slot - bw) / 2;
        return (
          <g key={w.week_start}>
            {MODE_KEYS.map((k, j) => {
              const v = counts[i]![j]!;
              if (v <= 0) return null;
              const top = y(acc + v);
              const hgt = y(acc) - top - 2; // 2px surface gap between segments
              acc += v;
              return (
                <rect key={k} x={x0} y={top} width={bw} height={Math.max(1, hgt)} rx="2" fill={`url(#${MODE_PATTERN[k]})`} stroke={C['ink-900']} strokeWidth="1">
                  <title>{`${weekLabel(w.week_start)} · ${D.charts.modes[k]} ${v}`}</title>
                </rect>
              );
            })}
            {(weeks.length - 1 - i) % labelStep === 0 ? (
              <text x={x0 + bw / 2} y={H - 10} textAnchor="middle" fontSize="11" fill={C['ink-700']}>
                {weekLabel(w.week_start)}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

function HBars({ items }: { items: Array<{ label: string; value: number }> }): React.ReactElement {
  const maxV = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: sp(2) }}>
      {items.map((it) => (
        <li key={it.label} style={{ display: 'grid', gridTemplateColumns: 'minmax(80px, 120px) 1fr auto', gap: sp(2), alignItems: 'center' }}>
          <span lang="en" style={{ fontFamily: T.fonts.target, fontWeight: 700 }}>
            {it.label}
          </span>
          <span style={{ height: 14, background: C['paper-100'], borderRadius: 4, overflow: 'hidden' }}>
            <span style={{ display: 'block', height: '100%', width: `${(it.value / maxV) * 100}%`, background: C['sky-d'], borderRadius: 4 }} />
          </span>
          <span style={small}>{`${it.value}${D.units.times}`}</span>
        </li>
      ))}
    </ul>
  );
}

function Ladder({ level }: { level: string }): React.ReactElement {
  const levels = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'];
  const cur = Math.max(0, levels.indexOf(level));
  return (
    <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', alignItems: 'flex-end', gap: sp(1) }} aria-label={D.charts.ladder.title}>
      {levels.map((l, i) => (
        <li
          key={l}
          aria-current={i === cur ? 'step' : undefined}
          style={{
            flex: 1,
            height: 24 + i * 12,
            border,
            borderRadius: 4,
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
            paddingBottom: 2,
            fontWeight: 700,
            background: i < cur ? C['leaf'] : i === cur ? C.sun : C['paper-0'],
            color: C['ink-900']
          }}
        >
          {l}
        </li>
      ))}
    </ol>
  );
}

/* ---------- docs/07 §2.1: how the index is made, and its six components ---------- */

type PartKey = 'words' | 'speed' | 'prep' | 'connectors' | 'target' | 'hintFree';
const PARTS: ReadonlyArray<{
  key: PartKey;
  weight: number;
  unit: string;
  value: (w: DashboardWeek) => number | null;
  base: (b: NonNullable<DashboardPayload['series']['baseline']>) => number;
}> = [
  { key: 'words', weight: 30, unit: D.units.words, value: (w) => w.mean_words, base: (b) => r1(b.mean_words) },
  { key: 'speed', weight: 20, unit: D.units.wpm, value: (w) => w.speech_wpm, base: (b) => r1(b.speech_wpm) },
  { key: 'prep', weight: 15, unit: D.units.secPerWord, value: (w) => (w.prep_per_word_ms === null ? null : r2(w.prep_per_word_ms / 1000)), base: (b) => r2(b.latency_per_word_ms / 1000) },
  { key: 'connectors', weight: 15, unit: D.units.per100, value: (w) => w.connectors_per_100, base: (b) => r1(b.connectors_per_100) },
  { key: 'target', weight: 10, unit: D.units.pct, value: (w) => (w.target_lang_ratio === null ? null : Math.round(w.target_lang_ratio * 100)), base: (b) => Math.round(b.target_lang_ratio * 100) },
  { key: 'hintFree', weight: 10, unit: D.units.pct, value: (w) => (w.hint_free_ratio === null ? null : Math.round(w.hint_free_ratio * 100)), base: (b) => Math.round(b.hint_free_ratio * 100) }
];
function r1(n: number): number {
  return Math.round(n * 10) / 10;
}
function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** "구성 지표 펼치기" (docs/07 §4.2): the formula in words, then one small graph per component with the start dashed. */
export function ThinkParts({
  weeks,
  baseline,
  labels,
  ticks,
  initialOpen = false
}: {
  weeks: readonly DashboardWeek[];
  baseline: DashboardPayload['series']['baseline'];
  labels: string[];
  ticks: boolean[];
  initialOpen?: boolean;
}): React.ReactElement {
  const [open, setOpen] = useState(initialOpen);
  const [table, setTable] = useState(false);
  const fmtV = (v: number | null) => (v === null ? '—' : fmt(v));
  return (
    <div data-testid="think-parts" style={{ display: 'grid', gap: sp(2), borderTop: `1px solid ${C['line-200']}`, paddingTop: sp(2) }}>
      <div>
        <Button type="button" variant="paper" aria-expanded={open} onClick={() => setOpen((v) => !v)} data-testid="think-parts-toggle">
          {D.parts.summary}
        </Button>
      </div>
      {open ? (
        <>
          <p style={{ ...small, margin: 0 }} data-testid="think-parts-how">{D.parts.how}</p>
          {baseline ? null : <p style={{ ...small, margin: 0 }}>{D.parts.noBase}</p>}
          <div>
            <Button type="button" variant="paper" aria-pressed={table} onClick={() => setTable((v) => !v)}>
              {table ? D.showChart : D.showTable}
            </Button>
          </div>
          {table ? (
            <DataTable
              testId="think-parts-table"
              spec={{
                cols: [D.weekCol, ...PARTS.map((p) => `${D.parts[p.key]}(${p.unit})`)],
                rows: [
                  ...(baseline ? [[D.parts.legendBase, ...PARTS.map((p) => fmt(p.base(baseline)))]] : []),
                  ...weeks.map((w, i) => [labels[i]!, ...PARTS.map((p) => fmtV(p.value(w)))])
                ]
              }}
            />
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: sp(3) }}>
              {PARTS.map((p) => (
                <div key={p.key} style={{ display: 'grid', gap: sp(1) }} data-testid={`think-part-${p.key}`}>
                  <strong style={small}>{`${D.parts[p.key]} (${p.unit}) · ${D.parts.weight(p.weight)}`}</strong>
                  <LineChart
                    ariaLabel={D.parts[p.key]}
                    unit={p.unit}
                    width={300}
                    height={170}
                    reference={baseline ? p.base(baseline) : undefined}
                    points={weeks.map((w, i) => ({ label: labels[i]!, y: p.value(w), tick: ticks[i] }))}
                  />
                </div>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: sp(3), flexWrap: 'wrap', ...small }}>
            <span><Swatch color={C['sky-d']} dashed={false} />{D.parts.legendValue}</span>
            {baseline ? <span><Swatch color={C['ink-500']} dashed />{D.parts.legendBase}</span> : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

export function Calendar({ days }: { days: ReadonlyArray<{ day: string; free_words: number }> }): React.ReactElement {
  const maxV = Math.max(1, ...days.map((d) => d.free_words));
  const first = days[0] ? new Date(`${days[0].day}T00:00:00Z`).getUTCDay() : 0;
  const lead = (first + 6) % 7; // Monday-first rows
  const cells = [...Array<null>(lead).fill(null), ...days];
  const cols = Math.ceil(cells.length / 7);
  const size = 14;
  const gapPx = 3;
  const shade = (v: number) => (v <= 0 ? 0 : 0.2 + 0.8 * (v / maxV));
  return (
    <div style={{ overflowX: 'auto' }}>
      <svg role="img" aria-label={D.charts.calendar.title} width={cols * (size + gapPx)} height={7 * (size + gapPx)}>
        {cells.map((c, i) => {
          if (!c) return null;
          const col = Math.floor(i / 7);
          const row = i % 7;
          return (
            <rect key={c.day} x={col * (size + gapPx)} y={row * (size + gapPx)} width={size} height={size} rx="3" fill={c.free_words > 0 ? C['brand-d'] : C['paper-100']} fillOpacity={c.free_words > 0 ? shade(c.free_words) : 1} stroke={C['line-200']} strokeWidth="1">
              <title>{`${c.day} · ${c.free_words}${D.units.words}`}</title>
            </rect>
          );
        })}
      </svg>
    </div>
  );
}

/* ---------- page ---------- */

export type DashboardLoad =
  | { state: 'loading' }
  | { state: 'no_session' }
  | { state: 'no_child' }
  | { state: 'ok'; data: DashboardPayload; childId: string; children: Array<{ id: string; nickname: string }> }
  | { state: 'error' };

const childFromQuery = () => {
  try {
    return new URLSearchParams(window.location.search).get('child');
  } catch {
    return null;
  }
};

function Card4({ label, value, unit, badge, line, testId }: { label: string; value: string; unit: string; badge: string; line: string; testId: string }): React.ReactElement {
  return (
    <div data-testid={testId} style={{ border, borderRadius: px(TOKENS.shape.radiusCardPx), padding: sp(3), background: C['paper-0'], display: 'grid', gap: sp(1), alignContent: 'start' }}>
      <span style={{ ...small, fontWeight: 700, color: C['ink-900'] }}>{label}</span>
      <span style={{ fontSize: px(value === D.shortSample ? T.scale.h3.sizePx : T.scale.h1.sizePx), fontWeight: 800, lineHeight: 1.1 }}>
        {value}
        {value !== D.shortSample ? <span style={{ fontSize: px(T.scale.body.sizePx), fontWeight: 600, marginLeft: 4 }}>{unit}</span> : null}
      </span>
      <span style={{ ...small, fontWeight: 700 }}>{badge}</span>
      <span style={small}>{line}</span>
    </div>
  );
}

export function DashboardView({ data, initialTables = false }: { data: DashboardPayload; initialTables?: boolean }): React.ReactElement {
  const [scope, setScope] = useState<'both' | 'lesson' | 'solo'>('both');
  const chartW = useChartWidth();
  const weeks = data.series.weeks;
  const now = weeks[weeks.length - 1]!;
  const before = weeks[weeks.length - 5] ?? null;
  const nick = data.child.nickname;
  const labels = weeks.map((w) => weekLabel(w.week_start));
  const ticks = weeks.map((w) => w.lesson_days > 0);
  const weekRows = (f: (w: DashboardWeek) => Array<string | number>) => weeks.map((w) => [weekLabel(w.week_start), ...f(w)]);
  const opt = (v: number | null, unit = '') => (v === null ? D.shortSample : `${fmt(v)}${unit}`);

  const thinkC = fourWeekChange(now.think_speak_4w, before?.think_speak_4w ?? null);
  const freeC = fourWeekChange(now.free_words, before ? before.free_words : null);
  const timeC = fourWeekChange(now.speaking_min, before ? before.speaking_min : null);
  const mastC = fourWeekChange(now.cum_mastered, before ? before.cum_mastered : null);
  const fewDays = now.play_days > 0 && now.play_days <= 2 && freeC.kind === 'down';

  if (!data.series.has_data) {
    return (
      <Box testId="dashboard-waiting">
        <p style={{ margin: 0 }}>{D.waiting}</p>
      </Box>
    );
  }

  const cum = (key: 'cum_free_words' | 'cum_vocab' | 'cum_mastered', title: string, unit: string) => (
    <div style={{ display: 'grid', gap: sp(1) }}>
      <strong style={small}>{title}</strong>
      <LineChart
        ariaLabel={title}
        unit={unit}
        width={chartW}
        height={chartW < W ? 190 : 150}
        points={weeks.map((w, i) => ({ label: labels[i]!, y: w[key], tick: ticks[i] }))}
        projection={data.series.projection[key].map((p) => ({ label: weekLabel(p.week_start), y: p.value }))}
      />
    </div>
  );

  return (
    <div style={{ display: 'grid', gap: sp(4) }}>
      <p data-testid="dashboard-headline" style={{ margin: 0, fontSize: px(T.scale.h3.sizePx), fontWeight: 700 }}>
        {headline(nick, weeks)}
      </p>

      <div data-testid="dashboard-cards" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: sp(3) }}>
        <Card4
          testId="card-think"
          label={D.cards.think}
          value={now.think_speak_4w === null ? (data.series.baseline ? D.shortSample : D.baselinePending) : String(now.think_speak_4w)}
          unit=""
          badge={changeBadge(thinkC, '')}
          line={now.think_speak_4w === null ? (data.series.baseline ? D.thinkShort : D.thinkBaseline) : `${changeLine(thinkC, '')} ${D.thinkNote}`}
        />
        <Card4
          testId="card-free"
          label={D.cards.free}
          value={fmt(now.free_words)}
          unit={D.units.words}
          badge={changeBadge(freeC, D.units.words)}
          line={fewDays ? D.lineFewDays(now.play_days) : changeLine(freeC, D.units.words)}
        />
        <Card4
          testId="card-time"
          label={D.cards.time}
          value={fmt(now.speaking_min)}
          unit={D.units.min}
          badge={changeBadge(timeC, D.units.min)}
          line={changeLine(timeC, D.units.min)}
        />
        <Card4
          testId="card-mastered"
          label={D.cards.mastered}
          value={fmt(now.cum_mastered)}
          unit={D.units.sentences}
          badge={changeBadge(mastC, D.units.sentences)}
          line={D.masteredNote}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: sp(3) }}>
        <Box title={D.weekLineTitle} testId="dashboard-week-line">
          {data.week_line ? (
            <>
              <p lang="en" style={{ margin: 0, fontFamily: T.fonts.target, fontSize: px(T.scale.h3.sizePx), fontWeight: 700 }}>
                “{data.week_line.text}”
              </p>
              <p style={{ ...small, margin: `${sp(1)} 0 0` }}>{D.weekLineMeta(data.week_line.words)}</p>
            </>
          ) : (
            <p style={{ ...small, margin: 0 }}>{D.weekLineNone}</p>
          )}
        </Box>
        <Box title={D.reviewTitle} testId="dashboard-review">
          {data.review.length ? (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', gap: sp(2) }}>
              {data.review.map((r, i) => (
                <li key={i} lang="en" style={{ border, borderRadius: 999, padding: `${sp(1)} ${sp(3)}`, background: C['paper-50'], fontFamily: T.fonts.target, fontWeight: 700 }}>
                  {r.text}
                </li>
              ))}
            </ul>
          ) : (
            <p style={{ ...small, margin: 0 }}>{D.reviewNone}</p>
          )}
        </Box>
      </div>

      <h2 style={h2}>{D.growthTitle}</h2>

      <ChartCard
        testId="chart-think"
        initialTable={initialTables}
        footer={
          <>
            {data.series.baseline ? null : <p style={{ ...small, margin: 0 }} data-testid="think-baseline-pending">{D.thinkBaseline}</p>}
            <ThinkParts weeks={weeks} baseline={data.series.baseline} labels={labels} ticks={ticks} initialOpen={initialTables} />
          </>
        }
        title={D.charts.think.title}
        note={D.charts.think.note}
        legend={
          <>
            <span><Swatch color={C['sky-d']} />{D.charts.think.legendDot}</span>
            <span><Swatch color={C['sky-d']} dashed={false} />{D.charts.think.legendLine}</span>
            <span><Swatch color={C['ink-500']} hollow />{D.shortSample}</span>
          </>
        }
        table={{
          cols: [D.weekCol, D.charts.think.legendDot, D.charts.think.legendLine, D.lessonTick],
          rows: weekRows((w) => [
            w.think_status === 'baseline' ? D.baselinePending : opt(w.think_speak),
            w.think_speak_4w === null && !data.series.baseline ? D.baselinePending : opt(w.think_speak_4w),
            w.lesson_days ? '●' : ''
          ])
        }}
      >
        <LineChart
          ariaLabel={D.charts.think.title}
          unit=""
          width={chartW}
          height={chartW < W ? 240 : H}
          dots
          zeroBased={false}
          reference={100}
          points={weeks.map((w, i) => ({ label: labels[i]!, y: w.think_speak, tick: ticks[i] }))}
          line={weeks.map((w) => w.think_speak_4w)}
        />
      </ChartCard>

      <ChartCard
        testId="chart-cumulative"
        initialTable={initialTables}
        title={D.charts.cumulative.title}
        note={D.charts.cumulative.note}
        legend={
          <>
            <span><Swatch color={C['sky-d']} dashed={false} />실측</span>
            <span><Swatch color={C['sky-d']} dashed />{D.estimate}</span>
          </>
        }
        table={{
          cols: [D.weekCol, D.charts.cumFree, D.charts.cumVocab, D.charts.cumMastered],
          rows: [
            ...weekRows((w) => [w.cum_free_words, w.cum_vocab, w.cum_mastered]),
            ...data.series.projection.cum_free_words.map((p, i) => [
              `${weekLabel(p.week_start)} (${D.estimate})`,
              p.value,
              data.series.projection.cum_vocab[i]?.value ?? '',
              data.series.projection.cum_mastered[i]?.value ?? ''
            ])
          ]
        }}
      >
        <div style={{ display: 'grid', gap: sp(3) }}>
          {cum('cum_free_words', D.charts.cumFree, D.units.words)}
          {cum('cum_vocab', D.charts.cumVocab, D.units.words)}
          {cum('cum_mastered', D.charts.cumMastered, D.units.sentences)}
        </div>
      </ChartCard>

      <ChartCard
        testId="chart-weekly"
        initialTable={initialTables}
        title={D.charts.weekly.title}
        note={D.charts.weekly.note}
        controls={
          <div role="group" aria-label={D.charts.weekly.title} style={{ display: 'flex', gap: sp(1), flexWrap: 'wrap' }}>
            {(['both', 'lesson', 'solo'] as const).map((s) => (
              <Button key={s} type="button" variant={scope === s ? 'brand' : 'paper'} aria-pressed={scope === s} onClick={() => setScope(s)}>
                {D.charts.weekly[s]}
              </Button>
            ))}
          </div>
        }
        legend={MODE_KEYS.map((k) => (
          <span key={k}>
            <Swatch color={MODE_FILL[k]} pattern={MODE_PATTERN[k]} />
            {D.charts.modes[k]}
          </span>
        ))}
        table={{
          cols: [D.weekCol, ...MODE_KEYS.map((k) => `${D.charts.modes[k]} (${D.charts.weekly.lesson}/${D.charts.weekly.solo})`)],
          rows: weekRows((w) => MODE_KEYS.map((k) => `${w.modes.lesson[k]}/${w.modes.solo[k]}`))
        }}
      >
        <ModeBars weeks={weeks} scope={scope} width={chartW} />
      </ChartCard>

      <ChartCard
        testId="chart-fluency"
        initialTable={initialTables}
        title={D.charts.fluency.title}
        note={D.charts.fluency.note}
        table={{
          cols: [D.weekCol, `${D.charts.fluency.wpm}(${D.units.wpm})`, `${D.charts.fluency.words}(${D.units.words})`, `${D.charts.fluency.response}(${D.units.sec})`],
          rows: weekRows((w) => [opt(w.speech_wpm), opt(w.mean_words), opt(w.response_sec)])
        }}
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: sp(3) }}>
          {(
            [
              ['speech_wpm', D.charts.fluency.wpm, D.units.wpm],
              ['mean_words', D.charts.fluency.words, D.units.words],
              ['response_sec', D.charts.fluency.response, D.units.sec]
            ] as const
          ).map(([k, title, unit]) => (
            <div key={k} style={{ display: 'grid', gap: sp(1) }}>
              <strong style={small}>{`${title} (${unit})`}</strong>
              <LineChart ariaLabel={title} unit={unit} width={300} height={190} points={weeks.map((w, i) => ({ label: labels[i]!, y: w[k], tick: ticks[i] }))} />
            </div>
          ))}
        </div>
      </ChartCard>

      <ChartCard
        testId="chart-connectors"
        initialTable={initialTables}
        title={D.charts.connectors.title}
        note={D.charts.connectors.note}
        table={{ cols: ['표현', '횟수'], rows: data.series.connectors.map((c) => [c.expr, c.count]) }}
      >
        {data.series.connectors.length ? (
          <HBars items={data.series.connectors.map((c) => ({ label: c.expr, value: c.count }))} />
        ) : (
          <p style={{ ...small, margin: 0 }}>{D.charts.connectors.none}</p>
        )}
      </ChartCard>

      <ChartCard
        testId="chart-ladder"
        initialTable={initialTables}
        title={D.charts.ladder.title}
        note={D.charts.ladder.note}
        table={{ cols: ['레벨', ''], rows: ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'].map((l) => [l, l === data.child.level ? '지금' : '']) }}
      >
        <Ladder level={data.child.level} />
      </ChartCard>

      <ChartCard
        testId="chart-calendar"
        initialTable={initialTables}
        title={D.charts.calendar.title}
        note={D.charts.calendar.note}
        table={{ cols: [D.charts.calendar.dayCol, D.units.words], rows: data.series.calendar.filter((d) => d.free_words > 0).map((d) => [d.day, d.free_words]) }}
      >
        <Calendar days={data.series.calendar} />
      </ChartCard>

      <Box title={D.lessonsTitle} testId="dashboard-lessons">
        {data.lessons.length === 0 ? (
          <p style={{ ...small, margin: 0 }}>{D.lessonsNone}</p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: sp(2) }}>
            {data.lessons.map((l) => (
              <li key={l.id} style={{ border, borderRadius: px(TOKENS.shape.radiusCardPx), padding: sp(2), display: 'grid', gap: sp(1) }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: sp(2), flexWrap: 'wrap', alignItems: 'baseline' }}>
                  <strong>{new Date(l.started_at + KST).toISOString().slice(0, 10)}</strong>
                  {l.ended_at === null ? (
                    <span style={{ ...small, fontWeight: 700, color: C['leaf-d'] }}>{D.lessonLive}</span>
                  ) : l.report_path ? (
                    <a href={l.report_path} style={{ fontWeight: 700, color: C['sky-d'] }}>
                      {D.lessonReport}
                    </a>
                  ) : null}
                </div>
                <span style={small}>{D.lessonRow(l.duration_min, l.utterances, l.passes)}</span>
                {l.student_share !== null ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: sp(2) }}>
                    <span
                      role="meter"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(l.student_share * 100)}
                      aria-label={D.lessonShare(Math.round(l.student_share * 100))}
                      style={{ flex: 1, height: 10, background: C.sky, borderRadius: 4, overflow: 'hidden', border: `1px solid ${C['ink-900']}` }}
                    >
                      <span style={{ display: 'block', height: '100%', width: `${l.student_share * 100}%`, background: C.brand }} />
                    </span>
                    <span style={small}>{D.lessonShare(Math.round(l.student_share * 100))}</span>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Box>
    </div>
  );
}

export function DashboardPage({ api, initial }: { api?: FamilyApi; initial?: DashboardLoad }): React.ReactElement {
  const apiRef = useRef<FamilyApi>(api ?? createFamilyApi());
  const [load, setLoad] = useState<DashboardLoad>(initial ?? { state: 'loading' });

  const fetchFor = useCallback(async (childId?: string | null) => {
    const g = loadGuardianToken();
    if (!g) return setLoad({ state: 'no_session' });
    try {
      const me = await apiRef.current.me(g);
      const kids = me.children.map((k) => ({ id: k.player_id, nickname: k.nickname }));
      const pick = kids.find((k) => k.id === childId) ?? kids[0];
      if (!pick) return setLoad({ state: 'no_child' });
      const data = await apiRef.current.dashboard(g, pick.id);
      setLoad({ state: 'ok', data, childId: pick.id, children: kids });
    } catch (e) {
      setLoad(errorCodeOf(e) === 'guardian_only' ? { state: 'no_session' } : { state: 'error' });
    }
  }, []);

  useEffect(() => {
    if (initial) return;
    void fetchFor(childFromQuery());
  }, [initial, fetchFor]);

  const data = load.state === 'ok' ? load.data : null;
  return (
    <main
      className="lcw-lesson"
      data-testid="dashboard-page"
      style={{ maxWidth: '980px', margin: '0 auto', display: 'grid', gap: sp(4), fontFamily: T.fonts.ui, wordBreak: 'keep-all', color: C['ink-900'] }}
    >
      <LessonStyle />
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: sp(2), flexWrap: 'wrap' }}>
        <div style={{ display: 'grid', gap: sp(1) }}>
          <h1 style={{ margin: 0, fontSize: px(T.scale.h1.sizePx), lineHeight: px(T.scale.h1.lineHeightPx) }}>{data ? D.title(data.child.nickname) : D.titlePlain}</h1>
          {data ? <span style={small}>{D.levelBadge(data.child.level)}</span> : null}
        </div>
        {data && load.state === 'ok' ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: sp(2), flexWrap: 'wrap' }}>
            {load.children.length > 1 ? (
              <label style={{ ...small, display: 'flex', gap: sp(1), alignItems: 'center' }}>
                {D.pickChild}
                <select value={load.childId} onChange={(e) => void fetchFor(e.target.value)} style={{ minHeight: TOKENS.shape.touchTargetMinPx, border, borderRadius: 6 }}>
                  {load.children.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.nickname}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {data.next_lesson_at ? <span style={{ ...small, fontWeight: 700 }}>{D.nextLesson(data.next_lesson_at)}</span> : null}
            {data.lesson_window_on ? (
              <a
                href={`/window?child=${encodeURIComponent(load.childId)}`}
                data-testid="dashboard-window"
                style={{ border, borderRadius: px(TOKENS.shape.radiusButtonPx), padding: `${sp(1)} ${sp(3)}`, fontWeight: 700, color: C['ink-900'], background: data.lesson_live ? C.leaf : C['paper-0'], textDecoration: 'none' }}
              >
                {data.lesson_live ? D.windowLive : D.windowOpen}
              </a>
            ) : null}
          </div>
        ) : null}
      </header>
      {load.state === 'loading' ? <Box><p style={{ margin: 0 }}>…</p></Box> : null}
      {load.state === 'no_session' ? (
        <Box testId="dashboard-no-session">
          <p style={{ marginTop: 0 }}>{D.noSession}</p>
          <a href="/family">{D.goFamily}</a>
        </Box>
      ) : null}
      {load.state === 'error' ? (
        <Notice kind="error" onRetry={() => void fetchFor(childFromQuery())} retryLabel={D.retry}>
          {D.error}
        </Notice>
      ) : null}
      {data ? <DashboardView data={data} /> : null}
    </main>
  );
}
