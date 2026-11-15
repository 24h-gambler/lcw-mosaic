import { describe, expect, it } from 'vitest';
import { CLIP_BITS_PER_SECOND, CLIP_OFF_KEY, createMediaClipRecorder, pickClipMime, turnClipRecordingOff, uploadClip } from '../clip-recorder.js';

class FakeTrack {
  stopped = false;
  stop() {
    this.stopped = true;
  }
}
function fakeEnv(opts: { types?: string[]; failMic?: boolean } = {}) {
  const tracks: FakeTrack[] = [];
  const made: Array<{ opts: unknown }> = [];
  let resolveMic: ((s: unknown) => void) | null = null;
  const types = opts.types ?? ['audio/webm;codecs=opus'];
  class Rec {
    state = 'inactive';
    ondataavailable: ((ev: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    constructor(_s: unknown, o: unknown) {
      made.push({ opts: o });
    }
    static isTypeSupported(t: string) {
      return types.includes(t);
    }
    start() {
      this.state = 'recording';
    }
    stop() {
      this.state = 'inactive';
      this.ondataavailable?.({ data: new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 9, 9])]) });
      this.onstop?.();
    }
  }
  const store = new Map<string, string>();
  return {
    tracks,
    made,
    store,
    release: () => resolveMic?.({ getTracks: () => tracks }),
    env: {
      getUserMedia: (_c: MediaStreamConstraints) => {
        if (opts.failMic) return Promise.reject(new Error('NotAllowedError'));
        tracks.push(new FakeTrack());
        return new Promise<MediaStream>((r) => {
          resolveMic = r as (s: unknown) => void;
        });
      },
      MediaRecorder: Rec as never,
      storage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) },
      setTimer: () => 0,
      clearTimer: () => undefined
    }
  };
}

describe('clip recorder (voice_store replay)', () => {
  it('prefers Opus in WebM, then Ogg, then MP4 (Safari)', () => {
    expect(pickClipMime((t) => ['audio/mp4', 'audio/webm;codecs=opus'].includes(t))).toBe('audio/webm;codecs=opus');
    expect(pickClipMime((t) => t === 'audio/mp4')).toBe('audio/mp4');
    expect(pickClipMime(() => false)).toBeNull();
  });

  it('records one turn at 24 kbps and releases the mic', async () => {
    const f = fakeEnv();
    const r = createMediaClipRecorder(f.env)!;
    r.start();
    f.release();
    const blob = await r.stop();
    expect(blob?.type).toBe('audio/webm');
    expect(blob?.size).toBe(6);
    expect(f.made[0]!.opts).toMatchObject({ mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: CLIP_BITS_PER_SECOND });
    expect(f.tracks.every((t) => t.stopped)).toBe(true);
  });

  it('abort before the mic opened releases it and yields nothing', async () => {
    const f = fakeEnv();
    const r = createMediaClipRecorder(f.env)!;
    r.start();
    r.abort();
    f.release();
    await new Promise((res) => setTimeout(res, 0));
    expect(f.tracks.every((t) => t.stopped)).toBe(true);
    expect(await r.stop()).toBeNull();
  });

  it('a refused mic just means no clip; unsupported browsers and devices switched off get no recorder', async () => {
    const r = createMediaClipRecorder(fakeEnv({ failMic: true }).env)!;
    r.start();
    expect(await r.stop()).toBeNull();
    expect(createMediaClipRecorder({ ...fakeEnv({ types: [] }).env })).toBeNull();
    expect(createMediaClipRecorder({ getUserMedia: undefined, MediaRecorder: undefined, storage: null })).toBeNull();
    const off = fakeEnv();
    turnClipRecordingOff(off.env.storage);
    expect(off.store.get(CLIP_OFF_KEY)).toBe('1');
    expect(createMediaClipRecorder(off.env)).toBeNull();
  });

  it('uploads once, and never an empty, oversize or expired clip', async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: string) => {
      urls.push(url);
      return new Response('{}', { status: 201 });
    }) as unknown as typeof fetch;
    const offer = { token: 'b'.repeat(48), max_bytes: 10, expires_at: 2_000 };
    const now = () => 1_000;
    expect(await uploadClip(offer, Promise.resolve(new Blob([new Uint8Array(5)], { type: 'audio/webm' })), { fetchImpl, nowMs: now })).toBe(true);
    expect(await uploadClip(offer, Promise.resolve(new Blob([new Uint8Array(11)])), { fetchImpl, nowMs: now })).toBe(false);
    expect(await uploadClip(offer, Promise.resolve(null), { fetchImpl, nowMs: now })).toBe(false);
    expect(await uploadClip(offer, Promise.resolve(new Blob([new Uint8Array(5)])), { fetchImpl, nowMs: () => 3_000 })).toBe(false);
    expect(await uploadClip(offer, undefined, { fetchImpl, nowMs: now })).toBe(false);
    expect(urls).toEqual([`/v1/voice/upload/${'b'.repeat(48)}`]);
  });
});
