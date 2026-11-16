// Voxel light (docs/08 6.3, WP-208, R2627): sky light under roofs and lantern light spreading through the padded grid
// the meshing Worker sees, and the mesher carrying it into the vertex colour (r = AO, g = sky, b = block).
import { describe, expect, it } from 'vitest';
import { BK } from '../blocks.js';
import { LIGHT_PAD, MAX_LIGHT, computeLight } from '../voxel-light.js';
import { meshChunk } from '../mesher.js';

const N = 16 + 2 * LIGHT_PAD;
const at = (x: number, y: number, z: number): number => (y * N + z) * N + x;
const grid = (fill: (x: number, y: number, z: number) => number): Uint16Array => {
  const v = new Uint16Array(N * N * N);
  for (let y = 0; y < N; y++) for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) v[at(x, y, z)] = fill(x, y, z);
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
    const t0 = performance.now();
    const runs = 20;
    for (let i = 0; i < runs; i++) computeLight(v, N, open);
    expect((performance.now() - t0) / runs).toBeLessThan(8);
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
