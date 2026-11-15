import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LessonListen, listenErrorText } from '../LessonListen.js';
import { LessonAudioBox, publishErrorText } from '../LessonAudioBox.js';
import { listenLessonAudio, publishLessonAudio, type ListenState, type PublishState, type RtcEnv } from '../lessonAudio.js';
import { PARENT_STRINGS_KO } from '../parentStrings.js';
import { LESSON_AUDIO_STRINGS_KO as A } from '../lessonAudioStrings.js';

const W = PARENT_STRINGS_KO.window;

class FakeTrack {
  stopped = false;
  constructor(readonly kind = 'audio') {}
  stop() {
    this.stopped = true;
  }
}
class FakeStream {
  tracks: FakeTrack[] = [];
  constructor(t: FakeTrack[] = []) {
    this.tracks = [...t];
  }
  getTracks() {
    return [...this.tracks];
  }
  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === 'audio');
  }
  addTrack(t: FakeTrack) {
    this.tracks.push(t);
  }
  removeTrack(t: FakeTrack) {
    this.tracks = this.tracks.filter((x) => x !== t);
  }
}
const pcs: FakePc[] = [];
class FakePc {
  transceivers: Array<{ direction: string; mid: string | null; track?: FakeTrack }> = [];
  localDescription: { type: string; sdp: string } | null = null;
  remote: { type: string; sdp: string } | null = null;
  connectionState = 'new';
  closed = false;
  listeners: Record<string, Array<(e: any) => void>> = {};
  constructor(readonly config: RTCConfiguration) {
    pcs.push(this);
  }
  sent = 0;
  async getStats() {
    return new Map([['o', { type: 'outbound-rtp', bytesSent: this.sent }]]);
  }
  addTransceiver(track: FakeTrack, init: { direction: string }) {
    const t = {
      direction: init.direction,
      mid: null as string | null,
      track,
      sender: { track, replaceTrack: async (x: FakeTrack) => void (t.sender.track = x) }
    };
    this.transceivers.push(t);
    return t;
  }
  getTransceivers() {
    return this.transceivers;
  }
  async createOffer() {
    return { type: 'offer', sdp: this.transceivers.map((t) => `m=audio\na=${t.direction}`).join('\n') };
  }
  async createAnswer() {
    return { type: 'answer', sdp: this.transceivers.map((t) => `m=audio\na=${t.direction}`).join('\n') };
  }
  async setLocalDescription(d: { type: string; sdp: string }) {
    this.localDescription = d;
    this.transceivers.forEach((t, i) => (t.mid = String(i)));
  }
  async setRemoteDescription(d: { type: string; sdp: string }) {
    this.remote = d;
    if (d.type === 'offer') {
      // The SFU's offer brings one send-only audio transceiver and its track.
      const t = { direction: 'sendrecv', mid: '0', track: new FakeTrack() };
      this.transceivers.push(t);
      for (const f of this.listeners.track ?? []) f({ track: t.track });
    }
  }
  addEventListener(k: string, f: (e: any) => void) {
    (this.listeners[k] ??= []).push(f);
  }
  close() {
    this.closed = true;
  }
}

function env(withMic = true) {
  const gum: MediaStreamConstraints[] = [];
  const timers: Array<() => void> = [];
  const e: RtcEnv = {
    RTCPeerConnection: FakePc as never,
    MediaStream: FakeStream as never,
    ...(withMic
      ? {
          getUserMedia: async (c: MediaStreamConstraints) => {
            gum.push(c);
            return new FakeStream([new FakeTrack()]) as never;
          }
        }
      : {}),
    setInterval: ((f: () => void) => {
      timers.push(f);
      return timers.length as never;
    }) as never,
    clearInterval: (() => undefined) as never
  };
  return { e, gum, timers };
}

function fakeApi() {
  const calls: Array<[string, ...unknown[]]> = [];
  let live = true;
  return {
    calls,
    end: () => (live = false),
    api: {
      audioIce: async (...a: unknown[]) => (calls.push(['ice', ...a]), { ice_servers: [{ urls: ['stun:stun.cloudflare.com:3478'] }] }),
      audioPublish: async (...a: unknown[]) => (calls.push(['publish', ...a]), { sdp: 'm=audio\na=recvonly', stream_id: 'lesson-1' }),
      audioBeat: async (...a: unknown[]) => (calls.push(['beat', ...a]), { live, listeners: live ? 2 : 0 }),
      audioStop: async (...a: unknown[]) => (calls.push(['stop', ...a]), { ok: true, listeners_closed: 0 }),
      listenStart: async (...a: unknown[]) => (
        calls.push(['listenStart', ...a]), { listener_id: 'a'.repeat(24), sdp: 'm=audio\na=sendonly', ice_servers: [], stream_id: 'lesson-1' }
      ),
      listenAnswer: async (...a: unknown[]) => (calls.push(['listenAnswer', ...a]), { ok: true }),
      listenStop: async (...a: unknown[]) => (calls.push(['listenStop', ...a]), { ok: true })
    }
  };
}

