/**
 * Building in my world in the client (docs/03 D13, WP-201/207, R326 free build): aims, applies the shared sim-core
 * rules at once (optimistic), keeps the undo history (Z, last 20), runs the room check from nameplates, and hands
 * every op to PlotSync for the server, whose answer wins. On the plot by the plot rules; with scope 'world' also on
 * the open ground away from the town's protected places (sim-core town-guard.ts). DOM- and Three-free: the engine
 * draws, this decides.
 */
import { BLOCK_PALETTE } from '@lcw/content';
import {
  BK,
  BUILD_REACH_M,
  BUILD_UNDO_LIMIT,
  EditBucket,
  FREE_MAX_CELLS,
  PLOT_CHEST_POS,
  applyPlotOp,
  buildCellRule,
  cellIndex,
  cellOfIndex,
  isReplaceableCell,
  blockRef,
  breakSeconds,
  cellKey,
  checkRoom,
  cleanInventory,
  furnitureDef,
  furnitureRef,
  isInPlot,
  isOpenCell,
  TUNING,
  parseRef,
  plotRegion,
  recoveredBlock,
  starterInventory,
  type BuildScope,
  type FreeBuildBudget,
  type ItemRef,
  type PlotEditReason,
  type PlotFurniture,
  type PlotInventory,
  type PlotOp,
  type PlotState,
  type RoomCheck,
  type VoxelWorld
} from '@lcw/sim-core';

export type { PlotOp };

const BLOCK_IDS = new Set(BLOCK_PALETTE.map((b) => b.id));

/** What GET /v1/plot returns (edge plot.ts PlotSnapshot). */
export interface PlotSnapshotLike {
  /** on a guest pass (docs/19 §8): the cells this friend placed and may break again */
  guest_cells?: unknown;
  cells: Array<[number, number, number, number]>;
  furniture: Array<[number, number, number, string, number]>;
  inv: unknown;
  rev: number;
  /** R326: where the server lets this token build ('plot' in a lesson) */
  scope?: unknown;
  /** R326: the world's relay tag (the host and a friend on a pass share it) */
  world_tag?: unknown;
}

/**
 * Which cells of the client's world differ from the town (R326): the town's block of each changed cell is kept the
 * first time it changes, so a snapshot can put back what the server does not hold and the free-build budget counts
 * the changed cells outside the plot. Every change to the world goes through the builder, which tells this first.
 */
export class TownDelta implements FreeBuildBudget {
  private readonly town = new Map<number, number>();
  private outside = 0;
  constructor(private readonly world: VoxelWorld) {}

  get used(): number {
    return this.outside;
  }

  get size(): number {
    return this.town.size;
  }

  townAt(x: number, y: number, z: number): number {
    const t = this.town.get(cellIndex(x, y, z));
    return t === undefined ? this.world.getBlock(x, y, z) : t;
  }

  /** The cell is about to change from `before` (its current block) to `after`. */
  note(x: number, y: number, z: number, before: number, after: number): void {
    const k = cellIndex(x, y, z);
    const had = this.town.has(k);
    const town = had ? this.town.get(k)! : before;
    const differs = after !== town;
    if (differs && !had) this.town.set(k, town);
    if (!differs && had) this.town.delete(k);
    if (had !== differs && !isInPlot(this.world, x, z)) this.outside += differs ? 1 : -1;
  }

  /** Every changed cell: [x, y, z, town block]. */
  *changed(): Generator<[number, number, number, number]> {
    for (const [k, t] of this.town) {
      const [x, y, z] = cellOfIndex(k);
      yield [x, y, z, t];
    }
  }
}

/** Client-only refusals on top of the shared rules. */
export type BuildReason = PlotEditReason | 'far' | 'self' | 'paused' | 'loading' | 'pass_over';

export type BuildAccessKind = 'local' | 'saved' | 'paused' | 'loading';

