/**
 * The hand-built lesson town in the central sector (docs/03 3.5, WP-102): plaza, honey cafe, trade shop,
 * the build plot, and the windy hill, plus the meadow around them. Every block goes through
 * `VoxelWorld.setBlock` (AGENTS 4.1) with the system-generation actor; the builder is deterministic, so the
 * client (what the child sees) and the WorldDO (what the server saves edits against) start from the same blocks.
 */
import type { VoxelWorld } from './world.js';

/** Block ids the town uses (the same ids as `@lcw/content` BLOCK_PALETTE). */
export const BK = {
  air: 0,
  stone: 1,
  dirt: 2,
  grass: 3,
  brick: 4,
  road: 5,
  plank: 8,
  glass: 9,
  sand: 11,
  gravel: 12,
  granite: 14,
  marble: 15,
  stoneStair: 16,
  stoneSlab: 17,
  oakPlank: 18,
  birchPlank: 19,
  pinePlank: 20,
  log: 21,
  fence: 22,
  door: 23,
  stainedGlass: 25,
  torch: 26,
  lantern: 27,
  ironPlate: 29,
  copper: 30,
  goldTrim: 31,
  roofRed: 33,
  roofBlue: 34,
  roofSlate: 35,
  thatch: 36,
  scaffold: 41,
  nameplate: 42,
  carpet: 43,
  flowerPot: 44,
  leaves: 45,
  water: 46,
  flowerRed: 47,
  flowerYellow: 48,
  tallGrass: 49,
  honeycomb: 50,
  woolWhite: 51,
  woolRed: 52,
  woolYellow: 53,
  woolBlue: 54,
  woolGreen: 55,
  woolOrange: 56,
  crate: 57,
  barrel: 58,
  hay: 59,
  cobble: 60,
  jarShelf: 61,
  darkPlank: 62,
  chest: 63,
  path: 64,
  woolPink: 65,
  woolPurple: 66,
  terracottaHoney: 67,
  flowerBlue: 68,
  chalkboard: 69,
  stoneBrick: 70
} as const;

