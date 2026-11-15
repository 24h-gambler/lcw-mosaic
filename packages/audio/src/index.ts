export type AudioBusName = 'ui' | 'sfx' | 'amb' | 'bgm' | 'voice_npc' | 'voice_lesson';

export type DuckReason =
  | 'mic_open'
  | 'npc_speaking'
  | 'lesson_active'
  | 'lesson_vad'
  | 'skill_or_bubble'
  | 'lesson_window';

export type VadMode = 'conversation' | 'skill';

export function vadHangoverMs(mode: VadMode): number {
  return mode === 'skill' ? AUDIO_LIMITS.VAD_HANGOVER_MS : AUDIO_LIMITS.VAD_HANGOVER_CONVERSATION_MS;
}

export type MicContext = 'dialog' | 'combat_skill';
export type MicInputMode = 'tap_toggle' | 'hold';

/** docs/08 7.1-7.2: dialog = tap to start + tap to finish; only combat voice skill (V) is push-to-hold. */
export function micInputModeFor(context: MicContext): MicInputMode {
  return context === 'combat_skill' ? 'hold' : 'tap_toggle';
}

export interface MicCaptureState {
  recording: boolean;
  silenceMs: number;
}

export type MicCaptureEvent =
  | { type: 'tap' }
  | { type: 'frame'; speaking: boolean; frameMs: number };

export const MIC_CAPTURE_IDLE: MicCaptureState = { recording: false, silenceMs: 0 };

/**
 * Pure reducer for the dialog mic (tap-to-start, tap-to-finish, or auto-stop after
 * DIALOG_MIC_AUTO_STOP_SILENCE_MS of trailing silence once the child has spoken).
 */
export function reduceDialogMic(state: MicCaptureState, event: MicCaptureEvent): MicCaptureState {
  if (event.type === 'tap') {
    return state.recording ? { recording: false, silenceMs: 0 } : { recording: true, silenceMs: 0 };
  }
  if (!state.recording) return state;
  if (event.speaking) return { recording: true, silenceMs: 0 };
  const silenceMs = state.silenceMs + event.frameMs;
  if (silenceMs >= AUDIO_LIMITS.DIALOG_MIC_AUTO_STOP_SILENCE_MS) return { recording: false, silenceMs: 0 };
  return { recording: true, silenceMs };
}

export type MusicSector = 'plaza' | 'market' | 'wilds' | 'shelter' | 'mentor_dungeon';
export type MusicMoodState = 'calm' | 'explore' | 'tense' | 'celebrate';

export const AUDIO_LIMITS = {
  MASTER_PEAK_DBFS: -1.0,
  MASTER_PEAK_LINEAR: 0.89125, // 10^(-1 / 20)
  NPC_END_TO_MIC_ON_MS: 150,
  EXPLOSION_COALESCE_WINDOW_MS: 100,
  EXPLOSION_MAX_SIMULTANEOUS: 3,
  EXPLOSION_MERGE_MAX_BOOST_DB: 3,
  VAD_FRAME_MS: 20,
  VAD_SPEECH_START_MS: 300,
  /** Combat voice skills (docs/04 4.11): fast end-of-utterance. */
  VAD_HANGOVER_MS: 500,
  /** General conversation / lessons (docs/12 9): L2 children pause 1.0-1.8s mid-clause. */
  VAD_HANGOVER_CONVERSATION_MS: 1500,
  /** Dialog window (G02) tap-to-talk auto-stop after this much silence (docs/08 7.1). */
  DIALOG_MIC_AUTO_STOP_SILENCE_MS: 2500,
  TURN_TAKING_MAX_GAP_MS: 2000,
  OPUS_SAMPLE_RATE_HZ: 16_000,
  SPATIAL_MAX_DISTANCE: 28
} as const;

/** docs/12 2장 동시 재생 상한. `voice_lesson` is the call bus (lesson teacher and approved friends' real voices). */
export const BUS_CAPS: Record<AudioBusName, number> = {
  ui: 4,
  sfx: 16,
  amb: 4,
  bgm: 3,
  voice_npc: 2,
  voice_lesson: 8
};

/** docs/12 2장 기본 음량 and 4장 "기본 마스터 음량 70%". */
export const BUS_DEFAULT_VOLUMES: Record<AudioBusName, number> = {
  bgm: 0.6,
  amb: 0.7,
  sfx: 0.85,
  ui: 0.85,
  voice_npc: 1,
  voice_lesson: 1
};
export const MASTER_DEFAULT_VOLUME = 0.7;

