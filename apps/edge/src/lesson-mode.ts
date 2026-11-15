import { Hono } from 'hono';
import { z } from 'zod';
import { getLessonPlan, type LessonPlan } from '@lcw/content';
import { scoreUtterance } from '@lcw/converse';
import { LessonDO, type EdgePlatformDb, type SqliteExecutor } from './storage.js';

/**
 * Lesson mode (docs/18): a real lesson without the 3D world. The teacher (operator token) starts a lesson and gets a
 * 6-digit join code; the student device trades the code for a token scoped to that one lesson and player; every
 * utterance is scored server-side and stored like any other utterance (session_kind 'lesson').
 */

export const JOIN_CODE_TTL_MS = 12 * 3_600_000;
export const STUDENT_TOKEN_TTL_MS = 12 * 3_600_000;
export const JOIN_FAILS_PER_HOUR = 10;
export const COINS_PER_STAR = 10;

export const LESSON_MODE_SCHEMA = `
create table if not exists lesson_joins (code text primary key, lesson_id text not null, player_id text not null, expires_at integer not null);
create table if not exists student_tokens (token_hash text primary key, lesson_id text not null, player_id text not null, expires_at integer not null);
create table if not exists lesson_state (lesson_id text primary key, plan_id text not null, stage_id text not null, targets text not null, updated_at integer not null);
create table if not exists join_failures (hour integer primary key, n integer not null)
`;

export interface LessonModeDeps {
  sql: SqliteExecutor;
  db: EdgePlatformDb;
  nowMs: () => number;
  randomBytes: (n: number) => Uint8Array;
  sha256Hex: (s: string) => Promise<string>;
  /** Runs the existing complete-and-send-report route so the report logic stays in one place. */
  completeLesson: (lessonId: string, body: Record<string, unknown>) => Promise<Response>;
}

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

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
}): string {
  if (!r.pass && r.coreMissed) return '내용은 좋아요! so that · because 같은 연결어를 넣어서 한 번 더 말해 볼까요?';
  if (!r.pass) return '거의 다 왔어요! 화면의 문장을 보면서 한 번 더 천천히 말해 볼까요?';
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
    return c.json({ ok: true });
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
    return c.json({
      lesson: {
        id,
        player_id: l.player_id,
        nickname: nick?.nickname ?? l.player_id,
        started_at: l.started_at,
        ended_at: l.ended_at,
        stage_id: st?.stage_id ?? null,
        targets: st?.targets ?? []
      },
      utterances,
      pins,
      live
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
      clips: []
    });
    const body = (await res.json()) as { facts?: unknown; error?: string };
    if (!res.ok) return c.json({ error: body.error ?? 'report_failed' }, 500);
    const now = d.nowMs();
    d.sql.run('update lessons set ended_at = coalesce(ended_at, ?) where id = ?', [now, id]);
    d.sql.run('update student_tokens set expires_at = min(expires_at, ?) where lesson_id = ?', [now + 10 * 60_000, id]);
    d.sql.run('delete from lesson_joins where lesson_id = ?', [id]);
    return c.json({ report_path: `/r/${token}`, share_token: token, facts: body.facts });
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
    const fails = d.sql.get<{ n: number }>('select n from join_failures where hour = ?', [hour])?.n ?? 0;
    if (fails >= JOIN_FAILS_PER_HOUR) return c.json({ error: 'too_many_attempts' }, 429);
    const p = JoinSchema.safeParse(await c.req.json());
    const row = p.success
      ? d.sql.get<{ lesson_id: string; player_id: string }>(
          'select lesson_id, player_id from lesson_joins where code = ? and expires_at > ?',
          [p.data.code, now]
        )
      : undefined;
    if (!row) {
      d.sql.run('insert into join_failures (hour, n) values (?, 1) on conflict(hour) do update set n = n + 1', [hour]);
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

  const student = async (req: Request) => {
    const h = req.headers.get('authorization') ?? '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : '';
    if (token.length < 32) return null;
    return (
      d.sql.get<{ lesson_id: string; player_id: string }>(
        'select lesson_id, player_id from student_tokens where token_hash = ? and expires_at > ?',
        [await d.sha256Hex(token), d.nowMs()]
      ) ?? null
    );
  };

  app.get('/v1/lesson/state', async (c) => {
    const s = await student(c.req.raw);
    if (!s) return c.json({ error: 'student_only' }, 401);
    const st = stateOf(s.lesson_id);
    const l = lessonRow(s.lesson_id);
    const plan = getLessonPlan(st?.plan_id);
    const stage = st ? planStage(plan, st.stage_id) : undefined;
    return c.json({
      lesson_id: s.lesson_id,
      stage_id: st?.stage_id ?? null,
      stage_goal_ko: stage?.studentGoalKo ?? '',
      mode: stage?.mode ?? 'guided',
      targets: st?.targets ?? [],
      ended: Boolean(l?.ended_at)
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
    d.db.logUtterance({
      id: `utt-${s.lesson_id}-${now}-${hex(d.randomBytes(3))}`,
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
    const totals = d.sql.get<{ s: number }>('select coalesce(sum(stars), 0) as s from utterances where player_id = ?', [s.player_id]);
    const from = kstDayStartMs(kstDay(now));
    const today = d.sql.get<{ n: number }>('select count(*) as n from utterances where player_id = ? and created_at >= ?', [
      s.player_id,
      from
    ]);
    return c.json({
      pass,
      score: Math.round(score * 1000) / 1000,
      stars,
      feedback_ko: feedbackKo({ pass, stars, chosen: u.chosen_stars, capped, mode, coreMissed }),
      coins_total: Number(totals?.s ?? 0) * COINS_PER_STAR,
      utterances_today: Number(today?.n ?? 0)
    });
  });

  return app;
}
