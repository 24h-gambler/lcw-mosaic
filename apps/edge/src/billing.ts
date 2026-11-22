/**
 * Paid step after the free trial (R326, Dan 11-19 "무료 3분 뒤엔 유료 결제로"). The guardian picks a plan on /pricing,
 * leaves a name and a contact, and pays. Prices are the server's (`PLAN_PRICES_KRW`, packages/quota); the client never
 * sends an amount that is trusted.
 *
 * Two modes, decided by the deployment, never by the request:
 * - `live`: both `TOSS_CLIENT_KEY` and `TOSS_SECRET_KEY` are set. The page opens the Toss Payments widget with the
 *   order id and the server amount; Toss sends the payer back to /pricing/done with `paymentKey`, `orderId`, `amount`;
 *   `POST /v1/billing/confirm` checks that amount against the order, asks Toss to confirm (Basic auth with the secret
 *   key), and on success records the payment. A Solo order bound to a child whose family has a guardian issues the
 *   seat at once through the same rows as the operator's issue button (`issueSeats`, by 'billing'); anything else
 *   (Duo needs the second child, no guardian yet) waits in the operator inbox, already paid.
 * - `test` (no keys — today: the company has no approved Toss shop (MID) for this domain): the page says "시험 모드 —
 *   실제 돈이 나가지 않아요" and the order waits in the operator inbox as "입금 확인 대기" (docs/09 P6), where the
 *   operator issues the seat with the existing button after the transfer arrives. A test order never opens a seat by
 *   itself (that would be a free seat for anyone).
 *
 * Writes are few on purpose (Cloudflare free limits): one row per checkout, one update per confirm; config is static
 * and cached by the browser; nothing polls.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { PLAN_PRICES_KRW, TERM_DAYS } from '@lcw/quota';
import { extendSeatPaid, issueSeats } from './seats.js';
import type { SqliteExecutor } from './storage.js';

export const BILLING_SCHEMA = `
create table if not exists billing_orders (id text primary key, plan text not null, term text not null, amount_krw integer not null, player_id text, payer_name text not null, contact text not null, origin text not null, mode text not null, status text not null, payment_key text, created_at integer not null, paid_at integer, seat_order_id text, fail_reason text);
create index if not exists billing_orders_status on billing_orders (status, created_at)
`;

/** What a done order did to the seat, so a reload of the done page says the same as the first answer. */
function seatKind(o: { status: string; fail_reason: string | null }): { seat?: 'seat_extended' | 'seat_issued' } {
  if (o.status !== 'seat_issued') return {};
  return { seat: o.fail_reason === 'extended' ? 'seat_extended' : 'seat_issued' };
}

/** A closed or abandoned order keeps the guardian's name and contact this long, then they are cleared (same as consult requests). */
export const BILLING_CONTACT_RETENTION_MS = 180 * 86_400_000;

/** Clears the name and contact of orders closed (seat issued / failed) more than the retention ago. Hourly sweep. */
export function sweepBillingContacts(sql: SqliteExecutor, nowMs: number): void {
  sql.exec(BILLING_SCHEMA);
  sql.run(
    "update billing_orders set payer_name = '', contact = '' where status in ('seat_issued', 'failed', 'pending_payment') and created_at < ? and contact <> ''",
    [nowMs - BILLING_CONTACT_RETENTION_MS]
  );
}

/** Checkouts one network address may start per hour (a typo loop, not a business rule). */
export const CHECKOUTS_PER_HOUR_PER_CLIENT = 6;
/** Toss confirm endpoint (docs: https://docs.tosspayments.com/reference#결제-승인). */
export const TOSS_CONFIRM_URL = 'https://api.tosspayments.com/v1/payments/confirm';

export const BILLING_PUBLIC_ROUTES: ReadonlyArray<readonly [string, RegExp]> = [
  ['GET', /^\/v1\/billing\/config$/],
  ['POST', /^\/v1\/billing\/checkout$/],
  ['POST', /^\/v1\/billing\/confirm$/]
];

export type BillingMode = 'test' | 'live';
export type BillingStatus = 'transfer_wait' | 'pending_payment' | 'paid' | 'seat_issued' | 'failed';

