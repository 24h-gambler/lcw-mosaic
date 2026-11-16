import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FREE_PLAY_LIMITS, GUEST_PASS_HEADER, normalizeGuestPassCode } from '@lcw/schemas';
import { TRY_CAFE_OFFERS, gradeTryOrder } from '@lcw/content';
import { PlatformDO, isPublicRoute, type LcwEnv } from '../platform.js';
import { kstDay, kstMonth, newGuestPassCode, nextKstDayStart, nextKstMonthStart, passesPlayedThisMonth } from '../free-play.js';
import { fakeDurableStorage } from './fake-do.js';

const TOKEN = 'op-token-0123456789abcdef';
const op = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
const anon = { 'content-type': 'application/json' };
const bearer = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const MIN = 60_000;
const DAY = 86_400_000;
const platform = () => new PlatformDO({ storage: fakeDurableStorage() }, { PLATFORM: undefined as never, LCW_OPERATOR_TOKEN: TOKEN } as LcwEnv);
async function call(p: PlatformDO, method: string, path: string, body?: unknown, headers: Record<string, string> = anon) {
  const res = await p.fetch(new Request(`https://x${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
  return { status: res.status, body: (await res.json()) as any };
}
const ip = (a: string) => ({ ...anon, 'cf-connecting-ip': a });
const DEV_A = 'device-aaaaaaaaaaaaaaaa';
const DEV_B = 'device-bbbbbbbbbbbbbbbb';
const T0 = Date.UTC(2026, 10, 16, 3, 0, 0); // 2026-11-16 12:00 KST
const at = (ms: number) => vi.setSystemTime(ms);

async function guardianWithSeat(p: PlatformDO, playerId = 'kid-host', fam = 'fam-host', seat = true) {
  await call(p, 'POST', '/v1/admin/players', { family_id: fam, guardian_id: `g-${fam}`, player_id: playerId, nickname: 'Juno', birth_year: 2016, level: 'L2' }, op);
  const inv = await call(p, 'POST', '/v1/admin/family-invites', { player_id: playerId }, op);
  const s = await call(p, 'POST', '/v1/family/session', { invite: inv.body.invite_path.split('#k=')[1] }, anon);
  const g = bearer(s.body.guardian_token);
  await call(p, 'POST', '/v1/family/service-consent', { granted: true }, g);
  if (!seat) return { g, sid: '' };
  const issued = await call(p, 'POST', '/v1/admin/seats', { payer_guardian_id: `g-${fam}`, plan: 'solo', term: 'month', player_ids: [playerId] }, op);
  return { g, sid: issued.body.seat_ids[0] as string };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  at(T0);
});
afterEach(() => vi.useRealTimers());

describe('free play limits (docs/01 §3, Dan 2026-11-16)', () => {
  it('the table Dan set: /try 3 minutes and one order, pass 30 minutes and 2 a month', () => {
    expect(FREE_PLAY_LIMITS).toMatchObject({ tryMinutes: 3, tryVoiceOrders: 1, guestPassMinutes: 30, guestPassesPerSeatPerMonth: 2 });
  });

  it('public routes are exactly the try and pass entry routes; guardian routes need the guardian session', () => {
    expect(isPublicRoute('POST', '/v1/try/start')).toBe(true);
    expect(isPublicRoute('POST', '/v1/try/order')).toBe(true);
    expect(isPublicRoute('GET', '/v1/guest-pass/check')).toBe(true);
    expect(isPublicRoute('POST', '/v1/guest-pass/redeem')).toBe(true);
    expect(isPublicRoute('GET', '/v1/guest-pass/status')).toBe(true);
    expect(isPublicRoute('GET', '/v1/try/start')).toBe(false);
    expect(isPublicRoute('POST', '/v1/family/seats/s1/guest-passes')).toBe(true);
  });

  it('KST day and month boundaries', () => {
    expect(kstDay(T0)).toBe('2026-11-16');
    expect(kstDay(Date.UTC(2026, 10, 16, 15, 0))).toBe('2026-11-17');
    expect(nextKstDayStart(T0)).toBe(Date.UTC(2026, 10, 16, 15, 0));
    expect(kstMonth(Date.UTC(2026, 10, 30, 15, 0))).toBe('2026-12');
    expect(nextKstMonthStart(T0)).toBe(Date.UTC(2026, 10, 30, 15, 0));
  });
});

describe('/try session: server clock, one order, one session a device a day', () => {
  it('start stamps 3 minutes on the server clock; a reload resumes the same session', async () => {
    const p = platform();
    const s = await call(p, 'POST', '/v1/try/start', { device: DEV_A }, ip('198.51.100.1'));
    expect(s.status).toBe(201);
    expect(s.body).toMatchObject({ started_at: T0, ends_at: T0 + 3 * MIN, server_now: T0, orders_left: 1, order: null });
    at(T0 + MIN);
    const again = await call(p, 'POST', '/v1/try/start', { device: DEV_A }, ip('198.51.100.1'));
    expect(again.status).toBe(200);
    expect(again.body.try_id).toBe(s.body.try_id);
    expect(again.body.ends_at).toBe(T0 + 3 * MIN);
  });

  it('the server grades like the site: a miss leaves the order, a pass uses it, a second order is refused', async () => {
    const p = platform();
    const { try_id } = (await call(p, 'POST', '/v1/try/start', { device: DEV_A })).body;
    const miss = await call(p, 'POST', '/v1/try/order', { try_id, aim: 3, text: 'banana', path: 'recognition' });
    expect(miss.body).toMatchObject({ stars: 0, granted: false, orders_left: 1 });
    // The client cannot claim stars: the server grades the words it heard.
    const ok = await call(p, 'POST', '/v1/try/order', { try_id, aim: 3, text: 'can I have a warm honey tea so that I stay warm', path: 'recognition' });
    expect(ok.body).toMatchObject({ stars: 3, granted: true, orders_left: 0 });
    const second = await call(p, 'POST', '/v1/try/order', { try_id, aim: 1, text: 'honey tea please', path: 'recognition' });
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({ error: 'try_order_used', order: { stars: 3 } });
    // Resuming shows the granted order.
    expect((await call(p, 'POST', '/v1/try/start', { device: DEV_A })).body.order).toMatchObject({ stars: 3 });
  });

  it('word cards stop at two stars without a heard voice; a wrong card order does not pass', async () => {
    expect(gradeTryOrder({ aim: 3, text: TRY_CAFE_OFFERS[2]!.text, path: 'wordcards_only' })).toBe(2);
    expect(gradeTryOrder({ aim: 3, text: TRY_CAFE_OFFERS[2]!.text, path: 'wordcards_with_loudness', spoke: true })).toBe(3);
    expect(gradeTryOrder({ aim: 3, text: TRY_CAFE_OFFERS[2]!.text, path: 'wordcards_only', spoke: true })).toBe(2);
    expect(gradeTryOrder({ aim: 2, text: 'warm a Can I have honey tea?', path: 'wordcards_only' })).toBe(0);
  });

  it('after 3 minutes (+5 s in flight) the order is refused: no client timer can extend it', async () => {
    const p = platform();
    const { try_id } = (await call(p, 'POST', '/v1/try/start', { device: DEV_A })).body;
    at(T0 + 3 * MIN + 4_000);
    expect((await call(p, 'POST', '/v1/try/order', { try_id, aim: 1, text: 'banana', path: 'recognition' })).status).toBe(200);
    at(T0 + 3 * MIN + 6_000);
    const late = await call(p, 'POST', '/v1/try/order', { try_id, aim: 1, text: 'honey tea please', path: 'recognition' });
    expect(late.status).toBe(410);
    expect(late.body.error).toBe('try_ended');
  });

  it('one session per device per KST day, then the next day opens; an address caps at 20 a day', async () => {
    const p = platform();
    await call(p, 'POST', '/v1/try/start', { device: DEV_A }, ip('198.51.100.7'));
    at(T0 + 4 * MIN);
    const used = await call(p, 'POST', '/v1/try/start', { device: DEV_A }, ip('198.51.100.7'));
    expect(used.status).toBe(429);
    expect(used.body).toMatchObject({ error: 'try_used_today', retry_at: nextKstDayStart(T0) });
    at(nextKstDayStart(T0) + 1);
    expect((await call(p, 'POST', '/v1/try/start', { device: DEV_A }, ip('198.51.100.7'))).status).toBe(201);

    for (let i = 0; i < FREE_PLAY_LIMITS.trySessionsPerAddressPerDay - 1; i++) {
      expect((await call(p, 'POST', '/v1/try/start', { device: `device-school-${String(i).padStart(10, '0')}` }, ip('198.51.100.7'))).status).toBe(201);
    }
    expect((await call(p, 'POST', '/v1/try/start', { device: 'device-school-overflow-1' }, ip('198.51.100.7'))).status).toBe(429);
    expect((await call(p, 'POST', '/v1/try/start', { device: 'device-other-network-01' }, ip('203.0.113.9'))).status).toBe(201);
  });

  it('counts granted orders next to the AI budget and stores no address or device id', async () => {
    const p = platform();
    const { try_id } = (await call(p, 'POST', '/v1/try/start', { device: DEV_A }, ip('198.51.100.1'))).body;
    await call(p, 'POST', '/v1/try/order', { try_id, aim: 1, text: 'honey tea please', path: 'recognition' });
    expect(p.sql.get<{ used: number }>("select used from quota_daily where k = 'try_orders'")?.used).toBe(1);
    const dump = JSON.stringify(p.sql.all('select * from try_sessions'));
    expect(dump).not.toContain('198.51.100.1');
    expect(dump).not.toContain(DEV_A);
  });

  it('address and device hashes are keyed with a secret kept in the object: the plain sha256 of an address does not match', async () => {
    const p = platform();
    await call(p, 'POST', '/v1/try/start', { device: DEV_A }, ip('198.51.100.2'));
    const row = p.sql.get<{ addr_hash: string; device_hash: string }>('select addr_hash, device_hash from try_sessions')!;
    const plain = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))), (b) => b.toString(16).padStart(2, '0')).join('');
    expect(row.addr_hash).not.toBe((await plain(`try|198.51.100.2|${kstDay(T0)}`)).slice(0, 32));
    expect(row.device_hash).not.toBe((await plain(`try|${DEV_A}`)).slice(0, 32));
    const secret = p.sql.get<{ v: string }>('select v from free_play_secret where id = 1')!.v;
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    expect(row.addr_hash).toBe((await plain(`${secret}|try|198.51.100.2|${kstDay(T0)}`)).slice(0, 32));
    // The same object keeps the same key: the device still resumes its session.
    expect((await call(p, 'POST', '/v1/try/start', { device: DEV_A }, ip('198.51.100.2'))).status).toBe(200);
  });
});

describe('guest pass: 30 minutes from the first entry, 2 per seat per month', () => {
  it('codes use the unambiguous alphabet and normalise from XXXX-XXXX', () => {
    const seq = [...Array(64)].map((_, i) => (i * 37) % 256);
    const code = newGuestPassCode((n) => Uint8Array.from(seq.slice(0, n)));
    expect(code).toMatch(/^[2-9A-HJKMNP-Z]{8}$/);
    expect(normalizeGuestPassCode(`${code.slice(0, 4).toLowerCase()}-${code.slice(4)}`)).toBe(code);
    expect(normalizeGuestPassCode('O0O0-1111')).toBeNull();
  });

  it('a guardian issues two a month; a third waits for next month; a pass nobody used can be taken back', async () => {
    const p = platform();
    const { g, sid } = await guardianWithSeat(p);
    const a = await call(p, 'POST', `/v1/family/seats/${sid}/guest-passes`, {}, g);
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({ per_month: 2, minutes: 30, left_this_month: 1, pass: { state: 'ready' } });
    expect(a.body.pass.link).toMatch(/^\/pass\?code=[2-9A-HJKMNP-Z]{8}$/);
    const b = await call(p, 'POST', `/v1/family/seats/${sid}/guest-passes`, {}, g);
    expect(b.body.left_this_month).toBe(0);
    const c = await call(p, 'POST', `/v1/family/seats/${sid}/guest-passes`, {}, g);
    expect(c.status).toBe(409);
    // Nothing played yet: the next slot opens when the first waiting code runs out of its 7 days, not at the month turn.
    expect(c.body).toMatchObject({ error: 'monthly_limit', resets_at: T0 + FREE_PLAY_LIMITS.guestPassRedeemDays * DAY });
    // Revoking an unused pass gives the slot back.
    expect((await call(p, 'POST', `/v1/family/guest-passes/${b.body.pass.id}/revoke`, {}, g)).body.left_this_month).toBe(1);
    expect((await call(p, 'POST', `/v1/family/seats/${sid}/guest-passes`, {}, g)).status).toBe(201);
    at(nextKstMonthStart(T0) + 1);
    expect((await call(p, 'GET', `/v1/family/seats/${sid}/guest-passes`, undefined, g)).body.left_this_month).toBe(2);
    // Without a guardian session, or for another family's seat: nothing.
    expect((await call(p, 'POST', `/v1/family/seats/${sid}/guest-passes`, {}, anon)).status).toBe(401);
    const other = await guardianWithSeat(p, 'kid-other', 'fam-other');
    expect((await call(p, 'POST', `/v1/family/seats/${sid}/guest-passes`, {}, other.g)).status).toBe(404);
  });

  it('a seat that is not active cannot issue', async () => {
    const p = platform();
    const { g } = await guardianWithSeat(p, 'kid-noseat', 'fam-noseat', false);
    expect((await call(p, 'POST', '/v1/family/seats/seat-nope/guest-passes', {}, g)).status).toBe(404);
    const { g: g2, sid } = await guardianWithSeat(p, 'kid-r', 'fam-r');
    await call(p, 'POST', `/v1/admin/seats/${sid}/refund`, {}, op);
    expect((await call(p, 'POST', `/v1/family/seats/${sid}/guest-passes`, {}, g2)).body.error).toBe('seat_inactive');
  });

  it('check does not start the clock; the first entry does; the server clock ends it after 30 minutes', async () => {
    const p = platform();
    const { g, sid } = await guardianWithSeat(p);
    const code: string = (await call(p, 'POST', `/v1/family/seats/${sid}/guest-passes`, {}, g)).body.pass.code;
    at(T0 + 2 * DAY);
    expect((await call(p, 'GET', `/v1/guest-pass/check?code=${code}`)).body).toMatchObject({ state: 'ready', minutes: 30, ends_at: null });
    const r = await call(p, 'POST', '/v1/guest-pass/redeem', { code, device: DEV_A });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ world_id: 'home-kid-host', host_nickname: 'J***', started_at: T0 + 2 * DAY, ends_at: T0 + 2 * DAY + 30 * MIN });
    const h = { [GUEST_PASS_HEADER]: r.body.token };
    at(T0 + 2 * DAY + 10 * MIN);
    expect((await call(p, 'GET', '/v1/guest-pass/status', undefined, h)).body).toMatchObject({ state: 'active', remaining_ms: 20 * MIN });
    // Another device cannot use the running pass; the same device may come back with a new token.
    expect((await call(p, 'POST', '/v1/guest-pass/redeem', { code, device: DEV_B })).body.error).toBe('pass_in_use');
    const back = await call(p, 'POST', '/v1/guest-pass/redeem', { code, device: DEV_A });
    expect(back.status).toBe(200);
    expect(back.body.ends_at).toBe(T0 + 2 * DAY + 30 * MIN);
    at(T0 + 2 * DAY + 30 * MIN);
    expect((await call(p, 'GET', '/v1/guest-pass/status', undefined, h)).body).toMatchObject({ state: 'ended', remaining_ms: 0 });
    expect((await call(p, 'POST', '/v1/guest-pass/redeem', { code, device: DEV_A })).body.error).toBe('pass_ended');
    expect((await call(p, 'GET', `/v1/guest-pass/check?code=${code}`)).body.state).toBe('ended');
  });

  it('an unused code stops working 7 days after issue; a revoked running pass ends at once', async () => {
    const p = platform();
    const { g, sid } = await guardianWithSeat(p);
    const one = (await call(p, 'POST', `/v1/family/seats/${sid}/guest-passes`, {}, g)).body.pass;
    const two = (await call(p, 'POST', `/v1/family/seats/${sid}/guest-passes`, {}, g)).body.pass;
    const r = await call(p, 'POST', '/v1/guest-pass/redeem', { code: two.code, device: DEV_A });
    at(T0 + MIN);
    await call(p, 'POST', `/v1/family/guest-passes/${two.id}/revoke`, {}, g);
    expect((await call(p, 'GET', '/v1/guest-pass/status', undefined, { [GUEST_PASS_HEADER]: r.body.token })).body.state).toBe('ended');
    at(T0 + FREE_PLAY_LIMITS.guestPassRedeemDays * DAY + 1);
    expect((await call(p, 'POST', '/v1/guest-pass/redeem', { code: one.code, device: DEV_A })).body.error).toBe('pass_expired');
  });

  it('a code nobody entered gives its slot back when its 7 days run out; a used one keeps it', async () => {
    const p = platform();
    const { g, sid } = await guardianWithSeat(p);
    const one = (await call(p, 'POST', `/v1/family/seats/${sid}/guest-passes`, {}, g)).body.pass;
    const two = (await call(p, 'POST', `/v1/family/seats/${sid}/guest-passes`, {}, g)).body;
    expect(two.left_this_month).toBe(0);
    await call(p, 'POST', '/v1/guest-pass/redeem', { code: two.pass.code, device: DEV_A });
    // Same KST month (issued on the 16th, +7 days = the 23rd): the unused one expired and no longer counts.
    at(T0 + FREE_PLAY_LIMITS.guestPassRedeemDays * DAY + 1);
    const list = (await call(p, 'GET', `/v1/family/seats/${sid}/guest-passes`, undefined, g)).body;
    expect(list.passes.find((x: { id: string }) => x.id === one.id).state).toBe('expired');
    expect(list.left_this_month).toBe(1);
    expect((await call(p, 'POST', `/v1/family/seats/${sid}/guest-passes`, {}, g)).status).toBe(201);
    expect((await call(p, 'POST', `/v1/family/seats/${sid}/guest-passes`, {}, g)).body.error).toBe('monthly_limit');
  });

  it('passes count in the month a friend first enters: codes issued on the 30th and played on the 1st never make 3 played in one month', async () => {
    const p = platform();
    const { g, sid } = await guardianWithSeat(p);
    const lastNight = nextKstMonthStart(T0) - 60 * MIN; // Nov 30, 23:00 KST
    const dec1 = nextKstMonthStart(T0) + 60 * MIN; // Dec 1, 01:00 KST
    at(lastNight);
    const a = (await call(p, 'POST', `/v1/family/seats/${sid}/guest-passes`, {}, g)).body.pass;
    const b = (await call(p, 'POST', `/v1/family/seats/${sid}/guest-passes`, {}, g)).body.pass;
    expect((await call(p, 'POST', '/v1/guest-pass/redeem', { code: a.code, device: DEV_A })).status).toBe(201); // played in November
    at(dec1);
    // December: nothing played yet, b still waiting → one slot.
    expect((await call(p, 'GET', `/v1/family/seats/${sid}/guest-passes`, undefined, g)).body.left_this_month).toBe(1);
    const c = (await call(p, 'POST', `/v1/family/seats/${sid}/guest-passes`, {}, g)).body.pass;
    expect((await call(p, 'POST', `/v1/family/seats/${sid}/guest-passes`, {}, g)).body.error).toBe('monthly_limit');
    expect((await call(p, 'POST', '/v1/guest-pass/redeem', { code: b.code, device: DEV_A })).status).toBe(201);
    expect((await call(p, 'POST', '/v1/guest-pass/redeem', { code: c.code, device: DEV_B })).status).toBe(201);
    expect(passesPlayedThisMonth(p.sql, sid, dec1)).toBe(2);
    // Both played this month and nothing waiting: the slot opens at the month turn.
    expect((await call(p, 'GET', `/v1/family/seats/${sid}/guest-passes`, undefined, g)).body.resets_at).toBe(nextKstMonthStart(dec1));
    expect(passesPlayedThisMonth(p.sql, sid, lastNight)).toBe(1);
    expect((await call(p, 'POST', `/v1/family/seats/${sid}/guest-passes`, {}, g)).body.error).toBe('monthly_limit');
    // Second line: a waiting code left from the older count (issue month) cannot become a third played pass in December.
    p.sql.run("insert into guest_pass_grants (id, seat_id, issued_by, code, month, issued_at, redeem_until) values ('gp-old', ?, 'g-fam-host', 'ZZZZ2345', '2026-11', ?, ?)", [
      sid,
      lastNight,
      lastNight + 7 * DAY
    ]);
    const third = await call(p, 'POST', '/v1/guest-pass/redeem', { code: 'ZZZZ2345', device: 'device-cccccccccccccccc' });
    expect(third).toMatchObject({ status: 409, body: { error: 'monthly_limit', resets_at: nextKstMonthStart(dec1) } });
    // A new month starts the played count again (the month seat itself has run out by then, so only the count is checked).
    expect(passesPlayedThisMonth(p.sql, sid, nextKstMonthStart(dec1) + MIN)).toBe(0);
  });

  it("a Duo payer cannot issue, list or revoke passes for the other family's child (only that child's guardians)", async () => {
    const p = platform();
    const a = await guardianWithSeat(p, 'kid-a', 'fam-a', false);
    const b = await guardianWithSeat(p, 'kid-b', 'fam-b', false);
    // fam-a pays one Duo for its own child and a friend's child in fam-b.
    const issued = await call(p, 'POST', '/v1/admin/seats', { payer_guardian_id: 'g-fam-a', plan: 'duo', term: 'month', player_ids: ['kid-a', 'kid-b'] }, op);
    expect(issued.status).toBeLessThan(300);
    const seatIds: string[] = issued.body.seat_ids;
    const seatOf = (pid: string) => p.sql.get<{ id: string }>('select id from seats where player_id = ? and id in (' + seatIds.map(() => '?').join(',') + ')', [pid, ...seatIds])!.id;
    const seatA = seatOf('kid-a');
    const seatB = seatOf('kid-b');
    // The payer's own child: fine.
    expect((await call(p, 'POST', `/v1/family/seats/${seatA}/guest-passes`, {}, a.g)).status).toBe(201);
    // The friend's child: the payer is not that child's guardian.
    expect((await call(p, 'POST', `/v1/family/seats/${seatB}/guest-passes`, {}, a.g)).status).toBe(404);
    expect((await call(p, 'GET', `/v1/family/seats/${seatB}/guest-passes`, undefined, a.g)).status).toBe(404);
    const own = (await call(p, 'POST', `/v1/family/seats/${seatB}/guest-passes`, {}, b.g)).body.pass;
    expect(own.code).toBeTruthy();
    expect((await call(p, 'POST', `/v1/family/guest-passes/${own.id}/revoke`, {}, a.g)).status).toBe(404);
    expect((await call(p, 'GET', `/v1/guest-pass/check?code=${own.code}`)).body.state).toBe('ready');
  });

  it('the guardian list keeps every waiting code however many were issued and taken back since (no push-out by a cap)', async () => {
    const p = platform();
    const { g, sid } = await guardianWithSeat(p);
    const kept = (await call(p, 'POST', `/v1/family/seats/${sid}/guest-passes`, {}, g)).body.pass;
    // the other slot: issue and take back, 30 times, every row newer than the kept code
    for (let i = 0; i < 30; i++) {
      at(T0 + (i + 1) * MIN);
      const x = (await call(p, 'POST', `/v1/family/seats/${sid}/guest-passes`, {}, g)).body.pass;
      expect((await call(p, 'POST', `/v1/family/guest-passes/${x.id}/revoke`, {}, g)).status).toBe(200);
    }
    // a played pass for the history
    at(T0 + 40 * MIN);
    const played = (await call(p, 'POST', `/v1/family/seats/${sid}/guest-passes`, {}, g)).body.pass;
    expect((await call(p, 'POST', '/v1/guest-pass/redeem', { code: played.code, device: DEV_A }, ip('198.51.100.70'))).status).toBe(201);
    const list = (await call(p, 'GET', `/v1/family/seats/${sid}/guest-passes`, undefined, g)).body;
    const ids = list.passes.map((x: { id: string }) => x.id);
    expect(ids).toContain(kept.id);
    expect(ids).toContain(played.id);
    // passes taken back before anyone entered are not listed (they count for nothing)
    expect(list.passes).toHaveLength(2);
    expect(list.passes.map((x: { state: string }) => x.state)).toEqual(['active', 'ready']);
    expect(list.left_this_month).toBe(0);
  });

  it('wrong codes are limited per address per hour', async () => {
    const p = platform();
    for (let i = 0; i < 30; i++) await call(p, 'GET', '/v1/guest-pass/check?code=ABCD-EFGH', undefined, ip('198.51.100.66'));
    expect((await call(p, 'GET', '/v1/guest-pass/check?code=ABCD-EFGH', undefined, ip('198.51.100.66'))).status).toBe(429);
    expect((await call(p, 'GET', '/v1/guest-pass/check?code=ABCD-EFGH', undefined, ip('198.51.100.67'))).status).toBe(404);
  });
});

describe("a friend on a guest pass plays in the host's world (docs/19 §8)", () => {
  const X = 126;
  const Z = 170;
  it("opens the host's plot, builds with the host's blocks, never breaks the host's build, and stops at the end", async () => {
    const p = platform();
    const { g, sid } = await guardianWithSeat(p);
    // the host child builds a block of their own first (linked device)
    const code6 = (await call(p, 'POST', '/v1/family/children/kid-host/device-code', {}, g)).body.code;
    const dev = bearer((await call(p, 'POST', '/v1/device/link', { code: code6, label: 'tab' })).body.device_token);
    expect((await call(p, 'POST', '/v1/plot/ops', { ops: [{ op: 'place', x: X, y: 1, z: Z, slot: 0 }] }, dev)).body.results).toEqual([{ ok: true }]);
    await call(p, 'POST', '/v1/my-world', { name: 'Juno Town', season: 'winter', time: 'sunset', buddy: 'bunny' }, dev);

    const code = (await call(p, 'POST', `/v1/family/seats/${sid}/guest-passes`, {}, g)).body.pass.code;
    const r = await call(p, 'POST', '/v1/guest-pass/redeem', { code, device: DEV_A });
    const h = { ...anon, [GUEST_PASS_HEADER]: r.body.token };
    // the host's plot and world look, read with the pass alone
    const plot = await call(p, 'GET', '/v1/plot', undefined, h);
    expect(plot.status).toBe(200);
    expect(plot.body.cells.some((c: number[]) => c[0] === X && c[1] === 1 && c[2] === Z)).toBe(true);
    expect((await call(p, 'GET', '/v1/my-world', undefined, h)).body).toMatchObject({ made: true, visitor: true, world: { season: 'winter', time: 'sunset', buddy: 'bunny' } });
    // place: yes (host's carried blocks); break the friend's own: yes; break the host's, or the chest: not_yours
    const ops = await call(
      p,
      'POST',
      '/v1/plot/ops',
      {
        ops: [
          { op: 'place', x: X + 2, y: 1, z: Z, slot: 0 },
          { op: 'break', x: X, y: 1, z: Z },
          { op: 'take', ref: 'b1', n: 1 },
          { op: 'place', x: X + 3, y: 1, z: Z, slot: 0 }
        ],
        batch: 'guestbatch01'
      },
      h
    );
    expect(ops.body.results).toEqual([{ ok: true }, { ok: false, reason: 'not_yours' }, { ok: false, reason: 'not_yours' }, { ok: true }]);
    // a later request may break what this friend placed (remembered per pass)
    expect((await call(p, 'POST', '/v1/plot/ops', { ops: [{ op: 'break', x: X + 2, y: 1, z: Z }] }, h)).body.results).toEqual([{ ok: true }]);
    // the friend's snapshot says which cells are theirs to break again; the host's never carries that list
    expect((await call(p, 'GET', '/v1/plot', undefined, h)).body.guest_cells).toEqual([[X + 3, 1, Z]]);
    expect((await call(p, 'GET', '/v1/plot?guest_grant=anything', undefined, dev)).body.guest_cells).toBeUndefined();
    // the host sees the friend's block in their own plot
    const after = (await call(p, 'GET', '/v1/plot', undefined, dev)).body;
    expect(after.cells.some((c: number[]) => c[0] === X + 3 && c[2] === Z)).toBe(true);
    expect(after.cells.some((c: number[]) => c[0] === X && c[1] === 1 && c[2] === Z)).toBe(true);
    // a body cannot pose as another child or grant: the server fills them
    const forged = await call(p, 'POST', '/v1/plot/ops', { ops: [{ op: 'break', x: X, y: 1, z: Z }], player_id: 'kid-other', guest_grant: 'x' }, h);
    expect(forged.body.results).toEqual([{ ok: false, reason: 'not_yours' }]);
    // the host breaks the friend's block and builds there again: that cell is the host's now
    expect((await call(p, 'POST', '/v1/plot/ops', { ops: [{ op: 'break', x: X + 3, y: 1, z: Z }] }, dev)).body.results).toEqual([{ ok: true }]);
    expect((await call(p, 'POST', '/v1/plot/ops', { ops: [{ op: 'place', x: X + 3, y: 1, z: Z, slot: 0 }] }, dev)).body.results).toEqual([{ ok: true }]);
    expect((await call(p, 'POST', '/v1/plot/ops', { ops: [{ op: 'break', x: X + 3, y: 1, z: Z }] }, h)).body.results).toEqual([{ ok: false, reason: 'not_yours' }]);
    expect((await call(p, 'GET', '/v1/plot', undefined, h)).body.guest_cells).toEqual([]);
    // the end: reads and writes answer 410; no pass at all is the operator gate
    at(T0 + 30 * MIN);
    expect((await call(p, 'GET', '/v1/plot', undefined, h)).status).toBe(410);
    expect((await call(p, 'POST', '/v1/plot/ops', { ops: [{ op: 'place', x: X + 4, y: 1, z: Z, slot: 0 }] }, h)).status).toBe(410);
    expect((await call(p, 'GET', '/v1/my-world', undefined, h)).status).toBe(401);
    expect((await call(p, 'GET', '/v1/plot', undefined, { ...anon, [GUEST_PASS_HEADER]: 'x'.repeat(48) })).status).toBe(401);
  });

  it("a stopped host seat ends the friend's building; a child's own token is never taken for the pass", async () => {
    const p = platform();
    const { g, sid } = await guardianWithSeat(p);
    const code = (await call(p, 'POST', `/v1/family/seats/${sid}/guest-passes`, {}, g)).body.pass.code;
    const token = (await call(p, 'POST', '/v1/guest-pass/redeem', { code, device: DEV_A })).body.token;
    const h = { ...anon, [GUEST_PASS_HEADER]: token };
    // a resent guest batch is answered once (the journal keys guests apart from the host)
    const batch = { ops: [{ op: 'place', x: X + 1, y: 1, z: Z, slot: 0 }], batch: 'guestbatch02' };
    expect((await call(p, 'POST', '/v1/plot/ops', batch, h)).body.results).toEqual([{ ok: true }]);
    expect((await call(p, 'POST', '/v1/plot/ops', batch, h)).body.results).toEqual([{ ok: true }]);
    // the friend's own linked device with its own token gets its own plot, not the host's
    const own = await guardianWithSeat(p, 'kid-friend', 'fam-friend');
    const code6 = (await call(p, 'POST', '/v1/family/children/kid-friend/device-code', {}, own.g)).body.code;
    const dev = (await call(p, 'POST', '/v1/device/link', { code: code6, label: 'tab' })).body.device_token;
    const mine = (await call(p, 'GET', '/v1/plot', undefined, { ...bearer(dev), [GUEST_PASS_HEADER]: token })).body;
    expect(mine.cells.some((c: number[]) => c[0] === X + 1 && c[2] === Z)).toBe(false);
    // the host's seat is refunded: no more building on the pass
    expect((await call(p, 'POST', `/v1/admin/seats/${sid}/refund`, {}, op)).status).toBe(200);
    expect((await call(p, 'POST', '/v1/plot/ops', { ops: [{ op: 'place', x: X + 2, y: 1, z: Z, slot: 0 }] }, h)).status).toBe(410);
  });
});
