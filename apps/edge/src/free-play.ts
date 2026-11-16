/**
 * Free play the server enforces (docs/01 §3, Dan 2026-11-16 09:20): the /try session and the guest pass.
 * Every limit is in `FREE_PLAY_LIMITS` (@lcw/schemas) and every time is the server clock against a timestamp the server
 * wrote; a client timer only shows what the server said.
 *
 * /try (public, no account):
 *   POST /v1/try/start  {device}                     → a session: ends_at = server start + 3 min, one voice order.
 *        A device gets one session per KST day; a reload while it runs resumes the same one. A network address gets
 *        20 a day (shared school and home networks). The one-a-day limit rests on the device id the browser keeps, so a
 *        cleared storage or a private window starts again, up to the 20 per address: an accepted trade (no account,
 *        no AI cost). Addresses and device ids are kept only as hashes keyed with a random secret that never leaves
 *        this Durable Object (free_play_secret), so the 2^32 IPv4 space cannot be walked back from the table.
 *   POST /v1/try/order  {try_id, aim, text, path, spoke?} → the server repeats the site's grade (content/try-order.ts)
 *        and counts the order once. A sentence that does not pass leaves the order unused. No AI: the try runs on
 *        browser recognition and the sentence bank (docs/01 §3 "서버 비용 0"); its orders are counted in the quota
 *        table under `try_orders` so the operator view sees them next to the AI budget.
 *
 * Guest pass (a seat's friend, docs/01 §3, docs/10 §7):
 *   guardian  GET  /v1/family/seats/:id/guest-passes          the seat's passes and what is left this month
 *             POST /v1/family/seats/:id/guest-passes          issue one (2 per seat per KST month; active seats only)
 *             POST /v1/family/guest-passes/:id/revoke         take back a pass nobody entered (its slot returns)
 *   public    GET  /v1/guest-pass/check?code=                 state without starting the clock (the /pass page)
 *             POST /v1/guest-pass/redeem {code, device}       first entry starts 30 minutes; a session token back
 *             GET  /v1/guest-pass/status  (x-lcw-guest-pass)  active/ended and the remaining time on the server clock
 *   A pass belongs to the first device that enters; the same device may come back until ends_at. Codes nobody used stop
 *   working 7 days after issue. `guestPassFromRequest` is the gate other routes use for guest writes.
 */
import { Hono, type Context } from 'hono';
import {
  FREE_PLAY_LIMITS,
  GUEST_PASS_CODE_ALPHABET,
  GUEST_PASS_HEADER,
  GUEST_PASS_LOOKUPS_PER_HOUR,
  GuestPassRedeemRequestSchema,
  TryOrderRequestSchema,
  TryStartRequestSchema,
  formatGuestPassCode,
  normalizeGuestPassCode,
  type GuestPassCheck,
  type GuestPassSession,
  type GuestPassStatus,
  type TryOrderResponse,
  type TrySession
} from '@lcw/schemas';
import { gradeTryOrder } from '@lcw/content';
import { runInTransaction, type SqliteExecutor } from './storage.js';
import { playAllowed, seatState } from './seats.js';
import { ensureQuotaSchema } from './quota.js';

const MIN = 60_000;
const DAY = 86_400_000;
const KST = 9 * 3_600_000;
/** A request in flight when the clock runs out still counts (network and recognition delay). */
export const TRY_ORDER_GRACE_MS = 5_000;
/** Sentences one session may send (passing or not), so a script cannot spin on the grader. */
export const TRY_ATTEMPTS_PER_SESSION = 20;
/** Rows older than this are dropped on the next start (only hashes and stars are kept anyway). */
export const FREE_PLAY_RETENTION_MS = 35 * DAY;

