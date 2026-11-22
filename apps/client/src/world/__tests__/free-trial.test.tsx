/**
 * R326 free trial on the device: /v1/device/me says running/ended, only a running trial child beats (once a minute,
 * only while visible), the server's trial_ended answer swaps to the pay card, and the card has no price or time.
 */
import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FREE_PLAY_LIMITS } from '@lcw/schemas';
import { DEVICE_PLAY_BLOCKED_KEY, DEVICE_TOKEN_KEY, readPlayGate, rememberPlayGate, resolveIdentity, withPlayGate, type KeyStore, type PlayerIdentity } from '../identity.js';
import { isSeatInactiveBody, isTrialEndedBody, startTrialBeat } from '../seat.js';
import { TRIAL_PLANS_PATH, TrialEndedCard } from '../SeatNotice.js';
import { lessonJoinStep, needsTrialBeat, shellCardUp, soloPlayBlocked, withSeatStopped } from '../../App.js';
import { joinDeviceLesson } from '../../start/api.js';
import { FrameLayer, shopTipShown } from '../../frame/FrameLayer.js';
import type { WorldHandle } from '../api.js';

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

  it('R326 review: the device lesson join answer lifts a spent trial at once (no poll), an older server changes nothing', async () => {
    const store = memStore({ [DEVICE_TOKEN_KEY]: TOKEN });
    const ended = await resolveIdentity('', store, me({ nickname: 'Sora', play_allowed: false, seat: null, trial: 'ended' }));
    expect(soloPlayBlocked(ended)).toBe(true);
    const calls: string[] = [];
    const join = (extra: Record<string, unknown>) => async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      return new Response(JSON.stringify({ student_token: 's'.repeat(48), lesson_id: 'les-1', nickname: 'Sora', level: 'L2', voice_store: false, ...extra }), { status: 200 });
    };
    const s = await joinDeviceLesson(ended, join({ play_allowed: true, seat: null, trial: null }));
    // one request — the join the world makes anyway when the teacher starts the lesson
    expect(calls).toEqual(['POST /v1/device/lesson/join']);
    expect(s?.play).toEqual({ playAllowed: true, seat: null, trial: null });
    const step = lessonJoinStep(ended, s!);
    expect(step).toMatchObject({ remember: true, closeCard: true });
    const after = step.identity;
    expect(after).toMatchObject({ kind: 'child', playAllowed: true });
    expect((after as Extract<PlayerIdentity, { kind: 'child' }>).trial).toBeUndefined();
    expect(soloPlayBlocked(after)).toBe(false);
    expect(needsTrialBeat(after)).toBe(false); // a class student never beats the trial clock
    rememberPlayGate(store, s!.play!);
    expect(store.data[DEVICE_PLAY_BLOCKED_KEY]).toBeUndefined(); // an offline restart does not bring the card back
    // an older server without the gate: the device keeps what it knew
    const old = await joinDeviceLesson(ended, join({}));
    expect(old?.play).toBeUndefined();
    expect(lessonJoinStep(ended, old!)).toEqual({ identity: ended, remember: false, closeCard: true });
    // the same gate again keeps the same identity object (no effect re-runs, no extra request)
    expect(withPlayGate(after, s!.play!)).toBe(after);
    // the gate never touches a lesson-code student or a guest
    expect(withPlayGate({ kind: 'guest' }, readPlayGate({ play_allowed: true }))).toEqual({ kind: 'guest' });
    expect(readPlayGate({ play_allowed: false, trial: 'ended' })).toEqual({ playAllowed: false, seat: null, trial: 'ended' });
  });

  it('R326 review: the trial card holds the screen alone — no coin tip or frame button under its shade, none in a lesson', () => {
    const up = { soloBlocked: true, world: true, startOpen: false, lessonOn: false, seatCard: true };
    expect(shellCardUp(up)).toBe(true);
    // a live lesson puts the card (and the world pause) away; so does play coming back
    expect(shellCardUp({ ...up, lessonOn: true })).toBe(false);
    expect(shellCardUp({ ...up, soloBlocked: false })).toBe(false);
    // not on top of the title screen's Start button: the card comes once the child is in the world
    expect(shellCardUp({ ...up, startOpen: true })).toBe(false);
    const free = { blocked: false, menuOpen: false, guest: false, unseen: true, lessonOn: false, soloStopped: false };
    expect(shopTipShown(free)).toBe(true);
    expect(shopTipShown({ ...free, blocked: true })).toBe(false);
    // a spent trial cannot buy: the coin tip waits (unseen) until play comes back
    expect(shopTipShown({ ...free, soloStopped: true })).toBe(false);

    const g = globalThis as unknown as { localStorage?: Pick<Storage, 'getItem' | 'setItem'> };
    const had = g.localStorage;
    g.localStorage = { getItem: () => null, setItem: () => undefined };
    try {
      const world = {} as WorldHandle;
      const child = (playAllowed: boolean): Extract<PlayerIdentity, { kind: 'child' }> => ({ kind: 'child', token: TOKEN, nickname: 'Sora', level: 'L1', voiceStore: false, offline: false, playAllowed, seat: null });
      const open = renderToStaticMarkup(<FrameLayer world={world} identity={child(true)} />);
      expect(open).toContain('lcw-shoptip');
      expect(open).toContain('lcw-hudbtn--shop');
      const carded = renderToStaticMarkup(<FrameLayer world={world} identity={child(true)} cardOpen />);
      expect(carded).not.toContain('lcw-shoptip');
      expect(carded).not.toContain('lcw-hudbtn');
      const stopped = renderToStaticMarkup(<FrameLayer world={world} identity={{ ...child(false), trial: 'ended' }} />);
      expect(stopped).not.toContain('lcw-shoptip');
    } finally {
      if (had) g.localStorage = had;
      else delete g.localStorage;
    }
  });
});
