/**
 * R326 paid step (billing.ts): server prices only, test mode never opens a seat, live mode confirms with Toss and
 * issues a Solo seat once (a reload of the done page is not a second payment).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PLAN_PRICES_KRW } from '@lcw/quota';
import { PlatformDO, type LcwEnv } from '../platform.js';
import { TOSS_CONFIRM_URL } from '../billing.js';
import { fakeDurableStorage } from './fake-do.js';

const TOKEN = 'op-token-0123456789abcdef';
const op = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
const anon = { 'content-type': 'application/json' };
const bearer = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const platform = (toss = false) =>
  new PlatformDO(
    { storage: fakeDurableStorage() },
    { PLATFORM: undefined as never, LCW_OPERATOR_TOKEN: TOKEN, ...(toss ? { TOSS_CLIENT_KEY: 'test_ck_unit', TOSS_SECRET_KEY: 'test_sk_unit' } : {}) } as LcwEnv
  );
async function call(p: PlatformDO, method: string, path: string, body?: unknown, headers: Record<string, string> = op) {
  const res = await p.fetch(new Request(`https://x${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
  const text = await res.text();
  let b: any = text;
  try {
    b = JSON.parse(text);
  } catch {
    /* plain text */
  }
  return { status: res.status, body: b, headers: res.headers };
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
const checkout = { plan: 'solo', term: 'month', payer_name: '보호자', contact: '010-1234-5678', from: 'world' };
const sqlOf = (p: PlatformDO) => (p as any).sql;
const seatsOf = (p: PlatformDO, id: string) => Number(sqlOf(p).get('select count(*) as n from seats where player_id = ?', [id]).n);

afterEach(() => vi.unstubAllGlobals());

describe('R326 billing: plan choice → order at the server price', () => {
  it('config is public, cached and in test mode without Toss keys (no client key leaks)', async () => {
    const p = platform();
    const r = await call(p, 'GET', '/v1/billing/config', undefined, anon);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ mode: 'test', plans: PLAN_PRICES_KRW });
    expect(r.body.client_key).toBeUndefined();
    expect(r.headers.get('cache-control')).toContain('max-age=3600');
    expect((await call(platform(true), 'GET', '/v1/billing/config', undefined, anon)).body).toMatchObject({ mode: 'live', client_key: 'test_ck_unit' });
  });

  it('test mode: the order waits for a transfer in the operator inbox, bound to the child, and opens no seat', async () => {
    const p = platform();
    const dev = await kid(p, 'kid-b', 'fam-b');
    const o = await call(p, 'POST', '/v1/billing/checkout', checkout, dev);
    expect(o.status).toBe(201);
    expect(o.body).toMatchObject({ mode: 'test', status: 'transfer_wait', amount_krw: 14_900, child_bound: true });
    // an amount in the body is refused (strict body), the price is never the client's
    expect((await call(p, 'POST', '/v1/billing/checkout', { ...checkout, amount_krw: 100 }, anon)).status).toBe(400);
    expect((await call(p, 'POST', '/v1/billing/checkout', { ...checkout, contact: 'x' }, anon)).status).toBe(400);
    // a confirm in test mode does nothing
    expect((await call(p, 'POST', '/v1/billing/confirm', { order_id: o.body.order_id, payment_key: 'pk_fake_000000', amount: 14_900 }, anon)).status).toBe(409);
    expect(seatsOf(p, 'kid-b')).toBe(0);
    const inbox = await call(p, 'GET', '/v1/admin/billing/orders');
    expect(inbox.body.orders[0]).toMatchObject({ id: o.body.order_id, status: 'transfer_wait', plan: 'solo', amount_krw: 14_900, player_id: 'kid-b', nickname: 'Juno' });
    expect((await call(p, 'GET', '/v1/admin/billing/orders', undefined, anon)).status).toBe(401);
    // the operator issued the seat with the usual button and closes the order
    expect((await call(p, 'POST', `/v1/admin/billing/orders/${o.body.order_id}/close`, { outcome: 'seat_issued' })).status).toBe(200);
    expect((await call(p, 'POST', `/v1/admin/billing/orders/${o.body.order_id}/close`, { outcome: 'seat_issued' })).status).toBe(409);
  });

  it('checkouts per address are limited per hour', async () => {
    const p = platform();
    const codes: number[] = [];
    for (let i = 0; i < 8; i++) codes.push((await call(p, 'POST', '/v1/billing/checkout', checkout, anon)).status);
    expect(codes).toEqual([201, 201, 201, 201, 201, 201, 429, 429]);
  });
});