export interface Aim {
  /** the block (or furniture cell) under the pointer */
  hit: { x: number; y: number; z: number };
  /** the empty cell in front of the hit face (where a block would go) */
  place: { x: number; y: number; z: number };
  /** what the current tool would do here, or why not */
  placeReason: BuildReason | null;
  breakReason: BuildReason | null;
  /** seconds to hold for breaking the hit cell */
  breakS: number;
}

export interface RoomCheckEvent {
  missing: Array<'light' | 'rest' | 'flat'>;
  sentence: string;
  ok: boolean;
  structure: RoomCheck['structure'];
  resident: string | null;
  nameplate: { x: number; y: number; z: number };
}

export interface BuildHooks {
  /** a block changed at (x, y, z): remesh */
  blockChanged(x: number, y: number, z: number): void;
  furnitureChanged(): void;
  inventoryChanged(): void;
  roomChecked(r: RoomCheckEvent): void;
}

interface UndoStep {
  /** ops that reverse one edit, in order */
  ops: PlotOp[];
  /** a broken thing to bring back (from the hand, else the chest) */
  ref?: ItemRef;
}

const FURN_PICK = -1;
/** How long after the last edit the room check runs (D13 "블록이 바뀐 뒤 1초 후"). */
export const ROOM_CHECK_DELAY_MS = 1000;
/** Nameplates further than this from an edit cannot share a room with it (400 cells). */
const ROOM_REACH = 22;

/** R326 block relay: what this device just changed, for the others in the same world (engine → room). */
export interface CellChange {
  cells: Array<[number, number, number, number]>;
  furniture: Array<[number, number, number, string, number]>;
}

export class PlotBuilder {
  readonly state: PlotState;
  /** the cells that differ from the town (R326) */
  readonly delta: TownDelta;
  private readonly bucket: EditBucket;
  private undo: UndoStep[] = [];
  private nameplates = new Set<string>();
  private roomTimer: ReturnType<typeof setTimeout> | null = null;
  private roomDue = new Map<string, boolean>();
  private lastRoom = new Map<string, string>();
  access: BuildAccessKind = 'local';
  /** next furniture rotation (R key / turn button) */
  rot = 0;
  /** edits applied in this session (stats) */
  edits = 0;
  onOp: ((op: PlotOp) => void) | null = null;
  /** R326: a local edit took (relayed to the others in this world; snapshots and relays received are not) */
  onCells: ((c: CellChange, op: PlotOp) => void) | null = null;
  /** R326: the world's relay tag from the server snapshot ('' before one came: nothing is relayed or taken) */
  worldTag = '';
  /** how many relayed cells were drawn (stats) */
  remoteCells = 0;
  /**
   * Relayed cells drawn since the last server read. The room cannot tell who owns a world tag, so a relay is display
   * only and bounded: past TUNING.building.relay.remoteCellsMax the rest waits for my next server read, which also
   * puts every relayed cell back to the saved truth.
   */
  private remoteSinceRead = 0;
  /** the relay cap was reached: the engine reads the plot again (the friend's view then comes from the server) */
  onRemoteFull: (() => void) | null = null;
  private remoteFullSaid = false;

  /** `world` must be the town as the builder made it: the delta takes every unchanged cell as the town's. */
  constructor(
    readonly world: VoxelWorld,
    private readonly hooks: BuildHooks,
    nowMs: number
  ) {
    this.delta = new TownDelta(world);
    this.state = { world, furniture: new Map(), inv: starterInventory(), scope: 'world', budget: this.delta };
    this.bucket = new EditBucket(nowMs);
    this.scanNameplates();
  }

  /**
   * Where this child may build (R326): 'world' = the plot and the open ground of their own world (also a device-only
   * guest and a friend on a guest pass, who builds in the host's world); 'plot' = a lesson, the plot only.
   */
  get scope(): BuildScope {
    return this.state.scope ?? 'plot';
  }
  set scope(s: BuildScope) {
    this.state.scope = s;
  }

