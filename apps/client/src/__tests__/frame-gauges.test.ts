// G01 gauges (docs/03 D1, WP-104): rates, slow-down, refill rules, frozen clock, device record.
import { describe, expect, it } from 'vitest';
import { TUNING } from '@lcw/sim-core';
import { FORBIDDEN_PLAYER_UI_PATTERNS } from '@lcw/ui';
import { GAUGES_KEY, REFILL_EVERY_MS, gaugeEffects, loadGauges, refillOf, saveGauges, startGauges, stepGauges, useForGauges } from '../frame/gauges.js';
import { WORLD_STRINGS as W } from '../world/strings.js';

const run = (s: ReturnType<typeof startGauges>, sec: number, frozen = false) => {
  let g = s;
  for (let i = 0; i < sec; i++) g = stepGauges(g, 1, frozen);
  return g;
};

describe('gauges fall at the docs/03 rates', () => {
  it('start at 45%, hunger empties in 20 minutes and thirst in 14', () => {
    const s = startGauges();
    expect(s).toEqual({ hunger: 45, thirst: 45 });
    const full = { hunger: 100, thirst: 100 };
    expect(run(full, 14 * 60).thirst).toBeCloseTo(0, 5);
    expect(run(full, 14 * 60).hunger).toBeCloseTo(30, 0);
    expect(run(full, 20 * 60).hunger).toBeCloseTo(0, 5);
  });
  it('the clock stops when frozen (lesson, dialog, menu, hidden tab) and a long frame never drains at once', () => {
    expect(run({ hunger: 50, thirst: 50 }, 600, true)).toEqual({ hunger: 50, thirst: 50 });
    const once = stepGauges({ hunger: 50, thirst: 50 }, 3600, false);
    expect(once.thirst).toBeGreaterThan(48);
  });
  it('20% or less slows walking (hunger -15%, thirst -30%), 0% stops running, never below 0', () => {
    expect(gaugeEffects({ hunger: 50, thirst: 50 })).toMatchObject({ speedMult: 1, canRun: true });
    expect(gaugeEffects({ hunger: 20, thirst: 50 }).speedMult).toBe(TUNING.gauges.hungerLowSpeedMult);
    expect(gaugeEffects({ hunger: 20, thirst: 10 }).speedMult).toBe(TUNING.gauges.thirstLowSpeedMult);
    expect(gaugeEffects({ hunger: 0, thirst: 30 }).canRun).toBe(false);
    expect(run({ hunger: 1, thirst: 1 }, 300)).toEqual({ hunger: 0, thirst: 0 });
  });
});

describe('eating and drinking', () => {
  it('knows food from drink and leaves toys alone', () => {
    expect(refillOf('honey_tea')).toMatchObject({ kind: 'drink', thirst: TUNING.gauges.waterRestore });
    expect(refillOf('smoothie')).toMatchObject({ kind: 'drink', thirst: TUNING.gauges.smoothieRestore });
    expect(refillOf('hot_chocolate')?.kind).toBe('drink');
    expect(refillOf('cookie')).toMatchObject({ kind: 'food', hunger: TUNING.gauges.breadRestore });
    expect(refillOf('apple_juice')?.kind).toBe('drink');
    for (const k of ['kite', 'ball', 'hat', 'sticker', 'book']) expect(refillOf(k)).toBeNull();
  });
  it('a thing refills once per rest time and never past 100', () => {
    const used = new Map<string, number>();
    const g = useForGauges({ hunger: 80, thirst: 10 }, 'cookie', used, 1000);
    expect(g).toEqual({ hunger: 100, thirst: 10 });
    used.set('cookie', 1000);
    expect(useForGauges({ hunger: 10, thirst: 10 }, 'cookie', used, 1000 + REFILL_EVERY_MS - 1)).toBeNull();
    expect(useForGauges({ hunger: 10, thirst: 10 }, 'cookie', used, 1000 + REFILL_EVERY_MS)).toEqual({ hunger: 45, thirst: 10 });
    expect(useForGauges({ hunger: 10, thirst: 10 }, 'kite', used, 0)).toBeNull();
  });
});

describe('device record', () => {
  it('round-trips, drops stale rest times and survives a bad record', () => {
    const mem = new Map<string, string>();
    const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    saveGauges(store, { hunger: 33.33, thirst: 12 }, new Map([['cookie', 5000], ['tea', 0]]), 6000 + REFILL_EVERY_MS - 2000);
    const back = loadGauges(store);
    expect(back.g).toEqual({ hunger: 33.3, thirst: 12 });
    expect([...back.used.keys()]).toEqual(['cookie']);
    mem.set(GAUGES_KEY, '{oops');
    expect(loadGauges(store).g).toEqual(startGauges());
    mem.set(GAUGES_KEY, JSON.stringify({ g: { hunger: 400, thirst: -3 }, used: [[1, 2], ['x', 'y']] }));
    expect(loadGauges(store)).toEqual({ g: { hunger: 100, thirst: 0 }, used: new Map() });
  });
  it('the words stay kind (no blame, no "게임")', () => {
    const words = [W.hunger, W.thirst, W.slowed, W.useAgainFood, W.useAgainDrink, W.ate, W.drank, W.restLater, W.lowHunger, W.lowThirst].join(' ');
    for (const p of FORBIDDEN_PLAYER_UI_PATTERNS) expect(words).not.toContain(p);
    expect(words).not.toMatch(/게임/);
  });
});
