import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GuestPassesView, actionNotice, canTakeBack, confirmText, passBoxFor, passLine, revokeDone, shownPasses, type PassNotice } from '../GuestPasses.js';
import { createFamilyApi, type GuestPass, type GuestPassSummary } from '../familyApi.js';
import type { FetchLike } from '../lessonApi.js';
import { PARENT_STRINGS_KO } from '../parentStrings.js';

const P = PARENT_STRINGS_KO.guestPasses;
// 11-16 14:00 KST
const NOW = Date.UTC(2026, 10, 16, 5, 0, 0);
const DAY = 86_400_000;
// 10-28 KST: issued last month
const LAST_MONTH = Date.UTC(2026, 9, 28, 3, 0, 0);
const pass = (over: Partial<GuestPass> = {}): GuestPass => ({
  id: 'gp-1',
  code: 'ABCD-EFGH',
  link: '/pass?code=ABCDEFGH',
  state: 'ready',
  issued_at: NOW - DAY,
  redeem_until: NOW + 6 * DAY,
  started_at: null,
  ends_at: null,
  ...over
});
const sum = (left: number): GuestPassSummary => ({ per_month: 2, minutes: 30, left_this_month: left, resets_at: Date.UTC(2026, 10, 30, 15, 0, 0), server_now: NOW });
/** The issue button's tag, whatever the attribute order. */
const issueTag = (html: string) => /<button[^>]*data-testid="guest-pass-issue"[^>]*>/.exec(html)?.[0] ?? '';
const render = (passes: GuestPass[], left: number, notice: PassNotice | null = null, stale = false) =>
  renderToStaticMarkup(
    React.createElement(GuestPassesView, {
      passes,
      summary: sum(left),
      busy: false,
      notice,
      stale,
      onIssue: () => undefined,
      onRevoke: () => undefined,
      onCopy: () => undefined,
      copiedId: null,
      origin: 'https://lcw.example'
    })
  );

