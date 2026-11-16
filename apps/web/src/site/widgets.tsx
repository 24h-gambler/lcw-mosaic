import React, { useEffect, useState } from 'react';
import { TOKENS } from '@lcw/ui';
import { FAQ, LEARN, SAMPLE_DASH, SHARE } from './copy.js';
import { STATE_TAG } from './copyNow.js';
import { FEATURE_STATE, type FeatureId } from './featureStatus.js';
import { canSpeak, sayEnglish } from './sound.js';
import { track } from './track.js';

const C = TOKENS.colors;

export function Toast({ text, onDone }: { text: string | null; onDone: () => void }): React.ReactElement | null {
  useEffect(() => {
    if (!text) return undefined;
    const id = setTimeout(onDone, 3200);
    return () => clearTimeout(id);
  }, [text, onDone]);
  if (!text) return null;
  return (
    <div className="s-toast" role="status">
      {text}
    </div>
  );
}

/** State of the first feature in `ids` that is not live (null when all are live). */
export function pendingState(ids: readonly FeatureId[]): { id: FeatureId; state: 'building' | 'planned' } | null {
  for (const id of ids) {
    const st = FEATURE_STATE[id];
    if (st !== 'live') return { id, state: st };
  }
  return null;
}

/** "만드는 중" / "준비 중" next to a claim whose feature is not live yet (featureStatus.ts); nothing once it is live. */
export function StateTag({ ids }: { ids: readonly FeatureId[] }): React.ReactElement | null {
  const p = pendingState(ids);
  if (!p) return null;
  return (
    <span className="s-tag s-tag-soon" data-feature={p.id} data-feature-state={p.state}>
      {STATE_TAG[p.state]}
    </span>
  );
}

export function ListenButton({ text, label = LEARN.listen }: { text: string; label?: string }): React.ReactElement | null {
  const [ok, setOk] = useState(false);
  useEffect(() => setOk(typeof fetch !== 'undefined' || canSpeak()), []);
  if (!ok) return null;
  return (
    <button type="button" className="s-listen" onClick={() => sayEnglish(text, { force: true })} aria-label={`${label}: ${text}`}>
      ▶ {label}
    </button>
  );
}

export interface PaperOffer {
  stars: number;
  text: string;
  coins?: number;
}

/** 1–3 star sentences as on the in-game dialog, on paper (08 §2.3: star count + border, never colour alone). */
export function OfferList({ offers }: { offers: readonly PaperOffer[] }): React.ReactElement {
  return (
    <div className="s-offers-paper">
      {offers.map((o) => (
        <div key={o.stars + o.text} className="s-offer-p" data-stars={o.stars}>
          <span className="s-stars" aria-label={`별 ${o.stars}개`}>
            {'★'.repeat(o.stars)}
            <span style={{ opacity: 0.25 }}>{'★'.repeat(3 - o.stars)}</span>
          </span>
          <span className="s-en-sm" lang="en" style={{ fontSize: 18, lineHeight: '26px' }}>
            {o.text}
          </span>
          <span className="s-row" style={{ gap: 8, justifyContent: 'flex-end' }}>
            {typeof o.coins === 'number' ? <span className="s-coin">코인 {o.coins.toLocaleString('ko-KR')}</span> : null}
            <ListenButton text={o.text} />
          </span>
        </div>
      ))}
    </div>
  );
}

/** Moving average over the last `n` points (window shrinks at the start). */
export function movingAverage(values: readonly number[], n = 4): number[] {
  return values.map((_, i) => {
    const from = Math.max(0, i - n + 1);
    const win = values.slice(from, i + 1);
    return Math.round((win.reduce((a, b) => a + b, 0) / win.length) * 10) / 10;
  });
}

