import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { SEAT_FAIR_USE_LIMITS } from '@lcw/quota';
import type { DurableStorageLike } from '../do-sqlite.js';
import { BLOB_PART_CHARS, prefixedExecutor, SqliteBlobStore, splitStatements, worldPrefix } from '../do-sqlite.js';
import { createNodeSqliteExecutor } from '../node-sqlite.js';
import { WorldDO, InMemoryR2Store } from '../storage.js';
import { AI_DAILY_CALL_CAP, isOperator, isPublicRoute, PlatformDO, workerHandler as worker, type LcwEnv } from '../platform.js';
import * as entry from '../worker.js';

/**
 * Fake of the Durable Object SQLite storage: like the real API it refuses BEGIN/COMMIT/ROLLBACK/SAVEPOINT
 * through exec() and offers transactionSync instead — so these tests fail if storage code
 * falls back to SQL transaction statements in production.
 */
function fakeDurableStorage(): DurableStorageLike & { forbiddenSeen: string[] } {
  const require = createRequire(import.meta.url);
  const { DatabaseSync } = require('node:sqlite') as {
    DatabaseSync: new (f: string) => {
      exec(s: string): void;
      prepare(s: string): { all(...p: unknown[]): Array<Record<string, unknown>> };
    };
  };
  const db = new DatabaseSync(':memory:');
  const forbiddenSeen: string[] = [];
  return {
    forbiddenSeen,
    sql: {
      exec(query: string, ...bindings: unknown[]) {
        if (/^\s*(begin|commit|rollback|savepoint|release)\b/i.test(query)) {
          forbiddenSeen.push(query);
          throw new Error('DO SQLite: use transactionSync()');
        }
        if (query.includes(';') && query.trim().replace(/;\s*$/, '').includes(';')) {
          throw new Error('fake: one statement per exec');
        }
        const rows = db.prepare(query).all(...bindings);
        return { toArray: () => rows };
      }
    },
    transactionSync<T>(fn: () => T): T {
      db.exec('BEGIN');
      try {
        const out = fn();
        db.exec('COMMIT');
        return out;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    }
  };
}

const TOKEN = 'op-token-0123456789abcdef';

function makePlatform(env: Partial<LcwEnv> = {}) {
  const storage = fakeDurableStorage();
  const fullEnv = { PLATFORM: undefined as never, LCW_OPERATOR_TOKEN: TOKEN, ...env } as LcwEnv;
  const platform = new PlatformDO({ storage }, fullEnv);
  return { platform, storage };
}

const auth = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };

