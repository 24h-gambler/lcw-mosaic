import { Hono } from 'hono';
import { LESSON_SWEEP_CRON, buildLessonModeApp, studentFromRequest, type IdleSweepResult } from './lesson-mode.js';
import { buildExportApp } from './export-csv.js';
import { playAllowed, soloWriteGate, sweepSeatNotices } from './seats.js';
import { legacyWorldRedirect, withSeenCookie } from './world-path.js';
import {
  VOICE_PUBLIC_ROUTES,
  buildVoiceApp,
  drainVoicePurge,
  offerVoiceUpload,
  queueExpiredVoice,
  r2VoiceStore,
  type R2BucketLike,
  type VoiceBlobStore
} from './voice.js';
import { DEVICE_TOKEN_TTL_MS, FAMILY_PUBLIC_ROUTES, buildFamilyApp, openPublicReport } from './family.js';
import { buildPushAdminApp, deliverPush, enqueueGuardianNotices, enqueueReportNotices, vapidKeys, webPushSender, type PushSender } from './push.js';
import { buildGuardianViewAdminApp } from './guardian-view.js';
import { OAUTH_PUBLIC_ROUTES, buildOAuthApp, devProviderSpecs, linkIdentity, oauthConfigFrom } from './oauth.js';
import { buildOperatorLoginApp, ensureOperatorLoginSchema, exchangeOperatorSession, teacherRoleHandler } from './operator-login.js';
import { GUARDIAN_OAUTH_PUBLIC_ROUTES, buildGuardianOAuthApp, guardianOAuthHandler } from './guardian-oauth.js';
import { STUDENT_PUBLIC_ROUTES, buildStudentAccountApp } from './student-account.js';
import { ED_LINK_PUBLIC_ROUTES, buildEdLinkApp } from './ed-link.js';
import { buildLessonAudioApp, cloudflareRealtime, realtimeConfigFrom } from './lesson-audio.js';
import { SITE_PUBLIC_ROUTES, buildSiteApp } from './site.js';
import { BILLING_PUBLIC_ROUTES, buildBillingApp, sweepBillingContacts } from './billing.js';
import { FREE_PLAY_PUBLIC_ROUTES, buildFreePlayApp, guestPassFromRequest, sweepEndedGuestCells } from './free-play.js';
import { SHOWROOM_PUBLIC_ROUTES, buildShowroomApp } from './showroom.js';
import { MY_WORLD_PUBLIC_ROUTES, buildMyWorldApp, readMyWorld } from './my-world.js';
import { applyLessonTrade, ownedForTrade } from './lesson-trade.js';
import { injectReportShareMeta } from './report-page.js';
import { htmlForClient } from './html-cache.js';
import { injectShowroomShareMeta, showroomTokenFromPath } from './showroom-page.js';
import { createInitialPlayerState } from '@lcw/sim-core';
import { z } from 'zod';
import { FREE_TIER_LIMITS, OPS_SHARE, ttsNeurons, type QuotaMeter, type TtsEngine } from '@lcw/quota';
import type { LlmConverseInput } from '@lcw/schemas';
import { createEdgeApp } from './app.js';
import { priceIndexOf, runWeeklyPriceIndexes } from './economy.js';
import { handleServerStt } from './stt.js';
import { isTestPlayerId } from './nickname.js';
import { TTS_UPLOAD, handleTts, handleTtsUpload, localLinesList, parseTryVoice, prebuildFixedLines, runTtsCron, synthesize, ttsStatus, type TtsDeps } from './tts.js';
import { normalizeTtsText } from '@lcw/content';
import { activeLessonStarts, buildQuotaAdminApp, createDayMeter, ensureQuotaSchema, quotaHealth, readQuotaSettings, rollupQuota } from './quota.js';
import {
  createDurableSqliteExecutor,
  prefixedExecutor,
  PrefixedStore,
  SqliteBlobStore,
  worldPrefix,
  type DurableStorageLike
} from './do-sqlite.js';
import { EdgePlatformDb, LessonDO, WorldDO, type SqliteExecutor } from './storage.js';
import { ROOM_CONNECT_PATH, ROOM_TICKET_SCHEMA, buildRoomApp, redeemRoomTicket, routeRoomConnect } from './room.js';
import { OPS_CARD_ORIGIN, enqueuePendingAutoCloseCards, enqueueRecentStudentDays } from './ops-cards.js';

/**
 * Production platform (entry module: worker.ts). One SQLite Durable Object ("platform") holds the relational
 * data that docs/02 §9.1 puts in D1 plus every world (table-prefixed). The synchronous DO SQL API
 * lets the tested storage code run unchanged. Static pages (apps/web at /, apps/client at /world/)
 * are served by Workers static assets; only /v1/* and /health reach this code.
 */

interface AiBinding {
  run(model: string, input: unknown): Promise<unknown>;
}
interface DoStub {
  fetch(input: Request | string, init?: RequestInit): Promise<Response>;
}
interface DoNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): DoStub;
}
interface AssetsBinding {
  fetch(request: Request): Promise<Response>;
}
export interface LcwEnv {
  PLATFORM: DoNamespace;
  /** Multi rooms (room.ts WorldRoomDO), one per room name. Unbound → /v1/room/connect answers 503. */
  WORLD_ROOM?: DoNamespace;
  ASSETS?: AssetsBinding;
  AI?: AiBinding;
  /**
   * Toss Payments (billing.ts, R326). Both set → online card payment ('live'); either unset → test mode (orders wait for a
   * bank transfer in the operator inbox). Secrets: `wrangler secret put TOSS_CLIENT_KEY` / `TOSS_SECRET_KEY`.
   */
  TOSS_CLIENT_KEY?: string;
  TOSS_SECRET_KEY?: string;
  /** Operator (teacher) token — `wrangler secret put LCW_OPERATOR_TOKEN`. Unset → gated routes fail closed. */
  LCW_OPERATOR_TOKEN?: string;
  /** Secret: teacher/operator Google emails, comma separated (operator-login.ts). Never in the repository. */
  LCW_OPERATOR_GOOGLE_EMAILS?: string;
  /** English Day site (ed-link.ts) that signs the student hand-off tickets; default https://engday.pages.dev. */
  ENGDAY_ORIGIN?: string;
  BUILD_SHA?: string;
  /** R2 bucket for children's voice clips (voice.ts). Unbound → uploads answer 503 and nothing is stored. */
  VOICE?: R2BucketLike;
  /** Neural NPC voice (tts.ts): "on" serves /v1/tts to players; anything else keeps the device voice (default off). */
  TTS_NEURAL?: string;
  /**
   * "on" lets a Worker without `BUILD_SHA` (a local `wrangler dev`) call Workers AI (workersAi). Off by default: the
   * binding is the real account's even in local dev. Pass `--var LCW_LOCAL_AI:on` only for a check that needs a real
   * model answer.
   */
  LCW_LOCAL_AI?: string;
  /** Cloudflare Realtime SFU app for live lesson listening (lesson-audio.ts). Both unset → the window is text only. */
  REALTIME_APP_ID?: string;
  REALTIME_APP_TOKEN?: string;
  /** Optional TURN key (strict networks); without it ICE uses Cloudflare STUN only. */
  REALTIME_TURN_KEY_ID?: string;
  REALTIME_TURN_KEY_TOKEN?: string;
  /** Local real-path rig only: a stand-in SFU. Never set in production. */
  REALTIME_API_BASE?: string;
  /** Sign-in with Google / Kakao (oauth.ts). A provider without its settings is hidden. */
  LCW_GOOGLE_CLIENT_ID?: string;
  LCW_GOOGLE_CLIENT_SECRET?: string;
  LCW_KAKAO_REST_KEY?: string;
  LCW_KAKAO_CLIENT_SECRET?: string;
  /** Local real-path rig only: a stand-in Google / Kakao (oauth.ts devProviderSpecs). Never set in production. */
  LCW_OAUTH_DEV_PROVIDER?: string;
  /** Site origin the sign-in providers know for their callback; unset → the request's own origin (https). */
  LCW_PUBLIC_ORIGIN?: string;
}
interface DoState {
  storage: DurableStorageLike;
}

/** AI calls per UTC day. Workers AI free tier is 10,000 neurons/day; ~100 neurons per short call. */
export const AI_DAILY_CALL_CAP = Math.floor(FREE_TIER_LIMITS.dailyNeurons / 100);
export const DEMO_WORLD_ID = 'world-demo';
/** Worlds kept in memory at once inside the platform DO (128MB isolate); older ones are rebuilt from SQLite on demand. */
export const MAX_RESIDENT_WORLDS = 16;
/** Share tokens shorter than this are never served (guessable). Server-made tokens are 32+ chars. */
export const MIN_SHARE_TOKEN_CHARS = 16;

