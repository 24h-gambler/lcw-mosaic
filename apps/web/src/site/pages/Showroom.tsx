/** W08 showroom (docs/14 §2, WP-703): turn a static build snapshot; nothing live, no voice, no real name. */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { SHOWROOM } from '../copy.js';
import { SLink } from '../SiteShell.js';
import { SAMPLE_SNAPSHOTS, loadShowroom, parseShowroomSnapshot, snapshotVoxels, type ShowroomSnapshot } from '../showroom.js';
import { VoxelSvg, rotateQuarter } from '../voxel.js';
import { Toast } from '../widgets.js';

const DRAG_TURN_PX = 48;

export function ShowroomViewer({ snapshot }: { snapshot: ShowroomSnapshot }): React.ReactElement {
  const [turn, setTurn] = useState(0);
  const base = useMemo(() => snapshotVoxels(snapshot), [snapshot]);
  const voxels = useMemo(() => rotateQuarter(base, turn), [base, turn]);
  const drag = useRef<number | null>(null);
  return (
    <div className="s-stack" style={{ gap: 12 }}>
      <div
        className="s-show"
        onPointerDown={(e) => {
          drag.current = e.clientX;
        }}
        onPointerMove={(e) => {
          if (drag.current === null) return;
          const dx = e.clientX - drag.current;
          if (Math.abs(dx) >= DRAG_TURN_PX) {
            setTurn((t) => t + (dx > 0 ? 1 : -1));
            drag.current = e.clientX;
          }
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerLeave={() => {
          drag.current = null;
        }}
      >
        <VoxelSvg key={((turn % 4) + 4) % 4} voxels={voxels} unit={10} title={`${snapshot.title} 쇼룸`} className="s-risein" />
        {snapshot.sample ? (
          <span className="s-tag s-tag-sample" style={{ position: 'absolute', left: 12, top: 12 }}>
            {SHOWROOM.sampleTag}
          </span>
        ) : null}
      </div>
      <div className="s-row" style={{ justifyContent: 'space-between' }}>
        <div className="s-row">
          <button type="button" className="s-btn" onClick={() => setTurn((t) => t - 1)} aria-label={SHOWROOM.turnLeft}>
            ⟲
          </button>
          <button type="button" className="s-btn" onClick={() => setTurn((t) => t + 1)} aria-label={SHOWROOM.turnRight}>
            ⟳
          </button>
        </div>
        <span className="s-small">{SHOWROOM.blocks(snapshot.blocks.length)}</span>
      </div>
    </div>
  );
}

export function ShowroomPage({ token }: { token: string }): React.ReactElement {
  const initial = token in SAMPLE_SNAPSHOTS ? parseShowroomSnapshot(SAMPLE_SNAPSHOTS[token]) : null;
  const [snap, setSnap] = useState<ShowroomSnapshot | null | 'loading'>(initial ?? 'loading');
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (initial) return;
    let alive = true;
    void loadShowroom(token, typeof fetch === 'function' ? fetch : undefined).then((s) => {
      if (alive) setSnap(s);
    });
    return () => {
      alive = false;
    };
  }, [token, initial]);
  const copy = () => {
    void navigator.clipboard?.writeText(window.location.href).then(() => setToast(SHOWROOM.copied));
  };
  return (
    <section className="s-hero">
      <div className="s-wrap s-hero-grid">
        <div className="s-hero-copy">
          <span className="s-eyebrow">쇼룸</span>
          <h1 className="s-h1">{snap && snap !== 'loading' ? snap.title : SHOWROOM.title}</h1>
          <p className="s-lead">{SHOWROOM.lead}</p>
          <div className="s-row">
            <SLink to="/try" className="s-btn s-btn-brand">
              {SHOWROOM.cta} ▶
            </SLink>
            <button type="button" className="s-btn" onClick={copy}>
              {SHOWROOM.share}
            </button>
          </div>
        </div>
        {snap === 'loading' ? (
          <div className="s-show" aria-busy="true" style={{ aspectRatio: '4 / 3' }} />
        ) : snap ? (
          <ShowroomViewer snapshot={snap} />
        ) : (
          <div className="s-note s-warn" role="status">
            {SHOWROOM.notFound}
          </div>
        )}
      </div>
      <Toast text={toast} onDone={() => setToast(null)} />
    </section>
  );
}

export function WorldsPage(): React.ReactElement {
  const items = Object.entries(SAMPLE_SNAPSHOTS)
    .map(([k, v]) => [k, parseShowroomSnapshot(v)] as const)
    .filter((x): x is readonly [string, ShowroomSnapshot] => x[1] !== null);
  return (
    <section className="s-hero">
      <div className="s-wrap s-stack" style={{ gap: 24 }}>
        <div className="s-hero-copy" style={{ maxWidth: 720 }}>
          <span className="s-eyebrow">쇼룸</span>
          <h1 className="s-h1">{SHOWROOM.title}</h1>
          <p className="s-lead">{SHOWROOM.lead}</p>
        </div>
        <h2 className="s-h3">{SHOWROOM.galleryTitle}</h2>
        <div className="s-grid-3">
          {items.map(([k, s]) => (
            <SLink key={k} to={`/s/${k}`} className="s-card s-stack" style={{ color: 'inherit', textDecoration: 'none', gap: 8 }}>
              <VoxelSvg voxels={snapshotVoxels(s)} unit={5} style={{ width: '100%', height: 'auto' }} />
              <span className="s-row" style={{ justifyContent: 'space-between' }}>
                <strong>{s.title}</strong>
                {s.sample ? <span className="s-tag s-tag-sample">{SHOWROOM.sampleTag}</span> : null}
              </span>
            </SLink>
          ))}
        </div>
      </div>
    </section>
  );
}
