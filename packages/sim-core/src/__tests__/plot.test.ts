import { describe, expect, it } from 'vitest';
import {
  BK,
  BUILD_PALETTE,
  EditBucket,
  PLOT_CHEST_POS,
  VoxelWorld,
  applyPlotOp,
  blockRef,
  breakSeconds,
  buildTown,
  cellKey,
  checkRoom,
  cleanInventory,
  createPlotWorld,
  furnitureRef,
  parsePlotOp,
  starterInventory,
  type PlotState
} from '../index.js';

/** docs/03 D13 · docs/11 WP-201/202/207 — the rules the client and the server both run. */

let town: VoxelWorld | null = null;
function plotState(): PlotState {
  if (!town) {
    town = new VoxelWorld();
    buildTown(town);
  }
  return { world: createPlotWorld(town), furniture: new Map(), inv: starterInventory() };
}
const ME = 'kid';
// An empty patch inside the plot, away from the foundation, piles and the gate path.
const X = 126;
const Z = 170;

describe('build palette and inventory (D13)', () => {
  it('has 40 distinct palette blocks, all breakable within 0.2–3 s, scaffold at once', () => {
    expect(BUILD_PALETTE.length).toBe(40);
    expect(new Set(BUILD_PALETTE).size).toBe(40);
    for (const id of BUILD_PALETTE) {
      const s = breakSeconds(id);
      if (id === BK.scaffold) expect(s).toBe(0);
      else {
        expect(s).toBeGreaterThanOrEqual(0.2);
        expect(s).toBeLessThanOrEqual(3);
      }
    }
  });

  it('starts with five carried stacks and a stocked chest including furniture', () => {
    const inv = starterInventory();
    expect(inv.slots.length).toBe(5);
    expect(inv.slots.every((s) => s && s.n > 0)).toBe(true);
    expect(inv.chest[furnitureRef('furn_chair_wood')]).toBeGreaterThan(0);
    expect(inv.chest[blockRef(BK.door)]).toBeGreaterThan(0);
    expect(inv.chest[blockRef(BK.nameplate)]).toBeGreaterThan(0);
  });
});

