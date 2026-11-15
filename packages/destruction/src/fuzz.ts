import {
  ANCHORS,
  B,
  CFG,
  mulberry32,
  World,
  Z,
  type MutantFlags
} from './kernel.js';

const CORE_STRIP_COORDS: number[] = [];
for (let c = 0; c < CFG.SX; c++) {
  if ((c >= 46 && c < 50) || (c >= 142 && c < 146) || (c >= 238 && c < 242)) {
    CORE_STRIP_COORDS.push(c);
  }
}

export function coreHash(w: World): number {
  let h = 2166136261 >>> 0;
  const mix = (v: number): void => {
    h ^= v;
    h = Math.imul(h, 16777619) >>> 0;
  };
  for (const x of CORE_STRIP_COORDS) {
    for (let z = 0; z < CFG.SZ; z++) {
      for (let y = -2; y < 5; y++) mix(w.get(x, y, z) + 1);
    }
  }
  for (const z of CORE_STRIP_COORDS) {
    for (let x = 0; x < CFG.SX; x++) {
      for (let y = -2; y < 5; y++) mix(w.get(x, y, z) + 1);
    }
  }
  for (let x = 128; x < 160; x++) {
    for (let z = 128; z < 160; z++) {
      for (let y = -2; y < 24; y++) mix(w.get(x, y, z) + 1);
    }
  }
  return h;
}

export function cityHash(w: World): number {
  let h = 2166136261 >>> 0;
  for (let x = 52; x < 68; x++) {
    for (let z = 52; z < 68; z++) {
      for (let y = -2; y < 14; y++) {
        h ^= w.get(x, y, z) + 1;
        h = Math.imul(h, 16777619) >>> 0;
      }
    }
  }
  return h;
}

const roadCol = (v: number): boolean =>
  (v >= 46 && v < 50) || (v >= 142 && v < 146) || (v >= 238 && v < 242);

export function roadsConnected(w: World): boolean {
  const ok = (x: number, z: number): boolean =>
    x >= 0 &&
    x < CFG.SX &&
    z >= 0 &&
    z < CFG.SZ &&
    (roadCol(x) || roadCol(z)) &&
    w.get(x, 0, z) !== B.AIR &&
    w.get(x, 1, z) === B.AIR &&
    w.get(x, 2, z) === B.AIR;
  const seen = new Uint8Array(CFG.SX * CFG.SZ);
  const startX = CFG.SPAWN[0];
  const startZ = CFG.SPAWN[2];
  if (!ok(startX, startZ)) return false;
  const q: Array<[number, number]> = [[startX, startZ]];
  seen[startX * CFG.SZ + startZ] = 1;
  while (q.length) {
    const [x, z] = q.pop()!;
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1]
    ] as const) {
      const nx = x + dx;
      const nz = z + dz;
      if (ok(nx, nz) && !seen[nx * CFG.SZ + nz]) {
        seen[nx * CFG.SZ + nz] = 1;
        q.push([nx, nz]);
      }
    }
  }
  return ANCHORS.every(([ax, , az]) => seen[ax * CFG.SZ + az] === 1);
}