// ---- Deterministic hash + value noise (no Math.random, docs/03 3.3 결정론).
export function hash2i(seed: number, x: number, z: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(z, 668265263) + Math.imul(seed, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** 2D value noise in [0, 1). */
export function valueNoise(seed: number, x: number, z: number, cell: number): number {
  const gx = Math.floor(x / cell);
  const gz = Math.floor(z / cell);
  const fx = smooth(x / cell - gx);
  const fz = smooth(z / cell - gz);
  const a = hash2i(seed, gx, gz);
  const b = hash2i(seed, gx + 1, gz);
  const c = hash2i(seed, gx, gz + 1);
  const d = hash2i(seed, gx + 1, gz + 1);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

/** Small deterministic PRNG (mulberry32) for prop placement. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SYS = { id: 'system_gen', isSystemGen: true } as const;

export const TOWN_CENTER = { x: 144, z: 144 } as const;
export const TERRAIN_MIN = 24;
export const TERRAIN_MAX = 264;

const HILL = { x: 144, z: 102, r: 24, h: 9 } as const;

/** Ground height (surface block y) at a column. Flat town, a hill to the north, rolling meadow outside. */
export function terrainHeight(x: number, z: number): number {
  const dHill = Math.hypot(x + 0.5 - HILL.x, z + 0.5 - HILL.z);
  let hill = 0;
  if (dHill < HILL.r) {
    const t = 1 - dHill / HILL.r;
    hill = HILL.h * Math.min(1, t * t * (3 - 2 * t) * 1.35);
  }
  const dTown = Math.max(Math.abs(x - TOWN_CENTER.x), Math.abs(z - TOWN_CENTER.z));
  let meadow = 0;
  if (dTown > 50) {
    const fade = Math.min(1, (dTown - 50) / 26);
    meadow = (valueNoise(11, x, z, 22) * 5 + valueNoise(12, x, z, 9) * 1.6) * fade;
  }
  return Math.floor(Math.max(hill, meadow));
}

type Setter = (x: number, y: number, z: number, id: number) => void;

function makeSetter(world: VoxelWorld): Setter {
  return (x, y, z, id) => {
    world.setBlock(SYS, x, y, z, id);
  };
}

function fillBox(set: Setter, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, id: number): void {
  for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) set(x, y, z, id);
}

function tree(set: Setter, world: VoxelWorld, x: number, y: number, z: number, seed: number, big = false): void {
  const r = rng(seed);
  const trunk = (big ? 6 : 4) + Math.floor(r() * 2);
  for (let i = 0; i < trunk; i++) set(x, y + i, z, BK.log);
  const top = y + trunk;
  const rad = big ? 3 : 2;
  for (let dy = -rad; dy <= rad; dy++) {
    for (let dz = -rad - 1; dz <= rad + 1; dz++) {
      for (let dx = -rad - 1; dx <= rad + 1; dx++) {
        const d = Math.hypot(dx, dy * 1.25, dz);
        if (d > rad + 0.6) continue;
        if (d > rad - 0.4 && r() < 0.35) continue;
        const bx = x + dx;
        const by = top + dy;
        const bz = z + dz;
        if (world.getBlock(bx, by, bz) !== BK.air) continue;
        set(bx, by, bz, BK.leaves);
      }
    }
  }
  // A few apples / blossoms make trees read as cared for.
  for (let i = 0; i < 3; i++) {
    const ax = x + Math.floor(r() * 5) - 2;
    const az = z + Math.floor(r() * 5) - 2;
    const ay = top - rad - 1;
    if (world.getBlock(ax, ay + 1, az) === BK.leaves && world.getBlock(ax, ay, az) === BK.air) {
      set(ax, ay + 1, az, r() < 0.5 ? BK.woolRed : BK.woolPink);
    }
  }
}

function lampPost(set: Setter, x: number, y: number, z: number, h = 3): void {
  for (let i = 0; i < h; i++) set(x, y + i, z, BK.fence);
  set(x, y + h, z, BK.lantern);
}

function flowerPatch(set: Setter, x0: number, z0: number, x1: number, z1: number, y: number, seed: number): void {
  const r = rng(seed);
  for (let z = z0; z <= z1; z++) {
    for (let x = x0; x <= x1; x++) {
      const t = r();
      set(x, y, z, t < 0.3 ? BK.flowerRed : t < 0.55 ? BK.flowerYellow : t < 0.75 ? BK.flowerBlue : BK.tallGrass);
    }
  }
}

/** Gable roof along x: ridge parallel to x, slopes to -z and +z. */
function gableRoofX(set: Setter, x0: number, x1: number, z0: number, z1: number, yBase: number, id: number, gable: number): number {
  let k = 0;
  for (; z0 + k <= z1 - k; k++) {
    const y = yBase + k;
    for (let x = x0 - 1; x <= x1 + 1; x++) {
      set(x, y, z0 + k - 1, id);
      set(x, y, z1 - k + 1, id);
      if (z1 - k - (z0 + k) <= 1) {
        for (let z = z0 + k; z <= z1 - k; z++) set(x, y, z, id);
      }
    }
    // gable triangles fill
    for (let z = z0 + k; z <= z1 - k; z++) {
      set(x0, y, z, gable);
      set(x1, y, z, gable);
    }
  }
  return yBase + k;
}

/** Gable roof along z (ridge parallel to z). */
function gableRoofZ(set: Setter, x0: number, x1: number, z0: number, z1: number, yBase: number, id: number, gable: number): number {
  let k = 0;
  for (; x0 + k <= x1 - k; k++) {
    const y = yBase + k;
    for (let z = z0 - 1; z <= z1 + 1; z++) {
      set(x0 + k - 1, y, z, id);
      set(x1 - k + 1, y, z, id);
      if (x1 - k - (x0 + k) <= 1) {
        for (let x = x0 + k; x <= x1 - k; x++) set(x, y, z, id);
      }
    }
    for (let x = x0 + k; x <= x1 - k; x++) {
      set(x, y, z0, gable);
      set(x, y, z1, gable);
    }
  }
  return yBase + k;
}

function* terrain(world: VoxelWorld, set: Setter): Generator<void> {
  for (let z = TERRAIN_MIN; z < TERRAIN_MAX; z++) {
    for (let x = TERRAIN_MIN; x < TERRAIN_MAX; x++) {
      const h = terrainHeight(x, z);
      for (let y = -2; y <= h; y++) {
        set(x, y, z, y === h ? BK.grass : y >= h - 2 ? BK.dirt : BK.stone);
      }
    }
    // a pause point every 16 rows (one chunk row of the 240 x 240 m ground)
    if ((z - TERRAIN_MIN) % 16 === 15) yield;
  }
  void world;
}

function roads(set: Setter): void {
  // Main cross roads from the plaza gates (docs/03 3.5: four gates), cobble curbs.
  const paveX = (z0: number, z1: number, x0: number, x1: number): void => {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) set(x, 0, z, BK.road);
    }
  };
  paveX(142, 145, 100, 127); // west road toward the shop
  paveX(142, 145, 160, 192); // east road toward the cafe
  paveX(160, 190, 142, 145); // south road
  for (let x = 100; x <= 192; x++) {
    if (x >= 128 && x <= 159) continue;
    set(x, 0, 141, BK.cobble);
    set(x, 0, 146, BK.cobble);
  }
  for (let z = 160; z <= 190; z++) {
    set(141, 0, z, BK.cobble);
    set(146, 0, z, BK.cobble);
  }
}

