/**
 * Multi room connection (docs/03 D11; server apps/edge/src/room.ts, protocol sim-core room.ts).
 *
 * Who is in which room is the server's call from the token: a lesson student sits in the lesson's room, a linked
 * child in their family's room (siblings see each other in the same town). A guest without a token has no room and
 * nothing here runs. Failures never reach the world: no room, a refused ticket or a dropped socket only means the
 * child plays alone, and the connection retries with a growing pause. A full room says "방이 가득 찼어요" once and
 * stops trying for a while.
 */
import { MAX_TURN_RATE, TUNING, predictPose } from '@lcw/sim-core';
import { peerMotionOf } from './peer-motion.js';

export interface RoomPoseSource {
  /** x, y, z, yaw, anim of the local player (null while the world is not ready) */
  pose(): readonly [number, number, number, number, number] | null;
}

export interface RoomSink {
  hello(you: string, peers: ReadonlyArray<{ id: string; name: string; role: string; pose: readonly number[] }>): void;
  join(id: string, name: string, role: string): void;
  leave(id: string): void;
  /** vx, vz: ground velocity (m/s) to carry the figure along until the next pose (0 when standing or an old client) */
  pose(id: string, x: number, y: number, z: number, yaw: number, anim: number, vx?: number, vz?: number, w?: number): void;
  emote(id: string, e: string): void;
  full(cap: number): void;
  /** this person opened the world in another tab, which now holds the seat (close 4009): this tab stays alone */
  replaced?(): void;
  /** every peer gone (socket closed): the figures are removed until the next hello */
  reset(): void;
}

interface SocketLike {
  readyState: number;
  send(d: string): void;
  close(code?: number): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export interface RoomClientOptions {
  /** Bearer tokens to try in order (lesson student token first, then the child's device token); empty = none yet. */
  token: () => string | null | ReadonlyArray<string | null>;
  /** Ticket request body: only an operator names a room (a teacher walking into the lesson room, docs/02 §11). */
  ticketBody?: () => Record<string, unknown>;
  source: RoomPoseSource;
  sink: RoomSink;
  /** same origin by default ('' → relative /v1/...) */
  base?: string;
  fetchImpl?: typeof fetch;
  socket?: (url: string) => SocketLike;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
}

/** under this ground speed (m/s) the sender counts as standing (no velocity sent) */
const STILL_SPEED = 0.2;
/** a walking direction this far (rad) from the predicted one, or a pace change this large (m/s), goes out at once */
const SWERVE_RAD = 0.6;
/** the steady rate older pages were drawn for (until everyone has the pose budget) */
const LEGACY_POSE_HZ = 5;
const SWERVE_SPEED = 1.5;
/** height change (m) that goes out even when the ground prediction holds (steps, a jump) */
const ERR_Y = 0.6;
const wrapAngle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
/** after "full": try again in 60 s (someone may have left) */
const FULL_RETRY_MS = 60_000;
/** no token yet (a lesson joined after the world opened): look again locally, no request */
const NO_TOKEN_RETRY_MS = 10_000;
/** this token has no room (401): ask again rarely (a new lesson token may arrive) */
const NO_ROOM_RETRY_MS = 300_000;

export type RoomStatus = 'off' | 'connecting' | 'in' | 'full' | 'none' | 'replaced';

export class RoomClient {
  status: RoomStatus = 'off';
  room: string | null = null;
  framesIn = 0;
  posesSent = 0;
  rttMs: number | null = null;
  private ws: SocketLike | null = null;
  private stopped = false;
  private retry = 0;
  private timer: unknown = null;
  private poseTimer: unknown = null;
  private lastSent: readonly number[] | null = null;
  /** velocity sent with lastSent (the receivers move the figure along it) */
  private lastV: readonly [number, number, number] = [0, 0, 0];
  /** smoothed turn rate of the walking direction (rad/s) */
  private turn = 0;
  private tokens: number = TUNING.multi.poseBurst;
  private tokensAt = 0;
  private prevSample: { x: number; z: number; t: number; h: number | null } | null = null;
  /** where the others are (last pose + velocity), to send less often to a room where nobody is near */
  /** others on a page from before the pose budget (proto 1): while any is here, poses go at the old steady rate */
  private legacy = new Set<string>();
  private otherPos = new Map<string, { x: number; z: number; vx: number; vz: number; w: number; t: number }>();
  private lastSentAt = 0;
  private seq = 0;
  private toldFull = false;
  private lastPoseAt = -1e9;
  /** people in the room besides me: alone, nothing is sent but the keep-alive */
  private others = new Set<string>();

  constructor(private readonly o: RoomClientOptions) {}

