import { describe, expect, it } from 'vitest';
import { GUEST_PASS_HEADER } from '@lcw/schemas';
import { startFlowFor } from '../App.js';
import type { FetchLike, KeyStore } from '../start/api.js';
import {
  PASS_DEVICE_KEY,
  installPassHeader,
  isOwnApi,
  mmss,
  passDevice,
  passFromSearch,
  passLeftMs,
  passStatus,
  readPassSession,
  redeemPass,
  savePassSession
} from '../start/guestPass.js';

function memStore(): KeyStore & { m: Map<string, string> } {
  const m = new Map<string, string>();
  return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const answer = (status: number, body: unknown): FetchLike => async () => json(status, body);

describe('guest pass in the world (docs/19 §8)', () => {
  it('reads ?pass= as the 8-character code and skips the title for it', () => {
    expect(passFromSearch('?pass=abcd-efgh')).toBe('ABCDEFGH');
    expect(passFromSearch('?pass=ABCD EFGH&x=1')).toBe('ABCDEFGH');
    expect(passFromSearch('?pass=ABC0-EFGH')).toBeNull(); // 0 is not in the code alphabet
    expect(passFromSearch('?code=123456')).toBeNull();
    expect(startFlowFor('?pass=ABCD-EFGH', false)).toBe(false);
  });

  it('keeps one random device id (the /try one) and the tab session for this code only', () => {
    const store = memStore();
    const a = passDevice(store, () => new Uint8Array(16).fill(7));
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(passDevice(store, () => new Uint8Array(16).fill(9))).toBe(a);
    expect(store.m.get(PASS_DEVICE_KEY)).toBe(a);
    const s = { code: 'ABCDEFGH', token: 't', worldId: 'home-p', hostNickname: '지*', endsAt: 1000, skewMs: 0 };
    savePassSession(store, s);
    expect(readPassSession(store, 'ABCDEFGH')).toEqual(s);
    expect(readPassSession(store, 'ZZZZZZZZ')).toBeNull();
    savePassSession(store, null);
    expect(readPassSession(store, 'ABCDEFGH')).toBeNull();
  });

  it('redeem: a session on the server clock; ended codes go to the end screen, a second device is refused', async () => {
    let sent: RequestInit | undefined;
    const ok: FetchLike = async (_u, init) => {
      sent = init;
      return json(201, { token: 'tok', world_id: 'home-p1', host_nickname: '지*', started_at: 100, ends_at: 100 + 1_800_000, server_now: 100 });
    };
    const r = await redeemPass('ABCDEFGH', 'd'.repeat(32), ok, () => 40);
    expect(r).toEqual({ ok: true, session: { code: 'ABCDEFGH', token: 'tok', worldId: 'home-p1', hostNickname: '지*', endsAt: 1_800_100, skewMs: 60 } });
    expect(JSON.parse(String(sent?.body))).toEqual({ code: 'ABCDEFGH', device: 'd'.repeat(32) });
    for (const e of ['pass_ended', 'pass_expired', 'pass_revoked', 'seat_inactive']) expect(await redeemPass('ABCDEFGH', 'd', answer(410, { error: e }))).toEqual({ ok: false, why: 'ended' });
    expect(await redeemPass('ABCDEFGH', 'd', answer(409, { error: 'pass_in_use' }))).toEqual({ ok: false, why: 'in_use' });
    expect(await redeemPass('ABCDEFGH', 'd', answer(404, { error: 'pass_not_found' }))).toEqual({ ok: false, why: 'not_found' });
    expect(await redeemPass('ABCDEFGH', 'd', answer(429, { error: 'too_many_requests' }))).toEqual({ ok: false, why: 'retry' });
    expect(await redeemPass('ABCDEFGH', 'd', async () => Promise.reject(new Error('offline')))).toEqual({ ok: false, why: 'retry' });
  });

  it('status: sends the pass header; ended or a gone session ends it; offline keeps the local countdown', async () => {
    let headers: HeadersInit | undefined;
    const active: FetchLike = async (_u, init) => {
      headers = init?.headers;
      return json(200, { state: 'active', world_id: 'home-p1', started_at: 0, ends_at: 5000, remaining_ms: 4000, server_now: 1000 });
    };
    expect(await passStatus('tok', active, () => 900)).toEqual({ endsAt: 5000, skewMs: 100 });
    expect(headers).toMatchObject({ [GUEST_PASS_HEADER]: 'tok' });
    expect(await passStatus('tok', answer(200, { state: 'ended', world_id: 'w', started_at: 0, ends_at: 5, remaining_ms: 0, server_now: 9 }))).toBe('ended');
    expect(await passStatus('tok', answer(404, { error: 'pass_not_found' }))).toBe('ended');
    expect(await passStatus('tok', answer(500, {}))).toBeNull();
    expect(await passStatus('tok', async () => Promise.reject(new Error('offline')))).toBeNull();
  });

  it('counts down on the server clock and shows m:ss', () => {
    expect(passLeftMs({ endsAt: 10_000, skewMs: 500 }, 4_000)).toBe(5_500);
    expect(passLeftMs({ endsAt: 10_000, skewMs: 0 }, 20_000)).toBe(0);
    expect(mmss(1_781_000)).toBe('29:41');
    expect(mmss(0)).toBe('0:00');
    expect(mmss(-5)).toBe('0:00');
  });

  it('puts the pass header on our own API requests only, and the undo restores fetch', async () => {
    const seen: Array<{ url: string; pass: string | null }> = [];
    const target = {
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        seen.push({ url, pass: new Headers(init?.headers).get(GUEST_PASS_HEADER) });
        return new Response('{}');
      }) as typeof fetch
    };
    const original = target.fetch;
    const undo = installPassHeader('tok', target, 'https://lcw.example');
    await target.fetch('/v1/plot', { headers: { a: 'b' } });
    await target.fetch('https://lcw.example/v1/dialog');
    await target.fetch('/world/assets/x.js');
    await target.fetch('https://other.example/v1/x');
    expect(seen.map((s) => s.pass)).toEqual(['tok', 'tok', null, null]);
    undo();
    expect(target.fetch).toBe(original);
    expect(isOwnApi('/v1/x', 'https://lcw.example')).toBe(true);
    expect(isOwnApi('https://evil.example/v1/x', 'https://lcw.example')).toBe(false);
  });
});
