import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { SqliteExecutor } from './storage.js';

/**
 * Sign-in with Google and Kakao for adults (docs/02 login: "카카오·구글 OAuth(보호자·성인)"). One module for every
 * role: the guardian side (guardian-oauth.ts) and the teacher side (operator-login.ts, lesson lane) plug a role
 * handler in; this module owns the provider talk, the ID token check and which account belongs to whom.
 *
 * Two ways in, same check, same role handler:
 * - Redirect (Google and Kakao): `GET /v1/oauth/:provider/start?role=…&return=…[&t=ticket]` makes a one-use state
 *   (with a PKCE verifier and a nonce), keeps it in an HttpOnly cookie scoped to /v1/oauth/:provider and sends the
 *   browser to the provider. `GET /v1/oauth/:provider/callback` checks the cookie against the state, trades the code
 *   (PKCE verifier, and the client secret where the provider wants one) for an ID token, checks it (signature by the
 *   provider's published keys, issuer, audience = our client id, expiry, nonce), then hands the identity to the role.
 *   The role answers where to go; a session token rides in the URL fragment (`#g=…`), never in a query or a log.
 * - Google Identity Services button: `POST /v1/oauth/google/credential {credential, role, return?, t?}` checks the
 *   same ID token (no nonce) and answers JSON `{redirect, token?}`.
 *
 * Tickets carry context from before the sign-in (e.g. "link this new sign-in to the guardian already signed in"):
 * a role issues one from its own authenticated route (`issueOAuthTicket`), 5 minutes, one use.
 *
 * Accounts: `oauth_identities (provider, sub, role) → subject_id` (guardian id, operator id). Only the provider's
 * stable `sub` is the key; the email is kept only when the provider gives a verified one (the teacher allow list
 * needs it). Kakao asks for `openid` only, so a Kakao guardian shares no email or profile with us.
 *
 * Settings (wrangler vars/secrets): LCW_GOOGLE_CLIENT_ID (public), LCW_GOOGLE_CLIENT_SECRET (redirect flow),
 * LCW_KAKAO_REST_KEY, LCW_KAKAO_CLIENT_SECRET (only if "Client Secret" is turned on in the Kakao app). A provider
 * without its settings is left out of `GET /v1/oauth/config`, and the pages hide its button.
 */

export type OAuthProvider = 'google' | 'kakao';
export type OAuthRole = 'guardian' | 'teacher';
export const OAUTH_PROVIDERS: readonly OAuthProvider[] = ['google', 'kakao'];
export const OAUTH_ROLES: readonly OAuthRole[] = ['guardian', 'teacher'];

export const OAUTH_STATE_TTL_MS = 10 * 60_000;
export const OAUTH_TICKET_TTL_MS = 5 * 60_000;
const SKEW_S = 60;

/** Where each role may land after sign-in; the first is the default (anything else asked for → the default). */
export const OAUTH_DEFAULT_RETURNS: Record<OAuthRole, readonly string[]> = {
  guardian: ['/family', '/signup', '/dashboard'],
  teacher: ['/director']
};

export interface OAuthIdentity {
  provider: OAuthProvider;
  sub: string;
  email: string | null;
  email_verified: boolean;
  name: string | null;
}

export interface OAuthConfig {
  google?: { clientId: string; clientSecret?: string };
  kakao?: { clientId: string; clientSecret?: string };
}

export type OAuthRoleResult = { redirect: string; token?: string } | { error: string; status?: number };
export type OAuthRoleHandler = (
  identity: OAuthIdentity,
  ctx: { ticket: Record<string, unknown> | null; nowMs: number; via: 'redirect' | 'credential'; returnTo: string }
) => Promise<OAuthRoleResult>;

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface ProviderSpec {
  authorize: string;
  token: string;
  jwks: string;
  issuers: ReadonlySet<string>;
  scope: string;
  /** Google gives no token for a web client without its secret; Kakao only when the app turned the secret on. */
  needsSecret: boolean;
}