function plaza(world: VoxelWorld, set: Setter): void {
  const cx = 144;
  const cz = 144;
  for (let z = 128; z <= 159; z++) {
    for (let x = 128; x <= 159; x++) {
      const d = Math.hypot(x + 0.5 - cx, z + 0.5 - cz);
      const edge = x === 128 || x === 159 || z === 128 || z === 159;
      let id: number = BK.stoneBrick;
      if (edge) id = BK.granite;
      else if (d > 6 && d < 7.2) id = BK.marble;
      else if (d >= 7.2 && d < 8.2) id = BK.granite;
      else if (d > 11 && ((x + z) & 1) === 0) id = BK.cobble;
      set(x, 0, z, id);
    }
  }
  // Fountain: rim, water basin, center pillar with a bowl.
  for (let z = cz - 5; z <= cz + 5; z++) {
    for (let x = cx - 5; x <= cx + 5; x++) {
      const d = Math.hypot(x + 0.5 - cx, z + 0.5 - cz);
      if (d < 4.6 && d >= 3.6) set(x, 1, z, BK.marble);
      else if (d < 3.6) {
        set(x, 0, z, BK.stoneBrick);
        if (d >= 1.5) set(x, 1, z, BK.water);
      }
    }
  }
  fillBox(set, cx - 1, 1, cz - 1, cx, 2, cz, BK.marble);
  for (let z = cz - 2; z <= cz + 1; z++) {
    for (let x = cx - 2; x <= cx + 1; x++) {
      const corner = (x === cx - 2 || x === cx + 1) && (z === cz - 2 || z === cz + 1);
      if (!corner) set(x, 3, z, BK.marble);
    }
  }
  fillBox(set, cx - 1, 3, cz - 1, cx, 3, cz, BK.water);
  set(cx - 1, 4, cz - 1, BK.goldTrim);
  set(cx, 4, cz, BK.goldTrim);
  set(cx - 1, 4, cz, BK.marble);
  set(cx, 4, cz - 1, BK.marble);

  // Lamps at the inner corners.
  for (const [x, z] of [[134, 134], [153, 134], [134, 153], [153, 153]] as const) lampPost(set, x, 1, z, 3);

  // Flower beds with small trees in the four corners.
  // The south-west corner is where the plaza meets the build plot's side gate, so that bed sits further north.
  const beds: Array<[number, number]> = [[130, 130], [155, 130], [130, 149], [155, 155]];
  beds.forEach(([bx, bz], i) => {
    fillBox(set, bx - 1, 0, bz - 1, bx + 2, 0, bz + 2, BK.grass);
    for (let k = -2; k <= 3; k++) {
      set(bx + k, 1, bz - 2, BK.stoneSlab);
      set(bx + k, 1, bz + 3, BK.stoneSlab);
      set(bx - 2, 1, bz + k, BK.stoneSlab);
      set(bx + 3, 1, bz + k, BK.stoneSlab);
    }
    flowerPatch(set, bx - 1, bz - 1, bx + 2, bz + 2, 1, 40 + i);
    if (i % 2 === 0) tree(set, world, bx, 1, bz, 70 + i);
    else set(bx, 1, bz, BK.flowerPot);
  });

  // Benches facing the fountain.
  const bench = (x: number, z: number, alongX: boolean): void => {
    for (let k = 0; k < 3; k++) set(alongX ? x + k : x, 1, alongX ? z : z + k, BK.stoneSlab);
  };
  bench(139, 136, true);
  bench(147, 136, true);
  bench(139, 151, true);
  bench(147, 151, true);
  bench(136, 139, false);
  bench(151, 147, false);

  // Notice board (north-east) and a mailbox.
  for (let y = 1; y <= 3; y++) {
    set(149, y, 130, BK.log);
    set(153, y, 130, BK.log);
  }
  fillBox(set, 150, 2, 130, 152, 3, 130, BK.chalkboard);
  for (let x = 149; x <= 153; x++) set(x, 4, 130, BK.roofRed);
  set(135, 1, 130, BK.woolBlue);
  set(135, 2, 130, BK.woolRed);

  // Gates with bunting on the four roads.
  const bunting = [BK.woolRed, BK.woolYellow, BK.woolBlue, BK.woolGreen];
  const gate = (alongX: boolean, fixed: number): void => {
    for (let y = 1; y <= 5; y++) {
      if (alongX) {
        set(141, y, fixed, BK.log);
        set(146, y, fixed, BK.log);
      } else {
        set(fixed, y, 141, BK.log);
        set(fixed, y, 146, BK.log);
      }
    }
    for (let k = 141; k <= 146; k++) {
      if (alongX) set(k, 6, fixed, BK.oakPlank);
      else set(fixed, 6, k, BK.oakPlank);
    }
    for (let k = 142; k <= 145; k++) {
      const id = bunting[k % 4]!;
      if (alongX) set(k, 5, fixed, id);
      else set(fixed, 5, k, id);
    }
    if (alongX) {
      set(141, 7, fixed, BK.lantern);
      set(146, 7, fixed, BK.lantern);
    } else {
      set(fixed, 7, 141, BK.lantern);
      set(fixed, 7, 146, BK.lantern);
    }
  };
  gate(true, 128);
  gate(true, 159);
  gate(false, 128);
  gate(false, 159);
}

