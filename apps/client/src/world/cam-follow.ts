/**
 * The camera's follow of the body (R2861①, Dan "점프·옆걸음 할 때 화면 흔들림" R2657 -> R2861).
 *
 * Root cause of the shake: in first person the eye (camPos) moved with the body at once, but the point it looks at
 * (camLook) eased after it (k = 1 - exp(-14 dt)). Every move of the body — a jump, a strafe, a landing — left the look
 * point behind for a few frames, so the view tilted toward where the body had been and swung back: up and down on a
 * jump, sideways on a strafe. In first person the gaze is the mouse's, not a follow: the look point moves with the eye
 * in the same frame. Only a cut into first person (out of a dialog shot or the title circle) eases for a moment.
 *
 * Pure (no three.js): the engine and the shake test (cam-follow.test.ts) run the same code.
 */
export interface V3 {
  x: number;
  y: number;
  z: number;
}

/** The view pitch that looks level (the walking view's resting tilt is just below it). */
export const PITCH_LEVEL = 0.3;
/** Third person: the orbit's range (the camera stays above the feet and below straight overhead). */
export const PITCH_MIN_THIRD = -0.35;
export const PITCH_MAX_THIRD = 1.25;
/** First person: almost straight up and straight down (digging under the feet and building over the head, R2861①). */
export const PITCH_MIN_FIRST = PITCH_LEVEL - 1.5;
export const PITCH_MAX_FIRST = PITCH_LEVEL + 1.5;
/** A cut into first person eases the gaze for this long (s): out of a dialog shot, the title circle or a mode switch. */
export const LOOK_EASE_AFTER_CUT_S = 0.35;

export function clampPitch(p: number, first: boolean): number {
  return first ? Math.max(PITCH_MIN_FIRST, Math.min(PITCH_MAX_FIRST, p)) : Math.max(PITCH_MIN_THIRD, Math.min(PITCH_MAX_THIRD, p));
}

/** The first-person gaze for a yaw and pitch: a unit vector (pitch PITCH_LEVEL = level, more = down). */
export function firstPersonDir(yaw: number, pitch: number): V3 {
  const a = pitch - PITCH_LEVEL;
  const c = Math.cos(a);
  return { x: Math.sin(yaw) * c, y: -Math.sin(a), z: Math.cos(yaw) * c };
}

export interface CamFollow {
  pos: V3;
  look: V3;
  /** the first frame snaps everything */
  init: boolean;
  /** time left of the ease after a cut into first person (s) */
  easeT: number;
  /** last frame was a first-person frame */
  wasFirst: boolean;
}

export function makeCamFollow(): CamFollow {
  return { pos: { x: 0, y: 0, z: 0 }, look: { x: 0, y: 0, z: 1 }, init: false, easeT: 0, wasFirst: false };
}

export interface FollowMode {
  /** the walking first-person view (not paused, not the title) */
  first: boolean;
  /** a dialog looks from the player's eyes: the eye moves at once, the gaze eases onto the face */
  dialogEyes: boolean;
  paused: boolean;
  attract: boolean;
  /** the old follow (the look point eases after the eye in first person too): only for the before/after test */
  legacyLookLag?: boolean;
}

function lerp(a: V3, b: V3, t: number): void {
  a.x += (b.x - a.x) * t;
  a.y += (b.y - a.y) * t;
  a.z += (b.z - a.z) * t;
}

/** One frame of the follow: moves `cam.pos` / `cam.look` toward the wanted ones. */
export function followCamera(cam: CamFollow, wantPos: V3, wantLook: V3, dt: number, m: FollowMode): void {
  const k = cam.init ? 1 - Math.exp(-(m.paused ? 4.5 : 14) * dt) : 1;
  const eyes = !m.attract && (m.first || m.dialogEyes);
  lerp(cam.pos, wantPos, eyes ? 1 : m.attract ? 1 - Math.exp(-1.5 * dt) : k);
  if (m.first && !cam.wasFirst && cam.init) cam.easeT = LOOK_EASE_AFTER_CUT_S;
  cam.wasFirst = m.first;
  if (cam.easeT > 0) cam.easeT = Math.max(0, cam.easeT - dt);
  if (m.first && !m.legacyLookLag && cam.easeT <= 0) {
    // the gaze is the mouse's: the look point rides with the eye in the same frame (no lag, no shake)
    cam.look.x = wantLook.x;
    cam.look.y = wantLook.y;
    cam.look.z = wantLook.z;
  } else {
    lerp(cam.look, wantLook, k);
  }
  cam.init = true;
}

/** The angle (degrees) between the view the camera shows and the one wanted: 0 = the view is exactly the mouse's. */
export function viewErrorDeg(cam: CamFollow, wantPos: V3, wantLook: V3): number {
  const ax = cam.look.x - cam.pos.x;
  const ay = cam.look.y - cam.pos.y;
  const az = cam.look.z - cam.pos.z;
  const bx = wantLook.x - wantPos.x;
  const by = wantLook.y - wantPos.y;
  const bz = wantLook.z - wantPos.z;
  const la = Math.hypot(ax, ay, az);
  const lb = Math.hypot(bx, by, bz);
  if (la < 1e-9 || lb < 1e-9) return 0;
  const c = Math.max(-1, Math.min(1, (ax * bx + ay * by + az * bz) / (la * lb)));
  return (Math.acos(c) * 180) / Math.PI;
}
