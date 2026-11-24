/**
 * Building on my plot (docs/03 D13, WP-201/202/207): the one rule set the client (optimistic) and the server
 * (authoritative, AGENTS 4) both run, so a block the child sees placed is a block the server accepts — and when the
 * two disagree the server's answer wins. One input is one block; every block change goes through `world.setBlock`.
 *
 * Inventory model (D13 "5칸 슬롯의 결핍감은 들고 다니는 것에만"): five carried slots, each one stack of a block or a
 * piece of furniture; the storage chest is unlimited. Furniture is not a block (D13 "격자 위에 놓이는 개체"): it sits
 * on a cell of the plot and counts for the room check.
 */
import { BLOCK_PALETTE, FURNITURE_REGISTRY, RESIDENT_REGISTRY, type FurnitureDef, type ResidentDef } from '@lcw/content';
import { BK } from './town.js';
import { TUNING } from './tuning.js';
import { VoxelWorld } from './world.js';

/** The first 40 build blocks (D13 palette, 1차 40종) in the order the chest panel shows them. */
export const BUILD_PALETTE: readonly number[] = [
  BK.grass, BK.dirt, BK.sand, BK.gravel, BK.stone, BK.cobble, BK.stoneBrick, BK.brick, BK.granite, BK.marble,
  BK.stoneSlab, BK.stoneStair, BK.oakPlank, BK.birchPlank, BK.pinePlank, BK.darkPlank, BK.plank, BK.log, BK.fence, BK.door,
  BK.glass, BK.stainedGlass, BK.torch, BK.lantern, BK.roofRed, BK.roofBlue, BK.roofSlate, BK.thatch, BK.woolWhite, BK.woolRed,
  BK.woolYellow, BK.woolBlue, BK.woolGreen, BK.carpet, BK.flowerPot, BK.leaves, BK.hay, BK.jarShelf, BK.scaffold, BK.nameplate
];

export const BUILD_REACH_M = TUNING.building.maxReachMeters;
/** Holding the place button repeats at most this often (still one block per step). */
export const BUILD_PLACE_PER_S = TUNING.building.maxPlacePerSec;
export const BUILD_UNDO_LIMIT = TUNING.building.undoHistoryMax;
export const SLOT_COUNT = 5;
export const STACK_MAX = 64;
/** Requests carry at most this many ops (the client flushes every few hundred ms). */
export const OPS_PER_REQUEST_MAX = 64;
/** The storage chest of the plot (town builder puts it by the gate); it cannot be broken or covered. */
export const PLOT_CHEST_POS = { x: 118, y: 1, z: 158 } as const;
/**
 * The plot's room-check region (`plotRegion`): the layers a home is judged in. Digging and building go on past it
 * (R2861①: FREE_MIN_Y .. FREE_MAX_Y, `plotCellRule`).
 */
export const PLOT_MIN_Y = -1;
export const PLOT_MAX_Y = 30;

// ---- Furniture (D13: about 80 finished pieces bought in shops, placed on the grid, counted by the room check).
// The ids and roles are the content registry's (`FURNITURE_REGISTRY`), the same list the shop and residents use.
export type FurnitureKey = string;
const FURNITURE_BY_ID = new Map<string, FurnitureDef>(FURNITURE_REGISTRY.map((f) => [f.id, f]));
export function furnitureDef(key: string): FurnitureDef | undefined {
  return FURNITURE_BY_ID.get(key);
}

/** What a slot or the chest holds: a block (`b<id>`) or a piece of furniture (`f<registry id>`). */
export type ItemRef = `b${number}` | `f${string}`;
export interface Stack {
  ref: ItemRef;
  n: number;
}
export interface PlotInventory {
  slots: Array<Stack | null>;
  chest: Partial<Record<ItemRef, number>>;
}
export interface PlotFurniture {
  key: FurnitureKey;
  /** quarter turns (0..3) */
  rot: number;
}

export function blockRef(id: number): ItemRef {
  return `b${id}`;
}
export function furnitureRef(key: FurnitureKey): ItemRef {
  return `f${key}`;
}
const BUILDABLE = new Set(BUILD_PALETTE);
export function parseRef(ref: string): { kind: 'block'; id: number } | { kind: 'furniture'; key: FurnitureKey } | null {
  if (ref.startsWith('b')) {
    const id = Number(ref.slice(1));
    return Number.isInteger(id) && BUILDABLE.has(id) ? { kind: 'block', id } : null;
  }
  if (ref.startsWith('f')) {
    const key = ref.slice(1);
    return FURNITURE_BY_ID.has(key) ? { kind: 'furniture', key } : null;
  }
  return null;
}

