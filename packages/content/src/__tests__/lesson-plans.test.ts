import { describe, expect, it } from 'vitest';
import { FIRST_LESSON_PLAN, getLessonNpc, getLessonPlan, LESSON_PLANS, SECOND_LESSON_PLAN } from '../index.js';

// Who stands in each 3D scene (apps/client/src/world/town.ts SCENES): a stage's NPC must be the one the world spawns there.
const SCENE_NPC: Record<string, string> = {
  plaza: 'guide',
  honey_cafe: 'cafe_owner',
  trade_shop: 'shop_owner',
  build_plot: 'guide',
  open_hill: 'guide'
};

describe('lesson plans', () => {
  it('are in teaching order with unique ids', () => {
    expect(LESSON_PLANS.map((p) => p.id)).toEqual(['first_lesson_v1', 'second_lesson_v1']);
    expect(getLessonPlan('second_lesson_v1')).toBe(SECOND_LESSON_PLAN);
    expect(getLessonPlan('nope')).toBe(FIRST_LESSON_PLAN);
  });

  for (const plan of LESSON_PLANS) {
    describe(plan.id, () => {
      it('stages add up, are ordered and unique', () => {
        expect(plan.stages.reduce((a, s) => a + s.minutes, 0)).toBe(plan.totalMinutes);
        expect(plan.stages.map((s) => s.order)).toEqual(plan.stages.map((_, i) => i + 1));
        expect(new Set(plan.stages.map((s) => s.id)).size).toBe(plan.stages.length);
      });

      it('every stage happens where its NPC stands', () => {
        for (const s of plan.stages) {
          expect(getLessonNpc(s.npcId), s.id).toBeDefined();
          expect(SCENE_NPC[s.sceneId], s.id).toBe(s.npcId);
        }
      });

      it('targets are scorable: core tags in the sentence, stars rise, no prices or deadlines in the child goal', () => {
        for (const s of plan.stages) {
          expect(s.targets.length, s.id).toBeGreaterThan(0);
          const stars = s.targets.map((t) => t.stars);
          expect([...stars].sort(), s.id).toEqual(stars);
          for (const t of s.targets) {
            expect(/[가-힣]/.test(t.text), t.text).toBe(false);
            expect(t.hintTags.length, t.text).toBeGreaterThan(0);
            for (const tag of t.hintTags) expect(t.text.toLowerCase(), tag).toContain(tag);
          }
          expect(/\d+\s*(원|코인|분|시|일)/.test(s.studentGoalKo), s.id).toBe(false);
        }
      });
    });
  }

  it('a sentence keeps its star count across plans (the console looks stars up by text)', () => {
    const known = new Map<string, number>();
    for (const p of LESSON_PLANS)
      for (const s of p.stages)
        for (const t of s.targets) {
          expect(known.get(t.text) ?? t.stars, t.text).toBe(t.stars);
          known.set(t.text, t.stars);
        }
  });

  it("the second lesson opens with the first lesson's sentences, without hints, and builds the promised shop", () => {
    const first = new Set(FIRST_LESSON_PLAN.stages.flatMap((s) => s.targets.map((t) => t.text)));
    const open = SECOND_LESSON_PLAN.stages[0]!;
    expect(open.mode).toBe('recall');
    expect(open.hint).toBe('initial');
    for (const t of open.targets) expect(first.has(t.text), t.text).toBe(true);
    expect(SECOND_LESSON_PLAN.stages.some((s) => s.sceneId === 'build_plot')).toBe(true);
  });
});
