/**
 * /r/<token> — the parent's lesson report (docs/18 §1, docs/08 §9.3, docs/07 §5). Opened from a KakaoTalk link on a
 * phone, so it is one narrow column. Order: what the child actually said (quotes), then the three numbers with one
 * line each, the lesson flow, today's expressions, the teacher's note, the next lesson, and the full fact table last.
 * Every number comes from the server's fact sheet (facts.lesson); nothing is computed or rounded differently here.
 * The child's name is never shown: the link can be forwarded.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, TOKENS } from '@lcw/ui';
import { createLessonApi, errorCodeOf, loadOperatorToken, type LessonApi, type SharedReport } from './lessonApi.js';
import { formatLessonFact, kstLabel, reportFactRows } from './lessonFlow.js';
import { LessonStyle, border, sp } from './lessonUi.js';
import { PARENT_STRINGS_KO } from './parentStrings.js';
import { LESSON_STRINGS_KO } from './strings.js';
import { VoiceClips } from './VoiceClips.js';

const S = LESSON_STRINGS_KO.report;
const P = PARENT_STRINGS_KO.report;
const C = TOKENS.colors;
const T = TOKENS.typography;
const px = (n: number) => `${n}px`;

/** The director's "미리 보기" link adds ?preview=1; on the teacher's device the stored operator token then marks it a preview. */
export function previewOperatorToken(search = typeof window !== 'undefined' ? window.location.search : ''): string | null {
  return new URLSearchParams(search).get('preview') === '1' ? loadOperatorToken() : null;
}

export type ReportLoad =
  | { status: 'loading' }
  | { status: 'ok'; report: SharedReport; preview?: boolean }
  | { status: 'not_found' }
  | { status: 'gone' }
  | { status: 'error' };

export interface ParentReportPageProps {
  token: string;
  api?: LessonApi;
  initial?: ReportLoad;
}

export function ParentReportPage({ token, api, initial }: ParentReportPageProps): React.ReactElement {
  const apiRef = useRef<LessonApi>(api ?? createLessonApi());
  const [load, setLoad] = useState<ReportLoad>(initial ?? { status: 'loading' });

  const fetchReport = useCallback(async () => {
    setLoad({ status: 'loading' });
    const op = previewOperatorToken();
    try {
      setLoad({ status: 'ok', report: await apiRef.current.getReport(token, op), preview: Boolean(op) });
    } catch (e) {
      const code = errorCodeOf(e);
      // 410 (30 days passed, or the guardian closed the link) is not a connection problem.
      if (['report_expired', 'report_revoked', 'http_410'].includes(code)) setLoad({ status: 'gone' });
      else setLoad(code === 'report_not_found' || code === 'http_404' ? { status: 'not_found' } : { status: 'error' });
    }
  }, [token]);

  useEffect(() => {
    if (!initial) void fetchReport();
  }, [fetchReport, initial]);

  return (
    <main
      className="lcw-lesson lcw-report"
      data-testid="parent-report-page"
      style={{
        maxWidth: '560px',
        margin: '0 auto',
        display: 'grid',
        gap: sp(4),
        fontSize: px(T.scale['body-l'].sizePx),
        lineHeight: px(T.scale['body-l'].lineHeightPx),
        fontFamily: T.fonts.ui,
        color: C['ink-900'],
        wordBreak: 'keep-all',
        overflowWrap: 'anywhere'
      }}
    >
      <LessonStyle />
      <style>{REPORT_CSS}</style>
      {load.status === 'loading' ? (
        <Card>
          <p style={{ margin: 0 }}>{S.loading}</p>
        </Card>
      ) : null}
      {load.status === 'not_found' || load.status === 'gone' ? (
        <Card>
          <h1 style={h1}>{load.status === 'gone' ? P.goneTitle : S.notFoundTitle}</h1>
          <p style={{ margin: 0 }}>{load.status === 'gone' ? P.goneBody : S.notFoundBody}</p>
        </Card>
      ) : null}
      {load.status === 'error' ? (
        <Card>
          <p role="alert" style={{ marginTop: 0 }}>
            {S.errorBody}
          </p>
          <Button type="button" variant="brand" onClick={() => void fetchReport()}>
            {S.retry}
          </Button>
        </Card>
      ) : null}
      {load.status === 'ok' ? <ReportBody report={load.report} preview={load.preview} token={token} /> : null}
    </main>
  );
}

