import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { filterSpeechBubble } from '@lcw/converse';
import type { EdgePlatformDb, SqliteExecutor } from './storage.js';
import { REPORT_SHARE_TTL_MS, kstDayOf, stripIdentifiers, type PublicReportView } from './parent-report.js';

/**
 * Guardian domain (WP-301, docs/16 §3, docs/10 §5): family account, child profiles, separate consents, device link
 * codes, and the guardian's controls over lesson report links.
 *
 * Sign-in: the teacher (operator) issues a one-time family invite link (`/family#k=<invite>`); the guardian's browser
 * trades it for a guardian session token kept on that device. OAuth (guardians.oauth_sub) can be added as a second
 * way to reach the same session table — nothing here assumes the invite is the only one.
 */

export const FAMILY_INVITE_TTL_MS = 7 * 86_400_000;
export const GUARDIAN_SESSION_TTL_MS = 180 * 86_400_000;
export const DEVICE_CODE_TTL_MS = 10 * 60_000;
export const DEVICE_TOKEN_TTL_MS = 365 * 86_400_000;
/** Wrong invite/device codes per hour before the public exchange routes answer 429. */
export const FAMILY_FAILS_PER_HOUR = 20;

/**
 * Consents a guardian toggles one by one (docs/16 §3; docs/07 §4.5 lists the first four). `service` is the required one
 * and is given once for the family on first entry. There is deliberately no "turn everything on" route.
 */
export const GUARDIAN_CONSENT_SCOPES = ['voice_store', 'lesson_window', 'showroom_public', 'public_server', 'friend_voice'] as const;
export type GuardianConsentScope = (typeof GUARDIAN_CONSENT_SCOPES)[number];

export const FAMILY_SCHEMA = `
create table if not exists guardian_invites (code_hash text primary key, guardian_id text not null, family_id text not null, created_at integer not null, expires_at integer not null, used_at integer);
create table if not exists guardian_sessions (token_hash text primary key, guardian_id text not null, family_id text not null, created_at integer not null, expires_at integer not null, revoked_at integer);
create table if not exists device_link_codes (code text primary key, player_id text not null, family_id text not null, expires_at integer not null, used_at integer);
create table if not exists devices (id text primary key, player_id text not null, family_id text not null, token_hash text unique not null, label text not null, created_at integer not null, last_seen_at integer, revoked_at integer);
create table if not exists family_failures (k text not null, hour integer not null, n integer not null, primary key (k, hour));
create table if not exists report_revocations (share_token text primary key, revoked_at integer not null);
create table if not exists family_flags (family_id text not null, k text not null, v integer not null, at integer not null, primary key (family_id, k));
create table if not exists consent_log (id integer primary key autoincrement, player_id text not null, guardian_id text not null, scope text not null, granted integer not null, at integer not null)
`;

export interface FamilyDeps {
  sql: SqliteExecutor;
  db: EdgePlatformDb;
  nowMs: () => number;
  randomBytes: (n: number) => Uint8Array;
  sha256Hex: (s: string) => Promise<string>;
}

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const sixDigits = (b: Uint8Array) =>
  String((((b[0]! << 24) | (b[1]! << 16) | (b[2]! << 8) | b[3]!) >>> 0) % 1_000_000).padStart(6, '0');

const InviteSchema = z.object({ player_id: z.string().min(1).max(64) }).strict();
const SessionSchema = z.object({ invite: z.string().regex(/^[0-9a-f]{48}$/) }).strict();
const ServiceConsentSchema = z.object({ granted: z.literal(true) }).strict();
const ChildSchema = z
  .object({
    nickname: z.string().trim().min(1).max(16),
    birth_year: z.number().int().min(2005).max(2025),
    level: z.enum(['L1', 'L2', 'L3', 'L4', 'L5', 'L6']).default('L1')
  })
  .strict();
const ConsentSchema = z.object({ granted: z.boolean() }).strict();
const DeviceLinkSchema = z
  .object({ code: z.string().regex(/^\d{6}$/), label: z.string().trim().max(24).default('') })
  .strict();

interface Guardian {
  guardian_id: string;
  family_id: string;
  token_hash: string;
}