/** A new plot: five starter stacks in hand, the chest stocked with the basics and a first set of furniture. */
export function starterInventory(): PlotInventory {
  const slots: Array<Stack | null> = [
    { ref: blockRef(BK.oakPlank), n: 32 },
    { ref: blockRef(BK.brick), n: 32 },
    { ref: blockRef(BK.glass), n: 16 },
    { ref: blockRef(BK.roofRed), n: 16 },
    { ref: blockRef(BK.torch), n: 8 }
  ];
  const chest: Partial<Record<ItemRef, number>> = {};
  for (const id of BUILD_PALETTE) chest[blockRef(id)] = 16;
  chest[blockRef(BK.door)] = 4;
  chest[blockRef(BK.nameplate)] = 4;
  chest[furnitureRef('furn_chair_wood')] = 2;
  chest[furnitureRef('furn_bed_single')] = 1;
  chest[furnitureRef('furn_table_dining')] = 1;
  chest[furnitureRef('furn_lamp_table')] = 1;
  return { slots, chest };
}

const blastById = new Map(BLOCK_PALETTE.map((b) => [b.id, b.blastResistance] as const));
const lightById = new Map(BLOCK_PALETTE.map((b) => [b.id, b.lightLevel] as const));

/** Seconds of holding to break a block by hand (D13: 0.2–3 s by strength; scaffold breaks at once). */
export function breakSeconds(id: number): number {
  if (id === BK.scaffold) return 0;
  // R2861①: the town's road breaks like its cobble kerb (the content palette keeps it blast-proof for the old kernel)
  if (id === BK.road) return breakSeconds(BK.cobble);
  const br = blastById.get(id) ?? 1;
  if (!Number.isFinite(br)) return Infinity;
  return Math.max(0.2, Math.min(3, 0.2 + br * 0.3));
}

/** R2861① (Dan 11-23 "axe 를 구하러 trade market 에 감"): what each hand tool is for. */
const TOOL_BLOCKS: Record<'axe' | 'shovel' | 'pickaxe', ReadonlySet<number>> = {
  axe: new Set([BK.plank, BK.oakPlank, BK.birchPlank, BK.pinePlank, BK.log, BK.fence, BK.door, BK.crate, BK.barrel, BK.leaves]),
  shovel: new Set([BK.dirt, BK.grass, BK.sand, BK.gravel, BK.hay]),
  pickaxe: new Set([BK.stone, BK.cobble, BK.granite, BK.marble, BK.brick, BK.stoneStair, BK.stoneSlab, BK.copper, BK.ironPlate])
};
/** A tool held in hand breaks its own kind of block in this share of the bare-hand time. */
export const TOOL_BREAK_FACTOR = 0.35;
/** The hand tool an item key is (an iron pickaxe is a pickaxe, never an axe), or null. */
export function toolOf(itemKey: string | null | undefined): 'axe' | 'shovel' | 'pickaxe' | null {
  const k = (itemKey ?? '').toLowerCase();
  if (!k) return null;
  if (k.includes('pickaxe')) return 'pickaxe';
  if (/(^|_)axe($|_)/.test(k)) return 'axe';
  if (k.includes('shovel')) return 'shovel';
  return null;
}
/** Seconds to break `id` with `itemKey` in hand: the right tool cuts the bare-hand time (breakSeconds) to 35%. */
export function toolBreakSeconds(id: number, itemKey: string | null | undefined): number {
  const base = breakSeconds(id);
  const tool = toolOf(itemKey);
  if (!tool || !Number.isFinite(base) || !TOOL_BLOCKS[tool].has(id)) return base;
  return Math.max(0.1, base * TOOL_BREAK_FACTOR);
}

