import { Hono } from 'hono';
import { z } from 'zod';
import type { SqliteExecutor } from './storage.js';
import { PUSH_COPY_KO, type PushKind } from './push-copy.js';
import { encryptPayload, isPushServiceEndpoint, makeVapidKeys, vapidAuthorization, b64url, type PushTarget, type VapidKeys } from './web-push.js';

/**
 * Guardian notices by Web Push (docs/09 §12): lesson reports (made, still unopened after 2 days), seat expiry
 * (7 days, 1 day, ended) and refund results go to the guardian's own devices that opted in on /family. Cost 0: the browsers' push services are free and the Worker does
 * the RFC 8291 encryption itself (web-push.ts).
 *
 * Nobody receives anything until the operator turns sending on (`POST /v1/admin/push/sending {enabled:true}`): until
 * then notices are queued and shown in `GET /v1/admin/push` as held. The first real send to a person is a release
 * step, not a side effect of a deploy.
 *
 * What a notice carries: a title, one line and a link to /family — never the child's name, a price or a seat id
 * (it shows on a lock screen).
 */

export const PUSH_SCHEMA_SQL = `
create table if not exists push_meta (k text primary key, v text not null);
create table if not exists push_subs (id text primary key, family_id text not null, guardian_id text not null, endpoint text not null unique, p256dh text not null, auth text not null, label text not null default '', created_at integer not null, last_ok_at integer, fails integer not null default 0, revoked_at integer, revoke_reason text);
create index if not exists push_subs_family on push_subs (family_id, revoked_at);
create table if not exists push_outbox (id text primary key, family_id text not null, kind text not null, ref text not null unique, created_at integer not null, status text not null, attempts integer not null default 0, sent_at integer, devices_ok integer not null default 0, last_error text);
create index if not exists push_outbox_status on push_outbox (status, created_at);
`;

const DAY = 86_400_000;
/** Notices older than this are not sent any more (a "7 days left" from last week is wrong now). */
export const PUSH_FRESH_MS = 2 * DAY;
/** A "test" press is only worth showing right away; held while sending is off, it expires instead of arriving later. */
export const PUSH_TEST_FRESH_MS = 10 * 60_000;
export const PUSH_MAX_ATTEMPTS = 5;
/** A device that failed this many sends in a row is dropped (it re-subscribes when the guardian opens /family). */
export const PUSH_MAX_DEVICE_FAILS = 5;
export const PUSH_MAX_DEVICES_PER_FAMILY = 10;
/** Push service keeps an undelivered notice this long (device offline). */
export const PUSH_TTL_S = 24 * 3600;
export const VAPID_SUBJECT = 'https://lcw.worldwidesomething.com';

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

export async function vapidKeys(sql: SqliteExecutor): Promise<VapidKeys> {
  sql.exec(PUSH_SCHEMA_SQL);
  const row = sql.get<{ v: string }>("select v from push_meta where k = 'vapid'");
  if (row) return JSON.parse(row.v) as VapidKeys;
  const keys = await makeVapidKeys();
  // Two first calls racing: the first insert wins and both read it back.
  sql.run("insert or ignore into push_meta (k, v) values ('vapid', ?)", [JSON.stringify(keys)]);
  return JSON.parse(sql.get<{ v: string }>("select v from push_meta where k = 'vapid'")!.v) as VapidKeys;
}

export function sendingEnabled(sql: SqliteExecutor): boolean {
  sql.exec(PUSH_SCHEMA_SQL);
  return sql.get<{ v: string }>("select v from push_meta where k = 'sending'")?.v === 'on';
}

export function setSending(sql: SqliteExecutor, on: boolean, by: string, nowMs: number): void {
  sql.exec(PUSH_SCHEMA_SQL);
  sql.run("insert into push_meta (k, v) values ('sending', ?) on conflict(k) do update set v = excluded.v", [on ? 'on' : 'off']);
  sql.run("insert into push_meta (k, v) values ('sending_changed', ?) on conflict(k) do update set v = excluded.v", [JSON.stringify({ on, by, at: nowMs })]);
}

/* ---------- subscriptions (guardian side, called from family.ts behind its guardian gate) ---------- */

