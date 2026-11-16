/**
 * Play places in the central sector (docs/01 6장 놀이 방식, docs/03 3.5 중앙 섹터, D2 채굴·환전, D4 커리어): the market
 * hall (tailor, makers' counter, exchange, office) with the mine elevator, and the three mine floors under it.
 *
 * Coordinates are offsets from TOWN_CENTER (world lane 2026-11-16: the random world will move the central sector's
 * origin; everything here follows it). Every place keeps 8 m or more from the lesson route (plaza -> honey cafe ->
 * trade shop and the roads between) and 6 m or more inside the terrain edge (tested in play-sites.test.ts).
 * Every block goes through `VoxelWorld.setBlock` (AGENTS 4.1). Deterministic: no clock, no Math.random.
 */
import type { VoxelWorld } from './world.js';
import { TUNING } from './tuning.js';

/** Same ids as town.ts BK (kept local so this file has no import cycle with town.ts). */
const B = {
  air: 0,
  stone: 1,
  dirt: 2,
  grass: 3,
  road: 5,
  bedrock: 6,
  marble: 15,
  oakPlank: 18,
  log: 21,
  door: 23,
  glass: 9,
  lantern: 27,
  ironPlate: 29,
  goldTrim: 31,
  ironBars: 32,
  roofSlate: 35,
  carpet: 43,
  flowerPot: 44,
  woolRed: 52,
  woolYellow: 53,
  woolBlue: 54,
  woolPurple: 66,
  crate: 57,
  barrel: 58,
  cobble: 60,
  darkPlank: 62,
  path: 64,
  chalkboard: 69,
  stoneBrick: 70,
  oreCoal: 71,
  oreIron: 72,
  oreGold: 73,
  oreRuby: 74,
  oreDiamond: 75
} as const;

const SYS = { id: 'system_gen', isSystemGen: true } as const;
type Setter = (x: number, y: number, z: number, id: number) => void;

/** The central sector's origin (town.ts TOWN_CENTER). Kept as a parameter so a moved sector moves these places. */
export interface Origin {
  x: number;
  z: number;
}
const ORIGIN: Origin = { x: 144, z: 144 };

/** Market hall footprint (relative): x 38..62, z 6..18 -> world 182..206, 150..162 with the town at 144,144. */
const HALL = { dx0: 38, dx1: 62, dz0: 6, dz1: 18, wallH: 5 } as const;
/** Counters along the back (south) wall, west to east; each 4 wide. The keeper stands behind, the child in front. */
export const PLAY_COUNTERS = [
  { id: 'tailor', npc: 'tailor', ctx: 'boutique', dx0: 40 },
  { id: 'workshop', npc: 'maker', ctx: 'makers_lab', dx0: 46 },
  { id: 'exchange', npc: 'exchange_clerk', ctx: 'exchange', dx0: 52 },
  { id: 'office', npc: 'office_boss', ctx: 'boss', dx0: 58 }
] as const;
export type PlayCounterId = (typeof PLAY_COUNTERS)[number]['id'];

/** Mine floors under the hall (docs/03 3.2 광산 −150 ~ −9; each floor sits where its ores occur, D2 표). */
export const MINE_FLOORS = [
  { id: 'mine', label: 'B1', floorY: -24, ores: ['coal', 'iron'] },
  { id: 'mine_deep', label: 'B2', floorY: -72, ores: ['gold', 'ruby', 'iron'] },
  { id: 'mine_core', label: 'B3', floorY: -120, ores: ['diamond', 'gold'] }
] as const;
export type MineFloorId = (typeof MINE_FLOORS)[number]['id'];

const ORE_BLOCK: Readonly<Record<string, number>> = {
  coal: B.oreCoal,
  iron: B.oreIron,
  gold: B.oreGold,
  ruby: B.oreRuby,
  diamond: B.oreDiamond
};

export interface PlaySpot {
  x: number;
  y: number;
  z: number;
  /** facing = (sin yaw, 0, cos yaw); yaw 0 faces +z (south) */
  yaw: number;
}

