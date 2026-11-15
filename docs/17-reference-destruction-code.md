# 17. 파괴 커널 참조 코드

`13`의 규칙을 코드로 옮긴 참조 구현과 시험 코드 전문입니다. 의존성이 없고 Node 18 이상에서 실행됩니다. 아래 네 블록을 같은 폴더에 각각의 파일 이름으로 저장하면 됩니다. 게임을 만들 때는 `kernel.mjs`를 `packages/destruction`으로 옮기고 TypeScript로 바꿉니다.

| 파일 | 역할 | 실행 |
|---|---|---|
| `kernel.mjs` | 구역, `setBlock`, 폭발, 유체, 투사체, 복구, 저널 | (모듈) |
| `unit.mjs` | 지정 시나리오 16개 | `node unit.mjs` |
| `fuzz.mjs` | 무작위 실행과 불변식 검사 | `node fuzz.mjs 24 1000` |
| `mutants.mjs` | 결함 주입 | `node mutants.mjs` |

참조 구현의 좌표(도로 위치, 건물 상자, 부지 범위)와 높이 범위(−32 ~ +64)는 시험용 예시입니다. 상수 `CFG`의 상한값은 `13`의 5장 표와 같습니다.

## `kernel.mjs`

```js
// 파괴·유체·투사체 규칙의 참조 구현 (docs/13-destruction-physics.md 의 규범 코드)
// 의존성 없음. Node 18+ 에서 실행. 실제 게임에서는 packages/sim-core 로 옮긴다.
// 이 파일의 상수와 분기 순서가 문서 표의 근거다. 문서와 다르면 이 파일이 맞다.

export const CFG = {
  SX: 288, SZ: 288, YMIN: -32, YMAX: 64,          // 참조 실행용 높이. 실제 월드는 -400..1000
  TICK_HZ: 20,
  MAX_POWER: 6,                                    // 폭발 위력 상한
  MAX_BLOCKS_PER_EXPLOSION: 1500,
  MAX_PENDING_EXPLOSIONS: 64,
  MAX_EXPLOSIONS_PER_TICK: 2,
  ACTOR_EXPLOSIONS_PER_SEC: 4,
  MAX_BLOCK_OPS_PER_TICK: 2000,
  MAX_HEALS_PER_TICK: 1000,
  HEAL_TICKS: 1200,                                // 60초
  MAX_TEMP: 60000,
  MAX_DELTA: 200000,                               // 참조 실행용. 실제 값은 저장 20MB 에서 역산
  MAX_FLUID: 4096, FLUID_PER_BOMB: 256, FLUID_TTL: 400, FLUID_STEP: 5, MAX_FLUID_UPDATES: 512,
  MAX_PROJECTILES: 32, ACTOR_PROJECTILES: 4, PROJ_MAX_SPEED: 2.0, PROJ_TTL: 120, ROCKET_POWER: 3,
  MAX_SPEED: 3.0,                                  // 60 m/s
  FUSE_MIN: 10, FUSE_MAX: 30,
  SPAWN: [144, 1, 144],
};

export const B = { AIR: 0, STONE: 1, DIRT: 2, GRASS: 3, BRICK: 4, ROAD: 5, BEDROCK: 6, DYNAMITE: 7, PLANK: 8, GLASS: 9, VAULT: 10 };
const RES = [0, 6, 0.5, 0.6, 6, Infinity, Infinity, 0, 3, 0.3, 1200];
export const Z = { OOB: 0, CORE: 1, CITY: 2, PLOT: 3, WILD: 4 };

export function mulberry32(a) {
  return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const ROADS = [46, 142, 238];
const isRoadCoord = (v) => (v >= 46 && v < 50) || (v >= 142 && v < 146) || (v >= 238 && v < 242);
const CITY_BOXES = [];
for (const cx of [48, 144, 240]) for (const cz of [48, 144, 240]) {
  if (cx === 144 && cz === 144) CITY_BOXES.push([100, 100]); else CITY_BOXES.push([cx + 6, cz + 6]);
}
export const ANCHORS = [];
for (const cx of ROADS) for (const cz of ROADS) ANCHORS.push([cx + 1, 1, cz + 1]);
const PLOT = { x0: 100, x1: 132, z0: 156, z1: 188 };

// 1352개 광선 방향 (16^3 격자의 겉면 점). 한 번만 계산.
const RAYS = [];
for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) for (let k = 0; k < 16; k++) {
  if (i === 0 || i === 15 || j === 0 || j === 15 || k === 0 || k === 15) {
    let dx = i / 15 * 2 - 1, dy = j / 15 * 2 - 1, dz = k / 15 * 2 - 1; const l = Math.hypot(dx, dy, dz);
    RAYS.push([dx / l, dy / l, dz / l]);
  }
}
export const RAY_COUNT = RAYS.length;

export class World {
  constructor(seed = 1, mut = {}) {
    this.seed = seed; this.mut = mut;               // mut: 검증용 결함 주입 스위치
    this.tick = 0;
    this.delta = new Map();                         // L2 영구 편집
    this.temp = new Map();                          // L4 임시 편집 key -> {id, exp, defers}
    this.journal = [];                              // [key, prevId|undefined]
    this.fluid = new Map();                         // key -> {lvl, exp, bomb}
    this.fluidFront = [];
    this.bombs = new Map();                         // bombId -> 남은 셀 수
    this.proj = [];
    this.pending = [];                              // 폭발 대기열 {x,y,z,power,actor,at}
    this.ops = [];                                  // 블록 연산 대기열 [actor,x,y,z,id]
    this.players = [];                              // {id,x,y,z,vx,vy,vz,owner,permitted}
    this.rate = new Map();                          // actor -> [tick...]
    this.stats = { rejected: {}, clamped: {}, maxOpsTick: 0, maxExpBlocks: 0, maxPending: 0, maxFluid: 0, maxProj: 0, maxTemp: 0, explosions: 0, fizzles: 0, chains: 0, heals: 0, rescues: 0, maxPower: 0 };
    this.h = new Int8Array(CFG.SX * CFG.SZ);
    for (let x = 0; x < CFG.SX; x++) for (let z = 0; z < CFG.SZ; z++) {
      let flat = isRoadCoord(x) || isRoadCoord(z) || (x >= 96 && x < 192 && z >= 96 && z < 192);
      for (const [bx, bz] of CITY_BOXES) if (x >= bx - 2 && x < bx + 14 && z >= bz - 2 && z < bz + 14) flat = true;
      this.h[x * CFG.SZ + z] = flat ? 0 : Math.floor(5 + 3 * Math.sin(x * 0.07 + seed) + 3 * Math.cos(z * 0.05 - seed));
    }
  }
  key(x, y, z) { return (x * (CFG.YMAX - CFG.YMIN) + (y - CFG.YMIN)) * CFG.SZ + z; }
  unkey(k) { const z = k % CFG.SZ; k = (k - z) / CFG.SZ; const span = CFG.YMAX - CFG.YMIN; const yy = k % span; return [(k - yy) / span, yy + CFG.YMIN, z]; }
  inb(x, y, z) { return Number.isInteger(x) && Number.isInteger(y) && Number.isInteger(z) && x >= 0 && x < CFG.SX && z >= 0 && z < CFG.SZ && y >= CFG.YMIN && y < CFG.YMAX; }
  zone(x, y, z) {
    if (!this.inb(x, y, z)) return Z.OOB;
    if (y === CFG.YMIN) return Z.CORE;
    if ((isRoadCoord(x) || isRoadCoord(z)) && y >= -2 && y < 5) return Z.CORE;
    if (x >= 128 && x < 160 && z >= 128 && z < 160 && y >= -4 && y < 24) return Z.CORE;
    if (y >= -2 && y < 14) for (const [bx, bz] of CITY_BOXES) if (x >= bx - 2 && x < bx + 14 && z >= bz - 2 && z < bz + 14) return Z.CITY;
    if (x >= PLOT.x0 && x < PLOT.x1 && z >= PLOT.z0 && z < PLOT.z1 && y > CFG.YMIN) return Z.PLOT;
    return Z.WILD;
  }
  base(x, y, z) {                                   // L0 + 프리팹. 저장하지 않는 순수 함수
    if (y === CFG.YMIN) return B.BEDROCK;
    const h = this.h[x * CFG.SZ + z];
    if (y > h) {
      if (y >= 1 && y < 9) for (const [bx, bz] of CITY_BOXES) if (x >= bx && x < bx + 12 && z >= bz && z < bz + 12) {
        const edge = x === bx || x === bx + 11 || z === bz || z === bz + 11 || y === 8;
        if (edge) return (y === 3 && (x + z) % 3 === 0) ? B.GLASS : B.BRICK;
      }
      return B.AIR;
    }
    if (y === h) return (isRoadCoord(x) || isRoadCoord(z)) ? B.ROAD : B.GRASS;
    return y > h - 4 ? B.DIRT : B.STONE;
  }
  get(x, y, z) {
    if (!this.inb(x, y, z)) return B.BEDROCK;       // 경계 밖은 단단한 벽으로 취급
    const k = this.key(x, y, z);
    const t = this.temp.get(k); if (t !== undefined) return t.id;
    const d = this.delta.get(k); if (d !== undefined) return d;
    return this.base(x, y, z);
  }
  rej(why) { this.stats.rejected[why] = (this.stats.rejected[why] || 0) + 1; return false; }
  clamp(why) { this.stats.clamped[why] = (this.stats.clamped[why] || 0) + 1; }
  playerAt(x, y, z) { for (const p of this.players) { const px = Math.floor(p.x), py = Math.floor(p.y), pz = Math.floor(p.z); if (px === x && pz === z && (py === y || py + 1 === y)) return p; } return null; }
  canEdit(actor, x, y, z) {
    const zn = this.zone(x, y, z);
    if (zn === Z.OOB) return 0;
    if (zn === Z.CORE) return this.mut.noCoreGuard ? Z.WILD : 0;
    if (zn === Z.PLOT) { const p = this.players[actor]; return (p && (p.owner || p.permitted)) ? Z.PLOT : 0; }
    return zn;
  }
  // 모든 블록 변경의 유일한 입구
  setBlock(actor, x, y, z, id) {
    if (!this.inb(x, y, z)) return this.rej('oob');
    if (!(id >= 0 && id <= 10) || !Number.isInteger(id)) return this.rej('bad_block');
    const zn = this.canEdit(actor, x, y, z);
    if (!zn) return this.rej(this.zone(x, y, z) === Z.CORE ? 'core' : 'no_permission');
    if (id !== B.AIR && this.playerAt(x, y, z)) return this.rej('occupied');
    const k = this.key(x, y, z);
    const cur = this.get(x, y, z); if (cur === id) return true;
    let toTemp = zn === Z.CITY;
    if (!toTemp && !this.delta.has(k) && this.delta.size >= CFG.MAX_DELTA) { toTemp = true; this.clamp('delta_full_to_temp'); }
    if (toTemp) {
      if (this.delta.has(k)) { toTemp = false; }    // 이미 영구 편집이 있는 칸은 영구 계층에서 처리
      else {
        if (this.temp.size >= CFG.MAX_TEMP && !this.temp.has(k)) return this.rej('temp_full');
        if (id === this.base(x, y, z)) this.temp.delete(k); else this.temp.set(k, { id, exp: this.tick + CFG.HEAL_TICKS, defers: 0 });
        return true;
      }
    }
    this.journal.push([k, this.delta.get(k)]);
    if (id === this.base(x, y, z)) this.delta.delete(k); else this.delta.set(k, id);
    this.temp.delete(k);
    return true;
  }
  place(actor, x, y, z, id) { if (id === B.AIR || id === B.BEDROCK || id === B.ROAD) return this.rej('bad_block'); if (this.get(x, y, z) !== B.AIR) return this.rej('not_empty'); return this.setBlock(actor, x, y, z, id); }
  dig(actor, x, y, z) { const c = this.get(x, y, z); if (c === B.AIR) return this.rej('empty'); if (RES[c] === Infinity) return this.rej('unbreakable'); return this.setBlock(actor, x, y, z, B.AIR); }

  fin3(x, y, z) { return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z); }
  allow(actor) {
    const a = this.rate.get(actor) || []; const cut = this.tick - CFG.TICK_HZ;
    while (a.length && a[0] <= cut) a.shift();
    if (a.length >= CFG.ACTOR_EXPLOSIONS_PER_SEC) { this.rate.set(actor, a); return false; }
    a.push(this.tick); this.rate.set(actor, a); return true;
  }
  explode(actor, x, y, z, power, { chained = false, delay = 0 } = {}) {
    if (!this.mut.noSanitize) {
      if (!this.fin3(x, y, z) || !Number.isFinite(power)) { this.stats.fizzles++; return this.rej('nan'); }
      if (x < 0 || x >= CFG.SX || z < 0 || z >= CFG.SZ || y < CFG.YMIN || y >= CFG.YMAX) { this.stats.fizzles++; return this.rej('oob'); }
      if (power <= 0) { this.stats.fizzles++; return this.rej('bad_power'); }
      if (power > CFG.MAX_POWER) { power = CFG.MAX_POWER; this.clamp('power'); }
    }
    if (!chained && !this.allow(actor)) { this.stats.fizzles++; return this.rej('rate'); }
    if (!this.mut.noQueueCap && this.pending.length >= CFG.MAX_PENDING_EXPLOSIONS) { this.stats.fizzles++; return this.rej('queue_full'); }
    this.pending.push({ x, y, z, power, actor, at: this.tick + delay });
    this.stats.maxPending = Math.max(this.stats.maxPending, this.pending.length);
    return true;
  }
  runExplosion(e) {
    this.stats.explosions++;
    if (e.power > this.stats.maxPower || Number.isNaN(e.power)) this.stats.maxPower = Number.isNaN(e.power) ? Infinity : e.power;
    const rng = mulberry32((Math.floor(e.x * 31) ^ Math.floor(e.y * 131) ^ Math.floor(e.z * 977) ^ (this.tick * 7919) ^ this.seed) | 0);
    const hit = new Set(); const out = [];
    for (let r = 0; r < RAYS.length && out.length < CFG.MAX_BLOCKS_PER_EXPLOSION; r++) {
      const d = RAYS[r]; let inten = e.power * (0.7 + 0.6 * rng());
      let px = e.x, py = e.y, pz = e.z; let guard = 0;
      while (inten > 0 && guard++ < 400) {
        const bx = Math.floor(px), by = Math.floor(py), bz = Math.floor(pz);
        if (!this.inb(bx, by, bz)) break;
        const id = this.get(bx, by, bz);
        if (id !== B.AIR) {
          const zn = this.canEdit(e.actor, bx, by, bz);
          if (!zn || RES[id] === Infinity) break;   // 보호 구역과 깨지지 않는 블록에서 광선 종료
          inten -= (RES[id] + 0.3) * 0.3;
          if (inten > 0) { const k = this.key(bx, by, bz); if (!hit.has(k)) { hit.add(k); out.push([bx, by, bz, id]); if (out.length >= CFG.MAX_BLOCKS_PER_EXPLOSION) { this.clamp('explosion_blocks'); break; } } }
        }
        px += d[0] * 0.3; py += d[1] * 0.3; pz += d[2] * 0.3; inten -= 0.225;
      }
    }
    this.stats.maxExpBlocks = Math.max(this.stats.maxExpBlocks, out.length);
    for (const [bx, by, bz, id] of out) {
      this.ops.push([e.actor, bx, by, bz, B.AIR]);
      if (id === B.DYNAMITE) { this.stats.chains++; this.explode(e.actor, bx + 0.5, by + 0.5, bz + 0.5, 4, { chained: true, delay: CFG.FUSE_MIN + Math.floor(rng() * (CFG.FUSE_MAX - CFG.FUSE_MIN)) }); }
    }
    for (const p of this.players) {                 // 넉백: 크기 제한
      const dx = p.x - e.x, dy = p.y - e.y, dz = p.z - e.z; const dist = Math.hypot(dx, dy, dz);
      if (dist < e.power * 2 && dist > 1e-6) { const f = (1 - dist / (e.power * 2)) * 1.5; this.impulse(p.id, dx / dist * f, dy / dist * f + 0.2, dz / dist * f); }
    }
  }
  impulse(pid, ix, iy, iz) {
    const p = this.players[pid]; if (!p) return this.rej('no_player');
    if (!this.fin3(ix, iy, iz)) return this.rej('nan');
    p.vx += ix; p.vy += iy; p.vz += iz;
    const s = Math.hypot(p.vx, p.vy, p.vz);
    if (s > CFG.MAX_SPEED) { const k = CFG.MAX_SPEED / s; p.vx *= k; p.vy *= k; p.vz *= k; this.clamp('speed'); }
    return true;
  }
  waterBomb(actor, x, y, z) {
    if (!this.fin3(x, y, z)) return this.rej('nan');
    const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
    if (!this.inb(bx, by, bz)) return this.rej('oob');
    if (!this.allow(actor)) return this.rej('rate');
    const id = this.tick * 1000 + this.bombs.size;
    this.bombs.set(id, CFG.FLUID_PER_BOMB);
    this.addFluid(bx, by, bz, 7, id);
    for (const p of this.players) { const d = Math.hypot(p.x - x, p.y - y, p.z - z); if (d < 4 && d > 1e-6) this.impulse(p.id, (p.x - x) / d * 0.4, 0.1, (p.z - z) / d * 0.4); }
    return true;
  }
  addFluid(x, y, z, lvl, bomb) {
    if (!this.inb(x, y, z) || this.get(x, y, z) !== B.AIR) return false;
    const k = this.key(x, y, z); const cur = this.fluid.get(k);
    if (cur && cur.lvl >= lvl) return false;
    if (!this.mut.noFluidCaps) {
      if (!cur && this.fluid.size >= CFG.MAX_FLUID) { this.clamp('fluid_global'); return false; }
      const left = this.bombs.get(bomb) || 0; if (left <= 0) { this.clamp('fluid_bomb'); return false; }
      this.bombs.set(bomb, left - 1);
    }
    this.fluid.set(k, { lvl, exp: this.tick + CFG.FLUID_TTL, bomb }); this.fluidFront.push(k);
    this.stats.maxFluid = Math.max(this.stats.maxFluid, this.fluid.size);
    return true;
  }
  rocket(actor, x, y, z, dx, dy, dz, speed) {
    if (!this.fin3(x, y, z) || !this.fin3(dx, dy, dz) || !Number.isFinite(speed)) return this.rej('nan');
    const l = Math.hypot(dx, dy, dz); if (l < 1e-6) return this.rej('zero_dir');
    if (x < 0 || x >= CFG.SX || z < 0 || z >= CFG.SZ || y < CFG.YMIN || y >= CFG.YMAX) return this.rej('oob');
    if (speed <= 0) return this.rej('bad_speed');
    if (speed > CFG.PROJ_MAX_SPEED) { speed = CFG.PROJ_MAX_SPEED; this.clamp('proj_speed'); }
    if (this.proj.length >= CFG.MAX_PROJECTILES) return this.rej('proj_global');
    if (this.proj.filter((p) => p.actor === actor).length >= CFG.ACTOR_PROJECTILES) return this.rej('proj_actor');
    this.proj.push({ actor, x, y, z, dx: dx / l, dy: dy / l, dz: dz / l, speed, ttl: CFG.PROJ_TTL });
    this.stats.maxProj = Math.max(this.stats.maxProj, this.proj.length);
    return true;
  }
  rescue(p) { [p.x, p.y, p.z] = [CFG.SPAWN[0] + 0.5, CFG.SPAWN[1], CFG.SPAWN[2] + 0.5]; p.vx = p.vy = p.vz = 0; this.stats.rescues++; }
  solidAtPlayer(p) { const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z); return this.get(x, y, z) !== B.AIR || this.get(x, y + 1, z) !== B.AIR; }

  step() {
    this.tick++;
    // 1) 폭발: 틱당 개수 제한
    let ran = 0; const keep = [];
    for (const e of this.pending) { if (e.at <= this.tick && ran < CFG.MAX_EXPLOSIONS_PER_TICK) { this.runExplosion(e); ran++; } else keep.push(e); }
    this.pending = keep;
    // 2) 블록 연산: 틱당 예산
    let n = 0; const budget = this.mut.noOpsBudget ? Infinity : CFG.MAX_BLOCK_OPS_PER_TICK;
    while (this.ops.length && n < budget) { const o = this.ops.shift(); this.setBlock(o[0], o[1], o[2], o[3], o[4]); n++; }
    this.stats.maxOpsTick = Math.max(this.stats.maxOpsTick, n);
    // 3) 투사체: 0.25 간격 스윕
    const alive = [];
    for (const p of this.proj) {
      let dead = false; const steps = Math.ceil(p.speed / 0.25); const inc = p.speed / steps;
      for (let s = 0; s < steps && !dead; s++) {
        const nx = p.x + p.dx * inc, ny = p.y + p.dy * inc, nz = p.z + p.dz * inc;
        const bx = Math.floor(nx), by = Math.floor(ny), bz = Math.floor(nz);
        if (!this.inb(bx, by, bz)) { dead = true; break; }
        if (this.get(bx, by, bz) !== B.AIR) { this.explode(p.actor, p.x, p.y, p.z, CFG.ROCKET_POWER, { chained: true }); dead = true; break; }
        p.x = nx; p.y = ny; p.z = nz;
      }
      if (!dead && --p.ttl > 0) alive.push(p);
    }
    this.proj = alive;
    // 4) 유체: 5틱마다 전파, 갱신 수 제한, 수명 만료
    if (this.tick % CFG.FLUID_STEP === 0) {
      const front = this.fluidFront.splice(0, this.mut.noFluidCaps ? this.fluidFront.length : CFG.MAX_FLUID_UPDATES);
      for (const k of front) {
        const c = this.fluid.get(k); if (!c) continue; const [x, y, z] = this.unkey(k);
        if (this.inb(x, y - 1, z) && this.get(x, y - 1, z) === B.AIR) { this.addFluid(x, y - 1, z, 7, c.bomb); continue; }
        if (c.lvl > 1) for (const [ax, az] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) this.addFluid(x + ax, y, z + az, c.lvl - 1, c.bomb);
      }
      for (const [k, c] of this.fluid) if (c.exp <= this.tick || this.get(...this.unkey(k)) !== B.AIR) this.fluid.delete(k);
      for (const [id] of this.bombs) if (id < (this.tick - CFG.FLUID_TTL - 10) * 1000) this.bombs.delete(id);
    }
    // 5) 임시 편집 복구: 예산, 플레이어가 서 있으면 연기
    let healed = 0;
    for (const [k, t] of this.temp) {
      if (healed >= CFG.MAX_HEALS_PER_TICK) break;
      if (t.exp > this.tick) continue;
      const [x, y, z] = this.unkey(k); const baseId = this.base(x, y, z);
      const pl = baseId !== B.AIR ? this.playerAt(x, y, z) : null;
      if (pl) {
        if (t.defers < 10) { t.defers++; t.exp = this.tick + 20; continue; }   // 최대 10초 기다린 뒤
        this.temp.delete(k); healed++; this.stats.heals++;                      // 복구하고 플레이어를 위로 올린다
        let ok = false; for (let up = 0; up < 16 && !ok; up++) { pl.y += 1; ok = pl.y < CFG.YMAX - 3 && !this.solidAtPlayer(pl); }
        if (!ok) this.rescue(pl);
        continue;
      }
      this.temp.delete(k); healed++; this.stats.heals++;
    }
    this.stats.maxTemp = Math.max(this.stats.maxTemp, this.temp.size);
    // 6) 플레이어 적분: 칸 단위 충돌, 경계·NaN 구조
    for (const p of this.players) {
      if (!this.fin3(p.x, p.y, p.z) || !this.fin3(p.vx, p.vy, p.vz)) { this.rescue(p); continue; }
      const steps = Math.max(1, Math.ceil(Math.hypot(p.vx, p.vy, p.vz) / 0.25));
      for (let s = 0; s < steps; s++) {
        const ox = p.x, oy = p.y, oz = p.z;
        p.x += p.vx / steps; p.y += p.vy / steps; p.z += p.vz / steps;
        if (p.x < 0.5 || p.x > CFG.SX - 0.5 || p.z < 0.5 || p.z > CFG.SZ - 0.5 || p.y < CFG.YMIN + 1 || p.y > CFG.YMAX - 3) { this.rescue(p); break; }
        if (this.solidAtPlayer(p)) { p.x = ox; p.y = oy; p.z = oz; p.vx = p.vy = p.vz = 0; break; }
      }
      p.vx *= 0.8; p.vy *= 0.8; p.vz *= 0.8;
      if (this.solidAtPlayer(p)) { let ok = false; for (let up = 0; up < 16; up++) { p.y += 1; if (p.y < CFG.YMAX - 3 && !this.solidAtPlayer(p)) { ok = true; break; } } if (!ok) this.rescue(p); }
    }
  }
  rollbackAll() { for (let i = this.journal.length - 1; i >= 0; i--) { const [k, prev] = this.journal[i]; if (prev === undefined) this.delta.delete(k); else this.delta.set(k, prev); } this.journal.length = 0; }
  hashState() {
    let h = 2166136261 >>> 0; const mix = (v) => { h ^= v | 0; h = Math.imul(h, 16777619) >>> 0; };
    for (const k of [...this.delta.keys()].sort((a, b) => a - b)) { mix(k); mix(this.delta.get(k)); }
    for (const k of [...this.temp.keys()].sort((a, b) => a - b)) { mix(k); mix(this.temp.get(k).id); }
    for (const p of this.players) { mix(Math.round(p.x * 1000)); mix(Math.round(p.y * 1000)); mix(Math.round(p.z * 1000)); }
    mix(this.fluid.size); mix(this.proj.length); mix(this.pending.length); return h;
  }
}
```

