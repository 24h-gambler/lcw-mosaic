import { describe, expect, it } from 'vitest';
import { FREE_TIER_LIMITS, QuotaMeter } from '../index.js';

describe('@lcw/quota WP-112 acceptance', () => {
  it('transitions cleanly across degradation stages 0..4 and prioritizes lessons', () => {
    const meter = new QuotaMeter('2026-11-15', FREE_TIER_LIMITS.dailyNeurons);
    const now = 1_000_000_000;

    expect(meter.getStatus(now).stage).toBe(0);
    expect(meter.canUseCreativeLlm({ seatId: 's1', isLesson: false, nowMs: now })).toBe(true);

    // Push to 70% -> stage 1
    expect(meter.consumeNeurons('s1', 7000, 'llm')).toBe(true);
    expect(meter.getStatus(now).stage).toBe(1);
    expect(meter.canUseCreativeLlm({ seatId: 's1', isLesson: false, nowMs: now })).toBe(false);
    expect(meter.canUseCreativeLlm({ seatId: 's1', isLesson: true, nowMs: now })).toBe(true);

    // Push to 85% -> stage 2
    expect(meter.consumeNeurons('s1', 1500, 'stt', 60)).toBe(true);
    expect(meter.getStatus(now).stage).toBe(2);
    expect(
      meter.canUseServerStt({ seatId: 's1', isLesson: false, hasDeviceStt: true, nowMs: now })
    ).toBe(false);
    expect(
      meter.canUseServerStt({ seatId: 's1', isLesson: false, hasDeviceStt: false, nowMs: now })
    ).toBe(true);

    // Push to 95% -> stage 3 (bank-only, never overshoots limit)
    expect(meter.consumeNeurons('s1', 1000, 'craft')).toBe(true);
    expect(meter.getStatus(now).stage).toBe(3);
    expect(meter.getStatus(now).bankOnlyMode).toBe(true);
    expect(meter.consumeNeurons('s1', 1000, 'llm')).toBe(false);

    // Outage -> stage 4
    meter.setProviderOutage(true);
    expect(meter.getStatus(now).stage).toBe(4);
  });

  it('reserves 3,000 neurons 30 minutes before scheduled lessons and allows zero-quota bank mode', () => {
    const meter = new QuotaMeter('2026-11-15', 10_000);
    const lessonStart = 1_000_000_000 + 20 * 60 * 1000;
    meter.registerScheduledLesson(lessonStart);
    meter.consumeNeurons('s1', 7000, 'llm');

    // Within 30 min window & <=3000 remaining -> general blocked, lesson allowed
    expect(
      meter.canUseCreativeLlm({ seatId: 's2', isLesson: false, nowMs: 1_000_000_000 })
    ).toBe(false);
    expect(
      meter.canUseCreativeLlm({ seatId: 's2', isLesson: true, nowMs: 1_000_000_000 })
    ).toBe(true);

    // Setting limit to 0 puts meter safely in bankOnlyMode
    const zeroMeter = new QuotaMeter('2026-11-15', 0);
    expect(zeroMeter.getStatus(0).bankOnlyMode).toBe(true);
    expect(zeroMeter.canUseCreativeLlm({ seatId: 's1', isLesson: false, nowMs: 0 })).toBe(false);
  });
});
