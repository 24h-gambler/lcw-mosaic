/** W03 student page (docs/14 §5). No price, payment, stock or deadline anywhere on this page. */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LOOP_OFFERS, PLAY } from '../copy.js';
import { SLink } from '../SiteShell.js';
import { prefersReducedMotion } from '../sound.js';
import { ListenButton, OfferList, Toast, useShareToParent } from '../widgets.js';
import {
  VoxelSvg,
  box,
  buildOrder,
  character,
  floatingIsland,
  grass,
  house,
  isoBounds,
  merge,
  placeAt,
  shift,
  tree,
  type Vox
} from '../voxel.js';

const BUILD_STEP_MS = 60;

/** Empty plot → three-storey house, one block at a time, while the montage is on screen. */
export function BuildMontage({ unit = 7 }: { unit?: number }): React.ReactElement {
  const order = useMemo(() => buildOrder(shift(house(), 2, 2, 0)), []);
  const ground = useMemo(() => grass(13, 11), []);
  const full = useMemo(() => merge(ground, order, placeAt(character({ shirt: 'leaf' }), 7, 10)), [ground, order]);
  const vb = useMemo(() => isoBounds(full, unit), [full, unit]);
  const [n, setN] = useState(order.length);
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined' || prefersReducedMotion()) return undefined;
    const io = new IntersectionObserver((es) => setVisible(es.some((e) => e.isIntersecting)), { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return undefined;
    setN(0);
    const per = Math.max(1, Math.ceil(order.length / 70));
    const id = setInterval(() => setN((v) => (v >= order.length + per * 20 ? 0 : v + per)), BUILD_STEP_MS);
    return () => clearInterval(id);
  }, [visible, order.length]);
  const shown = n >= order.length;
  const voxels = useMemo(
    () => merge(ground, order.slice(0, Math.min(n, order.length)), shown ? placeAt(character({ shirt: 'leaf' }), 7, 10) : []),
    [ground, order, n, shown]
  );
  return (
    <div ref={ref} className="s-show" style={{ cursor: 'default' }}>
      <VoxelSvg voxels={voxels} unit={unit} viewBox={vb} title="빈 땅에서 3층 집까지 한 칸씩 쌓는 장면" />
      <span className="s-tag" style={{ position: 'absolute', left: 12, top: 12 }}>
        블록 {Math.min(n, order.length).toLocaleString('ko-KR')} / {order.length.toLocaleString('ko-KR')}
      </span>
    </div>
  );
}

const MODE_ART: Vox[][] = [
  merge(box(0, 0, 0, 4, 4, 1, 'sun-d'), box(0, 0, 1, 4, 1, 3, 'paper-100'), box(0, 0, 1, 1, 4, 3, 'paper-100'), box(0, 0, 4, 4, 4, 1, 'brand-d')),
  merge(placeAt(character({ shirt: 'brand' }), 2, 2), box(5, 1, 0, 3, 3, 2, 'leaf'), box(5, 1, 2, 3, 3, 1, 'leaf-d')),
  merge(box(0, 0, 0, 3, 3, 3, 'ink-500'), box(1, 1, 3, 1, 1, 1, 'sun'), box(4, 0, 0, 2, 2, 2, 'sun'), box(4, 3, 0, 2, 2, 1, 'sky')),
  merge(shift(floatingIsland('leaf', 'sun-d'), 0, 0, 3), shift(tree(), 2, 2, 4))
];

const BOOM: Vox[] = merge(
  box(0, 0, 0, 6, 5, 4, 'silver'),
  box(1, 4, 1, 1, 1, 2, 'sky'),
  box(3, 4, 1, 2, 1, 2, 'sky'),
  [
    { x: 6, y: 1, z: 4, c: 'brand' },
    { x: 7, y: 2, z: 5, c: 'sun' },
    { x: 5, y: 0, z: 6, c: 'brand' },
    { x: 7, y: 0, z: 3, c: 'sun' },
    { x: 8, y: 3, z: 6, c: 'ink-500' },
    { x: 6, y: 3, z: 7, c: 'ink-500' }
  ]
);

const GEAR: Vox[] = merge(
  placeAt(character({ shirt: 'grape' }), 3, 3),
  box(2, 1, 13, 4, 4, 3, 'brand'),
  box(3, 2, 16, 2, 2, 1, 'leaf-d'),
  [{ x: 3, y: 4, z: 14, c: 'sun' }, { x: 5, y: 4, z: 14, c: 'sun' }]
);

const FRIENDS: Vox[] = merge(grass(10, 6), placeAt(character({ shirt: 'brand' }), 3, 3), placeAt(character({ shirt: 'sky-d', hair: 'sun-d', waveArm: true }), 7, 3));