/** Routes anyone may call. Everything else under /v1 needs the operator token. */
export function isPublicRoute(method: string, path: string): boolean {
  if (path === '/health' || path === '/v1/health') return true;
  if (method === 'GET' && path === '/v1/trades/scenarios') return true;
  if (method === 'GET' && /^\/v1\/reports\/[^/]+$/.test(path) && path !== '/v1/reports/weekly') return true;
  if (method === 'POST' && path === '/v1/converse/understand') return true;
  // Lesson mode (docs/18): the join code exchange is public; /v1/lesson/* checks its own student token.
  if (method === 'POST' && path === '/v1/join') return true;
  if (path.startsWith('/v1/lesson/')) return true;
  // Guardian (WP-301): /v1/family/* checks its own guardian session token, /v1/device/* the child device token.
  if (FAMILY_PUBLIC_ROUTES.some(([m, re]) => m === method && re.test(path))) return true;
  // Sign-in with Google / Kakao (oauth.ts): state, ticket or ID token checked by the module; /family sign-in links
  // check the guardian session (guardian-oauth.ts).
  if (OAUTH_PUBLIC_ROUTES.some(([m, re]) => m === method && re.test(path))) return true;
  if (GUARDIAN_OAUTH_PUBLIC_ROUTES.some(([m, re]) => m === method && re.test(path))) return true;
  // Student sign-up (student-account.ts): the adult's guardian session, or the waiting device's claim token.
  if (STUDENT_PUBLIC_ROUTES.some(([m, re]) => m === method && re.test(path))) return true;
  // English Day sign-in hand-off (ed-link.ts): the ticket is checked with English Day inside.
  if (ED_LINK_PUBLIC_ROUTES.some(([m, re]) => m === method && re.test(path))) return true;
  // Public site (docs/14): cookie-free counters and the tutoring consult form, see site.ts.
  if (SITE_PUBLIC_ROUTES.some(([m, re]) => m === method && re.test(path))) return true;
  // Paid step after the free trial (R326, billing.ts): plan config, checkout and the Toss confirm check their own input.
  if (BILLING_PUBLIC_ROUTES.some(([m, re]) => m === method && re.test(path))) return true;
  // Showroom (WP-703): GET is the public link; publish/delete check the child device token, see showroom.ts.
  if (SHOWROOM_PUBLIC_ROUTES.some(([m, re]) => m === method && re.test(path))) return true;
  // Multi room tickets (room.ts): lesson, device or operator token, checked inside.
  if (method === 'POST' && path === '/v1/room/ticket') return true;
  // Voice clips (voice.ts): upload checks its one-use token, playback its signature.
  if (VOICE_PUBLIC_ROUTES.some(([m, re]) => m === method && re.test(path))) return true;
  // My world (G07, my-world.ts): checks the child's device or lesson token itself.
  if (MY_WORLD_PUBLIC_ROUTES.some(([m, re]) => m === method && re.test(path))) return true;
  // Free play (free-play.ts): /try sessions and guest pass entry check their own input and tokens.
  if (FREE_PLAY_PUBLIC_ROUTES.some(([m, re]) => m === method && re.test(path))) return true;
  return false;
}

export function isOperator(req: Request, token: string | undefined): boolean {
  if (!token || token.length < 16) return false;
  const h = req.headers.get('authorization') ?? '';
  const given = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (given.length !== token.length) return false;
  let diff = 0;
  for (let i = 0; i < token.length; i++) diff |= token.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

const OPS_SCHEMA = `
create table if not exists ops_runs (task text not null, at integer not null, ok integer not null, detail text not null);
create index if not exists ops_runs_task_at on ops_runs (task, at)
`;

class LazyWorlds extends Map<string, WorldDO> {
  constructor(
    private readonly sql: SqliteExecutor,
    private readonly blobs: SqliteBlobStore
  ) {
    super();
  }
  override get(id: string): WorldDO | undefined {
    const hit = super.get(id);
    if (hit) {
      // refresh LRU position
      super.delete(id);
      super.set(id, hit);
      return hit;
    }
    const row = this.sql.get<{ seed: string; gen_version: number }>(
      'select seed, gen_version from worlds where id = ?',
      [id]
    );
    if (!row) return undefined;
    const w = new WorldDO({
      sql: prefixedExecutor(this.sql, worldPrefix(id)),
      r2: new PrefixedStore(this.blobs, worldPrefix(id)),
      seed: row.seed,
      genVersion: row.gen_version
    });
    // Rebuild saved chunks/objects over the generated terrain. The success path of loadWorldWithRecovery has no
    // await, so the world is fully hydrated before this returns; only the safe-mode fallback continues async.
    void w.loadWorldWithRecovery();
    super.set(id, w);
    while (this.size > MAX_RESIDENT_WORLDS) {
      const oldest = this.keys().next().value as string;
      super.delete(oldest);
    }
    return w;
  }
}

class LazyLessons extends Map<string, LessonDO> {
  constructor(private readonly db: EdgePlatformDb) {
    super();
  }
  override get(id: string): LessonDO | undefined {
    const hit = super.get(id);
    if (hit) return hit;
    const row = this.db.sql.get<{ player_id: string; world_id: string; started_at: number }>(
      'select player_id, world_id, started_at from lessons where id = ?',
      [id]
    );
    if (!row) return undefined;
    const l = new LessonDO(id, this.db, row.player_id, row.world_id, row.started_at);
    super.set(id, l);
    return l;
  }
}

const AdminPlayerSchema = z
  .object({
    family_id: z.string().min(1).max(64),
    guardian_id: z.string().min(1).max(64),
    player_id: z.string().min(1).max(64),
    nickname: z.string().min(1).max(32),
    birth_year: z.number().int().min(2005).max(2025).optional(),
    level: z.enum(['L1', 'L2', 'L3', 'L4', 'L5', 'L6']).optional()
  })
  .strict();
/** Teacher's fix of a registered student: nickname, level, birth year (null = unknown). Only the fields sent change. */
const AdminPlayerPatchSchema = z
  .object({
    nickname: z.string().min(1).max(32).optional(),
    birth_year: z.number().int().min(2005).max(2025).nullable().optional(),
    level: z.enum(['L1', 'L2', 'L3', 'L4', 'L5', 'L6']).optional()
  })
  .strict()
  .refine((o) => Object.keys(o).length > 0, { message: 'nothing_to_change' });
const AdminWorldSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{3,40}$/),
    owner_id: z.string().min(1).max(64),
    name: z.string().min(1).max(40),
    seed: z.string().min(1).max(64).optional(),
    /** docs/03 D10: 생존 도시·창작·아레나·역할극 마을·캠페인 */
    mode: z.enum(['survival_city', 'creative', 'arena', 'roleplay_town', 'campaign']).default('survival_city')
  })
  .strict();
const AdminLessonSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{3,40}$/),
    player_id: z.string().min(1).max(64),
    world_id: z.string().min(1).max(64)
  })
  .strict();

export class PlatformDO {
  readonly sql: SqliteExecutor;
  readonly db: EdgePlatformDb;
  private app: Hono;
  private appDay: string;
  /** Today's quota meter (WP-112): counters in `quota_daily`, limit/outage from `quota_settings`. */
  quota!: QuotaMeter;
  private readonly worlds: LazyWorlds;
  private readonly lessons: LazyLessons;

  constructor(state: DoState, private readonly env: LcwEnv) {
    this.sql = createDurableSqliteExecutor(state.storage);
    this.db = new EdgePlatformDb(this.sql);
    this.sql.exec(OPS_SCHEMA);
    this.sql.exec(ROOM_TICKET_SCHEMA);
    ensureOperatorLoginSchema(this.sql);
    ensureQuotaSchema(this.sql);
    const blobs = new SqliteBlobStore(this.sql);
    this.ensureDemo();
    this.worlds = new LazyWorlds(this.sql, blobs);
    this.lessons = new LazyLessons(this.db);
    this.appDay = utcDay(Date.now());
    this.app = this.buildApp(this.appDay);
  }

  /** The QuotaMeter is per UTC day; a DO can live for days, so the app is rebuilt when the day changes. */
  private buildApp(day: string): Hono {
    this.quota = createDayMeter(this.sql, day);
    const inner = createEdgeApp({
      db: this.db,
      worlds: this.worlds,
      lessons: this.lessons,
      quota: this.quota,
      nowMs: () => Date.now(),
      // The understand route awaits the model but does not use its answer yet, so calling it would only burn the
      // daily Workers AI budget. Wire runAiCapped back in when the LLM reply is consumed (docs/04 §4.4).
      runWorkersAi: undefined,
      priceIndex: (worldId) => priceIndexOf(this.sql, worldId),
      // No R2 binding → no offer: the device then records nothing.
      offerVoiceUpload: async (p) =>
        this.env.VOICE
          ? offerVoiceUpload({ sql: this.sql, db: this.db, randomBytes: (n) => crypto.getRandomValues(new Uint8Array(n)), sha256Hex }, p)
          : null
    });
    return buildGatedApp(inner, this.env, this);
  }

  /** Operator settings changed: today's meter follows at once (the next day's meter reads them when it is built). */
  applyQuotaSettings(): void {
    const s = readQuotaSettings(this.sql);
    this.quota.setDailyNeuronsLimit(s.dailyNeurons);
    this.quota.setProviderOutage(s.outage);
  }

