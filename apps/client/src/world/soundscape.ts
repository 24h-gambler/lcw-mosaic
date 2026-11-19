/**
 * The town's soundscape (R2627 "소리도", docs/12 8장 공간감): sounds that come from places, heard from where the child
 * stands and looks.
 *
 *  - beds: the wind over the town (no position; muffled and quieter indoors), the plaza fountain (a loop at the
 *    fountain), the cafe (cups) and the trade shop (coins, a creaking floor) from inside their rooms;
 *  - life: birds in the trees by day, crickets in the grass at night, the windmill creaking on its hill;
 *  - the shop bell when the child walks into a store;
 *  - footsteps per material (sound-synth.ts), with a short room reverb indoors on the high tier.
 *
 * Space (docs/12 8): each source is a PannerNode, HRTF on the high tier (headphones on a PC), equal-power panning
 * otherwise; full level up to 2 m, silent at 32 m (linear). A wall between the source and the listener (one ray
 * through the blocks, re-checked 4 times a second) closes a low-pass down to 900 Hz. Inside (a store, or a roof over
 * the head) the wind is muffled and, on the high tier, effects get a short room reverb.
 *
 * Every sound is synthesized in code (sound-synth.ts); buffers are built one per tick after the audio unlocks, so the
 * first tap never stalls. Pure decisions (inside?, occluded?, which bed) are exported for tests.
 */
import type * as THREE from 'three';
import type { VoxelWorld } from '@lcw/sim-core';
import { isOpaqueCube } from './blocks.js';
import { STORES } from './storefront.js';
import {
  STEP_MATERIALS,
  STEP_VARIANTS,
  birdCall,
  coinClink,
  cricketChirp,
  cupClink,
  footstep,
  fountainLoop,
  roomImpulse,
  shopBell,
  windLoop,
  woodCreak,
  type StepMaterial
} from './sound-synth.js';

/** docs/12 8장: full level to 2 m, nothing at 32 m */
export const REF_DISTANCE = 2;
export const MAX_DISTANCE = 32;
/** low-pass when a wall is between (Hz) */
export const OCCLUDED_HZ = 900;

export const FOUNTAIN = { x: 144, y: 2.6, z: 144 } as const;

/** Is the point inside a store's room (walls excluded)? Returns the store id. */
export function storeAt(x: number, y: number, z: number): string | null {
  for (const s of STORES) {
    const b = s.box;
    if (x > b.x0 + 1 && x < b.x1 && z > b.z0 + 1 && z < b.z1 && y < b.y1 + 1) return s.id;
  }
  return null;
}

/** Inside: in a store, or a solid block within 8 above the head (a roof, a tunnel). */
export function isIndoors(world: Pick<VoxelWorld, 'getBlock'>, x: number, y: number, z: number): boolean {
  if (storeAt(x, y, z)) return true;
  const bx = Math.floor(x);
  const bz = Math.floor(z);
  for (let k = Math.floor(y) + 2; k <= Math.floor(y) + 9; k++) if (isOpaqueCube(world.getBlock(bx, k, bz))) return true;
  return false;
}

/** Counts opaque blocks on the straight line between two points (Amanatides-Woo walk; the end cells excluded). */
export function wallsBetween(world: Pick<VoxelWorld, 'getBlock'>, a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }, cap = 3): number {
  let x = Math.floor(a.x);
  let y = Math.floor(a.y);
  let z = Math.floor(a.z);
  const ex = Math.floor(b.x);
  const ey = Math.floor(b.y);
  const ez = Math.floor(b.z);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  const sz = Math.sign(dz);
  const tdx = sx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tdy = sy !== 0 ? Math.abs(1 / dy) : Infinity;
  const tdz = sz !== 0 ? Math.abs(1 / dz) : Infinity;
  let tmx = sx > 0 ? (x + 1 - a.x) * tdx : sx < 0 ? (a.x - x) * tdx : Infinity;
  let tmy = sy > 0 ? (y + 1 - a.y) * tdy : sy < 0 ? (a.y - y) * tdy : Infinity;
  let tmz = sz > 0 ? (z + 1 - a.z) * tdz : sz < 0 ? (a.z - z) * tdz : Infinity;
  let n = 0;
  for (let i = 0; i < 128; i++) {
    if (tmx < tmy && tmx < tmz) {
      x += sx;
      tmx += tdx;
    } else if (tmy < tmz) {
      y += sy;
      tmy += tdy;
    } else {
      z += sz;
      tmz += tdz;
    }
    if (x === ex && y === ey && z === ez) break;
    if (isOpaqueCube(world.getBlock(x, y, z)) && ++n >= cap) break;
  }
  return n;
}

