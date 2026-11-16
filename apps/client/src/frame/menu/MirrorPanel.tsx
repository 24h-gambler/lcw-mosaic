/**
 * G04 거울 뷰 (docs/08 8.6; docs/03 D1 "캐릭터 1종 + 소켓 6개"): the child's own character turning in a small 3D
 * view (drag, arrow buttons, or the keyboard), and the list of what is worn in each of the six sockets (server items).
 * The view is its own tiny renderer that lives only while the tab is open; the world is paused meanwhile.
 */
import React, { useEffect, useRef, useState } from 'react';
import { COLOR_TOKENS as C } from '@lcw/ui';
import { FRAME_STRINGS as F } from '../strings.js';
import { SOCKET_NAMES, fetchItems, type ItemsView } from '../api.js';
import { socketThings } from './BagPanel.js';
import { motionReduced } from '../settings.js';
import type { MenuPanelProps } from './types.js';
import { KoHelp } from './ko-help.js';
import type { NpcLook } from '../../world/town.js';

/** Next yaw after a turn step (radians, kept in -PI..PI). */
export function turnYaw(yaw: number, step: number): number {
  let y = yaw + step;
  while (y > Math.PI) y -= Math.PI * 2;
  while (y < -Math.PI) y += Math.PI * 2;
  return y;
}

const MIRROR_CSS = `
.lcw-menu .lcw-mirror{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px;align-items:start}
.lcw-menu .lcw-mirror__view{position:relative;aspect-ratio:3/4;max-height:calc(100vh - 220px);width:100%;border:2px solid var(--c-ink-900);border-radius:8px;overflow:hidden;
  background:linear-gradient(180deg,var(--c-paper-100),var(--c-paper-0));touch-action:none;cursor:grab}
.lcw-menu .lcw-mirror__view canvas{display:block;width:100%;height:100%}
.lcw-menu .lcw-mirror__turn{display:flex;gap:8px;justify-content:center;margin-top:8px}
.lcw-menu .lcw-mirror__list{list-style:none;margin:0;padding:0;display:grid;gap:6px}
.lcw-menu .lcw-mirror__list li{display:grid;grid-template-columns:calc(64px * var(--fs)) calc(32px * var(--fs)) 1fr;align-items:center;gap:8px;padding:8px 10px;background:var(--c-paper-0);border:2px solid var(--c-ink-900);border-radius:8px}
.lcw-menu .lcw-mirror__list li.empty{background:transparent;border-style:dashed;border-color:var(--c-ink-500);color:var(--c-ink-500)}
.lcw-menu .lcw-mirror__list .s{font-weight:800}
.lcw-menu .lcw-mirror__list .e{font-size:calc(24px * var(--fs));text-align:center}
@media (max-width:600px){.lcw-menu .lcw-mirror{grid-template-columns:1fr}.lcw-menu .lcw-mirror__view{aspect-ratio:1/1;max-height:42vh}}
@media (max-height:500px){.lcw-menu .lcw-mirror__view{aspect-ratio:auto;height:calc(100vh - 120px)}}
`;