  /**
   * Every Workers AI call goes through the meter (AGENTS 4.8): the degrade ladder decides (stage 1+ keeps creative
   * AI for lesson rooms, stage 3+ and limit 0 are bank only), the neurons are counted before the call so a failed
   * call never overshoots, and the durable per-day call count stays as a second cap. Null = use the bank.
   */
  async runAiCapped(model: string, input: LlmConverseInput, opts: { seatId?: string; isLesson?: boolean; neurons?: number } = {}): Promise<unknown> {
    const day = utcDay(Date.now());
    const used = this.sql.get<{ used: number }>(
      "select used from quota_daily where day = ? and k = 'ai_calls'",
      [day]
    )?.used ?? 0;
    const ai = workersAi(this.env);
    if (used >= AI_DAILY_CALL_CAP || !ai) return null;
    const now = Date.now();
    this.quota.setScheduledLessons(activeLessonStarts(this.sql, now));
    const seatId = opts.seatId ?? 'server';
    if (!this.quota.canUseCreativeLlm({ seatId, isLesson: opts.isLesson ?? false, nowMs: now })) return null;
    if (!this.quota.consumeNeurons(seatId, opts.neurons ?? 100, 'llm')) return null;
    this.sql.run(
      "insert into quota_daily (day, k, used) values (?, 'ai_calls', 1) on conflict(day, k) do update set used = used + 1",
      [day]
    );
    return ai.run(model, input);
  }

  private ensureDemo(): void {
    const now = Date.now();
    this.db.ensureFamilyAndPlayer({
      familyId: 'fam-demo',
      guardianId: 'guardian-demo',
      playerId: 'player-demo',
      nickname: 'Demo',
      nowMs: now
    });
    this.sql.run(
      'insert or ignore into worlds (id, owner_id, name, seed, gen_version, mode, lang) values (?, ?, ?, ?, ?, ?, ?)',
      [DEMO_WORLD_ID, 'player-demo', 'Demo Town', 'lcw-world-1', 1, 'survival_city', 'en']
    );
  }

  /** Student token → lesson/player (docs/18 tokens), for the student's own solo scoring path. */
  studentFromRequest(req: Request): Promise<{ lesson_id: string; player_id: string } | null> {
    return studentFromRequest({ sql: this.sql, sha256Hex, nowMs: () => Date.now() }, req);
  }

  /**
   * The lesson child is talking somewhere off the town screen (the adventure's 🎤 with the same lesson token, the
   * day's last box): a sign of life, so the idle sweep does not close the lesson while the town polls stop. Same rule
   * as the adventure's away poll (GET /v1/lesson/state?away=adventure, PR 172): only lesson_presence.last_seen_at moves
   * (never back); the scene the console shows stays what the last poll said, and the town stage's minutes do not run.
   */
  lessonChildSeen(lessonId: string, now = Date.now()): void {
    this.sql.run(
      `insert into lesson_presence (lesson_id, last_seen_at) values (?, ?)
       on conflict(lesson_id) do update set last_seen_at = max(lesson_presence.last_seen_at, excluded.last_seen_at)`,
      [lessonId, now]
    );
  }

  /**
   * Linked child device token (guardian /link → `lcw.deviceToken`, same checks as GET /v1/device/me) → player,
   * for solo play outside a lesson.
   */
  async deviceFromRequest(req: Request): Promise<{ device_id: string; player_id: string } | null> {
    const h = req.headers.get('authorization') ?? '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : '';
    if (token.length < 32) return null;
    const dev = this.sql.get<{ id: string; player_id: string; created_at: number }>(
      'select id, player_id, created_at from devices where token_hash = ? and revoked_at is null',
      [await sha256Hex(token)]
    );
    if (!dev || Date.now() - dev.created_at > DEVICE_TOKEN_TTL_MS) return null;
    return { device_id: dev.id, player_id: dev.player_id };
  }

  playerLevel(playerId: string): string {
    return this.sql.get<{ level: string }>('select level from players where id = ?', [playerId])?.level ?? 'L1';
  }

  /**
   * The student's own home world holds their coin ledger. Created on first solo order with the starting purse of
   * a new player (sim-core createInitialPlayerState), granted once.
   */
  ensureHomeWorld(playerId: string): string {
    const id = homeWorldId(playerId);
    this.sql.run(
      'insert or ignore into worlds (id, owner_id, name, seed, gen_version, mode, lang) values (?, ?, ?, ?, ?, ?, ?)',
      [id, playerId, 'Home', id, 1, 'survival_city', 'en']
    );
    const w = this.worlds.get(id);
    if (w && !w.sql.get('select 1 as x from ledger where player = ? and reason = ?', [playerId, 'starter'])) {
      w.appendLedger(playerId, createInitialPlayerState(playerId).coins, 'starter', 'starter', Date.now());
    }
    return id;
  }

  /**
   * One coin balance per child: the home-world ledger (same one solo orders pay from). Lesson stars are credited
   * here once per utterance (`ref` = the utterance id), so the 3D client, the dialog window and /join all show it.
   */
  creditCoins(playerId: string, delta: number, reason: string, ref: string, nowMs: number): number {
    const w = this.worlds.get(this.ensureHomeWorld(playerId));
    if (!w) return 0;
    if (delta !== 0 && !w.sql.get('select 1 as x from ledger where player = ? and ref = ?', [playerId, ref])) {
      w.appendLedger(playerId, delta, reason, ref, nowMs);
    }
    return w.getPlayerBalance(playerId);
  }

  /** The child's home world (its items, ledger), created if missing: lesson trades with the teacher move things there. */
  homeWorld(playerId: string): WorldDO | undefined {
    return this.worlds.get(this.ensureHomeWorld(playerId));
  }

  coinBalance(playerId: string): number {
    return this.worlds.get(this.ensureHomeWorld(playerId))?.getPlayerBalance(playerId) ?? 0;
  }

  recordRun(task: string, ok: boolean, detail: unknown): void {
    this.sql.run('insert into ops_runs (task, at, ok, detail) values (?, ?, ?, ?)', [
      task,
      Date.now(),
      ok ? 1 : 0,
      JSON.stringify(detail).slice(0, 2000)
    ]);
    // keep 90 days of run history
    this.sql.run('delete from ops_runs where at < ?', [Date.now() - 90 * 86_400_000]);
  }

  voiceStore(): VoiceBlobStore | null {
    return this.env.VOICE ? r2VoiceStore(this.env.VOICE) : null;
  }

  /**
   * Voice clip deletion (voice.ts), its own ops run: hourly drains the purge queue into R2 (consent revocations R2
   * refused at the time), daily 03:00 first queues clips past retention (last seat end + 12 months).
   */
  async runVoiceCron(cron: string, now: number): Promise<unknown> {
    if (cron === '0 6 * * 1') return null;
    const task = cron === '0 3 * * *' ? 'daily_voice_retention' : 'hourly_voice_purge';
    try {
      const expired = cron === '0 3 * * *' ? queueExpiredVoice(this.sql, now) : {};
      const store = this.voiceStore();
      const purge = await drainVoicePurge(this.sql, store);
      const detail = { ...expired, ...purge, store_bound: store !== null };
      this.recordRun(task, purge.failed === 0, detail);
      return detail;
    } catch (err) {
      const detail = { error: err instanceof Error ? err.message : String(err) };
      this.recordRun(task, false, detail);
      return detail;
    }
  }

  async pushSender(): Promise<PushSender> {
    return webPushSender(await vapidKeys(this.sql), (i, init) => fetch(i, init), () => Date.now());
  }

  /** Right after a lesson report is made: queue its notice and send it if sending is on (otherwise it is held). */
  async pushReportNotices(now: number): Promise<unknown> {
    const queued = enqueueReportNotices(this.sql, (n) => crypto.getRandomValues(new Uint8Array(n)), now);
    if (!queued) return { queued };
    const r = await deliverPush(this.sql, await this.pushSender(), now, 10);
    this.recordRun('report_push', r.failed === 0, { queued, ...r });
    return { queued, ...r };
  }

  /** Hourly guardian push notices (push.ts): queue fresh seat/refund/report notices, send them if sending is on. */
  async runPushCron(cron: string, now: number): Promise<unknown> {
    if (cron !== '0 * * * *') return null;
    try {
      const queued = enqueueGuardianNotices(this.sql, (n) => crypto.getRandomValues(new Uint8Array(n)), now);
      const r = await deliverPush(this.sql, await this.pushSender(), now);
      const detail = { queued, ...r };
      this.recordRun('hourly_push', r.failed === 0, detail);
      return detail;
    } catch (err) {
      const detail = { error: err instanceof Error ? err.message : String(err) };
      this.recordRun('hourly_push', false, detail);
      return detail;
    }
  }

  /** Hourly seat notices (docs/09 시간별 "좌석 만료 안내"), recorded as their own ops run. */
  runSeatNotices(now: number): number | { error: string } {
    try {
      const n = sweepSeatNotices(this.sql, now);
      // closed online orders let go of the guardian's name and contact after the retention (billing.ts)
      sweepBillingContacts(this.sql, now);
      this.recordRun('hourly_seat_notices', true, { recorded: n });
      return n;
    } catch (err) {
      const detail = { error: err instanceof Error ? err.message : String(err) };
      this.recordRun('hourly_seat_notices', false, detail);
      return detail;
    }
  }

