/**
 * Seats (WP-704, docs/01 §4, docs/09 P6): manual issuance after a bank transfer, paid extension, expiry (30 days
 * read-only, then archived), the refund rule as one operator button, and the Duo partial refund through
 * `settleDuoSeatRefund` / `hasSingleDuoPayer` (packages/quota). Money never moves here: a refund records the amount
 * the operator transfers back to the single payer.
 *
 * Payments: every payment is a `seat_orders` row linked to its seats in `seat_order_links` — the first issue
 * ('issue', one order for both Duo seats) and each paid extension ('extend', one seat, `days`). The refund window is
 * per payment: KST, from the day after payment to 24:00 of the 7th day (`refundDeadlineMs`).
 *
 * First use ends the refund (Dan 11-16 "환불은 한 번 체험하면 불가"; 전자상거래법 제17조 제2항 제5호 — digital content
 * whose supply has begun, with the trial scene and guest pass as the §17(6) trial means; docs/01 §4, docs/16):
 * `seat_usage.first_used_at` is written by the server the first time the seat's child enters the world on a linked
 * device, makes a solo play request, or joins a lesson while the seat is live (`markSeatUse`). A payment can be
 * refunded only inside its window AND before that use: the issue payment by any use of the seat, an extension by use
 * on or after the day its days begin (`seat_order_periods.period_from`). A used payment is refused at once with the
 * reason (`seat_used`); it never goes to the review inbox. Duo is judged seat by seat.
 *
 * Who may ask: the payer, or the guardian of that seat's child. Only the payer chooses how a Duo partial refund is
 * settled; another family's request waits for that choice. One family's request never touches the other Duo seat's
 * data (docs/01 §4 "결제자는 1명").
 *
 * Play: `playAllowed` is the server-side gate. Device-token solo writes (platform.ts: converse/score incl. purchases,
 * review attempts; showroom publish) answer 403 `seat_inactive` while the newest seat is read-only/archived/refunded.
 * Lesson paths (/v1/join, /v1/lesson/*, lesson student tokens) never look at seats.
 */
import type { Hono, Context } from 'hono';
import { z } from 'zod';
import {
  PLAN_PRICES_KRW,
  TERM_DAYS,
  hasSingleDuoPayer,
  inRefundWindow,
  refundDeadlineMs,
  settleDuoSeatRefund,
  type BillingTerm,
  type DuoRefundMode
} from '@lcw/quota';
import { FREE_PLAY_LIMITS } from '@lcw/schemas';
import { isTestPlayerId } from './nickname.js';
import { BILLING_SCHEMA } from './billing.js';
import { runInTransaction, type SqliteExecutor } from './storage.js';

const DAY = 86_400_000;
export const SEAT_READ_ONLY_MS = 30 * DAY;
export const SEAT_EXPIRING_MS = 7 * DAY;
/** A payment time may be a little ahead of the server clock (typing), not more. */
export const PAID_AT_FUTURE_SLACK_MS = 10 * 60_000;

/**
 * Audit (`seat_changes`): every operator change of a seat's period — issue, extend, edit_dates, stop — is one row with
 * who (`by`: the ops key is the one operator identity, 'operator'), when, and the seat's {starts_at, ends_at, status}
 * before and after. Payments stay in `seat_orders`; a date edit or a stop moves no money and never touches them.
 */
export type SeatChangeKind = 'issue' | 'extend' | 'edit_dates' | 'stop' | 'refund' | 'refund_extend' | 'duo_to_solo';
/** A start may be set up to a day ahead (a date picked as "today" keeps its time of day); a seat counts from its end. */
export const SEAT_START_AHEAD_MS = DAY;
/** Latest an operator may set an end date to (a typo guard, not a business rule). */
export const SEAT_MAX_AHEAD_MS = 3 * 366 * DAY;

/**
 * `seat_order_seats` (first version, one order per seat) is kept for old rows and copied into `seat_order_links`,
 * which allows several payments per seat.
 */
export const SEATS_SCHEMA = `
create table if not exists seat_orders (id text primary key, payer_id text not null, plan text not null, term text not null, amount_krw integer not null, paid_at integer not null, created_at integer not null, note text not null default '');
create table if not exists seat_order_seats (seat_id text primary key, order_id text not null);
create table if not exists seat_order_links (seat_id text not null, order_id text not null, kind text not null, days integer, refunded_at integer, primary key (seat_id, order_id));
create table if not exists seat_refunds (id text primary key, seat_id text not null, order_id text not null, requested_by text not null, requested_at integer not null, mode text, status text not null, refund_krw integer, remaining_solo_days integer, decided_at integer, reason text, note text not null default '');
create table if not exists seat_notices (seat_id text not null, kind text not null, at integer not null, primary key (seat_id, kind));
insert or ignore into seat_order_links (seat_id, order_id, kind, days, refunded_at) select l.seat_id, l.order_id, 'issue', null, case when s.status = 'refunded' then s.ends_at end from seat_order_seats l left join seats s on s.id = l.seat_id;
create table if not exists seat_usage (seat_id text primary key, first_used_at integer not null, last_used_at integer not null, first_via text not null);
create table if not exists seat_order_periods (order_id text primary key, period_from integer not null);
create table if not exists seat_order_usage (order_id text primary key, first_used_at integer not null);
create table if not exists seat_changes (id text primary key, seat_id text not null, kind text not null, by text not null, at integer not null, before_json text not null, after_json text not null, note text not null default '');
create index if not exists seat_changes_seat on seat_changes (seat_id, at);
create table if not exists free_trial (player_id text primary key, used_ms integer not null, last_beat_at integer not null, started_at integer not null);
`;

/** How a seat was first used (kept for the operator: "first used 11-16 15:02 in a lesson"). */
export type SeatUseVia = 'world' | 'play' | 'lesson';
/** last_used_at is moved at most this often (every play request would be a write). */
const USE_TOUCH_MS = 60_000;

/**
 * Server record of seat use: the live seat of this child (issued, not refunded, inside its period) gets its first use
 * once and its last use refreshed. No live seat (pre-sale, trial, lesson-only, read-only) → nothing is written.
 * Callers: GET /v1/device/me (the child's world opens on a linked device: 'world'), a solo play write that passed the
 * seat gate ('play'), a student in a lesson (GET /v1/lesson/state: 'lesson', tutoring seats only).
 */
export function markSeatUse(sql: SqliteExecutor, playerId: string, nowMs: number, via: SeatUseVia): void {
  // Hot path (play writes, lesson/state every 1.2 s): the tables exist since mountSeatRoutes ran in this object.
  const s = sql.get<{ id: string; plan: string }>(
    "select id, plan from seats where player_id = ? and status <> 'refunded' and starts_at <= ? and ends_at > ? order by starts_at desc limit 1",
    [playerId, nowMs, nowMs]
  );
  if (!s) return;
  // Lessons are not what a Solo/Duo seat sells (they are never gated by seats): only a tutoring seat is used by one.
  if (via === 'lesson' && s.plan !== 'tutoring') return;
  sql.run(
    `insert into seat_usage (seat_id, first_used_at, last_used_at, first_via) values (?, ?, ?, ?)
     on conflict(seat_id) do update set last_used_at = excluded.last_used_at where seat_usage.last_used_at < excluded.last_used_at - ?`,
    [s.id, nowMs, nowMs, via, USE_TOUCH_MS]
  );
  // Each extension's own first use: the first use on or after the day its days begin (never throttled).
  sql.run(
    `insert or ignore into seat_order_usage (order_id, first_used_at)
     select l.order_id, ? from seat_order_links l join seat_order_periods p on p.order_id = l.order_id
     where l.seat_id = ? and l.kind = 'extend' and l.refunded_at is null and p.period_from <= ?`,
    [nowMs, s.id, nowMs]
  );
}

