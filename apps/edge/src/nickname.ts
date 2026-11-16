import type { SqliteExecutor } from './storage.js';

/**
 * One name, one student on the student sign-up (Dan 11-16 14:3x: "닉네임 겹치지 않게 해서 Oreo 인식되면 그거 학생에
 * 붙히는 구조"): the name is how a sign-up finds the teacher's row. A guardian adding a child (family.ts) and the
 * teacher making a student (/v1/admin/players) are not blocked: those work by player_id, two families may well both
 * have a 'Mina', and blocking them broke 20 existing flows (seats, Duo, push, my world …) when tried on 11-16.
 *
 * Smoke-check rows and the demo row are not students (the console student list hides them too): they never take a
 * name and are never matched, so a sign-up called 'Demo' cannot be linked onto the demo row.
 */
export const isTestPlayerId = (id: string) => id.startsWith('smoke-') || id === 'player-demo';

/** Case, full/half width and spaces, dots, dashes, underscores ignored: 'Oreo', ' oreo', 'ＯＲＥＯ', 'O-reo' are one name. */
export const nicknameKey = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[\s._-]+/g, '');

/** A family a real guardian holds: signed in at least once, or gave consent. Teacher-made placeholder families do not. */
export function familyHasGuardian(sql: SqliteExecutor, familyId: string): boolean {
  return (
    Boolean(sql.get("select v from family_flags where family_id = ? and k = 'service' and v = 1", [familyId])) ||
    Boolean(sql.get('select 1 from guardian_sessions where family_id = ? limit 1', [familyId])) ||
    Boolean(sql.get('select 1 from guardians where family_id = ? and oauth_sub is not null limit 1', [familyId]))
  );
}

export type NameOwner = { kind: 'free' } | { kind: 'taken' } | { kind: 'teacher_row'; player_id: string | null };

/**
 * Who already has this name: a waiting sign-up or a student with a real guardian → taken; only a teacher-made row
 * (no guardian yet, like Oreo before the sign-up) → that row; two teacher-made rows with the name → `player_id: null`
 * (the teacher picks; never a guess). `exceptSignup` / `exceptPlayer`: the sign-up being approved, or the row being
 * re-posted, does not block itself.
 */
export function nameOwner(sql: SqliteExecutor, nickname: string, opts: { exceptSignup?: string; exceptPlayer?: string } = {}): NameOwner {
  const key = nicknameKey(nickname);
  let waiting: Array<{ id: string; nickname: string }> = [];
  try {
    waiting = sql.all<{ id: string; nickname: string }>("select id, nickname from student_signups where state = 'pending' and nickname != ''", []);
  } catch {
    /* sign-ups not set up in this build: nothing waiting */
  }
  if (waiting.some((s) => s.id !== opts.exceptSignup && nicknameKey(s.nickname) === key)) return { kind: 'taken' };
  const same = sql
    .all<{ id: string; family_id: string; nickname: string }>(
      "select id, family_id, nickname from players where kind = 'child' and id not like 'smoke-%' and id <> 'player-demo'",
      []
    )
    .filter((k) => k.id !== opts.exceptPlayer && nicknameKey(k.nickname) === key);
  if (!same.length) return { kind: 'free' };
  if (same.some((k) => familyHasGuardian(sql, k.family_id))) return { kind: 'taken' };
  return { kind: 'teacher_row', player_id: same.length === 1 ? same[0]!.id : null };
}

/** Up to three free names close to the one asked for ('Oreo' → 'Oreo2', 'Oreo3', …), within `max` letters. */
export function nameIdeas(sql: SqliteExecutor, nickname: string, max = 16): string[] {
  const out: string[] = [];
  const base = nickname.trim();
  for (let n = 2; n < 100 && out.length < 3; n++) {
    const idea = `${base.slice(0, max - String(n).length)}${n}`;
    if (nameOwner(sql, idea).kind === 'free') out.push(idea);
  }
  return out;
}
