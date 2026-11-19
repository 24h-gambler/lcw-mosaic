import { describe, expect, it } from 'vitest';
import { dialogViewInset } from '../App.js';
import { DIALOG_CSS } from '../dialog/styles.js';

describe('dialog window layout and the world inset (outsider capture 11-16: 844x390 covered the whole world)', () => {
  it('a landscape side panel reports its width as the right inset', () => {
    expect(dialogViewInset({ left: 338, top: 0, width: 506, height: 390 }, 844, 390)).toEqual({ bottom: 0, right: 506 });
    // under the star/coin chip (52px down on a 390px-high screen: 338 tall), still a side panel
    expect(dialogViewInset({ left: 338, top: 52, width: 506, height: 338 }, 844, 390)).toEqual({ bottom: 0, right: 506 });
    expect(dialogViewInset({ left: 312, top: 56, width: 600, height: 464 }, 912, 520)).toEqual({ bottom: 0, right: 600 });
  });

  it('R326: on a desktop the window is a right info panel with no dim layer, and reports a right inset', () => {
    const block = DIALOG_CSS.slice(DIALOG_CSS.indexOf('@media (min-width:761px) and (min-height:521px){'));
    expect(block).toMatch(/\.lcw-dlg\{background:transparent;align-items:stretch;justify-content:flex-end;padding:64px 12px 12px\}/);
    expect(block).toMatch(/\.lcw-dlg__win\{width:min\(440px,38vw\);height:100%/);
    expect(dialogViewInset({ left: 828, top: 64, width: 440, height: 724 }, 1280, 800)).toEqual({ bottom: 0, right: 452 });
  });

  it('a portrait bottom sheet and a short wide window report the covered bottom', () => {
    expect(dialogViewInset({ left: 0, top: 300, width: 390, height: 544 }, 390, 844)).toEqual({ bottom: 544, right: 0 });
    expect(dialogViewInset({ left: 180, top: 520, width: 1080, height: 368 }, 1440, 900)).toEqual({ bottom: 380, right: 0 });
  });

  it('the stylesheet turns the window into a right side panel on low landscape screens', () => {
    const block = DIALOG_CSS.slice(DIALOG_CSS.indexOf('@media (orientation:landscape) and (max-height:520px){'));
    // R326: narrower, so the world keeps most of the screen
    expect(block).toMatch(/\.lcw-dlg__win\{width:min\(52vw,560px\);height:100%/);
    expect(block).toMatch(/\.lcw-dlg__preview\{display:none\}/);
    // starts under the HUD star/coin chip (lesson lane 11-16: the 🔊 covered it on 844x390)
    expect(block).toMatch(/\.lcw-dlg\{padding:56px 0 0;/);
  });
});
