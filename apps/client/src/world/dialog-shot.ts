/**
 * Camera views (docs/03 4장 외형, docs/08 7.1: first person is the default view, `F5` third person, `Tab` mirror;
 * Dan 11-16 09:20 "평상시 1인칭").
 *
 * Dialog (docs/08 5장 "slow 320 ms"): whatever view the child walks in, a dialog looks at the NPC face to face from
 * the player's own eyes. The engine moves the projection centre into the part of the screen the dialog window leaves
 * free (`setViewInset(bottom, right)`), so looking straight at the face puts it in the middle of that free strip, and
 * nothing of the player stands between (the over-the-shoulder shot hid Hannah behind the player's head on 1280x720
 * and 1440x900, outsider capture on prod 3ae617b).
 *
 * Pure (no THREE) so the views are tested without a renderer.
 */

export type CamMode = 'first' | 'third' | 'mirror';

/** The view a new player starts in. */
export const DEFAULT_CAM_MODE: Exclude<CamMode, 'mirror'> = 'first';

/** Eye height above the feet (the head is the top 8 of 27 voxels of a 1.69 m character). */
export const EYE_Y = 1.55;
/** Height of an NPC's face above its feet. */
export const NPC_FACE_Y = 1.44;

/** `F5`: first person and third person swap; from the mirror it goes back to first person. */
export function toggleThirdPerson(mode: CamMode): CamMode {
  return mode === 'first' ? 'third' : 'first';
}

/** `Tab`: the mirror and back to the view the child came from. */
export function toggleMirror(mode: CamMode, before: Exclude<CamMode, 'mirror'>): CamMode {
  return mode === 'mirror' ? before : 'mirror';
}

/** The touch view button walks all three: first, third, mirror. */
export function cycleCamMode(mode: CamMode): CamMode {
  return mode === 'first' ? 'third' : mode === 'third' ? 'mirror' : 'first';
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Nearer than this the face overflows a phone's free strip (walkToNpc stops ~1.3 m from the errand neighbour):
 * the view eases back along the line of sight, still from the player's side and height (the body is not drawn).
 */
export const DIALOG_MIN_FACE_DIST = 2.1;

/** Free distance along a ray (physics raycastDistance): walls keep the eased-back view inside the room. */
export type FreeRay = (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number) => number;

/** Dialog view: the player's eyes, looking at the NPC's face. */
export function dialogShot(player: Vec3, npc: Vec3, stepOffset = 0, free?: FreeRay): { pos: Vec3; look: Vec3 } {
  const look = { x: npc.x, y: npc.y + NPC_FACE_Y, z: npc.z };
  const eye = { x: player.x, y: player.y + stepOffset + EYE_Y, z: player.z };
  const dx = eye.x - look.x;
  const dz = eye.z - look.z;
  const d = Math.hypot(dx, dz);
  if (d >= DIALOG_MIN_FACE_DIST || d < 1e-3) return { pos: eye, look };
  const ux = dx / d;
  const uz = dz / d;
  const back = Math.max(0, Math.min(DIALOG_MIN_FACE_DIST - d, free ? free(eye.x, eye.y, eye.z, ux, 0, uz, DIALOG_MIN_FACE_DIST - d + 0.3) - 0.3 : Infinity));
  return { pos: { x: eye.x + ux * back, y: eye.y, z: eye.z + uz * back }, look };
}
