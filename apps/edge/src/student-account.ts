import { Hono } from 'hono';
import { z } from 'zod';
import { filterSpeechBubble } from '@lcw/converse';
import type { EdgePlatformDb, SqliteExecutor } from './storage.js';
import { DEVICE_CODE_TTL_MS, DEVICE_TOKEN_TTL_MS, GUARDIAN_CONSENT_SCOPES } from './family.js';
import { closeListeners, type RealtimeClient } from './lesson-audio.js';
import { drainVoicePurge, type VoiceBlobStore } from './voice.js';
import { JOIN_CODE_TTL_MS as LESSON_JOIN_WINDOW_MS, STUDENT_TOKEN_TTL_MS as LESSON_STUDENT_TOKEN_TTL_MS } from './lesson-mode.js';

/**
 * Student sign-up in lesson time (docs/02 login, docs/16 §2-1, §3), on top of the guardian account (family.ts):
 *
 * 1. On the student device (/signup) an adult signs in: the child's guardian, or a student of 14 or older as their
 *    own account holder (docs/02: OAuth is for guardians and adults; the guardian lane's OAuth gives a guardian
 *    session, the same kind the invite link gives). Nothing about the child is sent before that.
 * 2. The adult gives the required service consent (`/v1/family/service-consent`, docs/16 §3) — before it, this
 *    module refuses the request (`service_consent_required`), so no child data is processed without consent.
 * 3. The adult types the nickname: `POST /v1/student/signup` makes a pending request (nickname, the family) and a
 *    claim token the waiting device keeps. It shows in the teacher console under '승인 대기'.
 * 4. The teacher approves it into an existing student row (e.g. Oreo, production stu-29ddc960: same player_id, so
 *    lessons, utterances, coins and the world continue) or a new one. An existing row made by the teacher
 *    (admin placeholder family, no guardian of its own) moves into the signing guardian's family; a row that
 *    already has a real guardian is never moved (`player_has_guardian`).
 * 5. The waiting device collects a device token (an ordinary `devices` row, as `/v1/device/link`), once.
 * Any other device: the guardian signs in there and links it (family.ts device code → /v1/device/link), or the
 * teacher makes a 6-digit code for a consented student (`POST /v1/admin/students/:id/device-code`).
 *
 * Lesson time: the teacher comes into the student's own world. The signed-in world polls `GET /v1/device/lesson`
 * (which also marks the student '접속 중' for the console) and, once the teacher presses 수업 시작, attaches the
 * lesson by itself with `POST /v1/device/lesson/join` (the same answer as `/v1/join`); the student taps nothing.
 * Before the required consent the adult states who they are (guardian 19+ or student 14+, `POST /v1/student/attest`).
 *
 * Kept: the nickname for at most 3 hours while pending; cleared on approval, reject or expiry. No email, name or Google data
 * is stored here. The lesson join code (lesson-mode.ts) is untouched.
 */

export const SIGNUP_PENDING_TTL_MS = 3 * 3_600_000;
/** An approved signup must be collected by its device within this time (the device polls while it waits). */
export const SIGNUP_CLAIM_TTL_MS = 24 * 3_600_000;
export const SIGNUP_MAX_PENDING = 40;
/** Sign-ups one account may send per 24 h (pending or decided): one account cannot fill the console queue. */
export const SIGNUP_PER_FAMILY = 5;
/** The signed-in world screen's poll marks the student '접속 중' in the console; one write per student per 10 s. */
export const WORLD_SEEN_WRITE_MS = 10_000;
/**
 * Who gave the consent (docs/16 §3, PIPA 22-2): the guardian of a child (19 or older), or a student of 14 or older
 * signing for themselves. Kept as family_flags k='age_attest' (1 = guardian 19+, 2 = self 14+) with the time.
 */
export const AGE_ATTEST = { guardian_19: 1, self_14: 2 } as const;
export type AgeAttest = keyof typeof AGE_ATTEST;
export const STUDENT_FAILS_PER_HOUR = 30;

export const STUDENT_PUBLIC_ROUTES: ReadonlyArray<readonly [string, RegExp]> = [
  ['POST', /^\/v1\/student\/signup$/],
  ['GET', /^\/v1\/student\/signup\/status$/],
  ['POST', /^\/v1\/student\/attest$/],
  // The signed-in world (device token): is my lesson running (and '접속 중'), attach it without a code.
  ['GET', /^\/v1\/device\/lesson$/],
  ['POST', /^\/v1\/device\/lesson\/join$/]
];

