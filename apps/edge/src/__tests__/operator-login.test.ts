import { describe, expect, it } from 'vitest';
import { PlatformDO, type LcwEnv } from '../platform.js';
import type { OAuthIdentity } from '../oauth.js';
import { OPERATOR_SESSION_PREFIX, allowList, teacherRoleHandler } from '../operator-login.js';
import { fakeDurableStorage } from './fake-do.js';

const TOKEN = 'op-token-0123456789abcdef';
// Test-only addresses (example.com is reserved); the real allow list is a server secret.
const ALLOWED = 'teacher@example.com, Second@Example.com';
const op = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
const anon = { 'content-type': 'application/json' };
const bearer = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const platform = (emails: string | undefined = ALLOWED) =>
  new PlatformDO({ storage: fakeDurableStorage() }, { PLATFORM: undefined as never, LCW_OPERATOR_TOKEN: TOKEN, LCW_OPERATOR_GOOGLE_EMAILS: emails } as LcwEnv);
async function call(p: PlatformDO, method: string, path: string, body?: unknown, headers: Record<string, string> = op) {
  const res = await p.fetch(new Request(`https://x${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
  return { status: res.status, body: (await res.json()) as any };
}
const sha256Hex = async (s: string) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))), (b) => b.toString(16).padStart(2, '0')).join('');
const google = (email: string, sub = `sub-${email}`, extra: Partial<OAuthIdentity> = {}): OAuthIdentity => ({
  provider: 'google',
  sub,
  email,
  email_verified: true,
  name: '김선생',
  ...extra
});
function handler(p: PlatformDO, emails: string | undefined = ALLOWED) {
  return teacherRoleHandler({ sql: p.sql, nowMs: () => Date.now(), randomBytes: (n) => crypto.getRandomValues(new Uint8Array(n)), sha256Hex, allowedEmails: emails });
}
const ctx = (via: 'redirect' | 'credential' = 'credential') => ({ ticket: null, nowMs: Date.now(), via, returnTo: '/director' });
async function signIn(p: PlatformDO, email = 'teacher@example.com', sub?: string) {
  const r = await handler(p)(google(email, sub), ctx());
  if (!('token' in r) || !r.token) throw new Error(JSON.stringify(r));
  return r.token;
}

describe('teacher account (operator-login.ts on the shared OAuth module)', () => {
  it('an allowed, verified Google account gets an operator session that works on the console routes', async () => {
    const p = platform();
    const r = await handler(p)(google('Teacher@Example.com'), ctx());
    const token = (r as { token: string }).token;
    expect(r).toMatchObject({ redirect: `/director#op=${token}` });
    expect(token.startsWith(OPERATOR_SESSION_PREFIX)).toBe(true);
    expect(token).not.toContain(TOKEN);
    const t = bearer(token);
    expect((await call(p, 'GET', '/v1/admin/students', undefined, t)).status).toBe(200);
    expect((await call(p, 'GET', '/v1/admin/lessons/live', undefined, t)).status).toBe(200);
    expect((await call(p, 'POST', '/v1/admin/players', { family_id: 'f1', guardian_id: 'g1', player_id: 'stu-1', nickname: 'Oreo' }, t)).status).toBe(201);
    const me = await call(p, 'GET', '/v1/admin/operator-sessions', undefined, t);
    expect(me.body.me).toMatchObject({ name: '김선생' });
    expect(me.body.sessions).toHaveLength(1);
    expect(me.body.sessions[0]).toMatchObject({ live: true, label: 'Google 버튼' });
    // The redirect path puts the token in the fragment only.
    const red = await handler(p)(google('teacher@example.com'), ctx('redirect'));
    expect(red).toMatchObject({ redirect: expect.stringMatching(/^\/director#op=lcwop_[0-9a-f]{64}$/) });
    expect('token' in red ? red.token : undefined).toBeUndefined();
  });

  it('refuses accounts off the list, unverified emails, Kakao, and an empty list', async () => {
    const p = platform();
    expect(await handler(p)(google('someone@example.com'), ctx())).toEqual({ error: 'not_an_operator', status: 403 });
    expect(await handler(p)(google('teacher@example.com', 's', { email_verified: false }), ctx())).toEqual({ error: 'not_an_operator', status: 403 });
    expect(await handler(p)(google('teacher@example.com', 's', { provider: 'kakao' }), ctx())).toEqual({ error: 'not_an_operator', status: 403 });
    expect(await handler(p, '')(google('teacher@example.com'), ctx())).toEqual({ error: 'not_an_operator', status: 403 });
    expect([...allowList(ALLOWED)]).toEqual(['teacher@example.com', 'second@example.com']);
  });

  it('logout, ending all of an account’s sessions, and the ops key ending any; other accounts are not touched', async () => {
    const p = platform();
    const a1 = await signIn(p, 'teacher@example.com', 'sub-a');
    const a2 = await signIn(p, 'teacher@example.com', 'sub-a');
    const b = await signIn(p, 'second@example.com', 'sub-b');
    const listA = await call(p, 'GET', '/v1/admin/operator-sessions', undefined, bearer(a1));
    expect(listA.body.sessions).toHaveLength(2);
    const bId = (await call(p, 'GET', '/v1/admin/operator-sessions', undefined, bearer(b))).body.me.session_id;
    // An account cannot end another account's session.
    expect((await call(p, 'POST', '/v1/admin/operator-sessions/revoke', { id: bId }, bearer(a1))).status).toBe(404);
    // Logout (own session).
    const a1Id = listA.body.me.session_id;
    expect((await call(p, 'POST', '/v1/admin/operator-sessions/revoke', { id: a1Id }, bearer(a1))).body).toEqual({ revoked: 1 });
    expect((await call(p, 'GET', '/v1/admin/students', undefined, bearer(a1))).status).toBe(401);
    expect((await call(p, 'GET', '/v1/admin/students', undefined, bearer(a2))).status).toBe(200);
    // All of mine.
    expect((await call(p, 'POST', '/v1/admin/operator-sessions/revoke', { all: true }, bearer(a2))).body).toEqual({ revoked: 1 });
    expect((await call(p, 'GET', '/v1/admin/students', undefined, bearer(a2))).status).toBe(401);
    expect((await call(p, 'GET', '/v1/admin/students', undefined, bearer(b))).status).toBe(200);
    // The ops key sees and ends everything.
    expect((await call(p, 'GET', '/v1/admin/operator-sessions')).body.sessions).toHaveLength(3);
    expect((await call(p, 'POST', '/v1/admin/operator-sessions/revoke', { all: true })).body).toEqual({ revoked: 1 });
    expect((await call(p, 'GET', '/v1/admin/students', undefined, bearer(b))).status).toBe(401);
  });

  it('taking an email off the allow list ends that account’s sessions at the next request', async () => {
    const storage = fakeDurableStorage();
    const env = (emails: string) => ({ PLATFORM: undefined as never, LCW_OPERATOR_TOKEN: TOKEN, LCW_OPERATOR_GOOGLE_EMAILS: emails }) as LcwEnv;
    const p1 = new PlatformDO({ storage }, env(ALLOWED));
    const t = await signIn(p1, 'second@example.com');
    expect((await call(p1, 'GET', '/v1/admin/students', undefined, bearer(t))).status).toBe(200);
    const p2 = new PlatformDO({ storage }, env('teacher@example.com'));
    expect((await call(p2, 'GET', '/v1/admin/students', undefined, bearer(t))).status).toBe(401);
  });

  it('a client cannot forge the session header; a made-up lcwop_ token gets nothing', async () => {
    const p = platform();
    expect((await call(p, 'GET', '/v1/admin/students', undefined, { ...anon, 'x-lcw-op-session': 'ops-x' })).status).toBe(401);
    expect((await call(p, 'GET', '/v1/admin/students', undefined, bearer(`${OPERATOR_SESSION_PREFIX}${'0'.repeat(64)}`))).status).toBe(401);
    // The ops key with a forged header is still the ops key (sees every session, not "no account").
    const k = await call(p, 'GET', '/v1/admin/operator-sessions', undefined, { ...op, 'x-lcw-op-session': 'ops-x' });
    expect(k.status).toBe(200);
    expect(k.body.me).toBeNull();
  });
});
