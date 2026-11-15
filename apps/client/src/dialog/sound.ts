import { LEVEL_DEFINITIONS, type LangLevel } from '@lcw/content';
import { PROCEDURAL_SFX_PRESETS, synthesizeProceduralPcm } from '@lcw/audio';

/**
 * Dialog sounds (docs/12 6.2 `dlg.*`, temporary procedural sounds of 6.4) and the NPC/offer voice (4.8).
 * Everything is optional: with sound off, blocked autoplay or no Web Audio the panel works the same (docs/12 10).
 */

type Ctx = { ctx: AudioContext } | null;
let shared: Ctx = null;

function audioCtx(): AudioContext | null {
  if (shared) return shared.ctx;
  const g = globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const C = g.AudioContext ?? g.webkitAudioContext;
  if (!C) return null;
  try {
    shared = { ctx: new C() };
    return shared.ctx;
  } catch {
    return null;
  }
}

/** Call from a tap handler (iOS unlocks audio only inside a user gesture). */
export function unlockDialogAudio(): void {
  const c = audioCtx();
  if (c && c.state === 'suspended') void c.resume().catch(() => undefined);
}

const SAMPLE_RATE = 24_000;

export function playSfx(id: keyof typeof PROCEDURAL_SFX_PRESETS | string, step = 0, delayMs = 0): void {
  const c = audioCtx();
  if (!c) return;
  try {
    const pcm = synthesizeProceduralPcm(id, SAMPLE_RATE, step);
    const buf = c.createBuffer(1, pcm.length, SAMPLE_RATE);
    buf.getChannelData(0).set(pcm);
    const src = c.createBufferSource();
    src.buffer = buf;
    src.connect(c.destination);
    src.start(c.currentTime + delayMs / 1000);
  } catch {
    /* sound is decoration only */
  }
}

/** docs/12 6.2 dlg.pass.N: one rising note per star, 80 ms apart. */
export function playPass(stars: number): void {
  for (let i = 0; i < Math.max(1, stars); i++) playSfx('word.hit', i * 2, i * 90);
  playSfx('coin.drop', 0, Math.max(1, stars) * 90 + 60);
}

export function playAgain(): void {
  playSfx('ui.click');
}

/**
 * Speaks an English line. Bank lines should come from pre-synthesized files (4.8); until those exist the
 * device voice (speechSynthesis, on-device, no upload) reads them at the level's speech rate.
 */
export function speakEnglish(text: string, level: LangLevel): Promise<void> {
  return new Promise((resolve) => {
    const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
    if (!synth || typeof SpeechSynthesisUtterance === 'undefined') {
      resolve();
      return;
    }
    try {
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-US';
      u.rate = LEVEL_DEFINITIONS[level].speechRate * 0.95;
      const voice = synth.getVoices().find((v) => v.lang === 'en-US') ?? synth.getVoices().find((v) => v.lang.startsWith('en'));
      if (voice) u.voice = voice;
      u.onend = () => resolve();
      u.onerror = () => resolve();
      synth.speak(u);
      // Some browsers never fire onend; never block the dialog on a voice.
      setTimeout(resolve, 400 + text.length * 90);
    } catch {
      resolve();
    }
  });
}

export function stopSpeaking(): void {
  try {
    window.speechSynthesis?.cancel();
  } catch {
    /* ignore */
  }
}
