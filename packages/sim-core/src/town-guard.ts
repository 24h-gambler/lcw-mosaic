/**
 * The town's protected places (R326 free build, docs/03 D13 "자유 건축"): a child may place and break blocks anywhere
 * in their own world except here. One table for the client (the red outline and the reason at once) and the server
 * (which refuses the same cells, AGENTS 4.7), so what the child sees refused is what the server refuses.
 *
 * What is kept: every building the town builder puts up (`town.ts`: the plaza and fountain, the honey cafe and its
 * terrace, the trade shop and its yard, the four cottages, the windmill and the hill top), the roads and the hill path,
 * the way into the plot (north gate, nameplate, side gate to the plaza), and the walks the NPCs and townsfolk take
 * (scene paths and wanderer routes in apps/client/src/world/town.ts; a client test checks every point of them is here).
 * A protected column is protected at every height: nothing is stacked over a shop roof or across a road.
 *
 * The plot is not in this table: inside the fence its owner builds by the plot rules (`plotCellRule`, fence and chest
 * kept). Trees, flowers and the meadow are free to dig and build on, as in any sandbox.
 */
import { TERRAIN_MAX, TERRAIN_MIN } from './town.js';
import { TUNING } from './tuning.js';

/** A protected box of columns, both ends inclusive. */
export interface GuardBox {
  id: string;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}
/** A protected disc of columns (cell centres within r). */
export interface GuardDisc {
  id: string;
  x: number;
  z: number;
  r: number;
}
/** A protected walk: the cells whose centre is within `half` of the polyline. */
export interface GuardWalk {
  id: string;
  half: number;
  points: ReadonlyArray<readonly [number, number]>;
}

/** Cottage footprint (town.ts `cottage`) plus the roof overhang, the door step and its flower pot. */
function cottageBox(id: string, x0: number, z0: number, w: number, d: number): GuardBox {
  return { id, x0: x0 - 2, x1: x0 + w + 1, z0: z0 - 2, z1: z0 + d + 1 };
}

export const TOWN_GUARD_BOXES: readonly GuardBox[] = [
  // plaza 128..159 with the fountain, lamps and flower beds (town.ts `plaza`), one cell of kerb around it
  { id: 'plaza', x0: 127, x1: 160, z0: 127, z1: 160 },
  // east-west road z 142..145 with the cobble kerbs at 141 and 146 (town.ts `roads`), x 100..192
  { id: 'road_ew', x0: 99, x1: 193, z0: 140, z1: 147 },
  // south road x 142..145, kerbs 141 and 146, z 160..190
  { id: 'road_s', x0: 140, x1: 147, z0: 159, z1: 191 },
  // the path and half-step ramp up the hill from the north gate (town.ts `openHill`), x 142..146, z 104..127
  { id: 'hill_path', x0: 140, x1: 148, z0: 99, z1: 128 },
  // windmill tower x 136..138, z 97..99 with its door, roof and sails
  { id: 'windmill', x0: 134, x1: 140, z0: 94, z1: 101 },
  // honey cafe x 166..178, z 128..140, terrace from x 161, awning and sign at x 164..165, beehives at x 179
  { id: 'honey_cafe', x0: 159, x1: 181, z0: 126, z1: 142 },
  // trade shop x 110..122, z 128..140, market yard to x 127, awning and sign at x 123..124
  { id: 'trade_shop', x0: 108, x1: 128, z0: 126, z1: 142 },
  // the way from the road to the plot's north gate (gate x 120..123 at z 156) and the nameplate at (125, 1, 155)
  { id: 'plot_gate', x0: 118, x1: 126, z0: 147, z1: 155 },
  // the path from the plot's side gate (x 131, z 157..158) to the plaza
  { id: 'plot_side_gate', x0: 132, x1: 136, z0: 155, z1: 160 },
  cottageBox('cottage_brick', 170, 152, 7, 8),
  cottageBox('cottage_thatch', 160, 166, 8, 7),
  cottageBox('cottage_birch', 110, 110, 8, 7),
  cottageBox('cottage_stone', 168, 108, 7, 8)
];

export const TOWN_GUARD_DISCS: readonly GuardDisc[] = [
  // the flat hill top with the picnic blanket, the benches and where the guide stands (town.ts HILL)
  { id: 'hill_top', x: 144, z: 102, r: 6.5 },
  // R2904①: the trail ranger's post out in the open land east of the road (town.ts `trail_ranger`): the ground he stands on stays
  { id: 'ranger_post', x: 200.5, z: 146.5, r: 2.6 }
];

export const TOWN_GUARD_WALKS: readonly GuardWalk[] = [
  // walker.3 (apps/client/src/world/town.ts WANDERERS): down the hill path, across the slope, over the plaza corner
  // to the east road. walker.1 and walker.2 stay on the plaza.
  { id: 'walker_3', half: 1.6, points: [[144, 126], [144, 116], [139, 110], [144, 126], [160, 144], [176, 147]] }
];

/** Where a child may build outside the plot: the generated ground (TERRAIN_MIN..TERRAIN_MAX), nothing over the void. */
export const FREE_BUILD_AREA = { x0: TERRAIN_MIN, x1: TERRAIN_MAX, z0: TERRAIN_MIN, z1: TERRAIN_MAX } as const;

function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

/** Which guard keeps this column (cell x, z), or null. */
export function townGuardAt(x: number, z: number): string | null {
  for (const b of TOWN_GUARD_BOXES) if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1) return b.id;
  const cx = x + 0.5;
  const cz = z + 0.5;
  for (const d of TOWN_GUARD_DISCS) if (Math.hypot(cx - d.x, cz - d.z) <= d.r) return d.id;
  for (const w of TOWN_GUARD_WALKS) {
    for (let i = 0; i + 1 < w.points.length; i++) {
      const a = w.points[i]!;
      const b = w.points[i + 1]!;
      if (segDist(cx, cz, a[0], a[1], b[0], b[1]) <= w.half) return w.id;
    }
  }
  return null;
}

let mask: Uint8Array | null = null;
/** Is this column one of the town's protected places? A precomputed 288 x 288 table (83 KB): aim runs every frame. */
export function townProtected(x: number, z: number): boolean {
  const sx = TUNING.world.sizeX;
  const sz = TUNING.world.sizeZ;
  if (x < 0 || z < 0 || x >= sx || z >= sz) return true;
  if (!mask) {
    const m = new Uint8Array(sx * sz);
    for (let zz = 0; zz < sz; zz++) for (let xx = 0; xx < sx; xx++) m[zz * sx + xx] = townGuardAt(xx, zz) ? 1 : 0;
    mask = m;
  }
  return mask[z * sx + x] === 1;
}
