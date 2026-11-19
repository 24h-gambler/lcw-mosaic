/**
 * R326 free trial on the device: /v1/device/me says running/ended, only a running trial child beats (once a minute,
 * only while visible), the server's trial_ended answer swaps to the pay card, and the card has no price or time.
 */
import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FREE_PLAY_LIMITS } from '@lcw/schemas';
import { DEVICE_PLAY_BLOCKED_KEY, DEVICE_TOKEN_KEY, resolveIdentity, type KeyStore } from '../identity.js';
import { isSeatInactiveBody, isTrialEndedBody, startTrialBeat } from '../seat.js';
import { TRIAL_PLANS_PATH, TrialEndedCard } from '../SeatNotice.js';
import { needsTrialBeat, soloPlayBlocked, withSeatStopped } from '../../App.js';

function memStore(init: Record<string, string> = {}): KeyStore & { data: Record<string, string> } {
  const data = { ...init };
  return { data, getItem: (k) => (k in data ? data[k]! : null), setItem: (k, v) => void (data[k] = v), removeItem: (k) => void delete data[k] };
}
const TOKEN = 'a'.repeat(64);
const me = (body: unknown) => async () => new Response(JSON.stringify(body), { status: 200 });

describe('R326 free trial on the device', () => {
  it('reads trial running/ended from /v1/device/me and remembers an ended trial for an offline start', async () => {
    const run = await resolveIdentity('', memStore({ [DEVICE_TOKEN_KEY]: TOKEN }), me({ nickname: 'Sora', play_allowed: true, seat: null, trial: 'running' }));
    expect(run).toMatchObject({ kind: 'child', playAllowed: true, trial: 'running' });
    expect(needsTrialBeat(run)).toBe(true);
    const store = memStore({ [DEVICE_TOKEN_KEY]: TOKEN });
    const end = await resolveIdentity('', store, me({ nickname: 'Sora', play_allowed: false, seat: null, trial: 'ended' }));
    expect(end).toMatchObject({ playAllowed: false, trial: 'ended' });
    expect(soloPlayBlocked(end)).toBe(true);
    expect(needsTrialBeat(end)).toBe(false);
    expect(store.data[DEVICE_PLAY_BLOCKED_KEY]).toBe('trial');
    const offline = await resolveIdentity('', store, async () => {
      throw new Error('offline');
    });
    expect(offline).toMatchObject({ offline: true, playAllowed: false, trial: 'ended' });
    // a seated child (trial null) and an older server without the field never beat
    for (const body of [{ play_allowed: true, seat: { state: 'active' }, trial: null }, { play_allowed: true, seat: null }]) {
      expect(needsTrialBeat(await resolveIdentity('', memStore({ [DEVICE_TOKEN_KEY]: TOKEN }), me(body)))).toBe(false);
    }
    expect(needsTrialBeat({ kind: 'guest' })).toBe(false);
    expect(withSeatStopped(run, true)).toMatchObject({ playAllowed: false, trial: 'ended' });
  });

  it('the server answer trial_ended counts as a stop and is told apart from a paused seat', () => {
    expect(isSeatInactiveBody({ error: 'trial_ended', trial: 'ended' })).toBe(true);
    expect(isTrialEndedBody({ error: 'trial_ended' })).toBe(true);
    expect(isTrialEndedBody({ error: 'seat_inactive' })).toBe(false);
  });

  it('beats at once and then every minute, skips a hidden tab, and stops when the server says the trial ended', async () => {
    const calls: string[] = [];
    let tick: (() => void) | null = null;
    const timers = {
      setInterval: ((fn: () => void, ms: number) => {
        expect(ms).toBe(FREE_PLAY_LIMITS.worldTrialBeatMs);
        tick = fn;
        return 1 as unknown as ReturnType<typeof setInterval>;
      }) as unknown as typeof setInterval,
      clearInterval: (() => {
        tick = null;
      }) as unknown as typeof clearInterval
    };
    const doc = { visibilityState: 'visible' as DocumentVisibilityState, addEventListener: () => undefined, removeEventListener: () => undefined };
    let answer = { play_allowed: true, trial: 'running' };
    let ended = 0;
    startTrialBeat({
      token: TOKEN,
      everyMs: FREE_PLAY_LIMITS.worldTrialBeatMs,
      onEnded: () => ended++,
      doc,
      timers,
      fetchImpl: async (url, init) => {
        calls.push(`${init?.method} ${url}`);
        return new Response(JSON.stringify(answer), { status: 200 });
      }
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toEqual(['POST /v1/device/heartbeat']);
    doc.visibilityState = 'hidden';
    tick!();
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toHaveLength(1);
    doc.visibilityState = 'visible';
    answer = { play_allowed: false, trial: 'ended' };
    tick!();
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toHaveLength(2);
    expect(ended).toBe(1);
    expect(tick).toBeNull();
  });

  it('the pay card points the grown-up at the plans page and shows no price, payment word or time', () => {
    const html = renderToStaticMarkup(<TrialEndedCard onClose={() => undefined} />);
    expect(html).toContain(`href="${TRIAL_PLANS_PATH.replace('&', '&amp;')}"`);
    expect(TRIAL_PLANS_PATH).toBe('/pricing?from=world#plans');
    expect(html).not.toMatch(/원|₩|\d{1,3},\d{3}|결제|price|pay\b|기한|까지/);
  });
});
