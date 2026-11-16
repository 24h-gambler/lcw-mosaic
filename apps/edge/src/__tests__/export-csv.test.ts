import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlatformDO, type LcwEnv } from '../platform.js';
import { MINUTE_CSV_COLUMNS, UTTERANCE_CSV_COLUMNS, csvCell, kstDayRange, toCsv } from '../export-csv.js';
import { fakeDurableStorage } from './fake-do.js';

const TOKEN = 'op-token-0123456789abcdef';
const op = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };

function platform() {
  return new PlatformDO({ storage: fakeDurableStorage() }, { PLATFORM: undefined as never, LCW_OPERATOR_TOKEN: TOKEN } as LcwEnv);
}
async function call(p: PlatformDO, method: string, path: string, body?: unknown, headers: Record<string, string> = op) {
  const res = await p.fetch(new Request(`https://x${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
  // Keep the BOM: Response.text() strips it while decoding, so read the bytes (Excel needs EF BB BF on disk).
  const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(await res.arrayBuffer());
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* csv */
  }
  return { status: res.status, headers: res.headers, text, body: json };
}

/** Minimal RFC 4180 reader for the tests (quotes, doubled quotes, CRLF). */
function parseCsv(text: string): string[][] {
  expect(text.charCodeAt(0)).toBe(0xfeff);
  const s = text.slice(1);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (q) {
      if (ch === '"' && s[i + 1] === '"') (cell += '"'), i++;
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') row.push(cell), (cell = '');
    else if (ch === '\r' && s[i + 1] === '\n') {
      row.push(cell), rows.push(row), (row = []), (cell = ''), i++;
    } else cell += ch;
  }
  expect(row.length === 0 && cell === '').toBe(true); // ends with CRLF
  return rows;
}
const asObjects = (rows: string[][]) => rows.slice(1).map((r) => Object.fromEntries(rows[0]!.map((h, i) => [h, r[i]])));

async function startLesson(p: PlatformDO, playerId: string, nickname: string) {
  await call(p, 'POST', '/v1/admin/players', { family_id: `fam-${playerId}`, guardian_id: `g-${playerId}`, player_id: playerId, nickname, birth_year: 2016, level: 'L1' });
  const s = await call(p, 'POST', '/v1/admin/lessons/start', { player_id: playerId });
  expect(s.status).toBe(201);
  const j = await call(p, 'POST', '/v1/join', { code: s.body.join_code }, { 'content-type': 'application/json' });
  expect(j.status).toBe(200);
  return { lessonId: s.body.lesson_id as string, st: { authorization: `Bearer ${j.body.student_token}`, 'content-type': 'application/json' } };
}

// 2026-11-16 15:00 KST = 06:00 UTC
const T0 = Date.parse('2026-11-16T06:00:00Z');

afterEach(() => {
  vi.useRealTimers();
});

describe('csv helpers', () => {
  it('quotes, doubles quotes, neutralises formulas, BOM + CRLF', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    for (const lead of ['+', '-', '@', '\t', '\r']) expect(csvCell(`${lead}1`).replace(/^"/, '').startsWith(`'${lead}`)).toBe(true);
    expect(csvCell(-3)).toBe('-3'); // numbers are not text: no prefix
    expect(csvCell(null)).toBe('');
    expect(toCsv(['a', 'b'], [[1, 'x']])).toBe('﻿a,b\r\n1,x\r\n');
  });

  it('KST day ranges', () => {
    expect(kstDayRange('2026-11-16')).toEqual({ from: Date.parse('2026-11-15T15:00:00Z'), to: Date.parse('2026-11-16T15:00:00Z') });
    expect(kstDayRange('2026-02-30')).toBeNull();
    expect(kstDayRange('16-11-2026')).toBeNull();
  });
});

