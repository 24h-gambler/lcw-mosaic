/**
 * Live lesson sound over WebRTC (WP-307, docs/12 §9 "보호자 청취", server: apps/edge/src/lesson-audio.ts).
 *
 * - publishLessonAudio (teacher console): the teacher's mic, optionally mixed with a second input that carries the
 *   student (a call app routed through a virtual cable, or a second mic) — "두 채널을 섞어 단방향 전송" — into ONE
 *   send-only audio track. No camera, ever.
 * - listenLessonAudio (guardian window): pulls that track receive-only. This module's listener never touches
 *   getUserMedia; every transceiver is forced to recvonly before answering, and the server refuses any answer that
 *   would send (`listen_only`).
 *
 * Browser objects are injected so tests can drive both sides with fakes.
 */
import type { createFamilyApi } from './familyApi.js';

type FamilyApi = ReturnType<typeof createFamilyApi>;

/** The console tells the server it is still sending this often (server: 30 s freshness). */
export const LESSON_AUDIO_BEAT_MS = 10_000;

export interface RtcEnv {
  RTCPeerConnection: typeof RTCPeerConnection;
  MediaStream: typeof MediaStream;
  getUserMedia?: (c: MediaStreamConstraints) => Promise<MediaStream>;
  AudioContext?: typeof AudioContext;
  setInterval: typeof setInterval;
  clearInterval: typeof clearInterval;
}

export function browserRtcEnv(): RtcEnv | null {
  if (typeof window === 'undefined' || typeof window.RTCPeerConnection !== 'function' || typeof window.MediaStream !== 'function') return null;
  const md = navigator.mediaDevices;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  return {
    RTCPeerConnection: window.RTCPeerConnection,
    MediaStream: window.MediaStream,
    ...(md && typeof md.getUserMedia === 'function' ? { getUserMedia: (c: MediaStreamConstraints) => md.getUserMedia(c) } : {}),
    ...(AC ? { AudioContext: AC } : {}),
    setInterval: window.setInterval.bind(window) as typeof setInterval,
    clearInterval: window.clearInterval.bind(window) as typeof clearInterval
  };
}

/* ---------------- teacher: publish ---------------- */

export type PublishState =
  | { state: 'starting' }
  | { state: 'live'; listeners: number; streamId: string; mixFallback?: boolean }
  | { state: 'failed'; error: string }
  | { state: 'stopped' };

export interface PublishOptions {
  api: Pick<FamilyApi, 'audioIce' | 'audioPublish' | 'audioBeat' | 'audioStop'>;
  op: string;
  lessonId: string;
  /** Teacher mic; undefined → the default input. */
  micId?: string;
  /** Optional second input carrying the student (mixed into the same track). */
  secondId?: string;
  env: RtcEnv;
  onState: (s: PublishState) => void;
}

export interface Publisher {
  stop(): Promise<void>;
  /** 0..1 loudness of what is being sent (meter on the console). */
  level(): number;
}

const micConstraints = (id: string | undefined, voice: boolean): MediaStreamConstraints => ({
  audio: {
    ...(id ? { deviceId: { exact: id } } : {}),
    // The teacher's voice gets the usual call processing; a line carrying the student is left as it is.
    echoCancellation: voice,
    noiseSuppression: voice,
    autoGainControl: voice
  },
  video: false
});

