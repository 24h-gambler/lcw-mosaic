/**
 * Player movement against the voxel grid: AABB 0.6 x 1.8 x 0.6 (docs/08 6.2), walk 4.5 m/s and sprint from
 * sim-core TUNING, gravity, jumping and step-up. The step-up height is the caller's: half a block (stairs, slabs) by
 * default in play, a whole block only with the "auto jump" setting or while the world walks the child (Dan 11-16
 * R2625: an automatic hop onto every block felt like a jump nobody pressed).
 * Pure: the block lookup is passed in.
 */
import { TUNING } from '@lcw/sim-core';
import { collideHeight } from './blocks.js';

export const PLAYER_HALF_W = TUNING.character.collisionBoxMeters[0] / 2;
export const PLAYER_H = TUNING.character.collisionBoxMeters[1];
export const GRAVITY = 26;
export const JUMP_SPEED = 8.2;
export const STEP_UP_MAX = 1.05;
/** Without auto jump: stairs, slabs and paths only (a slab on a path is 0.6 up; a whole block never). */
export const STEP_UP_SMALL = 0.65;

export interface Body {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  onGround: boolean;
  /** smoothed visual y offset after a step-up, decays to 0 */
  stepOffset: number;
}

export interface MoveIntent {
  /** desired horizontal direction in world space (length <= 1) */
  dx: number;
  dz: number;
  run: boolean;
  jump: boolean;
}

export type BlockAt = (x: number, y: number, z: number) => number;

export interface Pusher {
  x: number;
  z: number;
  r: number;
}

export function makeBody(x: number, y: number, z: number): Body {
  return { x, y, z, vx: 0, vy: 0, vz: 0, onGround: false, stepOffset: 0 };
}

/** True if the box [x-hw, x+hw] x [y, y+h] x [z-hw, z+hw] overlaps any solid block part. */
export function boxHits(blockAt: BlockAt, x: number, y: number, z: number, hw = PLAYER_HALF_W, h = PLAYER_H): boolean {
  const eps = 1e-4;
  const x0 = Math.floor(x - hw + eps);
  const x1 = Math.floor(x + hw - eps);
  const y0 = Math.floor(y + eps);
  const y1 = Math.floor(y + h - eps);
  const z0 = Math.floor(z - hw + eps);
  const z1 = Math.floor(z + hw - eps);
  for (let by = y0; by <= y1; by++) {
    for (let bz = z0; bz <= z1; bz++) {
      for (let bx = x0; bx <= x1; bx++) {
        const ch = collideHeight(blockAt(bx, by, bz));
        if (ch <= 0) continue;
        if (y + eps < by + ch) return true;
      }
    }
  }
  return false;
}

/** Height of the floor directly under the box (max collide top among blocks below feet), or -Infinity. */
function floorUnder(blockAt: BlockAt, x: number, y: number, z: number): number {
  const hw = PLAYER_HALF_W - 1e-3;
  let best = -Infinity;
  const by = Math.floor(y - 1e-3);
  for (const ox of [-hw, hw]) {
    for (const oz of [-hw, hw]) {
      const bx = Math.floor(x + ox);
      const bz = Math.floor(z + oz);
      const ch = collideHeight(blockAt(bx, by, bz));
      if (ch > 0) best = Math.max(best, by + ch);
    }
  }
  return best;
}

/**
 * Advance the body by dt seconds. Returns true if a step-up happened (for footstep / camera smoothing).
 */
