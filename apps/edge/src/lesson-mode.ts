import { Hono } from 'hono';
import { z } from 'zod';
import {
  LESSON_DIRECTOR_EVENTS,
  LESSON_NPCS,
  LESSON_PLANS,
  UTTERANCE_CLIENT_ID_RE,
  bankTextKey,
  getLessonPlan,
  normalizeTeacherName,
  type LessonPlan
} from '@lcw/content';
import { scoreUtterance } from '@lcw/converse';
import {
  computeLessonMetrics,
  extractBookmarkWindows,
  meaningfulExpression,
  type BookmarkTranscriptLine,
  type LessonMinuteInput,
  type UtteranceMetricInput
} from '@lcw/metrics';
import { LessonDO, type DirectorEventKind, type EdgePlatformDb, type SqliteExecutor } from './storage.js';
import { markSeatUse } from './seats.js';
import { buildLessonParentFacts } from './parent-report.js';
import { createMemoryCard } from './review.js';
import { enqueueLessonEnd, mountOpsCardRoutes } from './ops-cards.js';

/**
 * Lesson mode (docs/18): a real lesson without the 3D world. The teacher (operator token) starts a lesson and gets a
 * 6-digit join code; the student device trades the code for a token scoped to that one lesson and player; every
 * utterance is scored server-side and stored like any other utterance (session_kind 'lesson').
 */

/**
 * Teacher presence (Dan 11-16: "with one PC nobody knows whether the teacher is there"). The director console beats
 * POST /v1/admin/lessons/:id/presence every TEACHER_BEAT_MS while the lesson runs; the teacher is present while the
 * last beat is at most TEACHER_PRESENT_MS old. The child's state carries `teacher` and the world shows a teacher tag
 * or switches to "혼자 놀기"; each answer is stored with interlocutor 'teacher' (teacher there) or 'self' (alone).
 * Rollout: a lesson that has never had a beat (started by a console from before this change) counts as taught for its
 * whole life, as before. A console with this change says `presence: true` at start, which is the first beat.
 */
export const TEACHER_BEAT_MS = 15_000;
export const TEACHER_PRESENT_MS = 45_000;
/** The student device's one-time mic check result (talk lane, sessionStorage 'lcw.micStatus'). */
export const LESSON_MIC_STATUSES = ['ok', 'quiet', 'none', 'skipped'] as const;
/** 1PC panel lock: wrong numbers per lesson within PANEL_FAIL_WINDOW_MS before the unlock answers 429. */
export const PANEL_FAILS_MAX = 5;
export const PANEL_FAIL_WINDOW_MS = 10 * 60_000;
export interface TeacherPresence {
  present: boolean;
  name: string | null;
  since: number | null;
  /** false: no beat ever (an old console) — present by rule, not by heartbeat. */
  tracked: boolean;
  panel: 'open' | 'closed' | null;
}

export const JOIN_CODE_TTL_MS = 12 * 3_600_000;
export const STUDENT_TOKEN_TTL_MS = 12 * 3_600_000;
/**
 * Signed-in devices of a student (family.ts `devices`, student-account.ts): those see the teacher's lesson by
 * themselves (GET /v1/device/lesson), so the console puts the 6-digit code behind '다른 기기로 들어오기'.
 * The window equals family.ts DEVICE_TOKEN_TTL_MS (a test keeps them equal; no import, family.ts pulls lesson code).
 */
export const LINKED_DEVICE_TTL_MS = 365 * 86_400_000;
const LINKED_DEVICES_SQL = '(select count(*) from devices dv where dv.player_id = p.id and dv.revoked_at is null and dv.created_at > ?)';
/**
 * Last poll of the student's signed-in world (student-account.ts GET /v1/device/lesson, written at most every 10 s):
 * the console draws '접속 중' when now - world_seen_at < 20 s, else '접속 대기'. Null: never signed in on a device.
 */
const WORLD_SEEN_SQL = (playerCol: string) => `(select w.seen_at from student_world_seen w where w.player_id = ${playerCol})`;
/** Wrong codes one device (client IP) may try per hour; a typo-prone child never locks out other lessons. */
export const JOIN_FAILS_PER_HOUR = 10;
/** Wrong codes all devices together may try per hour (6-digit codes live 12 h: guessing stays far below 1%). */
export const JOIN_FAILS_PER_HOUR_ALL = 200;
export const COINS_PER_STAR = 10;
/** A student client that has not polled state for this long shows as disconnected on the director console. */
export const STUDENT_PRESENCE_TTL_MS = 10_000;
/** A client that asks without `since` (first poll, reload) still sees a line or event spoken this recently. */
export const LESSON_LIVE_FRESH_MS = 20_000;
/** A client back from a long pause is not flooded with old bubbles. */
export const LESSON_LIVE_MAX_BACKLOG_MS = 120_000;
export const LESSON_LIVE_MAX_ITEMS = 20;
/**
 * Speaking time estimates for the per-minute progress table until WP-306 voice activity lands: teacher lines are
 * typed (no audio), and a student utterance without a measured duration is costed by words. Children speak about
 * 2 words/s in early lessons; adult teacher speech about 2.5 words/s.
 */
export const TEACHER_MS_PER_WORD = 400;
export const STUDENT_MS_PER_WORD = 500;
export const LESSON_MINUTES_MAX = 240;
export const TYPED_INPUT_MAX_STARS = 2;
/** A resend claim with no stored answer after this long is a request that died midway: the resend is processed. */
export const UTTERANCE_CLAIM_STALE_MS = 60_000;
const TYPED_INPUT_SOURCES: ReadonlySet<string> = new Set(['keyboard', 'board']);

export const LESSON_MODE_SCHEMA = `
create table if not exists lesson_joins (code text primary key, lesson_id text not null, player_id text not null, expires_at integer not null);
create table if not exists student_tokens (token_hash text primary key, lesson_id text not null, player_id text not null, expires_at integer not null);
create table if not exists lesson_state (lesson_id text primary key, plan_id text not null, stage_id text not null, targets text not null, updated_at integer not null);
create table if not exists join_failures (hour integer primary key, n integer not null);
create table if not exists join_failures_by_client (hour integer not null, client text not null, n integer not null, primary key (hour, client));
create table if not exists lesson_live (seq integer primary key autoincrement, id text not null unique, lesson_id text not null, at integer not null, type text not null, npc_id text, kind text, text text not null);
create index if not exists lesson_live_by_lesson on lesson_live (lesson_id, seq);
create index if not exists utterances_by_session on utterances (session_id, created_at);
create index if not exists utterances_by_player on utterances (player_id, created_at);
create index if not exists pins_by_lesson on pins (lesson_id, at_ms);
create table if not exists lesson_stage_log (id integer primary key autoincrement, lesson_id text not null, at integer not null, stage_id text not null);
create index if not exists lesson_stage_log_by_lesson on lesson_stage_log (lesson_id, at);
create table if not exists lesson_director (lesson_id text primary key, possessed_npc_id text, updated_at integer not null);
create table if not exists lesson_presence (lesson_id text primary key, last_seen_at integer not null, scene_id text, ui text);
create table if not exists lesson_utterance_clients (lesson_id text not null, client_id text not null, response text not null, at integer not null, primary key (lesson_id, client_id));
create table if not exists lesson_teacher (lesson_id text primary key, first_beat_at integer not null, last_beat_at integer not null, present_since integer not null, panel text not null default 'open', op_session text, name text, left_at integer, account_name text);
create table if not exists lesson_panel_lock (lesson_id text primary key, pin_hash text not null, set_at integer not null, fails integer not null default 0, fail_since integer)
`;

export interface LessonModeDeps {
  sql: SqliteExecutor;
  db: EdgePlatformDb;
  nowMs: () => number;
  randomBytes: (n: number) => Uint8Array;
  sha256Hex: (s: string) => Promise<string>;
  /** Runs the existing complete-and-send-report route so the report logic stays in one place. */
  completeLesson: (lessonId: string, body: Record<string, unknown>) => Promise<Response>;
  /**
   * The child's one coin ledger (home world, shared with solo orders). Lesson stars go in as stars × COINS_PER_STAR,
   * once per utterance; `coins_total` is its balance. Absent only in unit setups without worlds (then the old sum).
   */
  coins?: {
    credit: (playerId: string, delta: number, ref: string, nowMs: number) => number;
    balance: (playerId: string) => number;
  };
  /** Voice clips (voice.ts offerVoiceUpload): an upload token for a speech turn with voice_store on, else null. */
  offerVoiceUpload?: (p: { playerId: string; utteranceId: string; source: string; nowMs: number }) => Promise<VoiceUploadOfferLike | null>;
}

