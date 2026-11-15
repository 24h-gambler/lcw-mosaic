import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { SqliteExecutor } from './storage.js';

/**
 * Live lesson listening (WP-307, docs/02 실시간 음성, docs/12 §9 "보호자 청취", docs/16 §3 row 6).
 *
 * One way only: the teacher's director console publishes ONE audio track (teacher mic, optionally mixed with a
 * second input carrying the student, docs/12 "두 채널을 섞어 단방향 전송") to Cloudflare Realtime SFU, and each
 * guardian with this child's `lesson_window` consent pulls that track receive-only. The guardian's microphone is never
 * part of it: the guardian page never asks for one, and the server refuses any guardian SDP answer that would send
 * media (`listen_only`). Nothing is recorded — the SFU forwards packets, these tables hold only who is connected.
 *
 * The SFU app secret stays on the server: every SFU call goes through these routes (docs/02: browsers never hold a
 * Cloudflare credential). Without `REALTIME_APP_ID`/`REALTIME_APP_TOKEN` the routes answer 503
 * `realtime_not_configured` and the window says it shows text only.
 *
 * Flow
 * - Teacher: `POST /v1/admin/lessons/:id/audio/ice` → ICE servers; `POST .../audio/publish {sdp offer, mid}` → a new
 *   SFU session pushes the track, answer SDP back; `POST .../audio/beat` every 10 s keeps it "live" (and returns how
 *   many guardians are listening); `POST .../audio/stop` ends it and closes the listeners.
 * - Guardian: `POST /v1/family/children/:pid/lesson-window/audio` → a new SFU session pulls the track, the SFU's offer
 *   SDP back; `PUT .../audio/:listener {sdp answer}` (recvonly checked) completes it; the window poll
 *   (`GET .../lesson-window?listener=`) keeps the listener seen; `DELETE .../audio/:listener` closes it. Turning
 *   `lesson_window` off closes every listener of that child at once.
 */

export const REALTIME_API_BASE = 'https://rtc.live.cloudflare.com/v1';
export const REALTIME_STUN: IceServer = { urls: ['stun:stun.cloudflare.com:3478'] };
/** The console beats every 10 s; a publisher not seen for this long is treated as gone. */
export const LESSON_AUDIO_PUB_FRESH_MS = 30_000;
/** The window polls every 10 s with its listener id; unseen for this long → not counted as listening. */
export const LESSON_AUDIO_LISTENER_FRESH_MS = 35_000;
/** Open listener connections per child at once (two guardians on two devices, plus one reconnect). */
export const LESSON_AUDIO_MAX_LISTENERS = 4;
/** TURN credentials outlive a 120-minute lesson with overtime. */
export const LESSON_AUDIO_TURN_TTL_S = 4 * 3600;
const SDP_MAX = 20_000;

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface RealtimeConfig {
  appId: string;
  appToken: string;
  turnKeyId?: string;
  turnKeyToken?: string;
  /** Tests and the local real-path rig point this at a stand-in SFU. */
  apiBase?: string;
}

export class RealtimeError extends Error {
  constructor(
    readonly code: string,
    readonly status = 502
  ) {
    super(code);
  }
}

