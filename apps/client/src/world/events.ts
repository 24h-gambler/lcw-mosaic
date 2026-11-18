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
 * The NPC the first-visit errand (docs/03 D1, server state) needs next, by world town.ts id: the giver at the honey cafe
 * door to start and to hand the drink over, the cafe owner to order. Null when it is done or not started. The world
 * marks it (WorldHandle.setGoalNpc) and keeps its talk prompt (Dan 11-16 R2625 ⑤).
 */
export function errandGoalNpc(state: 'offered' | 'accepted' | 'carrying' | 'done' | null): string | null {
  if (state === 'offered' || state === 'carrying') return 'errand_neighbor';
  if (state === 'accepted') return 'cafe_owner';
  return null;
}
