import { describe, expect, it } from 'vitest';
import { PlatformDO, isPublicRoute, type LcwEnv } from '../platform.js';
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
  return { status: res.status, body: (text ? JSON.parse(text) : null) as any };
}

async function linkedChild(p: PlatformDO, pid = 'kid-1') {
  await call(p, 'POST', '/v1/admin/players', { family_id: `fam-${pid}`, guardian_id: `g-${pid}`, player_id: pid, nickname: 'Juno', birth_year: 2016, level: 'L1' });
  const inv = await call(p, 'POST', '/v1/admin/family-invites', { player_id: pid });
  const s = await call(p, 'POST', '/v1/family/session', { invite: inv.body.invite_path.split('#k=')[1] }, anon);
  const g = bearer(s.body.guardian_token);
  await call(p, 'POST', '/v1/family/service-consent', { granted: true }, g);
  const code = await call(p, 'POST', `/v1/family/children/${pid}/device-code`, {}, g);
  const link = await call(p, 'POST', '/v1/device/link', { code: code.body.code, label: '태블릿' }, anon);
  expect(link.status).toBe(200);
  return bearer(link.body.device_token);
}

const choice = { name: '지우의 마을', season: 'winter', time: 'sunset', buddy: 'bunny' };

describe('my world (G07, Dan 11-16 R2555)', () => {
  it('is public only as the two token-checked routes', () => {
    expect(isPublicRoute('GET', '/v1/my-world')).toBe(true);
    expect(isPublicRoute('POST', '/v1/my-world')).toBe(true);
    expect(isPublicRoute('DELETE', '/v1/my-world')).toBe(false);
  });

  it('a linked child makes it once: the server picks the seed, every device then opens the same world', async () => {
    const p = platform();
    const dev = await linkedChild(p);
    expect((await call(p, 'GET', '/v1/my-world', undefined, dev)).body).toEqual({ made: false });
    const made = await call(p, 'POST', '/v1/my-world', { ...choice, seed: 'ffffffff' }, dev);
    expect(made.status).toBe(201);
    expect(made.body.world).toMatchObject({ name: '지우의 마을', season: 'winter', time: 'sunset', buddy: 'bunny' });
    expect(made.body.world.seed).toMatch(/^[0-9a-f]{16}$/);
    expect(made.body.world.seed).not.toBe('ffffffff');
    const again = await call(p, 'GET', '/v1/my-world', undefined, dev);
    expect(again.body).toEqual({ made: true, world: made.body.world });
    const twice = await call(p, 'POST', '/v1/my-world', { ...choice, name: '다른 이름' }, dev);
    expect(twice.status).toBe(409);
    expect(twice.body.world.name).toBe('지우의 마을');
  });

  it('refuses no token, a bad name or an unknown detail, and keeps children apart', async () => {
    const p = platform();
    expect((await call(p, 'GET', '/v1/my-world', undefined, anon)).status).toBe(401);
    expect((await call(p, 'POST', '/v1/my-world', choice, anon)).status).toBe(401);
    const a = await linkedChild(p, 'kid-a');
    const b = await linkedChild(p, 'kid-b');
    for (const bad of [{ ...choice, name: '' }, { ...choice, name: 'http://x.y' }, { ...choice, name: '가'.repeat(13) }, { ...choice, season: 'monsoon' }, { name: '마을' }]) {
      const r = await call(p, 'POST', '/v1/my-world', bad, a);
      expect(r.status).toBe(400);
      expect(r.body.error).toBe('invalid_world_setup');
    }
    expect((await call(p, 'POST', '/v1/my-world', choice, a)).status).toBe(201);
    expect((await call(p, 'GET', '/v1/my-world', undefined, b)).body).toEqual({ made: false });
  });
});
