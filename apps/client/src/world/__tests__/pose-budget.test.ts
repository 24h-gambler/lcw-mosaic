// Pose request budget vs smoothness (docs/02 §11.3, operator 11-16: "8명이 2시간 걸어도 하루 10만 요청 안",
// "받는 쪽의 보간(부드러움)과 p95 지연이 지금보다 나빠지지 않는지"). The real sender (RoomClient) walks synthetic
// paths; its poses cross a simulated network and server batch to the real receiver motion (PeerMotion), drawn at
// 60 fps. The error of the drawn figure against where the sender really is, and the messages per second, are compared
// with the previous scheme (5 Hz while moving, ease toward the last pose with a 150 ms time constant).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TUNING } from '@lcw/sim-core';
import { RoomClient, type RoomSink } from '../room-client.js';
import { PeerMotion } from '../peer-motion.js';

type Pose = [number, number, number, number, number];

/** Deterministic random numbers (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SPEED = TUNING.world.walkSpeedMps;

/** A child walking: a path as a function of time (ms) → pose. Integrated at 1 ms steps on demand. */
function walker(kind: 'wander' | 'circle' | 'straight', seed: number) {
  const r = rng(seed);
  let t = 0;
  let x = 0;
  let z = 0;
  let yaw = 0;
  let turnRate = 0;
  let moving = true;
  let segEnd = 0;
  const newSegment = () => {
    if (kind === 'circle') {
      turnRate = SPEED / 3; // radius 3 m: turning all the time (worst case)
      moving = true;
      segEnd = t + 1e9;
      return;
    }
    if (kind === 'straight') {
      yaw = r() * Math.PI * 2;
      turnRate = 0;
      moving = r() > 0.1;
      segEnd = t + 4000 + r() * 6000;
      return;
    }
    // wander: walk 1.5-5 s with a gentle or no curve, sometimes stop 1-3 s, sometimes a sharp turn
    moving = r() > 0.2;
    if (r() < 0.5) yaw += (r() - 0.5) * Math.PI * 1.5;
    turnRate = r() < 0.4 ? (r() - 0.5) * 1.6 : 0;
    segEnd = t + (moving ? 1500 + r() * 3500 : 1000 + r() * 2000);
    // stay within 20 m of the meeting point (the near case): head back when too far
    if (Math.hypot(x, z) > 18) yaw = Math.atan2(-x, -z) + (r() - 0.5) * 0.5;
  };
  newSegment();
  return (to: number): Pose => {
    while (t < to) {
      if (t >= segEnd) newSegment();
      t += 1;
      if (moving) {
        yaw += turnRate / 1000;
        x += (Math.sin(yaw) * SPEED) / 1000;
        z += (Math.cos(yaw) * SPEED) / 1000;
      }
    }
    return [x, 1, z, yaw, moving ? 1 : 0];
  };
}

class FakeSocket {
  readyState = 1;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  constructor(private readonly out: (d: string) => void) {}
  send(d: string) {
    this.out(d);
  }
  close() {
    this.readyState = 3;
  }
}

const sink: RoomSink = { hello() {}, join() {}, leave() {}, pose() {}, emote() {}, full() {}, reset() {} };
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};
const pct = (a: number[], q: number) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
};

/** Old receiver: ease toward the last pose (150 ms), no velocity. */
class OldMotion {
  x = 0;
  z = 0;
  tx = 0;
  tz = 0;
  seen = false;
  set(x: number, z: number) {
    this.tx = x;
    this.tz = z;
    if (!this.seen) ((this.x = x), (this.z = z), (this.seen = true));
  }
  step(dt: number) {
    const k = 1 - Math.exp(-dt / 0.15);
    this.x += (this.tx - this.x) * k;
    this.z += (this.tz - this.z) * k;
  }
}

interface Result {
  msgsPerS: number;
  p50: number;
  p95: number;
  max: number;
  /** how fast the drawn figure slides (m/s), p99 and max: a correction that snaps shows as a spike */
  slideP99: number;
  slideMax: number;
}

/**
 * One walker for `seconds`, the other person standing `otherAt` metres away. Network: 60-140 ms one way plus the
 * room's 50 ms batch window. Returns messages per second and the drawn error (m) sampled every frame after warm-up.
 */
