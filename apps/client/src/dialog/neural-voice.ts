import { normalizeTtsText, ttsVoiceId, type NpcVoice } from '@lcw/content';
import { BUS_LUFS_TARGETS } from '@lcw/audio';
import { readStudentToken } from './submit.js';
import { frameSettings } from '../frame/settings.js';
import { browserVoice } from '@lcw/audio';
import { codeFromSearch, loadStudentSession } from '../lesson/api.js';

/**
 * The neural NPC voice on the client (edge tts.ts, docs/04 4.8): asks `/v1/tts/status` once; while the server says
 * it is on, NPC lines and model sentences come as mp3 from `/v1/tts` (R2-cached, the same sentence is made once) and
 * play on the NPC voice bus, loudness-matched to the bus target. Anything that is off, slow or failing is read by the
 * browser voice (Kokoro on the device, @lcw/audio browser-voice.ts) and only where that cannot run by the device voice
 * (sound.ts), so a dialog never waits on it.
 */

export const NEURAL_VOICE = {
  /**
   * A line not here by then is read by the device voice instead. Aura-2 makes a new line in 1.3-2.3 s (measured
   * 11-16), a cached one comes in ~0.1 s; NPC lines are prebuilt, so this only covers a first-time model sentence.
   */
  waitMs: 4000,
  /** Lines kept in memory (the dialog prefetches its NPC line and offers). */
  cacheLines: 24,
  /**
   * Loudness match to the voice bus (docs/12 voice_npc -16 LUFS). The voice bus (-1 dB) and master (70%, -3.1 dB)
   * follow before the -1 dBFS limiter (audio/runtime.ts), so a peak of +3 dBFS here reaches it at -1.1 dBFS: loud
   * enough for peaky voices (hera, athena peak at -0.1..-0.4 dBFS raw) without ever touching the limiter.
   */
  targetDb: BUS_LUFS_TARGETS.voice_npc,
  peakCeilingDb: 3,
  maxGainDb: 12
} as const;

/** `?voice=device` / `?voice=neural` (checks, demos) or the server's switch. */
function override(): 'device' | 'neural' | null {
  try {
    const v = new URLSearchParams(location.search).get('voice');
    return v === 'device' || v === 'neural' ? v : null;
  } catch {
    return null;
  }
}

let statusP: Promise<boolean> | null = null;
let statusKnown: boolean | null = null;
/** true once the server itself answered the status (on or off); false when asking failed (5xx, offline). */
let statusAnswered = false;

export function neuralVoiceStatus(base = '', fetchImpl: typeof fetch = (i, init) => fetch(i, init)): Promise<boolean> {
  const o = override();
  if (o === 'device') return Promise.resolve((statusKnown = false));
  if (!statusP) {
    statusP = fetchImpl(`${base}/v1/tts/status`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { enabled?: boolean } | null) => {
        statusAnswered = j !== null && typeof j === 'object';
        return (statusKnown = Boolean(j?.enabled));
      })
      .catch(() => (statusKnown = false));
  }
  return statusP;
}

/**
 * May this page start the browser voice's first model download (326 MB WebGPU / 92 MB WASM)? Only when a line really
 * needs it: the server itself said its voice is off, or the server just missed a line. Never during a lesson (a class
 * of PCs would pull it through the school line while the 3D world shares the GPU; a model already in the browser's
 * cache is still used), never for a line without a cast voice (the settings' volume try), never because asking the
 * status failed (a 5xx or a dropped connection is not "off").
 */
export function browserVoiceMayDownload(why: 'server_off' | 'server_missed' | 'other'): boolean {
  if (why === 'other') return false;
  if (why === 'server_off' && !statusAnswered) return false;
  return !lessonPage();
}

/** A teacher's lesson on this page: a ?code= link or a saved student session (lesson/LessonLayer isLessonPage). */
export function lessonPage(): boolean {
  try {
    return Boolean(codeFromSearch(typeof location === 'undefined' ? '' : location.search) ?? loadStudentSession());
  } catch {
    return false;
  }
}

/** The browser voice can read a line now without a first download (loaded, or the model is in this browser's cache). */
export function browserVoiceReadyOrCached(): boolean {
  const bv = browserVoice();
  return bv.available() && (bv.state() === 'ready' || bv.modelCached());
}

/** Sync view: true only once the server said on. */
export function neuralVoiceOn(): boolean {
  // the player's "자연스러운 목소리" switch (G14 설정) turns it off too (no line is fetched or prefetched then)
  return statusKnown === true && frameSettings().neuralVoice;
}

/** true / false once the server answered (or `?voice=device`), null while unknown. */
export function neuralVoiceStatusKnown(): boolean | null {
  if (override() === 'device') return false;
  return statusKnown;
}

/** Test seam. */
export function resetNeuralVoice(): void {
  failedUntil.clear();
  statusP = null;
  statusKnown = null;
  statusAnswered = false;
  cache.clear();
}

function token(): string {
  try {
    return readStudentToken() || localStorage.getItem('lcw.deviceToken') || '';
  } catch {
    return '';
  }
}

/**
 * Cached lines only (`c=1`, edge tts.ts): a browser under automation (headless checks and measurements set
 * navigator.webdriver) or `?voice=cached` never makes a new line, so tests do not spend the children's day of neurons
 * (11-16: the day reached 86% on checks). A real child's browser never sets it.
 */
