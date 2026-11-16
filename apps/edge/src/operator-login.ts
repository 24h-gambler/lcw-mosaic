import { Hono } from 'hono';
import { z } from 'zod';
import type { OAuthIdentity, OAuthRoleHandler } from './oauth.js';
import type { SqliteExecutor } from './storage.js';

/**
 * Teacher / operator account (docs/02 login: Google OAuth for adults; docs/18 §1 director console).
 *
 * Sign-in runs through the shared OAuth module (oauth.ts, guardian lane): Google with role=teacher, by redirect
 * (`/v1/oauth/google/start?role=teacher`) or the Google button's credential (`POST /v1/oauth/google/credential`).
 * The module verifies the Google account and calls `teacherRoleHandler` from here, which checks the verified email
 * against the allow list, keeps one `operators` row per Google account and issues an operator session token
 * (`lcwop_…`, 30 days) for that browser. The redirect lands on `/director#op=<token>` (a fragment never reaches
 * the server or a Referer); the credential path answers the token as JSON. The ops key (LCW_OPERATOR_TOKEN) stays
 * with the ops tooling and never reaches a lesson device.
 *
 * Allow list: the `LCW_OPERATOR_GOOGLE_EMAILS` secret (comma separated, case-insensitive). No email is written in
 * code or in the repository. Taking an email off the list ends that account's sessions at their next request.
 *
 * How a session acts as the operator: `exchangeOperatorSession` runs in the platform DO before the app and, for a
 * live session token, hands the request on with the ops key in its Authorization header and the session id in
 * `x-lcw-op-session` (always stripped from the client's request first). Every gated route keeps its one
 * `isOperator` check unchanged; routes that care who the teacher is read the session header (`operatorOf`).
 *
 * Sessions: listed per account, one ended by itself (logout), all of an account's sessions ended by that account,
 * and any session ended by the ops key.
 */

export const OPERATOR_SESSION_TTL_MS = 30 * 86_400_000;
export const OPERATOR_SESSION_PREFIX = 'lcwop_';
/** last_seen_at is written at most this often per session (every request would be a write). */
const SEEN_EVERY_MS = 60_000;
export const OP_SESSION_HEADER = 'x-lcw-op-session';


export const OPERATOR_LOGIN_SCHEMA = `
create table if not exists operators (id text primary key, google_sub text unique not null, email text not null, name text not null, created_at integer not null, last_login_at integer not null);
create table if not exists operator_sessions (id text primary key, token_hash text unique not null, operator_id text not null, label text not null, created_at integer not null, expires_at integer not null, last_seen_at integer, revoked_at integer);
create index if not exists operator_sessions_operator on operator_sessions (operator_id)
`;

export interface OperatorLoginDeps {
  sql: SqliteExecutor;
  nowMs: () => number;
  randomBytes: (n: number) => Uint8Array;
  sha256Hex: (s: string) => Promise<string>;
  /** LCW_OPERATOR_GOOGLE_EMAILS (raw secret value) */
  allowedEmails: string | undefined;
}

export interface OperatorIdentity {
  session_id: string;
  operator_id: string;
  name: string;
}

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const bearer = (req: Request) => {
  const h = req.headers.get('authorization') ?? '';
  return h.startsWith('Bearer ') ? h.slice(7) : '';
};

export function allowList(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? '')
      .split(/[,\s]+/)
      .map((x) => x.trim().toLowerCase())
      .filter((x) => x.includes('@'))
  );
}

export function ensureOperatorLoginSchema(sql: SqliteExecutor): void {
  sql.exec(OPERATOR_LOGIN_SCHEMA);
}

/**
 * Before the app: a live `lcwop_` session token of an account still on the allow list becomes the ops key (plus the
 * session id header); anything else passes on unchanged except that a client-sent session header is always dropped.
 */
