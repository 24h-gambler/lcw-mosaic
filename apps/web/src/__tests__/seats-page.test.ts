import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { App } from '../App.js';
import { routeFromPath } from '../main.js';
import { FamilySeatsView, SeatBadge, SeatsAdminPage, daysLeft, doneText, kstInputToMs, sentKind } from '../SeatsPage.js';
import { createFamilyApi, type FamilySeat } from '../familyApi.js';
import type { FetchLike } from '../lessonApi.js';
import { PARENT_STRINGS_KO } from '../parentStrings.js';

const S = PARENT_STRINGS_KO.seats;
const A = PARENT_STRINGS_KO.seatsAdmin;
const DAY = 86_400_000;
const NOW = 1_800_000_000_000;

const seat = (over: Partial<FamilySeat> = {}): FamilySeat => ({
  id: 'seat-a',
  child: { player_id: 'kid-1', nickname: 'Juno' },
  plan: 'solo',
  term: 'month',
  starts_at: NOW - 2 * DAY,
  ends_at: NOW + 28 * DAY,
  state: 'active',
  read_only_until: null,
  is_payer: true,
  payments: [{ order_id: 'o-issue-14900', kind: 'issue', plan: 'solo', days: null, amount_krw: 14_900, paid_at: NOW - 2 * DAY, refund_until: NOW + 5 * DAY, refunded_krw: 0, refunded: false }],
  refund_until: NOW + 5 * DAY,
  can_request_refund: true,
  pending_request: null,
  can_choose_mode: false,
  notice: null,
  duo_options: null,
  ...over
});
const render = (seats: FamilySeat[]) =>
  renderToStaticMarkup(React.createElement(FamilySeatsView, { seats, now: NOW, onRequest: () => undefined }));

