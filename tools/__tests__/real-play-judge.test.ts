// The nightly real-play judgement (tools/real-play-judge.mjs): a clean production run gives no regression, each broken
// promise gives one entry in the nightly-audit regression shape, and cached-only voice 404s are not errors.
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs tools without types
import { judgeView, playLines, playRegressions } from '../real-play-judge.mjs';
// @ts-expect-error plain .mjs tools without types
import { mergePlay } from '../nightly-audit.mjs';

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

  it('a run that did not finish, or never tried a talk, is a regression and not a pass', () => {
    expect(playRegressions({ pc: null })).toEqual([{ id: 'play:not-run', owner: 'world', route: '/world/', sizes: ['1440x900'], why: ['pc: 실플레이 보고서 없음'] }]);
    const none = { ...clean(), clickSuccess: '0/0' };
    expect(judgeView(none).map((x: { id: string }) => x.id)).toEqual(['play:click-talk']);
  });

  it('merges into the audit report: regressions, the play section and the summary lines', () => {
    const rep = { regressions: [{ id: 'X1', owner: 'site', route: '/', sizes: ['d'], why: ['HTTP 500'] }] };
    const bad = { ...clean(), wrongNpc: 1 };
    const merged = mergePlay(rep, { pc: bad, touch: clean() }, { seconds: 600 });
    expect(merged.regressions.map((r: { id: string }) => r.id)).toEqual(['X1', 'play:wrong-npc']);
    expect(merged.play.lines).toHaveLength(2);
    expect(merged.play.seconds).toBe(600);
  });
});
