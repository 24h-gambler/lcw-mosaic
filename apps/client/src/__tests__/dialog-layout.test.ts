import { describe, expect, it } from 'vitest';
import { dialogViewInset } from '../App.js';
import { DIALOG_CSS } from '../dialog/styles.js';

describe('dialog window layout and the world inset (outsider capture 11-16: 844x390 covered the whole world)', () => {
  it('a landscape side panel reports its width as the right inset', () => {
    expect(dialogViewInset({ left: 338, top: 0, width: 506, height: 390 }, 844, 390)).toEqual({ bottom: 0, right: 506 });
  });

  it('a portrait bottom sheet and a desktop window report the covered bottom', () => {
    expect(dialogViewInset({ left: 0, top: 300, width: 390, height: 544 }, 390, 844)).toEqual({ bottom: 544, right: 0 });
    expect(dialogViewInset({ left: 180, top: 520, width: 1080, height: 368 }, 1440, 900)).toEqual({ bottom: 380, right: 0 });
  });

  it('the stylesheet turns the window into a right side panel on low landscape screens', () => {
    const block = DIALOG_CSS.slice(DIALOG_CSS.indexOf('@media (orientation:landscape) and (max-height:520px){'));
    expect(block).toMatch(/\.lcw-dlg__win\{width:min\(60vw,600px\);height:100%/);
    expect(block).toMatch(/\.lcw-dlg__preview\{display:none\}/);
  });
});