export interface VoiceUploadOfferLike {
  token: string;
  max_bytes: number;
  expires_at: number;
}

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/** Resolves a student bearer token to its one lesson and player (also used by the solo /v1/converse/score path). */
export async function studentFromRequest(
  d: Pick<LessonModeDeps, 'sql' | 'sha256Hex' | 'nowMs'>,
  req: Request
): Promise<{ lesson_id: string; player_id: string } | null> {
  const h = req.headers.get('authorization') ?? '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (token.length < 32) return null;
  return (
    d.sql.get<{ lesson_id: string; player_id: string }>(
      'select lesson_id, player_id from student_tokens where token_hash = ? and expires_at > ?',
      [await d.sha256Hex(token), d.nowMs()]
    ) ?? null
  );
}

export function makeJoinCode(bytes: Uint8Array): string {
  // 6 digits from 4 random bytes (bias < 0.03%)
  const n = ((bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!) >>> 0;
  return String(n % 1_000_000).padStart(6, '0');
}

const wordsOf = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;

/** Free talk has no single right sentence: length is the signal (docs/07 free utterances). */
export function scoreFreeTalk(transcript: string): { pass: boolean; score: number; stars: 0 | 1 | 2 | 3 } {
  const w = wordsOf(transcript);
  if (w < 3) return { pass: false, score: Math.min(1, w / 12), stars: 0 };
  return { pass: true, score: Math.min(1, w / 12), stars: w >= 12 ? 3 : w >= 6 ? 2 : 1 };
}

export function feedbackKo(r: {
  pass: boolean;
  stars: number;
  chosen: number;
  capped: boolean;
  mode: string;
  coreMissed?: boolean;
  typedCapped?: boolean;
}): string {
  if (!r.pass && r.coreMissed) return '내용은 좋아요! so that · because 같은 연결어를 넣어서 한 번 더 말해 볼까요?';
  if (!r.pass) return '거의 다 왔어요! 화면의 문장을 보면서 한 번 더 천천히 말해 볼까요?';
  if (r.typedCapped) return '좋아요! 다음엔 목소리로 말해 보면 별 3개까지 받을 수 있어요.';
  if (r.capped) return '좋아요! so that · because 같은 연결어까지 넣으면 별 3개예요.';
  if (r.mode === 'free') return r.stars >= 3 ? '와, 길게 잘 말했어요! 별 3개!' : '잘했어요! 조금 더 길게 이어 말하면 별이 늘어나요.';
  if (r.stars >= 3) return '완벽해요! 별 3개!';
  return r.stars >= r.chosen ? '통과! 다음엔 한 단계 위 문장에 도전해 볼까요?' : '통과했어요!';
}

const StartSchema = z
  .object({ player_id: z.string().min(1).max(64), plan_id: z.string().max(64).optional(), presence: z.boolean().optional() })
  .strict();
/**
 * source: 'console' = the /director heartbeat, 'panel' = the 1PC teacher panel on the child's screen. After "선생님 나가기"
 * (presence/leave, from the panel or the console) no beat counts until the teacher comes back on purpose: resume, sent
 * by the console's "다시 수업하기" or by the panel's first beat after its lock number. Otherwise whichever side was left
 * open on the same PC would undo the leave within 15 s. Only panel beats set the panel state; a console resume sets it
 * back to 'open' (no panel folded away any more).
 */
const PresenceSchema = z
  .object({
    panel: z.enum(['open', 'closed']).default('open'),
    source: z.enum(['console', 'panel']).default('console'),
    resume: z.boolean().optional(),
    // The name alone ("김민지", no "선생님"), typed on the console; the child sees teacherLabel(name). Blank (or only the
    // title) clears it. Typed name > the signed-in account's name > "선생님" (review #80).
    name: z
      .string()
      .max(64)
      .refine((v) => isBlankTeacherName(v) || normalizeTeacherName(v) !== null, 'invalid_name')
      .optional()
  })
  .strict();
/** Blank, or only the title typed: clears the typed name (back to the account name or "선생님"). */
function isBlankTeacherName(v: string): boolean {
  return v.replace(/선생님/g, '').trim() === '';
}
const PanelPinSchema = z.object({ pin: z.string().regex(/^\d{4,6}$/) }).strict();
const StageSchema = z
  .object({ stage_id: z.string().min(1).max(64), targets: z.array(z.string().min(1).max(200)).max(6) })
  .strict();
const PinSchema = z
  .object({
    kind: z.enum(['expression', 'coaching', 'highlight']),
    at_ms: z.number().int().min(0),
    note: z.string().max(300).default('')
  })
  .strict();
const EndSchema = z
  .object({ teacher_comment: z.string().max(400).default(''), next_lesson_at: z.string().max(60).default('') })
  .strict();
const NpcIdSchema = z.enum(LESSON_NPCS.map((n) => n.id) as [string, ...string[]]);
const NpcSaySchema = z.object({ npc_id: NpcIdSchema, text: z.string().trim().min(1).max(200) }).strict();
const PossessSchema = z.object({ npc_id: NpcIdSchema.nullable() }).strict();
const DIRECTOR_EVENT_KINDS = LESSON_DIRECTOR_EVENTS.map((e) => e.kind) as [DirectorEventKind, ...DirectorEventKind[]];
const EventSchema = z.object({ kind: z.enum(DIRECTOR_EVENT_KINDS), detail: z.string().max(200).default('') }).strict();
const JoinSchema = z.object({ code: z.string().regex(/^\d{6}$/) }).strict();
const UtteranceSchema = z
  .object({
    target_text: z.string().max(200).default(''),
    transcript: z.string().min(1).max(400),
    chosen_stars: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1),
    hint_level: z.enum(['full', 'keyword', 'initial', 'picture', 'none']).default('full'),
    latency_ms: z.number().int().min(0).max(600_000).default(0),
    dur_ms: z.number().int().min(0).max(600_000).default(0),
    stt_source: z.enum(['browser', 'keyboard', 'board', 'device', 'workers_ai']).default('browser'),
    confidence: z.number().min(0).max(1).default(1),
    // Disconnect recovery (packages/content lesson-outbox): one id per answer, so a resend is the same answer; the stage
    // the child answered in (an answer queued offline may arrive after the teacher moved on). It is stored at arrival
    // time: the console feed reads rows newer than its last look, and a back-dated row would never reach it.
    client_id: z.string().regex(UTTERANCE_CLIENT_ID_RE).optional(),
    stage_id: z.string().max(64).optional()
  })
  .strict();

function kstDay(ms: number): string {
  return new Date(ms + 9 * 3_600_000).toISOString().slice(0, 10);
}
function kstDayStartMs(day: string): number {
  return Date.parse(`${day}T00:00:00+09:00`);
}

/**
 * Every minute from the start to now (or the end), silent minutes included, so the chart shows gaps. `complete`
 * says whether the last minute is over (a running lesson's current minute is not yet a silent minute).
 * Shared by the director feed and the operator CSV export (export-csv.ts).
 */
export function lessonMinutes(
  d: Pick<LessonModeDeps, 'sql' | 'db' | 'nowMs'>,
  id: string,
  endingAt?: number
): { minutes: LessonMinuteInput[]; complete: number } {
  const l = d.sql.get<{ started_at: number; ended_at: number | null }>('select started_at, ended_at from lessons where id = ?', [id]);
  if (!l) return { minutes: [], complete: 0 };
  const stored = new Map(d.db.listLessonMinutes(id).map((m) => [m.minute, m]));
  const stages = d.sql.all<{ at: number; stage_id: string }>(
    'select at, stage_id from lesson_stage_log where lesson_id = ? order by at, id',
    [id]
  );
  const endAt = l.ended_at ?? endingAt ?? d.nowMs();
  const elapsed = Math.max(0, endAt - l.started_at);
  const last = Math.min(LESSON_MINUTES_MAX - 1, Math.floor(elapsed / 60_000));
  const out: LessonMinuteInput[] = [];
  let si = 0;
  let stage =
    stages[0]?.stage_id ??
    d.sql.get<{ stage_id: string }>('select stage_id from lesson_state where lesson_id = ?', [id])?.stage_id ??
    'lesson';
  for (let m = 0; m <= last; m++) {
    const minuteEnd = l.started_at + (m + 1) * 60_000 - 1;
    while (si < stages.length && stages[si]!.at <= minuteEnd) stage = stages[si++]!.stage_id;
    out.push(stored.get(m) ?? { lesson_id: id, minute: m, student_ms: 0, teacher_ms: 0, exchanges: 0, activity: stage });
  }
  const complete = l.ended_at || endingAt ? out.length : Math.min(out.length, Math.floor(elapsed / 60_000));
  return { minutes: out, complete };
}

