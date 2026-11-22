/**
 * R326 (Dan 11-19 "무료 3분 뒤엔 유료 결제로"): a signed-up child without a seat plays FREE_PLAY_LIMITS.worldTrialMinutes
 * of server-counted world time. The device beats POST /v1/device/heartbeat while the world is open; every solo write is
 * a beat too. Seats, tutoring students and smoke players never run on the clock; the child device never gets minutes.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FREE_PLAY_LIMITS } from '@lcw/schemas';
import { PlatformDO, type LcwEnv } from '../platform.js';
import { fakeDurableStorage } from './fake-do.js';

const TOKEN = 'op-token-0123456789abcdef';
const op = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
const anon = { 'content-type': 'application/json' };
const bearer = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const platform = () => new PlatformDO({ storage: fakeDurableStorage() }, { PLATFORM: undefined as never, LCW_OPERATOR_TOKEN: TOKEN } as LcwEnv);
async function call(p: PlatformDO, method: string, path: string, body?: unknown, headers: Record<string, string> = op) {
  const res = await p.fetch(new Request(`https://x${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
  const text = await res.text();
  let b: any = text;
  try {
    b = JSON.parse(text);
  } catch {
    /* plain text */
  }
  return { status: res.status, body: b };
}
async function kid(p: PlatformDO, playerId: string, fam: string) {
  await call(p, 'POST', '/v1/admin/players', { family_id: fam, guardian_id: `g-${fam}`, player_id: playerId, nickname: 'Juno', birth_year: 2016, level: 'L2' });
  const inv = await call(p, 'POST', '/v1/admin/family-invites', { player_id: playerId });
  const s = await call(p, 'POST', '/v1/family/session', { invite: inv.body.invite_path.split('#k=')[1] }, anon);
  const g = bearer(s.body.guardian_token);
  await call(p, 'POST', '/v1/family/service-consent', { granted: true }, g);
  const code = await call(p, 'POST', `/v1/family/children/${playerId}/device-code`, {}, g);
  const link = await call(p, 'POST', '/v1/device/link', { code: code.body.code }, anon);
  return bearer(link.body.device_token);
}
const sqlOf = (p: PlatformDO) => (p as any).sql;
const used = (p: PlatformDO, id: string) => Number(sqlOf(p).get('select used_ms from free_trial where player_id = ?', [id])?.used_ms ?? -1);
const T0 = Date.UTC(2026, 10, 19, 12, 0, 0);
const at = (ms: number) => vi.setSystemTime(T0 + ms);
const S = 1000;

afterEach(() => vi.useRealTimers());