export const FREE_PLAY_SCHEMA = `
create table if not exists try_sessions (id text primary key, device_hash text not null, addr_hash text not null, day text not null, started_at integer not null, ends_at integer not null, attempts integer not null default 0, order_stars integer, order_text text, ordered_at integer);
create index if not exists try_sessions_device on try_sessions (device_hash, day);
create index if not exists try_sessions_addr on try_sessions (addr_hash, day);
create table if not exists guest_pass_grants (id text primary key, seat_id text not null, issued_by text not null, code text unique not null, month text not null, issued_at integer not null, redeem_until integer not null, started_at integer, ends_at integer, device_hash text, revoked_at integer);
create index if not exists guest_pass_grants_seat on guest_pass_grants (seat_id, month);
create table if not exists guest_pass_sessions (token_hash text primary key, grant_id text not null, created_at integer not null);
create table if not exists free_play_limits (k text not null, hour integer not null, n integer not null, primary key (k, hour));
create table if not exists free_play_secret (id integer primary key check (id = 1), v text not null)
`;

/** Public routes this module serves; each checks its own input (platform.ts isPublicRoute lists exactly these). */
export const FREE_PLAY_PUBLIC_ROUTES: ReadonlyArray<readonly [string, RegExp]> = [
  ['POST', /^\/v1\/try\/start$/],
  ['POST', /^\/v1\/try\/order$/],
  ['GET', /^\/v1\/guest-pass\/check$/],
  ['POST', /^\/v1\/guest-pass\/redeem$/],
  ['GET', /^\/v1\/guest-pass\/status$/]
];
/** Guardian routes (behind the guardian session; family.ts FAMILY_PUBLIC_ROUTES lists them). */
export const GUEST_PASS_GUARDIAN_ROUTES: ReadonlyArray<readonly [string, RegExp]> = [
  ['GET', /^\/v1\/family\/seats\/[^/]+\/guest-passes$/],
  ['POST', /^\/v1\/family\/seats\/[^/]+\/guest-passes$/],
  ['POST', /^\/v1\/family\/guest-passes\/[^/]+\/revoke$/]
];

export interface FreePlayDeps {
  sql: SqliteExecutor;
  nowMs: () => number;
  randomBytes: (n: number) => Uint8Array;
  sha256Hex: (s: string) => Promise<string>;
}

export function kstDay(ms: number): string {
  return new Date(ms + KST).toISOString().slice(0, 10);
}
export function kstMonth(ms: number): string {
  return new Date(ms + KST).toISOString().slice(0, 7);
}
/** First instant of the next KST day / month (when a used-up limit opens again). */
export function nextKstDayStart(ms: number): number {
  return Math.floor((ms + KST) / DAY) * DAY + DAY - KST;
}
export function nextKstMonthStart(ms: number): number {
  const d = new Date(ms + KST);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) - KST;
}

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/** 8 characters from the unambiguous alphabet (31^8 ≈ 8.5e11), rejection-sampled so every character is equally likely. */
export function newGuestPassCode(randomBytes: (n: number) => Uint8Array): string {
  const n = GUEST_PASS_CODE_ALPHABET.length;
  const limit = 256 - (256 % n);
  let out = '';
  while (out.length < 8) {
    for (const b of randomBytes(16)) {
      if (b < limit && out.length < 8) out += GUEST_PASS_CODE_ALPHABET[b % n];
    }
  }
  return out;
}

type TryRow = {
  id: string;
  device_hash: string;
  started_at: number;
  ends_at: number;
  attempts: number;
  order_stars: number | null;
  order_text: string | null;
};
type GrantRow = {
  id: string;
  seat_id: string;
  issued_by: string;
  code: string;
  month: string;
  issued_at: number;
  redeem_until: number;
  started_at: number | null;
  ends_at: number | null;
  device_hash: string | null;
  revoked_at: number | null;
};

export type GrantState = 'ready' | 'active' | 'ended' | 'expired' | 'revoked';
export function grantState(g: Pick<GrantRow, 'revoked_at' | 'started_at' | 'ends_at' | 'redeem_until'>, now: number): GrantState {
  if (g.revoked_at !== null) return 'revoked';
  if (g.started_at !== null) return now < (g.ends_at ?? 0) ? 'active' : 'ended';
  return now < g.redeem_until ? 'ready' : 'expired';
}