async function run(kind: 'wander' | 'circle' | 'straight', seconds: number, scheme: 'new' | 'old', otherAt = 5, seed = 7): Promise<Result> {
  const path = walker(kind, seed);
  const r = rng(seed + 1);
  const inFlight: Array<{ at: number; p: number[] }> = [];
  let sent = 0;
  let batchOpenUntil = 0;
  const t0 = Date.now();
  const deliver = (p: number[]) => {
    const now = Date.now();
    // leading edge goes at once, inside the window it rides the next batch
    const leave = now < batchOpenUntil ? batchOpenUntil : now;
    if (now >= batchOpenUntil) batchOpenUntil = now + TUNING.multi.broadcastMs;
    inFlight.push({ at: leave + 60 + r() * 80, p });
  };
  let client: RoomClient | null = null;
  let oldLast: Pose | null = null;
  let oldLastAt = -1e9;
  if (scheme === 'new') {
    client = new RoomClient({
      token: () => 'k'.repeat(40),
      source: { pose: () => path(Date.now() - t0) },
      sink,
      base: 'https://lcw.test',
      fetchImpl: (async () => new Response(JSON.stringify({ ticket: 't'.repeat(48), room: 'family-f', connect: '/v1/room/connect' }), { status: 200 })) as unknown as typeof fetch,
      socket: () => {
        const s = new FakeSocket((d) => {
          if (d === 'ping') return;
          const m = JSON.parse(d) as { t: string; p: number[] };
          if (m.t === 'p') {
            sent++;
            deliver(m.p);
          }
        });
        setTimeout(() => {
          s.onmessage?.({ data: JSON.stringify({ t: 'hello', you: 'me', cap: 8, peers: [['o', 'Mina', 'player', otherAt, 1, 0, 0, 0, 2, 0, 0, 0, 0]] }) });
        }, 0);
        return s;
      },
      now: () => Date.now()
    });
    client.start();
    await flush();
  }
  const motion = new PeerMotion();
  const old = new OldMotion();
  const errs: number[] = [];
  const slides: number[] = [];
  let px: number | null = null;
  let pz = 0;
  const frameMs = 1000 / 60;
  let nextTick = 0;
  for (let ms = 0; ms < seconds * 1000; ms += frameMs) {
    vi.advanceTimersByTime(frameMs);
    const now = Date.now();
    const el = now - t0;
    if (scheme === 'old' && el >= nextTick) {
      // previous sender: every 100 ms tick, a pose when moved, at most 5 a second
      nextTick += 100;
      const p = path(el);
      const moved = !oldLast || p[4] !== oldLast[4] || Math.hypot(p[0] - oldLast[0], p[2] - oldLast[2]) > 0.03 || Math.abs(p[3] - oldLast[3]) > 0.03;
      if (moved && (p[4] !== oldLast?.[4] || now - oldLastAt >= 199)) {
        oldLast = p;
        oldLastAt = now;
        sent++;
        deliver([...p, 0, 0, 0]);
      }
    }
    for (let i = inFlight.length - 1; i >= 0; i--) {
      if (inFlight[i]!.at > now) continue;
      const { p } = inFlight.splice(i, 1)[0]!;
      if (scheme === 'new') motion.set(p[0]!, p[1]!, p[2]!, p[3]!, p[6] ?? 0, p[7] ?? 0, now, p[8] ?? 0);
      else old.set(p[0]!, p[2]!);
    }
    let dx: number;
    let dz: number;
    const truth = path(el);
    if (scheme === 'new') {
      motion.step(frameMs / 1000, now);
      dx = motion.x - truth[0];
      dz = motion.z - truth[2];
    } else {
      old.step(frameMs / 1000);
      dx = old.x - truth[0];
      dz = old.z - truth[2];
    }
    if (el > 3000) errs.push(Math.hypot(dx, dz));
    const dxw = scheme === 'new' ? motion.x : old.x;
    const dzw = scheme === 'new' ? motion.z : old.z;
    if (el > 3000 && px !== null) slides.push(Math.hypot(dxw - px, dzw - pz) / (frameMs / 1000));
    px = dxw;
    pz = dzw;
  }
  client?.stop();
  return { msgsPerS: sent / seconds, p50: pct(errs, 0.5), p95: pct(errs, 0.95), max: Math.max(...errs), slideP99: pct(slides, 0.99), slideMax: Math.max(...slides) };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('pose budget (docs/02 §11.3): fewer requests, no worse smoothness', () => {
  it('8 people walking for 2 hours stay under the free 100k requests a day, even turning all the time', async () => {
    const rows: Record<string, Result> = {};
    for (const kind of ['wander', 'straight', 'circle'] as const) {
      rows[`${kind} new`] = await run(kind, 240, 'new');
      rows[`${kind} old`] = await run(kind, 240, 'old');
    }
    rows['wander new, nobody near'] = await run('wander', 240, 'new', 200);
    // other children, other paths
    for (const seed of [11, 23, 37, 51]) rows[`wander new, seed ${seed}`] = await run('wander', 240, 'new', 5, seed);
    const table = Object.entries(rows).map(([k, v]) => ({
      run: k,
      'msgs/s': +v.msgsPerS.toFixed(2),
      '8 people x 2 h': Math.round(v.msgsPerS * 8 * 7200),
      'err p50 m': +v.p50.toFixed(2),
      'err p95 m': +v.p95.toFixed(2),
      'err max m': +v.max.toFixed(2),
      'slide p99 m/s': +v.slideP99.toFixed(1),
      'slide max m/s': +v.slideMax.toFixed(1)
    }));
    console.table(table);
    for (const kind of ['wander', 'straight', 'circle']) {
      const n = rows[`${kind} new`]!;
      const o = rows[`${kind} old`]!;
      expect(n.msgsPerS * 8 * 7200).toBeLessThan(100_000);
      // the drawn figure is not further off than before (p95), and corrections stay small
      expect(n.p95).toBeLessThanOrEqual(o.p95 * 1.05);
      // and it does not slide or jump more than before (a late sharp turn glides at most ~6 m/s on top of walking)
      expect(n.slideP99).toBeLessThanOrEqual(o.slideP99 * 1.05);
      expect(n.slideMax).toBeLessThanOrEqual(12);
      // the worst moment (a sudden reversal seen a round trip late) stays well under the 8 m snap
      expect(n.max).toBeLessThanOrEqual(3.5);
    }
    for (const seed of [11, 23, 37, 51]) {
      const n = rows[`wander new, seed ${seed}`]!;
      expect(n.msgsPerS * 8 * 7200).toBeLessThan(100_000);
      expect(n.p95).toBeLessThanOrEqual(rows['wander old']!.p95);
      expect(n.slideMax).toBeLessThanOrEqual(12);
      expect(n.max).toBeLessThanOrEqual(3.5);
    }
    // a steady turn is predicted (position and facing): well under the budget, not pressed against it
    expect(rows['circle new']!.msgsPerS).toBeLessThanOrEqual(TUNING.multi.poseBudgetHz / 2);
    expect(rows['wander new, nobody near']!.msgsPerS).toBeLessThan(rows['wander new']!.msgsPerS);
  }, 120_000);
});