export const SubscribeSchema = z
  .object({
    endpoint: z.string().min(10).max(1000),
    keys: z.object({ p256dh: z.string().min(80).max(100), auth: z.string().min(16).max(32) }).strict(),
    label: z.string().max(40).optional()
  })
  .strict();

export function subscribe(
  sql: SqliteExecutor,
  randomBytes: (n: number) => Uint8Array,
  g: { family_id: string; guardian_id: string },
  input: z.infer<typeof SubscribeSchema>,
  nowMs: number
): { ok: true; id: string } | { ok: false; status: 400 | 429; error: string } {
  sql.exec(PUSH_SCHEMA_SQL);
  if (!isPushServiceEndpoint(input.endpoint)) return { ok: false, status: 400, error: 'unknown_push_service' };
  let p: Uint8Array;
  let a: Uint8Array;
  try {
    p = b64url.decode(input.keys.p256dh);
    a = b64url.decode(input.keys.auth);
  } catch {
    return { ok: false, status: 400, error: 'bad_keys' };
  }
  if (p.length !== 65 || p[0] !== 4 || a.length !== 16) return { ok: false, status: 400, error: 'bad_keys' };
  const existing = sql.get<{ id: string }>('select id from push_subs where endpoint = ?', [input.endpoint]);
  if (existing) {
    // The same browser re-subscribing (or moving to another guardian login on that device): it belongs to the latest.
    sql.run(
      'update push_subs set family_id = ?, guardian_id = ?, p256dh = ?, auth = ?, label = ?, fails = 0, revoked_at = null, revoke_reason = null where id = ?',
      [g.family_id, g.guardian_id, input.keys.p256dh, input.keys.auth, input.label ?? '', existing.id]
    );
    return { ok: true, id: existing.id };
  }
  const n = Number(sql.get<{ n: number }>('select count(*) as n from push_subs where family_id = ? and revoked_at is null', [g.family_id])?.n ?? 0);
  if (n >= PUSH_MAX_DEVICES_PER_FAMILY) return { ok: false, status: 429, error: 'too_many_devices' };
  const id = `ps-${hex(randomBytes(9))}`;
  sql.run(
    'insert into push_subs (id, family_id, guardian_id, endpoint, p256dh, auth, label, created_at) values (?, ?, ?, ?, ?, ?, ?, ?)',
    [id, g.family_id, g.guardian_id, input.endpoint, input.keys.p256dh, input.keys.auth, input.label ?? '', nowMs]
  );
  return { ok: true, id };
}

export function unsubscribe(sql: SqliteExecutor, familyId: string, endpoint: string, nowMs: number): boolean {
  sql.exec(PUSH_SCHEMA_SQL);
  const r = sql.get<{ id: string }>('select id from push_subs where endpoint = ? and family_id = ? and revoked_at is null', [endpoint, familyId]);
  if (!r) return false;
  sql.run("update push_subs set revoked_at = ?, revoke_reason = 'guardian' where id = ?", [nowMs, r.id]);
  return true;
}

export function familyPushState(sql: SqliteExecutor, familyId: string, endpoint: string | null) {
  sql.exec(PUSH_SCHEMA_SQL);
  const devices = Number(sql.get<{ n: number }>('select count(*) as n from push_subs where family_id = ? and revoked_at is null', [familyId])?.n ?? 0);
  const thisDevice = endpoint
    ? Boolean(sql.get('select 1 as x from push_subs where endpoint = ? and family_id = ? and revoked_at is null', [endpoint, familyId]))
    : false;
  return { devices, this_device: thisDevice, sending: sendingEnabled(sql) };
}

/* ---------- outbox ---------- */

function enqueue(sql: SqliteExecutor, randomBytes: (n: number) => Uint8Array, familyId: string, kind: PushKind, ref: string, nowMs: number): boolean {
  const before = sql.get('select 1 as x from push_outbox where ref = ?', [ref]);
  if (before) return false;
  sql.run("insert or ignore into push_outbox (id, family_id, kind, ref, created_at, status) values (?, ?, ?, ?, ?, 'queued')", [
    `po-${hex(randomBytes(9))}`,
    familyId,
    kind,
    ref,
    nowMs
  ]);
  return true;
}