const REPORT_CSS = `
.lcw-report details > summary { cursor: pointer; list-style: none; min-height: ${TOKENS.shape.touchTargetMinPx}px; display: flex; align-items: center; justify-content: space-between; gap: ${sp(2)}; font-weight: 700; }
.lcw-report details > summary::-webkit-details-marker { display: none; }
.lcw-report details > summary::after { content: '+'; font-size: ${T.scale.h3.sizePx}px; line-height: 1; }
.lcw-report details[open] > summary::after { content: '−'; }
.lcw-report .lcw-quote { animation: lcw-quote-in ${TOKENS.motion.slowMs}ms ease-out both; }
.lcw-report .lcw-quote:nth-child(2) { animation-delay: 80ms; }
.lcw-report .lcw-quote:nth-child(3) { animation-delay: 160ms; }
@keyframes lcw-quote-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .lcw-report .lcw-quote { animation: none; } }
`;

const h1: React.CSSProperties = {
  margin: `0 0 ${sp(2)}`,
  fontSize: px(T.scale.h2.sizePx),
  lineHeight: px(T.scale.h2.lineHeightPx)
};
const h2: React.CSSProperties = {
  margin: `0 0 ${sp(3)}`,
  fontSize: px(T.scale.h3.sizePx),
  lineHeight: px(T.scale.h3.lineHeightPx)
};
const small: React.CSSProperties = { fontSize: px(T.scale.small.sizePx), lineHeight: px(T.scale.small.lineHeightPx), color: C['ink-700'] };

function Card({
  children,
  tone = 'paper',
  accent,
  testId
}: {
  children: React.ReactNode;
  tone?: 'paper' | 'tinted';
  accent?: string;
  testId?: string;
}): React.ReactElement {
  return (
    <section
      data-testid={testId}
      style={{
        backgroundColor: tone === 'tinted' ? C['paper-100'] : C['paper-0'],
        color: C['ink-900'],
        border,
        borderRadius: px(TOKENS.shape.radiusCardPx),
        boxShadow: TOKENS.shape.shadowDefault,
        padding: sp(4),
        borderTop: accent ? `${sp(1)} solid ${accent}` : undefined,
        minWidth: 0
      }}
    >
      {children}
    </section>
  );
}

/* ---------- small pictures (24px grid, 2px ink stroke, docs/08 §4) ---------- */

const STAR_COLORS: Record<number, string> = { 1: C.silver, 2: C.sky, 3: C.sun };

function Star({ filled, color }: { filled: boolean; color: string }): React.ReactElement {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" style={{ display: 'block' }}>
      <path
        d="M12 2.8l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 16.8l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"
        fill={filled ? color : C['paper-0']}
        stroke={C['ink-900']}
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Stars as shapes and as text (docs/08 §2.3: colour is never the only signal). */
function Stars({ n }: { n: number }): React.ReactElement {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }} role="img" aria-label={P.starsLabel(n)}>
      {[1, 2, 3].map((i) => (
        <Star key={i} filled={i <= n} color={STAR_COLORS[n] ?? C.silver} />
      ))}
    </span>
  );
}