/** First instant of the KST month `ms` falls in. */
export function kstMonthStart(ms: number): number {
  const d = new Date(ms + KST);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - KST;
}

/** Passes a friend first entered in the KST month of `now` (the month a pass is played in, not the month it was issued). */
export function passesPlayedThisMonth(sql: SqliteExecutor, seatId: string, now: number): number {
  return Number(
    sql.get<{ n: number }>('select count(*) as n from guest_pass_grants where seat_id = ? and started_at >= ? and started_at < ?', [
      seatId,
      kstMonthStart(now),
      nextKstMonthStart(now)
    ])?.n ?? 0
  );
}

/**
 * Passes that count against the seat's month (coordinator 11-16): the ones a friend first entered this KST month, plus
 * the ones still waiting to be entered (issued any month, not revoked, 7 days not over). Issuing keeps that sum at 2 or
 * less, and entering only moves a pass from waiting to played, so no calendar month gets more than 2 played passes even
 * when a code issued on the 31st is used on the 1st. A pass nobody entered gives its slot back when it is revoked or when
 * its 7 days to enter run out (nobody played on it; counting it would leave the seat a month short for a lost code).
 */
export function passesUsedThisMonth(sql: SqliteExecutor, seatId: string, now: number): number {
  const waiting = Number(
    sql.get<{ n: number }>('select count(*) as n from guest_pass_grants where seat_id = ? and started_at is null and revoked_at is null and redeem_until > ?', [
      seatId,
      now
    ])?.n ?? 0
  );
  return passesPlayedThisMonth(sql, seatId, now) + waiting;
}

/**
 * The guest gate for other routes: the pass behind an `x-lcw-guest-pass` token and whether it still runs on the server
 * clock. null = no token or an unknown one.
 */
export async function guestPassFromRequest(
  d: Pick<FreePlayDeps, 'sql' | 'sha256Hex'>,
  req: Request,
  now: number
): Promise<{ grant_id: string; seat_id: string; player_id: string; world_id: string; active: boolean; ends_at: number } | null> {
  const token = req.headers.get(GUEST_PASS_HEADER) ?? '';
  if (token.length < 32) return null;
  const th = await d.sha256Hex(`gp|${token}`);
  const g = d.sql.get<GrantRow & { player_id: string }>(
    'select g.*, s.player_id from guest_pass_sessions t join guest_pass_grants g on g.id = t.grant_id join seats s on s.id = g.seat_id where t.token_hash = ?',
    [th]
  );
  if (!g || g.ends_at === null) return null;
  // The host's seat must still run: a refunded or lapsed seat ends a running pass for every route at once (status
  // answers 'ended', the plot and the world look answer 410), so the friend reaches /guest-end, not a dead plot.
  const active = grantState(g, now) === 'active' && playAllowed(d.sql, g.player_id, now).allowed;
  return { grant_id: g.id, seat_id: g.seat_id, player_id: g.player_id, world_id: `home-${g.player_id}`, active, ends_at: g.ends_at };
}

/** Grants whose friend-cell records the daily cleanup already dropped (one row per grant, kept small). */
const GUEST_CELLS_SWEPT_SQL = 'create table if not exists guest_cells_swept (grant_id text primary key, at integer not null)';
/** Most grants handled in one daily run; the rest wait for the next day. */
export const GUEST_CELLS_SWEEP_LIMIT = 500;

/**
 * Daily retention cleanup (03:00): once a pass is over (ended on the server clock, or revoked after the friend came
 * in), the record of which cells that friend placed in the host's plot (`plot_guest_cells`, docs/19 §8) has no use any
 * more: the blocks stay in the host's plot as the host's own, only the "this friend may break it" mark goes.
 * `drop(playerId, grantId)` removes one grant's rows from that child's home world and says how many went.
 */
