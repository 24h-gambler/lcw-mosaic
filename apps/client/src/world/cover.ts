// Pure screen-box geometry for the HUD (world/hud.ts), kept apart so tests need no DOM or three.js.

/**
 * Whether a screen box meets any of the HUD part boxes ([left, top, right, bottom]) by more than `pad` px both ways:
 * a world label (a name plate over a head) there fades, so it never shows through a HUD card (frame, 11-18).
 */
export function coverHits(cover: ReadonlyArray<readonly [number, number, number, number]>, x0: number, y0: number, x1: number, y1: number, pad = 2): boolean {
  for (const [l, t, r, b] of cover) {
    if (Math.min(r, x1) - Math.max(l, x0) > pad && Math.min(b, y1) - Math.max(t, y0) > pad) return true;
  }
  return false;
}
