/**
 * R326 plans step on /pricing (#plans): plan × term → guardian name and contact → order at the server price.
 * - test mode (`/v1/billing/config` mode 'test', today): the order waits for a bank transfer in the operator inbox; the
 *   page says plainly that no money moves.
 * - live mode: the Toss Payments card window (`js.tosspayments.com/v2/standard`, loaded only when the button is
 *   pressed) comes back to /pricing?pay=done&paymentKey&orderId&amount, and the server confirms it.
 * The device token of a child on this browser (lcw.deviceToken, set by /link) is sent so the order is that child's.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { CHECKOUT as K } from './copy.js';
import { track } from './track.js';

export type Plan = 'solo' | 'duo';
export type Term = 'month' | 'year';
export interface BillingConfig {
  mode: 'test' | 'live';
  client_key?: string;
  plans: Record<Plan, Record<Term, number>>;
}
type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export const BILLING_CONFIG_PATH = '/v1/billing/config';
export const TOSS_SDK_URL = 'https://js.tosspayments.com/v2/standard';

const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;
const PHONE = /^[0-9+\-\s()]{9,20}$/;
const MAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function validContact(c: string): boolean {
  const t = c.trim();
  return (PHONE.test(t) && t.replace(/\D/g, '').length >= 9) || MAIL.test(t);
}

function deviceToken(): string | null {
  try {
    const t = localStorage.getItem('lcw.deviceToken');
    return t && t.length >= 32 ? t : null;
  } catch {
    return null;
  }
}

/** Where the visitor came from (`?from=world|try`), for the line above the form. */
export function originOf(search: string): 'world' | 'try' | 'pricing' {
  const f = new URLSearchParams(search).get('from');
  return f === 'world' || f === 'try' ? f : 'pricing';
}

/** Toss success return: `?pay=done&paymentKey=…&orderId=…&amount=…` (fail: `?pay=fail&code=…`). */
export function tossReturnOf(search: string): { kind: 'done'; paymentKey: string; orderId: string; amount: number } | { kind: 'fail' } | null {
  const q = new URLSearchParams(search);
  if (q.get('pay') === 'fail') return { kind: 'fail' };
  if (q.get('pay') !== 'done') return null;
  const paymentKey = q.get('paymentKey') ?? '';
  const orderId = q.get('orderId') ?? '';
  const amount = Number(q.get('amount'));
  return paymentKey && orderId && Number.isInteger(amount) && amount > 0 ? { kind: 'done', paymentKey, orderId, amount } : { kind: 'fail' };
}

type TossFactory = (clientKey: string) => { payment(o: { customerKey: string }): { requestPayment(o: Record<string, unknown>): Promise<void> } };
async function loadToss(): Promise<TossFactory> {
  const w = window as unknown as { TossPayments?: TossFactory };
  if (w.TossPayments) return w.TossPayments;
  await new Promise<void>((ok, bad) => {
    const s = document.createElement('script');
    s.src = TOSS_SDK_URL;
    s.onload = () => ok();
    s.onerror = () => bad(new Error('toss_sdk'));
    document.head.appendChild(s);
  });
  if (!w.TossPayments) throw new Error('toss_sdk');
  return w.TossPayments;
}