export function sweepEndedGuestCells(
  sql: SqliteExecutor,
  now: number,
  drop: (playerId: string, grantId: string) => number,
  limit = GUEST_CELLS_SWEEP_LIMIT
): { grants: number; cells: number; failed: number } {
  sql.exec(GUEST_CELLS_SWEPT_SQL);
  const over = sql.all<{ id: string; player_id: string }>(
    `select g.id, s.player_id from guest_pass_grants g join seats s on s.id = g.seat_id
     where g.started_at is not null and (g.revoked_at is not null or g.ends_at <= ?)
       and g.id not in (select grant_id from guest_cells_swept)
     order by coalesce(g.revoked_at, g.ends_at) limit ?`,
    [now, limit]
  );
  let cells = 0;
  let failed = 0;
  for (const g of over) {
    // one bad world never holds up the others; a failed grant is not marked, so the next day tries it again
    try {
      cells += drop(g.player_id, g.id);
    } catch {
      failed++;
      continue;
    }
    sql.run('insert or ignore into guest_cells_swept (grant_id, at) values (?, ?)', [g.id, now]);
  }
  return { grants: over.length - failed, cells, failed };
}

export interface GuardianRefLike {
  guardian_id: string;
  family_id: string;
}

/** Guardian pass list: passes a friend entered or that ran out unused, newest first, after every live one. */
const GUEST_PASS_LIST_HISTORY = 24;