/**
 * Hourly, after the seat notice sweep: one push per seat notice (7d / 1d / expired) and per decided refund, to the
 * family of that child. Only fresh events (PUSH_FRESH_MS) so turning this on does not replay history.
 */
export function enqueueGuardianNotices(sql: SqliteExecutor, randomBytes: (n: number) => Uint8Array, nowMs: number): number {
  sql.exec(PUSH_SCHEMA_SQL);
  let n = 0;
  const hasSeats = sql.get("select 1 as x from sqlite_master where type = 'table' and name = 'seat_notices'");
  if (!hasSeats) return 0;
  const notices = sql.all<{ seat_id: string; kind: string; family_id: string }>(
    `select n.seat_id, n.kind, p.family_id from seat_notices n join seats s on s.id = n.seat_id join players p on p.id = s.player_id
     where n.at > ? and p.family_id is not null`,
    [nowMs - PUSH_FRESH_MS]
  );
  for (const r of notices) {
    const kind = r.kind === '7d' ? 'seat_7d' : r.kind === '1d' ? 'seat_1d' : r.kind === 'expired' ? 'seat_expired' : null;
    if (kind && enqueue(sql, randomBytes, r.family_id, kind, `seat:${r.seat_id}:${r.kind}`, nowMs)) n++;
  }
  const refunds = sql.all<{ id: string; status: string; family_id: string }>(
    `select r.id, r.status, p.family_id from seat_refunds r join seats s on s.id = r.seat_id join players p on p.id = s.player_id
     where r.decided_at is not null and r.decided_at > ? and r.status in ('done', 'declined') and p.family_id is not null`,
    [nowMs - PUSH_FRESH_MS]
  );
  for (const r of refunds) {
    const kind: PushKind = r.status === 'done' ? 'refund_done' : 'refund_declined';
    if (enqueue(sql, randomBytes, r.family_id, kind, `refund:${r.id}:${r.status}`, nowMs)) n++;
  }
  return n + enqueueReportNotices(sql, randomBytes, nowMs);
}

/**
 * Lesson reports (docs/09 P5 "공유 링크 생성 → 푸시", docs/10 §4 T5→T7): one notice when a lesson report is made and
 * one reminder when it is still unopened two days later (processPendingReportReminders marks it). Opened or revoked
 * reports are not announced; the share link itself never rides in a notice (lock screen) — it opens /family.
 */
export function enqueueReportNotices(sql: SqliteExecutor, randomBytes: (n: number) => Uint8Array, nowMs: number): number {
  sql.exec(PUSH_SCHEMA_SQL);
  const hasDeliveries = sql.get("select 1 as x from sqlite_master where type = 'table' and name = 'report_deliveries'");
  if (!hasDeliveries) return 0;
  let n = 0;
  const rows = sql.all<{ report_id: string; family_id: string; sent_at: number; reminder_sent_at: number | null }>(
    `select d.report_id, p.family_id, d.sent_at, d.reminder_sent_at from report_deliveries d join players p on p.id = d.player_id
     where d.kind = 'lesson' and p.family_id is not null and d.opened_at is null and (d.sent_at > ? or d.reminder_sent_at > ?)`,
    [nowMs - PUSH_FRESH_MS, nowMs - PUSH_FRESH_MS]
  );
  for (const r of rows) {
    if (reportClosed(sql, r.report_id)) continue;
    if (r.sent_at > nowMs - PUSH_FRESH_MS && enqueue(sql, randomBytes, r.family_id, 'lesson_report', `report:${r.report_id}`, nowMs)) n++;
    if (r.reminder_sent_at !== null && r.reminder_sent_at > nowMs - PUSH_FRESH_MS) {
      if (enqueue(sql, randomBytes, r.family_id, 'report_reminder', `report:${r.report_id}:reminder`, nowMs)) n++;
    }
  }
  return n;
}

