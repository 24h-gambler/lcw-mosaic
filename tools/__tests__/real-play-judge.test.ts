// The nightly real-play judgement (tools/real-play-judge.mjs): a clean production run gives no regression, each broken
// promise gives one entry in the nightly-audit regression shape, and cached-only voice 404s are not errors.
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs tools without types
import { judgeView, playLines, playNotRun, playRegressions } from '../real-play-judge.mjs';
// @ts-expect-error plain .mjs tools without types
import { mergePlay, playBudget } from '../nightly-audit.mjs';

/** The shape of a clean 11-18 production run (0cc5ffa, pc). */
const clean = () => ({
  view: 'pc',
  size: '1440x900',
  unwantedJumps: 0,
  jumpView: [
    { bodyRise: 0.86, camRise: 0.13 },
    { bodyRise: 1.11, camRise: 0.17 }
  ],
  clickSuccess: '7/7',
  keySuccess: '7/7',
  wrongNpc: 0,
  errand: { status: 200, state: 'done' },
  hill: { ran: true, tries: 1, reachedTop: true, topY: 10, pressedJumpsUp: 0, unwantedJumpsUp: 0, autoClimbsUp: 0 },
  lesson: {
    started: true,
    dialogOpened: true,
    reopenByClick: true,
    reopenByKey: true,
    passer: { id: 'cafe_owner', ok: true, prompt: false, dialogOpened: false, quietTaps: 2, stillFolded: true, faced: true }
  },
  errs: [],
  ttsCacheMiss: 10,
  seconds: 290
});

