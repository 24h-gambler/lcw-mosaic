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
  createLevelMeter?: (stream: MediaStream) => LevelMeter | null;
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

/**
 * `running() === false`: the meter cannot hear (its AudioContext is suspended, so it reads 0 whatever the child says).
 * The turn then goes on as if there were no meter (every frame counts as speech, the child taps to finish), so the
 * words are sent instead of dropped as "quiet" (R2627 lost turns).
 */
export interface LevelMeter {
  rms(): number;
  close(): void;
  running?(): boolean;
}

function browserLevelMeter(stream: MediaStream): LevelMeter | null {
  const Ctx = (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ??
    (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  try {
    const ctx = new Ctx();
    // Made after getUserMedia resolved, outside the tap: some browsers start it suspended and it then reads 0.
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
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
      running: () => ctx.state === 'running',
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
      let meter: LevelMeter | null = null;
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
      // `raw` names what failed (the console and lcw.micIssue keep it): 'http_429', 'fetch', 'vad_quiet', ...
      const fail = (issue: MicIssue, raw?: string) => {
        release();
        if (!aborted) cb.onError(issue, raw);
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
          return fail('network', 'fetch');
        }
        if (aborted) return;
        // R2627: each refusal says what it was. The daily meter (429) is a pause, not "no mic": word cards for this
        // window, and the console reads 'quota' rather than "no mic". No model / not a child's token / a format the
        // server does not take: the server path is closed here → word cards. Too long or a failed model call: say again.
        const code = `http_${res.status}`;
        if (res.status === 429) return fail('quota', code);
        if (res.status === 503 || res.status === 401 || res.status === 403 || res.status === 415) return fail('unsupported', code);
        if (res.status === 413 || res.status >= 500 || !res.ok) return fail('stt_failed', code);
        const j = (await res.json().catch(() => null)) as { transcript?: unknown; confidence?: unknown } | null;
        const text = typeof j?.transcript === 'string' ? j.transcript.trim() : '';
        const confidence = typeof j?.confidence === 'number' ? j.confidence : 0.7;
        // Whisper heard no words in a voiced recording: a no-speech turn the console can tell from a quiet mic.
        if (!text) return fail('no_speech', 'stt_empty');
        cb.onEnd({ transcript: text, confidence });
      };

      void (async () => {
        try {
          stream = await env.getUserMedia!({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        } catch (err) {
          const name = (err as { name?: string })?.name ?? '';
          const raw = `gum_${name.replace(/[^A-Za-z]/g, '').toLowerCase().slice(0, 30) || 'error'}`;
          return fail(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unsupported', raw);
        }
        if (aborted) return release();
        const R = env.MediaRecorder!;
        const mimeType = pickRecorderType(R);
        try {
          rec = new R(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 16_000 });
        } catch {
          return fail('unsupported', 'recorder');
        }
        rec.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) chunks.push(e.data);
        };
        rec.onstop = () => {
          const ms = env.now() - startedAt;
          const type = rec?.mimeType || mimeType || 'audio/webm';
          release();
          if (aborted) return;
          // Nothing recorded at all: the recorder gave no data (a broken capture), not a quiet child.
          if (chunks.length === 0) return fail('no_speech', 'no_audio');
          // Nothing above the voice level: no upload, nothing charged (the panel says it did not hear).
          if (!voiced) return fail('no_speech', 'vad_quiet');
          void upload(new Blob(chunks, { type }), ms);
        };
        meter = env.createLevelMeter?.(stream) ?? null;
        startedAt = env.now();
        rec.start();
        stopTick = env.every(FRAME_MS, () => {
          const hears = meter && meter.running?.() !== false;
          const loud = hears ? meter!.rms() >= VOICE_RMS : true;
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
        onError(issue, raw) {
          if (issue === 'unsupported' || issue === 'quota') clearRecognitionCuts();
          cb.onError(issue, raw);
        }
      });
    }
  };
}
