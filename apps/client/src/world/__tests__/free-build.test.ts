// R326 free build in the client (docs/03 D13 자유 건축): build and dig anywhere in my own world the town rules allow,
// the town's places and the NPC walks stay, a snapshot puts back what the server does not hold, a relay from another
// world is ignored.
import { describe, expect, it } from 'vitest';
import { BK, FREE_MAX_CELLS, TUNING, VoxelWorld, buildTown, cellKey, terrainHeight, townProtected, type PlotOp } from '@lcw/sim-core';
import { PlotBuilder, type CellChange } from '../build.js';
import { NPCS, SCENES, WANDERERS } from '../town.js';
import { BUILD_REASONS_KO } from '../strings.js';

let shared: VoxelWorld | null = null;
function freshWorld(): VoxelWorld {
  const w = new VoxelWorld();
  buildTown(w);
  return w;
}

function builder() {
  const changed: string[] = [];
  const b = new PlotBuilder(
    freshWorld(),
    { blockChanged: (x, y, z) => changed.push(cellKey(x, y, z)), furnitureChanged: () => undefined, inventoryChanged: () => undefined, roomChecked: () => undefined },
    0
  );
  return { b, changed };
}

const MX = 210;
const MZ = 214;
const H = terrainHeight(MX, MZ);
const me = { x: MX + 0.5, y: H + 1, z: MZ - 2.5 };
const onTop = (x: number, z: number) => ({ x, y: terrainHeight(x, z), z, nx: 0, ny: 1, nz: 0 });

describe('the town keeps the places NPCs and lessons use (R326)', () => {
  it('every scene stand, NPC spot, walk and wanderer route is protected or on the plot', () => {
    shared ??= freshWorld();
    const plot = shared.plot;
    const inPlot = (x: number, z: number) => x >= plot.x0 && x < plot.x1 && z >= plot.z0 && z < plot.z1;
    const open: string[] = [];
    const check = (x: number, z: number, what: string) => {
      const cx = Math.floor(x);
      const cz = Math.floor(z);
      if (!inPlot(cx, cz) && !townProtected(cx, cz)) open.push(`${what} ${cx},${cz}`);
    };
    const walk = (pts: ReadonlyArray<readonly [number, number]>, what: string) => {
      for (let i = 0; i + 1 < pts.length; i++) {
        const [ax, az] = pts[i]!;
        const [bx, bz] = pts[i + 1]!;
        const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) * 4));
        for (let k = 0; k <= n; k++) check(ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n, what);
      }
    };
    for (const s of Object.values(SCENES)) {
      check(s.player.x, s.player.z, `${s.id} player`);
      if (s.npc) check(s.npc.spot.x, s.npc.spot.z, `${s.id} npc`);
      walk(s.path, `${s.id} path`);
      // the auto-walk from the plaza to the first waypoint
      walk([[SCENES.plaza.player.x, SCENES.plaza.player.z], s.path[0]!], `${s.id} start`);
    }
    for (const n of NPCS) if (n.spot) check(n.spot.x, n.spot.z, n.id);
    for (const w of WANDERERS) walk([...w.route, w.route[0]!], w.id);
    expect(open).toEqual([]);
  });
});

