import { describe, expect, it } from 'vitest';
import {
  BK,
  FREE_BUILD_AREA,
  FREE_MAX_CELLS,
  FREE_MAX_Y,
  FREE_MIN_Y,
  OverlayWorld,
  RoomCore,
  VoxelWorld,
  applyPlotOp,
  blockRef,
  buildCellRule,
  buildTown,
  cellIndex,
  cellOfIndex,
  isInPlot,
  parseBlockRelay,
  starterInventory,
  stowInInventory,
  terrainHeight,
  townGuardAt,
  townProtected,
  type PlotState
} from '../index.js';

/** R326 free build (docs/03 D13 자유 건축): the town rules the client and the server both run. */

let town: VoxelWorld | null = null;
function theTown(): VoxelWorld {
  if (!town) {
    town = new VoxelWorld();
    buildTown(town);
  }
  return town;
}
function worldState(scope: 'world' | 'plot' = 'world'): PlotState & { world: OverlayWorld } {
  const world = new OverlayWorld(theTown());
  const base = theTown();
  return { world, furniture: new Map(), inv: starterInventory(), scope, budget: { townAt: (x, y, z) => base.getBlock(x, y, z), get used() { return world.changedOutsidePlot; } } };
}
// open meadow south-east of the town, well away from every protected place
const MX = 210;
const MZ = 214;
const ME = 'kid';

describe('town guard: the town keeps its places (R326)', () => {
  it('protects every block the town builder put up outside the plot (only nature is left free)', () => {
    const w = theTown();
    const nature = new Set<number>([BK.log, BK.leaves, BK.woolRed, BK.woolPink, BK.flowerRed, BK.flowerYellow, BK.flowerBlue, BK.tallGrass]);
    const free: string[] = [];
    for (let z = FREE_BUILD_AREA.z0; z < FREE_BUILD_AREA.z1; z++) {
      for (let x = FREE_BUILD_AREA.x0; x < FREE_BUILD_AREA.x1; x++) {
        if (isInPlot(w, x, z) || townProtected(x, z)) continue;
        const h = terrainHeight(x, z);
        for (let y = -2; y <= 24; y++) {
          const id = w.getBlock(x, y, z);
          const ground = y > h ? 0 : y === h ? BK.grass : y >= h - 2 ? BK.dirt : BK.stone;
          if (id === ground || nature.has(id)) continue;
          free.push(`${x},${y},${z}:${id}`);
        }
      }
    }
    expect(free.slice(0, 10)).toEqual([]);
  });

  it('names each place and leaves the meadow free', () => {
    expect(townGuardAt(144, 144)).toBe('plaza');
    expect(townGuardAt(170, 134)).toBe('honey_cafe');
    expect(townGuardAt(116, 134)).toBe('trade_shop');
    expect(townGuardAt(144, 102)).toBe('hill_path');
    expect(townGuardAt(149, 103)).toBe('hill_top');
    expect(townGuardAt(122, 150)).toBe('plot_gate');
    expect(townGuardAt(170, 144)).toBe('road_ew');
    expect(townGuardAt(152, 136)).toBe('plaza');
    expect(townGuardAt(MX, MZ)).toBeNull();
    expect(townProtected(MX, MZ)).toBe(false);
    expect(townProtected(-1, 10)).toBe(true);
  });

  it('judges a cell: meadow free, town protected, plot by the plot rules, edge, depth and height, lesson scope', () => {
    const w = theTown();
    const h = terrainHeight(MX, MZ);
    expect(buildCellRule(w, MX, h + 1, MZ, 'world')).toBeNull();
    expect(buildCellRule(w, MX, h, MZ, 'world')).toBeNull();
    expect(buildCellRule(w, 140, 1, 140, 'world')).toBe('protected');
    expect(buildCellRule(w, 170, 20, 134, 'world')).toBe('protected'); // over the cafe roof too
    expect(buildCellRule(w, 126, 1, 170, 'world')).toBeNull(); // inside the plot
    expect(buildCellRule(w, 100, 1, 170, 'world')).toBe('fence');
    expect(buildCellRule(w, FREE_BUILD_AREA.x1, 1, MZ, 'world')).toBe('edge');
    expect(buildCellRule(w, MX, FREE_MIN_Y - 1, MZ, 'world')).toBe('too_low');
    expect(buildCellRule(w, MX, FREE_MAX_Y + 1, MZ, 'world')).toBe('too_high');
    expect(buildCellRule(w, MX, h + 1, MZ, 'plot')).toBe('not_my_plot');
    expect(buildCellRule(w, 126, 1, 170, 'plot')).toBeNull();
    expect(buildCellRule(w, MX + 0.5, 1, MZ, 'world')).toBe('bad_op');
  });
});

