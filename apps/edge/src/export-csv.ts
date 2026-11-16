import { Hono } from 'hono';
import { lessonMinutes, type LessonModeDeps } from './lesson-mode.js';

/**
 * Operator CSV exports of the lesson record (coordinator 11-16). Storage stays SQLite; these only read it.
 * Both routes sit under /v1/admin, so the gated app's operator check (platform.ts) already guards them.
 *
 *   GET /v1/admin/export/utterances.csv?day=YYYY-MM-DD[&player_id=…]   one row per utterance that KST day
 *   GET /v1/admin/export/lesson-minutes.csv?lesson_id=…  |  ?day=YYYY-MM-DD   the per-minute progress table
 *
 * Children appear by nickname and id only (no guardian fields, no birth year). Files are UTF-8 with a BOM and CRLF
 * so Excel opens Korean text as is; text cells that start like a formula are prefixed with ' (CSV injection).
 */

export type ExportDeps = Pick<LessonModeDeps, 'sql' | 'db' | 'nowMs'>;

const KST_OFFSET_MS = 9 * 3_600_000;
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The KST calendar day of a moment, as YYYY-MM-DD. */
export function kstDay(ms: number): string {
  return new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** [start, end) in epoch ms of a KST calendar day, or null when the text is not a real date. */
export function kstDayRange(day: string): { from: number; to: number } | null {
  const m = DAY_RE.exec(day);
  if (!m) return null;
  const from = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - KST_OFFSET_MS;
  if (!Number.isFinite(from) || kstDay(from) !== day) return null;
  return { from, to: from + 86_400_000 };
}

/** KST wall time with offset, e.g. 2026-11-16T15:04:05+09:00 (what a teacher reads in Excel). */
export function kstIso(ms: number): string {
  return new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 19) + '+09:00';
}

/** One CSV cell (RFC 4180): quoted when needed; text that a spreadsheet would run as a formula gets a leading '. */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: readonly string[], rows: ReadonlyArray<ReadonlyArray<unknown>>): string {
  return '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

const csvResponse = (body: string, filename: string) =>
  new Response(body, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'private, no-store',
      'x-robots-tag': 'noindex, nofollow'
    }
  });

export const UTTERANCE_CSV_COLUMNS = [
  'at_kst',
  'lesson_id',
  'player_id',
  'nickname',
  'session_kind',
  'mode',
  'stage_id',
  'target_text',
  'heard_text',
  'stars',
  'hint_level',
  'attempts',
  'speak_ms'
] as const;

export const MINUTE_CSV_COLUMNS = [
  'lesson_id',
  'player_id',
  'nickname',
  'minute',
  'minute_start_kst',
  'activity',
  'student_ms',
  'teacher_ms',
  'exchanges',
  'minute_complete'
] as const;

type UtteranceRow = {
  created_at: number;
  session_id: string;
  session_kind: string;
  player_id: string;
  nickname: string | null;
  ctx: string;
  target_text: string;
  final_text: string;
  stars: number;
  hint_level: string;
  attempts: number;
  dur_ms: number;
}

export function buildExportApp(d: ExportDeps): Hono {
  const app = new Hono();

  const dayOf = (q: string | undefined) => {
    const day = q && q.trim() ? q.trim() : kstDay(d.nowMs());
    const range = kstDayRange(day);
    return range ? { day, ...range } : null;
  };

  app.get('/v1/admin/export/utterances.csv', (c) => {
    const day = dayOf(c.req.query('day'));
    if (!day) return c.json({ error: 'invalid_day', expected: 'YYYY-MM-DD (KST)' }, 400);
    const player = c.req.query('player_id')?.trim() || null;
    const rows = d.sql.all<UtteranceRow>(
      `select u.created_at, u.session_id, u.session_kind, u.player_id, p.nickname, u.ctx, u.target_text, u.final_text,
              u.stars, u.hint_level, u.attempts, u.dur_ms
         from utterances u left join players p on p.id = u.player_id
        where u.created_at >= ? and u.created_at < ? ${player ? 'and u.player_id = ?' : ''}
        order by u.player_id, u.created_at, u.id`,
      player ? [day.from, day.to, player] : [day.from, day.to]
    );
    const body = toCsv(
      UTTERANCE_CSV_COLUMNS,
      rows.map((u) => [
        kstIso(u.created_at),
        u.session_kind === 'lesson' ? u.session_id : '',
        u.player_id,
        u.nickname ?? '',
        u.session_kind,
        // Lesson vs solo `mode` on the record lands with dom/teacher-presence; empty until then (session_kind says it today).
        '',
        u.ctx,
        u.target_text,
        u.final_text,
        u.stars,
        u.hint_level,
        u.attempts,
        u.dur_ms
      ])
    );
    return csvResponse(body, `lcw-utterances-${day.day}${player ? `-${player.replace(/[^\w-]/g, '_')}` : ''}.csv`);
  });

  app.get('/v1/admin/export/lesson-minutes.csv', (c) => {
    const lessonId = c.req.query('lesson_id')?.trim() || null;
    const day = lessonId ? null : dayOf(c.req.query('day'));
    if (!lessonId && !day) return c.json({ error: 'invalid_day', expected: 'YYYY-MM-DD (KST)' }, 400);
    const lessons = d.sql.all<{ id: string; player_id: string; started_at: number; nickname: string | null }>(
      `select l.id, l.player_id, l.started_at, p.nickname from lessons l left join players p on p.id = l.player_id
        where ${lessonId ? 'l.id = ?' : 'l.started_at >= ? and l.started_at < ?'} order by l.started_at, l.id`,
      lessonId ? [lessonId] : [day!.from, day!.to]
    );
    if (lessonId && !lessons.length) return c.json({ error: 'lesson_not_found' }, 404);
    const rows: unknown[][] = [];
    for (const l of lessons) {
      const { minutes, complete } = lessonMinutes(d, l.id);
      for (const m of minutes)
        rows.push([
          l.id,
          l.player_id,
          l.nickname ?? '',
          m.minute,
          kstIso(l.started_at + m.minute * 60_000),
          m.activity,
          m.student_ms,
          m.teacher_ms,
          m.exchanges,
          m.minute < complete ? 1 : 0
        ]);
    }
    const name = lessonId ? lessonId.replace(/[^\w-]/g, '_') : day!.day;
    return csvResponse(toCsv(MINUTE_CSV_COLUMNS, rows), `lcw-lesson-minutes-${name}.csv`);
  });

  return app;
}
