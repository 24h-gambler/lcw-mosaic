// R2904① (Dan R2904 "12살이 기대하는 자유도 — 도구가 부수는 속도와 종류를 바꾸고, 땅속에 동굴과 광물"): ore veins in the
// TUNING.mining bands, caves in the mine band that never reach the surface, pickaxe tiers the client and the server
// both check (applyPlotOp), and the sword for the soft things.
import { describe, expect, it } from 'vitest';
import {
  BK,
  CAVE_BOTTOM,
  CubicChunk,
  fillNaturalChunk,
  CAVE_TOP,
  ORE_BLOCKS,
  TUNING,
  VoxelWorld,
  applyPlotOp,
  blockRef,
  breakSeconds,
  starterInventory,
  isCaveCell,
  mineTierOf,
  naturalBlock,
  naturalHeight,
  naturalOre,
  oreKeyOf,
  oreReason,
  oreTier,
  pickTier,
  toolBreakSeconds,
  toolOf,
  type PlotState
} from '../index.js';

describe('ores of the deep (R2904①)', () => {
  it('each ore lies only in its TUNING band, and every one is found', () => {
    const found = new Map<number, { n: number; lo: number; hi: number }>();
    for (let y = -8; y >= -160; y -= 1) {
      for (let i = 0; i < 400; i++) {
        const id = naturalOre(3000 + i * 7, y, -2000 + i * 13);
        if (!id) continue;
        const f = found.get(id) ?? { n: 0, lo: Infinity, hi: -Infinity };
        f.n++;
        f.lo = Math.min(f.lo, y);
        f.hi = Math.max(f.hi, y);
        found.set(id, f);
      }
    }
    for (const id of ORE_BLOCKS) {
      const band = TUNING.mining.ores[oreKeyOf(id)!]!;
      const f = found.get(id);
      expect(f?.n ?? 0).toBeGreaterThan(5);
      expect(f!.lo).toBeGreaterThanOrEqual(band.minY);
      expect(f!.hi).toBeLessThanOrEqual(band.maxY);
    }
    // rarer the deeper: coal outnumbers diamond
    expect(found.get(BK.coalOre)!.n).toBeGreaterThan(found.get(BK.diamondOre)!.n * 3);
  });

  it('an ore shows in the ground only where the stone is (not in the town foundation, not in the air of a cave)', () => {
    let ores = 0;
    for (let y = -10; y >= -150; y -= 2) {
      for (let i = 0; i < 200; i++) {
        const x = i * 11 - 900;
        const z = i * 5 + 300;
        const b = naturalBlock(x, y, z);
        if (ORE_BLOCKS.includes(b)) {
          ores++;
          expect(isCaveCell(x, y, z)).toBe(false);
        }
      }
    }
    expect(ores).toBeGreaterThan(20);
    for (let y = 0; y > -9; y--) for (let i = 0; i < 100; i++) expect(ORE_BLOCKS).not.toContain(naturalBlock(144 + (i % 20), y, 144 + i));
  });
});

describe('caves (R2904①)', () => {
  it('a deep chunk (caves and ores) still fills fast enough to stream while digging down (budget: < 4 ms a chunk here)', () => {
    let n = 0;
    const t0 = performance.now();
    for (let cx = 40; cx < 46; cx++) for (let cz = 40; cz < 46; cz++) for (const cy of [-2, -4, -8]) {
      fillNaturalChunk(new CubicChunk(cx, cy, cz));
      n++;
    }
    expect((performance.now() - t0) / n).toBeLessThan(4);
  });

  it('a few percent of the mine band is air, joined into tunnels; nothing above the cave top or under the bottom', () => {
    let air = 0;
    let n = 0;
    for (let y = CAVE_BOTTOM; y <= CAVE_TOP; y += 3) {
      for (let i = 0; i < 300; i++) {
        n++;
        if (naturalBlock(500 + i * 3, y, -400 + ((i * 7) % 90)) === 0) air++;
      }
    }
    expect(air / n).toBeGreaterThan(0.015);
    expect(air / n).toBeLessThan(0.12);
    for (let i = 0; i < 2000; i++) {
      const x = (i * 37) % 3000;
      const z = (i * 53) % 3000;
      expect(isCaveCell(x, CAVE_TOP + 1 + (i % 10), z)).toBe(false);
      expect(isCaveCell(x, CAVE_BOTTOM - 1 - (i % 10), z)).toBe(false);
    }
  });

  it('the surface stays whole: every column still has its grass and ground down to the cave top', () => {
    for (let i = 0; i < 300; i++) {
      const x = -2000 + i * 17;
      const z = 1500 - i * 11;
      const h = naturalHeight(x, z);
      expect(naturalBlock(x, h, z)).toBe(BK.grass);
      for (let y = h; y > CAVE_TOP; y -= 2) expect(naturalBlock(x, y, z)).not.toBe(0);
    }
  });
});

