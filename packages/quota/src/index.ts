export const FREE_TIER_LIMITS = {
  dailyNeurons: 10_000,
  dailyDoRequests: 100_000,
  dailyD1Writes: 100_000,
  lessonReserveNeurons: 3_000
} as const;

export const SEAT_FAIR_USE_LIMITS = {
  creativeAiPerDay: 60,
  aiCraftPerDay: 30,
  serverSttMinutesPerDay: 40,
  maxActiveWorlds: 5,
  maxObjectsPerWorld: 300
} as const;

/**
 * Server speech recognition (docs/02 6장: Workers AI Whisper for devices without on-device recognition, Opus at
 * 16 kbps). One dialog turn is at most 12 s (docs/04 4.1), so a request carries at most 15 s. Neurons are counted
 * from the audio length before the call: Whisper large-v3-turbo is priced about 46 neurons per audio minute.
 */
export const SERVER_STT = {
  model: '@cf/openai/whisper-large-v3-turbo',
  /** One turn is up to 60 s (client mic-controller HARD_TURN_MS; a stage-1 task is ~20 s, 11-16). */
  maxSec: 61,
  /** 61 s of Opus at up to 64 kbps plus container overhead; larger bodies are refused unread. */
  maxBytes: 520_000,
  /** 16 kbps Opus: the length estimate from the size when it is longer than the client says. */
  opusBytesPerSec: 2_000,
  neuronsPerMinute: 46,
  /** Transcripts longer than this are cut (a dialog sentence is far shorter). */
  maxTranscriptChars: 1000
} as const;

export function serverSttNeurons(sec: number): number {
  return Math.max(1, Math.ceil((Math.max(0, sec) * SERVER_STT.neuronsPerMinute) / 60));
}

/**
 * Neural NPC voice (docs/04 4.8, Dan 11-16 "목소리 자연스러움"): Workers AI text-to-speech, cached in R2 so one
 * sentence in one voice is made once. Neurons are counted from the characters before the call. Aura-1 is priced
 * $0.015 per 1,000 characters = about 1.37 neurons per character ($0.011 per 1,000 neurons); MeloTTS $0.0002 per
 * audio minute, about 0.02 neurons per character at 15 characters a second (counted at 0.05 to stay on the safe side).
 */
export const NEURAL_TTS = {
  models: { aura: '@cf/deepgram/aura-1', aura2: '@cf/deepgram/aura-2-en', melo: '@cf/myshell-ai/melotts' },
  /** Workers AI price per 1k characters / $0.011 per 1k neurons: aura-1 $0.015, aura-2-en $0.030, MeloTTS ~$0.0002/min. */
  neuronsPerChar: { aura: 1.37, aura2: 2.73, melo: 0.05 },
  /** One NPC line (a teacher's possession line included); longer text is refused, not cut. */
  maxChars: 300,
  /** Operator prebuild: neurons one call may spend on fixed lines (the rest continues on the next call). */
  prebuildBudgetNeurons: 4_500
} as const;

export type TtsEngine = keyof typeof NEURAL_TTS.models;

export function ttsNeurons(engine: TtsEngine, chars: number): number {
  return Math.max(1, Math.ceil(Math.max(0, chars) * NEURAL_TTS.neuronsPerChar[engine]));
}

export type DegradeStage = 0 | 1 | 2 | 3 | 4;

export interface QuotaStatus {
  day: string;
  stage: DegradeStage;
  neuronsUsed: number;
  neuronsLimit: number;
  usageRatio: number;
  lessonReservedActive: boolean;
  bankOnlyMode: boolean;
  opsAlert: boolean;
}

/**
 * Where the day's counters live. The default keeps them in memory (tests, one isolate); the edge passes a store
 * backed by its Durable Object SQLite (`quota_daily`), so an evicted or restarted object keeps counting the same
 * day instead of starting from zero (docs/02 5장: one counter for the whole service).
 */