describe('R326 billing live: Toss confirm', () => {
  const tossOk = (amount: number, orderId: string) => new Response(JSON.stringify({ status: 'DONE', totalAmount: amount, orderId }), { status: 200 });

  it('confirms the server amount with the secret key, issues the Solo seat once, and a reload is the same answer', async () => {
    const p = platform(true);
    const dev = await kid(p, 'kid-l', 'fam-l');
    const o = (await call(p, 'POST', '/v1/billing/checkout', checkout, dev)).body;
    expect(o).toMatchObject({ mode: 'live', status: 'pending_payment' });
    const seen: Array<{ url: string; auth: string; body: any }> = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      seen.push({ url, auth: String((init.headers as Record<string, string>).authorization), body: JSON.parse(String(init.body)) });
      return tossOk(14_900, o.order_id);
    });
    const r = await call(p, 'POST', '/v1/billing/confirm', { order_id: o.order_id, payment_key: 'pk_live_123456', amount: 14_900 }, anon);
    expect(r.body).toMatchObject({ ok: true, status: 'seat_issued' });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe(TOSS_CONFIRM_URL);
    expect(seen[0]!.auth).toBe(`Basic ${btoa('test_sk_unit:')}`);
    expect(seen[0]!.body).toEqual({ paymentKey: 'pk_live_123456', orderId: o.order_id, amount: 14_900 });
    expect(seatsOf(p, 'kid-l')).toBe(1);
    // the seat lifts the free-trial gate on the device
    expect((await call(p, 'GET', '/v1/device/me', undefined, dev)).body).toMatchObject({ play_allowed: true, trial: null, seat: { state: 'active' } });
    const again = await call(p, 'POST', '/v1/billing/confirm', { order_id: o.order_id, payment_key: 'pk_live_123456', amount: 14_900 }, anon);
    expect(again.body).toMatchObject({ ok: true, status: 'seat_issued' });
    expect(seen).toHaveLength(1);
    expect(seatsOf(p, 'kid-l')).toBe(1);
    expect((await call(p, 'POST', '/v1/billing/confirm', { order_id: o.order_id, payment_key: 'pk_other_12345', amount: 14_900 }, anon)).status).toBe(409);
  });

  it('a changed amount is refused before Toss is asked; a Toss failure records the reason and opens nothing', async () => {
    const p = platform(true);
    const dev = await kid(p, 'kid-m', 'fam-m');
    let calls = 0;
    vi.stubGlobal('fetch', async () => {
      calls++;
      return new Response(JSON.stringify({ code: 'REJECT_CARD_COMPANY', message: 'no' }), { status: 400 });
    });
    const a = (await call(p, 'POST', '/v1/billing/checkout', checkout, dev)).body;
    expect((await call(p, 'POST', '/v1/billing/confirm', { order_id: a.order_id, payment_key: 'pk_live_aaaaaa', amount: 100 }, anon)).body).toEqual({ error: 'amount_mismatch' });
    expect(calls).toBe(0);
    const b = (await call(p, 'POST', '/v1/billing/checkout', checkout, dev)).body;
    const r = await call(p, 'POST', '/v1/billing/confirm', { order_id: b.order_id, payment_key: 'pk_live_bbbbbb', amount: 14_900 }, anon);
    expect(r).toMatchObject({ status: 402, body: { error: 'payment_failed', reason: 'REJECT_CARD_COMPANY' } });
    expect(seatsOf(p, 'kid-m')).toBe(0);
    // Toss answering DONE for another amount is not a payment of this order
    vi.stubGlobal('fetch', async () => tossOk(100, 'x'));
    const c2 = (await call(p, 'POST', '/v1/billing/checkout', checkout, dev)).body;
    expect((await call(p, 'POST', '/v1/billing/confirm', { order_id: c2.order_id, payment_key: 'pk_live_cccccc', amount: 14_900 }, anon)).status).toBe(402);
    expect(seatsOf(p, 'kid-m')).toBe(0);
  });

  it('a paid Duo (or an order without a child) waits in the inbox as paid, no seat guessed', async () => {
    const p = platform(true);
    const o = (await call(p, 'POST', '/v1/billing/checkout', { ...checkout, plan: 'duo' }, anon)).body;
    expect(o.amount_krw).toBe(19_900);
    vi.stubGlobal('fetch', async () => tossOk(19_900, o.order_id));
    expect((await call(p, 'POST', '/v1/billing/confirm', { order_id: o.order_id, payment_key: 'pk_live_dddddd', amount: 19_900 }, anon)).body).toMatchObject({ ok: true, status: 'paid' });
    expect((await call(p, 'GET', '/v1/admin/billing/orders')).body.orders[0]).toMatchObject({ id: o.order_id, status: 'paid' });
  });
});