/** docs/12 2장: over a cap, lower-priority and older sounds stop first (call > NPC voice > UI > SFX > ambience). */
export const BUS_PRIORITY: Record<AudioBusName, number> = {
  voice_lesson: 50,
  voice_npc: 40,
  ui: 30,
  sfx: 20,
  amb: 10,
  bgm: 5
};

export const BUS_LUFS_TARGETS: Record<AudioBusName, number> = {
  ui: -18,
  sfx: -14,
  amb: -26,
  bgm: -24,
  voice_npc: -16,
  voice_lesson: -16
};

/**
 * docs/12 3장 덕킹 표, in dB per bus while a reason is active. Overlapping reasons take the deepest cut per bus
 * (never the sum). The guardian lesson window plays no game sound at all: only the call bus is left.
 * While the mic is open NPC voice and UI sounds are not played at all (3장 순서 5), see `play`.
 */
export const DUCK_TABLE_DB: Record<DuckReason, Partial<Record<AudioBusName, number>>> = {
  mic_open: { bgm: -24, amb: -18, sfx: -12 },
  npc_speaking: { bgm: -12, amb: -9, sfx: -6 },
  lesson_active: { bgm: -9, amb: -6, sfx: -3 },
  lesson_vad: { bgm: -24, amb: -18, sfx: -9 },
  skill_or_bubble: { bgm: -18, amb: -12, sfx: -6 },
  lesson_window: { bgm: -Infinity, amb: -Infinity, sfx: -Infinity, ui: -Infinity, voice_npc: -Infinity }
};

/** docs/12 3장 복귀: how long a bus takes to come back once a reason ends. Lesson end returns in one second. */
export const DUCK_RELEASE_MS: Record<DuckReason, number> = {
  mic_open: 400,
  npc_speaking: 300,
  lesson_active: 1000,
  lesson_vad: 600,
  skill_or_bubble: 300,
  lesson_window: 0
};
/** Going down is quick so the first syllable is not masked. */
export const DUCK_ATTACK_MS = 40;

/** Release time when `reason` ends while `stillActive` remain: the bus glides back over the ended reason's time. */
export function duckReleaseMs(reason: DuckReason): number {
  return DUCK_RELEASE_MS[reason];
}

/** Deepest active cut on a bus (dB, 0 = none). Pure, shared by the engine and the WebAudio runtime. */
export function duckDbFor(bus: AudioBusName, active: Iterable<DuckReason>): number {
  let min = 0;
  for (const r of active) {
    const db = DUCK_TABLE_DB[r][bus];
    if (db !== undefined && db < min) min = db;
  }
  return min;
}

export interface SynthParams {
  freqStart: number;
  freqEnd: number;
  durationMs: number;
  wave: 'sine' | 'triangle' | 'square' | 'noise';
  gain: number;
}

export const PROCEDURAL_SFX_PRESETS: Record<string, SynthParams> = {
  /** docs/12 6.4: square 1,200 Hz, 30 ms. */
  'ui.click': { freqStart: 1200, freqEnd: 1200, durationMs: 30, wave: 'square', gain: 0.25 },
  /** docs/12 6.4: sine 660 -> 880 Hz, 60 ms (the short rising cue before recording starts). */
  'dlg.mic_on': { freqStart: 660, freqEnd: 880, durationMs: 60, wave: 'sine', gain: 0.45 },
  'dlg.mic_off': { freqStart: 659.25, freqEnd: 440, durationMs: 85, wave: 'triangle', gain: 0.4 },
  'blk.place': { freqStart: 220, freqEnd: 160, durationMs: 70, wave: 'triangle', gain: 0.5 },
  'blk.break': { freqStart: 180, freqEnd: 95, durationMs: 110, wave: 'square', gain: 0.45 },
  'build.note': { freqStart: 261.63, freqEnd: 261.63, durationMs: 120, wave: 'triangle', gain: 0.4 },
  'word.hit': { freqStart: 440, freqEnd: 440, durationMs: 100, wave: 'sine', gain: 0.45 },
  'fx.explode': { freqStart: 110, freqEnd: 38, durationMs: 280, wave: 'noise', gain: 0.7 },
  'coin.drop': { freqStart: 987.77, freqEnd: 1318.51, durationMs: 130, wave: 'sine', gain: 0.5 },
  'star.chime': { freqStart: 587.33, freqEnd: 1174.66, durationMs: 240, wave: 'triangle', gain: 0.55 },
  /** docs/12 6.2: review sign, a low two-note cue that does not fall (no 'failure' sound). */
  'mem.warn': { freqStart: 392, freqEnd: 440, durationMs: 220, wave: 'triangle', gain: 0.35 },
  /** docs/12 6.2: repair done (wrench + sparkle). */
  'mem.fix': { freqStart: 659.25, freqEnd: 1318.51, durationMs: 200, wave: 'sine', gain: 0.45 }
};

