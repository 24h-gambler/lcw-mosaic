import { describe, expect, it } from 'vitest';
import { ANSWER_BOX, pressZ } from '../ui/zkey.js';

/**
 * R2861 (Dan 11-23 "Z must not skip the English; with the microphone off Z goes to the answer box") with R2734
 * ("Z never stalls"): the order of what one Z press does, without a browser.
 */

type Fake = { tagName: string; disabled?: boolean; clicked: number; focused: number; testid?: string; closest: (s: string) => unknown; click: () => void; focus: () => void };
const el = (tagName: string, extra: Partial<Fake> = {}): Fake => {
  const e: Fake = {
    tagName,
    clicked: 0,
    focused: 0,
    closest: (s: string) => (s === '.adv-panel' ? {} : null),
    click: () => void (e.clicked += 1),
    focus: () => void (e.focused += 1),
    ...extra
  };
  return e;
};
const doc = (active: unknown, primary: Fake[], boxes: Fake[]) => ({
  activeElement: active,
  querySelectorAll: (s: string) => (s === '.adv-panel [data-primary]' ? primary : s === ANSWER_BOX ? boxes : [])
});
const engine = (handled: boolean) => ({ confirm: () => handled });

describe('R2861 Z: never a skip, never a stall', () => {
  it('the engine step comes first', () => {
    const p = el('BUTTON');
    expect(pressZ(engine(true), doc(null, [p], []))).toBe('engine');
    expect(p.clicked).toBe(0);
  });

  it('a "say it" talk with the microphone off: no default button, Z puts the cursor in the answer box', () => {
    const box = el('INPUT');
    expect(pressZ(engine(false), doc(null, [], [box]))).toBe('answer');
    expect(box.focused).toBe(1);
  });

  it('already typing in the box: Enter in an empty box does nothing more (no skip, no turn)', () => {
    const box = el('INPUT');
    expect(pressZ(engine(false), doc(box, [], [box]))).toBe('none');
    expect(box.focused).toBe(0);
  });

  it('the class-code box of the join form is not the answer box', () => {
    expect(ANSWER_BOX).toContain(':not([data-testid="adv-join-code"])');
  });

  it('a default button (e.g. Next after a passed answer) is pressed; a disabled one is not', () => {
    const off = el('BUTTON', { disabled: true });
    const next = el('BUTTON');
    expect(pressZ(engine(false), doc(null, [off, next], []))).toBe('primary');
    expect(off.clicked).toBe(0);
    expect(next.clicked).toBe(1);
  });

  it('a focused panel button is pressed before the default one', () => {
    const f = el('BUTTON');
    const p = el('BUTTON');
    expect(pressZ(engine(false), doc(f, [p], []))).toBe('focused');
    expect([f.clicked, p.clicked]).toEqual([1, 0]);
  });
});
