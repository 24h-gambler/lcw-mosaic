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

export class QuotaMeter {
  private day: string;
  private neuronsLimit: number;
  private neuronsUsed = 0;
  private doRequestsUsed = 0;
  private d1WritesUsed = 0;
  private providerOutage = false;
  private scheduledLessonStartsAtMs: number[] = [];
  private seatUsage = new Map<
    string,
    { creativeAi: number; aiCraft: number; serverSttSec: number }
  >();

  constructor(day: string, neuronsLimit: number = FREE_TIER_LIMITS.dailyNeurons) {
    this.day = day;
    this.neuronsLimit = Math.max(0, neuronsLimit);
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
    let s = this.seatUsage.get(seatId);
    if (!s) {
      s = { creativeAi: 0, aiCraft: 0, serverSttSec: 0 };
      this.seatUsage.set(seatId, s);
    }
    return s;
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

  consumeNeurons(seatId: string, neurons: number, kind: 'llm' | 'stt' | 'craft', sttSec = 0): boolean {
    if (neurons < 0 || !Number.isFinite(neurons)) return false;
    if (this.neuronsUsed + neurons > this.neuronsLimit) {
      return false; // Never allow overage billing (AGENTS.md 4.8)
    }
    this.neuronsUsed += neurons;
    const seat = this.getSeat(seatId);
    if (kind === 'llm') seat.creativeAi++;
    else if (kind === 'craft') seat.aiCraft++;
    else if (kind === 'stt') seat.serverSttSec += sttSec;
    return true;
  }

  recordDoRequest(count = 1): void {
    this.doRequestsUsed += count;
  }

  recordD1Write(rows = 1): void {
    this.d1WritesUsed += rows;
  }

  getInfraCounts() {
    return {
      doRequestsUsed: this.doRequestsUsed,
      d1WritesUsed: this.d1WritesUsed
    };
  }
}