export const STUDENT_ACCOUNT_SCHEMA = `
create table if not exists student_signups (id text primary key, family_id text not null, guardian_id text not null, nickname text not null, claim_hash text unique not null, label text not null, created_at integer not null, expires_at integer not null, state text not null, player_id text, decided_at integer, claimed_at integer, device_id text, check_code text not null default '', moved_from text, match_player_id text);
create index if not exists student_signups_state on student_signups (state, created_at);
create table if not exists student_failures (k text not null, hour integer not null, n integer not null, primary key (k, hour));
create table if not exists student_world_seen (player_id text primary key, seen_at integer not null)
`;

export interface StudentAccountDeps {
  sql: SqliteExecutor;
  db: EdgePlatformDb;
  nowMs: () => number;
  randomBytes: (n: number) => Uint8Array;
  sha256Hex: (s: string) => Promise<string>;
  /** R2 for voice clips: an undo that withdraws voice_store deletes the queued clips at once (the hourly cron retries). */
  voiceStore?: () => VoiceBlobStore | null;
  /** Lesson audio: an undo hangs up the signing family's lesson-window listeners. */
  realtime?: () => RealtimeClient | null;
}

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const sixDigits = (b: Uint8Array) => String(((b[0]! << 24) | (b[1]! << 16) | (b[2]! << 8) | b[3]!) >>> 0).slice(-6).padStart(6, '0');
const bearer = (req: Request) => {
  const h = req.headers.get('authorization') ?? '';
  return h.startsWith('Bearer ') ? h.slice(7) : '';
};

const Nickname = z
  .string()
  .trim()
  .min(1)
  .max(16)
  // Letters, digits, spaces: no links, no @, no phone-number-like runs.
  .regex(/^[\p{L}\p{N} _.-]+$/u)
  .refine((s) => !/\d{6,}/.test(s), 'no_long_numbers');
const SignupSchema = z.object({ nickname: Nickname, label: z.string().trim().max(40).default('') }).strict();
/**
 * The same name for people (Dan 11-16 14:3x: no two students share a nickname): case, full/half width and spaces,
 * dots, dashes, underscores are ignored, so 'Oreo', ' oreo', 'ＯＲＥＯ' and 'O-reo' are one name.
 */
export const nicknameKey = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[\s._-]+/g, '');
/**
 * The 4 digits the waiting student screen shows. The console never lists them: the teacher types what the student's
 * screen says, so a stranger's sign-up named 'Oreo' cannot be approved by its name alone.
 */
const CheckCode = z.string().regex(/^\d{4}$/);
const AttestSchema = z.object({ who: z.enum(['guardian_19', 'self_14']) }).strict();
const ApproveSchema = z.union([
  // `confirm`: the teacher saw the warning that this row already has signed-in devices.
  z.object({ player_id: z.string().min(1).max(64), check: CheckCode, confirm: z.boolean().optional() }).strict(),
  z.object({ new_student: z.object({ level: z.enum(['L1', 'L2', 'L3', 'L4', 'L5', 'L6']).default('L1') }).strict(), check: CheckCode }).strict()
]);