function honeyCafe(set: Setter): void {
  const x0 = 166;
  const x1 = 178;
  const z0 = 128;
  const z1 = 140;
  fillBox(set, x0, 0, z0, x1, 0, z1, BK.oakPlank);
  for (let y = 1; y <= 5; y++) {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const wall = x === x0 || x === x1 || z === z0 || z === z1;
        if (!wall) continue;
        const corner = (x === x0 || x === x1) && (z === z0 || z === z1);
        let id: number = y === 1 ? BK.stoneBrick : BK.birchPlank;
        if (corner) id = BK.log;
        else if ((y === 3 || y === 4) && (z === z0 || z === z1) && x % 3 === 0) id = BK.glass;
        else if ((y === 3 || y === 4) && x === x1 && z % 3 === 0) id = BK.glass;
        set(x, y, z, id);
      }
    }
  }
  // Front: counter window and a door.
  for (let z = 131; z <= 137; z++) {
    set(x0, 1, z, BK.darkPlank);
    set(x0, 2, z, BK.air);
    set(x0, 3, z, BK.air);
  }
  set(x0, 1, 138, BK.air);
  set(x0, 2, 138, BK.air);
  set(x0, 1, 139, BK.birchPlank);
  // Honey on the counter.
  set(x0, 2, 131, BK.honeycomb);
  set(x0, 2, 137, BK.flowerPot);
  // Ceiling, interior shelves and lights.
  fillBox(set, x0 + 1, 6, z0 + 1, x1 - 1, 6, z1 - 1, BK.oakPlank);
  // Back wall: low light-wood cabinets, then one row of display cubbies (honey jar + mug) broken by windows and a
  // menu board in the middle, honeycomb tiles above - a cafe wall, not a wall of shelves.
  const menuZ = Math.floor((z0 + z1) / 2);
  for (let z = z0 + 1; z <= z1 - 1; z++) {
    set(x1 - 1, 1, z, BK.birchPlank);
    set(x1 - 1, 2, z, z === menuZ ? BK.chalkboard : z % 2 === 0 ? BK.jarShelf : BK.glass);
    set(x1 - 1, 3, z, z % 2 === 0 ? BK.honeycomb : BK.oakPlank);
  }
  set(170, 5, 131, BK.lantern);
  set(170, 5, 137, BK.lantern);
  set(174, 5, 134, BK.lantern);
  for (const [x, z] of [[171, 132], [171, 136], [174, 132], [174, 136]] as const) {
    set(x, 1, z, BK.fence);
    set(x, 2, z, BK.carpet);
  }
  // Roof with a little overhang, then the walls of the gables.
  for (let y = 6; y <= 6; y++) {
    for (let z = z0; z <= z1; z++) {
      set(x0, y, z, BK.birchPlank);
      set(x1, y, z, BK.birchPlank);
    }
  }
  gableRoofX(set, x0, x1, z0, z1, 7, BK.roofRed, BK.birchPlank);
  // Striped awning over the counter.
  for (let z = 130; z <= 138; z++) {
    const stripe = z % 2 === 0 ? BK.woolYellow : BK.woolWhite;
    set(x0 - 1, 4, z, stripe);
    set(x0 - 2, 4, z, stripe);
  }
  // Giant honey pot sign on the front gable, with a bee.
  for (let y = 8; y <= 11; y++) {
    for (let z = 132; z <= 136; z++) {
      const round = (y === 8 || y === 11) && (z === 132 || z === 136);
      if (!round) set(x0 - 1, y, z, BK.terracottaHoney);
    }
  }
  for (let z = 133; z <= 135; z++) set(x0 - 1, 12, z, BK.woolOrange);
  set(x0 - 1, 10, 134, BK.honeycomb);
  set(x0 - 1, 9, 133, BK.honeycomb);
  set(x0 - 1, 7, 135, BK.honeycomb);
  set(x0 - 2, 11, 138, BK.woolYellow);
  set(x0 - 2, 11, 139, BK.darkPlank);
  set(x0 - 2, 11, 140, BK.woolYellow);
  set(x0 - 2, 12, 139, BK.glass);
  // Terrace with tables, stools and potted flowers.
  fillBox(set, 161, 0, 128, 165, 0, 140, BK.oakPlank);
  for (const [x, z] of [[162, 130], [162, 138]] as const) {
    set(x, 1, z, BK.fence);
    set(x, 2, z, BK.carpet);
    set(x + 1, 1, z, BK.stoneSlab);
    set(x - 1, 1, z, BK.stoneSlab);
  }
  set(165, 1, 129, BK.chalkboard);
  set(165, 2, 129, BK.chalkboard);
  set(161, 1, 128, BK.flowerPot);
  set(161, 1, 140, BK.flowerPot);
  lampPost(set, 161, 1, 132, 3);
  // Beehives by the side wall.
  set(179, 1, 130, BK.hay);
  set(179, 2, 130, BK.honeycomb);
  set(179, 1, 132, BK.hay);
}