export async function exchangeOperatorSession(
  d: Pick<OperatorLoginDeps, 'sql' | 'nowMs' | 'sha256Hex' | 'allowedEmails'>,
  request: Request,
  operatorKey: string | undefined
): Promise<Request> {
  const token = bearer(request);
  const forged = request.headers.has(OP_SESSION_HEADER);
  if (!token.startsWith(OPERATOR_SESSION_PREFIX)) {
    if (!forged) return request;
    const headers = new Headers(request.headers);
    headers.delete(OP_SESSION_HEADER);
    return new Request(request, { headers });
  }
  const headers = new Headers(request.headers);
  headers.delete(OP_SESSION_HEADER);
  const now = d.nowMs();
  const s =
    operatorKey && operatorKey.length >= 16
      ? d.sql.get<{ id: string; last_seen_at: number | null; email: string }>(
          `select s.id, s.last_seen_at, o.email from operator_sessions s join operators o on o.id = s.operator_id
           where s.token_hash = ? and s.expires_at > ? and s.revoked_at is null`,
          [await d.sha256Hex(token), now]
        )
      : undefined;
  if (s && allowList(d.allowedEmails).has(s.email)) {
    headers.set('authorization', `Bearer ${operatorKey}`);
    headers.set(OP_SESSION_HEADER, s.id);
    if (!s.last_seen_at || now - s.last_seen_at >= SEEN_EVERY_MS) {
      d.sql.run('update operator_sessions set last_seen_at = ? where id = ?', [now, s.id]);
    }
  } else {
    // A dead, unknown or no-longer-allowed session: no credentials at all, so the gate answers operator_only.
    headers.delete('authorization');
  }
  return new Request(request, { headers });
}

/** Who the teacher is on an operator request: the session's account, or null for the ops key. */
export function operatorOf(sql: SqliteExecutor, req: Request): OperatorIdentity | null {
  const id = req.headers.get(OP_SESSION_HEADER);
  if (!id) return null;
  const r = sql.get<{ operator_id: string; name: string }>(
    'select s.operator_id, o.name from operator_sessions s join operators o on o.id = s.operator_id where s.id = ?',
    [id]
  );
  return r ? { session_id: id, operator_id: r.operator_id, name: r.name } : null;
}

const RevokeSchema = z.union([z.object({ id: z.string().min(1).max(64) }).strict(), z.object({ all: z.literal(true) }).strict()]);

/** A new operator session for an allowed Google account: the `operators` row (one per Google account) and the token. */
export async function issueOperatorSession(
  d: Pick<OperatorLoginDeps, 'sql' | 'nowMs' | 'randomBytes' | 'sha256Hex'>,
  who: { sub: string; email: string; name: string | null },
  label: string
): Promise<{ token: string; session_id: string; operator_id: string; name: string; expires_at: number }> {
  const token = OPERATOR_SESSION_PREFIX + hex(d.randomBytes(32));
  const tokenHash = await d.sha256Hex(token);
  const now = d.nowMs();
  const name = (who.name || who.email.split('@')[0] || '선생님').slice(0, 60);
  d.sql.run(
    `insert into operators (id, google_sub, email, name, created_at, last_login_at) values (?, ?, ?, ?, ?, ?)
     on conflict(google_sub) do update set email = excluded.email, name = excluded.name, last_login_at = excluded.last_login_at`,
    [`op-${hex(d.randomBytes(6))}`, who.sub, who.email, name, now, now]
  );
  const op = d.sql.get<{ id: string }>('select id from operators where google_sub = ?', [who.sub])!;
  const id = `ops-${hex(d.randomBytes(6))}`;
  d.sql.run(
    'insert into operator_sessions (id, token_hash, operator_id, label, created_at, expires_at, last_seen_at, revoked_at) values (?, ?, ?, ?, ?, ?, ?, null)',
    [id, tokenHash, op.id, label.slice(0, 60) || 'device', now, now + OPERATOR_SESSION_TTL_MS, now]
  );
  return { token, session_id: id, operator_id: op.id, name, expires_at: now + OPERATOR_SESSION_TTL_MS };
}