export interface QuotaStore {
  get(key: string): number;
  add(key: string, n: number): void;
}

export class MemoryQuotaStore implements QuotaStore {
  private m = new Map<string, number>();
  get(key: string): number {
    return this.m.get(key) ?? 0;
  }
  add(key: string, n: number): void {
    this.m.set(key, this.get(key) + n);
  }
}

/** Counter keys in a QuotaStore (one day per store). */
export const QUOTA_KEYS = {
  neurons: 'neurons',
  doRequests: 'do_requests',
  d1Writes: 'd1_writes',
  seat: (seatId: string, kind: 'llm' | 'craft' | 'stt_sec') => `seat:${seatId}:${kind}`
} as const;

export class QuotaMeter {
  private day: string;
  private neuronsLimit: number;
  private providerOutage = false;
  private scheduledLessonStartsAtMs: number[] = [];
  private store: QuotaStore;

  constructor(day: string, neuronsLimit: number = FREE_TIER_LIMITS.dailyNeurons, store: QuotaStore = new MemoryQuotaStore()) {
    this.day = day;
    this.neuronsLimit = Math.max(0, neuronsLimit);
    this.store = store;
  }

  private get neuronsUsed(): number {
    return this.store.get(QUOTA_KEYS.neurons);
  }

  getDay(): string {
    return this.day;
  }

  setProviderOutage(outage: boolean): void {
    this.providerOutage = outage;
  }

  setDailyNeuronsLimit(limit: number): void {
    this.neuronsLimit = Math.max(0, limit);
  }

  registerScheduledLesson(startsAtMs: number): void {
    this.scheduledLessonStartsAtMs.push(startsAtMs);
  }

  /** Replace the known lesson start times (the edge reads them from its lessons tables on each request). */
  setScheduledLessons(startsAtMs: readonly number[]): void {
    this.scheduledLessonStartsAtMs = [...startsAtMs];
  }

  isLessonReservationWindow(nowMs: number): boolean {
    const thirtyMinMs = 30 * 60 * 1000;
    return this.scheduledLessonStartsAtMs.some(
      (start) => nowMs >= start - thirtyMinMs && nowMs <= start + 120 * 60 * 1000
    );
  }

  getStatus(nowMs: number): QuotaStatus {
    const lessonReservedActive = this.isLessonReservationWindow(nowMs);
    if (this.providerOutage) {
      return {
        day: this.day,
        stage: 4,
        neuronsUsed: this.neuronsUsed,
        neuronsLimit: this.neuronsLimit,
        usageRatio: 1,
        lessonReservedActive,
        bankOnlyMode: true,
        opsAlert: true
      };
    }

    if (this.neuronsLimit <= 0) {
      return {
        day: this.day,
        stage: 3,
        neuronsUsed: this.neuronsUsed,
        neuronsLimit: this.neuronsLimit,
        usageRatio: 1,
        lessonReservedActive,
        bankOnlyMode: true,
        opsAlert: true
      };
    }

    const usageRatio = this.neuronsUsed / this.neuronsLimit;
    let stage: DegradeStage = 0;
    if (usageRatio >= 0.95) stage = 3;
    else if (usageRatio >= 0.85) stage = 2;
    else if (usageRatio >= 0.7) stage = 1;

    return {
      day: this.day,
      stage,
      neuronsUsed: this.neuronsUsed,
      neuronsLimit: this.neuronsLimit,
      usageRatio: Number(usageRatio.toFixed(4)),
      lessonReservedActive,
      bankOnlyMode: stage >= 3,
      opsAlert: stage >= 2
    };
  }

  private getSeat(seatId: string) {
    return {
      creativeAi: this.store.get(QUOTA_KEYS.seat(seatId, 'llm')),
      aiCraft: this.store.get(QUOTA_KEYS.seat(seatId, 'craft')),
      serverSttSec: this.store.get(QUOTA_KEYS.seat(seatId, 'stt_sec'))
    };
  }