  /** One ended pass's friend-cell marks out of the host child's home world (none if that plot never had a guest). */
  private dropGuestCells(playerId: string, grantId: string): number {
    const prefix = worldPrefix(homeWorldId(playerId));
    const has = this.sql.get<{ n: number }>("select count(*) as n from sqlite_master where type = 'table' and name = ?", [`${prefix}_plot_guest_cells`]);
    if (!has || Number(has.n) === 0) return 0;
    const w = prefixedExecutor(this.sql, prefix);
    const n = Number(w.get<{ n: number }>('select count(*) as n from plot_guest_cells where grant_id = ?', [grantId])?.n ?? 0);
    if (n > 0) w.run('delete from plot_guest_cells where grant_id = ?', [grantId]);
    return n;
  }

  /** Set when the routes are built (lesson-mode.ts sweepIdleLessons). */
  lessonSweep: ((now: number, origin: string | null, dryRun?: boolean) => IdleSweepResult) | null = null;

  /** Abandoned lessons closed on every cron, recorded as their own ops run only when something closed or it failed. */
  sweepIdleLessons(cron: string): IdleSweepResult | { error: string } {
    try {
      const r = this.lessonSweep?.(Date.now(), this.env.LCW_PUBLIC_ORIGIN ?? null) ?? { open: 0, idle: [], closed: [], cards: [], dry_run: false };
      // A card that could not be queued fails the run (the teacher's console box still lists the lesson).
      const cardFailed = r.cards.some((x) => x.card.startsWith('failed:'));
      if (r.closed.length || cron === '0 3 * * *') {
        this.recordRun('lesson_idle_sweep', !cardFailed, { cron, open: r.open, closed: r.closed, cards: r.cards });
      }
      return r;
    } catch (err) {
      const detail = { error: err instanceof Error ? err.message : String(err) };
      this.recordRun('lesson_idle_sweep', false, { cron, ...detail });
      return detail;
    }
  }

  runCron(cron: string): { task: string; ok: boolean; detail: unknown } {
    const now = Date.now();
    let task = 'hourly_quota_rollup';
    let detail: unknown = {};
    try {
      if (cron === '0 3 * * *') {
        task = 'daily_retention_cleanup';
        // docs/16: audio is only kept with an active voice_store consent → drop audio refs whose consent was revoked.
        this.sql.run(
          `update utterances set audio_first = null, audio_final = null
           where (audio_first is not null or audio_final is not null)
             and player_id not in (select player_id from consents where scope = 'voice_store' and granted_at is not null and revoked_at is null)`
        );
        // docs/19 §8: a pass that is over drops its friend-cell marks (the blocks stay, as the host's). Its own try: a
        // failure here never hides the audio purge above.
        let guestCells: unknown;
        try {
          guestCells = sweepEndedGuestCells(this.sql, now, (playerId, grantId) => this.dropGuestCells(playerId, grantId));
        } catch (err) {
          guestCells = { error: err instanceof Error ? err.message : String(err) };
        }
        // a failure shows on the ops runs as its own failed line (the retention task itself still ran)
        const gc = guestCells as { error?: string; failed?: number };
        if (gc.error || (gc.failed ?? 0) > 0) this.recordRun('daily_guest_cells', false, guestCells);
        detail = { purged_audio_without_consent: true, guest_cells: guestCells };
      } else if (cron === '0 6 * * 1') {
        task = 'weekly_parent_reports';
        const players = this.sql.all<{ player_id: string }>(
          'select distinct player_id from utterances where created_at >= ?',
          [now - 7 * 86_400_000]
        );
        // docs/09 P7: each world's price index from its own income vs spend (never server-wide).
        const prices = runWeeklyPriceIndexes(this.sql, now);
        detail = { players_with_speech: players.length, price_index: prices };
      } else {
        // Seat notices run in their own try: a failure there never hides the report reminders, and the reverse.
        const seats = this.runSeatNotices(now);
        // docs/09-ops.md 15: each student's day record goes to the hub outbox every hour, lessons or not. Own try too.
        let studentCards: unknown;
        try {
          studentCards = enqueueRecentStudentDays(this.sql, now, this.env.LCW_PUBLIC_ORIGIN ?? OPS_CARD_ORIGIN).length;
        } catch (err) {
          studentCards = { error: err instanceof Error ? err.message : String(err) };
          this.recordRun('hourly_student_cards', false, studentCards);
        }
        // Auto-closed lessons still waiting for the teacher: their card goes again only when it changed (keep, PR 162).
        let autoCards: unknown;
        try {
          autoCards = enqueuePendingAutoCloseCards(this.sql, now, this.env.LCW_PUBLIC_ORIGIN ?? null).length;
        } catch (err) {
          autoCards = { error: err instanceof Error ? err.message : String(err) };
          this.recordRun('hourly_auto_close_cards', false, autoCards);
        }
        const r = this.db.processPendingReportReminders(now);
        // docs/09 P9: the day's stage; a day that reached 85% is kept as an alert day.
        const quota = rollupQuota(this.sql, this.quota, now);
        detail = { reminded: r.remindedCount, seat_notices: seats, quota, student_cards: studentCards, auto_close_cards: autoCards };
      }
      this.recordRun(task, true, detail);
      return { task, ok: true, detail };
    } catch (err) {
      detail = { error: err instanceof Error ? err.message : String(err) };
      this.recordRun(task, false, detail);
      return { task, ok: false, detail };
    }
  }

  health(): Record<string, unknown> {
    const count = (q: string): number => Number(this.sql.get<{ n: number }>(q)?.n ?? 0);
    const lastRuns = this.sql.all<{ task: string; at: number; ok: number }>(
      'select task, max(at) as at, ok from ops_runs group by task'
    );
    return {
      ok: true,
      service: 'lcw-edge',
      runtime: 'cloudflare-workers',
      storage: 'durable-object-sqlite',
      build: this.env.BUILD_SHA ?? 'dev',
      operator_token: Boolean(this.env.LCW_OPERATOR_TOKEN),
      ai_binding: Boolean(this.env.AI),
      counts: {
        players: count('select count(*) as n from players'),
        worlds: count('select count(*) as n from worlds'),
        utterances: count('select count(*) as n from utterances'),
        lessons: count('select count(*) as n from lessons'),
        reports: count('select count(*) as n from reports')
      },
      last_runs: Object.fromEntries(lastRuns.map((r) => [r.task, { at: r.at, ok: r.ok === 1 }])),
      ai_calls_today:
        this.sql.get<{ used: number }>("select used from quota_daily where day = ? and k = 'ai_calls'", [
          utcDay(Date.now())
        ])?.used ?? 0,
      ai_daily_cap: AI_DAILY_CALL_CAP,
      quota: quotaHealth(this.sql, this.quota, Date.now())
    };
  }

  async fetch(original: Request): Promise<Response> {
    // A teacher device's operator session (operator-login.ts) acts as the operator key from here on.
    const request = await exchangeOperatorSession(
      { sql: this.sql, nowMs: () => Date.now(), sha256Hex, allowedEmails: this.env.LCW_OPERATOR_GOOGLE_EMAILS },
      original,
      this.env.LCW_OPERATOR_TOKEN
    );
    const day = utcDay(Date.now());
    if (day !== this.appDay) {
      this.appDay = day;
      this.app = this.buildApp(day);
    }
    // The lesson reserve follows the lessons table (a lesson started from any device holds it at once).
    if (new URL(request.url).pathname.startsWith('/v1/converse/')) this.quota.setScheduledLessons(activeLessonStarts(this.sql, Date.now()));
    const res = await this.app.fetch(request);
    // Drain a body the route never read (early 401/403/404 answers, `{}` on bodyless POSTs): workerd otherwise fails
    // the next request on the same kept-alive connection ("Can't read from request stream after response has been sent").
    if (request.body && !request.bodyUsed) await request.arrayBuffer().catch(() => undefined);
    return res;
  }
}

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function homeWorldId(playerId: string): string {
  return `home-${playerId}`;
}

