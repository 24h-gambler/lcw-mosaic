import { Hono } from 'hono';
import { buildLessonModeApp, studentFromRequest } from './lesson-mode.js';
import { FAMILY_PUBLIC_ROUTES, buildFamilyApp, openPublicReport } from './family.js';
import { SITE_PUBLIC_ROUTES, buildSiteApp } from './site.js';
import { injectReportShareMeta } from './report-page.js';
import { createInitialPlayerState } from '@lcw/sim-core';
import { z } from 'zod';
import { FREE_TIER_LIMITS, QuotaMeter } from '@lcw/quota';
import type { LlmConverseInput } from '@lcw/schemas';
import { createEdgeApp } from './app.js';
import {
  createDurableSqliteExecutor,
  prefixedExecutor,
  PrefixedStore,
  SqliteBlobStore,
  worldPrefix,
  type DurableStorageLike
} from './do-sqlite.js';
import { EdgePlatformDb, LessonDO, WorldDO, type SqliteExecutor } from './storage.js';

/**
 * Production platform (entry module: worker.ts). One SQLite Durable Object ("platform") holds the relational
 * data that docs/02 §9.1 puts in D1 plus every world (table-prefixed). The synchronous DO SQL API
 * lets the tested storage code run unchanged. Static pages (apps/web at /, apps/client at /game/)
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
  ASSETS?: AssetsBinding;
  AI?: AiBinding;
  /** Operator (teacher) token — `wrangler secret put LCW_OPERATOR_TOKEN`. Unset → gated routes fail closed. */
  LCW_OPERATOR_TOKEN?: string;
  BUILD_SHA?: string;
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

