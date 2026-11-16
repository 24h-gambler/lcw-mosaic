/**
 * Microphone → text for the dialog window (WP-106 fallback ladder, docs/04 4.4).
 * This file holds the browser SpeechRecognition rung and the environment checks that decide when the panel must
 * go straight to the word-card board / keyboard instead (in-app browsers, no API, denied permission).
 * On-device Whisper and Workers AI Whisper plug in as further `SpeechEngine`s with the same interface.
 */

export type MicIssue = 'unsupported' | 'in_app' | 'insecure' | 'denied' | 'no_speech' | 'network' | 'aborted';

export interface SpeechFinal {
  transcript: string;
  confidence: number;
}

export interface SpeechCallbacks {
  /** Live (interim + final so far) transcript. Also the "child is speaking" signal for the auto-stop. */
  onInterim(text: string): void;
  /** Recognition ended: the joined final transcript, or null when nothing was heard. */
  onEnd(result: SpeechFinal | null): void;
  /** `raw`: the browser's own error code when there is one (e.g. 'audio-capture'), for the mic status record. */
  onError(issue: MicIssue, raw?: string): void;
}

export interface SpeechSession {
  /** Finish and deliver what was heard (second tap / auto-stop). */
  stop(): void;
  /** Drop everything (panel closed). */
  abort(): void;
}

export interface SpeechEngine {
  readonly source: 'browser' | 'device' | 'workers_ai';
  /** False when `onInterim` only signals speech (a level meter), so it is never taken as the child's words. */
  readonly interimIsText?: boolean;
  /** How long the mic controller waits for `onEnd` after stop (server recognition needs the upload + model). */
  readonly stopGraceMs?: number;
  availability(): { ok: true } | { ok: false; issue: MicIssue };
  start(cb: SpeechCallbacks): SpeechSession;
}

/** Messenger/social in-app browsers ship web views without speech recognition or with mic prompts that never show. */
const IN_APP_UA = /KAKAOTALK|NAVER\(inapp|Instagram|FBAN|FBAV|Line\/|DaumApps|everytimeApp|BAND\//i;

export function isInAppBrowser(ua: string): boolean {
  return IN_APP_UA.test(ua);
}

export function isKakaoInApp(ua: string): boolean {
  return /KAKAOTALK/i.test(ua);
}

/** KakaoTalk's documented scheme for "open this page in the system browser". */
export function kakaoOpenExternalUrl(pageUrl: string): string {
  return `kakaotalk://web/openExternal?url=${encodeURIComponent(pageUrl)}`;
}

interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((ev: RecognitionResultEvent) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
interface RecognitionResultEvent {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string; confidence: number } }>;
}
type RecognitionCtor = new () => RecognitionLike;

interface SpeechEnv {
  userAgent: string;
  isSecureContext: boolean;
  SpeechRecognition?: RecognitionCtor;
}

function browserEnv(): SpeechEnv {
  const w = (typeof window !== 'undefined' ? window : {}) as Record<string, unknown> & { isSecureContext?: boolean };
  return {
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    isSecureContext: w.isSecureContext !== false,
    SpeechRecognition: (w.SpeechRecognition ?? w.webkitSpeechRecognition) as RecognitionCtor | undefined
  };
}

export function mapRecognitionError(error: string): MicIssue {
  if (error === 'not-allowed' || error === 'service-not-allowed' || error === 'audio-capture') return 'denied';
  if (error === 'no-speech') return 'no_speech';
  if (error === 'network') return 'network';
  return 'aborted';
}

/**
 * Browser recognition keeps listening for the whole turn (Dan 11-16 "1초도 유지가 안되고 인식이 끊기는"): Android
 * Chrome and others ignore `continuous` and end on the first pause (or with `no-speech` / `aborted`) long before our
 * turn rules end it. While the turn is still on (no stop/abort from the mic controller), an end like that starts
 * recognition again and the words heard so far are kept and joined. Only the mic controller ends a turn: the
 * child's second tap, 2.5 s of silence after speaking, 6 s without a word, or 12 s.
 */
