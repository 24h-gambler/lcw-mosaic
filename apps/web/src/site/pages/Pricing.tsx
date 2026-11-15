/** W05 pricing (docs/14 §6, 01 §4). Refund and cancellation are visible on the same screen as the prices. */
import React, { useEffect, useState } from 'react';
import { FAQ, PRICING } from '../copy.js';
import { SLink } from '../SiteShell.js';
import { track } from '../track.js';
import { FaqList } from '../widgets.js';

export function PricingPage(): React.ReactElement {
  const [yearly, setYearly] = useState(false);
  useEffect(() => track('pricing_view'), []);
  return (
    <>
      <section className="s-hero">
        <div className="s-wrap s-stack" style={{ gap: 24 }}>
          <div className="s-hero-copy" style={{ maxWidth: 720 }}>
            <span className="s-eyebrow">요금</span>
            <h1 className="s-h1">{PRICING.title}</h1>
            <p className="s-lead">{PRICING.lead}</p>
          </div>
          <div className="s-tabs" role="group" aria-label="결제 주기">
            <button type="button" className="s-tab" aria-pressed={!yearly} onClick={() => setYearly(false)}>
              월 결제
            </button>
            <button type="button" className="s-tab" aria-pressed={yearly} onClick={() => setYearly(true)}>
              연 결제
            </button>
          </div>
          <div className="s-plans">
            {PRICING.plans.map((p) => (
              <div key={p.id} className={`s-card s-plan ${p.id === 'duo' ? 's-plan-hl' : ''}`}>
                <span className="s-row" style={{ justifyContent: 'space-between' }}>
                  <strong className="s-h3">{p.name}</strong>
                  <span className="s-tag">{p.seats}</span>
                </span>
                <span className="s-plan-price">
                  {yearly ? p.year : p.month}
                  <small> / {yearly ? PRICING.yearly : PRICING.monthly}</small>
                </span>
                <span className="s-small">
                  {yearly ? `${p.perSeatYear} (연 결제)` : `연 결제 ${p.year}`}
                </span>
                <ul>
                  {p.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="s-promise">
            {PRICING.promises.map((t) => (
              <div key={t}>✓ {t}</div>
            ))}
          </div>
          <p className="s-muted">{PRICING.tutoringPlan}</p>
        </div>
      </section>

      <section className="s-sec s-sec-tint">
        <div className="s-wrap s-split" style={{ alignItems: 'start' }}>
          <div className="s-stack">
            <h2 className="s-h2">{PRICING.refundTitle}</h2>
            <p className="s-lead">결제 후 7일 이내 전액 환불. 해지는 보호자 화면에서 바로 할 수 있어요.</p>
          </div>
          <div className="s-tablewrap">
            <table className="s-table" style={{ background: 'inherit' }}>
              <tbody>
                {PRICING.refundRows.map((r) => (
                  <tr key={r.k}>
                    <th scope="row" style={{ width: '32%' }}>
                      {r.k}
                    </th>
                    <td>{r.v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="s-sec">
        <div className="s-wrap s-card s-row" style={{ justifyContent: 'space-between' }}>
          <div className="s-stack" style={{ gap: 4 }}>
            <strong className="s-h3">{PRICING.startTitle}</strong>
            <span className="s-muted">{PRICING.startBody}</span>
          </div>
          <SLink to="/tutoring#consult" className="s-btn s-btn-brand s-btn-lg">
            {PRICING.startCta}
          </SLink>
        </div>
      </section>

      <section className="s-sec s-sec-tint">
        <div className="s-wrap">
          <div className="s-sec-head">
            <h2 className="s-h2">{PRICING.faqTitle}</h2>
          </div>
          <FaqList items={FAQ} />
        </div>
      </section>
    </>
  );
}
