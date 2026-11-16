import { describe, expect, it } from 'vitest';
import { ROOM_CLOSE, RoomCore, TUNING, cleanRoomName, parseRoomPose, predictPose } from '../index.js';

const join = (core: RoomCore, i: number, now = 0) => core.join({ id: `id${i}`, key: `k${i}`, name: `p${i}`, role: 'bot' }, now);

describe('multi room core (docs/03 D11 capacity, docs/02 §11)', () => {
  it('admits up to the spec capacity of 8 and refuses the 9th with a full frame', () => {
    expect(TUNING.multi.roomCapacity).toBe(8);
    const core = new RoomCore();
    for (let i = 0; i < 8; i++) expect(join(core, i).ok).toBe(true);
    const ninth = join(core, 8);
    expect(ninth.ok).toBe(false);
    if (!ninth.ok) expect(JSON.parse(ninth.frame)).toEqual({ t: 'full', cap: 8 });
    expect(core.size).toBe(8);
    expect(core.counters.full).toBe(1);
  });

  it('a second socket of the same person replaces the first even when the room is full', () => {
    const core = new RoomCore(2);
    join(core, 0);
    join(core, 1);
    const again = core.join({ id: 'new0', key: 'k0', name: 'p0', role: 'bot' }, 5);
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.replaces).toBe('id0');
    expect(core.size).toBe(2);
    expect(core.members.has('id0')).toBe(false);
    // the old socket closing later must not remove anyone
    expect(core.leave('id0')).toBeNull();
    expect(core.size).toBe(2);
  });

  it('hello lists the others with their last pose; a newcomer is announced', () => {
    const core = new RoomCore();
    join(core, 0);
    core.receive('id0', JSON.stringify({ t: 'p', p: [1.234, 2, 3, 0.5, 1] }), 10);
    const r = join(core, 1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const hello = JSON.parse(r.hello);
    expect(hello).toMatchObject({ t: 'hello', you: 'id1', cap: 8 });
    expect(hello.peers).toEqual([['id0', 'p0', 'bot', 1.23, 2, 3, 0.5, 1]]);
    expect(JSON.parse(r.joinFrame)).toEqual({ t: 'join', id: 'id1', name: 'p1', role: 'bot' });
  });

  it('poses are batched: many sends between flushes become one frame with each mover once', () => {
    const core = new RoomCore();
    join(core, 0);
    join(core, 1);
    for (let s = 0; s < 5; s++) core.receive('id0', JSON.stringify({ t: 'p', p: [s, 0, 0, 0, 1, s] }), 10 + s);
    const out = core.flush();
    expect(out).not.toBeNull();
    expect(JSON.parse(out!.frame)).toEqual({ t: 'poses', p: [['id0', 4, 0, 0, 0, 1, 4, 0, 0, 0]] });
    expect(core.flush()).toBeNull();
  });

  it('closes a socket that floods past maxMsgPerSec and drops junk without relaying it', () => {
    const core = new RoomCore();
    join(core, 0);
    let last;
    for (let i = 0; i <= TUNING.multi.maxMsgPerSec; i++) last = core.receive('id0', '{"t":"ping","c":1}', 100);
    expect(last).toEqual({ kind: 'close', code: ROOM_CLOSE.rate, reason: 'rate' });
    const core2 = new RoomCore();
    join(core2, 0);
    expect(core2.receive('id0', 'not json', 0)).toEqual({ kind: 'none' });
    expect(core2.receive('id0', JSON.stringify({ t: 'p', p: [1e9, 0, 0, 0, 0] }), 0)).toEqual({ kind: 'none' });
    expect(core2.receive('id0', JSON.stringify({ t: 'e', e: 'rude' }), 0)).toEqual({ kind: 'none' });
    expect(core2.receive('id0', 'x'.repeat(TUNING.multi.maxMsgBytes + 1), 0)).toEqual({ kind: 'none' });
    expect(core2.flush()).toBeNull();
    expect(core2.counters.dropped).toBe(4);
  });

  it('answers ping with pong and broadcasts allowed emotes', () => {
    const core = new RoomCore();
    join(core, 0);
    expect(core.receive('id0', '{"t":"ping","c":42}', 0)).toEqual({ kind: 'reply', frame: '{"t":"pong","c":42}' });
    expect(core.receive('id0', '{"t":"e","e":"wave"}', 0)).toEqual({ kind: 'broadcast', frame: '{"t":"e","id":"id0","e":"wave"}', exceptSelf: false });
  });

  it('finds members silent past silentDropMs, counting the keep-alive time', () => {
    const core = new RoomCore();
    join(core, 0, 0);
    join(core, 1, 0);
    const later = TUNING.multi.silentDropMs + 1;
    expect(core.silent(later, (id) => (id === 'id1' ? later - 10 : 0))).toEqual(['id0']);
  });

  it('pose and name validation', () => {
    expect(parseRoomPose([1, 2, 3, 0, 1])).toEqual([1, 2, 3, 0, 1, 0, 0, 0, 0]);
    // velocity and turn rate ride along; out-of-range ones are refused
    expect(parseRoomPose([1, 2, 3, 0, 1, 5, 4.567, -1, 0.5])).toEqual([1, 2, 3, 0, 1, 5, 4.57, -1, 0.5]);
    expect(parseRoomPose([1, 2, 3, 0, 1, 5, 99, 0, 0])).toBeNull();
    expect(parseRoomPose([1, 2, 3, 0, 1, 5, 1, 0, 50])).toBeNull();
    expect(parseRoomPose([1, 2, 3, 0, 1, 5, 1, 0, 0, 9])).toBeNull();
    expect(parseRoomPose([1, 2, 3, 0, 1.5])).toBeNull();
    expect(parseRoomPose([Number.NaN, 2, 3, 0, 1])).toBeNull();
    expect(parseRoomPose('1,2,3')).toBeNull();
    expect(cleanRoomName('‮abc\u0000')).toBe('abc');
    expect(cleanRoomName('')).toBe('친구');
    expect(cleanRoomName('가'.repeat(30))).toHaveLength(16);
  });
});

describe('pose prediction (predictPose, docs/02 §11.3)', () => {
  it('a straight walk moves along the velocity; a turning one follows the circle', () => {
    expect(predictPose(1, 2, 3, -1, 0, 2)).toEqual([7, 0]);
    // 4.5 m/s turning at 1.5 rad/s: a circle of radius 3 m comes back to the start after 2π/1.5 s
    const [x, z] = predictPose(0, 0, 0, 4.5, 1.5, (2 * Math.PI) / 1.5);
    expect(Math.hypot(x, z)).toBeLessThan(1e-6);
    const [hx, hz] = predictPose(0, 0, 0, 4.5, 1.5, Math.PI / 1.5);
    expect(Math.hypot(hx, hz)).toBeCloseTo(6, 6); // half way round: the diameter
  });
});