export interface MineVein {
  /** Stable id (floor + index): the server's respawn key. */
  id: string;
  floor: MineFloorId;
  ore: string;
  /** The vein block (world coordinates). */
  x: number;
  y: number;
  z: number;
}

/** Elevator cell of the hall (inside, north-west corner) and of each mine floor (same column). */
function elevatorCell(o: Origin): { x: number; z: number } {
  return { x: o.x + HALL.dx0 + 2, z: o.z + HALL.dz0 + 2 };
}

/** Where the child stands at a counter (2.2 m in front of the keeper, facing it) and where the keeper stands. */
export function counterSpots(id: PlayCounterId, o: Origin = ORIGIN): { player: PlaySpot; npc: PlaySpot } {
  const c = PLAY_COUNTERS.find((k) => k.id === id)!;
  const x = o.x + c.dx0 + 1.5;
  const back = o.z + HALL.dz1 - 1;
  return {
    npc: { x, y: 1, z: back + 0.4, yaw: Math.PI },
    player: { x, y: 1, z: back + 0.4 - 2.2, yaw: 0 }
  };
}

/** The office customer waits by the hall's east window (talked to during a shift, docs/03 D4 고객 응대). */
export function customerSpot(o: Origin = ORIGIN): PlaySpot {
  return { x: o.x + HALL.dx1 - 2.5, y: 1, z: o.z + HALL.dz0 + 3.5, yaw: -Math.PI / 2 };
}

/** The elevator stop of the hall or a mine floor (where the child arrives). */
export function elevatorSpot(floor: 'hall' | MineFloorId, o: Origin = ORIGIN): PlaySpot {
  const e = elevatorCell(o);
  const y = floor === 'hall' ? 1 : MINE_FLOORS.find((f) => f.id === floor)!.floorY + 1;
  return { x: e.x + 0.5, y, z: e.z + 0.5, yaw: 0 };
}

/** The front door of the hall (outside, on the path from the east road). */
export function hallDoor(o: Origin = ORIGIN): { x: number; z: number } {
  return { x: o.x + (HALL.dx0 + HALL.dx1) / 2 + 0.5, z: o.z + HALL.dz0 - 1.5 };
}

/** The hall and mine footprint (relative box, for the distance tests and the world lane's sector planner). */
export const PLAY_SITE_BOXES = [{ id: 'market_hall', dx0: HALL.dx0 - 2, dx1: HALL.dx1 + 2, dz0: HALL.dz0 - 5, dz1: HALL.dz1 + 2 }] as const;

/** All veins, deterministic. Walls of each floor carry its ores in turn (no random: the same mine on every device). */
export function mineVeins(o: Origin = ORIGIN): MineVein[] {
  const out: MineVein[] = [];
  const x0 = o.x + HALL.dx0 + 1;
  const x1 = o.x + HALL.dx1 - 1;
  // the vein blocks sit in the south and north walls of the room (the wall cells themselves)
  const wallS = o.z + HALL.dz1;
  const wallN = o.z + HALL.dz0;
  for (const f of MINE_FLOORS) {
    // every 3rd cell, clear of the elevator corner and the timber frames; alternate heights 1 and 2
    let i = 0;
    for (let x = x0 + 5; x <= x1 - 1; x += 3) {
      for (const z of [wallS, wallN]) {
        const ore = f.ores[i % f.ores.length]!;
        out.push({ id: `${f.id}.${i}`, floor: f.id, ore, x, y: f.floorY + 1 + (i % 2), z });
        i++;
      }
    }
  }
  return out;
}

export function veinById(id: string, o: Origin = ORIGIN): MineVein | null {
  return mineVeins(o).find((v) => v.id === id) ?? null;
}

/** Tool tier needed for an ore (docs/03 D2 필요 도구), 1 = the wooden pickaxe every child has. */
export function oreToolTier(ore: string): number {
  return TUNING.mining.ores[ore]?.requiredToolTier ?? 99;
}

