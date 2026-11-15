/** Pure helpers for the /try speech fallback (docs/14 section 8). No server calls, no recording is sent anywhere. */

/** Speech-like energy must last at least this long to pass the loudness check. */
export const TRY_SPEECH_MIN_MS = 800;
/** RMS (0..1) above which a frame counts as speech-like. */
export const TRY_SPEECH_RMS_THRESHOLD = 0.04;
/** Short dips below the threshold inside a phrase are bridged (children pause mid-clause). */
export const TRY_SPEECH_MAX_GAP_MS = 400;
/** Target 3-star sentence for the /try cafe order. */
export const TRY_TARGET_SENTENCE = 'Can I have a warm honey tea so I stay warm?';
/** Analyser poll interval. */
export const TRY_ANALYSER_INTERVAL_MS = 50;

export interface EnergySample {
  tMs: number;
  rms: number;
}

export interface EnergyVerdict {
  passed: boolean;
  /** Longest run of speech-like energy (gaps up to TRY_SPEECH_MAX_GAP_MS bridged). */
  speechMs: number;
}

export function evaluateSpeechEnergy(
  samples: readonly EnergySample[],
  opts: { minMs?: number; threshold?: number; maxGapMs?: number } = {}
): EnergyVerdict {
  const minMs = opts.minMs ?? TRY_SPEECH_MIN_MS;
  const threshold = opts.threshold ?? TRY_SPEECH_RMS_THRESHOLD;
  const maxGap = opts.maxGapMs ?? TRY_SPEECH_MAX_GAP_MS;
  let best = 0;
  let runStart: number | null = null;
  let lastLoud = 0;
  for (const s of samples) {
    if (s.rms >= threshold) {
      if (runStart === null || s.tMs - lastLoud > maxGap) runStart = s.tMs;
      lastLoud = s.tMs;
      best = Math.max(best, lastLoud - runStart);
    }
  }
  return { passed: best >= minMs, speechMs: best };
}

export function rmsOfTimeDomain(bytes: ArrayLike<number>): number {
  if (bytes.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < bytes.length; i++) {
    const v = ((bytes[i] ?? 128) - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / bytes.length);
}

export interface SpeechSupport {
  recognition: boolean;
  getUserMedia: boolean;
}

export type TryPath = 'recognition' | 'wordcards_with_loudness' | 'wordcards_only';

/** Recognition when available; otherwise word cards, with the loudness check only if the mic can be opened. */
export function chooseTryPath(s: SpeechSupport): TryPath {
  if (s.recognition) return 'recognition';
  return s.getUserMedia ? 'wordcards_with_loudness' : 'wordcards_only';
}

export function detectSpeechSupport(g: {
  SpeechRecognition?: unknown;
  webkitSpeechRecognition?: unknown;
  navigator?: { mediaDevices?: { getUserMedia?: unknown } };
}): SpeechSupport {
  return {
    recognition: Boolean(g.SpeechRecognition ?? g.webkitSpeechRecognition),
    getUserMedia: typeof g.navigator?.mediaDevices?.getUserMedia === 'function'
  };
}

/** Deterministic shuffle (seeded LCG) so the card order is testable. */
export function shuffleWords(words: readonly string[], seed: number): string[] {
  const out = [...words];
  let s = seed >>> 0 || 1;
  for (let i = out.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export function sentenceWords(sentence: string): string[] {
  return sentence.trim().split(/\s+/).filter(Boolean);
}

/** Compares assembled cards to the target, ignoring case and trailing punctuation. */
export function isSentenceAssembled(picked: readonly string[], target: string): boolean {
  const norm = (w: string) => w.toLowerCase().replace(/[.,!?]+$/g, '');
  const t = sentenceWords(target).map(norm);
  return picked.length === t.length && picked.every((w, i) => norm(w) === t[i]);
}