export const RECOGNITION_KEEPALIVE = {
  /** A run shorter than this counts as a short end (the browser cut, not the child). */
  shortRunMs: 1500,
  /** Pause before listening again (Chrome needs the old session to let go of the mic, or the new one aborts). */
  restartDelayMs: 250,
  /** Safety cap on restarts in one turn (60 x ≥250 ms; the mic controller's turn ends at a pause past 45 s, hard at 60 s). */
  maxRestarts: 60,
  /** Short ends in one turn that mark the turn as cut by the browser. */
  flakyShortEnds: 3,
  /** Cut turns before this device goes to the server Whisper rung (kept in localStorage). */
  flakyTurns: 2,
  /** The mark fades: after this long the browser gets another chance. */
  flakyForgetMs: 3 * 24 * 3600 * 1000,
  storageKey: 'lcw.sttShortEndTurns'
} as const;

/** Errors that only end this run (restart while the turn is on); the rest end the turn. */
const RESTARTABLE = new Set(['no-speech', 'aborted']);

function readCutMark(nowMs: number): number {
  try {
    const raw = localStorage.getItem(RECOGNITION_KEEPALIVE.storageKey) || '';
    const [n, at] = raw.split('|').map(Number);
    if (!n || !at || nowMs - at > RECOGNITION_KEEPALIVE.flakyForgetMs) return 0;
    return n;
  } catch {
    return 0;
  }
}

export function recordShortEndTurn(nowMs = Date.now()): number {
  const n = readCutMark(nowMs) + 1;
  try {
    localStorage.setItem(RECOGNITION_KEEPALIVE.storageKey, `${n}|${nowMs}`);
  } catch {
    /* private mode: the browser keeps its keep-alive */
  }
  return n;
}

/** The server rung refused (quota, no token): give the browser back to this device. */
export function clearRecognitionCuts(): void {
  try {
    localStorage.removeItem(RECOGNITION_KEEPALIVE.storageKey);
  } catch {
    /* ignore */
  }
}

/** True once this device's browser recognition cut short in RECOGNITION_KEEPALIVE.flakyTurns recent turns. */
export function browserRecognitionCuts(nowMs = Date.now()): boolean {
  return readCutMark(nowMs) >= RECOGNITION_KEEPALIVE.flakyTurns;
}

