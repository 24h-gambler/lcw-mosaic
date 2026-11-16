import type { Hono } from 'hono';
import { z } from 'zod';
import { isTestPlayerId } from './nickname.js';
import type { SqliteExecutor } from './storage.js';

/**
 * Hub cards for the teacher (Dan's spine), made by the server (docs/09 "운영 카드"): the after-lesson summary and the
 * student's daily record. The spine is on a private tailnet (never reachable from the internet), so the Worker
 * cannot post to it; the cards wait here in an outbox and the spine side pulls them with the operator token
 * (GET /v1/admin/outbox/cards), posts each with the source adjustment and ceiling rules of tools/lesson-watch.mjs,
 * and acks it (POST /v1/admin/outbox/cards/ack).
 *
 * One row per card ref: a later change to the same card rewrites the row and sends it again (the spine rewrites the
 * open card with the same ref in place, so a resend never makes a second card). Numbers, nickname and ids only:
 * nothing a child said.
 */

export const OPS_CARD_SCHEMA = `
create table if not exists ops_card_outbox (ref text primary key, card text not null, created_at integer not null, updated_at integer not null, acked_at integer, spine_id text);
create index if not exists ops_card_outbox_pending on ops_card_outbox (acked_at, updated_at);
create index if not exists utterances_by_time on utterances (created_at)
`;
// utterances_by_time: the hourly enqueueRecentStudentDays reads the last two hours of every student; without it each
// hour scans the whole table. utterances exists by then (storage.ts schema, lesson-mode.ts indexes it before mounting).

/** The spine source the watch has always used for LCW cards (tools/lesson-watch.mjs CARD_SOURCE). */
export const OPS_CARD_SOURCE = 'outsourcing';
/** After the lesson: the phone may chime (2). */
export const LESSON_SUMMARY_IMPORTANCE = 2;
/** The daily record: listed in the hub, no ring (1). */
export const STUDENT_DAILY_IMPORTANCE = 1;
/** Acked rows older than this are dropped when the outbox is read. */
export const OPS_CARD_KEEP_MS = 30 * 86_400_000;

export interface OpsCard {
  source: string;
  ref: string;
  title: string;
  body: string;
  importance: number;
  actions: Array<Record<string, unknown>>;
}

const kstDay = (ms: number) => new Date(ms + 9 * 3_600_000).toISOString().slice(0, 10);
const kstDayStartMs = (day: string) => Date.parse(`${day}T00:00:00+09:00`);
const kstClock = (ms: number) => new Date(ms + 9 * 3_600_000).toISOString().slice(11, 16);
const consoleActions = (origin: string) => [
  { type: 'open', url: `${origin}/director`, label: '디렉터 콘솔 열기' },
  { type: 'dismiss' }
];

interface SpeechCounts {
  utterances: number;
  passes: number;
  stars: number;
  words: number;
  speaking_ms: number;
  lessons: number;
  last_at: number | null;
}
function speechCounts(sql: SqliteExecutor, where: string, params: unknown[]): SpeechCounts {
  const r = sql.get<Record<string, number | null>>(
    `select count(*) as utterances, coalesce(sum(case when stars > 0 then 1 else 0 end), 0) as passes,
            coalesce(sum(stars), 0) as stars, coalesce(sum(words), 0) as words, coalesce(sum(dur_ms), 0) as speaking_ms,
            count(distinct case when session_kind = 'lesson' then session_id end) as lessons, max(created_at) as last_at
     from utterances where ${where}`,
    params
  );
  return {
    utterances: Number(r?.utterances ?? 0),
    passes: Number(r?.passes ?? 0),
    stars: Number(r?.stars ?? 0),
    words: Number(r?.words ?? 0),
    speaking_ms: Number(r?.speaking_ms ?? 0),
    lessons: Number(r?.lessons ?? 0),
    last_at: r?.last_at == null ? null : Number(r.last_at)
  };
}
/** Closed by the idle sweep (lesson-mode.ts LESSON_IDLE_CLOSE_MS): its report waits for the teacher, or went out with a later part. */
function autoCloseOf(sql: SqliteExecutor, lessonId: string): { sent_at: number | null; folded_into: string | null } | null {
  try {
    return sql.get<{ sent_at: number | null; folded_into: string | null }>('select sent_at, folded_into from lesson_auto_close where lesson_id = ?', [lessonId]) ?? null;
  } catch {
    return null; /* no lesson tables (ops-card unit setups) */
  }
}
/**
 * The auto-closed lesson's card: '리포트 확인·보내기' opens that lesson on the console (the report goes to the guardian
 * only from there, after the teacher looks), '이어 하기' opens the console at the same lesson ready to continue it.
 */
const autoActions = (origin: string, lessonId: string) => [
  { type: 'open', url: `${origin}/director?auto=${encodeURIComponent(lessonId)}`, label: '리포트 확인·보내기' },
  { type: 'open', url: `${origin}/director?auto=${encodeURIComponent(lessonId)}&next=continue`, label: '이어 하기' },
  { type: 'dismiss' }
];
const nicknameOf = (sql: SqliteExecutor, playerId: string) =>
  sql.get<{ nickname: string }>('select nickname from players where id = ?', [playerId])?.nickname ?? playerId;
