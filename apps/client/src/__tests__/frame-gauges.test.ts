// G01 gauges (docs/03 D1, WP-104, R325): rates, slow-down, refill rules, health and warmth, frozen clock, device record.
import { describe, expect, it } from 'vitest';
import { TUNING } from '@lcw/sim-core';
import { FORBIDDEN_PLAYER_UI_PATTERNS } from '@lcw/ui';
import { GAUGES_KEY, NO_CLIMATE, REFILL_EVERY_MS, afterFall, gaugeEffects, loadGauges, refillOf, restAtSquare, saveGauges, startGauges, stepGauges, useForGauges, type Climate, type GaugeState } from '../frame/gauges.js';

/** hunger and thirst as given, health and warmth full (the two R325 added) */
const gs = (hunger: number, thirst: number, health = 100, warmth = 100): GaugeState => ({ hunger, thirst, health, warmth });
import { WORLD_STRINGS as W } from '../world/strings.js';

const run = (s: GaugeState, sec: number, frozen = false, c: Climate = NO_CLIMATE, grace = false) => {
  let g = s;
  for (let i = 0; i < sec; i++) g = stepGauges(g, 1, frozen, 1, c, grace);
  return g;
};

describe('gauges fall at the docs/03 rates', () => {
  it('start at 45%, hunger empties in 20 minutes and thirst in 14', () => {
    const s = startGauges();
    expect(s).toEqual(gs(45, 45));
    const full = gs(100, 100);
    expect(run(full, 14 * 60).thirst).toBeCloseTo(0, 5);
    expect(run(full, 14 * 60).hunger).toBeCloseTo(30, 0);
    expect(run(full, 20 * 60).hunger).toBeCloseTo(0, 5);
  });
  it('the clock stops when frozen (lesson, dialog, menu, hidden tab) and a long frame never drains at once', () => {
    expect(run(gs(50, 50), 600, true)).toEqual(gs(50, 50));
    const once = stepGauges(gs(50, 50), 3600, false);
    expect(once.thirst).toBeGreaterThan(48);
  });
  it('20% or less slows walking (hunger -15%, thirst -30%), 0% stops running, never below 0', () => {
    expect(gaugeEffects(gs(50, 50))).toMatchObject({ speedMult: 1, canRun: true });
    expect(gaugeEffects(gs(20, 50)).speedMult).toBe(TUNING.gauges.hungerLowSpeedMult);
    expect(gaugeEffects(gs(20, 10)).speedMult).toBe(TUNING.gauges.thirstLowSpeedMult);
    expect(gaugeEffects(gs(0, 30)).canRun).toBe(false);
    expect(run(gs(1, 1), 300)).toMatchObject({ hunger: 0, thirst: 0 });
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
    const g = useForGauges(gs(80, 10), 'cookie', used, 1000);
    expect(g).toEqual(gs(100, 10));
    used.set('cookie', 1000);
    expect(useForGauges(gs(10, 10), 'cookie', used, 1000 + REFILL_EVERY_MS - 1)).toBeNull();
    expect(useForGauges(gs(10, 10), 'cookie', used, 1000 + REFILL_EVERY_MS)).toEqual(gs(45, 10));
    expect(useForGauges(gs(10, 10), 'kite', used, 0)).toBeNull();
  });
});