describe('OverlayWorld: a child world as a delta over the shared town (R326)', () => {
  it('reads through, keeps only what differs, counts the cells outside the plot', () => {
    const w = new OverlayWorld(theTown());
    const h = terrainHeight(MX, MZ);
    expect(w.getBlock(MX, h, MZ)).toBe(BK.grass);
    expect(w.setBlock({ id: 'k', isOwner: true, townRules: true }, MX, h + 1, MZ, BK.brick).ok).toBe(true);
    expect(w.getBlock(MX, h + 1, MZ)).toBe(BK.brick);
    expect(theTown().getBlock(MX, h + 1, MZ)).toBe(0); // the shared town never changes
    expect(w.changedOutsidePlot).toBe(1);
    w.setBlock({ id: 'k', isOwner: true }, 126, 1, 170, BK.brick);
    expect(w.changedCount).toBe(2);
    expect(w.changedOutsidePlot).toBe(1);
    w.setBlock({ id: 'k', isOwner: true, townRules: true }, MX, h + 1, MZ, 0); // back to the town's: the cell drops out
    expect(w.changedOutsidePlot).toBe(0);
    expect(w.changedCount).toBe(1);
    expect(w.getBlock(-5, 0, 0)).toBe(6);
  });

  it('keeps the zone checks of setBlock (a road strip only refuses an edit not judged by the town rules)', () => {
    const w = new OverlayWorld(theTown());
    expect(w.setBlock({ id: 'k', isOwner: true }, 47, 1, 210, BK.brick).ok).toBe(false);
    expect(w.setBlock({ id: 'k', isOwner: true, townRules: true }, 47, 1, 210, BK.brick).ok).toBe(true);
    expect(w.setBlock({ id: 'stranger' }, 126, 1, 170, BK.brick).ok).toBe(false);
  });

  it('packs and unpacks a cell index', () => {
    for (const c of [[0, -400, 0], [287, 1000, 287], [210, -1, 14], [5, 40, 263]] as const) {
      expect(cellOfIndex(cellIndex(c[0], c[1], c[2]))).toEqual([...c]);
    }
  });
});

