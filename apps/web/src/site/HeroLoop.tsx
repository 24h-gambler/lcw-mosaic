/**
 * W01 15-second loop (docs/14 §3): the child hesitates → the dialog offers ★/★★/★★★ sentences → the child says
 * the ★★★ one (words turn green as they are heard, 08 §8.2) → a jetpack attaches and the child lifts off towards
 * a sky island. Captions carry the story with the sound off. It plays only while on screen, can be paused
 * (WCAG 2.2.2), and with prefers-reduced-motion it starts paused on the final frame.
 *
 * The voxel scene is drawn as SVG so the landing stays inside the 600KB budget (docs/14 §11); once the world
 * domain's /game renders the same moment, a captured clip of /game can sit behind the same captions.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LOOP, LOOP_OFFERS } from './copy.js';
import { prefersReducedMotion } from './sound.js';
import {
  IsoGroup,
  box,
  character,
  floatingIsland,
  grass,
  isoPoint,
  merge,
  placeAt,
  projectIso,
  rotateQuarter,
  shift,
  tree,
  type Vox
} from './voxel.js';

export const HERO_LOOP_MS = 15_000;
/** Phase start times (ms) inside the loop; captions follow the phases. */
export const HERO_PHASES = [0, 3_500, 8_000, 11_000] as const;
const TICK_MS = 100;
const UNIT = 10;

export function heroPhaseAt(tMs: number): 0 | 1 | 2 | 3 {
  const t = ((tMs % HERO_LOOP_MS) + HERO_LOOP_MS) % HERO_LOOP_MS;
  if (t >= HERO_PHASES[3]) return 3;
  if (t >= HERO_PHASES[2]) return 2;
  if (t >= HERO_PHASES[1]) return 1;
  return 0;
}

/** How many words of the ★★★ sentence are already painted green at time t (phase 2 only). */
export function heroWordsLit(tMs: number, wordCount: number): number {
  const t = ((tMs % HERO_LOOP_MS) + HERO_LOOP_MS) % HERO_LOOP_MS;
  if (t < HERO_PHASES[2]) return 0;
  if (t >= HERO_PHASES[3]) return wordCount;
  const span = HERO_PHASES[3] - HERO_PHASES[2] - 600;
  return Math.min(wordCount, Math.floor(((t - HERO_PHASES[2]) / span) * wordCount));
}

const KID_AT: [number, number] = [6, 7];
const HIDE_FLAME = ['flame'] as const;

function useScene() {
  return useMemo(() => {
    const ground = merge(grass(22, 11), box(15, 2, 0, 4, 2, 2, 'sun-d'), box(15, 2, 2, 4, 2, 1, 'ink-500'));
    const trees = [placeAt(tree(), 2, 2), placeAt(tree(), 20, 9)];
    const maker = placeAt(character({ shirt: 'sky-d', pants: 'ink-700', hair: 'sun-d' }), 16, 5);
    const kid = placeAt(character({}), KID_AT[0], KID_AT[1]);
    const kidJet = placeAt(rotateQuarter(character({ jetpack: true }), 1), KID_AT[0], KID_AT[1]);
    const island = shift(merge(floatingIsland('leaf', 'sun-d'), shift(tree(), 2, 2, 1)), 13, 0, 17);
    const clouds = [shift(box(0, 0, 0, 5, 3, 1, 'paper-0'), -2, 8, 21), shift(box(0, 0, 0, 4, 2, 1, 'paper-0'), 18, -2, 24)];
    const all: Vox[] = merge(ground, ...trees, maker, kid, kidJet, island, ...clouds, shift(kidJet, 0, 0, 7));
    const b = projectIso(all, UNIT);
    const pad = UNIT * 2;
    const vb = { x: b.minX - pad, y: b.minY - pad, w: b.width + pad * 2, h: b.height + pad * 2 };
    const pct = (x: number, y: number, z: number) => {
      const [sx, sy] = isoPoint(x, y, z, UNIT);
      return { left: `${((sx - vb.x) / vb.w) * 100}%`, top: `${((sy - vb.y) / vb.h) * 100}%` };
    };
    return { ground, trees, maker, kid, kidJet, island, clouds, vb, pct };
  }, []);
}

