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
  onError(issue: MicIssue): void;
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

export function createBrowserSpeechEngine(envOverride?: Partial<SpeechEnv>, lang = 'en-US'): SpeechEngine {
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
      const rec = new Ctor();
      rec.lang = lang;
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      const finals: SpeechFinal[] = [];
      let interim = '';
      let aborted = false;
      let errored = false;
      rec.onresult = (ev) => {
        interim = '';
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const r = ev.results[i]!;
          if (r.isFinal) finals.push({ transcript: r[0].transcript.trim(), confidence: r[0].confidence || 0.8 });
          else interim += r[0].transcript;
        }
        cb.onInterim([...finals.map((f) => f.transcript), interim.trim()].filter(Boolean).join(' '));
      };
      rec.onerror = (ev) => {
        const issue = mapRecognitionError(ev.error);
        // no-speech with something already heard is just the end of the turn
        if (issue === 'no_speech' && (finals.length > 0 || interim)) return;
        if (issue === 'aborted' && aborted) return;
        errored = true;
        cb.onError(issue);
      };
      rec.onend = () => {
        if (aborted || errored) return;
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
      try {
        rec.start();
      } catch {
        queueMicrotask(() => cb.onError('aborted'));
      }
      return {
        stop: () => {
          try {
            rec.stop();
          } catch {
            /* already stopped */
          }
        },
        abort: () => {
          aborted = true;
          try {
            rec.abort();
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