/** Opens a lesson report share link for anyone holding it: 30-day life, guardian can revoke, allow-listed fields only. */
export function openPublicReport(
  sql: SqliteExecutor,
  db: EdgePlatformDb,
  token: string,
  nowMs: number,
  /** Teacher preview (operator token): show the page without recording a parent open. */
  preview = false
): { status: 200; view: PublicReportView } | { status: 404 | 410; error: string } {
  const row = sql.get<{ created_at: number }>('select created_at from reports where share_token = ?', [token]);
  if (!row) return { status: 404, error: 'report_not_found' };
  if (sql.get('select share_token from report_revocations where share_token = ?', [token])) {
    return { status: 410, error: 'report_revoked' };
  }
  if (nowMs - row.created_at > REPORT_SHARE_TTL_MS) return { status: 410, error: 'report_expired' };
  const r = preview
    ? sql.get<Record<string, unknown>>('select * from reports where share_token = ?', [token])!
    : db.openSharedReport(token, nowMs)!;
  const delivery = db.getReportDeliveryByToken(token);
  const parse = (v: unknown) => {
    try {
      return typeof v === 'string' ? JSON.parse(v) : v;
    } catch {
      return v;
    }
  };
  const clips = parse(r.clips);
  return {
    status: 200,
    view: {
      kind: String(r.kind),
      ref_id: String(r.ref_id),
      facts: stripIdentifiers(parse(r.facts)),
      body: String(r.body),
      clips: Array.isArray(clips) ? clips : [],
      created_at: Number(r.created_at),
      expires_at: Number(r.created_at) + REPORT_SHARE_TTL_MS,
      teacher_comment: delivery?.teacher_comment ?? '',
      next_lesson_at: delivery?.next_lesson_at ?? ''
    }
  };
}