export function buildStudentAccountApp(d: StudentAccountDeps): Hono {
  d.sql.exec(STUDENT_ACCOUNT_SCHEMA);
  // A table made before a column was added (production got #76 first): add it once.
  const signupCols = d.sql.all<{ name: string }>('pragma table_info(student_signups)').map((col) => col.name);
  if (!signupCols.includes('match_player_id')) d.sql.exec('alter table student_signups add column match_player_id text');
  const app = new Hono();

  const hour = () => Math.floor(d.nowMs() / 3_600_000);
  const fails = (k: string) => d.sql.get<{ n: number }>('select n from student_failures where k = ? and hour = ?', [k, hour()])?.n ?? 0;
  const ipKey = (req: Request) => `ip:${req.headers.get('cf-connecting-ip') ?? 'local'}`;
  const failed = (req: Request) =>
    d.sql.run('insert into student_failures (k, hour, n) values (?, ?, 1) on conflict(k, hour) do update set n = n + 1', [ipKey(req), hour()]);
  /** Pending past its life, or approved and never collected: the nickname goes. */
  const sweep = (now: number) => {
    d.sql.run("update student_signups set state = 'expired', nickname = '' where state = 'pending' and expires_at <= ?", [now]);
    d.sql.run(
      "update student_signups set state = 'expired', nickname = '' where state = 'approved' and claimed_at is null and decided_at <= ?",
      [now - SIGNUP_CLAIM_TTL_MS]
    );
  };
  const familyConsented = (familyId: string) =>
    Boolean(d.sql.get("select v from family_flags where family_id = ? and k = 'service' and v = 1", [familyId]));
  /** A family a real guardian holds: signed in at least once, or gave consent. Teacher-made placeholder families do not. */
  const familyHasGuardian = (familyId: string) =>
    familyConsented(familyId) ||
    Boolean(d.sql.get('select 1 from guardian_sessions where family_id = ? limit 1', [familyId])) ||
    Boolean(d.sql.get('select 1 from guardians where family_id = ? and oauth_sub is not null limit 1', [familyId]));
  /**
   * Who already has this name: a waiting sign-up or a student with a real guardian → taken; only a teacher-made row
   * (no guardian yet, like Oreo before the sign-up) → that row, the sign-up waits for the teacher's 4-digit check to
   * join it. `exceptSignup`: the sign-up being approved does not block itself.
   */
  const nameOwner = (nickname: string, exceptSignup = ''): { kind: 'free' } | { kind: 'taken' } | { kind: 'teacher_row'; player_id: string } => {
    const key = nicknameKey(nickname);
    const waiting = d.sql
      .all<{ id: string; nickname: string }>("select id, nickname from student_signups where state = 'pending' and nickname != ''", [])
      .some((s) => s.id !== exceptSignup && nicknameKey(s.nickname) === key);
    if (waiting) return { kind: 'taken' };
    const same = d.sql
      .all<{ id: string; family_id: string; nickname: string }>("select id, family_id, nickname from players where kind = 'child'", [])
      .filter((k) => nicknameKey(k.nickname) === key);
    if (!same.length) return { kind: 'free' };
    if (same.some((k) => familyHasGuardian(k.family_id))) return { kind: 'taken' };
    return { kind: 'teacher_row', player_id: same[0]!.id };
  };
  /** Up to three free names close to the one asked for ('Oreo' → 'Oreo2', 'Oreo3', …), within the 16-letter limit. */
  const nameIdeas = (nickname: string): string[] => {
    const out: string[] = [];
    const base = nickname.trim();
    for (let n = 2; n < 100 && out.length < 3; n++) {
      const idea = `${base.slice(0, 16 - String(n).length)}${n}`;
      if (nameOwner(idea).kind === 'free') out.push(idea);
    }
    return out;
  };
  const guardianOf = async (req: Request) => {
    const t = bearer(req);
    if (t.length < 32) return null;
    return (
      d.sql.get<{ guardian_id: string; family_id: string }>(
        'select guardian_id, family_id from guardian_sessions where token_hash = ? and expires_at > ? and revoked_at is null',
        [await d.sha256Hex(t), d.nowMs()]
      ) ?? null
    );
  };
  const consentFor = (playerId: string, guardianId: string, now: number) => {
    // The family's service consent covers each child profile in it (family.ts does the same at consent time).
    if (d.db.hasActiveConsent(playerId, 'service')) return;
    d.db.setConsent({ playerId, guardianId, scope: 'service', granted: true, nowMs: now });
    d.sql.run('insert into consent_log (player_id, guardian_id, scope, granted, at) values (?, ?, ?, ?, ?)', [playerId, guardianId, 'service', 1, now]);
  };
  const attestOf = (familyId: string): AgeAttest | null => {
    const v = d.sql.get<{ v: number }>("select v from family_flags where family_id = ? and k = 'age_attest'", [familyId])?.v;
    return v === AGE_ATTEST.guardian_19 ? 'guardian_19' : v === AGE_ATTEST.self_14 ? 'self_14' : null;
  };
  /** Signed-in devices of a student still within their life (family.ts devices). */
  const devicesOf = (playerId: string, now: number) =>
    Number(
      d.sql.get<{ n: number }>('select count(*) as n from devices where player_id = ? and revoked_at is null and created_at > ?', [
        playerId,
        now - DEVICE_TOKEN_TTL_MS
      ])?.n ?? 0
    );
  /**
   * How the signing adult got in, for the console line: the provider and a masked hint (never the full address):
   * `o***@g***.com` from the provider's e-mail, else the last 4 of the provider's id; 'invite' for an invite link.
   */
  const signerOf = (guardianId: string): { provider: string; hint: string } => {
    let id: { provider: string; sub: string; email: string | null } | undefined;
    try {
      id = d.sql.get<{ provider: string; sub: string; email: string | null }>(
        "select provider, sub, email from oauth_identities where role = 'guardian' and subject_id = ? order by last_login_at desc limit 1",
        [guardianId]
      );
    } catch {
      id = undefined; // a build without the sign-in module (oauth.ts): invite-link sessions only
    }
    if (!id) return { provider: 'invite', hint: '' };
    return { provider: id.provider, hint: maskIdentity(id.email, id.sub) };
  };
  const issueDevice = async (playerId: string, label: string, now: number) => {
    const p = d.sql.get<{ family_id: string; nickname: string; level: string }>('select family_id, nickname, level from players where id = ?', [playerId]);
    if (!p) return null;
    const token = hex(d.randomBytes(32));
    const tokenHash = await d.sha256Hex(token);
    const id = `dev-${hex(d.randomBytes(6))}`;
    d.sql.run(
      'insert into devices (id, player_id, family_id, token_hash, label, created_at, last_seen_at, revoked_at) values (?, ?, ?, ?, ?, ?, ?, null)',
      [id, playerId, p.family_id, tokenHash, label || '학생 기기', now, now]
    );
    return { id, body: { device_token: token, nickname: p.nickname, level: p.level, expires_at: now + DEVICE_TOKEN_TTL_MS } };
  };

  /* ---------- student device (the adult's guardian session; the waiting device's claim token) ---------- */

  /** The adult says who they are before the consent (docs/16 §3): the guardian (19+) or the student (14+) themselves. */
  app.post('/v1/student/attest', async (c) => {
    const g = await guardianOf(c.req.raw);
    if (!g) return c.json({ error: 'guardian_only' }, 401);
    const p = AttestSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!p.success) return c.json({ error: 'invalid' }, 400);
    d.sql.run(
      "insert into family_flags (family_id, k, v, at) values (?, 'age_attest', ?, ?) on conflict(family_id, k) do update set v = excluded.v, at = excluded.at",
      [g.family_id, AGE_ATTEST[p.data.who], d.nowMs()]
    );
    return c.json({ ok: true, who: p.data.who });
  });

  app.post('/v1/student/signup', async (c) => {
    if (fails(ipKey(c.req.raw)) >= STUDENT_FAILS_PER_HOUR) return c.json({ error: 'too_many_attempts' }, 429);
    const g = await guardianOf(c.req.raw);
    if (!g) {
      failed(c.req.raw);
      return c.json({ error: 'guardian_only' }, 401);
    }
    // docs/16 §2-1, §3: nothing about the child before the required consent.
    if (!attestOf(g.family_id)) return c.json({ error: 'age_attest_required' }, 403);
    if (!familyConsented(g.family_id)) return c.json({ error: 'service_consent_required' }, 403);
    const p = SignupSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!p.success) return c.json({ error: 'invalid', issues: p.error.issues.map((i) => ({ path: i.path, message: i.message })) }, 400);
    // The world's chat filter (personal data, bad words) on the name every teacher and NPC will say.
    const f = filterSpeechBubble(p.data.nickname);
    if (!f.allowed && (f.reason === 'pii' || f.reason === 'profanity')) return c.json({ error: 'invalid', reason: f.reason }, 400);
    const claim = hex(d.randomBytes(32));
    const claimHash = await d.sha256Hex(claim);
    const now = d.nowMs();
    sweep(now);
    // One name, one student. A teacher-made row with this name is not 'taken': the sign-up waits to join it.
    const owner = nameOwner(p.data.nickname);
    if (owner.kind === 'taken') {
      failed(c.req.raw); // counted like a wrong guess, so names cannot be listed by trying them
      return c.json({ error: 'nickname_taken', suggestions: nameIdeas(p.data.nickname) }, 409);
    }
    const open = (q: string, a: unknown[]) => d.sql.get<{ n: number }>(q, a)?.n ?? 0;
    if (open("select count(*) as n from student_signups where state = 'pending'", []) >= SIGNUP_MAX_PENDING) return c.json({ error: 'too_many_pending' }, 429);
    if (open('select count(*) as n from student_signups where family_id = ? and created_at > ?', [g.family_id, now - 86_400_000]) >= SIGNUP_PER_FAMILY) {
      return c.json({ error: 'too_many_pending' }, 429);
    }
    const id = `sg-${hex(d.randomBytes(6))}`;
    d.sql.run(
      `insert into student_signups (id, family_id, guardian_id, nickname, claim_hash, label, created_at, expires_at, state, player_id, decided_at, claimed_at, device_id, match_player_id)
       values (?, ?, ?, ?, ?, ?, ?, ?, 'pending', null, null, null, null, ?)`,
      [id, g.family_id, g.guardian_id, p.data.nickname, claimHash, p.data.label, now, now + SIGNUP_PENDING_TTL_MS, owner.kind === 'teacher_row' ? owner.player_id : null]
    );
    const check = sixDigits(d.randomBytes(4)).slice(-4);
    d.sql.run('update student_signups set check_code = ? where id = ?', [check, id]);
    return c.json(
      { state: 'pending', signup_id: id, claim_token: claim, check, expires_at: now + SIGNUP_PENDING_TTL_MS, teacher_match: owner.kind === 'teacher_row' },
      201
    );
  });

  /** The waiting device polls with its claim token. Once approved, the first poll gets the device token (once). */
  app.get('/v1/student/signup/status', async (c) => {
    const claim = bearer(c.req.raw);
    if (claim.length !== 64) return c.json({ error: 'signup_not_found' }, 404);
    const claimHash = await d.sha256Hex(claim);
    const now = d.nowMs();
    sweep(now);
    const s = d.sql.get<{ id: string; state: string; player_id: string | null; claimed_at: number | null; label: string }>(
      'select id, state, player_id, claimed_at, label from student_signups where claim_hash = ?',
      [claimHash]
    );
    if (!s) return c.json({ error: 'signup_not_found' }, 404);
    if (s.state !== 'approved' || !s.player_id) return c.json({ state: s.state });
    if (s.claimed_at) return c.json({ state: 'approved', already_claimed: true });
    // Marked collected in the same synchronous block as the check: two polls racing get one device.
    d.sql.run('update student_signups set claimed_at = ? where id = ?', [now, s.id]);
    const dev = await issueDevice(s.player_id, s.label, now);
    if (!dev) return c.json({ error: 'player_not_found' }, 404);
    d.sql.run('update student_signups set device_id = ? where id = ?', [dev.id, s.id]);
    return c.json({ state: 'approved', ...dev.body });
  });

  /* ---------- teacher console (behind the platform's operator gate) ---------- */

  app.get('/v1/admin/student-signups', (c) => {
    sweep(d.nowMs());
    const now = d.nowMs();
    const rows = d.sql.all<{ id: string; nickname: string; created_at: number; expires_at: number; family_id: string; guardian_id: string; match_player_id: string | null }>(
      "select id, nickname, created_at, expires_at, family_id, guardian_id, match_player_id from student_signups where state = 'pending' order by created_at"
    );
    /** The teacher-made row this name matched, while it is still one (no guardian took it meanwhile). */
    const matchOf = (pid: string | null) => {
      const k = pid ? d.sql.get<{ id: string; family_id: string; nickname: string }>('select id, family_id, nickname from players where id = ?', [pid]) : null;
      return k && !familyHasGuardian(k.family_id) ? { player_id: k.id, nickname: k.nickname } : null;
    };
    // Who signed (provider, masked hint, age statement) so a stranger typing 'Oreo' is not linked by the name alone;
    // students already in the signing family (e.g. a sibling) with their signed-in devices.
    return c.json({
      signups: rows.map((r) => ({
        id: r.id,
        nickname: r.nickname,
        created_at: r.created_at,
        expires_at: r.expires_at,
        signer: { ...signerOf(r.guardian_id), attest: attestOf(r.family_id) },
        match: matchOf(r.match_player_id),
        family_students: d.sql
          .all<{ id: string; nickname: string }>('select id, nickname from players where family_id = ? order by nickname', [r.family_id])
          .map((k) => ({ player_id: k.id, nickname: k.nickname, linked_devices: devicesOf(k.id, now) }))
      }))
    });
  });

  app.post('/v1/admin/student-signups/:id/approve', async (c) => {
    const p = ApproveSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!p.success) return c.json({ error: 'invalid', issues: p.error.issues }, 400);
    const now = d.nowMs();
    sweep(now);
    const s = d.sql.get<{ id: string; family_id: string; guardian_id: string; nickname: string; check_code: string }>(
      "select id, family_id, guardian_id, nickname, check_code from student_signups where id = ? and state = 'pending'",
      [c.req.param('id')]
    );
    if (!s) return c.json({ error: 'signup_not_found' }, 404);
    if (!s.check_code || p.data.check !== s.check_code) return c.json({ error: 'check_mismatch' }, 409);
    if (!familyConsented(s.family_id)) return c.json({ error: 'service_consent_required' }, 409);
    let playerId: string;
    let movedFrom: string | null = null;
    if ('player_id' in p.data) {
      const row = d.sql.get<{ id: string; family_id: string }>('select id, family_id from players where id = ?', [p.data.player_id]);
      if (!row) return c.json({ error: 'player_not_found' }, 404);
      if (row.family_id !== s.family_id) {
        // Only a teacher-made row with no guardian of its own joins the signing family; a real family keeps its child.
        if (familyHasGuardian(row.family_id)) return c.json({ error: 'player_has_guardian' }, 409);
        // Devices already signed in as this student (e.g. linked by the teacher's code): the teacher confirms again.
        const n = devicesOf(row.id, now);
        if (n > 0 && p.data.confirm !== true) return c.json({ error: 'player_has_devices', devices: n }, 409);
        const to = s.family_id;
        movedFrom = row.family_id;
        d.sql.run('update players set family_id = ? where id = ?', [to, row.id]);
        d.sql.run('update devices set family_id = ? where player_id = ?', [to, row.id]);
        d.sql.run('update device_link_codes set family_id = ? where player_id = ?', [to, row.id]);
      }
      playerId = row.id;
    } else {
      // A new student under this name: someone may have taken it since the sign-up (or it matched a teacher row).
      if (nameOwner(s.nickname, s.id).kind !== 'free') return c.json({ error: 'nickname_taken' }, 409);
      playerId = `stu-${hex(d.randomBytes(4))}`;
      d.db.ensureFamilyAndPlayer({ familyId: s.family_id, guardianId: s.guardian_id, playerId, nickname: s.nickname, level: p.data.new_student.level, nowMs: now });
    }
    consentFor(playerId, s.guardian_id, now);
    // The players row holds the name now; the sign-up keeps no copy (docs/16: minimum, transient).
    d.sql.run("update student_signups set state = 'approved', nickname = '', check_code = '', player_id = ?, decided_at = ?, moved_from = ? where id = ?", [
      playerId,
      now,
      movedFrom,
      s.id
    ]);
    const kid = d.sql.get<{ nickname: string }>('select nickname from players where id = ?', [playerId]);
    return c.json({ ok: true, player_id: playerId, nickname: kid?.nickname ?? s.nickname });
  });

  /**
   * A wrong approval, undone by the teacher: the row goes back to the family it came from (a teacher-made row), the
   * devices signed in through it since the approval stop working, and every consent the signing family gave for it is
   * withdrawn (service and each guardian scope: voice_store queues the clips for deletion, lesson_window hangs up the
   * family's listeners). History (lessons, utterances, coins) stays on the same player_id.
   */
  app.post('/v1/admin/student-signups/:id/undo', async (c) => {
    const s = d.sql.get<{ id: string; family_id: string; guardian_id: string; player_id: string | null; decided_at: number | null; moved_from: string | null }>(
      "select id, family_id, guardian_id, player_id, decided_at, moved_from from student_signups where id = ? and state = 'approved'",
      [c.req.param('id')]
    );
    if (!s || !s.player_id) return c.json({ error: 'signup_not_found' }, 404);
    const now = d.nowMs();
    d.sql.run('update devices set revoked_at = ? where player_id = ? and revoked_at is null and created_at >= ?', [now, s.player_id, s.decided_at ?? 0]);
    if (s.moved_from) {
      d.sql.run('update players set family_id = ? where id = ? and family_id = ?', [s.moved_from, s.player_id, s.family_id]);
      d.sql.run('update devices set family_id = ? where player_id = ?', [s.moved_from, s.player_id]);
      d.sql.run('update device_link_codes set expires_at = ? where player_id = ? and used_at is null and expires_at > ?', [now, s.player_id, now]);
      // The row was a teacher-made one before (no guardian of its own), so every active consent on it is the signer's.
      for (const scope of ['service', ...GUARDIAN_CONSENT_SCOPES] as const) {
        if (!d.db.hasActiveConsent(s.player_id, scope)) continue;
        d.db.setConsent({ playerId: s.player_id, guardianId: s.guardian_id, scope, granted: false, nowMs: now });
        d.sql.run('insert into consent_log (player_id, guardian_id, scope, granted, at) values (?, ?, ?, ?, ?)', [s.player_id, s.guardian_id, scope, 0, now]);
      }
    }
    d.sql.run("update student_signups set state = 'undone', decided_at = ? where id = ?", [now, s.id]);
    if (s.moved_from) {
      await closeListeners(d.sql, d.realtime?.() ?? null, { playerId: s.player_id }, 'signup_undone', now);
      if (d.voiceStore) await drainVoicePurge(d.sql, d.voiceStore()).catch(() => null);
    }
    return c.json({ ok: true, player_id: s.player_id, moved_back: Boolean(s.moved_from) });
  });

  /** Approved in the last 24 h: the console can undo one that went to the wrong student. */
  app.get('/v1/admin/student-signups/recent', (c) => {
    const now = d.nowMs();
    const rows = d.sql.all<{ id: string; player_id: string; decided_at: number; moved_from: string | null }>(
      "select id, player_id, decided_at, moved_from from student_signups where state = 'approved' and decided_at > ? order by decided_at desc limit 20",
      [now - 86_400_000]
    );
    return c.json({
      approved: rows.map((r) => ({
        id: r.id,
        player_id: r.player_id,
        nickname: d.sql.get<{ nickname: string }>('select nickname from players where id = ?', [r.player_id])?.nickname ?? '',
        decided_at: r.decided_at,
        moved: Boolean(r.moved_from)
      }))
    });
  });

  app.post('/v1/admin/student-signups/:id/reject', (c) => {
    const s = d.sql.get<{ id: string }>("select id from student_signups where id = ? and state = 'pending'", [c.req.param('id')]);
    if (!s) return c.json({ error: 'signup_not_found' }, 404);
    d.sql.run("update student_signups set state = 'rejected', nickname = '', decided_at = ? where id = ?", [d.nowMs(), s.id]);
    return c.json({ ok: true });
  });

  /** The teacher connects another device of a consented student (the same 6-digit code a guardian makes; /link). */
  app.post('/v1/admin/students/:id/device-code', (c) => {
    const kid = d.sql.get<{ id: string; family_id: string }>('select id, family_id from players where id = ?', [c.req.param('id')]);
    if (!kid) return c.json({ error: 'player_not_found' }, 404);
    if (!familyConsented(kid.family_id)) return c.json({ error: 'service_consent_required' }, 403);
    const now = d.nowMs();
    d.sql.run('update device_link_codes set expires_at = ? where player_id = ? and used_at is null and expires_at > ?', [now, kid.id, now]);
    let code = sixDigits(d.randomBytes(4));
    for (let i = 0; i < 5 && d.sql.get('select code from device_link_codes where code = ?', [code]); i++) code = sixDigits(d.randomBytes(4));
    d.sql.run('insert into device_link_codes (code, player_id, family_id, expires_at, used_at) values (?, ?, ?, ?, null)', [
      code,
      kid.id,
      kid.family_id,
      now + DEVICE_CODE_TTL_MS
    ]);
    return c.json({ code, expires_at: now + DEVICE_CODE_TTL_MS, link_path: '/link' }, 201);
  });

  /** How many signed-in devices a student has: the console shows '학생 화면에 자동으로 떠요' instead of the code. */
  app.get('/v1/admin/students/:id/devices', (c) => {
    const now = d.nowMs();
    const n = d.sql.get<{ n: number }>('select count(*) as n from devices where player_id = ? and revoked_at is null and created_at > ?', [
      c.req.param('id'),
      now - DEVICE_TOKEN_TTL_MS
    ])?.n;
    return c.json({ count: Number(n ?? 0) });
  });

  /* ---------- signed-in student device: the teacher's lesson shows up by itself (no code) ---------- */

  const deviceOf = async (req: Request) => {
    const token = bearer(req);
    if (!/^[0-9a-f]{64}$/.test(token)) return null;
    const dev = d.sql.get<{ id: string; player_id: string; created_at: number }>(
      'select id, player_id, created_at from devices where token_hash = ? and revoked_at is null',
      [await d.sha256Hex(token)]
    );
    return dev && d.nowMs() - dev.created_at <= DEVICE_TOKEN_TTL_MS ? dev : null;
  };
  /** Consent withdrawn (family_flags service = 0): the device no longer attaches lessons until a new consent. */
  const deviceConsented = (playerId: string) => {
    const fam = d.sql.get<{ family_id: string }>('select family_id from players where id = ?', [playerId])?.family_id;
    return Boolean(fam && familyConsented(fam));
  };
  /** The student's running lesson: the same rule as the console's live list (lesson-mode.ts /v1/admin/lessons/live). */
  const liveLessonOf = (playerId: string, now: number) =>
    d.sql.get<{ lesson_id: string; started_at: number }>(
      `select l.id as lesson_id, l.started_at from lessons l
       where l.player_id = ? and l.ended_at is null and l.started_at >= ?
         and exists (select 1 from lesson_joins j where j.lesson_id = l.id and j.expires_at > ?)
       order by l.started_at desc limit 1`,
      [playerId, now - LESSON_JOIN_WINDOW_MS, now]
    );

  /** Polled by the signed-in world (every few seconds while open); also marks the student '접속 중' for the console. */
  app.get('/v1/device/lesson', async (c) => {
    const dev = await deviceOf(c.req.raw);
    if (!dev) return c.json({ error: 'device_only' }, 401);
    if (!deviceConsented(dev.player_id)) return c.json({ error: 'service_consent_required' }, 403);
    const now = d.nowMs();
    // '접속 중' in the console (lesson-mode.ts world_seen_at): at most one write per student per 10 s.
    d.sql.run(
      'insert into student_world_seen (player_id, seen_at) values (?, ?) on conflict(player_id) do update set seen_at = excluded.seen_at where excluded.seen_at - student_world_seen.seen_at >= ?',
      [dev.player_id, now, WORLD_SEEN_WRITE_MS]
    );
    const live = liveLessonOf(dev.player_id, now);
    return c.json(live ? { live: true, lesson_id: live.lesson_id, started_at: live.started_at } : { live: false });
  });

  /**
   * The world attaches the running lesson by itself (no tap): the same student session `/v1/join` gives for the code
   * (lesson-mode.ts). Called again (refresh, restart) it adds a token and leaves the earlier ones working.
   */
  app.post('/v1/device/lesson/join', async (c) => {
    const dev = await deviceOf(c.req.raw);
    if (!dev) return c.json({ error: 'device_only' }, 401);
    if (!deviceConsented(dev.player_id)) return c.json({ error: 'service_consent_required' }, 403);
    const now = d.nowMs();
    const live = liveLessonOf(dev.player_id, now);
    if (!live) return c.json({ error: 'no_live_lesson' }, 404);
    const token = hex(d.randomBytes(24));
    d.sql.run('insert into student_tokens (token_hash, lesson_id, player_id, expires_at) values (?, ?, ?, ?)', [
      await d.sha256Hex(token),
      live.lesson_id,
      dev.player_id,
      now + LESSON_STUDENT_TOKEN_TTL_MS
    ]);
    d.sql.run('update devices set last_seen_at = ? where id = ?', [now, dev.id]);
    const pl = d.sql.get<{ nickname: string; level: string }>('select nickname, level from players where id = ?', [dev.player_id]);
    return c.json({
      student_token: token,
      lesson_id: live.lesson_id,
      player_id: dev.player_id,
      nickname: pl?.nickname ?? '',
      level: pl?.level ?? 'L1',
      voice_store: d.db.hasActiveConsent(dev.player_id, 'voice_store')
    });
  });

  return app;
}

/** `o***@g***.com` from an e-mail, else `…1234` from the provider id: enough to tell two adults apart, never the address. */
export function maskIdentity(email: string | null | undefined, sub: string): string {
  const m = email ? /^([^@\s])[^@\s]*@([^.@\s])[^@\s]*?(\.[^.@\s]+)$/.exec(email.trim()) : null;
  if (m) return `${m[1]}***@${m[2]}***${m[3]}`;
  return sub.length > 4 ? `…${sub.slice(-4)}` : '…';
}
