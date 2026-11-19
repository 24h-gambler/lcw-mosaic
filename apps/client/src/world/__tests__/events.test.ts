import { describe, expect, it } from 'vitest';
import { NPCS } from '../town.js';
import { LESSON_FREE_TALK_EVENT, LESSON_TALK_EVENT, errandGoalNpc } from '../events.js';

/** Dan 11-16 R2625 ③⑤: the talk an NPC tap opens in a lesson, and the NPC the errand needs next. */
describe('talk targets between the world and the layers', () => {
  it('the errand goal walks giver -> cafe -> giver -> nobody, and both are town NPCs', () => {
    expect(errandGoalNpc('offered')).toBe('errand_neighbor');
    expect(errandGoalNpc('accepted')).toBe('cafe_owner');
    expect(errandGoalNpc('carrying')).toBe('errand_neighbor');
    expect(errandGoalNpc('done')).toBeNull();
    expect(errandGoalNpc(null)).toBeNull();
    const ids = new Set(NPCS.map((n) => n.id));
    expect(ids.has('errand_neighbor') && ids.has('cafe_owner')).toBe(true);
  });

  it('the lesson talk event has one name for both sides', () => {
    expect(LESSON_TALK_EVENT).toBe('lcw:lesson-talk');
    // Dan 11-19: a passer-by in a lesson gets a free talk; the layer answers the app under its own name
    expect(LESSON_FREE_TALK_EVENT).toBe('lcw:lesson-free-talk');
    expect(LESSON_FREE_TALK_EVENT).not.toBe(LESSON_TALK_EVENT);
  });
});
