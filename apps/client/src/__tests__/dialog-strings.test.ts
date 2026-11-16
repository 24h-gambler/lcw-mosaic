import { afterEach, describe, expect, it } from 'vitest';
import { UI_STRINGS_EN, UI_STRINGS_KO } from '@lcw/content';
import { feedbackLine, helpKo, live, ui } from '../dialog/strings.js';
import { resetLangForTest, setHelpKo } from '../world/lang.js';

/** Dan 11-16: the dialog speaks the language the child learns; Korean only as the help line when it is on. */
describe('dialog strings in the learning language', () => {
  afterEach(() => resetLangForTest());

  it('English tables by default, with the same keys as the Korean ones', () => {
    expect(ui()).toBe(UI_STRINGS_EN);
    expect(live('dialog').chooseTitle).toBe('Pick a sentence to say');
    const keys = (o: object): string[] => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? keys(v).map((x) => `${k}.${x}`) : [k]));
    expect(keys(UI_STRINGS_EN).sort()).toEqual(keys(UI_STRINGS_KO).sort());
  });

  it('feedback from the grader (Korean) shows in English, the Korean under it only with the help on', () => {
    const f = UI_STRINGS_KO.dialog.feedback;
    expect(feedbackLine(f.perfect)).toEqual({ text: 'Perfect! 3 stars!', help: null });
    expect(feedbackLine(f.coreMissedPhrase.replace('{p}', 'so that'))).toEqual({ text: "Good idea! Can you add 'so that'?", help: null });
    expect(feedbackLine('알 수 없는 줄').text).toBe('알 수 없는 줄');
    setHelpKo(true);
    expect(feedbackLine(f.almost)).toEqual({ text: UI_STRINGS_EN.dialog.feedback.almost, help: f.almost });
    expect(helpKo('말하고 싶은 문장을 골라요', 'Pick a sentence to say')).toBe('말하고 싶은 문장을 골라요');
    setHelpKo(false);
    expect(helpKo('말하고 싶은 문장을 골라요', 'Pick a sentence to say')).toBeNull();
  });
});