  /** Could anything be built around this spot (the build controls show)? The plot, or the open ground with scope 'world'. */
  canBuildNear(x: number, z: number): boolean {
    const bx = Math.floor(x);
    const bz = Math.floor(z);
    if (isInPlot(this.world, bx, bz)) return true;
    if (this.scope !== 'world') return false;
    // standing on a road or in the plaza the ground right beside it may still be free: look one reach around
    const r = Math.ceil(BUILD_REACH_M);
    for (let dz = -r; dz <= r; dz += r) {
      for (let dx = -r; dx <= r; dx += r) {
        const reason = buildCellRule(this.world, bx + dx, 0, bz + dz, 'world');
        if (!reason || reason === 'too_low' || reason === 'too_high') return true;
      }
    }
    return false;
  }

  get inv(): PlotInventory {
    return this.state.inv;
  }

  inPlot(x: number, z: number): boolean {
    return isInPlot(this.world, Math.floor(x), Math.floor(z));
  }

  /** Block id for picking: furniture cells pick as solid. */
  pickAt = (x: number, y: number, z: number): number => (this.state.furniture.has(cellKey(x, y, z)) ? FURN_PICK : this.world.getBlock(x, y, z));

  furnitureAt = (x: number, y: number, z: number): PlotFurniture | undefined => this.state.furniture.get(cellKey(x, y, z));

  /** Is the cell the slot's thing would go into free of the player's body? */
  private overlapsPlayer(c: { x: number; y: number; z: number }, player: { x: number; y: number; z: number }): boolean {
    const hw = 0.3;
    return c.x + 1 > player.x - hw && c.x < player.x + hw && c.z + 1 > player.z - hw && c.z < player.z + hw && c.y + 1 > player.y && c.y < player.y + 1.8;
  }

  /** Judge a pointer hit for both tools (outline colour and the reason shown next to it). */
  aim(hit: { x: number; y: number; z: number; nx: number; ny: number; nz: number }, player: { x: number; y: number; z: number }, slot: number): Aim {
    const place = { x: hit.x + hit.nx, y: hit.y + hit.ny, z: hit.z + hit.nz };
    const eye = { x: player.x, y: player.y + 1.5, z: player.z };
    const far = (c: { x: number; y: number; z: number }): boolean => Math.hypot(c.x + 0.5 - eye.x, c.y + 0.5 - eye.y, c.z + 0.5 - eye.z) > BUILD_REACH_M + 0.5;
    const paused = this.access === 'paused' ? this.pausedReason() : this.access === 'loading' ? 'loading' : null;
    let placeReason: BuildReason | null = paused ?? (far(place) ? 'far' : buildCellRule(this.world, place.x, place.y, place.z, this.scope));
    if (!placeReason) {
      const s = this.state.inv.slots[slot];
      if (!s) placeReason = 'empty_slot';
      else if (this.state.furniture.has(cellKey(place.x, place.y, place.z))) placeReason = 'occupied';
      else {
        const what = parseRef(s.ref);
        const prev = this.world.getBlock(place.x, place.y, place.z);
        if (what?.kind === 'block' ? !isReplaceableCell(prev) : prev !== 0) placeReason = 'occupied';
        else if (what?.kind === 'block' && this.overlapsPlayer(place, player)) placeReason = 'self';
        else if (what?.kind === 'furniture') {
          const below = this.world.getBlock(place.x, place.y - 1, place.z);
          // the same support rule as the server (sim-core applyPlotOp): grass tufts, flowers and water hold nothing up
          if (isOpenCell(below) || this.state.furniture.has(cellKey(place.x, place.y - 1, place.z))) placeReason = 'no_support';
        } else if (what?.kind === 'block' && this.overBudget(place.x, place.y, place.z, prev, what.id)) placeReason = 'too_many';
      }
    }
    let breakReason: BuildReason | null = paused ?? (far(hit) ? 'far' : buildCellRule(this.world, hit.x, hit.y, hit.z, this.scope));
    if (!breakReason && this.guestCells && !this.guestCells.has(cellKey(hit.x, hit.y, hit.z))) breakReason = 'not_yours';
    const id = this.world.getBlock(hit.x, hit.y, hit.z);
    const isFurn = this.state.furniture.has(cellKey(hit.x, hit.y, hit.z));
    if (!breakReason && !isFurn) {
      if (id === 0 || id === BK.water) breakReason = 'no_block';
      else if (!Number.isFinite(breakSeconds(id))) breakReason = 'unbreakable';
      else if (this.state.furniture.has(cellKey(hit.x, hit.y + 1, hit.z))) breakReason = 'occupied';
      else if (this.overBudget(hit.x, hit.y, hit.z, id, 0)) breakReason = 'too_many';
    }
    return { hit: { x: hit.x, y: hit.y, z: hit.z }, place, placeReason, breakReason, breakS: isFurn ? 0.2 : breakSeconds(id) };
  }