describe('operator CSV exports (GET /v1/admin/export/*)', () => {
  it('operator only: 401 without the token, 401 with a student token', async () => {
    const p = platform();
    const { st } = await startLesson(p, 'kid-1', 'Oreo');
    for (const path of ['/v1/admin/export/utterances.csv', '/v1/admin/export/lesson-minutes.csv'])
      for (const h of [{}, st]) expect((await call(p, 'GET', path, undefined, h as Record<string, string>)).status).toBe(401);
  });

  it('utterances: one row per utterance of the KST day, nickname and ids only, injection-safe, filters by player', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    const p = platform();
    const a = await startLesson(p, 'kid-1', 'Oreo');
    const b = await startLesson(p, 'kid-2', 'Juno');
    await call(p, 'POST', `/v1/admin/lessons/${a.lessonId}/stage`, { stage_id: 'cafe_order', targets: ['Can I have a warm honey tea?'] });
    await call(p, 'POST', `/v1/admin/lessons/${b.lessonId}/stage`, { stage_id: 'cafe_order', targets: ['Can I have a warm honey tea?'] });
    const say = (st: Record<string, string>, transcript: string, extra: Record<string, unknown> = {}) =>
      call(p, 'POST', '/v1/lesson/utterance', { target_text: 'Can I have a warm honey tea?', transcript, chosen_stars: 2, dur_ms: 2100, ...extra }, st);

    vi.setSystemTime(T0 + 61_000);
    expect((await say(a.st, 'can I have a warm honey tea', { hint_level: 'keyword' })).status).toBe(200);
    vi.setSystemTime(T0 + 125_000);
    expect((await say(a.st, '=cmd, "tea"')).status).toBe(200);
    vi.setSystemTime(T0 + 130_000);
    expect((await say(b.st, 'can I have a warm honey tea')).status).toBe(200);
    // 2026-11-17 00:30 KST belongs to the next KST day (still 11-16 in UTC)
    vi.setSystemTime(Date.parse('2026-11-16T15:30:00Z'));
    expect((await say(a.st, 'can I have a warm honey tea')).status).toBe(200);

    vi.setSystemTime(T0 + 200_000);
    const r = await call(p, 'GET', '/v1/admin/export/utterances.csv');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(r.headers.get('content-disposition')).toBe('attachment; filename="lcw-utterances-2026-11-16.csv"');
    expect(r.headers.get('cache-control')).toBe('private, no-store');
    const rows = parseCsv(r.text);
    expect(rows[0]).toEqual([...UTTERANCE_CSV_COLUMNS]);
    const objs = asObjects(rows);
    expect(objs).toHaveLength(3);
    expect(objs.map((o) => o.nickname)).toEqual(['Oreo', 'Oreo', 'Juno']);
    const first = objs[0]!;
    expect(first).toMatchObject({
      at_kst: '2026-11-16T15:01:01+09:00',
      lesson_id: a.lessonId,
      player_id: 'kid-1',
      session_kind: 'lesson',
      mode: '',
      stage_id: 'cafe_order',
      target_text: 'Can I have a warm honey tea?',
      heard_text: 'can I have a warm honey tea',
      hint_level: 'keyword',
      attempts: '1',
      speak_ms: '2100'
    });
    expect(Number(first.stars)).toBeGreaterThan(0);
    expect(objs[1]!.heard_text).toBe(`'=cmd, "tea"`);
    expect(r.text).not.toContain('fam-kid-1');
    expect(r.text).not.toContain('2016');

    const next = asObjects(parseCsv((await call(p, 'GET', '/v1/admin/export/utterances.csv?day=2026-11-17')).text));
    expect(next.map((o) => o.at_kst)).toEqual(['2026-11-17T00:30:00+09:00']);
    const one = await call(p, 'GET', '/v1/admin/export/utterances.csv?day=2026-11-16&player_id=kid-2');
    expect(one.headers.get('content-disposition')).toBe('attachment; filename="lcw-utterances-2026-11-16-kid-2.csv"');
    expect(asObjects(parseCsv(one.text)).map((o) => o.nickname)).toEqual(['Juno']);
    expect((await call(p, 'GET', '/v1/admin/export/utterances.csv?day=2026-13-01')).status).toBe(400);
  });

  it('by day, smoke-check and demo students are left out unless include_test=1; asked by id they are returned', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    const p = platform();
    const real = await startLesson(p, 'kid-1', 'Oreo');
    const smoke = await startLesson(p, 'smoke-20261116', 'Smoke');
    const demo = await startLesson(p, 'player-demo', 'Demo');
    for (const l of [real, smoke, demo]) {
      await call(p, 'POST', `/v1/admin/lessons/${l.lessonId}/stage`, { stage_id: 'cafe_order', targets: ['Can I have a warm honey tea?'] });
      const r = await call(p, 'POST', '/v1/lesson/utterance', { target_text: 'Can I have a warm honey tea?', transcript: 'can I have a warm honey tea', chosen_stars: 2, dur_ms: 2000 }, l.st);
      expect(r.status).toBe(200);
    }
    vi.setSystemTime(T0 + 120_000);
    const players = async (path: string) => [...new Set(asObjects(parseCsv((await call(p, 'GET', path)).text)).map((o) => o.player_id))].sort();

    expect(await players('/v1/admin/export/utterances.csv')).toEqual(['kid-1']);
    expect(await players('/v1/admin/export/utterances.csv?include_test=1')).toEqual(['kid-1', 'player-demo', 'smoke-20261116']);
    expect(await players('/v1/admin/export/utterances.csv?player_id=smoke-20261116')).toEqual(['smoke-20261116']);

    expect(await players('/v1/admin/export/lesson-minutes.csv?day=2026-11-16')).toEqual(['kid-1']);
    expect(await players('/v1/admin/export/lesson-minutes.csv?day=2026-11-16&include_test=1')).toEqual(['kid-1', 'player-demo', 'smoke-20261116']);
    expect(await players(`/v1/admin/export/lesson-minutes.csv?lesson_id=${demo.lessonId}`)).toEqual(['player-demo']);
  });

  it('lesson minutes: the same per-minute table the director feed shows, by lesson or by KST day', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    const p = platform();
    const a = await startLesson(p, 'kid-1', 'Oreo');
    await call(p, 'POST', `/v1/admin/lessons/${a.lessonId}/stage`, { stage_id: 'cafe_order', targets: ['Can I have a warm honey tea?'] });
    vi.setSystemTime(T0 + 70_000);
    await call(p, 'POST', '/v1/lesson/utterance', { target_text: 'Can I have a warm honey tea?', transcript: 'can I have a warm honey tea', chosen_stars: 2, dur_ms: 2000 }, a.st);
    vi.setSystemTime(T0 + 190_000);

    const feed = await call(p, 'GET', `/v1/admin/lessons/${a.lessonId}/feed`);
    expect(feed.status).toBe(200);
    const r = await call(p, 'GET', `/v1/admin/export/lesson-minutes.csv?lesson_id=${a.lessonId}`);
    expect(r.status).toBe(200);
    const rows = parseCsv(r.text);
    expect(rows[0]).toEqual([...MINUTE_CSV_COLUMNS]);
    const objs = asObjects(rows);
    expect(objs.map((o) => Number(o.minute))).toEqual(feed.body.minutes.map((m: { minute: number }) => m.minute));
    for (const [i, m] of (feed.body.minutes as Array<Record<string, unknown>>).entries())
      expect(objs[i]).toMatchObject({
        activity: String(m.activity),
        student_ms: String(m.student_ms),
        teacher_ms: String(m.teacher_ms),
        exchanges: String(m.exchanges)
      });
    expect(objs[1]).toMatchObject({ minute: '1', minute_start_kst: '2026-11-16T15:01:00+09:00', exchanges: '1', nickname: 'Oreo', minute_complete: '1' });
    expect(objs.at(-1)!.minute_complete).toBe('0'); // the running minute is not over yet

    const byDay = asObjects(parseCsv((await call(p, 'GET', '/v1/admin/export/lesson-minutes.csv?day=2026-11-16')).text));
    expect(byDay).toHaveLength(objs.length);
    expect(asObjects(parseCsv((await call(p, 'GET', '/v1/admin/export/lesson-minutes.csv?day=2026-11-15')).text))).toHaveLength(0);
    expect((await call(p, 'GET', '/v1/admin/export/lesson-minutes.csv?lesson_id=les-nope')).status).toBe(404);
  });
});
