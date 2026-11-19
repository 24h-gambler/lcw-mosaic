import { Hono, type Context } from 'hono';
import { filterSpeechBubble } from '@lcw/converse';
import { VOICE_SCHEMA_SQL, queueVoicePurgeSql, runInTransaction, type EdgePlatformDb, type SqliteExecutor } from './storage.js';

/**
 * Voice clips (docs/02 §10, docs/16 §2-2·3, docs/07 §4): the child's own spoken turn, kept only while the guardian's
 * `voice_store` consent is on.
 *
 * - Upload: the scoring routes (/v1/converse/score, /v1/lesson/utterance) answer a speech turn of a child whose
 *   guardian turned voice_store on with `audio_upload {token, max_bytes, expires_at}`. The device then POSTs the
 *   recorded turn to `/v1/voice/upload/:token` (one use, 10 minutes, bound to that utterance). Consent is checked
 *   again at upload; the bytes must be WebM/Ogg/MP4 audio by their magic bytes. Objects go to R2 under an opaque key
 *   (`clips/<random>`) — no player id, nickname or text in the key.
 * - Listen: only the guardian of that child, from a report on the guardian's own device
 *   (`GET /v1/family/reports/:token/clips`), gets short-lived signed URLs (`/v1/voice/clips/:id?e=&s=`, 15 minutes,
 *   HMAC with a key kept inside the Durable Object). The public report link never carries audio (it can be
 *   forwarded). The operator sees counts and sizes only (`GET /v1/admin/voice`), never a playable URL.
 * - Delete: turning voice_store off queues every clip of that child at once (same transaction as the consent change)
 *   and the consent route deletes them from R2 before answering; anything R2 refused is retried by the hourly cron.
 *   Clips are also deleted 12 months after the child's last seat ended (docs/02 §10, daily cron).
 */


const DAY = 86_400_000;
/** One spoken turn is at most 12 s (docs/04 4.1); 24 kbps Opus ≈ 36 KB, Safari AAC ≈ 100 KB. */
export const VOICE_MAX_BYTES = 256 * 1024;
export const VOICE_UPLOAD_TTL_MS = 10 * 60_000;
export const VOICE_PLAY_URL_TTL_MS = 15 * 60_000;
/** docs/02 §10: utterance clips are kept for the seat's life + 12 months (`가정`). */
export const VOICE_KEEP_AFTER_SEAT_MS = 365 * DAY;
/** Clips listed under one report (best turns first). */
export const REPORT_CLIPS_MAX = 6;
/** Speech turns only: typed or card-assembled sentences have no voice to keep. */
export const VOICE_SOURCES: ReadonlySet<string> = new Set(['browser', 'device', 'workers_ai']);
export const VOICE_PURGE_MAX_ATTEMPTS = 20;

/** Public routes this module serves; each checks its own token or signature (platform.ts isPublicRoute). */
export const VOICE_PUBLIC_ROUTES: ReadonlyArray<readonly [string, RegExp]> = [
  ['POST', /^\/v1\/voice\/upload\/[0-9a-f]{48}$/],
  ['GET', /^\/v1\/voice\/clips\/[0-9a-f]{24}$/]
];