export type PlotEditReason =
  | 'not_my_plot'
  | 'fence'
  | 'too_low'
  | 'too_high'
  | 'chest'
  | 'empty_slot'
  | 'occupied'
  | 'no_block'
  | 'unbreakable'
  | 'not_buildable'
  | 'no_support'
  | 'bag_full'
  | 'bad_op'
  | 'rate'
  /** a guest-pass visitor tried to break what the host built, or to use the host's chest (docs/19 §8) */
  | 'not_yours'
  /** R326 free build: one of the town's places (town-guard.ts) */
  | 'protected'
  /** R326: past the generated ground (no building over the void) */
  | 'edge'
  /** R326: this world already holds TUNING.building.freeMaxCells changed cells outside the plot */
  | 'too_many';

/**
 * Where an edit may land (R326, docs/03 D13 자유 건축): 'world' = anywhere in the child's own world the town rules
 * allow (the plot by the plot rules, the open ground by town-guard.ts); 'plot' = inside the plot fence only (a
 * lesson: the class shares one town and the lesson needs its places as the teacher set them).
 */
export type BuildScope = 'plot' | 'world';

/**
 * The free-build budget (R326): how many cells outside the plot differ from the town now, and the town's block at a
 * cell. The server reads both from its OverlayWorld, the client from its TownDelta; applyPlotOp refuses an edit that
 * would make one more changed cell past TUNING.building.freeMaxCells ('too_many'). Undoing a change is always allowed.
 */
export interface FreeBuildBudget {
  townAt(x: number, y: number, z: number): number;
  readonly used: number;
}

export const FREE_MIN_Y = TUNING.building.freeMinY;
export const FREE_MAX_Y = TUNING.building.freeMaxY;
export const FREE_MAX_CELLS = TUNING.building.freeMaxCells;

export function isInPlot(world: VoxelWorld, x: number, z: number): boolean {
  const p = world.plot;
  return x >= p.x0 && x < p.x1 && z >= p.z0 && z < p.z1;
}

/** Can this cell be edited at all (position rules only)? The fence ring and the chest stay as the town built them. */
export function plotCellRule(world: VoxelWorld, x: number, y: number, z: number): PlotEditReason | null {
  if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(z)) return 'bad_op';
  if (!isInPlot(world, x, z)) return 'not_my_plot';
  const p = world.plot;
  if (x === p.x0 || x === p.x1 - 1 || z === p.z0 || z === p.z1 - 1) return 'fence';
  // R2861①: the plot digs and builds as deep and as high as the open world (PLOT_MIN_Y / PLOT_MAX_Y bound the room check)
  if (y < FREE_MIN_Y) return 'too_low';
  if (y > FREE_MAX_Y) return 'too_high';
  if (x === PLOT_CHEST_POS.x && z === PLOT_CHEST_POS.z && y >= PLOT_CHEST_POS.y && y <= PLOT_CHEST_POS.y + 1) return 'chest';
  return null;
}

/**
 * Can this cell be edited by the town rules (R326)? Inside the plot the plot rules; outside it, with scope 'world',
 * the generated ground away from the town's protected places, between FREE_MIN_Y and FREE_MAX_Y.
 */
export function buildCellRule(world: VoxelWorld, x: number, y: number, z: number, scope: BuildScope): PlotEditReason | null {
  if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(z)) return 'bad_op';
  if (isInPlot(world, x, z)) return plotCellRule(world, x, y, z);
  // a lesson builds on the plot only (docs/03 D13 수업 중 건축): the same answer as outside anyone's plot before R326
  if (scope === 'plot') return 'not_my_plot';
  // R2861① (Dan R2657 -> R2861 "마을도 부술 수 있게, 끝없이"): the whole open world, the town's buildings and roads too
  // (the town comes back by undo and the teacher's restore, apps/edge/src/plot.ts); only its far end and the bedrock stop
  if (x < TUNING.world.openMin || x >= TUNING.world.openMax || z < TUNING.world.openMin || z >= TUNING.world.openMax) return 'edge';
  if (y < FREE_MIN_Y) return 'too_low';
  if (y > FREE_MAX_Y) return 'too_high';
  return null;
}

/** Cells a placed block may take: open air, a grass tuft, water (building out over the water's edge). */
export function isReplaceableCell(id: number): boolean {
  return id === 0 || id === BK.tallGrass || id === BK.water;
}

/**
 * The editable state: blocks (the child's world, or a VoxelWorld holding only the plot region in older callers),
 * furniture on cells, the inventory. `scope` (default 'plot') and `budget` are the R326 free-build parts.
 */
