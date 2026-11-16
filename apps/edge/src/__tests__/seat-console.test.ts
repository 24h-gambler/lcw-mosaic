import { describe, expect, it } from 'vitest';
import { PlatformDO, isPublicRoute, type LcwEnv } from '../platform.js';
import { SEAT_MAX_AHEAD_MS } from '../seats.js';
import { fakeDurableStorage } from './fake-do.js';

/** Teacher console subscription controls (LessonDirector → /v1/admin/seats/:id/dates|stop|changes). */
const TOKEN = 'op-token-0123456789abcdef';
const op = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
const anon = { 'content-type': 'application/json' };
const bearer = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const DAY = 86_400_000;
const platform = () => new PlatformDO({ storage: fakeDurableStorage() }, { PLATFORM: undefined as never, LCW_OPERATOR_TOKEN: TOKEN } as LcwEnv);
async function call(p: PlatformDO, method: string, path: string, body?: unknown, headers: Record<string, string> = op) {
  const res = await p.fetch(new Request(`https://x${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
  return { status: res.status, body: (await res.json()) as any };
}
async function family(p: PlatformDO, playerId: string, fam: string, nickname = 'Oreo') {
  await call(p, 'POST', '/v1/admin/players', { family_id: fam, guardian_id: `g-${fam}`, player_id: playerId, nickname, birth_year: 2016, level: 'L2' });
  const inv = await call(p, 'POST', '/v1/admin/family-invites', { player_id: playerId });
  const s = await call(p, 'POST', '/v1/family/session', { invite: inv.body.invite_path.split('#k=')[1] }, anon);
  const g = bearer(s.body.guardian_token);
  await call(p, 'POST', '/v1/family/service-consent', { granted: true }, g);
  return g;
}
async function linkDevice(p: PlatformDO, g: Record<string, string>, playerId: string) {
  const code = await call(p, 'POST', `/v1/family/children/${playerId}/device-code`, {}, g);
  const link = await call(p, 'POST', '/v1/device/link', { code: code.body.code }, anon);
  return bearer(link.body.device_token);
}
/** The console's 과외 좌석 발급: 0원, payer = the child's family guardian. */
async function tutoring(p: PlatformDO, playerId: string) {
  const r = await call(p, 'POST', '/v1/admin/seats', { payer_player_id: playerId, plan: 'tutoring', term: 'month', player_ids: [playerId], amount_krw: 0 });
  expect(r.status).toBe(201);
  return r.body.seat_ids[0] as string;
}

describe('teacher console seat controls', () => {
  it('routes are operator-only', async () => {
    expect(isPublicRoute('POST', '/v1/admin/seats/seat-1/dates')).toBe(false);
    expect(isPublicRoute('POST', '/v1/admin/seats/seat-1/stop')).toBe(false);
    expect(isPublicRoute('GET', '/v1/admin/seats/seat-1/changes')).toBe(false);
    const p = platform();
    const g = await family(p, 'stu-1', 'fam-a');
    const sid = await tutoring(p, 'stu-1');
    expect((await call(p, 'POST', `/v1/admin/seats/${sid}/dates`, { ends_at: Date.now() + 40 * DAY }, anon)).status).toBe(401);
    expect((await call(p, 'POST', `/v1/admin/seats/${sid}/dates`, { ends_at: Date.now() + 40 * DAY }, g)).status).toBe(401);
    expect((await call(p, 'POST', `/v1/admin/seats/${sid}/stop`, {}, g)).status).toBe(401);
    expect((await call(p, 'GET', `/v1/admin/seats/${sid}/changes`, undefined, g)).status).toBe(401);
  });

  it('tutoring issue is 0원 and audited; date edit moves start/end, the guardian sees the same dates, audit keeps before/after', async () => {
    const p = platform();
    const g = await family(p, 'stu-1', 'fam-a');
    const sid = await tutoring(p, 'stu-1');
    const seat0 = (await call(p, 'GET', '/v1/admin/seats')).body[0];
    expect(seat0).toMatchObject({ id: sid, player_id: 'stu-1', plan: 'tutoring', state: 'active' });
    expect(seat0.payments[0].amount_krw).toBe(0);

    const newStart = seat0.starts_at - 3 * DAY;
    const newEnd = seat0.ends_at + 10 * DAY;
    const r = await call(p, 'POST', `/v1/admin/seats/${sid}/dates`, { starts_at: newStart, ends_at: newEnd, note: 'console' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id: sid, starts_at: newStart, ends_at: newEnd, state: 'active', changed: true });

    const fam = (await call(p, 'GET', '/v1/family/seats', undefined, g)).body.seats[0];
    expect(fam).toMatchObject({ id: sid, starts_at: newStart, ends_at: newEnd, state: 'active' });
    const admin = (await call(p, 'GET', '/v1/admin/seats')).body[0];
    expect(admin).toMatchObject({ starts_at: newStart, ends_at: newEnd });
    // No payment was made or changed by the edit.
    expect(admin.payments).toHaveLength(1);

    const changes = (await call(p, 'GET', `/v1/admin/seats/${sid}/changes`)).body;
    expect(changes.map((c: any) => c.kind)).toEqual(['edit_dates', 'issue']);
    expect(changes[0]).toMatchObject({
      by: 'operator',
      before: { starts_at: seat0.starts_at, ends_at: seat0.ends_at, status: 'active' },
      after: { starts_at: newStart, ends_at: newEnd, status: 'active' },
      note: 'console'
    });
    expect(changes[1]).toMatchObject({ before: null, after: { plan: 'tutoring', amount_krw: 0, ends_at: seat0.ends_at } });

    // Same dates again: nothing changes, nothing is recorded.
    expect((await call(p, 'POST', `/v1/admin/seats/${sid}/dates`, { ends_at: newEnd })).body.changed).toBe(false);
    expect((await call(p, 'GET', `/v1/admin/seats/${sid}/changes`)).body).toHaveLength(2);
  });

  it('date edit validation: strict body, end after start, not absurdly far, refunded/unknown seat refused', async () => {
    const p = platform();
    await family(p, 'stu-1', 'fam-a');
    const sid = await tutoring(p, 'stu-1');
    const s = (await call(p, 'GET', '/v1/admin/seats')).body[0];
    expect((await call(p, 'POST', `/v1/admin/seats/${sid}/dates`, {})).status).toBe(400);
    expect((await call(p, 'POST', `/v1/admin/seats/${sid}/dates`, { ends_at: s.ends_at, plan: 'solo' })).status).toBe(400);
    expect((await call(p, 'POST', `/v1/admin/seats/${sid}/dates`, { ends_at: 'x' })).status).toBe(400);
    expect((await call(p, 'POST', `/v1/admin/seats/${sid}/dates`, { ends_at: s.starts_at })).body.error).toBe('ends_before_starts');
    expect((await call(p, 'POST', `/v1/admin/seats/${sid}/dates`, { starts_at: s.ends_at + DAY })).body.error).toBe('ends_before_starts');
    expect((await call(p, 'POST', `/v1/admin/seats/${sid}/dates`, { ends_at: Date.now() + SEAT_MAX_AHEAD_MS + DAY })).body.error).toBe('date_too_far');
    expect((await call(p, 'POST', '/v1/admin/seats/seat-none/dates', { ends_at: s.ends_at })).status).toBe(404);
    expect((await call(p, 'POST', '/v1/admin/seats/seat-none/stop', {})).status).toBe(404);
    expect((await call(p, 'GET', '/v1/admin/seats/seat-none/changes')).status).toBe(404);
    expect((await call(p, 'GET', `/v1/admin/seats/${sid}/changes`)).body).toHaveLength(1);
  });

  it('an end date in the past ends play like an expiry; a later end reopens it', async () => {
    const p = platform();
    const g = await family(p, 'stu-1', 'fam-a');
    const dev = await linkDevice(p, g, 'stu-1');
    const sid = await tutoring(p, 'stu-1');
    const s = (await call(p, 'GET', '/v1/admin/seats')).body[0];
    expect((await call(p, 'POST', `/v1/admin/seats/${sid}/dates`, { starts_at: s.starts_at - 5 * DAY, ends_at: Date.now() - DAY })).body.state).toBe('read_only');
    expect((await call(p, 'GET', '/v1/device/me', undefined, dev)).body).toMatchObject({ play_allowed: false, seat: { state: 'read_only' } });
    expect((await call(p, 'POST', `/v1/admin/seats/${sid}/dates`, { ends_at: Date.now() + 3 * DAY })).body.state).toBe('expiring');
    expect((await call(p, 'GET', '/v1/device/me', undefined, dev)).body.play_allowed).toBe(true);
  });

  it('stop ends the seat now without touching payments; extend 1 month reopens it; every step is in the audit', async () => {
    const p = platform();
    const g = await family(p, 'stu-1', 'fam-a');
    const dev = await linkDevice(p, g, 'stu-1');
    const sid = await tutoring(p, 'stu-1');
    const before = (await call(p, 'GET', '/v1/admin/seats')).body[0];
    const t0 = Date.now();
    const st = await call(p, 'POST', `/v1/admin/seats/${sid}/stop`, {});
    expect(st.status).toBe(200);
    expect(st.body.state).toBe('read_only');
    expect(st.body.ends_at).toBeGreaterThanOrEqual(t0);
    expect(st.body.ends_at).toBeLessThanOrEqual(Date.now());
    expect((await call(p, 'POST', `/v1/admin/seats/${sid}/stop`, {})).body.error).toBe('already_ended');
    expect((await call(p, 'POST', `/v1/admin/seats/${sid}/stop`, { reason: 'x' })).status).toBe(400);
    expect((await call(p, 'GET', '/v1/device/me', undefined, dev)).body).toMatchObject({ play_allowed: false, seat: { state: 'read_only' } });
    const fam = (await call(p, 'GET', '/v1/family/seats', undefined, g)).body.seats[0];
    expect(fam).toMatchObject({ state: 'read_only', ends_at: st.body.ends_at });
    const after = (await call(p, 'GET', '/v1/admin/seats')).body[0];
    expect(after.payments).toEqual(before.payments);

    const ext = await call(p, 'POST', `/v1/admin/seats/${sid}/extend`, { days: 30, amount_krw: 0, note: 'console' });
    expect(ext.status).toBe(200);
    expect(ext.body).toMatchObject({ state: 'active', amount_krw: 0 });
    expect((await call(p, 'GET', '/v1/device/me', undefined, dev)).body.play_allowed).toBe(true);

    const changes = (await call(p, 'GET', `/v1/admin/seats/${sid}/changes`)).body;
    expect(changes.map((c: any) => c.kind)).toEqual(['extend', 'stop', 'issue']);
    expect(changes[1]).toMatchObject({ before: { ends_at: before.ends_at }, after: { ends_at: st.body.ends_at } });
    expect(changes[0]).toMatchObject({ before: { ends_at: st.body.ends_at }, after: { ends_at: ext.body.ends_at, days: 30, amount_krw: 0 }, note: 'console' });
  });

  it('a refunded seat cannot be edited or stopped; a new tutoring seat can be issued after a stop', async () => {
    const p = platform();
    await family(p, 'stu-1', 'fam-a');
    const sid = await tutoring(p, 'stu-1');
    // a live seat blocks a second issue
    expect((await call(p, 'POST', '/v1/admin/seats', { payer_player_id: 'stu-1', plan: 'tutoring', term: 'month', player_ids: ['stu-1'], amount_krw: 0 })).status).toBe(409);
    await call(p, 'POST', `/v1/admin/seats/${sid}/stop`, {});
    const sid2 = await tutoring(p, 'stu-1');
    expect(sid2).not.toBe(sid);

    await family(p, 'stu-2', 'fam-b', 'Mint');
    const solo = await call(p, 'POST', '/v1/admin/seats', { payer_player_id: 'stu-2', plan: 'solo', term: 'month', player_ids: ['stu-2'] });
    const rs = solo.body.seat_ids[0];
    expect((await call(p, 'POST', `/v1/admin/seats/${rs}/refund`, {})).status).toBe(200);
    expect((await call(p, 'POST', `/v1/admin/seats/${rs}/dates`, { ends_at: Date.now() + 40 * DAY })).body.error).toBe('already_refunded');
    expect((await call(p, 'POST', `/v1/admin/seats/${rs}/stop`, {})).body.error).toBe('already_refunded');
  });
});
