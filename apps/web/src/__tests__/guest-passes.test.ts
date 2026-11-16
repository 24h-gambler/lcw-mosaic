import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GuestPassesView, actionNotice, canTakeBack, confirmText, passBoxFor, passLine, revokeDone, shownPasses, slotBack, takeBack, type PassNotice } from '../GuestPasses.js';
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
    expect(html).toContain(P.noneLeft('12월 1일'));
    expect(issueTag(html)).toContain('disabled');
    // none left while an unused pass waits: say it can be taken back (no promise about the count)
    expect(html).toContain('data-testid="guest-passes-ready-hint"');
    expect(render([pass({ id: 'gp-3', state: 'ended' })], 0)).not.toContain('guest-passes-ready-hint');
  });

  it('an unused pass that ran out of days stays as a line with no button (#96: the server stops counting it)', () => {
    const expired = pass({ id: 'ex', state: 'expired', issued_at: NOW - 8 * DAY + 3_600_000, redeem_until: NOW - DAY + 3_600_000 });
    expect(canTakeBack(expired)).toBe(false);
    const html = render([expired], 2);
    expect(html).toContain('data-testid="guest-pass-ex"');
    expect(html).toContain(P.stateExpired);
    expect(html).not.toContain('data-testid="guest-pass-revoke-ex"');
    expect(html).not.toContain('data-testid="guest-pass-copy-ex"');
    expect(html).not.toContain('pass?code=');
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

  it('take back: reads the pass again, asks, and words the result from the server count (wiring of the flow)', () => {
    const fake = (fresh: GuestPass | undefined, leftBefore: number, after: GuestPass, leftAfter: number) => {
      const calls: string[] = [];
      return {
        calls,
        api: {
          guestPasses: async () => (calls.push('list'), { passes: fresh ? [fresh] : [], ...sum(leftBefore) }),
          revokeGuestPass: async (_g: string, id: string) => (calls.push(`revoke ${id}`), { pass: after, ...sum(leftAfter) })
        }
      };
    };
    return (async () => {
      // unused, the count went up: a slot came back
      let f = fake(pass(), 0, pass({ state: 'revoked' }), 1);
      const asked: string[] = [];
      expect(await takeBack(f.api, 'g', 's', 'gp-1', (q) => (asked.push(q), true))).toEqual({ kind: 'ok', text: P.revoked });
      expect(asked).toEqual([P.confirmRevoke]);
      expect(f.calls).toEqual(['list', 'revoke gp-1']);
      // the count did not move (e.g. a pass of another month): no slot promised
      f = fake(pass(), 1, pass({ state: 'revoked' }), 1);
      expect(await takeBack(f.api, 'g', 's', 'gp-1', () => true)).toEqual({ kind: 'ok', text: P.revokedPlain });
      // a friend entered since the screen loaded: the question is about stopping, the answer says stopped
      const running = pass({ state: 'active', started_at: NOW - 1000, ends_at: NOW + 1_000_000 });
      f = fake(running, 1, { ...running, state: 'revoked', ends_at: NOW }, 1);
      const q2: string[] = [];
      expect(await takeBack(f.api, 'g', 's', 'gp-1', (q) => (q2.push(q), true))).toEqual({ kind: 'ok', text: P.stopped });
      expect(q2).toEqual([P.confirmStop]);
      // cancelled: nothing sent, the last notice stays
      f = fake(pass(), 0, pass({ state: 'revoked' }), 1);
      expect(await takeBack(f.api, 'g', 's', 'gp-1', () => false)).toBeUndefined();
      expect(f.calls).toEqual(['list']);
      // gone or no longer takeable: say it changed, ask nothing
      f = fake(pass({ state: 'ended', started_at: NOW - DAY }), 0, pass(), 0);
      expect(await takeBack(f.api, 'g', 's', 'gp-1', () => { throw new Error('asked'); })).toEqual({ kind: 'info', text: P.changed });
      expect(f.calls).toEqual(['list']);
    })();
  });

  it('the third pass of the month (409 monthly_limit) and the other refusals each have their own words', () => {
    const msg = actionNotice('monthly_limit', sum(0));
    expect(msg).toBe(P.limit(2, P.noneLeft('12월 1일')));
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

  it('says when a slot opens as the server sends it (#98 resets_at): the end of a waiting code with its time, a month turn by date', () => {
    // 12-01 00:00 KST
    const monthTurn = Date.UTC(2026, 10, 30, 15, 0, 0);
    expect(slotBack(monthTurn)).toBe(P.noneLeft('12월 1일'));
    // a waiting code issued 11-16 14:44 KST ends 11-23 14:44 KST
    const codeEnd = Date.UTC(2026, 10, 23, 5, 44, 0);
    // only if nobody enters the waiting code (a friend entering keeps the slot used)
    expect(slotBack(codeEnd)).toBe(P.noneLeftCode('11월 23일 14:44'));
    expect(P.noneLeftCode('x')).toContain('아무도 들어오지 않으면');
    // never early: 14:44:30 reads 14:45
    expect(slotBack(codeEnd + 30_000)).toBe(P.noneLeftCode('11월 23일 14:45'));
    const html = renderToStaticMarkup(
      React.createElement(GuestPassesView, {
        passes: [pass()],
        summary: { ...sum(0), resets_at: codeEnd },
        busy: false,
        notice: null,
        onIssue: () => undefined,
        onRevoke: () => undefined,
        onCopy: () => undefined,
        copiedId: null,
        origin: 'https://lcw.example'
      })
    );
    expect(html).toContain(P.noneLeftCode('11월 23일 14:44'));
    expect(actionNotice('monthly_limit', { per_month: 2, resets_at: codeEnd })).toBe(P.limit(2, P.noneLeftCode('11월 23일 14:44')));
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
