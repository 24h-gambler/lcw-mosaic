/**
 * G01 connection band (docs/08 8.6): when the server cannot be reached the world keeps going on the device and the
 * HUD shows "혼자 모드로 계속 중". Signals: the browser's offline/online events, and `lcw:server-unreachable`, which
 * any domain may dispatch when one of its requests fails at the network level (a TypeError from fetch, not an HTTP
 * answer). While the band is up the watcher asks /v1/health every few seconds and drops the band on the first answer.
 * No polling while things are fine: the free request budget is spent on play, not on checks.
 */

export const SERVER_UNREACHABLE_EVENT = 'lcw:server-unreachable';

/** Tell the HUD a request could not reach the server (call from a fetch `catch` that saw a network error). */
export function reportServerUnreachable(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(SERVER_UNREACHABLE_EVENT));
}

export interface ConnectionWatchOptions {
  setOnline(on: boolean): void;
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
  /** ms between health checks while the band is up */
  retryMs?: number;
  target?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  startOnline?: boolean;
}

/** Starts watching; returns a stop function. */
export function watchConnection(opts: ConnectionWatchOptions): () => void {
  const target = opts.target ?? window;
  const f = opts.fetchImpl ?? ((i: string, init?: RequestInit) => globalThis.fetch(i, init));
  const retryMs = opts.retryMs ?? 5000;
  let online = opts.startOnline ?? true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const set = (on: boolean): void => {
    if (on === online) return;
    online = on;
    opts.setOnline(on);
    if (!on) schedule();
  };
  const check = async (): Promise<void> => {
    timer = null;
    if (stopped || online) return;
    try {
      // a half-open connection may never answer: give up after a few seconds and try again on the next round
      const signal = typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? AbortSignal.timeout(Math.max(1000, retryMs - 500)) : undefined;
      const res = await f('/v1/health', { cache: 'no-store', ...(signal ? { signal } : {}) });
      if (stopped) return;
      if (res.ok) {
        set(true);
        return;
      }
    } catch {
      /* still unreachable */
    }
    schedule();
  };
  const schedule = (): void => {
    if (stopped || timer !== null) return;
    timer = setTimeout(() => void check(), retryMs);
  };
  const down = (): void => set(false);
  // The browser saying "online" is a hint, not proof: check the server before dropping the band.
  const up = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    void check();
  };

  if (!online) {
    opts.setOnline(false);
    schedule();
  }
  target.addEventListener('offline', down);
  target.addEventListener('online', up);
  target.addEventListener(SERVER_UNREACHABLE_EVENT, down);
  return () => {
    stopped = true;
    if (timer !== null) clearTimeout(timer);
    target.removeEventListener('offline', down);
    target.removeEventListener('online', up);
    target.removeEventListener(SERVER_UNREACHABLE_EVENT, down);
  };
}
