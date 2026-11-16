import { LEVEL_DEFINITIONS, type LangLevel } from '@lcw/content';
import { PROCEDURAL_SFX_PRESETS, synthesizeProceduralPcm, type AudioBusName } from '@lcw/audio';
import { getAudioRuntime } from '../audio/runtime.js';
import { frameSettings, pickEnglishVoice } from '../frame/settings.js';

/**
 * Dialog sounds (docs/12 6.2 `dlg.*`, temporary procedural sounds of 6.4) and the NPC/offer voice (4.8), on the
 * page's one audio graph (`audio/runtime.ts`): dialog cues go to the UI bus, the NPC voice ducks every game sound,
 * and the mic only records after the NPC voice, a 150 ms pause and the rising cue (docs/12 3장).
 * Everything is optional: with sound off, blocked autoplay or no Web Audio the panel works the same (docs/12 10).
 */

/** Call from a tap handler (iOS unlocks audio only inside a user gesture). */
export function unlockDialogAudio(): void {
  getAudioRuntime().unlock();
}

const SAMPLE_RATE = 24_000;

/** Dialog feedback is UI (buttons, stars, coins, review cues); anything else goes to the effects bus. */
export function busOf(id: string): AudioBusName {
  return /^(dlg|ui|word|coin|star|mem)\./.test(id) ? 'ui' : 'sfx';
}

export function playSfx(id: keyof typeof PROCEDURAL_SFX_PRESETS | string, step = 0, delayMs = 0): void {
  const rt = getAudioRuntime();
  const c = rt.unlock();
  const bus = busOf(id);
  const out = rt.bus(bus);
  if (!c || !out) return;
  if (!rt.admit(id, bus, (PROCEDURAL_SFX_PRESETS[id]?.durationMs ?? 120) + delayMs).ok) return;
  try {
    const pcm = synthesizeProceduralPcm(id, SAMPLE_RATE, step);
    const buf = c.createBuffer(1, pcm.length, SAMPLE_RATE);
    buf.getChannelData(0).set(pcm);
    const src = c.createBufferSource();
    src.buffer = buf;
    src.connect(out);
    src.start(c.currentTime + delayMs / 1000);
  } catch {
    /* sound is decoration only */
  }
}

/**
 * docs/12 3장 마이크 순서: cuts a speaking NPC, waits 150 ms, plays the rising cue, and resolves true when recording
 * may start (after the cue, so it never lands in recognition). A second call or `cancelMicCue` resolves false.
 */
export function micCue(): Promise<boolean> {
  return getAudioRuntime().micCue();
}

export function cancelMicCue(): void {
  getAudioRuntime().cancelMic();
}

/** Recording ended: music and effects come back over 400 ms. */
export function micClosed(): void {
  getAudioRuntime().micClosed();
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
let speechGen = 0;

export function speakEnglish(text: string, level: LangLevel): Promise<void> {
  return new Promise<void>((done) => {
    const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
    if (!synth || typeof SpeechSynthesisUtterance === 'undefined') {
      done();
      return;
    }
    // The NPC voice ducks music/ambience/effects (docs/12 3장 "NPC가 말하는 중") until it ends.
    const rt = getAudioRuntime();
    const gen = ++speechGen;
    // Player settings (G14): voice speed (slower for young children) and natural (neural) voice on/off.
    const pref = frameSettings();
    const estMs = (400 + text.length * 90) / pref.voiceRate;
    rt.npcVoiceStarted(estMs);
    let ended = false;
    const resolve = () => {
      if (ended) return;
      ended = true;
      // An older line's late onend (cancelled by this one) must not lift the duck of the line now speaking.
      if (gen === speechGen) rt.npcVoiceEnded();
      done();
    };
    try {
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-US';
      u.rate = LEVEL_DEFINITIONS[level].speechRate * 0.95 * pref.voiceRate;
      // The device voice is not on the WebAudio graph: the player's voice volume (G14) reaches it here.
      u.volume = Math.min(1, Math.max(0, rt.engine.getSnapshot().busVolumes.voice_npc));
      const voice = pickEnglishVoice(synth.getVoices(), pref.neuralVoice);
      if (voice) u.voice = voice;
      u.onend = () => resolve();
      u.onerror = () => resolve();
      synth.speak(u);
      // Some browsers never fire onend; never block the dialog on a voice.
      setTimeout(resolve, estMs);
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
  speechGen++;
  getAudioRuntime().npcVoiceEnded();
}