const PENTATONIC_SEMITONES = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24] as const;

export function getLadderSemitoneOffset(step: number): number {
  const safeStep = Math.max(0, Math.floor(step));
  const idx = safeStep % PENTATONIC_SEMITONES.length;
  return PENTATONIC_SEMITONES[idx] ?? 0;
}

export function dbToGain(db: number): number {
  if (!(db > -60)) return 0;
  return 10 ** (db / 20);
}

/**
 * Deterministic limiter enforcing max -1.0 dBFS peak for child hearing protection (docs/12 §4).
 */
export function applyHearingProtectionLimiter(sample: number): number {
  const maxAmp = AUDIO_LIMITS.MASTER_PEAK_LINEAR;
  if (sample > maxAmp) return maxAmp;
  if (sample < -maxAmp) return -maxAmp;
  return sample;
}

export function synthesizeProceduralPcm(
  id: string,
  sampleRate = 16_000,
  step = 0
): Float32Array {
  const preset = PROCEDURAL_SFX_PRESETS[id] ?? {
    freqStart: 440,
    freqEnd: 440,
    durationMs: 80,
    wave: 'sine' as const,
    gain: 0.35
  };
  const semitoneShift =
    id === 'build.note' || id === 'word.hit' ? getLadderSemitoneOffset(step) : 0;
  const pitchFactor = 2 ** (semitoneShift / 12);
  const f0 = preset.freqStart * pitchFactor;
  const f1 = preset.freqEnd * pitchFactor;

  const totalSamples = Math.max(16, Math.round((preset.durationMs / 1000) * sampleRate));
  const buf = new Float32Array(totalSamples);
  let phase = 0;
  let noiseState = 0x12345678;

  for (let i = 0; i < totalSamples; i++) {
    const t = i / totalSamples;
    const freq = f0 + (f1 - f0) * t;
    const envelope = Math.min(1, i / 32) * (1 - t);
    phase += (2 * Math.PI * freq) / sampleRate;

    let osc = 0;
    if (preset.wave === 'sine') {
      osc = Math.sin(phase);
    } else if (preset.wave === 'triangle') {
      osc = (2 / Math.PI) * Math.asin(Math.sin(phase));
    } else if (preset.wave === 'square') {
      osc = Math.sin(phase) >= 0 ? 0.65 : -0.65;
    } else {
      noiseState = (noiseState * 1664525 + 1013904223) >>> 0;
      osc = ((noiseState / 0xffffffff) * 2 - 1) * 0.85;
    }

    buf[i] = applyHearingProtectionLimiter(osc * envelope * preset.gain);
  }
  return buf;
}

export function encodeWavBytes(samples: Float32Array, sampleRate = 16_000): Uint8Array {
  const dataSize = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);
  for (let i = 0; i < samples.length; i++) {
    const s = applyHearingProtectionLimiter(samples[i] ?? 0);
    view.setInt16(44 + i * 2, Math.round(s * 32767), true);
  }
  return new Uint8Array(buffer);
}

export interface ActiveVoice {
  handleId: number;
  soundId: string;
  bus: AudioBusName;
  priority: number;
  startedAtMs: number;
  endsAtMs: number;
  looping: boolean;
  pos?: [number, number, number];
  /** docs/12 6.3 폭발 묶기: explosions merged into this one raise its level, at most +3 dB. */
  boostDb?: number;
}

export interface PlayOptions {
  bus?: AudioBusName;
  pos?: [number, number, number];
  volume?: number;
  priority?: number;
  nowMs?: number;
  durationMs?: number;
  step?: number;
}

export interface PlayResult {
  played: boolean;
  handleId: number | null;
  reason?: string;
  /** When an explosion was merged: the voice it joined and that voice's new boost. */
  mergedInto?: number;
  boostDb?: number;
  attenuatedGain: number;
  semitoneOffset: number;
}

