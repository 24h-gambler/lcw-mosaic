import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { FIRST_ERRAND, NPC_GENERIC_REACTIONS, NPC_OPENING_LINES, NPC_REVISIT_LINES, OPEN_ENDED_PROMPTS, UI_STRINGS_KO, fixedTtsLines } from '@lcw/content';
import { GOAL_CHAIN, currentGoal, goalLine, noteSoloResult, onGoalChange, resetGoalsForTest } from '../dialog/goals.js';
import {
  createOpenAnswerScorer,
  nextOpeningLine,
  noteSoloDone,
  openingLineFor,
  resetNpcLinesForTest,
  soloTalkPlan
} from '../dialog/npc-lines.js';
import { createPracticeSubmit } from '../dialog/submit.js';
import type { NpcRef, UtteranceSubmit } from '../dialog/types.js';

/**
 * R2625 (Dan 11-16, real lesson with Oreo): "계속 반복되는 말만 나와서 게임 자체가 진행이 아예 안됐고요". The dialog side:
 * NPCs say something new when visited again, a passed talk moves a goal, and after the errand there is a next goal.
 */

beforeAll(() => {
  const m = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear()
  };
});

afterEach(() => {
  resetGoalsForTest();
  resetNpcLinesForTest();
});

const LUNA: NpcRef = { id: 'guide', ctx: 'guide', nameKo: '루나', nameEn: 'Luna' };
const HANNAH: NpcRef = { id: 'cafe_owner', ctx: 'cafe', nameKo: '해나', nameEn: 'Hannah' };
const utter = (transcript: string, target = ''): UtteranceSubmit => ({
  target_text: target,
  transcript,
  chosen_stars: 1,
  hint_level: 'full',
  latency_ms: 0,
  dur_ms: 1000,
  stt_source: 'keyboard',
  confidence: 1
});

describe('NPC lines visit by visit (R2625)', () => {
  it('the first visit hears the greeting, later visits go round new lines and never repeat back to back', () => {
    const lines = Array.from({ length: 7 }, () => nextOpeningLine('cafe_owner', 'cafe'));
    expect(lines[0]).toBe(NPC_OPENING_LINES.cafe);
    expect(lines.slice(1, 4)).toEqual([...NPC_REVISIT_LINES.cafe!]);
    for (let i = 1; i < lines.length; i++) expect(lines[i]).not.toBe(lines[i - 1]);
    // each NPC counts its own visits
    expect(nextOpeningLine('shop_owner', 'trade_shop')).toBe(NPC_OPENING_LINES.trade_shop);
    expect(openingLineFor('nobody', 3)).toBe(NPC_OPENING_LINES.guide);
  });

  it('every revisit line is a fixed neural-voice line in its NPC voice', () => {
    const fixed = new Set(fixedTtsLines().map((l) => l.text));
    for (const lines of Object.values(NPC_REVISIT_LINES)) for (const l of lines) expect(fixed.has(l)).toBe(true);
  });

  it('every fifth passed talk the NPC asks one open question after the pass (docs/04 4.10)', () => {
    const asked: Array<string | undefined> = [];
    for (let i = 0; i < 10; i++) {
      const plan = soloTalkPlan(HANNAH, 'L1');
      asked.push(plan.followUps?.[0]);
      noteSoloDone('cafe', { pass: true, stars: 2 });
    }
    expect(asked.filter(Boolean)).toEqual([OPEN_ENDED_PROMPTS[0], OPEN_ENDED_PROMPTS[1]]);
    expect(asked[4]).toBe(OPEN_ENDED_PROMPTS[0]);
    expect(asked[9]).toBe(OPEN_ENDED_PROMPTS[1]);
    // a missed talk does not count
    const before = soloTalkPlan(HANNAH, 'L1').followUps;
    noteSoloDone('cafe', { pass: false, stars: 0 });
    expect(soloTalkPlan(HANNAH, 'L1').followUps).toEqual(before);
  });

  it('the open answer is scored on the device: no coins, no item, a reaction in English and a Korean help line', async () => {
    const score = createOpenAnswerScorer('cafe', 'L1');
    const short = await score(utter('yes'));
    expect(short).toMatchObject({ pass: false, stars: 0, feedbackKo: UI_STRINGS_KO.dialog.openAnswerShort });
    const ok = await score(utter('because I am thirsty'));
    expect(ok.pass).toBe(true);
    expect(ok.stars).toBeGreaterThanOrEqual(1);
    expect(NPC_GENERIC_REACTIONS).toContain(ok.feedbackEn);
    expect(ok.coinsTotal).toBeUndefined();
    expect(ok.itemKey).toBeUndefined();
  });
});

describe('town goals after the errand (R2625)', () => {
  it('ask Luna the way -> trade with Toby -> order with ★★ or better at the cafe, each moved only by a passed talk with that NPC', () => {
    const seen: Array<[string | null, string | null]> = [];
    const off = onGoalChange((g, done) => seen.push([g?.id ?? null, done]));
    expect(currentGoal()?.id).toBe('ask_way');
    expect(noteSoloResult('cafe', { pass: true, stars: 3 })).toBeNull(); // not this step's NPC
    expect(noteSoloResult('guide', { pass: false, stars: 0 })).toBeNull(); // a miss
    expect(noteSoloResult('guide', { pass: true, stars: 1 })).toBe('ask_way');
    expect(currentGoal()?.id).toBe('trade');
    expect(noteSoloResult('trade_shop', { pass: true, stars: 1 })).toBe('trade');
    expect(noteSoloResult('cafe', { pass: true, stars: 1 })).toBeNull(); // ★★ needed
    expect(noteSoloResult('cafe', { pass: true, stars: 2 })).toBe('cafe_stars');
    expect(currentGoal()).toBeNull();
    expect(seen).toEqual([
      ['trade', 'ask_way'],
      ['cafe_stars', 'trade'],
      [null, 'cafe_stars']
    ]);
    off();
    expect(GOAL_CHAIN).toHaveLength(3);
  });

  it('under "ask the way to the trade shop" the guide offers that place (first run offered the cafe), then her usual bank', () => {
    const asks = soloTalkPlan(LUNA, 'L1').offers!.map((o) => o.text);
    expect(asks.every((t) => /trade shop/i.test(t))).toBe(true);
    noteSoloDone('guide', { pass: true, stars: 1 });
    expect(soloTalkPlan(LUNA, 'L1').offers).toBeUndefined();
  });

  it('noteSoloDone moves the chain like the App does after a window closes', () => {
    noteSoloDone('guide', { pass: true, stars: 2 });
    expect(currentGoal()?.id).toBe('trade');
  });

  it('the goal line names the cast in the learn language (English: Luna, Toby, Hannah)', () => {
    expect(goalLine(currentGoal()!)).toContain('Luna');
  });

  it('a guest asking the way on the device is walked there too (practice result carries the place)', async () => {
    const r = await createPracticeSubmit(LUNA, 'L1')(utter('Where is the trade shop?', 'Where is the trade shop?'));
    expect(r.pass).toBe(true);
    expect(r.askedKey).toBe('trade_shop');
    expect(r.practice).toBe(true);
  });

  it('the errand ask is never a revisit line', () => {
    expect(NPC_REVISIT_LINES.errand).not.toContain(FIRST_ERRAND.lines.ask);
  });
});