const secs = (ms: number) => Math.round(ms / 1000);

/** The after-lesson summary card of one lesson (null when the lesson is unknown). */
export function lessonSummaryCard(sql: SqliteExecutor, lessonId: string, nowMs: number, origin: string): OpsCard | null {
  const l = sql.get<{ id: string; player_id: string; started_at: number; ended_at: number | null }>(
    'select id, player_id, started_at, ended_at from lessons where id = ?',
    [lessonId]
  );
  if (!l) return null;
  const end = l.ended_at ?? nowMs;
  const minutes = Math.max(0, Math.round((end - l.started_at) / 60_000));
  const s = speechCounts(sql, 'session_kind = ? and session_id = ?', ['lesson', lessonId]);
  const stages = sql.get<{ n: number }>('select count(distinct stage_id) as n from lesson_stage_log where lesson_id = ?', [lessonId])?.n ?? 0;
  const pins = sql.get<{ n: number }>('select count(*) as n from pins where lesson_id = ?', [lessonId])?.n ?? 0;
  const report = sql.get<{ n: number }>("select count(*) as n from reports where ref_id = ? and kind = 'lesson'", [lessonId])?.n ?? 0;
  const nick = nicknameOf(sql, l.player_id);
  const auto = autoCloseOf(sql, lessonId);
  const pending = Boolean(auto && auto.sent_at === null && auto.folded_into === null);
  const numbers = `말 ${s.utterances}번 · 통과 ${s.passes}`;
  return {
    source: OPS_CARD_SOURCE,
    ref: `${OPS_CARD_SOURCE}:lcw:lesson:${lessonId}:summary`,
    title: pending
      ? `⏸ LCW 수업 자동 마무리됨 · ${nick} · ${minutes}분 · ${numbers} · 리포트 보내기/이어 하기`
      : `📚 LCW 수업 끝 · ${nick} · ${minutes}분 · ${numbers}`,
    body: [
      `수업 ${lessonId} · 학생 ${nick} (${l.player_id})`,
      `시간 ${kstClock(l.started_at)}–${kstClock(end)} (${minutes}분)`,
      `말한 횟수 ${s.utterances} · 통과 ${s.passes} · 별 ${s.stars} · 단어 ${s.words} · 말한 시간 ${secs(s.speaking_ms)}초`,
      `단계 ${stages}개 · 핀 ${pins}개 · 보호자 보고서 ${
        report ? '만듦' : auto?.folded_into ? `이어 한 수업 ${auto.folded_into} 의 보고서에 합쳐 보냄` : pending ? '초안만 있음(아직 안 보냄)' : '없음'
      }`,
      ...(auto
        ? [
            pending
              ? `선생님과 학생이 ${kstClock(end)} 뒤로 15분 넘게 없어서 서버가 '끝내지 않고 떠난 수업'으로 닫았습니다. 보호자에게는 아직 아무것도 가지 않았습니다. 콘솔에서 리포트를 확인하고 보내거나, 오늘 안에 이어 하면 두 수업이 한 리포트로 갑니다.`
              : `'끝내지 않고 떠난 수업'으로 자동 마무리됐던 수업입니다.`
          ]
        : []),
      '자세한 것은 디렉터 콘솔에서 봅니다(아이가 한 말 원문은 카드에 싣지 않습니다).'
    ].join('\n'),
    importance: LESSON_SUMMARY_IMPORTANCE,
    actions: pending ? autoActions(origin, lessonId) : consoleActions(origin)
  };
}

/** The student's record for one KST day (lessons and solo play together); null when the student is unknown. */
export function studentDailyCard(sql: SqliteExecutor, playerId: string, day: string, origin: string): OpsCard | null {
  if (!sql.get<{ id: string }>('select id from players where id = ?', [playerId])) return null;
  const from = kstDayStartMs(day);
  const s = speechCounts(sql, 'player_id = ? and created_at >= ? and created_at < ?', [playerId, from, from + 86_400_000]);
  const nick = nicknameOf(sql, playerId);
  return {
    source: OPS_CARD_SOURCE,
    ref: `${OPS_CARD_SOURCE}:lcw:student:${playerId}:${day}`,
    title: `🧒 LCW 학생 하루 기록 · ${nick} · ${day}`,
    body: [
      `학생 ${nick} (${playerId}) · ${day} (한국 시간)`,
      `수업 ${s.lessons}번 · 말한 횟수 ${s.utterances} · 통과 ${s.passes} · 별 ${s.stars}`,
      `단어 ${s.words} · 말한 시간 ${secs(s.speaking_ms)}초${s.last_at ? ` · 마지막 ${kstClock(s.last_at)}` : ''}`,
      '발화별 기록은 디렉터 콘솔의 CSV 로 받습니다(카드에는 숫자만).'
    ].join('\n'),
    importance: STUDENT_DAILY_IMPORTANCE,
    actions: consoleActions(origin)
  };
}