export interface BillingDeps {
  sql: SqliteExecutor;
  nowMs: () => number;
  randomBytes: (n: number) => Uint8Array;
  sha256Hex: (s: string) => Promise<string>;
  /** Toss keys from the deployment (secrets). Both set → live. */
  toss: { clientKey?: string; secretKey?: string };
  /** The linked child behind a device token on the request, if any (binds the order to that child). */
  deviceChild: (req: Request) => Promise<string | null>;
  fetchImpl?: typeof fetch;
}

const PHONE = /^[0-9+\-\s()]{9,20}$/;
const MAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CheckoutBody = z
  .object({
    plan: z.enum(['solo', 'duo']),
    term: z.enum(['month', 'year']),
    payer_name: z.string().trim().min(1).max(40),
    contact: z.string().trim().min(5).max(80),
    from: z.enum(['world', 'try', 'pricing']).default('pricing')
  })
  .strict()
  .refine((b) => (PHONE.test(b.contact) && b.contact.replace(/\D/g, '').length >= 9) || MAIL.test(b.contact), {
    message: 'contact must be a phone number or an e-mail address',
    path: ['contact']
  });
const ConfirmBody = z
  .object({
    order_id: z.string().min(8).max(64),
    payment_key: z.string().min(8).max(200),
    amount: z.number().int().positive()
  })
  .strict();

export function billingMode(toss: BillingDeps['toss']): BillingMode {
  return toss.clientKey && toss.secretKey ? 'live' : 'test';
}

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const b64 = (s: string) => btoa(s);

type OrderRow = {
  id: string;
  plan: 'solo' | 'duo';
  term: 'month' | 'year';
  amount_krw: number;
  player_id: string | null;
  payer_name: string;
  contact: string;
  origin: string;
  mode: BillingMode;
  status: BillingStatus;
  payment_key: string | null;
  created_at: number;
  paid_at: number | null;
  seat_order_id: string | null;
  fail_reason: string | null;
};