/** The part of the Cloudflare Realtime SFU / TURN HTTPS API these routes use (docs: realtime-api-2024-05-21). */
export interface RealtimeClient {
  iceServers(): Promise<IceServer[]>;
  newSession(): Promise<string>;
  /** Push a local track from the client's offer; returns the SFU's answer. */
  pushTrack(sessionId: string, offerSdp: string, mid: string, trackName: string): Promise<{ answerSdp: string }>;
  /** Pull a remote track into a fresh session; the SFU makes the offer. */
  pullTrack(sessionId: string, remoteSessionId: string, trackName: string): Promise<{ offerSdp: string; mid: string | null }>;
  renegotiate(sessionId: string, answerSdp: string): Promise<void>;
  closeTracks(sessionId: string, mids: string[]): Promise<void>;
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

interface SfuTracksResponse {
  errorCode?: string;
  errorDescription?: string;
  requiresImmediateRenegotiation?: boolean;
  sessionDescription?: { sdp: string; type: string };
  tracks?: { mid?: string; trackName?: string; sessionId?: string; errorCode?: string; errorDescription?: string }[];
}

export function cloudflareRealtime(cfg: RealtimeConfig, fetchImpl: Fetch = (i, init) => fetch(i, init)): RealtimeClient {
  const base = (cfg.apiBase ?? REALTIME_API_BASE).replace(/\/$/, '');
  const app = `${base}/apps/${encodeURIComponent(cfg.appId)}`;
  const call = async <T>(method: string, url: string, body?: unknown, token = cfg.appToken): Promise<T> => {
    let res: Response;
    try {
      res = await fetchImpl(url, {
        method,
        headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    } catch {
      throw new RealtimeError('realtime_unreachable');
    }
    const text = await res.text().catch(() => '');
    let data: unknown = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = {};
    }
    if (!res.ok) throw new RealtimeError(`realtime_http_${res.status}`);
    const top = data as SfuTracksResponse;
    if (top.errorCode) throw new RealtimeError(`realtime_${top.errorCode}`);
    const item = top.tracks?.find((t) => t.errorCode);
    if (item) throw new RealtimeError(`realtime_${item.errorCode}`);
    return data as T;
  };
  return {
    async iceServers() {
      if (!cfg.turnKeyId || !cfg.turnKeyToken) return [REALTIME_STUN];
      try {
        const r = await call<{ iceServers?: IceServer[] }>(
          'POST',
          `${base}/turn/keys/${encodeURIComponent(cfg.turnKeyId)}/credentials/generate-ice-servers`,
          { ttl: LESSON_AUDIO_TURN_TTL_S },
          cfg.turnKeyToken
        );
        return Array.isArray(r.iceServers) && r.iceServers.length ? r.iceServers : [REALTIME_STUN];
      } catch {
        // TURN is the fallback path for strict networks; STUN still connects most homes.
        return [REALTIME_STUN];
      }
    },
    async newSession() {
      const r = await call<{ sessionId?: string }>('POST', `${app}/sessions/new`);
      if (!r.sessionId) throw new RealtimeError('realtime_no_session');
      return r.sessionId;
    },
    async pushTrack(sessionId, offerSdp, mid, trackName) {
      const r = await call<SfuTracksResponse>('POST', `${app}/sessions/${encodeURIComponent(sessionId)}/tracks/new`, {
        sessionDescription: { type: 'offer', sdp: offerSdp },
        tracks: [{ location: 'local', mid, trackName }]
      });
      if (r.sessionDescription?.type !== 'answer' || !r.sessionDescription.sdp) throw new RealtimeError('realtime_no_answer');
      return { answerSdp: r.sessionDescription.sdp };
    },
    async pullTrack(sessionId, remoteSessionId, trackName) {
      const r = await call<SfuTracksResponse>('POST', `${app}/sessions/${encodeURIComponent(sessionId)}/tracks/new`, {
        tracks: [{ location: 'remote', sessionId: remoteSessionId, trackName }]
      });
      if (r.sessionDescription?.type !== 'offer' || !r.sessionDescription.sdp) throw new RealtimeError('realtime_no_offer');
      return { offerSdp: r.sessionDescription.sdp, mid: r.tracks?.[0]?.mid ?? null };
    },
    async renegotiate(sessionId, answerSdp) {
      await call('PUT', `${app}/sessions/${encodeURIComponent(sessionId)}/renegotiate`, {
        sessionDescription: { type: 'answer', sdp: answerSdp }
      });
    },
    async closeTracks(sessionId, mids) {
      if (!mids.length) return;
      await call('PUT', `${app}/sessions/${encodeURIComponent(sessionId)}/tracks/close`, {
        tracks: mids.map((mid) => ({ mid })),
        force: true
      });
    }
  };
}

/** Reads the Worker env; null (→ 503 realtime_not_configured) unless both SFU values are set. */
export function realtimeConfigFrom(env: {
  REALTIME_APP_ID?: string;
  REALTIME_APP_TOKEN?: string;
  REALTIME_TURN_KEY_ID?: string;
  REALTIME_TURN_KEY_TOKEN?: string;
  REALTIME_API_BASE?: string;
}): RealtimeConfig | null {
  if (!env.REALTIME_APP_ID || !env.REALTIME_APP_TOKEN) return null;
  return {
    appId: env.REALTIME_APP_ID,
    appToken: env.REALTIME_APP_TOKEN,
    ...(env.REALTIME_TURN_KEY_ID && env.REALTIME_TURN_KEY_TOKEN
      ? { turnKeyId: env.REALTIME_TURN_KEY_ID, turnKeyToken: env.REALTIME_TURN_KEY_TOKEN }
      : {}),
    ...(env.REALTIME_API_BASE ? { apiBase: env.REALTIME_API_BASE } : {})
  };
}

/* ---------- SDP checks: audio only, and the guardian side can only receive ---------- */

export interface SdpSection {
  kind: string;
  mid: string | null;
  direction: 'sendrecv' | 'sendonly' | 'recvonly' | 'inactive';
}

export function sdpSections(sdp: string): SdpSection[] {
  const parts = sdp.split(/\r?\n(?=m=)/).filter((p) => p.startsWith('m='));
  return parts.map((p) => {
    const kind = /^m=(\w+)/.exec(p)?.[1] ?? '';
    const mid = /\r?\na=mid:([^\r\n]+)/.exec(p)?.[1]?.trim() ?? null;
    const dir = /\r?\na=(sendrecv|sendonly|recvonly|inactive)\b/.exec(p)?.[1] as SdpSection['direction'] | undefined;
    return { kind, mid, direction: dir ?? 'sendrecv' };
  });
}

/** The console's offer: audio sections only (no camera ever), and the published mid sends. */
export function checkPublisherOffer(sdp: string, mid: string): string | null {
  const s = sdpSections(sdp);
  if (!s.length) return 'bad_sdp';
  if (s.some((x) => x.kind !== 'audio')) return 'audio_only';
  const m = s.find((x) => x.mid === mid);
  if (!m) return 'unknown_mid';
  if (m.direction !== 'sendonly' && m.direction !== 'sendrecv') return 'not_sending';
  return null;
}

/** The guardian's answer must not send anything (WP-307: 보호자 마이크가 연결되지 않음). */
export function checkListenerAnswer(sdp: string): string | null {
  const s = sdpSections(sdp);
  if (!s.length) return 'bad_sdp';
  if (s.some((x) => x.kind !== 'audio')) return 'audio_only';
  if (s.some((x) => x.direction === 'sendrecv' || x.direction === 'sendonly')) return 'listen_only';
  return null;
}

/* ---------- state ---------- */

interface PubRow extends Record<string, unknown> {
  lesson_id: string;
  sfu_session: string;
  track_name: string;
  mid: string;
  started_at: number;
  seen_at: number;
  ended_at: number | null;
}

export interface LessonAudioState {
  direction: 'recvonly';
  available: boolean;
  reason: 'realtime_not_configured' | 'no_teacher_stream' | null;
  /** Changes when the teacher republishes; a listening window reconnects when it changes. */
  stream_id: string | null;
}

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

export function livePublisher(sql: SqliteExecutor, lessonId: string, nowMs: number): PubRow | null {
  const row = sql.get<PubRow>(
    `select p.* from lesson_audio_pub p join lessons l on l.id = p.lesson_id
     where p.lesson_id = ? and p.ended_at is null and l.ended_at is null and p.seen_at > ?`,
    [lessonId, nowMs - LESSON_AUDIO_PUB_FRESH_MS]
  );
  return row ?? null;
}

export function lessonAudioState(sql: SqliteExecutor, lessonId: string | null, nowMs: number, configured: boolean): LessonAudioState {
  if (!configured) return { direction: 'recvonly', available: false, reason: 'realtime_not_configured', stream_id: null };
  const pub = lessonId ? livePublisher(sql, lessonId, nowMs) : null;
  return pub
    ? { direction: 'recvonly', available: true, reason: null, stream_id: pub.track_name }
    : { direction: 'recvonly', available: false, reason: 'no_teacher_stream', stream_id: null };
}

export function activeListenerCount(sql: SqliteExecutor, lessonId: string, nowMs: number): number {
  return Number(
    sql.get<{ n: number }>(
      'select count(*) as n from lesson_audio_listeners where lesson_id = ? and closed_at is null and answered_at is not null and seen_at > ?',
      [lessonId, nowMs - LESSON_AUDIO_LISTENER_FRESH_MS]
    )?.n ?? 0
  );
}

/** Closes listener sessions at the SFU (best effort) and marks them closed. Returns how many were open. */
export async function closeListeners(
  sql: SqliteExecutor,
  rt: RealtimeClient | null,
  where: { lessonId?: string; playerId?: string; id?: string },
  reason: string,
  nowMs: number
): Promise<number> {
  const [col, val] = where.id ? ['id', where.id] : where.lessonId ? ['lesson_id', where.lessonId] : ['player_id', where.playerId];
  const rows = sql.all<{ id: string; sfu_session: string; mid: string | null }>(
    `select id, sfu_session, mid from lesson_audio_listeners where ${col} = ? and closed_at is null`,
    [val]
  );
  for (const r of rows) {
    sql.run('update lesson_audio_listeners set closed_at = ?, close_reason = ? where id = ? and closed_at is null', [nowMs, reason, r.id]);
    if (rt && r.mid) await rt.closeTracks(r.sfu_session, [r.mid]).catch(() => undefined);
  }
  return rows.length;
}

/* ---------- guardian side (called from family.ts after its guardian / child / consent gate) ---------- */

export type ListenStart =
  | { ok: true; listener_id: string; sdp: string; ice_servers: IceServer[]; stream_id: string }
  | { ok: false; status: 409 | 429 | 502 | 503; error: string };

export async function startListening(
  d: { sql: SqliteExecutor; randomBytes: (n: number) => Uint8Array },
  rt: RealtimeClient | null,
  p: { playerId: string; guardianId: string; nowMs: number }
): Promise<ListenStart> {
  if (!rt) return { ok: false, status: 503, error: 'realtime_not_configured' };
  const lesson = d.sql.get<{ id: string }>(
    'select id from lessons where player_id = ? and ended_at is null order by started_at desc limit 1',
    [p.playerId]
  );
  const pub = lesson ? livePublisher(d.sql, lesson.id, p.nowMs) : null;
  if (!lesson || !pub) return { ok: false, status: 409, error: 'no_teacher_stream' };
  // Stale half-open attempts and listeners whose window stopped polling do not hold a place.
  d.sql.run(
    "update lesson_audio_listeners set closed_at = ?, close_reason = 'stale' where player_id = ? and closed_at is null and seen_at <= ?",
    [p.nowMs, p.playerId, p.nowMs - LESSON_AUDIO_LISTENER_FRESH_MS]
  );
  const open = Number(
    d.sql.get<{ n: number }>('select count(*) as n from lesson_audio_listeners where player_id = ? and closed_at is null', [p.playerId])?.n ?? 0
  );
  if (open >= LESSON_AUDIO_MAX_LISTENERS) return { ok: false, status: 429, error: 'too_many_listeners' };
  try {
    const [ice, session] = await Promise.all([rt.iceServers(), rt.newSession()]);
    const pulled = await rt.pullTrack(session, pub.sfu_session, pub.track_name);
    const id = hex(d.randomBytes(12));
    d.sql.run(
      `insert into lesson_audio_listeners (id, lesson_id, player_id, guardian_id, sfu_session, mid, track_name, created_at, seen_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, lesson.id, p.playerId, p.guardianId, session, pulled.mid, pub.track_name, p.nowMs, p.nowMs]
    );
    return { ok: true, listener_id: id, sdp: pulled.offerSdp, ice_servers: ice, stream_id: pub.track_name };
  } catch (e) {
    return { ok: false, status: 502, error: e instanceof RealtimeError ? e.code : 'realtime_error' };
  }
}

interface ListenerRow extends Record<string, unknown> {
  id: string;
  lesson_id: string;
  player_id: string;
  guardian_id: string;
  sfu_session: string;
  closed_at: number | null;
}

export function listenerOf(sql: SqliteExecutor, id: string, playerId: string, familyId: string): ListenerRow | null {
  if (!/^[0-9a-f]{24}$/.test(id)) return null;
  return (
    sql.get<ListenerRow>(
      `select l.id, l.lesson_id, l.player_id, l.guardian_id, l.sfu_session, l.closed_at from lesson_audio_listeners l
       join players p on p.id = l.player_id where l.id = ? and l.player_id = ? and p.family_id = ?`,
      [id, playerId, familyId]
    ) ?? null
  );
}

export async function answerListening(
  sql: SqliteExecutor,
  rt: RealtimeClient | null,
  row: ListenerRow,
  answerSdp: string,
  nowMs: number
): Promise<{ ok: true } | { ok: false; status: 400 | 409 | 410 | 502 | 503; error: string }> {
  if (!rt) return { ok: false, status: 503, error: 'realtime_not_configured' };
  if (row.closed_at !== null) return { ok: false, status: 410, error: 'listener_closed' };
  if (answerSdp.length > SDP_MAX) return { ok: false, status: 400, error: 'bad_sdp' };
  const bad = checkListenerAnswer(answerSdp);
  if (bad) {
    // A sending answer is never forwarded to the SFU; the half-open session is closed.
    await closeListeners(sql, rt, { id: row.id }, bad, nowMs);
    return { ok: false, status: 400, error: bad };
  }
  if (!livePublisher(sql, row.lesson_id, nowMs)) return { ok: false, status: 409, error: 'no_teacher_stream' };
  try {
    await rt.renegotiate(row.sfu_session, answerSdp);
  } catch (e) {
    return { ok: false, status: 502, error: e instanceof RealtimeError ? e.code : 'realtime_error' };
  }
  sql.run('update lesson_audio_listeners set answered_at = ?, seen_at = ? where id = ?', [nowMs, nowMs, row.id]);
  return { ok: true };
}

export function touchListener(sql: SqliteExecutor, id: string, playerId: string, nowMs: number): boolean {
  if (!/^[0-9a-f]{24}$/.test(id)) return false;
  const row = sql.get<{ closed_at: number | null }>('select closed_at from lesson_audio_listeners where id = ? and player_id = ?', [id, playerId]);
  if (!row || row.closed_at !== null) return false;
  sql.run('update lesson_audio_listeners set seen_at = ? where id = ?', [nowMs, id]);
  return true;
}

/* ---------- teacher side (operator routes) ---------- */

const PublishSchema = z
  .object({
    sdp: z.string().min(10).max(SDP_MAX),
    mid: z.string().min(1).max(16)
  })
  .strict();

export interface LessonAudioDeps {
  sql: SqliteExecutor;
  nowMs: () => number;
  randomBytes: (n: number) => Uint8Array;
  realtime: () => RealtimeClient | null;
}

export function buildLessonAudioApp(d: LessonAudioDeps): Hono {
  const app = new Hono();
  type Ctx = Context;
  const liveLesson = (c: Ctx) =>
    d.sql.get<{ id: string; player_id: string }>('select id, player_id from lessons where id = ? and ended_at is null', [
      c.req.param('id') ?? ''
    ]);
  const noStore = (c: Ctx) => c.header('cache-control', 'no-store');

  app.post('/v1/admin/lessons/:id/audio/ice', async (c) => {
    noStore(c);
    const rt = d.realtime();
    if (!rt) return c.json({ error: 'realtime_not_configured' }, 503);
    if (!liveLesson(c)) return c.json({ error: 'lesson_not_live' }, 404);
    return c.json({ ice_servers: await rt.iceServers() });
  });

  app.post('/v1/admin/lessons/:id/audio/publish', async (c) => {
    noStore(c);
    const rt = d.realtime();
    if (!rt) return c.json({ error: 'realtime_not_configured' }, 503);
    const lesson = liveLesson(c);
    if (!lesson) return c.json({ error: 'lesson_not_live' }, 404);
    const p = PublishSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!p.success) return c.json({ error: 'invalid' }, 400);
    const bad = checkPublisherOffer(p.data.sdp, p.data.mid);
    if (bad) return c.json({ error: bad }, 400);
    const now = d.nowMs();
    const trackName = `lesson-${hex(d.randomBytes(8))}`;
    let session: string;
    let answer: string;
    try {
      session = await rt.newSession();
      answer = (await rt.pushTrack(session, p.data.sdp, p.data.mid, trackName)).answerSdp;
    } catch (e) {
      return c.json({ error: e instanceof RealtimeError ? e.code : 'realtime_error' }, 502);
    }
    // A republish (console reload, device switch) replaces the stream; listeners of the old one reconnect
    // when the window sees the new stream_id.
    const old = d.sql.get<{ sfu_session: string; mid: string; ended_at: number | null }>(
      'select sfu_session, mid, ended_at from lesson_audio_pub where lesson_id = ?',
      [lesson.id]
    );
    d.sql.run(
      `insert into lesson_audio_pub (lesson_id, sfu_session, track_name, mid, started_at, seen_at, ended_at) values (?, ?, ?, ?, ?, ?, null)
       on conflict(lesson_id) do update set sfu_session = excluded.sfu_session, track_name = excluded.track_name, mid = excluded.mid,
         started_at = excluded.started_at, seen_at = excluded.seen_at, ended_at = null`,
      [lesson.id, session, trackName, p.data.mid, now, now]
    );
    if (old && old.ended_at === null) await rt.closeTracks(old.sfu_session, [old.mid]).catch(() => undefined);
    await closeListeners(d.sql, rt, { lessonId: lesson.id }, 'republished', now);
    return c.json({ sdp: answer, stream_id: trackName });
  });

  app.post('/v1/admin/lessons/:id/audio/beat', (c) => {
    noStore(c);
    const now = d.nowMs();
    const lesson = liveLesson(c);
    const pub = d.sql.get<{ ended_at: number | null }>('select ended_at from lesson_audio_pub where lesson_id = ?', [c.req.param('id') ?? '']);
    if (!lesson || !pub || pub.ended_at !== null) return c.json({ live: false, listeners: 0 });
    d.sql.run('update lesson_audio_pub set seen_at = ? where lesson_id = ?', [now, lesson.id]);
    return c.json({ live: true, listeners: activeListenerCount(d.sql, lesson.id, now) });
  });

  app.post('/v1/admin/lessons/:id/audio/stop', async (c) => {
    noStore(c);
    const id = c.req.param('id') ?? '';
    const now = d.nowMs();
    const rt = d.realtime();
    const pub = d.sql.get<{ sfu_session: string; mid: string; ended_at: number | null }>(
      'select sfu_session, mid, ended_at from lesson_audio_pub where lesson_id = ?',
      [id]
    );
    if (pub && pub.ended_at === null) {
      d.sql.run('update lesson_audio_pub set ended_at = ? where lesson_id = ?', [now, id]);
      if (rt) await rt.closeTracks(pub.sfu_session, [pub.mid]).catch(() => undefined);
    }
    const closed = await closeListeners(d.sql, rt, { lessonId: id }, 'teacher_stopped', now);
    return c.json({ ok: true, listeners_closed: closed });
  });

  return app;
}
