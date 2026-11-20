import { Hono } from 'hono';
import { z } from 'zod';
import { filterSpeechBubble } from '@lcw/converse';
// Token file only (no React): the showroom palette is the design-system color names, same as the web parser.
import { COLOR_TOKENS } from '../../../packages/ui/src/tokens.js';
import type { EdgePlatformDb, SqliteExecutor } from './storage.js';
import { soloWriteGate } from './seats.js';
import { DEVICE_TOKEN_TTL_MS } from './family.js';

/**
 * Showroom (WP-703, docs/01 §2 "정적 스냅샷, 실시간·음성·실명 없음", docs/02 §consents `showroom` 동의, W08 `/s/<token>`).
 *
 * - The child's linked device (or the operator for a lesson showcase) publishes a snapshot of a build + avatar colors.
 * - One link per child: publishing again updates the same link, so links already shared keep working.
 * - The link is served only while the guardian's `showroom_public` consent is active; withdrawing it hides the page at
 *   once and deletes the stored snapshot on the next publish or read.
 * - Only allow-listed fields are stored or served: title, blocks [x,y,z,color], avatar colors. No position, voice,
 *   nickname or player id ever leaves the server.
 */

export const SHOWROOM_MAX_BLOCKS = 20_000;
export const SHOWROOM_PUBLISHES_PER_HOUR = 30;
/** Public share tokens: 32 hex chars from 16 random bytes. */
export const SHOWROOM_TOKEN_RE = /^[a-f0-9]{32}$/;

/** Public routes this module serves (platform.ts isPublicRoute lists exactly these); POST/DELETE check a device token. */
export const SHOWROOM_PUBLIC_ROUTES: ReadonlyArray<readonly [string, RegExp]> = [
  ['GET', /^\/v1\/showroom\/[^/]+$/],
  ['POST', /^\/v1\/showroom$/],
  ['DELETE', /^\/v1\/showroom$/]
];

export const SHOWROOM_SCHEMA = `
create table if not exists showrooms (token text primary key, player_id text not null unique, title text not null, body text not null, created_at integer not null, updated_at integer not null);
create table if not exists showroom_limits (k text not null, hour integer not null, n integer not null, primary key (k, hour))
`;

const COLOR_NAMES = Object.keys(COLOR_TOKENS) as [string, ...string[]];
const Color = z.enum(COLOR_NAMES);
const Int = (lo: number, hi: number) => z.number().int().min(lo).max(hi);

export const SnapshotSchema = z
  .object({
    v: z.literal(1),
    title: z.string().trim().min(1).max(40),
    blocks: z.array(z.tuple([Int(-512, 512), Int(-512, 512), Int(-64, 512), Color])).max(SHOWROOM_MAX_BLOCKS),
    avatar: z.object({ shirt: Color, pants: Color, hair: Color }).strict()
  })
  .strict();

const PublishSchema = z
  .object({
    snapshot: SnapshotSchema,
    /** Operator only: whose showroom this is. A device always publishes for its own child. */
    player_id: z.string().min(1).max(64).optional()
  })
  .strict();

export type ShowroomSnapshotBody = z.infer<typeof SnapshotSchema>;

export interface ShowroomDeps {
  sql: SqliteExecutor;
  db: EdgePlatformDb;
  nowMs: () => number;
  randomBytes: (n: number) => Uint8Array;
  sha256Hex: (s: string) => Promise<string>;
  isOperator: (req: Request) => boolean;
}

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

