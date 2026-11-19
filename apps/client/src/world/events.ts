/**
 * Window events between the world shell and the lazily loaded layers (kept here so App does not import a layer's
 * module eagerly just for a name).
 *
 * LESSON_TALK_EVENT: the child clicked, tapped or pressed E on an NPC while a lesson runs (Dan 11-16 R2625: "클릭해서
 * 인터랙트가 안되고, 상호작용 키도 npc들과 대화가 안됩니다"). The lesson layer opens its dialog window again (the
 * lesson's sentences are the talk), instead of the tap doing nothing.
 */
export const LESSON_TALK_EVENT = 'lcw:lesson-talk';

/**
 * LESSON_FREE_TALK_EVENT: the lesson layer heard a LESSON_TALK_EVENT for an NPC that is not the lesson's (a passer-by)
 * and folded its window; the app opens a free talk with that NPC (Dan 11-19 "자유도도 없앴다" — #152 had made
 * passers-by quiet in a lesson). detail: { npcId }.
 */
export const LESSON_FREE_TALK_EVENT = 'lcw:lesson-free-talk';

/**
 * LESSON_STAGE_EVENT: the lesson moved to another stage while the child's screen was on (the teacher's move or the
 * server's auto move, PR 146). The mic check card closes if it is still open, so no card sits over the new stage's
 * dialog (lesson lane 11-18, production smoke: the card stayed over the cafe and trade dialogs). Not sent on the
 * first state of a lesson.
 */
export const LESSON_STAGE_EVENT = 'lcw:lesson-stage';

/**
 * The NPC the first-visit errand (docs/03 D1, server state) needs next, by world town.ts id: the giver at the honey cafe
 * door to start and to hand the drink over, the cafe owner to order. Null when it is done or not started. The world
 * marks it (WorldHandle.setGoalNpc) and keeps its talk prompt (Dan 11-16 R2625 ⑤).
 */
export function errandGoalNpc(state: 'offered' | 'accepted' | 'carrying' | 'done' | null): string | null {
  if (state === 'offered' || state === 'carrying') return 'errand_neighbor';
  if (state === 'accepted') return 'cafe_owner';
  return null;
}