export const PROVIDER_SPECS: Record<OAuthProvider, ProviderSpec> = {
  google: {
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    jwks: 'https://www.googleapis.com/oauth2/v3/certs',
    issuers: new Set(['accounts.google.com', 'https://accounts.google.com']),
    scope: 'openid email profile',
    needsSecret: true
  },
  kakao: {
    authorize: 'https://kauth.kakao.com/oauth/authorize',
    token: 'https://kauth.kakao.com/oauth/token',
    jwks: 'https://kauth.kakao.com/.well-known/jwks.json',
    issuers: new Set(['https://kauth.kakao.com']),
    scope: 'openid',
    needsSecret: false
  }
};

/**
 * Local real-path rig only (like REALTIME_API_BASE): every provider's authorize / token / keys at one stand-in base,
 * issuer = that base. `LCW_OAUTH_DEV_PROVIDER` — never set in production.
 */
export function devProviderSpecs(base: string): Record<OAuthProvider, ProviderSpec> {
  const b = base.replace(/\/$/, '');
  const one = (p: OAuthProvider): ProviderSpec => ({
    ...PROVIDER_SPECS[p],
    authorize: `${b}/${p}/authorize`,
    token: `${b}/${p}/token`,
    jwks: `${b}/${p}/jwks`,
    issuers: new Set([`${b}/${p}`])
  });
  return { google: one('google'), kakao: one('kakao') };
}

export function oauthConfigFrom(env: Record<string, unknown>): OAuthConfig {
  const s = (k: string) => (typeof env[k] === 'string' && (env[k] as string).trim() ? (env[k] as string).trim() : undefined);
  const out: OAuthConfig = {};
  const g = s('LCW_GOOGLE_CLIENT_ID');
  if (g) out.google = { clientId: g, clientSecret: s('LCW_GOOGLE_CLIENT_SECRET') };
  const k = s('LCW_KAKAO_REST_KEY');
  if (k) out.kakao = { clientId: k, clientSecret: s('LCW_KAKAO_CLIENT_SECRET') };
  return out;
}

/** Providers whose redirect sign-in works with these settings. */
export function redirectProviders(config: OAuthConfig): OAuthProvider[] {
  return OAUTH_PROVIDERS.filter((p) => {
    const c = config[p];
    return Boolean(c && (!PROVIDER_SPECS[p].needsSecret || c.clientSecret));
  });
}

export const OAUTH_SCHEMA = `
create table if not exists oauth_states (state_hash text primary key, provider text not null, role text not null, verifier text not null, nonce text not null, return_to text not null, ticket_hash text, created_at integer not null, expires_at integer not null, used_at integer);
create table if not exists oauth_tickets (ticket_hash text primary key, role text not null, data text not null, browser_hash text not null, created_at integer not null, expires_at integer not null, used_at integer);
create table if not exists oauth_handoffs (code_hash text primary key, browser_hash text not null, result text not null, created_at integer not null, expires_at integer not null, used_at integer);
create table if not exists oauth_seen_tokens (token_hash text primary key, expires_at integer not null);
create table if not exists oauth_identities (provider text not null, sub text not null, role text not null, subject_id text not null, email text, created_at integer not null, last_login_at integer not null, primary key (provider, sub, role));
create index if not exists oauth_identities_subject on oauth_identities (role, subject_id)
`;

/** Public routes this module serves; each checks its own state, ticket or ID token (platform.ts isPublicRoute). */
export const OAUTH_PUBLIC_ROUTES: ReadonlyArray<readonly [string, RegExp]> = [
  ['GET', /^\/v1\/oauth\/config$/],
  ['GET', /^\/v1\/oauth\/(google|kakao)\/(start|callback)$/],
  ['POST', /^\/v1\/oauth\/google\/credential$/],
  ['POST', /^\/v1\/oauth\/exchange$/]
];