  private get now(): number {
    return (this.o.now ?? (() => performance.now()))();
  }
  private later(fn: () => void, ms: number): unknown {
    return (this.o.setTimer ?? ((f, m) => setTimeout(f, m)))(fn, ms);
  }
  private cancel(h: unknown): void {
    if (h !== null) (this.o.clearTimer ?? ((x) => clearTimeout(x as ReturnType<typeof setTimeout>)))(h);
  }

  start(): void {
    this.stopped = false;
    void this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.cancel(this.timer);
    this.cancel(this.poseTimer);
    this.timer = this.poseTimer = null;
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onclose = null;
      try {
        ws.close(1000);
      } catch {
        /* closing */
      }
    }
    this.o.sink.reset();
    this.status = 'off';
  }

  /** Take the seat back after another tab of the same person took it (that tab then gets 4009 in turn). */
  takeOver(): void {
    if (this.stopped || this.status !== 'replaced') return;
    this.retry = 0;
    this.cancel(this.timer);
    this.timer = null;
    void this.connect();
  }

  private schedule(ms: number): void {
    if (this.stopped) return;
    this.cancel(this.timer);
    this.timer = this.later(() => void this.connect(), ms);
  }

  private backoff(): number {
    this.retry = Math.min(this.retry + 1, 6);
    return Math.min(60_000, 2000 * 2 ** (this.retry - 1));
  }

  private async connect(): Promise<void> {
    if (this.stopped || this.ws) return;
    const raw = this.o.token();
    const tokens = [...new Set((Array.isArray(raw) ? raw : [raw]).filter((t): t is string => typeof t === 'string' && t.length > 0))];
    if (!tokens.length) {
      this.status = 'none';
      return this.schedule(NO_TOKEN_RETRY_MS);
    }
    this.status = 'connecting';
    const base = this.o.base ?? '';
    type Ticket = { ticket?: string; room: string | null; connect: string };
    let ticket = null as Ticket | null;
    let noRoom = 0;
    for (const token of tokens) {
      try {
        const res = await (this.o.fetchImpl ?? fetch)(`${base}/v1/room/ticket`, {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify(this.o.ticketBody?.() ?? {})
        });
        // {room:null} (or 401 from an older server): this token has no room (an expired lesson) — try the next one
        if (res.status === 401) {
          noRoom++;
          continue;
        }
        if (!res.ok) break;
        const body = (await res.json()) as Ticket;
        if (!body.room) {
          noRoom++;
          continue;
        }
        ticket = body;
        break;
      } catch {
        break;
      }
      if (this.stopped) return;
    }
    if (this.stopped) return;
    if (!ticket && noRoom === tokens.length) {
      // no token has a room: wait long, do not hammer the server
      this.status = 'none';
      return this.schedule(NO_ROOM_RETRY_MS);
    }
    if (this.stopped) return;
    if (!ticket?.ticket) return this.schedule(this.backoff());
    this.room = ticket.room;
    const loc = typeof location !== 'undefined' ? location : null;
    const origin = base || (loc ? `${loc.protocol}//${loc.host}` : '');
    const url = `${origin.replace(/^http/, 'ws')}${ticket.connect}?t=${encodeURIComponent(ticket.ticket)}&v=2`;
    let ws: SocketLike;
    try {
      ws = this.o.socket ? this.o.socket(url) : (new WebSocket(url) as unknown as SocketLike);
    } catch {
      return this.schedule(this.backoff());
    }
    this.ws = ws;
    ws.onmessage = (ev) => this.onFrame(ev.data);
    ws.onerror = () => undefined;
    ws.onclose = (ev) => {
      this.ws = null;
      this.cancel(this.poseTimer);
      this.poseTimer = null;
      this.o.sink.reset();
      if (this.stopped) return;
      if (ev.code === 4003) {
        this.status = 'full';
        return this.schedule(FULL_RETRY_MS);
      }
      // replaced by this person's newer tab: that tab is the one in the room now. No retry (two tabs would keep
      // kicking each other); takeOver() brings the seat back here when the person comes back to this tab.
      if (ev.code === 4009) {
        this.status = 'replaced';
        this.o.sink.replaced?.();
        return;
      }
      this.status = 'connecting';
      this.schedule(this.backoff());
    };
  }

