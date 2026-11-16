import { Hono } from 'hono';
import type { EdgePlatformDb, SqliteExecutor } from './storage.js';
import { FAMILY_SCHEMA, familyChildSummary } from './family.js';
import { buildDashboard } from './dashboard.js';
import { PUSH_SCHEMA_SQL, sendingEnabled } from './push.js';
import { playAllowed } from './seats.js';

/**
 * Operator view of what one child's guardian receives (coordinator 11-16, first paid lesson): the /family home card
 * (`familyChildSummary`, the same function `GET /v1/family/me` uses), the dashboard payload (`buildDashboard`, the
 * same as `GET /v1/family/children/:pid/dashboard`), the lesson report deliveries and the family's push notices.
 * Read only — nothing here writes, so checking it after a real lesson never marks a report opened or sends a push.
 *
 * Operator only (platform.ts gates /v1/admin/*), never cached. Guardian ids are not in the body and the guardian's
 * sign-in state is counts only; share links are whole so the check can open the public report as a teacher preview
 * (operator token: no parent open is recorded). `tools/guardian-check.mjs` reads this route after a lesson and masks
 * the links in what it prints.
 */
export interface GuardianViewDeps {
  sql: SqliteExecutor;
  db: EdgePlatformDb;
  nowMs: () => number;
}

export function guardianView(sql: SqliteExecutor, db: EdgePlatformDb, playerId: string, nowMs: number) {
  sql.exec(FAMILY_SCHEMA);
  sql.exec(PUSH_SCHEMA_SQL);
  const kid = sql.get<{ id: string; nickname: string; level: string; birth_year: number | null; family_id: string | null }>(
    'select id, nickname, level, birth_year, family_id from players where id = ?',
    [playerId]
  );
  if (!kid) return null;
  const fam = kid.family_id ?? '';
  const count = (q: string, p: unknown[]) => Number(sql.get<{ n: number }>(q, p)?.n ?? 0);
  const home = familyChildSummary(sql, db, kid, nowMs);
  const dashboard = buildDashboard(sql, db, kid.id, nowMs);
  const deliveries = sql
    .all<{ report_id: string; kind: string; share_url: string; status: string; sent_at: number; opened_at: number | null; reminder_sent_at: number | null; next_lesson_at: string | null; teacher_comment: string | null }>(
      'select report_id, kind, share_url, status, sent_at, opened_at, reminder_sent_at, next_lesson_at, teacher_comment from report_deliveries where player_id = ? order by sent_at desc limit 20',
      [kid.id]
    )
    .map((r) => ({
      report_id: r.report_id,
      kind: r.kind,
      share_path: r.share_url,
      status: r.status,
      sent_at: r.sent_at,
      opened_at: r.opened_at,
      reminder_sent_at: r.reminder_sent_at,
      next_lesson_at: r.next_lesson_at,
      teacher_comment: Boolean(r.teacher_comment && r.teacher_comment.trim())
    }));
  const seat = playAllowed(sql, kid.id, nowMs);
  return {
    child: { player_id: kid.id, nickname: kid.nickname, level: kid.level },
    family_id: fam,
    signin: {
      invites_open: count('select count(*) as n from guardian_invites where family_id = ? and used_at is null and expires_at > ?', [fam, nowMs]),
      invites_used: count('select count(*) as n from guardian_invites where family_id = ? and used_at is not null', [fam]),
      sessions_active: count('select count(*) as n from guardian_sessions where family_id = ? and revoked_at is null and expires_at > ?', [fam, nowMs]),
      service_consented: Boolean(sql.get("select v from family_flags where family_id = ? and k = 'service'", [fam]))
    },
    seat: seat.seat ? { allowed: seat.allowed, state: seat.seat.state, ends_at: seat.seat.ends_at } : { allowed: seat.allowed, state: null, ends_at: null },
    home,
    dashboard,
    deliveries,
    push: {
      sending: sendingEnabled(sql),
      devices: count('select count(*) as n from push_subs where family_id = ? and revoked_at is null', [fam]),
      outbox: sql.all<{ kind: string; ref: string; status: string; created_at: number; sent_at: number | null; devices_ok: number; attempts: number; last_error: string | null }>(
        'select kind, ref, status, created_at, sent_at, devices_ok, attempts, last_error from push_outbox where family_id = ? order by created_at desc limit 30',
        [fam]
      )
    },
    server_now: nowMs
  };
}

export type GuardianView = NonNullable<ReturnType<typeof guardianView>>;

export function buildGuardianViewAdminApp(d: GuardianViewDeps): Hono {
  const app = new Hono();
  app.get('/v1/admin/children/:pid/guardian-view', (c) => {
    const v = guardianView(d.sql, d.db, c.req.param('pid'), d.nowMs());
    if (!v) return c.json({ error: 'player_not_found' }, 404);
    c.header('cache-control', 'private, no-store');
    return c.json(v);
  });
  return app;
}
