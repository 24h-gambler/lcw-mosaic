import { describe, expect, it } from 'vitest';
import { hasSingleDuoPayer, inRefundWindow, refundDeadlineMs, settleDuoSeatRefund } from '../index.js';

const DAY = 86_400_000;
const T0 = 1_800_000_000_000;

describe('Duo single-seat refund (docs/01 4, docs/09 P6)', () => {
  it('refunds Duo minus Solo when one seat leaves within 7 days (monthly and yearly)', () => {
    const m = settleDuoSeatRefund({ term: 'month', paidAtMs: T0, refundRequestedAtMs: T0 + 5 * DAY, mode: 'refund_difference' });
    expect(m).toEqual({ eligible: true, remainingSeatPlan: 'solo', refundKrw: 5000, remainingSoloDays: 30 });
    const y = settleDuoSeatRefund({ term: 'year', paidAtMs: T0, refundRequestedAtMs: T0 + 7 * DAY, mode: 'refund_difference' });
    expect(y).toMatchObject({ eligible: true, refundKrw: 40_000, remainingSoloDays: 365 });
  });

  it('converts the remaining half payment pro-rata to Solo days with no cash refund', () => {
    const m = settleDuoSeatRefund({ term: 'month', paidAtMs: T0, refundRequestedAtMs: T0 + DAY, mode: 'convert_to_solo_days' });
    // 19,900 / 2 = 9,950 of a 14,900 Solo month -> 20 days
    expect(m).toEqual({ eligible: true, remainingSeatPlan: 'solo', refundKrw: 0, remainingSoloDays: 20 });
  });

  it('window is KST calendar days: from the day after payment, closes at 24:00 KST of the 7th day', () => {
    // paid 2026-11-01 15:00 KST → open until 2026-11-08 24:00 KST
    const paid = Date.UTC(2026, 10, 1, 6, 0, 0);
    expect(refundDeadlineMs(paid)).toBe(Date.UTC(2026, 10, 8, 15, 0, 0));
    expect(inRefundWindow(paid, paid + 7 * DAY)).toBe(true);
    expect(inRefundWindow(paid, Date.UTC(2026, 10, 8, 14, 59, 59, 999))).toBe(true);
    expect(inRefundWindow(paid, Date.UTC(2026, 10, 8, 15, 0, 0))).toBe(false);
    expect(inRefundWindow(paid, paid - 1)).toBe(false);
    // paid 23:59 KST still counts that day as day 0
    const late = Date.UTC(2026, 10, 1, 14, 59, 0);
    expect(refundDeadlineMs(late)).toBe(Date.UTC(2026, 10, 8, 15, 0, 0));
    // paid 00:00 KST (= previous UTC day 15:00)
    expect(refundDeadlineMs(Date.UTC(2026, 9, 31, 15, 0, 0))).toBe(Date.UTC(2026, 10, 8, 15, 0, 0));
  });

  it('does not apply after the window (falls to the ops inbox rule) or before payment', () => {
    expect(settleDuoSeatRefund({ term: 'month', paidAtMs: T0, refundRequestedAtMs: refundDeadlineMs(T0), mode: 'refund_difference' })).toEqual({
      eligible: false,
      reason: 'outside_refund_window'
    });
    expect(settleDuoSeatRefund({ term: 'month', paidAtMs: T0, refundRequestedAtMs: T0 - 1, mode: 'refund_difference' }).eligible).toBe(false);
  });

  it('never refunds more than was paid and requires exactly one payer_id', () => {
    const r = settleDuoSeatRefund({ term: 'month', paidAtMs: T0, refundRequestedAtMs: T0, paidAmountKrw: 10_000, mode: 'refund_difference' });
    expect(r).toMatchObject({ refundKrw: 0 });
    expect(hasSingleDuoPayer([{ seatId: 'a', payerId: 'u1' }, { seatId: 'b', payerId: 'u1' }])).toBe(true);
    expect(hasSingleDuoPayer([{ seatId: 'a', payerId: 'u1' }, { seatId: 'b', payerId: 'u2' }])).toBe(false);
    expect(hasSingleDuoPayer([{ seatId: 'a', payerId: 'u1' }])).toBe(false);
  });
});