export function check(w: World, ref: { deep: boolean; core?: number | null }): string[] {
  const v: string[] = [];
  const [sx, sy, sz] = CFG.SPAWN;
  if (w.get(sx, sy - 1, sz) === B.AIR || w.get(sx, sy, sz) !== B.AIR || w.get(sx, sy + 1, sz) !== B.AIR) {
    v.push('I1 spawn');
  }
  if (ref.deep && !roadsConnected(w)) v.push('I2 roads');
  if (ref.deep && ref.core !== null && ref.core !== undefined && coreHash(w) !== ref.core) {
    v.push('I8 core changed');
  }
  for (const k of w.delta.keys()) {
    if (w.zone(...w.unkey(k)) === Z.CORE) {
      v.push('I8 delta in core');
      break;
    }
  }
  for (const k of w.temp.keys()) {
    if (w.zone(...w.unkey(k)) === Z.CORE) {
      v.push('I8 temp in core');
      break;
    }
  }
  if (w.fluid.size > CFG.MAX_FLUID) v.push('fluid cap');
  if (w.proj.length > CFG.MAX_PROJECTILES) v.push('projectile cap');
  if (w.pending.length > CFG.MAX_PENDING_EXPLOSIONS) v.push('pending cap');
  if (w.temp.size > CFG.MAX_TEMP) v.push('temp cap');
  if (w.delta.size > CFG.MAX_DELTA) v.push('delta cap');
  if (w.stats.maxOpsTick > CFG.MAX_BLOCK_OPS_PER_TICK) v.push('ops budget');
  if (w.stats.maxExpBlocks > CFG.MAX_BLOCKS_PER_EXPLOSION) v.push('explosion size');
  if (w.stats.maxPower > CFG.MAX_POWER) v.push('power over cap');
  for (const p of w.players) {
    if (![p.x, p.y, p.z, p.vx, p.vy, p.vz].every(Number.isFinite)) v.push('player NaN');
    else if (
      p.x < 0 ||
      p.x >= CFG.SX ||
      p.z < 0 ||
      p.z >= CFG.SZ ||
      p.y < CFG.YMIN ||
      p.y >= CFG.YMAX
    ) {
      v.push('player OOB');
    } else if (w.solidAtPlayer(p)) {
      v.push('player in block');
    }
    if (Math.hypot(p.vx, p.vy, p.vz) > CFG.MAX_SPEED + 1e-9) v.push('player speed');
  }
  return v;
}

const HOT: Array<[number, number, number]> = [
  [144, 2, 144],
  [144, 1, 100],
  [48, 1, 48],
  [60, 4, 60],
  [106, 4, 106],
  [116, 2, 170],
  [150, 3, 150],
  [240, 1, 144],
  [47, 1, 200],
  [20, 8, 20]
];
const BAD = [NaN, Infinity, -Infinity, 1e12, -1e12, -1, 1e9, 0.5, -0.0];

export interface FuzzResult {
  fails: Array<{ i: number | string; tick: number; v: string[] }>;
  stats: World['stats'];
  mid: number;
  ticks: number;
  journal: number;
}