  private onFrame(data: unknown): void {
    if (typeof data !== 'string') return;
    this.framesIn++;
    if (data === 'pong') return;
    let f: { t?: string; [k: string]: unknown };
    try {
      f = JSON.parse(data) as typeof f;
    } catch {
      return;
    }
    const sink = this.o.sink;
    switch (f.t) {
      case 'hello': {
        this.status = 'in';
        this.retry = 0;
        this.toldFull = false;
        const peers = ((f.peers as unknown[][]) ?? []).map((p) => ({ id: String(p[0]), name: String(p[1]), role: String(p[2]), pose: p.slice(3) as number[] }));
        this.others = new Set(peers.map((p) => p.id));
        this.legacy = new Set(peers.filter((p) => p.pose[5] !== 2).map((p) => p.id));
        this.prevSample = null;
        this.otherPos.clear();
        for (const p of peers) {
          const [x, , z] = p.pose as number[];
          const v = peerMotionOf(p.pose);
          if (typeof x === 'number' && typeof z === 'number') this.otherPos.set(p.id, { x, z, vx: v.vx, vz: v.vz, w: v.w, t: this.now - v.ageMs });
        }
        sink.hello(String(f.you), peers);
        this.lastSent = null;
        this.tickPose();
        break;
      }
      case 'join':
        this.others.add(String(f.id));
        if (f.v !== 2) this.legacy.add(String(f.id));
        sink.join(String(f.id), String(f.name), String(f.role));
        // the newcomer only knows where I stood when I last moved (nothing is sent while alone): tell them now
        this.lastSent = null;
        this.lastPoseAt = -1e9;
        break;
      case 'leave':
        this.others.delete(String(f.id));
        this.legacy.delete(String(f.id));
        this.otherPos.delete(String(f.id));
        sink.leave(String(f.id));
        break;
      case 'poses':
        for (const p of (f.p as unknown[][]) ?? []) {
          const id = String(p[0]);
          const vx = typeof p[7] === 'number' ? p[7] : 0;
          const vz = typeof p[8] === 'number' ? p[8] : 0;
          const w = typeof p[9] === 'number' ? p[9] : 0;
          this.otherPos.set(id, { x: p[1] as number, z: p[3] as number, vx, vz, w, t: this.now });
          sink.pose(id, p[1] as number, p[2] as number, p[3] as number, p[4] as number, p[5] as number, vx, vz, w);
        }
        break;
      case 'e':
        sink.emote(String(f.id), String(f.e));
        break;
      case 'pong':
        if (typeof f.c === 'number') this.rttMs = Math.round(this.now - f.c);
        break;
      case 'full':
        if (!this.toldFull) sink.full(Number(f.cap) || TUNING.multi.roomCapacity);
        this.toldFull = true;
        break;
    }
  }

