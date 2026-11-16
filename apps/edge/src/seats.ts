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
import { runInTransaction, type SqliteExecutor } from './storage.js';

const DAY = 86_400_000;
export const SEAT_READ_ONLY_MS = 30 * DAY;
export const SEAT_EXPIRING_MS = 7 * DAY;
/** A payment time may be a little ahead of the server clock (typing), not more. */
export const PAID_AT_FUTURE_SLACK_MS = 10 * 60_000;

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
create table if not exists seat_order_periods (order_id text primary key, period_from integer not null)
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
  sql.exec(SEATS_SCHEMA);
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
}

/**
 * Normalizer (hourly with the notices): a seat used before use was recorded (seats issued before this code shipped, or
 * a missed write) gets its first use from what the server already knows — a lesson of a tutoring seat's child inside
 * the seat period (its start), or a linked device seen inside the period (its last sighting, the best we have).
 */
export function backfillSeatUse(sql: SqliteExecutor, nowMs: number): number {
  let n = 0;
  const seats = sql.all<{ id: string; player_id: string; plan: string; starts_at: number; ends_at: number }>(
    "select s.id, s.player_id, s.plan, s.starts_at, s.ends_at from seats s left join seat_usage u on u.seat_id = s.id where u.seat_id is null and s.status <> 'refunded' and s.starts_at <= ?",
    [nowMs]
  );
  for (const s of seats) {
    const to = Math.min(nowMs, s.ends_at);
    const lesson =
      s.plan === 'tutoring'
        ? sql.get<{ at: number | null }>('select min(started_at) as at from lessons where player_id = ? and started_at >= ? and started_at < ?', [s.player_id, s.starts_at, to])?.at ?? null
        : null;
    const device = sql.get<{ at: number | null }>(
      'select max(last_seen_at) as at from devices where player_id = ? and last_seen_at >= ? and last_seen_at < ?',
      [s.player_id, s.starts_at, to]
    )?.at ?? null;
    const at = lesson ?? device;
    if (at === null) continue;
    sql.run('insert or ignore into seat_usage (seat_id, first_used_at, last_used_at, first_via) values (?, ?, ?, ?)', [
      s.id,
      at,
      Math.max(at, device ?? at),
      lesson !== null ? 'lesson' : 'world'
    ]);
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

/**
 * Server-side play gate. The newest seat decides: active/expiring → play; read-only/archived/refunded → no solo play.
 * A child who never had a seat (pre-sale, lesson-only) keeps playing.
 */
export function playAllowed(sql: SqliteExecutor, playerId: string, nowMs: number): { allowed: boolean; seat: { state: SeatState; ends_at: number } | null } {
  const s = sql.get<SeatRow>('select * from seats where player_id = ? order by starts_at desc, ends_at desc limit 1', [playerId]);
  if (!s) return { allowed: true, seat: null };
  const state = seatState(s, nowMs);
  return { allowed: state === 'active' || state === 'expiring', seat: { state, ends_at: s.ends_at } };
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
    if (!u || u.first_used_at > asOf) return false;
    if (l.kind === 'issue') return true;
    const from = d.sql.get<{ period_from: number }>('select period_from from seat_order_periods where order_id = ?', [l.order_id])?.period_from;
    // An old extension without its start day counts as used once the seat is.
    if (from === undefined) return true;
    // last_used_at only moves forward, so "used from its first day by asOf" needs both ends inside.
    return from <= asOf && u.last_used_at >= from;
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
    const q = p.data;
    const need = q.plan === 'duo' ? 2 : 1;
    if (q.player_ids.length !== need || new Set(q.player_ids).size !== need) return c.json({ error: 'seat_count_mismatch', need }, 400);
    const payerFamily = q.payer_player_id ? familyOfPlayer(q.payer_player_id) : undefined;
    const payer = q.payer_guardian_id
      ? d.sql.get<{ id: string; family_id: string }>('select id, family_id from guardians where id = ?', [q.payer_guardian_id])
      : payerFamily
        ? d.sql.get<{ id: string; family_id: string }>('select id, family_id from guardians where family_id = ? order by id limit 1', [payerFamily])
        : undefined;
    if (!payer) return c.json({ error: 'payer_not_found' }, 404);
    const fams = q.player_ids.map(familyOfPlayer);
    if (fams.some((f) => !f)) return c.json({ error: 'player_not_found' }, 404);
    // A minor seat lives under a guardian account (docs/16 #1): the payer's own child must be among the seats.
    if (!fams.includes(payer.family_id)) return c.json({ error: 'payer_not_guardian_of_any_seat' }, 400);
    const now = d.nowMs();
    if (q.paid_at !== undefined && q.paid_at > now + PAID_AT_FUTURE_SLACK_MS) return c.json({ error: 'paid_at_in_future' }, 400);
    for (const pid of q.player_ids) {
      const live = d.sql.get<SeatRow>("select * from seats where player_id = ? and status <> 'refunded' and ends_at > ?", [pid, now]);
      if (live) return c.json({ error: 'seat_exists', seat_id: live.id }, 409);
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
        return sid;
      });
    });
    return c.json({ order_id: oid, seat_ids: seats, amount_krw: amount, ends_at: ends, refund_until: refundDeadlineMs(paidAt) }, 201);
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
    });
    return c.json({ id: s.id, order_id: oid, amount_krw: amount, ends_at: ends, refund_until: refundDeadlineMs(paidAt), state: seatState({ ends_at: ends, status: 'active' }, now) });
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
          rule_refund_open: Boolean(target && inRefundWindow(target.paid_at, now) && !usedPayment(target, openRequest(s.id)?.requested_at)),
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
    return c.json({ requests, expiring });
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
        refund_block: !target || !live ? null : used ? 'seat_used' : paidLeft === 0 ? 'nothing_paid' : !inWindow ? 'outside_refund_window' : null,
        can_request_refund: (isPayer || mine) && live && !open && !used && paidLeft > 0,
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
      // Used → refused now, with the reason (docs/01 §4). No inbox item: the rule has nothing to decide.
      if (usedPayment(target)) return { status: 409, body: { error: 'seat_used', first_used_at: seatUsage(d.sql, s.id)?.first_used_at ?? null } };
      const duo = target.kind === 'issue' && Boolean(duoPartner(s.id));
      const open = openRequest(s.id);
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
