import { DEVICE_TOKEN_KEY } from '../world/identity.js';
import { browserRecognitionCuts, clearRecognitionCuts, createBrowserSpeechEngine, type MicIssue, type SpeechCallbacks, type SpeechEngine, type SpeechSession } from './speech.js';
import { readStudentToken } from './submit.js';

/**
 * Workers AI Whisper rung of the mic ladder (docs/02 6장, docs/04 4.4, WP-106): for a child's device whose browser
 * has no speech recognition (in-app browsers, Firefox, some tablets), the turn is recorded as Opus at 16 kbps and
 * sent once to `POST /v1/converse/stt` with the child's own token. The server meters it and keeps no audio; this
 * module keeps none either (the recording is dropped after the upload). Guests have no token, so no server path.
 *
 * There is no live transcript, so "the child is speaking" for the auto-stop comes from the mic level (a changing
 * dots string through `onInterim`, never used as words: `interimIsText: false`), and the stop grace is long
 * enough for the upload and the model.
 */

export const SERVER_STT_PATH = '/v1/converse/stt';
/** RMS of a voiced 100 ms frame (0..1 float samples); quieter frames count as silence. */
export const VOICE_RMS = 0.02;
/** Upload + model time the mic controller waits for after the turn ends. */
export const SERVER_STT_STOP_GRACE_MS = 9000;
const FRAME_MS = 100;

