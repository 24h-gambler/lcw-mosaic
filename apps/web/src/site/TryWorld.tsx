/**
 * The /try order inside the real 3D town (WP-702 with docs/19 createWorld). The site keeps the flow, the panel and
 * the speech; the world only shows it: plaza → walk (or autopilot) to the honey cafe → owner's bubble → two-shot while
 * the child picks and says a sentence → honey tea in hand with the star burst.
 *
 * The world chunk (three.js + town) loads only on /try, while the start screen is up, and only where it can run well.
 * Anything else — no WebGL2, a low tier, a slow load, a low frame rate, a start tap before the town is ready, or any
 * error — keeps the 2D stage for the whole order, so the order always finishes.
 */
import React, { useEffect, useRef } from 'react';
import type { WorldHandle, WorldTier } from '../../../client/src/world/api.js';
import type { TryPhase } from './tryState.js';

export type TryWorldStatus = 'off' | 'loading' | 'checking' | 'ready' | 'failed';

/** Give up on the 3D town after this long and stay on the 2D stage (the child should not wait on a spinner). */
export const TRY_WORLD_LOAD_MS = 9_000;
export const TRY_CAFE_NPC = 'cafe_owner';
export const TRY_ITEM = 'honey_tea';
/** Below this frame rate on the start screen, /try keeps the 2D stage (a choppy town is worse than a flat one). */
export const TRY_WORLD_MIN_FPS = 20;
export const TRY_WORLD_FPS_CHECK_MS = 2_500;

export interface WorldProbe {
  webgl2: boolean;
  coarse: boolean;
  deviceMemory?: number;
  hardwareConcurrency?: number;
  search: string;
  saveData?: boolean;
}

/**
 * Which stage /try uses. `?world=0` forces 2D and `?world=1` forces 3D (checks and screenshots);
 * otherwise 3D only with WebGL2 and a device that is not low tier (same split as the game shell's pickTier).
 */
export function chooseTryStage(p: WorldProbe): { stage: '3d' | '2d'; tier: WorldTier; forced: boolean } {
  const q = new URLSearchParams(p.search);
  const forced = q.get('world');
  const qt = q.get('tier');
  const mem = p.deviceMemory ?? null;
  const cores = p.hardwareConcurrency ?? 4;
  let tier: WorldTier;
  if (qt === 'low' || qt === 'mid' || qt === 'high') tier = qt;
  else if (mem !== null && mem < 4) tier = 'low';
  else if (p.coarse) tier = 'mid';
  else tier = cores >= 8 && (mem === null || mem >= 8) ? 'high' : 'mid';
  if (forced === '0' || !p.webgl2) return { stage: '2d', tier, forced: forced === '0' };
  if (forced === '1') return { stage: '3d', tier, forced: true };
  if (tier === 'low' || p.saveData) return { stage: '2d', tier, forced: false };
  return { stage: '3d', tier, forced: false };
}

export function probeWorld(): WorldProbe {
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  let webgl2 = false;
  try {
    webgl2 = !!document.createElement('canvas').getContext('webgl2');
  } catch {
    webgl2 = false;
  }
  return {
    webgl2,
    coarse: typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches,
    deviceMemory: nav.deviceMemory,
    hardwareConcurrency: nav.hardwareConcurrency,
    search: location.search,
    saveData: nav.connection?.saveData
  };
}

/** What the world shows for each phase of the order. */
export interface WorldCue {
  goalKo: string;
  targetEn?: string;
  paused: boolean;
  scene: 'plaza' | 'honey_cafe';
}

export function worldCueFor(phase: TryPhase, goals: Record<TryPhase, string>, targetEn?: string): WorldCue {
  const outside = phase === 'start' || phase === 'walk';
  return {
    goalKo: goals[phase],
    targetEn: phase === 'speak' ? targetEn : undefined,
    // The child moves only while walking; from the greeting on, the world holds the two-shot with the owner.
    paused: phase !== 'walk',
    scene: outside ? 'plaza' : 'honey_cafe'
  };
}

export interface TryWorldStageProps {
  tier: WorldTier;
  label: string;
  onStatus: (s: TryWorldStatus) => void;
  onWorld: (w: WorldHandle | null) => void;
}

/** Canvas + HUD host. Creates the world once and disposes it on unmount. */
export function TryWorldStage({ tier, label, onStatus, onWorld }: TryWorldStageProps): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hudRef = useRef<HTMLDivElement | null>(null);
  const cbs = useRef({ onStatus, onWorld });
  cbs.current = { onStatus, onWorld };

  useEffect(() => {
    let alive = true;
    let handle: WorldHandle | null = null;
    cbs.current.onStatus('loading');
    const timer = setTimeout(() => {
      if (alive && !handle) {
        alive = false;
        cbs.current.onStatus('failed');
      }
    }, TRY_WORLD_LOAD_MS);
    (async () => {
      try {
        const api = await import('../../../client/src/world/api.js');
        if (!alive || !canvasRef.current) return;
        const w = await api.createWorld({ canvas: canvasRef.current, tier, startScene: 'plaza', hudRoot: hudRef.current ?? undefined });
        if (!alive) {
          w.dispose();
          return;
        }
        handle = w;
        clearTimeout(timer);
        cbs.current.onWorld(w);
        cbs.current.onStatus('ready');
      } catch {
        if (alive) {
          alive = false;
          clearTimeout(timer);
          cbs.current.onStatus('failed');
        }
      }
    })();
    return () => {
      alive = false;
      clearTimeout(timer);
      cbs.current.onWorld(null);
      handle?.dispose();
    };
  }, [tier]);

  return (
    <div className="s-world" data-testid="try-world">
      <canvas ref={canvasRef} className="s-world-canvas" aria-label={label} role="img" />
      <div ref={hudRef} className="s-world-hud" />
    </div>
  );
}