describe('/family friend pass box (free-play.ts guest passes)', () => {
  it('none yet: what it is, how many are left, the issue button', () => {
    const html = render([], 2);
    expect(html).toContain(P.title);
    expect(html).toContain(P.body(30));
    expect(html).toContain(P.left(2, 2));
    expect(issueTag(html)).not.toContain('disabled');
  });

  it('a ready pass: code, full link, copy and take back; a running one: stop now; ended ones stay as a line', () => {
    const html = render([pass(), pass({ id: 'gp-2', state: 'active', started_at: NOW - 60_000, ends_at: NOW + 29 * 60_000 }), pass({ id: 'gp-3', state: 'ended', started_at: NOW - DAY, ends_at: NOW - DAY + 1_800_000 })], 0);
    expect(html).toContain('ABCD-EFGH');
    expect(html).toContain('https://lcw.example/pass?code=ABCDEFGH');
    expect(html).toContain('data-testid="guest-pass-copy-gp-1"');
    expect(html).toContain('data-testid="guest-pass-revoke-gp-1"');
    expect(html).toContain(P.stop);
    expect(html).not.toContain('data-testid="guest-pass-copy-gp-2"');
    expect(html).toContain(P.stateEnded);
    expect(html).not.toContain('data-testid="guest-pass-revoke-gp-3"');
    // the month is used up: the button is off and the date it comes back is said
    expect(html).toContain('이번 달 초대권을 다 썼습니다');
    expect(issueTag(html)).toContain('disabled');
  });

  it('an unused pass that ran out of days is gone (#96: the server stops counting it), this month or last', () => {
    const expired = pass({ id: 'ex', state: 'expired', issued_at: NOW - 8 * DAY + 3_600_000, redeem_until: NOW - DAY + 3_600_000 });
    expect(canTakeBack(expired)).toBe(false);
    expect(render([expired], 2)).not.toContain('guest-pass-ex');
    expect(shownPasses([expired, pass({ id: 'old', state: 'expired', issued_at: LAST_MONTH, redeem_until: LAST_MONTH + 7 * DAY })])).toEqual([]);
    expect(P.rules).toContain('장수에서도 저절로 빠집니다');
  });

  it('a pass stopped mid-play (server: revoked with started_at) stays as a line; one taken back unused is not listed', () => {
    const stopped = pass({ id: 'st', state: 'revoked', started_at: NOW - 600_000, ends_at: NOW - 60_000 });
    const back = pass({ id: 'bk', state: 'revoked' });
    const html = render([stopped, back], 1);
    expect(html).toContain('data-testid="guest-pass-st"');
    expect(html).toContain(P.stateStopped);
    expect(html).not.toContain('data-testid="guest-pass-revoke-st"');
    expect(html).not.toContain('guest-pass-bk');
    for (const st of ['ready', 'active', 'ended', 'expired', 'revoked'] as const) expect(passLine(pass({ state: st, ends_at: NOW }))).toBeTruthy();
    expect(passLine(stopped)).toBe(P.stateStopped);
    expect(passLine(back)).toBe(P.stateRevoked);
  });

  it('the confirm and done words come from the fresh pass and the server count, not a month rule of the screen', () => {
    expect(confirmText(pass())).toBe(P.confirmRevoke);
    expect(confirmText(pass({ state: 'active', started_at: NOW - 1000, ends_at: NOW + 1000 }))).toBe(P.confirmStop);
    // the friend entered in between: the server stopped a running pass
    expect(revokeDone(pass({ state: 'revoked', started_at: NOW - 1000, ends_at: NOW }), 0, 0)).toBe(P.stopped);
    // a slot came back only when the server's count went up (whatever the server's month rule is)
    expect(revokeDone(pass({ state: 'revoked' }), 0, 1)).toBe(P.revoked);
    expect(revokeDone(pass({ state: 'revoked', issued_at: LAST_MONTH }), 1, 1)).toBe(P.revokedPlain);
  });

  it('the third pass of the month (409 monthly_limit) and the other refusals each have their own words', () => {
    const msg = actionNotice('monthly_limit', sum(0));
    expect(msg).toBe(P.limit(2, '12월 1일'));
    expect(msg).toContain('2장');
    expect(actionNotice('seat_inactive', sum(0))).toBe(P.seatInactive);
    expect(actionNotice('service_consent_required', sum(0))).toBe(P.needConsent);
    expect(actionNotice('pass_not_found', sum(0))).toBe(P.gone);
    // a failed action is not "could not load"
    expect(actionNotice('network', sum(0))).toBe(P.actionError);
    expect(actionNotice(null, sum(0))).not.toBe(P.error);
    const html = render([], 0, { kind: 'error', text: msg }, true);
    expect(html).toContain('data-testid="guest-passes-notice"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('data-testid="guest-passes-stale"');
  });

  it('the box goes on live seats of the own child only (not another family\'s Duo seat, not ended seats)', () => {
    expect(passBoxFor({ child: { player_id: 'k', nickname: 'Juno' } as never, state: 'active' })).toBe(true);
    expect(passBoxFor({ child: { player_id: 'k', nickname: 'Juno' } as never, state: 'expiring' })).toBe(true);
    expect(passBoxFor({ child: null, state: 'active' })).toBe(false);
    for (const st of ['read_only', 'archived', 'refunded'] as const) expect(passBoxFor({ child: { player_id: 'k', nickname: 'Juno' } as never, state: st })).toBe(false);
  });

  it('client paths and methods match free-play.ts', async () => {
    const seen: Array<{ method: string; url: string; auth: string | null }> = [];
    const fetch: FetchLike = async (url, init) => {
      seen.push({ method: init?.method ?? 'GET', url, auth: new Headers(init?.headers).get('authorization') });
      return new Response(JSON.stringify({ passes: [], pass: pass(), ...sum(2) }));
    };
    const api = createFamilyApi({ fetch });
    await api.guestPasses('gtok', 'seat 1');
    await api.issueGuestPass('gtok', 'seat 1');
    await api.revokeGuestPass('gtok', 'gp-9');
    expect(seen).toEqual([
      { method: 'GET', url: '/v1/family/seats/seat%201/guest-passes', auth: 'Bearer gtok' },
      { method: 'POST', url: '/v1/family/seats/seat%201/guest-passes', auth: 'Bearer gtok' },
      { method: 'POST', url: '/v1/family/guest-passes/gp-9/revoke', auth: 'Bearer gtok' }
    ]);
  });
});
