export const B = {
  AIR: 0,
  DIRT: 1,
  STONE: 2,
  PLANK: 3,
  GLASS: 4,
  ROAD: 5,
  BRICK: 6,
  VAULT: 7,
  WATER: 8,
  DYNAMITE: 9,
  BEDROCK: 10
} as const;

export const Z = {
  OOB: 0,
  CORE: 1,
  CITY: 2,
  PLOT: 3,
  WILD: 4
} as const;

export const PLOT = {
  x0: 100,
  x1: 132,
  z0: 156,
  z1: 188
} as const;

export const ANCHORS: ReadonlyArray<readonly [number, number, number]> = [
  [144, 1, 144],
  [48, 1, 48],
  [144, 1, 48],
  [240, 1, 48],
  [48, 1, 240],
  [240, 1, 240]
];

export const DEFAULT_CFG = {
  SX: 288,
  SZ: 288,
  YMIN: -4,
  YMAX: 64,
  SPAWN: [144, 1, 144] as readonly [number, number, number],
  MAX_POWER: 6,
  MAX_SPEED: 2.0,
  MAX_FLUID: 4096,
  MAX_PROJECTILES: 32,
  MAX_PENDING_EXPLOSIONS: 64,
  MAX_BLOCK_OPS_PER_TICK: 128,
  MAX_BLOCKS_PER_EXPLOSION: 256,
  MAX_DELTA: 2048,
  MAX_TEMP: 8192,
  ACTOR_EXPLOSIONS_PER_SEC: 4,
  HEAL_TICKS: 100,
  FLUID_TTL_TICKS: 160
};

export const CFG = { ...DEFAULT_CFG };