export interface PlotState {
  world: VoxelWorld;
  furniture: Map<string, PlotFurniture>;
  inv: PlotInventory;
  scope?: BuildScope;
  budget?: FreeBuildBudget;
}

export const cellKey = (x: number, y: number, z: number): string => `${x},${y},${z}`;

export type PlotOp =
  | { op: 'place'; x: number; y: number; z: number; slot: number; rot?: number }
  | { op: 'break'; x: number; y: number; z: number }
  /** chest -> hand: up to n of `ref` into `slot` (or the first slot that can take it) */
  | { op: 'take'; ref: ItemRef; n: number; slot?: number }
  /** hand -> chest: up to n from `slot` */
  | { op: 'store'; slot: number; n: number }
  | { op: 'swap'; a: number; b: number };

export interface PlotOpResult {
  ok: boolean;
  reason?: PlotEditReason;
  /** what was in the cell before (place/break), for undo */
  prev?: number;
  /** furniture that was removed (break) */
  prevFurniture?: PlotFurniture;
  /** break: the recovered thing went to the chest because every slot was full */
  toChest?: boolean;
}

/** Would writing `next` at this cell make one changed cell too many outside the plot? */
function overBudget(state: PlotState, x: number, y: number, z: number, prev: number, next: number): boolean {
  const b = state.budget;
  if (!b || isInPlot(state.world, x, z)) return false;
  const town = b.townAt(x, y, z);
  return prev === town && next !== town && b.used >= FREE_MAX_CELLS;
}

/** The actor for a child's edit: the owner of their own world, judged by the town rules (R326). */
const editor = (id: string) => ({ id, isOwner: true, townRules: true });

const slotOk = (s: unknown): s is number => typeof s === 'number' && Number.isInteger(s) && s >= 0 && s < SLOT_COUNT;

/**
 * A shop's block bundle lands in the build stock (edge plot.ts unpackShopBlocks) where the child sees it: the hand.
 * Same stack first, then an empty slot; when the hand is full and holds none of it, the last slot's stack goes to the
 * chest (nothing is lost) and the bundle takes that slot. What still does not fit goes to the chest.
 */
export function stowInInventory(inv: PlotInventory, ref: ItemRef, n: number): void {
  const slots: Array<Stack | null> = inv.slots;
  const held = slots.some((s) => s?.ref === ref);
  const out = slots[slots.length - 1];
  if (!held && n > 0 && out && !slots.includes(null)) {
    inv.chest[out.ref] = (inv.chest[out.ref] ?? 0) + out.n;
    slots[slots.length - 1] = null;
  }
  recover(inv, ref, n);
}

function recover(inv: PlotInventory, ref: ItemRef, n: number): boolean {
  let left = n;
  for (const s of inv.slots) {
    if (left <= 0) break;
    if (s && s.ref === ref && s.n < STACK_MAX) {
      const k = Math.min(left, STACK_MAX - s.n);
      s.n += k;
      left -= k;
    }
  }
  for (let i = 0; i < inv.slots.length && left > 0; i++) {
    if (inv.slots[i] === null) {
      const k = Math.min(left, STACK_MAX);
      inv.slots[i] = { ref, n: k };
      left -= k;
    }
  }
  if (left > 0) inv.chest[ref] = (inv.chest[ref] ?? 0) + left;
  return left > 0;
}

function consume(inv: PlotInventory, slot: number): void {
  const s = inv.slots[slot];
  if (!s) return;
  s.n -= 1;
  if (s.n <= 0) inv.slots[slot] = null;
}

/** What breaking `id` gives back (null: nothing, e.g. a flower). */
export function recoveredBlock(id: number): number | null {
  if (BUILDABLE.has(id)) return id;
  if (id === BK.path) return BK.dirt;
  return null;
}

const SOLID_EXCEPT = new Set<number>([0, BK.torch, BK.lantern, BK.carpet, BK.flowerRed, BK.flowerYellow, BK.flowerBlue, BK.tallGrass, BK.water]);
/** Blocks the room fill walks through (open air and thin decor). */
export function isOpenCell(id: number): boolean {
  return SOLID_EXCEPT.has(id);
}

