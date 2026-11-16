import {
  BUS_DEFAULT_VOLUMES,
  DUCK_ATTACK_MS,
  DUCK_RELEASE_MS,
  MASTER_DEFAULT_VOLUME,
  createAudioEngine,
  synthesizeProceduralPcm,
  type AudioBusName,
  type AudioEngine,
  type DuckReason
} from '@lcw/audio';

/**
 * One WebAudio graph for the whole client (docs/12 2장 신호 흐름, WP-110):
 *
 *   bgm / amb / sfx / ui / voice_npc / call(voice_lesson) bus gains -> master 70% -> high-pass 40 Hz -> limiter -1 dB -> out
 *
 * The bus rules (caps, explosion merging, ducking table, mic order) live in `@lcw/audio`'s engine, which this runtime
 * drives with the real clock; here they become gain ramps on the bus nodes. World, dialog and lesson sounds connect
 * to `bus(name)` instead of each owning an AudioContext, so the mic and the NPC voice duck every game sound at once.
 * Everything is optional: no WebAudio (or before the first tap) means silence and the game works the same (docs/12 10).
 */

export const AUDIO_BUSES: readonly AudioBusName[] = ['bgm', 'amb', 'sfx', 'ui', 'voice_npc', 'voice_lesson'];

export interface RuntimeClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}

export interface AudioRuntimeOptions {
  clock?: RuntimeClock;
  /** Test seam: build the AudioContext (null = no WebAudio). */
  createContext?: () => AudioContext | null;
  /** Test seam: has the page had a tap or key press yet (navigator.userActivation)? */
  activated?: () => boolean;
  /** Called when a mic tap cuts the NPC voice (the device voice must actually stop). */
  cutNpcVoice?: () => void;
}

export interface AudioRuntime {
  readonly engine: AudioEngine;
  /** Creates (or resumes) the context. Call from a tap: browsers keep audio locked until the first gesture. */
  unlock(): AudioContext | null;
  context(): AudioContext | null;
  /** The bus input node to connect a sound to (null without WebAudio). */
  bus(name: AudioBusName): AudioNode | null;
  /** Asks the bus rules whether a sound may start now (caps, mic-open silence, explosion merging). */
  admit(id: string, bus: AudioBusName, durationMs: number): { ok: boolean; boostDb?: number; mergedInto?: number };
  duck(reason: DuckReason, on: boolean): void;
  npcVoiceStarted(estimatedMs: number): void;
  npcVoiceEnded(): void;
  /**
   * docs/12 3장 순서: NPC voice ends (a tap cuts it) -> 150 ms -> rising cue -> recording starts after the cue.
   * Resolves true when recording may start, false if cancelled (a second tap, the window closed).
   */
  micCue(): Promise<boolean>;
  cancelMic(): void;
  /** Recording ended: the mic duck releases over 400 ms. */
  micClosed(): void;
  setHidden(hidden: boolean): void;
  /** Current bus gains the graph is heading to (for checks). */
  targets(): Record<AudioBusName, number>;
}

const realClock: RuntimeClock = {
  now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>)
};

function pageActivated(): boolean {
  const ua = (globalThis as { navigator?: { userActivation?: { hasBeenActive?: boolean } } }).navigator?.userActivation;
  // Browsers without the API (older Safari) keep the old behaviour: build now, resume on the gesture.
  return ua?.hasBeenActive !== false;
}

/**
 * Runs `cb` once, right after the page's first real activation. On a touch screen the first pointerdown is not an
 * activation yet (Chrome activates on pointerup / click / touchend), so a sound started from pointerdown could not
 * open audio on the first tap; listening here (capture, passive) opens it on that same tap. Returns a stop function.
 */
export function onPageActivation(cb: () => void, target: Pick<Window, 'addEventListener' | 'removeEventListener'> | null = typeof window === 'undefined' ? null : window): () => void {
  if (!target) return () => undefined;
  const events = ['pointerup', 'click', 'touchend', 'keydown'] as const;
  let done = false;
  const off = (): void => {
    for (const e of events) target.removeEventListener(e, handler, true);
  };
  function handler(): void {
    if (done || !pageActivated()) return;
    done = true;
    off();
    cb();
  }
  for (const e of events) target.addEventListener(e, handler, { capture: true, passive: true });
  return () => {
    done = true;
    off();
  };
}

function browserContext(): AudioContext | null {
  const g = globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const C = g.AudioContext ?? g.webkitAudioContext;
  if (!C) return null;
  try {
    return new C();
  } catch {
    return null;
  }
}