export function cachedOnlyVoice(): boolean {
  try {
    if (typeof navigator !== 'undefined' && navigator.webdriver === true) return true;
    return new URLSearchParams(location.search).get('voice') === 'cached';
  } catch {
    return false;
  }
}

export function ttsUrl(base: string, voice: NpcVoice, text: string): string {
  return `${base}/v1/tts?v=${encodeURIComponent(ttsVoiceId(voice))}&t=${encodeURIComponent(normalizeTtsText(text))}${cachedOnlyVoice() ? '&c=1' : ''}`;
}

const cache = new Map<string, Promise<ArrayBuffer | null>>();

/** After a failed line: ask again in 30 s; after the meter said no (429), in 5 minutes. */
export const NEURAL_RETRY_MS = 30_000;
export const NEURAL_RETRY_METER_MS = 300_000;
const failedUntil = new Map<string, number>();

/** Starts (or reuses) the download of one line; null when the server will not or cannot make it. */
export function loadLine(voice: NpcVoice, text: string, base = '', fetchImpl: typeof fetch = (i, init) => fetch(i, init)): Promise<ArrayBuffer | null> {
  const url = ttsUrl(base, voice, text);
  const hit = cache.get(url);
  if (hit) return hit;
  // A line that just failed waits before it is asked again: the dialog prefetches its lines on every lesson poll, and
  // without this a refused line (429 meter, 5xx) was fetched again every few seconds by every child (33 times in 80 s).
  const until = failedUntil.get(url);
  if (until !== undefined && Date.now() < until) return Promise.resolve(null);
  const t = token();
  let status = 0;
  const p = fetchImpl(url, t ? { headers: { authorization: `Bearer ${t}` } } : undefined)
    .then((r) => {
      status = r.status;
      return r.ok && (r.headers.get('content-type') ?? '').startsWith('audio/') ? r.arrayBuffer() : null;
    })
    .catch(() => null);
  cache.set(url, p);
  void p.then((b) => {
    if (b) {
      failedUntil.delete(url);
      return;
    }
    cache.delete(url); // a refusal or failure is tried again, after a wait (the device voice reads it meanwhile)
    failedUntil.set(url, Date.now() + (status === 429 ? NEURAL_RETRY_METER_MS : NEURAL_RETRY_MS));
    while (failedUntil.size > 64) failedUntil.delete(failedUntil.keys().next().value!);
  });
  while (cache.size > NEURAL_VOICE.cacheLines) cache.delete(cache.keys().next().value!);
  return p;
}

/**
 * Warm the lines a dialog is about to speak (its NPC line, the offers' model sentences). A line the server will not
 * make (off, refused by the meter, failed) is made by the browser voice in the background instead, so its 🔊 tap
 * plays at once.
 */
export function prefetchLines(lines: Array<{ voice: NpcVoice; text: string }>): void {
  const pref = frameSettings();
  if (!pref.neuralVoice) return;
  // making a line in the background loads the model first, so it follows the same first-download rule as speaking
  const warm = (l: { voice: NpcVoice; text: string }, why: 'server_off' | 'server_missed') => {
    const bv = browserVoice();
    if (!bv.available()) return;
    if (!browserVoiceReadyOrCached() && !browserVoiceMayDownload(why)) return;
    void bv.speak(l.text, l.voice, pref.voiceRate, 60_000, { background: true });
  };
  if (!neuralVoiceOn()) {
    if (neuralVoiceStatusKnown() === false) for (const l of lines) if (l.text.trim()) warm(l, 'server_off');
    return;
  }
  for (const l of lines) if (l.text.trim()) void loadLine(l.voice, l.text).then((b) => (b ? undefined : warm(l, 'server_missed')));
}

/** Resolves the bytes if they arrive within `ms`, else null (the caller reads with the device voice). */
export function within<T>(p: Promise<T | null>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const id = setTimeout(() => resolve(null), ms);
    void p.then((v) => {
      clearTimeout(id);
      resolve(v);
    });
  });
}

/**
 * Gain (linear) that brings a decoded line to the bus target: RMS of the loud part (frames above -50 dBFS) stands in
 * for its loudness, and the gain never lets the peak pass the ceiling (the limiter stays untouched).
 */
export function loudnessGain(samples: Float32Array): number {
  const frame = 1024;
  let sum = 0;
  let n = 0;
  let peak = 0;
  for (let s = 0; s < samples.length; s += frame) {
    let e = 0;
    const end = Math.min(samples.length, s + frame);
    for (let i = s; i < end; i++) {
      const v = samples[i]!;
      e += v * v;
      const a = Math.abs(v);
      if (a > peak) peak = a;
    }
    const ms = e / Math.max(1, end - s);
    if (ms > 1e-5) {
      sum += ms;
      n += 1;
    }
  }
  if (n === 0 || peak === 0) return 1;
  const rmsDb = 10 * Math.log10(sum / n);
  // Measured on 35 aura/melo lines (11-16): this gated RMS sits 0.4 dB above ffmpeg's EBU R128 integrated loudness
  // (range -1.2..+1.3 dB), so it stands in for LUFS within about a decibel.
  const wantDb = NEURAL_VOICE.targetDb - (rmsDb - 0.4);
  const peakRoomDb = NEURAL_VOICE.peakCeilingDb - 20 * Math.log10(peak);
  const db = Math.min(wantDb, peakRoomDb, NEURAL_VOICE.maxGainDb);
  return Math.pow(10, db / 20);
}