interface RecorderLike {
  state: string;
  mimeType: string;
  ondataavailable: ((e: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  start(timesliceMs?: number): void;
  stop(): void;
}
interface RecorderCtor {
  new (stream: MediaStream, opts?: { mimeType?: string; audioBitsPerSecond?: number }): RecorderLike;
  isTypeSupported?(t: string): boolean;
}

export interface ServerSttEnv {
  isSecureContext: boolean;
  getUserMedia?: (c: MediaStreamConstraints) => Promise<MediaStream>;
  MediaRecorder?: RecorderCtor;
  /** Level meter for the auto-stop; without it every frame counts as speech until the 12 s turn cap. */
  createLevelMeter?: (stream: MediaStream) => { rms(): number; close(): void } | null;
  fetch: typeof fetch;
  token: () => string;
  now: () => number;
  every: (ms: number, fn: () => void) => () => void;
}

function readDeviceToken(): string {
  try {
    return typeof localStorage !== 'undefined' ? (localStorage.getItem(DEVICE_TOKEN_KEY) ?? '') : '';
  } catch {
    return '';
  }
}

function browserLevelMeter(stream: MediaStream): { rms(): number; close(): void } | null {
  const Ctx = (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ??
    (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  try {
    const ctx = new Ctx();
    const src = ctx.createMediaStreamSource(stream);
    const an = ctx.createAnalyser();
    an.fftSize = 1024;
    src.connect(an);
    const buf = new Float32Array(an.fftSize);
    return {
      rms() {
        an.getFloatTimeDomainData(buf);
        let s = 0;
        for (let i = 0; i < buf.length; i++) s += buf[i]! * buf[i]!;
        return Math.sqrt(s / buf.length);
      },
      close() {
        src.disconnect();
        void ctx.close().catch(() => undefined);
      }
    };
  } catch {
    return null;
  }
}

function browserEnv(): ServerSttEnv {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  const gum = nav?.mediaDevices?.getUserMedia?.bind(nav.mediaDevices);
  return {
    isSecureContext: typeof isSecureContext === 'boolean' ? isSecureContext : true,
    getUserMedia: gum,
    MediaRecorder: (globalThis as { MediaRecorder?: RecorderCtor }).MediaRecorder,
    createLevelMeter: browserLevelMeter,
    fetch: (...a) => fetch(...a),
    token: () => readStudentToken() || readDeviceToken(),
    now: () => Date.now(),
    every: (ms, fn) => {
      const id = setInterval(fn, ms);
      return () => clearInterval(id);
    }
  };
}

export function pickRecorderType(R: RecorderCtor): string {
  for (const t of ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm', 'audio/mp4']) {
    if (R.isTypeSupported?.(t)) return t;
  }
  return '';
}

export function createServerSpeechEngine(opts: { baseUrl?: string; env?: Partial<ServerSttEnv>; deviceHasStt?: boolean } = {}): SpeechEngine {
  const env: ServerSttEnv = { ...browserEnv(), ...opts.env };
  return {
    source: 'workers_ai',
    interimIsText: false,
    stopGraceMs: SERVER_STT_STOP_GRACE_MS,
    availability() {
      if (!env.isSecureContext) return { ok: false, issue: 'insecure' };
      if (!env.getUserMedia || !env.MediaRecorder) return { ok: false, issue: 'unsupported' };
      if (!env.token()) return { ok: false, issue: 'unsupported' };
      return { ok: true };
    },
    start(cb: SpeechCallbacks): SpeechSession {
      let aborted = false;
      let stopRequested = false;
      let rec: RecorderLike | null = null;
      let stream: MediaStream | null = null;
      let meter: { rms(): number; close(): void } | null = null;
      let stopTick: (() => void) | null = null;
      let voiced = false;
      let tick = 0;
      let startedAt = 0;
      const chunks: Blob[] = [];
      const release = () => {
        stopTick?.();
        stopTick = null;
        meter?.close();
        meter = null;
        for (const t of stream?.getTracks() ?? []) t.stop();
        stream = null;
      };
      const fail = (issue: MicIssue) => {
        release();
        if (!aborted) cb.onError(issue);
      };
      const upload = async (blob: Blob, ms: number) => {
        let res: Response;
        try {
          res = await env.fetch(`${opts.baseUrl ?? ''}${SERVER_STT_PATH}`, {
            method: 'POST',
            headers: {
              authorization: `Bearer ${env.token()}`,
              'content-type': blob.type || 'audio/webm',
              'x-lcw-audio-ms': String(Math.round(ms)),
              ...(opts.deviceHasStt ? { 'x-lcw-device-stt': '1' } : {})
            },
            body: blob
          });
        } catch {
          return fail('network');
        }
        if (aborted) return;
        // Refused by the meter, no model, or not a child's token: the server path is closed for now → word cards.
        if (res.status === 429 || res.status === 503 || res.status === 401 || res.status === 403 || res.status === 413 || res.status === 415) return fail('unsupported');
        if (!res.ok) return fail('network');
        const j = (await res.json().catch(() => null)) as { transcript?: unknown; confidence?: unknown } | null;
        const text = typeof j?.transcript === 'string' ? j.transcript.trim() : '';
        const confidence = typeof j?.confidence === 'number' ? j.confidence : 0.7;
        cb.onEnd(text ? { transcript: text, confidence } : null);
      };

      void (async () => {
        try {
          stream = await env.getUserMedia!({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        } catch (err) {
          const name = (err as { name?: string })?.name ?? '';
          return fail(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unsupported');
        }
        if (aborted) return release();
        const R = env.MediaRecorder!;
        const mimeType = pickRecorderType(R);
        try {
          rec = new R(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 16_000 });
        } catch {
          return fail('unsupported');
        }
        rec.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) chunks.push(e.data);
        };
        rec.onstop = () => {
          const ms = env.now() - startedAt;
          const type = rec?.mimeType || mimeType || 'audio/webm';
          release();
          if (aborted) return;
          // Nothing above the voice level: no upload, nothing charged (the panel says it did not hear).
          if (!voiced || chunks.length === 0) return cb.onEnd(null);
          void upload(new Blob(chunks, { type }), ms);
        };
        meter = env.createLevelMeter?.(stream) ?? null;
        startedAt = env.now();
        rec.start();
        stopTick = env.every(FRAME_MS, () => {
          const loud = meter ? meter.rms() >= VOICE_RMS : true;
          if (!loud) return;
          voiced = true;
          tick += 1;
          cb.onInterim('·'.repeat(1 + (tick % 3)));
        });
        if (stopRequested && rec.state !== 'inactive') rec.stop();
      })();

      return {
        stop() {
          stopRequested = true;
          if (rec && rec.state !== 'inactive') rec.stop();
        },
        abort() {
          aborted = true;
          if (rec && rec.state !== 'inactive') rec.stop();
          release();
        }
      };
    }
  };
}

/**
 * The engine a dialog uses by default: the browser's recognition where it works, else the server Whisper rung for
 * a child with a token, else the browser engine again (its availability tells the panel to go to the word cards).
 */
export function createDialogSpeechEngine(): SpeechEngine {
  const browser = createBrowserSpeechEngine();
  const server = createServerSpeechEngine();
  if (!browser.availability().ok) return server.availability().ok ? server : browser;
  // A browser whose recognition kept cutting short (speech.ts RECOGNITION_KEEPALIVE) hands this device to Whisper;
  // if the server rung refuses (quota, token), the mark is cleared so the next turn is the browser again.
  if (!(browserRecognitionCuts() && server.availability().ok)) return browser;
  return {
    ...server,
    start(cb) {
      return server.start({
        ...cb,
        onError(issue) {
          if (issue === 'unsupported') clearRecognitionCuts();
          cb.onError(issue);
        }
      });
    }
  };
}