export function createBrowserSpeechEngine(envOverride?: Partial<SpeechEnv>, lang = 'en-US', now: () => number = () => Date.now()): SpeechEngine {
  const env = { ...browserEnv(), ...envOverride };
  return {
    source: 'browser',
    availability() {
      if (isInAppBrowser(env.userAgent)) return { ok: false, issue: 'in_app' };
      if (!env.isSecureContext) return { ok: false, issue: 'insecure' };
      if (!env.SpeechRecognition) return { ok: false, issue: 'unsupported' };
      return { ok: true };
    },
    start(cb) {
      const Ctor = env.SpeechRecognition;
      if (!Ctor) {
        queueMicrotask(() => cb.onError('unsupported'));
        return { stop() {}, abort() {} };
      }
      const finals: SpeechFinal[] = [];
      let interim = '';
      let aborted = false;
      let errored = false;
      let stopRequested = false;
      let delivered = false;
      let restarts = 0;
      let shortEnds = 0;
      let rec: RecognitionLike | null = null;
      let runStartedAt = 0;
      let restartTimer: ReturnType<typeof setTimeout> | null = null;
      const heardAny = () => finals.length > 0 || interim.trim() !== '';
      const joined = () => [...finals.map((f) => f.transcript), interim.trim()].filter(Boolean).join(' ');
      const deliver = () => {
        if (delivered || aborted || errored) return;
        delivered = true;
        if (shortEnds >= RECOGNITION_KEEPALIVE.flakyShortEnds) recordShortEndTurn();
        const parts = [...finals];
        if (interim.trim()) parts.push({ transcript: interim.trim(), confidence: 0.6 });
        if (parts.length === 0) {
          cb.onEnd(null);
          return;
        }
        const transcript = parts.map((p) => p.transcript).join(' ').replace(/\s+/g, ' ').trim();
        const confidence = parts.reduce((a, p) => a + p.confidence, 0) / parts.length;
        cb.onEnd({ transcript, confidence: Math.max(0, Math.min(1, confidence)) });
      };
      const run = (): boolean => {
        const r = new Ctor();
        r.lang = lang;
        r.continuous = true;
        r.interimResults = true;
        r.maxAlternatives = 1;
        rec = r;
        r.onresult = (ev) => {
          if (rec !== r) return;
          interim = '';
          for (let i = ev.resultIndex; i < ev.results.length; i++) {
            const x = ev.results[i]!;
            if (x.isFinal) {
              const t = x[0].transcript.trim();
              if (t) finals.push({ transcript: t, confidence: x[0].confidence || 0.8 });
            } else interim += x[0].transcript;
          }
          cb.onInterim(joined());
        };
        r.onerror = (ev) => {
          if (rec !== r || aborted || delivered) return;
          // A cut (no-speech / aborted) only ends this run: onend listens again, or ends the turn after a stop.
          if (RESTARTABLE.has(ev.error)) return;
          // After a stop, or on a restarted run (the clip recorder may hold the mic now: audio-capture), the turn
          // ends with what was heard rather than as a mic problem.
          if ((stopRequested || restarts > 0) && heardAny()) return deliver();
          if (restarts > 0 && ev.error === 'audio-capture') return deliver();
          errored = true;
          cb.onError(mapRecognitionError(ev.error), ev.error);
        };
        r.onend = () => {
          if (rec !== r || aborted || errored) return;
          if (stopRequested) return deliver();
          // The browser ended by itself: keep what it heard and listen again.
          if (interim.trim()) {
            finals.push({ transcript: interim.trim(), confidence: 0.6 });
            interim = '';
          }
          if (now() - runStartedAt < RECOGNITION_KEEPALIVE.shortRunMs) shortEnds += 1;
          if (restarts >= RECOGNITION_KEEPALIVE.maxRestarts) return deliver();
          restarts += 1;
          restartTimer = setTimeout(() => {
            restartTimer = null;
            if (aborted || delivered || errored) return;
            if (stopRequested) return deliver();
            if (!run()) deliver();
          }, RECOGNITION_KEEPALIVE.restartDelayMs);
        };
        runStartedAt = now();
        try {
          r.start();
          return true;
        } catch {
          return false;
        }
      };
      if (!run()) queueMicrotask(() => cb.onError('aborted'));
      return {
        stop: () => {
          stopRequested = true;
          // Between two runs there is nothing to stop: the turn ends now with what was heard.
          if (restartTimer) {
            clearTimeout(restartTimer);
            restartTimer = null;
            return deliver();
          }
          try {
            rec?.stop();
          } catch {
            deliver();
          }
        },
        abort: () => {
          aborted = true;
          if (restartTimer) clearTimeout(restartTimer);
          try {
            rec?.abort();
          } catch {
            /* already stopped */
          }
        }
      };
    }
  };
}

/** Scripted engine for tests and the headless preview: "hears" the given lines in order. */
export function createScriptedSpeechEngine(lines: Array<string | MicIssue | null>, opts: { delayMs?: number } = {}): SpeechEngine {
  let i = 0;
  const delay = opts.delayMs ?? 400;
  return {
    source: 'browser',
    availability: () => ({ ok: true }),
    start(cb) {
      const line = lines[Math.min(i, lines.length - 1)] ?? null;
      i++;
      let done = false;
      const issues: MicIssue[] = ['unsupported', 'in_app', 'insecure', 'denied', 'no_speech', 'network', 'aborted'];
      const t1 = setTimeout(() => {
        if (done) return;
        if (line && issues.includes(line as MicIssue)) {
          done = true;
          cb.onError(line as MicIssue);
          return;
        }
        if (line) cb.onInterim(line);
      }, delay);
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(t1);
        cb.onEnd(line && !issues.includes(line as MicIssue) ? { transcript: line, confidence: 0.9 } : null);
      };
      const t2 = setTimeout(finish, delay * 2);
      return {
        stop: finish,
        abort: () => {
          done = true;
          clearTimeout(t1);
          clearTimeout(t2);
        }
      };
    }
  };
}
