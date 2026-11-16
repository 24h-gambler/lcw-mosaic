import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GuestPassesView, passLine } from '../GuestPasses.js';
import type { GuestPass, GuestPassSummary } from '../familyApi.js';
import { PARENT_STRINGS_KO } from '../parentStrings.js';

const P = PARENT_STRINGS_KO.guestPasses;
const NOW = Date.UTC(2026, 10, 16, 5, 0, 0);
const DAY = 86_400_000;
const pass = (over: Partial<GuestPass> = {}): GuestPass => ({
  id: 'gp-1',
  code: 'ABCD-EFGH',
  link: '/pass?code=ABCDEFGH',
  state: 'ready',
  issued_at: NOW,
  redeem_until: NOW + 7 * DAY,
  started_at: null,
  ends_at: null,
  ...over
});
const sum = (left: number): GuestPassSummary => ({ per_month: 2, minutes: 30, left_this_month: left, resets_at: Date.UTC(2026, 10, 30, 15, 0, 0), server_now: NOW });
/** The issue button's tag, whatever the attribute order. */
const issueTag = (html: string) => /<button[^>]*data-testid="guest-pass-issue"[^>]*>/.exec(html)?.[0] ?? '';
const render = (passes: GuestPass[], left: number, notice: string | null = null) =>
  renderToStaticMarkup(
    React.createElement(GuestPassesView, {
      passes,
      summary: sum(left),
      busy: false,
      notice,
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
    const html = render([pass(), pass({ id: 'gp-2', state: 'active', started_at: NOW - 60_000, ends_at: NOW + 29 * 60_000 }), pass({ id: 'gp-3', state: 'ended' })], 0);
    expect(html).toContain('ABCD-EFGH');
    expect(html).toContain('https://lcw.example/pass?code=ABCDEFGH');
    expect(html).toContain('data-testid="guest-pass-copy-gp-1"');
    expect(html).toContain(P.revoke);
    expect(html).toContain(P.stop);
    expect(html).not.toContain('data-testid="guest-pass-copy-gp-2"');
    expect(html).toContain(P.stateEnded);
    // the month is used up: the button is off and the date it comes back is said
    expect(html).toContain('이번 달 초대권을 다 썼습니다');
    expect(issueTag(html)).toContain('disabled');
  });

  it('expired and revoked passes are not listed; each state has words', () => {
    const html = render([pass({ id: 'x1', state: 'expired' }), pass({ id: 'x2', state: 'revoked' })], 1);
    expect(html).not.toContain('guest-pass-x1');
    expect(html).not.toContain('guest-pass-x2');
    for (const st of ['ready', 'active', 'ended', 'expired', 'revoked'] as const) expect(passLine(pass({ state: st, ends_at: NOW }))).toBeTruthy();
  });

  it('the third pass of the month (409 monthly_limit) is explained with the limit and when it comes back', () => {
    const msg = P.limit(2, '12월 1일');
    expect(msg).toContain('2장');
    expect(msg).toContain('12월 1일');
    expect(msg).toContain('회수');
    const html = render([], 0, msg);
    expect(html).toContain('data-testid="guest-passes-notice"');
  });
});
