/** W03 student page (docs/14 §5). No price, payment, stock or deadline anywhere on this page. */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LOOP_OFFERS, PLAY, TOUR } from '../copy.js';
import { GameClip } from '../GameMedia.js';
import { SLink } from '../SiteShell.js';
import { prefersReducedMotion } from '../sound.js';
import { CAFE_OFFERS_NOW, FEATURE_NAME_KO, PLAY_NOW, PLAY_SECTION_FEATURES } from '../copyNow.js';
import { FEATURE_IDS, allLive, featureLive, liveOr, type FeatureId } from '../featureStatus.js';
import { ListenButton, OfferList, StateTag, Toast, useShareToParent } from '../widgets.js';
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

/** About 40 frames per build at 7 fps: reads as block-by-block without re-drawing the scene 16 times a second. */
const BUILD_STEP_MS = 140;
const BUILD_FRAMES = 40;

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
    const per = Math.max(1, Math.ceil(order.length / BUILD_FRAMES));
    const id = setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      setN((v) => (v >= order.length + per * 10 ? 0 : v + per));
    }, BUILD_STEP_MS);
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

/** A cup on a counter, for the card of what is open today (talking at the cafe and the shop). */
const TALK_ART: Vox[] = merge(
  box(0, 0, 0, 6, 3, 2, 'sun-d'),
  box(2, 1, 2, 2, 2, 2, 'paper-100'),
  box(2, 1, 4, 2, 2, 1, 'sun'),
  placeAt(character({ shirt: 'leaf' }), 7, 1)
);

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
  ids,
  children
}: {
  title: string;
  body: string;
  art: React.ReactNode;
  line?: string;
  flip?: boolean;
  /** Features this section shows: a state tag sits next to the title until they are live (featureStatus.ts). */
  ids: readonly FeatureId[];
  children?: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="s-sec" data-live={allLive(ids) ? 'yes' : 'no'}>
      <div className="s-wrap s-split">
        <div className="s-stack" style={{ order: flip ? 2 : 0 }}>
          <h2 className="s-h2 s-row" style={{ gap: 12 }}>
            <span>{title}</span>
            <StateTag ids={ids} />
          </h2>
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

type SectionKey = keyof typeof PLAY_SECTION_FEATURES;

export function PlayPage(): React.ReactElement {
  const { share, toast, clear } = useShareToParent();
  const halfLive = allLive(PLAY_NOW.half.needs);
  // Mode cards: what is open today first (featureStatus.ts), the rest keep their state tag.
  const modes = [
    ...(allLive(PLAY_NOW.talkMode.needs)
      ? [{ k: PLAY_NOW.talkMode.k, d: PLAY_NOW.talkMode.d, ids: PLAY_NOW.talkMode.needs as readonly FeatureId[], art: TALK_ART }]
      : []),
    ...PLAY.modes.map((m, i) => {
      const st = PLAY_NOW.modes[i]!;
      return { k: m.k, d: st.now ? liveOr({ needs: st.needs, now: st.now }, m.d as string) : (m.d as string), ids: [st.tag] as readonly FeatureId[], art: MODE_ART[i]! };
    })
  ].sort((x, y) => Number(allLive(y.ids)) - Number(allLive(x.ids)));
  const openNow = PLAY_NOW.openNow(FEATURE_IDS.filter((id) => featureLive(id) && id !== 'showroom').map((id) => FEATURE_NAME_KO[id]));

  const sections: Array<{ key: SectionKey; ids: readonly FeatureId[]; render: (flip: boolean) => React.ReactElement }> = [
    {
      key: 'half',
      // The star price is live at the cafe today; the gear lab's jetpack takes over once it is.
      ids: halfLive ? PLAY_SECTION_FEATURES.half : ['talk_order'],
      render: (flip) => (
        <Feature
          key="half"
          flip={flip}
          ids={halfLive ? PLAY_SECTION_FEATURES.half : ['talk_order']}
          title={PLAY.halfTitle}
          body={liveOr(PLAY_NOW.half, PLAY.halfBody as string)}
          art={<OfferList offers={halfLive ? LOOP_OFFERS : CAFE_OFFERS_NOW} />}
        />
      )
    },
    {
      key: 'boom',
      ids: PLAY_SECTION_FEATURES.boom,
      render: (flip) => (
        <Feature
          key="boom"
          flip={flip}
          ids={PLAY_SECTION_FEATURES.boom}
          title={PLAY.boomTitle}
          body={PLAY.boomBody}
          line={PLAY.boomLine}
          art={<VoxelSvg voxels={BOOM} unit={14} style={{ width: '100%', maxWidth: 360, height: 'auto' }} title="터진 사무실" />}
        />
      )
    },
    {
      key: 'make',
      ids: PLAY_SECTION_FEATURES.make,
      render: (flip) => (
        <Feature
          key="make"
          flip={flip}
          ids={PLAY_SECTION_FEATURES.make}
          title={PLAY.makeTitle}
          body={PLAY.makeBody}
          line={PLAY.makeLine}
          art={<VoxelSvg voxels={GEAR} unit={9} style={{ width: '100%', maxWidth: 260, height: 'auto' }} title="호박 헬멧을 쓴 캐릭터" />}
        />
      )
    },
    {
      key: 'build',
      ids: PLAY_SECTION_FEATURES.build,
      render: (flip) => (
        <Feature
          key="build"
          flip={flip}
          ids={PLAY_SECTION_FEATURES.build}
          title={PLAY.buildTitle}
          body={liveOr(PLAY_NOW.build, PLAY.buildBody as string)}
          art={<BuildMontage unit={6} />}
        />
      )
    },
    {
      key: 'friend',
      ids: PLAY_SECTION_FEATURES.friend,
      render: (flip) => (
        <Feature
          key="friend"
          flip={flip}
          ids={PLAY_SECTION_FEATURES.friend}
          title={PLAY.friendTitle}
          body={PLAY.friendBody}
          art={<VoxelSvg voxels={FRIENDS} unit={10} style={{ width: '100%', maxWidth: 360, height: 'auto' }} title="친구와 함께 서 있는 장면" />}
        >
          <SLink to="/pass" className="s-small">
            초대 코드를 받았나요? →
          </SLink>
        </Feature>
      )
    },
    {
      key: 'up',
      ids: PLAY_SECTION_FEATURES.up,
      render: (flip) => (
        <Feature
          key="up"
          flip={flip}
          ids={PLAY_SECTION_FEATURES.up}
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
      )
    }
  ];
  // Live sections first, in their written order; every other claim stays below with its tag.
  const ordered = [...sections].sort((x, y) => Number(allLive(y.ids)) - Number(allLive(x.ids)));

  return (
    <>
      <section className="s-hero">
        <div className="s-wrap s-hero-grid">
          <div className="s-hero-copy">
            <span className="s-eyebrow">플레이어에게</span>
            <h1 className="s-display">{PLAY.title}</h1>
            <p className="s-lead">{liveOr(PLAY_NOW.lead, PLAY.lead as string)}</p>
            <div className="s-entrances">
              <SLink to="/try" className="s-btn s-btn-brand s-btn-lg">
                {PLAY.tryIt} ▶
              </SLink>
              <button type="button" className="s-btn s-btn-lg" onClick={share}>
                {PLAY.send}
              </button>
            </div>
          </div>
          <GameClip clip="tour-town" captions={TOUR.captions} label={TOUR.label} />
        </div>
      </section>

      <section className="s-sec s-sec-tint">
        <div className="s-wrap">
          <div className="s-sec-head">
            <h2 className="s-h2">{PLAY.freeTitle}</h2>
            {openNow ? <p className="s-lead" data-testid="open-now">{openNow}</p> : null}
          </div>
          <div className="s-grid-modes">
            {modes.map((m) => (
              <div key={m.k} className="s-card s-stack" style={{ gap: 8 }} data-live={allLive(m.ids) ? 'yes' : 'no'}>
                <VoxelSvg voxels={m.art} unit={7} style={{ height: 96, width: '100%' }} />
                <span className="s-row" style={{ gap: 8, justifyContent: 'space-between' }}>
                  <strong className="s-h3">{m.k}</strong>
                  <StateTag ids={m.ids} />
                </span>
                <p className="s-muted">{m.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {ordered.map((sec, i) => sec.render(i % 2 === 1))}

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