/**
 * Apply one op for the plot owner. Same function on the client (optimistic) and in the WorldDO (authoritative):
 * position rules, the slot's stack, cell occupancy and furniture support are checked here; blocks change only
 * through `world.setBlock`.
 */
export function applyPlotOp(state: PlotState, actorId: string, op: PlotOp): PlotOpResult {
  const { world, inv, furniture } = state;
  switch (op.op) {
    case 'place': {
      if (!slotOk(op.slot)) return { ok: false, reason: 'bad_op' };
      const rule = buildCellRule(world, op.x, op.y, op.z, state.scope ?? 'plot');
      if (rule) return { ok: false, reason: rule };
      const stack = inv.slots[op.slot];
      if (!stack || stack.n <= 0) return { ok: false, reason: 'empty_slot' };
      const what = parseRef(stack.ref);
      if (!what) return { ok: false, reason: 'not_buildable' };
      const k = cellKey(op.x, op.y, op.z);
      const prev = world.getBlock(op.x, op.y, op.z);
      if (furniture.has(k)) return { ok: false, reason: 'occupied' };
      if (what.kind === 'block') {
        if (!isReplaceableCell(prev)) return { ok: false, reason: 'occupied' };
        if (overBudget(state, op.x, op.y, op.z, prev, what.id)) return { ok: false, reason: 'too_many' };
        const res = world.setBlock(editor(actorId), op.x, op.y, op.z, what.id);
        if (!res.ok) return { ok: false, reason: 'protected' };
        consume(inv, op.slot);
        return { ok: true, prev };
      }
      if (prev !== 0) return { ok: false, reason: 'occupied' };
      const below = world.getBlock(op.x, op.y - 1, op.z);
      if (isOpenCell(below) || furniture.has(cellKey(op.x, op.y - 1, op.z))) return { ok: false, reason: 'no_support' };
      furniture.set(k, { key: what.key, rot: (((op.rot ?? 0) % 4) + 4) % 4 });
      consume(inv, op.slot);
      return { ok: true, prev: 0 };
    }
    case 'break': {
      const rule = buildCellRule(world, op.x, op.y, op.z, state.scope ?? 'plot');
      if (rule) return { ok: false, reason: rule };
      const k = cellKey(op.x, op.y, op.z);
      const f = furniture.get(k);
      if (f) {
        furniture.delete(k);
        const toChest = recover(inv, furnitureRef(f.key), 1);
        return { ok: true, prev: 0, prevFurniture: f, toChest };
      }
      const prev = world.getBlock(op.x, op.y, op.z);
      if (prev === 0 || prev === BK.water) return { ok: false, reason: 'no_block' };
      if (!Number.isFinite(breakSeconds(prev))) return { ok: false, reason: 'unbreakable' };
      // furniture standing on this block would float
      if (furniture.has(cellKey(op.x, op.y + 1, op.z))) return { ok: false, reason: 'occupied' };
      // a block set into the town's water or a grass tuft gives that back when broken (the pond is not drained, and
      // the cell is the town's again so it leaves the cap); a tuft broken on its own is gone
      const town = state.budget?.townAt(op.x, op.y, op.z) ?? 0;
      const after = (town === BK.water || town === BK.tallGrass) && prev !== town ? town : 0;
      if (overBudget(state, op.x, op.y, op.z, prev, after)) return { ok: false, reason: 'too_many' };
      const res = world.setBlock(editor(actorId), op.x, op.y, op.z, after);
      if (!res.ok) return { ok: false, reason: 'protected' };
      // Every palette block comes back as itself (D13 회수 100%); a dirt path gives dirt, flowers and grass tufts nothing.
      const back = recoveredBlock(prev);
      const toChest = back === null ? false : recover(inv, blockRef(back), 1);
      return { ok: true, prev, toChest };
    }
    case 'take': {
      const what = parseRef(op.ref);
      if (!what || !Number.isInteger(op.n) || op.n <= 0) return { ok: false, reason: 'bad_op' };
      const have = inv.chest[op.ref] ?? 0;
      if (have <= 0) return { ok: false, reason: 'no_block' };
      let want = Math.min(op.n, have, STACK_MAX);
      const target = op.slot !== undefined ? op.slot : inv.slots.findIndex((s) => s?.ref === op.ref && s.n < STACK_MAX);
      const slot = target >= 0 ? target : inv.slots.findIndex((s) => s === null);
      if (!slotOk(slot)) return { ok: false, reason: 'bag_full' };
      const cur = inv.slots[slot];
      if (cur && cur.ref !== op.ref) {
        // the slot holds something else: it goes back to the chest first (one tap swaps what is in hand)
        inv.chest[cur.ref] = (inv.chest[cur.ref] ?? 0) + cur.n;
        inv.slots[slot] = null;
      }
      const now = inv.slots[slot];
      want = Math.min(want, STACK_MAX - (now?.n ?? 0));
      if (want <= 0) return { ok: false, reason: 'bag_full' };
      inv.chest[op.ref] = have - want;
      if (inv.chest[op.ref] === 0) delete inv.chest[op.ref];
      if (now) now.n += want;
      else inv.slots[slot] = { ref: op.ref, n: want };
      return { ok: true };
    }
    case 'store': {
      if (!slotOk(op.slot) || !Number.isInteger(op.n) || op.n <= 0) return { ok: false, reason: 'bad_op' };
      const s = inv.slots[op.slot];
      if (!s) return { ok: false, reason: 'empty_slot' };
      const k = Math.min(op.n, s.n);
      s.n -= k;
      inv.chest[s.ref] = (inv.chest[s.ref] ?? 0) + k;
      if (s.n <= 0) inv.slots[op.slot] = null;
      return { ok: true };
    }
    case 'swap': {
      if (!slotOk(op.a) || !slotOk(op.b)) return { ok: false, reason: 'bad_op' };
      const t = inv.slots[op.a] ?? null;
      inv.slots[op.a] = inv.slots[op.b] ?? null;
      inv.slots[op.b] = t;
      return { ok: true };
    }
    default:
      return { ok: false, reason: 'bad_op' };
  }
}

