/**
 * What Z (and Enter in an empty answer box) does, in order (R2734 "Z never stalls", R2861 "Z never skips English"):
 *   1. the engine's own step (menus, lists, a passed talk's Next)
 *   2. the panel button the child already has focus on
 *   3. the panel's one default button (data-primary) — never a skip: the talk panel has none that passes
 *   4. no default button (a "say it" talk with the microphone off): the answer box gets focus, so the next keys type
 * Duck-typed (tagName, disabled) so the order is tested without a browser.
 */
type El = { tagName: string; disabled?: boolean; closest?: (s: string) => unknown; click?: () => void; focus?: () => void };
type Doc = { activeElement: unknown; querySelectorAll: (s: string) => ArrayLike<unknown> };

/** The answer box (say/spell talks) — not the class-code box of the join form. */
export const ANSWER_BOX = '.adv-panel input:not([data-testid="adv-join-code"])';

export type ZAction = 'engine' | 'focused' | 'primary' | 'answer' | 'none';

export function pressZ(engine: { confirm(): boolean }, doc: Doc): ZAction {
  if (engine.confirm()) return 'engine';
  const f = doc.activeElement as El | null;
  if (f && f.tagName === 'BUTTON' && !f.disabled && f.closest?.('.adv-panel')) {
    f.click?.();
    return 'focused';
  }
  const primary = (Array.from(doc.querySelectorAll('.adv-panel [data-primary]')) as El[]).find((b) => !b.disabled);
  if (primary) {
    primary.click?.();
    return 'primary';
  }
  const box = (Array.from(doc.querySelectorAll(ANSWER_BOX)) as El[]).find((b) => !b.disabled);
  if (box && box !== f) {
    box.focus?.();
    return 'answer';
  }
  return 'none';
}
