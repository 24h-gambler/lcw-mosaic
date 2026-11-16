import React, { useState } from 'react';
import { FAQ, LEARN_PAGES, MEDIA, NAV, PARENTS, PRICING, REFUND_RULE, SITUATIONS } from '../copy.js';
import { GameShot } from '../GameMedia.js';
import { SLink } from '../SiteShell.js';
import { SITUATION_FEATURE, STATE_TAG } from '../copyNow.js';
import { featureLive } from '../featureStatus.js';
import { FaqList, ListenButton, OfferList, SampleDashboard, StateTag, pendingState } from '../widgets.js';
import { VoxelSvg, character, merge, placeAt, box } from '../voxel.js';

const SITUATION_PAGE: Readonly<Record<string, string>> = {
  cafe: 'order-a-drink',
  makers: 'order-gear',
  exchange: 'trade-items',
  court: 'say-sorry'
};

function Situations(): React.ReactElement {
  const [sel, setSel] = useState<string>(SITUATIONS[0].id);
  const page = LEARN_PAGES.find((p) => p.slug === SITUATION_PAGE[sel]) ?? LEARN_PAGES[0];
  return (
    <div>
      <div className="s-tabs" role="tablist" aria-label="말하기 장면">
        {SITUATIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            className="s-tab"
            aria-selected={sel === s.id}
            aria-controls="s-situation"
            onClick={() => setSel(s.id)}
          >
            {s.label}
            {SITUATION_FEATURE[s.id] && !featureLive(SITUATION_FEATURE[s.id]!) ? (
              <small style={{ marginLeft: 6, opacity: 0.7, fontWeight: 600 }}>{STATE_TAG[pendingState([SITUATION_FEATURE[s.id]!])!.state]}</small>
            ) : null}
          </button>
        ))}
      </div>
      <div id="s-situation" role="tabpanel" className="s-stack" style={{ gap: 12 }}>
        <p className="s-muted s-row" style={{ gap: 8 }}>
          <span>{page.scene}</span>
          {SITUATION_FEATURE[sel] ? <StateTag ids={[SITUATION_FEATURE[sel]!]} /> : null}
        </p>
        <OfferList offers={page.offers} />
        <SLink to={`/learn/${page.slug}`} className="s-small">
          이 장면의 표현 더 보기 →
        </SLink>
      </div>
    </div>
  );
}

function ModesChart(): React.ReactElement {
  const pattern = ['', 'repeating-linear-gradient(45deg,currentColor 0 2px,transparent 2px 6px)', 'radial-gradient(currentColor 1px,transparent 1.5px) 0 0/6px 6px', 'linear-gradient(currentColor 1px,transparent 1px) 0 0/6px 6px,linear-gradient(90deg,currentColor 1px,transparent 1px) 0 0/6px 6px'];
  const tone = ['s-btn-brand', 's-btn-sun', '', 's-btn-sky'];
  return (
    <div className="s-stack" style={{ gap: 8 }}>
      {PARENTS.modes.map((m, i) => (
        <div key={m.k} className="s-row" style={{ gap: 12, flexWrap: 'nowrap' }}>
          <span
            className={`s-tag ${tone[i]}`}
            style={{ width: 56, justifyContent: 'center', backgroundImage: pattern[i] || undefined }}
            aria-hidden="true"
          >
            &nbsp;
          </span>
          <span style={{ flex: 1 }}>
            <strong>{m.k}</strong> — {m.d}
          </span>
          <span className={`s-tag ${m.counted ? 's-tag-leaf' : ''}`}>{m.counted ? '성장 그래프에 셈' : '따로 기록'}</span>
        </div>
      ))}
    </div>
  );
}

function MemorySteps(): React.ReactElement {
  return (
    <ol className="s-row" style={{ listStyle: 'none', padding: 0, gap: 8 }} aria-label="복습 간격">
      {PARENTS.memorySteps.map((s, i) => {
        const last = i === PARENTS.memorySteps.length - 1;
        return (
          <li
            key={s}
            className={`s-tag ${last ? 's-btn-sun' : i % 2 === 0 ? '' : 's-tint'}`}
            style={{ padding: '8px 12px', fontSize: 14, lineHeight: '20px' }}
          >
            {last ? '♛ ' : `${i + 1}. `}
            {s}
          </li>
        );
      })}
    </ol>
  );
}