/**
 * Normalizer (hourly with the notices): a tutoring seat whose lesson was not recorded as use (seats issued before this
 * code shipped, or a missed write) gets its first use from the earliest lesson of its child after the seat was issued
 * and inside its period. Device sightings are not used: linking a device also stamps last_seen_at without any play.
 */
export function backfillSeatUse(sql: SqliteExecutor, nowMs: number): number {
  let n = 0;
  const seats = sql.all<{ id: string; player_id: string; starts_at: number; ends_at: number; issued_at: number | null }>(
    `select s.id, s.player_id, s.starts_at, s.ends_at,
            (select min(o.created_at) from seat_order_links l join seat_orders o on o.id = l.order_id where l.seat_id = s.id and l.kind = 'issue') as issued_at
     from seats s left join seat_usage u on u.seat_id = s.id
     where u.seat_id is null and s.status <> 'refunded' and s.plan = 'tutoring' and s.starts_at <= ?`,
    [nowMs]
  );
  for (const s of seats) {
    const from = Math.max(s.starts_at, s.issued_at ?? s.starts_at);
    const at =
      sql.get<{ at: number | null }>('select min(started_at) as at from lessons where player_id = ? and started_at >= ? and started_at < ?', [
        s.player_id,
        from,
        Math.min(nowMs, s.ends_at)
      ])?.at ?? null;
    if (at === null) continue;
    sql.run("insert or ignore into seat_usage (seat_id, first_used_at, last_used_at, first_via) values (?, ?, ?, 'lesson')", [s.id, at, at]);
    n++;
  }
  return n;
}

export function seatUsage(sql: SqliteExecutor, seatId: string): { first_used_at: number; last_used_at: number; first_via: SeatUseVia } | null {
  return (
    sql.get<{ first_used_at: number; last_used_at: number; first_via: SeatUseVia }>('select first_used_at, last_used_at, first_via from seat_usage where seat_id = ?', [seatId]) ??
    null
  );
}

export type SeatPlan = 'solo' | 'duo' | 'tutoring';
export type SeatState = 'active' | 'expiring' | 'read_only' | 'archived' | 'refunded';

type SeatRow = {
  id: string;
  payer_id: string;
  player_id: string;
  plan: string;
  period: string;
  starts_at: number;
  ends_at: number;
  status: string;
};
type OrderRow = { id: string; payer_id: string; plan: string; term: BillingTerm; amount_krw: number; paid_at: number; created_at: number };
type LinkRow = OrderRow & { seat_id: string; order_id: string; kind: 'issue' | 'extend'; days: number | null; refunded_at: number | null };

export function duoOptions(term: BillingTerm, paidAtMs: number, paidAmountKrw: number, nowMs: number): { refund_difference_krw: number; solo_days: number } | null {
  const a = settleDuoSeatRefund({ term, paidAtMs, refundRequestedAtMs: nowMs, paidAmountKrw, mode: 'refund_difference' });
  const b = settleDuoSeatRefund({ term, paidAtMs, refundRequestedAtMs: nowMs, paidAmountKrw, mode: 'convert_to_solo_days' });
  return a.eligible && b.eligible ? { refund_difference_krw: a.refundKrw, solo_days: b.remainingSoloDays } : null;
}

/** Default price of an extension: the plan price when `days` is a whole term (Duo: one seat's half), otherwise 0. */
export function extensionPriceKrw(plan: string, days: number): number {
  const term: BillingTerm | null = days === TERM_DAYS.month ? 'month' : days === TERM_DAYS.year ? 'year' : null;
  if (!term) return 0;
  if (plan === 'solo') return PLAN_PRICES_KRW.solo[term];
  if (plan === 'duo') return Math.round(PLAN_PRICES_KRW.duo[term] / 2);
  return 0;
}

/** Time-derived state (docs/09 §5: expiry → 30 days read-only, then archived). */
export function seatState(s: Pick<SeatRow, 'ends_at' | 'status'>, nowMs: number): SeatState {
  if (s.status === 'refunded') return 'refunded';
  if (nowMs < s.ends_at) return s.ends_at - nowMs <= SEAT_EXPIRING_MS ? 'expiring' : 'active';
  return nowMs < s.ends_at + SEAT_READ_ONLY_MS ? 'read_only' : 'archived';
}

export type TrialState = 'running' | 'ended';
export interface PlayGate {
  allowed: boolean;
  seat: { state: SeatState; ends_at: number } | null;
  /** R326: only for a child with no seat ever who is not exempt; null = no free-trial clock applies. */
  trial: TrialState | null;
}

const TRIAL_MS = FREE_PLAY_LIMITS.worldTrialMinutes * 60_000;

/**
 * Who never runs on the free-trial clock (R326): smoke/demo players and tutoring students (the teacher issues them a
 * 0-won seat, R2588; a tutoring student whose seat is not typed in yet must not hit a pay screen). Teachers and lesson
 * tokens never reach this gate (lesson paths do not look at seats).
 */
function trialExempt(sql: SqliteExecutor, playerId: string): boolean {
  if (isTestPlayerId(playerId)) return true;
  const p = sql.get<{ tutor_student: number }>('select tutor_student from players where id = ?', [playerId]);
  return Number(p?.tutor_student ?? 0) === 1;
}

function trialUsed(sql: SqliteExecutor, playerId: string): number {
  return Number(sql.get<{ used_ms: number }>('select used_ms from free_trial where player_id = ?', [playerId])?.used_ms ?? 0);
}

/**
 * Server-side play gate. The newest seat decides: active/expiring → play; read-only/archived/refunded → no solo play.
 * A child who never had a seat plays on the free-trial clock (R326): `worldTrialMinutes` of server-counted world time,
 * then `allowed` is false with `trial: 'ended'`. Reads only (the clock moves in `beatTrial`).
 */
export function playAllowed(sql: SqliteExecutor, playerId: string, nowMs: number): PlayGate {
  // A live seat always decides (an older seat whose start date was edited later must not hide it), then the newest.
  const s = sql.get<SeatRow>(
    "select * from seats where player_id = ? order by (status <> 'refunded' and ends_at > ?) desc, starts_at desc, ends_at desc limit 1",
    [playerId, nowMs]
  );
  if (!s) {
    if (trialExempt(sql, playerId)) return { allowed: true, seat: null, trial: null };
    const ended = trialUsed(sql, playerId) >= TRIAL_MS;
    return { allowed: !ended, seat: null, trial: ended ? 'ended' : 'running' };
  }
  const state = seatState(s, nowMs);
  return { allowed: state === 'active' || state === 'expiring', seat: { state, ends_at: s.ends_at }, trial: null };
}

/**
 * One beat of the free-trial clock (R326): adds the time since the last beat, at most `worldTrialBeatMaxAddMs`, or 0
 * after a break longer than `worldTrialBreakMs` (a new stretch). One upsert, capped at the trial length. Callers: the
 * trial child's device beat (POST /v1/device/heartbeat, every `worldTrialBeatMs` while the world is visible) and every
 * solo write of a trial child that passed the gate (a request that was coming anyway — no extra round trip).
 */
