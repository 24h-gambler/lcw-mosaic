// LCW look and performance rules (WP-004, docs/08 6.1/6.2/6.6): tier budgets, the resolution governor, region
// merging, the toy bevel table, the face sheet, and the town builder shared through sim-core.
import { describe, expect, it } from 'vitest';
import { VoxelWorld, buildTown as simBuildTown, BK as SIM_BK } from '@lcw/sim-core';
import { BLOCK_PALETTE } from '@lcw/content';
import { TIER_SETTINGS, ResolutionGovernor } from '../tiers.js';
import { REGION, mergeGeo } from '../chunks.js';
import { tileBevel, TILE_PX } from '../atlas.js';
import { TILE_NAMES, BK, type TileName } from '../blocks.js';
import { faceCell } from '../character.js';
import { buildTown } from '../town.js';
import type { GeoBuffers } from '../mesher.js';

describe('device tiers (docs/08 6.6)', () => {
  it('low never costs more than mid, mid never more than high', () => {
    const { low, mid, high } = TIER_SETTINGS;
    expect(low.viewChunks).toBeLessThan(mid.viewChunks);
    expect(mid.viewChunks).toBeLessThan(high.viewChunks);
    expect(low.pixelScale).toBeLessThan(mid.pixelScale);
    expect(low.minScale).toBeLessThanOrEqual(mid.minScale);
    expect(low.particles).toBeLessThan(mid.particles);
    expect(mid.particles).toBeLessThan(high.particles);
  });

  it('only the high tier pays for sun shadows, MSAA and the lit material', () => {
    expect(TIER_SETTINGS.low.shadows).toBe(false);
    expect(TIER_SETTINGS.mid.shadows).toBe(false);
    expect(TIER_SETTINGS.high.shadows).toBe(true);
    expect(TIER_SETTINGS.low.antialias || TIER_SETTINGS.mid.antialias).toBe(false);
    expect(TIER_SETTINGS.low.material).toBe('fast');
    expect(TIER_SETTINGS.mid.material).toBe('fast');
    expect(TIER_SETTINGS.low.clouds).toBe(false);
    expect(TIER_SETTINGS.low.targetFps).toBe(30);
  });
});

