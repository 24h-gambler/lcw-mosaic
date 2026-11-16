import { LEVEL_DEFINITIONS, type LangLevel, type NpcVoice } from '@lcw/content';
import { PROCEDURAL_SFX_PRESETS, synthesizeProceduralPcm, type AudioBusName } from '@lcw/audio';
import { getAudioRuntime, NPC_VOICE_CUT_EVENT } from '../audio/runtime.js';
import { loadLine, loudnessGain, NEURAL_VOICE, neuralVoiceStatus, neuralVoiceStatusKnown, within } from './neural-voice.js';

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
 * Speaks an English line (docs/04 4.8). With the neural voice on (neural-voice.ts) and a `voice` given, the line comes
 * from the server in that NPC's voice (R2-cached) on the NPC voice bus; when it is off, slower than
 * NEURAL_VOICE.waitMs or failing, the device voice (speechSynthesis, on-device, no upload) reads it at the level's
 * speech rate.
 */
let speechGen = 0;
/** The neural line now playing (an AudioBufferSource on the voice bus, or a plain <audio> when Web Audio is locked). */
let neuralPlaying: { stop(): void } | null = null;

function stopNeural(): void {
  const p = neuralPlaying;
  neuralPlaying = null;
  try {
    p?.stop();
  } catch {
    /* ignore */
  }
}

if (typeof globalThis.addEventListener === 'function') globalThis.addEventListener(NPC_VOICE_CUT_EVENT, stopNeural);

export function speakEnglish(text: string, level: LangLevel, voice?: NpcVoice): Promise<void> {
  if (voice && typeof Audio !== 'undefined' && neuralVoiceStatusKnown() !== false) {
    const gen = ++speechGen;
    // The first line of a page may come before the status answer: wait for it inside the same budget.
    const t0 = Date.now();
    return within(neuralVoiceStatus(), NEURAL_VOICE.waitMs).then((on) => {
      if (gen !== speechGen) return;
      if (!on) return speakDevice(text, level);
      return within(loadLine(voice, text), Math.max(0, NEURAL_VOICE.waitMs - (Date.now() - t0))).then((bytes) => {
        if (gen !== speechGen) return; // a newer line (or stop) took over while this one loaded
        if (!bytes) return speakDevice(text, level);
        return playNeural(bytes, gen).then((ok) => (ok || gen !== speechGen ? undefined : speakDevice(text, level)));
      });
    });
  }
  return speakDevice(text, level);
}

/**
 * Plays one neural line at its own pace (no time-stretch: stretching a natural voice to the level's 0.9 rate made it
 * sound processed). Web Audio first: once the runtime's context runs (any earlier tap), a buffer source plays without
 * the media autoplay rules that block a late `<audio>.play()` on phones. If the context cannot run, a plain `<audio>`
 * plays it; false when neither could start, so the caller reads it with the device voice.
 */
async function playNeural(bytes: ArrayBuffer, gen: number): Promise<boolean> {
  const rt = getAudioRuntime();
  const c = rt.unlock();
  stopNeural();
  try {
    window.speechSynthesis?.cancel();
  } catch {
    /* ignore */
  }
  if (c && c.state !== 'running') await within(c.resume().then(() => true).catch(() => null), 300);
  if (gen !== speechGen) return true;
  if (c && c.state === 'running') {
    let decoded: AudioBuffer | null = null;
    try {
      decoded = await c.decodeAudioData(bytes.slice(0));
    } catch {
      decoded = null;
    }
    if (gen !== speechGen) return true;
    if (decoded) {
      const buf = decoded;
      return new Promise<boolean>((resolve) => {
        const src = c.createBufferSource();
        src.buffer = buf;
        const g = c.createGain();
        g.gain.value = loudnessGain(buf.getChannelData(0));
        src.connect(g).connect(rt.bus('voice_npc') ?? c.destination);
        let finished = false;
        const end = () => {
          if (finished) return;
          finished = true;
          if (neuralPlaying === handle) neuralPlaying = null;
          if (gen === speechGen) rt.npcVoiceEnded();
          resolve(true);
        };
        const handle = {
          stop() {
            try {
              src.stop();
            } catch {
              /* not started */
            }
            end();
          }
        };
        neuralPlaying = handle;
        src.onended = end;
        rt.npcVoiceStarted(buf.duration * 1000);
        src.start();
      });
    }
  }
  // Web Audio locked or the bytes would not decode there: a plain media element at its own level.
  const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }));
  const a = new Audio();
  a.preload = 'auto';
  a.src = url;
  return new Promise<boolean>((resolve) => {
    let started = false;
    let finished = false;
    const end = (ok: boolean) => {
      if (finished) return;
      finished = true;
      if (neuralPlaying === handle) neuralPlaying = null;
      // Detach the element before revoking: revoking a blob it is still loading (play blocked before the first tap, a
      // newer line took over) made Chrome log "Failed to load resource: net::ERR_FILE_NOT_FOUND" on the child's page.
      try {
        a.onerror = null;
        a.pause();
        a.removeAttribute('src');
        a.load();
      } catch {
        /* ignore */
      }
      URL.revokeObjectURL(url);
      if (started && gen === speechGen) rt.npcVoiceEnded();
      resolve(ok || started);
    };
    const handle = {
      stop() {
        a.pause();
        end(true);
      }
    };
    neuralPlaying = handle;
    a.onplaying = () => {
      if (started) return;
      started = true;
      rt.npcVoiceStarted((Number.isFinite(a.duration) ? a.duration : 3) * 1000);
    };
    a.onended = () => end(true);
    a.onerror = () => end(false);
    a.play().catch(() => end(false));
  });
}

function speakDevice(text: string, level: LangLevel): Promise<void> {
  return new Promise<void>((done) => {
    const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
    if (!synth || typeof SpeechSynthesisUtterance === 'undefined') {
      done();
      return;
    }
    // The NPC voice ducks music/ambience/effects (docs/12 3장 "NPC가 말하는 중") until it ends.
    const rt = getAudioRuntime();
    const gen = ++speechGen;
    rt.npcVoiceStarted(400 + text.length * 90);
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
  stopNeural();
  try {
    window.speechSynthesis?.cancel();
  } catch {
    /* ignore */
  }
  speechGen++;
  getAudioRuntime().npcVoiceEnded();
}
