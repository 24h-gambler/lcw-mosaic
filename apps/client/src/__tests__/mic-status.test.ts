import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MicController } from '../dialog/mic-controller.js';
import { MIC_ISSUE_KEY, MIC_STATUS_KEY, MIC_TURNS_KEY, noteMicIssue, noteMicTurn, noteTurnLost, noteTurnSent, readMicIssue, readMicTurns, resetMicStatusForTest } from '../dialog/mic-status.js';
import { MIC_TURNS_RE, readLessonMicTurns } from '../lesson/api.js';
import type { SpeechCallbacks, SpeechEngine } from '../dialog/speech.js';

/** Oreo lesson 11-16: the console said "no mic" all lesson while voiced turns came in. The status follows the turns. */
describe('live mic status for the teacher console', () => {
  const mem = new Map<string, string>();
  beforeEach(() => {
    mem.clear();
    resetMicStatusForTest();
    (globalThis as { sessionStorage?: unknown }).sessionStorage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k)
    };
  });
  afterEach(() => {
    delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
  });

  it('a check that ended "none" turns "ok" on the first turn that hears words', () => {
    mem.set(MIC_STATUS_KEY, 'none');
    noteMicTurn(true, 1_000);
    expect(mem.get(MIC_STATUS_KEY)).toBe('ok');
  });

  it('a refused or missing mic is "none" with the browser code kept; a cut (aborted) changes nothing', () => {
    noteMicTurn(true, 1_000);
    noteMicIssue('aborted', 'aborted', 2_000);
    expect(mem.get(MIC_STATUS_KEY)).toBe('ok');
    noteMicIssue('network', 'network', 2_500);
    expect(mem.get(MIC_STATUS_KEY)).toBe('ok');
    noteMicIssue('denied', 'audio-capture', 3_000);
    expect(mem.get(MIC_STATUS_KEY)).toBe('none');
    expect(readMicIssue()).toEqual({ issue: 'denied', raw: 'audio-capture', at: 3_000 });
    expect(mem.get(MIC_ISSUE_KEY)).toBe('denied:audio-capture|3000');
  });

  it('a silent turn right after one that heard words stays "ok"; a minute later it is "quiet"', () => {
    noteMicTurn(true, 10_000);
    noteMicTurn(false, 30_000);
    expect(mem.get(MIC_STATUS_KEY)).toBe('ok');
    noteMicIssue('no_speech', 'no-speech', 80_000);
    expect(mem.get(MIC_STATUS_KEY)).toBe('quiet');
  });

  it('the mic controller writes it from real turns (heard words, then a refused mic with its code)', () => {
    let cb: SpeechCallbacks | null = null;
    const engine: SpeechEngine = {
      source: 'browser',
      interimIsText: true,
      availability: () => ({ ok: true }),
      start(c: SpeechCallbacks) {
        cb = c;
        return { stop: () => c.onEnd({ transcript: 'my name is Ariel', confidence: 0.9 }), abort() {} };
      }
    } as unknown as SpeechEngine;
    const c = new MicController(engine, { onView() {}, onFinal() {}, onIssue() {} });
    c.tap();
    c.tap();
    expect(mem.get(MIC_STATUS_KEY)).toBe('ok');
    c.tap();
    cb!.onError('denied', 'not-allowed');
    expect(mem.get(MIC_STATUS_KEY)).toBe('none');
    expect(readMicIssue()?.raw).toBe('not-allowed');
    c.dispose();
  });
});

/** R2627: every mic turn ends sent or lost (with why), so a lesson with two answers in 25 minutes can be read. */
describe('mic turn count (lcw.micTurns)', () => {
  const mem = new Map<string, string>();
  beforeEach(() => {
    mem.clear();
    resetMicStatusForTest();
    (globalThis as { sessionStorage?: unknown }).sessionStorage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k)
    };
  });
  afterEach(() => {
    delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
  });

  function engineOf(script: Array<'words' | 'nothing' | 'denied' | 'open'>) {
    let i = 0;
    return {
      source: 'browser',
      interimIsText: true,
      availability: () => ({ ok: true }),
      start(c: SpeechCallbacks) {
        const step = script[i++];
        if (step === 'denied') queueMicrotask(() => c.onError('denied', 'not-allowed'));
        return {
          stop: () => {
            if (step === 'words') c.onEnd({ transcript: 'I like soccer', confidence: 0.9 });
            if (step === 'nothing') c.onEnd(null);
          },
          abort() {}
        };
      }
    } as unknown as SpeechEngine;
  }

  it('the controller counts starts and the turns that ended with nothing; the panel counts the sent ones', async () => {
    const c = new MicController(engineOf(['words', 'nothing', 'denied', 'open']), { onView() {}, onFinal() {}, onIssue() {} });
    c.tap();
    c.tap(); // words → the panel sends it
    noteTurnSent();
    c.tap();
    c.tap(); // nothing heard
    c.tap(); // refused
    await Promise.resolve();
    c.tap(); // open when the window closes
    c.dispose();
    const t = readMicTurns();
    expect(t).toMatchObject({ started: 4, sent: 1, lost: 3, lastLost: { cause: 'closed' } });
    expect(t.started).toBe(t.sent + t.lost);
  });

  it('same key and format on both sides (the lesson poll sends it as is)', () => {
    noteTurnLost('submit_failed', 1794816185609);
    expect(mem.get(MIC_TURNS_KEY)).toBe('0.0.1|submit_failed:1794816185609');
    expect(MIC_TURNS_RE.test(mem.get(MIC_TURNS_KEY)!)).toBe(true);
    expect(readLessonMicTurns()).toBe('0.0.1|submit_failed:1794816185609');
    noteTurnLost('Bad Cause!', 1794816185610);
    expect(readMicTurns().lastLost).toEqual({ cause: 'other', at: 1794816185610 });
  });
});
