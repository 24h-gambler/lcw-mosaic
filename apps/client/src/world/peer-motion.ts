/**
 * How another person's figure moves between their poses (docs/02 §11.3 request budget).
 *
 * A sender sends a pose only when this prediction would be off (room-client.ts), so between poses the figure keeps
 * walking along the velocity and turn rate that came with the last one (predictPose; up to poseHorizonMs, so a frozen
 * tab does not walk away). Each frame the figure moves as far as the prediction did and closes the rest with a ~100 ms
 * ease: no lag while walking straight, a short smooth correction when a turn or stop arrives, a snap after a jump of
 * more than 8 m (teleport, scene change). Pure (no three.js) so the smoothness can be measured in tests.
 */
import { TUNING, predictPose } from '@lcw/sim-core';

/** velocity, turn rate and pose age from a hello entry's pose part ([x,y,z,yaw,anim,proto,vx,vz,w,ageMs]) */
export function peerMotionOf(pose: readonly unknown[]): { vx: number; vz: number; w: number; ageMs: number } {
  const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return { vx: n(pose[6]), vz: n(pose[7]), w: n(pose[8]), ageMs: Math.max(0, n(pose[9])) };
}

/** time constant of the correction ease (s) */
export const PEER_EASE_S = 0.1;
/** fastest a correction slides the figure on top of its walking (m/s) */
export const PEER_FIX_MPS = 6;
/** a gap this large (m) snaps instead of sliding through walls */
export const PEER_SNAP_M = 8;

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

export class PeerMotion {
  x = 0;
  y = 0;
  z = 0;
  yaw = 0;
  seen = false;
  private tx = 0;
  private ty = 0;
  private tz = 0;
  private tyaw = 0;
  private vx = 0;
  private vz = 0;
  private w = 0;
  private at = 0;
  /** the predicted spot at the last step (the figure is carried by how far that moved) */
  private lastPx: number | null = null;
  private lastPz = 0;

  constructor(private readonly horizonMs: number = TUNING.multi.poseHorizonMs) {}

  /** A pose arrived at `now` (ms). */
  set(x: number, y: number, z: number, yaw: number, vx: number, vz: number, now: number, w = 0): void {
    this.tx = x;
    this.ty = y;
    this.tz = z;
    this.tyaw = yaw;
    this.vx = Number.isFinite(vx) ? vx : 0;
    this.vz = Number.isFinite(vz) ? vz : 0;
    this.w = Number.isFinite(w) ? w : 0;
    this.at = now;
    this.lastPx = null;
    if (!this.seen) {
      this.seen = true;
      this.x = x;
      this.y = y;
      this.z = z;
      this.yaw = yaw;
    }
  }

  /** Put the figure straight where the prediction says (a newcomer's first look: no glide from a stale spot). */
  settle(now: number): void {
    if (!this.seen) return;
    const p = this.predicted(now);
    this.x = p.x;
    this.y = p.y;
    this.z = p.z;
    this.yaw = p.yaw;
    this.lastPx = null;
  }

  /** Where the sender should be now: the last pose carried along its velocity, for at most the horizon. */
  predicted(now: number): { x: number; y: number; z: number; yaw: number } {
    const age = Math.min(Math.max(0, now - this.at), this.horizonMs) / 1000;
    const [x, z] = predictPose(this.tx, this.tz, this.vx, this.vz, this.w, age);
    // facing turns with the walking direction while carried along
    return { x, y: this.ty, z, yaw: this.tyaw + this.w * age };
  }

  /** Advance the drawn figure by dt seconds at time `now` (ms). */
  step(dt: number, now: number): void {
    if (!this.seen) return;
    const p = this.predicted(now);
    if (Math.hypot(p.x - this.x, p.y - this.y, p.z - this.z) > PEER_SNAP_M) {
      this.x = p.x;
      this.y = p.y;
      this.z = p.z;
      this.yaw = p.yaw;
      return;
    }
    // carried along as far as the prediction moved since the last frame, then the remaining gap eases out
    if (this.lastPx === null) {
      const p0 = this.predicted(now - dt * 1000);
      this.lastPx = p0.x;
      this.lastPz = p0.z;
    }
    this.x += p.x - this.lastPx;
    this.z += p.z - this.lastPz;
    this.lastPx = p.x;
    this.lastPz = p.z;
    const k = 1 - Math.exp(-dt / PEER_EASE_S);
    // the correction never slides faster than PEER_FIX_MPS (a sharp turn arriving late glides, it does not jump)
    let cx = (p.x - this.x) * k;
    let cz = (p.z - this.z) * k;
    const c = Math.hypot(cx, cz);
    const cap = PEER_FIX_MPS * dt;
    if (c > cap) {
      cx *= cap / c;
      cz *= cap / c;
    }
    this.x += cx;
    this.y += (p.y - this.y) * k;
    this.z += cz;
    this.yaw = wrap(this.yaw + wrap(p.yaw - this.yaw) * k);
  }
}