describe('production worker (Durable Object SQLite wiring)', () => {
  it('entry module exports only handlers (workerd rejects other exports)', () => {
    expect(Object.keys(entry).sort()).toEqual(['PlatformDO', 'default']);
    for (const v of Object.values(entry)) expect(typeof v === 'function' || typeof v === 'object').toBe(true);
  });

  it('splits schema scripts into single statements and drops comment lines', () => {
    expect(splitStatements('-- c\ncreate table a (x int);\ncreate table b (y int);\n')).toEqual([
      'create table a (x int)',
      'create table b (y int)'
    ]);
  });

  it('boots the platform schema on DO SQLite and reports health without auth', async () => {
    const { platform, storage } = makePlatform();
    const pub = (await (await platform.fetch(new Request('https://x/health'))).json()) as Record<string, unknown>;
    expect(Object.keys(pub).sort()).toEqual(['build', 'ok', 'service']);
    const res = await platform.fetch(new Request('https://x/v1/admin/health', { headers: auth }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; counts: { players: number; worlds: number } };
    expect(body.ok).toBe(true);
    expect(body.counts.players).toBe(1);
    expect(body.counts.worlds).toBe(1);
    expect(storage.forbiddenSeen).toEqual([]);
  });

  it('gates writes behind the operator token and fails closed without one', async () => {
    const { platform } = makePlatform();
    const anon = await platform.fetch(
      new Request('https://x/v1/admin/players', { method: 'POST', body: '{}' })
    );
    expect(anon.status).toBe(401);
    const { platform: noToken } = makePlatform({ LCW_OPERATOR_TOKEN: undefined });
    const closed = await noToken.fetch(
      new Request('https://x/v1/consents', { method: 'POST', body: '{}' })
    );
    expect(closed.status).toBe(503);
    expect(isPublicRoute('GET', '/v1/reports/abc')).toBe(true);
    expect(isPublicRoute('POST', '/v1/reports/weekly')).toBe(false);
    expect(isPublicRoute('POST', '/v1/converse/score')).toBe(false);
    expect(isOperator(new Request('https://x', { headers: { authorization: 'Bearer short' } }), 'short')).toBe(false);
  });

  it('runs world block edits atomically on DO SQLite (transactionSync, no BEGIN)', async () => {
    const { platform, storage } = makePlatform();
    const res = await platform.fetch(
      new Request('https://x/v1/worlds/world-demo/edits', {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({
          actor_id: 'player-demo',
          is_owner: true,
          edits: [{ x: 108, y: 2, z: 164, block_id: 2 }]
        })
      })
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
    expect(storage.forbiddenSeen).toEqual([]);
    const unknown = await platform.fetch(
      new Request('https://x/v1/worlds/nope/edits', {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ actor_id: 'a', edits: [{ x: 0, y: 0, z: 0, block_id: 1 }] })
      })
    );
    expect(unknown.status).toBe(404);
  });

  it('keeps worlds apart in one database through table prefixes', () => {
    const base = createNodeSqliteExecutor(':memory:');
    const r2 = new InMemoryR2Store();
    const a = new WorldDO({ sql: prefixedExecutor(base, worldPrefix('world-a')), r2, seed: 'a' });
    const b = new WorldDO({ sql: prefixedExecutor(base, worldPrefix('world-b')), r2, seed: 'b' });
    a.appendLedger('p1', 50, 'test', 'r', 1);
    expect(a.getPlayerBalance('p1')).toBe(50);
    expect(b.getPlayerBalance('p1')).toBe(0);
    const tables = base
      .all<{ name: string }>("select name from sqlite_master where type = 'table' and name like 'w_%'")
      .map((r) => r.name);
    expect(tables).toContain('w_world_a_ledger');
    expect(tables).toContain('w_world_b_chunks');
    expect(() => prefixedExecutor(base, 'bad;drop')).toThrow();
  });

  it('creates players, worlds and lessons through operator routes and persists across a DO restart', async () => {
    const storage = fakeDurableStorage();
    const env = { PLATFORM: undefined as never, LCW_OPERATOR_TOKEN: TOKEN } as LcwEnv;
    const p1 = new PlatformDO({ storage }, env);
    const post = (path: string, body: unknown) =>
      p1.fetch(new Request(`https://x${path}`, { method: 'POST', headers: auth, body: JSON.stringify(body) }));
    expect(
      (await post('/v1/admin/players', {
        family_id: 'f1',
        guardian_id: 'g1',
        player_id: 'kid-1',
        nickname: 'Kid'
      })).status
    ).toBe(201);
    expect((await post('/v1/admin/worlds', { id: 'kid-town', owner_id: 'kid-1', name: 'Kid Town' })).status).toBe(201);
    expect((await post('/v1/admin/lessons', { id: 'lesson-001', player_id: 'kid-1', world_id: 'kid-town' })).status).toBe(201);
    // new DO instance on the same storage = eviction + restart
    const p2 = new PlatformDO({ storage }, env);
    const h = (await (await p2.fetch(new Request('https://x/v1/admin/health', { headers: auth }))).json()) as {
      counts: { players: number; worlds: number; lessons: number };
    };
    expect(h.counts).toMatchObject({ players: 2, worlds: 2, lessons: 1 });
  });

  it('keeps built blocks after the DO restarts (worlds rehydrate from SQLite)', async () => {
    const storage = fakeDurableStorage();
    const env = { PLATFORM: undefined as never, LCW_OPERATOR_TOKEN: TOKEN } as LcwEnv;
    const edit = (p: PlatformDO, x: number) =>
      p.fetch(
        new Request('https://x/v1/worlds/world-demo/edits', {
          method: 'POST',
          headers: auth,
          body: JSON.stringify({ actor_id: 'player-demo', is_owner: true, edits: [{ x, y: 2, z: 164, block_id: 2 }] })
        })
      );
    const p1 = new PlatformDO({ storage }, env);
    expect((await edit(p1, 108)).status).toBe(200);
    const p2 = new PlatformDO({ storage }, env);
    expect((await edit(p2, 109)).status).toBe(200);
    const p3 = new PlatformDO({ storage }, env);
    const world = (p3 as unknown as { worlds: Map<string, { world: { getBlock(x: number, y: number, z: number): number } }> }).worlds.get('world-demo')!;
    expect(world.world.getBlock(108, 2, 164)).toBe(2);
    expect(world.world.getBlock(109, 2, 164)).toBe(2);
  });

  it('stores blobs larger than one DO row in parts and isolates worlds by key prefix', () => {
    const base = createNodeSqliteExecutor(':memory:');
    const store = new SqliteBlobStore(base);
    const big = 'x'.repeat(BLOB_PART_CHARS * 2 + 10);
    store.put('w_a/snapshots/s1.json', big);
    expect(store.get('w_a/snapshots/s1.json')).toBe(big);
    expect(base.get<{ n: number }>('select count(*) as n from blob_parts')?.n).toBe(3);
    expect(store.get('w_b/snapshots/s1.json')).toBeNull();
  });

  it('serves shared reports only for strong tokens and without family ids', async () => {
    const { platform } = makePlatform();
    const short = await platform.fetch(new Request('https://x/v1/reports/abc'));
    expect(short.status).toBe(404);
    const token = 'tok-0123456789abcdefXYZ';
    platform.db.saveReport({ id: 'r1', playerId: 'player-demo', kind: 'weekly', refId: 'w1', facts: { a: 1 }, body: 'hi', clips: [], shareToken: token, nowMs: Date.now() });
    const res = await platform.fetch(new Request(`https://x/v1/reports/${token}`));
    expect(res.status).toBe(200);
    const j = (await res.json()) as Record<string, unknown>;
    expect(j).not.toHaveProperty('player_id');
    expect(j.facts).toEqual({ a: 1 });
    const bad = await platform.fetch(new Request('https://x/v1/converse/understand', { method: 'POST', body: '{not json' }));
    expect(bad.status).toBe(400);
  });

  it('records cron runs so a keeper can detect silent failures', async () => {
    const { platform } = makePlatform();
    expect(platform.runCron('0 * * * *').ok).toBe(true);
    expect(platform.runCron('0 3 * * *').task).toBe('daily_retention_cleanup');
    expect(platform.runCron('0 6 * * 1').task).toBe('weekly_parent_reports');
    const h = platform.health() as { last_runs: Record<string, { ok: boolean }> };
    expect(Object.keys(h.last_runs).sort()).toEqual([
      'daily_retention_cleanup',
      'hourly_quota_rollup',
      'hourly_seat_notices',
      'weekly_parent_reports'
    ]);
  });

  it('drains request bodies a route never read, so a kept-alive connection survives an early answer', async () => {
    const { platform } = makePlatform();
    const req = new Request('https://x/v1/family/children/kid-x/device-code', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
    const res = await platform.fetch(req);
    expect(res.status).toBe(401);
    expect(req.bodyUsed).toBe(true);
  });

  it('caps Workers AI calls per day durably', async () => {
    let calls = 0;
    const { platform } = makePlatform({ AI: { run: async () => { calls++; return {}; } } });
    // the public understand route must not spend AI while its answer is unused
    await platform.fetch(new Request('https://x/v1/converse/understand', { method: 'POST', body: JSON.stringify({ dialog_id: 'd', npc_ctx: 'cafe', level: 'L1', transcript: 'zzz qqq unknown words', stt: { source: 'keyboard', confidence: 1 } }) }));
    expect(calls).toBe(0);
    for (let i = 0; i < AI_DAILY_CALL_CAP + 5; i++) {
      await platform.runAiCapped('@cf/meta/llama-3.1-8b-instruct-fast', {} as never);
    }
    // ~100 neurons a call: solo AI stops at the seat's fair use (60 a day) before stage 1 (70%, WP-112 ladder)
    expect(calls).toBe(Math.min(SEAT_FAIR_USE_LIMITS.creativeAiPerDay, Math.round(AI_DAILY_CALL_CAP * 0.7)));
    for (let i = 0; i < AI_DAILY_CALL_CAP + 5; i++) {
      await platform.runAiCapped('@cf/meta/llama-3.1-8b-instruct-fast', {} as never, { isLesson: true });
    }
    // lesson rooms keep it up to stage 3 (95%), and never past the durable call cap
    expect(calls).toBe(Math.round(AI_DAILY_CALL_CAP * 0.95));
    expect(calls).toBeLessThanOrEqual(AI_DAILY_CALL_CAP);
  });

  it('routes /v1 and /health to the platform DO and everything else to static assets', async () => {
    const hits: string[] = [];
    const env = {
      PLATFORM: {
        idFromName: (n: string) => n,
        get: () => ({ fetch: async (r: Request | string) => { hits.push('do:' + new URL(typeof r === 'string' ? r : r.url).pathname); return new Response('{}'); } })
      },
      ASSETS: { fetch: async (r: Request) => { hits.push('asset:' + new URL(r.url).pathname); return new Response('<html>'); } }
    } as unknown as LcwEnv;
    await worker.fetch(new Request('https://lcw/health'), env);
    await worker.fetch(new Request('https://lcw/v1/trades/scenarios'), env);
    await worker.fetch(new Request('https://lcw/try'), env);
    await worker.fetch(new Request('https://lcw/world/'), env);
    await worker.scheduled({ cron: '0 3 * * *' }, env);
    expect(hits).toEqual(['do:/health', 'do:/v1/trades/scenarios', 'asset:/try', 'asset:/world/', 'do:/internal/cron']);
  });
});
