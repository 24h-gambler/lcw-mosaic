import { Hono } from 'hono';
import { z } from 'zod';
import type { EdgePlatformDb, SqliteExecutor } from './storage.js';
import { DEVICE_TOKEN_TTL_MS, FAMILY_FAILS_GLOBAL_PER_HOUR, FAMILY_FAILS_PER_HOUR } from './family.js';

/**
 * English Day sign-in hand-off (R2734③, automation docs/handbook/06-pipelines/english-day-accounts.md §4).
 *
 * The student's day starts on the English Day lesson doc (engday.pages.dev). A student who signed in there and taps
 * the LCW step goes to `/link?edt=<ticket>`. The ticket is made by English Day for that signed-in student only: 2 minutes,
 * HMAC-signed with English Day's own secret. This server never holds that secret — it asks English Day
 * (`POST <ENGDAY_ORIGIN>/api/sso/verify`) whether the ticket is real and whose it is.
 *
 * A real ticket alone does not open an LCW child: the operator first pairs the English Day student key with the LCW
 * player (`PUT /v1/admin/students/:id/ed-link`, the home PC fills it from the lesson state `profile.lcw_player_id`).
 * Only that pair, only once per ticket (`ed_link_used`), and only for a family that gave the required service consent
 * (docs/16 §3, same rule as the teacher's device code) gets an ordinary device token (`devices` row, as
 * `/v1/device/link`). The world then attaches the teacher's lesson by itself (`/v1/device/lesson`).
 */

export const ENGDAY_ORIGIN_DEFAULT = 'https://engday.pages.dev';
/** English Day sign-ins kept per student (a laptop and a spare); older ones are revoked when a new one comes in. */
export const ED_DEVICES_KEPT = 3;
/** English Day student keys (its KEY_RE): lowercase letters, digits, Hangul, `_` and `-`. */
const ED_KEY = /^[a-z0-9가-힣_-]{1,40}$/;

export const ED_LINK_PUBLIC_ROUTES: ReadonlyArray<readonly [string, RegExp]> = [['POST', /^\/v1\/device\/ed-link$/]];

export const ED_LINK_SCHEMA = `
create table if not exists ed_links (player_id text primary key, student text unique not null, at integer not null);
create table if not exists ed_link_used (jti text primary key, at integer not null);
create table if not exists family_failures (k text not null, hour integer not null, n integer not null, primary key (k, hour))
`;

export interface EdTicket {
  ok: boolean;
  student?: string;
  lcw_player_id?: string;
  jti?: string;
  exp?: number;
}

export interface EdLinkDeps {
  sql: SqliteExecutor;
  db: EdgePlatformDb;
  nowMs: () => number;
  randomBytes: (n: number) => Uint8Array;
  sha256Hex: (s: string) => Promise<string>;
  /** Asks English Day whether a ticket is real. Default: POST to `<ENGDAY_ORIGIN>/api/sso/verify`. */
  verify?: (ticket: string) => Promise<EdTicket | null>;
  engdayOrigin?: string;
}

const TicketSchema = z
  .object({ ticket: z.string().regex(/^[A-Za-z0-9_-]{10,600}\.[0-9a-f]{64}$/), label: z.string().trim().max(24).default('') })
  .strict();
const PairSchema = z.object({ student: z.string().regex(ED_KEY) }).strict();

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