describe('health and warmth (R325, Dan 11-19)', () => {
  const G = TUNING.gauges;
  it('health falls only while a gauge is empty, faster with two, and comes back while fed, watered and warm', () => {
    expect(run(gs(60, 60, 50), 60).health).toBeGreaterThan(50);
    expect(run(gs(60, 60, 100), 60).health).toBe(100);
    // between regenMinPct and empty: health holds
    expect(run(gs(40, 40, 50), 30).health).toBeCloseTo(50, 5);
    const oneEmpty = 50 - run(gs(0, 60, 50), 30).health;
    const twoEmpty = 50 - run(gs(0, 0, 50), 30).health;
    expect(oneEmpty).toBeCloseTo(G.emptyGaugeHealthPerSec * 30, 3);
    expect(twoEmpty).toBeCloseTo(oneEmpty * 2, 3);
    // 0 -> 100 in 5 minutes while kept up
    expect(run(gs(100, 100, 0), 5 * 60 + 1).health).toBe(100);
  });
  it('warmth: winter outdoors 6 min, a snowstorm 90 s (docs/03), a roof or a warm drink keeps the cold off, a fire warms fastest', () => {
    const winter: Climate = { cold: 1, fire: false, roof: false };
    const storm: Climate = { cold: 2, fire: false, roof: false };
    expect(run(gs(100, 100), 6 * 60, false, winter).warmth).toBeCloseTo(0, 5);
    expect(run(gs(100, 100), 3 * 60, false, winter).warmth).toBeCloseTo(50, 0);
    expect(run(gs(100, 100), 90, false, storm).warmth).toBeCloseTo(0, 5);
    expect(run(gs(100, 100), 60, false, { ...winter, roof: true }).warmth).toBe(100);
    expect(run(gs(100, 100), 60, false, winter, true).warmth).toBe(100);
    expect(run(gs(100, 100, 100, 0), 12, false, { ...storm, fire: true }).warmth).toBeCloseTo(100, 5);
    expect(run(gs(100, 100, 100, 0), 12, false, NO_CLIMATE).warmth).toBeCloseTo(30, 5);
    // frozen to 0 empties health like an empty gauge; cold at 20% or less slows by the docs/03 40%
    expect(run(gs(100, 100, 50, 0), 30, false, storm).health).toBeLessThan(50);
    expect(gaugeEffects(gs(100, 100, 100, 20)).speedMult).toBe(G.tempLowSpeedMult);
    expect(gaugeEffects(gs(100, 100, 20, 100)).speedMult).toBe(G.healthLowSpeedMult);
  });
  it('a long fall hurts past the safe height; a rest at the square is never death and not straight back to empty', () => {
    expect(afterFall(gs(50, 50), 3)).toEqual(gs(50, 50));
    expect(afterFall(gs(50, 50), G.fallSafeMeters + 2).health).toBe(100 - 2 * G.fallHealthPerMeter);
    expect(afterFall(gs(50, 50, 5), 30).health).toBe(0);
    const r = restAtSquare(gs(0, 10, 0, 0));
    expect(r).toEqual({ hunger: G.restMinPct, thirst: G.restMinPct, health: G.restHealthPct, warmth: 100 });
    expect(restAtSquare(gs(90, 90, 0, 50))).toMatchObject({ hunger: 90, thirst: 90 });
  });
  it('a child who never eats or drinks is not sent back to the square over and over: at least 12 min between rests (review R325)', () => {
    let s = restAtSquare(gs(0, 0, 0, 0));
    let t = 0;
    while (s.health > 0 && t < 3600) {
      s = stepGauges(s, 1, false);
      t++;
    }
    expect(t).toBeGreaterThanOrEqual(12 * 60);
    // and from a new device (45% hunger and thirst)
    let n = gs(G.spawnStartPct, G.spawnStartPct);
    let u = 0;
    while (n.health > 0 && u < 3600) {
      n = stepGauges(n, 1, false);
      u++;
    }
    expect(u).toBeGreaterThanOrEqual(12 * 60);
  });
  it('a warm drink warms and is marked warm; food heals a little; an iced drink does not warm', () => {
    expect(refillOf('hot_chocolate')).toMatchObject({ kind: 'drink', warm: true, warmth: G.warmDrinkRestore });
    expect(refillOf('honey_tea')?.warm).toBe(true);
    expect(refillOf('iced_tea')?.warm).toBe(false);
    expect(refillOf('water')).toMatchObject({ warm: false, warmth: 0 });
    expect(refillOf('cookie')).toMatchObject({ health: G.foodHealthRestore });
    expect(useForGauges(gs(50, 50, 50, 10), 'hot_chocolate', new Map(), 0)).toMatchObject({ warmth: 10 + G.warmDrinkRestore });
  });
});

describe('device record', () => {
  it('round-trips, drops stale rest times and survives a bad record', () => {
    const mem = new Map<string, string>();
    const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    saveGauges(store, gs(33.33, 12), new Map([['cookie', 5000], ['tea', 0]]), 6000 + REFILL_EVERY_MS - 2000);
    const back = loadGauges(store);
    expect(back.g).toEqual(gs(33.3, 12));
    expect([...back.used.keys()]).toEqual(['cookie']);
    mem.set(GAUGES_KEY, '{oops');
    expect(loadGauges(store).g).toEqual(startGauges());
    mem.set(GAUGES_KEY, JSON.stringify({ g: gs(400, -3), used: [[1, 2], ['x', 'y']] }));
    expect(loadGauges(store)).toEqual({ g: gs(100, 0), used: new Map() });
    // a record from before R325 (no health, no warmth): both start full
    mem.set(GAUGES_KEY, JSON.stringify({ g: { hunger: 20, thirst: 30 }, used: [] }));
    expect(loadGauges(store).g).toEqual(gs(20, 30, 100, 100));
  });
  it('the words stay kind (no blame, no "게임")', () => {
    const words = [W.hunger, W.thirst, W.health, W.warmth, W.slowed, W.useAgainFood, W.useAgainDrink, W.ate, W.drank, W.restLater, W.lowHunger, W.lowThirst, W.lowHealth, W.lowWarmth, W.rested, W.ouch, W.warmedUp].join(' ');
    for (const p of FORBIDDEN_PLAYER_UI_PATTERNS) expect(words).not.toContain(p);
    expect(words).not.toMatch(/게임/);
  });
});