/** Opened or revoked since it was queued: the notice has nothing left to say. */
function reportClosed(sql: SqliteExecutor, reportId: string): boolean {
  const r = sql.get<{ opened_at: number | null; share_token: string }>('select opened_at, share_token from report_deliveries where report_id = ?', [reportId]);
  if (!r) return true;
  if (r.opened_at !== null) return true;
  const revoked = sql.get("select 1 as x from sqlite_master where type = 'table' and name = 'report_revocations'")
    ? sql.get('select 1 as x from report_revocations where share_token = ?', [r.share_token])
    : undefined;
  return Boolean(revoked);
}

const reportOf = (ref: string): string | null => (ref.startsWith('report:') ? ref.slice(7).replace(/:reminder$/, '') : null);

export function enqueueTest(sql: SqliteExecutor, randomBytes: (n: number) => Uint8Array, familyId: string, nowMs: number): boolean {
  sql.exec(PUSH_SCHEMA_SQL);
  // At most one test a minute per family.
  return enqueue(sql, randomBytes, familyId, 'test', `test:${familyId}:${Math.floor(nowMs / 60_000)}`, nowMs);
}

export interface PushSender {
  send(target: PushTarget, payload: Uint8Array<ArrayBuffer>): Promise<{ status: number }>;
}

/** Real sender: encrypt for this browser, sign VAPID, POST to its push service. */
export function webPushSender(keys: VapidKeys, fetchImpl: Fetch, nowMs: () => number): PushSender {
  return {
    async send(target, payload) {
      if (!isPushServiceEndpoint(target.endpoint)) return { status: 400 };
      const body = await encryptPayload(target, payload);
      const res = await fetchImpl(target.endpoint, {
        method: 'POST',
        headers: {
          authorization: await vapidAuthorization(keys, target.endpoint, VAPID_SUBJECT, nowMs()),
          'content-encoding': 'aes128gcm',
          'content-type': 'application/octet-stream',
          ttl: String(PUSH_TTL_S),
          urgency: 'normal'
        },
        body
      });
      await res.arrayBuffer().catch(() => undefined);
      return { status: res.status };
    }
  };
}

export function noticePayload(kind: PushKind, id: string): Uint8Array<ArrayBuffer> {
  const c = PUSH_COPY_KO[kind];
  return new TextEncoder().encode(JSON.stringify({ title: c.title, body: c.body, url: '/family', tag: kind.startsWith('seat') ? 'seat' : kind === 'lesson_report' || kind === 'report_reminder' ? 'report' : kind, id }));
}

export interface DeliverResult {
  sending: boolean;
  held: number;
  sent: number;
  no_device: number;
  failed: number;
  expired: number;
  /** Report notices dropped because the report was opened or revoked first. */
  skipped: number;
  devices_dropped: number;
}

