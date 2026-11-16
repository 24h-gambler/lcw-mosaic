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
// Same rule as the SQL below: LIKE 'smoke-%' ignores ASCII case, and the demo id is compared exactly.
export const isTestPlayerId = (id: string) => id.toLowerCase().startsWith('smoke-') || id === 'player-demo';

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

/** `taken.by`: who holds the name — another waiting sign-up, or a student with a guardian (that student's id). */
export type NameOwner =
  | { kind: 'free' }
  | { kind: 'taken'; by: { kind: 'signup' } | { kind: 'student'; player_id: string } }
  | { kind: 'teacher_row'; player_id: string | null };

export interface NameIndex {
  /**
   * Who has this name now; `exceptSignup`: the sign-up being approved or listed does not block itself.
   * `familyId`: the asking family (a sign-up, a listed sign-up) — its own child with the name is answered first, so
   * another family's student or a waiting sign-up with the same name never hides it (the answer does not depend on
   * which row the database returns first).
   */
  owner(nickname: string, exceptSignup?: string, familyId?: string): NameOwner;
  /** The family's own children with this name (two only when the family named two children alike). */
  ownChildren(nickname: string, familyId: string): string[];
}

/**
 * Who already has a name: a waiting sign-up or a student with a real guardian → taken; only a teacher-made row (no
 * guardian yet, like Oreo before the sign-up) → that row; two teacher-made rows with the name → `player_id: null`
 * (the teacher picks; never a guess).
 *
 * Reads the waiting sign-ups and the students once and groups them by name, so a console listing (every 8 s) or a
 * run of name ideas costs two reads, not two per row. Guardian checks are made once per family, on demand.
 */
export function nameIndex(sql: SqliteExecutor): NameIndex {
  let waiting: Array<{ id: string; nickname: string }> = [];
  try {
    waiting = sql.all<{ id: string; nickname: string }>("select id, nickname from student_signups where state = 'pending' and nickname != ''", []);
  } catch (e) {
    // Only a build without the sign-up table means 'nothing waiting'; any other database error is real.
    if (!/no such table/i.test(String(e))) throw e;
  }
  const waitingByKey = new Map<string, string[]>();
  for (const s of waiting) {
    const k = nicknameKey(s.nickname);
    waitingByKey.set(k, [...(waitingByKey.get(k) ?? []), s.id]);
  }
  const playersByKey = new Map<string, Array<{ id: string; family_id: string }>>();
  for (const p of sql.all<{ id: string; family_id: string; nickname: string }>(
    "select id, family_id, nickname from players where kind = 'child' and id not like 'smoke-%' and id <> 'player-demo'",
    []
  )) {
    const k = nicknameKey(p.nickname);
    playersByKey.set(k, [...(playersByKey.get(k) ?? []), { id: p.id, family_id: p.family_id }]);
  }
  const guarded = new Map<string, boolean>();
  const hasGuardian = (familyId: string) => {
    if (!guarded.has(familyId)) guarded.set(familyId, familyHasGuardian(sql, familyId));
    return guarded.get(familyId)!;
  };
  return {
    owner(nickname, exceptSignup, familyId) {
      const key = nicknameKey(nickname);
      const same = playersByKey.get(key) ?? [];
      // The asking family signed in to ask (a sign-up, a listed sign-up), so no guardian check: its own child is its own
      // even when every guardian mark has gone since.
      const own = familyId ? same.find((k) => k.family_id === familyId) : undefined;
      if (own) return { kind: 'taken', by: { kind: 'student', player_id: own.id } };
      if ((waitingByKey.get(key) ?? []).some((id) => id !== exceptSignup)) return { kind: 'taken', by: { kind: 'signup' } };
      if (!same.length) return { kind: 'free' };
      const held = same.find((k) => hasGuardian(k.family_id));
      if (held) return { kind: 'taken', by: { kind: 'student', player_id: held.id } };
      return { kind: 'teacher_row', player_id: same.length === 1 ? same[0]!.id : null };
    },
    ownChildren(nickname, familyId) {
      return (playersByKey.get(nicknameKey(nickname)) ?? []).filter((k) => k.family_id === familyId).map((k) => k.id);
    }
  };
}

/** One-off lookup (a sign-up, an approval): see nameIndex. */
export function nameOwner(sql: SqliteExecutor, nickname: string, opts: { exceptSignup?: string; familyId?: string } = {}): NameOwner {
  return nameIndex(sql).owner(nickname, opts.exceptSignup, opts.familyId);
}

/** Up to three free names close to the one asked for ('Oreo' → 'Oreo2', 'Oreo3', …), within `max` letters. */
export function nameIdeas(sql: SqliteExecutor, nickname: string, max = 16): string[] {
  const index = nameIndex(sql);
  const out: string[] = [];
  const base = nickname.trim();
  for (let n = 2; n < 100 && out.length < 3; n++) {
    const idea = `${base.slice(0, max - String(n).length)}${n}`;
    if (index.owner(idea).kind === 'free') out.push(idea);
  }
  return out;
}