function tradeShop(set: Setter): void {
  const x0 = 110;
  const x1 = 122;
  const z0 = 128;
  const z1 = 140;
  fillBox(set, x0, 0, z0, x1, 0, z1, BK.pinePlank);
  for (let y = 1; y <= 5; y++) {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const wall = x === x0 || x === x1 || z === z0 || z === z1;
        if (!wall) continue;
        const corner = (x === x0 || x === x1) && (z === z0 || z === z1);
        let id: number = y === 1 ? BK.cobble : BK.darkPlank;
        if (corner) id = BK.log;
        else if ((y === 3 || y === 4) && (z === z0 || z === z1) && x % 3 === 1) id = BK.glass;
        set(x, y, z, id);
      }
    }
  }
  for (let z = 131; z <= 137; z++) {
    set(x1, 1, z, BK.crate);
    set(x1, 2, z, BK.air);
    set(x1, 3, z, BK.air);
  }
  set(x1, 1, 130, BK.air);
  set(x1, 2, 130, BK.air);
  // Goods on the counter (things to trade).
  set(x1, 2, 131, BK.woolRed);
  set(x1, 2, 133, BK.honeycomb);
  set(x1, 2, 137, BK.flowerPot);
  fillBox(set, x0 + 1, 6, z0 + 1, x1 - 1, 6, z1 - 1, BK.pinePlank);
  for (let z = z0; z <= z1; z++) {
    set(x0, 6, z, BK.darkPlank);
    set(x1, 6, z, BK.darkPlank);
  }
  for (let z = z0 + 1; z <= z1 - 1; z++) {
    set(x0 + 1, 1, z, z % 3 === 0 ? BK.chest : BK.barrel);
    set(x0 + 1, 2, z, z % 2 === 0 ? BK.jarShelf : BK.crate);
    set(x0 + 1, 3, z, z % 2 === 0 ? BK.woolBlue : BK.woolGreen);
  }
  set(116, 5, 131, BK.lantern);
  set(116, 5, 137, BK.lantern);
  gableRoofX(set, x0, x1, z0, z1, 7, BK.roofBlue, BK.darkPlank);
  for (let z = 130; z <= 138; z++) {
    const stripe = z % 2 === 0 ? BK.woolBlue : BK.woolWhite;
    set(x1 + 1, 4, z, stripe);
    set(x1 + 2, 4, z, stripe);
  }
  // Swap sign: two arrows (orange to the right, blue to the left).
  const sx = x1 + 1;
  for (let z = 132; z <= 136; z++) {
    set(sx, 10, z, BK.woolOrange);
    set(sx, 8, z, BK.woolBlue);
  }
  set(sx, 11, 135, BK.woolOrange);
  set(sx, 9, 135, BK.woolOrange);
  set(sx, 9, 133, BK.woolBlue);
  set(sx, 7, 133, BK.woolBlue);
  // Market yard: crates, barrels, hay, a cart.
  fillBox(set, 123, 0, 128, 127, 0, 140, BK.gravel);
  set(124, 1, 128, BK.crate);
  set(125, 1, 128, BK.crate);
  set(124, 2, 128, BK.crate);
  set(126, 1, 140, BK.barrel);
  set(125, 1, 140, BK.barrel);
  set(123, 1, 139, BK.hay);
  set(123, 1, 129, BK.barrel);
  set(123, 2, 129, BK.flowerPot);
  lampPost(set, 127, 1, 134, 3);
}