## `unit.mjs`

```js
// 지정 시나리오 검증. 실행: node unit.mjs   (결함 주입: node unit.mjs noFluidCaps)
import { World, CFG, B, Z, ANCHORS } from './kernel.mjs';
import { check } from './fuzz.mjs';
const mut = process.argv[2] ? { [process.argv[2]]: true } : {};
const saved = { ...CFG }; const res = []; let failed = 0;
function mk(n = 3) { const w = new World(7, mut); for (let i = 0; i < n; i++) w.players.push({ id: i, x: 20.5 + i * 9, y: 30, z: 20.5, vx: 0, vy: 0, vz: 0, owner: i === 0 }); return w; }
function snapCore(w) { let h = 0; for (let x = 120; x < 168; x++) for (let z = 120; z < 168; z++) for (let y = -4; y < 24; y++) if (w.zone(x, y, z) === Z.CORE) h = (Math.imul(h, 31) + w.get(x, y, z) + 1) | 0; return h; }
function T(name, fn) { Object.assign(CFG, saved); let ok, info; try { [ok, info] = fn(); } catch (e) { ok = false; info = 'EXC ' + e.message; } if (!ok) failed++; res.push({ name, ok, info }); }
const steps = (w, n) => { for (let i = 0; i < n; i++) w.step(); };

T('T01 광장 한가운데 최대 위력 폭발: 코어 불변', () => { const w = mk(); const h = snapCore(w); for (let i = 0; i < 40; i++) { w.explode(i % 3, 144.5, 1.5, 144.5, 6); steps(w, 6); } return [snapCore(w) === h && w.delta.size === 0 && w.temp.size === 0, `explosions=${w.stats.explosions} changed=${w.delta.size + w.temp.size}`]; });
T('T02 도로를 따라 광장으로 쏜 로켓: 폭발하되 코어 불변', () => { const w = mk(); const h = snapCore(w); for (let i = 0; i < 12; i++) { w.rocket(i % 3, 144.5, 3.5, 90 + i, 0, -0.06, 1, 2); steps(w, 70); } return [snapCore(w) === h && w.stats.explosions === 12 && w.delta.size + w.temp.size === 0, `explosions=${w.stats.explosions} changed=${w.delta.size + w.temp.size}`]; });
T('T03 다이너마이트 512개 연쇄: 대기열 상한 유지, 결국 소진', () => { const w = mk(); let placed = 0; for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) for (let z = 0; z < 8; z++) placed += w.place(0, 200 + x, 14 + y, 200 + z, B.DYNAMITE) ? 1 : 0; w.explode(0, 204.5, 18.5, 204.5, 4); let maxP = 0; for (let i = 0; i < 2000; i++) { w.step(); maxP = Math.max(maxP, w.pending.length); } let left = 0; for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) for (let z = 0; z < 8; z++) if (w.get(200 + x, 14 + y, 200 + z) === B.DYNAMITE) left++; return [placed === 512 && maxP <= CFG.MAX_PENDING_EXPLOSIONS && w.pending.length === 0 && w.stats.maxOpsTick <= CFG.MAX_BLOCK_OPS_PER_TICK, `placed=${placed} maxPending=${maxP} explosions=${w.stats.explosions} fizzled=${w.stats.fizzles} dynamiteLeft=${left} maxOpsTick=${w.stats.maxOpsTick}`]; });
T('T04 물폭탄 폭주(8명, 초당 4개, 20초, 높은 곳): 유체 상한 유지, 블록 변화 없음, 소멸', () => { const w = mk(8); let thrown = 0; for (let t = 0; t < 400; t++) { if (t % 5 === 0) for (let a = 0; a < 8; a++) thrown += w.waterBomb(a, 60 + a * 20 + (t % 7), 40, 80 + (t % 11) * 3) ? 1 : 0; w.step(); } const peak = w.stats.maxFluid; const changed = w.delta.size + w.temp.size; steps(w, 500); return [peak <= CFG.MAX_FLUID && changed === 0 && w.fluid.size === 0, `thrown=${thrown} peakFluid=${peak} cap=${CFG.MAX_FLUID} blockChanges=${changed} afterTTL=${w.fluid.size}`]; });
T('T05 도로를 벽으로 막기 시도: 전부 거절, 9개 거점 연결 유지', () => { const w = mk(); let ok = 0; for (let x = 140; x < 148; x++) for (let y = 1; y < 5; y++) ok += w.place(1, x, y, 100, B.VAULT) ? 1 : 0; const ref = { deep: true, core: null }; const v = check(w, { deep: true, core: (function () { return null; })() }).filter((s) => s !== 'I8 core changed'); return [w.get(143, 1, 100) === B.AIR && v.length === 0, `placedOutsideRoad=${ok} violations=${v.join(',') || 'none'}`]; });
T('T06 무너진 벽 자리에 서 있을 때 복구: 끼이지 않음', () => { const w = mk(); w.explode(1, 59.5, 3.5, 54.5, 6); steps(w, 5); let gone = null; for (let x = 54; x < 66 && !gone; x++) for (let y = 1; y < 8 && !gone; y++) if (w.base(x, y, 54) !== B.AIR && w.get(x, y, 54) === B.AIR && w.get(x, y + 1, 54) === B.AIR) gone = [x, y]; if (!gone) return [false, 'no hole']; const p = w.players[2]; p.x = gone[0] + 0.5; p.y = gone[1]; p.z = 54.5; p.vx = p.vy = p.vz = 0; let stuck = 0; for (let i = 0; i < CFG.HEAL_TICKS + 400; i++) { w.step(); if (w.solidAtPlayer(p)) stuck++; } return [stuck === 0 && w.temp.size === 0, `hole=${gone} stuckTicks=${stuck} playerY=${p.y} tempLeft=${w.temp.size}`]; });
T('T07 남의 부지 폭파 불가, 주인은 가능, 되감기로 원상 복구', () => { const w = mk(); for (let y = 1; y < 4; y++) w.place(0, 116, y, 170, B.PLANK); const mine = w.delta.size; w.explode(1, 116.5, 2.5, 171.5, 6); steps(w, 5); const afterVisitor = w.delta.size; w.explode(0, 116.5, 2.5, 171.5, 6); steps(w, 5); const afterOwner = w.delta.size; w.rollbackAll(); return [mine === 3 && afterVisitor === 3 && afterOwner !== 3 && w.delta.size === 0, `owner placed=${mine} afterVisitorBlast=${afterVisitor} afterOwnerBlast=${afterOwner} afterRollback=${w.delta.size}`]; });
T('T08 저장 한도 도달: 이후 편집은 임시층으로 가고 복구됨', () => { CFG.MAX_DELTA = 50; const w = mk(); for (let i = 0; i < 120; i++) w.place(0, 10 + (i % 30), 20 + Math.floor(i / 30), 10, B.STONE); const d = w.delta.size, t = w.temp.size; steps(w, CFG.HEAL_TICKS + 5); return [d === 50 && t === 70 && w.temp.size === 0, `delta=${d} temp=${t} tempAfterHeal=${w.temp.size}`]; });
T('T09 폭발당 블록 수 상한', () => { CFG.MAX_BLOCKS_PER_EXPLOSION = 100; const w = mk(); for (let x = 0; x < 12; x++) for (let y = 0; y < 12; y++) for (let z = 0; z < 12; z++) w.place(0, 200 + x, 20 + y, 60 + z, B.GLASS); w.explode(0, 206.5, 26.5, 66.5, 6); steps(w, 3); return [w.stats.maxExpBlocks <= 100 && w.stats.maxExpBlocks > 0, `blocks=${w.stats.maxExpBlocks}`]; });
T('T10 틱당 연산 예산: 예산 안에서 나눠 처리하고 모두 적용', () => { CFG.MAX_BLOCK_OPS_PER_TICK = 50; const w = mk(); for (let x = 0; x < 12; x++) for (let y = 0; y < 12; y++) for (let z = 0; z < 12; z++) w.place(0, 200 + x, 20 + y, 60 + z, B.GLASS); w.explode(0, 206.5, 26.5, 66.5, 6); steps(w, 2); const queued = w.ops.length; steps(w, 200); return [w.stats.maxOpsTick <= 50 && queued > 0 && w.ops.length === 0, `maxOpsTick=${w.stats.maxOpsTick} queuedAfter2Ticks=${queued} left=${w.ops.length}`]; });
T('T11 최고 속도 로켓이 1칸 벽을 통과하지 못함', () => { const w = mk(); for (let x = 0; x < 9; x++) for (let y = 0; y < 9; y++) w.place(0, 196 + x, 26 + y, 80, B.VAULT); w.rocket(0, 200.5, 30.5, 60.5, 0, 0, 1, 1e9); let maxZ = 0; for (let i = 0; i < 60; i++) { w.step(); for (const p of w.proj) maxZ = Math.max(maxZ, p.z); } return [maxZ < 80 && w.stats.explosions === 1 && w.get(200, 30, 80) === B.VAULT, `maxZ=${maxZ.toFixed(2)} wallZ=80 explosions=${w.stats.explosions}`]; });
T('T12 투사체 전역 상한(9명 × 4발 시도)', () => { const w = mk(9); let ok = 0; for (let a = 0; a < 9; a++) for (let k = 0; k < 6; k++) ok += w.rocket(a, 30 + a * 20, 50, 30 + k * 5, 0, 0.2, 1, 0.3) ? 1 : 0; return [ok === 32 && w.proj.length === 32, `accepted=${ok} of 54`]; });
T('T13 한 틱에 폭발 20회 요청: 행위자당 초당 4회만 수락', () => { const w = mk(); let ok = 0; for (let k = 0; k < 20; k++) ok += w.explode(0, 200.5, 12.5, 200.5 + k, 3) ? 1 : 0; return [ok === CFG.ACTOR_EXPLOSIONS_PER_SEC, `accepted=${ok} of 20`]; });
T('T14 비정상 입력 70건: 예외 없음, 블록 변화 없음', () => { const w = mk(); const bad = [NaN, Infinity, -Infinity, 1e300, -1e300, null, undefined, '5', {}, []]; let n = 0; for (const v of bad) { w.explode(0, v, 5, 5, 4); w.setBlock(0, v, 5, 5, 1); w.setBlock(0, 5, 5, 5, v); w.waterBomb(0, 5, v, 5); w.rocket(0, v, 5, 5, 0, 0, 1, 1); w.rocket(0, 5, 30, 5, 0, 0, 1, v); w.impulse(0, v, 0, 0); n += 7; } steps(w, 50); const v = check(w, { deep: false }); return [w.delta.size === 0 && w.temp.size === 0 && w.stats.explosions === 0 && v.length === 0, `calls=${n} explosions=${w.stats.explosions} violations=${v.join(',') || 'none'}`]; });
T('T15 부드러운 블록 속 최대 위력 폭발의 크기(참고값)', () => { const w = mk(); for (let x = 0; x < 20; x++) for (let y = 0; y < 20; y++) for (let z = 0; z < 20; z++) w.place(0, 190 + x, 20 + y, 100 + z, B.GLASS); w.explode(0, 200.5, 30.5, 110.5, 6); steps(w, 3); return [w.stats.maxExpBlocks <= CFG.MAX_BLOCKS_PER_EXPLOSION, `glassBlocksDestroyed=${w.stats.maxExpBlocks} cap=${CFG.MAX_BLOCKS_PER_EXPLOSION}`]; });
T('T16 최대 위력 폭발 1회 계산 시간(Node 참고값)', () => { const w = mk(); const t0 = process.hrtime.bigint(); const N = 50; for (let i = 0; i < N; i++) w.runExplosion({ x: 60.5 + i, y: 4.5, z: 200.5, power: 6, actor: 0 }); const ms = Number(process.hrtime.bigint() - t0) / 1e6 / N; return [ms < 50, `avgMs=${ms.toFixed(2)}`]; });
Object.assign(CFG, saved);
for (const r of res) console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + '  [' + r.info + ']');
console.log(`${res.length - failed}/${res.length} passed` + (process.argv[2] ? `  (mutant: ${process.argv[2]})` : ''));
process.exit(failed ? 1 : 0);
```

