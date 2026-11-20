/**
 * Multi room server (docs/02 §3 "WorldDO: 저장·멀티 룸" → the room half, docs/03 D11, docs/02 §11 measured capacity).
 *
 * - `WorldRoomDO`: one Durable Object per room (`idFromName(room)`). It relays poses between the people in one world
 *   with the WebSocket Hibernation API, so a quiet room costs no duration. The relay rules live in sim-core
 *   `RoomCore` (pure, tested); this file is the socket plumbing. The room keeps nothing on disk.
 *   (The world *save* half of WorldDO stays in the platform DO, storage.ts `WorldDO`; this class name keeps the two
 *   apart.)
 * - Tickets: a browser cannot put a bearer token on a WebSocket, so the page first asks the platform DO for a one-use
 *   ticket (POST /v1/room/ticket with its lesson / device / operator token), then opens
 *   `wss://…/v1/room/connect?t=<ticket>`. The Worker redeems the ticket at the platform DO (internal route, not
 *   reachable from outside) and forwards the upgrade to the room with who-is-this headers it sets itself.
 * - Capacity: TUNING.multi.roomCapacity (8, docs/03). The 9th socket gets `{"t":"full"}` and close 4003; the client
 *   shows "방이 가득 찼어요".
 */
import { Hono } from 'hono';
import { ROOM_CLOSE, ROOM_ID_RE, RoomCore, TUNING, cleanRoomName, type RoomPose, type RoomRole } from '@lcw/sim-core';
import { OP_SESSION_HEADER } from './operator-login.js';

// ---- minimal workerd types (the repo does not pull @cloudflare/workers-types)

interface WsLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  serializeAttachment(v: unknown): void;
  deserializeAttachment(): unknown;
}
/** storage key of the room's play-fighting switch (true = off) */
const PVP_OFF_KEY = 'pvpOff';
interface RoomState {
  acceptWebSocket(ws: WsLike, tags?: string[]): void;
  getWebSockets(tag?: string): WsLike[];
  setWebSocketAutoResponse?(pair: unknown): void;
  getWebSocketAutoResponseTimestamp?(ws: WsLike): Date | null;
  /** R326: the teacher's play-fighting switch outlives an empty room (the sockets keep it only while someone is in) */
  storage?: { get(key: string): Promise<unknown>; put(key: string, value: unknown): Promise<void> };
}
interface Attachment {
  /** R326: the room's play fighting was turned off (kept on every socket, so it survives hibernation) */
  pvpOff?: boolean;
  id: string;
  key: string;
  name: string;
  role: RoomRole;
  pose: RoomPose;
  proto?: number;
  /** when that pose was set (ms) */
  at?: number;
}

declare const WebSocketPair: { new (): { 0: WsLike; 1: WsLike } };
declare const WebSocketRequestResponsePair: (new (req: string, res: string) => unknown) | undefined;

export const ROOM_HEADERS = { room: 'x-lcw-room', key: 'x-lcw-room-key', name: 'x-lcw-room-name', role: 'x-lcw-room-role', proto: 'x-lcw-room-proto' } as const;
const ROLES: readonly RoomRole[] = ['student', 'player', 'teacher', 'bot'];

function shortId(): string {
  const b = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(b, (x) => (x % 36).toString(36)).join('');
}

/**
 * Capacity: the spec value, unless the deployment sets LCW_ROOM_CAPACITY (wrangler var, 1..64). Used for the docs/02
 * §11 measurements above 8 on a local `wrangler dev`; production leaves it unset.
 */
export function roomCapacityFrom(env: unknown): number {
  const raw = Number((env as { LCW_ROOM_CAPACITY?: unknown } | null)?.LCW_ROOM_CAPACITY);
  return Number.isInteger(raw) && raw >= 1 && raw <= 64 ? raw : TUNING.multi.roomCapacity;
}

export class WorldRoomDO {
  private readonly core: RoomCore;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly startedAt = Date.now();