  private overBudget(x: number, y: number, z: number, prev: number, next: number): boolean {
    if (isInPlot(this.world, x, z)) return false;
    const town = this.delta.townAt(x, y, z);
    return prev === town && next !== town && this.delta.used >= FREE_MAX_CELLS;
  }

  /**
   * A friend on a guest pass builds in the host's plot (docs/19 §8): non-null = the cells this friend placed (the only
   * ones they may break). The chest and the slots stay the host's. The server holds the same rule; this shows it at once.
   */
  guestCells: Set<string> | null = null;

  /** a friend whose pass ended sees that, not the host seat's 'free play is resting' */
  private pausedReason(): BuildReason {
    return this.guestCells ? 'pass_over' : 'paused';
  }

  private notYours(op: PlotOp): boolean {
    if (!this.guestCells) return false;
    if (op.op === 'place') return false;
    return !(op.op === 'break' && this.guestCells.has(cellKey(op.x, op.y, op.z)));
  }

  /** Run one op locally (rules, pace), record undo, queue it for the server. */
  private run(op: PlotOp, nowMs: number, record: boolean): { ok: boolean; reason?: BuildReason } {
    if (this.access === 'paused') return { ok: false, reason: this.pausedReason() };
    if (this.access === 'loading') return { ok: false, reason: 'loading' };
    if (this.notYours(op)) return { ok: false, reason: 'not_yours' };
    if ((op.op === 'place' || op.op === 'break') && !this.bucket.take(nowMs)) return { ok: false, reason: 'rate' };
    const before = op.op === 'place' || op.op === 'break' ? this.world.getBlock(op.x, op.y, op.z) : 0;
    const r = applyPlotOp(this.state, 'me', op);
    if (!r.ok) return { ok: false, reason: r.reason };
    if (op.op === 'place' || op.op === 'break') this.delta.note(op.x, op.y, op.z, before, this.world.getBlock(op.x, op.y, op.z));
    this.edits++;
    if (this.guestCells && op.op === 'place') this.guestCells.add(cellKey(op.x, op.y, op.z));
    if (this.guestCells && op.op === 'break') this.guestCells.delete(cellKey(op.x, op.y, op.z));
    this.onOp?.(op);
    if (op.op === 'place' || op.op === 'break') {
      const furn = op.op === 'place' ? this.state.furniture.get(cellKey(op.x, op.y, op.z)) : r.prevFurniture;
      if (furn) this.hooks.furnitureChanged();
      else this.hooks.blockChanged(op.x, op.y, op.z);
      if (this.onCells) {
        const f = this.state.furniture.get(cellKey(op.x, op.y, op.z));
        if (furn) this.onCells({ cells: [], furniture: [[op.x, op.y, op.z, f?.key ?? '', f?.rot ?? 0]] }, op);
        else this.onCells({ cells: [[op.x, op.y, op.z, this.world.getBlock(op.x, op.y, op.z)]], furniture: [] }, op);
      }
      if (record) this.recordUndo(op, r.prev ?? 0, r.prevFurniture);
      const placedId = this.world.getBlock(op.x, op.y, op.z);
      const k = cellKey(op.x, op.y, op.z);
      if (placedId === BK.nameplate) {
        this.nameplates.add(k);
        this.roomDue.set(k, true); // a new nameplate always answers
        this.scheduleRoomCheck(0);
      } else {
        if (this.nameplates.delete(k)) this.lastRoom.delete(k);
        this.markRoomsNear(op.x, op.y, op.z);
      }
    }
    this.hooks.inventoryChanged();
    return { ok: true };
  }