/**
 * Browser-binding cookies. `__Host-` keeps a sibling subdomain from planting them (no Domain, Path=/, Secure).
 * - TICKET_COOKIE: set with a link ticket; /start only accepts the ticket from the browser that asked for it, so a
 *   ticket link sent to someone else cannot attach their Google/Kakao account to the sender's family.
 * - HANDOFF_COOKIE: set at the callback; the one-use code in `<return>#oauth=<code>` is exchanged for the result only
 *   by that same browser, so a result link sent to someone else cannot put them into the sender's account.
 */
export const OAUTH_TICKET_COOKIE = '__Host-lcw_oauth_t';
export const OAUTH_HANDOFF_COOKIE = '__Host-lcw_oauth_h';
const OAUTH_HANDOFF_TTL_MS = 5 * 60_000;
/** A forced key refetch (unknown kid) happens at most this often per provider. */
const FORCED_KEY_FETCH_GAP_MS = 60_000;
/** Google ID tokens live one hour; a credential seen once is refused until then. */
const SEEN_TOKEN_TTL_MS = 60 * 60_000;

/* ---------- small crypto helpers ---------- */

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
export const b64urlEncode = (b: Uint8Array): string =>
  btoa(String.fromCharCode(...b))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
function b64urlBytes(s: string): Uint8Array<ArrayBuffer> {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  return new Uint8Array(Array.from(b, (c) => c.charCodeAt(0)));
}
function b64urlJson(s: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(new TextDecoder().decode(b64urlBytes(s))) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
async function sha256(s: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
}
const sha256Hex = async (s: string) => hex(await sha256(s));

/* ---------- ID token check (google-id.ts from the lesson lane, for every provider) ---------- */

interface Jwk {
  kid: string;
  kty: string;
  n: string;
  e: string;
}
const keyCache = new Map<OAuthProvider, { keys: Jwk[]; until: number; forcedAt?: number }>();

/** Tests only. */
export function resetOAuthKeyCache(): void {
  keyCache.clear();
}

async function providerKeys(provider: OAuthProvider, jwksUrl: string, fetchFn: Fetch, nowMs: number, force: boolean): Promise<Jwk[]> {
  const c = keyCache.get(provider);
  if (!force && c && c.until > nowMs) return c.keys;
  // An unknown kid on an unauthenticated route must not turn every request into a provider fetch.
  if (force && c?.forcedAt !== undefined && nowMs - c.forcedAt < FORCED_KEY_FETCH_GAP_MS) return c.keys;
  let res: Response;
  try {
    res = await fetchFn(jwksUrl);
  } catch {
    return c?.keys ?? [];
  }
  if (!res.ok) return c?.keys ?? [];
  const body = (await res.json().catch(() => ({}))) as { keys?: Jwk[] };
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control') ?? '')?.[1] ?? 0);
  const keys = Array.isArray(body.keys) ? body.keys : [];
  keyCache.set(provider, { keys, until: nowMs + Math.max(300, maxAge) * 1000, forcedAt: force ? nowMs : c?.forcedAt });
  return keys;
}

/**
 * Checks an ID token (JWT RS256) from Google or Kakao: a kid from the provider's published keys (fetched again once
 * when unknown — keys rotate), the RSASSA-PKCS1-v1_5/SHA-256 signature, issuer, audience = our client id, exp in the
 * future and iat not in the future (60 s skew), the nonce when one was sent. Google: a verified email is required.
 */
export async function verifyIdToken(
  provider: OAuthProvider,
  idToken: string,
  clientId: string | undefined,
  nowMs: number,
  opts: { nonce?: string; fetch?: Fetch; spec?: ProviderSpec } = {}
): Promise<OAuthIdentity | null> {
  const fetchFn: Fetch = opts.fetch ?? ((u, i) => fetch(u, i));
  const spec = opts.spec ?? PROVIDER_SPECS[provider];
  if (!clientId || typeof idToken !== 'string' || idToken.length > 8192) return null;
  const parts = idToken.split('.');
  if (parts.length !== 3) return null;
  const [h, p, sig] = parts as [string, string, string];
  const header = b64urlJson(h);
  const claims = b64urlJson(p);
  if (!header || !claims || header.alg !== 'RS256' || typeof header.kid !== 'string') return null;
  let jwk = (await providerKeys(provider, spec.jwks, fetchFn, nowMs, false)).find((k) => k.kid === header.kid);
  if (!jwk) jwk = (await providerKeys(provider, spec.jwks, fetchFn, nowMs, true)).find((k) => k.kid === header.kid);
  if (!jwk || jwk.kty !== 'RSA') return null;
  let ok = false;
  try {
    const key = await crypto.subtle.importKey('jwk', { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlBytes(sig), new TextEncoder().encode(`${h}.${p}`));
  } catch {
    return null;
  }
  if (!ok) return null;
  const now = Math.floor(nowMs / 1000);
  if (!spec.issuers.has(String(claims.iss))) return null;
  const aud = claims.aud;
  if (!(aud === clientId || (Array.isArray(aud) && aud.includes(clientId)))) return null;
  if (typeof claims.exp !== 'number' || claims.exp + SKEW_S < now) return null;
  if (typeof claims.iat === 'number' && claims.iat - SKEW_S > now) return null;
  if (opts.nonce !== undefined && claims.nonce !== opts.nonce) return null;
  if (typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 255) return null;
  const verified = claims.email_verified === true || claims.email_verified === 'true';
  const email = typeof claims.email === 'string' && verified ? claims.email.toLowerCase() : null;
  if (provider === 'google' && !email) return null;
  return {
    provider,
    sub: claims.sub,
    email,
    email_verified: Boolean(email),
    name: typeof claims.name === 'string' ? claims.name.slice(0, 60) : typeof claims.nickname === 'string' ? claims.nickname.slice(0, 60) : null
  };
}

/* ---------- accounts ---------- */

export function subjectOf(sql: SqliteExecutor, role: OAuthRole, provider: OAuthProvider, sub: string): string | null {
  sql.exec(OAUTH_SCHEMA);
  return sql.get<{ subject_id: string }>('select subject_id from oauth_identities where provider = ? and sub = ? and role = ?', [provider, sub, role])?.subject_id ?? null;
}

/** Links this sign-in to a subject. 'taken' when it already belongs to another one (never moved silently). */
export function linkIdentity(
  sql: SqliteExecutor,
  p: { role: OAuthRole; identity: OAuthIdentity; subjectId: string },
  nowMs: number
): 'linked' | 'same' | 'taken' {
  sql.exec(OAUTH_SCHEMA);
  const cur = subjectOf(sql, p.role, p.identity.provider, p.identity.sub);
  if (cur && cur !== p.subjectId) return 'taken';
  if (cur) {
    sql.run('update oauth_identities set last_login_at = ?, email = coalesce(?, email) where provider = ? and sub = ? and role = ?', [
      nowMs,
      p.identity.email,
      p.identity.provider,
      p.identity.sub,
      p.role
    ]);
    return 'same';
  }
  sql.run('insert into oauth_identities (provider, sub, role, subject_id, email, created_at, last_login_at) values (?, ?, ?, ?, ?, ?, ?)', [
    p.identity.provider,
    p.identity.sub,
    p.role,
    p.subjectId,
    p.identity.email,
    nowMs,
    nowMs
  ]);
  return 'linked';
}

export function identitiesOf(sql: SqliteExecutor, role: OAuthRole, subjectId: string): Array<{ provider: OAuthProvider; created_at: number; last_login_at: number }> {
  sql.exec(OAUTH_SCHEMA);
  return sql.all<{ provider: OAuthProvider; created_at: number; last_login_at: number }>(
    'select provider, created_at, last_login_at from oauth_identities where role = ? and subject_id = ? order by created_at',
    [role, subjectId]
  );
}

export function unlinkIdentity(sql: SqliteExecutor, role: OAuthRole, subjectId: string, provider: OAuthProvider): boolean {
  sql.exec(OAUTH_SCHEMA);
  const had = sql.get('select 1 as x from oauth_identities where role = ? and subject_id = ? and provider = ?', [role, subjectId, provider]);
  sql.run('delete from oauth_identities where role = ? and subject_id = ? and provider = ?', [role, subjectId, provider]);
  return Boolean(had);
}

/* ---------- tickets ---------- */

/**
 * A one-use ticket carrying context into a sign-in (e.g. "link to this guardian"). It is bound to the browser that
 * asked: the route that issues it must send `setCookie` with its response, and /start refuses the ticket without it.
 */
export async function issueOAuthTicket(
  sql: SqliteExecutor,
  randomBytes: (n: number) => Uint8Array,
  p: { role: OAuthRole; data: Record<string, unknown> },
  nowMs: number
): Promise<{ ticket: string; setCookie: string }> {
  sql.exec(OAUTH_SCHEMA);
  const t = hex(randomBytes(24));
  const browser = hex(randomBytes(16));
  sql.run('insert into oauth_tickets (ticket_hash, role, data, browser_hash, created_at, expires_at, used_at) values (?, ?, ?, ?, ?, ?, null)', [
    await sha256Hex(t),
    p.role,
    JSON.stringify(p.data),
    await sha256Hex(browser),
    nowMs,
    nowMs + OAUTH_TICKET_TTL_MS
  ]);
  return { ticket: t, setCookie: `${OAUTH_TICKET_COOKIE}=${browser}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${OAUTH_TICKET_TTL_MS / 1000}` };
}

/** Ticket hash if it is live for this role (not used yet) and this browser holds its cookie, else null. */
async function liveTicket(sql: SqliteExecutor, t: string | undefined, role: OAuthRole, nowMs: number, browser: string): Promise<string | null> {
  if (!t || !/^[0-9a-f]{48}$/.test(t) || !/^[0-9a-f]{32}$/.test(browser)) return null;
  const th = await sha256Hex(t);
  const row = sql.get('select 1 as x from oauth_tickets where ticket_hash = ? and role = ? and browser_hash = ? and used_at is null and expires_at > ?', [
    th,
    role,
    await sha256Hex(browser),
    nowMs
  ]);
  return row ? th : null;
}

/** Spends a ticket; its data, or null if it was used or expired meanwhile. */
function spendTicket(sql: SqliteExecutor, th: string | null, nowMs: number): Record<string, unknown> | null {
  if (!th) return null;
  const row = sql.get<{ data: string }>('select data from oauth_tickets where ticket_hash = ? and used_at is null and expires_at > ?', [th, nowMs]);
  if (!row) return null;
  sql.run('update oauth_tickets set used_at = ? where ticket_hash = ?', [nowMs, th]);
  try {
    return JSON.parse(row.data) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/* ---------- routes ---------- */

export interface OAuthDeps {
  sql: SqliteExecutor;
  nowMs: () => number;
  randomBytes: (n: number) => Uint8Array;
  config: OAuthConfig;
  roles: Partial<Record<OAuthRole, OAuthRoleHandler>>;
  returns?: Partial<Record<OAuthRole, readonly string[]>>;
  /** Outbound calls to the providers (token, keys); tests put a stand-in provider here. */
  fetch?: Fetch;
  /** Provider endpoints; default PROVIDER_SPECS (devProviderSpecs for the local rig). */
  specs?: Record<OAuthProvider, ProviderSpec>;
  /** LCW_PUBLIC_ORIGIN: the site origin the providers know (e.g. https://lcw.worldwidesomething.com). */
  publicOrigin?: string;
}

const COOKIE = (p: OAuthProvider) => `lcw_oauth_${p}`;
const cookieOf = (req: Request, name: string) => {
  for (const part of (req.headers.get('cookie') ?? '').split(/;\s*/)) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i) === name) return part.slice(i + 1);
  }
  return '';
};

export function buildOAuthApp(d: OAuthDeps): Hono {
  d.sql.exec(OAUTH_SCHEMA);
  const app = new Hono();
  const fetchFn: Fetch = d.fetch ?? ((u, i) => fetch(u, i));
  const specs = d.specs ?? PROVIDER_SPECS;
  const isProvider = (p: string): p is OAuthProvider => (OAUTH_PROVIDERS as readonly string[]).includes(p);
  const isRole = (r: string | undefined): r is OAuthRole => Boolean(r && (OAUTH_ROLES as readonly string[]).includes(r) && d.roles[r as OAuthRole]);
  const returnFor = (role: OAuthRole, asked: string | undefined | null) => {
    const allowed = d.returns?.[role] ?? OAUTH_DEFAULT_RETURNS[role];
    return asked && allowed.includes(asked) ? asked : allowed[0]!;
  };
  const back = (c: Context, returnTo: string, error: string, provider?: OAuthProvider) => {
    if (provider) c.header('set-cookie', `${COOKIE(provider)}=; Path=/v1/oauth/${provider}; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
    c.header('cache-control', 'no-store');
    c.header('referrer-policy', 'no-referrer');
    return c.redirect(`${returnTo}#oauth_error=${error}`, 302);
  };
  // The callback registered with each provider must match exactly: the configured public origin, else the request's
  // own origin (https unless it is a loopback dev server — the platform DO can see a plain-http URL).
  const callbackUrl = (req: Request, p: OAuthProvider) => {
    const u = new URL(req.url);
    const loop = /^(127\.0\.0\.1|localhost|\[::1\])$/.test(u.hostname);
    const origin = d.publicOrigin?.replace(/\/$/, '') ?? (loop ? u.origin : `https://${u.host}`);
    return `${origin}/v1/oauth/${p}/callback`;
  };

  app.get('/v1/oauth/config', (c) => {
    c.header('cache-control', 'no-store');
    return c.json({ providers: redirectProviders(d.config), google_client_id: d.config.google?.clientId ?? null });
  });

  app.get('/v1/oauth/:provider/start', async (c) => {
    const provider = c.req.param('provider');
    const roleQ = c.req.query('role');
    if (!isProvider(provider) || !isRole(roleQ)) return c.json({ error: 'not_found' }, 404);
    const role = roleQ;
    const returnTo = returnFor(role, c.req.query('return'));
    if (!redirectProviders(d.config).includes(provider)) return back(c, returnTo, 'not_configured');
    const now = d.nowMs();
    const t = c.req.query('t');
    const th = t ? await liveTicket(d.sql, t, role, now, cookieOf(c.req.raw, OAUTH_TICKET_COOKIE)) : null;
    if (t && !th) return back(c, returnTo, 'ticket_invalid');
    const state = hex(d.randomBytes(16));
    const verifier = b64urlEncode(d.randomBytes(32));
    const nonce = hex(d.randomBytes(16));
    d.sql.run(
      'insert into oauth_states (state_hash, provider, role, verifier, nonce, return_to, ticket_hash, created_at, expires_at, used_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, null)',
      [await sha256Hex(state), provider, role, verifier, nonce, returnTo, th, now, now + OAUTH_STATE_TTL_MS]
    );
    // A state is worth nothing after it expires: keep the table to the last ten minutes of starts.
    d.sql.run('delete from oauth_states where expires_at < ?', [now]);
    d.sql.run('delete from oauth_tickets where expires_at < ?', [now]);
    d.sql.run('delete from oauth_handoffs where expires_at < ?', [now]);
    d.sql.run('delete from oauth_seen_tokens where expires_at < ?', [now]);
    const spec = specs[provider];
    const q = new URLSearchParams({
      response_type: 'code',
      client_id: d.config[provider]!.clientId,
      redirect_uri: callbackUrl(c.req.raw, provider),
      scope: spec.scope,
      state,
      nonce,
      code_challenge: b64urlEncode(await sha256(verifier)),
      code_challenge_method: 'S256'
    });
    if (provider === 'google') q.set('prompt', 'select_account');
    c.header('set-cookie', `${COOKIE(provider)}=${state}; Path=/v1/oauth/${provider}; HttpOnly; Secure; SameSite=Lax; Max-Age=${OAUTH_STATE_TTL_MS / 1000}`);
    c.header('cache-control', 'no-store');
    c.header('referrer-policy', 'no-referrer');
    return c.redirect(`${spec.authorize}?${q}`, 302);
  });

  app.get('/v1/oauth/:provider/callback', async (c) => {
    const provider = c.req.param('provider');
    if (!isProvider(provider)) return c.json({ error: 'not_found' }, 404);
    const now = d.nowMs();
    const state = c.req.query('state') ?? '';
    const cookie = cookieOf(c.req.raw, COOKIE(provider));
    const row =
      /^[0-9a-f]{32}$/.test(state) && cookie === state
        ? d.sql.get<{ state_hash: string; role: OAuthRole; verifier: string; nonce: string; return_to: string; ticket_hash: string | null; expires_at: number; used_at: number | null; provider: string }>(
            'select * from oauth_states where state_hash = ?',
            [await sha256Hex(state)]
          )
        : undefined;
    if (!row || row.provider !== provider || row.used_at !== null || row.expires_at <= now || !d.roles[row.role]) {
      return back(c, '/family', 'state_mismatch', provider);
    }
    d.sql.run('update oauth_states set used_at = ? where state_hash = ?', [now, row.state_hash]);
    const returnTo = row.return_to;
    const err = c.req.query('error');
    if (err) return back(c, returnTo, err === 'access_denied' ? 'cancelled' : 'provider_error', provider);
    const code = c.req.query('code');
    const cfg = d.config[provider];
    if (!code || !cfg) return back(c, returnTo, cfg ? 'provider_error' : 'not_configured', provider);
    const form = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: callbackUrl(c.req.raw, provider),
      client_id: cfg.clientId,
      code_verifier: row.verifier
    });
    if (cfg.clientSecret) form.set('client_secret', cfg.clientSecret);
    let idToken = '';
    try {
      const res = await fetchFn(specs[provider].token, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded;charset=utf-8' },
        body: form.toString()
      });
      const body = (await res.json().catch(() => ({}))) as { id_token?: unknown };
      if (res.ok && typeof body.id_token === 'string') idToken = body.id_token;
    } catch {
      idToken = '';
    }
    if (!idToken) return back(c, returnTo, 'provider_error', provider);
    const identity = await verifyIdToken(provider, idToken, cfg.clientId, now, { nonce: row.nonce, fetch: fetchFn, spec: specs[provider] });
    if (!identity) return back(c, returnTo, 'token_invalid', provider);
    const ticket = spendTicket(d.sql, row.ticket_hash, now);
    if (row.ticket_hash && !ticket) return back(c, returnTo, 'ticket_invalid', provider);
    const r = await d.roles[row.role]!(identity, { ticket, nowMs: now, via: 'redirect', returnTo });
    if ('error' in r) return back(c, returnTo, r.error, provider);
    // The result (a session token, "linked") never rides in the URL: the page gets a one-use code that only this
    // browser can exchange (POST /v1/oauth/exchange with the handoff cookie).
    const hashAt = r.redirect.indexOf('#');
    const path = hashAt >= 0 ? r.redirect.slice(0, hashAt) : r.redirect;
    const result = hashAt >= 0 ? r.redirect.slice(hashAt + 1) : '';
    const handoff = hex(d.randomBytes(16));
    const browser = hex(d.randomBytes(16));
    d.sql.run('insert into oauth_handoffs (code_hash, browser_hash, result, created_at, expires_at, used_at) values (?, ?, ?, ?, ?, null)', [
      await sha256Hex(handoff),
      await sha256Hex(browser),
      result,
      now,
      now + OAUTH_HANDOFF_TTL_MS
    ]);
    c.header('set-cookie', `${COOKIE(provider)}=; Path=/v1/oauth/${provider}; HttpOnly; Secure; SameSite=Lax; Max-Age=0`, { append: true });
    c.header('set-cookie', `${OAUTH_HANDOFF_COOKIE}=${browser}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${OAUTH_HANDOFF_TTL_MS / 1000}`, { append: true });
    c.header('cache-control', 'no-store');
    c.header('referrer-policy', 'no-referrer');
    return c.redirect(`${path}#oauth=${handoff}`, 302);
  });

  const CredentialSchema = z
    .object({ credential: z.string().min(20).max(8192), role: z.string(), return: z.string().max(64).optional(), t: z.string().max(64).optional() })
    .strict();
  app.post('/v1/oauth/google/credential', async (c) => {
    const p = CredentialSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!p.success || !isRole(p.data.role)) return c.json({ error: 'invalid' }, 400);
    const role = p.data.role;
    const cfg = d.config.google;
    if (!cfg) return c.json({ error: 'not_configured' }, 503);
    const now = d.nowMs();
    const th = p.data.t ? await liveTicket(d.sql, p.data.t, role, now, cookieOf(c.req.raw, OAUTH_TICKET_COOKIE)) : null;
    if (p.data.t && !th) return c.json({ error: 'ticket_invalid' }, 400);
    const identity = await verifyIdToken('google', p.data.credential, cfg.clientId, now, { fetch: fetchFn, spec: specs.google });
    if (!identity) return c.json({ error: 'token_invalid' }, 401);
    // One credential, one sign-in: a copied credential cannot mint more sessions while it is still valid.
    const seen = await sha256Hex(p.data.credential);
    if (d.sql.get('select 1 as x from oauth_seen_tokens where token_hash = ?', [seen])) return c.json({ error: 'token_invalid' }, 401);
    d.sql.run('insert into oauth_seen_tokens (token_hash, expires_at) values (?, ?)', [seen, now + SEEN_TOKEN_TTL_MS]);
    const ticket = spendTicket(d.sql, th, now);
    if (th && !ticket) return c.json({ error: 'ticket_invalid' }, 400);
    const r = await d.roles[role]!(identity, { ticket, nowMs: now, via: 'credential', returnTo: returnFor(role, p.data.return) });
    c.header('cache-control', 'no-store');
    if ('error' in r) return c.json({ error: r.error }, (r.status ?? 403) as 400 | 401 | 403 | 409);
    return c.json(r);
  });

  /** The page back from a provider trades `#oauth=<code>` for the result (`g=<token>`, `linked=<provider>`, …). */
  app.post('/v1/oauth/exchange', async (c) => {
    const p = z.object({ code: z.string().regex(/^[0-9a-f]{32}$/) }).strict().safeParse(await c.req.json().catch(() => ({})));
    c.header('cache-control', 'no-store');
    if (!p.success) return c.json({ error: 'invalid' }, 400);
    const browser = cookieOf(c.req.raw, OAUTH_HANDOFF_COOKIE);
    const now = d.nowMs();
    const row = /^[0-9a-f]{32}$/.test(browser)
      ? d.sql.get<{ code_hash: string; browser_hash: string; result: string; expires_at: number; used_at: number | null }>(
          'select * from oauth_handoffs where code_hash = ?',
          [await sha256Hex(p.data.code)]
        )
      : undefined;
    if (!row || row.used_at !== null || row.expires_at <= now || row.browser_hash !== (await sha256Hex(browser))) {
      return c.json({ error: 'handoff_invalid' }, 400);
    }
    d.sql.run('update oauth_handoffs set used_at = ? where code_hash = ?', [now, row.code_hash]);
    c.header('set-cookie', `${OAUTH_HANDOFF_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
    return c.json({ result: row.result });
  });

  return app;
}
