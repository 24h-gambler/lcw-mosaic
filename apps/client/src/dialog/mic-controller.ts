import {
  AUDIO_LIMITS,
  MIC_CAPTURE_IDLE,
  reduceDialogMic,
  turnClipRecordingOff,
  vadHangoverMs,
  type ClipRecorder,
  type MicCaptureState
} from '@lcw/audio';
import type { MicIssue, SpeechEngine, SpeechFinal, SpeechSession } from './speech.js';
import { noteMicIssue, noteMicTurn, noteTurnLost, noteTurnStart } from './mic-status.js';

/**
 * Dialog microphone (docs/08 7.1, docs/12 9): tap to start, tap again to finish, or auto-stop after
 * DIALOG_MIC_AUTO_STOP_SILENCE_MS of silence once the child has started speaking (reduceDialogMic).
 * After the conversation VAD hangover (1,500 ms) of silence the panel nudges "다 말했으면 한 번 더 눌러요".
 * A child who has not started yet gets FIRST_SPEECH_WAIT_MS before the turn ends (4.1: 6 s silence → re-prompt).
 *
 * Turn length (Oreo lesson 11-16: the first answer was cut at 12 s mid-sentence, "…because it makes" — the "the
 * recognition cuts off" Dan reported): a stage-1 fixed task is three sentences, about 20 s. Silence ends a turn;
 * MAX_TURN_MS (45 s) is only a soft cap that never cuts a child who is speaking — past it the turn ends at the
 * first pause of PAUSE_AT_CAP_MS — and HARD_TURN_MS (60 s, the server Whisper limit) is the one hard stop.
 * The last COUNTDOWN_MS before the soft cap show the seconds left (MicView.secondsLeft) so the end never surprises.
 */

export const MIC_FRAME_MS = 100;
export const FIRST_SPEECH_WAIT_MS = 6_000;
export const MAX_TURN_MS = 45_000;
/** Past MAX_TURN_MS the turn ends at the first pause this long (a speaking child is never cut). */
export const PAUSE_AT_CAP_MS = 700;
/** The one hard stop (server Whisper takes up to 60 s, packages/quota SERVER_STT.maxSec). */
export const HARD_TURN_MS = 60_000;
/** The seconds left show for this long before the soft cap. */
export const COUNTDOWN_MS = 10_000;

export interface MicView {
  recording: boolean;
  interim: string;
  /** Silence since the child last spoke passed the VAD hangover. */
  hangover: boolean;
  /** 0..1 level for the bar animation (recent speech activity). */
  level: number;
  /** Whole seconds left before the soft turn cap, only in its last COUNTDOWN_MS (else absent). */
  secondsLeft?: number;
  /** The turn ended and its words are on the way (the server rung uploads and transcribes): the panel says so. */
  processing?: boolean;
}

export interface MicControllerEvents {
  onView(v: MicView): void;
  /** `clip`: the recorded turn when a recorder was given and something was heard (resolves null if nothing usable). */
  onFinal(r: SpeechFinal | null, durMs: number, clip?: Promise<Blob | null>): void;
  onIssue(i: MicIssue): void;
}

export interface Clock {
  now(): number;
  every(ms: number, fn: () => void): () => void;
}

export const realClock: Clock = {
  now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  every: (ms, fn) => {
    const h = setInterval(fn, ms);
    return () => clearInterval(h);
  }
};

/** After stop, an engine that never sends its final result is given up on after this long (the child is not stuck). */
export const STOP_GRACE_MS = 3000;

export class MicController {
  private state: MicCaptureState = MIC_CAPTURE_IDLE;
  private session: SpeechSession | null = null;
  private stopTicker: (() => void) | null = null;
  private startedAt = 0;
  private lastActivityAt = 0;
  private spoke = false;
  private interim = '';
  private lastInterim = '';
  private ended = false;
  /** Bumped per session: late events from an older session (stopped, then tapped again) are ignored. */
  private gen = 0;
  /** Stop was sent and the engine's final result is still on its way; taps wait for it. */
  private finishing = false;
  /** The turn's clip, cut when the child stops (finish) or when the engine ends by itself (deliver). */
  private clip: Promise<Blob | null> | null = null;

  constructor(
    private readonly engine: SpeechEngine,
    private readonly ev: MicControllerEvents,
    private readonly clock: Clock = realClock,
    /** voice_store on: records the turn alongside recognition (clip-recorder.ts). Optional, never blocks recognition. */
    private readonly recorder: ClipRecorder | null = null
  ) {}

  get recording(): boolean {
    return this.state.recording;
  }

  /** The one mic button: start when idle, finish when recording. */
  tap(): void {
    if (this.finishing) return;
    const next = reduceDialogMic(this.state, { type: 'tap' });
    const was = this.state.recording;
    // State first, so the first view begin() emits already says "recording".
    this.state = next;
    if (next.recording && !was) this.begin();
    else if (!next.recording && was) this.finish();
  }