  /**
   * Pose loop, checked poseTickHz times a second (docs/02 §11.3 request budget). The receivers carry a figure along
   * its last velocity, so a pose goes out only when that prediction is off: the position by more than poseErrM (or
   * poseErrFarM when nobody is within poseNearM), the yaw by poseYawRad (far: poseYawFarRad), the height by 0.6 m, the
   * animation changed (start, stop, jump), or poseRefreshMs passed while moving. A token bucket (poseBurst, refilled
   * poseBudgetHz a second) caps the average whatever the walking, and poseHz the burst. Standing still or alone in
   * the room nothing is sent; a plain "ping" keep-alive every idleKeepaliveMs keeps the socket.
   */
  private tickPose(): void {
    this.cancel(this.poseTimer);
    this.poseTimer = this.later(() => this.tickPose(), 1000 / TUNING.multi.poseTickHz);
    const ws = this.ws;
    if (!ws || ws.readyState !== 1 || this.status !== 'in') return;
    const T = TUNING.multi;
    const p = this.others.size > 0 ? this.o.source.pose() : null;
    const now = this.now;
    this.tokens = Math.min(T.poseBurst, this.tokens + (Math.max(0, now - this.tokensAt) / 1000) * T.poseBudgetHz);
    this.tokensAt = now;
    if (p) {
      // velocity from what the player actually did since the last tick (a frozen tab reads 0, not its last speed)
      const prev = this.prevSample;
      let vx = 0;
      let vz = 0;
      let h: number | null = null;
      if (prev && now > prev.t) {
        const dt = (now - prev.t) / 1000;
        vx = (p[0] - prev.x) / dt;
        vz = (p[2] - prev.z) / dt;
        const sp = Math.hypot(vx, vz);
        if (sp < STILL_SPEED || sp > T.maxPoseSpeed) vx = vz = 0;
        else {
          h = Math.atan2(vx, vz);
          // how fast the walking direction turns, smoothed over a few ticks (a circle, a curve along a path)
          const w = prev.h === null ? 0 : wrapAngle(h - prev.h) / dt;
          this.turn += (Math.max(-MAX_TURN_RATE, Math.min(MAX_TURN_RATE, w)) - this.turn) * 0.5;
        }
      }
      if (h === null) this.turn = 0;
      this.prevSample = { x: p[0], z: p[2], t: now, h };
      const l = this.lastSent;
      let send = !l; // nothing sent yet, or a newcomer who must see me
      let free = send;
      // tokens needed: 1 for a drift, 0 for a sharp turn (borrows one), -1 for a start, stop or jump (borrows two);
      // the average stays within the budget, the debt is paid back first
      let need = 1;
      if (l) {
        const age = Math.min(now - this.lastPoseAt, T.poseHorizonMs) / 1000;
        const [px, pz] = predictPose(l[0]!, l[2]!, this.lastV[0], this.lastV[1], this.lastV[2], age);
        const ex = p[0] - px;
        const ez = p[2] - pz;
        const far = this.nearestOther(p[0], p[2], now) > T.poseNearM;
        const moving = vx !== 0 || vz !== 0 || p[4] !== 0;
        const stopped = !moving && (this.lastV[0] !== 0 || this.lastV[1] !== 0);
        // a sharp turn or a change of pace: the others would keep drawing the old line
        const lsp = Math.hypot(this.lastV[0], this.lastV[1]);
        const sp = Math.hypot(vx, vz);
        const swerve =
          sp > 0 && lsp > 0 && (Math.abs(wrapAngle(Math.atan2(vx, vz) - Math.atan2(this.lastV[0], this.lastV[1]) - this.lastV[2] * age)) > SWERVE_RAD || Math.abs(sp - lsp) > SWERVE_SPEED);
        const started = (vx !== 0 || vz !== 0) && this.lastV[0] === 0 && this.lastV[1] === 0;
        const err = Math.hypot(ex, ez);
        const errM = far ? T.poseErrFarM : T.poseErrM;
        need = p[4] !== l[4] || stopped || started ? -1 : swerve || err > errM * 3 ? 0 : 1;
        send =
          need < 1 ||
          err > errM ||
          Math.abs(p[1] - l[1]!) > ERR_Y ||
          // facing is predicted too (it turns with the walking direction on the receivers)
          Math.abs(wrapAngle(p[3] - (l[3]! + this.lastV[2] * age))) > (far ? T.poseYawFarRad : T.poseYawRad) ||
          (moving && now - this.lastPoseAt >= T.poseRefreshMs);
        free = false;
        // someone on an older page eases toward the last pose only: keep the old steady 5 Hz for them
        if (this.legacy.size > 0) {
          const movedAtAll = p[4] !== l[4] || Math.hypot(p[0] - l[0]!, p[2] - l[2]!) > 0.03 || Math.abs(p[1] - l[1]!) > 0.03 || Math.abs(wrapAngle(p[3] - l[3]!)) > 0.03;
          send = movedAtAll && (p[4] !== l[4] || now - this.lastPoseAt >= 1000 / LEGACY_POSE_HZ - 1);
          free = send;
        }
      }
      const due = now - this.lastPoseAt >= 1000 / T.poseHz - 1;
      if (send && (free || (due && this.tokens >= need))) {
        if (!free) this.tokens -= 1;
        this.seq++;
        const r2 = (n: number): number => Math.round(n * 100) / 100;
        const w = vx === 0 && vz === 0 ? 0 : Math.round(this.turn * 1000) / 1000;
        ws.send(JSON.stringify({ t: 'p', p: [p[0], p[1], p[2], p[3], p[4], this.seq, r2(vx), r2(vz), w] }));
        this.posesSent++;
        this.lastSent = p;
        this.lastV = [r2(vx), r2(vz), w];
        this.lastSentAt = now;
        this.lastPoseAt = now;
        return;
      }
    }
    if (now - this.lastSentAt >= TUNING.multi.idleKeepaliveMs) {
      ws.send('ping');
      this.lastSentAt = now;
    }
  }

  /** Distance to the nearest other person (their last pose carried along its velocity); Infinity when unknown. */
  private nearestOther(x: number, z: number, now: number): number {
    let best = Infinity;
    for (const id of this.others) {
      const o = this.otherPos.get(id);
      if (!o) return 0; // someone not placed yet: treat as near
      const [ox, oz] = predictPose(o.x, o.z, o.vx, o.vz, o.w, Math.min(now - o.t, TUNING.multi.poseHorizonMs) / 1000);
      best = Math.min(best, Math.hypot(ox - x, oz - z));
    }
    return best;
  }

  emote(e: string): void {
    if (this.ws?.readyState === 1 && TUNING.multi.emotes.includes(e)) this.ws.send(JSON.stringify({ t: 'e', e }));
  }
}
