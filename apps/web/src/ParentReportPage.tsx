/**
 * /r/<token> — the parent's lesson report (docs/18 §1, docs/08 §9.3). Opened from a KakaoTalk link on a phone, so it is
 * one narrow column, numbers first (07 §5: only the verified fact numbers), then the checked summary text.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, TOKENS } from '@lcw/ui';
import { createLessonApi, errorCodeOf, loadOperatorToken, type LessonApi, type SharedReport } from './lessonApi.js';
import { kstLabel, reportFactRows } from './lessonFlow.js';
import { LessonStyle, border, sp } from './lessonUi.js';
import { LESSON_STRINGS_KO } from './strings.js';

const S = LESSON_STRINGS_KO.report;
const C = TOKENS.colors;
const T = TOKENS.typography;

/** The director's "미리 보기" link adds ?preview=1; on the teacher's device the stored operator token then marks it a preview. */
export function previewOperatorToken(search = typeof window !== 'undefined' ? window.location.search : ''): string | null {
  return new URLSearchParams(search).get('preview') === '1' ? loadOperatorToken() : null;
}

export type ReportLoad =
  | { status: 'loading' }
  | { status: 'ok'; report: SharedReport }
  | { status: 'not_found' }
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
    try {
      setLoad({ status: 'ok', report: await apiRef.current.getReport(token, previewOperatorToken()) });
    } catch (e) {
      const code = errorCodeOf(e);
      // 410 (30 days passed, or the guardian closed the link) is not a connection problem: same screen as not found.
      const gone = ['report_not_found', 'report_expired', 'report_revoked', 'http_404', 'http_410'].includes(code);
      setLoad(gone ? { status: 'not_found' } : { status: 'error' });
    }
  }, [token]);

  useEffect(() => {
    if (!initial) void fetchReport();
  }, [fetchReport, initial]);

  return (
    <main
      className="lcw-lesson"
      data-testid="parent-report-page"
      style={{ maxWidth: '560px', margin: '0 auto', display: 'grid', gap: sp(3), fontSize: `${T.scale['body-l'].sizePx}px` }}
    >
      <LessonStyle />
      {load.status === 'loading' ? <Card><p style={{ margin: 0 }}>{S.loading}</p></Card> : null}
      {load.status === 'not_found' ? (
        <Card>
          <h1 style={h1}>{S.notFoundTitle}</h1>
          <p style={{ margin: 0, lineHeight: `${T.scale['body-l'].lineHeightPx}px` }}>{S.notFoundBody}</p>
        </Card>
      ) : null}
      {load.status === 'error' ? (
        <Card>
          <p role="alert" style={{ marginTop: 0 }}>{S.errorBody}</p>
          <Button type="button" variant="brand" onClick={() => void fetchReport()}>
            {S.retry}
          </Button>
        </Card>
      ) : null}
      {load.status === 'ok' ? <ReportBody report={load.report} /> : null}
    </main>
  );
}

const h1: React.CSSProperties = {
  margin: `0 0 ${sp(2)}`,
  fontSize: `${T.scale.h2.sizePx}px`,
  lineHeight: `${T.scale.h2.lineHeightPx}px`
};

function Card({ children, tone = 'paper' }: { children: React.ReactNode; tone?: 'paper' | 'tinted' }): React.ReactElement {
  return (
    <section
      style={{
        backgroundColor: tone === 'tinted' ? C['paper-100'] : C['paper-0'],
        color: C['ink-900'],
        border,
        borderRadius: `${TOKENS.shape.radiusCardPx}px`,
        padding: sp(3)
      }}
    >
      {children}
    </section>
  );
}

export function ReportBody({ report }: { report: SharedReport }): React.ReactElement {
  const rows = reportFactRows(report.facts ?? {});
  const kind = S.kinds[report.kind] ?? S.title;
  const date = kstLabel(report.created_at, false);
  return (
    <>
      <Card tone="tinted">
        <p style={{ margin: 0, fontSize: `${T.scale.small.sizePx}px`, color: C['ink-700'] }}>{kind}</p>
        <h1 style={{ ...h1, margin: 0 }} data-testid="report-date">
          {date} {S.title}
        </h1>
      </Card>
      <Card>
        <h2 style={h2}>{S.factsTitle}</h2>
        <table data-testid="report-facts" style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th scope="col" style={{ ...cell, textAlign: 'left', fontSize: `${T.scale.small.sizePx}px`, color: C['ink-700'] }}>
                {S.factCol}
              </th>
              <th scope="col" style={{ ...cell, textAlign: 'right', fontSize: `${T.scale.small.sizePx}px`, color: C['ink-700'] }}>
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
                <td
                  style={{
                    ...cell,
                    textAlign: 'right',
                    fontWeight: 700,
                    fontSize: `${T.scale.h3.sizePx}px`,
                    fontVariantNumeric: 'tabular-nums',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {r.value}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {report.body ? (
        <Card>
          <h2 style={h2}>{S.bodyTitle}</h2>
          <p data-testid="report-body" style={{ margin: 0, lineHeight: `${T.scale['body-l'].lineHeightPx}px`, whiteSpace: 'pre-line' }}>
            {report.body}
          </p>
        </Card>
      ) : null}
      {report.teacher_comment ? (
        <Card>
          <h2 style={h2}>{S.teacherTitle}</h2>
          <p style={{ margin: 0, lineHeight: `${T.scale['body-l'].lineHeightPx}px`, whiteSpace: 'pre-line' }}>{report.teacher_comment}</p>
        </Card>
      ) : null}
      {report.next_lesson_at ? (
        <Card>
          <h2 style={h2}>{S.nextTitle}</h2>
          <p style={{ margin: 0 }}>{report.next_lesson_at}</p>
        </Card>
      ) : null}
      <p style={{ margin: 0, fontSize: `${T.scale.small.sizePx}px`, color: C['ink-700'] }}>{S.factNote}</p>
    </>
  );
}

const h2: React.CSSProperties = {
  margin: `0 0 ${sp(2)}`,
  fontSize: `${T.scale.h3.sizePx}px`,
  lineHeight: `${T.scale.h3.lineHeightPx}px`
};

const cell: React.CSSProperties = {
  padding: `${sp(2)} 0`,
  borderBottom: `1px solid ${C['line-200']}`,
  verticalAlign: 'middle'
};
