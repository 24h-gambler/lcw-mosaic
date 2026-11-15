/**
 * Short procedural sounds for the lesson layer (docs/12 §6.2 `dir.<event>`, procedural like PROCEDURAL_SFX_PRESETS)
 * until recorded event sounds exist. Played on the UI bus at low gain; the world may add its own on top.
 */
import { PROCEDURAL_SFX_PRESETS, type SynthParams } from '@lcw/audio';
import type { LessonDirectorEventKind } from '@lcw/content';

export const LESSON_EVENT_SFX: Record<LessonDirectorEventKind, SynthParams[]> = {
  weather_shift: [{ freqStart: 900, freqEnd: 300, durationMs: 700, wave: 'noise', gain: 0.18 }],
  blackout: [{ freqStart: 140, freqEnd: 60, durationMs: 160, wave: 'square', gain: 0.3 }],
  npc_prompt: [
    { freqStart: 1046.5, freqEnd: 1046.5, durationMs: 140, wave: 'sine', gain: 0.3 },
    { freqStart: 1318.5, freqEnd: 1318.5, durationMs: 200, wave: 'sine', gain: 0.3 }
  ],
  mentor_dungeon_gate: [{ freqStart: 196, freqEnd: 261.6, durationMs: 650, wave: 'triangle', gain: 0.35 }],
  review_chest: [{ freqStart: 523.3, freqEnd: 1046.5, durationMs: 300, wave: 'triangle', gain: 0.3 }],
  star_celebration: [
    { freqStart: 1567.98, freqEnd: 783.99, durationMs: 420, wave: 'sine', gain: 0.25 },
    { freqStart: 587.33, freqEnd: 1174.66, durationMs: 240, wave: 'triangle', gain: 0.35 }
  ]
};

const EXTRA: Record<'pass' | 'mic_on', SynthParams[]> = {
  pass: [PROCEDURAL_SFX_PRESETS['star.chime']!],
  mic_on: [PROCEDURAL_SFX_PRESETS['dlg.mic_on']!]
};

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  const g = globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const AC = g.AudioContext ?? g.webkitAudioContext; // older iOS Safari
  if (!AC) return null;
  ctx ??= new AC();
  return ctx;
}

/**
 * Call from a tap or key press: a context first made by a poll (no gesture, e.g. joined by `?code=`) starts
 * suspended, and only resume() inside a gesture lets event sounds play for the rest of the lesson.
 */
export function unlockLessonAudio(): void {
  try {
    const a = audio();
    if (a && a.state === 'suspended') void a.resume().catch(() => undefined);
  } catch {
    /* no audio on this device */
  }
}

function play(seq: SynthParams[]): void {
  try {
    const ctx = audio();
    if (!ctx) return;
    let t = ctx.currentTime;
    for (const p of seq) {
      const g = ctx.createGain();
      g.gain.setValueAtTime(p.gain * 0.5, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + p.durationMs / 1000);
      g.connect(ctx.destination);
      if (p.wave === 'noise') {
        const len = Math.ceil((ctx.sampleRate * p.durationMs) / 1000);
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const data = buf.getChannelData(0);
        // Deterministic noise (no Math.random): a simple LCG is enough for wind.
        let x = 1234567;
        for (let i = 0; i < len; i++) {
          x = (x * 1103515245 + 12345) & 0x7fffffff;
          data[i] = (x / 0x7fffffff) * 2 - 1;
        }
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(p.freqStart, t);
        bp.frequency.exponentialRampToValueAtTime(Math.max(40, p.freqEnd), t + p.durationMs / 1000);
        src.connect(bp).connect(g);
        src.start(t);
      } else {
        const o = ctx.createOscillator();
        o.type = p.wave;
        o.frequency.setValueAtTime(p.freqStart, t);
        o.frequency.exponentialRampToValueAtTime(Math.max(20, p.freqEnd), t + p.durationMs / 1000);
        o.connect(g);
        o.start(t);
        o.stop(t + p.durationMs / 1000 + 0.02);
      }
      t += p.durationMs / 1000;
    }
  } catch {
    /* audio blocked until a gesture, or not available: the banner still shows */
  }
}

export function playLessonSfx(kind: LessonDirectorEventKind | 'pass' | 'mic_on'): void {
  const seq = kind === 'pass' || kind === 'mic_on' ? EXTRA[kind] : LESSON_EVENT_SFX[kind];
  if (seq) play(seq);
}
