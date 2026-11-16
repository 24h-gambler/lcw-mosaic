import { normalizeTtsText, npcCast, ttsVoiceId, voiceForCtx } from '@lcw/content';

/**
 * Voice and blips for the site and /try. English lines play in the same neural voices as the world (edge `/v1/tts`,
 * Workers AI Aura-2, R2-cached; the site's sentences are fixed lines in @lcw/content SITE_SPOKEN_LINES, so visitors
 * need no token). Only when that fails or is off does the device voice (speechSynthesis) read it. Nothing is recorded.
 * Small UI sounds are synthesised with WebAudio so no audio file (and no licence question) is involved (12 §5.3).
 */

let ctx: AudioContext | null = null;
let soundOn = false;

function ensureCtx(): AudioContext | null {
  try {
    const AC: typeof AudioContext | undefined =
      typeof window !== 'undefined'
        ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
        : undefined;
    if (AC && !ctx) ctx = new AC();
    void ctx?.resume().catch(() => undefined);
  } catch {
    ctx = null;
  }
  return ctx;
}

export function setSoundOn(on: boolean): void {
  soundOn = on;
  if (on) ensureCtx();
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

/** A line not here by then is read by the device voice (a new aura-2 line takes 1.3-2.3 s, a cached one ~0.1 s). */
export const SITE_VOICE_WAIT_MS = 4000;

let voiceGen = 0;
let playing: { stop(): void } | null = null;

function stopNeural(): void {
  const p = playing;
  playing = null;
  try {
    p?.stop();
  } catch {
    /* ignore */
  }
}

async function fetchLine(url: string): Promise<ArrayBuffer | null> {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const t = setTimeout(() => ctl?.abort(), SITE_VOICE_WAIT_MS);
  try {
    const r = await fetch(url, ctl ? { signal: ctl.signal } : undefined);
    if (!r.ok || !(r.headers.get('content-type') ?? '').startsWith('audio/')) return null;
    return await r.arrayBuffer();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** Plays the neural line; false when it could not (off, refused, slow, locked audio) so the device voice reads it. */
async function playNeural(text: string, who: 'npc' | 'model', gen: number, onEnd?: () => void): Promise<boolean> {
  if (typeof fetch === 'undefined') return false;
  const voice = who === 'npc' ? voiceForCtx('cafe') : npcCast().modelVoice;
  // headless checks (navigator.webdriver) hear cached lines only, never spend the day's neurons (edge tts.ts c=1)
  const auto = typeof navigator !== 'undefined' && navigator.webdriver === true;
  const url = `/v1/tts?v=${encodeURIComponent(ttsVoiceId(voice))}&t=${encodeURIComponent(normalizeTtsText(text))}${auto ? '&c=1' : ''}`;
  const c = ensureCtx();
  const bytes = await fetchLine(url);
  if (gen !== voiceGen) return true;
  if (!bytes) return false;
  if (c) {
    if (c.state !== 'running') await Promise.race([c.resume().catch(() => undefined), new Promise((r) => setTimeout(r, 300))]);
    if (c.state === 'running') {
      try {
        const buf = await c.decodeAudioData(bytes.slice(0));
        if (gen !== voiceGen) return true;
        const src = c.createBufferSource();
        src.buffer = buf;
        src.connect(c.destination);
        let done = false;
        const end = () => {
          if (done) return;
          done = true;
          if (playing === handle) playing = null;
          onEnd?.();
        };
        const handle = {
          stop() {
            try {
              src.stop();
            } catch {
              /* not started */
            }
          }
        };
        src.onended = end;
        playing = handle;
        src.start();
        return true;
      } catch {
        /* try a media element */
      }
    }
  }
  if (typeof Audio === 'undefined') return false;
  const objUrl = URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }));
  const a = new Audio(objUrl);
  try {
    await a.play();
  } catch {
    URL.revokeObjectURL(objUrl);
    return false;
  }
  playing = { stop: () => a.pause() };
  a.onended = () => {
    URL.revokeObjectURL(objUrl);
    onEnd?.();
  };
  return true;
}

/**
 * Speak an English line in the neural voice (`who`: the /try cafe owner or the model-sentence voice). `force` plays
 * even with sound off (an explicit [듣기] tap is consent to sound).
 */
export function sayEnglish(text: string, opts: { force?: boolean; rate?: number; onEnd?: () => void; who?: 'npc' | 'model' } = {}): void {
  if (!soundOn && !opts.force) {
    opts.onEnd?.();
    return;
  }
  stopNeural();
  if (canSpeak()) window.speechSynthesis.cancel();
  const gen = ++voiceGen;
  void playNeural(text, opts.who ?? 'model', gen, opts.onEnd).then((ok) => {
    if (!ok && gen === voiceGen) sayDevice(text, opts);
  });
}

function sayDevice(text: string, opts: { rate?: number; onEnd?: () => void }): void {
  if (!canSpeak()) {
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
  voiceGen++;
  stopNeural();
  if (canSpeak()) window.speechSynthesis.cancel();
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}
