import { afterEach, describe, expect, it } from 'vitest';
import { UI_STRINGS_EN, UI_STRINGS_KO } from '@lcw/content';
import { biLine, feedbackLine, helpKo, live, ui } from '../dialog/strings.js';
import { GOALS, goalLine, goalToast, goalWalkLabel } from '../dialog/goals.js';
import { errandGoalKo, type ErrandView } from '../dialog/errand.js';
import { resetLangForTest, setHelpKo } from '../world/lang.js';

/** Dan 11-16: the dialog speaks the language the child learns; Korean only as the help line when it is on. */
describe('dialog strings in the learning language', () => {
  afterEach(() => resetLangForTest());

  it('goal line, walk button and goal toasts: English, and "English · 한국어" with the help on (R2627 frame audit)', () => {
    expect(goalLine(GOALS.ask_way)).toBe('Ask Luna in the plaza the way to the trade shop');
    expect(goalWalkLabel(GOALS.ask_way)).toBe('🦊 Go to Luna');
    expect(goalToast('goalStepToast')).toBe(UI_STRINGS_EN.firstVisit.goalStepToast);
    setHelpKo(true);
    expect(goalLine(GOALS.ask_way)).toBe('Ask Luna in the plaza the way to the trade shop · 광장의 루나에게 교환 상점 가는 길을 물어봐요');
    expect(goalWalkLabel(GOALS.ask_way)).toBe('🦊 Go to Luna · 루나에게 가기');
    expect(goalToast('goalTourDone')).toBe(`${UI_STRINGS_EN.firstVisit.goalTourDone} · ${UI_STRINGS_KO.firstVisit.goalTourDone}`);
    const offered = errandGoalKo({ state: 'offered', item_ko: '꿀차' } as ErrandView);
    expect(offered.startsWith('Go talk to your neighbor Mia in front of the cafe · ')).toBe(true);
    expect(offered).toContain('미아');
    expect(biLine((_l, t) => t.firstVisit.walkCafe)).toBe(`${UI_STRINGS_EN.firstVisit.walkCafe} · ${UI_STRINGS_KO.firstVisit.walkCafe}`);
    setHelpKo(false);
    expect(goalWalkLabel(GOALS.ask_way)).toBe('🦊 Go to Luna');
  });

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

  it("the server's own English line wins over the table (lesson feedback_en), the Korean as help only", () => {
    expect(feedbackLine('수업 고정 문장이에요', 'A lesson line')).toEqual({ text: 'A lesson line', help: null });
    setHelpKo(true);
    expect(feedbackLine('수업 고정 문장이에요', 'A lesson line')).toEqual({ text: 'A lesson line', help: '수업 고정 문장이에요' });
    setHelpKo(false);
    expect(feedbackLine(UI_STRINGS_KO.dialog.feedback.pass, '')).toEqual({ text: UI_STRINGS_EN.dialog.feedback.pass, help: null });
  });

  it('read-aloud and review lines from the server come out in English, values included', () => {
    const R = UI_STRINGS_KO.readAloud;
    expect(feedbackLine(R.voiceOnly).text).toBe(UI_STRINGS_EN.readAloud.voiceOnly);
    expect(feedbackLine(R.again).text).toBe(UI_STRINGS_EN.readAloud.again);
    expect(feedbackLine(R.got.replace('{kind}', R.kind.light!).replace('{pct}', '10')).text).toBe('Great reading! Today, light furniture is 10% off.');
    expect(feedbackLine(R.already.replace('{kind}', R.kind.flat!)).text).toBe(UI_STRINGS_EN.readAloud.already.replace('{kind}', 'table'));
    const V = UI_STRINGS_KO.review;
    expect(feedbackLine(V.notDue).text).toBe(UI_STRINGS_EN.review.notDue);
    expect(feedbackLine(V.again).text).toBe(UI_STRINGS_EN.review.again);
    expect(feedbackLine(V.fixed.replace('{when}', '내일')).text).toBe('Fixed! Next check: tomorrow.');
    expect(feedbackLine(V.fixed.replace('{when}', '20분 뒤')).text).toBe('Fixed! Next check: in 20 minutes.');
    expect(feedbackLine(V.mastered.replace('{n}', '30')).text).toBe(UI_STRINGS_EN.review.mastered.replace('{n}', '30'));
    // every line the server can send has no Hangul once mapped
    for (const t of [R.voiceOnly, R.again, V.notDue, V.again, ...Object.values(UI_STRINGS_KO.dialog.feedback)]) {
      expect(feedbackLine(t.replace('{p}', 'so that')).text).not.toMatch(/[가-힣]/);
    }
  });
});
