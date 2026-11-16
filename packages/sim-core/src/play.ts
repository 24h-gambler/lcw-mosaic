/**
 * Play-mode rules (docs/01 6장 경영자; docs/03 D2 채굴·환전, D3 경제, D4 커리어; docs/04 4.2 환전소·면접·상사·고객).
 * Pure functions: time and state come in as arguments (AGENTS 3). The server (apps/edge/src/play.ts) keeps the state
 * and the ledger; the client only shows what these decide on the server.
 */
import { TUNING } from './tuning.js';

const P = TUNING.play;
export type Stars = 1 | 2 | 3;
export type JobRank = 'intern' | 'staff' | 'manager' | 'director';
export const JOB_RANKS: readonly JobRank[] = ['intern', 'staff', 'manager', 'director'];

/* ------------------------------------------------------------------ clock */

export interface PlayClock {
  /** Game day index (0 = the first day). */
  day: number;
  /** Minute of the game day, 0..1439. */
  minute: number;
}

/** docs/03 3.1 하루 = 실시간 24분; the clock runs only on the child's own play time (D4). */
export function clockOf(playMs: number): PlayClock {
  const total = Math.floor(Math.max(0, playMs) / P.realMsPerGameMinute) + P.clockStartMinute;
  return { day: Math.floor(total / 1440), minute: total % 1440 };
}

