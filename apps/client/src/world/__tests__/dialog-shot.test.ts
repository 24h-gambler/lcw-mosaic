import { describe, expect, it } from 'vitest';
import { DEFAULT_CAM_MODE, DIALOG_MIN_FACE_DIST, EYE_Y, NPC_FACE_Y, cycleCamMode, dialogShot, toggleMirror, toggleThirdPerson } from '../dialog-shot.js';

describe('camera views (docs/08 7.1, Dan 11-16 09:20)', () => {
  it('starts in first person; F5 swaps to third person and back; Tab is the mirror and returns', () => {
    expect(DEFAULT_CAM_MODE).toBe('first');
    expect(toggleThirdPerson('first')).toBe('third');
    expect(toggleThirdPerson('third')).toBe('first');
    expect(toggleThirdPerson('mirror')).toBe('first');
    expect(toggleMirror('first', 'first')).toBe('mirror');
    expect(toggleMirror('mirror', 'first')).toBe('first');
    expect(toggleMirror('mirror', 'third')).toBe('third');
    expect(cycleCamMode('first')).toBe('third');
    expect(cycleCamMode('third')).toBe('mirror');
    expect(cycleCamMode('mirror')).toBe('first');
  });

  // The arrival spots (#48): the player stands 2.3 m in front of each lesson NPC.
  const PAIRS = [
    { name: 'cafe owner', npc: { x: 167.5, y: 4, z: 134.5 }, player: { x: 165.2, y: 4, z: 134.5 } },
    { name: 'shop owner', npc: { x: 121.5, y: 4, z: 135.5 }, player: { x: 123.8, y: 4, z: 135.5 } },
    { name: 'neighbour', npc: { x: 161, y: 4, z: 141.3 }, player: { x: 161, y: 4, z: 139 } }
  ];
  for (const p of PAIRS) {
    it(`a dialog with the ${p.name} looks from the player's eyes straight at the face`, () => {
      const shot = dialogShot(p.player, p.npc, 0.1);
      expect(shot.pos).toEqual({ x: p.player.x, y: p.player.y + 0.1 + EYE_Y, z: p.player.z });
      expect(shot.look).toEqual({ x: p.npc.x, y: p.npc.y + NPC_FACE_Y, z: p.npc.z });
      // nothing of the player can stand between: the camera is the player's eyes
      const d = Math.hypot(shot.look.x - shot.pos.x, shot.look.z - shot.pos.z);
      expect(d).toBeCloseTo(2.3, 5);
      // nearly level: the gaze drops less than 10 degrees onto the face
      expect(Math.atan2(shot.pos.y - shot.look.y, d)).toBeLessThan((10 * Math.PI) / 180);
    });
  }

  it('eases back along the line of sight when the NPC stands nearer than the face fits, but not through a wall', () => {
    const npc = { x: 161, y: 4, z: 141.3 };
    const player = { x: 161, y: 4, z: 140 };
    const open = dialogShot(player, npc, 0, (_o, _p, _q, _dx, _dy, _dz, max) => max);
    expect(Math.hypot(open.pos.x - npc.x, open.pos.z - npc.z)).toBeCloseTo(DIALOG_MIN_FACE_DIST, 5);
    expect(open.pos.z).toBeLessThan(player.z);
    const wall = dialogShot(player, npc, 0, () => 0.5);
    expect(Math.hypot(wall.pos.x - npc.x, wall.pos.z - npc.z)).toBeCloseTo(1.3 + 0.2, 5);
    const none = dialogShot(player, npc, 0);
    expect(Math.hypot(none.pos.x - npc.x, none.pos.z - npc.z)).toBeCloseTo(DIALOG_MIN_FACE_DIST, 5);
  });
});