export function stepBody(
  body: Body,
  intent: MoveIntent,
  dt: number,
  blockAt: BlockAt,
  pushers: readonly Pusher[] = [],
  stepMax = STEP_UP_MAX
): boolean {
  dt = Math.min(dt, 1 / 20);
  const speed = intent.run ? TUNING.world.sprintSpeedMps : TUNING.world.walkSpeedMps;
  const len = Math.hypot(intent.dx, intent.dz);
  const tx = len > 1 ? (intent.dx / len) * speed : intent.dx * speed;
  const tz = len > 1 ? (intent.dz / len) * speed : intent.dz * speed;
  const accel = body.onGround ? 14 : 5;
  const k = 1 - Math.exp(-accel * dt);
  body.vx += (tx - body.vx) * k;
  body.vz += (tz - body.vz) * k;

  if (intent.jump && body.onGround) {
    body.vy = JUMP_SPEED;
    body.onGround = false;
  }
  body.vy -= GRAVITY * dt;
  if (body.vy < -40) body.vy = -40;

  let stepped = false;
  // Horizontal X
  const nx = body.x + body.vx * dt;
  if (!boxHits(blockAt, nx, body.y, body.z)) {
    body.x = nx;
  } else if (body.onGround && tryStep(blockAt, body, nx, body.z, stepMax)) {
    stepped = true;
  } else {
    body.vx = 0;
  }
  // Horizontal Z
  const nz = body.z + body.vz * dt;
  if (!boxHits(blockAt, body.x, body.y, nz)) {
    body.z = nz;
  } else if (body.onGround && tryStep(blockAt, body, body.x, nz, stepMax)) {
    stepped = true;
  } else {
    body.vz = 0;
  }
  // Vertical
  const ny = body.y + body.vy * dt;
  if (!boxHits(blockAt, body.x, ny, body.z)) {
    body.y = ny;
    body.onGround = false;
    if (body.vy <= 0) {
      const floor = floorUnder(blockAt, body.x, body.y + 0.02, body.z);
      if (floor > -Infinity && body.y - floor < 0.02) {
        body.y = floor;
        body.onGround = true;
        body.vy = 0;
      }
    }
  } else {
    if (body.vy < 0) {
      // land on top of the highest solid part under us
      const floor = floorUnder(blockAt, body.x, body.y + 1e-3, body.z);
      body.y = floor > -Infinity ? Math.max(floor, ny) : Math.floor(body.y);
      body.onGround = true;
    }
    body.vy = 0;
  }

  // Soft push away from NPCs so the player can't walk through them.
  for (const p of pushers) {
    const dx = body.x - p.x;
    const dz = body.z - p.z;
    const d = Math.hypot(dx, dz);
    const min = p.r + PLAYER_HALF_W;
    if (d < min && d > 1e-4) {
      const push = min - d;
      const px = body.x + (dx / d) * push;
      const pz = body.z + (dz / d) * push;
      if (!boxHits(blockAt, px, body.y, pz)) {
        body.x = px;
        body.z = pz;
      }
    }
  }

  body.stepOffset *= Math.exp(-12 * dt);
  if (Math.abs(body.stepOffset) < 1e-3) body.stepOffset = 0;
  // Fell out of the world: put back on top.
  if (body.y < -20) {
    body.y = 30;
    body.vy = 0;
  }
  return stepped;
}

function tryStep(blockAt: BlockAt, body: Body, nx: number, nz: number, stepMax: number): boolean {
  for (const up of stepMax >= STEP_UP_MAX ? [0.5, 1.0, STEP_UP_MAX] : [Math.min(0.5, stepMax), stepMax]) {
    if (boxHits(blockAt, body.x, body.y + up, body.z)) return false;
    if (!boxHits(blockAt, nx, body.y + up, nz)) {
      const floor = floorUnder(blockAt, nx, body.y + up, nz);
      const newY = floor > -Infinity ? Math.max(body.y, floor) : body.y + up;
      if (newY - body.y > stepMax + 1e-6) return false;
      body.stepOffset -= newY - body.y;
      body.y = newY;
      body.x = nx;
      body.z = nz;
      return true;
    }
  }
  return false;
}

/** March a ray through the grid; returns distance to the first block with collision, or maxDist. */
export function raycastDistance(
  blockAt: BlockAt,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxDist: number
): number {
  const step = 0.1;
  for (let t = 0; t < maxDist; t += step) {
    const x = ox + dx * t;
    const y = oy + dy * t;
    const z = oz + dz * t;
    const bx = Math.floor(x);
    const by = Math.floor(y);
    const bz = Math.floor(z);
    const ch = collideHeight(blockAt(bx, by, bz));
    if (ch > 0 && y - by < ch) return t;
  }
  return maxDist;
}

export interface VoxelHit {
  x: number;
  y: number;
  z: number;
  /** face normal of the hit (the empty cell in front is x+nx...) */
  nx: number;
  ny: number;
  nz: number;
  dist: number;
}

/** Exact voxel traversal (Amanatides & Woo) for block picking; hits any non-air block. */
export function pickVoxel(
  blockAt: BlockAt,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxDist: number
): VoxelHit | null {
  let x = Math.floor(ox);
  let y = Math.floor(oy);
  let z = Math.floor(oz);
  const sx = dx > 0 ? 1 : -1;
  const sy = dy > 0 ? 1 : -1;
  const sz = dz > 0 ? 1 : -1;
  const tdx = Math.abs(1 / (dx || 1e-9));
  const tdy = Math.abs(1 / (dy || 1e-9));
  const tdz = Math.abs(1 / (dz || 1e-9));
  let tmx = (dx > 0 ? x + 1 - ox : ox - x) * tdx;
  let tmy = (dy > 0 ? y + 1 - oy : oy - y) * tdy;
  let tmz = (dz > 0 ? z + 1 - oz : oz - z) * tdz;
  let nx = 0;
  let ny = 0;
  let nz = 0;
  let t = 0;
  while (t <= maxDist) {
    const id = blockAt(x, y, z);
    if (id !== 0 && !(t === 0 && nx === 0 && ny === 0 && nz === 0 && false)) {
      return { x, y, z, nx, ny, nz, dist: t };
    }
    if (tmx < tmy && tmx < tmz) {
      x += sx;
      t = tmx;
      tmx += tdx;
      nx = -sx;
      ny = 0;
      nz = 0;
    } else if (tmy < tmz) {
      y += sy;
      t = tmy;
      tmy += tdy;
      nx = 0;
      ny = -sy;
      nz = 0;
    } else {
      z += sz;
      t = tmz;
      tmz += tdz;
      nx = 0;
      ny = 0;
      nz = -sz;
    }
  }
  return null;
}
