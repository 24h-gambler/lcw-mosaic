import { Hono } from 'hono';
import { z } from 'zod';
import type { SqliteExecutor } from './storage.js';

/**
 * Public site back end (docs/14 §10 counters, W04 consult form; WP-701/703).
 *
 * - `/v1/site/event`: cookie-free daily counters. The body is only an event name and a page path; nothing that
 *   identifies a visitor is read or stored (no IP, no user agent, no id). Showroom tokens are folded to `/s/*`.
 * - `/v1/site/consult`: tutoring consult requests (name + phone or e-mail). Kept for CONSULT_RETENTION_MS, listed
 *   to the operator only, with a per-address hourly cap (the address is stored only as a salted hash bucket).
 */

export const SITE_EVENTS = [
  'entrance_parents',
  'entrance_players',
  'try_start',
  'mic_allowed',
  'order_done',
  'save_yes',
  'save_no',
  'send_to_parent',
  'pricing_view',
  'consult_submit',
  // R326: the world entrance and the paid step
  'entrance_play',
  'checkout_start',
  'checkout_done'
] as const;

export const CONSULT_RETENTION_MS = 180 * 86_400_000;
export const CONSULTS_PER_HOUR_PER_CLIENT = 5;
export const CONSULTS_PER_HOUR_GLOBAL = 120;
/** Counter rows a single day may hold; beyond this new (event, path) pairs are dropped, existing ones still count. */
export const SITE_EVENT_ROWS_PER_DAY = 2_000;

/** Public routes this module serves (platform.ts isPublicRoute lists exactly these). */
export const SITE_PUBLIC_ROUTES: ReadonlyArray<readonly [string, RegExp]> = [
  ['POST', /^\/v1\/site\/event$/],
  ['POST', /^\/v1\/site\/consult$/]
];

export const SITE_SCHEMA = `
create table if not exists site_event_daily (day text not null, event text not null, path text not null, n integer not null, primary key (day, event, path));
create table if not exists site_consults (id text primary key, created_at integer not null, name text not null, contact text not null, grade text not null, days text not null, note text not null, handled_at integer);
create table if not exists site_limits (k text not null, hour integer not null, n integer not null, primary key (k, hour))
`;

const EventBody = z.object({
  event: z.enum(SITE_EVENTS),
  path: z.string().max(200)
});

const PHONE = /^[0-9+\-\s()]{9,20}$/;
const MAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ConsultBody = z
  .object({
    name: z.string().trim().min(1).max(40),
    contact: z.string().trim().min(5).max(80),
    grade: z.string().max(20).default(''),
    days: z.array(z.string().max(12)).max(7).default([]),
    note: z.string().max(500).default('')
  })
  .refine((b) => (PHONE.test(b.contact) && b.contact.replace(/\D/g, '').length >= 9) || MAIL.test(b.contact), {
    message: 'contact must be a phone number or an e-mail address',
    path: ['contact']
  });

