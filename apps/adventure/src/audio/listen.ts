import { noteMicIssue, noteMicTurn, noteTurnSent, noteTurnStart } from '../../../client/src/dialog/mic-status.js';
import { createServerSpeechEngine } from '../../../client/src/dialog/server-stt.js';
import type { MicIssue, SpeechEngine, SpeechSession } from '../../../client/src/dialog/speech.js';
import { ADV } from '../core/tuning.js';

/**
 * The 🎤 in a TALK (docs/22 1.3): the same server Whisper path as the LCW dialog, one code for both. The turn is
 * recorded as Opus and sent once to `POST /v1/converse/stt` with the child's own token (the dialog's
 * `createServerSpeechEngine`, apps/client/src/dialog/server-stt.ts). The server meters it and keeps no audio; this page
 * keeps none either. The browser's own speech recognition is not used.
 *
 * The token is the child's lesson token in this tab (`lcw.studentToken`, from a class code) or a linked device's
 * (`lcw.deviceToken`), the same keys LCW uses. Without either, the panel asks for the class code (ui/JoinCode.tsx).
 * There is no live transcript: while the child speaks the panel shows a level dots line, never words.
 */
export type ListenEnd =
  | { kind: 'heard'; alternatives: string[] }
  | { kind: 'unsupported' | 'denied' | 'silent' | 'retry' | 'quota' | 'need_code' };

export type ListenState = 'ok' | 'need_code' | 'unsupported';

const MIC_OFF_KEY = 'lcw.adventure.micOff';
/** For this page view: the server refused the token (an old lesson tab: 401/403) → ask for the code again; the meter is resting (429) → typing. */
let refused = false;
let resting = false;
/** The lesson refused this tab's token (the lesson ended): the next 🎤 asks for the class code. */
export function lessonTokenRefused(): void {
  refused = true;
}
/** A new class code worked: the token is good again. */
export function tokenRenewed(): void {
  refused = false;
}
/** Test seam. */
export function resetListenMemory(): void {
  refused = false;
  resting = false;
}

function localStorageFlag(k: string): boolean {
  try {
    return localStorage.getItem(k) === '1';
  } catch {
    return false;
  }
}

export function markMicDenied(): void {
  try {
    localStorage.setItem(MIC_OFF_KEY, '1');
  } catch {
    // remembered for this page only
  }
}

/** The child's token for the server path: this tab's lesson token, else a linked device's (as the LCW dialog reads). */
export function childToken(): string {
  try {
    return sessionStorage.getItem('lcw.studentToken') || localStorage.getItem('lcw.deviceToken') || '';
  } catch {
    return '';
  }
}

let engineFor: (() => SpeechEngine) | null = null;
/** Test seam: the engine the Listener uses (default: the LCW dialog's server Whisper engine). */
export function setSpeechEngineFactory(f: (() => SpeechEngine) | null): void {
  engineFor = f;
}
const engine = (): SpeechEngine => (engineFor ? engineFor() : createServerSpeechEngine());

/** Can this page take a spoken turn now? `need_code`: everything is there but the child has no token yet. */
export function listenState(): ListenState {
  try {
    if (localStorageFlag(MIC_OFF_KEY) || resting) return 'unsupported';
    if (refused) return hasRecorder() ? 'need_code' : 'unsupported';
    const a = engine().availability();
    if (a.ok) return 'ok';
    if (a.issue === 'unsupported' && !childToken() && hasRecorder()) return 'need_code';
    return 'unsupported';
  } catch {
    return 'unsupported';
  }
}

function hasRecorder(): boolean {
  const g = globalThis as { navigator?: Navigator; MediaRecorder?: unknown; isSecureContext?: boolean };
  return Boolean(g.navigator?.mediaDevices?.getUserMedia && g.MediaRecorder && g.isSecureContext !== false);
}

/** What a failed turn means for the panel: say it again, or go to typing. */
export function endOf(issue: MicIssue, raw?: string): ListenEnd {
  if (raw === 'http_401' || raw === 'http_403') {
    refused = true;
    return { kind: 'need_code' };
  }
  if (issue === 'denied') {
    markMicDenied();
    return { kind: 'denied' };
  }
  if (issue === 'no_speech' || issue === 'aborted') return { kind: 'silent' };
  // a slow or failed upload, a model error: the words may come through next time
  if (issue === 'stt_failed' || issue === 'network') return { kind: 'retry' };
  if (issue === 'quota') {
    resting = true;
    return { kind: 'quota' };
  }
  if (issue === 'unsupported' && !childToken()) return { kind: 'need_code' };
  return { kind: 'unsupported' };
}

export class Listener {
  private session: SpeechSession | null = null;
  private done = false;
  private timers: Array<ReturnType<typeof setTimeout>> = [];

  /** `onLevel(dots)`: the child is speaking (a changing dots string, never words). */
  start(onLevel: (dots: string) => void, onEnd: (r: ListenEnd) => void): void {
    this.done = false;
    const eng = engine();
    const a = eng.availability();
    if (!a.ok) {
      this.done = true;
      onEnd(endOf(a.issue));
      return;
    }
    // Every turn goes into the same mic-turn ledger as the LCW dialog (dialog/mic-status.ts 'lcw.micTurns', R2627): the
    // lesson console sees the adventure's turns and why one was lost (audio/presence.ts sends it with the ping).
    noteTurnStart();
    const finish = (r: ListenEnd, issue?: { issue: MicIssue; raw?: string }) => {
      if (this.done) return;
      this.done = true;
      this.clear();
      if (r.kind === 'heard') {
        noteMicTurn(true);
        noteTurnSent();
      } else noteMicIssue(issue?.issue ?? (r.kind === 'silent' ? 'no_speech' : 'stt_failed'), issue?.raw ?? (r.kind === 'silent' ? 'stt_empty' : 'timeout'));
      onEnd(r);
    };
    let voicedAt = 0;
    const stopSoon = () => {
      this.clearStop();
      this.stopTimer = setTimeout(() => this.session?.stop(), ADV.listen.silenceStopMs);
    };
    this.session = eng.start({
      onInterim: (dots) => {
        voicedAt = Date.now();
        onLevel(dots);
        stopSoon();
      },
      onEnd: (res) => {
        const t = res?.transcript.trim() ?? '';
        finish(t ? { kind: 'heard', alternatives: [t] } : { kind: 'silent' });
      },
      onError: (issue, raw) => finish(endOf(issue, raw), { issue, raw })
    });
    // nobody spoke: end the turn (the recorder hears nothing, no upload, "say it again")
    this.timers.push(setTimeout(() => voicedAt === 0 && this.session?.stop(), ADV.listen.noVoiceMs));
    this.timers.push(setTimeout(() => this.session?.stop(), ADV.listen.maxMs));
    // the upload and the model have their own deadline in the engine; this only backs it up
    this.timers.push(setTimeout(() => finish({ kind: 'retry' }), ADV.listen.maxMs + (eng.stopGraceMs ?? 10_000)));
  }

  private stopTimer: ReturnType<typeof setTimeout> | null = null;
  private clearStop(): void {
    if (this.stopTimer) clearTimeout(this.stopTimer);
    this.stopTimer = null;
  }
  private clear(): void {
    this.clearStop();
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  /** The child tapped "Done": send what was recorded. */
  stop(): void {
    this.clearStop();
    this.session?.stop();
  }

  abort(): void {
    this.done = true;
    this.clear();
    this.session?.abort();
  }
}