export async function publishLessonAudio(o: PublishOptions): Promise<Publisher> {
  const { env } = o;
  o.onState({ state: 'starting' });
  const streams: MediaStream[] = [];
  let pc: RTCPeerConnection | null = null;
  let ctx: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;
  const buf = new Uint8Array(256);

  const teardown = () => {
    if (timer !== null) env.clearInterval(timer);
    timer = null;
    pc?.close();
    for (const s of streams) for (const t of s.getTracks()) t.stop();
    void ctx?.close().catch(() => undefined);
  };
  const publisher: Publisher = {
    async stop() {
      if (stopped) return;
      stopped = true;
      teardown();
      await o.api.audioStop(o.op, o.lessonId).catch(() => undefined);
      o.onState({ state: 'stopped' });
    },
    level() {
      if (!analyser) return 0;
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += ((v - 128) / 128) ** 2;
      return Math.min(1, Math.sqrt(sum / buf.length) * 4);
    }
  };

  try {
    if (!env.getUserMedia) throw new Error('no_microphone');
    streams.push(await env.getUserMedia(micConstraints(o.micId, true)));
    if (o.secondId) streams.push(await env.getUserMedia(micConstraints(o.secondId, false)));
    // One input: send the mic track itself (the sender then does not depend on a WebAudio graph running).
    // Two inputs: mix them in WebAudio into one track. The meter taps the inputs either way.
    const firstMic = streams[0]!.getAudioTracks()[0]!;
    let track: MediaStreamTrack = firstMic;
    let mixed = false;
    if (env.AudioContext) {
      ctx = new env.AudioContext();
      await ctx.resume().catch(() => undefined);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      const dest = streams.length > 1 ? ctx.createMediaStreamDestination() : null;
      for (const s of streams) {
        const src = ctx.createMediaStreamSource(s);
        const gain = ctx.createGain();
        gain.gain.value = streams.length > 1 ? 0.8 : 1;
        src.connect(gain);
        gain.connect(analyser);
        if (dest) gain.connect(dest);
      }
      if (dest) {
        track = dest.stream.getAudioTracks()[0]!;
        mixed = true;
      }
    }
    const { ice_servers } = await o.api.audioIce(o.op, o.lessonId);
    pc = new env.RTCPeerConnection({ iceServers: ice_servers, bundlePolicy: 'max-bundle' });
    const tr = pc.addTransceiver(track, { direction: 'sendonly' });
    await pc.setLocalDescription(await pc.createOffer());
    const mid = tr.mid;
    if (!mid || !pc.localDescription) throw new Error('no_offer');
    const res = await o.api.audioPublish(o.op, o.lessonId, { sdp: pc.localDescription.sdp, mid });
    await pc.setRemoteDescription({ type: 'answer', sdp: res.sdp });
    const thisPc = pc;
    thisPc.addEventListener('connectionstatechange', () => {
      if (!stopped && thisPc.connectionState === 'failed') {
        stopped = true;
        teardown();
        o.onState({ state: 'failed', error: 'connection_failed' });
      }
    });
    o.onState({ state: 'live', listeners: 0, streamId: res.stream_id });
    let checked = false;
    let mixFallback = false;
    const beat = async () => {
      if (stopped) return;
      // Self-check on the first beat: a WebAudio mix that produced no packets (seen in headless Chrome) falls back to
      // sending the teacher's mic alone — same sender, no renegotiation.
      if (!checked && mixed) {
        checked = true;
        const sent = await sentBytes(thisPc);
        if (sent === 0) {
          await tr.sender.replaceTrack(firstMic).catch(() => undefined);
          mixFallback = true;
        }
      }
      const b = await o.api.audioBeat(o.op, o.lessonId).catch(() => null);
      if (stopped || !b) return;
      if (!b.live) {
        stopped = true;
        teardown();
        o.onState({ state: 'stopped' });
      } else o.onState({ state: 'live', listeners: b.listeners, streamId: res.stream_id, ...(mixFallback ? { mixFallback } : {}) });
    };
    timer = env.setInterval(() => void beat(), LESSON_AUDIO_BEAT_MS);
    return publisher;
  } catch (e) {
    stopped = true;
    teardown();
    const msg = e instanceof Error ? e.message : String(e);
    const name = e instanceof Error ? e.name : '';
    o.onState({ state: 'failed', error: name === 'NotAllowedError' ? 'mic_denied' : name === 'NotFoundError' ? 'no_microphone' : msg });
    return publisher;
  }
}

