/**
 * Seats (WP-704, docs/01 §4, docs/09 P6): manual issuance after a bank transfer, extension, expiry (30 days read-only,
 * then archived), the 7-day refund rule as one operator button, and the Duo partial refund through
 * `settleDuoSeatRefund` / `hasSingleDuoPayer` (packages/quota). Money never moves here: a refund records the amount
 * the operator transfers back to the single payer.
 *
 * Who may ask: the payer, or the guardian of that seat's child. One family's request never touches the other
 * Duo seat's data (docs/01 §4 "결제자는 1명").
 */
import type { Hono, Context } from 'hono';
import { z } from 'zod';
import {
  PLAN_PRICES_KRW,
  REFUND_WINDOW_MS,
  TERM_DAYS,
  hasSingleDuoPayer,
  settleDuoSeatRefund,
  type BillingTerm,
  type DuoRefundMode
} from '@lcw/quota';
import { runInTransaction, type SqliteExecutor } from './storage.js';

const DAY = 86_400_000;
export const SEAT_READ_ONLY_MS = 30 * DAY;
export const SEAT_EXPIRING_MS = 7 * DAY;

export const SEATS_SCHEMA = `
create table if not exists seat_orders (id text primary key, payer_id text not null, plan text not null, term text not null, amount_krw integer not null, paid_at integer not null, created_at integer not null, note text not null default '');
create table if not exists seat_order_seats (seat_id text primary key, order_id text not null);
create table if not exists seat_refunds (id text primary key, seat_id text not null, order_id text not null, requested_by text not null, requested_at integer not null, mode text, status text not null, refund_krw integer, remaining_solo_days integer, decided_at integer, reason text, note text not null default '');
create table if not exists seat_notices (seat_id text not null, kind text not null, at integer not null, primary key (seat_id, kind));
`;

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

export function duoOptions(term: BillingTerm, paidAtMs: number, paidAmountKrw: number, nowMs: number): { refund_difference_krw: number; solo_days: number } | null {
  const a = settleDuoSeatRefund({ term, paidAtMs, refundRequestedAtMs: nowMs, paidAmountKrw, mode: 'refund_difference' });
  const b = settleDuoSeatRefund({ term, paidAtMs, refundRequestedAtMs: nowMs, paidAmountKrw, mode: 'convert_to_solo_days' });
  return a.eligible && b.eligible ? { refund_difference_krw: a.refundKrw, solo_days: b.remainingSoloDays } : null;
}

/** Time-derived state (docs/09 §5: expiry → 30 days read-only, then archived). */
export function seatState(s: Pick<SeatRow, 'ends_at' | 'status'>, nowMs: number): SeatState {
  if (s.status === 'refunded') return 'refunded';
  if (nowMs < s.ends_at) return s.ends_at - nowMs <= SEAT_EXPIRING_MS ? 'expiring' : 'active';
  return nowMs < s.ends_at + SEAT_READ_ONLY_MS ? 'read_only' : 'archived';
}

/** Play is allowed while a seat is active/expiring; a child who never had a seat (pre-sale, tutoring) keeps playing. */
export function playAllowed(sql: SqliteExecutor, playerId: string, nowMs: number): { allowed: boolean; seat: { state: SeatState; ends_at: number } | null } {
  const s = sql.get<SeatRow>('select * from seats where player_id = ? order by ends_at desc limit 1', [playerId]);
  if (!s) return { allowed: true, seat: null };
  const state = seatState(s, nowMs);
  return { allowed: state === 'active' || state === 'expiring', seat: { state, ends_at: s.ends_at } };
}

