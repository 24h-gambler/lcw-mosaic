import { AUDIO_LIMITS, MIC_CAPTURE_IDLE, reduceDialogMic, vadHangoverMs, type MicCaptureState } from '@lcw/audio';
import type { MicIssue, SpeechEngine, SpeechFinal, SpeechSession } from './speech.js';

/**
 * Dialog microphone (docs/08 7.1, docs/12 9): tap to start, tap again to finish, or auto-stop after
 * DIALOG_MIC_AUTO_STOP_SILENCE_MS of silence once the child has started speaking (reduceDialogMic).
 * After the conversation VAD hangover (1,500 ms) of silence the panel nudges "다 말했으면 한 번 더 눌러요".
 * A child who has not started yet gets FIRST_SPEECH_WAIT_MS before the turn ends (4.1: 6 s silence → re-prompt),
 * and one turn never exceeds MAX_TURN_MS (4.1: 12 s).
 */

export const MIC_FRAME_MS = 100;
export const FIRST_SPEECH_WAIT_MS = 6_000;
export const MAX_TURN_MS = 12_000;

export interface MicView {
  recording: boolean;
  interim: string;
  /** Silence since the child last spoke passed the VAD hangover. */
  hangover: boolean;
  /** 0..1 level for the bar animation (recent speech activity). */
  level: number;
}

export interface MicControllerEvents {
  onView(v: MicView): void;
  onFinal(r: SpeechFinal | null, durMs: number): void;
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

  constructor(
    private readonly engine: SpeechEngine,
    private readonly ev: MicControllerEvents,
    private readonly clock: Clock = realClock
  ) {}

  get recording(): boolean {
    return this.state.recording;
  }

  /** The one mic button: start when idle, finish when recording. */
  tap(): void {
    const next = reduceDialogMic(this.state, { type: 'tap' });
    if (next.recording && !this.state.recording) this.begin();
    else if (!next.recording && this.state.recording) this.finish();
    this.state = next;
  }

  dispose(): void {
    this.stopTicker?.();
    this.stopTicker = null;
    this.session?.abort();
    this.session = null;
    this.state = MIC_CAPTURE_IDLE;
  }

  private begin(): void {
    this.ended = false;
    this.spoke = false;
    this.interim = '';
    this.lastInterim = '';
    this.startedAt = this.clock.now();
    this.lastActivityAt = this.startedAt;
    this.session = this.engine.start({
      onInterim: (text) => {
        this.interim = text;
      },
      onEnd: (r) => this.deliver(r),
      onError: (issue) => {
        this.cleanup();
        this.state = MIC_CAPTURE_IDLE;
        this.ev.onIssue(issue);
      }
    });
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
    if (elapsed >= MAX_TURN_MS || (!this.spoke && elapsed >= FIRST_SPEECH_WAIT_MS)) {
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
    this.ev.onView({
      recording: this.state.recording,
      interim: this.interim,
      hangover: this.spoke && quiet >= vadHangoverMs('conversation'),
      level: this.spoke ? Math.max(0, 1 - quiet / AUDIO_LIMITS.DIALOG_MIC_AUTO_STOP_SILENCE_MS) : 0.15
    });
  }

  private finish(): void {
    this.stopTicker?.();
    this.stopTicker = null;
    const s = this.session;
    if (s) s.stop();
    else this.deliver(null);
  }

  private deliver(r: SpeechFinal | null): void {
    if (this.ended) return;
    this.ended = true;
    const dur = Math.round(this.clock.now() - this.startedAt);
    this.cleanup();
    this.state = MIC_CAPTURE_IDLE;
    this.ev.onView({ recording: false, interim: r?.transcript ?? this.interim, hangover: false, level: 0 });
    this.ev.onFinal(r && r.transcript.trim() ? r : null, dur);
  }

  private cleanup(): void {
    this.stopTicker?.();
    this.stopTicker = null;
    this.session = null;
  }
}
