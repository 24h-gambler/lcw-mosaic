export type AudioBusName = 'ui' | 'sfx' | 'amb' | 'bgm' | 'voice_npc' | 'voice_lesson';

export type DuckReason =
  | 'mic_open'
  | 'npc_speaking'
  | 'lesson_active'
  | 'lesson_vad'
  | 'skill_or_bubble'
  | 'lesson_window';

export type MusicSector = 'plaza' | 'market' | 'wilds' | 'shelter' | 'mentor_dungeon';
export type MusicMoodState = 'calm' | 'explore' | 'tense' | 'celebrate';

export const AUDIO_LIMITS = {
  MASTER_PEAK_DBFS: -1.0,
  MASTER_PEAK_LINEAR: 0.89125, // 10^(-1 / 20)
  NPC_END_TO_MIC_ON_MS: 150,
  EXPLOSION_COALESCE_WINDOW_MS: 100,
  EXPLOSION_MAX_SIMULTANEOUS: 3,
  VAD_FRAME_MS: 20,
  VAD_SPEECH_START_MS: 300,
  VAD_HANGOVER_MS: 500,
  TURN_TAKING_MAX_GAP_MS: 2000,
  OPUS_SAMPLE_RATE_HZ: 16_000,
  SPATIAL_MAX_DISTANCE: 28
} as const;

export const BUS_CAPS: Record<AudioBusName, number> = {
  ui: 4,
  sfx: 12,
  amb: 4,
  bgm: 2,
  voice_npc: 1,
  voice_lesson: 4
};

export const BUS_LUFS_TARGETS: Record<AudioBusName, number> = {
  ui: -18,
  sfx: -14,
  amb: -26,
  bgm: -24,
  voice_npc: -16,
  voice_lesson: -16
};

/** Attenuation in dB applied to target buses when a ducking reason is active (docs/12 §2). */
export const DUCK_TABLE_DB: Record<DuckReason, Partial<Record<AudioBusName, number>>> = {
  mic_open: { bgm: -18, amb: -14, sfx: -12, voice_npc: -60 },
  npc_speaking: { bgm: -10, amb: -6, sfx: -4 },
  lesson_active: { bgm: -12, amb: -8 },
  lesson_vad: { bgm: -16, sfx: -8 },
  skill_or_bubble: { bgm: -8 },
  lesson_window: { bgm: -12, amb: -10, sfx: -8 }
};

export interface SynthParams {
  freqStart: number;
  freqEnd: number;
  durationMs: number;
  wave: 'sine' | 'triangle' | 'square' | 'noise';
  gain: number;
}

export const PROCEDURAL_SFX_PRESETS: Record<string, SynthParams> = {
  'ui.click': { freqStart: 880, freqEnd: 1120, durationMs: 45, wave: 'sine', gain: 0.35 },
  'dlg.mic_on': { freqStart: 523.25, freqEnd: 783.99, durationMs: 90, wave: 'triangle', gain: 0.45 },
  'dlg.mic_off': { freqStart: 659.25, freqEnd: 440, durationMs: 85, wave: 'triangle', gain: 0.4 },
  'blk.place': { freqStart: 220, freqEnd: 160, durationMs: 70, wave: 'triangle', gain: 0.5 },
  'blk.break': { freqStart: 180, freqEnd: 95, durationMs: 110, wave: 'square', gain: 0.45 },
  'build.note': { freqStart: 261.63, freqEnd: 261.63, durationMs: 120, wave: 'triangle', gain: 0.4 },
  'word.hit': { freqStart: 440, freqEnd: 440, durationMs: 100, wave: 'sine', gain: 0.45 },
  'fx.explode': { freqStart: 110, freqEnd: 38, durationMs: 280, wave: 'noise', gain: 0.7 },
  'coin.drop': { freqStart: 987.77, freqEnd: 1318.51, durationMs: 130, wave: 'sine', gain: 0.5 },
  'star.chime': { freqStart: 587.33, freqEnd: 1174.66, durationMs: 240, wave: 'triangle', gain: 0.55 }
};

const PENTATONIC_SEMITONES = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24] as const;

export function getLadderSemitoneOffset(step: number): number {
  const safeStep = Math.max(0, Math.floor(step));
  const idx = safeStep % PENTATONIC_SEMITONES.length;
  return PENTATONIC_SEMITONES[idx] ?? 0;
}

export function dbToGain(db: number): number {
  if (db <= -60) return 0;
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
  attenuatedGain: number;
  semitoneOffset: number;
}

export interface MicSequenceSchedule {
  npcEndedAtMs: number;
  micOnCueAtMs: number;
  recordingStartedAtMs: number;
}