describe('resolution governor', () => {
  const feed = (g: ResolutionGovernor, ms: number, seconds: number): void => {
    for (let t = 0; t < seconds * 1000; t += ms) g.frame(ms);
  };

  it('drops 10 % per slow second down to the tier floor and stops there', () => {
    const g = new ResolutionGovernor(TIER_SETTINGS.mid);
    expect(g.scale).toBe(1);
    feed(g, 40, 1.05);
    expect(g.scale).toBe(0.9);
    feed(g, 40, 10);
    expect(g.scale).toBe(TIER_SETTINGS.mid.minScale);
  });

  it('climbs back 5 % per fast second, never above the tier scale', () => {
    const g = new ResolutionGovernor(TIER_SETTINGS.low);
    feed(g, 50, 6);
    expect(g.scale).toBe(TIER_SETTINGS.low.minScale);
    feed(g, 10, 20);
    expect(g.scale).toBe(TIER_SETTINGS.low.pixelScale);
  });

  it('holds the scale while the frame time sits inside the target band', () => {
    const g = new ResolutionGovernor(TIER_SETTINGS.low); // 30 fps target: 33 ms budget
    feed(g, 30, 5);
    expect(g.scale).toBe(TIER_SETTINGS.low.pixelScale);
  });

  it('a 60 Hz screen gets full resolution back after the start-up hitches (S7: stuck at 0.6-0.8 before)', () => {
    const g = new ResolutionGovernor(TIER_SETTINGS.mid);
    feed(g, 40, 3.1); // meshing the ground
    expect(g.scale).toBeLessThanOrEqual(0.7);
    feed(g, 1000 / 60, 40); // vsync-locked: never under 75 % of the budget
    expect(g.scale).toBe(TIER_SETTINGS.mid.pixelScale);
    expect(g.capMs).toBeNull();
  });

  it('a GPU-bound device settles just under the scale that was too slow instead of flapping', () => {
    const g = new ResolutionGovernor(TIER_SETTINGS.mid);
    // full resolution costs 24 ms (41 fps); 0.85 and below keep up with 60 Hz
    let downs = 0;
    for (let t = 0; t < 120_000; ) {
      const ms = Math.max(1000 / 60, 24 * g.scale * g.scale);
      const before = g.scale;
      g.frame(ms);
      if (g.scale < before) downs++;
      t += ms;
    }
    expect(g.scale).toBeGreaterThanOrEqual(0.8);
    expect(g.scale).toBeLessThanOrEqual(0.85);
    expect(downs).toBeLessThanOrEqual(6);
  });

  it('a 30 Hz cap that resolution cannot lift keeps full resolution and becomes the budget', () => {
    const g = new ResolutionGovernor(TIER_SETTINGS.mid);
    feed(g, 33.4, 3.1);
    expect(g.capMs).toBeCloseTo(33.4, 0);
    expect(g.scale).toBe(TIER_SETTINGS.mid.pixelScale);
    feed(g, 33.4, 30);
    expect(g.scale).toBe(TIER_SETTINGS.mid.pixelScale); // not at the floor: the tier picker does not step down
    // the cap goes away (power saving off): the tier budget is back
    feed(g, 1000 / 60, 2.1);
    expect(g.capMs).toBeNull();
  });

  it('a ~32 fps headless pace is found even when start-up hitches already pushed the scale to the floor', () => {
    const g = new ResolutionGovernor(TIER_SETTINGS.high); // floor 0.75
    feed(g, 40, 3.1);
    expect(g.scale).toBe(TIER_SETTINGS.high.minScale);
    feed(g, 31.3, 6);
    expect(g.capMs).toBeCloseTo(31.3, 0);
    expect(g.scale).toBe(TIER_SETTINGS.high.pixelScale);
  });

  it('a device bound at 35-40 fps (CPU or GPU) still reaches the floor so the tier can step down', () => {
    // CPU-bound: the same 25 ms whatever the resolution
    const cpu = new ResolutionGovernor(TIER_SETTINGS.high);
    feed(cpu, 25, 30);
    expect(cpu.capMs).toBeNull();
    expect(cpu.scale).toBe(TIER_SETTINGS.high.minScale);
    // GPU-bound, still 40 fps at the floor (45 ms x scale^2): no cap guess either, and it stays at the floor
    const gpu = new ResolutionGovernor(TIER_SETTINGS.high);
    let atFloor = 0;
    for (let t = 0; t < 60_000; ) {
      const ms = 45 * gpu.scale * gpu.scale;
      gpu.frame(ms);
      t += ms;
      if (t > 20_000 && gpu.scale <= TIER_SETTINGS.high.minScale) atFloor += ms;
    }
    expect(gpu.capMs).toBeNull();
    expect(atFloor).toBeGreaterThan(39_000);
  });

  it('a failed probe goes back to the scale that held (no slide below it)', () => {
    const g = new ResolutionGovernor(TIER_SETTINGS.mid);
    const seen = new Set<number>();
    let changes = 0;
    for (let t = 0; t < 200_000; ) {
      const ms = Math.max(1000 / 60, 22 * g.scale * g.scale); // 0.85 keeps 60 Hz, 0.9 does not quite
      const before = g.scale;
      g.frame(ms);
      if (g.scale !== before) changes++;
      if (t > 30_000) seen.add(g.scale);
      t += ms;
    }
    expect(Math.min(...seen)).toBeGreaterThanOrEqual(0.85);
    expect(changes).toBeLessThanOrEqual(14);
  });

  it('a device under 29 fps still goes down to the floor (no cap guess there)', () => {
    const g = new ResolutionGovernor(TIER_SETTINGS.mid);
    feed(g, 36, 10);
    expect(g.capMs).toBeNull();
    expect(g.scale).toBe(TIER_SETTINGS.mid.minScale);
  });

  it('a 60 fps tier still treats anything under 30 fps as too slow', () => {
    const g = new ResolutionGovernor(TIER_SETTINGS.mid);
    feed(g, 21, 1.05); // 47 fps: over 60 fps budget x 1.15
    expect(g.scale).toBeLessThan(1);
  });
});