/** Put a card in the outbox; an unchanged card is left as it is (acked stays acked). Returns true when it will be sent. */
export function enqueueCard(sql: SqliteExecutor, card: OpsCard, nowMs: number): boolean {
  const text = JSON.stringify(card);
  const prev = sql.get<{ card: string }>('select card from ops_card_outbox where ref = ?', [card.ref]);
  if (prev && prev.card === text) return false;
  if (prev) sql.run('update ops_card_outbox set card = ?, updated_at = ?, acked_at = null where ref = ?', [text, nowMs, card.ref]);
  else sql.run('insert into ops_card_outbox (ref, card, created_at, updated_at, acked_at, spine_id) values (?, ?, ?, ?, null, null)', [card.ref, text, nowMs, nowMs]);
  return true;
}

/** A lesson ended: its summary and the student's record for that day. */
export function enqueueLessonEnd(sql: SqliteExecutor, lessonId: string, nowMs: number, origin: string): string[] {
  const out: string[] = [];
  // Smoke-check and demo students (every deploy's production smoke lesson) never reach Dan's hub, like the other
  // operator reports leave them out (lesson-mode.ts live list and students, export-csv.ts).
  const who = sql.get<{ player_id: string }>('select player_id from lessons where id = ?', [lessonId]);
  if (who && isTestPlayerId(who.player_id)) return out;
  const summary = lessonSummaryCard(sql, lessonId, nowMs, origin);
  if (!summary) return out;
  if (enqueueCard(sql, summary, nowMs)) out.push(summary.ref);
  const l = sql.get<{ player_id: string; started_at: number }>('select player_id, started_at from lessons where id = ?', [lessonId]);
  const daily = l ? studentDailyCard(sql, l.player_id, kstDay(l.started_at), origin) : null;
  if (daily && enqueueCard(sql, daily, nowMs)) out.push(daily.ref);
  return out;
}

/** Production origin for cards made without a request (the hourly cron): the console button must open the real site. */
export const OPS_CARD_ORIGIN = 'https://lcw.worldwidesomething.com';

/**
 * Hourly (docs/09-ops.md 15): the daily record of every student who spoke in the last two hours - in a lesson or in
 * solo play. A lesson that closed itself (no teacher pressed end) or play outside a lesson still reaches the hub that
 * day; two hours so the last minutes before midnight (KST) are still written to that day's card. An unchanged card
 * stays as it is (enqueueCard), so an acked card goes again only when its numbers moved. Test students never.
 */
export function enqueueRecentStudentDays(sql: SqliteExecutor, nowMs: number, origin: string): string[] {
  const rows = sql.all<{ player_id: string; d: number }>(
    `select player_id, (created_at + 32400000) / 86400000 as d from utterances
     where created_at >= ? and player_id is not null group by player_id, d`,
    [nowMs - 2 * 3_600_000]
  );
  const out: string[] = [];
  for (const r of rows) {
    if (isTestPlayerId(r.player_id)) continue;
    const day = new Date(Number(r.d) * 86_400_000).toISOString().slice(0, 10);
    const card = studentDailyCard(sql, r.player_id, day, origin);
    if (card && enqueueCard(sql, card, nowMs)) out.push(card.ref);
  }
  return out;
}

const AckSchema = z.object({
  items: z
    .array(z.object({ ref: z.string().min(1).max(200), updated_at: z.number().int(), spine_id: z.string().max(64).optional() }))
    .min(1)
    .max(100)
});

/** Operator routes (the /v1 operator gate in platform.ts covers them). */
export function mountOpsCardRoutes(app: Hono, d: { sql: SqliteExecutor; nowMs: () => number }): void {
  d.sql.exec(OPS_CARD_SCHEMA);
  app.get('/v1/admin/outbox/cards', (c) => {
    const now = d.nowMs();
    d.sql.run('delete from ops_card_outbox where acked_at is not null and acked_at < ?', [now - OPS_CARD_KEEP_MS]);
    const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') ?? 50) || 50));
    const rows = d.sql.all<{ ref: string; card: string; updated_at: number }>(
      'select ref, card, updated_at from ops_card_outbox where acked_at is null order by updated_at limit ?',
      [limit]
    );
    return c.json({ cards: rows.map((r) => ({ ref: r.ref, updated_at: r.updated_at, card: JSON.parse(r.card) as OpsCard })), server_now: now });
  });
  // Ack names the version it posted (updated_at): a card rewritten after the pull stays pending and goes again.
  app.post('/v1/admin/outbox/cards/ack', async (c) => {
    const p = AckSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!p.success) return c.json({ error: 'invalid', issues: p.error.issues }, 400);
    const now = d.nowMs();
    let acked = 0;
    for (const it of p.data.items) {
      const hit = d.sql.get<{ ref: string }>('select ref from ops_card_outbox where ref = ? and updated_at = ? and acked_at is null', [
        it.ref,
        it.updated_at
      ]);
      if (!hit) continue;
      d.sql.run('update ops_card_outbox set acked_at = ?, spine_id = ? where ref = ?', [now, it.spine_id ?? null, it.ref]);
      acked++;
    }
    return c.json({ acked });
  });
}
