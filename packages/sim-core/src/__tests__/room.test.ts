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
    // [id, name, role, x, y, z, yaw, anim, protocol, vx, vz, turn rate, pose age ms]
    expect(hello.peers).toEqual([['id0', 'p0', 'bot', 1.23, 2, 3, 0.5, 1, 1, 0, 0, 0, 0]]);
    expect(JSON.parse(r.joinFrame)).toEqual({ t: 'join', id: 'id1', name: 'p1', role: 'bot', v: 1 });
  });

  it('hello carries protocol, velocity, turn rate and pose age so a newcomer draws the others moving', () => {
    const core = new RoomCore();
    core.join({ id: 'a', key: 'ka', name: 'A', role: 'player', proto: 2 }, 0);
    core.receive('a', JSON.stringify({ t: 'p', p: [1, 0, 2, 0, 1, 1, 4.5, -1, 0.5] }), 1000);
    core.receive('a', JSON.stringify({ t: 'e', e: 'wave' }), 2500); // not a pose: the age keeps running
    const r = core.join({ id: 'b', key: 'kb', name: 'B', role: 'player', proto: 2 }, 3000);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(JSON.parse(r.hello).peers).toEqual([['a', 'A', 'player', 1, 0, 2, 0, 1, 2, 4.5, -1, 0.5, 2000]]);
    expect(JSON.parse(r.joinFrame)).toMatchObject({ t: 'join', id: 'b', v: 2 });
    // after hibernation the pose time comes back from the socket attachment
    const core2 = new RoomCore();
    core2.restore({ id: 'a', key: 'ka', name: 'A', role: 'player', pose: [1, 0, 2, 0, 1, 1, 4.5, -1, 0.5], proto: 2, at: 1000 }, 9000);
    const r2 = core2.join({ id: 'c', key: 'kc', name: 'C', role: 'player' }, 9500);
    if (!r2.ok) return;
    expect(JSON.parse(r2.hello).peers[0].slice(8)).toEqual([2, 4.5, -1, 0.5, 8500]);
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

describe('play fighting (R326 PvP)', () => {
  const kid = (core: RoomCore, i: number, x: number, role: 'player' | 'student' | 'teacher' = 'player') => {
    core.join({ id: `k${i}`, key: `key${i}`, name: `n${i}`, role }, 0);
    core.receive(`k${i}`, JSON.stringify({ t: 'p', p: [x, 1, 0, 0, 0] }), 1);
  };
  it('a hit within reach goes to everyone with the push direction; out of reach, too soon or at oneself does nothing', () => {
    const core = new RoomCore();
    kid(core, 1, 0);
    kid(core, 2, 2);
    kid(core, 3, 20);
    kid(core, 4, 3);
    const r = core.receive('k1', JSON.stringify({ t: 'h', to: 'k2' }), 1000);
    expect(r).toEqual({ kind: 'broadcast', frame: JSON.stringify({ t: 'h', from: 'k1', to: 'k2', d: [1, 0] }), exceptSelf: false });
    // the cooldown
    expect(core.receive('k1', JSON.stringify({ t: 'h', to: 'k2' }), 1000 + TUNING.multi.hitCooldownMs - 1)).toEqual({ kind: 'none' });
    // one child takes at most one hit per hitTakenGapMs, however many hit (k4 stands as near as k1)
    expect(core.receive('k4', JSON.stringify({ t: 'h', to: 'k2' }), 1000 + TUNING.multi.hitTakenGapMs - 1)).toEqual({ kind: 'none' });
    const gap = Math.max(TUNING.multi.hitCooldownMs, TUNING.multi.hitTakenGapMs);
    expect(core.receive('k1', JSON.stringify({ t: 'h', to: 'k2' }), 1000 + gap).kind).toBe('broadcast');
    expect(core.receive('k4', JSON.stringify({ t: 'h', to: 'k2' }), 1000 + 2 * gap).kind).toBe('broadcast');
    // too far
    expect(core.receive('k2', JSON.stringify({ t: 'h', to: 'k3' }), 5000)).toEqual({ kind: 'none' });
    // nobody / oneself is junk
    expect(core.receive('k1', JSON.stringify({ t: 'h', to: 'k1' }), 9000)).toEqual({ kind: 'none' });
    expect(core.receive('k1', JSON.stringify({ t: 'h', to: 'nobody' }), 9000)).toEqual({ kind: 'none' });
    expect(core.counters.dropped).toBe(2);
  });
  it('R2861①: the teacher plays too: a student hits the teacher and the teacher hits a student', () => {
    const core = new RoomCore();
    kid(core, 1, 0, 'student');
    kid(core, 9, 2, 'teacher');
    expect(core.receive('k1', JSON.stringify({ t: 'h', to: 'k9' }), 1000)).toEqual({ kind: 'broadcast', frame: JSON.stringify({ t: 'h', from: 'k1', to: 'k9', d: [1, 0] }), exceptSelf: false });
    const gap = Math.max(TUNING.multi.hitCooldownMs, TUNING.multi.hitTakenGapMs);
    expect(core.receive('k9', JSON.stringify({ t: 'h', to: 'k1' }), 1000 + gap)).toEqual({ kind: 'broadcast', frame: JSON.stringify({ t: 'h', from: 'k9', to: 'k1', d: [-1, 0] }), exceptSelf: false });
  });
  it("only the teacher turns it off and on; when off no hit goes through (nor the teacher's); hello says the state", () => {
    const core = new RoomCore();
    kid(core, 1, 0, 'student');
    kid(core, 2, 1, 'student');
    kid(core, 9, 2, 'teacher');
    expect(core.receive('k1', JSON.stringify({ t: 'pvp', on: false }), 10)).toEqual({ kind: 'none' });
    expect(core.pvp).toBe(true);
    expect(core.receive('k9', JSON.stringify({ t: 'pvp', on: false }), 30)).toEqual({ kind: 'broadcast', frame: '{"t":"pvp","on":false}', exceptSelf: false });
    expect(core.receive('k1', JSON.stringify({ t: 'h', to: 'k2' }), 40)).toEqual({ kind: 'none' });
    expect(core.receive('k9', JSON.stringify({ t: 'h', to: 'k2' }), 45)).toEqual({ kind: 'none' });
    const late = core.join({ id: 'k5', key: 'key5', name: 'n5', role: 'student' }, 50);
    expect(late.ok && JSON.parse(late.hello).pvp).toBe(false);
    core.receive('k9', JSON.stringify({ t: 'pvp', on: true }), 60);
    expect(core.receive('k1', JSON.stringify({ t: 'h', to: 'k2' }), 70).kind).toBe('broadcast');
  });
});
