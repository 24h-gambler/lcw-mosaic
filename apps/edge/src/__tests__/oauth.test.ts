import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { PlatformDO, isPublicRoute, type LcwEnv } from '../platform.js';
import { PROVIDER_SPECS, b64urlEncode, resetOAuthKeyCache, verifyIdToken, type OAuthProvider } from '../oauth.js';
import { fakeDurableStorage } from './fake-do.js';

/**
 * Shared sign-in (oauth.ts) and the guardian side (guardian-oauth.ts) through the platform, against a stand-in
 * Google / Kakao: real RS256 ID tokens signed by a test key published as the provider's JWKS, a token endpoint that
 * checks the PKCE verifier against the challenge the browser carried, and the redirect / cookie dance of a browser.
 */
const TOKEN = 'op-token-0123456789abcdef';
const op = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
const anon = { 'content-type': 'application/json' };
const bearer = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const ENV = {
  LCW_GOOGLE_CLIENT_ID: 'gid-123.apps.googleusercontent.com',
  LCW_GOOGLE_CLIENT_SECRET: 'g-secret',
  LCW_KAKAO_REST_KEY: 'kakao-rest-key'
};
const platform = (env: Record<string, string> = ENV) =>
  new PlatformDO({ storage: fakeDurableStorage() }, { PLATFORM: undefined as never, LCW_OPERATOR_TOKEN: TOKEN, ...env } as LcwEnv);
