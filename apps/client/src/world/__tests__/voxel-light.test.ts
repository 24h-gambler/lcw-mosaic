// Voxel light (docs/08 6.3, WP-208, R2627): sky light under roofs and lantern light spreading through the padded grid
// the meshing Worker sees, and the mesher carrying it into the vertex colour (r = AO, g = sky, b = block).
import { describe, expect, it } from 'vitest';
import { BK } from '../blocks.js';
import { LIGHT_PAD, MAX_LIGHT, computeLight } from '../voxel-light.js';
import { meshChunk } from '../mesher.js';
import { VoxelWorld } from '@lcw/sim-core';
import { LIT_N, extractLit } from '../chunks.js';
import { buildTown } from '../town.js';

const N = 16 + 2 * LIGHT_PAD;
// the scenes below were laid out for a 6-block border; D moves them so they sit in the chunk whatever LIGHT_PAD is
const D = LIGHT_PAD - 6;
const at = (x: number, y: number, z: number): number => ((y + D) * N + (z + D)) * N + (x + D);
const grid = (fill: (x: number, y: number, z: number) => number): Uint16Array => {
  const v = new Uint16Array(N * N * N);
  for (let y = 0; y < N; y++) for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) v[(y * N + z) * N + x] = fill(x - D, y - D, z - D);
  return v;
};
const open = new Uint8Array(N * N).fill(1);

// a closed stone room (inside 10..17 on x/z, 3..6 high) with a doorway on the -z wall, on a stone floor
const room = (x: number, y: number, z: number): number => {
  if (y === 2) return BK.stone;
  const inX = x >= 9 && x <= 18;
  const inZ = z >= 9 && z <= 18;
  if (!inX || !inZ || y < 3 || y > 7) return 0;
  const wall = x === 9 || x === 18 || z === 9 || z === 18 || y === 7;
  const door = z === 9 && x === 13 && y <= 4;
  return wall && !door ? BK.stone : 0;
};

describe('voxel light (WP-208, R2627)', () => {
  it('open ground has full sky light; a roofed room is dark inside, lit a little through its door', () => {
    const { sky } = computeLight(grid(room), N, open);
    expect(sky[at(4, 3, 4)]).toBe(MAX_LIGHT); // open meadow
    const doorIn = sky[at(13, 3, 10)]!;
    const back = sky[at(16, 3, 17)]!;
    expect(doorIn).toBeGreaterThan(back);
    expect(doorIn).toBeLessThan(MAX_LIGHT);
    expect(back).toBeLessThan(doorIn);
  });

  it('a lantern lights its room, one level less per block, and walls stop it', () => {
    const v = grid(room);
    v[at(14, 3, 14)] = BK.lantern;
    const { block } = computeLight(v, N, open);
    expect(block[at(14, 3, 14)]).toBe(15);
    expect(block[at(15, 3, 14)]).toBe(14);
    expect(block[at(16, 3, 14)]).toBe(13);
    expect(block[at(17, 3, 14)]).toBe(12);
    expect(block[at(18, 3, 14)]).toBe(0); // wall block
    expect(block[at(19, 3, 14)]).toBe(0); // other side of the wall: no light leaks through stone
  });

  it('lighting one padded chunk stays inside the WP-208 budget (8 ms for a torch)', () => {
    const v = grid(room);
    v[at(14, 3, 14)] = BK.torch;
    computeLight(v, N, open); // warm up
    // median of 21 runs: one stall of a loaded test machine (seconds, seen under parallel suites) must not decide it
    const ts: number[] = [];
    for (let i = 0; i < 21; i++) {
      const t0 = performance.now();
      computeLight(v, N, open);
      ts.push(performance.now() - t0);
    }
    ts.sort((a, b) => a - b);
    expect(ts[10]).toBeLessThan(8);
  });

  it('the mesher puts sky and lantern light into the vertex colour when the light grid is passed', () => {
    // with a light grid the mesher reads the wider LIGHT_PAD grid itself (chunks.ts extractLit)
    const lv = grid(room);
    lv[at(14, 3, 14)] = BK.lantern;
    const m = meshChunk(lv, [0, 0, 0], { n: N, skyAbove: open });
    let minSky = 1;
    let maxBlock = 0;
    for (let i = 0; i < m.opaque.color.length; i += 3) {
      minSky = Math.min(minSky, m.opaque.color[i + 1]!);
      maxBlock = Math.max(maxBlock, m.opaque.color[i + 2]!);
    }
    expect(minSky).toBeLessThan(0.5); // the room's inner walls
    expect(maxBlock).toBeGreaterThan(0.7); // next to the lantern
  });
});

describe('chunk borders and extraction cost (R2627 review)', () => {
  const town = new VoxelWorld();
  buildTown(town);
  const n = LIT_N;
  const P = LIGHT_PAD;
  const idx = (x: number, y: number, z: number): number => ((y + P) * n + (z + P)) * n + (x + P);

  it('a cell on a chunk border gets the same sky and lantern light from both chunks (no seams)', () => {
    let cells = 0;
    let diff = 0;
    for (const k of town.chunks.keys()) {
      const [cx, cy, cz] = k.split(',').map(Number) as [number, number, number];
      if (!town.chunks.has(`${cx + 1},${cy},${cz}`) || (cx + cz) % 3 !== 0) continue;
      const ga = extractLit(town, cx, cy, cz);
      const gb = extractLit(town, cx + 1, cy, cz);
      const a = computeLight(ga.vox, n, ga.skyAbove);
      const b = computeLight(gb.vox, n, gb.skyAbove);
      for (let y = 0; y < 16; y++) {
        for (let z = 0; z < 16; z++) {
          for (const ax of [15, 16]) {
            const ia = idx(ax, y, z);
            const ib = idx(ax - 16, y, z);
            if (ga.vox[ia] !== 0) continue;
            cells++;
            if (a.sky[ia] !== b.sky[ib] || a.block[ia] !== b.block[ib]) diff++;
          }
        }
      }
    }
    expect(cells).toBeGreaterThan(5000);
    expect(diff).toBe(0);
  });

  it('extracting the light grid matches block by block and stays cheap on the main thread', () => {
    const keys = [...town.chunks.keys()].slice(0, 40).map((k) => k.split(',').map(Number) as [number, number, number]);
    // the same blocks as reading the world one by one
    const [cx, cy, cz] = keys[7]!;
    const g = extractLit(town, cx, cy, cz);
    for (let t = 0; t < 400; t++) {
      const x = (t * 7) % n;
      const y = (t * 13) % n;
      const z = (t * 29) % n;
      expect(g.vox[(y * n + z) * n + x], `${x},${y},${z}`).toBe(town.getBlock(cx * 16 - P + x, cy * 16 - P + y, cz * 16 - P + z));
    }
    const t0 = performance.now();
    for (const [a, b, c] of keys) extractLit(town, a, b, c);
    const per = (performance.now() - t0) / keys.length;
    // a buffer pair sent back by the Worker (still holding another chunk's grid) gives the same grid as a fresh one
    const [ex, ey, ez] = keys[3]!;
    const reused = extractLit(town, ex, ey, ez, { vox: new Uint16Array(n ** 3).fill(77), skyAbove: new Uint8Array(n * n).fill(0) });
    const fresh = extractLit(town, ex, ey, ez);
    expect(reused.vox).toEqual(fresh.vox);
    expect(reused.skyAbove).toEqual(fresh.skyAbove);
    // 44^3 cells copied from 27 chunks: well under 2 ms each even on a loaded test machine
    expect(per).toBeLessThan(2);
  });
});
