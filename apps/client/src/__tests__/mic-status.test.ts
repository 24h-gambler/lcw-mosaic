import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MicController } from '../dialog/mic-controller.js';
import { MIC_ISSUE_KEY, MIC_STATUS_KEY, noteMicIssue, noteMicTurn, readMicIssue, resetMicStatusForTest } from '../dialog/mic-status.js';
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
