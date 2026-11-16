import { describe, expect, it } from 'vitest';
import { PeerMotion, peerMotionOf } from '../peer-motion.js';

describe('PeerMotion (a newcomer sees the others where they are now)', () => {
  it('a hello entry with velocity and age is drawn at the carried spot at once, then walks on without a glide', () => {
    // hello pose part: [x, y, z, yaw, anim, proto, vx, vz, w, ageMs]: walking +z at 4 m/s, pose 2 s old
    const v = peerMotionOf([0, 1, 0, 0, 1, 2, 0, 4, 0, 2000]);
    expect(v).toEqual({ vx: 0, vz: 4, w: 0, ageMs: 2000 });
    const m = new PeerMotion();
    const now = 10_000;
    m.set(0, 1, 0, 0, v.vx, v.vz, now - v.ageMs, v.w);
    m.settle(now);
    expect(m.z).toBeCloseTo(8, 5);
    m.step(1 / 60, now + 1000 / 60);
    expect(m.z).toBeCloseTo(8 + 4 / 60, 3);
  });

  it('older hello entries (no velocity, no age) still place the figure where it stood', () => {
    expect(peerMotionOf([3, 0, 4, 1, 0])).toEqual({ vx: 0, vz: 0, w: 0, ageMs: 0 });
    const m = new PeerMotion();
    m.set(3, 0, 4, 1, 0, 0, 500);
    m.settle(500);
    expect([m.x, m.z, m.yaw]).toEqual([3, 4, 1]);
  });
});
