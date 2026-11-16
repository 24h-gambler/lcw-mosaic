/**
 * Multi room protocol and relay rules (docs/03 D11, docs/02 §3 "멀티: WebSocket", §11 measured capacity).
 *
 * One `WorldRoomDO` per room (apps/edge/src/room.ts) owns a `RoomCore`. The core is pure: ids, names and time come in
 * as arguments, every outgoing frame comes back as a string, so the same rules run in the Durable Object, in tests and
 * in the load bots (packages/bots). Poses are display only (where a friend stands); nothing authoritative (coins,
 * blocks, stars) ever rides on them (AGENTS 4.7).
 *
 * Wire format (JSON text frames, compact arrays to keep 10 Hz cheap):
 *   client → room   {"t":"p","p":[x,y,z,yaw,anim,seq?,vx?,vz?,w?]}   pose with ground velocity (m/s) and turn rate
 *                                                        (rad/s, predictPose): only when the
 *                                                        receivers' prediction (pose + velocity × age) would be off,
 *                                                        within a per-sender budget (TUNING.multi.poseBudgetHz)
 *                   {"t":"e","e":"wave"}                    emote from TUNING.multi.emotes
 *                   {"t":"ping","c":<client ms>}            round trip through the room (load bots, latency read-out)
 *                   "ping"                                  keep-alive, answered "pong" by the platform without waking the room
 *   room → client   {"t":"hello","you":id,"cap":8,"peers":[[id,name,role,x,y,z,yaw,anim],...]}
 *                   {"t":"join","id","name","role"} / {"t":"leave","id"}
 *                   {"t":"poses","p":[[id,x,y,z,yaw,anim,seq,vx,vz,w],...]}  every changed pose, batched per broadcastMs
 *                   {"t":"e","id","e"} / {"t":"pong","c"}
 *                   {"t":"full","cap"} then close 4003     the room is at capacity ("방이 가득 찼어요")
 */
import { TUNING } from './tuning.js';

export type RoomRole = 'student' | 'player' | 'teacher' | 'bot';
/**
 * x, y, z (metres), yaw (radians), anim (0 idle, 1 walk, 2 run, 3 jump, …), seq (sender's counter, latency probes),
 * vx, vz (ground velocity, m/s) and w (how fast the walking direction turns, rad/s): the receiver moves the figure
 * along that arc until the next pose (predictPose, docs/02 §11.3).
 */
export type RoomPose = [number, number, number, number, number, number, number, number, number];

/** most a walking direction may turn per second in a pose (a tight circle is ~1.5) */
export const MAX_TURN_RATE = 6;

/**
 * Where a pose has gone after `ageS` seconds: along its ground velocity, the direction turning at w rad/s (heading as
 * yaw: x = sin, z = cos). Sender and receivers use the same function, so the sender knows exactly what the others
 * draw and sends only when that is off.
 */
export function predictPose(x: number, z: number, vx: number, vz: number, w: number, ageS: number): [number, number] {
  if (Math.abs(w) < 1e-3) return [x + vx * ageS, z + vz * ageS];
  const sp = Math.hypot(vx, vz);
  const h0 = Math.atan2(vx, vz);
  const h1 = h0 + w * ageS;
  return [x + (sp * (Math.cos(h0) - Math.cos(h1))) / w, z + (sp * (Math.sin(h1) - Math.sin(h0))) / w];
}

export const ROOM_CLOSE = {
  full: 4003,
  rate: 4008,
  replaced: 4009,
  silent: 4010,
  invalid: 4011
} as const;

export interface RoomMember {
  id: string;
  /** stable per person (player id, or the bot name): a second socket of the same person replaces the first */
  key: string;
  name: string;
  role: RoomRole;
  pose: RoomPose;
  lastMsgAt: number;
  winStart: number;
  winCount: number;
  invalid: number;
  dirty: boolean;
}

export interface RoomCounters {
  joins: number;
  full: number;
  msgsIn: number;
  framesOut: number;
  bytesOut: number;
  dropped: number;
  closedRate: number;
}

