import { describe, expect, it } from 'vitest';
import { DEVICE_NICKNAME_KEY, DEVICE_TOKEN_KEY, joinCodeFrom, resolveIdentity, type FetchLike, type KeyStore } from '../identity.js';
import { DEVICE_PLAY_BLOCKED_KEY } from '../identity.js';
import { soloPlayBlocked } from '../../App.js';
import { soloPlayerOf } from '../../App.js';

function memStore(init: Record<string, string> = {}): KeyStore & { data: Record<string, string> } {
  const data = { ...init };
  return {
    data,
    getItem: (k) => (k in data ? data[k]! : null),
    setItem: (k, v) => {
      data[k] = v;
    },
    removeItem: (k) => {
      delete data[k];
    }
  };
}

const TOKEN = 'a'.repeat(64);

function fetchReturning(status: number, body: unknown, seen: string[] = []): FetchLike {
  return async (url, init) => {
    seen.push(`${url} ${(init?.headers as Record<string, string>)?.authorization ?? ''}`);
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
}

describe('player identity (lesson code > linked device > guest)', () => {
  it('reads a six-digit join code', () => {
    expect(joinCodeFrom('?code=123456')).toBe('123456');
    expect(joinCodeFrom('?code=123 456')).toBe('123456');
    expect(joinCodeFrom('?code=12345')).toBeNull();
    expect(joinCodeFrom('')).toBeNull();
  });

  it('prefers the lesson code even when the device is linked, without calling the server', async () => {
    const seen: string[] = [];
    const id = await resolveIdentity('?code=654321', memStore({ [DEVICE_TOKEN_KEY]: TOKEN }), fetchReturning(200, {}, seen));
    expect(id).toEqual({ kind: 'lesson', code: '654321' });
    expect(seen).toHaveLength(0);
  });

  it('enters as the linked child after GET /v1/device/me with the bearer token', async () => {
    const seen: string[] = [];
    const store = memStore({ [DEVICE_TOKEN_KEY]: TOKEN });
    const id = await resolveIdentity('', store, fetchReturning(200, { nickname: 'Sora', level: 'L2', voice_store: true }, seen));
    expect(id).toEqual({ kind: 'child', token: TOKEN, nickname: 'Sora', level: 'L2', voiceStore: true, offline: false, playAllowed: true, seat: null });
    expect(seen).toEqual([`/v1/device/me Bearer ${TOKEN}`]);
    expect(store.data[DEVICE_NICKNAME_KEY]).toBe('Sora');
    expect(soloPlayerOf(id)).toEqual({ deviceToken: TOKEN, nickname: 'Sora', level: 'L2' });
  });

  it('drops a revoked or expired token (401) and plays as a guest', async () => {
    const store = memStore({ [DEVICE_TOKEN_KEY]: TOKEN });
    const id = await resolveIdentity('', store, fetchReturning(401, { error: 'device_only' }));
    expect(id).toEqual({ kind: 'guest' });
    expect(store.data[DEVICE_TOKEN_KEY]).toBeUndefined();
    expect(soloPlayerOf(id)).toBeUndefined();
  });

  it('keeps the child offline with the saved nickname when the network fails', async () => {
    const store = memStore({ [DEVICE_TOKEN_KEY]: TOKEN, [DEVICE_NICKNAME_KEY]: 'Sora' });
    const id = await resolveIdentity('', store, async () => {
      throw new TypeError('offline');
    });
    expect(id).toMatchObject({ kind: 'child', nickname: 'Sora', offline: true });
    expect(store.data[DEVICE_TOKEN_KEY]).toBe(TOKEN);
  });

  it('is a guest with no token, a malformed token, or blocked storage', async () => {
    const never: FetchLike = async () => {
      throw new Error('must not be called');
    };
    expect(await resolveIdentity('', memStore(), never)).toEqual({ kind: 'guest' });
    expect(await resolveIdentity('', memStore({ [DEVICE_TOKEN_KEY]: 'short' }), never)).toEqual({ kind: 'guest' });
    const blocked: KeyStore = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => undefined,
      removeItem: () => undefined
    };
    expect(await resolveIdentity('', blocked, never)).toEqual({ kind: 'guest' });
    expect(await resolveIdentity('', null, never)).toEqual({ kind: 'guest' });
  });

  it('falls back to L1 for an unknown level', async () => {
    const id = await resolveIdentity('', memStore({ [DEVICE_TOKEN_KEY]: TOKEN }), fetchReturning(200, { nickname: 'Mo', level: 'L9' }));
    expect(id).toMatchObject({ kind: 'child', level: 'L1' });
  });

  it('reads the seat: play_allowed=false stops solo play and is remembered for an offline start (docs/19 6장)', async () => {
    const store = memStore({ [DEVICE_TOKEN_KEY]: TOKEN });
    const id = await resolveIdentity(
      '',
      store,
      fetchReturning(200, { nickname: 'Sora', level: 'L1', voice_store: false, play_allowed: false, seat: { state: 'read_only', ends_at: 1790000000000 } })
    );
    expect(id).toMatchObject({ kind: 'child', playAllowed: false, seat: { state: 'read_only', endsAt: 1790000000000 } });
    expect(soloPlayBlocked(id)).toBe(true);
    expect(store.data[DEVICE_PLAY_BLOCKED_KEY]).toBe('1');
    const off = await resolveIdentity('', store, async () => {
      throw new TypeError('offline');
    });
    expect(off).toMatchObject({ kind: 'child', offline: true, playAllowed: false });
    // seat renewed: the next online answer clears the flag
    const back = await resolveIdentity('', store, fetchReturning(200, { nickname: 'Sora', play_allowed: true, seat: { state: 'active', ends_at: null } }));
    expect(back).toMatchObject({ playAllowed: true, seat: { state: 'active', endsAt: null } });
    expect(store.data[DEVICE_PLAY_BLOCKED_KEY]).toBeUndefined();
  });

  it('no seat yet (seat:null) and older servers without the field keep playing; lessons are never gated', async () => {
    const a = await resolveIdentity('', memStore({ [DEVICE_TOKEN_KEY]: TOKEN }), fetchReturning(200, { nickname: 'Sora', play_allowed: true, seat: null }));
    expect(soloPlayBlocked(a)).toBe(false);
    const b = await resolveIdentity('', memStore({ [DEVICE_TOKEN_KEY]: TOKEN }), fetchReturning(200, { nickname: 'Sora' }));
    expect(soloPlayBlocked(b)).toBe(false);
    const lesson = await resolveIdentity('?code=123456', memStore({ [DEVICE_TOKEN_KEY]: TOKEN, [DEVICE_PLAY_BLOCKED_KEY]: '1' }), fetchReturning(200, {}));
    expect(lesson).toEqual({ kind: 'lesson', code: '123456' });
    expect(soloPlayBlocked(lesson)).toBe(false);
  });
});
