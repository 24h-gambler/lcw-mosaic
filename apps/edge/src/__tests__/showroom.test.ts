import { describe, expect, it } from 'vitest';
import { PlatformDO, isPublicRoute, type LcwEnv } from '../platform.js';
import { SHOWROOM_PUBLISHES_PER_HOUR } from '../showroom.js';
import { SAMPLE_SNAPSHOTS, parseShowroomSnapshot } from '../../../web/src/site/showroom.js';
import { fakeDurableStorage } from './fake-do.js';

const TOKEN = 'op-token-0123456789abcdef';
const op = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
const anon = { 'content-type': 'application/json' };
const bearer = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

function platform() {
  return new PlatformDO({ storage: fakeDurableStorage() }, { PLATFORM: undefined as never, LCW_OPERATOR_TOKEN: TOKEN } as LcwEnv);
}
async function call(p: PlatformDO, method: string, path: string, body?: unknown, headers: Record<string, string> = op) {
  const res = await p.fetch(new Request(`https://x${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as any, headers: res.headers };
}

/** Guardian invite → session → service consent → child → device link; returns the device and guardian headers. */
async function linkedChild(p: PlatformDO) {
  await call(p, 'POST', '/v1/admin/players', { family_id: 'fam-kim', guardian_id: 'g-kim', player_id: 'kid-1', nickname: 'Juno', birth_year: 2016, level: 'L1' });
  const inv = await call(p, 'POST', '/v1/admin/family-invites', { player_id: 'kid-1' });
  const s = await call(p, 'POST', '/v1/family/session', { invite: inv.body.invite_path.split('#k=')[1] }, anon);
  const g = bearer(s.body.guardian_token);
  await call(p, 'POST', '/v1/family/service-consent', { granted: true }, g);
  const code = await call(p, 'POST', '/v1/family/children/kid-1/device-code', {}, g);
  const link = await call(p, 'POST', '/v1/device/link', { code: code.body.code, label: '태블릿' }, anon);
  expect(link.status).toBe(200);
  return { dev: bearer(link.body.device_token), g };
}

const snapshot = () => JSON.parse(JSON.stringify(SAMPLE_SNAPSHOTS.demo)) as Record<string, unknown>;
const publishable = () => {
  const s = snapshot();
  delete s.sample;
  return s;
};

describe('showroom links (WP-703)', () => {
  it('needs the showroom consent, then serves only the allow-listed snapshot the site can draw', async () => {
    const p = platform();
    const { dev, g } = await linkedChild(p);
    expect((await call(p, 'POST', '/v1/showroom', { snapshot: publishable() }, dev)).body.error).toBe('consent_required');
    await call(p, 'PUT', '/v1/family/children/kid-1/consents/showroom_public', { granted: true }, g);
    const pub = await call(p, 'POST', '/v1/showroom', { snapshot: publishable() }, dev);
    expect(pub.status).toBe(201);
    expect(pub.body.path).toBe(`/s/${pub.body.token}`);
    const got = await call(p, 'GET', `/v1/showroom/${pub.body.token}`, undefined, anon);
    expect(got.status).toBe(200);
    expect(got.headers.get('x-robots-tag')).toContain('noindex');
    expect(Object.keys(got.body).sort()).toEqual(['avatar', 'blocks', 'title', 'v']);
    expect(JSON.stringify(got.body)).not.toMatch(/kid-1|Juno|fam-kim/);
    expect(parseShowroomSnapshot(got.body)).not.toBeNull();
  });

  it('keeps one link per child, and withdrawing consent hides it at once', async () => {
    const p = platform();
    const { dev, g } = await linkedChild(p);
    await call(p, 'PUT', '/v1/family/children/kid-1/consents/showroom_public', { granted: true }, g);
    const a = await call(p, 'POST', '/v1/showroom', { snapshot: publishable() }, dev);
    const b = await call(p, 'POST', '/v1/showroom', { snapshot: { ...publishable(), title: '새 마을' } }, dev);
    expect(b.status).toBe(200);
    expect(b.body.token).toBe(a.body.token);
    expect((await call(p, 'GET', `/v1/showroom/${a.body.token}`, undefined, anon)).body.title).toBe('새 마을');
    await call(p, 'PUT', '/v1/family/children/kid-1/consents/showroom_public', { granted: false }, g);
    expect((await call(p, 'GET', `/v1/showroom/${a.body.token}`, undefined, anon)).status).toBe(404);
    expect(p.sql.all('select token from showrooms')).toHaveLength(0);
  });

  it('rejects extra fields, live data, bad colors and personal data in the title', async () => {
    const p = platform();
    const { dev, g } = await linkedChild(p);
    await call(p, 'PUT', '/v1/family/children/kid-1/consents/showroom_public', { granted: true }, g);
    const post = (snap: unknown) => call(p, 'POST', '/v1/showroom', { snapshot: snap }, dev);
    expect((await post({ ...publishable(), position: { x: 1, y: 2, z: 3 } })).status).toBe(400);
    expect((await post({ ...publishable(), voice: 'clip.ogg' })).status).toBe(400);
    expect((await post({ ...publishable(), avatar: { shirt: 'brand', pants: 'sky-d', hair: 'ink-700', realName: '김준호' } })).status).toBe(400);
    expect((await post({ ...publishable(), blocks: [[0, 0, 0, '#ff0000']] })).status).toBe(400);
    expect((await post({ ...publishable(), title: '010-1234-5678 우리집' })).status).toBe(422);
  });

  it('only the device or the operator publishes, and publishing is capped per hour', async () => {
    const p = platform();
    const { dev, g } = await linkedChild(p);
    await call(p, 'PUT', '/v1/family/children/kid-1/consents/showroom_public', { granted: true }, g);
    expect((await call(p, 'POST', '/v1/showroom', { snapshot: publishable() }, anon)).status).toBe(401);
    expect((await call(p, 'POST', '/v1/showroom', { snapshot: publishable(), player_id: 'kid-2' }, dev)).status).toBe(403);
    expect((await call(p, 'POST', '/v1/showroom', { snapshot: publishable(), player_id: 'kid-1' }, op)).status).toBe(201);
    for (let i = 1; i < SHOWROOM_PUBLISHES_PER_HOUR; i++) await call(p, 'POST', '/v1/showroom', { snapshot: publishable() }, dev);
    expect((await call(p, 'POST', '/v1/showroom', { snapshot: publishable() }, dev)).status).toBe(429);
    expect((await call(p, 'DELETE', '/v1/showroom', undefined, dev)).status).toBe(200);
    expect(p.sql.all('select token from showrooms')).toHaveLength(0);
  });

  it('serves nothing for guessed or malformed tokens and opens only its own routes', async () => {
    const p = platform();
    expect((await call(p, 'GET', '/v1/showroom/demo', undefined, anon)).status).toBe(404);
    expect((await call(p, 'GET', `/v1/showroom/${'0'.repeat(32)}`, undefined, anon)).status).toBe(404);
    expect(isPublicRoute('GET', '/v1/showroom/abc')).toBe(true);
    expect(isPublicRoute('GET', '/v1/admin/showrooms')).toBe(false);
    expect((await call(p, 'GET', '/v1/admin/showrooms', undefined, anon)).status).toBe(401);
  });
});
