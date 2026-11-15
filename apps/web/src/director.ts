/** Director console rules that are pure enough to test (WP-304 hotkeys, WP-305 possession look). */
import type { LessonBookmark, LessonBookmarkKind } from '@lcw/metrics';

export const DIRECTOR_BOOKMARK_KEYS: Readonly<Record<string, LessonBookmarkKind>> = {
  F1: 'coaching',
  F2: 'expression'
};

/** Returns the bookmark for a hotkey, or null. Only the timestamp is stored, never text or audio. */
export function bookmarkFromKey(key: string, atMs: number): LessonBookmark | null {
  const kind = DIRECTOR_BOOKMARK_KEYS[key];
  return kind ? { kind, at_ms: atMs } : null;
}

export type TeacherAvatarState = 'active' | 'sitting_reading_map';
export type NpcMarker = 'none' | 'sparkle';

/** While possessing an NPC the teacher's own avatar sits on a bench reading a map (docs/10, WP-305). */
export const POSSESSION_TEACHER_AVATAR_STATE: TeacherAvatarState = 'sitting_reading_map';
export const POSSESSION_NPC_MARKER: NpcMarker = 'sparkle';

export interface PossessionLook {
  teacherAvatar: TeacherAvatarState;
  /** Marker per NPC id; only the possessed one gets a sparkle. */
  npcMarkers: Record<string, NpcMarker>;
}

export function resolvePossessionLook(
  possessedNpcId: string | null,
  npcIds: readonly string[]
): PossessionLook {
  const npcMarkers: Record<string, NpcMarker> = {};
  for (const id of npcIds) {
    npcMarkers[id] = id === possessedNpcId ? POSSESSION_NPC_MARKER : 'none';
  }
  return {
    teacherAvatar: possessedNpcId ? POSSESSION_TEACHER_AVATAR_STATE : 'active',
    npcMarkers
  };
}

export interface KeyEventLike {
  key: string;
  preventDefault(): void;
}

/**
 * Hotkey handler: F1/F2 add a timestamp bookmark. preventDefault stops the browser help page
 * (F1) and other defaults; other keys are left alone.
 */
export function handleDirectorKeydown(
  e: KeyEventLike,
  atMs: number,
  push: (b: LessonBookmark) => void
): boolean {
  const b = bookmarkFromKey(e.key, atMs);
  if (!b) return false;
  e.preventDefault();
  push(b);
  return true;
}