describe('applyPlotOp in the open world (R326)', () => {
  it('builds and digs on the meadow, gives the dug block back, refuses the town', () => {
    const s = worldState();
    const h = terrainHeight(MX, MZ);
    expect(applyPlotOp(s, ME, { op: 'place', x: MX, y: h + 1, z: MZ, slot: 0 })).toMatchObject({ ok: true, prev: 0 });
    expect(s.world.getBlock(MX, h + 1, MZ)).toBe(BK.oakPlank);
    const grass = (): number => s.inv.slots.reduce((n, x) => n + (x?.ref === blockRef(BK.grass) ? x.n : 0), 0) + (s.inv.chest[blockRef(BK.grass)] ?? 0);
    const before = grass();
    expect(applyPlotOp(s, ME, { op: 'break', x: MX + 1, y: h, z: MZ })).toMatchObject({ ok: true, prev: BK.grass });
    expect(grass()).toBe(before + 1);
    expect(applyPlotOp(s, ME, { op: 'place', x: 140, y: 1, z: 140, slot: 0 })).toMatchObject({ ok: false, reason: 'protected' });
    expect(applyPlotOp(s, ME, { op: 'break', x: 170, y: 1, z: 128 })).toMatchObject({ ok: false, reason: 'protected' });
    expect(applyPlotOp(s, ME, { op: 'break', x: MX, y: -2, z: MZ })).toMatchObject({ ok: false, reason: 'too_low' });
    expect(s.world.changedOutsidePlot).toBe(2);
  });

  it('a lesson (scope plot) builds only on the plot; no scope means the plot as before', () => {
    const s = worldState('plot');
    const h = terrainHeight(MX, MZ);
    expect(applyPlotOp(s, ME, { op: 'place', x: MX, y: h + 1, z: MZ, slot: 0 })).toMatchObject({ ok: false, reason: 'not_my_plot' });
    expect(applyPlotOp(s, ME, { op: 'place', x: 126, y: 1, z: 170, slot: 0 }).ok).toBe(true);
    const old = { world: s.world, furniture: new Map(), inv: starterInventory() } as PlotState;
    expect(applyPlotOp(old, ME, { op: 'place', x: MX, y: h + 2, z: MZ, slot: 0 })).toMatchObject({ ok: false, reason: 'not_my_plot' });
  });

  it('stops at the cell cap, but a change back to the town always goes', () => {
    const s = worldState();
    const h = terrainHeight(MX, MZ);
    applyPlotOp(s, ME, { op: 'place', x: MX, y: h + 1, z: MZ, slot: 0 });
    const full: PlotState = { ...s, budget: { townAt: s.budget!.townAt, used: FREE_MAX_CELLS } };
    expect(applyPlotOp(full, ME, { op: 'place', x: MX, y: h + 2, z: MZ, slot: 0 })).toMatchObject({ ok: false, reason: 'too_many' });
    expect(applyPlotOp(full, ME, { op: 'break', x: MX + 3, y: h, z: MZ })).toMatchObject({ ok: false, reason: 'too_many' });
    // breaking my own block puts the town's air back: allowed at the cap
    expect(applyPlotOp(full, ME, { op: 'break', x: MX, y: h + 1, z: MZ }).ok).toBe(true);
    // the plot is never counted
    expect(applyPlotOp(full, ME, { op: 'place', x: 126, y: 1, z: 170, slot: 0 }).ok).toBe(true);
  });

  it('places over water and a grass tuft, not into a block', () => {
    const s = worldState();
    const h = terrainHeight(MX, MZ);
    s.world.setBlock({ id: 'sys', isSystemGen: true }, MX, h + 1, MZ, BK.water);
    expect(applyPlotOp(s, ME, { op: 'place', x: MX, y: h + 1, z: MZ, slot: 1 }).ok).toBe(true);
    expect(applyPlotOp(s, ME, { op: 'place', x: MX, y: h + 1, z: MZ, slot: 1 })).toMatchObject({ ok: false, reason: 'occupied' });
  });

  it('breaking a block set into the town water or a grass tuft gives the water or the tuft back, off the cap', () => {
    // a town of its own with a pond cell and a tuft on the meadow (the shared one stays as built)
    const town = new VoxelWorld();
    buildTown(town);
    const h = terrainHeight(MX, MZ);
    const pond = { x: MX, y: h + 1, z: MZ };
    const tuft = { x: MX + 2, y: h + 1, z: MZ };
    town.setBlock({ id: 'sys', isSystemGen: true }, pond.x, pond.y, pond.z, BK.water);
    town.setBlock({ id: 'sys', isSystemGen: true }, tuft.x, tuft.y, tuft.z, BK.tallGrass);
    const world = new OverlayWorld(town);
    const st: PlotState = { world, furniture: new Map(), inv: starterInventory(), scope: 'world', budget: { townAt: (x, y, z) => town.getBlock(x, y, z), get used() { return world.changedOutsidePlot; } } };
    expect(applyPlotOp(st, ME, { op: 'place', ...pond, slot: 1 }).ok).toBe(true);
    expect(world.changedOutsidePlot).toBe(1);
    expect(applyPlotOp(st, ME, { op: 'break', ...pond }).ok).toBe(true);
    expect(world.getBlock(pond.x, pond.y, pond.z)).toBe(BK.water);
    expect(world.changedOutsidePlot).toBe(0);
    expect(applyPlotOp(st, ME, { op: 'place', ...tuft, slot: 1 }).ok).toBe(true);
    expect(applyPlotOp(st, ME, { op: 'break', ...tuft }).ok).toBe(true);
    expect(world.getBlock(tuft.x, tuft.y, tuft.z)).toBe(BK.tallGrass);
    expect(world.changedOutsidePlot).toBe(0);
    // the tuft itself broken: gone (one cell off the town now)
    expect(applyPlotOp(st, ME, { op: 'break', ...tuft }).ok).toBe(true);
    expect(world.getBlock(tuft.x, tuft.y, tuft.z)).toBe(0);
    expect(world.changedOutsidePlot).toBe(1);
  });
});