function buildPlot(world: VoxelWorld, set: Setter): void {
  const { x0, x1, z0, z1 } = world.plot; // 100..132 x 156..188 (docs/03 3.5 32 x 32m)
  for (let x = x0; x < x1; x++) {
    for (let z = z0; z < z1; z++) {
      const edge = x === x0 || x === x1 - 1 || z === z0 || z === z1 - 1;
      if (!edge) continue;
      if (z === z0 && x >= 120 && x <= 123) continue; // gate
      if (x === x1 - 1 && z >= 157 && z <= 158) continue; // side gate toward the plaza
      set(x, 1, z, BK.fence);
    }
  }
  for (const x of [119, 124]) {
    set(x, 1, z0, BK.log);
    set(x, 2, z0, BK.log);
    set(x, 3, z0, BK.lantern);
  }
  // Path from the plaza corner to the gate and into the plot.
  for (let x = 120; x <= 136; x++) for (let z = 157; z <= 158; z++) set(x, 0, z, BK.path);
  for (let z = 156; z <= 166; z++) for (let x = 120; x <= 123; x++) set(x, 0, z, BK.path);
  // Storage chest (보관 상자) and a nameplate by the gate.
  set(118, 1, 158, BK.chest);
  set(125, 1, 155, BK.nameplate); // outside the north gate, facing the road
  // A started foundation and material piles, so the first thing to do is obvious.
  for (let x = 106; x <= 114; x++) {
    for (let z = 168; z <= 176; z++) {
      const edge = x === 106 || x === 114 || z === 168 || z === 176;
      set(x, 0, z, edge ? BK.stoneBrick : BK.oakPlank);
    }
  }
  for (let y = 1; y <= 2; y++) {
    for (let x = 106; x <= 110; x++) set(x, y, 176, BK.brick);
    set(106, y, 175, BK.brick);
    set(106, y, 174, BK.brick);
  }
  set(106, 1, 176, BK.log);
  for (let y = 1; y <= 4; y++) set(114, y, 168, BK.scaffold);
  const piles: Array<[number, number, number, number]> = [
    [117, 170, BK.brick, 3],
    [117, 172, BK.oakPlank, 2],
    [117, 174, BK.glass, 1],
    [119, 170, BK.roofRed, 2],
    [119, 172, BK.woolYellow, 1]
  ];
  for (const [x, z, id, h] of piles) for (let y = 1; y <= h; y++) set(x, y, z, id);
  flowerPatch(set, 126, 180, 129, 184, 1, 91);
  tree(set, world, 103, 1, 184, 93, true);
}