  canUseCreativeLlm(params: { seatId: string; isLesson: boolean; nowMs: number }): boolean {
    const status = this.getStatus(params.nowMs);
    if (status.stage >= 3) return false;
    if (status.stage >= 1 && !params.isLesson) return false;

    if (!params.isLesson) {
      const seat = this.getSeat(params.seatId);
      if (seat.creativeAi >= SEAT_FAIR_USE_LIMITS.creativeAiPerDay) return false;

      // Respect lesson neuron reserve if lesson is within 30 minutes
      const remaining = this.neuronsLimit - this.neuronsUsed;
      if (status.lessonReservedActive && remaining <= FREE_TIER_LIMITS.lessonReserveNeurons) {
        return false;
      }
    }
    return true;
  }

  canUseServerStt(params: {
    seatId: string;
    isLesson: boolean;
    hasDeviceStt: boolean;
    nowMs: number;
  }): boolean {
    const status = this.getStatus(params.nowMs);
    if (status.stage >= 3) return false;
    if (status.stage >= 2 && !params.isLesson && params.hasDeviceStt) return false;
    if (!params.isLesson) {
      const seat = this.getSeat(params.seatId);
      if (seat.serverSttSec >= SEAT_FAIR_USE_LIMITS.serverSttMinutesPerDay * 60) return false;
    }
    return true;
  }

  canUseAiCraft(params: { seatId: string; isLesson: boolean; nowMs: number }): boolean {
    const status = this.getStatus(params.nowMs);
    if (status.stage >= 3) return false;
    if (status.stage >= 1 && !params.isLesson) return false;
    if (!params.isLesson) {
      const seat = this.getSeat(params.seatId);
      if (seat.aiCraft >= SEAT_FAIR_USE_LIMITS.aiCraftPerDay) return false;
    }
    return true;
  }

  /**
   * A new neural voice line (a cached one costs nothing and needs no ask). Lessons keep it to stage 2; solo play
   * gives it up from stage 2 (the device voice reads instead); nothing from stage 3. The lesson reserve holds it back
   * outside lessons like the creative calls.
   */
  canUseTts(params: { isLesson: boolean; nowMs: number }): boolean {
    const status = this.getStatus(params.nowMs);
    if (status.stage >= 3) return false;
    if (status.stage >= 2 && !params.isLesson) return false;
    if (!params.isLesson) {
      const remaining = this.neuronsLimit - this.neuronsUsed;
      if (status.lessonReservedActive && remaining <= FREE_TIER_LIMITS.lessonReserveNeurons) return false;
    }
    return true;
  }

  consumeNeurons(seatId: string, neurons: number, kind: 'llm' | 'stt' | 'craft' | 'tts', sttSec = 0): boolean {
    if (neurons < 0 || !Number.isFinite(neurons)) return false;
    if (this.neuronsUsed + neurons > this.neuronsLimit) {
      return false; // Never allow overage billing (AGENTS.md 4.8)
    }
    this.store.add(QUOTA_KEYS.neurons, neurons);
    if (kind === 'llm') this.store.add(QUOTA_KEYS.seat(seatId, 'llm'), 1);
    else if (kind === 'craft') this.store.add(QUOTA_KEYS.seat(seatId, 'craft'), 1);
    else if (kind === 'stt') this.store.add(QUOTA_KEYS.seat(seatId, 'stt_sec'), Math.max(0, Math.round(sttSec)));
    return true;
  }

  recordDoRequest(count = 1): void {
    this.store.add(QUOTA_KEYS.doRequests, count);
  }

  recordD1Write(rows = 1): void {
    this.store.add(QUOTA_KEYS.d1Writes, rows);
  }

  getInfraCounts() {
    return {
      doRequestsUsed: this.store.get(QUOTA_KEYS.doRequests),
      d1WritesUsed: this.store.get(QUOTA_KEYS.d1Writes)
    };
  }
}

export * from './duo.js';
