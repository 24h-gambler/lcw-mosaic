import { Hono } from 'hono';
import { readWorldChoice, readWorldSetup, type WorldSetup } from '@lcw/content';
import type { SqliteExecutor } from './storage.js';

/**
 * "내 월드 만들기" (docs/08 §8.4 G07, Dan 11-16 R2555): the child names their world and picks a few fun details; the
 * server picks the seed (the 3x3 sector layout and terrain come from it, sim-core generateWorldLayout) and keeps the
 * whole setup with the child's home world, so any device of the child opens the same world.
 *
 * Who: the child device token (guardian /link or the student sign-up) or a lesson student token, the same identities
 * as solo play (`soloPlayer` in platform.ts). A guest keeps its world on the device only and never calls here.
 *
 * One world per child for now: a second POST answers 409 with the world already made (making again is a later
 * screen). Nothing here is gated by the seat: a paused seat may still look around its own world.
 */

export const MY_WORLD_PUBLIC_ROUTES: ReadonlyArray<readonly [string, RegExp]> = [
  ['GET', /^\/v1\/my-world$/],
  ['POST', /^\/v1\/my-world$/]
];

export const MY_WORLD_SCHEMA = `
create table if not exists world_setups (world_id text primary key, player_id text not null, name text not null, season text not null, time text not null, buddy text not null, seed text not null, created_at integer not null)
`;

export interface MyWorldDeps {
  sql: SqliteExecutor;
  nowMs: () => number;
  randomBytes: (n: number) => Uint8Array;
  /** The child behind the request's token (device or lesson student), or null. */
  soloPlayer: (req: Request) => Promise<{ player_id: string } | null>;
  /** The child's home world id (created if missing). */
  ensureHomeWorld: (playerId: string) => string;
}

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

export function readMyWorld(sql: SqliteExecutor, worldId: string): WorldSetup | null {
  const row = sql.get<Record<string, unknown>>('select name, season, time, buddy, seed from world_setups where world_id = ?', [worldId]);
  return row ? readWorldSetup(row) : null;
}

export function buildMyWorldApp(d: MyWorldDeps): Hono {
  d.sql.exec(MY_WORLD_SCHEMA);
  const app = new Hono();

  app.get('/v1/my-world', async (c) => {
    const who = await d.soloPlayer(c.req.raw);
    if (!who) return c.json({ error: 'device_only' }, 401);
    const world = readMyWorld(d.sql, d.ensureHomeWorld(who.player_id));
    return c.json(world ? { made: true, world } : { made: false });
  });

  app.post('/v1/my-world', async (c) => {
    // Read the body first: answering a POST before draining it breaks the next request on a kept-alive connection.
    const body = (await c.req.json().catch(() => null)) as unknown;
    const who = await d.soloPlayer(c.req.raw);
    if (!who) return c.json({ error: 'device_only' }, 401);
    const choice = readWorldChoice(body);
    if (!choice) return c.json({ error: 'invalid_world_setup' }, 400);
    const worldId = d.ensureHomeWorld(who.player_id);
    const had = readMyWorld(d.sql, worldId);
    if (had) return c.json({ error: 'world_already_made', world: had }, 409);
    const seed = hex(d.randomBytes(8));
    d.sql.run('insert into world_setups (world_id, player_id, name, season, time, buddy, seed, created_at) values (?, ?, ?, ?, ?, ?, ?, ?)', [
      worldId,
      who.player_id,
      choice.name,
      choice.season,
      choice.time,
      choice.buddy,
      seed,
      d.nowMs()
    ]);
    // The world row shows the child's name (lists, the guardian dashboard). Its server seed stays: the home world
    // already holds the coin ledger and the saved plot, which were judged on that terrain.
    d.sql.run('update worlds set name = ? where id = ?', [choice.name, worldId]);
    return c.json({ made: true, world: readMyWorld(d.sql, worldId) }, 201);
  });

  return app;
}