/** Guardian routes, mounted from family.ts behind its guardian session check. */
export function mountGuestPassGuardianRoutes(
  app: Hono,
  d: FreePlayDeps,
  withGuardian: (c: Context, needService: boolean) => Promise<GuardianRefLike | Response>
): void {
  d.sql.exec(FREE_PLAY_SCHEMA);
  // Only the guardians of the seat's own child: a Duo payer may pay for a friend's child in another family, and paying
  // does not let them hand out (or see, or take back) passes into that child's world.
  const seatFor = (g: GuardianRefLike, sid: string) =>
    d.sql.get<{ id: string; payer_id: string; player_id: string; ends_at: number; status: string; family_id: string | null }>(
      'select s.id, s.payer_id, s.player_id, s.ends_at, s.status, p.family_id from seats s join players p on p.id = s.player_id where s.id = ? and p.family_id = ?',
      [sid, g.family_id]
    );
  const view = (row: GrantRow, now: number) => ({
    id: row.id,
    code: formatGuestPassCode(row.code),
    link: `/pass?code=${row.code}`,
    state: grantState(row, now),
    issued_at: row.issued_at,
    redeem_until: row.redeem_until,
    started_at: row.started_at,
    ends_at: row.ends_at
  });
  // When a slot opens again: a waiting code runs out of its 7 days, or the month turns (only if something was played
  // this month; waiting codes keep their slot across the turn).
  const nextSlotAt = (sid: string, now: number): number => {
    const waiting = d.sql.get<{ t: number | null }>(
      'select min(redeem_until) as t from guest_pass_grants where seat_id = ? and started_at is null and revoked_at is null and redeem_until > ?',
      [sid, now]
    )?.t;
    const monthTurn = passesPlayedThisMonth(d.sql, sid, now) > 0 ? nextKstMonthStart(now) : Infinity;
    const t = Math.min(waiting ?? Infinity, monthTurn);
    return Number.isFinite(t) ? t : nextKstMonthStart(now);
  };
  const summary = (sid: string, now: number) => {
    const used = passesUsedThisMonth(d.sql, sid, now);
    return {
      per_month: FREE_PLAY_LIMITS.guestPassesPerSeatPerMonth,
      minutes: FREE_PLAY_LIMITS.guestPassMinutes,
      left_this_month: Math.max(0, FREE_PLAY_LIMITS.guestPassesPerSeatPerMonth - used),
      resets_at: nextSlotAt(sid, now),
      server_now: now
    };
  };

  app.get('/v1/family/seats/:id/guest-passes', async (c) => {
    const g = await withGuardian(c, true);
    if (g instanceof Response) return g;
    const s = seatFor(g, c.req.param('id'));
    if (!s) return c.json({ error: 'seat_not_found' }, 404);
    const now = d.nowMs();
    // Every pass the guardian can still act on (waiting or running) is always in the list, together with the newest
    // history rows (capped); all of them newest issue first.
    // A pass taken back before anyone entered is left out: it counts for nothing, and issuing and taking back has no
    // limit, so those rows would otherwise push an older waiting code out of a capped list (review of #94).
    const live = d.sql.all<GrantRow>(
      'select * from guest_pass_grants where seat_id = ? and revoked_at is null and ((started_at is null and redeem_until > ?) or (started_at is not null and ends_at > ?))',
      [s.id, now, now]
    );
    const history = d.sql.all<GrantRow>(
      'select * from guest_pass_grants where seat_id = ? and not (revoked_at is not null and started_at is null) order by issued_at desc limit ?',
      [s.id, GUEST_PASS_LIST_HISTORY]
    );
    const byId = new Map<string, GrantRow>();
    for (const r of [...live, ...history]) byId.set(r.id, r);
    const rows = [...byId.values()].sort((a, b) => b.issued_at - a.issued_at);
    c.header('cache-control', 'private, no-store');
    return c.json({ passes: rows.map((r) => view(r, now)), ...summary(s.id, now) });
  });

  app.post('/v1/family/seats/:id/guest-passes', async (c) => {
    const g = await withGuardian(c, true);
    if (g instanceof Response) return g;
    const s = seatFor(g, c.req.param('id'));
    if (!s) return c.json({ error: 'seat_not_found' }, 404);
    const now = d.nowMs();
    const st = seatState(s, now);
    if (st !== 'active' && st !== 'expiring') return c.json({ error: 'seat_inactive', seat_state: st }, 409);
    const out = runInTransaction(d.sql, () => {
      if (passesUsedThisMonth(d.sql, s.id, now) >= FREE_PLAY_LIMITS.guestPassesPerSeatPerMonth) return null;
      let code = newGuestPassCode(d.randomBytes);
      while (d.sql.get('select 1 as x from guest_pass_grants where code = ?', [code])) code = newGuestPassCode(d.randomBytes);
      const row: GrantRow = {
        id: `gp-${hex(d.randomBytes(6))}`,
        seat_id: s.id,
        issued_by: g.guardian_id,
        code,
        month: kstMonth(now),
        issued_at: now,
        redeem_until: now + FREE_PLAY_LIMITS.guestPassRedeemDays * DAY,
        started_at: null,
        ends_at: null,
        device_hash: null,
        revoked_at: null
      };
      d.sql.run(
        'insert into guest_pass_grants (id, seat_id, issued_by, code, month, issued_at, redeem_until) values (?, ?, ?, ?, ?, ?, ?)',
        [row.id, row.seat_id, row.issued_by, row.code, row.month, row.issued_at, row.redeem_until]
      );
      return row;
    });
    if (!out) return c.json({ error: 'monthly_limit', ...summary(s.id, now) }, 409);
    c.header('cache-control', 'private, no-store');
    return c.json({ pass: view(out, now), ...summary(s.id, now) }, 201);
  });

  app.post('/v1/family/guest-passes/:id/revoke', async (c) => {
    const g = await withGuardian(c, true);
    if (g instanceof Response) return g;
    const row = d.sql.get<GrantRow>('select * from guest_pass_grants where id = ?', [c.req.param('id')]);
    if (!row || !seatFor(g, row.seat_id)) return c.json({ error: 'pass_not_found' }, 404);
    const now = d.nowMs();
    const st = grantState(row, now);
    if (st === 'revoked') return c.json({ pass: view(row, now), ...summary(row.seat_id, now) });
    // A running pass ends now (the friend's session stops at its next status check); its monthly slot stays used.
    d.sql.run('update guest_pass_grants set revoked_at = ?, ends_at = case when started_at is not null and ends_at > ? then ? else ends_at end where id = ?', [
      now,
      now,
      now,
      row.id
    ]);
    const after = d.sql.get<GrantRow>('select * from guest_pass_grants where id = ?', [row.id])!;
    return c.json({ pass: view(after, now), ...summary(row.seat_id, now) });
  });
}