/** R2 in production (`VOICE` binding); an in-memory map in tests. */
export interface VoiceBlobStore {
  put(key: string, bytes: Uint8Array, mime: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(keys: string[]): Promise<void>;
}

/** Just the R2Bucket calls this module makes (workers-types are not a dependency here). */
export interface R2BucketLike {
  put(key: string, value: Uint8Array, opts?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  delete(keys: string | string[]): Promise<void>;
}

export function r2VoiceStore(b: R2BucketLike): VoiceBlobStore {
  return {
    put: async (k, v, mime) => {
      await b.put(k, v, { httpMetadata: { contentType: mime } });
    },
    get: async (k) => {
      const o = await b.get(k);
      return o ? new Uint8Array(await o.arrayBuffer()) : null;
    },
    delete: async (keys) => {
      // R2 deletes up to 1000 keys per call.
      for (let i = 0; i < keys.length; i += 1000) await b.delete(keys.slice(i, i + 1000));
    }
  };
}

/** R2 stand-in for tests and local checks: same calls, objects in a Map. `failDeletes` simulates an R2 outage. */
export class MemoryR2Bucket implements R2BucketLike {
  readonly objects = new Map<string, { bytes: Uint8Array; mime: string }>();
  failDeletes = false;
  async put(k: string, value: Uint8Array, opts?: { httpMetadata?: { contentType?: string } }): Promise<unknown> {
    this.objects.set(k, { bytes: value, mime: opts?.httpMetadata?.contentType ?? '' });
    return {};
  }
  async get(k: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null> {
    const o = this.objects.get(k);
    if (!o) return null;
    return { arrayBuffer: async () => o.bytes.slice().buffer as ArrayBuffer };
  }
  async delete(keys: string | string[]): Promise<void> {
    if (this.failDeletes) throw new Error('r2_unavailable');
    for (const k of Array.isArray(keys) ? keys : [keys]) this.objects.delete(k);
  }
}

/** Container sniffing: WebM/Matroska (EBML), Ogg, or ISO-BMFF (MP4/M4A). Anything else is not stored. */
export function sniffAudioMime(b: Uint8Array): 'audio/webm' | 'audio/ogg' | 'audio/mp4' | null {
  if (b.length < 12) return null;
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'audio/webm';
  if (b[0] === 0x4f && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53) return 'audio/ogg';
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return 'audio/mp4';
  return null;
}

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

export interface VoiceDeps {
  sql: SqliteExecutor;
  db: EdgePlatformDb;
  nowMs: () => number;
  randomBytes: (n: number) => Uint8Array;
  sha256Hex: (s: string) => Promise<string>;
  /** null while the R2 binding is missing: uploads answer 503 and nothing is stored anywhere else. */
  store: () => VoiceBlobStore | null;
}

export interface VoiceUploadOffer {
  token: string;
  max_bytes: number;
  expires_at: number;
}

/**
 * Called by the scoring routes right after an utterance row is written. Only a speech turn of a child whose
 * guardian has voice_store on gets an upload token; everyone else gets null and the device records nothing.
 */
export async function offerVoiceUpload(
  d: Pick<VoiceDeps, 'sql' | 'db' | 'randomBytes' | 'sha256Hex'>,
  p: { playerId: string; utteranceId: string; source: string; nowMs: number }
): Promise<VoiceUploadOffer | null> {
  if (!VOICE_SOURCES.has(p.source)) return null;
  if (!d.db.hasActiveConsent(p.playerId, 'voice_store')) return null;
  const token = hex(d.randomBytes(24));
  const expires = p.nowMs + VOICE_UPLOAD_TTL_MS;
  d.sql.run('delete from voice_upload_tokens where expires_at <= ?', [p.nowMs]);
  d.sql.run('insert into voice_upload_tokens (token_hash, utterance_id, player_id, expires_at, used_at) values (?, ?, ?, ?, null)', [
    await d.sha256Hex(token),
    p.utteranceId,
    p.playerId,
    expires
  ]);
  return { token, max_bytes: VOICE_MAX_BYTES, expires_at: expires };
}

/**
 * Moves every clip of a child to the purge queue and cuts them off from the utterances, synchronously (so a revoked
 * consent can never be followed by a listen). R2 deletion happens in drainVoicePurge. See EdgePlatformDb.queueVoicePurge.
 */
export function queuePlayerVoicePurge(sql: SqliteExecutor, playerId: string, reason: string, nowMs: number): number {
  return runInTransaction(sql, () => queueVoicePurgeSql(sql, playerId, reason, nowMs));
}

/** Deletes queued objects from R2. Failures stay queued with the error; the hourly cron calls this again. */
export async function drainVoicePurge(
  sql: SqliteExecutor,
  store: VoiceBlobStore | null,
  limit = 500
): Promise<{ deleted: number; failed: number; left: number }> {
  const rows = sql.all<{ r2_key: string }>(
    'select r2_key from voice_purge where attempts < ? order by queued_at limit ?',
    [VOICE_PURGE_MAX_ATTEMPTS, limit]
  );
  let deleted = 0;
  let failed = 0;
  if (rows.length > 0 && store) {
    const keys = rows.map((r) => r.r2_key);
    try {
      await store.delete(keys);
      for (const k of keys) sql.run('delete from voice_purge where r2_key = ?', [k]);
      deleted = keys.length;
    } catch (err) {
      const msg = (err instanceof Error ? err.message : String(err)).slice(0, 200);
      for (const k of keys) sql.run('update voice_purge set attempts = attempts + 1, last_error = ? where r2_key = ?', [msg, k]);
      failed = keys.length;
    }
  } else if (rows.length > 0) {
    failed = rows.length;
  }
  const left = Number(sql.get<{ n: number }>('select count(*) as n from voice_purge')?.n ?? 0);
  return { deleted, failed, left };
}

/**
 * Daily retention (docs/02 §10): a child's clips go 12 months after their last seat ended. Also a safety net: any clip
 * whose child has no active voice_store consent (should never exist) is queued too.
 */
export function queueExpiredVoice(sql: SqliteExecutor, nowMs: number): { expired_players: number; no_consent_players: number } {
  const expired = sql.all<{ player_id: string }>(
    `select c.player_id from voice_clips c
     join (select player_id, max(ends_at) as last_end from seats group by player_id) s on s.player_id = c.player_id
     where s.last_end + ? < ?
     group by c.player_id`,
    [VOICE_KEEP_AFTER_SEAT_MS, nowMs]
  );
  for (const r of expired) queuePlayerVoicePurge(sql, r.player_id, 'retention', nowMs);
  const noConsent = sql.all<{ player_id: string }>(
    `select distinct c.player_id from voice_clips c
     where not exists (select 1 from consents k where k.player_id = c.player_id and k.scope = 'voice_store'
                       and k.granted_at is not null and k.revoked_at is null)`
  );
  for (const r of noConsent) queuePlayerVoicePurge(sql, r.player_id, 'no_consent', nowMs);
  return { expired_players: expired.length, no_consent_players: noConsent.length };
}

async function signKey(sql: SqliteExecutor, randomBytes: (n: number) => Uint8Array): Promise<CryptoKey> {
  let k = sql.get<{ v: string }>("select v from voice_meta where k = 'sign_key'")?.v;
  if (!k) {
    sql.run("insert or ignore into voice_meta (k, v) values ('sign_key', ?)", [hex(randomBytes(32))]);
    k = sql.get<{ v: string }>("select v from voice_meta where k = 'sign_key'")!.v;
  }
  const raw = new Uint8Array(k.match(/../g)!.map((h) => parseInt(h, 16)));
  return crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

async function signature(sql: SqliteExecutor, randomBytes: (n: number) => Uint8Array, clipId: string, exp: number): Promise<string> {
  const key = await signKey(sql, randomBytes);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${clipId}.${exp}`));
  return hex(new Uint8Array(mac));
}

export async function signedClipUrl(d: Pick<VoiceDeps, 'sql' | 'randomBytes'>, clipId: string, nowMs: number): Promise<string> {
  const exp = nowMs + VOICE_PLAY_URL_TTL_MS;
  return `/v1/voice/clips/${clipId}?e=${exp}&s=${await signature(d.sql, d.randomBytes, clipId, exp)}`;
}

export interface ReportClip {
  id: string;
  /** The child's sentence, through the same filter as speech bubbles. */
  text: string;
  at: number;
  dur_ms: number;
  stars: number;
  url: string;
}

/**
 * Clips under one report: a lesson report covers that lesson's turns, a weekly report the 7 days before it was made.
 * Best turns first (stars, then longer sentences), at most REPORT_CLIPS_MAX. Only the child's own lines: a clip left with
 * him under a line marked as a test session (lesson-mode.ts mark-test moves the line, not the clip) stays out.
 */
export async function reportClips(
  d: Pick<VoiceDeps, 'sql' | 'randomBytes'>,
  report: { player_id: string; kind: string; ref_id: string; created_at: number },
  nowMs: number
): Promise<ReportClip[]> {
  const scope =
    report.kind === 'lesson'
      ? { where: 'u.session_id = ?', arg: report.ref_id as string | number }
      : { where: 'u.created_at >= ?', arg: report.created_at - 7 * DAY };
  const rows = d.sql.all<{ id: string; final_text: string; created_at: number; dur_ms: number; stars: number }>(
    `select c.id, u.final_text, u.created_at, u.dur_ms, u.stars from voice_clips c join utterances u on u.id = c.utterance_id
     where c.player_id = ? and u.player_id = c.player_id and ${scope.where} and u.created_at <= ?
     order by u.stars desc, u.words desc, u.created_at asc limit ?`,
    [report.player_id, scope.arg, report.created_at + DAY, REPORT_CLIPS_MAX]
  );
  const out: ReportClip[] = [];
  for (const r of rows) {
    const f = filterSpeechBubble(r.final_text);
    out.push({
      id: r.id,
      text: f.allowed ? f.text : '',
      at: r.created_at,
      dur_ms: r.dur_ms,
      stars: r.stars,
      url: await signedClipUrl(d, r.id, nowMs)
    });
  }
  return out.sort((a, b) => a.at - b.at);
}

type Ctx = Context;

export function buildVoiceApp(d: VoiceDeps): Hono {
  d.sql.exec(VOICE_SCHEMA_SQL);
  const app = new Hono();

  app.post('/v1/voice/upload/:token', async (c: Ctx) => {
    const declared = Number(c.req.header('content-length') ?? '0');
    const body = new Uint8Array(await c.req.arrayBuffer().catch(() => new ArrayBuffer(0)));
    const now = d.nowMs();
    const hash = await d.sha256Hex(c.req.param('token') ?? '');
    const t = d.sql.get<{ utterance_id: string; player_id: string; expires_at: number; used_at: number | null }>(
      'select utterance_id, player_id, expires_at, used_at from voice_upload_tokens where token_hash = ?',
      [hash]
    );
    if (!t || t.used_at !== null || t.expires_at <= now) return c.json({ error: 'upload_token_invalid' }, 401);
    if (declared > VOICE_MAX_BYTES || body.length > VOICE_MAX_BYTES) return c.json({ error: 'too_large', max_bytes: VOICE_MAX_BYTES }, 413);
    const mime = sniffAudioMime(body);
    if (!mime) return c.json({ error: 'not_audio' }, 415);
    // Consent can be turned off between the turn and the upload: check again, store nothing.
    if (!d.db.hasActiveConsent(t.player_id, 'voice_store')) {
      d.sql.run('update voice_upload_tokens set used_at = ? where token_hash = ?', [now, hash]);
      return c.json({ error: 'voice_store_off' }, 403);
    }
    const utt = d.sql.get<{ id: string }>('select id from utterances where id = ? and player_id = ?', [t.utterance_id, t.player_id]);
    if (!utt) return c.json({ error: 'utterance_not_found' }, 404);
    const store = d.store();
    if (!store) return c.json({ error: 'voice_store_unavailable' }, 503);
    // Claim the token before the async put so a replay cannot write twice.
    d.sql.run('update voice_upload_tokens set used_at = ? where token_hash = ? and used_at is null', [now, hash]);
    const id = hex(d.randomBytes(12));
    const key = `clips/${id}`;
    await store.put(key, body, mime);
    const kept = runInTransaction(d.sql, () => {
      // Consent may have been revoked while the bytes were in flight: then the object goes straight to the purge queue.
      if (!d.db.hasActiveConsent(t.player_id, 'voice_store')) {
        d.sql.run(
          "insert or ignore into voice_purge (r2_key, player_id, reason, queued_at, attempts, last_error) values (?, ?, 'consent_revoked', ?, 0, null)",
          [key, t.player_id, now]
        );
        return false;
      }
      d.sql.run(
        'insert into voice_clips (id, utterance_id, player_id, r2_key, mime, bytes, created_at) values (?, ?, ?, ?, ?, ?, ?)',
        [id, t.utterance_id, t.player_id, key, mime, body.length, now]
      );
      d.sql.run('update utterances set audio_final = ? where id = ?', [id, t.utterance_id]);
      return true;
    });
    if (!kept) {
      await drainVoicePurge(d.sql, store).catch(() => undefined);
      return c.json({ error: 'voice_store_off' }, 403);
    }
    return c.json({ ok: true, bytes: body.length }, 201);
  });

  app.get('/v1/voice/clips/:id', async (c: Ctx) => {
    const id = c.req.param('id') ?? '';
    const exp = Number(c.req.query('e') ?? '0');
    const sig = c.req.query('s') ?? '';
    const now = d.nowMs();
    c.header('cache-control', 'private, no-store');
    c.header('referrer-policy', 'no-referrer');
    c.header('x-robots-tag', 'noindex, nofollow');
    if (!Number.isFinite(exp) || exp <= now || exp > now + VOICE_PLAY_URL_TTL_MS + 60_000) return c.json({ error: 'link_expired' }, 403);
    const want = await signature(d.sql, d.randomBytes, id, exp);
    let diff = want.length === sig.length ? 0 : 1;
    for (let i = 0; i < want.length && i < sig.length; i++) diff |= want.charCodeAt(i) ^ sig.charCodeAt(i);
    if (diff !== 0) return c.json({ error: 'bad_signature' }, 403);
    const clip = d.sql.get<{ r2_key: string; mime: string; player_id: string }>('select r2_key, mime, player_id from voice_clips where id = ?', [id]);
    // Gone (consent off, retention) even with a still-valid signature.
    if (!clip || !d.db.hasActiveConsent(clip.player_id, 'voice_store')) return c.json({ error: 'clip_not_found' }, 404);
    const store = d.store();
    const bytes = store ? await store.get(clip.r2_key) : null;
    if (!bytes) return c.json({ error: 'clip_not_found' }, 404);
    const headers: Record<string, string> = {
      'content-type': clip.mime,
      'accept-ranges': 'bytes',
      'cache-control': 'private, no-store',
      'referrer-policy': 'no-referrer',
      'x-robots-tag': 'noindex, nofollow'
    };
    // Safari's <audio> asks for byte ranges first; answer them (clips are small, sliced in memory).
    const range = /^bytes=(\d*)-(\d*)$/.exec(c.req.header('range') ?? '');
    if (range && (range[1] || range[2])) {
      const size = bytes.length;
      let start = range[1] ? Number(range[1]) : size - Number(range[2]);
      let end = range[1] && range[2] ? Number(range[2]) : size - 1;
      start = Math.max(0, start);
      end = Math.min(size - 1, end);
      if (start > end) return new Response(null, { status: 416, headers: { ...headers, 'content-range': `bytes */${size}` } });
      return new Response(bytes.slice(start, end + 1), {
        status: 206,
        headers: { ...headers, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': String(end - start + 1) }
      });
    }
    return new Response(new Uint8Array(bytes), { status: 200, headers: { ...headers, 'content-length': String(bytes.length) } });
  });

  /** Operator: counts and sizes only — no listening, no URLs (coordinator 11-16: 운영자는 보기만). */
  app.get('/v1/admin/voice', (c: Ctx) => {
    const now = d.nowMs();
    const players = d.sql.all<{ player_id: string; nickname: string | null; clips: number; bytes: number; last_at: number; last_seat_end: number | null }>(
      `select c.player_id, p.nickname, count(*) as clips, sum(c.bytes) as bytes, max(c.created_at) as last_at,
              (select max(ends_at) from seats s where s.player_id = c.player_id) as last_seat_end
       from voice_clips c left join players p on p.id = c.player_id group by c.player_id order by last_at desc`
    );
    const purge = d.sql.get<{ n: number; failing: number }>(
      'select count(*) as n, coalesce(sum(case when attempts > 0 then 1 else 0 end), 0) as failing from voice_purge'
    );
    return c.json({
      store_bound: d.store() !== null,
      clips_total: players.reduce((a, r) => a + Number(r.clips), 0),
      bytes_total: players.reduce((a, r) => a + Number(r.bytes), 0),
      players: players.map((r) => ({
        player_id: r.player_id,
        nickname: r.nickname,
        clips: Number(r.clips),
        bytes: Number(r.bytes),
        last_at: Number(r.last_at),
        keep_until: r.last_seat_end === null ? null : Number(r.last_seat_end) + VOICE_KEEP_AFTER_SEAT_MS
      })),
      purge_queue: Number(purge?.n ?? 0),
      purge_failing: Number(purge?.failing ?? 0),
      now
    });
  });

  return app;
}
