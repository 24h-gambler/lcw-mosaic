import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RECOGNITION_KEEPALIVE, browserRecognitionCuts, createBrowserSpeechEngine } from '../dialog/speech.js';
import { MicController, type Clock } from '../dialog/mic-controller.js';

/**
 * Dan 11-16 "음성이 1초도 유지가 안되고 인식이 끊기는": Android Chrome ignores `continuous` and ends recognition on the
 * first pause. The engine must keep listening until the mic controller ends the turn, joining what it heard.
 */

type Ev = { error: string };
class FakeRec {
  static made: FakeRec[] = [];
  lang = '';
  continuous = false;
  interimResults = false;
  maxAlternatives = 1;
  onresult: ((ev: unknown) => void) | null = null;
  onerror: ((ev: Ev) => void) | null = null;
  onend: (() => void) | null = null;
  started = false;
  stopped = false;
  constructor() {
    FakeRec.made.push(this);
  }
  start() {
    this.started = true;
  }
  /** Real Chrome: stop() may report 'aborted' / 'no-speech' before its onend. */
  stop() {
    this.stopped = true;
    queueMicrotask(() => {
      this.onerror?.({ error: 'aborted' });
      this.onend?.();
    });
  }
  abort() {
    queueMicrotask(() => {
      this.onerror?.({ error: 'aborted' });
      this.onend?.();
    });
  }
  say(text: string, final: boolean) {
    this.onresult?.({ resultIndex: 0, results: [{ isFinal: final, 0: { transcript: text, confidence: 0.9 } }] });
  }
  /** What Android Chrome does on the first pause. */
  cut(error?: string) {
    if (error) this.onerror?.({ error });
    this.onend?.();
  }
}
const mem = new Map<string, string>();
(globalThis as unknown as { localStorage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> }).localStorage = {
  getItem: (k) => mem.get(k) ?? null,
  setItem: (k, v) => void mem.set(k, String(v)),
  removeItem: (k) => void mem.delete(k)
};
const last = () => FakeRec.made.at(-1)!;
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};
/** The pause before the engine listens again. */
const gap = () => vi.advanceTimersByTime(RECOGNITION_KEEPALIVE.restartDelayMs);

