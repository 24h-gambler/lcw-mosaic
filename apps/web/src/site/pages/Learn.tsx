/** W07 expression pages (docs/14 §9): text first for search; the 3D scene loads only from the [이 장면 해 보기] button. */
import React from 'react';
import { LEARN, LEARN_PAGES, MEDIA } from '../copy.js';
import { GameShot } from '../GameMedia.js';
import type { SiteStillKey } from '../media.js';
import { SLink } from '../SiteShell.js';
import { LEARN_CTX_FEATURE } from '../copyNow.js';
import { OfferList, StateTag } from '../widgets.js';

/** The scene's state tag (makers lab, court: not in the world yet); nothing for live scenes and open questions. */
function SceneTag({ ctx }: { ctx: string }): React.ReactElement | null {
  const id = LEARN_CTX_FEATURE[ctx];
  return id ? <StateTag ids={[id]} /> : null;
}
import { VoxelSvg, box, cafe, floatingIsland, grass, merge, miniCharacter as character, placeAt, shift, tree, type Vox } from '../voxel.js';

/** Each scene as separate parts, so a test can check no prop sits inside a character (collisions()). */
export const LEARN_ART_PARTS: Readonly<Record<string, Vox[][]>> = {
  cafe: [grass(14, 13), shift(cafe(), 2, 1, 0), placeAt(character({}), 7, 11)],
  makers_lab: [grass(10, 8), placeAt(character({ jetpack: true }), 4, 4), box(7, 1, 0, 2, 4, 3, 'sun-d')],
  trade: [grass(12, 8), placeAt(character({}), 2, 5), placeAt(character({ shirt: 'sky-d', hair: 'sun-d' }), 10, 5), box(5, 3, 0, 2, 4, 3, 'sun-d'), box(5, 4, 3, 1, 1, 1, 'sky')],
  court: [grass(12, 8), box(1, 1, 0, 10, 2, 5, 'sun-d'), placeAt(character({ shirt: 'ink-700', hair: 'silver' }), 6, 2, 5), placeAt(character({}), 6, 6)],
  open_question: [shift(floatingIsland('leaf', 'sun-d'), 0, 0, 2), shift(tree(), 3, 0, 3), placeAt(character({}), 2, 4, 3)]
};
/**
 * Scenes the game already has get a real /game capture (docs/14 §10.3); the others keep the drawn picture until the
 * world builds them (gear lab, court).
 */
export const LEARN_STILL: Readonly<Record<string, { still: SiteStillKey; alt: string }>> = {
  cafe: { still: 'cafe-offers', alt: MEDIA.cafeOffers },
  trade: { still: 'trade-offers', alt: MEDIA.tradeOffers },
  open_question: { still: 'build-plot', alt: MEDIA.buildPlot }
};
const ART: Readonly<Record<string, Vox[]>> = Object.fromEntries(Object.entries(LEARN_ART_PARTS).map(([k, parts]) => [k, merge(...parts)]));

export function LearnIndexPage(): React.ReactElement {
  return (
    <section className="s-hero">
      <div className="s-wrap s-stack" style={{ gap: 32 }}>
        <div className="s-hero-copy" style={{ maxWidth: 720 }}>
          <span className="s-eyebrow">배우기</span>
          <h1 className="s-h1">{LEARN.indexTitle}</h1>
          <p className="s-lead">{LEARN.indexLead}</p>
        </div>
        <div className="s-grid-3">
          {LEARN_PAGES.map((p) => (
            <SLink key={p.slug} to={`/learn/${p.slug}`} className="s-card s-stack" style={{ color: 'inherit', textDecoration: 'none', gap: 8 }}>
              {LEARN_STILL[p.ctx] ? (
                <GameShot still={LEARN_STILL[p.ctx]!.still} alt="" className="s-shot-thumb" sizes="(max-width: 720px) 92vw, 320px" />
              ) : (
                <VoxelSvg voxels={ART[p.ctx] ?? ART.cafe!} unit={6} style={{ height: 120, width: '100%' }} />
              )}
              <span className="s-row" style={{ gap: 8, justifyContent: 'space-between' }}>
                <strong className="s-h3">{p.title}</strong>
                <SceneTag ctx={p.ctx} />
              </span>
              <span className="s-en-sm" lang="en">
                {p.offers[2]?.text}
              </span>
            </SLink>
          ))}
        </div>
      </div>
    </section>
  );
}

export function LearnPage({ slug }: { slug: string }): React.ReactElement {
  const p = LEARN_PAGES.find((x) => x.slug === slug);
  if (!p) return <LearnIndexPage />;
  return (
    <>
      <section className="s-hero">
        <div className="s-wrap s-hero-grid">
          <div className="s-hero-copy">
            <SLink to="/learn" className="s-small">
              {LEARN.back}
            </SLink>
            <h1 className="s-h1">{p.title}</h1>
            <p className="s-lead s-row" style={{ gap: 10 }}>
              <span>{p.scene}</span>
              <SceneTag ctx={p.ctx} />
            </p>
            <SLink to="/try" className="s-btn s-btn-brand s-btn-lg" style={{ justifySelf: 'start' }}>
              {LEARN.tryCta} ▶
            </SLink>
          </div>
          {LEARN_STILL[p.ctx] ? (
            <GameShot still={LEARN_STILL[p.ctx]!.still} alt={LEARN_STILL[p.ctx]!.alt} eager sizes="(max-width: 720px) 92vw, 560px" />
          ) : (
            <div className="s-show" style={{ cursor: 'default' }}>
              <VoxelSvg voxels={ART[p.ctx] ?? ART.cafe!} unit={12} title={p.scene} />
            </div>
          )}
        </div>
      </section>
      <section className="s-sec">
        <div className="s-wrap s-stack" style={{ gap: 16 }}>
          <h2 className="s-h2">{LEARN.starsTitle}</h2>
          <OfferList offers={p.offers} />
        </div>
      </section>
      <section className="s-sec s-sec-tint">
        <div className="s-wrap s-grid-2">
          <div className="s-stack">
            <h2 className="s-h3">{LEARN.explainTitle}</h2>
            <ul style={{ paddingLeft: 20, display: 'grid', gap: 8 }}>
              {p.explain.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </div>
          <div className="s-stack">
            <h2 className="s-h3">{LEARN.mistakeTitle}</h2>
            {p.mistakes.map((m) => (
              <div key={m.wrong} className="s-card-flat s-stack" style={{ gap: 4 }}>
                <span className="s-en-sm" lang="en" style={{ textDecoration: 'line-through' }}>
                  ✗ {m.wrong}
                </span>
                <span className="s-en-sm" lang="en">
                  ✓ {m.right}
                </span>
                <span className="s-small">{m.why}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
