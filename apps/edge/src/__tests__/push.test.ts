import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlatformDO, isPublicRoute, type LcwEnv } from '../platform.js';
import { b64url, encryptPayload, isPushServiceEndpoint, makeVapidKeys, vapidAuthorization } from '../web-push.js';
import { PUSH_FRESH_MS, PUSH_MAX_DEVICE_FAILS, PUSH_TEST_FRESH_MS, deliverPush, enqueueGuardianNotices } from '../push.js';
import { PUSH_COPY_KO } from '../push-copy.js';
import { fakeDurableStorage } from './fake-do.js';

const te = new TextEncoder();
const td = new TextDecoder();

/** RFC 8291 decryption with the browser's private key — what the browser does on receipt. */
type Bytes = Uint8Array<ArrayBuffer>;
async function decrypt(body: Bytes, uaPrivate: CryptoKey, uaPublic: Bytes, auth: Bytes): Promise<string> {
  const salt = body.slice(0, 16);
  const idlen = body[20]!;
  const asPublic = body.slice(21, 21 + idlen);
  const ct = body.slice(21 + idlen);
  const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, uaPrivate, 256));
  const hk = async (s: Bytes, ikm: Bytes, info: Bytes, n: number): Promise<Bytes> =>
    new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: s, info }, await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']), n * 8));
  const cat = (...a: Uint8Array[]): Bytes => new Uint8Array(a.flatMap((x) => [...x]));
  const ikm = await hk(auth, ecdh, cat(te.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const cek = await hk(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hk(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const padded = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ct));
  let end = padded.length - 1;
  while (end >= 0 && padded[end] === 0) end--;
  expect(padded[end]).toBe(2);
  return td.decode(padded.slice(0, end));
}

async function browserKeys() {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const pub = new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer);
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return { priv: pair.privateKey, pub, auth, p256dh: b64url.encode(pub), authB64: b64url.encode(auth) };
}