  dispose(): void {
    // The window closed while a turn was still open (recording, or its result on the way): that turn is lost.
    if ((this.state.recording || this.finishing) && !this.ended) noteTurnLost('closed');
    this.gen++;
    this.finishing = false;
    this.stopTicker?.();
    this.stopTicker = null;
    this.session?.abort();
    this.session = null;
    this.recorder?.abort();
    this.clip = null;
    this.state = MIC_CAPTURE_IDLE;
  }

  private begin(): void {
    this.ended = false;
    this.spoke = false;
    this.interim = '';
    this.lastInterim = '';
    this.startedAt = this.clock.now();
    this.lastActivityAt = this.startedAt;
    const gen = ++this.gen;
    this.clip = null;
    noteTurnStart();
    this.session = this.engine.start({
      onInterim: (text) => {
        if (gen === this.gen) this.interim = text;
      },
      onEnd: (r) => {
        if (gen === this.gen) this.deliver(r);
      },
      onError: (issue, raw) => {
        if (gen !== this.gen) return;
        noteMicIssue(issue, raw);
        this.finishing = false;
        if (this.recorder) {
          this.recorder.abort();
          // The mic was refused while the recorder held it too: never record on this device again (recognition wins).
          if (issue === 'denied') turnClipRecordingOff();
        }
        this.clip = null;
        this.cleanup();
        this.state = MIC_CAPTURE_IDLE;
        // The view must leave "recording" too, or the mic button and the live caption stay stuck on.
        this.ev.onView({ recording: false, interim: '', hangover: false, level: 0 });
        this.ev.onIssue(issue);
      }
    });
    // After the engine took the mic, so recognition always gets it first.
    this.recorder?.start();
    this.stopTicker = this.clock.every(MIC_FRAME_MS, () => this.frame());
    this.emit();
  }

  private frame(): void {
    if (!this.state.recording) return;
    const now = this.clock.now();
    const speaking = this.interim !== this.lastInterim;
    this.lastInterim = this.interim;
    if (speaking) {
      this.spoke = true;
      this.lastActivityAt = now;
    }
    const elapsed = now - this.startedAt;
    const pausedAtCap = elapsed >= MAX_TURN_MS && now - this.lastActivityAt >= PAUSE_AT_CAP_MS;
    if (elapsed >= HARD_TURN_MS || pausedAtCap || (!this.spoke && elapsed >= FIRST_SPEECH_WAIT_MS)) {
      this.state = MIC_CAPTURE_IDLE;
      this.finish();
      return;
    }
    if (this.spoke) {
      const next = reduceDialogMic(this.state, { type: 'frame', speaking, frameMs: MIC_FRAME_MS });
      this.state = next;
      if (!next.recording) {
        this.finish();
        return;
      }
    }
    this.emit();
  }

  private emit(): void {
    const now = this.clock.now();
    const quiet = now - this.lastActivityAt;
    const left = MAX_TURN_MS - (now - this.startedAt);
    this.ev.onView({
      ...(this.state.recording && this.spoke && left <= COUNTDOWN_MS ? { secondsLeft: Math.max(0, Math.ceil(left / 1000)) } : {}),
      recording: this.state.recording,
      interim: this.interim,
      hangover: this.spoke && quiet >= vadHangoverMs('conversation'),
      level: this.spoke ? Math.max(0, 1 - quiet / AUDIO_LIMITS.DIALOG_MIC_AUTO_STOP_SILENCE_MS) : 0.15
    });
  }

  private finish(): void {
    this.stopTicker?.();
    this.stopTicker = null;
    if (this.recorder && !this.clip) this.clip = this.recorder.stop();
    const s = this.session;
    if (s) {
      this.finishing = true;
      const gen = this.gen;
      const cancel = this.clock.every(this.engine.stopGraceMs ?? STOP_GRACE_MS, () => {
        cancel();
        if (gen !== this.gen || !this.finishing) return;
        // Use what was heard live rather than nothing (only when the live text is words, not a level signal).
        const said = this.engine.interimIsText === false ? '' : this.interim.trim();
        this.deliver(said ? { transcript: said, confidence: 0.5 } : null);
      });
      s.stop();
      // still waiting for the engine (the server rung's upload and Whisper): say "listening to your answer" meanwhile
      if (this.finishing && gen === this.gen) this.ev.onView({ recording: false, interim: this.interim, hangover: false, level: 0, processing: true });
    } else this.deliver(null);
  }

  private deliver(r: SpeechFinal | null): void {
    if (this.ended) return;
    this.ended = true;
    this.finishing = false;
    const dur = Math.round(this.clock.now() - this.startedAt);
    this.cleanup();
    this.state = MIC_CAPTURE_IDLE;
    this.ev.onView({ recording: false, interim: r?.transcript ?? this.interim, hangover: false, level: 0 });
    const heard = r && r.transcript.trim() ? r : null;
    noteMicTurn(!!heard);
    if (!heard) noteTurnLost('no_speech');
    if (this.recorder && !this.clip) this.clip = this.recorder.stop();
    const clip = this.clip;
    this.clip = null;
    if (heard && clip) this.ev.onFinal(heard, dur, clip);
    else this.ev.onFinal(heard, dur);
  }

  private cleanup(): void {
    this.stopTicker?.();
    this.stopTicker = null;
    this.session = null;
  }
}
