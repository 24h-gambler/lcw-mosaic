import { describe, expect, it } from 'vitest';
import { PlatformDO, type LcwEnv } from '../platform.js';
import { markSeatUse, sweepSeatNotices } from '../seats.js';
import { fakeDurableStorage } from './fake-do.js';

/** Dan 11-16 "환불은 한 번 체험하면 불가": a seat's paid period is refunded only before its first use (docs/01 §4). */
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
async function family(p: PlatformDO, playerId: string, fam: string, nickname = 'Juno') {
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
const sql = (p: PlatformDO) => (p as any).sql;
const issue = async (p: PlatformDO, body: Record<string, unknown>) => (await call(p, 'POST', '/v1/admin/seats', body)).body.seat_ids as string[];

describe('refund ends at first use (seats.ts seat_usage)', () => {
  it('the child opens the world → used: no request, no rule refund, the reason is said; nothing goes to the inbox', async () => {
    const p = platform();
    const g = await family(p, 'kid-1', 'fam-a');
    const dev = await linkDevice(p, g, 'kid-1');
    const [sid] = await issue(p, { payer_guardian_id: 'g-fam-a', plan: 'solo', term: 'month', player_ids: ['kid-1'] });
    const before = (await call(p, 'GET', '/v1/family/seats', undefined, g)).body.seats[0];
    expect(before).toMatchObject({ refundable: true, refund_block: null, first_used_at: null, can_request_refund: true });

    expect((await call(p, 'GET', '/v1/device/me', undefined, dev)).body.play_allowed).toBe(true);
    const after = (await call(p, 'GET', '/v1/family/seats', undefined, g)).body.seats[0];
    expect(after).toMatchObject({ refundable: false, refund_block: 'seat_used', can_request_refund: false });
    expect(after.first_used_at).toBeGreaterThan(0);
    expect(after.payments[0].used).toBe(true);

    const req = await call(p, 'POST', `/v1/family/seats/${sid}/refund-request`, {}, g);
    expect(req.status).toBe(409);
    expect(req.body.error).toBe('seat_used');
    expect((await call(p, 'GET', '/v1/admin/seat-inbox')).body.requests).toHaveLength(0);
    const rule = await call(p, 'POST', `/v1/admin/seats/${sid}/refund`, {});
    expect(rule.status).toBe(409);
    expect(rule.body.error).toBe('seat_used');
    const admin = (await call(p, 'GET', '/v1/admin/seats')).body.find((s: any) => s.id === sid);
    expect(admin).toMatchObject({ rule_refund_open: false, first_used_via: 'world' });
    // the seat keeps going
    expect((await call(p, 'GET', '/v1/device/me', undefined, dev)).body.seat.state).toBe('active');
  });

  it('a request made before the first use is judged as of the request, even if the child played meanwhile', async () => {
    const p = platform();
    const g = await family(p, 'kid-1', 'fam-a');
    const dev = await linkDevice(p, g, 'kid-1');
    const [sid] = await issue(p, { payer_guardian_id: 'g-fam-a', plan: 'solo', term: 'month', player_ids: ['kid-1'] });
    expect((await call(p, 'POST', `/v1/family/seats/${sid}/refund-request`, {}, g)).body.status).toBe('pending');
    await new Promise((r) => setTimeout(r, 5));
    await call(p, 'GET', '/v1/device/me', undefined, dev);
    const inbox = (await call(p, 'GET', '/v1/admin/seat-inbox')).body.requests[0];
    expect(inbox.first_used_at).toBeGreaterThan(inbox.requested_at);
    const done = await call(p, 'POST', `/v1/admin/seats/${sid}/refund`, {});
    expect(done.status).toBe(200);
    expect(done.body.refund_krw).toBe(14_900);
  });

  it('Duo is judged seat by seat: the used seat stays, the unused one can still leave (payer settles)', async () => {
    const p = platform();
    const ga = await family(p, 'kid-a', 'fam-a', 'Juno');
    const gb = await family(p, 'kid-b', 'fam-b', 'Mina');
    const devA = await linkDevice(p, ga, 'kid-a');
    const [seatA, seatB] = await issue(p, { payer_guardian_id: 'g-fam-a', plan: 'duo', term: 'month', player_ids: ['kid-a', 'kid-b'] });
    await call(p, 'GET', '/v1/device/me', undefined, devA);
    expect((await call(p, 'POST', `/v1/family/seats/${seatA}/refund-request`, {}, ga)).body.error).toBe('seat_used');
    const mineB = (await call(p, 'GET', '/v1/family/seats', undefined, gb)).body.seats.find((s: any) => s.id === seatB);
    expect(mineB).toMatchObject({ refundable: true, can_request_refund: true });
    expect((await call(p, 'POST', `/v1/family/seats/${seatB}/refund-request`, { mode: 'refund_difference' }, ga)).status).toBe(201);
    const done = await call(p, 'POST', `/v1/admin/seats/${seatB}/refund`, {});
    expect(done.status).toBe(200);
    expect(done.body.remaining_seat).toMatchObject({ id: seatA, plan: 'solo' });
    expect(done.body.refund_krw).toBeGreaterThan(0);
  });

  it('an extension paid after use is its own payment: refundable until its own days begin to be used', async () => {
    const p = platform();
    const g = await family(p, 'kid-1', 'fam-a');
    const dev = await linkDevice(p, g, 'kid-1');
    const [sid] = await issue(p, { payer_guardian_id: 'g-fam-a', plan: 'solo', term: 'month', player_ids: ['kid-1'], paid_at: Date.now() - 3 * DAY });
    await call(p, 'GET', '/v1/device/me', undefined, dev);
    expect((await call(p, 'POST', `/v1/admin/seats/${sid}/extend`, { days: 30 })).status).toBe(200);
    const seat = (await call(p, 'GET', '/v1/family/seats', undefined, g)).body.seats[0];
    expect(seat.refundable).toBe(true);
    expect(seat.payments.map((x: any) => [x.kind, x.used])).toEqual([
      ['extend', false],
      ['issue', true]
    ]);
    const done = await call(p, 'POST', `/v1/admin/seats/${sid}/refund`, {});
    expect(done.status).toBe(200);
    expect(done.body.removed_days).toBe(30);
    // the issue payment, used, is not refunded
    expect((await call(p, 'POST', `/v1/admin/seats/${sid}/refund`, {})).body.error).toBe('seat_used');
  });

  it('tutoring: inside the tutoring fee (0원) nothing to refund; a paid tutoring seat follows the same rule; a lesson is its first use', async () => {
    const p = platform();
    const g = await family(p, 'kid-1', 'fam-a');
    await issue(p, { payer_guardian_id: 'g-fam-a', plan: 'tutoring', term: 'month', player_ids: ['kid-1'] });
    const incl = (await call(p, 'GET', '/v1/family/seats', undefined, g)).body.seats[0];
    expect(incl).toMatchObject({ plan: 'tutoring', refundable: false, refund_block: 'nothing_paid', can_request_refund: false });

    const g2 = await family(p, 'kid-2', 'fam-b');
    const [sid2] = await issue(p, { payer_guardian_id: 'g-fam-b', plan: 'tutoring', term: 'month', player_ids: ['kid-2'], amount_krw: 200_000 });
    expect((await call(p, 'GET', '/v1/family/seats', undefined, g2)).body.seats[0]).toMatchObject({ refundable: true, can_request_refund: true });
    markSeatUse(sql(p), 'kid-2', Date.now(), 'lesson');
    expect((await call(p, 'POST', `/v1/family/seats/${sid2}/refund-request`, {}, g2)).body.error).toBe('seat_used');

    const g3 = await family(p, 'kid-3', 'fam-c');
    const [sid3] = await issue(p, { payer_guardian_id: 'g-fam-c', plan: 'tutoring', term: 'month', player_ids: ['kid-3'], amount_krw: 200_000 });
    expect((await call(p, 'POST', `/v1/family/seats/${sid3}/refund-request`, {}, g3)).body.status).toBe('pending');
    expect((await call(p, 'POST', `/v1/admin/seats/${sid3}/refund`, {})).body.refund_krw).toBe(200_000);
  });

  it('a lesson does not use a Solo seat; the hourly normalizer fills first use from lessons in a tutoring period', async () => {
    const p = platform();
    const g = await family(p, 'kid-1', 'fam-a');
    const [sid] = await issue(p, { payer_guardian_id: 'g-fam-a', plan: 'solo', term: 'month', player_ids: ['kid-1'] });
    markSeatUse(sql(p), 'kid-1', Date.now(), 'lesson');
    expect((await call(p, 'GET', '/v1/family/seats', undefined, g)).body.seats[0].first_used_at).toBeNull();

    // a tutoring seat whose lesson happened before use was recorded (e.g. before this shipped)
    await family(p, 'kid-9', 'fam-z', 'Oreo');
    const [tid] = await issue(p, { payer_guardian_id: 'g-fam-z', plan: 'tutoring', term: 'month', player_ids: ['kid-9'], paid_at: Date.now() - DAY });
    const at = Date.now() - 1000;
    sql(p).run("insert into lessons (id, player_id, world_id, started_at, plan) values ('l-1', 'kid-9', 'w', ?, 'weekly_120m')", [at]);
    sweepSeatNotices(sql(p), Date.now());
    const admin = (await call(p, 'GET', '/v1/admin/seats')).body;
    expect(admin.find((s: any) => s.id === tid)).toMatchObject({ first_used_at: at, first_used_via: 'lesson' });
    expect(admin.find((s: any) => s.id === sid).first_used_at).toBeNull();
  });
});