describe('guardian seats section (WP-704)', () => {
  it('no seat (pre-sale): the section is not shown at all', () => {
    expect(render([])).toBe('');
  });

  it('payer sees state, period, the amount paid and the refund deadline', () => {
    const html = render([seat()]);
    expect(html).toContain(S.title);
    expect(html).toContain('Juno');
    expect(html).toContain(S.state.active);
    expect(html).toContain('14,900원');
    expect(html).toContain(S.refundAsk);
    expect(html).toContain('data-testid="seat-payment"');
  });

  it('other family Duo seat: no name, no money; non-payer sees no payment', () => {
    const html = render([
      seat({ id: 'seat-b', child: null, plan: 'duo', is_payer: true, payments: [{ order_id: 'o-issue-19900', kind: 'issue', plan: 'duo', days: null, amount_krw: 19_900, paid_at: NOW, refund_until: NOW + 5 * DAY, refunded_krw: 0, refunded: false }] }),
      seat({ id: 'seat-c', plan: 'duo', is_payer: false, payments: null })
    ]);
    expect(html).toContain(S.otherSeat);
    expect(html).toContain(S.otherSeatNote);
    expect(html.match(/data-testid="seat-payment"/g)?.length).toBe(1);
  });

  it('expiring, read-only, archived and refunded each explain what happens, in words', () => {
    const html = render([
      seat({ id: 's1', state: 'expiring', ends_at: NOW + 3 * DAY }),
      seat({ id: 's2', state: 'read_only', ends_at: NOW - DAY, read_only_until: NOW + 29 * DAY, refund_until: NOW - 20 * DAY, can_request_refund: false }),
      seat({ id: 's3', state: 'archived', ends_at: NOW - 40 * DAY, can_request_refund: false }),
      seat({ id: 's4', state: 'refunded', can_request_refund: false, payments: [{ order_id: 'o-issue-14900', kind: 'issue', plan: 'solo', days: null, amount_krw: 14_900, paid_at: NOW, refund_until: NOW + 5 * DAY, refunded_krw: 14_900, refunded: false }] })
    ]);
    expect(html).toContain(S.state.expiring(3));
    expect(html).toContain('혼자 놀기는 멈췄습니다');
    expect(html).toContain(S.archivedBody);
    expect(html).toContain(S.refundedBody);
    expect(html).toContain(S.refundedLine('14,900'));
    // refund ask only on live seats
    expect(html.match(/data-testid="seat-ask-/g)?.length).toBe(1);
  });

  it('pending request replaces the ask button', () => {
    const html = render([seat({ can_request_refund: false, pending_request: { id: 'rf-1', requested_at: NOW, status: 'pending', awaiting_payer_choice: false } })]);
    expect(html).toContain('data-testid="seat-pending"');
    expect(render([seat({ can_request_refund: false, pending_request: { id: 'rf-2', requested_at: NOW, status: 'review', awaiting_payer_choice: false } })])).toContain(
      '선생님이 직접 확인하고'
    );
    expect(html).not.toContain('data-testid="seat-ask-');
  });

  it('refund deadline: the date of the last refundable moment, at 24:00 KST', () => {
    // exclusive deadline 2026-11-09 00:00 KST → "11월 8일 24:00까지"
    const until = Date.UTC(2026, 10, 8, 15, 0, 0);
    const html = renderToStaticMarkup(
      React.createElement(FamilySeatsView, { seats: [seat({ refund_until: until })], now: until - DAY, onRequest: () => undefined })
    );
    expect(html).toContain(S.refundUntil('11월 8일'));
    expect(html).toContain('11월 8일 24:00까지');
  });

  it('Duo: payment lines include extensions; the payer chooses when the other family asked; the friend waits', () => {
    const duo = { refund_difference_krw: 5_000, solo_days: 20 };
    const payer = render([
      seat({
        id: 'seat-b',
        child: null,
        plan: 'duo',
        can_request_refund: false,
        can_choose_mode: true,
        duo_options: duo,
        pending_request: { id: 'rf-1', requested_at: NOW, status: 'pending', awaiting_payer_choice: true },
        payments: [{ order_id: 'o-extend-9950', kind: 'extend', plan: 'duo', days: 30, amount_krw: 9_950, paid_at: NOW, refund_until: NOW + 5 * DAY, refunded_krw: 0, refunded: false }, { order_id: 'o-issue-19900', kind: 'issue', plan: 'duo', days: null, amount_krw: 19_900, paid_at: NOW - DAY, refund_until: NOW + 5 * DAY, refunded_krw: 0, refunded: false }]
      })
    ]);
    expect(payer).toContain('data-testid="seat-choose-seat-b"');
    expect(payer).toContain(S.duoDiff('5,000'));
    expect(payer).toContain(S.duoDays(20));
    expect(payer).toContain('연장 30일');
    expect(payer).toContain('두 좌석 합계 19,900원');
    const friend = render([
      seat({
        plan: 'duo',
        is_payer: false,
        payments: null,
        can_request_refund: false,
        pending_request: { id: 'rf-1', requested_at: NOW, status: 'pending', awaiting_payer_choice: true }
      })
    ]);
    expect(friend).toContain('결제하신 분이 정산 방식을 고르면');
    expect(friend).not.toContain('seat-choose');
    expect(friend).not.toContain('원 ·');
  });

  it('confirmation after a request, and KST input → ms for payment times', () => {
    expect(sentKind({ status: 'pending', mode: 'convert_to_solo_days' })).toBe('chosen');
    expect(sentKind({ status: 'pending', awaiting_payer_choice: true })).toBe('awaiting');
    expect(sentKind({ status: 'pending', awaiting_payer_choice: false })).toBe('pending');
    expect(sentKind({ status: 'review', awaiting_payer_choice: false })).toBe('review');
    expect(kstInputToMs('2026-11-01T15:00')).toBe(Date.UTC(2026, 10, 1, 6, 0, 0));
    expect(kstInputToMs('')).toBeNull();
    expect(doneText({ refund_krw: 9_950, removed_days: 30, remaining_seat: null })).toBe(A.refundDoneExtend('9,950', 30));
  });

  it('operator message says what to send: Solo full, Duo difference keeps the term, Duo days sends nothing', () => {
    expect(doneText({ refund_krw: 14_900, remaining_seat: null })).toContain('14,900원을 보내');
    expect(doneText({ refund_krw: 5_000, remaining_seat: { solo_days: 30 } })).toBe(A.refundDoneDuoKeep('5,000'));
    expect(doneText({ refund_krw: 0, remaining_seat: { solo_days: 20 } })).toBe(A.refundDoneDuoDays(20));
  });

  it('badge: words for every state; days left rounds up', () => {
    expect(daysLeft(NOW + 1, NOW)).toBe(1);
    expect(daysLeft(NOW + 6.2 * DAY, NOW)).toBe(7);
    for (const st of ['active', 'expiring', 'read_only', 'archived', 'refunded'] as const) {
      const html = renderToStaticMarkup(React.createElement(SeatBadge, { state: st, endsAt: NOW + 2 * DAY, now: NOW }));
      expect(html.replace(/<[^>]+>/g, '').trim().length).toBeGreaterThan(1);
    }
  });
});

describe('operator /seats (docs/09 P6)', () => {
  it('route is known and renders the seats page; without a key it points to the director console', () => {
    expect(routeFromPath('/seats')).toBe('/seats');
    const html = renderToStaticMarkup(React.createElement(SeatsAdminPage, { initialToken: null }));
    expect(html).toContain(A.title);
    expect(html).toContain(A.needKey);
    expect(renderToStaticMarkup(React.createElement(App, { initialRoute: '/seats' }))).toContain('data-testid="seats-admin"');
  });

  it('client calls: guardian seats with the guardian token, refund request body, operator issue and refund', async () => {
    const calls: Array<{ url: string; method: string; auth: string | null; body: unknown }> = [];
    const fetch: FetchLike = async (url, init) => {
      const h = (init?.headers ?? {}) as Record<string, string>;
      calls.push({ url, method: String(init?.method), auth: h.authorization ?? null, body: init?.body ? JSON.parse(String(init.body)) : null });
      return new Response(JSON.stringify({ ok: true, seats: [], server_now: NOW }), { status: 200 });
    };
    const api = createFamilyApi({ fetch });
    await api.seats('g-token');
    await api.requestRefund('g-token', 'seat a', { mode: 'convert_to_solo_days', note: '시간이 안 맞아요' });
    await api.adminIssueSeat('op', { payer_player_id: 'kid-1', plan: 'duo', term: 'month', player_ids: ['kid-1', 'kid-2'] });
    await api.adminRefundSeat('op', 'seat-a');
    await api.adminDecideRefund('op', 'rf-1', { decision: 'decline' });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET /v1/family/seats',
      'POST /v1/family/seats/seat%20a/refund-request',
      'POST /v1/admin/seats',
      'POST /v1/admin/seats/seat-a/refund',
      'POST /v1/admin/seat-refunds/rf-1/decide'
    ]);
    expect(calls[0]!.auth).toBe('Bearer g-token');
    expect(calls[1]!.body).toEqual({ mode: 'convert_to_solo_days', note: '시간이 안 맞아요' });
    expect(calls[3]!.body).toEqual({});
  });

  it('price never reaches a child screen: seat code and strings stay out of the game/join/link screens', () => {
    const dir = fileURLToPath(new URL('..', import.meta.url));
    for (const f of ['StudentJoin.tsx', 'tryFlow.ts']) {
      const src = readFileSync(`${dir}${f}`, 'utf8');
      expect(src).not.toMatch(/SeatsPage|seatsAdmin|PARENT_STRINGS_KO\.seats|amount_krw/);
    }
  });
});