describe('real-play judgement for the nightly audit', () => {
  it('a clean run has no finding, and the cached-only voice 404s do not count', () => {
    expect(judgeView(clean())).toEqual([]);
    expect(playRegressions({ pc: clean(), touch: { ...clean(), view: 'touch' } })).toEqual([]);
    expect(playLines({ pc: clean() })[0]).toContain('캐시 전용 음성 404 10');
  });

  it('each broken promise is one regression with the sizes it showed on', () => {
    const bad = clean();
    bad.unwantedJumps = 2;
    bad.keySuccess = '6/7';
    bad.jumpView = [{ bodyRise: 1.2, camRise: 1.1 }];
    bad.hill = { ...bad.hill, reachedTop: false, topY: 1, tries: 3 };
    bad.lesson.passer = { ...bad.lesson.passer, ok: false, dialogOpened: true };
    bad.errs = ['http 500 lcw.worldwidesomething.com/v1/errand'];
    const regs = playRegressions({ pc: bad, touch: clean() });
    expect(regs.map((r: { id: string }) => r.id).sort()).toEqual(
      ['play:hill', 'play:jump-view', 'play:key-talk', 'play:lesson-passer', 'play:page-errors', 'play:unwanted-jumps'].sort()
    );
    for (const r of regs) {
      expect(r.route).toBe('/world/');
      expect(r.sizes).toEqual(['1440x900']);
      expect(r.why[0].startsWith('pc: ')).toBe(true);
    }
  });

  it('a run that did not finish is "not checked", never a regression; a run that never tried a talk is a regression', () => {
    expect(playRegressions({ pc: null })).toEqual([]);
    expect(playNotRun({ pc: null, touch: clean() }, { pc: { killed: true, code: null } })).toEqual([{ view: 'pc', why: '시간 한도에 멈춤' }]);
    expect(playNotRun({ pc: null, touch: clean() }, { pc: { killed: false, code: 3, stalledAfter: 'browser' } })[0].why).toContain("'browser' 다음 단계");
    expect(playNotRun({ touch: null }, { touch: { killed: false, code: 1 } })).toEqual([{ view: 'touch', why: '보고서 없음(종료 코드 1)' }]);
    expect(playLines({ pc: null })[0]).toContain('확인 안 됨');
    const none = { ...clean(), clickSuccess: '0/0' };
    expect(judgeView(none).map((x: { id: string }) => x.id)).toEqual(['play:click-talk']);
  });

  it('a passer-by the bot could not get on screen is not checked, not a failure', () => {
    const r = clean();
    r.lesson.passer = { ...r.lesson.passer, faced: false, ok: null };
    expect(judgeView(r)).toEqual([]);
    expect(playLines({ pc: r })[0]).toContain('확인 안 됨(화면에 못 잡음)');
  });

  it('a hill walk that never got down to the ramp is not checked; one that got down and not up is a regression', () => {
    const r = clean();
    r.hill = { ...r.hill, reachedBottom: false, reachedTop: false, topY: 10 } as typeof r.hill;
    expect(judgeView(r)).toEqual([]);
    expect(playLines({ pc: r })[0]).toContain('언덕 확인 안 됨');
    r.hill = { ...r.hill, reachedBottom: true, reachedTop: false, topY: 1 } as typeof r.hill;
    expect(judgeView(r).map((x: { id: string }) => x.id)).toEqual(['play:hill']);
  });

  it('a lesson reopen the bot could not try (NPC never on screen) is not checked', () => {
    const r = clean();
    r.lesson = { ...r.lesson, reopenByClick: null, reopenByKey: null } as typeof r.lesson;
    expect(judgeView(r)).toEqual([]);
    expect(playLines({ pc: r })[0]).toContain('클릭 확인 안 됨');
    r.lesson = { ...r.lesson, reopenByClick: false } as typeof r.lesson;
    expect(judgeView(r).map((x: { id: string }) => x.id)).toEqual(['play:lesson-reopen']);
  });

  it('an NPC the scene did not draw is a regression; one drawn that the bot missed leaves zero talks not checked', () => {
    const drawn = { inScene: true, shown: true, meshes: 12, x: 167.5, y: 1, z: 134.5, dist: 9 };
    const miss = (d: object | null) => ({ id: 'cafe_owner', step: 'talk', sceneKnown: true, drawn: d });
    const r = { ...clean(), clickSuccess: '0/0', keySuccess: '0/0', faceMisses: [miss(drawn)] };
    expect(judgeView(r)).toEqual([]);
    expect(playLines({ pc: r })[0]).toContain('0/0 확인 안 됨(NPC 는 그려져 있고 봇이 화면에 못 잡음)');
    const hidden = { ...r, faceMisses: [miss({ ...drawn, shown: false })] };
    expect(judgeView(hidden).map((x: { id: string }) => x.id)).toEqual(['play:npc-not-drawn', 'play:click-talk', 'play:key-talk']);
    expect(judgeView({ ...r, faceMisses: [miss(null)] })[0].why).toContain('cafe_owner(씬에 없음)');
    expect(judgeView({ ...r, faceMisses: [miss({ ...drawn, meshes: 0 })] })[0].why).toContain('메시 0');
    // a page from before the scene graph was read cannot tell: zero talks stay a regression
    expect(judgeView({ ...r, faceMisses: [{ id: 'cafe_owner', sceneKnown: false, drawn: null }] }).map((x: { id: string }) => x.id)).toEqual(['play:click-talk', 'play:key-talk']);
    // the view never turned on a drag, or the world was paused / a dialog open: the page's fault, never "not checked"
    const noTurn = { ...r, faceMisses: [{ ...miss(drawn), turned: false, turns: 15 }] };
    expect(judgeView(noTurn).map((x: { id: string }) => x.id)).toEqual(['play:look-input', 'play:click-talk', 'play:key-talk']);
    expect(judgeView({ ...r, faceMisses: [{ ...miss(drawn), turned: true, dlg: true }] }).map((x: { id: string }) => x.id)).toEqual(['play:click-talk', 'play:key-talk']);
    expect(judgeView({ ...r, faceMisses: [{ ...miss(drawn), turned: true, paused: true }] }).map((x: { id: string }) => x.id)).toEqual(['play:click-talk', 'play:key-talk']);
    expect(judgeView({ ...r, faceMisses: [{ ...miss(drawn), turned: true, turns: 15 }] })).toEqual([]);
    // a drawn NPC missed on one talk does not hide the talks that were tried
    expect(judgeView({ ...clean(), clickSuccess: '5/6', faceMisses: [miss(drawn)] }).map((x: { id: string }) => x.id)).toEqual(['play:click-talk']);
  });

  it('a short night skips the play so the screens keep their time', () => {
    expect(playBudget(10 * 60000)).toBe(0);
    expect(playBudget(40 * 60000)).toBe(24 * 60000);
    expect(playBudget(20 * 60000)).toBe(12 * 60000);
  });

  it('merges into the audit report: regressions, the play section and the summary lines', () => {
    const rep = { regressions: [{ id: 'X1', owner: 'site', route: '/', sizes: ['d'], why: ['HTTP 500'] }] };
    const bad = { ...clean(), wrongNpc: 1 };
    const merged = mergePlay(rep, { pc: bad, touch: null }, { seconds: 600 }, { touch: { killed: true, code: null } });
    expect(merged.regressions.map((r: { id: string }) => r.id)).toEqual(['X1', 'play:wrong-npc']);
    expect(merged.play.lines).toHaveLength(2);
    expect(merged.play.seconds).toBe(600);
    expect(merged.play.notRun).toEqual([{ view: 'touch', why: '시간 한도에 멈춤' }]);
  });
});