function Icon({ d }: { d: string }): React.ReactElement {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" style={{ flex: 'none' }}>
      <path d={d} fill="none" stroke={C['ink-900']} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
const ICON = {
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  chat: 'M4 5h16v11H9l-5 4zM8 10h8M8 13h5',
  pencil: 'M4 20l4-1 11-11-3-3L5 16zM14 6l3 3',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v5M16 3v5',
  teacher: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 4-6 8-6s8 2 8 6'
};

/* ---------- facts.lesson (server: apps/edge/src/parent-report.ts) ---------- */

export interface LessonFactsView {
  lesson_day: string;
  lesson_number: number;
  duration_min: number;
  utterances: number;
  passes: number;
  free_words: number;
  speaking_sec: number;
  quotes: Array<{ text: string; stars: number; stage_title_ko: string; hintless: boolean }>;
  expressions: string[];
  stages: Array<{ id: string; title_ko: string; utterances: number; passes: number }>;
  summary_ko: string;
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Reads facts.lesson defensively: a report made before this field existed has none and falls back to the table. */
export function lessonFactsOf(facts: Record<string, unknown> | undefined): LessonFactsView | null {
  const l = facts?.lesson;
  if (!l || typeof l !== 'object') return null;
  const o = l as Record<string, unknown>;
  return {
    lesson_day: str(o.lesson_day),
    lesson_number: num(o.lesson_number),
    duration_min: num(o.duration_min),
    utterances: num(o.utterances),
    passes: num(o.passes),
    free_words: num(o.free_words),
    speaking_sec: num(o.speaking_sec),
    quotes: arr(o.quotes).map((q) => {
      const x = (q ?? {}) as Record<string, unknown>;
      return { text: str(x.text), stars: num(x.stars), stage_title_ko: str(x.stage_title_ko), hintless: x.hintless === true };
    }).filter((q) => q.text),
    expressions: arr(o.expressions).map(str).filter(Boolean),
    stages: arr(o.stages).map((s) => {
      const x = (s ?? {}) as Record<string, unknown>;
      return { id: str(x.id), title_ko: str(x.title_ko), utterances: num(x.utterances), passes: num(x.passes) };
    }),
    summary_ko: str(o.summary_ko)
  };
}

/** "21초", "2분 5초", "28분" — the same split the server's summary sentence uses. */
export function speakingTimeLabel(sec: number): string {
  return formatLessonFact('speaking_sec', sec);
}

/** "2026-11-16" → "11월 16일 (일)". */
export function lessonDayLabel(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return day;
  const wd = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
  return `${Number(m[2])}월 ${Number(m[3])}일 (${P.weekday[wd]})`;
}

export function ReportBody({ report, preview = false, token }: { report: SharedReport; preview?: boolean; token?: string }): React.ReactElement {
  const lesson = lessonFactsOf(report.facts);
  // The guardian's own device hears the child's turns (edge voice.ts); the teacher's preview and forwarded links do not.
  const voice = !preview && token ? <VoiceClips token={token} /> : null;
  return (
    <>
      {preview ? (
        <p role="status" data-testid="report-preview" style={{ ...small, margin: 0, padding: sp(2), border: `2px dashed ${C['sky-d']}`, borderRadius: px(TOKENS.shape.radiusCardPx), color: C['sky-d'], fontWeight: 700 }}>
          {P.previewBanner}
        </p>
      ) : null}
      {lesson ? (
        <LessonReport report={report} lesson={lesson} voice={voice} />
      ) : (
        <>
          <FactTableReport report={report} />
          {voice}
        </>
      )}
      <footer style={{ ...small, display: 'grid', gap: sp(1), padding: `0 ${sp(1)} ${sp(5)}` }}>
        {report.expires_at ? <span>{P.footerExpires(kstLabel(report.expires_at, false))}</span> : null}
        <span>{P.footerPrivacy}</span>
      </footer>
    </>
  );
}

function LessonReport({ report, lesson, voice }: { report: SharedReport; lesson: LessonFactsView; voice?: React.ReactNode }): React.ReactElement {
  const dayLabel = lesson.lesson_day ? lessonDayLabel(lesson.lesson_day) : kstLabel(report.created_at, false);
  return (
    <>
      <header style={{ display: 'grid', gap: sp(1), padding: `${sp(2)} ${sp(1)} 0` }}>
        <span
          style={{
            ...small,
            justifySelf: 'start',
            padding: `${sp(0)} ${sp(2)}`,
            border,
            borderRadius: '999px',
            backgroundColor: C.brand,
            color: C['ink-900'],
            fontWeight: 700
          }}
        >
          {P.brand}
        </span>
        <h1 data-testid="report-date" style={{ ...h1, margin: 0, fontSize: px(T.scale.h1.sizePx), lineHeight: px(T.scale.h1.lineHeightPx) }}>
          {P.lessonTitle(dayLabel)}
        </h1>
        <span style={small}>{P.lessonMeta(lesson.duration_min)}</span>
      </header>

      <Card accent={C.brand} testId="report-quotes">
        <h2 style={{ ...h2, marginBottom: sp(1) }}>{P.quotesTitle}</h2>
        <p style={{ ...small, margin: `0 0 ${sp(3)}` }}>{P.quotesNote}</p>
        {lesson.quotes.length === 0 ? <p style={{ margin: 0 }}>{P.quotesEmpty}</p> : null}
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: sp(3) }}>
          {lesson.quotes.map((q, i) => (
            <li
              key={`${i}-${q.text}`}
              className="lcw-quote"
              style={{
                borderLeft: `${sp(1)} solid ${C.brand}`,
                backgroundColor: C['paper-50'],
                borderRadius: `0 ${px(TOKENS.shape.radiusCardPx)} ${px(TOKENS.shape.radiusCardPx)} 0`,
                padding: `${sp(2)} ${sp(3)}`,
                display: 'grid',
                gap: sp(1)
              }}
            >
              <blockquote
                lang="en"
                style={{
                  margin: 0,
                  fontFamily: T.fonts.target,
                  fontSize: px(T.targetSentenceMinPx),
                  lineHeight: px(T.scale.h3.lineHeightPx),
                  fontWeight: 700,
                  wordBreak: 'normal'
                }}
              >
                “{q.text}”
              </blockquote>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: sp(2), ...small }}>
                <Stars n={q.stars} />
                <span>{P.starsLabel(q.stars)}</span>
                {q.stage_title_ko ? <span>{q.stage_title_ko}</span> : null}
                {q.hintless ? (
                  <span style={{ border: `2px solid ${C['leaf-d']}`, color: C['leaf-d'], borderRadius: '999px', padding: `0 ${sp(1)}`, fontWeight: 700 }}>
                    {P.hintless}
                  </span>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      </Card>
      {voice}

      <Card testId="report-numbers">
        <h2 style={h2}>{P.numbersTitle}</h2>
        <div style={{ display: 'grid', gap: sp(3) }}>
          <Stat icon={ICON.clock} label={P.speakingTime} value={speakingTimeLabel(lesson.speaking_sec)} note={P.speakingTimeNote} />
          <Stat icon={ICON.chat} label={P.attempts} value={P.attemptsValue(lesson.utterances)} note={P.attemptsNote(lesson.passes)} />
          <Stat icon={ICON.pencil} label={P.freeWords} value={P.freeWordsValue(lesson.free_words)} note={P.freeWordsNote} />
        </div>
        {lesson.lesson_number === 1 ? <p style={{ ...small, margin: `${sp(3)} 0 0` }}>{P.firstLessonNote}</p> : null}
      </Card>

      {lesson.stages.length > 0 ? (
        <Card testId="report-flow">
          <h2 style={h2}>{P.flowTitle}</h2>
          <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: sp(3) }}>
            {lesson.stages.map((s) => (
              <li key={s.id} style={{ display: 'grid', gap: sp(1) }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: sp(2), alignItems: 'baseline' }}>
                  <span style={{ fontWeight: 700 }}>{s.title_ko}</span>
                  <span style={{ ...small, whiteSpace: 'nowrap' }}>{P.flowRow(s.passes, s.utterances)}</span>
                </div>
                <PassMeter passes={s.passes} total={s.utterances} />
              </li>
            ))}
          </ol>
        </Card>
      ) : null}

      {lesson.expressions.length > 0 ? (
        <Card testId="report-expressions">
          <h2 style={h2}>{P.expressionsTitle(lesson.expressions.length)}</h2>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', gap: sp(2) }}>
            {lesson.expressions.map((e) => (
              <li
                key={e}
                lang="en"
                style={{
                  fontFamily: T.fonts.target,
                  fontWeight: 700,
                  border,
                  borderRadius: px(TOKENS.shape.radiusButtonPx),
                  padding: `${sp(1)} ${sp(2)}`,
                  backgroundColor: C['paper-100']
                }}
              >
                {e}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {report.teacher_comment ? (
        <Card accent={C.sky} testId="report-teacher">
          <div style={{ display: 'flex', alignItems: 'center', gap: sp(2), marginBottom: sp(2) }}>
            <Icon d={ICON.teacher} />
            <h2 style={{ ...h2, margin: 0 }}>{P.teacherTitle}</h2>
          </div>
          <p style={{ margin: 0, whiteSpace: 'pre-line' }}>{report.teacher_comment}</p>
        </Card>
      ) : null}

      {report.next_lesson_at ? (
        <Card tone="tinted" testId="report-next">
          <div style={{ display: 'flex', alignItems: 'center', gap: sp(2) }}>
            <Icon d={ICON.calendar} />
            <div style={{ display: 'grid' }}>
              <span style={small}>{P.nextTitle}</span>
              <strong style={{ fontSize: px(T.scale.h3.sizePx), lineHeight: px(T.scale.h3.lineHeightPx) }}>{report.next_lesson_at}</strong>
            </div>
          </div>
        </Card>
      ) : null}

      <Card testId="report-details">
        <details>
          <summary>{P.detailsTitle}</summary>
          {report.body ? (
            <div style={{ marginTop: sp(3) }}>
              <h3 style={{ ...small, margin: `0 0 ${sp(1)}`, fontWeight: 700 }}>{P.summaryTitle}</h3>
              <p data-testid="report-body" style={{ margin: 0, whiteSpace: 'pre-line' }}>
                {report.body}
              </p>
            </div>
          ) : null}
          <FactTable facts={report.facts} />
        </details>
      </Card>
    </>
  );
}

function Stat({ icon, label, value, note }: { icon: string; label: string; value: string; note: string }): React.ReactElement {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: `${sp(0)} ${sp(2)}`, alignItems: 'start' }}>
      <Icon d={icon} />
      <div style={{ display: 'grid', minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: sp(2), flexWrap: 'wrap' }}>
          <span>{label}</span>
          <strong style={{ fontSize: px(T.scale.h2.sizePx), lineHeight: px(T.scale.h2.lineHeightPx), fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
            {value}
          </strong>
        </div>
        <span style={small}>{note}</span>
      </div>
    </div>
  );
}

/** Passed share as a bar plus the text beside it (colour is not the only signal). */
function PassMeter({ passes, total }: { passes: number; total: number }): React.ReactElement {
  const pct = total > 0 ? Math.round((passes / total) * 100) : 0;
  return (
    <div
      role="meter"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={passes}
      aria-label={P.flowRow(passes, total)}
      style={{ height: sp(2), border: `2px solid ${C['ink-900']}`, borderRadius: '999px', backgroundColor: C['paper-100'], overflow: 'hidden' }}
    >
      <div style={{ width: `${pct}%`, height: '100%', backgroundColor: C.leaf }} />
    </div>
  );
}

function FactTable({ facts }: { facts: Record<string, unknown> | undefined }): React.ReactElement {
  const rows = reportFactRows(facts ?? {});
  return (
    <table data-testid="report-facts" style={{ width: '100%', borderCollapse: 'collapse', marginTop: sp(3) }}>
      <thead>
        <tr>
          <th scope="col" style={{ ...cell, ...small, textAlign: 'left' }}>
            {S.factCol}
          </th>
          <th scope="col" style={{ ...cell, ...small, textAlign: 'right' }}>
            {S.valueCol}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            <th scope="row" style={{ ...cell, textAlign: 'left', fontWeight: 400 }}>
              {r.label}
            </th>
            <td style={{ ...cell, textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{r.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Reports made before facts.lesson existed (and weekly reports): the plain fact table and checked summary. */
function FactTableReport({ report }: { report: SharedReport }): React.ReactElement {
  const kind = S.kinds[report.kind] ?? S.title;
  return (
    <>
      <Card tone="tinted">
        <p style={{ ...small, margin: 0 }}>{kind}</p>
        <h1 style={{ ...h1, margin: 0 }} data-testid="report-date">
          {kstLabel(report.created_at, false)} {S.title}
        </h1>
      </Card>
      <Card>
        <h2 style={h2}>{S.factsTitle}</h2>
        <FactTable facts={report.facts} />
      </Card>
      {report.body ? (
        <Card>
          <h2 style={h2}>{S.bodyTitle}</h2>
          <p data-testid="report-body" style={{ margin: 0, whiteSpace: 'pre-line' }}>
            {report.body}
          </p>
        </Card>
      ) : null}
      {report.teacher_comment ? (
        <Card accent={C.sky}>
          <h2 style={h2}>{S.teacherTitle}</h2>
          <p style={{ margin: 0, whiteSpace: 'pre-line' }}>{report.teacher_comment}</p>
        </Card>
      ) : null}
      {report.next_lesson_at ? (
        <Card tone="tinted">
          <h2 style={h2}>{S.nextTitle}</h2>
          <p style={{ margin: 0 }}>{report.next_lesson_at}</p>
        </Card>
      ) : null}
      <p style={{ ...small, margin: 0 }}>{S.factNote}</p>
    </>
  );
}

const cell: React.CSSProperties = {
  padding: `${sp(2)} 0`,
  borderBottom: `1px solid ${C['line-200']}`,
  verticalAlign: 'middle'
};