/** Is this a parseable op? (shape only; the rules are in applyPlotOp) */
export function parsePlotOp(raw: unknown): PlotOp | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const int = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && Math.abs(v) < 100000;
  switch (r.op) {
    case 'place':
      return int(r.x) && int(r.y) && int(r.z) && int(r.slot) ? { op: 'place', x: r.x, y: r.y, z: r.z, slot: r.slot, rot: int(r.rot) ? r.rot : 0 } : null;
    case 'break':
      return int(r.x) && int(r.y) && int(r.z) ? { op: 'break', x: r.x, y: r.y, z: r.z } : null;
    case 'take':
      return typeof r.ref === 'string' && parseRef(r.ref) && int(r.n) ? { op: 'take', ref: r.ref as ItemRef, n: r.n, ...(int(r.slot) ? { slot: r.slot } : {}) } : null;
    case 'store':
      return int(r.slot) && int(r.n) ? { op: 'store', slot: r.slot, n: r.n } : null;
    case 'swap':
      return int(r.a) && int(r.b) ? { op: 'swap', a: r.a, b: r.b } : null;
    default:
      return null;
  }
}

/** Server-side pace (D13 "초당 4개"): a token bucket per player, refilled by server time; place and break cost 1. */
export class EditBucket {
  private tokens: number;
  private at: number;
  constructor(
    nowMs: number,
    private readonly perSec = BUILD_PLACE_PER_S + 1,
    private readonly cap = 10
  ) {
    this.tokens = cap;
    this.at = nowMs;
  }
  take(nowMs: number): boolean {
    this.tokens = Math.min(this.cap, this.tokens + ((nowMs - this.at) / 1000) * this.perSec);
    this.at = nowMs;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

/** The plot region a plot world holds: the plot plus a one-cell margin (room checks at the fence see outside air). */
export function plotRegion(world: VoxelWorld): { x0: number; x1: number; z0: number; z1: number; y0: number; y1: number } {
  const p = world.plot;
  return { x0: p.x0 - 1, x1: p.x1 + 1, z0: p.z0 - 1, z1: p.z1 + 1, y0: PLOT_MIN_Y - 1, y1: PLOT_MAX_Y + 1 };
}

/** A VoxelWorld holding only the plot region of `base` (the town), for the server's per-player plot. */
export function createPlotWorld(base: VoxelWorld): VoxelWorld {
  const w = new VoxelWorld(base.plot);
  const r = plotRegion(base);
  const sys = { id: 'plot_base', isSystemGen: true };
  for (let y = r.y0; y < r.y1; y++) {
    for (let z = r.z0; z < r.z1; z++) {
      for (let x = r.x0; x < r.x1; x++) {
        const id = base.getBlock(x, y, z);
        if (id !== 0) w.setBlock(sys, x, y, z, id);
      }
    }
  }
  return w;
}

/** Re-apply saved cells on a plot world built from the town (system actor: each was validated when it was made). */
export function replayPlotCells(world: VoxelWorld, cells: ReadonlyArray<readonly [number, number, number, number]>): number {
  let n = 0;
  for (const [x, y, z, id] of cells) {
    if (plotCellRule(world, x, y, z)) continue;
    if (world.setBlock({ id: 'plot_replay', isSystemGen: true }, x, y, z, id).ok) n++;
  }
  return n;
}

/** Sanitise an inventory read from storage or the network. */
export function cleanInventory(raw: unknown): PlotInventory | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { slots?: unknown; chest?: unknown };
  const slots: Array<Stack | null> = [];
  const arr = Array.isArray(r.slots) ? r.slots : [];
  for (let i = 0; i < SLOT_COUNT; i++) {
    const s = arr[i] as { ref?: unknown; n?: unknown } | null | undefined;
    if (s && typeof s.ref === 'string' && parseRef(s.ref) && typeof s.n === 'number' && Number.isFinite(s.n) && s.n >= 1) {
      slots.push({ ref: s.ref as ItemRef, n: Math.min(STACK_MAX, Math.floor(s.n)) });
    } else slots.push(null);
  }
  const chest: Partial<Record<ItemRef, number>> = {};
  if (r.chest && typeof r.chest === 'object') {
    for (const [k, v] of Object.entries(r.chest as Record<string, unknown>)) {
      if (!parseRef(k) || typeof v !== 'number' || !Number.isFinite(v) || v < 1) continue;
      chest[k as ItemRef] = Math.min(1_000_000, Math.floor(v));
    }
  }
  return { slots, chest };
}

export function cloneInventory(inv: PlotInventory): PlotInventory {
  return { slots: inv.slots.map((s) => (s ? { ...s } : null)), chest: { ...inv.chest } };
}

// ---- Room check (D13 방 판정): from a nameplate on an inside wall, walk the open cells; at most 400.
export const ROOM_MAX_CELLS = TUNING.building.roomMaxVolume;
export const ROOM_MIN_CELLS = TUNING.building.roomMinVolume;
export const ROOM_MIN_CEILING = TUNING.building.roomMinCeiling;
export type RoomStructureNeed = 'closed' | 'size' | 'ceiling' | 'door';
export type RoomFurnitureNeed = 'light' | 'rest' | 'flat';
export interface RoomCheck {
  ok: boolean;
  /** furniture-kind needs (the read-aloud discount keys) */
  missing: RoomFurnitureNeed[];
  /** shape needs, reported before furniture */
  structure: RoomStructureNeed[];
  /** the target-language sentence for the first need (or the "ready" line when the room is complete) */
  sentence: string;
  cells: number;
  /** a complete room with a resident's job furniture: who may move in */
  resident: ResidentDef | null;
}

/**
 * docs/03 D13: the room check names what is missing in the target language. One table for the world (build screen)
 * and the server (the read-aloud discount checks the child read exactly this sentence).
 */
export const ROOM_MISSING_SENTENCES = {
  too_small: 'This room needs more space.',
  low_ceiling: 'This room needs a higher ceiling.',
  door: 'This room needs a door.',
  light: 'This room needs a light source.',
  rest: 'This room needs a bed or a chair.',
  flat: 'This room needs a table or workbench.'
} as const;

export const ROOM_SENTENCES: Readonly<Record<RoomStructureNeed | RoomFurnitureNeed | 'ok' | 'resident', string>> = {
  closed: 'This room is too big or not enclosed.',
  size: ROOM_MISSING_SENTENCES.too_small,
  ceiling: ROOM_MISSING_SENTENCES.low_ceiling,
  door: ROOM_MISSING_SENTENCES.door,
  light: ROOM_MISSING_SENTENCES.light,
  rest: ROOM_MISSING_SENTENCES.rest,
  flat: ROOM_MISSING_SENTENCES.flat,
  ok: 'What a lovely room!',
  resident: 'This room is ready for a resident!'
};

type BlockAt = (x: number, y: number, z: number) => number;
type FurnitureAt = (x: number, y: number, z: number) => PlotFurniture | undefined;
const DIRS = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1]
] as const;

