/**
 * Building on my plot in the client (docs/03 D13, WP-201/207): aims, applies the shared sim-core rules at once
 * (optimistic), keeps the undo history (Z, last 20), runs the room check from nameplates, and hands every op to
 * PlotSync for the server, whose answer wins. DOM- and Three-free: the engine draws, this decides.
 */
import {
  BK,
  BUILD_REACH_M,
  BUILD_UNDO_LIMIT,
  EditBucket,
  PLOT_CHEST_POS,
  applyPlotOp,
  blockRef,
  breakSeconds,
  cellKey,
  checkRoom,
  cleanInventory,
  createPlotWorld,
  furnitureDef,
  furnitureRef,
  isInPlot,
  parseRef,
  plotCellRule,
  plotRegion,
  recoveredBlock,
  starterInventory,
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

/** What GET /v1/plot returns (edge plot.ts PlotSnapshot). */
export interface PlotSnapshotLike {
  /** on a guest pass (docs/19 §8): the cells this friend placed and may break again */
  guest_cells?: unknown;
  cells: Array<[number, number, number, number]>;
  furniture: Array<[number, number, number, string, number]>;
  inv: unknown;
  rev: number;
}

/** Client-only refusals on top of the shared rules. */
export type BuildReason = PlotEditReason | 'far' | 'self' | 'paused' | 'loading';

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

export class PlotBuilder {
  readonly state: PlotState;
  private readonly base: VoxelWorld;
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

  constructor(
    readonly world: VoxelWorld,
    private readonly hooks: BuildHooks,
    nowMs: number
  ) {
    this.base = createPlotWorld(world);
    this.state = { world, furniture: new Map(), inv: starterInventory() };
    this.bucket = new EditBucket(nowMs);
    this.scanNameplates();
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
    const paused = this.access === 'paused' ? 'paused' : this.access === 'loading' ? 'loading' : null;
    let placeReason: BuildReason | null = paused ?? (far(place) ? 'far' : plotCellRule(this.world, place.x, place.y, place.z));
    if (!placeReason) {
      const s = this.state.inv.slots[slot];
      if (!s) placeReason = 'empty_slot';
      else if (this.state.furniture.has(cellKey(place.x, place.y, place.z))) placeReason = 'occupied';
      else {
        const what = parseRef(s.ref);
        const prev = this.world.getBlock(place.x, place.y, place.z);
        if (prev !== 0 && prev !== BK.tallGrass) placeReason = 'occupied';
        else if (what?.kind === 'block' && this.overlapsPlayer(place, player)) placeReason = 'self';
        else if (what?.kind === 'furniture') {
          const below = this.world.getBlock(place.x, place.y - 1, place.z);
          if (below === 0 || this.state.furniture.has(cellKey(place.x, place.y - 1, place.z))) placeReason = 'no_support';
        }
      }
    }
    let breakReason: BuildReason | null = paused ?? (far(hit) ? 'far' : plotCellRule(this.world, hit.x, hit.y, hit.z));
    if (!breakReason && this.guestCells && !this.guestCells.has(cellKey(hit.x, hit.y, hit.z))) breakReason = 'not_yours';
    const id = this.world.getBlock(hit.x, hit.y, hit.z);
    const isFurn = this.state.furniture.has(cellKey(hit.x, hit.y, hit.z));
    if (!breakReason && !isFurn) {
      if (id === 0 || id === BK.water) breakReason = 'no_block';
      else if (!Number.isFinite(breakSeconds(id))) breakReason = 'unbreakable';
      else if (this.state.furniture.has(cellKey(hit.x, hit.y + 1, hit.z))) breakReason = 'occupied';
    }
    return { hit: { x: hit.x, y: hit.y, z: hit.z }, place, placeReason, breakReason, breakS: isFurn ? 0.2 : breakSeconds(id) };
  }

  /**
   * A friend on a guest pass builds in the host's plot (docs/19 §8): non-null = the cells this friend placed (the only
   * ones they may break). The chest and the slots stay the host's. The server holds the same rule; this shows it at once.
   */
  guestCells: Set<string> | null = null;

  private notYours(op: PlotOp): boolean {
    if (!this.guestCells) return false;
    if (op.op === 'place') return false;
    return !(op.op === 'break' && this.guestCells.has(cellKey(op.x, op.y, op.z)));
  }

  /** Run one op locally (rules, pace), record undo, queue it for the server. */
  private run(op: PlotOp, nowMs: number, record: boolean): { ok: boolean; reason?: BuildReason } {
    if (this.access === 'paused' || this.access === 'loading') return { ok: false, reason: this.access };
    if (this.notYours(op)) return { ok: false, reason: 'not_yours' };
    if ((op.op === 'place' || op.op === 'break') && !this.bucket.take(nowMs)) return { ok: false, reason: 'rate' };
    const r = applyPlotOp(this.state, 'me', op);
    if (!r.ok) return { ok: false, reason: r.reason };
    this.edits++;
    if (this.guestCells && op.op === 'place') this.guestCells.add(cellKey(op.x, op.y, op.z));
    if (this.guestCells && op.op === 'break') this.guestCells.delete(cellKey(op.x, op.y, op.z));
    this.onOp?.(op);
    if (op.op === 'place' || op.op === 'break') {
      const furn = op.op === 'place' ? this.state.furniture.get(cellKey(op.x, op.y, op.z)) : r.prevFurniture;
      if (furn) this.hooks.furnitureChanged();
      else this.hooks.blockChanged(op.x, op.y, op.z);
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

  // ---- Server snapshot (load / resync): reset the plot to the town's, then lay the saved delta over it.
  applySnapshot(snap: PlotSnapshotLike): void {
    const r = plotRegion(this.world);
    const want = new Map<string, number>();
    for (const c of snap.cells ?? []) {
      if (!Array.isArray(c) || c.length < 4) continue;
      want.set(cellKey(c[0], c[1], c[2]), c[3]);
    }
    const sys = { id: 'plot_sync', isSystemGen: true };
    for (let y = r.y0; y < r.y1; y++) {
      for (let z = r.z0; z < r.z1; z++) {
        for (let x = r.x0; x < r.x1; x++) {
          const k = cellKey(x, y, z);
          const target = want.has(k) && !plotCellRule(this.world, x, y, z) ? want.get(k)! : this.base.getBlock(x, y, z);
          if (this.world.getBlock(x, y, z) !== target) {
            this.world.setBlock(sys, x, y, z, target);
            this.hooks.blockChanged(x, y, z);
          }
        }
      }
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
  }

  private scanNameplates(): void {
    this.nameplates.clear();
    const r = plotRegion(this.world);
    for (let y = r.y0; y < r.y1; y++) {
      for (let z = r.z0; z < r.z1; z++) {
        for (let x = r.x0; x < r.x1; x++) if (this.world.getBlock(x, y, z) === BK.nameplate && isInPlot(this.world, x, z)) this.nameplates.add(cellKey(x, y, z));
      }
    }
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
