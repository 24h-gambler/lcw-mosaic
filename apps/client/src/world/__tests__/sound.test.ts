import { describe, expect, it } from 'vitest';
import { VoxelWorld } from '@lcw/sim-core';
import { buildTown } from '../town.js';
import {
  PEAK_SFX,
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
  woodCreak
} from '../sound-synth.js';
import { FOUNTAIN, MAX_DISTANCE, REF_DISTANCE, isIndoors, nightness, storeAt, wallsBetween } from '../soundscape.js';
import { STORES } from '../storefront.js';

const SR = 48000;

function peak(x: Float32Array): number {
  let m = 0;
  for (const v of x) m = Math.max(m, Math.abs(v));
  return m;
}
function rms(x: Float32Array, from = 0, to = x.length): number {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i]! * x[i]!;
  return Math.sqrt(s / Math.max(1, to - from));
}
/** Brightness: the share of energy in the sample-to-sample difference (a cheap spectral centroid stand-in, 0..2). */
function brightness(x: Float32Array): number {
  let d = 0;
  let e = 0;
  for (let i = 1; i < x.length; i++) {
    d += (x[i]! - x[i - 1]!) ** 2;
    e += x[i]! ** 2;
  }
  return Math.sqrt(d / e);
}
/** Seconds until the level falls 40 dB below the loudest 10 ms. */
function ringTime(x: Float32Array): number {
  const w = Math.floor(0.01 * SR);
  let top = 0;
  const lv: number[] = [];
  for (let i = 0; i + w <= x.length; i += w) {
    const r = rms(x, i, i + w);
    lv.push(r);
    top = Math.max(top, r);
  }
  let last = 0;
  lv.forEach((r, i) => {
    if (r > top * 0.01) last = i;
  });
  return ((last + 1) * w) / SR;
}

describe('sound synthesis (R2627, docs/12 4장·6.2·6.4)', () => {
  it('footsteps: every material and variant is built, peaks at or under -6 dBFS, never silent, no DC', () => {
    for (const m of STEP_MATERIALS) {
      for (let v = 0; v < STEP_VARIANTS; v++) {
        const x = footstep(m, v, SR);
        expect(peak(x), `${m}.${v}`).toBeLessThanOrEqual(PEAK_SFX + 1e-6);
        expect(peak(x), `${m}.${v}`).toBeGreaterThan(0.3);
        const mean = x.reduce((a, b) => a + b, 0) / x.length;
        expect(Math.abs(mean), `${m}.${v} DC`).toBeLessThan(0.01);
        // starts and ends at rest (no click)
        expect(Math.abs(x[0]!)).toBeLessThan(0.01);
        expect(Math.abs(x[x.length - 1]!)).toBeLessThan(0.01);
      }
    }
  });

  it('footsteps sound like their material: metal rings longest, cloth is dullest, sand and grass brighter than wood', () => {
    const b = (m: (typeof STEP_MATERIALS)[number]): number => brightness(footstep(m, 0, SR));
    const ring = (m: (typeof STEP_MATERIALS)[number]): number => ringTime(footstep(m, 0, SR));
    expect(ring('metal')).toBeGreaterThan(ring('stone'));
    expect(ring('metal')).toBeGreaterThan(ring('wood'));
    expect(b('cloth')).toBeLessThan(b('wood'));
    expect(b('cloth')).toBeLessThan(b('stone'));
    expect(b('sand')).toBeGreaterThan(b('wood'));
    expect(b('plant')).toBeGreaterThan(b('wood'));
  });

  it('variants differ (no machine-gun repeat) and the same variant is the same on every device', () => {
    const a = footstep('stone', 0, SR);
    const a2 = footstep('stone', 0, SR);
    const c = footstep('stone', 1, SR);
    expect(Array.from(a.slice(0, 2000))).toEqual(Array.from(a2.slice(0, 2000)));
    let diff = 0;
    for (let i = 0; i < Math.min(a.length, c.length); i++) diff += Math.abs(a[i]! - c[i]!);
    expect(diff).toBeGreaterThan(10);
  });

  it('loops are seamless: the jump from the last sample back to the first is no bigger than a normal step', () => {
    for (const [name, x] of [
      ['fountain', fountainLoop(SR)],
      ['wind', windLoop(SR)]
    ] as const) {
      let typical = 0;
      for (let i = 1; i < x.length; i++) typical = Math.max(typical, Math.abs(x[i]! - x[i - 1]!));
      const jump = Math.abs(x[0]! - x[x.length - 1]!);
      expect(jump, name).toBeLessThanOrEqual(typical);
      expect(rms(x), name).toBeGreaterThan(0.03);
      expect(peak(x), name).toBeLessThanOrEqual(0.35 + 1e-6);
    }
  });

  it('the fountain is water (energy across low and high bands), the wind is low and dark', () => {
    expect(brightness(fountainLoop(SR))).toBeGreaterThan(brightness(windLoop(SR)) * 2);
  });

  it('life and places: birds, crickets, cups, coins, the bell and creaks are built at their levels', () => {
    for (let v = 0; v < 4; v++) expect(peak(birdCall(v, SR))).toBeCloseTo(0.25, 3);
    for (let v = 0; v < 3; v++) expect(peak(cricketChirp(v, SR))).toBeCloseTo(0.12, 3);
    expect(peak(cupClink(0, SR))).toBeCloseTo(0.3, 3);
    expect(peak(coinClink(0, SR))).toBeCloseTo(0.3, 3);
    const bell = shopBell(SR);
    expect(peak(bell)).toBeCloseTo(0.35, 3);
    // a bell rings on for most of a second
    expect(ringTime(bell)).toBeGreaterThan(0.7);
    expect(ringTime(woodCreak(0, SR, true))).toBeGreaterThan(0.2);
    const [l, r] = roomImpulse(SR);
    expect(l.length).toBe(r.length);
    expect(ringTime(l)).toBeLessThan(0.6);
  });
});