/** "08:45" */
export function hhmm(minute: number): string {
  const m = ((Math.floor(minute) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/**
 * Play time added by one heartbeat: the gap since the last one, capped, and nothing after a long gap (the child was
 * away; docs/03 D4 "며칠 접속하지 않았다고 해고되지 않습니다").
 */
export function heartbeatAddMs(lastBeatMs: number | null, nowMs: number): number {
  if (lastBeatMs === null) return 0;
  const gap = nowMs - lastBeatMs;
  if (gap <= 0 || gap > P.beatGapOfflineMs) return 0;
  return Math.min(gap, P.beatMaxAddMs);
}

/* ------------------------------------------------------------------ career (D4) */

export type OfficeHours = 'before_open' | 'on_time' | 'late' | 'closed';

/** Where the work day is: before 08:00, 08:00~09:00 on time, 09:00~17:00 late, after 17:00 closed. */
export function officeHours(minute: number): OfficeHours {
  if (minute < P.shift.openMinute) return 'before_open';
  if (minute <= P.shift.startMinute) return 'on_time';
  if (minute < P.shift.closeMinute) return 'late';
  return 'closed';
}

export interface JobState {
  rank: JobRank | null;
  /** Paid work days at the current rank (intern promotion: 3). */
  daysWorked: number;
  /** 3-star customer answers at the current rank (staff promotion: 5). */
  threeStarCustomers: number;
  /** On-time days in a row at the current rank (manager promotion: 5 "지각 0회로 5일"). */
  onTimeStreak: number;
  /** Negotiation missions done (director, docs/03 D4). */
  negotiations: number;
  /** docs/04 4.2 상사 3성 "+ 승진 점수": each point counts as one more step toward the current rank's condition. */
  promoPoints: number;
}

export function newJob(): JobState {
  return { rank: null, daysWorked: 0, threeStarCustomers: 0, onTimeStreak: 0, negotiations: 0, promoPoints: 0 };
}

export function dailyPay(rank: JobRank): number {
  return TUNING.career.ranks[rank].dailyPay;
}

/** The number the current rank's promotion counts, and how many it needs (docs/03 D4 표). */
export function promotionProgress(job: JobState): { have: number; need: number; next: JobRank | null } {
  if (!job.rank) return { have: 0, need: 0, next: null };
  const r = TUNING.career.ranks[job.rank] as { nextRank: JobRank | null; promoDaysRequired?: number; promoThreeStarCustomers?: number; promoOnTimeDays?: number; promoNegotiations?: number };
  const base =
    job.rank === 'intern' ? job.daysWorked : job.rank === 'staff' ? job.threeStarCustomers : job.rank === 'manager' ? job.onTimeStreak : job.negotiations;
  const need = r.promoDaysRequired ?? r.promoThreeStarCustomers ?? r.promoOnTimeDays ?? r.promoNegotiations ?? 0;
  return { have: base + job.promoPoints, need, next: r.nextRank };
}

/** Promotes when the current rank's condition is met; counters of the new rank start at 0. */
export function promoteIfReady(job: JobState): { job: JobState; promotedTo: JobRank | null } {
  const p = promotionProgress(job);
  if (!p.next || p.have < p.need) return { job, promotedTo: null };
  return {
    job: { ...job, rank: p.next, daysWorked: 0, threeStarCustomers: 0, onTimeStreak: 0, promoPoints: 0 },
    promotedTo: p.next
  };
}

/**
 * Interview result from the stars of its three turns (docs/04 4.2 면접: 1성 인턴, 2성 채용 + 계약금, 3성 한 단계 위).
 * The weakest turn decides: one weak answer is what the interviewer remembers.
 */
export function interviewOutcome(turnStars: readonly Stars[]): { rank: JobRank; contractBonus: number } {
  const s = Math.min(...turnStars) as Stars;
  if (s >= 3) return { rank: 'staff', contractBonus: 0 };
  if (s === 2) return { rank: 'intern', contractBonus: Math.round(dailyPay('intern') * P.contractBonusPct) };
  return { rank: 'intern', contractBonus: 0 };
}

export interface ShiftState {
  day: number;
  late: boolean;
  /** Pay factor from the clock-in line (late 1 star = 0.5). */
  payFactor: number;
  customersServed: number;
  tips: number;
  paid: boolean;
}

/** Clock-in (docs/04 4.2 상사): on time any pass is full pay; late 1★ half, 2★ full, 3★ full + a promotion point. */
export function clockIn(day: number, hours: OfficeHours, stars: Stars): { shift: ShiftState; promoPoint: boolean } {
  const late = hours === 'late';
  const payFactor = late && stars === 1 ? P.lateOneStarPayFactor : 1;
  return {
    shift: { day, late, payFactor, customersServed: 0, tips: 0, paid: false },
    promoPoint: stars === 3 && late
  };
}

/** One customer answered (docs/04 4.2 고객: 1성 처리, 2성 팁, 3성 팁 + 단골). */
export function serveCustomer(shift: ShiftState, stars: Stars): { shift: ShiftState; tip: number; regular: boolean } {
  const tip = P.customerTipByStars[stars];
  return { shift: { ...shift, customersServed: shift.customersServed + 1, tips: shift.tips + tip }, tip, regular: stars === 3 };
}

/** The day's pay once the shift's customers are done (docs/03 D4 "고객 응대 2건 → 일급"). */
export function shiftPay(rank: JobRank, shift: ShiftState): number {
  if (shift.customersServed < P.shift.customersPerShift) return 0;
  return Math.round(dailyPay(rank) * shift.payFactor);
}

/** Customer claim the shift's n-th customer brings: deterministic from day and index (docs/03 D4 office.customer.*). */
export function customerScenarioIndex(day: number, n: number, count: number): number {
  let h = (day * 2654435761 + (n + 1) * 40503) >>> 0;
  h ^= h >>> 15;
  return count > 0 ? h % count : 0;
}

/* ------------------------------------------------------------------ exchange & market (D2, D3) */

/** The ore's price in this world right now (docs/03 D2 기준가 × 시세 지수). */
export function oreMarketPrice(ore: string, marketIndex: number): number {
  const base = TUNING.mining.ores[ore]?.price ?? 0;
  const idx = Math.max(TUNING.economy.marketIndexMin, Math.min(TUNING.economy.marketIndexMax, marketIndex));
  return Math.max(1, Math.round(base * idx));
}

/** Coins for selling `units` of an ore with a sentence of `stars` (docs/04 4.2 환전소: 시세, +10%, +25%). */
export function exchangePayout(ore: string, units: number, marketIndex: number, stars: Stars): number {
  if (units <= 0) return 0;
  return Math.round(oreMarketPrice(ore, marketIndex) * units * (1 + P.exchangeBonusByStars[stars]));
}

/** The world's index after selling `units` (each unit presses it down; docs/03 D2 평균 회귀). */
export function marketAfterSale(index: number, units: number): number {
  return clampIndex(index - units * P.marketPressurePerUnit);
}

/** The world's index climbing back toward 1 over real time (docs/03 D2 "시간이 지나면 돌아옵니다"). */
export function marketRecovered(index: number, elapsedMs: number): number {
  const hours = Math.max(0, elapsedMs) / 3_600_000;
  const keep = Math.pow(1 - P.marketRecoveryPerHour, hours);
  return clampIndex(1 + (index - 1) * keep);
}

function clampIndex(v: number): number {
  return Number(Math.max(TUNING.economy.marketIndexMin, Math.min(TUNING.economy.marketIndexMax, v)).toFixed(4));
}

/* ------------------------------------------------------------------ mining (D2) */

/** The child's best tool tier from what they own (item keys; the wooden pickaxe is tier 1 for everyone). */
export function toolTierOf(itemKeys: Iterable<string>): number {
  let tier = 1;
  for (const k of itemKeys) tier = Math.max(tier, P.mine.toolTiers[k] ?? 1);
  return tier;
}

export type MineRefusal = 'tool' | 'resting' | 'too_fast';

/**
 * Can this swing take the vein's ore? `lastMinedPlayMs` is the child's play time when they last took this vein
 * (respawn runs on play time, so leaving the device on a shelf grows nothing).
 */
export function mineCheck(p: {
  ore: string;
  toolTier: number;
  playMs: number;
  lastMinedPlayMs: number | null;
  lastSwingAtMs: number | null;
  nowMs: number;
}): { ok: true } | { ok: false; reason: MineRefusal; waitMs?: number } {
  const need = TUNING.mining.ores[p.ore]?.requiredToolTier ?? 99;
  if (p.toolTier < need) return { ok: false, reason: 'tool' };
  if (p.lastSwingAtMs !== null && p.nowMs - p.lastSwingAtMs < P.mine.minIntervalMs) return { ok: false, reason: 'too_fast' };
  if (p.lastMinedPlayMs !== null) {
    const ready = p.lastMinedPlayMs + P.mine.veinRespawnPlayMs;
    if (p.playMs < ready) return { ok: false, reason: 'resting', waitMs: ready - p.playMs };
  }
  return { ok: true };
}

/* ------------------------------------------------------------------ my shop (D13 상인, docs/01 경영자 가게 운영) */

export function shopUnlocked(exchangeCoinsTotal: number): boolean {
  return exchangeCoinsTotal >= P.shopUnlockExchangeCoins;
}

/** A visitor buys one thing from my shop at its value with the star bonus of my sales line. */
export function shopSale(valueCoins: number, stars: Stars): number {
  return Math.round(Math.max(0, valueCoins) * (1 + P.shopBonusByStars[stars]));
}