export interface AudioEngineSnapshot {
  unlocked: boolean;
  sector: MusicSector;
  musicState: MusicMoodState;
  micOpen: boolean;
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
    completeMicOpenDelay(nowMs?: number): boolean;
    stopMic(nowMs?: number): void;
  };
  lesson: {
    setListenOnly(enabled: boolean): void;
    canGuardianTransmitVoice(): boolean;
    evaluateVadFrame(rmsEnergy: number, speechMs: number, silenceMs: number): 'speech' | 'silence';
  };
  setListener(pos: [number, number, number], yaw: number): void;
  setBusVolume(bus: AudioBusName, volume: number): void;
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
  let listenerPos: [number, number, number] = [0, 0, 0];
  let listenerYaw = 0;

  const activeDucks = new Set<DuckReason>();
  const busVolumes: Record<AudioBusName, number> = {
    ui: 1,
    sfx: 1,
    amb: 0.85,
    bgm: 0.75,
    voice_npc: 1,
    voice_lesson: 1
  };
  const voices: ActiveVoice[] = [];
  const explosionTimestamps: number[] = [];
  const eventLog: Array<{ atMs: number; event: string; id: string }> = [];

  function pruneExpired(nowMs: number): void {
    for (let i = voices.length - 1; i >= 0; i--) {
      const v = voices[i]!;
      if (!v.looping && v.endsAtMs <= nowMs) {
        voices.splice(i, 1);
      }
    }
    while (
      explosionTimestamps.length > 0 &&
      nowMs - explosionTimestamps[0]! > AUDIO_LIMITS.EXPLOSION_COALESCE_WINDOW_MS
    ) {
      explosionTimestamps.shift();
    }
  }

  function getEffectiveBusGain(bus: AudioBusName): number {
    let minDuckDb = 0;
    for (const reason of activeDucks) {
      const db = DUCK_TABLE_DB[reason][bus];
      if (db !== undefined && db < minDuckDb) {
        minDuckDb = db;
      }
    }
    const raw = busVolumes[bus] * dbToGain(minDuckDb);
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

    // Coalesce explosion sounds inside 100ms window (docs/12 §2 & §12)
    if (id.includes('explode')) {
      if (explosionTimestamps.length >= AUDIO_LIMITS.EXPLOSION_MAX_SIMULTANEOUS) {
        return {
          played: false,
          handleId: null,
          reason: 'explosion_coalesced',
          attenuatedGain: 0,
          semitoneOffset: 0
        };
      }
      explosionTimestamps.push(nowMs);
    }

    const cap = BUS_CAPS[bus];
    const busVoices = voices.filter((v) => v.bus === bus);
    const priority = opts.priority ?? (bus === 'ui' || bus === 'voice_npc' ? 10 : 5);
    if (busVoices.length >= cap) {
      // Evict lowest priority oldest voice on same bus if incoming priority >= lowest
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

  return {
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
        if (micOpen) {
          return {
            played: false,
            handleId: null,
            reason: 'blocked_while_mic_open',
            attenuatedGain: 0,
            semitoneOffset: 0
          };
        }
        activeDucks.add('npc_speaking');
        const durationMs = opts.durationMs ?? Math.max(400, utterance.length * 45);
        return playInternal(
          `voice.npc:${utterance.slice(0, 24)}`,
          { bus: 'voice_npc', nowMs, durationMs },
          false
        );
      },
      notifyNpcEnded(nowMs?: number): MicSequenceSchedule {
        const t = nowMs ?? currentMs;
        currentMs = Math.max(currentMs, t);
        activeDucks.delete('npc_speaking');
        const schedule: MicSequenceSchedule = {
          npcEndedAtMs: t,
          micOnCueAtMs: t + AUDIO_LIMITS.NPC_END_TO_MIC_ON_MS,
          recordingStartedAtMs: t + AUDIO_LIMITS.NPC_END_TO_MIC_ON_MS
        };
        pendingMicSchedule = schedule;
        eventLog.push({ atMs: t, event: 'npc_end', id: 'voice.npc' });
        return schedule;
      },
      completeMicOpenDelay(nowMs?: number): boolean {
        const t = nowMs ?? currentMs;
        currentMs = Math.max(currentMs, t);
        if (!pendingMicSchedule || t < pendingMicSchedule.micOnCueAtMs) {
          return false;
        }
        playInternal('dlg.mic_on', { bus: 'ui', nowMs: t, priority: 20 }, false);
        micOpen = true;
        activeDucks.add('mic_open');
        pendingMicSchedule = null;
        eventLog.push({ atMs: t, event: 'mic_record_start', id: 'mic' });
        return true;
      },
      stopMic(nowMs?: number) {
        const t = nowMs ?? currentMs;
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
      evaluateVadFrame(rmsEnergy: number, speechMs: number, silenceMs: number): 'speech' | 'silence' {
        if (rmsEnergy >= 0.02 && speechMs >= AUDIO_LIMITS.VAD_SPEECH_START_MS) {
          return 'speech';
        }
        if (silenceMs < AUDIO_LIMITS.VAD_HANGOVER_MS && speechMs >= AUDIO_LIMITS.VAD_SPEECH_START_MS) {
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
}
