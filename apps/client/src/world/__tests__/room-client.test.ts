import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TUNING } from '@lcw/sim-core';
import { RoomClient, type RoomSink } from '../room-client.js';
import { peerLook } from '../peers.js';

class FakeSocket {
  readyState = 1;
  sent: string[] = [];
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  constructor(readonly url: string) {}
  send(d: string) {
    this.sent.push(d);
  }
  close() {
    this.readyState = 3;
  }
  frame(f: unknown) {
    this.onmessage?.({ data: JSON.stringify(f) });
  }
  poses() {
    return this.sent.filter((s) => s.startsWith('{"t":"p"')).map((s) => JSON.parse(s).p);
  }
}

function sinkLog() {
  const log: string[] = [];
  const sink: RoomSink = {
    hello: (you, peers) => log.push(`hello ${you} ${peers.map((p) => p.id).join(',')}`),
    join: (id) => log.push(`join ${id}`),
    leave: (id) => log.push(`leave ${id}`),
    pose: (id, x) => log.push(`pose ${id} ${x}`),
    emote: (id, e) => log.push(`emote ${id} ${e}`),
    full: (cap) => log.push(`full ${cap}`),
    reset: () => log.push('reset')
  };
  return { log, sink };
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup(status = 200, pose: [number, number, number, number, number] = [1, 2, 3, 0, 1]) {
  const sockets: FakeSocket[] = [];
  const { log, sink } = sinkLog();
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ticket: 't'.repeat(48), room: 'family-f', connect: '/v1/room/connect' }), { status }));
  let p = pose;
  const client = new RoomClient({
    token: () => 'k'.repeat(40),
    source: { pose: () => p },
    sink,
    base: 'https://lcw.test',
    fetchImpl: fetchImpl as unknown as typeof fetch,
    socket: (url) => {
      const s = new FakeSocket(url);
      sockets.push(s);
      return s;
    },
    now: () => Date.now()
  });
  return { client, sockets, log, fetchImpl, move: (np: typeof pose) => (p = np) };
}

describe('room client (docs/03 D11, docs/02 §11 request budget)', () => {
  it('asks for a ticket with the token and opens the socket on the same host', async () => {
    const { client, sockets, fetchImpl } = setup();
    client.start();
    await flush();
    expect(fetchImpl).toHaveBeenCalledWith('https://lcw.test/v1/room/ticket', expect.objectContaining({ method: 'POST' }));
    expect(sockets[0]!.url).toBe(`wss://lcw.test/v1/room/connect?t=${'t'.repeat(48)}`);
    client.stop();
  });

  it('alone in the room it sends no poses, only the keep-alive ping', async () => {
    const { client, sockets } = setup();
    client.start();
    await flush();
    sockets[0]!.frame({ t: 'hello', you: 'me', cap: 8, peers: [] });
    vi.advanceTimersByTime(TUNING.multi.idleKeepaliveMs + 200);
    expect(sockets[0]!.poses()).toHaveLength(0);
    expect(sockets[0]!.sent).toContain('ping');
    client.stop();
  });

  it('with someone else it sends moving poses at most poseHz a second, and greets a newcomer with one pose', async () => {
    const { client, sockets, move } = setup();
    client.start();
    await flush();
    const s = sockets[0]!;
    s.frame({ t: 'hello', you: 'me', cap: 8, peers: [['p1', 'Mina', 'player', 0, 0, 0, 0, 0]] });
    expect(s.poses()).toHaveLength(1);
    // walk for one second, a new position every tick
    for (let i = 1; i <= TUNING.multi.poseTickHz; i++) {
      move([1 + i, 2, 3, 0, 1]);
      vi.advanceTimersByTime(1000 / TUNING.multi.poseTickHz);
    }
    const n = s.poses().length - 1;
    expect(n).toBeLessThanOrEqual(TUNING.multi.poseHz + 1);
    expect(n).toBeGreaterThanOrEqual(TUNING.multi.poseHz - 1);
    // standing still: nothing more
    const before = s.poses().length;
    vi.advanceTimersByTime(1000);
    expect(s.poses().length).toBe(before);
    // a newcomer gets my pose at once
    s.frame({ t: 'join', id: 'p2', name: 'Juno', role: 'player' });
    vi.advanceTimersByTime(1000 / TUNING.multi.poseTickHz);
    expect(s.poses().length).toBe(before + 1);
    client.stop();
  });

  it('a full room says so once, closes, and tries again a minute later', async () => {
    const { client, sockets, log } = setup();
    client.start();
    await flush();
    sockets[0]!.frame({ t: 'full', cap: 8 });
    sockets[0]!.onclose?.({ code: 4003 });
    expect(log).toContain('full 8');
    expect(client.status).toBe('full');
    vi.advanceTimersByTime(59_000);
    await flush();
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1_500);
    await flush();
    expect(sockets).toHaveLength(2);
    client.stop();
  });

  it('no room for this token (401) stops quietly without retrying', async () => {
    const { client, sockets, fetchImpl } = setup(401);
    client.start();
    await flush();
    vi.advanceTimersByTime(120_000);
    await flush();
    expect(sockets).toHaveLength(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(client.status).toBe('none');
  });

  it('relays peers to the world and clears them when the socket drops', async () => {
    const { client, sockets, log } = setup();
    client.start();
    await flush();
    const s = sockets[0]!;
    s.frame({ t: 'hello', you: 'me', cap: 8, peers: [['p1', 'Mina', 'player', 1, 2, 3, 0, 0]] });
    s.frame({ t: 'poses', p: [['p1', 4, 2, 3, 0, 1, 9]] });
    s.frame({ t: 'e', id: 'p1', e: 'wave' });
    s.onclose?.({ code: 1006 });
    expect(log).toEqual(['hello me p1', 'pose p1 4', 'emote p1 wave', 'reset']);
    client.stop();
  });

  it('the same id gets the same look on every screen', () => {
    const base = { skin: 1, hair: 2, shirt: 3, pants: 4, shoes: 5, hairStyle: 'short' as const };
    expect(peerLook('ab12cd', base, [10, 20, 30])).toEqual(peerLook('ab12cd', base, [10, 20, 30]));
    expect([10, 20, 30]).toContain(peerLook('zz', base, [10, 20, 30]).shirt);
  });
});