function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * The Workers AI binding, or none outside a deploy. Under `wrangler dev` the AI binding is always the real Cloudflare
 * account while the meter is the local object's, so a lane's local checks spent the production day unseen (R2627,
 * 11-16: the talk lane's prebuild on 127.0.0.1:8954 at 05:59 UTC, and 38 Aura lines at 02 UTC with no production
 * voice request; the account counted 18,327 neurons against the meter's 8,555). The request URL cannot tell: with the
 * custom-domain route wrangler dev rewrites url and Host to the production host. Only a deploy sets `BUILD_SHA`
 * (`pnpm deploy:edge`), so without it there is no AI unless `LCW_LOCAL_AI=on`; the clients then keep the device voice
 * and the board. Every AI call in this file takes the binding from here (a test keeps it that way).
 */
export function workersAi(env: Pick<LcwEnv, 'AI' | 'BUILD_SHA' | 'LCW_LOCAL_AI'>): AiBinding | undefined {
  if (!env.AI) return undefined;
  if (!env.BUILD_SHA && env.LCW_LOCAL_AI !== 'on') return undefined;
  return env.AI;
}

export function buildGatedApp(inner: Hono, env: LcwEnv, platform: PlatformDO): Hono {
  const app = new Hono();
  const publicHealth = () => ({ ok: true, service: 'lcw-edge', build: env.BUILD_SHA ?? 'dev' });
  app.get('/health', (c) => c.json(publicHealth()));
  app.get('/v1/health', (c) => c.json(publicHealth()));
  app.onError((err, c) => {
    if (err instanceof SyntaxError) return c.json({ error: 'invalid_json' }, 400);
    return c.json({ error: 'internal_error' }, 500);
  });
  // The Worker redeems a room ticket here before it hands a WebSocket to the room (room.ts routeRoomConnect).
  app.post('/internal/room-ticket', async (c) => {
    if (c.req.header('x-lcw-internal') !== 'room') return c.json({ error: 'forbidden' }, 403);
    const body = (await c.req.json().catch(() => ({}))) as { ticket?: unknown };
    const seat = await redeemRoomTicket({ sql: platform.sql, nowMs: () => Date.now(), sha256Hex }, String(body.ticket ?? ''));
    return seat ? c.json(seat) : c.json({ error: 'bad_ticket' }, 403);
  });
  app.post('/internal/cron', async (c) => {
    if (c.req.header('x-lcw-internal') !== 'cron') return c.json({ error: 'forbidden' }, 403);
    const body = (await c.req.json()) as { cron: string };
    // Every cron closes abandoned lessons (lesson-mode.ts LESSON_IDLE_CLOSE_MS); the 5-minute one does only that.
    const lessons = platform.sweepIdleLessons(body.cron);
    if (body.cron === LESSON_SWEEP_CRON) return c.json({ task: 'lesson_idle_sweep', ok: !('error' in lessons), lessons });
    const r = platform.runCron(body.cron);
    const voice = await platform.runVoiceCron(body.cron, Date.now());
    const push = await platform.runPushCron(body.cron, Date.now());
    // the hourly cron: the morning lesson/NPC prebuild and the nightly leftovers (tts.ts runTtsCron)
    const tts = body.cron === '0 * * * *' ? await runTtsCron(ttsDeps(), Date.now()).catch((e: unknown) => ({ task: 'tts_error', error: String(e).slice(0, 160) })) : null;
    return c.json({ ...r, voice, push, tts, lessons });
  });
  // Children score their own solo orders (docs/19 3: solo submit -> /v1/converse/score) with their lesson token,
  // or outside a lesson with their linked device token. Who, which world and which level come from the token and
  // the server, never from the body (AGENTS 4.7).
  const soloPlayer = async (req: Request): Promise<{ player_id: string; session_id: string; device: boolean } | null> => {
    const student = await platform.studentFromRequest(req);
    if (student) return { player_id: student.player_id, session_id: `solo-${student.lesson_id}`, device: false };
    const device = await platform.deviceFromRequest(req);
    return device ? { player_id: device.player_id, session_id: `solo-${device.device_id}`, device: true } : null;
  };
  /**
   * Seat gate for solo play (WP-704): a device-token write while the child's seat is read-only/archived/refunded
   * answers 403. Reads stay open for the 30 read-only days; lesson tokens are never gated by seats.
   */
  const seatBlocked = (s: { player_id: string; device: boolean }): Response | null => {
    if (!s.device) return null;
    // R326: a child with no seat plays on the server's free-trial clock; this write is one of its beats (seats.ts).
    const refused = soloWriteGate(platform.sql, s.player_id, Date.now());
    return refused ? Response.json(refused, { status: 403 }) : null;
  };
  /** Forwards a child's own request to the inner app with who/which world/level filled in by the server. */
  const forwardSolo = (
    url: string,
    s: { player_id: string; session_id: string },
    body: Record<string, unknown> | null,
    extra: (p: { player_id: string; world_id: string; level: string; session_id: string }) => Record<string, unknown>
  ): Promise<Response> => {
    const ids = {
      player_id: s.player_id,
      world_id: platform.ensureHomeWorld(s.player_id),
      level: platform.playerLevel(s.player_id),
      session_id: s.session_id
    };
    if (body === null) {
      const u = new URL(url);
      for (const [k, v] of Object.entries(extra(ids))) u.searchParams.set(k, String(v));
      return Promise.resolve(inner.fetch(new Request(u.toString(), { method: 'GET' })));
    }
    return Promise.resolve(
      inner.fetch(
        new Request(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...body, ...extra(ids) })
        })
      )
    );
  };
  const readBody = async (c: { req: { json(): Promise<unknown> } }): Promise<Record<string, unknown> | null> => {
    const body = (await c.req.json().catch(() => null)) as unknown;
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  };
  app.post('/v1/converse/score', async (c, next) => {
    if (isOperator(c.req.raw, env.LCW_OPERATOR_TOKEN)) return next();
    const s = await soloPlayer(c.req.raw);
    if (!s) return next();
    // Read the body first: answering a POST before draining it breaks the next request on a kept-alive connection (workerd).
    const body = await readBody(c);
    const blocked = seatBlocked(s);
    if (blocked) return blocked;
    if (!body) return c.json({ error: 'invalid_score_request' }, 400);
    return forwardSolo(c.req.url, s, body, (p) => ({
      strict_bank: true,
      player_id: p.player_id,
      world_id: p.world_id,
      session_kind: 'solo',
      session_id: p.session_id,
      level: p.level,
      interlocutor: 'npc'
    }));
  });
  // Memory-card reviews (docs/03 D8): the same tokens, the child's own cards only.
  app.get('/v1/review/due', async (c, next) => {
    if (isOperator(c.req.raw, env.LCW_OPERATOR_TOKEN)) return next();
    const s = await soloPlayer(c.req.raw);
    if (!s) return next();
    return forwardSolo(c.req.url, s, null, (p) => ({ player_id: p.player_id, world_id: p.world_id }));
  });
  app.post('/v1/furniture/read-aloud', async (c, next) => {
    if (isOperator(c.req.raw, env.LCW_OPERATOR_TOKEN)) return next();
    const s = await soloPlayer(c.req.raw);
    if (!s) return next();
    const body = await readBody(c);
    if (!body) return c.json({ error: 'invalid_read_aloud_request' }, 400);
    return forwardSolo(c.req.url, s, body, (p) => ({ player_id: p.player_id, world_id: p.world_id, level: p.level }));
  });
  app.get('/v1/errand', async (c, next) => {
    if (isOperator(c.req.raw, env.LCW_OPERATOR_TOKEN)) return next();
    const s = await soloPlayer(c.req.raw);
    if (!s) return next();
    return forwardSolo(c.req.url, s, null, (p) => ({ player_id: p.player_id }));
  });
  app.get('/v1/furniture/discounts', async (c, next) => {
    if (isOperator(c.req.raw, env.LCW_OPERATOR_TOKEN)) return next();
    const s = await soloPlayer(c.req.raw);
    if (!s) return next();
    return forwardSolo(c.req.url, s, null, (p) => ({ player_id: p.player_id }));
  });
  app.post('/v1/review/attempt', async (c, next) => {
    if (isOperator(c.req.raw, env.LCW_OPERATOR_TOKEN)) return next();
    const s = await soloPlayer(c.req.raw);
    if (!s) return next();
    // Read the body first: answering a POST before draining it breaks the next request on a kept-alive connection (workerd).
    const body = await readBody(c);
    const blocked = seatBlocked(s);
    if (blocked) return blocked;
    if (!body) return c.json({ error: 'invalid_review_request' }, 400);
    return forwardSolo(c.req.url, s, body, (p) => ({ player_id: p.player_id, world_id: p.world_id, level: p.level }));
  });
  // Repair NPC, the child's things, collection books and settings (docs/09 P4, G03/G04/G10): the same child tokens,
  // the child's own records only. Reads stay open while a seat is paused; writes that are play (pick, carry, hold)
  // are gated like a review attempt. Settings are not play, so a paused seat may still save them.
  const soloRead = (path: string, extra?: (p: { player_id: string; world_id: string }) => Record<string, unknown>) =>
    app.get(path, async (c, next) => {
      if (isOperator(c.req.raw, env.LCW_OPERATOR_TOKEN)) return next();
      const s = await soloPlayer(c.req.raw);
      if (!s) return next();
      return forwardSolo(c.req.url, s, null, (p) => extra?.(p) ?? { player_id: p.player_id, world_id: p.world_id });
    });
  const soloWrite = (path: string, invalid: string, pick: (b: Record<string, unknown>) => Record<string, unknown>) =>
    app.post(path, async (c, next) => {
      if (isOperator(c.req.raw, env.LCW_OPERATOR_TOKEN)) return next();
      const s = await soloPlayer(c.req.raw);
      if (!s) return next();
      // Read the body first: answering a POST before draining it breaks the next request on a kept-alive connection (workerd).
      const body = await readBody(c);
      const blocked = seatBlocked(s);
      if (blocked) return blocked;
      if (!body) return c.json({ error: invalid }, 400);
      return forwardSolo(c.req.url, s, pick(body), (p) => ({ player_id: p.player_id, world_id: p.world_id }));
    });
  soloRead('/v1/review/repair');
  soloWrite('/v1/review/repair/pick', 'invalid_repair_pick', (b) => ({ item_id: b.item_id }));
  soloRead('/v1/items');
  soloWrite('/v1/items/equip', 'invalid_equip_request', (b) => ({ item_id: b.item_id, to: b.to }));
  soloWrite('/v1/items/use', 'invalid_use_request', (b) => ({ item_key: b.item_key }));
  // Town shop, daily quests and child-to-child trades (shop.ts, Dan R326 ⑤⑪⑫): the child's own ledger and things only.
  soloRead('/v1/shop');
  soloWrite('/v1/shop/buy', 'invalid_buy_request', (b) => ({ item_key: b.item_key, request_id: b.request_id }));
  soloWrite('/v1/shop/sell', 'invalid_sell_request', (b) => ({ item_id: b.item_id }));
  soloWrite('/v1/quests/claim', 'invalid_claim', (b) => ({ quest: b.quest }));
  // Trades are seen by the people in the same room, and the server names the room from the token exactly as the
  // multi room does (room.ts roomSeatFor): a lesson's room or the family's room, never a name the client sends.
  const tradeRoom = async (req: Request): Promise<string | null> => {
    const student = await platform.studentFromRequest(req);
    if (student) return `lesson-${student.lesson_id}`;
    const device = await platform.deviceFromRequest(req);
    if (!device) return null;
    const fam = platform.sql.get<{ family_id: string }>('select family_id from players where id = ?', [device.player_id])?.family_id;
    return fam ? `family-${fam}` : null;
  };
  app.get('/v1/p2p/offers', async (c, next) => {
    if (isOperator(c.req.raw, env.LCW_OPERATOR_TOKEN)) return next();
    const s = await soloPlayer(c.req.raw);
    if (!s) return next();
    const room = await tradeRoom(c.req.raw);
    if (!room) return c.json({ error: 'no_room' }, 404);
    return forwardSolo(c.req.url, s, null, (p) => ({ player_id: p.player_id, world_id: p.world_id, room }));
  });
  app.post('/v1/p2p/offer', async (c, next) => {
    if (isOperator(c.req.raw, env.LCW_OPERATOR_TOKEN)) return next();
    const s = await soloPlayer(c.req.raw);
    if (!s) return next();
    const body = await readBody(c);
    const blocked = seatBlocked(s);
    if (blocked) return blocked;
    if (!body) return c.json({ error: 'invalid_offer' }, 400);
    const room = await tradeRoom(c.req.raw);
    if (!room) return c.json({ error: 'no_room' }, 404);
    return forwardSolo(c.req.url, s, { item_id: body.item_id, price: body.price, said: body.said }, (p) => ({ player_id: p.player_id, world_id: p.world_id, room }));
  });
  app.post('/v1/p2p/accept', async (c, next) => {
    if (isOperator(c.req.raw, env.LCW_OPERATOR_TOKEN)) return next();
    const s = await soloPlayer(c.req.raw);
    if (!s) return next();
    const body = await readBody(c);
    const blocked = seatBlocked(s);
    if (blocked) return blocked;
    if (!body) return c.json({ error: 'invalid_accept' }, 400);
    const room = await tradeRoom(c.req.raw);
    if (!room) return c.json({ error: 'no_room' }, 404);
    return forwardSolo(c.req.url, s, { offer_id: body.offer_id, said: body.said }, (p) => ({ player_id: p.player_id, world_id: p.world_id, room }));
  });
  soloWrite('/v1/p2p/cancel', 'invalid_cancel', (b) => ({ offer_id: b.offer_id }));
  soloRead('/v1/collection');
  soloRead('/v1/settings', (p) => ({ player_id: p.player_id }));
  app.put('/v1/settings', async (c, next) => {
    if (isOperator(c.req.raw, env.LCW_OPERATOR_TOKEN)) return next();
    const s = await soloPlayer(c.req.raw);
    if (!s) return next();
    const body = await readBody(c);
    if (!body) return c.json({ error: 'invalid_settings', reason: 'settings_not_object' }, 400);
    return inner.fetch(
      new Request(c.req.url, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ settings: body.settings, player_id: s.player_id })
      })
    );
  });
  // Server speech recognition for the child's own dialog turn (docs/02 6장): lesson or device token only, through
  // the quota meter, audio never kept (stt.ts).
  app.post('/v1/converse/stt', async (c) => {
    const drain = () => (c.req.raw.body && !c.req.raw.bodyUsed ? c.req.raw.body.cancel().catch(() => undefined) : undefined);
    const student = await platform.studentFromRequest(c.req.raw);
    const device = student ? null : await platform.deviceFromRequest(c.req.raw);
    const playerId = student?.player_id ?? device?.player_id;
    if (!playerId) {
      await drain();
      return c.json({ error: 'child_token_required' }, 401);
    }
    // a lesson child's turn off the town screen (the adventure) keeps the lesson alive for the idle sweep
    if (student) platform.lessonChildSeen(student.lesson_id);
    const blocked = device ? seatBlocked({ player_id: playerId, device: true }) : null;
    if (blocked) {
      await drain();
      return blocked;
    }
    // smoke-check and demo students spend only the operator and test share (OPS_SHARE)
    const quota = () => (isTestPlayerId(playerId) ? platform.quota.opsView() : platform.quota);
    return handleServerStt(c.req.raw, { player_id: playerId, lesson: Boolean(student) }, { quota, ai: workersAi(env), nowMs: () => Date.now() });
  });
  // Neural NPC voice (tts.ts): cached lines for anyone, new fixed lines through the meter, other text only for a
  // child's own token; off unless TTS_NEURAL=on (the operator may always try and prebuild).
  // `ops`: operator and smoke/demo traffic spends only the operator and test share (OPS_SHARE, R2627); the cron's
  // prebuild is the service's own and stays on the day. No deploy (local `wrangler dev`): no AI (workersAi).
  const ttsDeps = (ops = false): TtsDeps => ({
    enabled: env.TTS_NEURAL === 'on',
    quota: () => (ops ? platform.quota.opsView() : platform.quota),
    ai: workersAi(env),
    store: env.VOICE as TtsDeps['store'],
    nowMs: () => Date.now(),
    sha256Hex
  });
  app.get('/v1/tts/status', (c) => ttsStatus(ttsDeps()));
  app.get('/v1/tts', async (c) => {
    const operator = isOperator(c.req.raw, env.LCW_OPERATOR_TOKEN);
    const student = operator ? null : await platform.studentFromRequest(c.req.raw);
    const device = operator || student ? null : await platform.deviceFromRequest(c.req.raw);
    const playerId = student?.player_id ?? device?.player_id ?? null;
    // smoke-check and demo students hear cached lines only (they never spend the day's neurons)
    const cachedOnly = !!playerId && isTestPlayerId(playerId);
    return handleTts(new URL(c.req.url), { operator, player_id: playerId, lesson: Boolean(student), cachedOnly }, ttsDeps(operator));
  });
  // Operator measurement: one uncached synthesis with its time (engine/voice choice, docs/04 4.8).
  app.post('/v1/admin/tts/try', async (c) => {
    if (!isOperator(c.req.raw, env.LCW_OPERATOR_TOKEN)) return c.json({ error: 'operator_only' }, 401);
    const body = (await c.req.json().catch(() => null)) as { voice?: string; text?: string } | null;
    const voice = parseTryVoice(body?.voice);
    const text = normalizeTtsText(body?.text ?? '');
    const ai = workersAi(env);
    if (!voice || !text || !ai) return c.json({ error: 'voice_text_ai_required' }, 400);
    // through the meter like every AI call (AGENTS 4.8), from the operator and test share only (11-16: two tries
    // spent 289 neurons the meter never saw)
    if (!platform.quota.opsView().consumeNeurons(OPS_SHARE.seat, ttsNeurons(voice.engine as TtsEngine, text.length), 'tts')) {
      return c.json({ error: 'ops_quota', ops: platform.quota.opsStatus() }, 429);
    }
    const t0 = Date.now();
    const bytes = await synthesize(ai, voice, text).catch(() => null);
    if (!bytes) return c.json({ error: 'tts_failed' }, 502);
    return new Response(bytes as unknown as BodyInit, { headers: { 'content-type': 'audio/mpeg', 'cache-control': 'no-store', 'x-lcw-tts-ms': String(Date.now() - t0) } });
  });
  // Local open-weights voice (R2625): the operator's GPU makes the model voice's fixed lines and uploads them here
  // (tools/tts-local in the automation repo, nightly); the list it makes comes from the deployed code.
  app.get('/v1/admin/tts/local-lines', (c) => {
    if (!isOperator(c.req.raw, env.LCW_OPERATOR_TOKEN)) return c.json({ error: 'operator_only' }, 401);
    return c.json(localLinesList(), 200, { 'cache-control': 'no-store' });
  });
  app.put('/v1/admin/tts/line', async (c) => {
    if (!isOperator(c.req.raw, env.LCW_OPERATOR_TOKEN)) return c.json({ error: 'operator_only' }, 401);
    const declared = Number(c.req.header('content-length') ?? '0');
    if (declared > TTS_UPLOAD.maxBytes) return c.json({ error: 'too_large', max_bytes: TTS_UPLOAD.maxBytes }, 413);
    const body = new Uint8Array(await c.req.arrayBuffer());
    return handleTtsUpload(new URL(c.req.url), body, ttsDeps());
  });
  app.post('/v1/admin/tts/prebuild', async (c) => {
    if (!isOperator(c.req.raw, env.LCW_OPERATOR_TOKEN)) return c.json({ error: 'operator_only' }, 401);
    const body = (await c.req.json().catch(() => ({}))) as { budget_neurons?: number; voice?: string };
    // the operator and test share only (R2627: one call here took the day from 2,957 to 8,122); the full set is the
    // hourly cron's (00 UTC and the 23 UTC leftovers)
    const r = await prebuildFixedLines(ttsDeps(true), { budgetNeurons: body.budget_neurons, voice: body.voice });
    return c.json({ ...r, ops: platform.quota.opsStatus() });
  });
  // My plot (WP-207): the child's own home world, from the same tokens. Building alone is solo play, so a linked
  // device whose seat has paused play may still look (GET) but not build (docs/01 §4; the client shows the notice).
  // A lesson token always may: the lesson is the teacher's time.
  // A friend on a guest pass (docs/19 §8, `x-lcw-guest-pass`) opens the host child's plot while the pass runs and builds
  // there by the guest rules (plot.ts applyOps guestGrant): the host's own build and chest stay theirs. A child's own
  // token wins over a pass on the same request (a linked tablet visiting a friend is still the friend's guest only when
  // it sends no token of its own: the world client sends the pass alone).
  const passVisitor = (req: Request) => guestPassFromRequest({ sql: platform.sql, sha256Hex }, req, Date.now());
  app.get('/v1/plot', async (c, next) => {
    if (isOperator(c.req.raw, env.LCW_OPERATOR_TOKEN)) return next();
    const s = await soloPlayer(c.req.raw);
    if (!s) {
      const g = await passVisitor(c.req.raw);
      if (!g) return next();
      if (!g.active) return c.json({ error: 'pass_ended' }, 410);
      return forwardSolo(c.req.url, { player_id: g.player_id, session_id: `pass-${g.grant_id}` }, null, (p) => ({
        player_id: p.player_id,
        world_id: p.world_id,
        guest_grant: g.grant_id,
        plot_only: '',
        unpack: ''
      }));
    }
    // R326: a lesson token builds on the plot only (the class shares the lesson town); the child's device token anywhere.
    // Opening bought block bundles is a write: only where the seat lets the child play (a read-only seat just looks).
    const unpack = !s.device || playAllowed(platform.sql, s.player_id, Date.now()).allowed;
    return forwardSolo(c.req.url, s, null, (p) => ({ player_id: p.player_id, world_id: p.world_id, guest_grant: '', plot_only: s.device ? '' : '1', unpack: unpack ? '1' : '' }));
  });
  app.post('/v1/plot/ops', async (c, next) => {
    if (isOperator(c.req.raw, env.LCW_OPERATOR_TOKEN)) return next();
    const s = await soloPlayer(c.req.raw);
    if (!s) {
      const g = await passVisitor(c.req.raw);
      if (!g) return next();
      const body = await readBody(c);
      // ended, revoked, or the host's seat stopped (guestPassFromRequest folds the seat in): the friend sees /guest-end
      if (!g.active) return c.json({ error: 'pass_ended' }, 410);
      if (!body) return c.json({ error: 'invalid_plot_ops' }, 400);
      return forwardSolo(c.req.url, { player_id: g.player_id, session_id: `pass-${g.grant_id}` }, { ops: body.ops, batch: body.batch }, (p) => ({
        player_id: p.player_id,
        world_id: p.world_id,
        guest_grant: g.grant_id,
        plot_only: false
      }));
    }
    // Read the body first: answering a POST before draining it breaks the next request on a kept-alive connection (workerd).
    const body = await readBody(c);
    const blocked = seatBlocked(s);
    if (blocked) return blocked;
    if (!body) return c.json({ error: 'invalid_plot_ops' }, 400);
    return forwardSolo(c.req.url, s, { ops: body.ops, batch: body.batch }, (p) => ({ player_id: p.player_id, world_id: p.world_id, plot_only: !s.device }));
  });
  app.use('/v1/*', async (c, next) => {
    if (isPublicRoute(c.req.method, c.req.path)) return next();
    if (!env.LCW_OPERATOR_TOKEN) return c.json({ error: 'operator_token_not_configured' }, 503);
    if (!isOperator(c.req.raw, env.LCW_OPERATOR_TOKEN)) return c.json({ error: 'operator_only' }, 401);
    return next();
  });
  app.post('/v1/admin/players', async (c) => {
    const p = AdminPlayerSchema.safeParse(await c.req.json());
    if (!p.success) return c.json({ error: 'invalid', issues: p.error.issues }, 400);
    platform.db.ensureFamilyAndPlayer({
      familyId: p.data.family_id,
      guardianId: p.data.guardian_id,
      playerId: p.data.player_id,
      nickname: p.data.nickname,
      birthYear: p.data.birth_year,
      level: p.data.level,
      nowMs: Date.now()
    });
    return c.json({ ok: true }, 201);
  });
  app.patch('/v1/admin/players/:id', async (c) => {
    const p = AdminPlayerPatchSchema.safeParse(await c.req.json().catch(() => null));
    if (!p.success) return c.json({ error: 'invalid', issues: p.error.issues }, 400);
    const id = c.req.param('id');
    if (!platform.sql.get('select id from players where id = ?', [id])) return c.json({ error: 'player_not_found' }, 404);
    const cols = Object.entries(p.data).filter(([, v]) => v !== undefined);
    platform.sql.run(`update players set ${cols.map(([k]) => `${k} = ?`).join(', ')} where id = ?`, [...cols.map(([, v]) => v), id]);
    return c.json(platform.sql.get('select id, nickname, level, birth_year from players where id = ?', [id]));
  });
  app.post('/v1/admin/worlds', async (c) => {
    const p = AdminWorldSchema.safeParse(await c.req.json());
    if (!p.success) return c.json({ error: 'invalid', issues: p.error.issues }, 400);
    platform.sql.run(
      'insert or ignore into worlds (id, owner_id, name, seed, gen_version, mode, lang) values (?, ?, ?, ?, ?, ?, ?)',
      [p.data.id, p.data.owner_id, p.data.name, p.data.seed ?? `seed-${p.data.id}`, 1, p.data.mode, 'en']
    );
    return c.json({ ok: true, id: p.data.id }, 201);
  });
  app.post('/v1/admin/lessons', async (c) => {
    const p = AdminLessonSchema.safeParse(await c.req.json());
    if (!p.success) return c.json({ error: 'invalid', issues: p.error.issues }, 400);
    new LessonDO(p.data.id, platform.db, p.data.player_id, p.data.world_id, Date.now());
    return c.json({ ok: true, id: p.data.id }, 201);
  });
  app.get('/v1/admin/health', (c) => c.json(platform.health()));
  // Same body for the ops keeper (operator token): `quota.alert` / `quota.over_85` feed the hub card (docs/09 P9).
  app.get('/v1/ops/health', (c) => c.json(platform.health()));
  app.route('/', buildQuotaAdminApp({ sql: platform.sql, meter: () => platform.quota, nowMs: () => Date.now(), onSettings: () => platform.applyQuotaSettings() }));
  // Public share link: strong tokens only, 30-day life, guardian revocation, allow-listed parent fields (family.ts).
  app.get('/v1/reports/:token', (c) => {
    const token = c.req.param('token');
    if (token === 'weekly' || token.length < MIN_SHARE_TOKEN_CHARS) return c.json({ error: 'report_not_found' }, 404);
    // The director's preview carries the operator token; a parent's open is recorded only without it.
    const r = openPublicReport(platform.sql, platform.db, token, Date.now(), isOperator(c.req.raw, env.LCW_OPERATOR_TOKEN));
    c.header('cache-control', 'private, no-store');
    c.header('referrer-policy', 'no-referrer');
    c.header('x-robots-tag', 'noindex, nofollow');
    if (r.status !== 200) return c.json({ error: r.error }, r.status);
    return c.json(r.view);
  });
  const rtConfig = realtimeConfigFrom(env);
  const realtime = rtConfig ? cloudflareRealtime(rtConfig) : null;
  const familyDeps = {
    sql: platform.sql,
    db: platform.db,
    nowMs: () => Date.now(),
    randomBytes: (n: number) => crypto.getRandomValues(new Uint8Array(n)),
    sha256Hex,
    voiceStore: () => platform.voiceStore(),
    pushSender: async () => platform.pushSender(),
    realtime: () => realtime
  };
  app.route('/', buildFamilyApp(familyDeps));
  const operatorLogin = { ...familyDeps, allowedEmails: env.LCW_OPERATOR_GOOGLE_EMAILS };
  app.route('/', buildOperatorLoginApp(operatorLogin));
  app.route('/', buildStudentAccountApp(familyDeps));
  app.route('/', buildEdLinkApp({ ...familyDeps, engdayOrigin: env.ENGDAY_ORIGIN }));
  app.route('/', buildPushAdminApp(familyDeps));
  app.route('/', buildGuardianViewAdminApp(familyDeps));
  const oauthConfig = oauthConfigFrom(env as unknown as Record<string, unknown>);
  const guardianOAuth = { ...familyDeps, config: oauthConfig };
  app.route('/', buildGuardianOAuthApp(guardianOAuth));
  // Roles plug in here: the teacher handler (operator-login.ts, lesson lane) joins `roles` next to the guardian one.
  app.route(
    '/',
    buildOAuthApp({
      ...familyDeps,
      config: oauthConfig,
      roles: {
        guardian: guardianOAuthHandler(guardianOAuth),
        // Teacher accounts: Google, verified email on the LCW_OPERATOR_GOOGLE_EMAILS secret → an operator session.
        teacher: teacherRoleHandler(operatorLogin, (identity, operatorId) => {
          linkIdentity(platform.sql, { role: 'teacher', identity, subjectId: operatorId }, Date.now());
        })
      },
      specs: env.LCW_OAUTH_DEV_PROVIDER ? devProviderSpecs(env.LCW_OAUTH_DEV_PROVIDER) : undefined,
      publicOrigin: env.LCW_PUBLIC_ORIGIN
    })
  );
  app.route('/', buildVoiceApp({ ...familyDeps, store: () => platform.voiceStore() }));
  app.route('/', buildLessonAudioApp(familyDeps));
  app.route('/', buildSiteApp({ sql: platform.sql, nowMs: familyDeps.nowMs, randomBytes: familyDeps.randomBytes, sha256Hex }));
  app.route(
    '/',
    buildBillingApp({
      sql: platform.sql,
      nowMs: familyDeps.nowMs,
      randomBytes: familyDeps.randomBytes,
      sha256Hex,
      toss: { clientKey: env.TOSS_CLIENT_KEY, secretKey: env.TOSS_SECRET_KEY },
      deviceChild: async (req) => (await platform.deviceFromRequest(req))?.player_id ?? null
    })
  );
  app.route('/', buildFreePlayApp({ sql: platform.sql, nowMs: familyDeps.nowMs, randomBytes: familyDeps.randomBytes, sha256Hex }));
  app.route('/', buildShowroomApp({ ...familyDeps, isOperator: (req) => isOperator(req, env.LCW_OPERATOR_TOKEN) }));
  app.route(
    '/',
    buildRoomApp({
      sql: platform.sql,
      nowMs: () => Date.now(),
      randomBytes: (n) => crypto.getRandomValues(new Uint8Array(n)),
      sha256Hex,
      student: (req) => platform.studentFromRequest(req),
      device: (req) => platform.deviceFromRequest(req),
      isOperator: (req) => isOperator(req, env.LCW_OPERATOR_TOKEN),
      player: (id) => platform.sql.get<{ nickname: string; family_id: string }>('select nickname, family_id from players where id = ?', [id]) ?? null,
      // a live Duo seat: both children play in the payer's family room (R325)
      playFamily: (id) =>
        platform.sql.get<{ family_id: string }>(
          `select g.family_id from seats s join guardians g on g.id = s.payer_id
           where s.player_id = ? and s.plan = 'duo' and s.status <> 'refunded' and s.starts_at <= ? and s.ends_at > ? order by s.starts_at desc limit 1`,
          [id, Date.now(), Date.now()]
        )?.family_id ?? null,
      pass: async (req) => {
        const g = await passVisitor(req);
        return g?.active ? { host_player_id: g.player_id, grant_id: g.grant_id } : null;
      }
    })
  );
  // Operator read-out of one room (members, counters) for load checks and the docs/02 §11 capacity numbers.
  app.get('/v1/admin/rooms/:room', async (c) => {
    if (!env.WORLD_ROOM) return c.json({ error: 'rooms_not_configured' }, 503);
    const room = c.req.param('room');
    const res = await env.WORLD_ROOM.get(env.WORLD_ROOM.idFromName(room)).fetch(new Request('https://room/stats'));
    return c.json({ room, ...((await res.json()) as Record<string, unknown>) });
  });
  app.route(
    '/',
    buildMyWorldApp({
      sql: platform.sql,
      nowMs: familyDeps.nowMs,
      randomBytes: familyDeps.randomBytes,
      soloPlayer,
      passHost: async (req) => {
        const g = await passVisitor(req);
        return g?.active ? g.player_id : null;
      },
      ensureHomeWorld: (playerId) => platform.ensureHomeWorld(playerId)
    })
  );
  app.route('/', buildExportApp({ sql: platform.sql, db: platform.db, nowMs: () => Date.now() }));
  app.get('/v1/admin/ops-runs', (c) =>
    c.json(platform.sql.all('select task, at, ok, detail from ops_runs order by at desc limit 50'))
  );
  const lessonApp = buildLessonModeApp({
      sql: platform.sql,
      db: platform.db,
      nowMs: () => Date.now(),
      randomBytes: (n) => crypto.getRandomValues(new Uint8Array(n)),
      sha256Hex,
      offerVoiceUpload: async (p) =>
        platform.voiceStore()
          ? offerVoiceUpload({ sql: platform.sql, db: platform.db, randomBytes: (n) => crypto.getRandomValues(new Uint8Array(n)), sha256Hex }, p)
          : null,
      // R325: trades with the teacher move the child's things in the home world (lesson-trade.ts)
      trades: {
        owned: (playerId) => ownedForTrade(platform.homeWorld(playerId), playerId),
        apply: (p) => applyLessonTrade(platform.homeWorld(p.playerId), p)
      },
      worldLook: (playerId) => readMyWorld(platform.sql, platform.ensureHomeWorld(playerId)),
      coins: {
        credit: (playerId, delta, ref, nowMs) => platform.creditCoins(playerId, delta, 'lesson_stars', ref, nowMs),
        balance: (playerId) => platform.coinBalance(playerId)
      },
      completeLesson: async (lessonId, body) => {
        const res = await inner.fetch(
          new Request(`https://lcw.internal/v1/lessons/${encodeURIComponent(lessonId)}/complete-and-send-report`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body)
          })
        );
        // docs/09 P5 "공유 링크 → 푸시": the report notice is queued at once (held while sending is off) instead of
        // waiting for the hourly push cron. A push failure never fails the lesson's end.
        if (res.ok) await platform.pushReportNotices(Date.now()).catch(() => undefined);
        return res;
      }
    });
  platform.lessonSweep = lessonApp.sweepIdleLessons;
  app.route('/', lessonApp);
  app.route('/', inner);
  return app;
}