/** 0 by day .. 1 at night (hour 0..24): birds before dusk, crickets after. */
export function nightness(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  if (h >= 7 && h <= 18) return 0;
  if (h >= 20 || h <= 5) return 1;
  return h < 7 ? (7 - h) / 2 : (h - 18) / 2;
}

interface Emitter {
  pos: { x: number; y: number; z: number };
  panner: PannerNode;
  lp: BiquadFilterNode;
  gain: GainNode;
  /** reverb send (interior sources) */
  send?: GainNode;
}

type Buffers = {
  steps: Map<StepMaterial, AudioBuffer[]>;
  fountain?: AudioBuffer;
  wind?: AudioBuffer;
  birds: AudioBuffer[];
  crickets: AudioBuffer[];
  cups: AudioBuffer[];
  coins: AudioBuffer[];
  creaks: AudioBuffer[];
  millCreaks: AudioBuffer[];
  bell?: AudioBuffer;
  room?: AudioBuffer;
};

export interface SoundscapeOutputs {
  /** effects bus input (footsteps, bell, birds, emitters) */
  sfx: AudioNode;
  /** ambience bus input (wind) */
  amb: AudioNode;
}

export class Soundscape {
  private ctx: AudioContext | null = null;
  private out: SoundscapeOutputs | null = null;
  private readonly buf: Buffers = { steps: new Map(), birds: [], crickets: [], cups: [], coins: [], creaks: [], millCreaks: [] };
  private building = false;
  private readonly emitters: Emitter[] = [];
  private fountain: Emitter | null = null;
  private cafe: Emitter | null = null;
  private shop: Emitter | null = null;
  private mill: Emitter | null = null;
  private windGain: GainNode | null = null;
  private windLp: BiquadFilterNode | null = null;
  private reverb: ConvolverNode | null = null;
  private reverbIn: GainNode | null = null;
  private stepOut: GainNode | null = null;
  private stepSend: GainNode | null = null;
  private readonly loops: AudioBufferSourceNode[] = [];
  private occAt = 0;
  private indoor = false;
  private inStore: string | null = null;
  private storeKnown = false;
  private nextBird = 3;
  private nextCricket = 1;
  private nextCup = 4;
  private nextCoin = 6;
  private nextCreak = 9;
  private nextMill = 5;
  private t = 0;
  private stepVar = 0;
  private readonly listener = { x: 0, y: 0, z: 0 };
  private rnd = 0x9e3779b9;
  private disposed = false;

  constructor(
    private readonly world: Pick<VoxelWorld, 'getBlock'>,
    private readonly opts: { hrtf: boolean; reverb: boolean; mill?: { x: number; y: number; z: number } }
  ) {}