/** Ground under the hall: flat at y 0, cleared above, so the meadow bumps east of the town do not cut into it. */
function flatten(set: Setter, world: VoxelWorld, x0: number, z0: number, x1: number, z1: number): void {
  for (let z = z0; z <= z1; z++) {
    for (let x = x0; x <= x1; x++) {
      for (let y = 1; y <= 12; y++) if (world.getBlock(x, y, z) !== B.air) set(x, y, z, B.air);
      set(x, 0, z, B.grass);
      set(x, -1, z, B.dirt);
      set(x, -2, z, B.stone);
    }
  }
}

function box(set: Setter, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, id: number): void {
  for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) set(x, y, z, id);
}

function marketHall(set: Setter, world: VoxelWorld, o: Origin): void {
  const x0 = o.x + HALL.dx0;
  const x1 = o.x + HALL.dx1;
  const z0 = o.z + HALL.dz0;
  const z1 = o.z + HALL.dz1;
  flatten(set, world, x0 - 2, z0 - 5, x1 + 2, z1 + 2);
  // the east road runs on to the hall, then a cobble path to the door
  for (let x = o.x + 48; x <= x1 + 2; x++) for (let z = o.z - 2; z <= o.z + 1; z++) set(x, 0, z, B.road);
  const door = hallDoor(o);
  for (let z = o.z + 2; z < z0; z++) for (let x = Math.floor(door.x) - 1; x <= Math.floor(door.x) + 1; x++) set(x, 0, z, B.cobble);
  box(set, x0, 0, z0, x1, 0, z1, B.marble);
  for (let y = 1; y <= HALL.wallH; y++) {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const wall = x === x0 || x === x1 || z === z0 || z === z1;
        if (!wall) continue;
        const corner = (x === x0 || x === x1) && (z === z0 || z === z1);
        let id: number = corner ? B.log : y === 1 ? B.stoneBrick : B.stoneBrick;
        if (!corner && (y === 2 || y === 3) && (z === z0 || x === x1) && (x + z) % 3 === 0) id = B.glass;
        set(x, y, z, id);
      }
    }
  }
  // wide front opening (no door block: the auto-walk goes straight in)
  const dx = Math.floor(door.x);
  for (let y = 1; y <= 3; y++) for (let x = dx - 1; x <= dx + 1; x++) set(x, y, z0, B.air);
  set(dx - 2, 4, z0, B.goldTrim);
  set(dx + 2, 4, z0, B.goldTrim);
  // flat roof with a gold rim, and a big coin sign over the door
  box(set, x0, HALL.wallH + 1, z0, x1, HALL.wallH + 1, z1, B.roofSlate);
  for (let x = x0; x <= x1; x++) {
    set(x, HALL.wallH + 2, z0, B.goldTrim);
    set(x, HALL.wallH + 2, z1, B.goldTrim);
  }
  for (let z = z0; z <= z1; z++) {
    set(x0, HALL.wallH + 2, z, B.goldTrim);
    set(x1, HALL.wallH + 2, z, B.goldTrim);
  }
  for (let y = HALL.wallH + 3; y <= HALL.wallH + 7; y++) {
    for (let x = dx - 2; x <= dx + 2; x++) {
      const r = Math.hypot(x - dx, y - (HALL.wallH + 5));
      if (r <= 2.3) set(x, y, z0, r <= 1.1 ? B.goldTrim : B.woolYellow);
    }
  }
  // lights
  for (let x = x0 + 3; x <= x1 - 3; x += 6) set(x, HALL.wallH, Math.floor((z0 + z1) / 2), B.lantern);
  // counters: a one-high counter in front of each keeper, its color telling what it sells
  const tops: Readonly<Record<PlayCounterId, number>> = { tailor: B.woolPurple, workshop: B.ironPlate, exchange: B.goldTrim, office: B.darkPlank };
  for (const c of PLAY_COUNTERS) {
    const cx0 = o.x + c.dx0;
    for (let x = cx0; x <= cx0 + 3; x++) set(x, 1, z1 - 2, tops[c.id]);
    // a sign board on the back wall above the keeper
    for (let x = cx0; x <= cx0 + 3; x++) set(x, 4, z1, c.id === 'office' ? B.chalkboard : tops[c.id]);
  }
  // goods: rolls of cloth, tools, ore crates, a desk with papers
  set(o.x + 40, 2, z1 - 2, B.woolRed);
  set(o.x + 43, 2, z1 - 2, B.woolBlue);
  set(o.x + 46, 2, z1 - 2, B.crate);
  set(o.x + 55, 2, z1 - 2, B.barrel);
  set(o.x + 61, 1, z1 - 1, B.crate);
  // carpet path from the door, potted plants
  for (let z = z0 + 1; z <= z1 - 4; z++) set(dx, 1, z, B.carpet);
  set(x0 + 1, 1, z1 - 1, B.flowerPot);
  set(x1 - 1, 1, z0 + 1, B.flowerPot);
  // elevator: iron floor, bars on two sides, a lantern
  const e = elevatorCell(o);
  box(set, e.x - 1, 0, e.z - 1, e.x + 1, 0, e.z + 1, B.ironPlate);
  for (let y = 1; y <= 3; y++) {
    set(e.x - 1, y, e.z + 1, B.ironBars);
    set(e.x + 1, y, e.z + 1, B.ironBars);
  }
  set(e.x, 4, e.z, B.lantern);
}

