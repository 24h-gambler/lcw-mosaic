/**
 * The natural ground under and around the town (R2861①, Dan R2657 -> R2861 "마을 밖·땅속까지 끝없이 파고 짓기").
 *
 * Before: the world was the 240 x 240 m meadow the town builder wrote (y -2 .. surface) over a void: past its edge
 * there was nothing, and under y = -2 nothing to dig. Now every cell of the open world has a block by a pure function
 * of its position, so the client and the server agree on it without storing it:
 *
 *  - the surface: the town's own height (`terrainHeight`) inside the town, rolling hills fading in past 120 m from the
 *    centre, grass on top, two layers of dirt, stone below;
 *  - the deep: stone with pockets of gravel, granite, marble and dirt, and single veins of copper (under -30 m) and gold
 *    trim (under -150 m), down to a rough bedrock floor at `TUNING.world.yMin`;
 *  - trees on the open meadow past the town's edge (never inside the town box, the builder plants those);
 *  - R2904① (Dan R2904 "12살이 기대하는 자유도"): ore veins of coal, iron, gold, ruby and diamond in the depth bands of
 *    `TUNING.mining.ores` (a pickaxe of the ore's tier mines them), and caves — winding tunnels and a few wider rooms
 *    of air between `CAVE_TOP` and `CAVE_BOTTOM`, never reaching the surface (a cave is found by digging into it).
 *
 * A chunk is created filled with this ground (`fillNaturalChunk`), and a cell of a chunk that was never created reads
 * as this ground (`naturalBlock`): untouched ground costs no memory, only an edit makes a chunk. Inside the town box the
 * ground equals what the old `terrain()` wrote (grass / dirt / stone from y -2 to the surface), so the builder's other
 * steps and every saved cell keep their meaning.
 */
import { CHUNK_SIZE, type CubicChunk } from './chunk.js';
import { TUNING } from './tuning.js';

/** Block ids (town.ts BK, the content palette): repeated here so this file has no import cycle with town.ts. */
const AIR = 0;
const STONE = 1;
const DIRT = 2;
const GRASS = 3;
const BEDROCK = 6;
const GRAVEL = 12;
const GRANITE = 14;
const MARBLE = 15;
const LOG = 21;
const COPPER = 30;
const GOLD_TRIM = 31;
const LEAVES = 45;
/** R2904① ores (town.ts BK.coalOre … BK.diamondOre): mined with a pickaxe of their tier (plot.ts oreTier). */
const COAL_ORE = 71;
const IRON_ORE = 72;
const GOLD_ORE = 73;
const RUBY_ORE = 74;
const DIAMOND_ORE = 75;

/** The town's centre and its generated meadow box (town.ts TOWN_CENTER, TERRAIN_MIN, TERRAIN_MAX). */
const CENTER = 144;
const BOX_MIN = 24;
const BOX_MAX = 264;
const HILL = { x: 144, z: 102, r: 24, h: 9 } as const;

