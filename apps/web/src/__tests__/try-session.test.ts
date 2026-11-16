import { describe, expect, it } from 'vitest';
import { FREE_PLAY_LIMITS } from '@lcw/schemas';
import { TRY_DEVICE_KEY, formatClock, orderTry, startTrySession, tryDeviceId, tryRemainingMs } from '../site/trySession.js';
import { TRY } from '../site/tryCopy.js';

const reply = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('/try session judged by the server (docs/01 §3, docs/19 8장)', () => {
  it('keeps one device id per browser, and still answers when storage throws', () => {
    const m = new Map<string, string>();
    const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    const a = tryDeviceId(store, () => 'a'.repeat(32));
    expect(a).toBe('a'.repeat(32));
    expect(m.get(TRY_DEVICE_KEY)).toBe(a);
    expect(tryDeviceId(store, () => 'b'.repeat(32))).toBe(a);
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => undefined
    };
    const c = tryDeviceId(broken, () => 'c'.repeat(32));
    expect(tryDeviceId(broken, () => 'd'.repeat(32))).toBe(c);
  });

  it('start: uses the server clock (offset), and tells "used today" and errors apart', async () => {
    const session = { try_id: 't1', started_at: 1_000_000, ends_at: 1_000_000 + FREE_PLAY_LIMITS.tryMinutes * 60_000, server_now: 1_000_000, order: null };
    const ok = await startTrySession(reply(200, session), 'x'.repeat(32), () => 400_000);
    expect(ok.kind).toBe('ok');
    if (ok.kind !== 'ok') return;
    expect(ok.offsetMs).toBe(600_000);
    // The client clock is 10 minutes behind: the time left is still the server's 3 minutes.
    expect(tryRemainingMs(session.ends_at, ok.offsetMs, 400_000)).toBe(FREE_PLAY_LIMITS.tryMinutes * 60_000);
    expect(tryRemainingMs(session.ends_at, ok.offsetMs, 400_000 + 10 * 60_000)).toBe(0);

    expect((await startTrySession(reply(429, { error: 'try_used_today', retry_at: 1, last: null }), 'x'.repeat(32))).kind).toBe('used_today');
    expect((await startTrySession(reply(500, { error: 'x' }), 'x'.repeat(32))).kind).toBe('error');
    const down = async (): Promise<Response> => {
      throw new TypeError('offline');
    };
    expect((await startTrySession(down, 'x'.repeat(32))).kind).toBe('error');
  });

  it('order: only the server grant serves the drink; a miss, the end and a second order each come back as such', async () => {
    const p = { tryId: 't1', aim: 3 as const, text: 'Can I have a warm honey tea, please?', path: 'recognition' as const };
    expect(await orderTry(reply(200, { stars: 3, granted: true, orders_left: 0, ends_at: 1, server_now: 0 }), p)).toEqual({ kind: 'granted', stars: 3 });
    expect(await orderTry(reply(200, { stars: 0, granted: false, orders_left: 1, ends_at: 1, server_now: 0 }), p)).toEqual({ kind: 'missed' });
    expect(await orderTry(reply(410, { error: 'try_ended' }), p)).toEqual({ kind: 'ended' });
    expect(await orderTry(reply(409, { error: 'try_order_used', order: { stars: 2 } }), p)).toEqual({ kind: 'used', stars: 2 });
    expect(await orderTry(reply(429, { error: 'too_many_requests' }), p)).toEqual({ kind: 'too_many' });
    expect(await orderTry(reply(500, { error: 'x' }), p)).toEqual({ kind: 'error' });
  });

  it('sends the sentence capped at 300 characters and nothing about the person', async () => {
    let sent: Record<string, unknown> = {};
    const spy = async (_u: string, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ stars: 1, granted: true, orders_left: 0, ends_at: 1, server_now: 0 }), { status: 200 });
    };
    await orderTry(spy, { tryId: 't1', aim: 1, text: 'x'.repeat(500), path: 'wordcards_with_loudness', spoke: true });
    expect(Object.keys(sent).sort()).toEqual(['aim', 'path', 'spoke', 'text', 'try_id']);
    expect(String(sent.text)).toHaveLength(300);
  });

  it('clock and child copy: minutes come from FREE_PLAY_LIMITS, no price or deadline words', () => {
    expect(formatClock(125_000)).toBe('2:05');
    expect(formatClock(400)).toBe('0:01');
    expect(TRY.limitNote).toContain(`${FREE_PLAY_LIMITS.tryMinutes}분`);
    const all = [TRY.limitNote, TRY.serverMissed, TRY.netError, TRY.retry, TRY.timeLeft('1:00'), ...Object.values(TRY.gate).flatMap((g) => [g.title, g.body])].join(' ');
    expect(all).not.toMatch(/[0-9,]+\s*원|결제|할인|구독|만료|기한|남은 수량|품절|게임/);
  });
});

describe('TrySpeak waits are not restarted by the per-second clock re-render', () => {
  it('the pass/finish timers read the callback from a ref and do not depend on it', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../site/TrySpeak.tsx', import.meta.url), 'utf8');
    // 11-16 real-path check: with onDone in the deps the 1.3 s pause restarted every second and the order never fired.
    expect(src).toContain('onDoneRef.current(passed');
    expect(src).toContain('onPassedRef.current(');
    for (const deps of src.match(/\}, \[[^\]]*\]\);/g) ?? []) expect(deps, deps).not.toMatch(/\bonDone\b|\bonPassed\b/);
  });
});
