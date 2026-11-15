/**
 * Duo plan partial-refund rule (docs/01 4, docs/09 P6).
 * Pure functions: time is passed in, no I/O.
 */

const DAY_MS = 86_400_000;

/** Single place for plan prices and the refund window (docs/01 4). KRW. */
export const PLAN_PRICES_KRW = {
  solo: { month: 14_900, year: 119_000 },
  duo: { month: 19_900, year: 159_000 }
} as const;

export const REFUND_WINDOW_MS = 7 * DAY_MS;
export const TERM_DAYS = { month: 30, year: 365 } as const;

export type BillingTerm = keyof typeof TERM_DAYS;
export type DuoRefundMode = 'refund_difference' | 'convert_to_solo_days';

export interface DuoSeatRecord {
  seatId: string;
  /** Exactly one seat of a Duo carries the payer; both seats share the same payer_id. */
  payerId: string;
}

export interface DuoPartialRefundInput {
  term: BillingTerm;
  paidAtMs: number;
  refundRequestedAtMs: number;
  /** Amount actually paid for the Duo (defaults to list price). */
  paidAmountKrw?: number;
  mode: DuoRefundMode;
}

export type DuoPartialRefundResult =
  | { eligible: false; reason: 'outside_refund_window' }
  | {
      eligible: true;
      remainingSeatPlan: 'solo';
      /** Cash returned to the single payer. */
      refundKrw: number;
      /** Days of Solo service the remaining seat keeps (full term for refund_difference). */
      remainingSoloDays: number;
    };

/** A Duo has exactly one payer_id. Returns true when every seat names the same single payer. */
export function hasSingleDuoPayer(seats: readonly DuoSeatRecord[]): boolean {
  return seats.length === 2 && seats[0]!.payerId.length > 0 && seats[0]!.payerId === seats[1]!.payerId;
}

/**
 * If one seat of a Duo is refunded within 7 days, the remaining seat is converted to Solo pricing:
 * - refund_difference: payer is refunded (Duo paid - Solo price); the seat keeps the whole term.
 * - convert_to_solo_days: nothing is refunded; the remaining seat's half of the Duo payment is
 *   converted pro-rata into Solo days.
 */
export function settleDuoSeatRefund(input: DuoPartialRefundInput): DuoPartialRefundResult {
  const elapsed = input.refundRequestedAtMs - input.paidAtMs;
  if (elapsed < 0 || elapsed > REFUND_WINDOW_MS) {
    return { eligible: false, reason: 'outside_refund_window' };
  }
  const paid = input.paidAmountKrw ?? PLAN_PRICES_KRW.duo[input.term];
  const solo = PLAN_PRICES_KRW.solo[input.term];
  const termDays = TERM_DAYS[input.term];
  if (input.mode === 'refund_difference') {
    return {
      eligible: true,
      remainingSeatPlan: 'solo',
      refundKrw: Math.max(0, paid - solo),
      remainingSoloDays: termDays
    };
  }
  const remainingShare = paid / 2;
  return {
    eligible: true,
    remainingSeatPlan: 'solo',
    refundKrw: 0,
    remainingSoloDays: Math.min(termDays, Math.floor((remainingShare / solo) * termDays))
  };
}