export function runFuzz(seed: number, actions: number, mut: MutantFlags = {}): FuzzResult {
  const w = new World(seed, mut);
  const r = mulberry32(seed * 7919 + 13);
  w.players.push({ id: 0, x: 144.5, y: 1, z: 144.5, vx: 0, vy: 0, vz: 0, owner: true });
  w.players.push({ id: 1, x: 60.5, y: 12, z: 100.5, vx: 0, vy: 0, vz: 0 });
  w.players.push({ id: 2, x: 116.5, y: 1, z: 170.5, vx: 0, vy: 0, vz: 0 });
  for (let id = 3; id < 8; id++) {
    w.players.push({ id, x: 20.5 + id * 30, y: 20, z: 20.5, vx: 0, vy: 0, vz: 0 });
  }
  const ref = { core: coreHash(w), city: cityHash(w), deep: true };
  const fails: Array<{ i: number | string; tick: number; v: string[] }> = [];
  const ri = (n: number): number => Math.floor(r() * n);
  const pos = (): [number, number, number] => {
    if (r() < 0.6) {
      const h = HOT[ri(HOT.length)]!;
      return [h[0] + ri(17) - 8 + r(), h[1] + ri(9) - 3 + r(), h[2] + ri(17) - 8 + r()];
    }
    return [r() * CFG.SX, CFG.YMIN + r() * (CFG.YMAX - CFG.YMIN), r() * CFG.SZ];
  };
  const bad = (): number => BAD[ri(BAD.length)]!;

  for (let i = 0; i < actions; i++) {
    const a = ri(3);
    const t = r();
    const [x, y, z] = pos();
    if (t < 0.22) {
      w.explode(a, x, y, z, 1 + r() * 7);
    } else if (t < 0.3) {
      w.explode(
        a,
        r() < 0.5 ? bad() : x,
        r() < 0.5 ? bad() : y,
        r() < 0.5 ? bad() : z,
        r() < 0.7 ? bad() : 4
      );
    } else if (t < 0.38) {
      const bx = Math.floor(x);
      const by = Math.floor(y);
      const bz = Math.floor(z);
      const n = 2 + ri(5);
      for (let dx = 0; dx < n; dx++) {
        for (let dy = 0; dy < n; dy++) {
          for (let dz = 0; dz < n; dz++) {
            w.place(a, bx + dx, by + dy, bz + dz, B.DYNAMITE);
          }
        }
      }
      w.explode(a, bx + 0.5, by + 0.5, bz + 0.5, 4);
    } else if (t < 0.5) {
      const bx = Math.floor(x);
      const bz = Math.floor(z);
      for (let k = 0; k < 12; k++) {
        w.place(
          a,
          bx + (k % 4),
          1 + Math.floor(k / 4),
          bz,
          [B.STONE, B.PLANK, B.VAULT, B.BRICK][ri(4)]!
        );
      }
    } else if (t < 0.56) {
      w.setBlock(
        a,
        r() < 0.5 ? bad() : Math.floor(x),
        Math.floor(y),
        r() < 0.5 ? bad() : Math.floor(z),
        r() < 0.5 ? bad() : ri(11)
      );
    } else if (t < 0.66) {
      w.waterBomb(a, r() < 0.15 ? bad() : x, r() < 0.5 ? y + 20 : y, z);
    } else if (t < 0.8) {
      const tx = HOT[ri(HOT.length)]!;
      const d =
        r() < 0.15
          ? [bad(), bad(), bad()]
          : r() < 0.5
            ? [tx[0] - x, tx[1] - y, tx[2] - z]
            : [r() - 0.5, r() - 0.5, r() - 0.5];
      w.rocket(a, x, Math.max(y, 6), z, d[0]!, d[1]!, d[2]!, r() < 0.2 ? bad() : 0.3 + r() * 4);
    } else if (t < 0.86) {
      w.impulse(
        ri(8),
        r() < 0.3 ? bad() : (r() - 0.5) * 50,
        (r() - 0.5) * 50,
        r() < 0.3 ? bad() : (r() - 0.5) * 50
      );
    } else if (t < 0.91) {
      for (let k = 0; k < 20; k++) {
        w.dig(a, Math.floor(x) + ri(3), Math.floor(y) - ri(4), Math.floor(z) + ri(3));
      }
    } else if (t < 0.96) {
      for (let k = 0; k < 12; k++) {
        const q = pos();
        if (r() < 0.5) w.explode(a, q[0], q[1], q[2], 5);
        else w.rocket(ri(8), q[0], Math.max(q[1], 6), q[2], r() - 0.5, -r(), r() - 0.5, 2);
      }
    } else if (t < 0.98) {
      const p = w.players[ri(8)]!;
      const h = HOT[ri(HOT.length)]!;
      p.x = h[0] + 0.5;
      p.y = h[1] + 6;
      p.z = h[2] + 0.5;
      if (w.solidAtPlayer(p)) w.rescue(p);
    }

    const n = 1 + ri(r() < 0.1 ? 60 : 6);
    for (let s = 0; s < n; s++) {
      w.step();
      ref.deep = false;
      const v = check(w, ref);
      if (v.length) {
        fails.push({ i, tick: w.tick, v });
        break;
      }
    }
    if (i % 100 === 99 || i === actions - 1) {
      ref.deep = true;
      const v = check(w, ref);
      if (v.length) fails.push({ i, tick: w.tick, v });
    }
    if (fails.length) break;
  }

  const mid = w.hashState();
  if (!fails.length) {
    for (let s = 0; s < CFG.HEAL_TICKS + 300; s++) w.step();
    ref.deep = true;
    const v = check(w, ref);
    if (w.temp.size) v.push(`temp not drained:${w.temp.size}`);
    if (w.fluid.size) v.push('fluid not drained');
    if (w.proj.length || w.pending.length || w.ops.length) v.push('queues not drained');
    if (cityHash(w) !== ref.city) v.push('city not healed');
    w.rollbackAll();
    if (w.delta.size) v.push(`rollback left delta:${w.delta.size}`);
    if (v.length) fails.push({ i: 'settle', tick: w.tick, v });
  }
  return { fails, stats: w.stats, mid, ticks: w.tick, journal: w.journal.length };
}
