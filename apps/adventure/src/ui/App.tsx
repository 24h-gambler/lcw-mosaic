import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ADV } from '../core/tuning.js';
import { Renderer } from '../render.js';
import type { Engine } from '../engine.js';
import { Panel } from './Panel.js';
import { ParentSummary } from './Parent.js';
import { S } from './strings.js';

/** Layout (docs/22 4장): a 4:3 stage beside the panel on wide screens, above it on tall ones. */
function layoutFor(w: number, h: number): { side: boolean; stageW: number; stageH: number } {
  const ratio = ADV.screen.w / ADV.screen.h;
  if (w / h > 1.15) {
    const panel = Math.max(300, Math.min(420, w * 0.3));
    const stageH = Math.min(h, (w - panel) / ratio);
    return { side: true, stageW: Math.floor(stageH * ratio), stageH: Math.floor(stageH) };
  }
  const stageW = Math.min(w, (h * 0.58) * ratio);
  return { side: false, stageW: Math.floor(stageW), stageH: Math.floor(stageW / ratio) };
}

const KEY_DIR: Record<string, 'left' | 'right' | 'up' | 'down'> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
  a: 'left',
  d: 'right',
  w: 'up',
  s: 'down',
  A: 'left',
  D: 'right',
  W: 'up',
  S: 'down'
};

export function App({ engine }: { engine: Engine }) {
  const snap = useSyncExternalStore(engine.subscribe, engine.getSnapshot);
  const cvRef = useRef<HTMLCanvasElement | null>(null);
  const [lay, setLay] = useState(() => layoutFor(window.innerWidth, window.innerHeight));

  useLayoutEffect(() => {
    const on = () => setLay(layoutFor(window.innerWidth, window.innerHeight));
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);

  // the loop: fixed 60 Hz steps, one draw per animation frame
  useEffect(() => {
    const cv = cvRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d', { alpha: false });
    if (!ctx) return;
    const r = new Renderer(cv, ctx);
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const dt = 1 / ADV.stepHz;
    const frame = (now: number) => {
      const ms = Math.min(ADV.maxFrameMs, now - last);
      last = now;
      acc += ms / 1000;
      let n = 0;
      while (acc >= dt && n < 8) {
        engine.step(dt);
        acc -= dt;
        n++;
      }
      r.resize(cv.clientWidth || ADV.screen.w, cv.clientHeight || ADV.screen.h);
      r.draw(engine);
      engine.frames += 1;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [engine]);

  // keyboard
  useEffect(() => {
    const typing = (t: EventTarget | null) => t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement;
    const down = (e: KeyboardEvent) => {
      if (typing(e.target)) {
        if (e.key === 'Escape') (e.target as HTMLElement).blur();
        return;
      }
      const dir = KEY_DIR[e.key];
      if (dir) {
        const s = engine.getSnapshot();
        const menuish = s.scene === 'title' || s.battle?.phase === 'menu';
        if (menuish) {
          if (!e.repeat) engine.menuMove(dir === 'left' || dir === 'up' ? -1 : 1);
        } else if (s.battle?.phase === 'talkPick' || s.battle?.phase === 'pouch') {
          const btns = [...document.querySelectorAll<HTMLButtonElement>('[data-nav]')];
          const i = btns.indexOf(document.activeElement as HTMLButtonElement);
          btns[(i + (dir === 'up' || dir === 'left' ? -1 : 1) + btns.length) % btns.length]?.focus();
        } else engine.keys.add(dir);
        e.preventDefault();
        return;
      }
      const onButton = e.target instanceof HTMLButtonElement;
      if (e.key === 'z' || e.key === 'Z' || ((e.key === 'Enter' || e.key === ' ') && !onButton)) {
        if (!e.repeat) engine.confirm();
        e.preventDefault();
      } else if (e.key === 'x' || e.key === 'X' || e.key === 'Escape' || e.key === 'Backspace') {
        engine.cancel();
      } else if (/^[1-4]$/.test(e.key) && engine.getSnapshot().battle?.phase === 'menu') {
        engine.command((['poke', 'talk', 'pouch', 'friend'] as const)[Number(e.key) - 1]!);
      }
    };
    const up = (e: KeyboardEvent) => {
      const dir = KEY_DIR[e.key];
      if (dir) engine.keys.delete(dir);
    };
    const blur = () => engine.keys.clear();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, [engine]);

  const toLogical = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) / rect.width) * ADV.screen.w, y: ((e.clientY - rect.top) / rect.height) * ADV.screen.h };
  };

  if (snap.scene === 'parent') return <ParentSummary engine={engine} snap={snap} />;

  const top = (
    <div className="adv-top">
      <span className="brand">{S.title.en}</span>
      <button type="button" className="toggle" aria-pressed={snap.help} onClick={() => engine.toggleHelp()} data-testid="adv-help">
        {S.help}
      </button>
      <button type="button" className="toggle" aria-pressed={snap.sound} onClick={() => engine.toggleSound()} data-testid="adv-sound">
        {snap.sound ? '🔊' : '🔈'} {snap.sound ? S.soundOn.en : S.soundOff.en}
      </button>
    </div>
  );

  return (
    <div className={`adv ${lay.side ? 'side' : 'stack'}`} data-testid="adv-root" data-scene={snap.scene}>
      {!lay.side && top}
      <div className="adv-stage" style={{ width: lay.side ? lay.stageW : '100%', height: lay.stageH }}>
        <canvas
          ref={cvRef}
          width={ADV.screen.w}
          height={ADV.screen.h}
          style={{ width: lay.stageW, height: lay.stageH }}
          aria-label={S.title.en}
          data-testid="adv-canvas"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            const p = toLogical(e);
            engine.pointer('down', p.x, p.y);
          }}
          onPointerMove={(e) => {
            if (e.buttons === 0 && e.pointerType === 'mouse') return;
            const p = toLogical(e);
            engine.pointer('move', p.x, p.y);
          }}
          onPointerUp={(e) => {
            const p = toLogical(e);
            engine.pointer('up', p.x, p.y);
          }}
        />
      </div>
      <div className="adv-side">
        {lay.side && top}
        <Panel engine={engine} snap={snap} />
      </div>
    </div>
  );
}