export interface MicSequenceSchedule {
  npcEndedAtMs: number;
  micOnCueAtMs: number;
  /** After the cue has finished (docs/12 3장 순서 4: the cue must not leak into recognition). */
  recordingStartedAtMs: number;
}

export interface AudioEngineSnapshot {
  unlocked: boolean;
  sector: MusicSector;
  musicState: MusicMoodState;
  micOpen: boolean;
  hidden: boolean;
  listenOnlyMode: boolean;
  activeDuckReasons: DuckReason[];
  busVolumes: Record<AudioBusName, number>;
  effectiveBusGains: Record<AudioBusName, number>;
  activeVoices: ActiveVoice[];
  listener: { pos: [number, number, number]; yaw: number };
  eventLog: Array<{ atMs: number; event: string; id: string }>;
}

export interface AudioEngine {
  unlock(): void;
  stepTime(nowMs: number): void;
  play(id: string, opts?: PlayOptions): PlayResult;
  loop(id: string, opts?: PlayOptions): { handleId: number | null; stop: () => void };
  stop(idOrHandle: string | number): void;
  music: {
    setSector(sector: MusicSector): void;
    setState(state: MusicMoodState): void;
  };
  duck(reason: DuckReason, active: boolean): void;
  voice: {
    say(utterance: string, opts?: { nowMs?: number; durationMs?: number }): PlayResult;
    notifyNpcEnded(nowMs?: number): MicSequenceSchedule;
    /** The NPC voice ended (or was cut) with nobody waiting for the mic. */
    npcEnded(nowMs?: number): void;
    /** The child asked for the mic: cuts a speaking NPC, then NPC end -> 150 ms -> cue -> recording. */
    requestMic(nowMs?: number): MicSequenceSchedule;
    /** True once recording may start (never while an NPC voice is still playing). */
    completeMicOpenDelay(nowMs?: number): boolean;
    npcSpeaking(nowMs?: number): boolean;
    stopMic(nowMs?: number): void;
  };
  lesson: {
    setListenOnly(enabled: boolean): void;
    canGuardianTransmitVoice(): boolean;
    evaluateVadFrame(
      rmsEnergy: number,
      speechMs: number,
      silenceMs: number,
      mode?: VadMode
    ): 'speech' | 'silence';
  };
  setListener(pos: [number, number, number], yaw: number): void;
  setBusVolume(bus: AudioBusName, volume: number): void;
  /** docs/12 2장: a hidden tab stops music and ambience; only the call bus keeps playing. */
  setHidden(hidden: boolean): void;
  getEffectiveBusGain(bus: AudioBusName): number;
  getSnapshot(): AudioEngineSnapshot;
}

function inferBusFromId(id: string): AudioBusName {
  if (id.startsWith('ui.') || id.startsWith('dlg.')) return 'ui';
  if (id.startsWith('amb.')) return 'amb';
  if (id.startsWith('bgm.')) return 'bgm';
  if (id.startsWith('voice.npc')) return 'voice_npc';
  if (id.startsWith('voice.lesson')) return 'voice_lesson';
  return 'sfx';
}