describe('a shop bundle lands in the hand (R326, docs/19 9장)', () => {
  it('fills the same stack, then an empty slot; a full hand sends its last stack to the chest and nothing is lost', () => {
    const inv = starterInventory();
    const count = (ref: string) => inv.slots.reduce((n, x) => n + (x?.ref === ref ? x.n : 0), 0) + (inv.chest[ref as never] ?? 0);
    const torch = count(blockRef(BK.torch));
    const plank = count(blockRef(BK.plank));
    stowInInventory(inv, blockRef(BK.plank), 16);
    expect(inv.slots[4]).toEqual({ ref: blockRef(BK.plank), n: 16 });
    expect(count(blockRef(BK.torch))).toBe(torch);
    expect(count(blockRef(BK.plank))).toBe(plank + 16);
    stowInInventory(inv, blockRef(BK.plank), 16); // held already: stacks, no second eviction
    expect(inv.slots[4]).toEqual({ ref: blockRef(BK.plank), n: 32 });
    expect(inv.slots[3]?.ref).toBe(blockRef(BK.roofRed));
    inv.slots[2] = null;
    stowInInventory(inv, blockRef(BK.stone), 8); // an empty slot is used first
    expect(inv.slots[2]).toEqual({ ref: blockRef(BK.stone), n: 8 });
  });
});

describe('block relay in the room (R326)', () => {
  it('parses a relay and refuses junk', () => {
    expect(parseBlockRelay({ w: 'wabc123', c: [[210, 3, 214, 18]], f: [[126, 1, 170, 'furn_chair_wood', 1]] })).toEqual({
      w: 'wabc123',
      c: [[210, 3, 214, 18]],
      f: [[126, 1, 170, 'furn_chair_wood', 1]]
    });
    expect(parseBlockRelay({ w: 'wabc123', c: [[210, 3, 214, 0]] })?.f).toEqual([]);
    expect(parseBlockRelay({ w: 'WORLD!', c: [[1, 1, 1, 1]] })).toBeNull();
    expect(parseBlockRelay({ w: 'wabc123', c: [] })).toBeNull();
    expect(parseBlockRelay({ w: 'wabc123', c: [[1.5, 1, 1, 1]] })).toBeNull();
    expect(parseBlockRelay({ w: 'wabc123', c: [[1, 1, 1, 999]] })).toBeNull();
    expect(parseBlockRelay({ w: 'wabc123', c: Array.from({ length: 17 }, () => [1, 1, 1, 1]) })).toBeNull();
    expect(parseBlockRelay({ w: 'wabc123', f: [[1, 1, 1, '<script>', 0]] })).toBeNull();
  });

  it('relays to everyone else in the room, junk counts as a strike', () => {
    const room = new RoomCore(8);
    room.join({ id: 'a', key: 'a', name: 'A', role: 'player' }, 0);
    room.join({ id: 'b', key: 'b', name: 'B', role: 'player' }, 0);
    const r = room.receive('a', JSON.stringify({ t: 'b', w: 'wabc123', c: [[210, 3, 214, 18]] }), 10);
    expect(r).toEqual({ kind: 'broadcast', exceptSelf: true, frame: JSON.stringify({ t: 'b', id: 'a', w: 'wabc123', c: [[210, 3, 214, 18]], f: [] }) });
    expect(room.receive('a', JSON.stringify({ t: 'b', w: 'x', c: [[1, 1, 1, 1]] }), 20)).toEqual({ kind: 'none' });
    expect(room.counters.dropped).toBe(1);
  });
});