describe('PlotBuilder in the open world (R326)', () => {
  it('builds and digs on the meadow, shows the controls there, refuses the plaza with its own reason', () => {
    const { b } = builder();
    expect(b.scope).toBe('world');
    expect(b.canBuildNear(MX, MZ)).toBe(true);
    const a = b.aim(onTop(MX, MZ), me, 0);
    expect(a.placeReason).toBeNull();
    expect(a.breakReason).toBeNull();
    expect(b.place(a.place, 0, 0).ok).toBe(true);
    expect(b.world.getBlock(MX, H + 1, MZ)).toBe(BK.oakPlank);
    expect(b.breakAt({ x: MX + 1, y: H, z: MZ }, 1000).ok).toBe(true);
    expect(b.delta.used).toBe(2);
    const plaza = b.aim({ x: 140, y: 0, z: 140, nx: 0, ny: 1, nz: 0 }, { x: 140, y: 1, z: 137 }, 0);
    expect(plaza.placeReason).toBe('protected');
    expect(plaza.breakReason).toBe('protected');
    expect(BUILD_REASONS_KO.protected).toBeTruthy();
    expect(BUILD_REASONS_KO.too_many).toBeTruthy();
    expect(BUILD_REASONS_KO.edge).toBeTruthy();
    // undo takes the dig back: the grass returns and the delta shrinks
    expect(b.undoLast(2000).ok).toBe(true);
    expect(b.world.getBlock(MX + 1, H, MZ)).toBe(BK.grass);
    expect(b.delta.used).toBe(1);
  });

  it('a lesson builds on the plot only: no controls on the meadow, the plot as before', () => {
    const { b } = builder();
    b.scope = 'plot';
    expect(b.canBuildNear(MX, MZ)).toBe(false);
    expect(b.aim(onTop(MX, MZ), me, 0).placeReason).toBe('not_my_plot');
    expect(b.canBuildNear(126, 170)).toBe(true);
  });

  it('standing in the plaza the controls show where free ground is within reach, not in the middle of it', () => {
    const { b } = builder();
    expect(b.canBuildNear(144, 144)).toBe(false);
    expect(b.canBuildNear(162, 150)).toBe(true); // the plaza's east edge: the meadow is a step away
  });

  it('refuses one changed cell past the cap but always lets a change go back to the town', () => {
    const { b } = builder();
    expect(b.place({ x: MX, y: H + 1, z: MZ }, 0, 0).ok).toBe(true);
    // stand in for a full world: the budget reads the delta
    Object.defineProperty(b.delta, 'used', { get: () => FREE_MAX_CELLS });
    expect(b.aim(onTop(MX - 2, MZ), me, 0).placeReason).toBe('too_many');
    expect(b.place({ x: MX - 2, y: terrainHeight(MX - 2, MZ) + 1, z: MZ }, 0, 1000)).toMatchObject({ ok: false, reason: 'too_many' });
    expect(b.breakAt({ x: MX, y: H + 1, z: MZ }, 2000).ok).toBe(true);
  });

  it('a snapshot puts back what the server does not hold and lays the saved cells on, outside the plot too', () => {
    const { b, changed } = builder();
    b.place({ x: MX, y: H + 1, z: MZ }, 0, 0);
    b.breakAt({ x: MX + 1, y: H, z: MZ }, 1000);
    changed.length = 0;
    // the server kept the dig and a tower elsewhere, not the plank
    const fixed = b.applySnapshot({
      cells: [[MX + 1, H, MZ, 0], [MX + 5, H + 1, MZ, BK.brick], [140, 1, 140, BK.brick], [126, 1, 170, BK.glass]],
      furniture: [],
      inv: null,
      rev: 3,
      scope: 'world',
      world_tag: 'wtag1'
    });
    expect(b.world.getBlock(MX, H + 1, MZ)).toBe(0);
    expect(b.world.getBlock(MX + 1, H, MZ)).toBe(0);
    expect(b.world.getBlock(MX + 5, H + 1, MZ)).toBe(BK.brick);
    expect(b.world.getBlock(126, 1, 170)).toBe(BK.glass);
    // the plaza cell is refused by the town rules on this side too
    expect(b.world.getBlock(140, 1, 140)).not.toBe(BK.brick);
    expect(fixed.map((c) => c.join(','))).toEqual([`${MX},${H + 1},${MZ},0`, `${MX + 5},${H + 1},${MZ},${BK.brick}`, `126,1,170,${BK.glass}`]);
    expect(b.worldTag).toBe('wtag1');
    expect(b.delta.used).toBe(2);
    // the same snapshot again changes nothing
    expect(b.applySnapshot({ cells: [[MX + 1, H, MZ, 0], [MX + 5, H + 1, MZ, BK.brick], [126, 1, 170, BK.glass]], furniture: [], inv: null, rev: 3 })).toEqual([]);
    // a lesson snapshot says the plot only, and a home-world cell outside the plot stays off the class town
    b.applySnapshot({ cells: [[MX + 5, H + 1, MZ, BK.brick], [126, 1, 170, BK.glass]], furniture: [], inv: null, rev: 4, scope: 'plot' });
    expect(b.scope).toBe('plot');
    expect(b.world.getBlock(MX + 5, H + 1, MZ)).toBe(0);
    expect(b.world.getBlock(126, 1, 170)).toBe(BK.glass);
    expect(b.delta.used).toBe(0);
    // a relay of the home meadow is not drawn in a lesson either
    b.worldTag = 'wtag1';
    expect(b.applyRemote('wtag1', [[MX + 6, H + 1, MZ, BK.brick]])).toBe(0);
  });

  it('a relay draws at most remoteCellsMax cells until the next server read (a forged tag cannot fill my cap)', () => {
    const { b } = builder();
    b.applySnapshot({ cells: [], furniture: [], inv: null, rev: 1, world_tag: 'wtag1' });
    const max = TUNING.building.relay.remoteCellsMax;
    let full = 0;
    b.onRemoteFull = () => full++;
    let drawn = 0;
    for (let x = 200; x < 262 && drawn < max + 50; x++) {
      for (let z = 200; z < 262; z += 1) {
        drawn += b.applyRemote('wtag1', [[x, terrainHeight(x, z) + 1, z, BK.brick]]);
      }
    }
    expect(drawn).toBe(max);
    expect(b.applyRemote('wtag1', [[MX, H + 3, MZ, BK.brick]])).toBe(0);
    // reaching the cap asks the engine once to read the plot again (the engine also spaces those reads)
    expect(full).toBe(1);
    // the next server read puts the relayed cells back to the saved truth and opens the relay again
    b.applySnapshot({ cells: [], furniture: [], inv: null, rev: 2, world_tag: 'wtag1' });
    expect(b.delta.used).toBe(0);
    expect(b.applyRemote('wtag1', [[MX, H + 3, MZ, BK.brick]])).toBe(1);
  });

  it('furniture needs a solid block under it, the same rule as the server (a grass tuft holds nothing up)', () => {
    const { b } = builder();
    b.state.inv.slots[4] = { ref: 'ffurn_chair_wood' as never, n: 1 };
    b.world.setBlock({ id: 'sys', isSystemGen: true }, MX, H + 1, MZ, BK.tallGrass);
    const aim = b.aim({ x: MX, y: H + 1, z: MZ, nx: 0, ny: 1, nz: 0 }, me, 4);
    expect(aim?.placeReason).toBe('no_support');
  });

  it('draws a relay for the world it has open, ignores another world, a protected cell and an unknown block', () => {
    const { b } = builder();
    expect(b.applyRemote('wtag1', [[MX, H + 1, MZ, BK.brick]])).toBe(0); // no snapshot yet: no world named
    b.applySnapshot({ cells: [], furniture: [], inv: null, rev: 1, world_tag: 'wtag1' });
    expect(b.applyRemote('wsibling', [[MX, H + 1, MZ, BK.brick]])).toBe(0);
    expect(b.applyRemote('wtag1', [[MX, H + 1, MZ, BK.brick], [140, 1, 140, BK.brick], [MX, H + 2, MZ, 250]])).toBe(1);
    expect(b.world.getBlock(MX, H + 1, MZ)).toBe(BK.brick);
    expect(b.world.getBlock(140, 1, 140)).not.toBe(BK.brick);
    expect(b.delta.used).toBe(1);
    // furniture relayed into the plot, then taken away
    b.applyRemote('wtag1', [], [[126, 1, 170, 'furn_chair_wood', 1]]);
    expect(b.state.furniture.get(cellKey(126, 1, 170))).toEqual({ key: 'furn_chair_wood', rot: 1 });
    b.applyRemote('wtag1', [], [[126, 1, 170, '', 0]]);
    expect(b.state.furniture.has(cellKey(126, 1, 170))).toBe(false);
  });

  it('relays what this device changed, never what a snapshot or a relay brought', () => {
    const { b } = builder();
    const out: CellChange[] = [];
    b.onCells = (c) => out.push(c);
    b.place({ x: MX, y: H + 1, z: MZ }, 0, 0);
    b.breakAt({ x: MX, y: H + 1, z: MZ }, 1000);
    b.applySnapshot({ cells: [[MX + 3, H + 1, MZ, BK.brick]], furniture: [], inv: null, rev: 1, world_tag: 'wtag1' });
    b.applyRemote('wtag1', [[MX + 4, H + 1, MZ, BK.brick]]);
    expect(out).toEqual([
      { cells: [[MX, H + 1, MZ, BK.oakPlank]], furniture: [] },
      { cells: [[MX, H + 1, MZ, 0]], furniture: [] }
    ]);
  });

  it('a friend on a guest pass builds on the host meadow and breaks only what they placed', () => {
    const { b } = builder();
    b.guestCells = new Set();
    b.applySnapshot({ cells: [[MX + 6, H + 1, MZ, BK.brick]], furniture: [], inv: null, rev: 1, guest_cells: [], world_tag: 'wh' });
    expect(b.place({ x: MX, y: H + 1, z: MZ }, 0, 0).ok).toBe(true);
    expect(b.breakAt({ x: MX, y: H + 1, z: MZ }, 1000).ok).toBe(true);
    expect(b.breakAt({ x: MX + 6, y: H + 1, z: MZ }, 2000)).toMatchObject({ ok: false, reason: 'not_yours' });
    expect(b.breakAt({ x: MX + 2, y: H, z: MZ }, 3000)).toMatchObject({ ok: false, reason: 'not_yours' });
    // the host breaks the friend's block: it is not the friend's to break again
    b.place({ x: MX + 1, y: H + 1, z: MZ }, 0, 4000);
    b.applyRemote('wh', [[MX + 1, H + 1, MZ, BK.glass]]);
    expect(b.aim({ x: MX + 1, y: H + 1, z: MZ, nx: 0, ny: 1, nz: 0 }, me, 0).breakReason).toBe('not_yours');
  });

  it('the server rule and the ops the client sends agree for a free-build op', () => {
    const { b } = builder();
    const ops: PlotOp[] = [];
    b.onOp = (op) => ops.push(op);
    b.place({ x: MX, y: H + 1, z: MZ }, 0, 0);
    expect(ops).toEqual([{ op: 'place', x: MX, y: H + 1, z: MZ, slot: 0, rot: 0 }]);
  });
});
