/**
 * Multi room connection (docs/03 D11; server apps/edge/src/room.ts, protocol sim-core room.ts).
 *
 * Who is in which room is the server's call from the token: a lesson student sits in the lesson's room, a linked
 * child in their family's room (siblings see each other in the same town). A guest without a token has no room and
 * nothing here runs. Failures never reach the world: no room, a refused ticket or a dropped socket only means the
 * child plays alone, and the connection retries with a growing pause. A full room says "방이 가득 찼어요" once and
 * stops trying for a while.
 */
import { TUNING } from '@lcw/sim-core';

export interface RoomPoseSource {
  /** x, y, z, yaw, anim of the local player (null while the world is not ready) */
  pose(): readonly [number, number, number, number, number] | null;
}

export interface RoomSink {
  hello(you: string, peers: ReadonlyArray<{ id: string; name: string; role: string; pose: readonly number[] }>): void;
  join(id: string, name: string, role: string): void;
  leave(id: string): void;
  pose(id: string, x: number, y: number, z: number, yaw: number, anim: number): void;
  emote(id: string, e: string): void;
  full(cap: number): void;
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
  token: () => string | null;
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

const MIN_MOVE = 0.03;
const MIN_TURN = 0.03;
/** after "full": try again in 60 s (someone may have left) */
const FULL_RETRY_MS = 60_000;
/** no token yet (a lesson joined after the world opened): look again locally, no request */
const NO_TOKEN_RETRY_MS = 10_000;
/** this token has no room (401): ask again rarely (a new lesson token may arrive) */
const NO_ROOM_RETRY_MS = 300_000;

export type RoomStatus = 'off' | 'connecting' | 'in' | 'full' | 'none';

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
    const token = this.o.token();
    if (!token) {
      this.status = 'none';
      return this.schedule(NO_TOKEN_RETRY_MS);
    }
    this.status = 'connecting';
    const base = this.o.base ?? '';
    type Ticket = { ticket: string; room: string; connect: string };
    let ticket = null as Ticket | null;
    try {
      const res = await (this.o.fetchImpl ?? fetch)(`${base}/v1/room/ticket`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: '{}'
      });
      // 401: this token has no room (expired lesson) — wait long, do not hammer the server
      if (res.status === 401) {
        this.status = 'none';
        return this.schedule(NO_ROOM_RETRY_MS);
      }
      if (res.ok) ticket = (await res.json()) as Ticket;
    } catch {
      ticket = null;
    }
    if (this.stopped) return;
    if (!ticket?.ticket) return this.schedule(this.backoff());
    this.room = ticket.room;
    const loc = typeof location !== 'undefined' ? location : null;
    const origin = base || (loc ? `${loc.protocol}//${loc.host}` : '');
    const url = `${origin.replace(/^http/, 'ws')}${ticket.connect}?t=${encodeURIComponent(ticket.ticket)}`;
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
      // replaced by this person's newer tab: that tab is the one in the room now
      if (ev.code === 4009) {
        this.status = 'off';
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
        sink.hello(String(f.you), peers);
        this.lastSent = null;
        this.tickPose();
        break;
      }
      case 'join':
        this.others.add(String(f.id));
        sink.join(String(f.id), String(f.name), String(f.role));
        // the newcomer only knows where I stood when I last moved (nothing is sent while alone): tell them now
        this.lastSent = null;
        this.lastPoseAt = -1e9;
        break;
      case 'leave':
        this.others.delete(String(f.id));
        sink.leave(String(f.id));
        break;
      case 'poses':
        for (const p of (f.p as unknown[][]) ?? []) sink.pose(String(p[0]), p[1] as number, p[2] as number, p[3] as number, p[4] as number, p[5] as number);
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
   * Pose loop, checked poseTickHz times a second: a pose goes out when moved or turned, at most poseHz a second,
   * except a change of animation (start, stop, jump) which goes at once. Alone in the room nothing is sent; a plain
   * "ping" keep-alive every idleKeepaliveMs keeps the socket.
   */
  private tickPose(): void {
    this.cancel(this.poseTimer);
    this.poseTimer = this.later(() => this.tickPose(), 1000 / TUNING.multi.poseTickHz);
    const ws = this.ws;
    if (!ws || ws.readyState !== 1 || this.status !== 'in') return;
    const p = this.others.size > 0 ? this.o.source.pose() : null;
    const now = this.now;
    if (p) {
      const l = this.lastSent;
      const animChanged = !l || p[4] !== l[4];
      const moved =
        animChanged || Math.abs(p[0] - l![0]!) > MIN_MOVE || Math.abs(p[1] - l![1]!) > MIN_MOVE || Math.abs(p[2] - l![2]!) > MIN_MOVE || Math.abs(p[3] - l![3]!) > MIN_TURN;
      const due = animChanged || now - this.lastPoseAt >= 1000 / TUNING.multi.poseHz - 1;
      if (moved && due) {
        this.seq++;
        ws.send(JSON.stringify({ t: 'p', p: [p[0], p[1], p[2], p[3], p[4], this.seq] }));
        this.posesSent++;
        this.lastSent = p;
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

  emote(e: string): void {
    if (this.ws?.readyState === 1 && TUNING.multi.emotes.includes(e)) this.ws.send(JSON.stringify({ t: 'e', e }));
  }
}
