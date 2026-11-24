// R2861① (Dan R2657 -> R2861 "점프·옆걸음 할 때 화면 흔들림"): the first-person view never leaves the mouse's line while
// the body jumps or strafes. Measured on the real physics (stepBody) and the engine's own follow (cam-follow.ts): the
// old follow (look point eased after the eye) against the new one (gaze rides with the eye).
import { describe, expect, it } from 'vitest';
import { followCamera, makeCamFollow, firstPersonDir, clampPitch, viewErrorDeg, PITCH_MAX_FIRST, PITCH_MIN_FIRST, type V3 } from '../cam-follow.js';
import { makeBody, stepBody, type BlockAt } from '../physics.js';

const EYE_Y = 1.55;
// flat ground at y < 0
const ground: BlockAt = (_x, y) => (y < 0 ? 1 : 0);

/** The largest angle (deg) between the shown view and the mouse's view over a run of frames. */
function shake(kind: 'jump' | 'strafe', legacy: boolean, fps = 60): number {
  const body = makeBody(10.5, 0, 10.5);
  const cam = makeCamFollow();
  const yaw = 0.4;
  const pitch = 0.3;
  const dt = 1 / fps;
  let worst = 0;
  for (let i = 0; i < fps * 3; i++) {
    const t = i * dt;
    // strafe: left and right every half second (the side of the view); jump: hop again on every landing
    const side = kind === 'strafe' ? (Math.floor(t / 0.5) % 2 === 0 ? 1 : -1) : 0;
    const dx = Math.cos(yaw) * side;
    const dz = -Math.sin(yaw) * side;
    stepBody(body, { dx, dz, run: false, jump: kind === 'jump' }, dt, ground);
    const wantPos: V3 = { x: body.x, y: body.y + body.stepOffset + EYE_Y, z: body.z };
    const d = firstPersonDir(yaw, pitch);
    const wantLook: V3 = { x: wantPos.x + d.x, y: wantPos.y + d.y, z: wantPos.z + d.z };
    followCamera(cam, wantPos, wantLook, dt, { first: true, dialogEyes: false, paused: false, attract: false, legacyLookLag: legacy });
    // after the first second (the start settles), the error the eye sees
    if (t > 1) worst = Math.max(worst, viewErrorDeg(cam, wantPos, wantLook));
  }
  return worst;
}

describe('first-person camera shake (R2861①)', () => {
  it('the old follow tilted the view on a jump and on a strafe (the shake Dan saw)', () => {
    expect(shake('jump', true)).toBeGreaterThan(2);
    expect(shake('strafe', true)).toBeGreaterThan(2);
  });
  it('the new follow keeps the view on the mouse line exactly, at 60, 30 and 20 fps', () => {
    for (const fps of [60, 30, 20]) {
      expect(shake('jump', false, fps)).toBeLessThan(0.01);
      expect(shake('strafe', false, fps)).toBeLessThan(0.01);
    }
  });
  it('a cut into first person (out of a dialog) still eases for a moment, then rides with the eye', () => {
    const cam = makeCamFollow();
    const at: V3 = { x: 0, y: 1.5, z: 0 };
    // a dialog frame looking sideways
    followCamera(cam, at, { x: 1, y: 1.5, z: 0 }, 1 / 60, { first: false, dialogEyes: true, paused: true, attract: false });
    const ahead: V3 = { x: 0, y: 1.5, z: 1 };
    followCamera(cam, at, ahead, 1 / 60, { first: true, dialogEyes: false, paused: false, attract: false });
    expect(viewErrorDeg(cam, at, ahead)).toBeGreaterThan(10);
    for (let i = 0; i < 30; i++) followCamera(cam, at, ahead, 1 / 60, { first: true, dialogEyes: false, paused: false, attract: false });
    expect(viewErrorDeg(cam, at, ahead)).toBeLessThan(0.01);
  });
  it('first person looks nearly straight up and down (dig under the feet, build overhead); third person keeps its orbit', () => {
    const down = firstPersonDir(0, PITCH_MAX_FIRST);
    const up = firstPersonDir(0, PITCH_MIN_FIRST);
    expect(down.y).toBeLessThan(-0.99);
    expect(up.y).toBeGreaterThan(0.99);
    expect(clampPitch(5, true)).toBe(PITCH_MAX_FIRST);
    expect(clampPitch(5, false)).toBe(1.25);
    expect(clampPitch(-5, false)).toBe(-0.35);
    // level at the resting pitch
    expect(Math.abs(firstPersonDir(1, 0.3).y)).toBeLessThan(1e-9);
  });
});