async function sentBytes(pc: RTCPeerConnection): Promise<number | null> {
  try {
    let n = 0;
    (await pc.getStats()).forEach((r: { type?: string; bytesSent?: number }) => {
      if (r.type === 'outbound-rtp') n += r.bytesSent ?? 0;
    });
    return n;
  } catch {
    return null;
  }
}

/* ---------------- guardian: listen (receive-only) ---------------- */

export type ListenState =
  | { state: 'connecting' }
  | { state: 'listening'; listenerId: string; streamId: string }
  | { state: 'failed'; error: string }
  | { state: 'stopped' };

export interface ListenOptions {
  api: Pick<FamilyApi, 'listenStart' | 'listenAnswer' | 'listenStop'>;
  guardian: string;
  playerId: string;
  /** Played through this element; `prime` it inside the tap so iOS lets it play later. */
  audio: HTMLAudioElement;
  env: Pick<RtcEnv, 'RTCPeerConnection' | 'MediaStream'>;
  onState: (s: ListenState) => void;
}

export interface Listener {
  stop(): Promise<void>;
  readonly listenerId: string | null;
}

/** Call synchronously in the tap handler: iOS only lets an element play if play() started inside a gesture. */
export function primeAudio(audio: HTMLAudioElement, env: Pick<RtcEnv, 'MediaStream'>): MediaStream {
  const ms = new env.MediaStream();
  audio.srcObject = ms;
  audio.autoplay = true;
  void audio.play().catch(() => undefined);
  return ms;
}

export async function listenLessonAudio(o: ListenOptions): Promise<Listener> {
  o.onState({ state: 'connecting' });
  let pc: RTCPeerConnection | null = null;
  let listenerId: string | null = null;
  let stopped = false;
  const ms = o.audio.srcObject instanceof o.env.MediaStream ? (o.audio.srcObject as MediaStream) : primeAudio(o.audio, o.env);
  const teardown = () => {
    pc?.close();
    for (const t of ms.getTracks()) {
      ms.removeTrack(t);
      t.stop();
    }
  };
  const listener: Listener = {
    get listenerId() {
      return listenerId;
    },
    async stop() {
      if (stopped) return;
      stopped = true;
      teardown();
      if (listenerId) await o.api.listenStop(o.guardian, o.playerId, listenerId).catch(() => undefined);
      o.onState({ state: 'stopped' });
    }
  };
  try {
    const start = await o.api.listenStart(o.guardian, o.playerId);
    listenerId = start.listener_id;
    pc = new o.env.RTCPeerConnection({ iceServers: start.ice_servers, bundlePolicy: 'max-bundle' });
    pc.addEventListener('track', (e) => {
      if (e.track.kind === 'audio') {
        ms.addTrack(e.track);
        void o.audio.play().catch(() => undefined);
      }
    });
    await pc.setRemoteDescription({ type: 'offer', sdp: start.sdp });
    // Receive only: nothing on this page is ever sent (no getUserMedia here).
    for (const t of pc.getTransceivers()) t.direction = 'recvonly';
    await pc.setLocalDescription(await pc.createAnswer());
    if (!pc.localDescription) throw new Error('no_answer');
    await o.api.listenAnswer(o.guardian, o.playerId, start.listener_id, pc.localDescription.sdp);
    const thisPc = pc;
    thisPc.addEventListener('connectionstatechange', () => {
      if (!stopped && thisPc.connectionState === 'failed') {
        stopped = true;
        teardown();
        o.onState({ state: 'failed', error: 'connection_failed' });
      }
    });
    o.onState({ state: 'listening', listenerId: start.listener_id, streamId: start.stream_id });
    return listener;
  } catch (e) {
    stopped = true;
    teardown();
    if (listenerId) await o.api.listenStop(o.guardian, o.playerId, listenerId).catch(() => undefined);
    const code = e && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code) : e instanceof Error ? e.message : 'error';
    o.onState({ state: 'failed', error: code });
    return listener;
  }
}
