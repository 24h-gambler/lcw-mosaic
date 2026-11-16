// Child screen copy and layout guards (WP-109), checked against the screens children actually see:
// the world HUD (world/strings.ts) and the frame menu (frame/strings.ts). The old HudOverlay/GameCanvas
// prototypes were never mounted by App.tsx and were retired; world/engine.ts + world/hud.ts replaced them.
import { describe, expect, it } from 'vitest';
import { FORBIDDEN_PLAYER_UI_PATTERNS, calculateDialogBoxHeightPx } from '@lcw/ui';
import { WORLD_STRINGS, BAND_NAMES_KO, SCENE_TITLES_KO } from '../world/strings.js';
import { FRAME_STRINGS } from '../frame/strings.js';

const PRICE = /[0-9,]+\s*원|결제|할인|구독|만료/;

describe('apps/client child screens (WP-109)', () => {
  it('fits the dialog layout within 720px at 100% and 150% font scale', () => {
    expect(calculateDialogBoxHeightPx(1.0)).toBeLessThanOrEqual(720);
    expect(calculateDialogBoxHeightPx(1.5)).toBeLessThanOrEqual(720);
  });

  it('keeps blame, pricing and payment words off the world HUD and the menu', () => {
    const copy = JSON.stringify([WORLD_STRINGS, BAND_NAMES_KO, SCENE_TITLES_KO, FRAME_STRINGS]);
    for (const pattern of FORBIDDEN_PLAYER_UI_PATTERNS) expect(copy).not.toContain(pattern);
    expect(PRICE.test(copy)).toBe(false);
  });
});
