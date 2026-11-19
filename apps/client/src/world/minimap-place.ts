/**
 * Where the minimap sits on screen (CSS px), per kind of screen (docs/08 7.3). Its own module without three.js so the
 * app layer (the review dock) can keep clear of it without pulling the renderer in.
 *
 *  - mouse: bottom-right corner; a narrow window (600 px or less) like a phone, the right column (1PC check at 390
 *    with a mouse: the corner one lay on the hotbar, the caption and the controls help);
 *  - touch: the right column under the view button (72 px; 96 px on a tablet);
 *  - touch landscape phone (height 500 or less): top-left under the status chip (its measured bottom, --lw-chip-b);
 *    the right side there is full (view, talk, jump and the two-column build tools).
 * tools/hud-layout.mjs measures the result against every HUD button, the build tools and the review dock.
 */
export const MINIMAP_PLACE = {
  mouse: { bottom: 24, right: 12, size: 148 },
  touch: { top: 124, right: 12, size: 72 },
  tablet: { top: 124, right: 12, size: 96 },
  landscape: { gapBelowChip: 10, left: 12, size: 72 }
} as const;

/** The lowest edge a touch minimap reaches (portrait phone or tablet) plus a gap: what sits under it starts here. */
export const MINIMAP_TOUCH_BOTTOM = Math.max(MINIMAP_PLACE.touch.top + MINIMAP_PLACE.touch.size, MINIMAP_PLACE.tablet.top + MINIMAP_PLACE.tablet.size) + 8;
