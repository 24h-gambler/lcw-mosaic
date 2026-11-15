/**
 * Guardian dashboard payload (WP-309, docs/07 §4, docs/08 §9.1–9.2). Loads one child's rows and hands them to
 * `buildDashboardSeries` (packages/metrics) so every number on home cards, graphs and tables comes from one place.
 * Guardian-only (session + service consent + own child); never public.
 */
import { buildDashboardSeries, filterValidUtterances, type DashboardSeries, type UtteranceMetricInput } from '@lcw/metrics';
import type { EdgePlatformDb, SqliteExecutor } from './storage.js';
import { REPORT_SHARE_TTL_MS } from './parent-report.js';

export const DASHBOARD_LESSONS_MAX = 20;

export interface DashboardLesson {
  id: string;
  started_at: number;
  ended_at: number | null;
  duration_min: number;
  student_min: number;
  teacher_min: number;
  /** Student share of talk time, 0..1; null when nothing was recorded. */
  student_share: number | null;
  utterances: number;
  passes: number;
  report_path: string | null;
}

export interface DashboardPayload {
  child: { nickname: string; level: string };
  series: DashboardSeries;
  /** Longest free utterance this week (docs/07 4.1 "이번 주의 한 마디"), text only. */
  week_line: { text: string; words: number; at: number } | null;
  /** Sentences coming back for review next (docs/07 4.1 "돌아올 문장"). */
  review: Array<{ text: string; due_at: number }>;
  lessons: DashboardLesson[];
  next_lesson_at: string | null;
  lesson_live: boolean;
  lesson_window_on: boolean;
  voice_store_on: boolean;
  server_now: number;
}

export function buildDashboard(sql: SqliteExecutor, db: EdgePlatformDb, playerId: string, nowMs: number): DashboardPayload {
  const kid = sql.get<{ nickname: string; level: string }>('select nickname, level from players where id = ?', [playerId]);
  const rows = db.listUtterancesForPlayer(playerId);
  const inputs: UtteranceMetricInput[] = rows.map((r) => ({
    id: r.id,
    player_id: r.player_id,
    session_id: r.session_id,
    session_kind: r.session_kind,
    ctx: r.ctx,
    mode: r.mode,
    interlocutor: r.interlocutor,
    final_text: r.final_text,
    words: r.words,
    l1_words: r.l1_words,
    dur_ms: r.dur_ms,
    latency_ms: r.latency_ms,
    stars: r.stars,
    hint_level: r.hint_level,
    attempts: r.attempts,
    score: r.score,
    confidence: r.confidence,
    created_at: r.created_at
  }));
  const mastered = sql.all<{ mastered_at: number | null }>('select mastered_at from memory_cards where player_id = ?', [playerId]);
  const lessonRows = sql.all<{ id: string; started_at: number; ended_at: number | null }>(
    'select id, started_at, ended_at from lessons where player_id = ? order by started_at desc',
    [playerId]
  );
  const series = buildDashboardSeries({
    utterances: inputs,
    masteredAt: mastered.map((m) => m.mastered_at),
    lessonStarts: lessonRows.map((l) => l.started_at),
    nowMs
  });

  const thisWeek = series.weeks[series.weeks.length - 1]!.week_start;
  const weekLine = filterValidUtterances(inputs)
    .valid.filter((u) => u.mode === 'free' && u.created_at >= thisWeek)
    .sort((a, b) => b.words - a.words || b.created_at - a.created_at)[0];

  const review = sql
    .all<{ text: string; due_at: number }>(
      `select case when u.target_text <> '' then u.target_text else u.final_text end as text, m.next_review_at as due_at
       from memory_cards m join utterances u on u.id = m.utterance_id
       where m.player_id = ? and m.mastered_at is null order by m.next_review_at asc limit 3`,
      [playerId]
    )
    .filter((r) => r.text.trim().length > 0);

  const lessons: DashboardLesson[] = lessonRows.slice(0, DASHBOARD_LESSONS_MAX).map((l) => {
    const t = sql.get<{ s: number | null; t: number | null }>(
      'select sum(student_ms) as s, sum(teacher_ms) as t from lesson_minutes where lesson_id = ?',
      [l.id]
    );
    const u = sql.get<{ n: number; p: number | null }>(
      'select count(*) as n, sum(case when stars > 0 then 1 else 0 end) as p from utterances where session_id = ?',
      [l.id]
    );
    const rep = sql.get<{ share_token: string; created_at: number }>(
      "select share_token, created_at from reports where kind = 'lesson' and ref_id = ? order by created_at desc limit 1",
      [l.id]
    );
    const repOk =
      rep &&
      nowMs - rep.created_at <= REPORT_SHARE_TTL_MS &&
      !sql.get('select share_token from report_revocations where share_token = ?', [rep.share_token]);
    const s = Number(t?.s ?? 0);
    const te = Number(t?.t ?? 0);
    return {
      id: l.id,
      started_at: l.started_at,
      ended_at: l.ended_at,
      duration_min: Math.max(0, Math.round(((l.ended_at ?? nowMs) - l.started_at) / 60_000)),
      student_min: Math.round((s / 60_000) * 10) / 10,
      teacher_min: Math.round((te / 60_000) * 10) / 10,
      student_share: s + te > 0 ? Math.round((s / (s + te)) * 100) / 100 : null,
      utterances: Number(u?.n ?? 0),
      passes: Number(u?.p ?? 0),
      report_path: repOk ? `/r/${rep!.share_token}` : null
    };
  });

  const next = sql.get<{ next_lesson_at: string | null }>(
    'select next_lesson_at from report_deliveries where player_id = ? and next_lesson_at is not null order by sent_at desc limit 1',
    [playerId]
  );
  const consents = db.listConsents(playerId);
  return {
    child: { nickname: kid?.nickname ?? '', level: kid?.level ?? 'L1' },
    series,
    week_line: weekLine ? { text: weekLine.final_text, words: weekLine.words, at: weekLine.created_at } : null,
    review,
    lessons,
    next_lesson_at: next?.next_lesson_at ?? null,
    lesson_live: lessonRows.some((l) => l.ended_at === null),
    lesson_window_on: Boolean(consents.lesson_window),
    voice_store_on: Boolean(consents.voice_store),
    server_now: nowMs
  };
}
