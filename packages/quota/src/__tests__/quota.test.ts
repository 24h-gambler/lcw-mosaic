import { describe, expect, it } from 'vitest';
import { FREE_TIER_LIMITS, OPS_SHARE, QuotaMeter, ttsNeurons } from '../index.js';

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

describe('operator and test share (OPS_SHARE, R2627)', () => {
  it('caps operator and test spending a day and leaves the rest of the day to the children', () => {
    const m = new QuotaMeter('2026-11-16', 10_000);
    const ops = m.opsView();
    expect(ops.consumeNeurons(OPS_SHARE.seat, 600, 'tts')).toBe(true);
    // the 11-16 prebuild (48 Aura-2 lines, ~5,100 neurons) is refused past the share
    expect(m.opsView().consumeNeurons(OPS_SHARE.seat, 5_100, 'tts')).toBe(false);
    expect(ops.consumeNeurons(OPS_SHARE.seat, OPS_SHARE.dailyNeurons - 600, 'tts')).toBe(true);
    expect(m.opsView().consumeNeurons(OPS_SHARE.seat, 1, 'tts')).toBe(false);
    // the share is inside the one day count, and the children's own spends are not capped by it
    expect(m.getStatus(0).neuronsUsed).toBe(OPS_SHARE.dailyNeurons);
    expect(m.consumeNeurons('child', 5_000, 'tts')).toBe(true);
    expect(m.opsStatus()).toEqual({ used: OPS_SHARE.dailyNeurons, limit: OPS_SHARE.dailyNeurons, left: 0 });
  });

  it('never takes the day to stage 1 nor into the lesson reserve, nor spends in an outage or a bank-only day', () => {
    const m = new QuotaMeter('2026-11-16', 10_000);
    m.consumeNeurons('child', 6_900, 'tts');
    expect(m.opsStatus().left).toBe(99);
    expect(m.opsView().consumeNeurons(OPS_SHARE.seat, 100, 'tts')).toBe(false); // would make exactly 70%
    expect(m.opsView().consumeNeurons(OPS_SHARE.seat, 99, 'tts')).toBe(true);
    expect(m.getStatus(0).neuronsUsed).toBe(6_999);
    expect(m.getStatus(0).stage).toBe(0);
    expect(m.opsStatus().left).toBe(0);
    // a lowered daily limit: the lesson reserve (3,000) is the tighter line, not 70%
    const low = new QuotaMeter('2026-11-16', 5_000);
    low.consumeNeurons('child', 1_900, 'tts');
    expect(low.opsStatus().left).toBe(99);
    expect(low.opsView().consumeNeurons(OPS_SHARE.seat, 100, 'tts')).toBe(false);
    expect(low.opsView().consumeNeurons(OPS_SHARE.seat, 99, 'tts')).toBe(true);
    expect(5_000 - low.getStatus(0).neuronsUsed).toBeGreaterThan(FREE_TIER_LIMITS.lessonReserveNeurons);
    const out = new QuotaMeter('2026-11-16', 10_000);
    out.setProviderOutage(true);
    expect(out.opsView().consumeNeurons(OPS_SHARE.seat, 1, 'stt', 1)).toBe(false);
    expect(new QuotaMeter('2026-11-16', 0).opsView().consumeNeurons(OPS_SHARE.seat, 1, 'tts')).toBe(false);
  });
});

describe('neural voice on the ladder (canUseTts)', () => {
  const now = Date.parse('2026-11-16T03:00:00Z');
  it('solo play gives it up from stage 2, lessons from stage 3, and the lesson reserve holds it back', () => {
    const m = new QuotaMeter('2026-11-16', 1000);
    expect(m.canUseTts({ isLesson: false, nowMs: now })).toBe(true);
    m.consumeNeurons('a', 860, 'tts');
    expect(m.canUseTts({ isLesson: false, nowMs: now })).toBe(false);
    expect(m.canUseTts({ isLesson: true, nowMs: now })).toBe(true);
    m.consumeNeurons('a', 100, 'tts');
    expect(m.canUseTts({ isLesson: true, nowMs: now })).toBe(false);
    expect(ttsNeurons('aura', 50)).toBe(69);
    expect(ttsNeurons('melo', 50)).toBe(3);
  });
});
