// R2861① (Dan R2657 -> R2861 "마을 밖·땅속까지 끝없이"): the natural ground is one pure function of position, the same
// whether a chunk was made (filled) or never made (read through), and inside the town it is the old town ground.
import { describe, expect, it } from 'vitest';
import {
  BK,
  CHUNK_SIZE,
  CubicChunk,
  TERRAIN_MAX,
  TERRAIN_MIN,
  TUNING,
  VoxelWorld,
  buildTown,
  fillNaturalChunk,
  naturalBlock,
  naturalHeight,
  naturalSurfaceChunkRange,
  terrainHeight
} from '../index.js';

function chunkMatches(cx: number, cy: number, cz: number): string[] {
  const c = new CubicChunk(cx, cy, cz);
  fillNaturalChunk(c);
  const bad: string[] = [];
  for (let ly = 0; ly < CHUNK_SIZE; ly++) {
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const x = cx * CHUNK_SIZE + lx;
        const y = cy * CHUNK_SIZE + ly;
        const z = cz * CHUNK_SIZE + lz;
        const a = c.getVoxel(lx, ly, lz);
        const b = naturalBlock(x, y, z);
        if (a !== b && bad.length < 5) bad.push(`${x},${y},${z}: chunk ${a} cell ${b}`);
      }
    }
  }
  return bad;
}

describe('natural ground (R2861①)', () => {
  it('a filled chunk equals the cell function everywhere: the town, the far meadow with trees, the deep, the floor', () => {
    const yFloor = Math.floor(TUNING.world.yMin / CHUNK_SIZE);
    const cases: Array<[number, number, number]> = [
      [9, 0, 9],
      [0, 0, 0],
      [-1, 0, 3],
      [30, 0, -12],
      [30, 1, -12],
      [-200, 0, 400],
      [9, -2, 9],
      [9, -30, 9],
      [500, -70, -800],
      [9, yFloor, 9],
      [9, 3, 9]
    ];
    for (const [cx, cy, cz] of cases) expect(chunkMatches(cx, cy, cz)).toEqual([]);
  });

  it('inside the town box the ground is the old town ground (grass, two of dirt, stone to y -2), stone below', () => {
    for (let i = 0; i < 400; i++) {
      const x = TERRAIN_MIN + ((i * 37) % (TERRAIN_MAX - TERRAIN_MIN));
      const z = TERRAIN_MIN + ((i * 91) % (TERRAIN_MAX - TERRAIN_MIN));
      const h = terrainHeight(x, z);
      expect(naturalHeight(x, z)).toBe(h);
      for (let y = -2; y <= h + 9; y++) {
        const want = y > h ? 0 : y === h ? BK.grass : y >= h - 2 ? BK.dirt : BK.stone;
        expect(naturalBlock(x, y, z)).toBe(want);
      }
      expect(naturalBlock(x, -3, z)).toBe(BK.stone);
    }
  });

  it('the open land goes on: hills and trees past the town, every column has ground, nothing floats', () => {
    let trees = 0;
    let maxH = 0;
    for (let i = 0; i < 3000; i++) {
      const x = -3000 + ((i * 7919) % 9000);
      const z = -3000 + ((i * 104729) % 9000);
      const h = naturalHeight(x, z);
      maxH = Math.max(maxH, h);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(naturalBlock(x, h, z)).toBe(BK.grass);
      for (let y = h + 1; y < h + 9; y++) if (naturalBlock(x, y, z) === BK.log) trees++;
    }
    expect(maxH).toBeGreaterThan(12);
    expect(trees).toBeGreaterThan(20); // log cells over sampled columns: ~1 tree per 190 m²
    // a trunk stands on grass
    for (let x = -400; x < -300; x++) {
      for (let z = 400; z < 420; z++) {
        const h = naturalHeight(x, z);
        if (naturalBlock(x, h + 1, z) === BK.log) expect(naturalBlock(x, h, z)).toBe(BK.grass);
      }
    }
  });

  it('the deep holds pockets and veins down to a bedrock floor at yMin that nothing goes under', () => {
    const seen = new Map<number, number>();
    for (let y = -10; y > TUNING.world.yMin + 4; y -= 7) {
      for (let i = 0; i < 60; i++) {
        const id = naturalBlock(i * 13, y, i * 29 - 700);
        seen.set(id, (seen.get(id) ?? 0) + 1);
      }
    }
    for (const id of [BK.stone, BK.gravel, BK.granite, BK.marble, BK.dirt]) expect(seen.get(id) ?? 0).toBeGreaterThan(0);
    expect(seen.get(0) ?? 0).toBe(0); // no caves of air: what is dug is what a child dug
    for (let i = 0; i < 50; i++) expect(naturalBlock(i * 101, TUNING.world.yMin, -i * 77)).toBe(BK.road + 1); // bedrock (6)
  });

  it('a world reads untouched ground without making chunks, and a fresh chunk starts as the ground', () => {
    const w = new VoxelWorld();
    expect(w.getBlock(5000, -900, -5000)).not.toBe(0);
    expect(w.chunks.size).toBe(0);
    const h = naturalHeight(5000, -5000);
    expect(w.getBlock(5000, h, -5000)).toBe(BK.grass);
    w.setBlock({ id: 'k', townRules: true }, 5000, h + 1, -5000, BK.brick);
    expect(w.chunks.size).toBe(1);
    expect(w.getBlock(5000, h, -5000)).toBe(BK.grass);
    expect(w.getBlock(5000, h + 1, -5000)).toBe(BK.brick);
    // a bare grid stays bare
    expect(new VoxelWorld(undefined, { natural: false }).getBlock(5000, -900, -5000)).toBe(0);
  });

  it('the town builds on it as before: same blocks as the town over the old written ground', () => {
    const a = new VoxelWorld();
    buildTown(a);
    const b = new VoxelWorld(undefined, { natural: false });
    buildTown(b);
    const diff: string[] = [];
    for (let z = TERRAIN_MIN; z < TERRAIN_MAX; z += 3) {
      for (let x = TERRAIN_MIN; x < TERRAIN_MAX; x += 3) {
        for (let y = -2; y <= 30; y++) {
          if (a.getBlock(x, y, z) !== b.getBlock(x, y, z) && diff.length < 5) diff.push(`${x},${y},${z}`);
        }
      }
    }
    expect(diff).toEqual([]);
  });

  it('the surface chunk range covers every visible ground face and tree of a column', () => {
    for (const [cx, cz] of [[9, 9], [-40, 20], [100, -300], [1, 1]] as const) {
      const [lo, hi] = naturalSurfaceChunkRange(cx, cz);
      for (let lz = 0; lz < CHUNK_SIZE; lz += 3) {
        for (let lx = 0; lx < CHUNK_SIZE; lx += 3) {
          const x = cx * CHUNK_SIZE + lx;
          const z = cz * CHUNK_SIZE + lz;
          const h = naturalHeight(x, z);
          expect(Math.floor(h / CHUNK_SIZE)).toBeGreaterThanOrEqual(lo);
          expect(Math.floor((h + 8) / CHUNK_SIZE)).toBeLessThanOrEqual(hi);
        }
      }
    }
  });

  it('fills a chunk fast enough to stream the land while walking (budget: < 2 ms a chunk here)', () => {
    const t0 = performance.now();
    let n = 0;
    for (let cx = 40; cx < 48; cx++) for (let cz = 40; cz < 48; cz++) for (let cy = -1; cy <= 1; cy++) {
      fillNaturalChunk(new CubicChunk(cx, cy, cz));
      n++;
    }
    const per = (performance.now() - t0) / n;
    expect(per).toBeLessThan(2);
  });
});
