import type { LessonWindowStatus } from '@lcw/schemas';

/** Status bar refresh interval for the parent lesson window (docs/08 P04). */
export const LESSON_WINDOW_REFRESH_MS = 10_000;
/** If no status arrived for this long the bar says the connection is waiting. */
export const LESSON_WINDOW_STALE_MS = 3 * LESSON_WINDOW_REFRESH_MS;

/** Text badge shown as the scene icon (no image assets needed; icon art can replace it later). */
export const LESSON_SCENE_ICON_GLYPH: Record<LessonWindowStatus['scene_icon'], string> = {
  cafe: '카페',
  plaza: '광장',
  boutique: '옷가게',
  makers_lab: '메이커스',
  dungeon: '던전',
  home: '내 집',
  shop: '상점',
  hill: '언덕',
  build: '건축'
};

export type LessonWindowView =
  | { state: 'idle' }
  | { state: 'stale'; lastSentAtMs: number }
  | {
      state: 'live';
      icon: string;
      line: string;
      targetSentence: string | null;
    };

/** One-line summary: "place · situation". Pure so the parent view and tests share it. */
export function formatLessonStatusLine(s: Pick<LessonWindowStatus, 'place' | 'situation'>): string {
  return `${s.place} · ${s.situation}`;
}

export function buildLessonWindowView(
  status: LessonWindowStatus | null,
  nowMs: number
): LessonWindowView {
  if (!status) return { state: 'idle' };
  if (nowMs - status.sent_at > LESSON_WINDOW_STALE_MS) {
    return { state: 'stale', lastSentAtMs: status.sent_at };
  }
  return {
    state: 'live',
    icon: LESSON_SCENE_ICON_GLYPH[status.scene_icon],
    line: formatLessonStatusLine(status),
    targetSentence: status.target_sentence
  };
}

/** Demo source until the LessonDO feed is wired (backend is owned elsewhere). Cycles through scenes. */
export const DEMO_LESSON_STATUSES: readonly Omit<LessonWindowStatus, 'sent_at'>[] = [
  {
    type: 'lesson.window_status',
    lesson_id: 'demo-lesson',
    place: '런던 카페',
    situation: '선생님이 카페 주인 역할 중',
    target_sentence: 'Can I have a warm honey tea so I stay warm?',
    scene_icon: 'cafe'
  },
  {
    type: 'lesson.window_status',
    lesson_id: 'demo-lesson',
    place: '메이커스 랩',
    situation: '지우가 제트팩 부품을 주문하는 중',
    target_sentence: 'Could you build a fast red jetpack so that I can fly?',
    scene_icon: 'makers_lab'
  }
];

export function demoLessonStatusAt(tick: number, nowMs: number): LessonWindowStatus {
  const base = DEMO_LESSON_STATUSES[tick % DEMO_LESSON_STATUSES.length]!;
  return { ...base, sent_at: nowMs };
}

/** Demo feed: pushes at once and then every LESSON_WINDOW_REFRESH_MS. Returns the unsubscribe function. */
export function subscribeDemoLessonStatus(
  push: (s: LessonWindowStatus) => void,
  now: () => number = Date.now
): () => void {
  let tick = 0;
  push(demoLessonStatusAt(tick++, now()));
  const id = setInterval(() => push(demoLessonStatusAt(tick++, now())), LESSON_WINDOW_REFRESH_MS);
  return () => clearInterval(id);
}