export function beatTrial(sql: SqliteExecutor, playerId: string, nowMs: number): TrialState {
  const L = FREE_PLAY_LIMITS;
  sql.run(
    `insert into free_trial (player_id, used_ms, last_beat_at, started_at) values (?, 0, ?, ?)
     on conflict(player_id) do update set
       used_ms = min(?, used_ms + case when ? - last_beat_at between 0 and ? then min(? - last_beat_at, ?) else 0 end),
       last_beat_at = max(last_beat_at, ?)`,
    [playerId, nowMs, nowMs, TRIAL_MS, nowMs, L.worldTrialBreakMs, nowMs, L.worldTrialBeatMaxAddMs, nowMs]
  );
  return trialUsed(sql, playerId) >= TRIAL_MS ? 'ended' : 'running';
}

/**
 * The gate of a device-token solo write (platform.ts `seatBlocked`): seat → as before (and the seat's use is marked);
 * free trial → the write is a beat, refused once the clock is spent. Returns the 403 body or null.
 */
export function soloWriteGate(sql: SqliteExecutor, playerId: string, nowMs: number): Record<string, unknown> | null {
  const gate = playAllowed(sql, playerId, nowMs);
  if (gate.trial === 'running') {
    return beatTrial(sql, playerId, nowMs) === 'ended' ? { error: 'trial_ended', trial: 'ended' } : null;
  }
  if (gate.trial === 'ended') return { error: 'trial_ended', trial: 'ended' };
  if (gate.allowed) {
    markSeatUse(sql, playerId, nowMs, 'play');
    return null;
  }
  return { error: 'seat_inactive', seat: { state: gate.seat?.state ?? null } };
}

/** Hourly: record 7-day / 1-day / expired notices once per seat (shown on /family and in the operator inbox). */
export function sweepSeatNotices(sql: SqliteExecutor, nowMs: number): number {
  sql.exec(SEATS_SCHEMA);
  backfillSeatUse(sql, nowMs);
  let n = 0;
  for (const s of sql.all<SeatRow>("select * from seats where status <> 'refunded' and ends_at > ?", [nowMs - SEAT_READ_ONLY_MS])) {
    const left = s.ends_at - nowMs;
    const kind = left <= 0 ? 'expired' : left <= DAY ? '1d' : left <= SEAT_EXPIRING_MS ? '7d' : null;
    if (!kind) continue;
    const r = sql.get('select 1 as x from seat_notices where seat_id = ? and kind = ?', [s.id, kind]);
    if (r) continue;
    sql.run('insert into seat_notices (seat_id, kind, at) values (?, ?, ?)', [s.id, kind, nowMs]);
    n++;
  }
  return n;
}

const Mode = z.enum(['refund_difference', 'convert_to_solo_days']);
const IssueSchema = z
  .object({
    /** The guardian who transferred the money; or `payer_player_id` → that child's family guardian. */
    payer_guardian_id: z.string().min(1).max(64).optional(),
    payer_player_id: z.string().min(1).max(64).optional(),
    plan: z.enum(['solo', 'duo', 'tutoring']),
    term: z.enum(['month', 'year']),
    player_ids: z.array(z.string().min(1).max(64)).min(1).max(2),
    /** When the transfer arrived (ms). The refund window counts from this, not from when the seat was typed in. */
    paid_at: z.number().int().positive().optional(),
    amount_krw: z.number().int().min(0).max(10_000_000).optional(),
    note: z.string().max(200).optional()
  })
  .strict()
  .refine((v) => Boolean(v.payer_guardian_id) !== Boolean(v.payer_player_id), { message: 'one payer' });
const ExtendSchema = z
  .object({
    days: z.number().int().min(1).max(400),
    amount_krw: z.number().int().min(0).max(10_000_000).optional(),
    paid_at: z.number().int().positive().optional(),
    note: z.string().max(200).optional()
  })
  .strict();
const DatesSchema = z
  .object({
    starts_at: z.number().int().positive().optional(),
    ends_at: z.number().int().positive().optional(),
    /** A free extension from the console: the end moves to max(now, end) + days. No payment row, no refund window. */
    extend_days: z.number().int().min(1).max(400).optional(),
    note: z.string().max(200).optional()
  })
  .strict()
  .refine((v) => (v.extend_days !== undefined ? v.ends_at === undefined : v.starts_at !== undefined || v.ends_at !== undefined), {
    message: 'starts_at or ends_at, or extend_days without ends_at'
  });
const StopSchema = z.object({ note: z.string().max(200).optional() }).strict();
const DecideSchema = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('decline') }).strict(),
  z.object({ decision: z.literal('refund'), refund_krw: z.number().int().min(0).max(10_000_000) }).strict()
]);
/** The operator presses the rule; the Duo settlement is the payer's choice from their request, never the operator's. */
const RefundSchema = z.object({}).strict();
const RefundRequestSchema = z.object({ mode: Mode.optional(), note: z.string().trim().max(200).optional() }).strict();

export interface SeatDeps {
  sql: SqliteExecutor;
  nowMs: () => number;
  randomBytes: (n: number) => Uint8Array;
}
export interface GuardianRef {
  guardian_id: string;
  family_id: string;
}

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
type Out = { status: 200 | 201 | 400 | 404 | 409; body: Record<string, unknown> };

export type IssueInput = z.infer<typeof IssueSchema>;

/**
 * First issue of a seat (Solo/tutoring one child, Duo two) as one payment: `seat_orders` + `seats` + links + audit in
 * one transaction. The operator's issue button (`POST /v1/admin/seats`, after a bank transfer) and a confirmed online
 * payment (billing.ts, `by: 'billing'`) both come here, so the refund rule and first-use rule see the same rows.
 */