describe('Web Push crypto (RFC 8291 / 8292)', () => {
  it('matches the RFC 8291 §5 example byte for byte', async () => {
    const body = await encryptPayload(
      { p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', auth: 'BTBZMqHH6r4Tts7J_aSIgg' },
      te.encode('When I grow up, I want to be a watermelon'),
      {
        asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
        asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
        salt: 'DGv6ra1nlYgDCS1FRnbzlw'
      }
    );
    expect(b64url.encode(body)).toBe(
      'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN'
    );
  });

  it('a browser key pair decrypts what we send (fresh keys and salt each time)', async () => {
    const k = await browserKeys();
    const msg = JSON.stringify({ title: PUSH_COPY_KO.seat_7d.title, url: '/family' });
    const a = await encryptPayload({ p256dh: k.p256dh, auth: k.authB64 }, te.encode(msg));
    const b = await encryptPayload({ p256dh: k.p256dh, auth: k.authB64 }, te.encode(msg));
    expect(b64url.encode(a)).not.toBe(b64url.encode(b));
    expect(await decrypt(a, k.priv, k.pub, k.auth)).toBe(msg);
    await expect(encryptPayload({ p256dh: b64url.encode(new Uint8Array(10)), auth: k.authB64 }, te.encode('x'))).rejects.toThrow('bad_p256dh');
  });

  it('VAPID: ES256 JWT for the endpoint origin, verifiable with the public key', async () => {
    const keys = await makeVapidKeys();
    const h = await vapidAuthorization(keys, 'https://fcm.googleapis.com/fcm/send/abc', 'https://lcw.worldwidesomething.com', 1_800_000_000_000);
    const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(h)!;
    expect(m[4]).toBe(keys.publicKey);
    const claims = JSON.parse(td.decode(b64url.decode(m[2]!)));
    expect(claims).toEqual({ aud: 'https://fcm.googleapis.com', exp: 1_800_000_000 + 12 * 3600, sub: 'https://lcw.worldwidesomething.com' });
    const pub = await crypto.subtle.importKey('raw', b64url.decode(keys.publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, b64url.decode(m[3]!), te.encode(`${m[1]}.${m[2]}`))).toBe(true);
    expect('d' in keys.privateJwk).toBe(true);
  });

  it('only browser push services are accepted as endpoints', () => {
    for (const ok of ['https://fcm.googleapis.com/fcm/send/x', 'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://web.push.apple.com/x', 'https://wns2-by3p.notify.windows.com/w/?token=x'])
      expect(isPushServiceEndpoint(ok)).toBe(true);
    for (const bad of ['http://fcm.googleapis.com/x', 'https://fcm.googleapis.com:8443/x', 'https://127.0.0.1/x', 'https://evil.example/fcm.googleapis.com', 'https://fcm.googleapis.com.evil.example/x', 'not a url'])
      expect(isPushServiceEndpoint(bad)).toBe(false);
  });
});

/* ---------- routes and delivery through the platform ---------- */

const TOKEN = 'op-token-0123456789abcdef';
const op = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
const anon = { 'content-type': 'application/json' };
const bearer = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const platform = () => new PlatformDO({ storage: fakeDurableStorage() }, { PLATFORM: undefined as never, LCW_OPERATOR_TOKEN: TOKEN } as LcwEnv);
async function call(p: PlatformDO, method: string, path: string, body?: unknown, headers: Record<string, string> = op) {
  const res = await p.fetch(new Request(`https://x${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
  const t = await res.text();
  return { status: res.status, body: (t ? JSON.parse(t) : null) as any };
}
async function family(p: PlatformDO, pid: string, fam: string) {
  await call(p, 'POST', '/v1/admin/players', { family_id: fam, guardian_id: `g-${fam}`, player_id: pid, nickname: 'Juno', birth_year: 2016, level: 'L1' });
  const inv = await call(p, 'POST', '/v1/admin/family-invites', { player_id: pid });
  const s = await call(p, 'POST', '/v1/family/session', { invite: inv.body.invite_path.split('#k=')[1] }, anon);
  return bearer(s.body.guardian_token);
}
/** Stand-in push service: records what arrives and answers like FCM. */
function pushService(statusFor: (url: string) => number = () => 201) {
  const got: Array<{ url: string; headers: Headers; body: Bytes }> = [];
  const real = globalThis.fetch;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (!isPushServiceEndpoint(url)) return real(input as never, init);
    got.push({ url, headers: new Headers(init?.headers), body: new Uint8Array(init?.body as ArrayBuffer) as Bytes });
    return new Response(null, { status: statusFor(url) });
  });
  return got;
}
const run = (p: PlatformDO) => p.fetch(new Request('https://x/internal/cron', { method: 'POST', headers: { 'x-lcw-internal': 'cron' }, body: JSON.stringify({ cron: '0 * * * *' }) })).then((r) => r.json() as Promise<any>);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('guardian push notices (seat expiry, refunds) — held until the operator turns sending on', () => {
  it('subscribe → seat 7d notice queued → held while off → sent encrypted to this family only once on', async () => {
    const got = pushService();
    const p = platform();
    const g = await family(p, 'kid-1', 'fam-a');
    const other = await family(p, 'kid-2', 'fam-b');
    const k = await browserKeys();
    const k2 = await browserKeys();
    const key = await call(p, 'GET', '/v1/family/push', undefined, g);
    expect(key.body).toMatchObject({ public_key: expect.stringMatching(/^B[A-Za-z0-9_-]{86}$/), devices: 0, this_device: false, sending: false });
    expect((await call(p, 'GET', '/v1/family/push', undefined, other)).body.public_key).toBe(key.body.public_key);

    // a non-push-service endpoint and bad keys are refused
    expect((await call(p, 'POST', '/v1/family/push/subscribe', { endpoint: 'https://evil.example/x', keys: { p256dh: k.p256dh, auth: k.authB64 } }, g)).body.error).toBe('unknown_push_service');
    expect((await call(p, 'POST', '/v1/family/push/subscribe', { endpoint: 'https://fcm.googleapis.com/fcm/send/a', keys: { p256dh: 'A'.repeat(87), auth: k.authB64 } }, g)).body.error).toBe('bad_keys');
    expect((await call(p, 'POST', '/v1/family/push/subscribe', { endpoint: 'https://fcm.googleapis.com/fcm/send/a', keys: { p256dh: k.p256dh, auth: k.authB64 }, label: '폰' }, g)).status).toBe(201);
    expect((await call(p, 'POST', '/v1/family/push/subscribe', { endpoint: 'https://fcm.googleapis.com/fcm/send/b', keys: { p256dh: k2.p256dh, auth: k2.authB64 } }, other)).status).toBe(201);
    expect((await call(p, 'GET', `/v1/family/push?endpoint=${encodeURIComponent('https://fcm.googleapis.com/fcm/send/a')}`, undefined, g)).body).toMatchObject({ devices: 1, this_device: true });

    // a seat for kid-1 ending in 5 days
    const now = Date.now();
    const issued = await call(p, 'POST', '/v1/admin/seats', { payer_player_id: 'kid-1', plan: 'solo', term: 'month', player_ids: ['kid-1'], amount_krw: 19900, paid_at: now - 25 * 86_400_000 });
    expect(issued.status).toBeLessThan(300);
    (p as any).sql.run("update seats set ends_at = ? where player_id = 'kid-1'", [now + 5 * 86_400_000]);
    let cron = await run(p);
    expect(cron.push).toMatchObject({ queued: 1, sending: false, held: 1, sent: 0 });
    expect(got).toHaveLength(0);
    const admin = await call(p, 'GET', '/v1/admin/push');
    expect(admin.body).toMatchObject({ sending: false, devices: 2, families_with_devices: 2, outbox: { queued: 1 } });
    expect(admin.body.recent[0]).toMatchObject({ kind: 'seat_7d', status: 'queued' });

    // the operator turns sending on → next hour it goes out, to fam-a's device only, once
    expect((await call(p, 'POST', '/v1/admin/push/sending', { enabled: true, by: 'coordinator' })).body).toEqual({ sending: true });
    cron = await run(p);
    expect(cron.push).toMatchObject({ queued: 0, sending: true, sent: 1 });
    expect(got.map((x) => x.url)).toEqual(['https://fcm.googleapis.com/fcm/send/a']);
    const h = got[0]!.headers;
    expect(h.get('content-encoding')).toBe('aes128gcm');
    expect(h.get('ttl')).toBe('86400');
    expect(h.get('authorization')).toMatch(/^vapid t=.+, k=B/);
    const payload = JSON.parse(await decrypt(got[0]!.body, k.priv, k.pub, k.auth));
    expect(payload).toMatchObject({ title: PUSH_COPY_KO.seat_7d.title, body: PUSH_COPY_KO.seat_7d.body, url: '/family', tag: 'seat' });
    expect(JSON.stringify(payload)).not.toMatch(/Juno|kid-1|19900|fam-a/);
    await run(p);
    expect(got).toHaveLength(1);
  });

  it('gone devices are dropped, failing ones after 5 tries; no device → no_device; refunds notify; old events are not replayed', async () => {
    let status = 410;
    const got = pushService(() => status);
    const p = platform();
    const g = await family(p, 'kid-1', 'fam-a');
    const k = await browserKeys();
    await call(p, 'POST', '/v1/admin/push/sending', { enabled: true, by: 't' });
    await call(p, 'POST', '/v1/family/push/subscribe', { endpoint: 'https://fcm.googleapis.com/fcm/send/a', keys: { p256dh: k.p256dh, auth: k.authB64 } }, g);
    const t1 = await call(p, 'POST', '/v1/family/push/test', {}, g);
    expect(t1.body).toEqual({ sending: true, sent: false });
    expect((await call(p, 'GET', '/v1/family/push', undefined, g)).body.devices).toBe(0);
    expect((await call(p, 'POST', '/v1/family/push/test', {}, g)).body.error).toBe('too_soon');

    // re-subscribing revives the device; a 500 counts as a failure until the 5th
    await call(p, 'POST', '/v1/family/push/subscribe', { endpoint: 'https://fcm.googleapis.com/fcm/send/a', keys: { p256dh: k.p256dh, auth: k.authB64 } }, g);
    status = 500;
    const sql = (p as any).sql;
    for (let i = 0; i < PUSH_MAX_DEVICE_FAILS; i++) {
      sql.run("insert into push_outbox (id, family_id, kind, ref, created_at, status) values (?, 'fam-a', 'test', ?, ?, 'queued')", [`po-x${i}`, `t${i}`, Date.now()]);
      await deliverPush(sql, await (p as any).pushSender(), Date.now());
    }
    expect((await call(p, 'GET', '/v1/family/push', undefined, g)).body.devices).toBe(0);
    expect(got.length).toBeGreaterThanOrEqual(PUSH_MAX_DEVICE_FAILS + 1);

    // without devices a notice ends as no_device
    sql.run("insert into push_outbox (id, family_id, kind, ref, created_at, status) values ('po-n', 'fam-a', 'test', 'tn', ?, 'queued')", [Date.now()]);
    const r = await deliverPush(sql, await (p as any).pushSender(), Date.now());
    expect(r.no_device).toBeGreaterThanOrEqual(1);

    // refund decided → refund_done queued; a notice older than PUSH_FRESH_MS is not queued
    const now = Date.now();
    await call(p, 'POST', '/v1/admin/seats', { payer_player_id: 'kid-1', plan: 'solo', term: 'month', player_ids: ['kid-1'], amount_krw: 19900, paid_at: now - 86_400_000 });
    const seat = (await call(p, 'GET', '/v1/family/seats', undefined, g)).body.seats[0];
    const rq = await call(p, 'POST', `/v1/family/seats/${seat.id}/refund-request`, {}, g);
    // a pending request is not news yet; the operator's decision is
    expect(enqueueGuardianNotices(sql, (n) => crypto.getRandomValues(new Uint8Array(n)), now)).toBe(0);
    expect((await call(p, 'POST', `/v1/admin/seats/${seat.id}/refund`, {})).status).toBe(200);
    expect(enqueueGuardianNotices(sql, (n) => crypto.getRandomValues(new Uint8Array(n)), now)).toBe(1);
    expect(sql.get("select kind from push_outbox where ref like 'refund:%'").kind).toBe('refund_done');
    sql.run("insert into seat_notices (seat_id, kind, at) values ('old-seat', '7d', ?)", [now - PUSH_FRESH_MS - 1000]);
    expect(enqueueGuardianNotices(sql, (n) => crypto.getRandomValues(new Uint8Array(n)), now)).toBe(0);
    // stale queued items expire instead of going out late
    sql.run("insert into push_outbox (id, family_id, kind, ref, created_at, status) values ('po-old', 'fam-a', 'seat_7d', 'old', ?, 'queued')", [now - PUSH_FRESH_MS - 1]);
    expect((await deliverPush(sql, null, now)).expired).toBe(1);
    // a test press held while sending is off expires after minutes; a 2-hour-old refund notice still goes out
    sql.run("insert into push_outbox (id, family_id, kind, ref, created_at, status) values ('po-t', 'fam-a', 'test', 't-old', ?, 'queued')", [now - PUSH_TEST_FRESH_MS - 1]);
    sql.run("insert into push_outbox (id, family_id, kind, ref, created_at, status) values ('po-r', 'fam-a', 'refund_done', 'r-2h', ?, 'queued')", [now - 2 * 3600_000]);
    expect((await deliverPush(sql, null, now)).expired).toBe(1);
    expect(sql.get("select status from push_outbox where id = 'po-t'").status).toBe('expired');
    expect(sql.get("select status from push_outbox where id = 'po-r'").status).toBe('queued');
  });

  it('gates: guardian routes need a guardian session; the switch and the outbox are operator-only; unsubscribe is per family', async () => {
    pushService();
    expect(isPublicRoute('POST', '/v1/family/push/subscribe')).toBe(true);
    expect(isPublicRoute('POST', '/v1/admin/push/sending')).toBe(false);
    const p = platform();
    const g = await family(p, 'kid-1', 'fam-a');
    const other = await family(p, 'kid-2', 'fam-b');
    expect((await call(p, 'GET', '/v1/family/push', undefined, anon)).status).toBe(401);
    expect((await call(p, 'POST', '/v1/admin/push/sending', { enabled: true, by: 'x' }, g)).status).toBe(401);
    expect((await call(p, 'GET', '/v1/admin/push', undefined, anon)).status).toBe(401);
    const k = await browserKeys();
    await call(p, 'POST', '/v1/family/push/subscribe', { endpoint: 'https://fcm.googleapis.com/fcm/send/a', keys: { p256dh: k.p256dh, auth: k.authB64 } }, g);
    expect((await call(p, 'POST', '/v1/family/push/unsubscribe', { endpoint: 'https://fcm.googleapis.com/fcm/send/a' }, other)).body).toEqual({ ok: false });
    expect((await call(p, 'POST', '/v1/family/push/unsubscribe', { endpoint: 'https://fcm.googleapis.com/fcm/send/a' }, g)).body).toEqual({ ok: true });
    expect((await call(p, 'GET', '/v1/family/push', undefined, g)).body.devices).toBe(0);
  });
});
