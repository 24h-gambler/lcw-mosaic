/**
 * Device tiers (docs/08 6.6) and the dynamic-resolution governor that keeps the frame rate at the tier's target.
 * Kept free of three.js so the rules are fixed by unit tests.
 */
import type { WorldTier } from './api.js';

export interface TierSettings {
  /** horizontal view distance in chunks (docs/08 6.6: 4 / 6 / 8) */
  viewChunks: number;
  /** resolution scale on top of devicePixelRatio (0.75 / 1.0 / 1.0) */
  pixelScale: number;
  /** lowest scale the governor may drop to when frames are slow */
  minScale: number;
  /** sun shadows (only high; the others use blob shadows) */
  shadows: boolean;
  /** particle cap (200 / 400 / 600) */
  particles: number;
  /** MSAA costs fill rate on tablets; only the high tier pays for it */
  antialias: boolean;
  /** frame target the governor holds (30 / 60 / 60) */
  targetFps: number;
  /** block material: per-vertex `fast` shader, or `lit` (Lambert, receives sun shadows) */
  material: 'fast' | 'lit';
  /** drifting clouds (one instanced draw) */
  clouds: boolean;
}

export const TIER_SETTINGS: Readonly<Record<WorldTier, TierSettings>> = {
  low: { viewChunks: 4, pixelScale: 0.75, minScale: 0.5, shadows: false, particles: 200, antialias: false, targetFps: 30, material: 'fast', clouds: false },
  mid: { viewChunks: 6, pixelScale: 1.0, minScale: 0.6, shadows: false, particles: 400, antialias: false, targetFps: 60, material: 'fast', clouds: true },
  high: { viewChunks: 8, pixelScale: 1.0, minScale: 0.75, shadows: true, particles: 600, antialias: true, targetFps: 60, material: 'lit', clouds: true }
};

/**
 * Dynamic resolution: average frame time over ~1 s windows; too slow → scale down 10 %, comfortably fast → back up
 * 5 % (never above the tier scale, never below its floor). Returns the scale to apply.
 */
export class ResolutionGovernor {
  scale: number;
  private acc = 0;
  private frames = 0;
  constructor(private readonly t: Pick<TierSettings, 'pixelScale' | 'minScale' | 'targetFps'>, private readonly windowMs = 1000) {
    this.scale = t.pixelScale;
  }
  /** feed one frame's duration; returns true when the scale changed */
  frame(ms: number): boolean {
    this.acc += ms;
    this.frames++;
    if (this.acc < this.windowMs) return false;
    const avg = this.acc / this.frames;
    this.acc = 0;
    this.frames = 0;
    const budget = 1000 / this.t.targetFps;
    const before = this.scale;
    // Below 30 fps is never acceptable even when the target is 60 (WP-004 floor).
    if (avg > Math.min(budget * 1.15, 1000 / 30)) this.scale = Math.max(this.t.minScale, +(this.scale - 0.1).toFixed(2));
    else if (avg < budget * 0.75) this.scale = Math.min(this.t.pixelScale, +(this.scale + 0.05).toFixed(2));
    return this.scale !== before;
  }
}

/**
 * Last resort for a device that cannot carry 3D at all (docs/18: the lesson then moves to the /join word cards in the
 * same session). Fed one sample a second; trips once the world has stayed below `slowFps` for `slowS` seconds in a
 * row while the governor already sits at its resolution floor, after a warm-up. Once tripped it stays tripped.
 */
export class FrameFloorWatch {
  private seconds = 0;
  private slow = 0;
  tripped = false;
  constructor(private readonly opts: { warmupS: number; slowFps: number; slowS: number } = { warmupS: 15, slowFps: 12, slowS: 10 }) {}
  sample(fps: number, atFloor: boolean): boolean {
    if (this.tripped) return true;
    this.seconds++;
    if (this.seconds <= this.opts.warmupS) return false;
    this.slow = fps < this.opts.slowFps && atFloor ? this.slow + 1 : 0;
    if (this.slow >= this.opts.slowS) this.tripped = true;
    return this.tripped;
  }
}