export function issueSeats(d: SeatDeps, q: IssueInput, by: 'operator' | 'billing'): Out {
  const id = (p: string) => `${p}-${hex(d.randomBytes(6))}`;
  const familyOfPlayer = (pid: string) => d.sql.get<{ family_id: string }>('select family_id from players where id = ?', [pid])?.family_id;
  const need = q.plan === 'duo' ? 2 : 1;
  if (q.player_ids.length !== need || new Set(q.player_ids).size !== need) return { status: 400, body: { error: 'seat_count_mismatch', need } };
  const payerFamily = q.payer_player_id ? familyOfPlayer(q.payer_player_id) : undefined;
  const payer = q.payer_guardian_id
    ? d.sql.get<{ id: string; family_id: string }>('select id, family_id from guardians where id = ?', [q.payer_guardian_id])
    : payerFamily
      ? d.sql.get<{ id: string; family_id: string }>('select id, family_id from guardians where family_id = ? order by id limit 1', [payerFamily])
      : undefined;
  if (!payer) return { status: 404, body: { error: 'payer_not_found' } };
  const fams = q.player_ids.map(familyOfPlayer);
  if (fams.some((f) => !f)) return { status: 404, body: { error: 'player_not_found' } };
  // A minor seat lives under a guardian account (docs/16 #1): the payer's own child must be among the seats.
  if (!fams.includes(payer.family_id)) return { status: 400, body: { error: 'payer_not_guardian_of_any_seat' } };
  const now = d.nowMs();
  if (q.paid_at !== undefined && q.paid_at > now + PAID_AT_FUTURE_SLACK_MS) return { status: 400, body: { error: 'paid_at_in_future' } };
  for (const pid of q.player_ids) {
    const live = d.sql.get<SeatRow>("select * from seats where player_id = ? and status <> 'refunded' and ends_at > ?", [pid, now]);
    if (live) return { status: 409, body: { error: 'seat_exists', seat_id: live.id } };
  }
  const paidAt = q.paid_at ?? now;
  const amount = q.amount_krw ?? (q.plan === 'tutoring' ? 0 : PLAN_PRICES_KRW[q.plan][q.term]);
  const oid = id('ord');
  const ends = paidAt + TERM_DAYS[q.term] * DAY;
  const seats = runInTransaction(d.sql, () => {
    d.sql.run('insert into seat_orders (id, payer_id, plan, term, amount_krw, paid_at, created_at, note) values (?, ?, ?, ?, ?, ?, ?, ?)', [
      oid,
      payer.id,
      q.plan,
      q.term,
      amount,
      paidAt,
      now,
      q.note ?? ''
    ]);
    return q.player_ids.map((pid) => {
      const sid = id('seat');
      d.sql.run('insert into seats (id, payer_id, player_id, plan, period, starts_at, ends_at, status) values (?, ?, ?, ?, ?, ?, ?, ?)', [
        sid,
        payer.id,
        pid,
        q.plan,
        q.term,
        paidAt,
        ends,
        'active'
      ]);
      d.sql.run("insert into seat_order_links (seat_id, order_id, kind, days, refunded_at) values (?, ?, 'issue', null, null)", [sid, oid]);
      d.sql.run('insert into seat_changes (id, seat_id, kind, by, at, before_json, after_json, note) values (?, ?, ?, ?, ?, ?, ?, ?)', [
        id('sc'),
        sid,
        'issue',
        by,
        now,
        JSON.stringify(null),
        JSON.stringify({ starts_at: paidAt, ends_at: ends, status: 'active', plan: q.plan, term: q.term, order_id: oid, amount_krw: amount }),
        q.note ?? ''
      ]);
      return sid;
    });
  });
  return { status: 201, body: { order_id: oid, seat_ids: seats, amount_krw: amount, ends_at: ends, refund_until: refundDeadlineMs(paidAt) } };
}