export function createAudioRuntime(opts: AudioRuntimeOptions = {}): AudioRuntime {
  const clock = opts.clock ?? realClock;
  const engine = createAudioEngine(clock.now());
  engine.unlock();
  let ctx: AudioContext | null = null;
  let tried = false;
  const buses = new Map<AudioBusName, GainNode>();
  let micTimer: unknown = null;
  let micResolve: ((ok: boolean) => void) | null = null;

  function build(): void {
    if (tried) return;
    // Before the first tap a context only starts suspended and Chrome logs "The AudioContext was not allowed to start"
    // on every child page (a lesson poll cue, a world sound): wait for the gesture; the next unlock() builds it.
    if (!(opts.activated ?? pageActivated)()) return;
    tried = true;
    ctx = (opts.createContext ?? browserContext)();
    if (!ctx) return;
    try {
      const master = ctx.createGain();
      master.gain.value = MASTER_DEFAULT_VOLUME;
      // docs/12 4장: below 40 Hz is cut (small speakers, fatigue), limiter ceiling -1 dB.
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 40;
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -1;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.1;
      master.connect(hp).connect(limiter).connect(ctx.destination);
      for (const name of AUDIO_BUSES) {
        const g = ctx.createGain();
        g.gain.value = engine.getEffectiveBusGain(name);
        g.connect(master);
        buses.set(name, g);
      }
    } catch {
      ctx = null;
      buses.clear();
    }
  }

  function apply(rampMs: number): void {
    const c = ctx;
    for (const name of AUDIO_BUSES) {
      const node = buses.get(name);
      if (!node || !c) continue;
      const target = engine.getEffectiveBusGain(name);
      try {
        node.gain.cancelScheduledValues(c.currentTime);
        node.gain.setValueAtTime(node.gain.value, c.currentTime);
        if (rampMs <= 0) node.gain.setValueAtTime(target, c.currentTime);
        // setTargetAtTime reaches ~95% after three time constants.
        else node.gain.setTargetAtTime(target, c.currentTime, rampMs / 3000);
      } catch {
        node.gain.value = target;
      }
    }
  }

  function duck(reason: DuckReason, on: boolean): void {
    const was = engine.getSnapshot().activeDuckReasons.includes(reason);
    if (was === on) return;
    engine.duck(reason, on);
    apply(on ? DUCK_ATTACK_MS : DUCK_RELEASE_MS[reason]);
  }

  function playCue(): void {
    const c = ctx;
    const ui = buses.get('ui');
    if (!c || !ui) return;
    try {
      const rate = 24_000;
      const pcm = synthesizeProceduralPcm('dlg.mic_on', rate);
      const buf = c.createBuffer(1, pcm.length, rate);
      buf.getChannelData(0).set(pcm);
      const src = c.createBufferSource();
      src.buffer = buf;
      src.connect(ui);
      src.start();
    } catch {
      /* decoration only */
    }
  }

  function settleMic(ok: boolean): void {
    if (micTimer !== null) clock.clearTimeout(micTimer);
    micTimer = null;
    const r = micResolve;
    micResolve = null;
    r?.(ok);
  }

  const rt: AudioRuntime = {
    engine,
    unlock() {
      build();
      if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
      return ctx;
    },
    context: () => ctx,
    bus(name) {
      return buses.get(name) ?? null;
    },
    admit(id, bus, durationMs) {
      const r = engine.play(id, { bus, nowMs: clock.now(), durationMs });
      if (r.mergedInto !== undefined) return { ok: false, mergedInto: r.mergedInto, boostDb: r.boostDb };
      return { ok: r.played };
    },
    duck,
    npcVoiceStarted(estimatedMs) {
      engine.voice.say('npc', { nowMs: clock.now(), durationMs: Math.max(200, estimatedMs) });
      apply(DUCK_ATTACK_MS);
    },
    npcVoiceEnded() {
      if (!engine.voice.npcSpeaking(clock.now())) return;
      engine.voice.npcEnded(clock.now());
      apply(DUCK_RELEASE_MS.npc_speaking);
    },
    micCue() {
      settleMic(false);
      const now = clock.now();
      if (engine.voice.npcSpeaking(now)) opts.cutNpcVoice?.();
      const s = engine.voice.requestMic(now);
      apply(DUCK_RELEASE_MS.npc_speaking);
      return new Promise<boolean>((resolve) => {
        micResolve = resolve;
        const cueIn = Math.max(0, s.micOnCueAtMs - now);
        micTimer = clock.setTimeout(() => {
          playCue();
          engine.voice.completeMicOpenDelay(s.micOnCueAtMs);
          micTimer = clock.setTimeout(() => {
            micTimer = null;
            if (!engine.voice.completeMicOpenDelay(Math.max(clock.now(), s.recordingStartedAtMs))) {
              settleMic(false);
              return;
            }
            apply(DUCK_ATTACK_MS);
            settleMic(true);
          }, s.recordingStartedAtMs - s.micOnCueAtMs);
        }, cueIn);
      });
    },
    cancelMic() {
      if (!micResolve) return;
      engine.voice.stopMic(clock.now());
      settleMic(false);
      apply(DUCK_RELEASE_MS.mic_open);
    },
    micClosed() {
      if (!engine.getSnapshot().micOpen) return;
      engine.voice.stopMic(clock.now());
      apply(DUCK_RELEASE_MS.mic_open);
    },
    setHidden(hidden) {
      engine.setHidden(hidden);
      apply(hidden ? 0 : DUCK_RELEASE_MS.npc_speaking);
    },
    targets() {
      return Object.fromEntries(AUDIO_BUSES.map((b) => [b, engine.getEffectiveBusGain(b)])) as Record<AudioBusName, number>;
    }
  };
  return rt;
}

let shared: AudioRuntime | null = null;

/** Fired when the mic cuts a speaking NPC; the neural voice (dialog/sound.ts) stops on it like speechSynthesis. */
export const NPC_VOICE_CUT_EVENT = 'lcw:npc-voice-cut';

/** The page's one runtime. The NPC voice cut uses the device voice (speechSynthesis). */
export function getAudioRuntime(): AudioRuntime {
  if (shared) return shared;
  shared = createAudioRuntime({
    cutNpcVoice: () => {
      try {
        globalThis.speechSynthesis?.cancel();
      } catch {
        /* ignore */
      }
      try {
        globalThis.dispatchEvent?.(new Event(NPC_VOICE_CUT_EVENT));
      } catch {
        /* ignore */
      }
    }
  });
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => shared?.setHidden(document.visibilityState === 'hidden'));
    // Verification handle like `window.__lcwWorld` (bus targets, duck reasons, mic state); no child data in it.
    (globalThis as { __lcwAudio?: AudioRuntime }).__lcwAudio = shared;
  }
  return shared;
}

/** Bus default volumes, re-exported for settings screens. */
export { BUS_DEFAULT_VOLUMES };
