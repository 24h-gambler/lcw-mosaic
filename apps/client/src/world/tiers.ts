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
 * Dynamic resolution: average frame time over ~1 s windows; too slow → scale down 10 %, fast enough → back up 5 %
 * (never above the tier scale, never below its floor). Returns the scale to apply.
 *
 * Measured on a Galaxy S7 in production (docs/02 §11): the frame time of a 60 Hz screen never goes under 16.7 ms, so
 * "comfortably fast" (< 75 % of the budget) was never seen there and the meshing hitches of the first seconds left the
 * picture at 0.6-0.8 for the whole session although full resolution also held 60 fps. Now:
 * - at the refresh rate (within 8 % of the budget) for 3 windows in a row the scale probes 5 % up again;
 * - a probe up that turns out too slow goes straight back to the scale that held and is not tried again for 60
 *   windows (no flapping on a GPU-bound device);
 * - a 30 Hz pace that resolution cannot lift (power saving, a ~30 fps headless browser) is recognised when frames
 *   stay steady at 30-35.5 ms across a step of resolution (down, or up from the floor): the scale goes back up and that frame time becomes
 *   the budget, so the tier is not stepped down for nothing (AutoTierPicker waits for the floor). Anything that gets
 *   faster, leaves the band or jitters is load: a device bound at 30-40 fps still reaches the floor and the tier
 *   steps down (review of #132).
 */
/** frame times of a 30 Hz pace (about 28-33 fps): the only band read as a cap that resolution cannot lift */
const CAP_MIN_MS = 30;
const CAP_MAX_MS = 35.5;
/** a pace is steady: the frame times of one window spread less than this (ms) */
const CAP_MAX_SD = 3;

export class ResolutionGovernor {
  scale: number;
  /** frame time of a cap that resolution does not lift (ms), or null */
  capMs: number | null = null;
  private acc = 0;
  private accSq = 0;
  private frames = 0;
  private atRate = 0;
  /** first slow window at a steady 30 Hz pace: the scale and frame time there */
  private pacedAt: { scale: number; avg: number } | null = null;
  /** windows before the next one-step-up test at the floor */
  private floorProbeWait = 0;
  private hold = 0;
  private ceiling = Infinity;
  private ceilingFor = 0;
  /** windows since this governor last stepped up (a step down right after it means that probe failed) */
  private sinceUp = Infinity;
  /** the scale before the last step up (a failed probe goes back to it) */
  private probeFrom: number | null = null;
  constructor(private readonly t: Pick<TierSettings, 'pixelScale' | 'minScale' | 'targetFps'>, private readonly windowMs = 1000) {
    this.scale = t.pixelScale;
  }
  /** feed one frame's duration; returns true when the scale changed */
  frame(ms: number): boolean {
    this.acc += ms;
    this.accSq += ms * ms;
    this.frames++;
    if (this.acc < this.windowMs) return false;
    const avg = this.acc / this.frames;
    const sd = Math.sqrt(Math.max(0, this.accSq / this.frames - avg * avg));
    this.acc = 0;
    this.accSq = 0;
    this.frames = 0;
    if (this.hold > 0) this.hold--;
    this.sinceUp++;
    if (this.ceilingFor > 0 && --this.ceilingFor === 0) this.ceiling = Infinity;
    const before = this.scale;
    // the cap went away (the screen left power saving): back to the tier's own budget
    if (this.capMs !== null && avg < this.capMs * 0.85) this.capMs = null;
    const budget = Math.max(1000 / this.t.targetFps, this.capMs ?? 0);
    // Below 30 fps is never acceptable even when the target is 60 (WP-004 floor).
    const slowMs = this.capMs !== null ? budget * 1.15 : Math.min(budget * 1.15, 1000 / 30);
    if (avg > slowMs) {
      this.atRate = 0;
      const canStep = this.scale > this.t.minScale + 0.001;
      // A 30 Hz pace (power saving, headless) holds frames steady at ~33 ms whatever the resolution. Once frames
      // stayed in that band, steady, across a resolution change of a step (0.1) either way, it is that pace, not
      // load. At the floor the test is one step up. Load (GPU- or CPU-bound at 30-40 fps) changes with resolution,
      // leaves the band or jitters, and goes on to the floor so the tier picker can step down (review of #132).
      const paced = avg >= CAP_MIN_MS && avg <= CAP_MAX_MS && sd < CAP_MAX_SD;
      if (this.floorProbeWait > 0) this.floorProbeWait--;
      if (!paced) this.pacedAt = null;
      else if (!this.pacedAt || Math.abs(avg - this.pacedAt.avg) > this.pacedAt.avg * 0.03) this.pacedAt = { scale: this.scale, avg };
      else if (Math.abs(this.pacedAt.scale - this.scale) >= 0.1 - 1e-9) {
        this.capMs = avg;
        this.scale = this.t.pixelScale;
        this.pacedAt = null;
        this.ceiling = Infinity;
        this.ceilingFor = 0;
        this.probeFrom = null;
        return this.scale !== before;
      } else if (!canStep && this.floorProbeWait === 0) {
        // at the floor already: try one step up; a pace stays the same, load gets slower (and comes back down)
        this.floorProbeWait = 30;
        this.scale = Math.min(this.t.pixelScale, +(this.scale + 0.1).toFixed(2));
        return this.scale !== before;
      }
      if (!canStep) return false;
      this.hold = 3;
      // our own probe up was too much: back to the scale that held, and do not try that one again for a while
      // (a load spike sets no ceiling)
      if (this.sinceUp <= 2 && this.probeFrom !== null) {
        this.ceiling = before;
        this.ceilingFor = 60;
        this.scale = this.probeFrom;
        this.probeFrom = null;
        return this.scale !== before;
      }
      this.scale = Math.max(this.t.minScale, +(this.scale - 0.1).toFixed(2));
      return this.scale !== before;
    }
    this.pacedAt = null;
    const fast = avg < budget * 0.75;
    this.atRate = avg <= budget * 1.08 ? this.atRate + 1 : 0;
    if (this.hold === 0 && (fast || this.atRate >= 3)) {
      const up = Math.min(this.t.pixelScale, +(this.scale + 0.05).toFixed(2));
      // clear headroom (under 75 % of the budget) always climbs; a probe at the refresh rate stays under the ceiling
      if (up > this.scale && (fast || up < this.ceiling - 0.001)) {
        this.probeFrom = this.scale;
        this.scale = up;
        this.atRate = 0;
        this.sinceUp = 0;
      }
    }
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
  // shadows need the lit block material; the engine swaps it in on a tier change (canShadow false = a caller without it)
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