function mineFloor(set: Setter, o: Origin, floorY: number): void {
  const x0 = o.x + HALL.dx0;
  const x1 = o.x + HALL.dx1;
  const z0 = o.z + HALL.dz0;
  const z1 = o.z + HALL.dz1;
  // a stone shell (floor, walls, ceiling) with a 4-high room inside
  box(set, x0, floorY, z0, x1, floorY + 5, z1, B.stone);
  box(set, x0 + 1, floorY + 1, z0 + 1, x1 - 1, floorY + 4, z1 - 1, B.air);
  set(x0, floorY, z0, B.bedrock);
  // timber frames and lanterns (a mine is dark, docs/03 3.2 조도 0: the lanterns are the light)
  for (let x = x0 + 4; x <= x1 - 4; x += 6) {
    for (const z of [z0 + 1, z1 - 1]) {
      set(x, floorY + 1, z, B.log);
      set(x, floorY + 2, z, B.log);
      set(x, floorY + 3, z, B.log);
    }
    for (let z = z0 + 1; z <= z1 - 1; z++) set(x, floorY + 4, z, B.oakPlank);
    set(x, floorY + 3, Math.floor((z0 + z1) / 2), B.lantern);
  }
  // rails down the middle (iron plates) and a cart
  for (let x = x0 + 4; x <= x1 - 2; x++) set(x, floorY, Math.floor((z0 + z1) / 2), B.ironPlate);
  set(x1 - 3, floorY + 1, Math.floor((z0 + z1) / 2), B.crate);
  const e = elevatorCell(o);
  box(set, e.x - 1, floorY, e.z - 1, e.x + 1, floorY, e.z + 1, B.ironPlate);
  set(e.x - 1, floorY + 1, e.z + 1, B.ironBars);
  set(e.x + 1, floorY + 1, e.z + 1, B.ironBars);
}

/**
 * Builds the play places. Called once at the end of `buildTownSteps` (world lane: the random world will move this
 * call into the central sector's generation). Returns nothing; the caller counts setBlock calls through `set`.
 */
export function buildPlaySites(world: VoxelWorld, set?: Setter, o: Origin = ORIGIN): void {
  const put: Setter = set ?? ((x, y, z, id) => void world.setBlock(SYS, x, y, z, id));
  marketHall(put, world, o);
  for (const f of MINE_FLOORS) mineFloor(put, o, f.floorY);
  for (const v of mineVeins(o)) put(v.x, v.y, v.z, ORE_BLOCK[v.ore] ?? B.stone);
}