/** Operator routes (behind the operator gate) and guardian routes (behind `withGuardian`). */
export function mountSeatRoutes(
  app: Hono,
  d: SeatDeps,
  withGuardian: (c: Context, needService: boolean) => Promise<GuardianRef | Response>
): void {
  d.sql.exec(SEATS_SCHEMA);
  const id = (p: string) => `${p}-${hex(d.randomBytes(6))}`;
  const seatRow = (sid: string) => d.sql.get<SeatRow>('select * from seats where id = ?', [sid]);
  const nickOf = (pid: string) => d.sql.get<{ nickname: string }>('select nickname from players where id = ?', [pid])?.nickname ?? '';
  const familyOfPlayer = (pid: string) => d.sql.get<{ family_id: string }>('select family_id from players where id = ?', [pid])?.family_id;
  /** All payments of a seat, newest first. */
  const linksOf = (sid: string) =>
    d.sql.all<LinkRow>(
      'select o.*, l.seat_id, l.order_id, l.kind, l.days, l.refunded_at from seat_order_links l join seat_orders o on o.id = l.order_id where l.seat_id = ? order by o.paid_at desc, o.created_at desc',
      [sid]
    );
  const issueLink = (sid: string) => linksOf(sid).find((l) => l.kind === 'issue');
  const periodOf = (s: Pick<SeatRow, 'starts_at' | 'ends_at' | 'status'>) => ({ starts_at: s.starts_at, ends_at: s.ends_at, status: s.status });
  /** One audit row per change (see `seat_changes`). Call inside the transaction that makes the change. */
  const recordChange = (
    sid: string,
    kind: SeatChangeKind,
    at: number,
    before: Record<string, unknown> | null,
    after: Record<string, unknown>,
    note = ''
  ) =>
    d.sql.run('insert into seat_changes (id, seat_id, kind, by, at, before_json, after_json, note) values (?, ?, ?, ?, ?, ?, ?, ?)', [
      id('sc'),
      sid,
      kind,
      'operator',
      at,
      JSON.stringify(before),
      JSON.stringify(after),
      note
    ]);
  const orderSeats = (oid: string) =>
    d.sql.all<SeatRow>('select s.* from seats s join seat_order_links l on l.seat_id = s.id where l.order_id = ? order by s.id', [oid]);
  const refundedSoFar = (oid: string) =>
    Number(d.sql.get<{ s: number | null }>("select sum(refund_krw) as s from seat_refunds where order_id = ? and status = 'done'", [oid])?.s ?? 0);
  const leftOf = (o: Pick<OrderRow, 'id' | 'amount_krw'>) => Math.max(0, o.amount_krw - refundedSoFar(o.id));
  /** The other, still-live seat of a Duo issue order, if the Duo is whole. */
  const duoPartner = (sid: string): SeatRow | null => {
    const l = issueLink(sid);
    if (!l || l.plan !== 'duo') return null;
    const others = orderSeats(l.order_id).filter((x) => x.id !== sid && x.status !== 'refunded');
    return others.length === 1 ? others[0]! : null;
  };
  const openRequest = (sid: string) =>
    d.sql.get<{ id: string; requested_at: number; status: 'pending' | 'review'; mode: DuoRefundMode | null; requested_by: string }>(
      "select id, requested_at, status, mode, requested_by from seat_refunds where seat_id = ? and status in ('pending', 'review') order by requested_at limit 1",
      [sid]
    );
  /**
   * Had this payment been used by `asOf`? The issue payment by any use of the seat; an extension by use from its first
   * day. `asOf` is the time of the guardian's request when there is one: a refund asked for before the first use is
   * judged as of that moment (the guardian withdrew before using), even if the operator answers after the child played.
   */
  const usedPayment = (l: Pick<LinkRow, 'seat_id' | 'order_id' | 'kind'>, asOf = Number.POSITIVE_INFINITY): boolean => {
    const u = seatUsage(d.sql, l.seat_id);
    if (!u || u.first_used_at >= asOf) return false;
    if (l.kind === 'issue') return true;
    const from = d.sql.get<{ period_from: number }>('select period_from from seat_order_periods where order_id = ?', [l.order_id])?.period_from;
    // An old extension without its start day counts as used once the seat is.
    if (from === undefined) return true;
    // Its own first use (seat_order_usage), judged as of asOf like the seat's.
    const own = d.sql.get<{ first_used_at: number }>('select first_used_at from seat_order_usage where order_id = ?', [l.order_id])?.first_used_at;
    return own !== undefined && own < asOf;
  };
  /**
   * Which payment the refund rule looks at: a refundable one first (in its window and unused: the issue payment, else
   * the newest extension), else the issue payment in its window (to say why not), else the newest open payment.
   */
  const ruleTarget = (sid: string, now: number, asOf?: number) => {
    const live = linksOf(sid).filter((l) => l.refunded_at === null);
    const inWin = live.filter((l) => inRefundWindow(l.paid_at, now));
    const ok = inWin.filter((l) => !usedPayment(l, asOf));
    return ok.find((l) => l.kind === 'issue') ?? ok[0] ?? inWin.find((l) => l.kind === 'issue') ?? inWin[0] ?? live[0] ?? null;
  };
  const describePayments = (sid: string) =>
    linksOf(sid).map((l) => ({
      order_id: l.order_id,
      kind: l.kind,
      plan: l.plan,
      days: l.kind === 'extend' ? l.days : TERM_DAYS[l.term],
      amount_krw: l.amount_krw,
      paid_at: l.paid_at,
      refund_until: refundDeadlineMs(l.paid_at),
      refunded_krw: refundedSoFar(l.order_id),
      refunded: l.refunded_at !== null,
      used: usedPayment(l)
    }));

  /** The one refund rule, used by the operator button (docs/09 P6). Runs inside a transaction. */
  const executeRefund = (sid: string, now: number, requestedBy: string): Out => {
    const s = seatRow(sid);
    if (!s) return { status: 404, body: { error: 'seat_not_found' } };
    if (s.status === 'refunded') return { status: 409, body: { error: 'already_refunded' } };
    const open = openRequest(sid);
    // A guardian's open request fixes the moment use is judged at (see usedPayment).
    const asOf = open?.requested_at;
    const target = ruleTarget(sid, now, asOf);
    if (!target) return { status: 404, body: { error: 'payment_not_found' } };
    const record = (orderId: string, refund: number, soloDays: number | null, mode: DuoRefundMode | null) =>
      d.sql.run(
        'insert into seat_refunds (id, seat_id, order_id, requested_by, requested_at, mode, status, refund_krw, remaining_solo_days, decided_at, reason) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id('rf'), sid, orderId, requestedBy, now, mode, 'done', refund, soloDays, now, null]
      );
    // Every open request on this seat (pending or review) is answered by the rule refund.
    const closeOpen = () =>
      d.sql.run("update seat_refunds set status = 'closed', decided_at = ? where seat_id = ? and status in ('pending', 'review')", [now, sid]);
    // Outside the rule → one open review item per seat in the operator inbox; the seat itself does not change.
    const toReview = (reason: string) => {
      if (open) d.sql.run("update seat_refunds set status = 'review', reason = ?, order_id = ? where id = ?", [reason, target.order_id, open.id]);
      else
        d.sql.run(
          'insert into seat_refunds (id, seat_id, order_id, requested_by, requested_at, mode, status, refund_krw, remaining_solo_days, decided_at, reason) values (?, ?, ?, ?, ?, ?, ?, null, null, null, ?)',
          [id('rf'), sid, target.order_id, requestedBy, now, null, 'review', reason]
        );
    };
    // Ending a seat: every payment still open on it is returned in full (what is left of each), the seat stops now.
    const endSeat = (): number => {
      let total = 0;
      for (const l of linksOf(sid).filter((x) => x.refunded_at === null && x.kind === 'extend')) {
        const left = leftOf(l);
        if (left > 0) record(l.order_id, left, null, null);
        total += left;
      }
      d.sql.run("update seats set status = 'refunded', ends_at = ? where id = ?", [now, sid]);
      d.sql.run('update seat_order_links set refunded_at = ? where seat_id = ? and refunded_at is null', [now, sid]);
      recordChange(sid, 'refund', now, periodOf(s), { starts_at: s.starts_at, ends_at: now, status: 'refunded' });
      return total;
    };

    if (usedPayment(target, asOf)) {
      // First use ends the refund (docs/01 §4): the button refuses, and a request still open on this seat is answered
      // as declined with the reason (the guardian sees it; a refund_declined notice goes out if sending is on).
      if (open) d.sql.run("update seat_refunds set status = 'declined', reason = 'seat_used', decided_at = ? where id = ?", [now, open.id]);
      return { status: 409, body: { error: 'seat_used', first_used_at: seatUsage(d.sql, sid)?.first_used_at ?? null } };
    }
    if (!inRefundWindow(target.paid_at, now)) {
      // Tutoring follows the same rule (coordinator 11-16): unused and inside 7 days → back; used → never.
      toReview('outside_refund_window');
      return { status: 409, body: { error: 'outside_refund_window' } };
    }

    if (target.kind === 'extend') {
      // An extension paid within the window: return it and take its days back.
      const refund = leftOf(target);
      d.sql.run('update seats set ends_at = ends_at - ? where id = ?', [(target.days ?? 0) * DAY, sid]);
      d.sql.run('update seat_order_links set refunded_at = ? where seat_id = ? and order_id = ?', [now, sid, target.order_id]);
      record(target.order_id, refund, null, null);
      recordChange(sid, 'refund_extend', now, periodOf(s), {
        starts_at: s.starts_at,
        ends_at: s.ends_at - (target.days ?? 0) * DAY,
        status: s.status,
        order_id: target.order_id,
        refund_krw: refund
      });
      closeOpen();
      return { status: 200, body: { refund_krw: refund, payer_id: target.payer_id, remaining_seat: null, removed_days: target.days ?? 0 } };
    }

    const partner = target.plan === 'duo' ? duoPartner(sid) : null;
    if (partner) {
      if (!hasSingleDuoPayer([{ seatId: s.id, payerId: s.payer_id }, { seatId: partner.id, payerId: partner.payer_id }])) {
        toReview('duo_payer_mismatch');
        return { status: 409, body: { error: 'duo_payer_mismatch' } };
      }
      // Only the payer decides how a Duo partial refund is settled (docs/01 §4).
      const mode = open?.mode ?? null;
      if (!mode) return { status: 409, body: { error: 'awaiting_payer_choice' } };
      const r = settleDuoSeatRefund({ term: target.term, paidAtMs: target.paid_at, refundRequestedAtMs: now, paidAmountKrw: target.amount_krw, mode });
      if (!r.eligible) return { status: 409, body: { error: r.reason } };
      const cash = Math.min(r.refundKrw, leftOf(target));
      record(target.order_id, cash, r.remainingSoloDays, mode);
      const extra = endSeat();
      // The remaining seat becomes Solo; convert mode swaps the Duo term for the Solo days and keeps any extension.
      const newEnd = mode === 'convert_to_solo_days' ? partner.ends_at - (TERM_DAYS[target.term] - r.remainingSoloDays) * DAY : partner.ends_at;
      d.sql.run("update seats set plan = 'solo', ends_at = ? where id = ?", [newEnd, partner.id]);
      recordChange(partner.id, 'duo_to_solo', now, { ...periodOf(partner), plan: 'duo' }, { starts_at: partner.starts_at, ends_at: newEnd, status: partner.status, plan: 'solo', mode });
      closeOpen();
      return {
        status: 200,
        body: {
          refund_krw: cash + extra,
          payer_id: target.payer_id,
          mode,
          remaining_seat: { id: partner.id, plan: 'solo', ends_at: newEnd, solo_days: r.remainingSoloDays }
        }
      };
    }

    // Solo, or the last seat of a Duo: the rest of what was paid (docs/01 §4: 7일 이내 전액).
    const left = leftOf(target);
    record(target.order_id, left, null, null);
    const extra = endSeat();
    closeOpen();
    return { status: 200, body: { refund_krw: left + extra, payer_id: target.payer_id, remaining_seat: null } };
  };

  /* ---------- operator ---------- */

  app.post('/v1/admin/seats', async (c) => {
    const p = IssueSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!p.success) return c.json({ error: 'invalid', issues: p.error.issues }, 400);
    const r = issueSeats(d, p.data, 'operator');
    return c.json(r.body, r.status);
  });

  /** A paid (or free) extension of one seat: recorded as its own payment with its own refund window. */
  app.post('/v1/admin/seats/:id/extend', async (c) => {
    const s = seatRow(c.req.param('id'));
    if (!s) return c.json({ error: 'seat_not_found' }, 404);
    if (s.status === 'refunded') return c.json({ error: 'already_refunded' }, 409);
    const p = ExtendSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!p.success) return c.json({ error: 'invalid', issues: p.error.issues }, 400);
    const now = d.nowMs();
    if (p.data.paid_at !== undefined && p.data.paid_at > now + PAID_AT_FUTURE_SLACK_MS) return c.json({ error: 'paid_at_in_future' }, 400);
    const paidAt = p.data.paid_at ?? now;
    const amount = p.data.amount_krw ?? extensionPriceKrw(s.plan, p.data.days);
    const ends = Math.max(now, s.ends_at) + p.data.days * DAY;
    const oid = id('ord');
    runInTransaction(d.sql, () => {
      d.sql.run('insert into seat_orders (id, payer_id, plan, term, amount_krw, paid_at, created_at, note) values (?, ?, ?, ?, ?, ?, ?, ?)', [
        oid,
        s.payer_id,
        s.plan,
        p.data.days >= TERM_DAYS.year ? 'year' : 'month',
        amount,
        paidAt,
        now,
        p.data.note ?? ''
      ]);
      d.sql.run("insert into seat_order_links (seat_id, order_id, kind, days, refunded_at) values (?, ?, 'extend', ?, null)", [s.id, oid, p.data.days]);
      // The extension's days begin where the seat ended (or now, if it had already ended): its own "first use" line.
      d.sql.run('insert or replace into seat_order_periods (order_id, period_from) values (?, ?)', [oid, Math.max(now, s.ends_at)]);
      d.sql.run("update seats set ends_at = ?, status = 'active' where id = ?", [ends, s.id]);
      d.sql.run('delete from seat_notices where seat_id = ?', [s.id]);
      recordChange(s.id, 'extend', now, periodOf(s), { starts_at: s.starts_at, ends_at: ends, status: 'active', days: p.data.days, order_id: oid, amount_krw: amount }, p.data.note ?? '');
    });
    return c.json({ id: s.id, order_id: oid, amount_krw: amount, ends_at: ends, refund_until: refundDeadlineMs(paidAt), state: seatState({ ends_at: ends, status: 'active' }, now) });
  });

  /**
   * The teacher sets a seat's start and/or end date directly (teacher console). No payment is made or changed; the
   * state follows the new end (a past end → read-only, as with any expiry). Notices are cleared so the 7-day/1-day
   * reminders follow the new end.
   */
  app.post('/v1/admin/seats/:id/dates', async (c) => {
    const p = DatesSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!p.success) return c.json({ error: 'invalid', issues: p.error.issues }, 400);
    const now = d.nowMs();
    const out = runInTransaction(d.sql, (): Out => {
      const s = seatRow(c.req.param('id'));
      if (!s) return { status: 404, body: { error: 'seat_not_found' } };
      if (s.status === 'refunded') return { status: 409, body: { error: 'already_refunded' } };
      const days = p.data.extend_days;
      const starts = p.data.starts_at ?? s.starts_at;
      const ends = days !== undefined ? Math.max(now, s.ends_at) + days * DAY : (p.data.ends_at ?? s.ends_at);
      if (ends <= starts) return { status: 400, body: { error: 'ends_before_starts' } };
      if (ends > now + SEAT_MAX_AHEAD_MS) return { status: 400, body: { error: 'date_too_far' } };
      // Only what changes is checked against the clock (an old seat keeps its old start).
      if (starts !== s.starts_at && starts > now + SEAT_START_AHEAD_MS) return { status: 400, body: { error: 'start_in_future' } };
      if (starts !== s.starts_at && starts < now - SEAT_MAX_AHEAD_MS) return { status: 400, body: { error: 'date_too_old' } };
      // A far-past end by a typo would archive the seat and, through voice.ts retention (last end + 365 days), queue the
      // child's recordings for deletion: an edited end is never earlier than the 30 read-only days.
      if (ends !== s.ends_at && ends < now - SEAT_READ_ONLY_MS) return { status: 400, body: { error: 'date_too_old' } };
      if (starts === s.starts_at && ends === s.ends_at) return { status: 200, body: { id: s.id, starts_at: starts, ends_at: ends, state: seatState(s, now), changed: false } };
      d.sql.run('update seats set starts_at = ?, ends_at = ? where id = ?', [starts, ends, s.id]);
      if (ends !== s.ends_at) d.sql.run('delete from seat_notices where seat_id = ?', [s.id]);
      recordChange(
        s.id,
        days !== undefined ? 'extend' : 'edit_dates',
        now,
        periodOf(s),
        { starts_at: starts, ends_at: ends, status: s.status, ...(days !== undefined ? { days, amount_krw: 0 } : {}) },
        p.data.note ?? ''
      );
      return { status: 200, body: { id: s.id, starts_at: starts, ends_at: ends, state: seatState({ ends_at: ends, status: s.status }, now), changed: true } };
    });
    return c.json(out.body, out.status);
  });

  /**
   * Stop (중지): the seat ends now — solo play pauses and the usual 30 read-only days start. Not a refund: payments and
   * the refund flows are untouched (a refund is still POST /refund or a guardian request). Extending later reopens it.
   */
  app.post('/v1/admin/seats/:id/stop', async (c) => {
    const p = StopSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!p.success) return c.json({ error: 'invalid', issues: p.error.issues }, 400);
    const now = d.nowMs();
    const out = runInTransaction(d.sql, (): Out => {
      const s = seatRow(c.req.param('id'));
      if (!s) return { status: 404, body: { error: 'seat_not_found' } };
      if (s.status === 'refunded') return { status: 409, body: { error: 'already_refunded' } };
      if (s.ends_at <= now) return { status: 409, body: { error: 'already_ended' } };
      // A seat that has not started yet also starts now (ends_at > starts_at must hold).
      const ends = now;
      const starts = Math.min(s.starts_at, now - 1);
      d.sql.run('update seats set starts_at = ?, ends_at = ? where id = ?', [starts, ends, s.id]);
      d.sql.run('delete from seat_notices where seat_id = ?', [s.id]);
      recordChange(s.id, 'stop', now, periodOf(s), { starts_at: starts, ends_at: ends, status: s.status }, p.data.note ?? '');
      return { status: 200, body: { id: s.id, starts_at: starts, ends_at: ends, state: seatState({ ends_at: ends, status: s.status }, now) } };
    });
    return c.json(out.body, out.status);
  });

  /** The audit of one seat, newest first. */
  app.get('/v1/admin/seats/:id/changes', (c) => {
    const sid = c.req.param('id');
    if (!seatRow(sid)) return c.json({ error: 'seat_not_found' }, 404);
    const rows = d.sql.all<{ id: string; kind: string; by: string; at: number; before_json: string; after_json: string; note: string }>(
      'select id, kind, by, at, before_json, after_json, note from seat_changes where seat_id = ? order by at desc, rowid desc limit 200',
      [sid]
    );
    return c.json(
      rows.map((r) => ({ id: r.id, kind: r.kind, by: r.by, at: r.at, before: JSON.parse(r.before_json) as unknown, after: JSON.parse(r.after_json) as unknown, note: r.note }))
    );
  });

  app.post('/v1/admin/seats/:id/refund', async (c) => {
    const p = RefundSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!p.success) return c.json({ error: 'invalid', issues: p.error.issues }, 400);
    // Seat, the other Duo seat and the refund records change together or not at all.
    const r = runInTransaction(d.sql, () => executeRefund(c.req.param('id'), d.nowMs(), 'operator'));
    return c.json(r.body, r.status);
  });

  /**
   * Operator decision on a 'review' inbox item (outside the rule): decline (nothing changes), or an exception refund of
   * the amount the operator actually sends back (the seat ends now). Never more than is left of the seat's payments.
   * Requests inside the rule ('pending') go through POST /v1/admin/seats/:id/refund instead.
   */
  app.post('/v1/admin/seat-refunds/:id/decide', async (c) => {
    const p = DecideSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!p.success) return c.json({ error: 'invalid', issues: p.error.issues }, 400);
    const now = d.nowMs();
    const out = runInTransaction(d.sql, (): Out => {
      const r = d.sql.get<{ id: string; seat_id: string; order_id: string; status: string }>(
        'select id, seat_id, order_id, status from seat_refunds where id = ?',
        [c.req.param('id')]
      );
      if (!r || (r.status !== 'review' && r.status !== 'pending')) return { status: 404, body: { error: 'request_not_found' } };
      if (r.status === 'pending') return { status: 409, body: { error: 'use_rule_refund' } };
      const s = seatRow(r.seat_id);
      if (!s || s.status === 'refunded') {
        d.sql.run("update seat_refunds set status = 'closed', decided_at = ? where id = ?", [now, r.id]);
        return { status: 409, body: { error: 'already_refunded' } };
      }
      if (p.data.decision === 'decline') {
        d.sql.run("update seat_refunds set status = 'declined', decided_at = ? where id = ?", [now, r.id]);
        return { status: 200, body: { id: r.id, status: 'declined' } };
      }
      const open = linksOf(s.id).filter((l) => l.refunded_at === null);
      const max = open.reduce((sum, l) => sum + leftOf(l), 0);
      if (p.data.refund_krw > max) return { status: 400, body: { error: 'refund_exceeds_paid', max_krw: max } };
      // Book the amount against the seat's payments, newest first, so no single payment goes below zero.
      let rest = p.data.refund_krw;
      let first = true;
      for (const l of open) {
        const take = Math.min(rest, leftOf(l));
        if (first) {
          d.sql.run("update seat_refunds set status = 'done', refund_krw = ?, order_id = ?, decided_at = ? where id = ?", [take, l.order_id, now, r.id]);
          first = false;
        } else if (take > 0) {
          d.sql.run(
            "insert into seat_refunds (id, seat_id, order_id, requested_by, requested_at, mode, status, refund_krw, remaining_solo_days, decided_at, reason) values (?, ?, ?, 'operator', ?, null, 'done', ?, null, ?, 'exception')",
            [id('rf'), s.id, l.order_id, now, take, now]
          );
        }
        rest -= take;
      }
      if (first) d.sql.run("update seat_refunds set status = 'done', refund_krw = 0, decided_at = ? where id = ?", [now, r.id]);
      d.sql.run("update seats set status = 'refunded', ends_at = ? where id = ?", [now, s.id]);
      d.sql.run('update seat_order_links set refunded_at = ? where seat_id = ? and refunded_at is null', [now, s.id]);
      d.sql.run("update seat_refunds set status = 'closed', decided_at = ? where seat_id = ? and status in ('pending', 'review')", [now, s.id]);
      recordChange(s.id, 'refund', now, periodOf(s), { starts_at: s.starts_at, ends_at: now, status: 'refunded', refund_krw: p.data.refund_krw }, 'exception');
      return { status: 200, body: { id: r.id, status: 'done', refund_krw: p.data.refund_krw } };
    });
    return c.json(out.body, out.status);
  });

  app.get('/v1/admin/seats', (c) => {
    const now = d.nowMs();
    const rows = d.sql.all<SeatRow>('select * from seats order by ends_at desc limit 500');
    return c.json(
      rows.map((s) => {
        const target = s.status === 'refunded' ? null : ruleTarget(s.id, now);
        return {
          id: s.id,
          player_id: s.player_id,
          nickname: nickOf(s.player_id),
          plan: s.plan,
          term: s.period,
          starts_at: s.starts_at,
          ends_at: s.ends_at,
          state: seatState(s, now),
          payer_id: s.payer_id,
          payments: describePayments(s.id),
          first_used_at: seatUsage(d.sql, s.id)?.first_used_at ?? null,
          first_used_via: seatUsage(d.sql, s.id)?.first_via ?? null,
          rule_refund_open: Boolean(
            target && leftOf(target) > 0 && inRefundWindow(target.paid_at, now) && !usedPayment(target, openRequest(s.id)?.requested_at)
          ),
          awaiting_payer_choice: Boolean(target && target.kind === 'issue' && duoPartner(s.id) && !openRequest(s.id)?.mode)
        };
      })
    );
  });

  /** Operator inbox (docs/09 확인함): guardian refund requests, requests outside the rule, seats ending within 7 days. */
  app.get('/v1/admin/seat-inbox', (c) => {
    const now = d.nowMs();
    const requests = d.sql.all<Record<string, unknown>>(
      `select r.id, r.seat_id, r.requested_by, r.requested_at, r.mode, r.status, r.reason, r.note, s.plan, s.player_id, p.nickname,
              o.paid_at, o.amount_krw, o.term
       from seat_refunds r join seats s on s.id = r.seat_id join seat_orders o on o.id = r.order_id left join players p on p.id = s.player_id
       where r.status in ('pending', 'review') order by r.requested_at`
    );
    for (const r of requests) {
      // docs/09 확인함 "환불 요청: 사유, 결제일, 사용 기록" — usage since payment, counted not quoted.
      const since = Number(r.paid_at);
      r.usage = {
        lessons: Number(d.sql.get<{ n: number }>('select count(*) as n from lessons where player_id = ? and started_at >= ?', [r.player_id, since])?.n ?? 0),
        utterances: Number(d.sql.get<{ n: number }>('select count(*) as n from utterances where player_id = ? and created_at >= ?', [r.player_id, since])?.n ?? 0)
      };
      const target = ruleTarget(String(r.seat_id), now);
      r.refund_until = refundDeadlineMs(Number(r.paid_at));
      r.first_used_at = seatUsage(d.sql, String(r.seat_id))?.first_used_at ?? null;
      // A Duo partial refund waits until the payer has chosen (refund the difference, or convert to Solo days).
      r.awaiting_payer_choice = r.status === 'pending' && !r.mode && Boolean(target?.kind === 'issue' && duoPartner(String(r.seat_id)));
    }
    const expiring = d.sql
      .all<SeatRow>("select * from seats where status <> 'refunded' and ends_at > ? and ends_at <= ? order by ends_at", [now, now + SEAT_EXPIRING_MS])
      .map((s) => ({ id: s.id, player_id: s.player_id, nickname: nickOf(s.player_id), plan: s.plan, term: s.period, ends_at: s.ends_at }));
    // R326: online orders waiting for the operator — a test-mode order waits for the transfer ('transfer_wait'), a paid
    // one the seat could not open by itself ('paid': Duo, no guardian yet). The issue form below opens the seat.
    d.sql.exec(BILLING_SCHEMA);
    const orders = d.sql.all<Record<string, unknown>>(
      `select o.id, o.plan, o.term, o.amount_krw, o.player_id, p.nickname, o.payer_name, o.contact, o.origin, o.mode, o.status, o.created_at, o.paid_at
       from billing_orders o left join players p on p.id = o.player_id where o.status in ('transfer_wait', 'paid') order by o.created_at limit 100`
    );
    return c.json({ requests, expiring, orders });
  });

  /* ---------- guardian ---------- */

  const visibleSeats = (g: GuardianRef) =>
    d.sql.all<SeatRow>(
      'select s.* from seats s left join players p on p.id = s.player_id where p.family_id = ? or s.payer_id = ? order by s.ends_at desc',
      [g.family_id, g.guardian_id]
    );

  app.get('/v1/family/seats', async (c) => {
    const g = await withGuardian(c, false);
    if (g instanceof Response) return g;
    const now = d.nowMs();
    const seats = visibleSeats(g).map((s) => {
      const mine = familyOfPlayer(s.player_id) === g.family_id;
      const isPayer = s.payer_id === g.guardian_id;
      const target = s.status === 'refunded' ? null : ruleTarget(s.id, now);
      const partner = target?.kind === 'issue' ? duoPartner(s.id) : null;
      const open = openRequest(s.id);
      const notice = d.sql.get<{ kind: string; at: number }>('select kind, at from seat_notices where seat_id = ? order by at desc limit 1', [s.id]);
      const state = seatState(s, now);
      const live = state === 'active' || state === 'expiring';
      const refundUntil = target ? refundDeadlineMs(target.paid_at) : null;
      const inWindow = Boolean(target && inRefundWindow(target.paid_at, now));
      const usage = seatUsage(d.sql, s.id);
      const used = Boolean(target && usedPayment(target));
      const paidLeft = linksOf(s.id)
        .filter((l) => l.refunded_at === null)
        .reduce((sum, l) => sum + leftOf(l), 0);
      const awaiting = Boolean(open && open.status === 'pending' && !open.mode && partner);
      return {
        id: s.id,
        // Another family's Duo seat shows no child name or id (docs/01 §4).
        child: mine ? { player_id: s.player_id, nickname: nickOf(s.player_id) } : null,
        plan: s.plan,
        term: s.period,
        starts_at: s.starts_at,
        ends_at: s.ends_at,
        state,
        read_only_until: state === 'read_only' ? s.ends_at + SEAT_READ_ONLY_MS : null,
        is_payer: isPayer,
        // Payment history only to the payer.
        payments: isPayer ? describePayments(s.id) : null,
        /** Exclusive end of the refund window of the payment the rule would look at (KST 24:00 of the 7th day). */
        refund_until: refundUntil,
        /** When the seat was first used (server record); from then on its paid period is not refunded. */
        first_used_at: usage?.first_used_at ?? null,
        /** Refundable now: in the window and not used yet ('환불 가능(아직 사용 전)'). */
        refundable: Boolean(target && live && inWindow && !used && paidLeft > 0),
        // nothing_paid: a seat included in something else (a tutoring seat inside the teacher's fee) has no money here.
        // Nothing paid comes first: a used 0원 seat must not say '이용을 시작한 이용권은 환불되지 않습니다'.
        refund_block: !target || !live ? null : paidLeft === 0 ? 'nothing_paid' : used ? 'seat_used' : !inWindow ? 'outside_refund_window' : null,
        // A seat the teacher stopped inside its refund window can still be asked about (stop is not a refund).
        can_request_refund: (isPayer || mine) && (live || (inWindow && state === 'read_only')) && !open && !used && paidLeft > 0,
        // Open request; the requester's identity and note stay with the operator.
        pending_request: open ? { id: open.id, requested_at: open.requested_at, status: open.status, awaiting_payer_choice: awaiting } : null,
        /** The payer must still choose how the Duo partial refund is settled (another family asked first). */
        can_choose_mode: isPayer && awaiting,
        notice: notice ?? null,
        // The payer's two choices for leaving one Duo seat (docs/01 §4), computed by the same rule the operator runs.
        duo_options: isPayer && partner && target && inWindow && !used ? duoOptions(target.term, target.paid_at, target.amount_krw, now) : null
      };
    });
    return c.json({ seats, server_now: now });
  });

  app.post('/v1/family/seats/:id/refund-request', async (c) => {
    const g = await withGuardian(c, false);
    if (g instanceof Response) return g;
    const s = seatRow(c.req.param('id'));
    const mine = s ? familyOfPlayer(s.player_id) === g.family_id : false;
    if (!s || !(mine || s.payer_id === g.guardian_id)) return c.json({ error: 'seat_not_found' }, 404);
    const p = RefundRequestSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!p.success) return c.json({ error: 'invalid', issues: p.error.issues }, 400);
    const now = d.nowMs();
    const out = runInTransaction(d.sql, (): Out => {
      if (s.status === 'refunded') return { status: 409, body: { error: 'already_refunded' } };
      const target = ruleTarget(s.id, now);
      if (!target) return { status: 404, body: { error: 'seat_not_found' } };
      const isPayer = s.payer_id === g.guardian_id;
      const duo = target.kind === 'issue' && Boolean(duoPartner(s.id));
      const open = openRequest(s.id);
      // A new request on a used seat → refused now, with the reason (docs/01 §4); no inbox item. An open request made
      // before the first use keeps going (the payer may still answer it with the Duo choice).
      if (!open && usedPayment(target)) return { status: 409, body: { error: 'seat_used', first_used_at: seatUsage(d.sql, s.id)?.first_used_at ?? null } };
      if (open) {
        // The payer answers a waiting Duo request with the settlement choice; nothing else changes an open request.
        if (isPayer && duo && open.status === 'pending' && p.data.mode && !open.mode) {
          d.sql.run('update seat_refunds set mode = ? where id = ?', [p.data.mode, open.id]);
          return { status: 200, body: { id: open.id, status: open.status, mode: p.data.mode } };
        }
        return { status: 409, body: { error: 'already_requested' } };
      }
      // Only the payer chooses the Duo settlement; another family's request waits for it (mode null).
      const mode = isPayer && duo ? (p.data.mode ?? null) : null;
      // Inside the rule → 'pending' (the operator's one button); outside the 7 days → 'review'. Tutoring follows the same rule.
      const reason = !inRefundWindow(target.paid_at, now) ? 'outside_refund_window' : null;
      const rid = id('rf');
      d.sql.run(
        'insert into seat_refunds (id, seat_id, order_id, requested_by, requested_at, mode, status, refund_krw, remaining_solo_days, decided_at, reason, note) values (?, ?, ?, ?, ?, ?, ?, null, null, null, ?, ?)',
        [rid, s.id, target.order_id, g.guardian_id, now, mode, reason ? 'review' : 'pending', reason, p.data.note ?? '']
      );
      return {
        status: 201,
        body: { id: rid, status: reason ? 'review' : 'pending', awaiting_payer_choice: !reason && duo && !mode }
      };
    });
    return c.json(out.body, out.status);
  });
}