/** Sends queued notices if sending is on; otherwise leaves them queued (held). */
export async function deliverPush(sql: SqliteExecutor, sender: PushSender | null, nowMs: number, limit = 50): Promise<DeliverResult> {
  sql.exec(PUSH_SCHEMA_SQL);
  const r: DeliverResult = { sending: sendingEnabled(sql), held: 0, sent: 0, no_device: 0, failed: 0, expired: 0, skipped: 0, devices_dropped: 0 };
  const stale = "status = 'queued' and (created_at <= ? or (kind = 'test' and created_at <= ?))";
  const cut = [nowMs - PUSH_FRESH_MS, nowMs - PUSH_TEST_FRESH_MS];
  const exp = sql.get<{ n: number }>(`select count(*) as n from push_outbox where ${stale}`, cut);
  r.expired = Number(exp?.n ?? 0);
  sql.run(`update push_outbox set status = 'expired' where ${stale}`, cut);
  // A report the guardian already opened (or revoked) while its notice waited: drop the notice, do not announce it.
  for (const q of sql.all<{ id: string; ref: string }>("select id, ref from push_outbox where status = 'queued' and ref like 'report:%'")) {
    const rid = reportOf(q.ref);
    if (rid && reportClosed(sql, rid)) {
      sql.run("update push_outbox set status = 'skipped' where id = ?", [q.id]);
      r.skipped++;
    }
  }
  const queued = sql.all<{ id: string; family_id: string; kind: PushKind; attempts: number }>(
    "select id, family_id, kind, attempts from push_outbox where status = 'queued' order by created_at limit ?",
    [limit]
  );
  if (!r.sending || !sender) {
    r.held = queued.length;
    return r;
  }
  for (const item of queued) {
    const subs = sql.all<{ id: string; endpoint: string; p256dh: string; auth: string; fails: number }>(
      'select id, endpoint, p256dh, auth, fails from push_subs where family_id = ? and revoked_at is null',
      [item.family_id]
    );
    if (!subs.length) {
      sql.run("update push_outbox set status = 'no_device', attempts = attempts + 1 where id = ?", [item.id]);
      r.no_device++;
      continue;
    }
    let ok = 0;
    let lastError = '';
    for (const s of subs) {
      let status = 0;
      try {
        status = (await sender.send({ endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth }, noticePayload(item.kind, item.id))).status;
      } catch (e) {
        lastError = e instanceof Error ? e.message.slice(0, 120) : 'send_error';
      }
      if (status >= 200 && status < 300) {
        ok++;
        sql.run('update push_subs set last_ok_at = ?, fails = 0 where id = ?', [nowMs, s.id]);
      } else if (status === 404 || status === 410) {
        // The browser unsubscribed or the subscription expired: drop it.
        sql.run("update push_subs set revoked_at = ?, revoke_reason = 'gone' where id = ?", [nowMs, s.id]);
        r.devices_dropped++;
      } else {
        if (status) lastError = `http_${status}`;
        const fails = s.fails + 1;
        sql.run('update push_subs set fails = ? where id = ?', [fails, s.id]);
        if (fails >= PUSH_MAX_DEVICE_FAILS) {
          sql.run("update push_subs set revoked_at = ?, revoke_reason = 'failing' where id = ?", [nowMs, s.id]);
          r.devices_dropped++;
        }
      }
    }
    if (ok > 0) {
      sql.run("update push_outbox set status = 'sent', sent_at = ?, devices_ok = ?, attempts = attempts + 1, last_error = null where id = ?", [nowMs, ok, item.id]);
      r.sent++;
    } else {
      const attempts = item.attempts + 1;
      const still = sql.get('select 1 as x from push_subs where family_id = ? and revoked_at is null', [item.family_id]);
      const status = !still ? 'no_device' : attempts >= PUSH_MAX_ATTEMPTS ? 'failed' : 'queued';
      sql.run('update push_outbox set status = ?, attempts = ?, last_error = ? where id = ?', [status, attempts, lastError || null, item.id]);
      if (status === 'failed') r.failed++;
      if (status === 'no_device') r.no_device++;
    }
  }
  return r;
}

/* ---------- operator ---------- */

export function buildPushAdminApp(d: { sql: SqliteExecutor; nowMs: () => number }): Hono {
  const app = new Hono();
  app.get('/v1/admin/push', (c) => {
    d.sql.exec(PUSH_SCHEMA_SQL);
    const byStatus = Object.fromEntries(
      d.sql.all<{ status: string; n: number }>('select status, count(*) as n from push_outbox group by status').map((r) => [r.status, Number(r.n)])
    );
    const changed = d.sql.get<{ v: string }>("select v from push_meta where k = 'sending_changed'");
    return c.json({
      sending: sendingEnabled(d.sql),
      sending_changed: changed ? JSON.parse(changed.v) : null,
      devices: Number(d.sql.get<{ n: number }>('select count(*) as n from push_subs where revoked_at is null')?.n ?? 0),
      families_with_devices: Number(d.sql.get<{ n: number }>('select count(distinct family_id) as n from push_subs where revoked_at is null')?.n ?? 0),
      outbox: byStatus,
      recent: d.sql.all(
        'select id, family_id, kind, status, created_at, sent_at, devices_ok, attempts, last_error from push_outbox order by created_at desc limit 30'
      ),
      now: d.nowMs()
    });
  });
  app.post('/v1/admin/push/sending', async (c) => {
    const p = z
      .object({ enabled: z.boolean(), by: z.string().min(1).max(40) })
      .strict()
      .safeParse(await c.req.json().catch(() => ({})));
    if (!p.success) return c.json({ error: 'invalid' }, 400);
    setSending(d.sql, p.data.enabled, p.data.by, d.nowMs());
    return c.json({ sending: p.data.enabled });
  });
  return app;
}
