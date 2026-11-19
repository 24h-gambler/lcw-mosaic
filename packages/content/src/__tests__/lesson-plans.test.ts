import { describe, expect, it } from 'vitest';
import { ADVENTURE_STAGE_ID, FIRST_LESSON_PLAN, getLessonNpc, getLessonPlan, LESSON_DIRECTOR_EVENTS, LESSON_JOIN_CODE_SLOT, LESSON_PLANS, SECOND_LESSON_PLAN } from '../index.js';

// Who stands in each 3D scene (apps/client/src/world/town.ts SCENES): a stage's NPC must be the one the world spawns there.
const EVENT_KEYS: Record<string, string> = Object.fromEntries(LESSON_DIRECTOR_EVENTS.map((e) => [e.labelKo, e.hotkey]));

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

      it('every stage carries timed steps for the teacher and follow-up lines in English', () => {
        for (const s of plan.stages) {
          expect(s.stepsKo?.length ?? 0, s.id).toBeGreaterThanOrEqual(2);
          // steps walk the stage from 0 to its planned minutes
          expect(s.stepsKo![0], s.id).toMatch(/^0–\d+분 · /);
          expect(s.stepsKo!.at(-1), s.id).toMatch(new RegExp(`–${s.minutes}분 · `));
          for (const step of s.stepsKo!) expect(step.length, step).toBeLessThanOrEqual(110);
          expect(s.followUpsEn?.length ?? 0, s.id).toBeGreaterThanOrEqual(2);
          for (const line of s.followUpsEn!) expect(/[가-힣]/.test(line), line).toBe(false);
          // the hotkeys a step names are the real event keys (1 blizzard … 6 star celebration)
          for (const step of s.stepsKo!) {
            for (const m of step.matchAll(/「([^」]+)」\((\d)\)/g)) {
              expect(EVENT_KEYS[m[1]!], step).toBe(m[2]);
            }
          }
        }
      });

      it("ends with the adventure (R2625: … EC Play → LCW → adventure), after the wrap-up, with the report step there", () => {
        const last = plan.stages.at(-1)!;
        expect(last.id).toBe(ADVENTURE_STAGE_ID);
        expect(plan.stages.filter((s) => s.id === ADVENTURE_STAGE_ID)).toHaveLength(1);
        expect(plan.stages.at(-2)!.id).toBe('wrap_up');
        // the teacher sees the same-tab button and this lesson's code for a new tab; the child's goal points at the button
        expect(last.teacherGuideKo).toContain('🗺 모험');
        expect(last.teacherGuideKo).toContain(LESSON_JOIN_CODE_SLOT);
        expect(last.stepsKo![0]).toContain(LESSON_JOIN_CODE_SLOT);
        expect(last.studentGoalEn).toContain('🗺 Adventure');
        expect(last.titleKo.startsWith(String.fromCharCode(0x2460 + last.order - 1))).toBe(true);
        // 「수업 끝」 comes after the adventure now, so the wrap-up hands over instead of ending
        expect(last.stepsKo!.at(-1)).toContain('「수업 끝」');
        expect(plan.stages.at(-2)!.stepsKo!.at(-1)).toContain('모험');
        expect(last.parentMain).toBeFalsy();
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

describe('recall mask (maskInitials)', () => {
  it('keeps the first letter of each word and hides the rest, punctuation inside a word too', async () => {
    const { maskInitials } = await import('../lesson-plans.js');
    expect(maskInitials('Can I have a warm honey tea?')).toBe('C__ I h___ a w___ h____ t__?');
    expect(maskInitials('An ice-cream at 3:30, please.')).toBe('A_ i________ a_ 3___, p_____.');
    expect(maskInitials('"Hi!"')).toBe('"H_!"');
  });
});