/** Think-and-speak index chart following 08 §9.2: light weekly dots, a 3px 4-week line, 100 baseline, lesson ticks, table view. */
export function IndexChart({ initialTable = false }: { initialTable?: boolean }): React.ReactElement {
  const [table, setTable] = useState(initialTable);
  const v = SAMPLE_DASH.weekly;
  const avg = movingAverage(v);
  const W = 480;
  const H = 180;
  const padL = 36;
  const padB = 24;
  const min = 90;
  const max = 135;
  const x = (i: number) => padL + (i * (W - padL - 12)) / (v.length - 1);
  const y = (val: number) => 8 + ((max - val) * (H - padB - 8)) / (max - min);
  return (
    <div className="s-stack" style={{ gap: 8 }}>
      <div className="s-row" style={{ justifyContent: 'space-between' }}>
        <strong>{SAMPLE_DASH.chartTitle}</strong>
        <button type="button" className="s-listen" onClick={() => setTable((t) => !t)} aria-pressed={table}>
          {table ? SAMPLE_DASH.hideTable : SAMPLE_DASH.showTable}
        </button>
      </div>
      {table ? (
        <div className="s-tablewrap">
          <table className="s-table">
            <thead>
              <tr>
                <th scope="col">{SAMPLE_DASH.colWeek}</th>
                <th scope="col">{SAMPLE_DASH.colValue}</th>
                <th scope="col">{SAMPLE_DASH.colAvg}</th>
              </tr>
            </thead>
            <tbody>
              {v.map((val, i) => (
                <tr key={i}>
                  <td>
                    {SAMPLE_DASH.weekLabel(i)}
                    {SAMPLE_DASH.lessonWeeks.includes(i as never) ? ' · 수업' : ''}
                  </td>
                  <td className="s-num">{val}</td>
                  <td className="s-num">{avg[i]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <svg className="s-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${SAMPLE_DASH.chartTitle}: 첫 주 ${v[0]}, 12주 ${v[v.length - 1]}`}>
          {[100, 120].map((g) => (
            <g key={g}>
              <line x1={padL} x2={W - 8} y1={y(g)} y2={y(g)} stroke={g === 100 ? C['ink-500'] : C['line-200']} strokeDasharray={g === 100 ? '4 4' : undefined} />
              <text x={padL - 6} y={y(g) + 4} textAnchor="end" fontSize="12" fill={C['ink-500']}>
                {g}
              </text>
            </g>
          ))}
          {SAMPLE_DASH.lessonWeeks.map((i) => (
            <line key={i} x1={x(i)} x2={x(i)} y1={H - padB} y2={H - padB + 6} stroke={C['sky-d']} strokeWidth="2" />
          ))}
          {v.map((val, i) => (
            <circle key={i} cx={x(i)} cy={y(val)} r="3.5" fill={C.brand} opacity="0.45" />
          ))}
          <polyline points={avg.map((a, i) => `${x(i)},${y(a)}`).join(' ')} fill="none" stroke={C['brand-d']} strokeWidth="3" strokeLinejoin="round" />
          <text x={W - 8} y={H - 4} textAnchor="end" fontSize="12" fill={C['ink-500']}>
            · 주간값 ━ 4주 평균 | 파란 눈금 = 수업일
          </text>
        </svg>
      )}
    </div>
  );
}

export function SampleDashboard(): React.ReactElement {
  return (
    <div className="s-card s-stack" style={{ gap: 12 }}>
      <div className="s-row" style={{ justifyContent: 'space-between' }}>
        <strong className="s-h3">{SAMPLE_DASH.name}</strong>
        <span className="s-tag s-tag-sample">예시 화면</span>
      </div>
      <p className="s-muted">{SAMPLE_DASH.headline}</p>
      <div className="s-kpis">
        {SAMPLE_DASH.kpis.map((k) => (
          <div key={k.k} className="s-kpi">
            <small>{k.k}</small>
            <b>{k.v}</b>
            <em>{k.d}</em>
          </div>
        ))}
      </div>
      <IndexChart />
      <div className="s-note">
        <strong>{SAMPLE_DASH.oneLiner}</strong>{' '}
        <span className="s-en-sm" lang="en">
          “{SAMPLE_DASH.oneLinerEn}”
        </span>{' '}
        <ListenButton text={SAMPLE_DASH.oneLinerEn} />
      </div>
    </div>
  );
}

export function FaqList({ items = FAQ }: { items?: ReadonlyArray<{ q: string; a: string }> }): React.ReactElement {
  return (
    <div className="s-faq">
      {items.map((f) => (
        <details key={f.q}>
          <summary>{f.q}</summary>
          <div>{f.a}</div>
        </details>
      ))}
    </div>
  );
}

/** "부모님께 보내기": native share sheet when there is one, otherwise copy the parents' page link. */
export function useShareToParent(): { share: () => void; toast: string | null; clear: () => void } {
  const [toast, setToast] = useState<string | null>(null);
  const share = () => {
    track('send_to_parent');
    if (typeof window === 'undefined') return;
    const url = `${window.location.origin}/parents`;
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    if (typeof nav.share === 'function') {
      void nav.share({ title: SHARE.title, text: SHARE.text, url }).catch(() => undefined);
      return;
    }
    const done = () => setToast(SHARE.copied);
    const fail = () => setToast(SHARE.failed);
    if (nav.clipboard?.writeText) void nav.clipboard.writeText(`${SHARE.text} ${url}`).then(done, fail);
    else fail();
  };
  return { share, toast, clear: () => setToast(null) };
}