export function buildBillingApp(d: BillingDeps): Hono {
  d.sql.exec(BILLING_SCHEMA);
  const app = new Hono();
  const mode = billingMode(d.toss);
  const f = d.fetchImpl ?? ((i: string, x?: RequestInit) => globalThis.fetch(i, x));

  app.get('/v1/billing/config', (c) => {
    // Static per deployment: the browser keeps it a few minutes (a return visit costs no request; a key put in shows
    // the card step within minutes, not an hour).
    c.header('cache-control', 'public, max-age=300');
    return c.json({
      mode,
      ...(mode === 'live' ? { client_key: d.toss.clientKey } : {}),
      plans: PLAN_PRICES_KRW,
      term_days: TERM_DAYS
    });
  });

  app.post('/v1/billing/checkout', async (c) => {
    const p = CheckoutBody.safeParse(await c.req.json().catch(() => null));
    if (!p.success) return c.json({ error: 'invalid', fields: p.error.issues.slice(0, 5).map((i) => i.path.join('.')) }, 400);
    const now = d.nowMs();
    const hour = Math.floor(now / 3_600_000);
    const key = `checkout|${await d.sha256Hex(c.req.header('cf-connecting-ip') ?? 'local')}`;
    // the same small counter table the consult form uses (site.ts); created there, created here too for a lone test
    d.sql.exec('create table if not exists site_limits (k text not null, hour integer not null, n integer not null, primary key (k, hour))');
    const used = Number(d.sql.get<{ n: number }>('select n from site_limits where k = ? and hour = ?', [key, hour])?.n ?? 0);
    if (used >= CHECKOUTS_PER_HOUR_PER_CLIENT) return c.json({ error: 'too_many' }, 429);
    d.sql.run('insert into site_limits (k, hour, n) values (?, ?, 1) on conflict(k, hour) do update set n = n + 1', [key, hour]);
    const q = p.data;
    const amount = PLAN_PRICES_KRW[q.plan][q.term];
    const playerId = await d.deviceChild(c.req.raw);
    // Toss order ids: 6–64 chars of [A-Za-z0-9_-].
    const id = `lcw-${hex(d.randomBytes(12))}`;
    const status: BillingStatus = mode === 'live' ? 'pending_payment' : 'transfer_wait';
    d.sql.run(
      'insert into billing_orders (id, plan, term, amount_krw, player_id, payer_name, contact, origin, mode, status, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, q.plan, q.term, amount, playerId, q.payer_name, q.contact, q.from, mode, status, now]
    );
    return c.json(
      {
        order_id: id,
        mode,
        status,
        amount_krw: amount,
        plan: q.plan,
        term: q.term,
        order_name: `LCW ${q.plan === 'duo' ? 'Duo' : 'Solo'} ${q.term === 'year' ? '1년' : '1개월'}`,
        child_bound: playerId !== null
      },
      201
    );
  });

  app.post('/v1/billing/confirm', async (c) => {
    const p = ConfirmBody.safeParse(await c.req.json().catch(() => null));
    if (!p.success) return c.json({ error: 'invalid' }, 400);
    if (mode !== 'live') return c.json({ error: 'test_mode' }, 409);
    const o = d.sql.get<OrderRow>('select * from billing_orders where id = ?', [p.data.order_id]);
    if (!o) return c.json({ error: 'order_not_found' }, 404);
    // The same payment confirmed twice (a reload of the done page): the first answer again, no second charge.
    if (o.status === 'paid' || o.status === 'seat_issued') {
      if (o.payment_key !== p.data.payment_key) return c.json({ error: 'already_paid' }, 409);
      return c.json({ ok: true, status: o.status, ...seatKind(o), seat_order_id: o.seat_order_id });
    }
    if (o.status !== 'pending_payment') return c.json({ error: 'not_payable', status: o.status }, 409);
    // The amount Toss shows the payer came from our order; one that differs was changed in the browser.
    if (p.data.amount !== o.amount_krw) {
      d.sql.run("update billing_orders set status = 'failed', fail_reason = 'amount_mismatch' where id = ?", [o.id]);
      return c.json({ error: 'amount_mismatch' }, 400);
    }
    let res: Response;
    try {
      res = await f(TOSS_CONFIRM_URL, {
        method: 'POST',
        headers: { authorization: `Basic ${b64(`${d.toss.secretKey}:`)}`, 'content-type': 'application/json', 'idempotency-key': o.id },
        body: JSON.stringify({ paymentKey: p.data.payment_key, orderId: o.id, amount: o.amount_krw })
      });
    } catch {
      // Not known whether Toss took it: the order stays payable, the same confirm can be sent again (idempotency key).
      return c.json({ error: 'toss_unreachable' }, 502);
    }
    const body = (await res.json().catch(() => ({}))) as { status?: string; totalAmount?: number; orderId?: string; code?: string };
    if (res.status >= 500 || body.code === 'PROVIDER_ERROR' || body.code === 'FAILED_INTERNAL_SYSTEM_PROCESSING') {
      // Toss had a passing failure: the order stays payable and the same confirm can be sent again (idempotency key).
      return c.json({ error: 'toss_unavailable' }, 502);
    }
    if (!res.ok || body.status !== 'DONE' || body.totalAmount !== o.amount_krw || body.orderId !== o.id) {
      const reason = String(body.code ?? `status_${res.status}`).slice(0, 60);
      d.sql.run("update billing_orders set status = 'failed', fail_reason = ? where id = ? and status = 'pending_payment'", [reason, o.id]);
      return c.json({ error: 'payment_failed', reason }, 402);
    }
    const now = d.nowMs();
    // Two confirms of the same payment at once (two tabs): only the one that moves the order on opens the seat; the
    // other answers what the first did (review of the R326 paid step).
    const fresh = d.sql.get<OrderRow>('select * from billing_orders where id = ?', [o.id]);
    if (!fresh || fresh.status !== 'pending_payment') {
      return c.json({ ok: true, status: fresh?.status ?? 'paid', ...(fresh ? seatKind(fresh) : {}), seat_order_id: fresh?.seat_order_id ?? null });
    }
    d.sql.run("update billing_orders set status = 'paid', payment_key = ?, paid_at = ? where id = ? and status = 'pending_payment'", [
      p.data.payment_key,
      now,
      o.id
    ]);
    // Solo for a known child with a guardian: the seat opens now — or, when the child already has a live seat, the same
    // payment extends it by the term (never money taken and nothing done). Otherwise the operator finishes it.
    if (o.plan === 'solo' && o.player_id) {
      const seatDeps = { sql: d.sql, nowMs: d.nowMs, randomBytes: d.randomBytes };
      const issued = issueSeats(
        seatDeps,
        { plan: 'solo', term: o.term, player_ids: [o.player_id], payer_player_id: o.player_id, paid_at: now, amount_krw: o.amount_krw, note: `online ${o.id}` },
        'billing'
      );
      const live = issued.status === 409 && issued.body.error === 'seat_exists' ? String(issued.body.seat_id) : null;
      // Only a live Solo seat is extended by a Solo payment: a tutoring (0 won) or Duo seat has its own first-use, refund
      // and sibling end-date rules, so that payment waits in the operator inbox as paid (review of the R326 paid step).
      const livePlan = live ? d.sql.get<{ plan: string }>('select plan from seats where id = ?', [live])?.plan : null;
      if (live && livePlan !== 'solo') {
        d.sql.run('update billing_orders set fail_reason = ? where id = ?', [`seat_live_${String(livePlan)}`.slice(0, 60), o.id]);
        return c.json({ ok: true, status: 'paid', seat_order_id: null });
      }
      const done = live ? extendSeatPaid(seatDeps, live, { days: TERM_DAYS[o.term], amount_krw: o.amount_krw, paid_at: now, note: `online ${o.id}` }, 'billing') : issued;
      if (done.status === 201 || done.status === 200) {
        const kind = live ? 'seat_extended' : 'seat_issued';
        d.sql.run("update billing_orders set status = 'seat_issued', seat_order_id = ?, fail_reason = ? where id = ?", [String(done.body.order_id), live ? 'extended' : null, o.id]);
        return c.json({ ok: true, status: 'seat_issued', seat: kind, seat_order_id: done.body.order_id, ...(live ? { ends_at: done.body.ends_at } : {}) });
      }
      d.sql.run('update billing_orders set fail_reason = ? where id = ?', [`seat_${String(done.body.error ?? done.status)}`.slice(0, 60), o.id]);
    }
    return c.json({ ok: true, status: 'paid', seat_order_id: null });
  });

  /** Operator inbox (docs/09 P6 "입금 확인 대기"): open online orders, newest first. */
  app.get('/v1/admin/billing/orders', (c) => {
    const rows = d.sql.all<OrderRow & { nickname: string | null }>(
      `select o.*, p.nickname from billing_orders o left join players p on p.id = o.player_id
       where o.status in ('transfer_wait', 'paid') or o.created_at > ? order by o.created_at desc limit 100`,
      [d.nowMs() - 30 * 86_400_000]
    );
    return c.json({ mode, orders: rows.map(({ payment_key: _k, ...r }) => r) });
  });

  /** The operator closed a transfer order (issued the seat with the issue button, or the money never came). */
  app.post('/v1/admin/billing/orders/:id/close', async (c) => {
    const b = z
      .object({ outcome: z.enum(['seat_issued', 'failed']), seat_order_id: z.string().max(64).optional() })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!b.success) return c.json({ error: 'invalid' }, 400);
    const o = d.sql.get<OrderRow>('select * from billing_orders where id = ?', [c.req.param('id')]);
    if (!o) return c.json({ error: 'order_not_found' }, 404);
    if (o.status !== 'transfer_wait' && o.status !== 'paid') return c.json({ error: 'not_open', status: o.status }, 409);
    d.sql.run('update billing_orders set status = ?, seat_order_id = ?, fail_reason = ? where id = ?', [
      b.data.outcome,
      b.data.seat_order_id ?? null,
      b.data.outcome === 'failed' ? 'operator' : null,
      o.id
    ]);
    return c.json({ ok: true });
  });

  return app;
}