  place(at: { x: number; y: number; z: number }, slot: number, nowMs: number): { ok: boolean; reason?: BuildReason } {
    return this.run({ op: 'place', x: at.x, y: at.y, z: at.z, slot, rot: this.rot }, nowMs, true);
  }

  breakAt(at: { x: number; y: number; z: number }, nowMs: number): { ok: boolean; reason?: BuildReason } {
    return this.run({ op: 'break', x: at.x, y: at.y, z: at.z }, nowMs, true);
  }

  take(ref: ItemRef, n: number, slot: number | undefined, nowMs: number): { ok: boolean; reason?: BuildReason } {
    return this.run(slot === undefined ? { op: 'take', ref, n } : { op: 'take', ref, n, slot }, nowMs, false);
  }

  store(slot: number, nowMs: number): { ok: boolean; reason?: BuildReason } {
    const s = this.state.inv.slots[slot];
    if (!s) return { ok: false, reason: 'empty_slot' };
    return this.run({ op: 'store', slot, n: s.n }, nowMs, false);
  }

  swap(a: number, b: number, nowMs: number): { ok: boolean; reason?: BuildReason } {
    return this.run({ op: 'swap', a, b }, nowMs, false);
  }

  private recordUndo(op: PlotOp, prev: number, prevFurniture?: PlotFurniture): void {
    if (op.op === 'place') {
      this.undo.push({ ops: [{ op: 'break', x: op.x, y: op.y, z: op.z }] });
    } else if (op.op === 'break') {
      const back = prev ? recoveredBlock(prev) : null;
      const ref: ItemRef | null = prevFurniture ? furnitureRef(prevFurniture.key) : back !== null ? blockRef(back) : null;
      if (!ref) return;
      this.undo.push({ ops: [{ op: 'place', x: op.x, y: op.y, z: op.z, slot: -1, rot: prevFurniture?.rot ?? 0 }], ref });
    }
    while (this.undo.length > BUILD_UNDO_LIMIT) this.undo.shift();
  }

  get undoDepth(): number {
    return this.undo.length;
  }

  /** Z: take back the last edit (D13 최근 20개). A broken block comes back from the hand or the chest. */
  undoLast(nowMs: number): { ok: boolean; reason?: BuildReason } {
    const step = this.undo.pop();
    if (!step) return { ok: false, reason: 'no_block' };
    for (const op of step.ops) {
      if (op.op === 'place' && op.slot === -1 && step.ref) {
        let slot = this.state.inv.slots.findIndex((s) => s?.ref === step.ref);
        if (slot < 0) {
          // back from the chest into an empty slot (or the selected one's stack goes to the chest first)
          const free = this.state.inv.slots.findIndex((s) => s === null);
          const t = this.run({ op: 'take', ref: step.ref, n: 1, ...(free >= 0 ? { slot: free } : { slot: 0 }) }, nowMs, false);
          if (!t.ok) return t;
          slot = this.state.inv.slots.findIndex((s) => s?.ref === step.ref);
        }
        const r = this.run({ ...op, slot }, nowMs, false);
        if (!r.ok) return r;
      } else {
        const r = this.run(op, nowMs, false);
        if (!r.ok) return r;
      }
    }
    return { ok: true };
  }