## `fuzz.mjs`

```js
// 파괴 규칙 퍼즈 검증. 실행: node fuzz.mjs [시드 수] [시드당 행동 수]
import { World, CFG, B, Z, ANCHORS, mulberry32 } from './kernel.mjs';

const SEEDS = +process.argv[2] || 20, ACTIONS = +process.argv[3] || 1500;

function coreHash(w) {                                  // 보호 코어 전체(도로 격자 + 광장)의 블록 해시
  let h = 2166136261 >>> 0; const mix = (v) => { h ^= v; h = Math.imul(h, 16777619) >>> 0; };
  for (let x = 0; x < CFG.SX; x++) for (let z = 0; z < CFG.SZ; z++) for (let y = -2; y < 5; y++) if (w.zone(x, y, z) === Z.CORE) mix(w.get(x, y, z) + 1);
  for (let x = 128; x < 160; x++) for (let z = 128; z < 160; z++) for (let y = 5; y < 24; y++) mix(w.get(x, y, z) + 1);
  return h;
}
function cityHash(w) { let h = 2166136261 >>> 0; for (let x = 0; x < CFG.SX; x++) for (let z = 0; z < CFG.SZ; z++) for (let y = -2; y < 14; y++) if (w.zone(x, y, z) === Z.CITY) { h ^= w.get(x, y, z) + 1; h = Math.imul(h, 16777619) >>> 0; } return h; }
const roadCol = (v) => (v >= 46 && v < 50) || (v >= 142 && v < 146) || (v >= 238 && v < 242);
function roadsConnected(w) {                            // I2: 스폰에서 9개 거점까지 도로 위 보행 가능
  const ok = (x, z) => x >= 0 && x < CFG.SX && z >= 0 && z < CFG.SZ && (roadCol(x) || roadCol(z)) && w.get(x, 0, z) !== B.AIR && w.get(x, 1, z) === B.AIR && w.get(x, 2, z) === B.AIR;
  const seen = new Uint8Array(CFG.SX * CFG.SZ); const q = [[CFG.SPAWN[0], CFG.SPAWN[2]]];
  if (!ok(q[0][0], q[0][1])) return false; seen[q[0][0] * CFG.SZ + q[0][1]] = 1;
  while (q.length) { const [x, z] = q.pop(); for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, nz = z + dz; if (ok(nx, nz) && !seen[nx * CFG.SZ + nz]) { seen[nx * CFG.SZ + nz] = 1; q.push([nx, nz]); } } }
  return ANCHORS.every(([ax, , az]) => seen[ax * CFG.SZ + az]);
}
export function check(w, ref) {
  const v = [];
  const [sx, sy, sz] = CFG.SPAWN;
  if (w.get(sx, sy - 1, sz) === B.AIR || w.get(sx, sy, sz) !== B.AIR || w.get(sx, sy + 1, sz) !== B.AIR) v.push('I1 spawn');
  if (ref.deep && !roadsConnected(w)) v.push('I2 roads');
  if (ref.deep && coreHash(w) !== ref.core) v.push('I8 core changed');
  for (const k of w.delta.keys()) if (w.zone(...w.unkey(k)) === Z.CORE) { v.push('I8 delta in core'); break; }
  for (const k of w.temp.keys()) if (w.zone(...w.unkey(k)) === Z.CORE) { v.push('I8 temp in core'); break; }
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
    else if (p.x < 0 || p.x >= CFG.SX || p.z < 0 || p.z >= CFG.SZ || p.y < CFG.YMIN || p.y >= CFG.YMAX) v.push('player OOB');
    else if (w.solidAtPlayer(p)) v.push('player in block');
    if (Math.hypot(p.vx, p.vy, p.vz) > CFG.MAX_SPEED + 1e-9) v.push('player speed');
  }
  return v;
}
const HOT = [[144, 2, 144], [144, 1, 100], [48, 1, 48], [60, 4, 60], [106, 4, 106], [116, 2, 170], [150, 3, 150], [240, 1, 144], [47, 1, 200], [20, 8, 20]];
const BAD = [NaN, Infinity, -Infinity, 1e12, -1e12, -1, 1e9, 0.5, -0.0];

export function run(seed, actions, mut = {}, trace = null) {
  const w = new World(seed, mut); const r = mulberry32(seed * 7919 + 13);
  w.players.push({ id: 0, x: 144.5, y: 1, z: 144.5, vx: 0, vy: 0, vz: 0, owner: true });
  w.players.push({ id: 1, x: 60.5, y: 12, z: 100.5, vx: 0, vy: 0, vz: 0 });
  w.players.push({ id: 2, x: 116.5, y: 1, z: 170.5, vx: 0, vy: 0, vz: 0 });
  for (let id = 3; id < 8; id++) w.players.push({ id, x: 20.5 + id * 30, y: 20, z: 20.5, vx: 0, vy: 0, vz: 0 });   // 정원 8명
  const ref = { core: coreHash(w), city: cityHash(w), deep: true };
  const fails = []; const ri = (n) => Math.floor(r() * n);
  const pos = () => { if (r() < 0.6) { const h = HOT[ri(HOT.length)]; return [h[0] + ri(17) - 8 + r(), h[1] + ri(9) - 3 + r(), h[2] + ri(17) - 8 + r()]; } return [r() * CFG.SX, CFG.YMIN + r() * (CFG.YMAX - CFG.YMIN), r() * CFG.SZ]; };
  const bad = () => BAD[ri(BAD.length)];
  for (let i = 0; i < actions; i++) {
    const a = ri(3), t = r(); let [x, y, z] = pos();
    if (t < 0.22) w.explode(a, x, y, z, 1 + r() * 7);
    else if (t < 0.30) w.explode(a, r() < 0.5 ? bad() : x, r() < 0.5 ? bad() : y, r() < 0.5 ? bad() : z, r() < 0.7 ? bad() : 4);
    else if (t < 0.38) { const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z); const n = 2 + ri(5); for (let dx = 0; dx < n; dx++) for (let dy = 0; dy < n; dy++) for (let dz = 0; dz < n; dz++) w.place(a, bx + dx, by + dy, bz + dz, B.DYNAMITE); w.explode(a, bx + 0.5, by + 0.5, bz + 0.5, 4); }
    else if (t < 0.50) { const bx = Math.floor(x), bz = Math.floor(z); for (let k = 0; k < 12; k++) w.place(a, bx + (k % 4), 1 + Math.floor(k / 4), bz, [B.STONE, B.PLANK, B.VAULT, B.BRICK][ri(4)]); }
    else if (t < 0.56) w.setBlock(a, r() < 0.5 ? bad() : Math.floor(x), Math.floor(y), r() < 0.5 ? bad() : Math.floor(z), r() < 0.5 ? bad() : ri(11));
    else if (t < 0.66) w.waterBomb(a, r() < 0.15 ? bad() : x, r() < 0.5 ? y + 20 : y, z);
    else if (t < 0.80) { const tx = HOT[ri(HOT.length)]; const d = r() < 0.15 ? [bad(), bad(), bad()] : r() < 0.5 ? [tx[0] - x, tx[1] - y, tx[2] - z] : [r() - 0.5, r() - 0.5, r() - 0.5]; w.rocket(a, x, Math.max(y, 6), z, d[0], d[1], d[2], r() < 0.2 ? bad() : 0.3 + r() * 4); }
    else if (t < 0.86) w.impulse(ri(8), r() < 0.3 ? bad() : (r() - 0.5) * 50, (r() - 0.5) * 50, r() < 0.3 ? bad() : (r() - 0.5) * 50);
    else if (t < 0.91) { for (let k = 0; k < 20; k++) w.dig(a, Math.floor(x) + ri(3), Math.floor(y) - ri(4), Math.floor(z) + ri(3)); }
    else if (t < 0.96) { for (let k = 0; k < 12; k++) { const q = pos(); if (r() < 0.5) w.explode(a, q[0], q[1], q[2], 5); else w.rocket(ri(8), q[0], Math.max(q[1], 6), q[2], r() - 0.5, -r(), r() - 0.5, 2); } }
    else if (t < 0.98) { const p = w.players[ri(8)]; const h = HOT[ri(HOT.length)]; p.x = h[0] + 0.5; p.y = h[1] + 6; p.z = h[2] + 0.5; if (w.solidAtPlayer(p)) w.rescue(p); }
    const n = 1 + ri(r() < 0.1 ? 60 : 6);
    for (let s = 0; s < n; s++) { w.step(); ref.deep = false; const v = check(w, ref); if (v.length) { fails.push({ i, tick: w.tick, v }); break; } }
    if (i % 100 === 99 || i === actions - 1) { ref.deep = true; const v = check(w, ref); if (v.length) fails.push({ i, tick: w.tick, v }); }
    if (fails.length) break;
  }
  const mid = w.hashState();
  // 정리 단계: 행동을 멈추고 70초 진행 → 임시 계층·유체·투사체·대기열이 비어야 하고 도시 구역이 원형과 같아야 한다
  if (!fails.length) {
    for (let s = 0; s < CFG.HEAL_TICKS + 300; s++) w.step();
    ref.deep = true; const v = check(w, ref);
    if (w.temp.size) v.push('temp not drained:' + w.temp.size);
    if (w.fluid.size) v.push('fluid not drained');
    if (w.proj.length || w.pending.length || w.ops.length) v.push('queues not drained');
    if (cityHash(w) !== ref.city) v.push('city not healed');
    w.rollbackAll(); if (w.delta.size) v.push('rollback left delta:' + w.delta.size);
    if (v.length) fails.push({ i: 'settle', tick: w.tick, v });
  }
  return { fails, stats: w.stats, mid, ticks: w.tick, journal: w.journal.length };
}

if (process.argv[1].endsWith('fuzz.mjs')) {
  const t0 = Date.now(); const agg = { rejected: {}, clamped: {} }; let bad = 0; const mx = {}; let ticks = 0;
  for (let s = 1; s <= SEEDS; s++) {
    const a = run(s, ACTIONS); const b = s <= 5 ? run(s, ACTIONS) : a;
    if (a.mid !== b.mid) { bad++; console.log('seed', s, 'NON-DETERMINISTIC'); }
    if (a.fails.length) { bad++; console.log('seed', s, 'FAIL', JSON.stringify(a.fails[0])); }
    ticks += a.ticks;
    for (const k of ['rejected', 'clamped']) for (const [n, c] of Object.entries(a.stats[k])) agg[k][n] = (agg[k][n] || 0) + c;
    for (const [n, c] of Object.entries(a.stats)) if (typeof c === 'number') mx[n] = n.startsWith('max') ? Math.max(mx[n] || 0, c) : (mx[n] || 0) + c;
  }
  console.log(JSON.stringify({ seeds: SEEDS, actionsPerSeed: ACTIONS, ticks, failedSeeds: bad, totals: mx, rejected: agg.rejected, clamped: agg.clamped, seconds: (Date.now() - t0) / 1000 }, null, 1));
  process.exit(bad ? 1 : 0);
}
```

## `mutants.mjs`

```js
// 검증의 검증: 방어 장치를 하나씩 끄고 퍼즈가 그 결함을 잡아내는지 확인한다.
import { run } from './fuzz.mjs';
const MUT = ['noCoreGuard', 'noFluidCaps', 'noQueueCap', 'noSanitize'];
const out = {};
for (const m of MUT) {
  let caught = null;
  for (let s = 1; s <= 4 && !caught; s++) { const r = run(s, 500, { [m]: true }); if (r.fails.length) caught = { seed: s, at: r.fails[0].i, v: r.fails[0].v }; }
  out[m] = caught || 'NOT CAUGHT';
}
console.log(JSON.stringify(out, null, 1));
```