describe('pickaxe tiers and the sword (R2904①)', () => {
  it('tiers (docs/03 D2): wooden pickaxe 1, iron pickaxe 2, drill 3; coal·iron need 1, gold·ruby 2, diamond 3', () => {
    expect(pickTier('pickaxe')).toBe(1);
    expect(pickTier('iron_pickaxe')).toBe(2);
    expect(pickTier('pickaxe_iron')).toBe(2);
    expect(pickTier('drill')).toBe(3);
    expect(pickTier('axe')).toBe(0);
    expect(pickTier(null)).toBe(0);
    expect(mineTierOf(['axe', 'pickaxe', 'iron_pickaxe'])).toBe(2);
    expect([BK.coalOre, BK.ironOre, BK.goldOre, BK.rubyOre, BK.diamondOre].map(oreTier)).toEqual([1, 1, 2, 2, 3]);
    expect(oreTier(BK.stone)).toBe(0);
    expect(oreReason(BK.coalOre, 0)).toBe('needs_pickaxe');
    expect(oreReason(BK.goldOre, 1)).toBe('needs_iron_pickaxe');
    expect(oreReason(BK.diamondOre, 2)).toBe('needs_drill');
    expect(oreReason(BK.diamondOre, 3)).toBeNull();
    expect(oreReason(BK.stone, 0)).toBeNull();
  });

  it('a pickaxe mines ore faster; the sword cuts leaves, hay and wool, not stone', () => {
    expect(toolOf('drill')).toBe('pickaxe');
    expect(toolOf('sword')).toBe('sword');
    expect(toolBreakSeconds(BK.ironOre, 'pickaxe')).toBeLessThan(breakSeconds(BK.ironOre));
    expect(toolBreakSeconds(BK.leaves, 'sword')).toBeLessThanOrEqual(breakSeconds(BK.leaves));
    expect(toolBreakSeconds(BK.woolRed, 'sword')).toBeLessThan(breakSeconds(BK.woolRed));
    expect(toolBreakSeconds(BK.stone, 'sword')).toBe(breakSeconds(BK.stone));
  });

  it('the server rule (applyPlotOp): a bare hand cannot take ore, the right pickaxe can, and the ore comes back to the hand', () => {
    const world = new VoxelWorld();
    let x = 3000;
    let y = -40;
    let z = 0;
    // find an iron ore cell in the iron band
    search: for (y = -21; y >= -89; y--) {
      for (x = 3000; x < 3200; x++) {
        for (z = 0; z < 8; z++) if (world.getBlock(x, y, z) === BK.ironOre) break search;
      }
    }
    expect(world.getBlock(x, y, z)).toBe(BK.ironOre);
    let tier = 0;
    const state: PlotState = { world, furniture: new Map(), inv: starterInventory(), scope: 'world', mineTier: () => tier };
    expect(applyPlotOp(state, 'kid', { op: 'break', x, y, z })).toMatchObject({ ok: false, reason: 'needs_pickaxe' });
    expect(world.getBlock(x, y, z)).toBe(BK.ironOre);
    tier = 1;
    const r = applyPlotOp(state, 'kid', { op: 'break', x, y, z });
    expect(r.ok).toBe(true);
    expect(world.getBlock(x, y, z)).toBe(0);
    const ref = blockRef(BK.ironOre);
    const inHand = state.inv.slots.some((s) => s?.ref === ref) || (state.inv.chest[ref] ?? 0) > 0;
    expect(inHand).toBe(true);
    // a mined ore is placeable (shown off on the plot) but never starts in a new chest
    expect(starterInventory().chest[ref]).toBeUndefined();
  });
});