export function buildShowroomApp(d: ShowroomDeps): Hono {
  d.sql.exec(SHOWROOM_SCHEMA);
  const app = new Hono();
  const hour = () => Math.floor(d.nowMs() / 3_600_000);

  const deviceChild = async (req: Request): Promise<string | null> => {
    const h = req.headers.get('authorization') ?? '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : '';
    if (token.length < 32) return null;
    const dev = d.sql.get<{ player_id: string; created_at: number }>(
      'select player_id, created_at from devices where token_hash = ? and revoked_at is null',
      [await d.sha256Hex(token)]
    );
    if (!dev || d.nowMs() - dev.created_at > DEVICE_TOKEN_TTL_MS) return null;
    return dev.player_id;
  };
  const consented = (playerId: string) => d.db.hasActiveConsent(playerId, 'showroom_public');
  const forget = (playerId: string) => d.sql.run('delete from showrooms where player_id = ?', [playerId]);

  app.post('/v1/showroom', async (c) => {
    const op = d.isOperator(c.req.raw);
    const fromDevice = op ? null : await deviceChild(c.req.raw);
    if (!op && !fromDevice) return c.json({ error: 'device_only' }, 401);
    const raw: unknown = await c.req.json().catch(() => null);
    // Seat gate (WP-704): publishing is a write; a read-only/archived/refunded seat cannot publish (removing still can).
    // The body is read first so the request stream is drained before an early answer.
    if (fromDevice) {
      const refused = soloWriteGate(d.sql, fromDevice, d.nowMs());
      if (refused) return c.json(refused, 403);
    }
    const p = PublishSchema.safeParse(raw);
    if (!p.success) return c.json({ error: 'invalid', fields: p.error.issues.slice(0, 5).map((i) => i.path.join('.')) }, 400);
    const playerId = op ? p.data.player_id : fromDevice;
    if (!playerId) return c.json({ error: 'player_id_required' }, 400);
    if (!op && p.data.player_id && p.data.player_id !== playerId) return c.json({ error: 'forbidden' }, 403);
    if (!consented(playerId)) {
      forget(playerId);
      return c.json({ error: 'consent_required', scope: 'showroom_public' }, 403);
    }
    const limitKey = `pub:${playerId}`;
    const used = d.sql.get<{ n: number }>('select n from showroom_limits where k = ? and hour = ?', [limitKey, hour()])?.n ?? 0;
    if (used >= SHOWROOM_PUBLISHES_PER_HOUR) return c.json({ error: 'too_many_requests' }, 429);
    // World titles are shown to anyone with the link: same PII/profanity filter as nicknames and bubbles (docs/16 §1).
    const f = filterSpeechBubble(p.data.snapshot.title);
    if (f.reason === 'pii' || f.reason === 'profanity') return c.json({ error: 'title_rejected', reason: f.reason }, 422);
    d.sql.run('insert into showroom_limits (k, hour, n) values (?, ?, 1) on conflict(k, hour) do update set n = n + 1', [limitKey, hour()]);
    d.sql.run('delete from showroom_limits where hour < ?', [hour() - 48]);
    const now = d.nowMs();
    const body = JSON.stringify(p.data.snapshot);
    const existing = d.sql.get<{ token: string }>('select token from showrooms where player_id = ?', [playerId]);
    const token = existing?.token ?? hex(d.randomBytes(16));
    if (existing) d.sql.run('update showrooms set title = ?, body = ?, updated_at = ? where token = ?', [p.data.snapshot.title, body, now, token]);
    else
      d.sql.run('insert into showrooms (token, player_id, title, body, created_at, updated_at) values (?, ?, ?, ?, ?, ?)', [
        token,
        playerId,
        p.data.snapshot.title,
        body,
        now,
        now
      ]);
    return c.json({ token, path: `/s/${token}`, updated: Boolean(existing) }, existing ? 200 : 201);
  });

  app.delete('/v1/showroom', async (c) => {
    const playerId = await deviceChild(c.req.raw);
    if (!playerId) return c.json({ error: 'device_only' }, 401);
    forget(playerId);
    return c.json({ ok: true });
  });

  app.get('/v1/showroom/:token', (c) => {
    const token = c.req.param('token');
    c.header('x-robots-tag', 'noindex, nofollow');
    c.header('referrer-policy', 'no-referrer');
    if (!SHOWROOM_TOKEN_RE.test(token)) return c.json({ error: 'not_found' }, 404);
    const row = d.sql.get<{ player_id: string; body: string }>('select player_id, body from showrooms where token = ?', [token]);
    if (!row) return c.json({ error: 'not_found' }, 404);
    if (!consented(row.player_id)) {
      forget(row.player_id);
      return c.json({ error: 'not_found' }, 404);
    }
    // Re-validate on the way out, so a stored row can never serve more than the allow-list.
    const snap = SnapshotSchema.safeParse(JSON.parse(row.body));
    if (!snap.success) return c.json({ error: 'not_found' }, 404);
    c.header('cache-control', 'public, max-age=60');
    return c.json(snap.data);
  });

  app.get('/v1/admin/showrooms', (c) =>
    c.json(d.sql.all('select token, player_id, title, created_at, updated_at from showrooms order by updated_at desc limit 200'))
  );
  return app;
}