const fakeAudio = () => {
  const el = { srcObject: null as unknown, autoplay: false, plays: 0, volume: 1, play: async () => void el.plays++ };
  return el;
};

describe('teacher publisher (one send-only audio track)', () => {
  it('mic → send-only transceiver → offer with its mid → answer applied → beats report listeners', async () => {
    pcs.length = 0;
    const { e, gum, timers } = env();
    const f = fakeApi();
    const states: PublishState[] = [];
    const pub = await publishLessonAudio({ api: f.api as never, op: 'op', lessonId: 'L1', env: e, onState: (s) => states.push(s) });
    expect(gum).toHaveLength(1);
    expect(gum[0]).toMatchObject({ audio: { echoCancellation: true }, video: false });
    const pc = pcs[0]!;
    expect(pc.transceivers).toEqual([expect.objectContaining({ direction: 'sendonly', mid: '0' })]);
    expect(f.calls.find((c) => c[0] === 'publish')).toEqual(['publish', 'op', 'L1', { sdp: 'm=audio\na=sendonly', mid: '0' }]);
    expect(pc.remote).toEqual({ type: 'answer', sdp: 'm=audio\na=recvonly' });
    expect(states.at(-1)).toEqual({ state: 'live', listeners: 0, streamId: 'lesson-1' });
    timers[0]!();
    await new Promise((r) => setTimeout(r, 0));
    expect(states.at(-1)).toEqual({ state: 'live', listeners: 2, streamId: 'lesson-1' });
    await pub.stop();
    expect(pc.closed).toBe(true);
    expect(f.calls.at(-1)![0]).toBe('stop');
    expect(states.at(-1)).toEqual({ state: 'stopped' });
  });

  it('second input mixes into the same track; the server ending the lesson stops it; denied mic says so', async () => {
    pcs.length = 0;
    const { e, gum, timers } = env();
    const f = fakeApi();
    const states: PublishState[] = [];
    await publishLessonAudio({ api: f.api as never, op: 'op', lessonId: 'L1', micId: 'm1', secondId: 'line2', env: e, onState: (s) => states.push(s) });
    expect(gum.map((g) => (g.audio as any).deviceId)).toEqual([{ exact: 'm1' }, { exact: 'line2' }]);
    expect((gum[1]!.audio as any).echoCancellation).toBe(false);
    // no AudioContext in this env → the first input is sent; still exactly one transceiver
    expect(pcs[0]!.transceivers).toHaveLength(1);
    f.end();
    timers[0]!();
    await new Promise((r) => setTimeout(r, 0));
    expect(states.at(-1)).toEqual({ state: 'stopped' });

    const denied = env();
    denied.e.getUserMedia = async () => {
      throw Object.assign(new Error('x'), { name: 'NotAllowedError' });
    };
    const s2: PublishState[] = [];
    await publishLessonAudio({ api: f.api as never, op: 'op', lessonId: 'L1', env: denied.e, onState: (s) => s2.push(s) });
    expect(s2.at(-1)).toEqual({ state: 'failed', error: 'mic_denied' });
    expect(publishErrorText('mic_denied')).toBe(A.micDenied);
  });
});

class FakeNode {
  connect<T>(n: T) {
    return n;
  }
  gain = { value: 1 };
  fftSize = 0;
  getByteTimeDomainData(b: Uint8Array) {
    b.fill(128);
  }
}
class FakeAudioContext {
  static mixTrack = new FakeTrack();
  async resume() {}
  async close() {}
  createAnalyser() {
    return new FakeNode();
  }
  createGain() {
    return new FakeNode();
  }
  createMediaStreamSource() {
    return new FakeNode();
  }
  createMediaStreamDestination() {
    return { stream: new FakeStream([FakeAudioContext.mixTrack]) };
  }
}

describe('two inputs: one mixed track, with a fallback when the mix sends nothing', () => {
  it('mixes into one track; if the first beat finds 0 bytes sent, swaps in the teacher mic and says so', async () => {
    pcs.length = 0;
    const { e, timers } = env();
    e.AudioContext = FakeAudioContext as never;
    const f = fakeApi();
    const states: PublishState[] = [];
    await publishLessonAudio({ api: f.api as never, op: 'op', lessonId: 'L1', secondId: 'line2', env: e, onState: (s) => states.push(s) });
    const t = pcs[0]!.transceivers[0] as any;
    expect(t.sender.track).toBe(FakeAudioContext.mixTrack);
    timers[0]!();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(t.sender.track).not.toBe(FakeAudioContext.mixTrack);
    expect(states.at(-1)).toEqual({ state: 'live', listeners: 2, streamId: 'lesson-1', mixFallback: true });
  });

  it('a mix that sends keeps the mixed track', async () => {
    pcs.length = 0;
    const { e, timers } = env();
    e.AudioContext = FakeAudioContext as never;
    const f = fakeApi();
    const states: PublishState[] = [];
    await publishLessonAudio({ api: f.api as never, op: 'op', lessonId: 'L1', secondId: 'line2', env: e, onState: (s) => states.push(s) });
    pcs[0]!.sent = 5000;
    timers[0]!();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect((pcs[0]!.transceivers[0] as any).sender.track).toBe(FakeAudioContext.mixTrack);
    expect(states.at(-1)).toEqual({ state: 'live', listeners: 2, streamId: 'lesson-1' });
  });

  it('one input sends the mic track itself even with WebAudio available (meter only)', async () => {
    pcs.length = 0;
    const { e } = env();
    e.AudioContext = FakeAudioContext as never;
    await publishLessonAudio({ api: fakeApi().api as never, op: 'op', lessonId: 'L1', env: e, onState: () => undefined });
    expect((pcs[0]!.transceivers[0] as any).sender.track).not.toBe(FakeAudioContext.mixTrack);
  });
});

