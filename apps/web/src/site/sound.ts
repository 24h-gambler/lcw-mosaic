/**
 * Browser-only voice and blips for the site and /try. NPC lines use speechSynthesis (no server, no recording);
 * small UI sounds are synthesised with WebAudio so no audio file (and no licence question) is involved (12 §5.3).
 */

let ctx: AudioContext | null = null;
let soundOn = false;

export function setSoundOn(on: boolean): void {
  soundOn = on;
  if (on) {
    try {
      const AC: typeof AudioContext | undefined =
        typeof window !== 'undefined'
          ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
          : undefined;
      if (AC && !ctx) ctx = new AC();
      void ctx?.resume();
    } catch {
      ctx = null;
    }
  }
}

export function isSoundOn(): boolean {
  return soundOn;
}

export type Blip = 'tap' | 'pop' | 'star' | 'gulp' | 'step';

const BLIPS: Record<Blip, { f: number[]; ms: number; type: OscillatorType; gain: number }> = {
  tap: { f: [660], ms: 60, type: 'square', gain: 0.04 },
  step: { f: [220], ms: 40, type: 'triangle', gain: 0.05 },
  pop: { f: [520, 780], ms: 110, type: 'square', gain: 0.05 },
  star: { f: [784, 988, 1175], ms: 120, type: 'triangle', gain: 0.07 },
  gulp: { f: [300, 240, 200], ms: 90, type: 'sine', gain: 0.08 }
};

export function blip(kind: Blip): void {
  if (!soundOn || !ctx) return;
  const spec = BLIPS[kind];
  let t = ctx.currentTime;
  for (const f of spec.f) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = spec.type;
    osc.frequency.value = f;
    g.gain.setValueAtTime(spec.gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + spec.ms / 1000);
    osc.connect(g).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + spec.ms / 1000 + 0.02);
    t += spec.ms / 1000;
  }
}

export function canSpeak(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/** Speak an English line. `force` plays even with sound off (an explicit [듣기] tap is consent to sound). */
export function sayEnglish(text: string, opts: { force?: boolean; rate?: number; onEnd?: () => void } = {}): void {
  if (!canSpeak() || (!soundOn && !opts.force)) {
    opts.onEnd?.();
    return;
  }
  try {
    const synth = window.speechSynthesis;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = opts.rate ?? 0.92;
    const voice = synth.getVoices().find((v) => v.lang.startsWith('en-US')) ?? synth.getVoices().find((v) => v.lang.startsWith('en'));
    if (voice) u.voice = voice;
    if (opts.onEnd) u.onend = () => opts.onEnd?.();
    synth.speak(u);
  } catch {
    opts.onEnd?.();
  }
}

export function stopSpeaking(): void {
  if (canSpeak()) window.speechSynthesis.cancel();
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}
