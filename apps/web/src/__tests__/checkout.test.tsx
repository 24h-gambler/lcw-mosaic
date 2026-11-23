/**
 * R329 entrance and plans step: the service address opens the intro (/about) for a first visit and the world
 * (/world/) for a revisit, the intro has a 'play now' button to /world/, /pricing has the plans step (#plans) at
 * the server prices with a plain test-mode band, the try's end and the world's trial card lead there, and the
 * operator inbox lists the online orders.
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PLAN_PRICES_KRW } from '@lcw/quota';
import { App } from '../App.js';
import { routeFromPath } from '../main.js';
import { CheckoutSection, originOf, tossReturnOf, validContact } from '../site/Checkout.js';
import { parseSitePath, prerenderPaths } from '../site/routes.js';
import { TRY_PLANS_PATH, TryScene } from '../site/TryScene.js';
import { SeatsAdminPage } from '../SeatsPage.js';
import { createFamilyApi } from '../familyApi.js';
import type { FetchLike } from '../lessonApi.js';

const render = (path: string) => renderToStaticMarkup(<App initialRoute={routeFromPath(path)} />);
const cfg = { mode: 'test' as const, plans: PLAN_PRICES_KRW };

describe('R326 entrance: the intro leads into the world', () => {
  it('the intro lives at /about (and an in-app `/` shows it); its header and hero go to /world/', () => {
    expect(parseSitePath('/about')?.page).toBe('home');
    expect(parseSitePath('/')?.path).toBe('/about');
    expect(prerenderPaths()).toContain('/about');
    expect(prerenderPaths()).not.toContain('/');
    const html = render('/about');
    const plays = html.match(/<a[^>]*data-cta="play"[^>]*>/g) ?? [];
    expect(plays.length).toBeGreaterThanOrEqual(2);
    for (const a of plays) expect(a).toContain('href="/world/"');
    expect(html).toContain('지금 플레이');
  });

  it('the try end sends the visitor to the plans step (no price on the child page itself)', () => {
    expect(TRY_PLANS_PATH).toBe('/pricing?from=try#plans');
    const end = renderToStaticMarkup(<TryScene initial={{ phase: 'end', stars: 3, said: 'x' }} />);
    expect(end).toContain(`href="${TRY_PLANS_PATH}"`);
  });
});

describe('R326 plans step on /pricing', () => {
  it('renders at #plans with the server price and the test-mode band', () => {
    const html = renderToStaticMarkup(<CheckoutSection config={cfg} initialSearch="?from=world" />);
    expect(html).toContain('id="plans"');
    expect(html).toContain('data-mode="test"');
    expect(html).toContain('카드 결제 준비 중 — 지금은 계좌이체로 받아요');
    expect(html).toContain('14,900원');
    expect(html).toContain('무료 체험이 끝났어요');
    expect(html).toContain('주문 넣기 (계좌이체)');
    // the refund rule is shown before payment (docs/16 #10)
    expect(html).toContain('이용을 시작하면 환불되지 않습니다');
    const live = renderToStaticMarkup(<CheckoutSection config={{ ...cfg, mode: 'live', client_key: 'test_ck_x' }} />);
    expect(live).not.toContain('계좌이체');
    expect(live).toContain('결제하기');
    expect(render('/pricing')).toContain('id="plans"');
  });

  it('reads where the visitor came from and the Toss return', () => {
    expect(originOf('?from=world')).toBe('world');
    expect(originOf('?from=evil')).toBe('pricing');
    expect(tossReturnOf('?pay=done&paymentKey=pk_1&orderId=lcw-abc&amount=14900')).toEqual({ kind: 'done', paymentKey: 'pk_1', orderId: 'lcw-abc', amount: 14_900 });
    expect(tossReturnOf('?pay=done&paymentKey=pk_1&orderId=lcw-abc&amount=x')).toEqual({ kind: 'fail' });
    expect(tossReturnOf('?pay=fail&code=USER_CANCEL')).toEqual({ kind: 'fail' });
    expect(tossReturnOf('')).toBeNull();
    expect(validContact('010-1234-5678')).toBe(true);
    expect(validContact('a@b.co')).toBe(true);
    expect(validContact('12')).toBe(false);
  });
});

describe('R326 operator inbox lists online orders', () => {
  it('shows a test-mode order waiting for the transfer', async () => {
    const orders = [
      { id: 'lcw-1', plan: 'solo', term: 'month', amount_krw: 14_900, player_id: 'kid-1', nickname: 'Juno', payer_name: '보호자', contact: '010-1234-5678', origin: 'world', mode: 'test', status: 'transfer_wait', created_at: 1_800_000_000_000, paid_at: null }
    ];
    const f: FetchLike = async (url) => {
      const u = String(url);
      const body = u.includes('seat-inbox') ? { requests: [], expiring: [], orders } : [];
      return new Response(JSON.stringify(body), { status: 200 });
    };
    const api = createFamilyApi({ fetch: f });
    const inbox = await api.adminSeatInbox('op');
    expect(inbox.orders?.[0]?.status).toBe('transfer_wait');
    // the page itself renders 'loading' on the server; the box is covered by the type and the api call above
    expect(renderToStaticMarkup(<SeatsAdminPage api={api} initialToken="op" />)).toContain('좌석 관리');
  });
});
