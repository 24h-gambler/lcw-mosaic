// G01 HUD read-outs and the connection band (docs/08 8.1, 8.6): place · band, weather · clock, hotbar caption, offline.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bandOf, clockLabel, hotbarCaption, placeLabel } from '../frame/status.js';
import { SERVER_UNREACHABLE_EVENT, watchConnection } from '../frame/connection.js';
import { WORLD_STRINGS as W } from '../world/strings.js';

describe('status line', () => {
  it('names the vertical band of docs/03 3.2 by height', () => {
    expect(bandOf(1)).toBe('surface');
    expect(bandOf(-8)).toBe('surface');
    expect(bandOf(-9)).toBe('mine');
    expect(bandOf(79.5)).toBe('surface');
    expect(bandOf(80)).toBe('sky_island');
    expect(bandOf(-200)).toBe('deep_core');
    expect(bandOf(450)).toBe('space_station');
    expect(bandOf(5000)).toBe('deep_space');
    expect(bandOf(-5000)).toBe('deep_core');
  });

  it('puts the place first, then the band', () => {
    expect(placeLabel('중앙 광장', 'surface')).toBe('중앙 광장 · 지상');
    expect(placeLabel('', 'mine')).toBe('광산');
  });

  it('shows weather in words next to a zero-padded world clock (night 19~05)', () => {
    expect(clockLabel(10.5, 'clear')).toBe(`${W.weatherClear} 10:30`);
    expect(clockLabel(8.75, 'clear')).toBe(`${W.weatherClear} 08:45`);
    expect(clockLabel(21 + 1 / 6, 'clear')).toBe(`${W.weatherNight} 21:10`);
    expect(clockLabel(4.99, 'clear').startsWith(W.weatherNight)).toBe(true);
    expect(clockLabel(5, 'clear').startsWith(W.weatherClear)).toBe(true);
    expect(clockLabel(10.5, 'snow')).toBe(`${W.weatherSnow} 10:30`);
    expect(clockLabel(24, 'clear')).toBe(`${W.weatherNight} 00:00`);
  });
});

describe('hotbar caption', () => {
  const tea = { title: '꿀차' };
  it('says what an all-empty bar is for, so empty slots never look unfinished', () => {
    expect(hotbarCaption([null, null, null, null, null], 0)).toBe(W.hotbarAllEmpty);
    expect(W.hotbarAllEmpty).not.toMatch(/게임/);
  });
  it('names the selected thing, or "빈 칸" when only that slot is empty', () => {
    expect(hotbarCaption([tea, null, null, null, null], 0)).toBe('꿀차');
    expect(hotbarCaption([tea, null, null, null, null], 2)).toBe(W.hotbarEmpty);
  });
});

describe('connection band', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function fakeTarget() {
    const t = new EventTarget();
    return t as unknown as Pick<Window, 'addEventListener' | 'removeEventListener'> & EventTarget;
  }

  it('shows the band on offline and on a network failure, and drops it only after /v1/health answers', async () => {
    const target = fakeTarget();
    const states: boolean[] = [];
    let up = false;
    const calls: string[] = [];
    const stop = watchConnection({
      setOnline: (on) => states.push(on),
      target,
      retryMs: 1000,
      fetchImpl: async (u) => {
        calls.push(u);
        if (!up) throw new TypeError('network');
        return new Response('{}', { status: 200 });
      }
    });
    target.dispatchEvent(new Event('offline'));
    expect(states).toEqual([false]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toEqual(['/v1/health']);
    expect(states).toEqual([false]);
    up = true;
    await vi.advanceTimersByTimeAsync(1000);
    expect(states).toEqual([false, true]);
    // no polling while things are fine
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls.length).toBe(2);
    target.dispatchEvent(new Event(SERVER_UNREACHABLE_EVENT));
    expect(states).toEqual([false, true, false]);
    stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls.length).toBe(2);
  });

  it('treats the browser "online" event as a hint and checks the server first', async () => {
    const target = fakeTarget();
    const states: boolean[] = [];
    const stop = watchConnection({
      setOnline: (on) => states.push(on),
      target,
      startOnline: false,
      retryMs: 1000,
      fetchImpl: async () => new Response('', { status: 503 })
    });
    expect(states).toEqual([false]);
    target.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    expect(states).toEqual([false]);
    stop();
  });
});