export function engdayVerifier(origin: string): (ticket: string) => Promise<EdTicket | null> {
  return async (ticket) => {
    try {
      const res = await fetch(`${origin.replace(/\/+$/, '')}/api/sso/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ticket })
      });
      if (res.status === 403 || res.status === 400) return { ok: false };
      if (!res.ok) return null;
      return (await res.json()) as EdTicket;
    } catch {
      return null;
    }
  };
}

export function buildEdLinkApp(d: EdLinkDeps): Hono {
  d.sql.exec(ED_LINK_SCHEMA);
  const app = new Hono();
  const verify = d.verify ?? engdayVerifier(d.engdayOrigin || ENGDAY_ORIGIN_DEFAULT);
  const hour = () => Math.floor(d.nowMs() / 3_600_000);
  const count = (k: string) => d.sql.get<{ n: number }>('select n from family_failures where k = ? and hour = ?', [k, hour()])?.n ?? 0;
  const bump = (k: string) =>
    d.sql.run('insert into family_failures (k, hour, n) values (?, ?, 1) on conflict(k, hour) do update set n = n + 1', [k, hour()]);
  const ipKey = (req: Request) => `edlink:${req.headers.get('cf-connecting-ip') ?? 'local'}`;
  const limited = (req: Request) => count(ipKey(req)) >= FAMILY_FAILS_PER_HOUR || count('edlink:*') >= FAMILY_FAILS_GLOBAL_PER_HOUR;
  const failed = (req: Request) => {
    bump(ipKey(req));
    bump('edlink:*');
  };
  const familyConsented = (familyId: string) =>
    Boolean(d.sql.get("select v from family_flags where family_id = ? and k = 'service' and v = 1", [familyId]));

  /* ---------- operator: pair an English Day student key with an LCW player ---------- */

  app.put('/v1/admin/students/:id/ed-link', async (c) => {
    const p = PairSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!p.success) return c.json({ error: 'invalid_student_key' }, 422);
    const id = c.req.param('id');
    if (!d.sql.get('select id from players where id = ?', [id])) return c.json({ error: 'player_not_found' }, 404);
    // One English Day student ↔ one LCW player: moving the key to another player drops the old pair.
    d.sql.run('delete from ed_links where student = ? or player_id = ?', [p.data.student, id]);
    d.sql.run('insert into ed_links (player_id, student, at) values (?, ?, ?)', [id, p.data.student, d.nowMs()]);
    return c.json({ ok: true, player_id: id, student: p.data.student });
  });

  app.delete('/v1/admin/students/:id/ed-link', (c) => {
    d.sql.run('delete from ed_links where player_id = ?', [c.req.param('id')]);
    return c.json({ ok: true });
  });

  app.get('/v1/admin/ed-links', (c) =>
    c.json({ links: d.sql.all<{ player_id: string; student: string; at: number }>('select player_id, student, at from ed_links order by student') })
  );

  /* ---------- the student's device: English Day ticket → device token ---------- */

  app.post('/v1/device/ed-link', async (c) => {
    c.header('cache-control', 'no-store');
    if (limited(c.req.raw)) return c.json({ error: 'too_many_attempts' }, 429);
    const p = TicketSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!p.success) {
      failed(c.req.raw);
      return c.json({ error: 'invalid_ticket' }, 400);
    }
    const t = await verify(p.data.ticket);
    if (t === null) return c.json({ error: 'engday_unreachable' }, 503);
    if (!t.ok || !t.student || !ED_KEY.test(t.student) || !t.jti || !(Number(t.exp) * 1000 > d.nowMs())) {
      failed(c.req.raw);
      return c.json({ error: 'invalid_ticket' }, 403);
    }
    const pair = d.sql.get<{ player_id: string }>('select player_id from ed_links where student = ?', [t.student]);
    if (!pair) return c.json({ error: 'not_linked' }, 403);
    // English Day may carry its own idea of the LCW id; if it names a different child, nothing opens.
    if (t.lcw_player_id && t.lcw_player_id !== pair.player_id) return c.json({ error: 'not_linked' }, 403);
    const kid = d.sql.get<{ id: string; family_id: string | null; nickname: string; level: string }>(
      'select id, family_id, nickname, level from players where id = ?',
      [pair.player_id]
    );
    if (!kid || !kid.family_id) return c.json({ error: 'not_linked' }, 403);
    if (!familyConsented(kid.family_id)) return c.json({ error: 'service_consent_required' }, 403);
    const now = d.nowMs();
    const jtiKey = `${t.student}:${t.jti}`.slice(0, 80);
    if (d.sql.get('select jti from ed_link_used where jti = ?', [jtiKey])) return c.json({ error: 'ticket_used' }, 403);
    d.sql.run('insert into ed_link_used (jti, at) values (?, ?)', [jtiKey, now]);
    d.sql.run('delete from ed_link_used where at < ?', [now - 86_400_000]);
    const token = hex(d.randomBytes(32));
    const devId = `dev-ed${hex(d.randomBytes(6))}`;
    d.sql.run(
      'insert into devices (id, player_id, family_id, token_hash, label, created_at, last_seen_at, revoked_at) values (?, ?, ?, ?, ?, ?, ?, null)',
      [devId, kid.id, kid.family_id, await d.sha256Hex(token), p.data.label || 'English Day 노트북', now, now]
    );
    // Every lesson the student comes in from English Day again: keep the newest few of these sign-ins, not one per day.
    d.sql.run(
      `update devices set revoked_at = ? where player_id = ? and revoked_at is null and id like 'dev-ed%' and id not in
         (select id from devices where player_id = ? and revoked_at is null and id like 'dev-ed%' order by created_at desc limit ?)`,
      [now, kid.id, kid.id, ED_DEVICES_KEPT]
    );
    return c.json({ device_token: token, nickname: kid.nickname, level: kid.level, expires_at: now + DEVICE_TOKEN_TTL_MS });
  });

  return app;
}