export function buildLessonModeApp(d: LessonModeDeps): Hono {
  d.sql.exec(LESSON_MODE_SCHEMA);
  // lesson_presence predates the mic column: add it once on an existing database.
  if (!d.sql.all<{ name: string }>('pragma table_info(lesson_presence)').some((col) => col.name === 'mic')) {
    d.sql.exec('alter table lesson_presence add column mic text');
  }
  const teacherCols = d.sql.all<{ name: string }>('pragma table_info(lesson_teacher)').map((col) => col.name);
  if (!teacherCols.includes('left_at')) d.sql.exec('alter table lesson_teacher add column left_at integer');
  if (!teacherCols.includes('account_name')) d.sql.exec('alter table lesson_teacher add column account_name text');
  const app = new Hono();
  // Hub cards for the teacher (after-lesson summary, student's daily record): an outbox the spine side pulls.
  mountOpsCardRoutes(app, d);

  const lessonRow = (id: string) =>
    d.sql.get<{ id: string; player_id: string; started_at: number; ended_at: number | null; plan: string }>(
      'select id, player_id, started_at, ended_at, plan from lessons where id = ?',
      [id]
    );
  /** The signed-in account's name alone (same join as the teacher sign-in, #87), or null: no session, no tables yet. */
  const sessionNameOf = (opSession: string | null): string | null => {
    if (!opSession) return null;
    try {
      // operator-login.ts: the session's label is the device ("Chrome on Windows"); the name is the Google account's.
      const r = d.sql.get<{ name: string | null }>(
        'select o.name as name from operator_sessions s join operators o on o.id = s.operator_id where s.id = ?',
        [opSession]
      );
      return normalizeTeacherName(r?.name);
    } catch {
      return null; /* no operator tables (a platform without Google sign-in) */
    }
  };
  /** panel null = keep the panel state (console beats); a beat always clears an earlier leave. */
  /** typedName undefined = this beat says nothing about the name (1PC panel, an older console): keep it; blank clears. */
  const beat = (lessonId: string, now: number, panel: 'open' | 'closed' | null, opSession: string | null, typedName?: string) => {
    const typed = typedName === undefined ? undefined : normalizeTeacherName(typedName);
    const prev = d.sql.get<{ last_beat_at: number; present_since: number }>(
      'select last_beat_at, present_since from lesson_teacher where lesson_id = ?',
      [lessonId]
    );
    // A gap longer than the present window starts a new stretch of presence.
    const since = prev && now - prev.last_beat_at <= TEACHER_PRESENT_MS ? prev.present_since : now;
    d.sql.run(
      `insert into lesson_teacher (lesson_id, first_beat_at, last_beat_at, present_since, panel, op_session, name, account_name, left_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, null)
       on conflict(lesson_id) do update set last_beat_at = excluded.last_beat_at, present_since = excluded.present_since,
         panel = coalesce(?, lesson_teacher.panel), op_session = coalesce(excluded.op_session, lesson_teacher.op_session),
         name = case when ? then excluded.name else lesson_teacher.name end,
         account_name = coalesce(excluded.account_name, lesson_teacher.account_name), left_at = null`,
      [lessonId, now, now, since, panel ?? 'open', opSession, typed ?? null, sessionNameOf(opSession), panel, typed === undefined ? 0 : 1]
    );
  };
  const teacherOf = (lessonId: string, now: number): TeacherPresence => {
    const l = lessonRow(lessonId);
    if (!l || l.ended_at) return { present: false, name: null, since: null, tracked: true, panel: null };
    const t = d.sql.get<{ last_beat_at: number; present_since: number; panel: string; name: string | null; account_name: string | null }>(
      'select last_beat_at, present_since, panel, name, account_name from lesson_teacher where lesson_id = ?',
      [lessonId]
    );
    // name is the name alone or null; the child's screen shows teacherLabel(name) ("선생님" for null).
    if (!t) return { present: true, name: null, since: l.started_at, tracked: false, panel: null };
    const present = now - t.last_beat_at <= TEACHER_PRESENT_MS;
    return {
      present,
      name: present ? (t.name ?? t.account_name ?? null) : null,
      since: present ? t.present_since : null,
      tracked: true,
      panel: present ? (t.panel === 'closed' ? 'closed' : 'open') : null
    };
  };
  const stateOf = (id: string) => {
    const s = d.sql.get<{ plan_id: string; stage_id: string; targets: string }>(
      'select plan_id, stage_id, targets from lesson_state where lesson_id = ?',
      [id]
    );
    return s ? { plan_id: s.plan_id, stage_id: s.stage_id, targets: JSON.parse(s.targets) as string[] } : null;
  };
  const planStage = (plan: LessonPlan, stageId: string) => plan.stages.find((s) => s.id === stageId);
  const possessedOf = (id: string) =>
    d.sql.get<{ possessed_npc_id: string | null }>('select possessed_npc_id from lesson_director where lesson_id = ?', [id])
      ?.possessed_npc_id ?? null;
  const setPossessed = (id: string, npcId: string | null) =>
    d.sql.run('insert or replace into lesson_director (lesson_id, possessed_npc_id, updated_at) values (?, ?, ?)', [
      id,
      npcId,
      d.nowMs()
    ]);
  const logStage = (id: string, stageId: string, at: number) =>
    d.sql.run('insert into lesson_stage_log (lesson_id, at, stage_id) values (?, ?, ?)', [id, at, stageId]);
  const stageAt = (id: string, at: number) =>
    d.sql.get<{ stage_id: string }>(
      'select stage_id from lesson_stage_log where lesson_id = ? and at <= ? order by at desc, id desc limit 1',
      [id, at]
    )?.stage_id ??
    stateOf(id)?.stage_id ??
    'lesson';
  /** Targets as dialog offers (docs/19 §3): plan sentences keep their stars and core tags; a sentence the teacher
   * typed gets stars by its place in the list. */
  const offersOf = (plan: LessonPlan, targets: readonly string[]) =>
    targets.map((text, i) => {
      const t = plan.stages.flatMap((x) => x.targets).find((x) => x.text === text);
      return t
        ? { stars: t.stars, text: t.text, hintTags: t.hintTags }
        : { stars: Math.min(3, i + 1) as 1 | 2 | 3, text, hintTags: [] as string[] };
    });

  /**
   * Per-minute progress (WP-304 LessonDO.recordMinute): rebuilt from what is stored for that minute, so a retry or
   * an out-of-order write converges on the same row.
   */
  const recordMinuteAt = (id: string, at: number) => {
    const l = lessonRow(id);
    if (!l || at < l.started_at) return;
    const minute = Math.floor((at - l.started_at) / 60_000);
    if (minute >= LESSON_MINUTES_MAX) return;
    const from = l.started_at + minute * 60_000;
    const to = from + 60_000;
    const st = d.sql.get<{ n: number; ms: number }>(
      `select count(*) as n, coalesce(sum(case when dur_ms > 0 then dur_ms else words * ${STUDENT_MS_PER_WORD} end), 0) as ms
       from utterances where session_id = ? and created_at >= ? and created_at < ?`,
      [id, from, to]
    );
    const lines = d.sql.all<{ text: string }>(
      "select text from lesson_live where lesson_id = ? and type = 'line' and at >= ? and at < ?",
      [id, from, to]
    );
    const teacherMs = lines.reduce((a, x) => a + wordsOf(x.text) * TEACHER_MS_PER_WORD, 0);
    new LessonDO(id, d.db, l.player_id, 'lesson-mode', l.started_at).recordMinute({
      minute,
      studentMs: Number(st?.ms ?? 0),
      teacherMs,
      exchanges: Number(st?.n ?? 0),
      activity: stageAt(id, to - 1)
    });
  };

  /** Every minute of the lesson (see lessonMinutes; the CSV export reads the same table). */
  const minutesOf = (id: string, endingAt?: number) => lessonMinutes(d, id, endingAt);

  const lessonUtterances = (id: string): UtteranceMetricInput[] =>
    d.sql
      .all<Record<string, unknown>>('select * from utterances where session_id = ? order by created_at', [id])
      .map((u) => ({ ...u, lesson_id: id }) as unknown as UtteranceMetricInput);

  /** Talk balance of this lesson only (computeLessonMetrics over this lesson's finished minutes and utterances). */
  const progressOf = (id: string, mins = minutesOf(id)) => {
    const m = computeLessonMetrics(id, mins.minutes.slice(0, Math.max(mins.complete, 0)).concat(
      // the running minute still counts its talk, just not as silence
      mins.minutes.slice(mins.complete).filter((x) => x.student_ms > 0 || x.exchanges > 0)
    ), lessonUtterances(id));
    return {
      student_ms: m.student_ms,
      teacher_ms: m.teacher_ms,
      student_talk_ratio: m.student_talk_ratio,
      exchanges: m.exchanges,
      long_silence_minutes: m.long_silence_minutes,
      mode_breakdown: m.mode_breakdown
    };
  };

  /** The lesson plan's target sentences (with core-pattern tags): what a pinned fragment can grow into. */
  const planTargetsOf = (id: string) =>
    getLessonPlan(d.sql.get<{ plan: string }>('select plan from lessons where id = ?', [id])?.plan || undefined).stages.flatMap(
      (s) => s.targets
    );

  /** F1/F2 pin windows (docs/10 §2): 30 s either side of each pin over the student's and the teacher's lines. */
  const pinWindowsOf = (id: string) => {
    const l = lessonRow(id);
    if (!l) return [];
    const transcript: BookmarkTranscriptLine[] = [
      ...d.sql
        .all<{ at: number; text: string }>(
          'select created_at as at, final_text as text from utterances where session_id = ? order by created_at',
          [id]
        )
        .map((u) => ({ at_ms: u.at - l.started_at, speaker: 'student' as const, text: u.text })),
      ...d.sql
        .all<{ at: number; text: string }>("select at, text from lesson_live where lesson_id = ? and type = 'line' order by seq", [id])
        .map((x) => ({ at_ms: x.at - l.started_at, speaker: 'teacher' as const, text: x.text }))
    ];
    const pins = d.sql.all<{ id: string; kind: string; at_ms: number; note: string }>(
      'select id, kind, at_ms, note from pins where lesson_id = ? order by at_ms',
      [id]
    );
    const windows = extractBookmarkWindows(
      pins.map((p) => ({ kind: p.kind === 'expression' ? ('expression' as const) : ('coaching' as const), at_ms: p.at_ms })),
      transcript,
      undefined,
      planTargetsOf(id)
    );
    return pins.map((p, i) => {
      const w = windows[i]!;
      return {
        pin_id: p.id,
        kind: p.kind,
        note: p.note,
        at_ms: p.at_ms,
        window_start_ms: w.window_start_ms,
        window_end_ms: w.window_end_ms,
        lines: w.lines,
        candidate_expressions: w.candidate_expressions
      };
    });
  };

  type LiveRow = { seq: number; id: string; at: number; type: string; npc_id: string | null; kind: string | null; text: string };
  const splitLive = (rows: LiveRow[]) => ({
    npc_lines: rows.filter((r) => r.type === 'line').map((r) => ({ id: r.id, seq: r.seq, at: r.at, npc_id: r.npc_id ?? '', text: r.text })),
    events: rows.filter((r) => r.type === 'event').map((r) => ({ id: r.id, seq: r.seq, at: r.at, kind: r.kind ?? '', detail: r.text }))
  });
  const maxSeq = (id: string) =>
    Number(d.sql.get<{ s: number | null }>('select max(seq) as s from lesson_live where lesson_id = ?', [id])?.s ?? 0);
  /**
   * NPC lines and events for a polling student (docs/19 §4). The cursor is the row sequence, never a clock, so two
   * rows written in the same millisecond are both delivered once. Without a cursor (first poll, reload) only lines of
   * the last 20 s are shown and no event is replayed; a client back from a long pause skips rows older than 2 min.
   */
  const liveForStudent = (id: string, rawCursor: string | undefined, now: number) => {
    const cursor = Number(rawCursor ?? '');
    if (!Number.isFinite(cursor) || rawCursor === undefined || rawCursor === '' || cursor < 0) {
      const rows = d.sql.all<LiveRow>(
        "select * from lesson_live where lesson_id = ? and type = 'line' and at > ? order by seq desc limit ?",
        [id, now - LESSON_LIVE_FRESH_MS, LESSON_LIVE_MAX_ITEMS]
      );
      return { ...splitLive(rows.reverse()), cursor: maxSeq(id) };
    }
    const rows = d.sql.all<LiveRow>('select * from lesson_live where lesson_id = ? and seq > ? order by seq limit ?', [
      id,
      cursor,
      LESSON_LIVE_MAX_ITEMS
    ]);
    const next = rows.length ? rows[rows.length - 1]!.seq : cursor;
    return { ...splitLive(rows.filter((r) => r.at >= now - LESSON_LIVE_MAX_BACKLOG_MS)), cursor: next };
  };
  const insertLive = (row: { id: string; lessonId: string; at: number; type: 'line' | 'event'; npcId?: string; kind?: string; text: string }) =>
    d.sql.run('insert into lesson_live (id, lesson_id, at, type, npc_id, kind, text) values (?, ?, ?, ?, ?, ?, ?)', [
      row.id,
      row.lessonId,
      row.at,
      row.type,
      row.npcId ?? null,
      row.kind ?? null,
      row.text
    ]);

  /* ---------- operator ---------- */

  app.get('/v1/admin/students', (c) => {
    const since = d.nowMs() - 7 * 86_400_000;
    const rows = d.sql.all<Record<string, unknown>>(
      `select p.id as player_id, p.nickname, p.level, p.birth_year, p.family_id,
              (select max(started_at) from lessons l where l.player_id = p.id) as last_lesson_at,
              (select count(*) from utterances u where u.player_id = p.id and u.created_at >= ?) as utterances_7d,
              ${LINKED_DEVICES_SQL} as linked_devices,
              ${WORLD_SEEN_SQL('p.id')} as world_seen_at
       from players p where p.id not like 'smoke-%' and p.id <> 'player-demo' order by p.nickname`,
      [since, d.nowMs() - LINKED_DEVICE_TTL_MS]
    );
    return c.json(rows);
  });

  app.post('/v1/admin/lessons/start', async (c) => {
    const p = StartSchema.safeParse(await c.req.json());
    if (!p.success) return c.json({ error: 'invalid', issues: p.error.issues }, 400);
    const player = d.sql.get<{ id: string }>('select id from players where id = ?', [p.data.player_id]);
    if (!player) return c.json({ error: 'player_not_found' }, 404);
    const now = d.nowMs();
    const plan = getLessonPlan(p.data.plan_id);
    const lessonId = `les-${kstDay(now).replace(/-/g, '')}-${hex(d.randomBytes(4))}`;
    new LessonDO(lessonId, d.db, p.data.player_id, 'lesson-mode', now);
    d.sql.run('update lessons set plan = ? where id = ?', [plan.id, lessonId]);
    let code = makeJoinCode(d.randomBytes(4));
    for (let i = 0; i < 5 && d.sql.get('select code from lesson_joins where code = ? and expires_at > ?', [code, now]); i++) {
      code = makeJoinCode(d.randomBytes(4));
    }
    d.sql.run('insert or replace into lesson_joins (code, lesson_id, player_id, expires_at) values (?, ?, ?, ?)', [
      code,
      lessonId,
      p.data.player_id,
      now + JOIN_CODE_TTL_MS
    ]);
    const first = plan.stages[0]!;
    d.sql.run(
      'insert or replace into lesson_state (lesson_id, plan_id, stage_id, targets, updated_at) values (?, ?, ?, ?, ?)',
      [lessonId, plan.id, first.id, JSON.stringify(first.targets.map((t) => t.text)), now]
    );
    logStage(lessonId, first.id, now);
    setPossessed(lessonId, null);
    // A console that beats says so at start: the start is the first beat (an old console never does: see above).
    if (p.data.presence) beat(lessonId, now, 'open', c.req.header('x-lcw-op-session') ?? null);
    const linked = d.sql.get<{ n: number }>(`select ${LINKED_DEVICES_SQL} as n from players p where p.id = ?`, [now - LINKED_DEVICE_TTL_MS, p.data.player_id])?.n;
    return c.json({ lesson_id: lessonId, join_code: code, expires_at: now + JOIN_CODE_TTL_MS, plan, linked_devices: Number(linked ?? 0) }, 201);
  });

  /*
   * 1PC teacher panel lock. The panel opens over the child's own screen on the PC the teacher signed in on, so the
   * operator credentials are in that browser already; the lock number keeps the child from opening it. It is checked
   * here, never in the page, and a few wrong tries lock it for ten minutes.
   */
  app.post('/v1/admin/lessons/:id/panel-pin', async (c) => {
    const id = c.req.param('id');
    if (!lessonRow(id)) return c.json({ error: 'lesson_not_found' }, 404);
    const p = PanelPinSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!p.success) return c.json({ error: 'invalid', issues: p.error.issues }, 400);
    const hash = await d.sha256Hex(`panel:${id}:${p.data.pin}`);
    d.sql.run('insert or replace into lesson_panel_lock (lesson_id, pin_hash, set_at, fails, fail_since) values (?, ?, ?, 0, null)', [
      id,
      hash,
      d.nowMs()
    ]);
    return c.json({ ok: true });
  });
  app.get('/v1/admin/lessons/:id/panel-pin', (c) => {
    const r = d.sql.get<{ set_at: number }>('select set_at from lesson_panel_lock where lesson_id = ?', [c.req.param('id')]);
    return c.json({ set: Boolean(r), set_at: r?.set_at ?? null });
  });
  app.post('/v1/admin/lessons/:id/panel-unlock', async (c) => {
    const id = c.req.param('id');
    const p = PanelPinSchema.safeParse(await c.req.json().catch(() => ({})));
    const hash = p.success ? await d.sha256Hex(`panel:${id}:${p.data.pin}`) : '';
    const now = d.nowMs();
    const lock = d.sql.get<{ pin_hash: string; fails: number; fail_since: number | null }>(
      'select pin_hash, fails, fail_since from lesson_panel_lock where lesson_id = ?',
      [id]
    );
    if (!lock) return c.json({ error: 'no_pin' }, 409);
    const windowOpen = lock.fail_since !== null && now - lock.fail_since < PANEL_FAIL_WINDOW_MS;
    if (windowOpen && lock.fails >= PANEL_FAILS_MAX) return c.json({ error: 'too_many_attempts' }, 429);
    if (lock.pin_hash !== hash) {
      d.sql.run('update lesson_panel_lock set fails = ?, fail_since = ? where lesson_id = ?', [
        windowOpen ? lock.fails + 1 : 1,
        windowOpen ? lock.fail_since : now,
        id
      ]);
      return c.json({ error: 'wrong_pin' }, 403);
    }
    d.sql.run('update lesson_panel_lock set fails = 0, fail_since = null where lesson_id = ?', [id]);
    return c.json({ ok: true });
  });

  /** The teacher steps away on purpose (1PC panel "선생님 나가기"): alone at once, not 45 s later. */
  app.post('/v1/admin/lessons/:id/presence/leave', (c) => {
    const id = c.req.param('id');
    if (!lessonRow(id)) return c.json({ error: 'lesson_not_found' }, 404);
    const now = d.nowMs();
    const gone = now - TEACHER_PRESENT_MS - 1;
    d.sql.run(
      `insert into lesson_teacher (lesson_id, first_beat_at, last_beat_at, present_since, panel, left_at) values (?, ?, ?, ?, 'closed', ?)
       on conflict(lesson_id) do update set last_beat_at = excluded.last_beat_at, panel = 'closed', left_at = excluded.left_at`,
      [id, gone, gone, gone, now]
    );
    return c.json({ teacher: teacherOf(id, now), left: true });
  });

  app.post('/v1/admin/lessons/:id/presence', async (c) => {
    const id = c.req.param('id');
    const l = lessonRow(id);
    if (!l) return c.json({ error: 'lesson_not_found' }, 404);
    const p = PresenceSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!p.success) return c.json({ error: 'invalid', issues: p.error.issues }, 400);
    if (l.ended_at) return c.json({ error: 'lesson_ended' }, 409);
    const now = d.nowMs();
    const fromPanel = p.data.source === 'panel';
    const left = d.sql.get<{ left_at: number | null }>('select left_at from lesson_teacher where lesson_id = ?', [id])?.left_at ?? null;
    // The teacher left on purpose: a console or an unlocked panel still beating does not bring them back.
    if (left !== null && !p.data.resume) {
      return c.json({ teacher: teacherOf(id, now), left: true, beat_ms: TEACHER_BEAT_MS, present_ms: TEACHER_PRESENT_MS });
    }
    beat(id, now, fromPanel ? p.data.panel : p.data.resume ? 'open' : null, c.req.header('x-lcw-op-session') ?? null, p.data.name);
    return c.json({ teacher: teacherOf(id, now), left: false, beat_ms: TEACHER_BEAT_MS, present_ms: TEACHER_PRESENT_MS });
  });

  app.post('/v1/admin/lessons/:id/stage', async (c) => {
    const id = c.req.param('id');
    const l = lessonRow(id);
    if (!l) return c.json({ error: 'lesson_not_found' }, 404);
    const p = StageSchema.safeParse(await c.req.json());
    if (!p.success) return c.json({ error: 'invalid', issues: p.error.issues }, 400);
    d.sql.run(
      'insert or replace into lesson_state (lesson_id, plan_id, stage_id, targets, updated_at) values (?, ?, ?, ?, ?)',
      [id, l.plan || 'first_lesson_v1', p.data.stage_id, JSON.stringify(p.data.targets), d.nowMs()]
    );
    const prev = d.sql.get<{ stage_id: string }>(
      'select stage_id from lesson_stage_log where lesson_id = ? order by at desc, id desc limit 1',
      [id]
    );
    if (prev?.stage_id !== p.data.stage_id) logStage(id, p.data.stage_id, d.nowMs());
    return c.json({ ok: true });
  });

  /* Possession and NPC lines (WP-305): the teacher speaks as an NPC; the student's world shows the bubble with a
     sparkle on that NPC only (docs/10 §2). Saying a line as an NPC also possesses it. */
  app.post('/v1/admin/lessons/:id/npc-say', async (c) => {
    const id = c.req.param('id');
    const l = lessonRow(id);
    if (!l) return c.json({ error: 'lesson_not_found' }, 404);
    if (l.ended_at) return c.json({ error: 'lesson_ended' }, 409);
    const p = NpcSaySchema.safeParse(await c.req.json().catch(() => null));
    if (!p.success) return c.json({ error: 'invalid', issues: p.error.issues }, 400);
    const at = d.nowMs();
    const lineId = `npc-${hex(d.randomBytes(6))}`;
    insertLive({ id: lineId, lessonId: id, at, type: 'line', npcId: p.data.npc_id, text: p.data.text });
    setPossessed(id, p.data.npc_id);
    recordMinuteAt(id, at);
    return c.json({ ok: true, id: lineId, at }, 201);
  });

  app.post('/v1/admin/lessons/:id/possess', async (c) => {
    const id = c.req.param('id');
    const l = lessonRow(id);
    if (!l) return c.json({ error: 'lesson_not_found' }, 404);
    if (l.ended_at) return c.json({ error: 'lesson_ended' }, 409);
    const p = PossessSchema.safeParse(await c.req.json().catch(() => null));
    if (!p.success) return c.json({ error: 'invalid', issues: p.error.issues }, 400);
    setPossessed(id, p.data.npc_id);
    return c.json({ ok: true, possessed_npc_id: p.data.npc_id });
  });

  /* Director events (WP-305, six kinds): stored with the lesson, played once on the student's screen. */
  app.post('/v1/admin/lessons/:id/event', async (c) => {
    const id = c.req.param('id');
    const l = lessonRow(id);
    if (!l) return c.json({ error: 'lesson_not_found' }, 404);
    if (l.ended_at) return c.json({ error: 'lesson_ended' }, 409);
    const p = EventSchema.safeParse(await c.req.json().catch(() => null));
    if (!p.success) return c.json({ error: 'invalid', issues: p.error.issues }, 400);
    const at = d.nowMs();
    const eventId = `evt-${hex(d.randomBytes(6))}`;
    insertLive({ id: eventId, lessonId: id, at, type: 'event', kind: p.data.kind, text: p.data.detail });
    return c.json({ ok: true, id: eventId, at }, 201);
  });

  /** Report draft material for the teacher only (T03): transcripts stay off the public report. */
  app.get('/v1/admin/lessons/:id/pin-windows', (c) => {
    const id = c.req.param('id');
    if (!lessonRow(id)) return c.json({ error: 'lesson_not_found' }, 404);
    return c.json(pinWindowsOf(id));
  });

  app.get('/v1/admin/lesson-plans', (c) => c.json(LESSON_PLANS));
  app.get('/v1/admin/lesson-npcs', (c) => c.json(LESSON_NPCS));
  app.get('/v1/admin/director-events', (c) => c.json(LESSON_DIRECTOR_EVENTS));

  /**
   * Lessons still running (no end, started within the join code's life), for a console opened on another device:
   * the code, the plan, the current stage and the time per stage come from the server, not the starting browser.
   */
  app.get('/v1/admin/lessons/live', (c) => {
    const now = d.nowMs();
    // `include_test=1` (operator smoke checks in production): smoke-/demo students too. Default leaves them out.
    const withTest = c.req.query('include_test') === '1';
    const rows = d.sql.all<{ lesson_id: string; player_id: string; nickname: string | null; plan: string | null; started_at: number; world_seen_at: number | null }>(
      `select l.id as lesson_id, l.player_id, p.nickname, l.plan, l.started_at, ${WORLD_SEEN_SQL('l.player_id')} as world_seen_at
       from lessons l left join players p on p.id = l.player_id
       where l.ended_at is null and l.started_at >= ?${withTest ? '' : ` and l.player_id not like 'smoke-%' and l.player_id <> 'player-demo'`}
       order by l.started_at desc limit 20`,
      [now - JOIN_CODE_TTL_MS]
    );
    const lessons = rows.flatMap((r) => {
      const join = d.sql.get<{ code: string; expires_at: number }>(
        'select code, expires_at from lesson_joins where lesson_id = ? and expires_at > ? order by expires_at desc limit 1',
        [r.lesson_id, now]
      );
      if (!join) return [];
      const st = stateOf(r.lesson_id);
      const log = d.sql.all<{ at: number; stage_id: string }>(
        'select at, stage_id from lesson_stage_log where lesson_id = ? order by at, id',
        [r.lesson_id]
      );
      const stageMs: Record<string, number> = {};
      for (let i = 0; i + 1 < log.length; i++) {
        const cur = log[i]!;
        stageMs[cur.stage_id] = (stageMs[cur.stage_id] ?? 0) + Math.max(0, log[i + 1]!.at - cur.at);
      }
      const last = log[log.length - 1];
      return [
        {
          lesson_id: r.lesson_id,
          join_code: join.code,
          expires_at: join.expires_at,
          plan_id: getLessonPlan(st?.plan_id ?? r.plan ?? undefined).id,
          player_id: r.player_id,
          nickname: r.nickname ?? r.player_id,
          started_at: r.started_at,
          stage_id: st?.stage_id ?? last?.stage_id ?? null,
          stage_started_at: last?.at ?? r.started_at,
          stage_ms: stageMs,
          world_seen_at: r.world_seen_at ?? null
        }
      ];
    });
    return c.json({ lessons, server_now: now });
  });

  /** Lessons of one KST day for the hub (report check, send to parent). */
  app.get('/v1/admin/lessons', (c) => {
    const day = /^\d{4}-\d{2}-\d{2}$/.test(c.req.query('day') ?? '') ? c.req.query('day')! : kstDay(d.nowMs());
    const from = kstDayStartMs(day);
    const rows = d.sql.all<Record<string, unknown>>(
      `select l.id, l.player_id, p.nickname, l.plan, l.started_at, l.ended_at,
              (select share_token from reports r where r.ref_id = l.id and r.kind = 'lesson' order by created_at desc limit 1) as share_token,
              (select count(*) from utterances u where u.session_id = l.id) as utterances,
              (select count(*) from utterances u where u.session_id = l.id and u.stars > 0) as passes
       from lessons l left join players p on p.id = l.player_id
       where l.started_at >= ? and l.started_at < ? and l.player_id not like 'smoke-%' order by l.started_at`,
      [from, from + 86_400_000]
    );
    return c.json({
      day,
      lessons: rows.map(({ share_token, ...r }) => ({ ...r, report_path: share_token ? `/r/${String(share_token)}` : null }))
    });
  });

  app.post('/v1/admin/lessons/:id/pins', async (c) => {
    const id = c.req.param('id');
    if (!lessonRow(id)) return c.json({ error: 'lesson_not_found' }, 404);
    const p = PinSchema.safeParse(await c.req.json());
    if (!p.success) return c.json({ error: 'invalid', issues: p.error.issues }, 400);
    const pinId = `pin-${hex(d.randomBytes(6))}`;
    d.sql.run('insert into pins (id, lesson_id, at_ms, kind, note) values (?, ?, ?, ?, ?)', [
      pinId,
      id,
      p.data.at_ms,
      p.data.kind,
      p.data.note
    ]);
    return c.json({ ok: true, id: pinId }, 201);
  });

  app.get('/v1/admin/lessons/:id/feed', (c) => {
    const id = c.req.param('id');
    const l = lessonRow(id);
    if (!l) return c.json({ error: 'lesson_not_found' }, 404);
    const since = Number(c.req.query('since') ?? 0) || 0;
    const nick = d.sql.get<{ nickname: string }>('select nickname from players where id = ?', [l.player_id]);
    const st = stateOf(id);
    const utterances = d.sql
      .all<Record<string, unknown>>(
        `select id, created_at as at, target_text, final_text as transcript, stars, score, hint_level, mode
         from utterances where session_id = ? and created_at > ? order by created_at`,
        [id, since]
      )
      .map((u) => ({ ...u, pass: Number(u.stars) > 0 }));
    const pins = d.sql.all('select id, kind, at_ms, note from pins where lesson_id = ? order by at_ms', [id]);
    const live = d.sql.get<Record<string, number>>(
      `select count(*) as utterances, coalesce(sum(case when stars > 0 then 1 else 0 end), 0) as passes,
              coalesce(sum(stars), 0) as stars_total, coalesce(sum(words), 0) as words_total,
              coalesce(sum(dur_ms), 0) as student_speaking_ms
       from utterances where session_id = ?`,
      [id]
    );
    const now = d.nowMs();
    const presence = d.sql.get<{ last_seen_at: number; scene_id: string | null; ui: string | null; mic: string | null }>(
      'select last_seen_at, scene_id, ui, mic from lesson_presence where lesson_id = ?',
      [id]
    );
    const lastUtt = d.sql.get<Record<string, unknown>>(
      `select created_at as at, target_text, final_text as transcript, stars from utterances
       where session_id = ? order by created_at desc limit 1`,
      [id]
    );
    const plan = getLessonPlan(st?.plan_id);
    const stage = st ? planStage(plan, st.stage_id) : undefined;
    const mins = minutesOf(id);
    return c.json({
      lesson: {
        id,
        player_id: l.player_id,
        nickname: nick?.nickname ?? l.player_id,
        started_at: l.started_at,
        ended_at: l.ended_at,
        stage_id: st?.stage_id ?? null,
        targets: st?.targets ?? [],
        plan_id: plan.id,
        possessed_npc_id: possessedOf(id)
      },
      utterances,
      pins,
      live,
      ...splitLive(
        d.sql.all<LiveRow>('select * from lesson_live where lesson_id = ? and seq > ? order by seq', [
          id,
          Math.max(0, Number(c.req.query('live_cursor') ?? 0) || 0)
        ])
      ),
      live_cursor: maxSeq(id),
      stage_log: d.sql.all('select at, stage_id from lesson_stage_log where lesson_id = ? order by at, id', [id]),
      minutes: mins.minutes.map(({ lesson_id: _l, ...m }) => m),
      progress: progressOf(id, mins),
      student_view: {
        connected: Boolean(presence && now - presence.last_seen_at <= STUDENT_PRESENCE_TTL_MS),
        last_seen_at: presence?.last_seen_at ?? null,
        scene_id: presence?.scene_id ?? null,
        ui: presence?.ui ?? null,
        // The child's one-time mic check on this device (talk lane): ok | quiet | none | skipped, null = not reported.
        mic: presence?.mic ?? null,
        expected_scene_id: stage?.sceneId ?? null,
        goal_ko: stage?.studentGoalKo ?? '',
        targets: st?.targets ?? [],
        last_utterance: lastUtt ? { ...lastUtt, pass: Number(lastUtt.stars) > 0 } : null
      },
      // What the child's world says about the teacher right now (the console's own heartbeat, read back).
      teacher: teacherOf(id, now),
      server_now: now
    });
  });

  app.post('/v1/admin/lessons/:id/end', async (c) => {
    const id = c.req.param('id');
    const l = lessonRow(id);
    if (!l) return c.json({ error: 'lesson_not_found' }, 404);
    const p = EndSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!p.success) return c.json({ error: 'invalid', issues: p.error.issues }, 400);
    // Ended already (another device, a double tap): hand back the report that exists. A new one would replace the
    // share token and the comment, and the link the teacher already sent to the parent would stop opening.
    if (l.ended_at) {
      const prev = d.sql.get<{ share_token: string; facts: string }>(
        `select share_token, facts from reports where ref_id = ? and kind = 'lesson' and share_token is not null order by created_at desc limit 1`,
        [id]
      );
      if (prev) {
        let facts: unknown = null;
        try {
          facts = JSON.parse(prev.facts);
        } catch {
          facts = null;
        }
        return c.json({ report_path: `/r/${prev.share_token}`, share_token: prev.share_token, facts, pin_windows: pinWindowsOf(id), already_ended: true });
      }
    }
    const guardian = d.sql.get<{ id: string }>(
      'select g.id from guardians g join players p on p.family_id = g.family_id where p.id = ? limit 1',
      [l.player_id]
    );
    const token = hex(d.randomBytes(16));
    const pinWindows = pinWindowsOf(id);
    // F2 pins become lesson-born expressions (WP-310 transfer tracking): the teacher's note, else the top candidate,
    // as a whole unit ("Can I have" -> the child's "Can I have a warm honey tea?"); fragments nothing explains are dropped.
    const targets = planTargetsOf(id);
    for (const w of pinWindows) {
      const note = /[A-Za-z]{2,}/.test(w.note) ? w.note.trim() : '';
      const said = w.lines.filter((x) => x.speaker === 'student').map((x) => x.text).reverse();
      // The lemma stays the pattern the teacher pinned ("can I have"): transfer tracking looks for it in solo play
      // (every lemma token must reappear), so a whole sentence would almost never count. A note that nothing in the
      // lesson explains (a remark, "for your") is not a pattern: the top candidate line stands in.
      const pattern = note && meaningfulExpression(note, { utterances: said, targets }) ? note : '';
      const lemma = w.kind === 'expression' ? (pattern || w.candidate_expressions[0] || '').slice(0, 120) : '';
      if (lemma) {
        d.db.registerLessonExpression({ id: `expr-${w.pin_id}`, playerId: l.player_id, lemmaKey: lemma, lessonId: id, nowMs: d.nowMs() });
      }
    }
    const res = await d.completeLesson(id, {
      report_id: `rep-${id}`,
      player_id: l.player_id,
      guardian_id: guardian?.id ?? 'guardian-unknown',
      ref_id: id,
      draft_body: '',
      teacher_comment: p.data.teacher_comment,
      next_lesson_at: p.data.next_lesson_at || '다음 수업 때 알려 드려요',
      share_token: token,
      share_url: `/r/${token}`,
      clips: [],
      // Numbers only on the public report (docs/18 §1, 07 §5); pin transcripts go back to the teacher below.
      lesson_extra: { progress: progressOf(id, minutesOf(id, d.nowMs())) },
      lesson_facts: buildLessonParentFacts(d.sql, id, d.nowMs()) ?? undefined
    });
    const body = (await res.json()) as { facts?: unknown; error?: string };
    if (!res.ok) return c.json({ error: body.error ?? 'report_failed' }, 500);
    const now = d.nowMs();
    d.sql.run('update lessons set ended_at = coalesce(ended_at, ?) where id = ?', [now, id]);
    d.sql.run('update student_tokens set expires_at = min(expires_at, ?) where lesson_id = ?', [now + 10 * 60_000, id]);
    d.sql.run('delete from lesson_joins where lesson_id = ?', [id]);
    // The after-lesson summary and the student's daily record go to the card outbox (ops-cards.ts). A card failure
    // never fails the end: the report is out and the lesson is closed.
    try {
      enqueueLessonEnd(d.sql, id, now, new URL(c.req.url).origin);
    } catch {
      /* the next end or daily refresh writes the cards again */
    }
    return c.json({ report_path: `/r/${token}`, share_token: token, facts: body.facts, pin_windows: pinWindows });
  });

  const dailyRows = (where: string, params: unknown[]) =>
    d.sql.all<Record<string, number | string>>(
      `select player_id, count(*) as utterances, coalesce(sum(case when stars > 0 then 1 else 0 end), 0) as passes,
              coalesce(sum(words), 0) as words, coalesce(sum(dur_ms), 0) as speaking_ms,
              count(distinct case when session_kind = 'lesson' then session_id end) as lessons, max(created_at) as last_at
       from utterances where ${where} group by player_id`,
      params
    );

  app.get('/v1/admin/students/:id/daily', (c) => {
    const id = c.req.param('id');
    const days = Math.min(90, Math.max(1, Number(c.req.query('days') ?? 14) || 14));
    const out = [];
    const today = kstDay(d.nowMs());
    for (let i = days - 1; i >= 0; i--) {
      const day = kstDay(kstDayStartMs(today) - i * 86_400_000 + 3_600_000);
      const from = kstDayStartMs(day);
      const r = dailyRows('player_id = ? and created_at >= ? and created_at < ?', [id, from, from + 86_400_000])[0];
      out.push({
        day,
        utterances: Number(r?.utterances ?? 0),
        passes: Number(r?.passes ?? 0),
        words: Number(r?.words ?? 0),
        speaking_ms: Number(r?.speaking_ms ?? 0),
        lessons: Number(r?.lessons ?? 0)
      });
    }
    return c.json(out);
  });

  app.get('/v1/admin/daily', (c) => {
    const day = /^\d{4}-\d{2}-\d{2}$/.test(c.req.query('day') ?? '') ? c.req.query('day')! : kstDay(d.nowMs());
    const from = kstDayStartMs(day);
    const rows = dailyRows("created_at >= ? and created_at < ? and player_id not like 'smoke-%'", [from, from + 86_400_000]);
    const nick = (id: string) => d.sql.get<{ nickname: string }>('select nickname from players where id = ?', [id])?.nickname ?? id;
    return c.json({ day, students: rows.map((r) => ({ ...r, nickname: nick(String(r.player_id)) })) });
  });

  /* ---------- student ---------- */

  app.post('/v1/join', async (c) => {
    const now = d.nowMs();
    const hour = Math.floor(now / 3_600_000);
    const client = (c.req.header('cf-connecting-ip') ?? 'local').slice(0, 64);
    const fails = d.sql.get<{ n: number }>('select n from join_failures where hour = ?', [hour])?.n ?? 0;
    const mine = d.sql.get<{ n: number }>('select n from join_failures_by_client where hour = ? and client = ?', [hour, client])?.n ?? 0;
    if (fails >= JOIN_FAILS_PER_HOUR_ALL || mine >= JOIN_FAILS_PER_HOUR) return c.json({ error: 'too_many_attempts' }, 429);
    const p = JoinSchema.safeParse(await c.req.json());
    const row = p.success
      ? d.sql.get<{ lesson_id: string; player_id: string }>(
          'select lesson_id, player_id from lesson_joins where code = ? and expires_at > ?',
          [p.data.code, now]
        )
      : undefined;
    if (!row) {
      d.sql.run('insert into join_failures (hour, n) values (?, 1) on conflict(hour) do update set n = n + 1', [hour]);
      d.sql.run(
        'insert into join_failures_by_client (hour, client, n) values (?, ?, 1) on conflict(hour, client) do update set n = n + 1',
        [hour, client]
      );
      d.sql.run('delete from join_failures_by_client where hour < ?', [hour - 1]);
      return c.json({ error: 'invalid_code' }, 404);
    }
    const token = hex(d.randomBytes(24));
    d.sql.run('insert into student_tokens (token_hash, lesson_id, player_id, expires_at) values (?, ?, ?, ?)', [
      await d.sha256Hex(token),
      row.lesson_id,
      row.player_id,
      now + STUDENT_TOKEN_TTL_MS
    ]);
    const pl = d.sql.get<{ nickname: string; level: string }>('select nickname, level from players where id = ?', [row.player_id]);
    return c.json({
      student_token: token,
      lesson_id: row.lesson_id,
      player_id: row.player_id,
      nickname: pl?.nickname ?? '',
      level: pl?.level ?? 'L1',
      // The device records a turn only when the guardian turned voice_store on (voice.ts); the server checks again.
      voice_store: d.db.hasActiveConsent(row.player_id, 'voice_store')
    });
  });

  const student = (req: Request) => studentFromRequest(d, req);
  const lessonStarsOf = (lessonId: string, playerId: string): number =>
    Number(
      d.sql.get<{ n: number | null }>('select coalesce(sum(stars), 0) as n from utterances where session_id = ? and player_id = ?', [
        lessonId,
        playerId
      ])?.n ?? 0
    );

  /* Polled every 3 s by the student client (docs/19 §4). `since` is the previous `server_now`; `scene` and `ui`
     tell the director console what the student's screen shows right now. */
  app.get('/v1/lesson/state', async (c) => {
    const s = await student(c.req.raw);
    if (!s) return c.json({ error: 'student_only' }, 401);
    const now = d.nowMs();
    // A tutoring seat is in use once its child is in a lesson (seats.ts markSeatUse; refund ends at first use).
    markSeatUse(d.sql, s.player_id, now, 'lesson');
    const st = stateOf(s.lesson_id);
    const l = lessonRow(s.lesson_id);
    const plan = getLessonPlan(st?.plan_id);
    const stage = st ? planStage(plan, st.stage_id) : undefined;
    const scene = c.req.query('scene');
    const ui = c.req.query('ui');
    const mic = c.req.query('mic');
    d.sql.run(
      `insert into lesson_presence (lesson_id, last_seen_at, scene_id, ui, mic) values (?, ?, ?, ?, ?)
       on conflict(lesson_id) do update set last_seen_at = excluded.last_seen_at,
         scene_id = coalesce(excluded.scene_id, lesson_presence.scene_id), ui = coalesce(excluded.ui, lesson_presence.ui),
         mic = coalesce(excluded.mic, lesson_presence.mic)`,
      [
        s.lesson_id,
        now,
        scene && /^[a-z_]{1,32}$/.test(scene) ? scene : null,
        ui === '3d' || ui === 'cards' ? ui : null,
        mic && (LESSON_MIC_STATUSES as readonly string[]).includes(mic) ? mic : null
      ]
    );
    const live = liveForStudent(s.lesson_id, c.req.query('cursor'), now);
    const stageStartedAt =
      d.sql.get<{ at: number | null }>('select max(at) as at from lesson_stage_log where lesson_id = ?', [s.lesson_id])?.at ?? null;
    const stageNpc = stage?.npcId ?? 'guide';
    return c.json({
      lesson_id: s.lesson_id,
      plan_id: plan.id,
      stage_id: st?.stage_id ?? null,
      stage_goal_ko: stage?.studentGoalKo ?? '',
      stage_goal_en: stage?.studentGoalEn ?? '',
      mode: stage?.mode ?? 'guided',
      scene_id: stage?.sceneId ?? 'plaza',
      npc_id: stage?.npcId ?? 'guide',
      hint: stage?.hint ?? 'full',
      targets: st?.targets ?? [],
      offers: offersOf(plan, st?.targets ?? []),
      possessed_npc_id: possessedOf(s.lesson_id),
      npc_lines: live.npc_lines,
      events: live.events,
      cursor: live.cursor,
      ended: Boolean(l?.ended_at),
      // The child's one coin balance (home-world ledger), so the 3D HUD and /join show it from the first poll.
      coins_balance: d.coins ? d.coins.balance(s.player_id) : null,
      // Stars this child earned in this lesson (the HUD star chip during a lesson), and the stage NPC's opening line
      // for the dialog window (the stage's script, not the NPC's solo greeting).
      lesson_stars: lessonStarsOf(s.lesson_id, s.player_id),
      npc_line_en: stage?.teacherScriptEn ?? '',
      // When the current stage began (server clock, same as npc_lines.at): lines before it belong to the last stage.
      stage_started_at: stageStartedAt,
      // The teacher's newest line as the stage NPC in this stage, however old: after a reload the first poll only
      // carries the last 20 s of lines, and the dialog window must still open with the follow-up, not the script.
      // Whether a teacher is with the child now (console heartbeat): the world shows a teacher tag, or "혼자 놀기".
      teacher: (({ present, name, since }) => ({ present, name, since }))(teacherOf(s.lesson_id, now)),
      stage_last_line_en:
        stageStartedAt === null
          ? null
          : (d.sql.get<{ text: string }>(
              "select text from lesson_live where lesson_id = ? and type = 'line' and npc_id = ? and at >= ? order by seq desc limit 1",
              [s.lesson_id, stageNpc, stageStartedAt]
            )?.text ?? null),
      server_now: now
    });
  });

  app.post('/v1/lesson/utterance', async (c) => {
    const s = await student(c.req.raw);
    if (!s) return c.json({ error: 'student_only' }, 401);
    const p = UtteranceSchema.safeParse(await c.req.json());
    if (!p.success) return c.json({ error: 'invalid', issues: p.error.issues }, 400);
    const u = p.data;
    const now = d.nowMs();
    // A resend of an answer already stored (its response was lost, or it waited in the device outbox): the same
    // result again, never a second utterance or coin credit. The balance and star sum are today's.
    if (u.client_id) {
      const seen = d.sql.get<{ response: string; at: number }>(
        'select response, at from lesson_utterance_clients where lesson_id = ? and client_id = ?',
        [s.lesson_id, u.client_id]
      );
      // The first copy is still being stored (the voice upload offer awaits): this resend is not a second answer.
      if (seen && !seen.response && now - seen.at < UTTERANCE_CLAIM_STALE_MS) return c.json({ error: 'in_progress' }, 409);
      if (seen && seen.response) {
        const first = JSON.parse(seen.response) as Record<string, unknown>;
        return c.json({
          ...first,
          ...(d.coins ? { coins_total: d.coins.balance(s.player_id) } : {}),
          lesson_stars: lessonStarsOf(s.lesson_id, s.player_id),
          replayed: true
        });
      }
      // Claimed before anything awaits, so two copies arriving together are stored once.
      d.sql.run('insert or replace into lesson_utterance_clients (lesson_id, client_id, response, at) values (?, ?, ?, ?)', [
        s.lesson_id,
        u.client_id,
        '',
        now
      ]);
    }
    const st = stateOf(s.lesson_id);
    const plan = getLessonPlan(st?.plan_id);
    // The stage the child answered in, if the teacher really opened it in this lesson; else the current one.
    const answered =
      u.stage_id && u.stage_id !== st?.stage_id
        ? d.sql.get<{ n: number }>('select count(*) as n from lesson_stage_log where lesson_id = ? and stage_id = ?', [s.lesson_id, u.stage_id])
            ?.n
          ? planStage(plan, u.stage_id)
          : undefined
        : undefined;
    const stage = answered ?? (st ? planStage(plan, st.stage_id) : undefined);
    const mode = stage?.mode ?? 'guided';
    const level = (d.sql.get<{ level: string }>('select level from players where id = ?', [s.player_id])?.level ?? 'L1') as
      | 'L1'
      | 'L2'
      | 'L3'
      | 'L4'
      | 'L5'
      | 'L6';
    let pass: boolean;
    let score: number;
    let stars: number;
    let capped = false;
    let coreMissed = false;
    if (mode === 'free' || !u.target_text) {
      const f = scoreFreeTalk(u.transcript);
      ({ pass, score, stars } = f);
    } else {
      const offer = plan.stages.flatMap((x) => x.targets).find((t) => t.text === u.target_text);
      const r = scoreUtterance({
        targetText: u.target_text,
        spokenTranscript: u.transcript,
        level,
        hintLevel: u.hint_level,
        stars: u.chosen_stars,
        hintTags: offer?.hintTags
      });
      pass = r.pass;
      score = r.score;
      stars = r.pass ? Math.min(u.chosen_stars, r.starCap) : 0;
      capped = r.pass && r.starCap < u.chosen_stars;
      coreMissed = r.coreTotal > 0 && r.coreMatchRate === 0;
    }
    // Typed or card-assembled sentences are not speech: two stars at most (docs/04 §4.1, same as /v1/converse/score).
    const typedCapped = TYPED_INPUT_SOURCES.has(u.stt_source) && stars > TYPED_INPUT_MAX_STARS;
    if (typedCapped) stars = TYPED_INPUT_MAX_STARS;
    const uttId = `utt-${s.lesson_id}-${now}-${hex(d.randomBytes(3))}`;
    d.db.logUtterance({
      id: uttId,
      player_id: s.player_id,
      world_id: 'lesson-mode',
      session_id: s.lesson_id,
      session_kind: 'lesson',
      ctx: stage?.id ?? 'lesson',
      mode,
      // Fixed at arrival: with the teacher present (console heartbeat) 'teacher', the child alone 'self'.
      interlocutor: teacherOf(s.lesson_id, now).present ? 'teacher' : 'self',
      first_text: u.transcript,
      target_text: u.target_text,
      final_text: u.transcript,
      words: wordsOf(u.transcript),
      l1_words: (u.transcript.match(/[가-힣]+/g) ?? []).length,
      dur_ms: u.dur_ms,
      latency_ms: u.latency_ms,
      stars,
      hint_level: u.hint_level,
      attempts: 1,
      score,
      confidence: u.confidence,
      source: u.stt_source,
      audio_first: null,
      audio_final: null,
      created_at: now
    });
    recordMinuteAt(s.lesson_id, now);
    // One balance everywhere (coordinator 11-16): the ledger, credited once per utterance id.
    const coinsTotal = d.coins
      ? d.coins.credit(s.player_id, stars * COINS_PER_STAR, `lesson:${uttId}`, now)
      : Number(d.sql.get<{ s: number }>('select coalesce(sum(stars), 0) as s from utterances where player_id = ?', [s.player_id])?.s ?? 0) *
        COINS_PER_STAR;
    // WP-310: a lesson line passed with 2+ stars becomes a memory card (one per lesson and sentence), reviewed later
    // in solo play like any other card (dialog domain, review.ts).
    if (pass && u.target_text) {
      createMemoryCard(d.db, {
        cardId: `mc-${s.lesson_id}-${bankTextKey(u.target_text).replace(/[^a-z0-9]+/g, '-').slice(0, 60)}`,
        playerId: s.player_id,
        utteranceId: uttId,
        itemId: `lesson-${uttId}|${stage?.id ?? 'lesson'}`,
        origin: 'lesson',
        stars,
        nowMs: now
      });
    }
    const from = kstDayStartMs(kstDay(now));
    const today = d.sql.get<{ n: number }>('select count(*) as n from utterances where player_id = ? and created_at >= ?', [
      s.player_id,
      from
    ]);
    const answer = {
      pass,
      score: Math.round(score * 1000) / 1000,
      stars,
      feedback_ko: feedbackKo({ pass, stars, chosen: u.chosen_stars, capped, mode, coreMissed, typedCapped }),
      coins_total: coinsTotal,
      // This lesson's star sum right after this answer was stored: the HUD chip takes it as is (adding the answer's
      // stars to its own count could count one twice when a poll lands between the store and this answer).
      lesson_stars: lessonStarsOf(s.lesson_id, s.player_id),
      utterances_today: Number(today?.n ?? 0)
    };
    if (u.client_id) {
      // The stored answer for a resend (written before anything awaits, so the claim is never left empty by a failure
      // further down); the voice upload ticket is for this request only.
      d.sql.run('update lesson_utterance_clients set response = ? where lesson_id = ? and client_id = ?', [
        JSON.stringify(answer),
        s.lesson_id,
        u.client_id
      ]);
    }
    const audioUpload = d.offerVoiceUpload
      ? await d.offerVoiceUpload({ playerId: s.player_id, utteranceId: uttId, source: u.stt_source, nowMs: now })
      : null;
    return c.json({ ...answer, ...(audioUpload ? { audio_upload: audioUpload } : {}) });
  });

  return app;
}
