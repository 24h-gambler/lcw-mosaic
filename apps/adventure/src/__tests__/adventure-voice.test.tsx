import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SpeechCallbacks, SpeechEngine } from '../../../client/src/dialog/speech.js';
import { cleanCode, joinWithCode } from '../audio/join.js';
import { Listener, endOf, listenState, setSpeechEngineFactory } from '../audio/listen.js';
import { Speak } from '../ui/Speak.js';
import { S } from '../ui/strings.js';

/** A fake engine in place of the LCW server Whisper engine: availability and what one turn ends with. */
function fakeEngine(avail: ReturnType<SpeechEngine['availability']>, run?: (cb: SpeechCallbacks) => void): SpeechEngine {
  return {
    source: 'workers_ai',
    interimIsText: false,
    stopGraceMs: 10,
    availability: () => avail,
    start(cb) {
      run?.(cb);
      return { stop() {}, abort() {} };
    }
  };
}

function withStorage(session: Record<string, string>, local: Record<string, string>) {
  const mk = (m: Record<string, string>) => ({
    getItem: (k: string) => (k in m ? m[k]! : null),
    setItem: (k: string, v: string) => void (m[k] = v),
    removeItem: (k: string) => void delete m[k]
  });
  vi.stubGlobal('sessionStorage', mk(session));
  vi.stubGlobal('localStorage', mk(local));
}

afterEach(() => {
  setSpeechEngineFactory(null);
  vi.unstubAllGlobals();
});

describe('A04 voice: the LCW server Whisper path and the class code', () => {
  it('the default engine is the LCW dialog server engine (no browser recognition): with no recorder the mic is off', () => {
    withStorage({}, {});
    expect(listenState()).toBe('unsupported');
  });

  it('no token but a recorder: the page asks for the class code instead of going quiet to typing', () => {
    withStorage({}, {});
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: () => Promise.resolve({}) } });
    vi.stubGlobal('MediaRecorder', function MediaRecorder() {});
    setSpeechEngineFactory(() => fakeEngine({ ok: false, issue: 'unsupported' }));
    expect(listenState()).toBe('need_code');
    const html = renderToStaticMarkup(<Speak help={true} placeholder="Type here" onAnswer={() => {}} />);
    expect(html).toContain('data-testid="adv-join"');
    expect(html).toContain('data-testid="adv-join-code"');
    expect(html).toContain('inputMode="numeric"');
    expect(html).toContain(S.joinTitle.en);
    expect(html).not.toContain('data-testid="adv-mic"');
    // typing stays one tap away, not forced
    expect(html).toContain('data-testid="adv-type-open"');
  });

  it('a token in this tab (lesson) or a linked device: the mic is on', () => {
    withStorage({ 'lcw.studentToken': 't' }, {});
    setSpeechEngineFactory(() => fakeEngine({ ok: true }));
    expect(listenState()).toBe('ok');
    const html = renderToStaticMarkup(<Speak help={false} placeholder="Type here" onAnswer={() => {}} />);
    expect(html).toContain('data-testid="adv-mic"');
    expect(html).not.toContain('data-testid="adv-join"');
  });

  it('a refused microphone is remembered and turns the mic off', () => {
    withStorage({}, {});
    expect(endOf('denied')).toEqual({ kind: 'denied' });
    setSpeechEngineFactory(() => fakeEngine({ ok: true }));
    expect(listenState()).toBe('unsupported');
  });

  it('what a failed turn means: say it again (quiet, not understood, slow upload), typing (no mic, resting meter)', () => {
    withStorage({ 'lcw.studentToken': 't' }, {});
    expect(endOf('no_speech').kind).toBe('silent');
    expect(endOf('stt_failed').kind).toBe('retry');
    expect(endOf('network').kind).toBe('retry');
    expect(endOf('quota').kind).toBe('quota');
    expect(endOf('unsupported').kind).toBe('unsupported');
    withStorage({}, {});
    expect(endOf('unsupported').kind).toBe('need_code');
  });

  it('a heard turn gives the transcript; a server error asks to say it again', () => {
    withStorage({ 'lcw.studentToken': 't' }, {});
    setSpeechEngineFactory(() => fakeEngine({ ok: true }, (cb) => cb.onEnd({ transcript: ' The eagle can fly. ', confidence: 0.8 })));
    const got: unknown[] = [];
    new Listener().start(() => {}, (r) => got.push(r));
    setSpeechEngineFactory(() => fakeEngine({ ok: true }, (cb) => cb.onError('stt_failed', 'http_502')));
    new Listener().start(() => {}, (r) => got.push(r));
    expect(got).toEqual([{ kind: 'heard', alternatives: ['The eagle can fly.'] }, { kind: 'retry' }]);
  });

  it('the class code goes to the same /v1/join as LCW and is kept under the same session keys', async () => {
    const session: Record<string, string> = {};
    withStorage(session, {});
    expect(cleanCode(' 26-25 68x9')).toBe('262568');
    const calls: Array<{ url: string; body: string }> = [];
    const ok = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: String(init.body) });
      return new Response(JSON.stringify({ student_token: 'tok', lesson_id: 'les-1', player_id: 'p', nickname: 'Oreo', level: 'L2', voice_store: false }), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await joinWithCode('262568', ok)).toEqual({ ok: true, nickname: 'Oreo' });
    expect(calls).toEqual([{ url: '/v1/join', body: '{"code":"262568"}' }]);
    expect(session['lcw.studentToken']).toBe('tok');
    expect(session['lcw.studentLessonId']).toBe('les-1');
    expect(session['lcw.studentLevel']).toBe('L2');
    const status = (n: number) => (async () => new Response('{}', { status: n })) as unknown as typeof fetch;
    expect(await joinWithCode('12345', ok)).toEqual({ ok: false, reason: 'format' });
    expect(await joinWithCode('000000', status(404))).toEqual({ ok: false, reason: 'invalid' });
    expect(await joinWithCode('000000', status(429))).toEqual({ ok: false, reason: 'busy' });
    expect(await joinWithCode('000000', (async () => Promise.reject(new Error('x'))) as unknown as typeof fetch)).toEqual({ ok: false, reason: 'network' });
  });
});