function openHill(world: VoxelWorld, set: Setter): void {
  // Path up the hill from the north gate.
  for (let z = 104; z <= 127; z++) {
    for (let x = 142; x <= 146; x++) {
      const h = terrainHeight(x, z);
      if (x === 142 || x === 146) continue;
      set(x, h, z, BK.path);
    }
  }
  const top = terrainHeight(HILL.x, HILL.z);
  // Flat top with a picnic blanket and benches.
  for (let z = HILL.z - 4; z <= HILL.z + 4; z++) {
    for (let x = HILL.x - 4; x <= HILL.x + 4; x++) {
      if (Math.hypot(x + 0.5 - HILL.x, z + 0.5 - HILL.z) > 4.6) continue;
      for (let y = terrainHeight(x, z) + 1; y <= top; y++) set(x, y, z, BK.dirt);
      set(x, top, z, BK.grass);
      for (let y = top + 1; y <= top + 3; y++) if (world.getBlock(x, y, z) !== BK.air) set(x, y, z, BK.air);
    }
  }
  for (let z = HILL.z - 1; z <= HILL.z; z++) for (let x = HILL.x + 2; x <= HILL.x + 3; x++) set(x, top + 1, z, BK.carpet);
  set(HILL.x - 3, top + 1, HILL.z + 2, BK.stoneSlab);
  set(HILL.x - 3, top + 1, HILL.z + 3, BK.stoneSlab);
  // Windmill tower (sails are a moving prop drawn by the engine).
  const wx = HILL.x - 7;
  const wz = HILL.z - 4;
  const base = terrainHeight(wx, wz);
  for (let y = base + 1; y <= base + 9; y++) {
    for (let z = wz - 1; z <= wz + 1; z++) {
      for (let x = wx - 1; x <= wx + 1; x++) {
        const corner = (x !== wx) && (z !== wz);
        set(x, y, z, corner ? BK.log : y % 3 === 0 && x === wx && z === wz + 1 ? BK.glass : BK.stoneBrick);
      }
    }
  }
  set(wx, base + 1, wz + 1, BK.door);
  set(wx, base + 2, wz + 1, BK.door);
  gableRoofZ(set, wx - 1, wx + 1, wz - 1, wz + 1, base + 10, BK.roofSlate, BK.stoneBrick);
  tree(set, world, HILL.x + 6, terrainHeight(HILL.x + 6, HILL.z - 3) + 1, HILL.z - 3, 311, true);
  // Flowers all over the slopes.
  const r = rng(404);
  for (let i = 0; i < 260; i++) {
    const a = r() * Math.PI * 2;
    const d = 4 + r() * (HILL.r - 4);
    const x = Math.floor(HILL.x + Math.cos(a) * d);
    const z = Math.floor(HILL.z + Math.sin(a) * d);
    if (x >= 141 && x <= 147 && z > HILL.z) continue;
    const h = terrainHeight(x, z);
    if (world.getBlock(x, h, z) !== BK.grass || world.getBlock(x, h + 1, z) !== BK.air) continue;
    const t = r();
    set(x, h + 1, z, t < 0.3 ? BK.flowerRed : t < 0.6 ? BK.flowerYellow : t < 0.8 ? BK.flowerBlue : BK.tallGrass);
  }
}

function cottage(set: Setter, x0: number, z0: number, w: number, d: number, wall: number, roof: number, doorFacesZ: boolean): void {
  const x1 = x0 + w - 1;
  const z1 = z0 + d - 1;
  fillBox(set, x0, 0, z0, x1, 0, z1, BK.oakPlank);
  for (let y = 1; y <= 4; y++) {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const isWall = x === x0 || x === x1 || z === z0 || z === z1;
        if (!isWall) continue;
        const corner = (x === x0 || x === x1) && (z === z0 || z === z1);
        let id = corner ? BK.log : wall;
        if (y === 2 && !corner && (x + z) % 3 === 0) id = BK.glass;
        set(x, y, z, id);
      }
    }
  }
  const midX = Math.floor((x0 + x1) / 2);
  const midZ = Math.floor((z0 + z1) / 2);
  if (doorFacesZ) {
    set(midX, 1, z1, BK.door);
    set(midX, 2, z1, BK.door);
    set(midX + 1, 1, z1 + 1, BK.flowerPot);
  } else {
    set(x0, 1, midZ, BK.door);
    set(x0, 2, midZ, BK.door);
    set(x0 - 1, 1, midZ + 1, BK.flowerPot);
  }
  if (w <= d) gableRoofZ(set, x0, x1, z0, z1, 5, roof, wall);
  else gableRoofX(set, x0, x1, z0, z1, 5, roof, wall);
}