function walk(blockAt: BlockAt, start: readonly [number, number, number]): { cells: Set<string>; closed: boolean } {
  const cells = new Set<string>([cellKey(start[0], start[1], start[2])]);
  const queue: Array<readonly [number, number, number]> = [start];
  for (let qi = 0; qi < queue.length; qi++) {
    const [x, y, z] = queue[qi]!;
    for (const [dx, dy, dz] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      const nz = z + dz;
      const k = cellKey(nx, ny, nz);
      if (cells.has(k) || !isOpenCell(blockAt(nx, ny, nz))) continue;
      cells.add(k);
      if (cells.size > ROOM_MAX_CELLS) return { cells, closed: false };
      queue.push([nx, ny, nz]);
    }
  }
  return { cells, closed: true };
}

/** Judge the space that holds `starts` (the first start that closes is used). Fixed cost: at most 400 cells each. */
export function checkRoomFrom(blockAt: BlockAt, furnitureAt: FurnitureAt, starts: ReadonlyArray<readonly [number, number, number]>): RoomCheck {
  let best: { cells: Set<string>; closed: boolean } | null = null;
  for (const s of starts) {
    if (!isOpenCell(blockAt(s[0], s[1], s[2]))) continue;
    const w = walk(blockAt, s);
    if (w.closed) {
      best = w;
      break;
    }
    best ??= w;
  }
  const structure: RoomStructureNeed[] = [];
  const missing: RoomFurnitureNeed[] = [];
  if (!best || !best.closed) {
    structure.push('closed');
    return { ok: false, missing, structure, sentence: ROOM_SENTENCES.closed, cells: best?.cells.size ?? 0, resident: null };
  }
  const cells = best.cells;
  if (cells.size < ROOM_MIN_CELLS) structure.push('size');
  let lowCeiling = false;
  let door = false;
  let light = false;
  let rest = false;
  let flat = false;
  let job: string | null = null;
  for (const k of cells) {
    const [x, y, z] = k.split(',').map(Number) as [number, number, number];
    // the open column through this cell must be at least ROOM_MIN_CEILING high
    if (!cells.has(cellKey(x, y - 1, z))) {
      let h = 1;
      while (h < ROOM_MIN_CEILING && cells.has(cellKey(x, y + h, z))) h++;
      if (h < ROOM_MIN_CEILING) lowCeiling = true;
    }
    const f = furnitureAt(x, y, z);
    const role = f ? furnitureDef(f.key)?.role : undefined;
    if (role === 'light') light = true;
    if (role === 'rest') rest = true;
    if (role === 'flat') flat = true;
    if (role === 'job') job ??= f!.key;
    if ((lightById.get(blockAt(x, y, z)) ?? 0) > 0) light = true;
    for (const [dx, dy, dz] of DIRS) {
      const id = blockAt(x + dx, y + dy, z + dz);
      if (id === BK.door) door = true;
      if ((lightById.get(id) ?? 0) > 0) light = true;
    }
  }
  if (lowCeiling) structure.push('ceiling');
  if (!door) structure.push('door');
  if (!light) missing.push('light');
  if (!rest) missing.push('rest');
  if (!flat) missing.push('flat');
  const ok = structure.length === 0 && missing.length === 0;
  const resident = ok && job ? (RESIDENT_REGISTRY.find((r) => r.jobFurnitureId === job) ?? null) : null;
  const first = structure[0] ?? missing[0];
  const sentence = first ? ROOM_SENTENCES[first] : resident ? ROOM_SENTENCES.resident : ROOM_SENTENCES.ok;
  return { ok, missing, structure, sentence, cells: cells.size, resident };
}

/** The room behind a nameplate set into a wall: tries each open side of it. */
export function checkRoom(blockAt: BlockAt, furnitureAt: FurnitureAt, np: { x: number; y: number; z: number }): RoomCheck {
  return checkRoomFrom(blockAt, furnitureAt, [
    [np.x + 1, np.y, np.z],
    [np.x - 1, np.y, np.z],
    [np.x, np.y, np.z + 1],
    [np.x, np.y, np.z - 1]
  ]);
}
