import { afterEach, describe, expect, it, vi } from 'vitest';
import { CLIP_EARLIEST_START_MS, afterPageSettles } from '../site/GameMedia.js';

// The site clips must not start downloading before the page has loaded and gone idle (Lighthouse mobile LCP on /play
// went to 3.1 s when the 681 KB clip started at 0.58 s, production 11-16).
describe('site clips wait for the page to settle', () => {
  const g = globalThis as unknown as Record<string, unknown>;
  afterEach(() => {
    delete g.window;
    delete g.document;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function fakePage(readyState: string, withIdle: boolean) {
    const listeners: Record<string, () => void> = {};
    const idle: Array<() => void> = [];
    g.document = { readyState };
    g.window = {
      addEventListener: (type: string, cb: () => void) => (listeners[type] = cb),
      removeEventListener: (type: string) => delete listeners[type],
      ...(withIdle ? { requestIdleCallback: (cb: () => void) => idle.push(cb), cancelIdleCallback: () => undefined } : {})
    };
    return { listeners, idle };
  }

  it('waits for load, then for an idle moment', () => {
    const page = fakePage('interactive', true);
    const fn = vi.fn();
    afterPageSettles(fn);
    expect(fn).not.toHaveBeenCalled();
    expect(page.idle).toHaveLength(0);
    page.listeners.load?.();
    expect(fn).not.toHaveBeenCalled();
    vi.spyOn(performance, 'now').mockReturnValue(CLIP_EARLIEST_START_MS + 1);
    page.idle[0]?.();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('never starts before the earliest start time, even when load and idle come fast', () => {
    vi.useFakeTimers();
    const page = fakePage('interactive', true);
    const now = vi.spyOn(performance, 'now').mockReturnValue(300);
    const fn = vi.fn();
    afterPageSettles(fn);
    page.listeners.load?.();
    page.idle[0]?.();
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(CLIP_EARLIEST_START_MS - 300 - 10);
    expect(fn).not.toHaveBeenCalled();
    now.mockReturnValue(CLIP_EARLIEST_START_MS + 5);
    vi.advanceTimersByTime(20);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('starts from the idle wait when the page already loaded, and falls back to a timer without idle callbacks', () => {
    vi.useFakeTimers();
    fakePage('complete', false);
    vi.spyOn(performance, 'now').mockReturnValue(CLIP_EARLIEST_START_MS + 1);
    const fn = vi.fn();
    afterPageSettles(fn);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(600);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('never fires after cancel (component unmounted)', () => {
    const page = fakePage('interactive', true);
    const fn = vi.fn();
    const cancel = afterPageSettles(fn);
    cancel();
    expect(page.listeners.load).toBeUndefined();
    const late = fakePage('complete', true);
    afterPageSettles(fn)();
    late.idle[0]?.();
    expect(fn).not.toHaveBeenCalled();
  });

  it('does nothing during server rendering', () => {
    const fn = vi.fn();
    afterPageSettles(fn)();
    expect(fn).not.toHaveBeenCalled();
  });
});