  // ---- Server snapshot (load / resync): every changed cell back to the town's, then the saved delta over it.
  /**
   * Returns the cells whose block changed on this device (a resync relays them when few: they are the server's truth).
   */
  applySnapshot(snap: PlotSnapshotLike): Array<[number, number, number, number]> {
    if (snap.scope === 'plot' || snap.scope === 'world') this.scope = snap.scope;
    this.remoteSinceRead = 0;
    this.remoteFullSaid = false;
    if (typeof snap.world_tag === 'string') this.worldTag = snap.world_tag;
    const want = new Map<number, number>();
    for (const c of snap.cells ?? []) {
      if (!Array.isArray(c) || c.length < 4) continue;
      const [x, y, z, id] = c as unknown[];
      if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number' || typeof id !== 'number') continue;
      // the server keeps only cells its rules allow; the same rule here keeps a stale or odd entry off the screen, and in
      // a lesson (scope 'plot') the home world's free build stays out of the shared class town
      if (buildCellRule(this.world, x, y, z, this.scope)) continue;
      want.set(cellIndex(x, y, z), id);
    }
    const changed: Array<[number, number, number, number]> = [];
    const sys = { id: 'plot_sync', isSystemGen: true };
    const put = (x: number, y: number, z: number, id: number): void => {
      const before = this.world.getBlock(x, y, z);
      if (before === id) return;
      this.delta.note(x, y, z, before, id);
      this.world.setBlock(sys, x, y, z, id);
      this.hooks.blockChanged(x, y, z);
      changed.push([x, y, z, id]);
    };
    // what this device changed and the server does not hold goes back to the town (collected first: put edits the delta)
    const back: Array<[number, number, number, number]> = [];
    for (const c of this.delta.changed()) if (!want.has(cellIndex(c[0], c[1], c[2]))) back.push(c);
    for (const [x, y, z, town] of back) put(x, y, z, town);
    for (const [k, id] of want) {
      const [x, y, z] = cellOfIndex(k);
      put(x, y, z, id);
    }
    this.state.furniture.clear();
    for (const f of snap.furniture ?? []) {
      if (!Array.isArray(f) || f.length < 5 || !furnitureDef(String(f[3]))) continue;
      this.state.furniture.set(cellKey(f[0], f[1], f[2]), { key: String(f[3]), rot: Number(f[4]) & 3 });
    }
    const inv = cleanInventory(snap.inv);
    if (inv) {
      this.state.inv.slots = inv.slots;
      this.state.inv.chest = inv.chest;
    }
    if (this.guestCells) {
      this.guestCells.clear();
      for (const c of Array.isArray(snap.guest_cells) ? snap.guest_cells : []) {
        if (Array.isArray(c) && c.length >= 3) this.guestCells.add(cellKey(Number(c[0]), Number(c[1]), Number(c[2])));
      }
    }
    this.undo = [];
    this.scanNameplates();
    this.hooks.furnitureChanged();
    this.hooks.inventoryChanged();
    return changed;
  }

  /**
   * Cells another person in this world just changed (R326 block relay: a friend on a guest pass in my world, or the
   * host while I visit). The sender relays them once its server took them; this only draws them (bounded by remoteCellsMax). A relay for another world (a sibling's own
   * world in the family room) is ignored, and each cell still passes the build rule here. Returns how many were drawn.
   */
  applyRemote(tag: string, cells: ReadonlyArray<readonly [number, number, number, number]>, furniture: ReadonlyArray<readonly [number, number, number, string, number]> = []): number {
    if (!this.worldTag || tag !== this.worldTag) return 0;
    const sys = { id: 'plot_relay', isSystemGen: true };
    let n = 0;
    for (const [x, y, z, id] of cells) {
      if (this.remoteSinceRead + n >= TUNING.building.relay.remoteCellsMax) {
        // once per read: the engine reads the plot again, which resets the count
        if (!this.remoteFullSaid) this.onRemoteFull?.();
        this.remoteFullSaid = true;
        break;
      }
      if (buildCellRule(this.world, x, y, z, this.scope)) continue;
      if (id !== 0 && !BLOCK_IDS.has(id)) continue;
      const before = this.world.getBlock(x, y, z);
      if (before === id) continue;
      this.delta.note(x, y, z, before, id);
      this.world.setBlock(sys, x, y, z, id);
      this.hooks.blockChanged(x, y, z);
      const k = cellKey(x, y, z);
      // the other person's cell is not mine to break on a pass; a nameplate there gets its room check
      this.guestCells?.delete(k);
      if (id === BK.nameplate) this.nameplates.add(k);
      else this.nameplates.delete(k);
      n++;
    }
    let furn = false;
    for (const [x, y, z, key, rot] of furniture) {
      if (buildCellRule(this.world, x, y, z, this.scope)) continue;
      const k = cellKey(x, y, z);
      if (key === '') furn = this.state.furniture.delete(k) || furn;
      else if (furnitureDef(key)) {
        this.state.furniture.set(k, { key, rot: rot & 3 });
        this.guestCells?.delete(k);
        furn = true;
      }
    }
    if (furn) this.hooks.furnitureChanged();
    this.remoteCells += n;
    this.remoteSinceRead += n;
    return n;
  }

