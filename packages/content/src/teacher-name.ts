/**
 * The teacher's name on the child's screen (review #80). `name` is the name alone, without "선생님": "김민지", "Dan".
 * Every child-facing label goes through teacherLabel, so the title is added exactly once ("김민지 선생님", never
 * "김민지 선생님 선생님"), and an empty or missing name reads "선생님".
 */
export const TEACHER_TITLE_KO = '선생님';
/** One length cap for the name alone (console field, server schema, display). */
export const TEACHER_NAME_MAX = 16;

/**
 * The name alone, or null: trims, drops a trailing title someone typed anyway ("김민지 선생님", "김민지선생님"), and
 * rejects what must not reach a child's screen (control characters, angle brackets) or is too long.
 */
export function normalizeTeacherName(raw: string | null | undefined): string | null {
  let t = (raw ?? '').trim();
  while (t.endsWith(TEACHER_TITLE_KO)) t = t.slice(0, -TEACHER_TITLE_KO.length).trim();
  if (!t || t.length > TEACHER_NAME_MAX) return null;
  for (const ch of t) {
    const c = ch.charCodeAt(0);
    if (c < 32 || c === 127 || ch === '<' || ch === '>') return null;
  }
  return t;
}

/** "김민지 선생님", or "선생님" when there is no usable name. Ends in "님" (consonant): the particle is "과". */
export function teacherLabel(name: string | null | undefined): string {
  const n = normalizeTeacherName(name);
  return n ? `${n} ${TEACHER_TITLE_KO}` : TEACHER_TITLE_KO;
}