export function CheckoutSection(props: { initialSearch?: string; fetchImpl?: Fetch; config?: BillingConfig | null }): React.ReactElement {
  const f: Fetch = props.fetchImpl ?? ((i, x) => globalThis.fetch(i, x));
  const search = props.initialSearch ?? (typeof location === 'undefined' ? '' : location.search);
  const from = originOf(search);
  const ret = useMemo(() => tossReturnOf(search), [search]);
  const [cfg, setCfg] = useState<BillingConfig | null>(props.config ?? null);
  const [plan, setPlan] = useState<Plan>('solo');
  const [term, setTerm] = useState<Term>('month');
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [agree, setAgree] = useState(false);
  const [state, setState] = useState<{ k: 'idle' | 'sending' | 'invalid' | 'error' | 'too_many' | 'fail' } | { k: 'done_test'; no: string } | { k: 'done_live' | 'done_extended' | 'done_paid' }>(
    ret?.kind === 'fail' ? { k: 'fail' } : { k: 'idle' }
  );

  useEffect(() => {
    if (cfg) return;
    let live = true;
    void f(BILLING_CONFIG_PATH)
      .then((r) => (r.ok ? (r.json() as Promise<BillingConfig>) : null))
      .then((c) => {
        if (live && c) setCfg(c);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  // Back from the Toss window: the server checks the amount and asks Toss to confirm.
  useEffect(() => {
    if (ret?.kind !== 'done') return;
    setState({ k: 'sending' });
    void f('/v1/billing/confirm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'omit',
      body: JSON.stringify({ order_id: ret.orderId, payment_key: ret.paymentKey, amount: ret.amount })
    })
      .then(async (r) => {
        const j = (await r.json().catch(() => ({}))) as { status?: string; seat?: string };
        if (!r.ok) return setState({ k: 'fail' });
        track('checkout_done');
        setState({ k: j.status === 'seat_issued' ? (j.seat === 'seat_extended' ? 'done_extended' : 'done_live') : 'done_paid' });
      })
      .catch(() => setState({ k: 'fail' }));
  }, [ret]);

  const amount = cfg?.plans[plan][term] ?? null;
  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!name.trim() || name.trim().length > 40 || !validContact(contact) || !agree) {
      setState({ k: 'invalid' });
      return;
    }
    setState({ k: 'sending' });
    track('checkout_start');
    const tok = deviceToken();
    let r: Response;
    try {
      r = await f('/v1/billing/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(tok ? { authorization: `Bearer ${tok}` } : {}) },
        credentials: 'omit',
        body: JSON.stringify({ plan, term, payer_name: name.trim(), contact: contact.trim(), from })
      });
    } catch {
      setState({ k: 'error' });
      return;
    }
    if (r.status === 429) return setState({ k: 'too_many' });
    if (!r.ok) return setState({ k: 'error' });
    const o = (await r.json()) as { order_id: string; mode: 'test' | 'live'; amount_krw: number; order_name: string };
    if (o.mode === 'test') {
      setState({ k: 'done_test', no: o.order_id.slice(-6).toUpperCase() });
      return;
    }
    try {
      const Toss = await loadToss();
      const origin = location.origin;
      await Toss(cfg!.client_key!)
        .payment({ customerKey: 'ANONYMOUS' })
        .requestPayment({
          method: 'CARD',
          amount: { currency: 'KRW', value: o.amount_krw },
          orderId: o.order_id,
          orderName: o.order_name,
          customerName: name.trim(),
          successUrl: `${origin}/pricing?pay=done#plans`,
          failUrl: `${origin}/pricing?pay=fail#plans`
        });
    } catch {
      setState({ k: 'fail' });
    }
  };

  const mode = cfg?.mode ?? 'test';
  const done = state.k === 'done_test' || state.k === 'done_live' || state.k === 'done_extended' || state.k === 'done_paid';
  return (
    <section className="s-sec" id="plans" data-testid="checkout" data-mode={mode}>
      <div className="s-wrap s-stack" style={{ gap: 16, maxWidth: 760 }}>
        <h2 className="s-h2">{K.title}</h2>
        {from === 'world' ? <p className="s-lead">{K.fromWorld}</p> : from === 'try' ? <p className="s-lead">{K.fromTry}</p> : null}
        {mode === 'test' ? (
          <div className="s-note s-warn" role="note" data-testid="test-band">
            <strong>{K.testBand}</strong>
            <br />
            {K.testBody}
          </div>
        ) : null}
        {done ? (
          <div className="s-note s-ok" role="status" style={{ fontSize: 18, lineHeight: '28px' }}>
            {state.k === 'done_test' ? K.doneTest(state.no) : state.k === 'done_live' ? K.doneLive : state.k === 'done_extended' ? K.doneExtended : K.donePaid}
            {from === 'world' || state.k === 'done_live' ? (
              <>
                <br />
                <a className="s-btn s-btn-brand" href="/world/" style={{ marginTop: 12 }}>
                  {K.backToWorld}
                </a>
              </>
            ) : null}
          </div>
        ) : (
          <form className="s-form s-card" onSubmit={(e) => void submit(e)} noValidate>
            <fieldset className="s-field" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend>{K.pick}</legend>
              <div className="s-tabs" role="radiogroup" aria-label={K.pick}>
                {(['solo', 'duo'] as const).map((p) => (
                  <button key={p} type="button" role="radio" className="s-tab" aria-checked={plan === p} aria-pressed={plan === p} onClick={() => setPlan(p)}>
                    {p === 'solo' ? 'Solo · 1좌석' : 'Duo · 2좌석'}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset className="s-field" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend>{K.term}</legend>
              <div className="s-tabs" role="radiogroup" aria-label={K.term}>
                {(['month', 'year'] as const).map((t) => (
                  <button key={t} type="button" role="radio" className="s-tab" aria-checked={term === t} aria-pressed={term === t} onClick={() => setTerm(t)}>
                    {t === 'month' ? K.month : K.year}
                  </button>
                ))}
              </div>
            </fieldset>
            <div className="s-grid-2" style={{ gap: 16 }}>
              <div className="s-field">
                <label htmlFor="b-name">{K.fName}</label>
                <input id="b-name" autoComplete="name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} required />
              </div>
              <div className="s-field">
                <label htmlFor="b-contact">{K.fContact}</label>
                <input id="b-contact" autoComplete="tel" value={contact} maxLength={80} onChange={(e) => setContact(e.target.value)} required />
              </div>
            </div>
            <p className="s-h3" data-testid="checkout-total">
              {K.total}: {amount === null ? '…' : won(amount)}
            </p>
            <p className="s-small">{K.refund}</p>
            <label className="s-row" style={{ gap: 8, alignItems: 'center' }}>
              <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
              {K.agree}
            </label>
            {deviceToken() ? <p className="s-small">{K.childBound}</p> : null}
            {state.k === 'invalid' ? <p className="s-note s-warn" role="alert">{K.invalid}</p> : null}
            {state.k === 'error' ? <p className="s-note s-warn" role="alert">{K.error}</p> : null}
            {state.k === 'too_many' ? <p className="s-note s-warn" role="alert">{K.tooMany}</p> : null}
            {state.k === 'fail' ? <p className="s-note s-warn" role="alert">{K.failLive}</p> : null}
            <button type="submit" className="s-btn s-btn-brand s-btn-lg" disabled={state.k === 'sending' || !cfg} style={{ justifySelf: 'start' }}>
              {state.k === 'sending' ? K.sending : mode === 'live' ? K.submitLive : K.submitTest}
            </button>
          </form>
        )}
      </div>
    </section>
  );
}