describe('R326 free trial: 3 minutes of server-counted world time, then the pay screen', () => {
  it('beats add the time between them; after the trial length play stops and writes answer 403 trial_ended', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    at(0);
    const p = platform();
    const dev = await kid(p, 'kid-t', 'fam-t');
    const me = await call(p, 'GET', '/v1/device/me', undefined, dev);
    expect(me.body).toMatchObject({ play_allowed: true, trial: 'running', seat: null });
    // no minutes, end time or price on the child device (AGENTS 4.9)
    expect(JSON.stringify(me.body)).not.toMatch(/ends_at|minutes|left|krw|price/i);
    expect(used(p, 'kid-t')).toBe(-1); // opening the world is a read: nothing written yet

    const beat = async (ms: number) => {
      at(ms);
      return (await call(p, 'POST', '/v1/device/heartbeat', undefined, dev)).body;
    };
    expect(await beat(0)).toEqual({ play_allowed: true, trial: 'running' });
    expect(used(p, 'kid-t')).toBe(0);
    await beat(60 * S);
    await beat(120 * S);
    expect(used(p, 'kid-t')).toBe(120 * S);
    // a solo write between beats is a beat too (no extra round trip)
    at(150 * S);
    expect((await call(p, 'POST', '/v1/items/use', { item_key: 'water' }, dev)).status).toBe(200);
    expect(used(p, 'kid-t')).toBe(150 * S);
    expect(await beat(180 * S)).toEqual({ play_allowed: false, trial: 'ended' });
    expect(used(p, 'kid-t')).toBe(FREE_PLAY_LIMITS.worldTrialMinutes * 60 * S);

    at(200 * S);
    const w = await call(p, 'POST', '/v1/items/use', { item_key: 'water' }, dev);
    expect(w).toEqual({ status: 403, body: { error: 'trial_ended', trial: 'ended' } });
    const me2 = await call(p, 'GET', '/v1/device/me', undefined, dev);
    expect(me2.body).toMatchObject({ play_allowed: false, trial: 'ended', seat: null });
    // the clock never runs past the trial (an ended beat writes nothing more)
    expect(await beat(400 * S)).toEqual({ play_allowed: false, trial: 'ended' });
    expect(used(p, 'kid-t')).toBe(180 * S);
  });

  it('one beat adds at most 75 s, and a break over 90 s starts a new stretch that adds the stretch floor', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    at(0);
    const p = platform();
    const dev = await kid(p, 'kid-g', 'fam-g');
    const beat = (ms: number) => {
      at(ms);
      return call(p, 'POST', '/v1/device/heartbeat', undefined, dev);
    };
    await beat(0);
    await beat(85 * S); // 85 s late: capped at 75
    expect(used(p, 'kid-g')).toBe(75 * S);
    await beat(85 * S + 10 * 60 * S); // the phone slept 10 minutes: new stretch, only the floor added
    expect(used(p, 'kid-g')).toBe(75 * S + FREE_PLAY_LIMITS.worldTrialStretchMinMs);
    await beat(85 * S + 10 * 60 * S + 60 * S);
    expect(used(p, 'kid-g')).toBe(135 * S + FREE_PLAY_LIMITS.worldTrialStretchMinMs);
    // a clock that went backwards adds nothing
    await beat(30 * S);
    expect(used(p, 'kid-g')).toBe(135 * S + FREE_PLAY_LIMITS.worldTrialStretchMinMs);
  });

  it('writes spaced past the break with the heartbeat blocked still run the clock down to trial_ended', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    at(0);
    const p = platform();
    const dev = await kid(p, 'kid-w', 'fam-w');
    const writes: number[] = [];
    for (let i = 0; i < 20; i++) {
      at(i * 100 * S); // every 100 s, past the 90 s break, and no heartbeat at all
      writes.push((await call(p, 'POST', '/v1/items/use', { item_key: 'water' }, dev)).status);
      if (writes.at(-1) === 403) break;
    }
    // the first write starts the clock at 0, then each one adds the stretch floor until the trial is spent
    const n = (FREE_PLAY_LIMITS.worldTrialMinutes * 60_000) / FREE_PLAY_LIMITS.worldTrialStretchMinMs;
    expect(writes).toEqual([...Array.from({ length: n }, () => 200), 403]);
    expect((await call(p, 'GET', '/v1/device/me', undefined, dev)).body).toMatchObject({ play_allowed: false, trial: 'ended' });
  });

  it('a child with a seat, a tutoring student and a smoke player never run on the clock (heartbeat writes nothing)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    at(0);
    const p = platform();
    const seated = await kid(p, 'kid-s', 'fam-s');
    await call(p, 'POST', '/v1/admin/seats', { payer_guardian_id: 'g-fam-s', plan: 'solo', term: 'month', player_ids: ['kid-s'] });
    const tutor = await kid(p, 'kid-u', 'fam-u');
    sqlOf(p).run('update players set tutor_student = 1 where id = ?', ['kid-u']);
    const smoke = await kid(p, 'smoke-kid', 'fam-x');
    for (const [dev, id] of [
      [seated, 'kid-s'],
      [tutor, 'kid-u'],
      [smoke, 'smoke-kid']
    ] as const) {
      for (let i = 0; i < 6; i++) {
        at(i * 60 * S);
        const hb = await call(p, 'POST', '/v1/device/heartbeat', undefined, dev);
        expect(hb.body, id).toEqual({ play_allowed: true, trial: null });
        expect((await call(p, 'POST', '/v1/items/use', { item_key: 'water' }, dev)).status, id).toBe(200);
      }
      expect(used(p, id), id).toBe(-1);
      expect((await call(p, 'GET', '/v1/device/me', undefined, dev)).body, id).toMatchObject({ play_allowed: true, trial: null });
    }
  });

  it('a child who has had a lesson with the teacher is never on the clock (tutor_student is set by no product code)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    at(0);
    const p = platform();
    const dev = await kid(p, 'kid-l', 'fam-l');
    sqlOf(p).run("insert into lessons (id, player_id, world_id, started_at, ended_at, plan) values ('les-1', 'kid-l', 'w-1', 0, 1, 'tutor')");
    for (let i = 0; i < 6; i++) {
      at(i * 60 * S);
      expect((await call(p, 'POST', '/v1/device/heartbeat', undefined, dev)).body).toEqual({ play_allowed: true, trial: null });
    }
    expect(used(p, 'kid-l')).toBe(-1);
  });

  it('an English Day student linked to the class is never on the clock, before the first lesson too', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    at(0);
    const p = platform();
    const dev = await kid(p, 'kid-e', 'fam-e');
    sqlOf(p).exec('create table if not exists ed_links (player_id text primary key, student text unique not null, at integer not null)');
    sqlOf(p).run("insert into ed_links (player_id, student, at) values ('kid-e', 'ed-student-1', 0)");
    for (let i = 0; i < 6; i++) {
      at(i * 60 * S);
      expect((await call(p, 'POST', '/v1/device/heartbeat', undefined, dev)).body).toEqual({ play_allowed: true, trial: null });
    }
    expect(used(p, 'kid-e')).toBe(-1);
  });

  it('a seat issued after the trial ended opens play again at once', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    at(0);
    const p = platform();
    const dev = await kid(p, 'kid-p', 'fam-p');
    for (let i = 0; i <= 3; i++) {
      at(i * 60 * S);
      await call(p, 'POST', '/v1/device/heartbeat', undefined, dev);
    }
    expect((await call(p, 'GET', '/v1/device/me', undefined, dev)).body.play_allowed).toBe(false);
    await call(p, 'POST', '/v1/admin/seats', { payer_guardian_id: 'g-fam-p', plan: 'solo', term: 'month', player_ids: ['kid-p'] });
    expect((await call(p, 'GET', '/v1/device/me', undefined, dev)).body).toMatchObject({ play_allowed: true, trial: null, seat: { state: 'active' } });
    expect((await call(p, 'POST', '/v1/items/use', { item_key: 'water' }, dev)).status).toBe(200);
  });

  it('heartbeat needs a live device token', async () => {
    const p = platform();
    expect((await call(p, 'POST', '/v1/device/heartbeat', undefined, anon)).status).toBe(401);
    expect((await call(p, 'POST', '/v1/device/heartbeat', undefined, bearer('x'.repeat(40)))).status).toBe(401);
  });
});