function platformStub(env: LcwEnv): DoStub {
  return env.PLATFORM.get(env.PLATFORM.idFromName('main'));
}

async function routeWorkerRequest(request: Request, env: LcwEnv): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === ROOM_CONNECT_PATH) return routeRoomConnect(request, platformStub(env), env.WORLD_ROOM);
  // The world moved from /game/ to /world/ (world-path.ts): old lesson and pass links keep their query.
  // R329: which way `/` goes depends on the revisit marker: first visit /about, revisit (or a lesson code) /world/.
  const moved = legacyWorldRedirect(url, request.headers.get('cookie'));
  if (moved) return moved;
  if (url.pathname === '/health' || url.pathname.startsWith('/v1/')) {
    return platformStub(env).fetch(request);
  }
  // Report share links get name-free preview tags and no-referrer/noindex (docs/16 §2-18), see report-page.ts.
  if (env.ASSETS && url.pathname.startsWith('/r/')) {
    const shell = await env.ASSETS.fetch(new Request(new URL('/', url), { headers: request.headers }));
    return injectReportShareMeta(shell, url);
  }
  // Showroom share links get the world's own title as preview tags, and 404 once consent is gone (showroom-page.ts).
  if (env.ASSETS && request.method === 'GET' && showroomTokenFromPath(url.pathname)) {
    const shell = await env.ASSETS.fetch(new Request(new URL('/', url), { headers: request.headers }));
    return injectShowroomShareMeta(shell, url, async (token) => {
      const res = await platformStub(env).fetch(new Request(new URL(`/v1/showroom/${token}`, url)));
      return res.ok ? ((await res.json()) as { title: string }) : null;
    });
  }
  // A plain page view marks the browser as a revisit, so the next `/` opens the world (world-path.ts).
  if (env.ASSETS) return withSeenCookie(request, await env.ASSETS.fetch(request));
  return new Response('not found', { status: 404 });
}

