import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlatformDO, isPublicRoute, type LcwEnv } from '../platform.js';
import { ED_DEVICES_KEPT } from '../ed-link.js';
import { fakeDurableStorage } from './fake-do.js';

/**
 * English Day → LCW sign-in hand-off (R2734③, ed-link.ts). English Day signs a 2-minute ticket for its signed-in student;
 * LCW asks English Day whether it is real, then opens only the LCW player the operator paired with that student key,
 * once per ticket, and only after the family's service consent.
 */
const TOKEN = 'op-token-0123456789abcdef';
const op = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
const anon = { 'content-type': 'application/json' };
const bearer = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const TICKET = (n: number) => `${'eyJzIjoib3JlbyJ9'.padEnd(20, 'A')}${n}.${'ab'.repeat(32)}`;

function platform() {
  return new PlatformDO({ storage: fakeDurableStorage() }, { PLATFORM: undefined as never, LCW_OPERATOR_TOKEN: TOKEN } as LcwEnv);
}
async function call(p: PlatformDO, method: string, path: string, body?: unknown, headers: Record<string, string> = op) {
  const res = await p.fetch(new Request(`https://x${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
  return { status: res.status, body: (await res.json()) as any };
}
async function consentedKid(p: PlatformDO, id = 'smoke-ed-1', family = 'fam-smoke-ed') {
  await call(p, 'POST', '/v1/admin/players', { family_id: family, guardian_id: 'g-smoke', player_id: id, nickname: 'Pico', birth_year: 2014, level: 'L2' });
  const inv = await call(p, 'POST', '/v1/admin/family-invites', { player_id: id });
  const s = await call(p, 'POST', '/v1/family/session', { invite: inv.body.invite_path.split('#k=')[1] }, anon);
  return bearer(s.body.guardian_token as string);
}

/** English Day's answer for each ticket (the real one checks the HMAC with its own secret). */
let answers: Record<string, { status: number; body: unknown }> = {};
const seen: string[] = [];
function stubEngday() {
  vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url instanceof Request ? url.url : url);
    seen.push(u);
    if (!u.endsWith('/api/sso/verify')) return new Response('{}', { status: 404 });
    const t = JSON.parse(String(init?.body ?? '{}')).ticket as string;
    const a = answers[t] ?? { status: 403, body: { ok: false, error: 'bad_ticket' } };
    return new Response(JSON.stringify(a.body), { status: a.status, headers: { 'content-type': 'application/json' } });
  });
}
const good = (n: number, extra: Record<string, unknown> = {}) => {
  answers[TICKET(n)] = { status: 200, body: { ok: true, student: 'smoke-oreo', lcw_player_id: '', jti: `j${n}`, exp: Math.floor(Date.now() / 1000) + 120, ...extra } };
  return TICKET(n);
};

afterEach(() => {
  vi.unstubAllGlobals();
  answers = {};
  seen.length = 0;
});

describe('English Day sign-in hand-off (/v1/device/ed-link)', () => {
  it('is a public route; pairing is operator only', async () => {
    expect(isPublicRoute('POST', '/v1/device/ed-link')).toBe(true);
    expect(isPublicRoute('PUT', '/v1/admin/students/x/ed-link')).toBe(false);
    const p = platform();
    await consentedKid(p);
    expect((await call(p, 'PUT', '/v1/admin/students/smoke-ed-1/ed-link', { student: 'smoke-oreo' }, anon)).status).toBe(401);
    expect((await call(p, 'PUT', '/v1/admin/students/smoke-ed-1/ed-link', { student: 'Bad Key!' })).status).toBe(422);
    expect((await call(p, 'PUT', '/v1/admin/students/nobody/ed-link', { student: 'smoke-oreo' })).status).toBe(404);
  });

  it('opens the paired, consented child once per ticket and the world signs in with the device token', async () => {
    stubEngday();
    const p = platform();
    const g = await consentedKid(p);
    expect((await call(p, 'PUT', '/v1/admin/students/smoke-ed-1/ed-link', { student: 'smoke-oreo' })).status).toBe(200);
    expect((await call(p, 'GET', '/v1/admin/ed-links')).body.links).toEqual([expect.objectContaining({ player_id: 'smoke-ed-1', student: 'smoke-oreo' })]);

    // before the family's required consent nothing opens (docs/16 §3)
    const t0 = good(1);
    const pre = await call(p, 'POST', '/v1/device/ed-link', { ticket: t0 }, anon);
    expect(pre).toMatchObject({ status: 403, body: { error: 'service_consent_required' } });
    await call(p, 'POST', '/v1/family/service-consent', { granted: true }, g);

    const t = good(2);
    const r = await call(p, 'POST', '/v1/device/ed-link', { ticket: t }, anon);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ nickname: 'Pico', level: 'L2' });
    expect(r.body.device_token).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(r.body)).not.toContain('smoke-ed-1');
    expect(seen.every((u) => u === 'https://engday.pages.dev/api/sso/verify')).toBe(true);
    const me = await call(p, 'GET', '/v1/device/me', undefined, bearer(r.body.device_token));
    expect(me).toMatchObject({ status: 200, body: { nickname: 'Pico' } });
    // the same ticket twice: refused (one use)
    expect((await call(p, 'POST', '/v1/device/ed-link', { ticket: t }, anon)).body.error).toBe('ticket_used');
    // the guardian sees it as one of the child's devices and can remove it
    const fam = await call(p, 'GET', '/v1/family/me', undefined, g);
    const kid = fam.body.children.find((c: any) => c.player_id === 'smoke-ed-1');
    expect(kid.devices.map((x: any) => x.label)).toEqual(['English Day 노트북']);
  });

  it('refuses forged, expired, unpaired and mismatched tickets', async () => {
    stubEngday();
    const p = platform();
    const g = await consentedKid(p);
    await call(p, 'POST', '/v1/family/service-consent', { granted: true }, g);
    // not paired yet
    expect((await call(p, 'POST', '/v1/device/ed-link', { ticket: good(3) }, anon)).body.error).toBe('not_linked');
    await call(p, 'PUT', '/v1/admin/students/smoke-ed-1/ed-link', { student: 'smoke-oreo' });
    // English Day says the signature is wrong
    expect((await call(p, 'POST', '/v1/device/ed-link', { ticket: TICKET(4) }, anon))).toMatchObject({ status: 403, body: { error: 'invalid_ticket' } });
    // English Day vouches but the time is past
    const old = TICKET(5);
    answers[old] = { status: 200, body: { ok: true, student: 'smoke-oreo', jti: 'j5', exp: Math.floor(Date.now() / 1000) - 1 } };
    expect((await call(p, 'POST', '/v1/device/ed-link', { ticket: old }, anon)).status).toBe(403);
    // a different student key
    expect((await call(p, 'POST', '/v1/device/ed-link', { ticket: good(6, { student: 'someone-else' }) }, anon)).body.error).toBe('not_linked');
    // English Day names another LCW child than the operator paired
    expect((await call(p, 'POST', '/v1/device/ed-link', { ticket: good(7, { lcw_player_id: 'stu-other' }) }, anon)).body.error).toBe('not_linked');
    // not a ticket at all
    expect((await call(p, 'POST', '/v1/device/ed-link', { ticket: 'x' }, anon)).status).toBe(400);
    // English Day down → 503, not a sign-in
    vi.stubGlobal('fetch', async () => new Response('down', { status: 502 }));
    expect((await call(p, 'POST', '/v1/device/ed-link', { ticket: TICKET(8) }, anon)).status).toBe(503);
  });

  it('keeps only the newest English Day sign-ins of a student', async () => {
    stubEngday();
    const p = platform();
    const g = await consentedKid(p);
    await call(p, 'POST', '/v1/family/service-consent', { granted: true }, g);
    await call(p, 'PUT', '/v1/admin/students/smoke-ed-1/ed-link', { student: 'smoke-oreo' });
    const tokens: string[] = [];
    for (let i = 0; i < ED_DEVICES_KEPT + 2; i++) tokens.push((await call(p, 'POST', '/v1/device/ed-link', { ticket: good(20 + i) }, anon)).body.device_token);
    const alive = [];
    for (const t of tokens) alive.push((await call(p, 'GET', '/v1/device/me', undefined, bearer(t))).status === 200);
    expect(alive.filter(Boolean)).toHaveLength(ED_DEVICES_KEPT);
    expect(alive[alive.length - 1]).toBe(true);
  });

  it('answers 429 after too many wrong tickets from one address', async () => {
    stubEngday();
    const p = platform();
    let last = 0;
    for (let i = 0; i < 25; i++) last = (await call(p, 'POST', '/v1/device/ed-link', { ticket: TICKET(100 + i) }, anon)).status;
    expect(last).toBe(429);
  });
});