function MirrorView({ look, reduceMotion }: { look: NpcLook; reduceMotion: boolean }): React.ReactElement {
  const host = useRef<HTMLDivElement | null>(null);
  const yawRef = useRef(0.5);
  const [, force] = useState(0);
  const draggingRef = useRef(false);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let live = true;
    let raf = 0;
    let cleanup = (): void => undefined;
    void Promise.all([import('three'), import('../../world/character.js')]).then(([THREE, ch]) => {
      if (!live) return;
      let renderer: InstanceType<typeof THREE.WebGLRenderer>;
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      } catch {
        return; // no second context on this device: the list still shows what is worn
      }
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      el.appendChild(renderer.domElement);
      const scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight(C['paper-0'], C['ink-500'], 1.6));
      const sun = new THREE.DirectionalLight(C['paper-0'], 1.4);
      sun.position.set(1.5, 3, 2.5);
      scene.add(sun);
      const c = new ch.VoxelCharacter(look);
      scene.add(c.root);
      const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
      const h = ch.CHAR_HEIGHT;
      cam.position.set(0, h * 0.62, h * 3.1);
      cam.lookAt(0, h * 0.5, 0);
      const size = (): void => {
        const w = el.clientWidth || 1;
        const hh = el.clientHeight || 1;
        renderer.setSize(w, hh, false);
        cam.aspect = w / hh;
        cam.updateProjectionMatrix();
      };
      size();
      const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(size) : null;
      ro?.observe(el);
      let last = performance.now();
      const tick = (now: number): void => {
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;
        if (!reduceMotion && !draggingRef.current) yawRef.current = turnYaw(yawRef.current, dt * 0.35);
        c.root.rotation.y = yawRef.current;
        c.update(dt, { speed: 0, talking: false, lookYaw: 0 });
        renderer.render(scene, cam);
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      cleanup = () => {
        cancelAnimationFrame(raf);
        ro?.disconnect();
        scene.traverse((o) => {
          const m = o as { geometry?: { dispose(): void }; material?: { dispose(): void } | Array<{ dispose(): void }> };
          m.geometry?.dispose();
          if (Array.isArray(m.material)) m.material.forEach((x) => x.dispose());
          else m.material?.dispose();
        });
        renderer.dispose();
        renderer.forceContextLoss();
        renderer.domElement.remove();
      };
    });
    return () => {
      live = false;
      cleanup();
    };
  }, [look, reduceMotion]);

  // drag to turn
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let x0 = 0;
    let id = -1;
    const down = (e: PointerEvent): void => {
      id = e.pointerId;
      x0 = e.clientX;
      draggingRef.current = true;
      el.setPointerCapture?.(e.pointerId);
    };
    const move = (e: PointerEvent): void => {
      if (e.pointerId !== id) return;
      yawRef.current = turnYaw(yawRef.current, (e.clientX - x0) * 0.012);
      x0 = e.clientX;
    };
    const up = (e: PointerEvent): void => {
      if (e.pointerId !== id) return;
      id = -1;
      draggingRef.current = false;
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
  }, []);

  const turn = (s: number): void => {
    yawRef.current = turnYaw(yawRef.current, s);
    force((n) => n + 1);
  };
  return (
    <div>
      <div
        className="lcw-mirror__view"
        ref={host}
        role="img"
        aria-label={F.mirrorTitle}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') turn(-0.4);
          if (e.key === 'ArrowRight') turn(0.4);
        }}
      />
      <div className="lcw-mirror__turn">
        <button type="button" className="btn" onClick={() => turn(-Math.PI / 4)} aria-label={F.turnLeft}>
          ⟲
        </button>
        <span className="muted" style={{ alignSelf: 'center' }}>
          {F.mirrorHint}
          <KoHelp of={F.mirrorHint} />
        </span>
        <button type="button" className="btn" onClick={() => turn(Math.PI / 4)} aria-label={F.turnRight}>
          ⟳
        </button>
      </div>
    </div>
  );
}

export function MirrorPanel(props: MenuPanelProps): React.ReactElement {
  const { world, auth, fetchImpl } = props;
  const [view, setView] = useState<ItemsView | null>(null);
  const [look] = useState<NpcLook | null>(() => world?.getPlayerLook?.() ?? null);
  // G14 '움직임 줄이기' (falls back to the device preference)
  const [reduceMotion] = useState(() => motionReduced());

  useEffect(() => {
    let live = true;
    if (auth.token)
      void fetchItems(auth, fetchImpl).then((r) => {
        if (live && r.ok) setView(r.data);
      });
    return () => {
      live = false;
    };
  }, [auth, fetchImpl]);

  const worn = view ? socketThings(view) : null;
  return (
    <section>
      <style>{MIRROR_CSS}</style>
      <h2>{F.mirrorTitle}<KoHelp of={F.mirrorTitle} /></h2>
      <div className="lcw-mirror">
        {look ? <MirrorView look={look} reduceMotion={reduceMotion} /> : <div />}
        <div>
          <h3 style={{ marginTop: 0 }}>{F.wearing}<KoHelp of={F.wearing} /></h3>
          <ul className="lcw-mirror__list">
            {SOCKET_NAMES.map((s) => {
              const t = worn?.[s] ?? null;
              return (
                <li key={s} className={t ? '' : 'empty'}>
                  <span className="s">{F.sockets[s]}</span>
                  <span className="e" aria-hidden="true">
                    {t?.emoji ?? ''}
                  </span>
                  <span>{t ? t.item_name_ko : F.socketEmpty}</span>
                </li>
              );
            })}
          </ul>
          {!auth.token ? <p className="note" style={{ marginTop: 8 }}>{F.guestNote}<KoHelp of={F.guestNote} /></p> : null}
        </div>
      </div>
    </section>
  );
}