describe('place and break (WP-201)', () => {
  it('one op is one block: placing uses one from the slot, breaking gives it back (100% recovery)', () => {
    const st = plotState();
    const before = st.inv.slots[0]!.n;
    const r = applyPlotOp(st, ME, { op: 'place', x: X, y: 1, z: Z, slot: 0 });
    expect(r).toMatchObject({ ok: true, prev: 0 });
    expect(st.world.getBlock(X, 1, Z)).toBe(BK.oakPlank);
    expect(st.inv.slots[0]!.n).toBe(before - 1);
    const b = applyPlotOp(st, ME, { op: 'break', x: X, y: 1, z: Z });
    expect(b).toMatchObject({ ok: true, prev: BK.oakPlank });
    expect(st.world.getBlock(X, 1, Z)).toBe(0);
    expect(st.inv.slots[0]!.n).toBe(before);
  });

  it('refuses outside the plot, the fence ring, the chest, occupied cells, empty slots', () => {
    const st = plotState();
    expect(applyPlotOp(st, ME, { op: 'place', x: 140, y: 1, z: 140, slot: 0 }).reason).toBe('not_my_plot');
    expect(applyPlotOp(st, ME, { op: 'break', x: st.world.plot.x0, y: 1, z: 170 }).reason).toBe('fence');
    expect(applyPlotOp(st, ME, { op: 'break', x: PLOT_CHEST_POS.x, y: PLOT_CHEST_POS.y, z: PLOT_CHEST_POS.z }).reason).toBe('chest');
    expect(applyPlotOp(st, ME, { op: 'place', x: X, y: 0, z: Z, slot: 0 }).reason).toBe('occupied');
    expect(applyPlotOp(st, ME, { op: 'place', x: X, y: 40, z: Z, slot: 0 }).reason).toBe('too_high');
    expect(applyPlotOp(st, ME, { op: 'break', x: X, y: -3, z: Z }).reason).toBe('too_low');
    st.inv.slots[2] = null;
    expect(applyPlotOp(st, ME, { op: 'place', x: X, y: 1, z: Z, slot: 2 }).reason).toBe('empty_slot');
    expect(applyPlotOp(st, ME, { op: 'place', x: X, y: 1, z: Z, slot: 9 }).reason).toBe('bad_op');
  });

  it('every cell inside the fence is buildable, also the corner that touches the plaza square', () => {
    const s = plotState();
    const p = s.world.plot;
    // x 128..130, z 157..159 lie inside the plaza's core square too (regression: refused as not_my_plot)
    for (const [x, z] of [[p.x1 - 2, p.z0 + 1], [128, 159], [129, 158], [118, 170]] as const) {
      s.inv.slots[0] = { ref: blockRef(BK.oakPlank), n: 8 };
      for (const y of [8, 15, 23]) expect(applyPlotOp(s, 'kid', { op: 'place', x, y, z, slot: 0 })).toMatchObject({ ok: true });
      expect(s.world.getZone(x, 1, z)).toBe('plot');
    }
    // the plaza itself stays protected
    expect(s.world.getZone(140, 1, 140)).toBe('core');
  });

  it('a full hand sends what is broken to the chest instead of losing it', () => {
    const st = plotState();
    st.inv.slots = st.inv.slots.map((_s, i) => ({ ref: blockRef(BK.glass), n: i === 0 ? 63 : 64 }));
    applyPlotOp(st, ME, { op: 'take', ref: blockRef(BK.brick), n: 1 }); // bag is full of glass: nothing happens
    const chestBrick = st.inv.chest[blockRef(BK.brick)] ?? 0;
    st.world.setBlock({ id: 'sys', isSystemGen: true }, X, 1, Z, BK.brick);
    const r = applyPlotOp(st, ME, { op: 'break', x: X, y: 1, z: Z });
    expect(r).toMatchObject({ ok: true, toChest: true });
    expect(st.inv.chest[blockRef(BK.brick)]).toBe(chestBrick + 1);
  });

  it('furniture sits on a solid cell, is not a block, and comes back when picked up', () => {
    const st = plotState();
    const r0 = applyPlotOp(st, ME, { op: 'take', ref: furnitureRef('furn_chair_wood'), n: 1, slot: 4 });
    expect(r0.ok).toBe(true);
    expect(applyPlotOp(st, ME, { op: 'place', x: X, y: 3, z: Z, slot: 4 }).reason).toBe('no_support');
    expect(applyPlotOp(st, ME, { op: 'place', x: X, y: 1, z: Z, slot: 4, rot: 5 }).ok).toBe(true);
    expect(st.world.getBlock(X, 1, Z)).toBe(0);
    expect(st.furniture.get(cellKey(X, 1, Z))).toEqual({ key: 'furn_chair_wood', rot: 1 });
    // the ground under a chair cannot be dug away
    expect(applyPlotOp(st, ME, { op: 'break', x: X, y: 0, z: Z }).reason).toBe('occupied');
    expect(applyPlotOp(st, ME, { op: 'break', x: X, y: 1, z: Z }).ok).toBe(true);
    expect(st.furniture.size).toBe(0);
    expect(st.inv.slots.some((s) => s?.ref === furnitureRef('furn_chair_wood'))).toBe(true);
  });

  it('take / store / swap move stacks between hand and chest without making or losing anything', () => {
    const st = plotState();
    const total = () =>
      st.inv.slots.reduce((a, s) => a + (s?.n ?? 0), 0) + Object.values(st.inv.chest).reduce<number>((a, n) => a + (n ?? 0), 0);
    const t0 = total();
    expect(applyPlotOp(st, ME, { op: 'store', slot: 1, n: 99 }).ok).toBe(true);
    expect(st.inv.slots[1]).toBeNull();
    expect(applyPlotOp(st, ME, { op: 'take', ref: blockRef(BK.lantern), n: 10, slot: 1 }).ok).toBe(true);
    expect(st.inv.slots[1]).toEqual({ ref: blockRef(BK.lantern), n: 10 });
    // taking into an occupied slot puts the old stack back first
    expect(applyPlotOp(st, ME, { op: 'take', ref: blockRef(BK.door), n: 2, slot: 1 }).ok).toBe(true);
    expect(st.inv.slots[1]).toEqual({ ref: blockRef(BK.door), n: 2 });
    expect(applyPlotOp(st, ME, { op: 'swap', a: 0, b: 1 }).ok).toBe(true);
    expect(st.inv.slots[0]?.ref).toBe(blockRef(BK.door));
    expect(total()).toBe(t0);
  });

  it('parses only well-formed ops', () => {
    expect(parsePlotOp({ op: 'place', x: 1, y: 2, z: 3, slot: 0 })).toEqual({ op: 'place', x: 1, y: 2, z: 3, slot: 0, rot: 0 });
    expect(parsePlotOp({ op: 'place', x: 1.5, y: 2, z: 3, slot: 0 })).toBeNull();
    expect(parsePlotOp({ op: 'take', ref: 'b6', n: 1 })).toBeNull(); // bedrock is not a build block
    expect(parsePlotOp({ op: 'take', ref: 'fsofa_nope', n: 1 })).toBeNull();
    expect(parsePlotOp({ op: 'nuke' })).toBeNull();
    expect(cleanInventory({ slots: [{ ref: 'b6', n: 3 }, { ref: 'b18', n: 999 }], chest: { b6: 9, b18: -2, ffurn_chair_wood: 1 } })).toEqual({
      slots: [null, { ref: 'b18', n: 64 }, null, null, null],
      chest: { ffurn_chair_wood: 1 }
    });
  });

  it('paces edits at about four a second with a short burst (server bucket)', () => {
    const b = new EditBucket(0);
    let n = 0;
    for (let i = 0; i < 40; i++) if (b.take(0)) n++;
    expect(n).toBe(10);
    let later = 0;
    for (let t = 0; t <= 2000; t += 50) if (b.take(t)) later++;
    expect(later).toBeGreaterThanOrEqual(9);
    expect(later).toBeLessThanOrEqual(11);
  });
});