async function call(p: PlatformDO, method: string, path: string, body?: unknown, headers: Record<string, string> = op) {
  const res = await p.fetch(new Request(`https://lcw.test${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' }));
  const t = await res.text();
  let b: any = null;
  try {
    b = t ? JSON.parse(t) : null;
  } catch {
    b = t;
  }
  return { status: res.status, headers: res.headers, body: b };
}

/* ---------- stand-in provider ---------- */

let key: CryptoKeyPair;
let other: CryptoKeyPair;
let jwk: { n: string; e: string };
beforeAll(async () => {
  const gen = () =>
    crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']) as Promise<CryptoKeyPair>;
  key = await gen();
  other = await gen();
  const pub = (await crypto.subtle.exportKey('jwk', key.publicKey)) as JsonWebKey;
  jwk = { n: pub.n!, e: pub.e! };
});
const enc = (o: unknown) => b64urlEncode(new TextEncoder().encode(JSON.stringify(o)));
async function idToken(claims: Record<string, unknown>, signer: CryptoKey = key.privateKey, kid = 'k1') {
  const head = enc({ alg: 'RS256', kid, typ: 'JWT' });
  const body = enc(claims);
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', signer, new TextEncoder().encode(`${head}.${body}`)));
  return `${head}.${body}.${b64urlEncode(sig)}`;
}
const now = () => Math.floor(Date.now() / 1000);
const claimsFor = (provider: OAuthProvider, sub: string, nonce: string, extra: Record<string, unknown> = {}) =>
  provider === 'google'
    ? { iss: 'https://accounts.google.com', aud: ENV.LCW_GOOGLE_CLIENT_ID, sub, email: 'Parent@Example.com', email_verified: true, name: 'P', nonce, iat: now(), exp: now() + 600, ...extra }
    : { iss: 'https://kauth.kakao.com', aud: ENV.LCW_KAKAO_REST_KEY, sub, nonce, iat: now(), exp: now() + 600, ...extra };

/** code → what the provider will put in the ID token, and the challenge the browser carried. */
const codes = new Map<string, { claims: Record<string, unknown>; challenge: string; redirect: string; signer?: CryptoKey }>();
const tokenCalls: URLSearchParams[] = [];
function provider() {
  const real = globalThis.fetch;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === PROVIDER_SPECS.google.jwks || url === PROVIDER_SPECS.kakao.jwks)
      return new Response(JSON.stringify({ keys: [{ kid: 'k1', kty: 'RSA', alg: 'RS256', use: 'sig', ...jwk }] }), { headers: { 'cache-control': 'public, max-age=3600' } });
    if (url === PROVIDER_SPECS.google.token || url === PROVIDER_SPECS.kakao.token) {
      const form = new URLSearchParams(String(init?.body));
      tokenCalls.push(form);
      const c = codes.get(form.get('code') ?? '');
      const challenge = b64urlEncode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(form.get('code_verifier') ?? ''))));
      if (!c || c.challenge !== challenge || c.redirect !== form.get('redirect_uri')) return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
      codes.delete(form.get('code')!);
      return new Response(JSON.stringify({ access_token: 'at', id_token: await idToken(c.claims, c.signer) }));
    }
    return real(input as never, init);
  });
}

/** A browser signing in: start → (provider says yes) → callback with the state cookie. */
async function signIn(
  p: PlatformDO,
  prov: OAuthProvider,
  sub: string,
  q = 'role=guardian',
  tweak: { claims?: Record<string, unknown>; signer?: CryptoKey; cookie?: string | null; error?: string; jar?: string } = {}
) {
  const start = await call(p, 'GET', `/v1/oauth/${prov}/start?${q}`, undefined, tweak.jar ? { cookie: tweak.jar } : {});
  if (start.status !== 302) return { start, cb: null as any, location: '' };
  const loc = new URL(start.headers.get('location')!, 'https://lcw.test');
  if (!loc.href.startsWith(PROVIDER_SPECS[prov].authorize)) return { start, cb: null as any, location: loc.pathname + loc.hash };
  const state = loc.searchParams.get('state')!;
  const cookie = /lcw_oauth_\w+=([0-9a-f]+)/.exec(start.headers.get('set-cookie') ?? '')?.[1];
  const code = `code-${Math.random().toString(16).slice(2)}`;
  codes.set(code, {
    claims: claimsFor(prov, sub, loc.searchParams.get('nonce')!, tweak.claims),
    challenge: loc.searchParams.get('code_challenge')!,
    redirect: loc.searchParams.get('redirect_uri')!,
    signer: tweak.signer
  });
  const qs = tweak.error ? `error=${tweak.error}&state=${state}` : `code=${code}&state=${state}`;
  const c: Record<string, string> = tweak.cookie === null ? {} : { cookie: `other=1; lcw_oauth_${prov}=${tweak.cookie ?? cookie}` };
  const cb = await call(p, 'GET', `/v1/oauth/${prov}/callback?${qs}`, undefined, c);
  const raw = cb.headers.get('location') ?? '';
  // The page trades `#oauth=<code>` for the result with the handoff cookie this browser got at the callback.
  const h = /^([^#]*)#oauth=([0-9a-f]{32})$/.exec(raw);
  if (!h) return { start, cb, raw, location: raw, authorize: loc, state, cookie };
  const handoff = handoffCookie(cb.headers);
  const x = await call(p, 'POST', '/v1/oauth/exchange', { code: h[2] }, { 'content-type': 'application/json', cookie: `__Host-lcw_oauth_h=${handoff}` });
  return { start, cb, raw, handoff, location: `${h[1]}#${x.body.result}`, authorize: loc, state, cookie };
}
const handoffCookie = (h: Headers) => /__Host-lcw_oauth_h=([0-9a-f]{32})/.exec(h.get('set-cookie') ?? '')?.[1] ?? '';
/** The browser-binding cookie a link ticket came with (`POST /v1/family/sign-in/link`). */
const jarOf = (h: Headers) => `__Host-lcw_oauth_t=${/__Host-lcw_oauth_t=([0-9a-f]{32})/.exec(h.get('set-cookie') ?? '')?.[1] ?? ''}`;
const tokenOf = (location: string) => /#g=([0-9a-f]{64})$/.exec(location)?.[1] ?? null;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  resetOAuthKeyCache();
});

describe('shared sign-in (oauth.ts): Google and Kakao, redirect with state + PKCE + nonce', () => {
  it('config lists only set-up providers; without settings the start goes back with not_configured', async () => {
    const p = platform();
    expect((await call(p, 'GET', '/v1/oauth/config', undefined, {})).body).toEqual({ providers: ['google', 'kakao'], google_client_id: ENV.LCW_GOOGLE_CLIENT_ID });
    // Google without its secret: the GIS button still works (client id), the redirect does not
    expect((await call(platform({ LCW_GOOGLE_CLIENT_ID: 'x' }), 'GET', '/v1/oauth/config', undefined, {})).body).toEqual({ providers: [], google_client_id: 'x' });
    const bare = platform({});
    expect((await call(bare, 'GET', '/v1/oauth/config', undefined, {})).body).toEqual({ providers: [], google_client_id: null });
    const s = await call(bare, 'GET', '/v1/oauth/kakao/start?role=guardian&return=/signup', undefined, {});
    expect(s.status).toBe(302);
    expect(s.headers.get('location')).toBe('/signup#oauth_error=not_configured');
    // a role nobody plugged in, or an unknown provider: 404
    expect((await call(p, 'GET', '/v1/oauth/kakao/start?role=teacher', undefined, {})).status).toBe(404);
    expect((await call(p, 'GET', '/v1/oauth/naver/start?role=guardian', undefined, {})).status).toBe(401); // not a public route at all
    for (const [m, path] of [['GET', '/v1/oauth/config'], ['GET', '/v1/oauth/kakao/start'], ['GET', '/v1/oauth/google/callback'], ['POST', '/v1/oauth/google/credential'], ['GET', '/v1/family/sign-in'], ['POST', '/v1/family/sign-in/link'], ['POST', '/v1/oauth/exchange']] as const)
      expect(isPublicRoute(m, path)).toBe(true);
    expect(isPublicRoute('POST', '/v1/oauth/kakao/credential')).toBe(false);
  });

  it('Kakao: new account → new family + guardian session in the fragment; the same account later → the same family', async () => {
    provider();
    const p = platform();
    const a = await signIn(p, 'kakao', 'kakao-111', 'role=guardian&return=/signup');
    // the browser was sent to Kakao with our client id, PKCE S256, a nonce, our callback; state in an HttpOnly cookie
    expect(a.authorize!.searchParams.get('client_id')).toBe(ENV.LCW_KAKAO_REST_KEY);
    expect(a.authorize!.searchParams.get('code_challenge_method')).toBe('S256');
    expect(a.authorize!.searchParams.get('scope')).toBe('openid');
    expect(a.authorize!.searchParams.get('redirect_uri')).toBe('https://lcw.test/v1/oauth/kakao/callback');
    expect(a.start.headers.get('set-cookie')).toMatch(/^lcw_oauth_kakao=[0-9a-f]{32}; Path=\/v1\/oauth\/kakao; HttpOnly; Secure; SameSite=Lax; Max-Age=600$/);
    expect(a.cb.status).toBe(302);
    // no token in the address bar: a one-use code only this browser can exchange
    expect(a.raw).toMatch(/^\/signup#oauth=[0-9a-f]{32}$/);
    expect(a.cb.headers.get('set-cookie')).toMatch(/__Host-lcw_oauth_h=[0-9a-f]{32}; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=300/);
    expect(a.location).toMatch(/^\/signup#g=[0-9a-f]{64}$/);
    const code = a.raw!.split('#oauth=')[1];
    // spent; and from another browser (no cookie, other cookie) it never worked
    expect((await call(p, 'POST', '/v1/oauth/exchange', { code }, { cookie: `__Host-lcw_oauth_h=${a.handoff}` })).body).toEqual({ error: 'handoff_invalid' });
    expect(a.cb.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(tokenCalls.at(-1)!.get('client_secret')).toBeNull();
    const g = bearer(tokenOf(a.location)!);
    const me = await call(p, 'GET', '/v1/family/me', undefined, g);
    expect(me.body).toEqual({ service_consented: false, children: [] });
    await call(p, 'POST', '/v1/family/service-consent', { granted: true }, g);
    expect((await call(p, 'POST', '/v1/family/children', { nickname: 'Momo', birth_year: 2017 }, g)).status).toBe(201);

    const b = await signIn(p, 'kakao', 'kakao-111');
    expect(b.location).toMatch(/^\/family#g=[0-9a-f]{64}$/);
    const me2 = await call(p, 'GET', '/v1/family/me', undefined, bearer(tokenOf(b.location)!));
    expect(me2.body.children.map((k: any) => k.nickname)).toEqual(['Momo']);
    // Kakao shared no email: none kept
    expect((p as any).sql.get("select email from oauth_identities where provider = 'kakao'").email).toBeNull();
    // a return outside the role's list falls back to /family
    expect((await signIn(p, 'kakao', 'kakao-111', 'role=guardian&return=https%3A%2F%2Fevil.example')).location).toMatch(/^\/family#g=/);
  });

  it('Google: client secret and verifier go to the token endpoint; the email is kept lower-case', async () => {
    provider();
    const p = platform();
    const a = await signIn(p, 'google', 'g-sub-1');
    expect(a.location).toMatch(/^\/family#g=/);
    const form = tokenCalls.at(-1)!;
    expect(form.get('client_secret')).toBe('g-secret');
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(a.authorize!.searchParams.get('prompt')).toBe('select_account');
    expect((p as any).sql.get("select email from oauth_identities where provider = 'google'").email).toBe('parent@example.com');
  });

  it('refuses: no cookie, another cookie, a reused or expired state, cancel, bad signature, wrong audience / issuer / nonce, unverified Google email', async () => {
    provider();
    const p = platform();
    expect((await signIn(p, 'kakao', 's', 'role=guardian', { cookie: null })).location).toBe('/family#oauth_error=state_mismatch');
    expect((await signIn(p, 'kakao', 's', 'role=guardian', { cookie: 'ab'.repeat(16) })).location).toBe('/family#oauth_error=state_mismatch');
    const ok = await signIn(p, 'kakao', 's');
    const again = await call(p, 'GET', `/v1/oauth/kakao/callback?code=x&state=${ok.state}`, undefined, { cookie: `lcw_oauth_kakao=${ok.cookie}` });
    expect(again.headers.get('location')).toBe('/family#oauth_error=state_mismatch');
    expect((await signIn(p, 'kakao', 's', 'role=guardian&return=/signup', { error: 'access_denied' })).location).toBe('/signup#oauth_error=cancelled');
    expect((await signIn(p, 'kakao', 's', 'role=guardian', { signer: other.privateKey })).location).toBe('/family#oauth_error=token_invalid');
    expect((await signIn(p, 'kakao', 's', 'role=guardian', { claims: { aud: 'someone-else' } })).location).toBe('/family#oauth_error=token_invalid');
    expect((await signIn(p, 'kakao', 's', 'role=guardian', { claims: { iss: 'https://accounts.google.com' } })).location).toBe('/family#oauth_error=token_invalid');
    expect((await signIn(p, 'kakao', 's', 'role=guardian', { claims: { nonce: 'replayed' } })).location).toBe('/family#oauth_error=token_invalid');
    expect((await signIn(p, 'kakao', 's', 'role=guardian', { claims: { exp: now() - 3600 } })).location).toBe('/family#oauth_error=token_invalid');
    expect((await signIn(p, 'google', 'g', 'role=guardian', { claims: { email_verified: false } })).location).toBe('/family#oauth_error=token_invalid');

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-16T03:00:00Z'));
    const start = await call(p, 'GET', '/v1/oauth/kakao/start?role=guardian', undefined, {});
    const state = new URL(start.headers.get('location')!).searchParams.get('state');
    vi.setSystemTime(new Date('2026-11-16T03:11:00Z'));
    const late = await call(p, 'GET', `/v1/oauth/kakao/callback?code=x&state=${state}`, undefined, { cookie: `lcw_oauth_kakao=${state}` });
    expect(late.headers.get('location')).toBe('/family#oauth_error=state_mismatch');
  });

  it('linking: the invited guardian adds Google, then Google alone opens that family; one account never joins two families', async () => {
    provider();
    const p = platform();
    await call(p, 'POST', '/v1/admin/players', { family_id: 'fam-oreo', guardian_id: 'g-oreo', player_id: 'stu-1', nickname: 'Oreo', birth_year: 2016, level: 'L1' });
    const inv = await call(p, 'POST', '/v1/admin/family-invites', { player_id: 'stu-1' });
    const s = await call(p, 'POST', '/v1/family/session', { invite: inv.body.invite_path.split('#k=')[1] }, anon);
    const g = bearer(s.body.guardian_token);
    expect((await call(p, 'GET', '/v1/family/sign-in', undefined, g)).body).toEqual({ available: ['google', 'kakao'], linked: [] });
    expect((await call(p, 'GET', '/v1/family/sign-in', undefined, anon)).status).toBe(401);

    const link = await call(p, 'POST', '/v1/family/sign-in/link', { provider: 'google' }, g);
    expect(link.body.start_path).toMatch(/^\/v1\/oauth\/google\/start\?role=guardian&return=%2Ffamily&t=[0-9a-f]{48}$/);
    const q = link.body.start_path.split('?')[1];
    const jar = jarOf(link.headers);
    // the ticket link sent to someone else (no ticket cookie, or theirs) links nothing
    expect((await signIn(p, 'google', 'g-victim', q)).location).toBe('/family#oauth_error=ticket_invalid');
    expect((await signIn(p, 'google', 'g-victim', q, { jar: `__Host-lcw_oauth_t=${'cd'.repeat(16)}` })).location).toBe('/family#oauth_error=ticket_invalid');
    const l = await signIn(p, 'google', 'g-parent', q, { jar });
    expect(l.location).toBe('/family#linked=google');
    // the ticket is spent
    expect((await signIn(p, 'google', 'g-parent', q, { jar })).location).toBe('/family#oauth_error=ticket_invalid');
    expect((await call(p, 'GET', '/v1/family/sign-in', undefined, g)).body.linked.map((x: any) => x.provider)).toEqual(['google']);

    const back = await signIn(p, 'google', 'g-parent');
    const me = await call(p, 'GET', '/v1/family/me', undefined, bearer(tokenOf(back.location)!));
    expect(me.body.children.map((k: any) => k.player_id)).toEqual(['stu-1']);
    // the operator's view counts the new session
    expect((await call(p, 'GET', '/v1/admin/children/stu-1/guardian-view')).body.signin.sessions_active).toBe(2);

    // another family's guardian cannot take this Google account over
    const k = await signIn(p, 'kakao', 'kakao-other');
    const g2 = bearer(tokenOf(k.location)!);
    const l2 = await call(p, 'POST', '/v1/family/sign-in/link', { provider: 'google' }, g2);
    expect((await signIn(p, 'google', 'g-parent', l2.body.start_path.split('?')[1], { jar: jarOf(l2.headers) })).location).toBe('/family#oauth_error=already_linked');

    // the last sign-in stays; with two, one can go
    expect((await call(p, 'DELETE', '/v1/family/sign-in/google', undefined, g)).status).toBe(409);
    const lk = await call(p, 'POST', '/v1/family/sign-in/link', { provider: 'kakao' }, g);
    expect((await signIn(p, 'kakao', 'kakao-oreo', lk.body.start_path.split('?')[1], { jar: jarOf(lk.headers) })).location).toBe('/family#linked=kakao');
    expect((await call(p, 'DELETE', '/v1/family/sign-in/google', undefined, g)).body).toEqual({ ok: true });
    expect((await call(p, 'GET', '/v1/family/sign-in', undefined, g)).body.linked.map((x: any) => x.provider)).toEqual(['kakao']);
    // the unlinked Google account signs in again: a new family of its own, no clash with an old record
    const again = await signIn(p, 'google', 'g-parent');
    expect(again.location).toMatch(/^\/family#g=[0-9a-f]{64}$/);
    expect((await call(p, 'GET', '/v1/family/me', undefined, bearer(tokenOf(again.location)!))).body.children).toEqual([]);
    // a sign-in whose guardian is gone gets a fresh family once, then keeps it
    (p as any).sql.run("delete from guardians where id = (select subject_id from oauth_identities where provider = 'google' and sub = 'g-parent')");
    const fresh = await signIn(p, 'google', 'g-parent');
    const famOf = async (loc: string) => (await call(p, 'GET', '/v1/family/sign-in', undefined, bearer(tokenOf(loc)!))).status;
    expect(await famOf(fresh.location)).toBe(200);
    const n = (p as any).sql.get('select count(*) as n from families').n;
    await signIn(p, 'google', 'g-parent');
    expect((p as any).sql.get('select count(*) as n from families').n).toBe(n);
  });

  it('Google button (GIS credential): same check, JSON answer; unknown role or bad token refused', async () => {
    provider();
    const p = platform();
    const cred = await idToken(claimsFor('google', 'g-cred', 'n', { nonce: undefined }));
    const r = await call(p, 'POST', '/v1/oauth/google/credential', { credential: cred, role: 'guardian', return: '/signup' }, anon);
    expect(r.status).toBe(200);
    expect(r.body.redirect).toBe(`/signup#g=${r.body.token}`);
    expect((await call(p, 'GET', '/v1/family/me', undefined, bearer(r.body.token))).status).toBe(200);
    // the same credential a second time (copied): refused
    expect((await call(p, 'POST', '/v1/oauth/google/credential', { credential: cred, role: 'guardian' }, anon)).status).toBe(401);
    const cred2 = await idToken(claimsFor('google', 'g-cred', 'n2', { nonce: undefined }));
    expect((await call(p, 'POST', '/v1/oauth/google/credential', { credential: cred2, role: 'teacher' }, anon)).status).toBe(400);
    const bad = await idToken(claimsFor('google', 'g-cred', 'n'), other.privateKey);
    expect((await call(p, 'POST', '/v1/oauth/google/credential', { credential: bad, role: 'guardian' }, anon)).status).toBe(401);
    expect((await call(platform({}), 'POST', '/v1/oauth/google/credential', { credential: cred, role: 'guardian' }, anon)).status).toBe(503);
  });

  it('verifyIdToken refetches the keys once for an unknown kid (rotation), and caches them otherwise', async () => {
    let jwksCalls = 0;
    const f = async (u: string) => {
      jwksCalls++;
      return new Response(JSON.stringify({ keys: [{ kid: jwksCalls === 1 ? 'old' : 'k1', kty: 'RSA', ...jwk }] }), { headers: { 'cache-control': 'max-age=600' } });
    };
    const t = await idToken(claimsFor('kakao', 'x', 'n1'));
    expect((await verifyIdToken('kakao', t, ENV.LCW_KAKAO_REST_KEY, Date.now(), { nonce: 'n1', fetch: f }))?.sub).toBe('x');
    expect(jwksCalls).toBe(2);
    expect((await verifyIdToken('kakao', t, ENV.LCW_KAKAO_REST_KEY, Date.now(), { fetch: f }))?.sub).toBe('x');
    expect(jwksCalls).toBe(2);
    expect(await verifyIdToken('kakao', t, undefined, Date.now(), { fetch: f })).toBeNull();
    expect(await verifyIdToken('kakao', 'a.b', ENV.LCW_KAKAO_REST_KEY, Date.now(), { fetch: f })).toBeNull();
  });
});