/** Public /try and guest pass routes. */
export function buildFreePlayApp(d: FreePlayDeps): Hono {
  d.sql.exec(FREE_PLAY_SCHEMA);
  ensureQuotaSchema(d.sql);
  const app = new Hono();
  const hour = () => Math.floor(d.nowMs() / 3_600_000);
  const lookups = (k: string) => Number(d.sql.get<{ n: number }>('select n from free_play_limits where k = ? and hour = ?', [k, hour()])?.n ?? 0);
  const bumpLookup = (k: string) =>
    d.sql.run('insert into free_play_limits (k, hour, n) values (?, ?, 1) on conflict(k, hour) do update set n = n + 1', [k, hour()]);
  const addr = (req: Request) => req.headers.get('cf-connecting-ip') ?? 'local';
  // Random key for address/device hashes, made once per Durable Object and never sent out (review: an unkeyed
  // sha256 of an IPv4 address and a known day is reversible by trying all 2^32 addresses).
  let secret: string | null = null;
  const keyed = async (s: string): Promise<string> => {
    if (secret === null) {
      d.sql.run('insert or ignore into free_play_secret (id, v) values (1, ?)', [hex(d.randomBytes(32))]);
      secret = d.sql.get<{ v: string }>('select v from free_play_secret where id = 1')!.v;
    }
    return d.sha256Hex(`${secret}|${s}`);
  };
  const noStore = (c: Context) => c.header('cache-control', 'no-store');

  /* ---------- /try ---------- */

  const session = (r: TryRow, now: number): TrySession => ({
    try_id: r.id,
    started_at: r.started_at,
    ends_at: r.ends_at,
    server_now: now,
    orders_left: r.order_stars === null ? FREE_PLAY_LIMITS.tryVoiceOrders : 0,
    order: r.order_stars !== null ? { stars: r.order_stars as 1 | 2 | 3, text: r.order_text ?? '' } : null
  });

  app.post('/v1/try/start', async (c) => {
    noStore(c);
    const p = TryStartRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!p.success) return c.json({ error: 'invalid' }, 400);
    const now = d.nowMs();
    const day = kstDay(now);
    const deviceHash = (await keyed(`try|${p.data.device}`)).slice(0, 32);
    // The address is hashed with the day: rows of different days cannot be joined to one network.
    const addrHash = (await keyed(`try|${addr(c.req.raw)}|${day}`)).slice(0, 32);
    const out = runInTransaction(d.sql, (): { status: 200 | 201 | 429; body: Record<string, unknown> } => {
      d.sql.run('delete from try_sessions where started_at < ?', [now - FREE_PLAY_RETENTION_MS]);
      const running = d.sql.get<TryRow>('select * from try_sessions where device_hash = ? and ends_at > ? order by started_at desc limit 1', [deviceHash, now]);
      if (running) return { status: 200, body: session(running, now) };
      const usedDevice = Number(d.sql.get<{ n: number }>('select count(*) as n from try_sessions where device_hash = ? and day = ?', [deviceHash, day])?.n ?? 0);
      const usedAddr = Number(d.sql.get<{ n: number }>('select count(*) as n from try_sessions where addr_hash = ? and day = ?', [addrHash, day])?.n ?? 0);
      if (usedDevice >= FREE_PLAY_LIMITS.trySessionsPerDevicePerDay || usedAddr >= FREE_PLAY_LIMITS.trySessionsPerAddressPerDay) {
        const last = d.sql.get<TryRow>('select * from try_sessions where device_hash = ? order by started_at desc limit 1', [deviceHash]);
        return { status: 429, body: { error: 'try_used_today', retry_at: nextKstDayStart(now), server_now: now, last: last ? session(last, now) : null } };
      }
      const row: TryRow = {
        id: `try-${hex(d.randomBytes(9))}`,
        device_hash: deviceHash,
        started_at: now,
        ends_at: now + FREE_PLAY_LIMITS.tryMinutes * MIN,
        attempts: 0,
        order_stars: null,
        order_text: null
      };
      d.sql.run('insert into try_sessions (id, device_hash, addr_hash, day, started_at, ends_at) values (?, ?, ?, ?, ?, ?)', [
        row.id,
        deviceHash,
        addrHash,
        day,
        row.started_at,
        row.ends_at
      ]);
      return { status: 201, body: session(row, now) };
    });
    return c.json(out.body, out.status);
  });

  app.post('/v1/try/order', async (c) => {
    noStore(c);
    const p = TryOrderRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!p.success) return c.json({ error: 'invalid' }, 400);
    const now = d.nowMs();
    const out = runInTransaction(d.sql, (): { status: 200 | 404 | 409 | 410 | 429; body: Record<string, unknown> } => {
      const r = d.sql.get<TryRow>('select * from try_sessions where id = ?', [p.data.try_id]);
      if (!r) return { status: 404, body: { error: 'try_not_found' } };
      if (r.order_stars !== null) return { status: 409, body: { error: 'try_order_used', ...session(r, now) } };
      if (now > r.ends_at + TRY_ORDER_GRACE_MS) return { status: 410, body: { error: 'try_ended', ends_at: r.ends_at, server_now: now } };
      if (r.attempts >= TRY_ATTEMPTS_PER_SESSION) return { status: 429, body: { error: 'too_many_requests', ends_at: r.ends_at, server_now: now } };
      const stars = gradeTryOrder({ aim: p.data.aim, text: p.data.text, path: p.data.path, ...(p.data.spoke !== undefined ? { spoke: p.data.spoke } : {}) });
      if (stars === 0) {
        d.sql.run('update try_sessions set attempts = attempts + 1 where id = ?', [r.id]);
        const body: TryOrderResponse = { stars: 0, granted: false, orders_left: FREE_PLAY_LIMITS.tryVoiceOrders, ends_at: r.ends_at, server_now: now };
        return { status: 200, body };
      }
      d.sql.run('update try_sessions set attempts = attempts + 1, order_stars = ?, order_text = ?, ordered_at = ? where id = ?', [stars, p.data.text.slice(0, 300), now, r.id]);
      // Counted next to the AI budget (quota_daily, UTC day like the meter); a /try order itself never calls AI.
      d.sql.run(
        "insert into quota_daily (day, k, used) values (?, 'try_orders', 1) on conflict(day, k) do update set used = used + 1",
        [new Date(now).toISOString().slice(0, 10)]
      );
      const body: TryOrderResponse = { stars, granted: true, orders_left: 0, ends_at: r.ends_at, server_now: now };
      return { status: 200, body };
    });
    return c.json(out.body, out.status);
  });

  /* ---------- guest pass ---------- */

  const lookupLimited = async (req: Request): Promise<boolean> => {
    const k = `gp:${(await keyed(`gp|${addr(req)}|${hour()}`)).slice(0, 16)}`;
    if (lookups(k) >= GUEST_PASS_LOOKUPS_PER_HOUR) return true;
    bumpLookup(k);
    // Counters older than two hours are never read again.
    d.sql.run('delete from free_play_limits where hour < ?', [hour() - 2]);
    return false;
  };
  const grantByCode = (raw: string) => {
    const code = normalizeGuestPassCode(raw);
    return code ? d.sql.get<GrantRow>('select * from guest_pass_grants where code = ?', [code]) : undefined;
  };

  app.get('/v1/guest-pass/check', async (c) => {
    noStore(c);
    if (await lookupLimited(c.req.raw)) return c.json({ error: 'too_many_requests' }, 429);
    const g = grantByCode(c.req.query('code') ?? '');
    if (!g) return c.json({ error: 'pass_not_found' }, 404);
    const now = d.nowMs();
    const body: GuestPassCheck = {
      state: grantState(g, now),
      minutes: FREE_PLAY_LIMITS.guestPassMinutes,
      ends_at: g.ends_at,
      redeem_until: g.redeem_until,
      server_now: now
    };
    return c.json(body);
  });

  app.post('/v1/guest-pass/redeem', async (c) => {
    noStore(c);
    const p = GuestPassRedeemRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!p.success) return c.json({ error: 'invalid' }, 400);
    if (await lookupLimited(c.req.raw)) return c.json({ error: 'too_many_requests' }, 429);
    const now = d.nowMs();
    const deviceHash = (await keyed(`gp-device|${p.data.device}`)).slice(0, 32);
    const token = hex(d.randomBytes(24));
    const tokenHash = await d.sha256Hex(`gp|${token}`);
    const out = runInTransaction(d.sql, (): { status: 200 | 201 | 404 | 409 | 410; body: Record<string, unknown> } => {
      // A pass lasts 30 minutes; its session tokens are useless a day later.
      d.sql.run('delete from guest_pass_sessions where created_at < ?', [now - 86_400_000]);
      const g = grantByCode(p.data.code);
      if (!g) return { status: 404, body: { error: 'pass_not_found' } };
      const st = grantState(g, now);
      if (st === 'revoked') return { status: 410, body: { error: 'pass_revoked' } };
      if (st === 'expired') return { status: 410, body: { error: 'pass_expired', redeem_until: g.redeem_until } };
      if (st === 'ended') return { status: 410, body: { error: 'pass_ended', ends_at: g.ends_at } };
      if (st === 'active' && g.device_hash !== deviceHash) return { status: 409, body: { error: 'pass_in_use' } };
      const host = d.sql.get<{ player_id: string; nickname: string | null; ends_at: number; status: string }>(
        'select s.player_id, p.nickname, s.ends_at, s.status from seats s left join players p on p.id = s.player_id where s.id = ?',
        [g.seat_id]
      );
      if (!host) return { status: 404, body: { error: 'pass_not_found' } };
      const seat = seatState(host, now);
      if (seat !== 'active' && seat !== 'expiring') return { status: 410, body: { error: 'seat_inactive' } };
      // Second line behind the issue check (rows issued under the older count, or a month that turned while codes waited):
      // a new first entry never makes a third played pass in one KST month.
      if (st === 'ready' && passesPlayedThisMonth(d.sql, g.seat_id, now) >= FREE_PLAY_LIMITS.guestPassesPerSeatPerMonth)
        return { status: 409, body: { error: 'monthly_limit', resets_at: nextKstMonthStart(now) } };
      let started = g.started_at;
      let ends = g.ends_at;
      if (st === 'ready') {
        started = now;
        ends = now + FREE_PLAY_LIMITS.guestPassMinutes * MIN;
        d.sql.run('update guest_pass_grants set started_at = ?, ends_at = ?, device_hash = ? where id = ? and started_at is null', [started, ends, deviceHash, g.id]);
      }
      d.sql.run('insert into guest_pass_sessions (token_hash, grant_id, created_at) values (?, ?, ?)', [tokenHash, g.id, now]);
      const body: GuestPassSession = {
        token,
        world_id: `home-${host.player_id}`,
        // Only the first character of the host's nickname: the code holder knows who invited them.
        host_nickname: host.nickname ? `${[...host.nickname][0]}${'*'.repeat(Math.max(1, [...host.nickname].length - 1))}` : '',
        started_at: started!,
        ends_at: ends!,
        server_now: now
      };
      return { status: st === 'ready' ? 201 : 200, body };
    });
    return c.json(out.body, out.status);
  });

  app.get('/v1/guest-pass/status', async (c) => {
    noStore(c);
    const now = d.nowMs();
    const g = await guestPassFromRequest(d, c.req.raw, now);
    if (!g) return c.json({ error: 'pass_not_found' }, 404);
    const row = d.sql.get<GrantRow>('select * from guest_pass_grants where id = ?', [g.grant_id])!;
    const body: GuestPassStatus = {
      state: g.active ? 'active' : 'ended',
      world_id: g.world_id,
      started_at: row.started_at ?? now,
      ends_at: g.ends_at,
      remaining_ms: g.active ? Math.max(0, g.ends_at - now) : 0,
      server_now: now
    };
    return c.json(body);
  });

  return app;
}
