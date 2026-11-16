import React from 'react';
import { HERO, LANDING, LOOP, LOOP_OFFERS, STEPS, STEP_GROW } from '../copy.js';
import { GameClip } from '../GameMedia.js';
import { SLink } from '../SiteShell.js';
import { track } from '../track.js';
import { LANDING_NOW as N } from '../copyNow.js';
import { liveOr } from '../featureStatus.js';
import { OfferList } from '../widgets.js';
import { VoxelSvg, box, floatingIsland, merge, shift } from '../voxel.js';

function WorldBands(): React.ReactElement {
  const v = merge(
    shift(floatingIsland('silver', 'ink-500'), 0, 0, 16),
    shift(box(2, 2, 17, 2, 2, 2, 'sky'), 0, 0, 0),
    shift(floatingIsland('leaf', 'sun-d'), 3, 3, 8),
    shift(box(0, 0, 0, 6, 6, 2, 'ink-500'), 6, 6, -2),
    shift(box(2, 2, 0, 2, 2, 1, 'sun'), 6, 6, 0)
  );
  return <VoxelSvg voxels={v} unit={6} style={{ width: 120, height: 'auto', justifySelf: 'end' }} />;
}

export function LandingPage(): React.ReactElement {
  // Full claims once their features are live (featureStatus.ts); the line that is true today until then (copyNow.ts).
  const steps = STEPS.map((s, i) =>
    i === 0
      ? { ...s, body: liveOr(N.step1Body, s.body as string), en: liveOr(N.step1En, s.en as string) }
      : i === 1
        ? { ...s, body: liveOr(N.step2Body, s.body as string) }
        : { ...s, body: liveOr(N.step3Body, s.body as string), en: liveOr(N.step3En, s.en as string) }
  );
  const grow = liveOr(N.stepGrow, STEP_GROW as readonly string[]);
  return (
    <>
      <section className="s-hero">
        <div className="s-wrap s-hero-grid">
          <div className="s-hero-copy">
            <span className="s-eyebrow">{HERO.eyebrow}</span>
            <h1 className="s-display">{HERO.title}</h1>
            <p className="s-lead">{liveOr(N.heroBody, HERO.body as string)}</p>
            <div className="s-entrances">
              <SLink to="/parents" className="s-btn s-btn-brand s-entrance" onClick={() => track('entrance_parents')}>
                <span>{HERO.parents}</span>
                <small>{HERO.parentsSub}</small>
              </SLink>
              <SLink to="/play" className="s-btn s-btn-sky s-entrance" onClick={() => track('entrance_players')}>
                <span>{HERO.players}</span>
                <small>{HERO.playersSub}</small>
              </SLink>
            </div>
          </div>
          <GameClip clip="hero-cafe" captions={LOOP.captions} label={LOOP.label} />
        </div>
      </section>

      <section className="s-wrap" style={{ paddingBottom: 48 }} aria-label="어떻게 하나요">
        <ol className="s-steps" style={{ listStyle: 'none', padding: 0 }}>
          {steps.map((s, i) => (
            <li key={s.n} className="s-step">
              <span className="s-row" style={{ gap: 10 }}>
                <span className="s-step-n">{s.n}</span>
                <strong className="s-h3">{s.title}</strong>
              </span>
              <p className="s-muted">{s.body}</p>
              {i === 0 ? (
                <span className="s-en-sm" lang="en" style={{ fontSize: 18 }}>
                  “{s.en}”
                </span>
              ) : null}
              {i === 1 ? (
                <span className="s-grow" lang="en">
                  {grow.map((g) => (
                    <span key={g}>{g}</span>
                  ))}
                </span>
              ) : null}
              {i === 2 ? (
                <span className="s-row" style={{ justifyContent: 'space-between' }}>
                  <span className="s-en-sm s-small" lang="en">
                    {s.en}
                  </span>
                  <WorldBands />
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      </section>

      <section className="s-tryband">
        <div className="s-wrap s-tryband-in">
          <div className="s-stack" style={{ gap: 4 }}>
            <strong className="s-h2">{HERO.tryCtaLong}</strong>
            <span>{HERO.trySub}</span>
          </div>
          <SLink to="/try" className="s-btn s-btn-brand s-btn-lg">
            {HERO.tryCta} ▶
          </SLink>
        </div>
      </section>

      <section className="s-sec" style={{ borderTop: 0 }}>
        <div className="s-wrap s-split">
          <div className="s-stack">
            <h2 className="s-h2">{LANDING.dialogTitle}</h2>
            <p className="s-lead">{liveOr(N.dialogBody, LANDING.dialogBody as string)}</p>
            <p className="s-small">{LANDING.dialogNote}</p>
          </div>
          <OfferList offers={liveOr(N.dialogOffers, LOOP_OFFERS)} />
        </div>
      </section>

      <section className="s-sec s-sec-tint">
        <div className="s-wrap">
          <div className="s-sec-head">
            <h2 className="s-h2">{LANDING.doorsTitle}</h2>
            <p className="s-lead">{LANDING.doorsBody}</p>
          </div>
          <div className="s-grid-2">
            <div className="s-card s-stack">
              <span className="s-tag s-tag-sky" style={{ justifySelf: 'start' }}>
                학부모
              </span>
              <h3 className="s-h3">{LANDING.parentDoor.title}</h3>
              <p className="s-muted">{LANDING.parentDoor.body}</p>
              <SLink to="/parents" className="s-btn s-btn-brand" onClick={() => track('entrance_parents')} style={{ justifySelf: 'start' }}>
                {LANDING.parentDoor.cta} →
              </SLink>
            </div>
            <div className="s-card s-stack">
              <span className="s-tag s-tag-leaf" style={{ justifySelf: 'start' }}>
                플레이어
              </span>
              <h3 className="s-h3">{LANDING.playerDoor.title}</h3>
              <p className="s-muted">{liveOr(N.playerDoorBody, LANDING.playerDoor.body as string)}</p>
              <SLink to="/play" className="s-btn s-btn-sky" onClick={() => track('entrance_players')} style={{ justifySelf: 'start' }}>
                {LANDING.playerDoor.cta} →
              </SLink>
            </div>
          </div>
          <div className="s-card-flat s-row" style={{ marginTop: 24, justifyContent: 'space-between' }}>
            <div className="s-stack" style={{ gap: 4 }}>
              <strong>{LANDING.tutoringTitle}</strong>
              <span className="s-muted">{LANDING.tutoringBody}</span>
            </div>
            <SLink to="/tutoring" className="s-btn">
              {LANDING.tutoringCta} →
            </SLink>
          </div>
        </div>
      </section>
    </>
  );
}