const KID_SMALL = placeAt(character({}), 3, 3);
const KID_TALL = merge(placeAt(character({ jetpack: true }), 3, 3), box(0, 0, -1, 7, 7, 1, 'leaf'));

export function ParentsPage(): React.ReactElement {
  return (
    <>
      <section className="s-hero">
        <div className="s-wrap s-hero-grid">
          <div className="s-hero-copy">
            <span className="s-eyebrow">학부모님께</span>
            <h1 className="s-h1">{PARENTS.title}</h1>
            <p className="s-lead">{PARENTS.lead}</p>
            <p className="s-small">
              <span className="s-tag s-tag-sample">{PARENTS.sampleTag}</span> {PARENTS.sampleNote}
            </p>
            <div className="s-row">
              <SLink to="/try" className="s-btn s-btn-brand">
                {NAV.try}해 보기
              </SLink>
              <SLink to="/pricing" className="s-btn">
                요금 보기
              </SLink>
            </div>
          </div>
          <SampleDashboard />
        </div>
      </section>

      <section className="s-sec s-sec-tint">
        <div className="s-wrap s-split">
          <div className="s-stack">
            <h2 className="s-h2">{PARENTS.problemTitle}</h2>
            <p className="s-lead">{PARENTS.problemBody}</p>
          </div>
          <div className="s-card s-stack" style={{ gap: 8 }}>
            {PARENTS.problemRows.map((r) => (
              <div key={r.k} className="s-row" style={{ justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px dashed currentColor' }}>
                <strong>{r.k}</strong>
                <span className="s-muted">{r.v}</span>
                <span className={`s-tag ${r.on ? '' : 's-btn-sun'}`}>{r.on ? '많이 해요' : '드물어요'}</span>
              </div>
            ))}
            <p style={{ fontWeight: 800 }}>{PARENTS.problemFoot}</p>
          </div>
        </div>
      </section>

      <section className="s-sec">
        <div className="s-wrap s-split" style={{ alignItems: 'start' }}>
          <div className="s-stack">
            <h2 className="s-h2">{PARENTS.methodTitle}</h2>
            <p className="s-lead">{PARENTS.methodBody}</p>
            <GameShot still="cafe-stars" alt={MEDIA.cafeStars} />
          </div>
          <Situations />
        </div>
      </section>

      <section className="s-sec s-sec-tint">
        <div className="s-wrap">
          <div className="s-sec-head">
            <h2 className="s-h2">{PARENTS.proofTitle}</h2>
            <p className="s-lead">{PARENTS.proofBody}</p>
          </div>
          <div className="s-grid-2">
            <div className="s-card">
              <ModesChart />
            </div>
            <div className="s-card s-stack" style={{ gap: 10 }}>
              <strong className="s-h3">{PARENTS.indexTitle}</strong>
              <p className="s-muted">{PARENTS.indexBody}</p>
              {PARENTS.indexParts.map((p) => (
                <div key={p.k} style={{ display: 'grid', gridTemplateColumns: '48px 1fr', gap: 8, alignItems: 'center' }}>
                  <b style={{ fontVariantNumeric: 'tabular-nums' }}>{p.w}%</b>
                  <div>
                    <div style={{ height: 10, width: `${p.w * 3}%`, border: '2px solid currentColor' }} className="s-btn-brand" />
                    <span className="s-small">{p.k}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="s-sec">
        <div className="s-wrap s-split">
          <div className="s-stack">
            <h2 className="s-h2">{PARENTS.memoryTitle}</h2>
            <p className="s-lead">{PARENTS.memoryBody}</p>
          </div>
          <div className="s-card s-stack">
            <MemorySteps />
            <p className="s-small">한 번 놓치면 한 칸만 뒤로 가요. 처음부터 다시 하지 않습니다.</p>
          </div>
        </div>
      </section>

      <section className="s-sec s-sec-tint">
        <div className="s-wrap">
          <div className="s-sec-head">
            <h2 className="s-h2">{PARENTS.museumTitle}</h2>
            <p className="s-lead">{PARENTS.museumBody}</p>
            <p className="s-small">
              <span className="s-tag s-tag-sample">{PARENTS.voiceTag}</span> {PARENTS.voiceNote}
            </p>
          </div>
          <div className="s-grid-2">
            {[
              { k: PARENTS.museumBefore, en: 'I want tea.', v: KID_SMALL, s: '3단어 · 머뭇거림 4초' },
              { k: PARENTS.museumAfter, en: 'Can I have a warm honey tea so that I stay warm?', v: KID_TALL, s: '11단어 · 접속 표현 so that' }
            ].map((m) => (
              <div key={m.k} className="s-card" style={{ display: 'grid', gridTemplateColumns: '96px 1fr', gap: 16, alignItems: 'center' }}>
                <VoxelSvg voxels={m.v} unit={4} style={{ width: 96, height: 'auto' }} />
                <div className="s-stack" style={{ gap: 6 }}>
                  <span className="s-tag" style={{ justifySelf: 'start' }}>
                    {m.k}
                  </span>
                  <span className="s-en-sm" lang="en" style={{ fontSize: 20, lineHeight: '28px' }}>
                    “{m.en}”
                  </span>
                  <span className="s-small">{m.s}</span>
                  <ListenButton text={m.en} label="시연 듣기" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="s-sec">
        <div className="s-wrap s-card s-row" style={{ justifyContent: 'space-between' }}>
          <div className="s-stack" style={{ gap: 6, maxWidth: 720 }}>
            <h2 className="s-h3">{PARENTS.tutoringTitle}</h2>
            <p className="s-muted">{PARENTS.tutoringBody}</p>
          </div>
          <SLink to="/tutoring" className="s-btn">
            과외 수업 보기 →
          </SLink>
        </div>
      </section>

      <section className="s-sec s-night">
        <div className="s-wrap">
          <div className="s-sec-head">
            <h2 className="s-h2">{PARENTS.safetyTitle}</h2>
          </div>
          <ul className="s-grid-2" style={{ listStyle: 'none', padding: 0 }}>
            {PARENTS.safetyItems.map((t) => (
              <li key={t} style={{ borderLeft: '4px solid currentColor', paddingLeft: 12 }}>
                {t}
              </li>
            ))}
          </ul>
          <p style={{ marginTop: 24 }}>
            <SLink to="/safety" style={{ color: 'inherit' }}>
              안전 설계 전체 보기 →
            </SLink>
          </p>
        </div>
      </section>

      <section className="s-sec">
        <div className="s-wrap s-split">
          <div className="s-stack">
            <h2 className="s-h2">{PARENTS.timeTitle}</h2>
            <p className="s-lead">{PARENTS.timeBody}</p>
          </div>
          <div className="s-card s-stack" style={{ gap: 8 }}>
            <strong>주간 요약 (예시)</strong>
            <span className="s-row" style={{ justifyContent: 'space-between' }}><span>이번 주 플레이</span><b>3시간 10분</b></span>
            <span className="s-row" style={{ justifyContent: 'space-between' }}><span>그중 영어로 말한 시간</span><b>38분</b></span>
            <span className="s-row" style={{ justifyContent: 'space-between' }}><span>플레이 시간 안내</span><b>하루 45분</b></span>
          </div>
        </div>
      </section>

      <section className="s-sec">
        <div className="s-wrap">
          <div className="s-sec-head">
            <h2 className="s-h2">{PARENTS.priceTitle}</h2>
            <p className="s-lead">{PARENTS.priceBody}</p>
          </div>
          <div className="s-grid-3">
            {PRICING.plans.map((p) => (
              <div key={p.id} className="s-card-flat s-stack" style={{ gap: 4 }}>
                <strong>
                  {p.name} <span className="s-small">{p.seats}</span>
                </strong>
                <span className="s-h3">월 {p.month}</span>
                <span className="s-small">연 {p.year}</span>
              </div>
            ))}
          </div>
          <p style={{ marginTop: 16, fontWeight: 800 }}>{REFUND_RULE.short} · Duo는 가족이 아니어도 돼요</p>
          <SLink to="/pricing" className="s-btn s-btn-brand" style={{ marginTop: 16 }}>
            {PARENTS.priceCta} →
          </SLink>
        </div>
      </section>

      <section className="s-sec s-sec-tint">
        <div className="s-wrap">
          <div className="s-sec-head">
            <h2 className="s-h2">{PARENTS.faqTitle}</h2>
          </div>
          <FaqList items={FAQ.slice(0, 6)} />
        </div>
      </section>
    </>
  );
}
