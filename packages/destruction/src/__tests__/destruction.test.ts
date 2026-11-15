import { beforeEach, describe, expect, it } from 'vitest';
import {
  B,
  CFG,
  check,
  resetCfg,
  runFuzz,
  World,
  Z,
  type MutantFlags
} from '../index.js';

function mk(n = 3, mut: MutantFlags = {}): World {
  const w = new World(7, mut, { visitorBuild: true });
  for (let i = 0; i < n; i++) {
    w.players.push({
      id: i,
      x: 20.5 + i * 9,
      y: 30,
      z: 20.5,
      vx: 0,
      vy: 0,
      vz: 0,
      owner: i === 0
    });
  }
  return w;
}

function snapCore(w: World): number {
  let h = 0;
  for (let x = 120; x < 168; x++) {
    for (let z = 120; z < 168; z++) {
      for (let y = -4; y < 24; y++) {
        if (w.zone(x, y, z) === Z.CORE) h = (Math.imul(h, 31) + w.get(x, y, z) + 1) | 0;
      }
    }
  }
  return h;
}

function steps(w: World, n: number): void {
  for (let i = 0; i < n; i++) w.step();
}

describe('@lcw/destruction WP-203 & WP-204 acceptance', () => {
  beforeEach(() => {
    resetCfg();
  });

  it('T01: max power explosions in central plaza leave core intact', () => {
    const w = mk();
    const h = snapCore(w);
    for (let i = 0; i < 40; i++) {
      w.explode(i % 3, 144.5, 1.5, 144.5, 6);
      steps(w, 6);
    }
    expect(snapCore(w)).toBe(h);
    expect(w.delta.size).toBe(0);
    expect(w.temp.size).toBe(0);
  });

  it('T02: rockets fired along road into plaza explode without changing core', () => {
    const w = mk();
    const h = snapCore(w);
    for (let i = 0; i < 12; i++) {
      w.rocket(i % 3, 144.5, 3.5, 90 + i, 0, -0.06, 1, 2);
      steps(w, 70);
    }
    expect(snapCore(w)).toBe(h);
    expect(w.stats.explosions).toBe(12);
    expect(w.delta.size + w.temp.size).toBe(0);
  });

  it('T03: 512 dynamite chain respects pending queue cap and drains completely', () => {
    const w = mk();
    let placed = 0;
    for (let x = 0; x < 8; x++) {
      for (let y = 0; y < 8; y++) {
        for (let z = 0; z < 8; z++) {
          if (w.place(0, 200 + x, 14 + y, 200 + z, B.DYNAMITE)) placed++;
        }
      }
    }
    w.explode(0, 204.5, 18.5, 204.5, 4);
    let maxP = 0;
    for (let i = 0; i < 2000; i++) {
      w.step();
      maxP = Math.max(maxP, w.pending.length);
    }
    expect(placed).toBe(512);
    expect(maxP).toBeLessThanOrEqual(CFG.MAX_PENDING_EXPLOSIONS);
    expect(w.pending.length).toBe(0);
    expect(w.stats.maxOpsTick).toBeLessThanOrEqual(CFG.MAX_BLOCK_OPS_PER_TICK);
  });

  it('T04: 8 players spamming water bombs stays under 4096 cells, changes 0 blocks, and evaporates', () => {
    const w = mk(8);
    for (let t = 0; t < 400; t++) {
      if (t % 5 === 0) {
        for (let a = 0; a < 8; a++) {
          w.waterBomb(a, 60 + a * 20 + (t % 7), 40, 80 + (t % 11) * 3);
        }
      }
      w.step();
    }
    expect(w.stats.maxFluid).toBeLessThanOrEqual(CFG.MAX_FLUID);
    expect(w.delta.size + w.temp.size).toBe(0);
    steps(w, 500);
    expect(w.fluid.size).toBe(0);
  });

  it('T05: attempting to wall off roads is rejected and road connectivity holds', () => {
    const w = mk();
    for (let x = 140; x < 148; x++) {
      for (let y = 1; y < 5; y++) {
        w.place(1, x, y, 100, B.VAULT);
      }
    }
    const v = check(w, { deep: true, core: null }).filter((s) => s !== 'I8 core changed');
    expect(w.get(143, 1, 100)).toBe(B.AIR);
    expect(v).toEqual([]);
  });

  it('T06: player standing in broken city wall when healed is pushed up without getting stuck', () => {
    const w = mk();
    w.explode(1, 59.5, 3.5, 54.5, 6);
    steps(w, 5);
    let gone: [number, number] | null = null;
    for (let x = 54; x < 66 && !gone; x++) {
      for (let y = 1; y < 8 && !gone; y++) {
        if (
          w.base(x, y, 54) !== B.AIR &&
          w.get(x, y, 54) === B.AIR &&
          w.get(x, y + 1, 54) === B.AIR
        ) {
          gone = [x, y];
        }
      }
    }
    expect(gone).not.toBeNull();
    const p = w.players[2]!;
    p.x = gone![0] + 0.5;
    p.y = gone![1];
    p.z = 54.5;
    p.vx = p.vy = p.vz = 0;
    let stuck = 0;
    for (let i = 0; i < CFG.HEAL_TICKS + 400; i++) {
      w.step();
      if (w.solidAtPlayer(p)) stuck++;
    }
    expect(stuck).toBe(0);
    expect(w.temp.size).toBe(0);
  });

  it('T07: visitor blast cannot break plot; owner blast works; rollback restores cleanly', () => {
    const w = mk();
    for (let y = 1; y < 4; y++) w.place(0, 116, y, 170, B.PLANK);
    expect(w.delta.size).toBe(3);
    w.explode(1, 116.5, 2.5, 171.5, 6);
    steps(w, 5);
    expect(w.delta.size).toBe(3);
    w.explode(0, 116.5, 2.5, 171.5, 6);
    steps(w, 5);
    expect(w.delta.size).not.toBe(3);
    w.rollbackAll();
    expect(w.delta.size).toBe(0);
  });

  it('T08: reaching permanent delta cap spills excess edits to temp layer which heals', () => {
    CFG.MAX_DELTA = 50;
    const w = mk();
    for (let i = 0; i < 120; i++) {
      w.place(0, 10 + (i % 30), 20 + Math.floor(i / 30), 10, B.STONE);
    }
    expect(w.delta.size).toBe(50);
    expect(w.temp.size).toBe(70);
    steps(w, CFG.HEAL_TICKS + 5);
    expect(w.temp.size).toBe(0);
  });

  it('T09: blocks per explosion cap stops calculation cleanly', () => {
    CFG.MAX_BLOCKS_PER_EXPLOSION = 100;
    const w = mk();
    for (let x = 0; x < 12; x++) {
      for (let y = 0; y < 12; y++) {
        for (let z = 0; z < 12; z++) {
          w.place(0, 200 + x, 20 + y, 60 + z, B.GLASS);
        }
      }
    }
    w.explode(0, 206.5, 26.5, 66.5, 6);
    steps(w, 3);
    expect(w.stats.maxExpBlocks).toBeGreaterThan(0);
    expect(w.stats.maxExpBlocks).toBeLessThanOrEqual(100);
  });

  it('T10: block ops budget per tick splits large explosions across ticks', () => {
    CFG.MAX_BLOCK_OPS_PER_TICK = 50;
    const w = mk();
    for (let x = 0; x < 12; x++) {
      for (let y = 0; y < 12; y++) {
        for (let z = 0; z < 12; z++) {
          w.place(0, 200 + x, 20 + y, 60 + z, B.GLASS);
        }
      }
    }
    w.explode(0, 206.5, 26.5, 66.5, 6);
    steps(w, 2);
    expect(w.ops.length).toBeGreaterThan(0);
    steps(w, 200);
    expect(w.stats.maxOpsTick).toBeLessThanOrEqual(50);
    expect(w.ops.length).toBe(0);
  });

  it('T11: absurdly high speed rocket is clamped and cannot tunnel through 1-block wall', () => {
    const w = mk();
    for (let x = 0; x < 9; x++) {
      for (let y = 0; y < 9; y++) {
        w.place(0, 196 + x, 26 + y, 80, B.VAULT);
      }
    }
    w.rocket(0, 200.5, 30.5, 60.5, 0, 0, 1, 1e9);
    let maxZ = 0;
    for (let i = 0; i < 60; i++) {
      w.step();
      for (const p of w.proj) maxZ = Math.max(maxZ, p.z);
    }
    expect(maxZ).toBeLessThan(80);
    expect(w.stats.explosions).toBe(1);
    expect(w.get(200, 30, 80)).toBe(B.VAULT);
  });

  it('T12: global projectile cap accepts 32 of 54 shots', () => {
    const w = mk(9);
    let ok = 0;
    for (let a = 0; a < 9; a++) {
      for (let k = 0; k < 6; k++) {
        if (w.rocket(a, 30 + a * 20, 50, 30 + k * 5, 0, 0.2, 1, 0.3)) ok++;
      }
    }
    expect(ok).toBe(32);
    expect(w.proj.length).toBe(32);
  });

  it('T13: actor explosion rate limit accepts 4 per second out of 20 requests', () => {
    const w = mk();
    let ok = 0;
    for (let k = 0; k < 20; k++) {
      if (w.explode(0, 200.5, 12.5, 200.5 + k, 3)) ok++;
    }
    expect(ok).toBe(CFG.ACTOR_EXPLOSIONS_PER_SEC);
  });

  it('T14: malformed inputs produce zero exceptions, zero explosions, and zero block changes', () => {
    const w = mk();
    const bad = [NaN, Infinity, -Infinity, 1e300, -1e300, null, undefined, '5', {}, []] as unknown as number[];
    for (const v of bad) {
      w.explode(0, v, 5, 5, 4);
      w.setBlock(0, v, 5, 5, 1);
      w.setBlock(0, 5, 5, 5, v);
      w.waterBomb(0, 5, v, 5);
      w.rocket(0, v, 5, 5, 0, 0, 1, 1);
      w.rocket(0, 5, 30, 5, 0, 0, 1, v);
      w.impulse(0, v, 0, 0);
    }
    steps(w, 50);
    expect(w.delta.size).toBe(0);
    expect(w.temp.size).toBe(0);
    expect(w.stats.explosions).toBe(0);
    expect(check(w, { deep: false })).toEqual([]);
  });

  it('T15: glass cube explosion respects MAX_BLOCKS_PER_EXPLOSION', () => {
    const w = mk();
    for (let x = 0; x < 20; x++) {
      for (let y = 0; y < 20; y++) {
        for (let z = 0; z < 20; z++) {
          w.place(0, 190 + x, 20 + y, 100 + z, B.GLASS);
        }
      }
    }
    w.explode(0, 200.5, 30.5, 110.5, 6);
    steps(w, 3);
    expect(w.stats.maxExpBlocks).toBeGreaterThan(0);
    expect(w.stats.maxExpBlocks).toBeLessThanOrEqual(CFG.MAX_BLOCKS_PER_EXPLOSION);
  });

  it('T16: max-power explosion calculation remains fast', () => {
    const w = mk();
    const t0 = performance.now();
    const N = 20;
    for (let i = 0; i < N; i++) {
      w.runExplosion({ x: 60.5 + i, y: 4.5, z: 200.5, power: 6, actor: 0 });
    }
    const avgMs = (performance.now() - t0) / N;
    expect(avgMs).toBeLessThan(50);
  });

  it('detects all 4 fault-injection mutants (mutants.mjs)', () => {
    const mutants: Array<keyof MutantFlags> = [
      'noCoreGuard',
      'noFluidCaps',
      'noQueueCap',
      'noSanitize'
    ];
    for (const m of mutants) {
      let caught = false;
      for (let s = 1; s <= 4 && !caught; s++) {
        const res = runFuzz(s, 500, { [m]: true });
        if (res.fails.length > 0) caught = true;
      }
      expect(caught).toBe(true);
    }
  });

  it('passes 24 seeds x 1000 random actions with determinism and clean rewind (WP-203 & WP-204)', () => {
    for (let s = 1; s <= 24; s++) {
      const a = runFuzz(s, 1000);
      expect(a.fails).toEqual([]);
      if (s <= 3) {
        const b = runFuzz(s, 1000);
        expect(a.mid).toBe(b.mid);
      }
    }
  }, 180000);

  it('supports snapshots, rewind, and visitor-specific edit rollback (WP-204)', () => {
    const w = mk();
    w.place(0, 10, 20, 10, B.STONE);
    const snap = w.createSnapshot();
    w.place(1, 12, 20, 10, B.PLANK);
    w.place(1, 13, 20, 10, B.PLANK);
    expect(w.delta.size).toBe(3);

    const reverted = w.rollbackByActor(1);
    expect(reverted).toBe(2);
    expect(w.hashState()).toBe(snap.hash);

    w.place(0, 14, 20, 10, B.BRICK);
    expect(w.hashState()).not.toBe(snap.hash);
    w.restoreSnapshot(snap);
    expect(w.hashState()).toBe(snap.hash);
  });

  // ---- Visitor permission rules (docs/03 D11, docs/17, WP-506) ----
  const SHOP = { x: 60, y: 1, z: 54, dx: 0, dz: -1 } as const;
  /** 0 = owner, 1 = permitted builder, 2 = visitor (default world: visitors cannot edit). */
  function mkPerm(mut: MutantFlags = {}, visitorBuild = false): World {
    const w = new World(7, mut, { visitorBuild, shops: [SHOP] });
    w.players.push({ id: 0, x: 20.5, y: 30, z: 20.5, vx: 0, vy: 0, vz: 0, owner: true });
    w.players.push({ id: 1, x: 30.5, y: 30, z: 20.5, vx: 0, vy: 0, vz: 0, permitted: true });
    w.players.push({ id: 2, x: 40.5, y: 30, z: 20.5, vx: 0, vy: 0, vz: 0 });
    return w;
  }

  /** Each rule as a scenario returning true when the rule holds. */
  const RULES: Record<string, (w: World) => boolean> = {
    R1_visitor_refused_in_wild_city_plot: (w) => {
      const before = w.hashState();
      const r = [
        w.place(2, 10, 1, 10, B.STONE), // WILD
        w.dig(2, 10, 0, 10), // WILD terrain
        w.place(2, 56, 1, 58, B.PLANK), // CITY
        w.place(2, 116, 1, 170, B.PLANK) // PLOT
      ];
      steps(w, 3);
      return r.every((x) => x === false) && w.delta.size === 0 && w.temp.size === 0 && before === w.hashState();
    },
    R1b_unknown_actor_is_visitor: (w) => w.place(99, 10, 1, 10, B.STONE) === false,
    R2_nobody_places_vault_in_city: (w) =>
      w.place(0, 56, 1, 58, B.VAULT) === false &&
      w.setBlock(1, 57, 1, 58, B.VAULT) === false &&
      w.get(56, 1, 58) === B.AIR,
    R3_shop_front_protected: (w) => {
      const cells: Array<[number, number, number]> = [];
      for (let i = 1; i <= CFG.SHOP_FRONT_CELLS; i++) {
        for (let h = 0; h < CFG.SHOP_DOOR_HEIGHT; h++) cells.push([SHOP.x, SHOP.y + h, SHOP.z - i]);
      }
      const ok = cells.every(([x, y, z]) => w.zone(x, y, z) === Z.CORE);
      return ok && cells.every(([x, y, z]) => !w.place(0, x, y, z, B.PLANK) && !w.place(1, x, y, z, B.PLANK));
    },
    R4_visitor_explosion_cannot_edit: (w) => {
      // Even with visitorBuild off, visitor blasts/rockets/water change nothing.
      w.explode(2, 10.5, 1.5, 10.5, 6);
      w.explode(2, 59.5, 3.5, 54.5, 6);
      w.rocket(2, 59.5, 6, 40, 0, -0.2, 1, 1.5);
      w.waterBomb(2, 10, 3, 10);
      steps(w, 40);
      return w.delta.size === 0 && w.temp.size === 0 && w.fluid.size === 0 && w.get(59, 3, 54) === B.BRICK;
    }
  };

  for (const [name, fn] of Object.entries(RULES)) {
    it(`${name}: holds in the default world`, () => {
      expect(fn(mkPerm())).toBe(true);
    });
  }

  it('permitted builders and owner keep today behaviour (WILD, CITY temp, PLOT)', () => {
    const w = mkPerm();
    expect(w.place(0, 10, 1, 10, B.STONE)).toBe(true);
    expect(w.place(1, 11, 1, 10, B.STONE)).toBe(true);
    expect(w.place(1, 56, 1, 58, B.PLANK)).toBe(true);
    expect(w.temp.size).toBe(1); // CITY edits still heal
    expect(w.place(1, 116, 1, 170, B.PLANK)).toBe(true);
    expect(w.place(0, 117, 1, 170, B.VAULT)).toBe(true); // VAULT is fine in PLOT
    expect(w.place(0, 12, 1, 10, B.VAULT)).toBe(true); // and in WILD
  });

  it('visitorBuild=true lets visitors edit WILD and CITY but never PLOT, CITY vault or shop front', () => {
    const w = mkPerm({}, true);
    expect(w.place(2, 10, 1, 10, B.STONE)).toBe(true);
    expect(w.place(2, 56, 1, 58, B.PLANK)).toBe(true);
    expect(w.place(2, 116, 1, 170, B.PLANK)).toBe(false);
    expect(w.place(2, 57, 1, 58, B.VAULT)).toBe(false);
    expect(w.place(2, SHOP.x, SHOP.y, SHOP.z - 1, B.PLANK)).toBe(false);
  });

  it('visitor chain explosion (dynamite) inside a permitted builder structure stays refused', () => {
    const w = mkPerm();
    for (let i = 0; i < 6; i++) w.place(1, 10 + i, 1, 10, B.DYNAMITE);
    w.explode(2, 12.5, 1.5, 10.5, 4);
    steps(w, 20);
    expect(w.get(12, 1, 10)).toBe(B.DYNAMITE);
    expect(w.delta.size).toBe(6);
  });

  it('fault injection: turning each new check off makes its scenario fail', () => {
    const cases: Array<[keyof MutantFlags, string[]]> = [
      ['noEditPerm', ['R1_visitor_refused_in_wild_city_plot', 'R1b_unknown_actor_is_visitor', 'R4_visitor_explosion_cannot_edit']],
      ['noCityVault', ['R2_nobody_places_vault_in_city']],
      ['noShopGuard', ['R3_shop_front_protected']]
    ];
    for (const [flag, rules] of cases) {
      for (const rule of rules) {
        expect(RULES[rule]!(mkPerm()), `${rule} sane`).toBe(true);
        expect(RULES[rule]!(mkPerm({ [flag]: true })), `${flag} -> ${rule}`).toBe(false);
      }
    }
  });

  it('fault injection: the fuzz invariants (I9) also catch each new mutant', () => {
    for (const m of ['noEditPerm', 'noCityVault', 'noShopGuard'] as const) {
      let caught = false;
      for (let s = 1; s <= 6 && !caught; s++) {
        if (runFuzz(s, 500, { [m]: true }).fails.length > 0) caught = true;
      }
      expect(caught, m).toBe(true);
    }
  }, 180000);
});