describe('guardian listener (receive-only)', () => {
  it('pulls, forces recvonly, answers, plays the incoming track; stop hangs up', async () => {
    pcs.length = 0;
    const { e, gum } = env();
    const f = fakeApi();
    const audio = fakeAudio();
    const states: ListenState[] = [];
    const l = await listenLessonAudio({ api: f.api as never, guardian: 'g', playerId: 'kid-1', audio: audio as never, env: e, onState: (s) => states.push(s) });
    const pc = pcs[0]!;
    expect(pc.transceivers.every((t) => t.direction === 'recvonly')).toBe(true);
    expect(f.calls.find((c) => c[0] === 'listenAnswer')).toEqual(['listenAnswer', 'g', 'kid-1', 'a'.repeat(24), 'm=audio\na=recvonly']);
    expect((audio.srcObject as FakeStream).getTracks()).toHaveLength(1);
    expect(audio.plays).toBeGreaterThan(0);
    expect(states.at(-1)).toEqual({ state: 'listening', listenerId: 'a'.repeat(24), streamId: 'lesson-1' });
    expect(gum).toHaveLength(0);
    await l.stop();
    expect(pc.closed).toBe(true);
    expect(f.calls.at(-1)).toEqual(['listenStop', 'g', 'kid-1', 'a'.repeat(24)]);
  });

  it('a refused start surfaces the server code and leaves nothing open', async () => {
    pcs.length = 0;
    const { e } = env();
    const f = fakeApi();
    f.api.listenStart = async () => {
      throw Object.assign(new Error('no_teacher_stream'), { code: 'no_teacher_stream' });
    };
    const states: ListenState[] = [];
    await listenLessonAudio({ api: f.api as never, guardian: 'g', playerId: 'kid-1', audio: fakeAudio() as never, env: e, onState: (s) => states.push(s) });
    expect(states.at(-1)).toEqual({ state: 'failed', error: 'no_teacher_stream' });
    expect(pcs).toHaveLength(0);
    expect(listenErrorText('no_teacher_stream')).toBe(W.audioNoStream);
  });

  it('the guardian pages never ask for a microphone or camera', () => {
    for (const f of ['../LessonListen.tsx', '../LessonWindowPage.tsx']) {
      const src = readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8');
      expect(src).not.toMatch(/getUserMedia\s*\(|getDisplayMedia\s*\(|<video[\s>/]/);
    }
    // the listen path of lessonAudio.ts has no getUserMedia either
    const lib = readFileSync(fileURLToPath(new URL('../lessonAudio.ts', import.meta.url)), 'utf8');
    const listenPart = lib.slice(lib.indexOf('/* ---------------- guardian: listen'));
    expect(listenPart).not.toMatch(/getUserMedia\s*\(/);
  });
});

describe('screens', () => {
  const audio = (over: Partial<{ available: boolean; reason: string | null }> = {}) => ({
    direction: 'recvonly' as const,
    available: true,
    reason: null,
    stream_id: 'lesson-1',
    listener: null,
    ...over
  });
  const { e } = env();
  const listen = (a: ReturnType<typeof audio>, rtc: RtcEnv | null = e) =>
    renderToStaticMarkup(React.createElement(LessonListen, { api: {} as never, guardian: 'g', playerId: 'kid-1', audio: a, onListener: () => undefined, env: rtc }));

  it('window: a start button when the teacher sends; text-only notes otherwise; privacy line always', () => {
    let html = listen(audio());
    expect(html).toContain(W.audioStart);
    expect(html).toContain(W.audioPrivacy);
    expect(html).not.toContain('controls');
    html = listen(audio({ available: false, reason: 'no_teacher_stream' }));
    expect(html).toContain(W.audioNoStream);
    expect(html).not.toContain(W.audioStart);
    expect(listen(audio({ available: false, reason: 'realtime_not_configured' }))).toContain(W.audioOff);
    expect(listen(audio(), null)).toContain(W.audioUnsupported);
  });

  it('console: mic and optional student input, start button', () => {
    const html = renderToStaticMarkup(React.createElement(LessonAudioBox, { token: 'op', lessonId: 'L1', disabled: false, env: e, listDevices: async () => [] }));
    expect(html).toContain(A.title);
    expect(html).toContain(A.micLabel);
    expect(html).toContain(A.secondNone);
    expect(html).toContain(A.start);
  });
});