/**
 * roles.teacher for the shared OAuth module: Google only, verified email on the allow list → an operator session.
 * `onLinked` lets the platform record the identity link (oauth.ts linkIdentity, subject = operators.id).
 */
export function teacherRoleHandler(
  d: Pick<OperatorLoginDeps, 'sql' | 'nowMs' | 'randomBytes' | 'sha256Hex' | 'allowedEmails'>,
  onLinked?: (identity: OAuthIdentity, operatorId: string) => void
): OAuthRoleHandler {
  return async (identity, ctx) => {
    if (identity.provider !== 'google' || !identity.email_verified || !identity.email) return { error: 'not_an_operator', status: 403 };
    const email = identity.email.toLowerCase();
    if (!allowList(d.allowedEmails).has(email)) return { error: 'not_an_operator', status: 403 };
    const label = typeof ctx.ticket?.label === 'string' ? ctx.ticket.label : ctx.via === 'credential' ? 'Google 버튼' : 'Google';
    const s = await issueOperatorSession(d, { sub: identity.sub, email, name: identity.name }, label);
    onLinked?.(identity, s.operator_id);
    // Fragment, never a query: it does not reach server logs or Referer headers; the console stores it and clears it.
    const to = ctx.returnTo || '/director';
    return ctx.via === 'credential' ? { redirect: `${to}#op=${s.token}`, token: s.token } : { redirect: `${to}#op=${s.token}` };
  };
}

/** Routes. `/v1/admin/*` sit behind the platform gate (ops key or a live session); `/v1/operator/*` are public. */
export function buildOperatorLoginApp(d: OperatorLoginDeps): Hono {
  ensureOperatorLoginSchema(d.sql);
  const app = new Hono();

  /** The signed-in account (null with the ops key) and its sessions; the ops key sees every session. */
  app.get('/v1/admin/operator-sessions', (c) => {
    const me = operatorOf(d.sql, c.req.raw);
    const now = d.nowMs();
    const rows = d.sql.all<{
      id: string;
      operator_id: string;
      name: string;
      label: string;
      created_at: number;
      expires_at: number;
      last_seen_at: number | null;
      revoked_at: number | null;
    }>(
      `select s.id, s.operator_id, o.name, s.label, s.created_at, s.expires_at, s.last_seen_at, s.revoked_at
       from operator_sessions s join operators o on o.id = s.operator_id
       ${me ? 'where s.operator_id = ?' : ''} order by s.created_at desc limit 50`,
      me ? [me.operator_id] : []
    );
    return c.json({
      me: me ? { session_id: me.session_id, name: me.name } : null,
      sessions: rows.map((r) => ({ ...r, live: r.revoked_at === null && r.expires_at > now }))
    });
  });

  /** {id} or {all: true}: an account ends its own sessions; the ops key may end any (all = every session). */
  app.post('/v1/admin/operator-sessions/revoke', async (c) => {
    const p = RevokeSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!p.success) return c.json({ error: 'invalid', issues: p.error.issues }, 400);
    const me = operatorOf(d.sql, c.req.raw);
    const now = d.nowMs();
    if ('all' in p.data) {
      const where = me ? 'revoked_at is null and operator_id = ?' : 'revoked_at is null';
      const args = me ? [me.operator_id] : [];
      const n = d.sql.all<{ id: string }>(`select id from operator_sessions where ${where}`, args).length;
      d.sql.run(`update operator_sessions set revoked_at = ? where ${where}`, [now, ...args]);
      return c.json({ revoked: n });
    }
    const row = d.sql.get<{ operator_id: string }>('select operator_id from operator_sessions where id = ? and revoked_at is null', [p.data.id]);
    if (!row || (me && row.operator_id !== me.operator_id)) return c.json({ error: 'session_not_found' }, 404);
    d.sql.run('update operator_sessions set revoked_at = ? where id = ?', [now, p.data.id]);
    return c.json({ revoked: 1 });
  });

  return app;
}