  private random(): number {
    this.rnd = (Math.imul(this.rnd ^ (this.rnd >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0;
    return this.rnd / 4294967296;
  }

  /** Call once the audio context exists (after the first tap). Builds the graph and the sounds, one per tick. */
  start(ctx: AudioContext, out: SoundscapeOutputs): void {
    if (this.ctx || this.disposed) return;
    this.ctx = ctx;
    this.out = out;
    this.stepOut = ctx.createGain();
    this.stepOut.connect(out.sfx);
    if (this.opts.reverb) {
      this.reverbIn = ctx.createGain();
      this.reverbIn.gain.value = 0;
      this.reverb = ctx.createConvolver();
      this.reverbIn.connect(this.reverb).connect(out.sfx);
      this.stepSend = ctx.createGain();
      this.stepSend.gain.value = 0.35;
      this.stepOut.connect(this.stepSend).connect(this.reverbIn);
    }
    this.windLp = ctx.createBiquadFilter();
    this.windLp.type = 'lowpass';
    this.windLp.frequency.value = 18000;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.windLp.connect(this.windGain).connect(out.amb);
    this.fountain = this.emitter(FOUNTAIN, 0.9);
    const cafe = STORES.find((s) => s.id === 'honey_cafe')!.box;
    const shop = STORES.find((s) => s.id === 'trade_shop')!.box;
    this.cafe = this.emitter({ x: (cafe.x0 + cafe.x1) / 2 + 0.5, y: 2.2, z: (cafe.z0 + cafe.z1) / 2 + 0.5 }, 0.9, true);
    this.shop = this.emitter({ x: (shop.x0 + shop.x1) / 2 + 0.5, y: 2.2, z: (shop.z0 + shop.z1) / 2 + 0.5 }, 0.9, true);
    if (this.opts.mill) this.mill = this.emitter(this.opts.mill, 1);
    this.buildSteps();
  }

  private emitter(pos: { x: number; y: number; z: number }, level: number, interior = false): Emitter | null {
    const ctx = this.ctx;
    if (!ctx || !this.out) return null;
    const panner = ctx.createPanner();
    panner.panningModel = this.opts.hrtf ? 'HRTF' : 'equalpower';
    panner.distanceModel = 'linear';
    panner.refDistance = REF_DISTANCE;
    panner.maxDistance = MAX_DISTANCE;
    panner.rolloffFactor = 1;
    setParam(panner.positionX, pos.x, () => panner.setPosition(pos.x, pos.y, pos.z));
    setParam(panner.positionY, pos.y);
    setParam(panner.positionZ, pos.z);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 18000;
    const gain = ctx.createGain();
    gain.gain.value = level;
    gain.connect(lp).connect(panner).connect(this.out.sfx);
    const e: Emitter = { pos, panner, lp, gain };
    if (interior && this.reverbIn) {
      e.send = ctx.createGain();
      e.send.gain.value = 0.5;
      gain.connect(e.send).connect(this.reverbIn);
    }
    this.emitters.push(e);
    return e;
  }

  /** Builds the sounds one per tick (a few ms each on a phone) so the first tap never stalls. */
  private buildSteps(): void {
    if (this.building || !this.ctx) return;
    this.building = true;
    const ctx = this.ctx;
    const sr = ctx.sampleRate;
    const mk = (x: Float32Array): AudioBuffer => {
      const b = ctx.createBuffer(1, x.length, sr);
      b.getChannelData(0).set(x);
      return b;
    };
    const jobs: (() => void)[] = [];
    for (const m of STEP_MATERIALS) {
      jobs.push(() => {
        const list: AudioBuffer[] = [];
        for (let v = 0; v < STEP_VARIANTS; v++) list.push(mk(footstep(m, v, sr)));
        this.buf.steps.set(m, list);
      });
    }
    jobs.push(() => {
      this.buf.wind = mk(windLoop(sr));
      this.startWind();
    });
    jobs.push(() => {
      this.buf.fountain = mk(fountainLoop(sr));
      this.startLoop(this.fountain, this.buf.fountain);
    });
    jobs.push(() => {
      for (let v = 0; v < 4; v++) this.buf.birds.push(mk(birdCall(v, sr)));
      for (let v = 0; v < 3; v++) this.buf.crickets.push(mk(cricketChirp(v, sr)));
    });
    jobs.push(() => {
      for (let v = 0; v < 3; v++) this.buf.cups.push(mk(cupClink(v, sr)));
      for (let v = 0; v < 3; v++) this.buf.coins.push(mk(coinClink(v, sr)));
    });
    jobs.push(() => {
      for (let v = 0; v < 3; v++) this.buf.creaks.push(mk(woodCreak(v, sr)));
      for (let v = 0; v < 2; v++) this.buf.millCreaks.push(mk(woodCreak(v, sr, true)));
      this.buf.bell = mk(shopBell(sr));
    });
    if (this.reverb) {
      jobs.push(() => {
        const [l, r] = roomImpulse(sr);
        const b = ctx.createBuffer(2, l.length, sr);
        b.getChannelData(0).set(l);
        b.getChannelData(1).set(r);
        this.buf.room = b;
        this.reverb!.buffer = b;
      });
    }
    const next = (): void => {
      if (this.disposed) return;
      const job = jobs.shift();
      if (!job) return;
      try {
        job();
      } catch {
        // a sound that fails to build stays silent; the game does not depend on it
      }
      setTimeout(next, 16);
    };
    setTimeout(next, 0);
  }

  private startWind(): void {
    const ctx = this.ctx;
    if (!ctx || !this.buf.wind || !this.windLp) return;
    const src = ctx.createBufferSource();
    src.buffer = this.buf.wind;
    src.loop = true;
    src.connect(this.windLp);
    src.start();
    this.loops.push(src);
  }

  private startLoop(e: Emitter | null, b: AudioBuffer | undefined): void {
    if (!this.ctx || !e || !b) return;
    const src = this.ctx.createBufferSource();
    src.buffer = b;
    src.loop = true;
    src.connect(e.gain);
    src.start(this.ctx.currentTime, this.random() * b.duration);
    this.loops.push(src);
  }

  /** A one-shot through an emitter, or at a point (its own short-lived panner). */
  private shot(b: AudioBuffer | undefined, at: Emitter | { x: number; y: number; z: number } | null, level = 1, rate = 1): void {
    const ctx = this.ctx;
    if (!ctx || !b || !at || !this.out) return;
    const src = ctx.createBufferSource();
    src.buffer = b;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = level;
    src.connect(g);
    if ('panner' in at) g.connect(at.gain);
    else {
      const p = ctx.createPanner();
      p.panningModel = this.opts.hrtf ? 'HRTF' : 'equalpower';
      p.distanceModel = 'linear';
      p.refDistance = REF_DISTANCE;
      p.maxDistance = MAX_DISTANCE;
      setParam(p.positionX, at.x, () => p.setPosition(at.x, at.y, at.z));
      setParam(p.positionY, at.y);
      setParam(p.positionZ, at.z);
      g.connect(p).connect(this.out.sfx);
      src.onended = () => {
        try {
          p.disconnect();
        } catch {
          // gone
        }
      };
    }
    src.start();
  }

  /** A footstep on `material` (`step.<material>`); false when the sounds are not built yet (the caller falls back). */
  step(material: string, pitchSemi = 0): boolean {
    const list = this.buf.steps.get(material as StepMaterial) ?? this.buf.steps.get('stone');
    if (!this.ctx || !list || !this.stepOut) return false;
    this.stepVar = (this.stepVar + 1 + Math.floor(this.random() * (STEP_VARIANTS - 1))) % STEP_VARIANTS;
    const src = this.ctx.createBufferSource();
    src.buffer = list[this.stepVar]!;
    src.playbackRate.value = Math.pow(2, pitchSemi / 12);
    const g = this.ctx.createGain();
    g.gain.value = 0.85 + this.random() * 0.15;
    src.connect(g).connect(this.stepOut);
    src.start();
    return true;
  }

  /**
   * Every frame: the listener follows the camera; beds follow inside/outside, the hour and walls; life sounds spawn
   * around the listener. `paused` (a dialog) holds the life sounds.
   */
  update(dt: number, camera: THREE.Camera, hour: number, paused: boolean): void {
    const ctx = this.ctx;
    if (!ctx || this.disposed) return;
    this.t += dt;
    const p = camera.position;
    this.listener.x = p.x;
    this.listener.y = p.y;
    this.listener.z = p.z;
    const L = ctx.listener;
    const e = camera.matrixWorld.elements;
    // camera looks down its -z; up is +y
    const fx = -e[8]!;
    const fy = -e[9]!;
    const fz = -e[10]!;
    const ux = e[4]!;
    const uy = e[5]!;
    const uz = e[6]!;
    if (L.positionX) {
      L.positionX.value = p.x;
      L.positionY.value = p.y;
      L.positionZ.value = p.z;
      L.forwardX.value = fx;
      L.forwardY.value = fy;
      L.forwardZ.value = fz;
      L.upX.value = ux;
      L.upY.value = uy;
      L.upZ.value = uz;
    } else {
      L.setPosition(p.x, p.y, p.z);
      L.setOrientation(fx, fy, fz, ux, uy, uz);
    }
    const now = ctx.currentTime;
    // inside / outside, walls: 4 times a second
    if (this.t - this.occAt > 0.25) {
      this.occAt = this.t;
      const feet = p.y - 1.5;
      this.indoor = isIndoors(this.world, p.x, feet, p.z);
      const store = storeAt(p.x, feet, p.z);
      if (this.storeKnown && store && store !== this.inStore) this.shot(this.buf.bell, { x: p.x, y: p.y + 0.8, z: p.z }, 0.8);
      this.inStore = store;
      this.storeKnown = true;
      for (const em of this.emitters) {
        const d = Math.hypot(em.pos.x - p.x, em.pos.y - p.y, em.pos.z - p.z);
        const walls = d < MAX_DISTANCE ? wallsBetween(this.world, p, em.pos) : 0;
        em.lp.frequency.setTargetAtTime(walls > 0 ? OCCLUDED_HZ / walls : 18000, now, 0.08);
      }
      if (this.windGain && this.windLp) {
        this.windGain.gain.setTargetAtTime(this.indoor ? 0.35 : 1, now, 0.4);
        this.windLp.frequency.setTargetAtTime(this.indoor ? 320 : 18000, now, 0.3);
      }
      if (this.reverbIn) this.reverbIn.gain.setTargetAtTime(this.indoor ? 1 : 0, now, 0.2);
    }
    if (paused) return;
    const night = nightness(hour);
    // birds by day, in the trees around (not indoors)
    this.nextBird -= dt;
    if (this.nextBird <= 0) {
      this.nextBird = 2 + this.random() * 5;
      if (!this.indoor && night < 0.6 && this.buf.birds.length) {
        const a = this.random() * Math.PI * 2;
        const r = 9 + this.random() * 16;
        this.shot(this.buf.birds[Math.floor(this.random() * this.buf.birds.length)], { x: p.x + Math.cos(a) * r, y: p.y + 4 + this.random() * 4, z: p.z + Math.sin(a) * r }, 0.7 * (1 - night), 0.9 + this.random() * 0.2);
      }
    }
    // crickets at night, in the grass
    this.nextCricket -= dt;
    if (this.nextCricket <= 0) {
      this.nextCricket = 0.35 + this.random() * 1.2;
      if (night > 0.3 && this.buf.crickets.length) {
        const a = this.random() * Math.PI * 2;
        const r = 5 + this.random() * 14;
        this.shot(this.buf.crickets[Math.floor(this.random() * this.buf.crickets.length)], { x: p.x + Math.cos(a) * r, y: p.y - 1.4, z: p.z + Math.sin(a) * r }, 0.6 * night * (this.indoor ? 0.4 : 1), 0.97 + this.random() * 0.06);
      }
    }
    // the cafe and the shop, heard from inside (and through the door)
    this.nextCup -= dt;
    if (this.nextCup <= 0) {
      this.nextCup = 2.5 + this.random() * 5;
      this.shot(this.buf.cups[Math.floor(this.random() * this.buf.cups.length)], this.cafe, 0.8, 0.95 + this.random() * 0.1);
    }
    this.nextCoin -= dt;
    if (this.nextCoin <= 0) {
      this.nextCoin = 5 + this.random() * 7;
      this.shot(this.buf.coins[Math.floor(this.random() * this.buf.coins.length)], this.shop, 0.7, 0.95 + this.random() * 0.1);
    }
    this.nextCreak -= dt;
    if (this.nextCreak <= 0) {
      this.nextCreak = 6 + this.random() * 9;
      this.shot(this.buf.creaks[Math.floor(this.random() * this.buf.creaks.length)], this.shop, 0.6);
    }
    this.nextMill -= dt;
    if (this.nextMill <= 0) {
      this.nextMill = 3.5 + this.random() * 2;
      this.shot(this.buf.millCreaks[Math.floor(this.random() * this.buf.millCreaks.length)], this.mill, 0.9, 0.9 + this.random() * 0.2);
    }
  }

  /** For checks: what the soundscape thinks right now. */
  state(): { started: boolean; built: number; indoor: boolean; store: string | null; emitters: number; panning: string } {
    return {
      started: !!this.ctx,
      built: this.buf.steps.size + (this.buf.wind ? 1 : 0) + (this.buf.fountain ? 1 : 0) + (this.buf.bell ? 1 : 0),
      indoor: this.indoor,
      store: this.inStore,
      emitters: this.emitters.length,
      panning: this.opts.hrtf ? 'HRTF' : 'equalpower'
    };
  }

  dispose(): void {
    this.disposed = true;
    for (const s of this.loops) {
      try {
        s.stop();
      } catch {
        // already stopped
      }
    }
    this.loops.length = 0;
    for (const e of this.emitters) {
      try {
        e.panner.disconnect();
      } catch {
        // gone
      }
    }
    this.emitters.length = 0;
    try {
      this.windGain?.disconnect();
      this.reverb?.disconnect();
      this.stepOut?.disconnect();
    } catch {
      // gone
    }
    this.ctx = null;
  }
}

/** AudioParam where the browser has it, else the old setter (Safari < 14.1). */
function setParam(p: AudioParam | undefined, v: number, fallback?: () => void): void {
  if (p) p.value = v;
  else fallback?.();
}