describe('browser recognition keeps the turn open (Android cut)', () => {
  let t = 0;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    FakeRec.made = [];
    t = 0;
    mem.clear();
  });
  afterEach(() => vi.useRealTimers());

  const engine = () => createBrowserSpeechEngine({ userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile', isSecureContext: true, SpeechRecognition: FakeRec as never }, 'en-US', () => t);
  const cbs = () => ({ onInterim: vi.fn(), onEnd: vi.fn(), onError: vi.fn() });

  it('restarts after the browser ends by itself and joins the words of every run', async () => {
    const cb = cbs();
    const s = engine().start(cb);
    last().say('can I have', false);
    t = 800;
    last().cut(); // first pause: Android ends (interim never finalized)
    gap();
    expect(FakeRec.made).toHaveLength(2);
    expect(cb.onEnd).not.toHaveBeenCalled();
    last().say('some cold water', true);
    expect(cb.onInterim.mock.calls.at(-1)![0]).toBe('can I have some cold water');
    t = 2500;
    last().cut('no-speech'); // later silence cut: still the turn
    gap();
    expect(FakeRec.made).toHaveLength(3);
    s.stop(); // the mic controller ends the turn (tap / 2.5 s silence / 12 s)
    await flush();
    expect(cb.onError).not.toHaveBeenCalled();
    expect(cb.onEnd).toHaveBeenCalledTimes(1);
    expect(cb.onEnd.mock.calls[0]![0].transcript).toBe('can I have some cold water');
  });

  it('a no-speech or aborted cut before the child spoke is not an error; a denied mic still is', () => {
    const cb = cbs();
    engine().start(cb);
    last().cut('no-speech');
    gap();
    last().cut('aborted');
    gap();
    expect(cb.onError).not.toHaveBeenCalled();
    expect(FakeRec.made).toHaveLength(3);
    last().cut('not-allowed');
    gap();
    expect(cb.onError).toHaveBeenCalledWith('denied', 'not-allowed');
    expect(FakeRec.made).toHaveLength(3);
  });

  it('a stop between two runs ends the turn at once with what was heard; abort sends nothing', async () => {
    const cb = cbs();
    const s = engine().start(cb);
    last().say('water', true);
    last().cut();
    s.stop(); // inside the restart pause
    gap();
    expect(FakeRec.made).toHaveLength(1);
    expect(cb.onEnd).toHaveBeenCalledTimes(1);
    expect(cb.onEnd.mock.calls[0]![0].transcript).toBe('water');
    const cb2 = cbs();
    const s2 = engine().start(cb2);
    last().say('hello', false);
    s2.abort();
    await flush();
    gap();
    expect(cb2.onEnd).not.toHaveBeenCalled();
    expect(cb2.onError).not.toHaveBeenCalled();
  });

  it('late events of an older run are ignored', () => {
    const cb = cbs();
    engine().start(cb);
    const first = last();
    first.say('cold', true);
    first.cut();
    gap();
    first.say('GHOST', true);
    first.onend?.();
    gap();
    expect(FakeRec.made).toHaveLength(2);
    expect(cb.onInterim.mock.calls.at(-1)![0]).toBe('cold');
  });

  it('the clip recorder holding the mic on a restarted run ends the turn with the words, not a mic problem', () => {
    const cb = cbs();
    engine().start(cb);
    last().say('cold water', true);
    last().cut();
    gap();
    last().cut('audio-capture');
    expect(cb.onError).not.toHaveBeenCalled();
    expect(cb.onEnd.mock.calls[0]![0].transcript).toBe('cold water');
  });

  it('a device that keeps cutting short goes to the server Whisper rung after two such turns, and forgets it later', async () => {
    for (let turn = 0; turn < RECOGNITION_KEEPALIVE.flakyTurns; turn++) {
      const s = engine().start(cbs());
      for (let i = 0; i < RECOGNITION_KEEPALIVE.flakyShortEnds; i++) {
        last().cut();
        gap();
      }
      s.stop();
      await flush();
    }
    expect(browserRecognitionCuts()).toBe(true);
    expect(browserRecognitionCuts(Date.now() + RECOGNITION_KEEPALIVE.flakyForgetMs + 1000)).toBe(false);
  });

  describe('with the mic controller', () => {
    let now = 0;
    const ticks: Array<() => void> = [];
    const clock: Clock = {
      now: () => now,
      every: (_ms, fn) => {
        ticks.push(fn);
        return () => void ticks.splice(ticks.indexOf(fn), 1);
      }
    };
    const step = (ms: number) => {
      for (let i = 0; i < ms / 100; i++) {
        now += 100;
        vi.advanceTimersByTime(100);
        for (const f of [...ticks]) f();
      }
    };
    const controller = (finals: Array<string | null>) =>
      new MicController(createBrowserSpeechEngine({ userAgent: 'x', isSecureContext: true, SpeechRecognition: FakeRec as never }, 'en-US', () => now), {
        onView: () => {},
        onFinal: (r) => finals.push(r?.transcript ?? null),
        onIssue: () => {}
      }, clock);
    beforeEach(() => {
      now = 0;
      ticks.length = 0;
    });

    it('the turn lasts until 2.5 s of silence after speaking, not the browser cut', async () => {
      const finals: Array<string | null> = [];
      const mic = controller(finals);
      mic.tap();
      step(500);
      last().say('cold', false);
      step(300);
      last().cut(); // Android: 0.8 s in, ends on the pause
      step(700);
      expect(mic.recording).toBe(true);
      last().say('water please', true);
      step(1000);
      expect(mic.recording).toBe(true);
      step(2600); // 2.5 s of silence after speaking
      await flush();
      expect(mic.recording).toBe(false);
      expect(finals).toEqual(['cold water please']);
    });

    it('a browser that ends right after every start still keeps the turn for the 6 s first-word wait', async () => {
      const finals: Array<string | null> = [];
      const mic = controller(finals);
      mic.tap();
      while (now < 5_000) {
        last().cut();
        step(300);
      }
      expect(mic.recording).toBe(true);
      last().say('hello', true);
      step(2700);
      await flush();
      expect(finals).toEqual(['hello']);
    });
  });
});