function hash2(seed: number, x: number, z: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(z, 668265263) + Math.imul(seed, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function hash3(seed: number, x: number, y: number, z: number): number {
  return hash2((seed ^ Math.imul(y, 0x9e3779b1)) | 0, x, z);
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function noise2(seed: number, x: number, z: number, cell: number): number {
  const gx = Math.floor(x / cell);
  const gz = Math.floor(z / cell);
  const fx = smooth(x / cell - gx);
  const fz = smooth(z / cell - gz);
  const a = hash2(seed, gx, gz);
  const b = hash2(seed, gx + 1, gz);
  const c = hash2(seed, gx, gz + 1);
  const d = hash2(seed, gx + 1, gz + 1);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

function noise3(seed: number, x: number, y: number, z: number, cell: number): number {
  // written out (no closures): it runs a few times for every cell of a deep chunk (fillNaturalChunk budget)
  const gx = Math.floor(x / cell);
  const gy = Math.floor(y / cell);
  const gz = Math.floor(z / cell);
  const fx = smooth(x / cell - gx);
  const fy = smooth(y / cell - gy);
  const fz = smooth(z / cell - gz);
  const s0 = (seed ^ Math.imul(gy, 0x9e3779b1)) | 0;
  const s1 = (seed ^ Math.imul(gy + 1, 0x9e3779b1)) | 0;
  const a0 = hash2(s0, gx, gz);
  const b0 = hash2(s0, gx + 1, gz);
  const c0 = hash2(s0, gx, gz + 1);
  const d0 = hash2(s0, gx + 1, gz + 1);
  const a1 = hash2(s1, gx, gz);
  const b1 = hash2(s1, gx + 1, gz);
  const c1 = hash2(s1, gx, gz + 1);
  const d1 = hash2(s1, gx + 1, gz + 1);
  const ab0 = a0 + (b0 - a0) * fx;
  const cd0 = c0 + (d0 - c0) * fx;
  const p0 = ab0 + (cd0 - ab0) * fz;
  const ab1 = a1 + (b1 - a1) * fx;
  const cd1 = c1 + (d1 - c1) * fx;
  const p1 = ab1 + (cd1 - ab1) * fz;
  return p0 + (p1 - p0) * fy;
}

/** The town's ground height (town.ts `terrainHeight`, the same numbers): flat town, the hill, the meadow. */
function townHeight(x: number, z: number): number {
  const dHill = Math.hypot(x + 0.5 - HILL.x, z + 0.5 - HILL.z);
  let hill = 0;
  if (dHill < HILL.r) {
    const t = 1 - dHill / HILL.r;
    hill = HILL.h * Math.min(1, t * t * (3 - 2 * t) * 1.35);
  }
  const dTown = Math.max(Math.abs(x - CENTER), Math.abs(z - CENTER));
  let meadow = 0;
  if (dTown > 50) {
    const fade = Math.min(1, (dTown - 50) / 26);
    meadow = (noise2(11, x, z, 22) * 5 + noise2(12, x, z, 9) * 1.6) * fade;
  }
  return Math.floor(Math.max(hill, meadow));
}

/** Where the hills of the open land begin (Chebyshev metres from the town centre): the whole town box is inside. */
export const NATURAL_HILLS_FROM = 120;
/** The highest a natural surface gets (m): the hills top out below this. */
export const NATURAL_MAX_SURFACE = 34;
/** The deepest a natural surface gets. */
export const NATURAL_MIN_SURFACE = 0;
/** A tree reaches this far above its ground (trunk up to 6, leaves one more). */
const TREE_REACH = 8;
/** The highest cave cell (m): a cave never opens into the town's foundation or the surface. */
export const CAVE_TOP = TUNING.mining.caves.top;
/** The lowest cave cell (m): the mine band of docs/03 3.2. */
export const CAVE_BOTTOM = TUNING.mining.caves.bottom;

/** Half-width of a tunnel in noise units (measured R2904: ~4% of the mine band is air, one joined tunnel system of ~18k cells per 96 x 48 x 96 m) and the room peak share. */
const TUNNEL_WIDTH = TUNING.mining.caves.tunnelWidth;
const ROOM_SHARE = TUNING.mining.caves.roomShare;

/**
 * A cave cell: tunnels where two smooth 3D noises both sit near their middle (a winding tube), and a few rooms where a
 * coarser noise peaks. Thinner near the top of the band so the roof is solid.
 */
export function isCaveCell(x: number, y: number, z: number): boolean {
  if (y > CAVE_TOP || y < CAVE_BOTTOM) return false;
  const edge = Math.min(1, (CAVE_TOP - y) / 6, (y - CAVE_BOTTOM) / 6);
  const w = TUNNEL_WIDTH * edge;
  if (Math.abs(noise3(71, x, y * 1.5, z, 18) - 0.5) < w && Math.abs(noise3(72, x, y * 1.5, z, 18) - 0.5) < w) return true;
  return noise3(73, x, y * 1.4, z, 26) > 1 - ROOM_SHARE * edge;
}

/** The ore at a cell, or 0: rarest first, each in its TUNING band, in small veins (a 4 x 3 x 4 cell lot, half filled). */
const ORES: ReadonlyArray<{ id: number; key: string; lot: number }> = [
  { id: DIAMOND_ORE, key: 'diamond' },
  { id: RUBY_ORE, key: 'ruby' },
  { id: GOLD_ORE, key: 'gold' },
  { id: IRON_ORE, key: 'iron' },
  { id: COAL_ORE, key: 'coal' }
].map((o) => ({ ...o, lot: TUNING.mining.veinLot[o.key] ?? 0 }));
export function naturalOre(x: number, y: number, z: number): number {
  const lx = Math.floor(x / 4);
  const ly = Math.floor(y / 3);
  const lz = Math.floor(z / 4);
  for (const [i, o] of ORES.entries()) {
    const band = TUNING.mining.ores[o.key];
    if (!band || y < band.minY || y > band.maxY) continue;
    if (hash3(81 + i, lx, ly, lz) >= o.lot) continue;
    if (hash3(91 + i, x, y, z) < 0.5) return o.id;
  }
  return 0;
}

/** Under this the ground is plain stone (the town's foundation look) before the pockets begin. */
const POCKETS_BELOW = -6;

/** The surface block y of a column of the open world. */
export function naturalHeight(x: number, z: number): number {
  const base = townHeight(x, z);
  const dTown = Math.max(Math.abs(x - CENTER), Math.abs(z - CENTER));
  if (dTown <= NATURAL_HILLS_FROM) return base;
  const fade = Math.min(1, (dTown - NATURAL_HILLS_FROM) / 60);
  const n = noise2(13, x, z, 64);
  const hills = (n * n * 22 + noise2(14, x, z, 17) * 4) * fade;
  return Math.min(NATURAL_MAX_SURFACE - 1, Math.floor(base + hills));
}

/** The ground block at a cell at or under the surface `h` of its column. */
function groundBlock(x: number, y: number, z: number, h: number): number {
  const yMin = TUNING.world.yMin;
  if (y <= yMin) return BEDROCK;
  if (y <= yMin + 3 && hash3(61, x, y, z) < 0.55 - (y - yMin) * 0.12) return BEDROCK;
  if (y === h) return GRASS;
  if (y >= h - 2) return DIRT;
  if (y >= POCKETS_BELOW) return STONE;
  if (isCaveCell(x, y, z)) return AIR;
  // pockets: blobs of 4 x 3 x 4 cells, their grid shifted per layer so they do not line up in columns
  const by = Math.floor(y / 3);
  const off = Math.floor(hash2(62, by, 0) * 4);
  const b = hash3(63, Math.floor((x + off) / 4), by, Math.floor((z + off) / 4));
  if (b < 0.05) return y > -150 ? GRAVEL : GRANITE;
  if (b < 0.1) return GRANITE;
  if (b < 0.13 && y < -40) return MARBLE;
  if (b < 0.16 && y > -80) return DIRT;
  const ore = naturalOre(x, y, z);
  if (ore) return ore;
  const v = hash3(64, x, y, z);
  if (y < -150 && v < 0.004) return GOLD_TRIM;
  if (y < -30 && v < 0.007) return COPPER;
  return STONE;
}

// ---- Trees of the open land: at most one per 9 x 9 m grid cell, never inside the town box (+3 m).
const TREE_GRID = 9;

interface Tree {
  x: number;
  z: number;
  /** first trunk cell */
  y0: number;
  /** trunk height */
  th: number;
}

function treeOf(gx: number, gz: number): Tree | null {
  if (hash2(51, gx, gz) > 0.42) return null;
  const x = gx * TREE_GRID + 2 + Math.floor(hash2(52, gx, gz) * (TREE_GRID - 4));
  const z = gz * TREE_GRID + 2 + Math.floor(hash2(53, gx, gz) * (TREE_GRID - 4));
  if (x >= BOX_MIN - 3 && x < BOX_MAX + 3 && z >= BOX_MIN - 3 && z < BOX_MAX + 3) return null;
  return { x, z, y0: naturalHeight(x, z) + 1, th: 4 + Math.floor(hash2(54, gx, gz) * 3) };
}

/** The tree block (log or leaves) a tree puts at a cell, or 0. */
function treeCell(t: Tree, x: number, y: number, z: number): number {
  const top = t.y0 + t.th;
  if (x === t.x && z === t.z && y >= t.y0 && y < top) return LOG;
  if (y < top - 2 || y > top) return 0;
  const r = y >= top - 0 ? 1 : 2;
  const dx = Math.abs(x - t.x);
  const dz = Math.abs(z - t.z);
  if (dx > r || dz > r) return 0;
  if (r === 2 && dx === 2 && dz === 2) return 0;
  return LEAVES;
}

/** The trees whose cells may reach the box x0..x1, z0..z1 (inclusive). */
function treesNear(x0: number, x1: number, z0: number, z1: number): Tree[] {
  const out: Tree[] = [];
  const gx0 = Math.floor((x0 - 2) / TREE_GRID);
  const gx1 = Math.floor((x1 + 2) / TREE_GRID);
  const gz0 = Math.floor((z0 - 2) / TREE_GRID);
  const gz1 = Math.floor((z1 + 2) / TREE_GRID);
  for (let gz = gz0; gz <= gz1; gz++) {
    for (let gx = gx0; gx <= gx1; gx++) {
      const t = treeOf(gx, gz);
      if (t) out.push(t);
    }
  }
  return out;
}

/** The natural block at any cell of the world (what an untouched cell holds). */
export function naturalBlock(x: number, y: number, z: number): number {
  if (y <= TUNING.world.yMin) return BEDROCK;
  if (y <= NATURAL_MAX_SURFACE + TREE_REACH || y <= TUNING.world.yMin + 3) {
    const h = naturalHeight(x, z);
    if (y <= h) return groundBlock(x, y, z, h);
    if (y > h + TREE_REACH + 1 && y > NATURAL_MAX_SURFACE) return AIR;
    // logs first, then leaves (two trees' crowns may meet; a trunk always shows)
    const ts = treesNear(x, x, z, z);
    let leaf = 0;
    for (const t of ts) {
      const c = treeCell(t, x, y, z);
      if (c === LOG) return LOG;
      if (c) leaf = c;
    }
    return leaf;
  }
  return AIR;
}

/**
 * Fill a new chunk with the natural ground (a fresh chunk is all air). Writes the palette directly, column by column:
 * one height per column, then the cells. Returns false when the chunk stayed all air.
 */
export function fillNaturalChunk(chunk: CubicChunk): boolean {
  const S = CHUNK_SIZE;
  const x0 = chunk.cx * S;
  const y0 = chunk.cy * S;
  const z0 = chunk.cz * S;
  const yMin = TUNING.world.yMin;
  // wholly above any ground and any tree: air
  if (y0 > NATURAL_MAX_SURFACE + TREE_REACH && y0 + S - 1 > yMin + 3) return false;
  let any = false;
  const put = (lx: number, ly: number, lz: number, id: number): void => chunk.generateVoxel(lx, ly, lz, id);
  let maxH = -Infinity;
  for (let lz = 0; lz < S; lz++) {
    for (let lx = 0; lx < S; lx++) {
      const x = x0 + lx;
      const z = z0 + lz;
      const h = naturalHeight(x, z);
      if (h > maxH) maxH = h;
      const top = Math.min(S - 1, h - y0);
      for (let ly = 0; ly <= top; ly++) {
        put(lx, ly, lz, groundBlock(x, y0 + ly, z, h));
        any = true;
      }
    }
  }
  // trees: only where the ground left air, leaves first then trunks
  if (y0 + S - 1 >= NATURAL_MIN_SURFACE && y0 <= maxH + TREE_REACH + 1) {
    const ts = treesNear(x0, x0 + S - 1, z0, z0 + S - 1);
    for (const pass of [LEAVES, LOG]) {
      for (const t of ts) {
        const top = t.y0 + t.th;
        for (let y = Math.max(y0, t.y0); y <= Math.min(y0 + S - 1, top); y++) {
          for (let z = Math.max(z0, t.z - 2); z <= Math.min(z0 + S - 1, t.z + 2); z++) {
            for (let x = Math.max(x0, t.x - 2); x <= Math.min(x0 + S - 1, t.x + 2); x++) {
              const c = treeCell(t, x, y, z);
              if (c !== pass) continue;
              const lx = x - x0;
              const ly = y - y0;
              const lz = z - z0;
              const cur = chunk.palette[chunk.voxels[(ly * S + lz) * S + lx]!] ?? 0;
              if (cur !== AIR && !(pass === LOG && cur === LEAVES)) continue;
              put(lx, ly, lz, c);
              any = true;
            }
          }
        }
      }
    }
  }
  chunk.dirty = true;
  return any;
}

/** The chunk-y range (inclusive) whose chunks of a chunk column can show the natural surface (ground faces and trees). */
export function naturalSurfaceChunkRange(cx: number, cz: number): [number, number] {
  const S = CHUNK_SIZE;
  let lo = Infinity;
  let hi = -Infinity;
  for (let lz = 0; lz < S; lz++) {
    for (let lx = 0; lx < S; lx++) {
      const h = naturalHeight(cx * S + lx, cz * S + lz);
      if (h < lo) lo = h;
      if (h > hi) hi = h;
    }
  }
  return [Math.floor((lo - 1) / S), Math.floor((hi + TREE_REACH + 1) / S)];
}