/** Routes anyone may call. Everything else under /v1 needs the operator token until guardian OAuth (WP-301) exists. */
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
  // Public site (docs/14): cookie-free counters and the tutoring consult form, see site.ts.
  if (SITE_PUBLIC_ROUTES.some(([m, re]) => m === method && re.test(path))) return true;
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
  private readonly worlds: LazyWorlds;
  private readonly lessons: LazyLessons;

  constructor(state: DoState, private readonly env: LcwEnv) {
    this.sql = createDurableSqliteExecutor(state.storage);
    this.db = new EdgePlatformDb(this.sql);
    this.sql.exec(OPS_SCHEMA);
    const blobs = new SqliteBlobStore(this.sql);
    this.ensureDemo();
    this.worlds = new LazyWorlds(this.sql, blobs);
    this.lessons = new LazyLessons(this.db);
    this.appDay = utcDay(Date.now());
    this.app = this.buildApp(this.appDay);
  }

  /** The QuotaMeter is per UTC day; a DO can live for days, so the app is rebuilt when the day changes. */
  private buildApp(day: string): Hono {
    const inner = createEdgeApp({
      db: this.db,
      worlds: this.worlds,
      lessons: this.lessons,
      quota: new QuotaMeter(day),
      nowMs: () => Date.now(),
      // The understand route awaits the model but does not use its answer yet, so calling it would only burn the
      // daily Workers AI budget. Wire runAiCapped back in when the LLM reply is consumed (docs/04 §4.4).
      runWorkersAi: undefined
    });
    return buildGatedApp(inner, this.env, this);
  }

  /** Durable per-day AI counter: the in-memory QuotaMeter resets when the DO is evicted, this does not. */
  async runAiCapped(model: string, input: LlmConverseInput): Promise<unknown> {
    const day = utcDay(Date.now());
    const used = this.sql.get<{ used: number }>(
      "select used from quota_daily where day = ? and k = 'ai_calls'",
      [day]
    )?.used ?? 0;
    if (used >= AI_DAILY_CALL_CAP || !this.env.AI) return null;
    this.sql.run(
      "insert into quota_daily (day, k, used) values (?, 'ai_calls', 1) on conflict(day, k) do update set used = used + 1",
      [day]
    );
    return this.env.AI.run(model, input);
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
        detail = { purged_audio_without_consent: true };
      } else if (cron === '0 6 * * 1') {
        task = 'weekly_parent_reports';
        const players = this.sql.all<{ player_id: string }>(
          'select distinct player_id from utterances where created_at >= ?',
          [now - 7 * 86_400_000]
        );
        detail = { players_with_speech: players.length };
      } else {
        const r = this.db.processPendingReportReminders(now);
        detail = { reminded: r.remindedCount };
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
      ai_daily_cap: AI_DAILY_CALL_CAP
    };
  }

  async fetch(request: Request): Promise<Response> {
    const day = utcDay(Date.now());
    if (day !== this.appDay) {
      this.appDay = day;
      this.app = this.buildApp(day);
    }
    return this.app.fetch(request);
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

export function buildGatedApp(inner: Hono, env: LcwEnv, platform: PlatformDO): Hono {
  const app = new Hono();
  const publicHealth = () => ({ ok: true, service: 'lcw-edge', build: env.BUILD_SHA ?? 'dev' });
  app.get('/health', (c) => c.json(publicHealth()));
  app.get('/v1/health', (c) => c.json(publicHealth()));
  app.onError((err, c) => {
    if (err instanceof SyntaxError) return c.json({ error: 'invalid_json' }, 400);
    return c.json({ error: 'internal_error' }, 500);
  });
  app.post('/internal/cron', async (c) => {
    if (c.req.header('x-lcw-internal') !== 'cron') return c.json({ error: 'forbidden' }, 403);
    const body = (await c.req.json()) as { cron: string };
    return c.json(platform.runCron(body.cron));
  });
  // Students score their own solo orders with their lesson token (docs/19 3: solo submit -> /v1/converse/score).
  // Who, which world and which level come from the token and the server, never from the body (AGENTS 4.7).
  app.post('/v1/converse/score', async (c, next) => {
    if (isOperator(c.req.raw, env.LCW_OPERATOR_TOKEN)) return next();
    const s = await platform.studentFromRequest(c.req.raw);
    if (!s) return next();
    const body = (await c.req.json()) as Record<string, unknown>;
    const forwarded = {
      ...body,
      player_id: s.player_id,
      world_id: platform.ensureHomeWorld(s.player_id),
      session_kind: 'solo',
      session_id: `solo-${s.lesson_id}`,
      level: platform.playerLevel(s.player_id),
      interlocutor: 'npc'
    };
    return inner.fetch(
      new Request(c.req.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(forwarded)
      })
    );
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
  const familyDeps = {
    sql: platform.sql,
    db: platform.db,
    nowMs: () => Date.now(),
    randomBytes: (n: number) => crypto.getRandomValues(new Uint8Array(n)),
    sha256Hex
  };
  app.route('/', buildFamilyApp(familyDeps));
  app.route('/', buildSiteApp({ sql: platform.sql, nowMs: familyDeps.nowMs, randomBytes: familyDeps.randomBytes, sha256Hex }));
  app.get('/v1/admin/ops-runs', (c) =>
    c.json(platform.sql.all('select task, at, ok, detail from ops_runs order by at desc limit 50'))
  );
  app.route(
    '/',
    buildLessonModeApp({
      sql: platform.sql,
      db: platform.db,
      nowMs: () => Date.now(),
      randomBytes: (n) => crypto.getRandomValues(new Uint8Array(n)),
      sha256Hex,
      completeLesson: (lessonId, body) =>
        Promise.resolve(
          inner.fetch(
            new Request(`https://lcw.internal/v1/lessons/${encodeURIComponent(lessonId)}/complete-and-send-report`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(body)
            })
          )
        )
    })
  );
  app.route('/', inner);
  return app;
}

function platformStub(env: LcwEnv): DoStub {
  return env.PLATFORM.get(env.PLATFORM.idFromName('main'));
}

export const workerHandler = {
  async fetch(request: Request, env: LcwEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health' || url.pathname.startsWith('/v1/')) {
      return platformStub(env).fetch(request);
    }
    // Report share links get name-free preview tags and no-referrer/noindex (docs/16 §2-18), see report-page.ts.
    if (env.ASSETS && url.pathname.startsWith('/r/')) {
      const shell = await env.ASSETS.fetch(new Request(new URL('/', url), { headers: request.headers }));
      return injectReportShareMeta(shell, url);
    }
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('not found', { status: 404 });
  },
  async scheduled(event: { cron: string }, env: LcwEnv): Promise<void> {
    const res = await platformStub(env).fetch('https://platform/internal/cron', {
      method: 'POST',
      headers: { 'x-lcw-internal': 'cron', 'content-type': 'application/json' },
      body: JSON.stringify({ cron: event.cron })
    });
    if (!res.ok) throw new Error(`cron_failed_${res.status}`);
  }
};