/** Folds a page path to a counter key: query/hash dropped, showroom tokens hidden, unknown shapes bucketed. */
export function counterPath(path: string): string {
  const clean = (path.split(/[?#]/)[0] ?? '/').replace(/\/+$/, '') || '/';
  if (clean.startsWith('/s/')) return '/s/*';
  if (!/^\/[a-z0-9/_-]{0,63}$/.test(clean)) return '/other';
  return clean;
}

export interface SiteDeps {
  sql: SqliteExecutor;
  nowMs: () => number;
  randomBytes: (n: number) => Uint8Array;
  sha256Hex: (s: string) => Promise<string>;
}

function kstDay(ms: number): string {
  return new Date(ms + 9 * 3_600_000).toISOString().slice(0, 10);
}

export function buildSiteApp(d: SiteDeps): Hono {
  d.sql.exec(SITE_SCHEMA);
  const app = new Hono();
  const hour = () => Math.floor(d.nowMs() / 3_600_000);
  const count = (k: string) => d.sql.get<{ n: number }>('select n from site_limits where k = ? and hour = ?', [k, hour()])?.n ?? 0;
  const bump = (k: string) =>
    d.sql.run('insert into site_limits (k, hour, n) values (?, ?, 1) on conflict(k, hour) do update set n = n + 1', [k, hour()]);

  app.post('/v1/site/event', async (c) => {
    const raw: unknown = await c.req.json().catch(() => null);
    const p = EventBody.safeParse(raw);
    if (!p.success) return c.json({ error: 'invalid' }, 400);
    const day = kstDay(d.nowMs());
    const path = counterPath(p.data.path);
    const exists = d.sql.get('select 1 as x from site_event_daily where day = ? and event = ? and path = ?', [day, p.data.event, path]);
    if (!exists) {
      const rows = d.sql.get<{ n: number }>('select count(*) as n from site_event_daily where day = ?', [day])?.n ?? 0;
      if (rows >= SITE_EVENT_ROWS_PER_DAY) return c.body(null, 204);
    }
    d.sql.run(
      'insert into site_event_daily (day, event, path, n) values (?, ?, ?, 1) on conflict(day, event, path) do update set n = n + 1',
      [day, p.data.event, path]
    );
    c.header('cache-control', 'no-store');
    return c.body(null, 204);
  });

  app.post('/v1/site/consult', async (c) => {
    // The address only picks a rate-limit bucket; it is hashed with the hour and never stored as is.
    const ip = c.req.header('cf-connecting-ip') ?? 'local';
    const bucket = `consult:${(await d.sha256Hex(`${ip}|${hour()}`)).slice(0, 16)}`;
    if (count(bucket) >= CONSULTS_PER_HOUR_PER_CLIENT || count('consult:*') >= CONSULTS_PER_HOUR_GLOBAL) {
      return c.json({ error: 'too_many_requests' }, 429);
    }
    const raw: unknown = await c.req.json().catch(() => null);
    const p = ConsultBody.safeParse(raw);
    if (!p.success) return c.json({ error: 'invalid', fields: p.error.issues.map((i) => i.path.join('.')) }, 400);
    bump(bucket);
    bump('consult:*');
    const now = d.nowMs();
    const id = `c_${Array.from(d.randomBytes(9), (b) => b.toString(16).padStart(2, '0')).join('')}`;
    d.sql.run('delete from site_consults where created_at < ?', [now - CONSULT_RETENTION_MS]);
    d.sql.run('delete from site_limits where hour < ?', [hour() - 48]);
    d.sql.run(
      'insert into site_consults (id, created_at, name, contact, grade, days, note) values (?, ?, ?, ?, ?, ?, ?)',
      [id, now, p.data.name, p.data.contact, p.data.grade, JSON.stringify(p.data.days), p.data.note.trim()]
    );
    c.header('cache-control', 'no-store');
    return c.json({ ok: true }, 201);
  });

  // Operator only (not in SITE_PUBLIC_ROUTES, so the platform gate asks for the operator token).
  app.get('/v1/admin/site/consults', (c) => {
    const rows = d.sql.all<{ id: string; created_at: number; name: string; contact: string; grade: string; days: string; note: string; handled_at: number | null }>(
      'select id, created_at, name, contact, grade, days, note, handled_at from site_consults order by created_at desc limit 200'
    );
    c.header('cache-control', 'private, no-store');
    return c.json(rows.map((r) => ({ ...r, days: JSON.parse(r.days) as string[] })));
  });
  app.post('/v1/admin/site/consults/:id/handled', (c) => {
    const id = c.req.param('id');
    const row = d.sql.get('select 1 as x from site_consults where id = ?', [id]);
    if (!row) return c.json({ error: 'not_found' }, 404);
    d.sql.run('update site_consults set handled_at = ? where id = ?', [d.nowMs(), id]);
    return c.json({ ok: true });
  });
  app.get('/v1/admin/site/events', (c) => {
    const days = Math.min(90, Math.max(1, Number(c.req.query('days') ?? 14) || 14));
    const since = kstDay(d.nowMs() - (days - 1) * 86_400_000);
    return c.json(
      d.sql.all('select day, event, path, n from site_event_daily where day >= ? order by day desc, event, path', [since])
    );
  });
  return app;
}
