import { describe, expect, it } from 'vitest';
import { FORBIDDEN_PLAYER_UI_PATTERNS } from '@lcw/ui';
import { LESSON_STRINGS_EN, LESSON_STRINGS_KO } from '../lesson/strings.js';

const leaves = (o: unknown, path = ''): Array<[string, unknown]> =>
  typeof o === 'object' && o !== null ? Object.entries(o).flatMap(([k, v]) => leaves(v, path ? `${path}.${k}` : k)) : [[path, o]];

describe('lesson copy in English (the world speaks the language the child learns)', () => {
  it('has every key the Korean copy has, and no Korean in it', () => {
    expect(leaves(LESSON_STRINGS_EN).map(([k]) => k).sort()).toEqual(leaves(LESSON_STRINGS_KO).map(([k]) => k).sort());
    const all = JSON.stringify(LESSON_STRINGS_EN) + LESSON_STRINGS_EN.status.ok('Oreo', 'Dan') + LESSON_STRINGS_EN.ended.today(3);
    expect(all).not.toMatch(/[가-힣]/);
    for (const bad of FORBIDDEN_PLAYER_UI_PATTERNS) expect(all).not.toContain(bad);
    expect(all).not.toMatch(/price|pay|won|₩/i);
  });

  it('every button a child presses carries an icon', () => {
    const S = LESSON_STRINGS_EN;
    for (const b of [S.code.enter, S.code.cancel, S.status.leave, S.status.leaveYes, S.status.leaveNo, S.speak.mic, S.speak.micStop, S.speak.typeInstead, S.speak.send])
      expect(b).toMatch(/^\p{Extended_Pictographic}/u);
  });

  it("names the teacher like the world's chip ('👩‍🏫 With Dan'), 'Teacher' when no name", () => {
    expect(LESSON_STRINGS_EN.status.ok('Oreo', 'Dan')).toBe('Oreo · 👩‍🏫 With Dan');
    expect(LESSON_STRINGS_EN.status.ok('', null)).toBe('👩‍🏫 With Teacher');
  });
});

describe('the lesson layer reads the language the child learns, Korean only as the help line', () => {
  it('English by default; with the Korean help on, the Korean follows after a dot (nested keys and functions too)', async () => {
    const { LESSON_STRINGS } = await import('../lesson/strings.js');
    const { setHelpKo, resetLangForTest } = await import('../world/lang.js');
    resetLangForTest();
    expect(LESSON_STRINGS.code.title).toBe(LESSON_STRINGS_EN.code.title);
    expect(LESSON_STRINGS.status.ok('Oreo', 'Dan')).toBe('Oreo · 👩‍🏫 With Dan');
    expect(LESSON_STRINGS.code.errors.invalid_code).toBe(LESSON_STRINGS_EN.code.errors.invalid_code);
    setHelpKo(true);
    expect(LESSON_STRINGS.ended.title).toBe(`${LESSON_STRINGS_EN.ended.title} · ${LESSON_STRINGS_KO.ended.title}`);
    expect(LESSON_STRINGS.status.ok('Oreo', 'Dan')).toBe('Oreo · 👩‍🏫 With Dan · Dan 선생님과 함께');
    expect(LESSON_STRINGS.code.errors.network).toContain(LESSON_STRINGS_KO.code.errors.network);
    expect(LESSON_STRINGS.code.errors.nope).toBeUndefined();
    resetLangForTest();
  });
});