function scatter(world: VoxelWorld, set: Setter): void {
  const reserved = (x: number, z: number): boolean => {
    if (x >= 98 && x <= 194 && z >= 124 && z <= 192) {
      // Town core: only the meadow strips between buildings are free.
      if (x >= 126 && x <= 162 && z >= 126 && z <= 162) return true;
      if (x >= 106 && x <= 128 && z >= 124 && z <= 144) return true;
      if (x >= 158 && x <= 182 && z >= 124 && z <= 144) return true;
      if (x >= 98 && x <= 134 && z >= 154 && z <= 190) return true;
      if (x >= 140 && x <= 147) return true;
      if (z >= 140 && z <= 147) return true;
    }
    if (Math.hypot(x - HILL.x, z - HILL.z) < 7) return true;
    if (x >= 140 && x <= 148 && z >= 100 && z <= 128) return true;
    if (Math.hypot(x - (HILL.x - 7), z - (HILL.z - 4)) < 4) return true;
    return false;
  };
  const r = rng(2026);
  const trees: Array<[number, number]> = [];
  for (let i = 0; i < 900 && trees.length < 150; i++) {
    const x = TERRAIN_MIN + 4 + Math.floor(r() * (TERRAIN_MAX - TERRAIN_MIN - 8));
    const z = TERRAIN_MIN + 4 + Math.floor(r() * (TERRAIN_MAX - TERRAIN_MIN - 8));
    if (reserved(x, z)) continue;
    const near = Math.max(Math.abs(x - TOWN_CENTER.x), Math.abs(z - TOWN_CENTER.z));
    if (near < 40 && r() < 0.5) continue;
    if (trees.some(([tx, tz]) => Math.abs(tx - x) < 6 && Math.abs(tz - z) < 6)) continue;
    trees.push([x, z]);
  }
  trees.forEach(([x, z], i) => {
    const h = terrainHeight(x, z);
    tree(set, world, x, h + 1, z, 1000 + i, hash2i(5, x, z) < 0.25);
  });
  for (let z = TERRAIN_MIN; z < TERRAIN_MAX; z++) {
    for (let x = TERRAIN_MIN; x < TERRAIN_MAX; x++) {
      if (reserved(x, z)) continue;
      const n = hash2i(77, x, z);
      if (n > 0.075) continue;
      const h = terrainHeight(x, z);
      if (world.getBlock(x, h, z) !== BK.grass || world.getBlock(x, h + 1, z) !== BK.air) continue;
      const t = hash2i(78, x, z);
      set(x, h + 1, z, t < 0.6 ? BK.tallGrass : t < 0.75 ? BK.flowerYellow : t < 0.9 ? BK.flowerRed : BK.flowerBlue);
    }
  }
}

/** Build the whole town into `world`. Returns the number of setBlock calls (for the loading bar and tests). */
/**
 * The town in small steps: every `yield` is a point where a caller on the main thread may hand the frame back (the
 * client builds the town between frames so no single task blocks for long; docs/08 TBT). The order of writes is the
 * same as `buildTown`, so both give the identical world.
 */
export function* buildTownSteps(world: VoxelWorld, counter?: { calls: number }): Generator<void, number> {
  let calls = 0;
  const raw = makeSetter(world);
  const set: Setter = (x, y, z, id) => {
    calls++;
    raw(x, y, z, id);
  };
  yield* terrain(world, set);
  roads(set);
  plaza(world, set);
  yield;
  honeyCafe(set);
  tradeShop(set);
  yield;
  buildPlot(world, set);
  openHill(world, set);
  yield;
  cottage(set, 170, 152, 7, 8, BK.brick, BK.roofSlate, false);
  cottage(set, 160, 166, 8, 7, BK.oakPlank, BK.thatch, false);
  cottage(set, 110, 110, 8, 7, BK.birchPlank, BK.roofRed, true);
  cottage(set, 168, 108, 7, 8, BK.stoneBrick, BK.roofBlue, true);
  yield;
  scatter(world, set);
  if (counter) counter.calls = calls;
  return calls;
}

/** The whole town at once (server, tests, tools). */
export function buildTown(world: VoxelWorld): number {
  const steps = buildTownSteps(world);
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
  }
}