/**
 * Quality 'auto' (G14 화면 설정): measures the device instead of guessing from its specs. Fed one sample a second
 * (fps, and whether the resolution governor already sits at its floor). After a warm-up (the ground is still being
 * meshed), a tier that stays below 85 % of its frame target at the resolution floor for `slowS` seconds steps down one
 * tier (high → mid → low); it never steps up (antialias cannot change on a live canvas, and flapping would be worse
 * than a slightly soft picture). `settled` is the tier after the first measuring window.
 */
export class AutoTierPicker {
  private seconds = 0;
  private slow = 0;
  settled: WorldTier | null = null;
  constructor(
    public tier: WorldTier,
    private readonly opts: { warmupS: number; measureS: number; slowS: number } = { warmupS: 4, measureS: 6, slowS: 5 }
  ) {}
  /** Returns the tier to switch to, or null to stay. */
  sample(fps: number, atFloor: boolean): WorldTier | null {
    this.seconds++;
    if (this.seconds <= this.opts.warmupS) return null;
    const target = TIER_SETTINGS[this.tier].targetFps;
    this.slow = fps < target * 0.85 && atFloor ? this.slow + 1 : 0;
    if (this.settled === null && this.seconds >= this.opts.warmupS + this.opts.measureS && this.slow === 0) this.settled = this.tier;
    if (this.slow < this.opts.slowS || this.tier === 'low') return null;
    this.slow = 0;
    this.tier = this.tier === 'high' ? 'mid' : 'low';
    // a fresh measuring window at the new tier
    this.seconds = this.opts.warmupS;
    this.settled = null;
    return this.tier;
  }
}

/** G14 values over a tier: what the world actually runs with (ranges as the settings screen offers them). */
export function graphicsFor(
  tier: WorldTier,
  g: { viewChunks: number | null; shadows: boolean | null; renderScale: number | null },
  canShadow: boolean
): { viewChunks: number; shadows: boolean; renderScale: number; minScale: number; targetFps: number; clouds: boolean } {
  const t = TIER_SETTINGS[tier];
  const viewChunks = g.viewChunks === null || !Number.isFinite(g.viewChunks) ? t.viewChunks : Math.max(3, Math.min(8, Math.round(g.viewChunks)));
  const renderScale = g.renderScale === null || !Number.isFinite(g.renderScale) ? t.pixelScale : Math.max(0.5, Math.min(1, g.renderScale));
  // shadows need the lit block material, which only a world started on high has
  const shadows = canShadow && (g.shadows ?? t.shadows);
  return { viewChunks, shadows, renderScale, minScale: Math.min(t.minScale, renderScale), targetFps: t.targetFps, clouds: t.clouds };
}

export type GpuClass = 'software' | 'integrated' | 'discrete' | 'unknown';

/**
 * What kind of GPU draws the page, from the WebGL renderer string. The CPU/memory guess alone put a 16-core desktop on
 * software GL at 'high' (docs/02 §11 measurement: 5.9 fps with shadows, 30 fps on mid).
 */
export function gpuClassOf(renderer: string | null | undefined): GpuClass {
  if (!renderer) return 'unknown';
  const r = renderer.toLowerCase();
  if (/swiftshader|llvmpipe|softpipe|software|basic render/.test(r)) return 'software';
  if (/nvidia|geforce|quadro|rtx|gtx|radeon rx|radeon pro|apple m\d|apple gpu/.test(r)) return 'discrete';
  if (/intel|uhd|iris|hd graphics|mali|adreno|powervr|vivante|radeon\(tm\) graphics|vega \d+ graphics|radeon graphics/.test(r)) return 'integrated';
  return 'unknown';
}

/** One throw-away context to read the renderer name (released at once). */
export function readGpuRenderer(): string | null {
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') ?? c.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return null;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return name || null;
  } catch {
    return null;
  }
}