export function HeroLoop({ autoPlay = true }: { autoPlay?: boolean }): React.ReactElement {
  const scene = useScene();
  const reduced = typeof window !== 'undefined' ? prefersReducedMotion() : false;
  const [t, setT] = useState<number>(HERO_PHASES[3] + 2_500);
  const [playing, setPlaying] = useState(false);
  const [userPaused, setUserPaused] = useState(false);
  const [onScreen, setOnScreen] = useState(true);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!reduced && autoPlay) {
      setT(0);
      setPlaying(true);
    }
  }, [reduced, autoPlay]);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver((es) => setOnScreen(es.some((e) => e.isIntersecting)), { threshold: 0.2 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const running = playing && !userPaused && onScreen;
  useEffect(() => {
    if (!running) return undefined;
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      setT((v) => (v + TICK_MS) % HERO_LOOP_MS);
    }, TICK_MS);
    return () => clearInterval(id);
  }, [running]);

  const phase = heroPhaseAt(t);
  const words = LOOP.spoken.split(' ');
  const lit = heroWordsLit(t, words.length);
  const inPhase = (t % HERO_LOOP_MS) - HERO_PHASES[phase];
  const lift = phase === 3 ? Math.min(1, Math.max(0, (inPhase - 700) / 1800)) : 0;
  const pickedShown = phase === 1 && inPhase > 2_600;
  const offersShown = phase === 1 ? Math.min(3, Math.floor(inPhase / 500)) : 0;
  const showIsland = phase === 3 && inPhase > 900;

  const goTo = (p: 0 | 1 | 2 | 3) => {
    setT(HERO_PHASES[p] + (p === 3 ? 2_500 : p === 2 ? 2_900 : p === 1 ? 2_800 : 1_200));
    setUserPaused(true);
    setPlaying(true);
  };
  const toggle = () => {
    if (!playing) {
      setPlaying(true);
      setUserPaused(false);
      if (phase === 3) setT(0);
      return;
    }
    setUserPaused((v) => !v);
  };
  const isRunning = playing && !userPaused;
  const { vb, pct } = scene;
  const kidHead = pct(KID_AT[0] + 2, KID_AT[1] - 1, 15);
  const makerHead = pct(17, 4, 15);

  return (
    <figure className="s-loop" ref={ref} aria-label={LOOP.label} data-testid="hero-loop" data-phase={phase} style={{ margin: 0, aspectRatio: `${vb.w} / ${vb.h}` }}>
      <div className="s-loop-dots" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <i key={i} data-on={i <= phase ? '1' : '0'} />
        ))}
      </div>
      <div className="s-loop-ctrl">
        <button type="button" onClick={() => goTo(((phase + 3) % 4) as 0 | 1 | 2 | 3)} aria-label={LOOP.prev}>
          ‹
        </button>
        <button type="button" onClick={toggle} aria-label={isRunning ? LOOP.pause : LOOP.play} aria-pressed={!isRunning}>
          {isRunning ? 'Ⅱ' : '▶'}
        </button>
        <button type="button" onClick={() => goTo(((phase + 1) % 4) as 0 | 1 | 2 | 3)} aria-label={LOOP.next}>
          ›
        </button>
      </div>
      <svg viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} width="100%" height="100%" aria-hidden="true" shapeRendering="crispEdges" style={{ position: 'absolute', inset: 0 }}>
        {scene.clouds.map((c, i) => (
          <IsoGroup key={`c${i}`} voxels={c} unit={UNIT} />
        ))}
        <g style={{ opacity: showIsland ? 1 : 0, transition: 'opacity 600ms ease-out' }}>
          <IsoGroup voxels={scene.island} unit={UNIT} />
        </g>
        <IsoGroup voxels={scene.ground} unit={UNIT} />
        <IsoGroup voxels={scene.trees[0]!} unit={UNIT} />
        <IsoGroup voxels={scene.maker} unit={UNIT} />
        {phase === 3 ? (
          <IsoGroup
            voxels={scene.kidJet}
            unit={UNIT}
            className="s-popin"
            transform={`translate(0 ${(-lift * 7 * UNIT).toFixed(1)})`}
            partClass={{ flame: 's-flame' }}
            hideParts={lift > 0 ? undefined : HIDE_FLAME}
          />
        ) : (
          <IsoGroup voxels={scene.kid} unit={UNIT} className={phase === 2 ? 's-bob' : undefined} />
        )}
        <IsoGroup voxels={scene.trees[1]!} unit={UNIT} />
      </svg>

      {phase === 0 ? (
        <div className="s-bubble" lang="en" style={{ ...kidHead, transform: 'translate(-10%, -120%)' }} key="b0">
          {LOOP.hesitant}
        </div>
      ) : null}
      {phase === 1 ? (
        <>
          <div className="s-bubble" lang="en" style={{ ...makerHead, transform: 'translate(-80%, -130%)', fontSize: 14, lineHeight: '18px' }} key="b1">
            {LOOP.npcAsk}
          </div>
          <div className="s-dialog" style={{ top: 'auto', bottom: '18%' }} aria-hidden="true">
            {LOOP_OFFERS.slice(0, offersShown).map((o) => (
              <div key={o.stars} className="s-offer s-risein" data-stars={o.stars} data-pick={pickedShown && o.stars === 3 ? '1' : '0'}>
                <span className="s-stars">{'★'.repeat(o.stars)}</span>
                <span className="s-en-sm" lang="en">
                  {o.text}
                </span>
                <span className="s-coin">{o.coins.toLocaleString('en-US')}</span>
              </div>
            ))}
          </div>
        </>
      ) : null}
      {phase === 2 ? (
        <div className="s-dialog" style={{ top: 'auto', bottom: '18%' }}>
          <div className="s-en-sm" lang="en" style={{ fontSize: 17, lineHeight: '24px' }}>
            {words.map((w, i) => (
              <React.Fragment key={i}>
                <span className="s-word" data-st={i < lit ? 'ok' : ''}>
                  {w}
                </span>{' '}
              </React.Fragment>
            ))}
          </div>
          {lit >= words.length ? (
            <span className="s-stars" style={{ color: 'inherit' }} aria-hidden="true">
              <span className="s-popin" style={{ display: 'inline-block' }}>★★★</span>
            </span>
          ) : null}
        </div>
      ) : null}
      {phase === 3 && lift < 0.2 ? (
        <span className="s-starburst" style={{ ...kidHead, transform: 'translate(-30%, -60%)' }} aria-hidden="true">
          ★
        </span>
      ) : null}

      <figcaption className="s-loop-cap" aria-live="off">
        <span>{LOOP.captions[phase]}</span>
      </figcaption>
    </figure>
  );
}