/** A 5×4×4 inside room (x X..X+4, z Z..Z+3, y 1..3) with walls, floor, ceiling; nameplate on the west wall. */
function buildRoom(st: PlotState, opts: { door?: boolean; light?: boolean; chair?: boolean; table?: boolean; hole?: boolean } = {}) {
  const sys = { id: 'sys', isSystemGen: true };
  const x0 = X - 1;
  const x1 = X + 5;
  const z0 = Z - 1;
  const z1 = Z + 4;
  for (let x = x0; x <= x1; x++) {
    for (let z = z0; z <= z1; z++) {
      for (let y = 0; y <= 4; y++) {
        const wall = x === x0 || x === x1 || z === z0 || z === z1 || y === 0 || y === 4;
        st.world.setBlock(sys, x, y, z, wall ? BK.brick : 0);
      }
    }
  }
  if (opts.door) {
    st.world.setBlock(sys, x1, 1, Z + 1, BK.door);
    st.world.setBlock(sys, x1, 2, Z + 1, BK.door);
  }
  if (opts.hole) st.world.setBlock(sys, x1, 2, Z + 2, 0);
  if (opts.light) st.world.setBlock(sys, X + 2, 3, Z + 3, BK.torch);
  if (opts.chair) st.furniture.set(cellKey(X, 1, Z), { key: 'furn_chair_wood', rot: 0 });
  if (opts.table) st.furniture.set(cellKey(X + 1, 1, Z), { key: 'furn_table_dining', rot: 0 });
  // nameplate set into the west wall, facing in
  st.world.setBlock(sys, x0, 2, Z + 1, BK.nameplate);
  return { x: x0, y: 2, z: Z + 1 };
}
const roomOf = (st: PlotState, np: { x: number; y: number; z: number }) =>
  checkRoom((x, y, z) => st.world.getBlock(x, y, z), (x, y, z) => st.furniture.get(cellKey(x, y, z)), np);

describe('room check from a nameplate (D13 방 판정)', () => {
  it('names the first missing thing in an English sentence, then says the room is complete', () => {
    const st = plotState();
    let np = buildRoom(st);
    let r = roomOf(st, np);
    expect(r.cells).toBe(5 * 4 * 3);
    expect(r.structure).toEqual(['door']);
    expect(r.missing).toEqual(['light', 'rest', 'flat']);
    expect(r.sentence).toBe('This room needs a door.');
    np = buildRoom(st, { door: true });
    expect(roomOf(st, np).sentence).toBe('This room needs a light source.');
    np = buildRoom(st, { door: true, light: true });
    expect(roomOf(st, np).sentence).toBe('This room needs a bed or a chair.');
    np = buildRoom(st, { door: true, light: true, chair: true });
    expect(roomOf(st, np)).toMatchObject({ missing: ['flat'], sentence: 'This room needs a table or workbench.' });
    np = buildRoom(st, { door: true, light: true, chair: true, table: true });
    expect(roomOf(st, np)).toMatchObject({ ok: true, missing: [], structure: [], sentence: 'What a lovely room!', resident: null });
  });

  it('a lamp counts as light, and a stove in a complete room invites the chef (D13 residents)', () => {
    const st = plotState();
    const np = buildRoom(st, { door: true, chair: true, table: true });
    expect(roomOf(st, np).missing).toEqual(['light']);
    st.furniture.set(cellKey(X + 2, 1, Z), { key: 'furn_lamp_table', rot: 0 });
    expect(roomOf(st, np)).toMatchObject({ ok: true, resident: null });
    st.furniture.set(cellKey(X + 3, 1, Z), { key: 'job_stove', rot: 0 });
    const r = roomOf(st, np);
    expect(r.resident?.id).toBe('res_chef');
    expect(r.sentence).toBe('This room is ready for a resident!');
  });

  it('a hole lets the walk leak outside: capped at 400 cells and reported', () => {
    const st = plotState();
    const np = buildRoom(st, { door: true, light: true, hole: true });
    const r = roomOf(st, np);
    expect(r.structure).toEqual(['closed']);
    expect(r.sentence).toBe('This room is too big or not enclosed.');
    expect(r.cells).toBeLessThanOrEqual(401);
  });

  it('a room one block high needs a higher ceiling', () => {
    const st = plotState();
    const sys = { id: 'sys', isSystemGen: true };
    const np = buildRoom(st, { door: true, light: true, chair: true, table: true });
    for (let x = X; x <= X + 4; x++) for (let z = Z; z <= Z + 3; z++) st.world.setBlock(sys, x, 2, z, BK.brick);
    // y=1 only now (door cell at y1 stays), nameplate at y2 faces brick: put it at y1
    st.world.setBlock(sys, np.x, 2, np.z, BK.brick);
    st.world.setBlock(sys, np.x, 1, np.z, BK.nameplate);
    const r = roomOf(st, { x: np.x, y: 1, z: np.z });
    expect(r.structure).toContain('ceiling');
  });
});
