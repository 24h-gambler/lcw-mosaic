import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROOM_CLOSE, TUNING } from '@lcw/sim-core';
import { GUEST_PASS_HEADER } from '@lcw/schemas';
import { PlatformDO, isPublicRoute, type LcwEnv } from '../platform.js';
import { ROOM_HEADERS, WorldRoomDO, routeRoomConnect } from '../room.js';
import { fakeDurableStorage } from './fake-do.js';

const TOKEN = 'op-token-0123456789abcdef';
const op = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
const anon = { 'content-type': 'application/json' };

function platform() {
  return new PlatformDO({ storage: fakeDurableStorage() }, { PLATFORM: undefined as never, LCW_OPERATOR_TOKEN: TOKEN } as LcwEnv);
}
async function call(p: PlatformDO, method: string, path: string, body?: unknown, headers: Record<string, string> = op) {
  const res = await p.fetch(new Request(`https://x${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
  return { status: res.status, body: (await res.json()) as any };
}
const redeem = (p: PlatformDO, ticket: string) =>
  p.fetch(
    new Request('https://platform/internal/room-ticket', {
      method: 'POST',
      headers: { 'x-lcw-internal': 'room', 'content-type': 'application/json' },
      body: JSON.stringify({ ticket })
    })
  );

describe('room tickets (room.ts, docs/02 §11)', () => {
  it('is a public route that checks its own tokens: nobody without a token gets a seat', async () => {
    expect(isPublicRoute('POST', '/v1/room/ticket')).toBe(true);
    const p = platform();
    for (const h of [anon, { ...anon, authorization: `Bearer ${'x'.repeat(40)}` }]) {
      const r = await call(p, 'POST', '/v1/room/ticket', {}, h);
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ room: null, reason: 'no_room' });
    }
  });

  it('a lesson student sits in their lesson room under their nickname; the body cannot move them', async () => {
    const p = platform();
    await call(p, 'POST', '/v1/admin/players', { family_id: 'fam-kim', guardian_id: 'g-kim', player_id: 'kid-1', nickname: 'Juno', birth_year: 2016, level: 'L1' });
    const s = await call(p, 'POST', '/v1/admin/lessons/start', { player_id: 'kid-1' });
    const j = await call(p, 'POST', '/v1/join', { code: s.body.join_code }, anon);
    const st = { authorization: `Bearer ${j.body.student_token}`, 'content-type': 'application/json' };
    const t = await call(p, 'POST', '/v1/room/ticket', { room: 'smoke-x' }, st);
    expect(t.status).toBe(200);
    expect(t.body).toMatchObject({ room: `lesson-${s.body.lesson_id}`, cap: 8, connect: '/v1/room/connect' });
    const seat = await redeem(p, t.body.ticket);
    expect(seat.status).toBe(200);
    expect(await seat.json()).toEqual({ room: `lesson-${s.body.lesson_id}`, key: 'kid-1', name: 'Juno', role: 'student' });
    // one use
    expect((await redeem(p, t.body.ticket)).status).toBe(403);
  });

  /** a linked child (guardian consent, device code, link) with or without a seat; returns the device bearer + guardian */
  async function linked(p: PlatformDO, kid: string, fam: string, nickname: string, seat = true) {
    await call(p, 'POST', '/v1/admin/players', { family_id: fam, guardian_id: `g-${fam}`, player_id: kid, nickname, birth_year: 2016, level: 'L1' });
    const inv = await call(p, 'POST', '/v1/admin/family-invites', { player_id: kid });
    const sess = await call(p, 'POST', '/v1/family/session', { invite: inv.body.invite_path.split('#k=')[1] }, anon);
    const g = { authorization: `Bearer ${sess.body.guardian_token}`, 'content-type': 'application/json' };
    await call(p, 'POST', '/v1/family/service-consent', { granted: true }, g);
    let sid = '';
    if (seat) sid = (await call(p, 'POST', '/v1/admin/seats', { payer_guardian_id: `g-${fam}`, plan: 'solo', term: 'month', player_ids: [kid] })).body.seat_ids[0];
    const code = await call(p, 'POST', `/v1/family/children/${kid}/device-code`, {}, g);
    const link = await call(p, 'POST', '/v1/device/link', { code: code.body.code, label: 't' }, anon);
    return { dev: { authorization: `Bearer ${link.body.device_token}`, 'content-type': 'application/json' }, g, sid };
  }

  it('two children on one Duo seat from two families meet in the payer family room (R325: each sat alone)', async () => {
    const p = platform();
    const a = await linked(p, 'kid-a', 'fam-a', 'Oreo', false);
    const b = await linked(p, 'kid-b', 'fam-b', 'Mint', false);
    const sib = await linked(p, 'kid-c', 'fam-a', 'Sib');
    const duo = await call(p, 'POST', '/v1/admin/seats', { payer_guardian_id: 'g-fam-a', plan: 'duo', term: 'month', player_ids: ['kid-a', 'kid-b'] });
    expect(duo.status).toBe(201);
    const ta = await call(p, 'POST', '/v1/room/ticket', {}, a.dev);
    const tb = await call(p, 'POST', '/v1/room/ticket', {}, b.dev);
    const tc = await call(p, 'POST', '/v1/room/ticket', {}, sib.dev);
    expect(ta.body.room).toBe('family-fam-a');
    expect(tb.body.room).toBe('family-fam-a');
    // the payer's other child keeps meeting their sibling
    expect(tc.body.room).toBe('family-fam-a');
    expect(await (await redeem(p, tb.body.ticket)).json()).toEqual({ room: 'family-fam-a', key: 'kid-b', name: 'Mint', role: 'player' });
    // a solo seat elsewhere: their own family room as before
    const solo = await linked(p, 'kid-d', 'fam-d', 'Solo');
    expect((await call(p, 'POST', '/v1/room/ticket', {}, solo.dev)).body.room).toBe('family-fam-d');
  });

  it('a friend on a running guest pass sits in the host child room; an ended pass has no room (R325)', async () => {
    const p = platform();
    const host = await linked(p, 'kid-host', 'fam-host', 'Juno');
    const code: string = (await call(p, 'POST', `/v1/family/seats/${host.sid}/guest-passes`, {}, host.g)).body.pass.code;
    const r = await call(p, 'POST', '/v1/guest-pass/redeem', { code, device: 'device-aaaaaaaaaaaaaaaa' }, anon);
    expect(r.status).toBe(201);
    const pass = { [GUEST_PASS_HEADER]: r.body.token, 'content-type': 'application/json' };
    const t = await call(p, 'POST', '/v1/room/ticket', {}, pass);
    expect(t.body.room).toBe('family-fam-host');
    const seat = (await (await redeem(p, t.body.ticket)).json()) as { key: string; name: string; role: string };
    expect(seat).toMatchObject({ room: 'family-fam-host', name: '', role: 'player' });
    expect(seat.key.startsWith('pass:')).toBe(true);
    // the host is in the same room
    expect((await call(p, 'POST', '/v1/room/ticket', {}, host.dev)).body.room).toBe('family-fam-host');
    // a pass that is not running seats nobody
    expect((await call(p, 'POST', '/v1/room/ticket', {}, { [GUEST_PASS_HEADER]: 'x'.repeat(40), 'content-type': 'application/json' })).body.room).toBeNull();
  });

  it('the operator names a room; smoke- rooms seat load bots under their own keys', async () => {
    const p = platform();
    expect((await call(p, 'POST', '/v1/room/ticket', { room: 'anything' })).body).toMatchObject({ room: null });
    const a = await call(p, 'POST', '/v1/room/ticket', { room: 'smoke-cap', name: 'bot-1', key: 'b1' });
    expect(await (await redeem(p, a.body.ticket)).json()).toEqual({ room: 'smoke-cap', key: 'op:b1', name: 'bot-1', role: 'bot' });
    const b = await call(p, 'POST', '/v1/room/ticket', { room: 'lesson-abc' });
    expect(await (await redeem(p, b.body.ticket)).json()).toEqual({ room: 'lesson-abc', key: 'operator', name: '선생님', role: 'teacher' });
  });

  it('expired tickets do not open a room; the internal route refuses outside callers', async () => {
    const p = platform();
    const now = Date.now();
    const spy = vi.spyOn(Date, 'now').mockReturnValue(now);
    const a = await call(p, 'POST', '/v1/room/ticket', { room: 'smoke-x', key: 'b' });
    spy.mockReturnValue(now + TUNING.multi.ticketTtlMs + 1);
    expect((await redeem(p, a.body.ticket)).status).toBe(403);
    spy.mockRestore();
    const res = await p.fetch(new Request('https://x/internal/room-ticket', { method: 'POST', headers: anon, body: '{"ticket":"x"}' }));
    expect(res.status).toBe(403);
  });
});

// ---- WorldRoomDO with a fake hibernation state

class FakeWs {
  sent: string[] = [];
  closed: { code: number; reason: string } | null = null;
  att: unknown = null;
  tags: string[] = [];
  peer: FakeWs | null = null;
  send(d: string) {
    if (this.closed) throw new Error('closed');
    this.sent.push(d);
  }
  close(code: number, reason: string) {
    this.closed = { code, reason };
  }
  serializeAttachment(v: unknown) {
    this.att = structuredClone(v);
  }
  deserializeAttachment() {
    return this.att;
  }
  frames() {
    return this.sent.map((s) => JSON.parse(s));
  }
}
class FakeState {
  sockets: FakeWs[] = [];
  acceptWebSocket(ws: FakeWs, tags: string[] = []) {
    ws.tags = tags;
    this.sockets.push(ws);
  }
  getWebSockets(tag?: string) {
    return this.sockets.filter((w) => !w.closed && (!tag || w.tags.includes(tag)));
  }
}

let lastServer: FakeWs | null = null;
beforeEach(() => {
  (globalThis as any).WebSocketPair = class {
    0: FakeWs;
    1: FakeWs;
    constructor() {
      this[0] = new FakeWs();
      this[1] = new FakeWs();
      lastServer = this[1];
    }
  };
  vi.useFakeTimers();
});
afterEach(() => {
  delete (globalThis as any).WebSocketPair;
  vi.useRealTimers();
});

// Node's Response refuses status 101; the room only needs the socket to be accepted.
async function connect(room: WorldRoomDO, key: string, name = key, proto = '2') {
  const headers = new Headers({ upgrade: 'websocket', [ROOM_HEADERS.key]: key, [ROOM_HEADERS.name]: encodeURIComponent(name), [ROOM_HEADERS.role]: 'bot', [ROOM_HEADERS.proto]: proto });
  await room.fetch(new Request('https://room/r', { headers })).catch(() => undefined);
  return lastServer!;
}

describe('WorldRoomDO (WebSocket relay, capacity)', () => {
  it('9th socket gets {"t":"full"} and close 4003; the 8 inside keep relaying', async () => {
    const state = new FakeState();
    const room = new WorldRoomDO(state as never, {});
    const socks: FakeWs[] = [];
    for (let i = 0; i < 8; i++) socks.push(await connect(room, `b${i}`));
    expect(socks[0]!.frames()[0]).toMatchObject({ t: 'hello', cap: 8, peers: [] });
    expect(socks[7]!.frames()[0].peers).toHaveLength(7);
    expect(socks[7]!.frames()[0].peers[0][8]).toBe(2); // each entry says which protocol that person's page speaks
    const ninth = await connect(room, 'b8');
    expect(ninth.frames()).toEqual([{ t: 'full', cap: 8 }]);
    expect(ninth.closed).toEqual({ code: ROOM_CLOSE.full, reason: 'room_full' });
    // the refused socket's words reach nobody
    room.webSocketMessage(ninth as never, '{"t":"e","e":"wave"}');
    expect(socks[0]!.frames().some((f) => f.t === 'e')).toBe(false);
    expect(room.stats()).toMatchObject({ members: 8, cap: 8, full: 1 });

    // the first pose after a quiet spell goes out at once; the next ones inside the window ride one batch
    const me = socks[0]!.frames()[0].you;
    socks[1]!.sent = [];
    room.webSocketMessage(socks[0] as never, JSON.stringify({ t: 'p', p: [1, 2, 3, 0, 1, 7] }));
    expect(socks[1]!.frames()).toEqual([{ t: 'poses', p: [[me, 1, 2, 3, 0, 1, 7, 0, 0, 0]] }]);
    room.webSocketMessage(socks[0] as never, JSON.stringify({ t: 'p', p: [2, 2, 3, 0, 1, 8] }));
    room.webSocketMessage(socks[0] as never, JSON.stringify({ t: 'p', p: [3, 2, 3, 0, 1, 9] }));
    expect(socks[1]!.sent).toHaveLength(1);
    vi.advanceTimersByTime(TUNING.multi.broadcastMs);
    expect(socks[1]!.frames()[1]).toEqual({ t: 'poses', p: [[me, 3, 2, 3, 0, 1, 9, 0, 0, 0]] });
    expect(socks[1]!.sent).toHaveLength(2);

    // someone leaves → a seat opens for the next one
    room.webSocketClose(socks[2] as never, 1000, '', true);
    expect((await connect(room, 'b9')).frames()[0].t).toBe('hello');
  });

  it('a refresh by the same person replaces the old socket instead of filling a seat', async () => {
    const state = new FakeState();
    const room = new WorldRoomDO(state as never, {});
    const a = await connect(room, 'kid');
    const other = await connect(room, 'kid2');
    const a2 = await connect(room, 'kid');
    expect(a.closed).toEqual({ code: ROOM_CLOSE.replaced, reason: 'replaced' });
    room.webSocketClose(a as never, ROOM_CLOSE.replaced, 'replaced', true);
    expect(room.stats()).toMatchObject({ members: 2 });
    const kinds = other.frames().map((f) => f.t);
    expect(kinds.filter((k) => k === 'leave')).toHaveLength(1);
    expect(a2.frames()[0].peers).toHaveLength(1);
  });

  it('hibernation wake rebuilds the members from socket attachments', async () => {
    const state = new FakeState();
    const room = new WorldRoomDO(state as never, {});
    await connect(room, 'x');
    await connect(room, 'y');
    const woke = new WorldRoomDO(state as never, {});
    expect(woke.stats()).toMatchObject({ members: 2 });
  });

  it('a flooding socket is closed with 4008', async () => {
    const state = new FakeState();
    const room = new WorldRoomDO(state as never, {});
    const a = await connect(room, 'flood');
    for (let i = 0; i <= TUNING.multi.maxMsgPerSec; i++) room.webSocketMessage(a as never, '{"t":"ping","c":1}');
    expect(a.closed?.code).toBe(ROOM_CLOSE.rate);
    expect(room.stats()).toMatchObject({ members: 0 });
  });
});

describe('routeRoomConnect (Worker)', () => {
  it('drops client-sent seat headers and forwards the redeemed seat to the named room', async () => {
    const seen: { name?: string; headers?: Headers } = {};
    const platformStub = { fetch: async () => Response.json({ room: 'lesson-1', key: 'kid-1', name: 'Juno', role: 'student' }) };
    const rooms = {
      idFromName: (n: string) => n,
      get: (id: unknown) => ({
        fetch: async (req: Request | string) => {
          seen.name = String(id);
          seen.headers = (req as Request).headers;
          return new Response('ok');
        }
      })
    };
    const req = new Request('https://lcw/v1/room/connect?t=abc', { headers: { upgrade: 'websocket', [ROOM_HEADERS.role]: 'teacher', 'x-lcw-room-key': 'evil' } });
    await routeRoomConnect(req, platformStub, rooms);
    expect(seen.name).toBe('lesson-1');
    expect(seen.headers!.get(ROOM_HEADERS.role)).toBe('student');
    expect(seen.headers!.get(ROOM_HEADERS.key)).toBe('kid-1');
    // a page from before the pose budget asks for no protocol: the room keeps the old steady rate for it
    expect(seen.headers!.get(ROOM_HEADERS.proto)).toBe('1');
    await routeRoomConnect(new Request('https://lcw/v1/room/connect?t=abc&v=2', { headers: { upgrade: 'websocket', [ROOM_HEADERS.proto]: '7' } }), platformStub, rooms);
    expect(seen.headers!.get(ROOM_HEADERS.proto)).toBe('2');
    const bad = await routeRoomConnect(req, { fetch: async () => new Response('{}', { status: 403 }) }, rooms);
    expect(bad.status).toBe(403);
    expect((await routeRoomConnect(new Request('https://lcw/v1/room/connect'), platformStub, rooms)).status).toBe(426);
    expect((await routeRoomConnect(req, platformStub, undefined)).status).toBe(503);
  });
});

describe('WorldRoomDO play-fighting switch (R326)', () => {
  class KvState extends FakeState {
    kv = new Map<string, unknown>();
    storage = {
      get: async (k: string) => this.kv.get(k),
      put: async (k: string, v: unknown) => void this.kv.set(k, v),
    };
  }
  const join = async (room: WorldRoomDO, key: string, role: string) => {
    const headers = new Headers({ upgrade: 'websocket', [ROOM_HEADERS.key]: key, [ROOM_HEADERS.name]: key, [ROOM_HEADERS.role]: role, [ROOM_HEADERS.proto]: '2' });
    await room.fetch(new Request('https://room/r', { headers })).catch(() => undefined);
    return lastServer!;
  };
  it('the teacher turns it off; a wake from hibernation and a room that emptied both still say off', async () => {
    const state = new KvState();
    const room = new WorldRoomDO(state as never, {});
    const t = await join(room, 'teach', 'teacher');
    await join(room, 'kid1', 'student');
    room.webSocketMessage(t as never, JSON.stringify({ t: 'pvp', on: false }));
    await Promise.resolve();
    expect(state.kv.get('pvpOff')).toBe(true);
    // hibernation: a new object over the same sockets
    const woke = new WorldRoomDO(state as never, {});
    expect((await join(woke, 'kid2', 'student')).frames()[0]).toMatchObject({ t: 'hello', pvp: false });
    // everyone left, a new day: a fresh object, no sockets, only the storage
    const empty = new KvState();
    empty.kv = state.kv;
    const fresh = new WorldRoomDO(empty as never, {});
    expect((await join(fresh, 'kid3', 'student')).frames()[0]).toMatchObject({ t: 'hello', pvp: false });
    // on again
    const t2 = await join(fresh, 'teach', 'teacher');
    fresh.webSocketMessage(t2 as never, JSON.stringify({ t: 'pvp', on: true }));
    await Promise.resolve();
    expect(state.kv.get('pvpOff')).toBe(false);
  });
});