  constructor(private readonly state: RoomState, env: unknown) {
    this.core = new RoomCore(roomCapacityFrom(env));
    // Keep-alive "ping" is answered by the platform without waking this object (no duration, no message handling).
    if (typeof WebSocketRequestResponsePair === 'function') state.setWebSocketAutoResponse?.(new WebSocketRequestResponsePair('ping', 'pong'));
    // Woke from hibernation: the members are whoever still holds a socket.
    const now = Date.now();
    for (const ws of state.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachment | null;
      if (!a?.id) continue;
      const { pvpOff, ...member } = a;
      this.core.restore(member, now);
      if (pvpOff) this.core.pvp = false;
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/stats') return Response.json(this.stats());
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response('expected websocket', { status: 426 });
    const key = request.headers.get(ROOM_HEADERS.key) ?? '';
    const role = request.headers.get(ROOM_HEADERS.role) as RoomRole | null;
    if (!key || !role || !ROLES.includes(role)) return new Response('forbidden', { status: 403 });
    const name = cleanRoomName(decodeURIComponent(request.headers.get(ROOM_HEADERS.name) ?? ''));
    if (!this.pvpLoaded) {
      this.pvpLoaded = true;
      // the first to come in after the room emptied reads the switch before its hello says it
      if ((await this.state.storage?.get(PVP_OFF_KEY).catch(() => undefined)) === true) this.core.pvp = false;
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const id = shortId();
    const proto = request.headers.get(ROOM_HEADERS.proto) === '2' ? 2 : 1;
    const res = this.core.join({ id, key, name, role, proto }, Date.now());
    this.state.acceptWebSocket(server, [id]);
    if (!res.ok) {
      // Accept, say why, close: a refused upgrade gives the browser no reason it can read.
      server.send(res.frame);
      server.close(ROOM_CLOSE.full, 'room_full');
      return new Response(null, { status: 101, webSocket: client } as ResponseInit);
    }
    const m = this.core.members.get(id)!;
    server.serializeAttachment({ id, key: m.key, name: m.name, role: m.role, pose: m.pose, proto: m.proto, at: m.poseAt, ...(this.core.pvp ? {} : { pvpOff: true }) } satisfies Attachment);
    if (res.replaces) {
      for (const old of this.state.getWebSockets(res.replaces)) old.close(ROOM_CLOSE.replaced, 'replaced');
      this.broadcast(JSON.stringify({ t: 'leave', id: res.replaces }), id);
    }
    server.send(res.hello);
    this.broadcast(res.joinFrame, id);
    return new Response(null, { status: 101, webSocket: client } as ResponseInit);
  }

  webSocketMessage(ws: WsLike, message: string | ArrayBuffer): void {
    const a = ws.deserializeAttachment() as Attachment | null;
    if (!a?.id || typeof message !== 'string') return;
    if (!this.core.members.has(a.id)) {
      // A socket the room no longer counts (it was refused as full, or replaced): nothing it says is relayed.
      return;
    }
    const r = this.core.receive(a.id, message, Date.now());
    switch (r.kind) {
      case 'reply':
        this.send(ws, r.frame);
        break;
      case 'broadcast':
        this.broadcast(r.frame, r.exceptSelf ? a.id : null);
        if ((JSON.parse(r.frame) as { t?: string }).t === 'pvp') this.keepPvp();
        break;
      case 'dirty':
        this.scheduleFlush();
        break;
      case 'close':
        this.drop(ws, a.id, r.code, r.reason);
        break;
    }
  }

  /** the teacher's play-fighting switch onto every socket (the room may sleep and wake from them) */
  /** the stored switch was read (once per object life: after that the core holds it) */
  private pvpLoaded = false;

  private keepPvp(): void {
    this.pvpLoaded = true;
    void this.state.storage?.put(PVP_OFF_KEY, !this.core.pvp).catch(() => undefined);
    for (const ws of this.state.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachment | null;
      if (!a?.id) continue;
      const { pvpOff: _old, ...rest } = a;
      ws.serializeAttachment(this.core.pvp ? rest : { ...rest, pvpOff: true });
    }
  }

  webSocketClose(ws: WsLike, _code: number, _reason: string, _clean: boolean): void {
    const a = ws.deserializeAttachment() as Attachment | null;
    if (a?.id) this.gone(a.id);
  }

  webSocketError(ws: WsLike): void {
    const a = ws.deserializeAttachment() as Attachment | null;
    if (a?.id) this.gone(a.id);
  }

  private gone(id: string): void {
    // A replaced socket closing must not take the new one with it: only the id that is still a member leaves.
    const leave = this.core.leave(id);
    if (leave) this.broadcast(leave, id);
  }

  private drop(ws: WsLike, id: string, code: number, reason: string): void {
    try {
      ws.close(code, reason);
    } catch {
      /* already closed */
    }
    this.gone(id);
  }

  /** Leading edge: a pose after a quiet spell goes out at once; inside the window it rides the next batch. */
  private scheduleFlush(): void {
    if (this.flushTimer) return;
    const wait = this.lastFlushAt + TUNING.multi.broadcastMs - Date.now();
    if (wait <= 0) return this.flush();
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, wait);
  }

  private lastFlushAt = 0;

  private flush(): void {
    this.lastFlushAt = Date.now();
    const out = this.core.flush();
    if (out) {
      // The attachment carries the last pose so a room that hibernates can still greet a newcomer with it.
      for (const m of out.moved) {
        for (const ws of this.state.getWebSockets(m.id)) ws.serializeAttachment({ id: m.id, key: m.key, name: m.name, role: m.role, pose: m.pose, proto: m.proto, at: m.poseAt, ...(this.core.pvp ? {} : { pvpOff: true }) } satisfies Attachment);
      }
      this.broadcast(out.frame, null);
    }
    const now = Date.now();
    const sockets = new Map<string, WsLike>();
    for (const ws of this.state.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachment | null;
      if (a?.id) sockets.set(a.id, ws);
    }
    const aliveAt = (id: string): number => {
      const ws = sockets.get(id);
      return ws ? (this.state.getWebSocketAutoResponseTimestamp?.(ws)?.getTime() ?? 0) : 0;
    };
    for (const id of this.core.silent(now, aliveAt)) {
      const ws = sockets.get(id);
      if (ws) this.drop(ws, id, ROOM_CLOSE.silent, 'silent');
      else this.gone(id);
    }
  }

  private send(ws: WsLike, frame: string): void {
    try {
      ws.send(frame);
      this.core.noteSent(1, frame.length);
    } catch {
      /* closing */
    }
  }

  private broadcast(frame: string, exceptId: string | null): void {
    for (const ws of this.state.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachment | null;
      if (!a?.id || a.id === exceptId || !this.core.members.has(a.id)) continue;
      this.send(ws, frame);
    }
  }

  stats(): Record<string, unknown> {
    return {
      members: this.core.size,
      cap: this.core.capacity,
      sockets: this.state.getWebSockets().length,
      up_ms: Date.now() - this.startedAt,
      ...this.core.counters
    };
  }
}

// ---- tickets (platform DO side)

export const ROOM_TICKET_SCHEMA = `
create table if not exists room_tickets (token_hash text primary key, room text not null, player_key text not null, name text not null, role text not null, expires_at integer not null);
create index if not exists room_tickets_exp on room_tickets (expires_at);
`;

interface TicketSql {
  run(sql: string, params?: unknown[]): void;
  get<T extends Record<string, unknown>>(sql: string, params?: unknown[]): T | undefined;
}

export interface RoomTicketDeps {
  sql: TicketSql;
  nowMs: () => number;
  randomBytes: (n: number) => Uint8Array;
  sha256Hex: (s: string) => Promise<string>;
  student: (req: Request) => Promise<{ lesson_id: string; player_id: string } | null>;
  device: (req: Request) => Promise<{ device_id: string; player_id: string } | null>;
  isOperator: (req: Request) => boolean;
  /** player → nickname and family (who the others see, which family room) */
  player: (playerId: string) => { nickname: string; family_id: string } | null;
  /**
   * R325 (Dan 11-19 "둘이서 하기 힘들다"): the family whose room this child plays in when it is not their own. A Duo
   * seat's two children may be from two families (docs/01 "Duo의 두 좌석은 가족이 아니어도 됩니다") and each sat alone
   * in their own family room; both now meet in the payer's family room. null = their own family.
   */
  playFamily?: (playerId: string) => string | null;
  /**
   * A friend on a guest pass (docs/19 §8, `x-lcw-guest-pass`) is in the host child's world: they sit in the host's room
   * (they were alone there, the host in their own). null = no running pass on this request.
   */
  pass?: (req: Request) => Promise<{ host_player_id: string; grant_id: string } | null>;
}

export interface RoomSeat {
  room: string;
  key: string;
  name: string;
  role: RoomRole;
}

/** Who may sit in which room: the token decides, the body only names the room for the operator. */
export async function roomSeatFor(d: RoomTicketDeps, req: Request, body: { room?: unknown; name?: unknown; key?: unknown }): Promise<RoomSeat | null> {
  const student = await d.student(req);
  if (student) {
    const p = d.player(student.player_id);
    return { room: `lesson-${student.lesson_id}`, key: student.player_id, name: p?.nickname ?? '', role: 'student' };
  }
  const visit = d.pass ? await d.pass(req) : null;
  if (visit) {
    const host = d.player(visit.host_player_id);
    if (!host) return null;
    // the pass alone names no child: the others see "Friend" (a name the guest typed would be an unchecked label)
    return { room: `family-${d.playFamily?.(visit.host_player_id) ?? host.family_id}`, key: `pass:${visit.grant_id}`, name: '', role: 'player' }; // '' = the client's own word for a friend
  }
  const device = await d.device(req);
  if (device) {
    const p = d.player(device.player_id);
    if (!p) return null;
    return { room: `family-${d.playFamily?.(device.player_id) ?? p.family_id}`, key: device.player_id, name: p.nickname, role: 'player' };
  }
  if (d.isOperator(req)) {
    const room = typeof body.room === 'string' ? body.room : '';
    if (!ROOM_ID_RE.test(room)) return null;
    const name = cleanRoomName(body.name ?? '선생님');
    // Load bots in smoke- rooms each bring their own key. A teacher is one seat per sign-in session (the session id the
    // platform sets after checking the lcwop_ token; a client's own header is stripped first): the same teacher's second
    // tab takes the seat over, two teachers signed in separately are two people. The ops key alone is one 'operator'.
    const smoke = room.startsWith('smoke-');
    const session = req.headers.get(OP_SESSION_HEADER);
    const key =
      smoke && typeof body.key === 'string' && body.key.length <= 64
        ? `op:${body.key}`
        : session && /^[A-Za-z0-9_-]{1,64}$/.test(session)
          ? `op:s:${session}`
          : 'operator';
    return { room, key, name, role: smoke ? 'bot' : 'teacher' };
  }
  return null;
}

const hex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

export async function issueRoomTicket(d: RoomTicketDeps, seat: RoomSeat): Promise<{ ticket: string; expires_at: number }> {
  const ticket = hex(d.randomBytes(24));
  const now = d.nowMs();
  const expires_at = now + TUNING.multi.ticketTtlMs;
  d.sql.run('delete from room_tickets where expires_at < ?', [now]);
  d.sql.run('insert into room_tickets (token_hash, room, player_key, name, role, expires_at) values (?, ?, ?, ?, ?, ?)', [
    await d.sha256Hex(ticket),
    seat.room,
    seat.key,
    seat.name,
    seat.role,
    expires_at
  ]);
  return { ticket, expires_at };
}

/** One use: the row goes whether or not it is still fresh. */
export async function redeemRoomTicket(d: Pick<RoomTicketDeps, 'sql' | 'nowMs' | 'sha256Hex'>, ticket: string): Promise<RoomSeat | null> {
  if (typeof ticket !== 'string' || ticket.length < 32 || ticket.length > 128) return null;
  const h = await d.sha256Hex(ticket);
  const row = d.sql.get<{ room: string; player_key: string; name: string; role: RoomRole; expires_at: number }>(
    'select room, player_key, name, role, expires_at from room_tickets where token_hash = ?',
    [h]
  );
  if (!row) return null;
  d.sql.run('delete from room_tickets where token_hash = ?', [h]);
  if (row.expires_at < d.nowMs()) return null;
  return { room: row.room, key: row.player_key, name: row.name, role: row.role };
}

/** POST /v1/room/ticket (public route: it checks its own tokens). */
export function buildRoomApp(d: RoomTicketDeps): Hono {
  const app = new Hono();
  app.post('/v1/room/ticket', async (c) => {
    const body = ((await c.req.json().catch(() => ({}))) ?? {}) as { room?: unknown; name?: unknown; key?: unknown };
    const seat = await roomSeatFor(d, c.req.raw, body);
    // No room for this caller (guest, expired lesson token): a plain answer, not 401 — every non-2xx fetch is a console
    // error on the child's page, and the client simply stays alone and asks again much later.
    if (!seat) return c.json({ room: null, reason: 'no_room' });
    const t = await issueRoomTicket(d, seat);
    return c.json({ ticket: t.ticket, expires_at: t.expires_at, room: seat.room, cap: TUNING.multi.roomCapacity, connect: '/v1/room/connect' });
  });
  return app;
}

// ---- Worker side

interface DoStubLike {
  fetch(input: Request | string, init?: RequestInit): Promise<Response>;
}
interface DoNamespaceLike {
  idFromName(name: string): unknown;
  get(id: unknown): DoStubLike;
}

export const ROOM_CONNECT_PATH = '/v1/room/connect';

/**
 * GET /v1/room/connect?t=<ticket> with Upgrade: websocket. Redeems the ticket at the platform DO, then hands the
 * upgrade to the room. Headers the client sent under x-lcw-room* are dropped first: only this code names the seat.
 */
export async function routeRoomConnect(request: Request, platform: DoStubLike, rooms: DoNamespaceLike | undefined): Promise<Response> {
  if (!rooms) return Response.json({ error: 'rooms_not_configured' }, { status: 503 });
  if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return Response.json({ error: 'expected_websocket' }, { status: 426 });
  const url = new URL(request.url);
  const ticket = url.searchParams.get('t') ?? '';
  const r = await platform.fetch('https://platform/internal/room-ticket', {
    method: 'POST',
    headers: { 'x-lcw-internal': 'room', 'content-type': 'application/json' },
    body: JSON.stringify({ ticket })
  });
  if (!r.ok) return Response.json({ error: 'bad_ticket' }, { status: 403 });
  const seat = (await r.json()) as RoomSeat;
  const headers = new Headers();
  for (const [k, v] of request.headers) if (!k.toLowerCase().startsWith('x-lcw-')) headers.set(k, v);
  headers.set(ROOM_HEADERS.room, seat.room);
  headers.set(ROOM_HEADERS.key, seat.key);
  headers.set(ROOM_HEADERS.name, encodeURIComponent(seat.name));
  headers.set(ROOM_HEADERS.role, seat.role);
  headers.set(ROOM_HEADERS.proto, url.searchParams.get('v') === '2' ? '2' : '1');
  return rooms.get(rooms.idFromName(seat.room)).fetch(new Request(`https://room/${encodeURIComponent(seat.room)}`, { headers }));
}