export type RoomReceive =
  | { kind: 'none' }
  | { kind: 'reply'; frame: string }
  | { kind: 'broadcast'; frame: string; exceptSelf: boolean }
  | { kind: 'dirty' }
  | { kind: 'close'; code: number; reason: string };

const NAME_MAX = 16;
const ZERO_POSE: RoomPose = [0, 0, 0, 0, 0, 0, 0, 0, 0];

export function cleanRoomName(raw: unknown): string {
  // Control characters and bidi overrides out, trimmed, at most 16 visible characters.
  const s = String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, '')
    .trim();
  return Array.from(s).slice(0, NAME_MAX).join('') || '친구';
}

const r2 = (n: number): number => Math.round(n * 100) / 100;
const r3 = (n: number): number => Math.round(n * 1000) / 1000;

/** Validates a pose array from the wire; null when anything is off (wrong length, not finite, out of the world). */
export function parseRoomPose(p: unknown, limit = TUNING.multi.coordLimit): RoomPose | null {
  if (!Array.isArray(p) || p.length < 5 || p.length > 9) return null;
  for (const v of p) if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const [x, y, z, yaw, anim] = p as number[];
  const seq = (p[5] as number | undefined) ?? 0;
  const vx = (p[6] as number | undefined) ?? 0;
  const vz = (p[7] as number | undefined) ?? 0;
  const w = (p[8] as number | undefined) ?? 0;
  if (Math.abs(x!) > limit || Math.abs(y!) > limit || Math.abs(z!) > limit) return null;
  if (Math.abs(yaw!) > 100) return null;
  if (!Number.isInteger(anim) || anim! < 0 || anim! > 15) return null;
  if (!Number.isInteger(seq) || seq < 0 || seq > 2 ** 31) return null;
  if (Math.abs(vx) > TUNING.multi.maxPoseSpeed || Math.abs(vz) > TUNING.multi.maxPoseSpeed) return null;
  if (Math.abs(w) > MAX_TURN_RATE) return null;
  return [r2(x!), r2(y!), r2(z!), r3(yaw!), anim!, seq, r2(vx), r2(vz), r3(w)];
}

export class RoomCore {
  readonly members = new Map<string, RoomMember>();
  readonly counters: RoomCounters = { joins: 0, full: 0, msgsIn: 0, framesOut: 0, bytesOut: 0, dropped: 0, closedRate: 0 };

  constructor(
    readonly capacity: number = TUNING.multi.roomCapacity,
    private readonly t = TUNING.multi
  ) {}

  get size(): number {
    return this.members.size;
  }

  /** The member a new socket of the same person would replace (refresh, second tab). */
  memberByKey(key: string): RoomMember | undefined {
    for (const m of this.members.values()) if (m.key === key) return m;
    return undefined;
  }

  /**
   * Admits a socket. A person already in the room is replaced (their old id leaves first, see `replaces`); otherwise
   * the room refuses once it holds `capacity` people.
   */
  join(
    p: { id: string; key: string; name: string; role: RoomRole; pose?: RoomPose },
    now: number
  ): { ok: true; hello: string; joinFrame: string; replaces: string | null } | { ok: false; frame: string } {
    const old = this.memberByKey(p.key);
    if (!old && this.members.size >= this.capacity) {
      this.counters.full++;
      return { ok: false, frame: JSON.stringify({ t: 'full', cap: this.capacity }) };
    }
    if (old) this.members.delete(old.id);
    const m: RoomMember = {
      id: p.id,
      key: p.key,
      name: cleanRoomName(p.name),
      role: p.role,
      pose: p.pose ?? old?.pose ?? [...ZERO_POSE],
      lastMsgAt: now,
      winStart: now,
      winCount: 0,
      invalid: 0,
      dirty: false
    };
    this.members.set(m.id, m);
    this.counters.joins++;
    const peers = [...this.members.values()].filter((o) => o.id !== m.id).map((o) => [o.id, o.name, o.role, ...o.pose.slice(0, 5)]);
    return {
      ok: true,
      hello: JSON.stringify({ t: 'hello', you: m.id, cap: this.capacity, peers }),
      joinFrame: JSON.stringify({ t: 'join', id: m.id, name: m.name, role: m.role }),
      replaces: old?.id ?? null
    };
  }