export function createAudioEngine(initialMs = 0): AudioEngine {
  let currentMs = initialMs;
  let unlocked = false;
  let nextHandleId = 1;
  let sector: MusicSector = 'plaza';
  let musicState: MusicMoodState = 'calm';
  let micOpen = false;
  let listenOnlyMode = false;
  let pendingMicSchedule: MicSequenceSchedule | null = null;
  let cuePlayed = false;
  let hidden = false;
  /** End of the NPC voice now playing (ms), or -1. */
  let npcVoiceUntil = -1;
  let lastNpcEndMs = Number.NEGATIVE_INFINITY;
  let listenerPos: [number, number, number] = [0, 0, 0];
  let listenerYaw = 0;

  const activeDucks = new Set<DuckReason>();
  const busVolumes: Record<AudioBusName, number> = { ...BUS_DEFAULT_VOLUMES };
  const voices: ActiveVoice[] = [];
  const eventLog: Array<{ atMs: number; event: string; id: string }> = [];

  function pruneExpired(nowMs: number): void {
    for (let i = voices.length - 1; i >= 0; i--) {
      const v = voices[i]!;
      if (!v.looping && v.endsAtMs <= nowMs) {
        voices.splice(i, 1);
      }
    }
    if (npcVoiceUntil >= 0 && nowMs >= npcVoiceUntil) endNpcVoice(npcVoiceUntil);
  }

  function endNpcVoice(t: number): void {
    npcVoiceUntil = -1;
    lastNpcEndMs = t;
    activeDucks.delete('npc_speaking');
    eventLog.push({ atMs: t, event: 'npc_end', id: 'voice.npc' });
  }

  function isExplosion(id: string): boolean {
    return id.startsWith('exp.') || id.includes('explode');
  }

  function getEffectiveBusGain(bus: AudioBusName): number {
    if (hidden && (bus === 'bgm' || bus === 'amb')) return 0;
    const raw = busVolumes[bus] * dbToGain(duckDbFor(bus, activeDucks));
    return Math.min(AUDIO_LIMITS.MASTER_PEAK_LINEAR, Math.max(0, raw));
  }

  function spatialAttenuation(pos?: [number, number, number]): number {
    if (!pos) return 1;
    const dx = pos[0] - listenerPos[0];
    const dy = pos[1] - listenerPos[1];
    const dz = pos[2] - listenerPos[2];
    const dist = Math.hypot(dx, dy, dz);
    if (dist >= AUDIO_LIMITS.SPATIAL_MAX_DISTANCE) return 0;
    return Math.max(0.05, 1 - dist / AUDIO_LIMITS.SPATIAL_MAX_DISTANCE);
  }

  function playInternal(id: string, opts: PlayOptions, looping: boolean): PlayResult {
    const nowMs = opts.nowMs ?? currentMs;
    currentMs = Math.max(currentMs, nowMs);
    pruneExpired(nowMs);

    const bus = opts.bus ?? inferBusFromId(id);

    // Block NPC voice & non-essential UI sounds while player microphone is open (docs/12 §3)
    if (micOpen && id !== 'dlg.mic_on' && id !== 'dlg.mic_off') {
      if (bus === 'voice_npc' || bus === 'ui') {
        return {
          played: false,
          handleId: null,
          reason: 'blocked_while_mic_open',
          attenuatedGain: 0,
          semitoneOffset: 0
        };
      }
    }

    // docs/12 6.3 폭발 묶기: an explosion starting within 100 ms of the newest one joins it (+1 dB each, max +3 dB);
    // at most 3 explosion sounds play at once.
    if (isExplosion(id)) {
      const booms = voices.filter((v) => isExplosion(v.soundId));
      const newest = booms.reduce<ActiveVoice | null>((a, v) => (!a || v.startedAtMs > a.startedAtMs ? v : a), null);
      if (newest && nowMs - newest.startedAtMs < AUDIO_LIMITS.EXPLOSION_COALESCE_WINDOW_MS) {
        newest.boostDb = Math.min(AUDIO_LIMITS.EXPLOSION_MERGE_MAX_BOOST_DB, (newest.boostDb ?? 0) + 1);
        return {
          played: false,
          handleId: null,
          reason: 'explosion_coalesced',
          mergedInto: newest.handleId,
          boostDb: newest.boostDb,
          attenuatedGain: 0,
          semitoneOffset: 0
        };
      }
      if (booms.length >= AUDIO_LIMITS.EXPLOSION_MAX_SIMULTANEOUS) {
        return { played: false, handleId: null, reason: 'explosion_limit', attenuatedGain: 0, semitoneOffset: 0 };
      }
    }

    const cap = BUS_CAPS[bus];
    const busVoices = voices.filter((v) => v.bus === bus);
    const priority = opts.priority ?? BUS_PRIORITY[bus];
    if (busVoices.length >= cap) {
      // Over the cap: the lowest-priority voice goes, the oldest among equals (voices are kept in start order).
      let victimIdx = -1;
      let lowestPri = Infinity;
      for (let i = 0; i < voices.length; i++) {
        const v = voices[i]!;
        if (v.bus === bus && v.priority < lowestPri) {
          lowestPri = v.priority;
          victimIdx = i;
        }
      }
      if (victimIdx === -1 || priority < lowestPri) {
        return {
          played: false,
          handleId: null,
          reason: `bus_cap_reached:${bus}`,
          attenuatedGain: 0,
          semitoneOffset: 0
        };
      }
      voices.splice(victimIdx, 1);
    }

    const durationMs =
      opts.durationMs ?? PROCEDURAL_SFX_PRESETS[id]?.durationMs ?? 120;
    const handleId = nextHandleId++;
    voices.push({
      handleId,
      soundId: id,
      bus,
      priority,
      startedAtMs: nowMs,
      endsAtMs: looping ? Number.POSITIVE_INFINITY : nowMs + durationMs,
      looping,
      pos: opts.pos
    });
    eventLog.push({ atMs: nowMs, event: 'play', id });

    const vol = Math.min(1, Math.max(0, opts.volume ?? 1));
    const gain = Math.min(
      AUDIO_LIMITS.MASTER_PEAK_LINEAR,
      vol * getEffectiveBusGain(bus) * spatialAttenuation(opts.pos)
    );
    const semitoneOffset =
      id === 'build.note' || id === 'word.hit' ? getLadderSemitoneOffset(opts.step ?? 0) : 0;

    return {
      played: true,
      handleId,
      attenuatedGain: Number(gain.toFixed(4)),
      semitoneOffset
    };
  }

  function schedule(npcEnded: number, now: number): MicSequenceSchedule {
    const cueAt = Math.max(now, npcEnded + AUDIO_LIMITS.NPC_END_TO_MIC_ON_MS);
    const s: MicSequenceSchedule = {
      npcEndedAtMs: npcEnded,
      micOnCueAtMs: cueAt,
      recordingStartedAtMs: cueAt + PROCEDURAL_SFX_PRESETS['dlg.mic_on']!.durationMs
    };
    pendingMicSchedule = s;
    cuePlayed = false;
    return s;
  }

  const engine: AudioEngine = {
    unlock() {
      unlocked = true;
    },
    stepTime(nowMs: number) {
      currentMs = Math.max(currentMs, nowMs);
      pruneExpired(currentMs);
    },
    play(id: string, opts: PlayOptions = {}) {
      return playInternal(id, opts, false);
    },
    loop(id: string, opts: PlayOptions = {}) {
      const res = playInternal(id, opts, true);
      return {
        handleId: res.handleId,
        stop: () => {
          if (res.handleId !== null) {
            const idx = voices.findIndex((v) => v.handleId === res.handleId);
            if (idx >= 0) voices.splice(idx, 1);
          }
        }
      };
    },
    stop(idOrHandle: string | number) {
      for (let i = voices.length - 1; i >= 0; i--) {
        const v = voices[i]!;
        if (typeof idOrHandle === 'number' ? v.handleId === idOrHandle : v.soundId === idOrHandle) {
          voices.splice(i, 1);
        }
      }
    },
    music: {
      setSector(nextSector: MusicSector) {
        sector = nextSector;
      },
      setState(nextState: MusicMoodState) {
        musicState = nextState;
      }
    },
    duck(reason: DuckReason, active: boolean) {
      if (active) activeDucks.add(reason);
      else activeDucks.delete(reason);
    },
    voice: {
      say(utterance: string, opts = {}) {
        const nowMs = opts.nowMs ?? currentMs;
        currentMs = Math.max(currentMs, nowMs);
        pruneExpired(nowMs);
        if (micOpen || pendingMicSchedule) {
          return {
            played: false,
            handleId: null,
            reason: 'blocked_while_mic_open',
            attenuatedGain: 0,
            semitoneOffset: 0
          };
        }
        const durationMs = opts.durationMs ?? Math.max(400, utterance.length * 45);
        const r = playInternal(`voice.npc:${utterance.slice(0, 24)}`, { bus: 'voice_npc', nowMs, durationMs }, false);
        if (r.played) {
          activeDucks.add('npc_speaking');
          npcVoiceUntil = Math.max(npcVoiceUntil, nowMs + durationMs);
          eventLog.push({ atMs: nowMs, event: 'npc_start', id: 'voice.npc' });
        }
        return r;
      },
      notifyNpcEnded(nowMs?: number): MicSequenceSchedule {
        const t = nowMs ?? currentMs;
        engine.voice.npcEnded(t);
        return schedule(t, t);
      },
      npcEnded(nowMs?: number): void {
        const t = nowMs ?? currentMs;
        currentMs = Math.max(currentMs, t);
        for (let i = voices.length - 1; i >= 0; i--) if (voices[i]!.bus === 'voice_npc') voices.splice(i, 1);
        if (npcVoiceUntil >= 0) endNpcVoice(t);
      },
      requestMic(nowMs?: number): MicSequenceSchedule {
        const t = nowMs ?? currentMs;
        currentMs = Math.max(currentMs, t);
        pruneExpired(t);
        if (npcVoiceUntil >= 0) return engine.voice.notifyNpcEnded(t); // a tap on the mic cuts the NPC voice first
        // A voice that ended less than 150 ms ago still gets its full pause; otherwise the cue plays now.
        const gapLeft = lastNpcEndMs + AUDIO_LIMITS.NPC_END_TO_MIC_ON_MS - t;
        return gapLeft > 0 ? schedule(lastNpcEndMs, t) : schedule(t - AUDIO_LIMITS.NPC_END_TO_MIC_ON_MS, t);
      },
      completeMicOpenDelay(nowMs?: number): boolean {
        const t = nowMs ?? currentMs;
        currentMs = Math.max(currentMs, t);
        pruneExpired(t);
        const s = pendingMicSchedule;
        if (!s || npcVoiceUntil >= 0) return false;
        if (t >= s.micOnCueAtMs && !cuePlayed) {
          cuePlayed = true;
          playInternal('dlg.mic_on', { bus: 'ui', nowMs: s.micOnCueAtMs, priority: 60 }, false);
          eventLog.push({ atMs: s.micOnCueAtMs, event: 'mic_cue', id: 'dlg.mic_on' });
        }
        if (t < s.recordingStartedAtMs) return false;
        micOpen = true;
        activeDucks.add('mic_open');
        pendingMicSchedule = null;
        eventLog.push({ atMs: s.recordingStartedAtMs, event: 'mic_record_start', id: 'mic' });
        return true;
      },
      npcSpeaking(nowMs?: number): boolean {
        pruneExpired(nowMs ?? currentMs);
        return npcVoiceUntil >= 0;
      },
      stopMic(nowMs?: number) {
        const t = nowMs ?? currentMs;
        pendingMicSchedule = null;
        micOpen = false;
        activeDucks.delete('mic_open');
        playInternal('dlg.mic_off', { bus: 'ui', nowMs: t, priority: 20 }, false);
        eventLog.push({ atMs: t, event: 'mic_stop', id: 'mic' });
      }
    },
    lesson: {
      setListenOnly(enabled: boolean) {
        listenOnlyMode = enabled;
        if (enabled) activeDucks.add('lesson_window');
        else activeDucks.delete('lesson_window');
      },
      canGuardianTransmitVoice(): boolean {
        return !listenOnlyMode;
      },
      evaluateVadFrame(
        rmsEnergy: number,
        speechMs: number,
        silenceMs: number,
        mode: VadMode = 'conversation'
      ): 'speech' | 'silence' {
        const hangoverMs = vadHangoverMs(mode);
        if (rmsEnergy >= 0.02 && speechMs >= AUDIO_LIMITS.VAD_SPEECH_START_MS) {
          return 'speech';
        }
        if (silenceMs < hangoverMs && speechMs >= AUDIO_LIMITS.VAD_SPEECH_START_MS) {
          return 'speech';
        }
        return 'silence';
      }
    },
    setListener(pos: [number, number, number], yaw: number) {
      listenerPos = [...pos];
      listenerYaw = yaw;
    },
    setBusVolume(bus: AudioBusName, volume: number) {
      busVolumes[bus] = Math.min(1, Math.max(0, volume));
    },
    setHidden(h: boolean) {
      hidden = h;
    },
    getEffectiveBusGain,
    getSnapshot() {
      pruneExpired(currentMs);
      const effectiveBusGains: Record<AudioBusName, number> = {
        ui: getEffectiveBusGain('ui'),
        sfx: getEffectiveBusGain('sfx'),
        amb: getEffectiveBusGain('amb'),
        bgm: getEffectiveBusGain('bgm'),
        voice_npc: getEffectiveBusGain('voice_npc'),
        voice_lesson: getEffectiveBusGain('voice_lesson')
      };
      return {
        unlocked,
        sector,
        musicState,
        micOpen,
        hidden,
        listenOnlyMode,
        activeDuckReasons: [...activeDucks],
        busVolumes: { ...busVolumes },
        effectiveBusGains,
        activeVoices: voices.map((v) => ({ ...v })),
        listener: { pos: [...listenerPos], yaw: listenerYaw },
        eventLog: [...eventLog]
      };
    }
  };
  return engine;
}

export * from './clip-recorder.js';