/** Hourly: record 7-day / 1-day / expired notices once per seat (shown on /family and in the operator inbox). */
export function sweepSeatNotices(sql: SqliteExecutor, nowMs: number): number {
  sql.exec(SEATS_SCHEMA);
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

const IssueSchema = z
  .object({
    /** The guardian who transferred the money; or `payer_player_id` → that child's family guardian. */
    payer_guardian_id: z.string().min(1).max(64).optional(),
    payer_player_id: z.string().min(1).max(64).optional(),
    plan: z.enum(['solo', 'duo', 'tutoring']),
    term: z.enum(['month', 'year']),
    player_ids: z.array(z.string().min(1).max(64)).min(1).max(2),
    paid_at: z.number().int().positive().optional(),
    amount_krw: z.number().int().min(0).max(10_000_000).optional(),
    note: z.string().max(200).optional()
  })
  .strict()
  .refine((v) => Boolean(v.payer_guardian_id) !== Boolean(v.payer_player_id), { message: 'one payer' });
const ExtendSchema = z.object({ days: z.number().int().min(1).max(400) }).strict();
const DecideSchema = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('decline') }).strict(),
  z.object({ decision: z.literal('refund'), refund_krw: z.number().int().min(0).max(10_000_000) }).strict()
]);
const RefundSchema = z.object({ mode: z.enum(['refund_difference', 'convert_to_solo_days']).optional() }).strict();
const RefundRequestSchema = z
  .object({ mode: z.enum(['refund_difference', 'convert_to_solo_days']).optional(), note: z.string().trim().max(200).optional() })
  .strict();

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