  /** Puts a member back after the Durable Object woke from hibernation (from the socket's attachment). */
  restore(m: { id: string; key: string; name: string; role: RoomRole; pose: RoomPose }, now: number): void {
    this.members.set(m.id, { ...m, lastMsgAt: now, winStart: now, winCount: 0, invalid: 0, dirty: false });
  }

  leave(id: string): string | null {
    return this.members.delete(id) ? JSON.stringify({ t: 'leave', id }) : null;
  }

  receive(id: string, raw: string, now: number): RoomReceive {
    const m = this.members.get(id);
    if (!m) return { kind: 'none' };
    this.counters.msgsIn++;
    m.lastMsgAt = now;
    if (now - m.winStart >= 1000) {
      m.winStart = now;
      m.winCount = 0;
    }
    if (++m.winCount > this.t.maxMsgPerSec) {
      this.counters.closedRate++;
      return { kind: 'close', code: ROOM_CLOSE.rate, reason: 'rate' };
    }
    if (raw.length > this.t.maxMsgBytes) return this.bad(m);
    let msg: { t?: unknown; p?: unknown; e?: unknown; c?: unknown };
    try {
      msg = JSON.parse(raw) as typeof msg;
    } catch {
      return this.bad(m);
    }
    if (!msg || typeof msg !== 'object') return this.bad(m);
    if (msg.t === 'p') {
      const pose = parseRoomPose(msg.p, this.t.coordLimit);
      if (!pose) return this.bad(m);
      m.pose = pose;
      m.dirty = true;
      return { kind: 'dirty' };
    }
    if (msg.t === 'ping') {
      const c = typeof msg.c === 'number' && Number.isFinite(msg.c) ? msg.c : 0;
      return { kind: 'reply', frame: JSON.stringify({ t: 'pong', c }) };
    }
    if (msg.t === 'e') {
      if (typeof msg.e !== 'string' || !this.t.emotes.includes(msg.e)) return this.bad(m);
      return { kind: 'broadcast', frame: JSON.stringify({ t: 'e', id, e: msg.e }), exceptSelf: false };
    }
    return this.bad(m);
  }

  private bad(m: RoomMember): RoomReceive {
    this.counters.dropped++;
    // A client that keeps sending junk is broken or hostile; 20 strikes and it goes.
    if (++m.invalid >= 20) return { kind: 'close', code: ROOM_CLOSE.invalid, reason: 'invalid' };
    return { kind: 'none' };
  }

  /** One frame with every pose that changed since the last flush (null when nothing moved). */
  flush(): { frame: string; moved: RoomMember[] } | null {
    const moved: RoomMember[] = [];
    for (const m of this.members.values()) {
      if (!m.dirty) continue;
      m.dirty = false;
      moved.push(m);
    }
    if (moved.length === 0) return null;
    return { frame: JSON.stringify({ t: 'poses', p: moved.map((m) => [m.id, ...m.pose]) }), moved };
  }

  /** Members that sent nothing (not even the keep-alive, which `aliveAt` reports) for silentDropMs. */
  silent(now: number, aliveAt: (id: string) => number = () => 0): string[] {
    const out: string[] = [];
    for (const m of this.members.values()) {
      if (now - Math.max(m.lastMsgAt, aliveAt(m.id)) > this.t.silentDropMs) out.push(m.id);
    }
    return out;
  }

  noteSent(frames: number, bytes: number): void {
    this.counters.framesOut += frames;
    this.counters.bytesOut += bytes;
  }
}

/**
 * Room names the server accepts. A lesson room follows the lesson, a family room the child's family (siblings share
 * the town), `smoke-` rooms are operator-only load tests.
 */
export const ROOM_ID_RE = /^(lesson|family|smoke)-[A-Za-z0-9_-]{1,64}$/;