describe('soundscape decisions (docs/12 8장)', () => {
  const world = new VoxelWorld();
  buildTown(world);

  it('distance follows the spec: full to 2 m, silent at 32 m', () => {
    expect(REF_DISTANCE).toBe(2);
    expect(MAX_DISTANCE).toBe(32);
  });

  it('inside a store and under a roof count as indoors; the plaza and the street do not', () => {
    for (const s of STORES) {
      const cx = (s.box.x0 + s.box.x1) / 2 + 0.5;
      const cz = (s.box.z0 + s.box.z1) / 2 + 0.5;
      expect(storeAt(cx, 1, cz)).toBe(s.id);
      expect(isIndoors(world, cx, 1, cz)).toBe(true);
    }
    expect(isIndoors(world, 150.5, 1, 150.5)).toBe(false);
    expect(storeAt(150.5, 1, 150.5)).toBeNull();
    // standing at a store's door outside is not inside
    for (const s of STORES) expect(storeAt(s.door.x + (s.id === 'honey_cafe' ? -1 : 1), 1, s.door.z)).toBeNull();
  });

  it('a wall between the listener and a store muffles it; the open plaza does not', () => {
    const cafe = STORES.find((s) => s.id === 'honey_cafe')!;
    const inside = { x: (cafe.box.x0 + cafe.box.x1) / 2 + 0.5, y: 2.2, z: (cafe.box.z0 + cafe.box.z1) / 2 + 0.5 };
    // behind the cafe's back wall (outside, +x)
    expect(wallsBetween(world, { x: cafe.box.x1 + 3.5, y: 2.6, z: inside.z }, inside)).toBeGreaterThan(0);
    // across the open plaza to the fountain's top
    expect(wallsBetween(world, { x: 144.5, y: 2.6, z: 152.5 }, { x: FOUNTAIN.x, y: 4.5, z: FOUNTAIN.z })).toBe(0);
  });

  it('birds by day, crickets by night, a short crossfade at dawn and dusk', () => {
    expect(nightness(12)).toBe(0);
    expect(nightness(22)).toBe(1);
    expect(nightness(2)).toBe(1);
    expect(nightness(19)).toBeCloseTo(0.5, 5);
    expect(nightness(6)).toBeCloseTo(0.5, 5);
  });
});