export const workerHandler = {
  // Every HTML response leaves with `no-transform` so Cloudflare does not inject its analytics beacon, compressed by
  // the Worker because no-transform also turns off Cloudflare's compression (html-cache.ts).
  async fetch(request: Request, env: LcwEnv): Promise<Response> {
    return htmlForClient(await routeWorkerRequest(request, env), request);
  },
  async scheduled(event: { cron: string; scheduledTime?: number }, env: LcwEnv): Promise<void> {
    // The 5-minute trigger (abandoned-lesson sweep) also carries the hourly tasks at minute 0: the account keeps three
    // cron triggers (Cloudflare counts them per account), and '0 * * * *' stays the hourly task's name everywhere.
    const crons =
      event.cron === LESSON_SWEEP_CRON
        ? new Date(event.scheduledTime ?? Date.now()).getUTCMinutes() < 5
          ? ['0 * * * *']
          : [LESSON_SWEEP_CRON]
        : [event.cron];
    for (const cron of crons) {
      const res = await platformStub(env).fetch('https://platform/internal/cron', {
        method: 'POST',
        headers: { 'x-lcw-internal': 'cron', 'content-type': 'application/json' },
        body: JSON.stringify({ cron })
      });
      if (!res.ok) throw new Error(`cron_failed_${res.status}`);
    }
  }
};
