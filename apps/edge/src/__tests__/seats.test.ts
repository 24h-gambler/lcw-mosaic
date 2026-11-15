import { describe, expect, it } from 'vitest';
import { PLAN_PRICES_KRW } from '@lcw/quota';
import { PlatformDO, isPublicRoute, type LcwEnv } from '../platform.js';
import { seatState, SEAT_READ_ONLY_MS } from '../seats.js';
import { fakeDurableStorage } from './fake-do.js';

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

describe('seats (WP-704, docs/01 §4, docs/09 P6)', () => {
  it('seat state follows time: active, expiring ≤7d, read-only 30 days, then archived', () => {
    const now = 1_000 * DAY;
    expect(seatState({ ends_at: now + 20 * DAY, status: 'active' }, now)).toBe('active');
    expect(seatState({ ends_at: now + 3 * DAY, status: 'active' }, now)).toBe('expiring');
    expect(seatState({ ends_at: now - DAY, status: 'active' }, now)).toBe('read_only');
    expect(seatState({ ends_at: now - SEAT_READ_ONLY_MS - 1, status: 'active' }, now)).toBe('archived');
    expect(seatState({ ends_at: now + 20 * DAY, status: 'refunded' }, now)).toBe('refunded');
  });

  it('routes: guardian seat routes are public (own token), operator routes are not', () => {
    expect(isPublicRoute('GET', '/v1/family/seats')).toBe(true);
    expect(isPublicRoute('POST', '/v1/family/seats/seat-1/refund-request')).toBe(true);
    expect(isPublicRoute('POST', '/v1/admin/seats')).toBe(false);
    expect(isPublicRoute('POST', '/v1/admin/seats/seat-1/refund')).toBe(false);
  });

  it('Solo: manual issue at list price, one seat per child, 7-day full refund, then play stops', async () => {
    const p = platform();
    const g = await family(p, 'kid-1', 'fam-a');
    const dev = await linkDevice(p, g, 'kid-1');
    // no seat ever (pre-sale) → play allowed
    expect((await call(p, 'GET', '/v1/device/me', undefined, dev)).body).toMatchObject({ play_allowed: true, seat: null });

    expect((await call(p, 'POST', '/v1/admin/seats', { payer_guardian_id: 'g-fam-a', plan: 'solo', term: 'month', player_ids: ['kid-1'] }, anon)).status).toBe(401);
    expect((await call(p, 'POST', '/v1/admin/seats', { payer_guardian_id: 'g-fam-a', plan: 'solo', term: 'month', player_ids: ['kid-1'] }, g)).status).toBe(401);
    expect((await call(p, 'POST', '/v1/admin/seats', { payer_guardian_id: 'g-fam-a', plan: 'duo', term: 'month', player_ids: ['kid-1'] })).status).toBe(400);
    const issued = await call(p, 'POST', '/v1/admin/seats', { payer_guardian_id: 'g-fam-a', plan: 'solo', term: 'month', player_ids: ['kid-1'] });
    expect(issued.status).toBe(201);
    expect(issued.body.amount_krw).toBe(PLAN_PRICES_KRW.solo.month);
    expect((await call(p, 'POST', '/v1/admin/seats', { payer_guardian_id: 'g-fam-a', plan: 'solo', term: 'month', player_ids: ['kid-1'] })).status).toBe(409);
    expect((await call(p, 'GET', '/v1/device/me', undefined, dev)).body).toMatchObject({ play_allowed: true, seat: { state: 'active' } });

    const mine = await call(p, 'GET', '/v1/family/seats', undefined, g);
    expect(mine.status).toBe(200);
    expect(mine.body.seats).toHaveLength(1);
    expect(mine.body.seats[0]).toMatchObject({ plan: 'solo', state: 'active', is_payer: true, can_request_refund: true, child: { nickname: 'Juno' } });
    expect(mine.body.seats[0].payment.amount_krw).toBe(14_900);

    const sid = issued.body.seat_ids[0];
    const req = await call(p, 'POST', `/v1/family/seats/${sid}/refund-request`, {}, g);
    expect(req.body.status).toBe('pending');
    expect((await call(p, 'POST', `/v1/family/seats/${sid}/refund-request`, {}, g)).status).toBe(409);
    const inbox = await call(p, 'GET', '/v1/admin/seat-inbox');
    expect(inbox.body.requests).toHaveLength(1);
    expect(inbox.body.requests[0]).toMatchObject({ amount_krw: 14_900, usage: { lessons: 0, utterances: 0 }, nickname: 'Juno' });

    const done = await call(p, 'POST', `/v1/admin/seats/${sid}/refund`, {});
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ refund_krw: 14_900, payer_id: 'g-fam-a', remaining_seat: null });
    expect((await call(p, 'GET', '/v1/admin/seat-inbox')).body.requests).toHaveLength(0);
    expect((await call(p, 'POST', `/v1/admin/seats/${sid}/refund`, {})).status).toBe(409);
    expect((await call(p, 'GET', '/v1/device/me', undefined, dev)).body).toMatchObject({ play_allowed: false, seat: { state: 'refunded' } });
    const after = (await call(p, 'GET', '/v1/family/seats', undefined, g)).body.seats[0];
    expect(after).toMatchObject({ state: 'refunded', can_request_refund: false });
    expect(after.payment.refunded_krw).toBe(14_900);
  });

  it('outside 7 days: no automatic refund, goes to the operator inbox for review', async () => {
    const p = platform();
    const g = await family(p, 'kid-1', 'fam-a');
    const paid = Date.now() - 8 * DAY;
    const issued = await call(p, 'POST', '/v1/admin/seats', { payer_guardian_id: 'g-fam-a', plan: 'solo', term: 'month', player_ids: ['kid-1'], paid_at: paid });
    const sid = issued.body.seat_ids[0];
    expect((await call(p, 'GET', '/v1/family/seats', undefined, g)).body.seats[0].can_request_refund).toBe(false);
    expect((await call(p, 'POST', `/v1/family/seats/${sid}/refund-request`, {}, g)).body.status).toBe('review');
    expect((await call(p, 'POST', `/v1/family/seats/${sid}/refund-request`, {}, g)).status).toBe(409);
    expect((await call(p, 'GET', '/v1/family/seats', undefined, g)).body.seats[0].pending_request.status).toBe('review');
    const r = await call(p, 'POST', `/v1/admin/seats/${sid}/refund`, {});
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('outside_refund_window');
    expect((await call(p, 'POST', `/v1/admin/seats/${sid}/refund`, {})).status).toBe(409);
    const inbox = await call(p, 'GET', '/v1/admin/seat-inbox');
    // pressing the button twice does not stack review items
    expect(inbox.body.requests).toHaveLength(1);
    expect(inbox.body.requests[0]).toMatchObject({ status: 'review', reason: 'outside_refund_window', nickname: 'Juno' });
    expect((await call(p, 'GET', '/v1/admin/seats')).body[0].state).toBe('active');
    // the operator decides the exception by hand: never more than was paid
    const rid = inbox.body.requests[0].id;
    expect((await call(p, 'POST', `/v1/admin/seat-refunds/${rid}/decide`, { decision: 'refund', refund_krw: 20_000 })).status).toBe(400);
    const dec = await call(p, 'POST', `/v1/admin/seat-refunds/${rid}/decide`, { decision: 'refund', refund_krw: 7_000 });
    expect(dec.body).toMatchObject({ status: 'done', refund_krw: 7_000 });
    expect((await call(p, 'GET', '/v1/admin/seat-inbox')).body.requests).toHaveLength(0);
    const after = (await call(p, 'GET', '/v1/family/seats', undefined, g)).body.seats[0];
    expect(after).toMatchObject({ state: 'refunded' });
    expect(after.payment.refunded_krw).toBe(7_000);
  });

  it('issue by the payer child: the family guardian becomes the payer; decline leaves the seat alone', async () => {
    const p = platform();
    const g = await family(p, 'kid-1', 'fam-a');
    const issued = await call(p, 'POST', '/v1/admin/seats', {
      payer_player_id: 'kid-1',
      plan: 'solo',
      term: 'year',
      player_ids: ['kid-1'],
      paid_at: Date.now() - 9 * DAY
    });
    expect(issued.status).toBe(201);
    expect(issued.body.amount_krw).toBe(PLAN_PRICES_KRW.solo.year);
    expect((await call(p, 'POST', '/v1/admin/seats', { payer_player_id: 'kid-1', payer_guardian_id: 'g-fam-a', plan: 'solo', term: 'year', player_ids: ['kid-1'] })).status).toBe(400);
    const sid = issued.body.seat_ids[0];
    const req = await call(p, 'POST', `/v1/family/seats/${sid}/refund-request`, {}, g);
    expect(req.body.status).toBe('review');
    expect((await call(p, 'POST', `/v1/admin/seat-refunds/${req.body.id}/decide`, { decision: 'decline' })).body.status).toBe('declined');
    const s = (await call(p, 'GET', '/v1/family/seats', undefined, g)).body.seats[0];
    expect(s).toMatchObject({ state: 'active', is_payer: true });
    expect(s.payment.refunded_krw).toBe(0);
  });

  it('Duo: one payer; one seat refunded → payer gets the difference, the other seat becomes Solo, other family sees no name or money', async () => {
    const p = platform();
    const ga = await family(p, 'kid-a', 'fam-a', 'Juno');
    const gb = await family(p, 'kid-b', 'fam-b', 'Mina');
    const devB = await linkDevice(p, gb, 'kid-b');
    // payer must be a guardian of one of the seats
    await family(p, 'kid-c', 'fam-c', 'Ari');
    expect((await call(p, 'POST', '/v1/admin/seats', { payer_guardian_id: 'g-fam-c', plan: 'duo', term: 'month', player_ids: ['kid-a', 'kid-b'] })).status).toBe(400);
    expect((await call(p, 'POST', '/v1/admin/seats', { payer_guardian_id: 'g-fam-a', plan: 'duo', term: 'month', player_ids: ['kid-a', 'kid-a'] })).status).toBe(400);
    const issued = await call(p, 'POST', '/v1/admin/seats', { payer_guardian_id: 'g-fam-a', plan: 'duo', term: 'month', player_ids: ['kid-a', 'kid-b'] });
    expect(issued.status).toBe(201);
    expect(issued.body.amount_krw).toBe(PLAN_PRICES_KRW.duo.month);
    const [seatA, seatB] = issued.body.seat_ids;

    // payer sees both seats; the other family's seat has no child name and the payer still sees the payment
    const payerView = (await call(p, 'GET', '/v1/family/seats', undefined, ga)).body.seats;
    expect(payerView).toHaveLength(2);
    const other = payerView.find((s: any) => s.id === seatB);
    expect(other.duo_options).toEqual({ refund_difference_krw: 5_000, solo_days: 20 });
    expect(other.child).toBeNull();
    expect(JSON.stringify(other)).not.toContain('Mina');
    expect(JSON.stringify(other)).not.toContain('kid-b');
    // non-payer family sees only its own seat, without payment
    const bView = (await call(p, 'GET', '/v1/family/seats', undefined, gb)).body.seats;
    expect(bView).toHaveLength(1);
    expect(bView[0]).toMatchObject({ id: seatB, is_payer: false, payment: null, duo_options: null, child: { nickname: 'Mina' } });
    expect(JSON.stringify(bView)).not.toContain('Juno');
    expect(JSON.stringify(bView)).not.toContain('g-fam-a');
    // a third family cannot touch either seat
    const gc = await family(p, 'kid-d', 'fam-d', 'Bo');
    expect((await call(p, 'POST', `/v1/family/seats/${seatB}/refund-request`, {}, gc)).status).toBe(404);

    // family B asks to leave; the payer is refunded the Duo − Solo difference, seat A turns Solo for the full term
    expect((await call(p, 'POST', `/v1/family/seats/${seatB}/refund-request`, { mode: 'convert_to_solo_days' }, gb)).body.status).toBe('pending');
    const r = await call(p, 'POST', `/v1/admin/seats/${seatB}/refund`, {});
    expect(r.status).toBe(200);
    // a non-payer cannot pick the settlement → default refund_difference
    expect(r.body.refund_krw).toBe(PLAN_PRICES_KRW.duo.month - PLAN_PRICES_KRW.solo.month);
    expect(r.body.remaining_seat).toMatchObject({ id: seatA, plan: 'solo', solo_days: 30 });
    const aSeat = (await call(p, 'GET', '/v1/family/seats', undefined, ga)).body.seats.find((s: any) => s.id === seatA);
    expect(aSeat).toMatchObject({ plan: 'solo', state: 'active' });
    expect((await call(p, 'GET', '/v1/device/me', undefined, devB)).body.play_allowed).toBe(false);

    // the last seat refunded within 7 days returns the rest of the payment
    const last = await call(p, 'POST', `/v1/admin/seats/${seatA}/refund`, {});
    expect(last.body.refund_krw).toBe(PLAN_PRICES_KRW.solo.month);
    const total = (await call(p, 'GET', '/v1/family/seats', undefined, ga)).body.seats[0].payment.refunded_krw;
    expect(total).toBe(PLAN_PRICES_KRW.duo.month);
  });

  it('Duo convert mode (payer picks): no cash back, the remaining seat keeps pro-rata Solo days', async () => {
    const p = platform();
    const ga = await family(p, 'kid-a', 'fam-a');
    await family(p, 'kid-b', 'fam-b');
    const issued = await call(p, 'POST', '/v1/admin/seats', { payer_guardian_id: 'g-fam-a', plan: 'duo', term: 'month', player_ids: ['kid-a', 'kid-b'] });
    const [seatA, seatB] = issued.body.seat_ids;
    await call(p, 'POST', `/v1/family/seats/${seatB}/refund-request`, { mode: 'convert_to_solo_days' }, ga);
    const r = await call(p, 'POST', `/v1/admin/seats/${seatB}/refund`, {});
    expect(r.body.refund_krw).toBe(0);
    expect(r.body.remaining_seat.solo_days).toBe(20);
    const a = (await call(p, 'GET', '/v1/admin/seats')).body.find((s: any) => s.id === seatA);
    expect(a.plan).toBe('solo');
    expect(a.ends_at - a.starts_at).toBe(20 * DAY);
  });

  it('expiry: read-only 30 days then archived; extend reopens; hourly cron records notices once', async () => {
    const p = platform();
    const g = await family(p, 'kid-1', 'fam-a');
    const dev = await linkDevice(p, g, 'kid-1');
    const issued = await call(p, 'POST', '/v1/admin/seats', {
      payer_guardian_id: 'g-fam-a',
      plan: 'solo',
      term: 'month',
      player_ids: ['kid-1'],
      paid_at: Date.now() - 35 * DAY
    });
    const sid = issued.body.seat_ids[0];
    const s = (await call(p, 'GET', '/v1/family/seats', undefined, g)).body.seats[0];
    expect(s.state).toBe('read_only');
    expect(s.read_only_until).toBe(s.ends_at + SEAT_READ_ONLY_MS);
    expect((await call(p, 'GET', '/v1/device/me', undefined, dev)).body).toMatchObject({ play_allowed: false, seat: { state: 'read_only' } });

    expect(p.runCron('0 * * * *').ok).toBe(true);
    expect((p.runCron('0 * * * *').detail as any).seat_notices).toBe(0);
    expect((await call(p, 'GET', '/v1/family/seats', undefined, g)).body.seats[0].notice.kind).toBe('expired');

    const ext = await call(p, 'POST', `/v1/admin/seats/${sid}/extend`, { days: 30 });
    expect(ext.body.state).toBe('active');
    expect((await call(p, 'GET', '/v1/device/me', undefined, dev)).body.play_allowed).toBe(true);
    expect((await call(p, 'GET', '/v1/family/seats', undefined, g)).body.seats[0].notice).toBeNull();
    // a fresh seat cannot be stacked on a live one, but can follow an archived one
    expect((await call(p, 'POST', '/v1/admin/seats', { payer_guardian_id: 'g-fam-a', plan: 'solo', term: 'month', player_ids: ['kid-1'] })).status).toBe(409);
  });
});
