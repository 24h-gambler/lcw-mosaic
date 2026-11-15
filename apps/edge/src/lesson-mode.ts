import { Hono } from 'hono';
import { z } from 'zod';
import { LESSON_DIRECTOR_EVENTS, LESSON_NPCS, LESSON_PLANS, getLessonPlan, type LessonPlan } from '@lcw/content';
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
import { buildLessonParentFacts } from './parent-report.js';

/**
 * Lesson mode (docs/18): a real lesson without the 3D world. The teacher (operator token) starts a lesson and gets a
 * 6-digit join code; the student device trades the code for a token scoped to that one lesson and player; every
 * utterance is scored server-side and stored like any other utterance (session_kind 'lesson').
 */

export const JOIN_CODE_TTL_MS = 12 * 3_600_000;
export const STUDENT_TOKEN_TTL_MS = 12 * 3_600_000;
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
create table if not exists lesson_presence (lesson_id text primary key, last_seen_at integer not null, scene_id text, ui text)
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

const StartSchema = z.object({ player_id: z.string().min(1).max(64), plan_id: z.string().max(64).optional() }).strict();
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
    confidence: z.number().min(0).max(1).default(1)
  })
  .strict();

function kstDay(ms: number): string {
  return new Date(ms + 9 * 3_600_000).toISOString().slice(0, 10);
}
function kstDayStartMs(day: string): number {
  return Date.parse(`${day}T00:00:00+09:00`);
}

export function buildLessonModeApp(d: LessonModeDeps): Hono {
  d.sql.exec(LESSON_MODE_SCHEMA);
  const app = new Hono();

  const lessonRow = (id: string) =>
    d.sql.get<{ id: string; player_id: string; started_at: number; ended_at: number | null; plan: string }>(
      'select id, player_id, started_at, ended_at, plan from lessons where id = ?',
      [id]
    );
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

  /**
   * Every minute from the start to now (or the end), silent minutes included, so the chart shows gaps. `complete`
   * says whether the last minute is over (a running lesson's current minute is not yet a silent minute).
   */
  const minutesOf = (id: string, endingAt?: number): { minutes: LessonMinuteInput[]; complete: number } => {
    const l = lessonRow(id);
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
    let stage = stages[0]?.stage_id ?? stateOf(id)?.stage_id ?? 'lesson';
    for (let m = 0; m <= last; m++) {
      const minuteEnd = l.started_at + (m + 1) * 60_000 - 1;
      while (si < stages.length && stages[si]!.at <= minuteEnd) stage = stages[si++]!.stage_id;
      out.push(stored.get(m) ?? { lesson_id: id, minute: m, student_ms: 0, teacher_ms: 0, exchanges: 0, activity: stage });
    }
    const complete = l.ended_at || endingAt ? out.length : Math.min(out.length, Math.floor(elapsed / 60_000));
    return { minutes: out, complete };
  };

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
              (select count(*) from utterances u where u.player_id = p.id and u.created_at >= ?) as utterances_7d
       from players p where p.id not like 'smoke-%' and p.id <> 'player-demo' order by p.nickname`,
      [since]
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
    return c.json({ lesson_id: lessonId, join_code: code, expires_at: now + JOIN_CODE_TTL_MS, plan }, 201);
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
    const presence = d.sql.get<{ last_seen_at: number; scene_id: string | null; ui: string | null }>(
      'select last_seen_at, scene_id, ui from lesson_presence where lesson_id = ?',
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
        expected_scene_id: stage?.sceneId ?? null,
        goal_ko: stage?.studentGoalKo ?? '',
        targets: st?.targets ?? [],
        last_utterance: lastUtt ? { ...lastUtt, pass: Number(lastUtt.stars) > 0 } : null
      },
      server_now: now
    });
  });

  app.post('/v1/admin/lessons/:id/end', async (c) => {
    const id = c.req.param('id');
    const l = lessonRow(id);
    if (!l) return c.json({ error: 'lesson_not_found' }, 404);
    const p = EndSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!p.success) return c.json({ error: 'invalid', issues: p.error.issues }, 400);
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
      const whole = note ? meaningfulExpression(note, { utterances: said, targets }) : null;
      const lemma = w.kind === 'expression' ? (whole || w.candidate_expressions[0] || '').slice(0, 120) : '';
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
      level: pl?.level ?? 'L1'
    });
  });

  const student = (req: Request) => studentFromRequest(d, req);

  /* Polled every 3 s by the student client (docs/19 §4). `since` is the previous `server_now`; `scene` and `ui`
     tell the director console what the student's screen shows right now. */
  app.get('/v1/lesson/state', async (c) => {
    const s = await student(c.req.raw);
    if (!s) return c.json({ error: 'student_only' }, 401);
    const now = d.nowMs();
    const st = stateOf(s.lesson_id);
    const l = lessonRow(s.lesson_id);
    const plan = getLessonPlan(st?.plan_id);
    const stage = st ? planStage(plan, st.stage_id) : undefined;
    const scene = c.req.query('scene');
    const ui = c.req.query('ui');
    d.sql.run(
      `insert into lesson_presence (lesson_id, last_seen_at, scene_id, ui) values (?, ?, ?, ?)
       on conflict(lesson_id) do update set last_seen_at = excluded.last_seen_at,
         scene_id = coalesce(excluded.scene_id, lesson_presence.scene_id), ui = coalesce(excluded.ui, lesson_presence.ui)`,
      [
        s.lesson_id,
        now,
        scene && /^[a-z_]{1,32}$/.test(scene) ? scene : null,
        ui === '3d' || ui === 'cards' ? ui : null
      ]
    );
    const live = liveForStudent(s.lesson_id, c.req.query('cursor'), now);
    return c.json({
      lesson_id: s.lesson_id,
      stage_id: st?.stage_id ?? null,
      stage_goal_ko: stage?.studentGoalKo ?? '',
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
    const st = stateOf(s.lesson_id);
    const plan = getLessonPlan(st?.plan_id);
    const stage = st ? planStage(plan, st.stage_id) : undefined;
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
      interlocutor: 'teacher',
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
    const from = kstDayStartMs(kstDay(now));
    const today = d.sql.get<{ n: number }>('select count(*) as n from utterances where player_id = ? and created_at >= ?', [
      s.player_id,
      from
    ]);
    return c.json({
      pass,
      score: Math.round(score * 1000) / 1000,
      stars,
      feedback_ko: feedbackKo({ pass, stars, chosen: u.chosen_stars, capped, mode, coreMissed, typedCapped }),
      coins_total: coinsTotal,
      utterances_today: Number(today?.n ?? 0)
    });
  });

  return app;
}
