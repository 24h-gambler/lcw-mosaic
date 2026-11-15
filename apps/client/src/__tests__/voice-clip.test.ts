/**
 * Voice clips on the device (edge voice.ts, @lcw/audio clip-recorder): the dialog records the spoken turn only when
 * asked (voice_store on), hands the clip to the submit, and the submit uploads it once, only when the server
 * answered with `audio_upload`. Recognition always wins: a mic refusal stops recording on this device.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ClipRecorder } from '@lcw/audio';
import { MicController, type Clock } from '../dialog/mic-controller.js';
import type { SpeechCallbacks, SpeechEngine } from '../dialog/speech.js';
import { audioUploadOf, createLessonSubmit, createSoloSubmitWith, lessonBody } from '../dialog/submit.js';
import { recordClipFor } from '../App.js';
import type { UtteranceSubmit } from '../dialog/types.js';

function fakeClock(): Clock & { advance(ms: number): void } {
  let t = 0;
  const timers: Array<{ every: number; next: number; fn: () => void; on: boolean }> = [];
  return {
    now: () => t,
    every(ms, fn) {
      const h = { every: ms, next: t + ms, fn, on: true };
      timers.push(h);
      return () => void (h.on = false);
    },
    advance(ms) {
      const end = t + ms;
      while (t < end) {
        t += 10;
        for (const h of timers)
          if (h.on && t >= h.next) {
            h.next += h.every;
            h.fn();
          }
      }
    }
  };
}

function engine(say: string | null) {
  let cb: SpeechCallbacks | null = null;
  const e: SpeechEngine = {
    source: 'browser',
    availability: () => ({ ok: true }),
    start(c) {
      cb = c;
      return { stop: () => cb?.onEnd(say ? { transcript: say, confidence: 0.9 } : null), abort: () => undefined };
    }
  };
  return { e, cb: () => cb! };
}

function recorder() {
  const log: string[] = [];
  const blob = new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4, 5, 6, 7, 8])], { type: 'audio/webm' });
  const r: ClipRecorder = {
    start: () => void log.push('start'),
    stop: () => {
      log.push('stop');
      return Promise.resolve(blob);
    },
    abort: () => void log.push('abort')
  };
  return { r, log, blob };
}

const u: UtteranceSubmit = {
  target_text: 'Can I have a tea?',
  transcript: 'can i have a tea',
  chosen_stars: 1,
  hint_level: 'none',
  latency_ms: 500,
  dur_ms: 1500,
  stt_source: 'browser',
  confidence: 0.9
};
const OFFER = { token: 'a'.repeat(48), max_bytes: 262144, expires_at: Date.now() + 600_000 };

describe('voice clip on the device', () => {
  it('records alongside recognition and hands the clip over only when something was heard', async () => {
    const clock = fakeClock();
    const heard = engine('can i have a tea');
    const rec = recorder();
    const finals: Array<{ t: string | null; clip?: Promise<Blob | null> }> = [];
    const c = new MicController(heard.e, { onView: () => {}, onFinal: (r, _d, clip) => finals.push({ t: r?.transcript ?? null, clip }), onIssue: () => {} }, clock, rec.r);
    c.tap();
    heard.cb().onInterim('can i');
    clock.advance(300);
    c.tap();
    expect(rec.log).toEqual(['start', 'stop']);
    expect(finals[0]!.t).toBe('can i have a tea');
    expect(await finals[0]!.clip).toBe(rec.blob);

    const silent = engine(null);
    const rec2 = recorder();
    const finals2: Array<{ t: string | null; clip?: Promise<Blob | null> }> = [];
    const c2 = new MicController(silent.e, { onView: () => {}, onFinal: (r, _d, clip) => finals2.push({ t: r?.transcript ?? null, clip }), onIssue: () => {} }, clock, rec2.r);
    c2.tap();
    clock.advance(200);
    c2.tap();
    expect(finals2).toEqual([{ t: null, clip: undefined }]);
  });

  it('a recognition error drops the clip; closing the panel drops it too', () => {
    const clock = fakeClock();
    const m = engine('x');
    const rec = recorder();
    const issues: string[] = [];
    const c = new MicController(m.e, { onView: () => {}, onFinal: () => {}, onIssue: (i) => issues.push(i) }, clock, rec.r);
    c.tap();
    m.cb().onError('denied');
    expect(issues).toEqual(['denied']);
    expect(rec.log).toEqual(['start', 'abort']);
    c.tap();
    c.dispose();
    expect(rec.log).toEqual(['start', 'abort', 'start', 'abort']);
  });

  it('without a recorder nothing changes (no clip argument)', () => {
    const clock = fakeClock();
    const m = engine('hello');
    const seen: unknown[][] = [];
    const c = new MicController(m.e, { onView: () => {}, onFinal: (...a) => seen.push(a), onIssue: () => {} }, clock);
    c.tap();
    clock.advance(100);
    c.tap();
    expect(seen[0]).toHaveLength(2);
  });

  it('solo and lesson submits upload the clip once, only when the server asked; the clip never rides in the body', async () => {
    const calls: Array<{ url: string; body: unknown; type: string | null }> = [];
    const answer = (withUpload: boolean) =>
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, body: init?.body, type: new Headers(init?.headers).get('content-type') });
        if (url.includes('/v1/voice/upload/')) return new Response('{"ok":true}', { status: 201 });
        return new Response(JSON.stringify({ pass: true, score: 1, stars: 1, missed: [], feedback_ko: 'ok', granted: null, memory_card: null, ...(withUpload ? { audio_upload: OFFER } : {}) }));
      });
    const blob = new Blob([new Uint8Array(20)], { type: 'audio/webm' });
    const solo = createSoloSubmitWith({ token: 't', npc: { id: 'n', ctx: 'cafe' } as never, fetchImpl: answer(true) as unknown as typeof fetch });
    await solo({ ...u, clip: Promise.resolve(blob) });
    await new Promise((r) => setTimeout(r, 0));
    expect(calls.map((c) => c.url)).toEqual(['/v1/converse/score', `/v1/voice/upload/${OFFER.token}`]);
    expect(String(calls[0]!.body)).not.toContain('clip');
    expect(calls[1]!.body).toBe(blob);
    expect(calls[1]!.type).toBe('audio/webm');

    calls.length = 0;
    await createSoloSubmitWith({ token: 't', npc: { id: 'n', ctx: 'cafe' } as never, fetchImpl: answer(false) as unknown as typeof fetch })({ ...u, clip: Promise.resolve(blob) });
    await new Promise((r) => setTimeout(r, 0));
    expect(calls.map((c) => c.url)).toEqual(['/v1/converse/score']);

    calls.length = 0;
    await createLessonSubmit({ token: 't', fetchImpl: answer(true) as unknown as typeof fetch })({ ...u, clip: Promise.resolve(blob) });
    await new Promise((r) => setTimeout(r, 0));
    expect(calls.map((c) => c.url)).toEqual(['/v1/lesson/utterance', `/v1/voice/upload/${OFFER.token}`]);
    expect(Object.keys(JSON.parse(String(calls[0]!.body)))).not.toContain('clip');
    expect(lessonBody({ ...u, clip: Promise.resolve(null) })).not.toHaveProperty('clip');
  });

  it('only a well-formed upload offer is used', () => {
    expect(audioUploadOf({ audio_upload: OFFER })).toEqual(OFFER);
    expect(audioUploadOf({ audio_upload: { ...OFFER, token: 'x' } })).toBeNull();
    expect(audioUploadOf({})).toBeNull();
  });

  it('records in a lesson by the /v1/join answer, at home by the device consent, never as a guest', () => {
    const kv = (m: Record<string, string>) => ({ getItem: (k: string) => m[k] ?? null });
    const child = { kind: 'child', token: 't', nickname: 'J', level: 'L2', voiceStore: true, offline: false, playAllowed: true, seat: null } as never;
    const childOff = { kind: 'child', token: 't', nickname: 'J', level: 'L2', voiceStore: false, offline: false, playAllowed: true, seat: null } as never;
    expect(recordClipFor(child, kv({}))).toBe(true);
    expect(recordClipFor(childOff, kv({}))).toBe(false);
    expect(recordClipFor(null, kv({}))).toBe(false);
    expect(recordClipFor(child, kv({ 'lcw.studentToken': 's' }))).toBe(false);
    expect(recordClipFor(null, kv({ 'lcw.studentToken': 's', 'lcw.studentVoice': '1' }))).toBe(true);
  });
});
