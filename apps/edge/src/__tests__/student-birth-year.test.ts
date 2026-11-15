import { describe, expect, it } from 'vitest';
import { PlatformDO, type LcwEnv } from '../platform.js';
import { fakeDurableStorage } from './fake-do.js';

const TOKEN = 'op-token-0123456789abcdef';
const op = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
const anon = { 'content-type': 'application/json' };
const platform = () => new PlatformDO({ storage: fakeDurableStorage() }, { PLATFORM: undefined as never, LCW_OPERATOR_TOKEN: TOKEN } as LcwEnv);
async function call(p: PlatformDO, method: string, path: string, body?: unknown, headers: Record<string, string> = op) {
  const res = await p.fetch(new Request(`https://x${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
  return { status: res.status, body: (await res.json()) as any };
}

describe('student birth year (11-16: Oreo stored as 2016 though none was sent)', () => {
  it('a student registered without a birth year is stored as unknown (null); the teacher can fix one later', async () => {
    const p = platform();
    await call(p, 'POST', '/v1/admin/players', { family_id: 'f1', guardian_id: 'g1', player_id: 'stu-oreo', nickname: 'Oreo', level: 'L1' });
    const row = (await call(p, 'GET', '/v1/admin/students')).body.find((s: any) => s.player_id === 'stu-oreo');
    expect(row).toMatchObject({ nickname: 'Oreo', level: 'L1', birth_year: null });
    // An old row with a made-up year is put back to unknown; other fields stay.
    expect((await call(p, 'PATCH', '/v1/admin/players/stu-oreo', { birth_year: 2016 })).body).toMatchObject({ birth_year: 2016 });
    expect((await call(p, 'PATCH', '/v1/admin/players/stu-oreo', { birth_year: null })).body).toEqual({
      id: 'stu-oreo',
      nickname: 'Oreo',
      level: 'L1',
      birth_year: null
    });
    expect((await call(p, 'PATCH', '/v1/admin/players/stu-oreo', {})).status).toBe(400);
    expect((await call(p, 'PATCH', '/v1/admin/players/stu-oreo', { family_id: 'x' })).status).toBe(400);
    expect((await call(p, 'PATCH', '/v1/admin/players/nobody', { level: 'L2' })).status).toBe(404);
    expect((await call(p, 'PATCH', '/v1/admin/players/stu-oreo', { level: 'L2' }, anon)).status).toBe(401);
  });
});