describe('region meshes', () => {
  const quad = (): GeoBuffers => ({
    position: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
    normal: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    tile: new Float32Array([0, 0, 3, 0, 1, 0, 3, 0, 1, 1, 3, 0, 0, 1, 3, 0.5]),
    color: new Float32Array([1, 1, 1, 0.5, 0.5, 0.5, 1, 1, 1, 1, 1, 1]),
    index: new Uint32Array([0, 1, 2, 0, 2, 3]),
    quads: 1
  });

  it('a region is 4 x 4 chunk columns', () => {
    expect(REGION).toBe(4);
  });

  it('merges chunk buffers with their origin offsets and rebased indices', () => {
    const geo = mergeGeo([
      { g: quad(), ox: 0, oy: 0, oz: 0 },
      { g: quad(), ox: 16, oy: 32, oz: 48 }
    ]);
    expect(geo).not.toBeNull();
    const pos = geo!.getAttribute('position');
    expect(pos.count).toBe(8);
    expect([pos.getX(4), pos.getY(4), pos.getZ(4)]).toEqual([16, 32, 48]);
    const idx = Array.from(geo!.getIndex()!.array);
    expect(idx).toEqual([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
    // packed attributes keep their meaning (normalized int normals / colours)
    expect(geo!.getAttribute('normal').getZ(0)).toBeCloseTo(1, 2);
    expect(geo!.getAttribute('color').getX(1)).toBeCloseTo(0.5, 1);
    expect(geo!.getAttribute('aTile').getW(3)).toBe(0.5);
  });

  it('switches to 32-bit indices past 65 535 vertices and returns null when empty', () => {
    const many = Array.from({ length: 16400 }, () => ({ g: quad(), ox: 0, oy: 0, oz: 0 }));
    const geo = mergeGeo(many);
    expect(geo!.getIndex()!.array).toBeInstanceOf(Uint32Array);
    const empty: GeoBuffers = { ...quad(), position: new Float32Array(0), index: new Uint32Array(0), quads: 0 };
    expect(mergeGeo([{ g: empty, ox: 0, oy: 0, oz: 0 }])).toBeNull();
  });
});

describe('LCW toy-block look (docs/08 6.1)', () => {
  it('atlas tiles are 32 px painted tiles', () => {
    expect(TILE_PX).toBe(32);
  });

  it('solid blocks get the full rounded bevel, ground a soft one, cut-outs none', () => {
    const name = (n: string): TileName => {
      expect(TILE_NAMES).toContain(n);
      return n as TileName;
    };
    expect(tileBevel(name('plank'))).toBe(1);
    expect(tileBevel(name('glass'))).toBe(0);
    expect(tileBevel(name('leaves'))).toBe(0);
    expect(tileBevel(name('grass_top'))).toBeGreaterThan(0);
    expect(tileBevel(name('grass_top'))).toBeLessThan(1);
  });

  it('the shelf block is the LCW honey-jar shelf (no book-shelf block)', () => {
    expect(TILE_NAMES).not.toContain('bookshelf');
    expect(TILE_NAMES).toContain('jar_shelf');
    expect(BK.jarShelf).toBe(61);
    const entry = BLOCK_PALETTE.find((b) => b.id === 61);
    expect(entry?.key).toBe('jar_shelf');
  });

  it('every mouth x blink state has its own cell in the 4 x 3 face sheet', () => {
    const mouths = ['closed', 'small', 'big', 'wide', 'o', 'smile'] as const;
    const seen = new Set<string>();
    for (const m of mouths) {
      for (const blink of [false, true]) {
        const c = faceCell(m, blink);
        expect(c.col).toBeGreaterThanOrEqual(0);
        expect(c.col).toBeLessThan(4);
        expect(c.row).toBeGreaterThanOrEqual(0);
        expect(c.row).toBeLessThan(3);
        seen.add(`${c.col},${c.row}`);
      }
    }
    expect(seen.size).toBe(12);
  });
});

describe('town builder lives in sim-core (server and client build the same town)', () => {
  it('client re-exports the sim-core builder and block ids', () => {
    expect(buildTown).toBe(simBuildTown);
    expect(BK).toBe(SIM_BK);
  });

  it('builds the same blocks twice (deterministic)', () => {
    const a = new VoxelWorld();
    const b = new VoxelWorld();
    simBuildTown(a);
    simBuildTown(b);
    for (const [x, y, z] of [
      [144, 3, 144],
      [160, 2, 132],
      [130, 1, 149],
      [118, 1, 158]
    ] as const) {
      expect(a.getBlock(x, y, z)).toBe(b.getBlock(x, y, z));
    }
    expect(a.chunks.size).toBe(b.chunks.size);
    expect(a.chunks.size).toBeGreaterThan(0);
  });
});
