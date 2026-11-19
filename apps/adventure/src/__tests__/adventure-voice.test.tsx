import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SpeechCallbacks, SpeechEngine } from '../../../client/src/dialog/speech.js';
import { cleanCode, joinWithCode } from '../audio/join.js';
import { Listener, endOf, listenState, resetListenMemory, setSpeechEngineFactory } from '../audio/listen.js';
import { pingLesson } from '../audio/presence.js';
import { saysWord, startRecord, toActivity, wordsSaid } from '../core/record.js';
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
  resetListenMemory();
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

  it('a refused token (an old lesson tab, 401) asks for the code again, until a new code works; a resting meter is typing for the page', async () => {
    withStorage({ 'lcw.studentToken': 'old' }, {});
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: () => Promise.resolve({}) } });
    vi.stubGlobal('MediaRecorder', function MediaRecorder() {});
    setSpeechEngineFactory(() => fakeEngine({ ok: true }));
    expect(listenState()).toBe('ok');
    expect(endOf('unsupported', 'http_401')).toEqual({ kind: 'need_code' });
    expect(listenState()).toBe('need_code');
    const ok = (async () => new Response(JSON.stringify({ student_token: 'new', lesson_id: 'les-2', player_id: 'p', nickname: '', level: 'L1' }), { status: 200 })) as unknown as typeof fetch;
    expect((await joinWithCode('123456', ok)).ok).toBe(true);
    expect(listenState()).toBe('ok');
    expect(endOf('quota', 'http_429')).toEqual({ kind: 'quota' });
    expect(listenState()).toBe('unsupported');
  });

  it('in a lesson the adventure keeps it open (away=adventure); no token, no call; a refused token asks for the code', async () => {
    withStorage({}, {});
    const calls: Array<{ url: string; auth: string }> = [];
    const answer = (n: number) =>
      (async (url: string, init: RequestInit) => {
        calls.push({ url, auth: String((init.headers as Record<string, string>).authorization) });
        return new Response('{}', { status: n });
      }) as unknown as typeof fetch;
    expect(await pingLesson(answer(200))).toBe('none');
    expect(calls).toEqual([]);
    withStorage({ 'lcw.studentToken': 'tok' }, {});
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: () => Promise.resolve({}) } });
    vi.stubGlobal('MediaRecorder', function MediaRecorder() {});
    setSpeechEngineFactory(() => fakeEngine({ ok: true }));
    expect(await pingLesson(answer(200))).toBe('ok');
    expect(calls[0]).toEqual({ url: '/v1/lesson/state?away=adventure', auth: 'Bearer tok' });
    expect(listenState()).toBe('ok');
    expect(await pingLesson(answer(401))).toBe('refused');
    expect(listenState()).toBe('need_code');
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

  it("a day word inside what the child said counts as caught: an island finished by speaking does not show the day's words as not done", () => {
    expect(saysWord("I'm fine. Thank you.", 'thank you')).toBe(true);
    expect(saysWord('Hello. Nice to meet you.', 'hello')).toBe(true);
    expect(saysWord('Good bye, friend!', 'goodbye')).toBe(true);
    expect(saysWord('thankyou', 'thank you')).toBe(true);
    expect(saysWord('Othello is here', 'hello')).toBe(false);
    expect(saysWord('I thank them', 'thank you')).toBe(false);
    const r = startRecord(1, 1, ['hello', 'goodbye', 'thank you', 'puppy'], 0);
    expect(wordsSaid(r, ['Hello. Nice to meet you.'])).toEqual(['hello']);
    wordsSaid(r, ["I'm fine. Thank you."]);
    wordsSaid(r, ['Hello!']);
    r.endedMs = 60_000;
    r.outcome = 'spared';
    const words = toActivity(r, 60_000).words;
    expect(words.find((w) => w.w === 'hello')).toEqual({ w: 'hello', ok: true, caught: 2, missed: 0 });
    expect(words.find((w) => w.w === 'thank you')).toMatchObject({ ok: true, caught: 1 });
    expect(words.find((w) => w.w === 'goodbye')).toMatchObject({ ok: false, caught: 0 });
  });

  it('every adventure turn goes into the LCW mic-turn ledger (lcw.micTurns), and the lesson ping carries it', async () => {
    const session: Record<string, string> = { 'lcw.studentToken': 'tok' };
    withStorage(session, {});
    setSpeechEngineFactory(() => fakeEngine({ ok: true }, (cb) => cb.onEnd({ transcript: 'Thank you.', confidence: 0.8 })));
    new Listener().start(() => {}, () => {});
    setSpeechEngineFactory(() => fakeEngine({ ok: true }, (cb) => cb.onError('stt_failed', 'http_502')));
    new Listener().start(() => {}, () => {});
    expect(session['lcw.micTurns']).toMatch(/^2\.1\.1\|stt_failed:\d+$/);
    expect(session['lcw.micIssue']).toMatch(/^stt_failed:http_502\|\d+$/);
    const urls: string[] = [];
    await pingLesson((async (url: string) => (urls.push(url), new Response('{}', { status: 200 }))) as unknown as typeof fetch);
    const q = new URLSearchParams(urls[0]!.split('?')[1]);
    expect(q.get('away')).toBe('adventure');
    expect(q.get('mic_turns')).toBe(session['lcw.micTurns']);
    expect(q.get('mic_issue')).toBe(session['lcw.micIssue']);
    expect(q.get('mic')).toBe('ok');
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