  private scanNameplates(): void {
    this.nameplates.clear();
    const r = plotRegion(this.world);
    for (let y = r.y0; y < r.y1; y++) {
      for (let z = r.z0; z < r.z1; z++) {
        for (let x = r.x0; x < r.x1; x++) if (this.world.getBlock(x, y, z) === BK.nameplate && isInPlot(this.world, x, z)) this.nameplates.add(cellKey(x, y, z));
      }
    }
    // a nameplate the child set into a wall on the open ground (R326) counts the room behind it too
    for (const [x, y, z] of this.delta.changed()) if (this.world.getBlock(x, y, z) === BK.nameplate) this.nameplates.add(cellKey(x, y, z));
  }

  // ---- Room check: on a nameplate placement, and 1 s after edits near a nameplate (D13).
  private markRoomsNear(x: number, y: number, z: number): void {
    let any = false;
    for (const k of this.nameplates) {
      const [nx, ny, nz] = k.split(',').map(Number) as [number, number, number];
      if (Math.abs(nx - x) <= ROOM_REACH && Math.abs(ny - y) <= ROOM_REACH && Math.abs(nz - z) <= ROOM_REACH) {
        if (!this.roomDue.has(k)) this.roomDue.set(k, false);
        any = true;
      }
    }
    if (any) this.scheduleRoomCheck(ROOM_CHECK_DELAY_MS);
  }

  private scheduleRoomCheck(ms: number): void {
    if (this.roomTimer) clearTimeout(this.roomTimer);
    this.roomTimer = setTimeout(() => {
      this.roomTimer = null;
      this.runRoomChecks();
    }, ms);
  }

  /** Run the due checks now (tests and the timer). Reports a nameplate when it is new or its answer changed. */
  runRoomChecks(): RoomCheckEvent[] {
    const out: RoomCheckEvent[] = [];
    for (const [k, always] of this.roomDue) {
      if (!this.nameplates.has(k)) continue;
      const [x, y, z] = k.split(',').map(Number) as [number, number, number];
      const r = checkRoom(this.pickBlockForRoom, this.furnitureAt, { x, y, z });
      const ev: RoomCheckEvent = { missing: r.missing, sentence: r.sentence, ok: r.ok, structure: r.structure, resident: r.resident?.nameEn ?? null, nameplate: { x, y, z } };
      if (always || this.lastRoom.get(k) !== r.sentence) {
        this.lastRoom.set(k, r.sentence);
        out.push(ev);
        this.hooks.roomChecked(ev);
      }
    }
    this.roomDue.clear();
    return out;
  }

  private pickBlockForRoom = (x: number, y: number, z: number): number => this.world.getBlock(x, y, z);

  /** The storage chest cell (tap to open). */
  isChest(x: number, y: number, z: number): boolean {
    return x === PLOT_CHEST_POS.x && y === PLOT_CHEST_POS.y && z === PLOT_CHEST_POS.z;
  }

  dispose(): void {
    if (this.roomTimer) clearTimeout(this.roomTimer);
  }
}