const BANDS: Vox[] = merge(
  shift(floatingIsland('silver', 'ink-500'), 2, 2, 30),
  shift(box(0, 0, 0, 2, 2, 3, 'sky'), 4, 4, 31),
  shift(floatingIsland('leaf', 'sun-d'), 0, 0, 18),
  shift(tree(), 2, 2, 19),
  shift(grass(8, 8, 0), 0, 0, 5),
  shift(box(0, 0, 0, 8, 8, 4, 'sun-d'), 0, 0, 1),
  shift(box(0, 0, 0, 8, 8, 2, 'ink-500'), 0, 0, -1),
  shift(box(0, 0, 0, 2, 2, 1, 'sun'), 3, 3, 1)
);

function Feature({
  title,
  body,
  art,
  line,
  flip,
  children
}: {
  title: string;
  body: string;
  art: React.ReactNode;
  line?: string;
  flip?: boolean;
  children?: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="s-sec">
      <div className="s-wrap s-split">
        <div className="s-stack" style={{ order: flip ? 2 : 0 }}>
          <h2 className="s-h2">{title}</h2>
          <p className="s-lead">{body}</p>
          {line ? (
            <p className="s-row">
              <span className="s-en-sm" lang="en" style={{ fontSize: 20, lineHeight: '28px' }}>
                “{line}”
              </span>
              <ListenButton text={line} />
            </p>
          ) : null}
          {children}
        </div>
        <div>{art}</div>
      </div>
    </section>
  );
}

export function PlayPage(): React.ReactElement {
  const { share, toast, clear } = useShareToParent();
  return (
    <>
      <section className="s-hero">
        <div className="s-wrap s-hero-grid">
          <div className="s-hero-copy">
            <span className="s-eyebrow">플레이어에게</span>
            <h1 className="s-display">{PLAY.title}</h1>
            <p className="s-lead">{PLAY.lead}</p>
            <div className="s-entrances">
              <SLink to="/try" className="s-btn s-btn-brand s-btn-lg">
                {PLAY.tryIt} ▶
              </SLink>
              <button type="button" className="s-btn s-btn-lg" onClick={share}>
                {PLAY.send}
              </button>
            </div>
          </div>
          <BuildMontage />
        </div>
      </section>

      <section className="s-sec s-sec-tint">
        <div className="s-wrap">
          <div className="s-sec-head">
            <h2 className="s-h2">{PLAY.freeTitle}</h2>
          </div>
          <div className="s-grid-4">
            {PLAY.modes.map((m, i) => (
              <div key={m.k} className="s-card s-stack" style={{ gap: 8 }}>
                <VoxelSvg voxels={MODE_ART[i]!} unit={7} style={{ height: 96, width: '100%' }} />
                <strong className="s-h3">{m.k}</strong>
                <p className="s-muted">{m.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <Feature title={PLAY.halfTitle} body={PLAY.halfBody} art={<OfferList offers={LOOP_OFFERS} />} />
      <Feature
        flip
        title={PLAY.boomTitle}
        body={PLAY.boomBody}
        line={PLAY.boomLine}
        art={<VoxelSvg voxels={BOOM} unit={14} style={{ width: '100%', maxWidth: 360, height: 'auto' }} title="터진 사무실" />}
      />
      <Feature
        title={PLAY.makeTitle}
        body={PLAY.makeBody}
        line={PLAY.makeLine}
        art={<VoxelSvg voxels={GEAR} unit={9} style={{ width: '100%', maxWidth: 260, height: 'auto' }} title="호박 헬멧을 쓴 캐릭터" />}
      />
      <Feature flip title={PLAY.buildTitle} body={PLAY.buildBody} art={<BuildMontage unit={6} />} />
      <Feature
        title={PLAY.friendTitle}
        body={PLAY.friendBody}
        art={<VoxelSvg voxels={FRIENDS} unit={10} style={{ width: '100%', maxWidth: 360, height: 'auto' }} title="친구와 함께 서 있는 장면" />}
      >
        <SLink to="/pass" className="s-small">
          초대 코드를 받았나요? →
        </SLink>
      </Feature>
      <Feature
        flip
        title={PLAY.upTitle}
        body={PLAY.upBody}
        art={
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 16, alignItems: 'center' }}>
            <VoxelSvg voxels={BANDS} unit={8} style={{ width: '100%', maxWidth: 240, height: 'auto' }} title="땅속에서 우주까지 층층이 쌓인 세계" />
            <ol style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 28, fontWeight: 800 }}>
              {PLAY.upBands.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ol>
          </div>
        }
      />

      <section className="s-tryband">
        <div className="s-wrap s-tryband-in">
          <div className="s-stack" style={{ gap: 4 }}>
            <strong className="s-h2">{PLAY.endTitle}</strong>
            <span>{PLAY.endBody}</span>
          </div>
          <div className="s-row">
            <button type="button" className="s-btn s-btn-brand s-btn-lg" onClick={share}>
              {PLAY.send}
            </button>
            <SLink to="/try" className="s-btn s-btn-lg">
              {PLAY.tryIt}
            </SLink>
          </div>
        </div>
      </section>
      <Toast text={toast} onDone={clear} />
    </>
  );
}