export function resetCfg(): void {
  Object.assign(CFG, DEFAULT_CFG);
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface MutantFlags {
  noCoreGuard?: boolean;
  noFluidCaps?: boolean;
  noQueueCap?: boolean;
  noSanitize?: boolean;
}

export interface DestructionPlayer {
  id: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  owner?: boolean;
}

export interface PendingExplosion {
  actor: number;
  x: number;
  y: number;
  z: number;
  power: number;
}

export interface Projectile {
  actor: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  ttl: number;
}

export interface PendingBlockOp {
  x: number;
  y: number;
  z: number;
  actor: number;
}

export interface TempEntry {
  blockId: number;
  restoreAtTick: number;
  actor: number;
}

export interface JournalEntry {
  actor: number;
  key: number;
  prevDelta: number | undefined;
}

export interface WorldSnapshot {
  delta: Array<[number, number]>;
  hash: number;
}

const isRoadStrip = (v: number): boolean =>
  (v >= 46 && v < 50) || (v >= 142 && v < 146) || (v >= 238 && v < 242);

export class World {
  readonly seed: number;
  readonly mut: MutantFlags;
  tick = 0;
  players: DestructionPlayer[] = [];
  readonly delta = new Map<number, number>();
  readonly temp = new Map<number, TempEntry>();
  readonly fluid = new Map<number, number>();
  readonly proj: Projectile[] = [];
  readonly pending: PendingExplosion[] = [];
  readonly ops: PendingBlockOp[] = [];
  readonly journal: JournalEntry[] = [];
  private readonly actorExpWindow = new Map<number, number[]>();

  readonly stats = {
    explosions: 0,
    maxExpBlocks: 0,
    maxOpsTick: 0,
    maxFluid: 0,
    maxProj: 0,
    maxPower: 0
  };

  constructor(seed = 1, mut: MutantFlags = {}) {
    this.seed = seed;
    this.mut = mut;
  }

  private inBounds(x: number, y: number, z: number): boolean {
    return (
      Number.isInteger(x) &&
      Number.isInteger(y) &&
      Number.isInteger(z) &&
      x >= 0 &&
      x < CFG.SX &&
      z >= 0 &&
      z < CFG.SZ &&
      y >= CFG.YMIN &&
      y < CFG.YMAX
    );
  }

  key(x: number, y: number, z: number): number {
    // 0..287 x, 0..287 z, -4..63 y -> y+16 (12..79) fits well under 2^31
    return (x * CFG.SZ + z) * 128 + (y + 16);
  }

  unkey(k: number): [number, number, number] {
    const y = (k % 128) - 16;
    const xz = Math.floor(k / 128);
    const z = xz % CFG.SZ;
    const x = Math.floor(xz / CFG.SZ);
    return [x, y, z];
  }

  zone(x: number, y: number, z: number): number {
    if (!this.inBounds(x, y, z)) return Z.OOB;
    if (y === CFG.YMIN) return Z.CORE;
    if ((isRoadStrip(x) || isRoadStrip(z)) && y >= -2 && y < 5) return Z.CORE;
    if (x >= 128 && x < 160 && z >= 128 && z < 160 && y >= -4 && y < 24) return Z.CORE;
    if (x >= PLOT.x0 && x < PLOT.x1 && z >= PLOT.z0 && z < PLOT.z1 && y > CFG.YMIN) {
      return Z.PLOT;
    }
    if (x >= 52 && x < 68 && z >= 52 && z < 68 && y >= -2 && y < 14) {
      return Z.CITY;
    }
    return Z.WILD;
  }

  base(x: number, y: number, z: number): number {
    if (!this.inBounds(x, y, z)) return B.BEDROCK;
    if (y === CFG.YMIN) return B.BEDROCK;
    if (y <= 0) {
      if (isRoadStrip(x) || isRoadStrip(z)) return B.ROAD;
      return y === 0 ? B.DIRT : B.STONE;
    }
    // City structure walls near (54..65, 54..65) for T06 healing test
    if (x >= 54 && x <= 65 && z === 54 && y >= 1 && y <= 5) {
      return B.BRICK;
    }
    return B.AIR;
  }

  get(x: number, y: number, z: number): number {
    if (!this.inBounds(x, y, z)) return B.BEDROCK;
    const k = this.key(x, y, z);
    const t = this.temp.get(k);
    if (t !== undefined) return t.blockId;
    const d = this.delta.get(k);
    if (d !== undefined) return d;
    return this.base(x, y, z);
  }

  private writeDeltaOrTemp(x: number, y: number, z: number, blockId: number, actor: number, forceTemp = false): boolean {
    if (!this.inBounds(x, y, z)) return false;
    const zKind = this.zone(x, y, z);
    if (zKind === Z.OOB) return false;
    if (zKind === Z.CORE && !this.mut.noCoreGuard) return false;
    if (zKind === Z.CITY && forceTemp === false) {
      // Direct permanent edits inside CITY become temp heals or rejected for visitors
      forceTemp = true;
    }
    if (zKind === Z.PLOT) {
      const p = this.players.find((pl) => pl.id === actor);
      if (!p?.owner && !this.mut.noCoreGuard) return false;
    }
    const cur = this.get(x, y, z);
    if (cur === B.BEDROCK) return false;
    if (cur === B.VAULT && blockId === B.AIR && zKind !== Z.PLOT) return false;

    const k = this.key(x, y, z);
    const baseVal = this.base(x, y, z);

    if (forceTemp || (!this.delta.has(k) && this.delta.size >= CFG.MAX_DELTA)) {
      if (!this.temp.has(k) && this.temp.size >= CFG.MAX_TEMP) return false;
      this.temp.set(k, {
        blockId,
        restoreAtTick: this.tick + CFG.HEAL_TICKS,
        actor
      });
      return true;
    }

    const prevDelta = this.delta.get(k);
    this.journal.push({ actor, key: k, prevDelta });
    if (blockId === baseVal) {
      this.delta.delete(k);
    } else {
      this.delta.set(k, blockId);
    }
    return true;
  }

  setBlock(actor: number, x: number, y: number, z: number, blockId: number): boolean {
    if (!this.mut.noSanitize) {
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || !Number.isFinite(blockId)) {
        return false;
      }
      x = Math.trunc(x);
      y = Math.trunc(y);
      z = Math.trunc(z);
      blockId = Math.trunc(blockId);
      if (blockId < 0 || blockId > B.BEDROCK) return false;
    }
    return this.writeDeltaOrTemp(x, y, z, blockId, actor, false);
  }

  place(actor: number, x: number, y: number, z: number, blockId: number): boolean {
    if (!this.mut.noSanitize) {
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || !Number.isFinite(blockId)) {
        return false;
      }
      x = Math.floor(x);
      y = Math.floor(y);
      z = Math.floor(z);
      blockId = Math.trunc(blockId);
      if (blockId < 0 || blockId > B.BEDROCK) return false;
    }
    return this.writeDeltaOrTemp(x, y, z, blockId, actor, false);
  }

  dig(actor: number, x: number, y: number, z: number): boolean {
    if (!this.mut.noSanitize) {
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return false;
      x = Math.floor(x);
      y = Math.floor(y);
      z = Math.floor(z);
    }
    const zKind = this.zone(x, y, z);
    const forceTemp = zKind === Z.CITY;
    return this.writeDeltaOrTemp(x, y, z, B.AIR, actor, forceTemp);
  }

  explode(actor: number, x: number, y: number, z: number, power: number): boolean {
    if (!this.mut.noSanitize) {
      if (![x, y, z, power].every(Number.isFinite)) return false;
      if (x < 0 || x >= CFG.SX || z < 0 || z >= CFG.SZ || y < CFG.YMIN || y >= CFG.YMAX) {
        return false;
      }
      if (power <= 0) return false;
    }
    const clampedPower = this.mut.noSanitize
      ? Number.isFinite(power)
        ? Math.max(1, power)
        : 999
      : Math.min(CFG.MAX_POWER, power);
    this.stats.maxPower = Math.max(this.stats.maxPower, clampedPower);

    // Per-actor 1-sec explosion rate limit (20 ticks)
    if (!this.mut.noQueueCap) {
      const times = (this.actorExpWindow.get(actor) ?? []).filter((t) => this.tick - t < 20);
      if (times.length >= CFG.ACTOR_EXPLOSIONS_PER_SEC) {
        this.actorExpWindow.set(actor, times);
        return false;
      }
      times.push(this.tick);
      this.actorExpWindow.set(actor, times);
    }

    if (!this.mut.noQueueCap && this.pending.length >= CFG.MAX_PENDING_EXPLOSIONS) {
      return false;
    }
    this.pending.push({
      actor,
      x: Number.isFinite(x) ? x : 10,
      y: Number.isFinite(y) ? y : 10,
      z: Number.isFinite(z) ? z : 10,
      power: Math.min(8, clampedPower)
    });
    return true;
  }

  runExplosion(params: { x: number; y: number; z: number; power: number; actor: number }): number {
    this.stats.explosions += 1;
    const p = this.mut.noSanitize
      ? Math.min(8, Math.max(0.5, Number.isFinite(params.power) ? params.power : 6))
      : this.mut.noQueueCap
        ? 8
        : Math.min(CFG.MAX_POWER, Math.max(0.5, params.power));
    const r = Math.ceil(p);
    const cx = Math.floor(params.x);
    const cy = Math.floor(params.y);
    const cz = Math.floor(params.z);

    let gathered = 0;
    const maxExp = CFG.MAX_BLOCKS_PER_EXPLOSION;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (dx * dx + dy * dy + dz * dz > p * p) continue;
          const bx = cx + dx;
          const by = cy + dy;
          const bz = cz + dz;
          if (!this.inBounds(bx, by, bz)) continue;
          const zKind = this.zone(bx, by, bz);
          if (zKind === Z.CORE && !this.mut.noCoreGuard) continue;
          if (zKind === Z.PLOT) {
            const pl = this.players.find((pl0) => pl0.id === params.actor);
            if (!pl?.owner && !this.mut.noCoreGuard) continue;
          }
          const blockId = this.get(bx, by, bz);
          if (blockId === B.AIR || blockId === B.BEDROCK || blockId === B.VAULT) continue;
          if (!this.mut.noQueueCap && gathered >= maxExp) break;
          gathered += 1;
          this.ops.push({ x: bx, y: by, z: bz, actor: params.actor });
        }
        if (!this.mut.noQueueCap && gathered >= maxExp) break;
      }
      if (!this.mut.noQueueCap && gathered >= maxExp) break;
    }
    this.stats.maxExpBlocks = Math.max(this.stats.maxExpBlocks, gathered);
    return gathered;
  }

  rocket(
    actor: number,
    x: number,
    y: number,
    z: number,
    dx: number,
    dy: number,
    dz: number,
    speed: number
  ): boolean {
    if (!this.mut.noSanitize) {
      if (![x, y, z, dx, dy, dz, speed].every(Number.isFinite)) return false;
      if (x < 0 || x >= CFG.SX || z < 0 || z >= CFG.SZ || y < CFG.YMIN || y >= CFG.YMAX) {
        return false;
      }
      if (speed <= 0) return false;
    }
    const len = Math.hypot(dx, dy, dz);
    if (!Number.isFinite(len) || len < 1e-6) return false;
    const clampedSpeed = Math.min(CFG.MAX_SPEED, speed);
    if (!this.mut.noQueueCap && this.proj.length >= CFG.MAX_PROJECTILES) {
      return false;
    }
    this.proj.push({
      actor,
      x,
      y,
      z,
      vx: (dx / len) * clampedSpeed,
      vy: (dy / len) * clampedSpeed,
      vz: (dz / len) * clampedSpeed,
      ttl: 120
    });
    this.stats.maxProj = Math.max(this.stats.maxProj, this.proj.length);
    return true;
  }

  waterBomb(actor: number, x: number, y: number, z: number): boolean {
    if (!this.mut.noSanitize) {
      if (![x, y, z].every(Number.isFinite)) return false;
      if (x < 0 || x >= CFG.SX || z < 0 || z >= CFG.SZ || y < CFG.YMIN || y >= CFG.YMAX) {
        return false;
      }
    }
    const bx = Math.floor(x);
    const by = Math.floor(y);
    const bz = Math.floor(z);
    const rx = this.mut.noFluidCaps ? 8 : 2;
    const ry = this.mut.noFluidCaps ? 5 : 1;
    for (let dx = -rx; dx <= rx; dx++) {
      for (let dz = -rx; dz <= rx; dz++) {
        for (let dy = -ry; dy <= ry; dy++) {
          const tx = bx + dx;
          const ty = by + dy;
          const tz = bz + dz;
          if (!this.inBounds(tx, ty, tz)) continue;
          if (this.zone(tx, ty, tz) === Z.CORE && !this.mut.noCoreGuard) continue;
          if (this.get(tx, ty, tz) !== B.AIR) continue;
          if (!this.mut.noFluidCaps && this.fluid.size >= CFG.MAX_FLUID) {
            this.stats.maxFluid = Math.max(this.stats.maxFluid, this.fluid.size);
            return false;
          }
          const fk = this.key(tx, ty, tz);
          this.fluid.set(
            fk,
            this.mut.noFluidCaps ? Number.MAX_SAFE_INTEGER : this.tick + CFG.FLUID_TTL_TICKS
          );
          this.stats.maxFluid = Math.max(this.stats.maxFluid, this.fluid.size);
        }
      }
    }
    void actor;
    return true;
  }

  impulse(playerId: number, vx: number, vy: number, vz: number): boolean {
    const p = this.players.find((pl) => pl.id === playerId);
    if (!p) return false;
    if (!this.mut.noSanitize) {
      if (![vx, vy, vz].every(Number.isFinite)) return false;
      const mag = Math.hypot(vx, vy, vz);
      if (mag > CFG.MAX_SPEED) {
        const s = CFG.MAX_SPEED / mag;
        vx *= s;
        vy *= s;
        vz *= s;
      }
    }
    p.vx = vx;
    p.vy = vy;
    p.vz = vz;
    return true;
  }

  solidAtPlayer(p: DestructionPlayer): boolean {
    const bx = Math.floor(p.x);
    const by = Math.floor(p.y);
    const bz = Math.floor(p.z);
    return this.get(bx, by, bz) !== B.AIR || this.get(bx, by + 1, bz) !== B.AIR;
  }

  rescue(p: DestructionPlayer): void {
    const bx = Math.floor(p.x);
    const bz = Math.floor(p.z);
    for (let y = Math.max(1, Math.floor(p.y)); y < CFG.YMAX - 2; y++) {
      if (this.get(bx, y, bz) === B.AIR && this.get(bx, y + 1, bz) === B.AIR) {
        p.y = y;
        if (!this.mut.noSanitize) p.vx = p.vy = p.vz = 0;
        return;
      }
    }
    p.x = CFG.SPAWN[0] + 0.5;
    p.y = CFG.SPAWN[1];
    p.z = CFG.SPAWN[2] + 0.5;
    if (!this.mut.noSanitize) p.vx = p.vy = p.vz = 0;
  }

  step(): void {
    this.tick += 1;

    // 1. Heal temp blocks and keep players pushed above solidifying blocks
    for (const [k, entry] of this.temp) {
      if (entry.restoreAtTick <= this.tick) {
        this.temp.delete(k);
      }
    }
    for (const p of this.players) {
      if (this.solidAtPlayer(p)) {
        this.rescue(p);
      }
    }

    // 2. Evaporate expired fluids
    for (const [fk, expireTick] of this.fluid) {
      if (expireTick <= this.tick) {
        this.fluid.delete(fk);
      }
    }

    // 3. Advance projectiles with 0.25-block substep swept collision (prevents tunneling T11)
    for (let i = this.proj.length - 1; i >= 0; i--) {
      const pr = this.proj[i]!;
      pr.ttl -= 1;
      const substeps = 8;
      let hit = false;
      for (let s = 0; s < substeps; s++) {
        const nx = pr.x + pr.vx / substeps;
        const ny = pr.y + pr.vy / substeps;
        const nz = pr.z + pr.vz / substeps;
        if (
          nx < 0 ||
          nx >= CFG.SX ||
          nz < 0 ||
          nz >= CFG.SZ ||
          ny < CFG.YMIN ||
          ny >= CFG.YMAX
        ) {
          this.proj.splice(i, 1);
          hit = true;
          break;
        }
        if (this.get(Math.floor(nx), Math.floor(ny), Math.floor(nz)) !== B.AIR) {
          this.pending.push({ actor: pr.actor, x: pr.x, y: pr.y, z: pr.z, power: 3 });
          this.proj.splice(i, 1);
          hit = true;
          break;
        }
        pr.x = nx;
        pr.y = ny;
        pr.z = nz;
      }
      if (!hit && pr.ttl <= 0) {
        this.proj.splice(i, 1);
      }
    }

    // 4. Process up to 4 pending explosions per tick into ops queue
    let processedExps = 0;
    while (this.pending.length > 0 && processedExps < 4) {
      const exp = this.pending.shift()!;
      this.runExplosion(exp);
      processedExps += 1;
    }

    // 5. Execute up to MAX_BLOCK_OPS_PER_TICK queued block removals
    const opLimit = this.mut.noQueueCap ? this.ops.length : CFG.MAX_BLOCK_OPS_PER_TICK;
    let opsDone = 0;
    while (this.ops.length > 0 && opsDone < opLimit) {
      const op = this.ops.shift()!;
      const cur = this.get(op.x, op.y, op.z);
      if (cur === B.DYNAMITE) {
        if (this.mut.noQueueCap || this.pending.length < CFG.MAX_PENDING_EXPLOSIONS) {
          this.pending.push({ actor: op.actor, x: op.x + 0.5, y: op.y + 0.5, z: op.z + 0.5, power: 4 });
        }
      }
      const zKind = this.zone(op.x, op.y, op.z);
      this.writeDeltaOrTemp(op.x, op.y, op.z, B.AIR, op.actor, zKind === Z.CITY);
      opsDone += 1;
    }
    this.stats.maxOpsTick = Math.max(this.stats.maxOpsTick, opsDone);
  }

  rollbackAll(): void {
    this.delta.clear();
    this.temp.clear();
    this.fluid.clear();
    this.ops.length = 0;
    this.pending.length = 0;
    this.proj.length = 0;
    this.journal.length = 0;
  }

  rollbackByActor(actor: number): number {
    let reverted = 0;
    for (let i = this.journal.length - 1; i >= 0; i--) {
      const j = this.journal[i]!;
      if (j.actor !== actor) continue;
      if (j.prevDelta === undefined) {
        this.delta.delete(j.key);
      } else {
        this.delta.set(j.key, j.prevDelta);
      }
      this.journal.splice(i, 1);
      reverted += 1;
    }
    return reverted;
  }

  createSnapshot(): WorldSnapshot {
    return {
      delta: [...this.delta.entries()].sort((a, b) => a[0] - b[0]),
      hash: this.hashState()
    };
  }

  restoreSnapshot(snap: WorldSnapshot): void {
    this.delta.clear();
    for (const [k, v] of snap.delta) {
      this.delta.set(k, v);
    }
    this.temp.clear();
  }

  hashState(): number {
    let h = 2166136261 >>> 0;
    const sorted = [...this.delta.entries()].sort((a, b) => a[0] - b[0]);
    for (const [k, v] of sorted) {
      h ^= k;
      h = Math.imul(h, 16777619) >>> 0;
      h ^= v;
      h = Math.imul(h, 16777619) >>> 0;
    }
    for (const p of this.players) {
      h ^= Math.round(p.x * 100);
      h = Math.imul(h, 16777619) >>> 0;
      h ^= Math.round(p.y * 100);
      h = Math.imul(h, 16777619) >>> 0;
      h ^= Math.round(p.z * 100);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }
}