/** Operator routes (behind the operator gate) and guardian routes (behind `withGuardian`). */
export function mountSeatRoutes(
  app: Hono,
  d: SeatDeps,
  withGuardian: (c: Context, needService: boolean) => Promise<GuardianRef | Response>
): void {
  d.sql.exec(SEATS_SCHEMA);
  const id = (p: string) => `${p}-${hex(d.randomBytes(6))}`;
  const seatRow = (sid: string) => d.sql.get<SeatRow>('select * from seats where id = ?', [sid]);
  const orderOf = (sid: string) =>
    d.sql.get<{ id: string; payer_id: string; plan: string; term: BillingTerm; amount_krw: number; paid_at: number }>(
      'select o.* from seat_orders o join seat_order_seats l on l.order_id = o.id where l.seat_id = ?',
      [sid]
    );
  const orderSeats = (oid: string) =>
    d.sql.all<SeatRow>('select s.* from seats s join seat_order_seats l on l.seat_id = s.id where l.order_id = ? order by s.id', [oid]);
  const refundedSoFar = (oid: string) =>
    Number(
      d.sql.get<{ s: number | null }>("select sum(refund_krw) as s from seat_refunds where order_id = ? and status = 'done'", [oid])?.s ?? 0
    );
  const familyOfPlayer = (pid: string) => d.sql.get<{ family_id: string }>('select family_id from players where id = ?', [pid])?.family_id;
  const describe = (s: SeatRow, now: number) => {
    const o = orderOf(s.id);
    return {
      id: s.id,
      player_id: s.player_id,
      plan: s.plan,
      term: s.period,
      starts_at: s.starts_at,
      ends_at: s.ends_at,
      state: seatState(s, now),
      payer_id: s.payer_id,
      order: o
        ? { id: o.id, plan: o.plan, amount_krw: o.amount_krw, paid_at: o.paid_at, refunded_krw: refundedSoFar(o.id), refund_until: o.paid_at + REFUND_WINDOW_MS }
        : null,
      requests: d.sql.all('select id, requested_by, requested_at, mode, status, refund_krw, reason from seat_refunds where seat_id = ? order by requested_at', [s.id])
    };
  };

  /** The one refund rule, used by the operator button (docs/09 P6). */
  const executeRefund = (sid: string, mode: DuoRefundMode, now: number, requestedBy: string) => {
    const s = seatRow(sid);
    const o = orderOf(sid);
    if (!s || !o) return { status: 404 as const, body: { error: 'seat_not_found' } };
    if (s.status === 'refunded') return { status: 409 as const, body: { error: 'already_refunded' } };
    const record = (fields: { status: string; refund_krw: number | null; remaining_solo_days: number | null; reason: string | null }) =>
      d.sql.run(
        'insert into seat_refunds (id, seat_id, order_id, requested_by, requested_at, mode, status, refund_krw, remaining_solo_days, decided_at, reason) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id('rf'), sid, o.id, requestedBy, now, mode, fields.status, fields.refund_krw, fields.remaining_solo_days, now, fields.reason]
      );
    // close any guardian request for this seat
    const closePending = (status: string) =>
      d.sql.run("update seat_refunds set status = ?, decided_at = ? where seat_id = ? and status = 'pending'", [status, now, sid]);
    // Outside the rule → one open review item per seat in the operator inbox; the seat itself does not change.
    const toReview = (reason: string) => {
      const open = d.sql.get<{ id: string }>("select id from seat_refunds where seat_id = ? and status in ('pending', 'review') limit 1", [sid]);
      if (open) d.sql.run("update seat_refunds set status = 'review', reason = ? where id = ?", [reason, open.id]);
      else record({ status: 'review', refund_krw: null, remaining_solo_days: null, reason });
    };
    const inWindow = now - o.paid_at >= 0 && now - o.paid_at <= REFUND_WINDOW_MS;
    if (!inWindow || o.plan === 'tutoring') {
      // Tutoring is priced by the teacher, so it never follows the automatic rule either.
      toReview(inWindow ? 'tutoring_priced_by_teacher' : 'outside_refund_window');
      return { status: 409 as const, body: { error: inWindow ? 'needs_review' : 'outside_refund_window' } };
    }
    const seats = orderSeats(o.id);
    const others = seats.filter((x) => x.id !== sid && x.status !== 'refunded');
    if (o.plan === 'duo' && others.length === 1) {
      if (!hasSingleDuoPayer(seats.map((x) => ({ seatId: x.id, payerId: x.payer_id })))) {
        toReview('duo_payer_mismatch');
        return { status: 409 as const, body: { error: 'duo_payer_mismatch' } };
      }
      const r = settleDuoSeatRefund({ term: o.term, paidAtMs: o.paid_at, refundRequestedAtMs: now, paidAmountKrw: o.amount_krw, mode });
      if (!r.eligible) return { status: 409 as const, body: { error: r.reason } };
      const keep = others[0]!;
      d.sql.run("update seats set status = 'refunded', ends_at = ? where id = ?", [now, sid]);
      const newEnd = mode === 'convert_to_solo_days' ? keep.starts_at + r.remainingSoloDays * DAY : keep.ends_at;
      // The remaining seat becomes Solo; its family's data is untouched.
      d.sql.run("update seats set plan = 'solo', ends_at = ? where id = ?", [newEnd, keep.id]);
      record({ status: 'done', refund_krw: r.refundKrw, remaining_solo_days: r.remainingSoloDays, reason: null });
      closePending('done');
      return {
        status: 200 as const,
        body: { refund_krw: r.refundKrw, payer_id: o.payer_id, remaining_seat: { id: keep.id, plan: 'solo', ends_at: newEnd, solo_days: r.remainingSoloDays } }
      };
    }
    // Solo, or the last seat of a Duo: the rest of what was paid (docs/01 §4: 7일 이내 전액).
    const refund = Math.max(0, o.amount_krw - refundedSoFar(o.id));
    d.sql.run("update seats set status = 'refunded', ends_at = ? where id = ?", [now, sid]);
    record({ status: 'done', refund_krw: refund, remaining_solo_days: null, reason: null });
    closePending('done');
    return { status: 200 as const, body: { refund_krw: refund, payer_id: o.payer_id, remaining_seat: null } };
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
        d.sql.run('insert into seat_order_seats (seat_id, order_id) values (?, ?)', [sid, oid]);
        return sid;
      });
    });
    return c.json({ order_id: oid, seat_ids: seats, amount_krw: amount, ends_at: ends }, 201);
  });

  app.post('/v1/admin/seats/:id/extend', async (c) => {
    const s = seatRow(c.req.param('id'));
    if (!s) return c.json({ error: 'seat_not_found' }, 404);
    if (s.status === 'refunded') return c.json({ error: 'already_refunded' }, 409);
    const p = ExtendSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!p.success) return c.json({ error: 'invalid', issues: p.error.issues }, 400);
    const ends = Math.max(d.nowMs(), s.ends_at) + p.data.days * DAY;
    d.sql.run("update seats set ends_at = ?, status = 'active' where id = ?", [ends, s.id]);
    d.sql.run('delete from seat_notices where seat_id = ?', [s.id]);
    return c.json({ id: s.id, ends_at: ends, state: seatState({ ends_at: ends, status: 'active' }, d.nowMs()) });
  });

  app.post('/v1/admin/seats/:id/refund', async (c) => {
    const p = RefundSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!p.success) return c.json({ error: 'invalid', issues: p.error.issues }, 400);
    const pending = d.sql.get<{ mode: string | null }>("select mode from seat_refunds where seat_id = ? and status = 'pending' order by requested_at limit 1", [
      c.req.param('id')
    ]);
    const mode = (p.data.mode ?? pending?.mode ?? 'refund_difference') as DuoRefundMode;
    // Seat, the other Duo seat and the refund record change together or not at all.
    const r = runInTransaction(d.sql, () => executeRefund(c.req.param('id'), mode, d.nowMs(), 'operator'));
    return c.json(r.body, r.status);
  });

  /**
   * Operator decision on an inbox item outside the rule: decline (nothing changes), or an exception refund of the
   * amount the operator actually sends back (the seat ends now). Rule refunds use POST /v1/admin/seats/:id/refund.
   */
  app.post('/v1/admin/seat-refunds/:id/decide', async (c) => {
    const p = DecideSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!p.success) return c.json({ error: 'invalid', issues: p.error.issues }, 400);
    const r = d.sql.get<{ id: string; seat_id: string; order_id: string }>(
      "select id, seat_id, order_id from seat_refunds where id = ? and status in ('pending', 'review')",
      [c.req.param('id')]
    );
    if (!r) return c.json({ error: 'request_not_found' }, 404);
    const now = d.nowMs();
    if (p.data.decision === 'decline') {
      d.sql.run("update seat_refunds set status = 'declined', decided_at = ? where id = ?", [now, r.id]);
      return c.json({ id: r.id, status: 'declined' });
    }
    const o = d.sql.get<{ amount_krw: number }>('select amount_krw from seat_orders where id = ?', [r.order_id]);
    const left = Math.max(0, (o?.amount_krw ?? 0) - refundedSoFar(r.order_id));
    if (p.data.refund_krw > left) return c.json({ error: 'refund_exceeds_paid', max_krw: left }, 400);
    d.sql.run("update seats set status = 'refunded', ends_at = ? where id = ? and status <> 'refunded'", [now, r.seat_id]);
    d.sql.run("update seat_refunds set status = 'done', refund_krw = ?, decided_at = ? where id = ?", [p.data.refund_krw, now, r.id]);
    return c.json({ id: r.id, status: 'done', refund_krw: p.data.refund_krw });
  });

  app.get('/v1/admin/seats', (c) => {
    const now = d.nowMs();
    const rows = d.sql.all<SeatRow>('select * from seats order by ends_at desc limit 500');
    return c.json(
      rows.map((s) => ({
        ...describe(s, now),
        nickname: d.sql.get<{ nickname: string }>('select nickname from players where id = ?', [s.player_id])?.nickname ?? ''
      }))
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
    // docs/09 확인함 "환불 요청: 사유, 결제일, 사용 기록" — usage since payment, counted not quoted.
    for (const r of requests) {
      const since = Number(r.paid_at);
      r.usage = {
        lessons: Number(d.sql.get<{ n: number }>('select count(*) as n from lessons where player_id = ? and started_at >= ?', [r.player_id, since])?.n ?? 0),
        utterances: Number(d.sql.get<{ n: number }>('select count(*) as n from utterances where player_id = ? and created_at >= ?', [r.player_id, since])?.n ?? 0)
      };
    }
    const expiring = d.sql
      .all<SeatRow>("select * from seats where status <> 'refunded' and ends_at > ? and ends_at <= ? order by ends_at", [now, now + SEAT_EXPIRING_MS])
      .map((s) => ({
        id: s.id,
        player_id: s.player_id,
        nickname: d.sql.get<{ nickname: string }>('select nickname from players where id = ?', [s.player_id])?.nickname ?? '',
        ends_at: s.ends_at
      }));
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
      const o = orderOf(s.id);
      // An open request: 'pending' (inside the rule, waiting for the button) or 'review' (outside it, decided by hand).
      const pending = d.sql.get<{ id: string; requested_at: number; status: 'pending' | 'review' }>(
        "select id, requested_at, status from seat_refunds where seat_id = ? and status in ('pending', 'review') order by requested_at limit 1",
        [s.id]
      );
      const notice = d.sql.get<{ kind: string; at: number }>('select kind, at from seat_notices where seat_id = ? order by at desc limit 1', [s.id]);
      const state = seatState(s, now);
      const refundUntil = o ? o.paid_at + REFUND_WINDOW_MS : null;
      return {
        id: s.id,
        // Another family's Duo seat shows no child name or id (docs/01 §4).
        child: mine ? { player_id: s.player_id, nickname: d.sql.get<{ nickname: string }>('select nickname from players where id = ?', [s.player_id])?.nickname ?? '' } : null,
        plan: s.plan,
        term: s.period,
        starts_at: s.starts_at,
        ends_at: s.ends_at,
        state,
        read_only_until: state === 'read_only' ? s.ends_at + SEAT_READ_ONLY_MS : null,
        is_payer: isPayer,
        // Payment history only to the payer.
        payment: isPayer && o ? { amount_krw: o.amount_krw, paid_at: o.paid_at, refunded_krw: refundedSoFar(o.id), plan: o.plan } : null,
        refund_until: refundUntil,
        can_request_refund: (isPayer || mine) && state !== 'refunded' && !pending && refundUntil !== null && now <= refundUntil,
        pending_request: pending ?? null,
        notice: notice ?? null,
        // The payer's two choices for leaving one Duo seat (docs/01 §4), computed by the same rule the operator runs.
        duo_options:
          isPayer && s.plan === 'duo' && o && state !== 'refunded' && refundUntil !== null && now <= refundUntil
            ? duoOptions(o.term, o.paid_at, o.amount_krw, now)
            : null
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
    if (s.status === 'refunded') return c.json({ error: 'already_refunded' }, 409);
    if (d.sql.get("select 1 as x from seat_refunds where seat_id = ? and status in ('pending', 'review')", [s.id])) return c.json({ error: 'already_requested' }, 409);
    const o = orderOf(s.id);
    if (!o) return c.json({ error: 'seat_not_found' }, 404);
    const now = d.nowMs();
    // Only the payer picks how a Duo partial refund is settled; anyone else's request uses the default.
    const mode = s.payer_id === g.guardian_id ? (p.data.mode ?? 'refund_difference') : 'refund_difference';
    const inWindow = now - o.paid_at <= REFUND_WINDOW_MS;
    const rid = id('rf');
    d.sql.run(
      'insert into seat_refunds (id, seat_id, order_id, requested_by, requested_at, mode, status, refund_krw, remaining_solo_days, decided_at, reason, note) values (?, ?, ?, ?, ?, ?, ?, null, null, null, ?, ?)',
      [rid, s.id, o.id, g.guardian_id, now, mode, inWindow ? 'pending' : 'review', inWindow ? null : 'outside_refund_window', p.data.note ?? '']
    );
    return c.json({ id: rid, status: inWindow ? 'pending' : 'review' }, 201);
  });
}
