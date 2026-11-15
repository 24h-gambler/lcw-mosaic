/** W07 expression pages (docs/14 §9): text first for search; the 3D scene loads only from the [이 장면 해 보기] button. */
import React from 'react';
import { LEARN, LEARN_PAGES } from '../copy.js';
import { SLink } from '../SiteShell.js';
import { OfferList } from '../widgets.js';
import { VoxelSvg, box, cafe, floatingIsland, grass, merge, miniCharacter as character, placeAt, shift, tree, type Vox } from '../voxel.js';

const ART: Readonly<Record<string, Vox[]>> = {
  cafe: merge(grass(14, 12), shift(cafe(), 2, 1, 0), placeAt(character({}), 7, 10)),
  makers_lab: merge(grass(10, 8), placeAt(character({ jetpack: true }), 4, 4), box(7, 1, 0, 2, 4, 3, 'sun-d')),
  trade: merge(grass(12, 8), placeAt(character({}), 3, 5), placeAt(character({ shirt: 'sky-d', hair: 'sun-d' }), 9, 5), box(5, 3, 0, 2, 4, 3, 'sun-d'), box(5, 4, 3, 1, 1, 1, 'sky')),
  court: merge(grass(12, 8), box(1, 1, 0, 10, 2, 5, 'sun-d'), placeAt(character({ shirt: 'ink-700', hair: 'silver' }), 6, 2, 5), placeAt(character({}), 6, 6)),
  open_question: merge(shift(floatingIsland('leaf', 'sun-d'), 0, 0, 2), shift(tree(), 2, 2, 3), placeAt(character({}), 4, 3, 3))
};

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
              <VoxelSvg voxels={ART[p.ctx] ?? ART.cafe!} unit={6} style={{ height: 120, width: '100%' }} />
              <strong className="s-h3">{p.title}</strong>
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
            <p className="s-lead">{p.scene}</p>
            <SLink to="/try" className="s-btn s-btn-brand s-btn-lg" style={{ justifySelf: 'start' }}>
              {LEARN.tryCta} ▶
            </SLink>
          </div>
          <div className="s-show" style={{ cursor: 'default' }}>
            <VoxelSvg voxels={ART[p.ctx] ?? ART.cafe!} unit={12} title={p.scene} />
          </div>
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