export function buildFamilyApp(d: FamilyDeps): Hono {
  d.sql.exec(FAMILY_SCHEMA);
  const app = new Hono();

  const hour = () => Math.floor(d.nowMs() / 3_600_000);
  const tooManyFails = (k: string) =>
    (d.sql.get<{ n: number }>('select n from family_failures where k = ? and hour = ?', [k, hour()])?.n ?? 0) >=
    FAMILY_FAILS_PER_HOUR;
  const fail = (k: string) =>
    d.sql.run('insert into family_failures (k, hour, n) values (?, ?, 1) on conflict(k, hour) do update set n = n + 1', [k, hour()]);
  const bearer = (req: Request) => {
    const h = req.headers.get('authorization') ?? '';
    return h.startsWith('Bearer ') ? h.slice(7) : '';
  };

  const guardianOf = async (req: Request): Promise<Guardian | null> => {
    const token = bearer(req);
    if (token.length < 32) return null;
    const th = await d.sha256Hex(token);
    const g = d.sql.get<{ guardian_id: string; family_id: string }>(
      'select guardian_id, family_id from guardian_sessions where token_hash = ? and expires_at > ? and revoked_at is null',
      [th, d.nowMs()]
    );
    return g ? { ...g, token_hash: th } : null;
  };
  const familyServiceFlag = (familyId: string) =>
    Boolean(d.sql.get("select v from family_flags where family_id = ? and k = 'service'", [familyId]));
  const childOf = (g: Guardian, playerId: string) =>
    d.sql.get<{ id: string; nickname: string; level: string; birth_year: number | null }>(
      'select id, nickname, level, birth_year from players where id = ? and family_id = ?',
      [playerId, g.family_id]
    );
  const logConsent = (playerId: string, guardianId: string, scope: string, granted: boolean) =>
    d.sql.run('insert into consent_log (player_id, guardian_id, scope, granted, at) values (?, ?, ?, ?, ?)', [
      playerId,
      guardianId,
      scope,
      granted ? 1 : 0,
      d.nowMs()
    ]);

  type Ctx = Context;
  const withGuardian = async (c: Ctx, needService: boolean): Promise<Guardian | Response> => {
    const g = await guardianOf(c.req.raw);
    if (!g) return c.json({ error: 'guardian_only' }, 401);
    if (needService && !familyServiceFlag(g.family_id)) return c.json({ error: 'service_consent_required' }, 403);
    return g;
  };

  /* ---------- operator: issue the family invite the teacher sends with the first report ---------- */

  app.post('/v1/admin/family-invites', async (c) => {
    const p = InviteSchema.safeParse(await c.req.json());
    if (!p.success) return c.json({ error: 'invalid', issues: p.error.issues }, 400);
    const row = d.sql.get<{ family_id: string; guardian_id: string | null }>(
      `select p.family_id, (select g.id from guardians g where g.family_id = p.family_id order by g.id limit 1) as guardian_id
       from players p where p.id = ?`,
      [p.data.player_id]
    );
    if (!row) return c.json({ error: 'player_not_found' }, 404);
    if (!row.guardian_id) return c.json({ error: 'guardian_not_found' }, 404);
    const code = hex(d.randomBytes(24));
    const now = d.nowMs();
    d.sql.run(
      'insert into guardian_invites (code_hash, guardian_id, family_id, created_at, expires_at, used_at) values (?, ?, ?, ?, ?, null)',
      [await d.sha256Hex(code), row.guardian_id, row.family_id, now, now + FAMILY_INVITE_TTL_MS]
    );
    // The code rides in the URL fragment so it never reaches server logs or Referer headers.
    return c.json({ invite_path: `/family#k=${code}`, expires_at: now + FAMILY_INVITE_TTL_MS }, 201);
  });

  /* ---------- guardian sign-in ---------- */

  app.post('/v1/family/session', async (c) => {
    if (tooManyFails('invite')) return c.json({ error: 'too_many_attempts' }, 429);
    const p = SessionSchema.safeParse(await c.req.json().catch(() => ({})));
    const now = d.nowMs();
    const inv = p.success
      ? d.sql.get<{ code_hash: string; guardian_id: string; family_id: string }>(
          'select code_hash, guardian_id, family_id from guardian_invites where code_hash = ? and expires_at > ? and used_at is null',
          [await d.sha256Hex(p.data.invite), now]
        )
      : undefined;
    if (!inv) {
      fail('invite');
      return c.json({ error: 'invalid_invite' }, 404);
    }
    d.sql.run('update guardian_invites set used_at = ? where code_hash = ?', [now, inv.code_hash]);
    const token = hex(d.randomBytes(32));
    d.sql.run(
      'insert into guardian_sessions (token_hash, guardian_id, family_id, created_at, expires_at, revoked_at) values (?, ?, ?, ?, ?, null)',
      [await d.sha256Hex(token), inv.guardian_id, inv.family_id, now, now + GUARDIAN_SESSION_TTL_MS]
    );
    return c.json({ guardian_token: token, expires_at: now + GUARDIAN_SESSION_TTL_MS });
  });

  app.post('/v1/family/logout', async (c) => {
    const g = await withGuardian(c, false);
    if (g instanceof Response) return g;
    d.sql.run('update guardian_sessions set revoked_at = ? where token_hash = ?', [d.nowMs(), g.token_hash]);
    return c.json({ ok: true });
  });

  /** Required consent (docs/16 §3 "필수: 서비스 이용"), given once for the family; applied to every child profile. */
  app.post('/v1/family/service-consent', async (c) => {
    const g = await withGuardian(c, false);
    if (g instanceof Response) return g;
    const p = ServiceConsentSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!p.success) return c.json({ error: 'invalid', issues: p.error.issues }, 400);
    const now = d.nowMs();
    d.sql.run(
      "insert into family_flags (family_id, k, v, at) values (?, 'service', 1, ?) on conflict(family_id, k) do update set v = 1, at = excluded.at",
      [g.family_id, now]
    );
    for (const k of d.sql.all<{ id: string }>('select id from players where family_id = ?', [g.family_id])) {
      d.db.setConsent({ playerId: k.id, guardianId: g.guardian_id, scope: 'service', granted: true, nowMs: now });
      logConsent(k.id, g.guardian_id, 'service', true);
    }
    return c.json({ ok: true });
  });

  app.get('/v1/family/me', async (c) => {
    const g = await withGuardian(c, false);
    if (g instanceof Response) return g;
    const now = d.nowMs();
    const kids = d.sql.all<{ id: string; nickname: string; level: string; birth_year: number | null }>(
      'select id, nickname, level, birth_year from players where family_id = ? order by nickname',
      [g.family_id]
    );
    const children = kids.map((k) => {
      const consents = d.db.listConsents(k.id);
      const devices = d.sql.all<{ id: string; label: string; created_at: number; last_seen_at: number | null }>(
        'select id, label, created_at, last_seen_at from devices where player_id = ? and revoked_at is null order by created_at',
        [k.id]
      );
      const reports = d.sql
        .all<{ share_token: string; ref_id: string; created_at: number; opened_at: number | null; kind: string }>(
          "select share_token, ref_id, created_at, opened_at, kind from reports where player_id = ? and kind = 'lesson' order by created_at desc limit 50",
          [k.id]
        )
        .map((r) => ({
          share_path: `/r/${r.share_token}`,
          lesson_day: kstDayOf(r.created_at),
          created_at: r.created_at,
          opened: r.opened_at !== null,
          expired: now - r.created_at > REPORT_SHARE_TTL_MS,
          revoked: Boolean(d.sql.get('select share_token from report_revocations where share_token = ?', [r.share_token]))
        }));
      const lessons = d.sql.get<{ n: number; last: number | null }>(
        'select count(*) as n, max(started_at) as last from lessons where player_id = ?',
        [k.id]
      );
      return {
        player_id: k.id,
        nickname: k.nickname,
        level: k.level,
        birth_year: k.birth_year,
        consents: Object.fromEntries(GUARDIAN_CONSENT_SCOPES.map((s) => [s, consents[s]])),
        devices,
        lessons: Number(lessons?.n ?? 0),
        last_lesson_at: lessons?.last ?? null,
        reports
      };
    });
    return c.json({ service_consented: familyServiceFlag(g.family_id), children });
  });

  app.post('/v1/family/children', async (c) => {
    const g = await withGuardian(c, true);
    if (g instanceof Response) return g;
    const p = ChildSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!p.success) return c.json({ error: 'invalid', issues: p.error.issues }, 400);
    // Nicknames are shown to others in worlds: same PII/profanity filter as speech bubbles (docs/16 §1).
    const f = filterSpeechBubble(p.data.nickname);
    if (f.reason === 'pii' || f.reason === 'profanity') return c.json({ error: 'nickname_rejected', reason: f.reason }, 422);
    const now = d.nowMs();
    const playerId = `kid-${hex(d.randomBytes(6))}`;
    d.db.ensureFamilyAndPlayer({
      familyId: g.family_id,
      guardianId: g.guardian_id,
      playerId,
      nickname: p.data.nickname,
      birthYear: p.data.birth_year,
      level: p.data.level,
      nowMs: now
    });
    d.db.setConsent({ playerId, guardianId: g.guardian_id, scope: 'service', granted: true, nowMs: now });
    logConsent(playerId, g.guardian_id, 'service', true);
    return c.json({ player_id: playerId }, 201);
  });

  app.put('/v1/family/children/:pid/consents/:scope', async (c) => {
    const g = await withGuardian(c, true);
    if (g instanceof Response) return g;
    const scope = c.req.param('scope') as GuardianConsentScope;
    if (!GUARDIAN_CONSENT_SCOPES.includes(scope)) return c.json({ error: 'unknown_scope' }, 400);
    const kid = childOf(g, c.req.param('pid'));
    if (!kid) return c.json({ error: 'child_not_found' }, 404);
    const p = ConsentSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!p.success) return c.json({ error: 'invalid', issues: p.error.issues }, 400);
    const res = d.db.setConsent({ playerId: kid.id, guardianId: g.guardian_id, scope, granted: p.data.granted, nowMs: d.nowMs() });
    logConsent(kid.id, g.guardian_id, scope, p.data.granted);
    return c.json(res);
  });

  app.post('/v1/family/children/:pid/device-code', async (c) => {
    const g = await withGuardian(c, true);
    if (g instanceof Response) return g;
    const kid = childOf(g, c.req.param('pid'));
    if (!kid) return c.json({ error: 'child_not_found' }, 404);
    const now = d.nowMs();
    d.sql.run('delete from device_link_codes where expires_at <= ? or (player_id = ? and used_at is null)', [now, kid.id]);
    let code = sixDigits(d.randomBytes(4));
    for (let i = 0; i < 5 && d.sql.get('select code from device_link_codes where code = ?', [code]); i++) {
      code = sixDigits(d.randomBytes(4));
    }
    d.sql.run('insert into device_link_codes (code, player_id, family_id, expires_at, used_at) values (?, ?, ?, ?, null)', [
      code,
      kid.id,
      g.family_id,
      now + DEVICE_CODE_TTL_MS
    ]);
    return c.json({ code, expires_at: now + DEVICE_CODE_TTL_MS }, 201);
  });

  app.delete('/v1/family/devices/:id', async (c) => {
    const g = await withGuardian(c, true);
    if (g instanceof Response) return g;
    const dev = d.sql.get('select id from devices where id = ? and family_id = ? and revoked_at is null', [c.req.param('id'), g.family_id]);
    if (!dev) return c.json({ error: 'device_not_found' }, 404);
    d.sql.run('update devices set revoked_at = ? where id = ?', [d.nowMs(), c.req.param('id')]);
    return c.json({ ok: true });
  });

  /** docs/16 §2-18: the guardian can kill a report link at once (e.g. forwarded by mistake). */
  app.post('/v1/family/reports/:token/revoke', async (c) => {
    const g = await withGuardian(c, false);
    if (g instanceof Response) return g;
    const token = c.req.param('token');
    const mine = d.sql.get(
      'select r.share_token from reports r join players p on p.id = r.player_id where r.share_token = ? and p.family_id = ?',
      [token, g.family_id]
    );
    if (!mine) return c.json({ error: 'report_not_found' }, 404);
    d.sql.run('insert or ignore into report_revocations (share_token, revoked_at) values (?, ?)', [token, d.nowMs()]);
    return c.json({ ok: true });
  });

  /* ---------- child device ---------- */

  app.post('/v1/device/link', async (c) => {
    if (tooManyFails('device')) return c.json({ error: 'too_many_attempts' }, 429);
    const p = DeviceLinkSchema.safeParse(await c.req.json().catch(() => ({})));
    const now = d.nowMs();
    const row = p.success
      ? d.sql.get<{ player_id: string; family_id: string }>(
          'select player_id, family_id from device_link_codes where code = ? and expires_at > ? and used_at is null',
          [p.data.code, now]
        )
      : undefined;
    if (!p.success || !row) {
      fail('device');
      return c.json({ error: 'invalid_code' }, 404);
    }
    d.sql.run('update device_link_codes set used_at = ? where code = ?', [now, p.data.code]);
    const token = hex(d.randomBytes(32));
    const id = `dev-${hex(d.randomBytes(6))}`;
    d.sql.run(
      'insert into devices (id, player_id, family_id, token_hash, label, created_at, last_seen_at, revoked_at) values (?, ?, ?, ?, ?, ?, ?, null)',
      [id, row.player_id, row.family_id, await d.sha256Hex(token), p.data.label || '아이 기기', now, now]
    );
    const kid = d.sql.get<{ nickname: string; level: string }>('select nickname, level from players where id = ?', [row.player_id]);
    return c.json({ device_token: token, nickname: kid?.nickname ?? '', level: kid?.level ?? 'L1', expires_at: now + DEVICE_TOKEN_TTL_MS });
  });

  app.get('/v1/device/me', async (c) => {
    const token = bearer(c.req.raw);
    if (token.length < 32) return c.json({ error: 'device_only' }, 401);
    const now = d.nowMs();
    const dev = d.sql.get<{ id: string; player_id: string; created_at: number }>(
      'select id, player_id, created_at from devices where token_hash = ? and revoked_at is null',
      [await d.sha256Hex(token)]
    );
    if (!dev || now - dev.created_at > DEVICE_TOKEN_TTL_MS) return c.json({ error: 'device_only' }, 401);
    d.sql.run('update devices set last_seen_at = ? where id = ?', [now, dev.id]);
    const kid = d.sql.get<{ nickname: string; level: string }>('select nickname, level from players where id = ?', [dev.player_id]);
    return c.json({ nickname: kid?.nickname ?? '', level: kid?.level ?? 'L1', voice_store: d.db.hasActiveConsent(dev.player_id, 'voice_store') });
  });

  return app;
}
