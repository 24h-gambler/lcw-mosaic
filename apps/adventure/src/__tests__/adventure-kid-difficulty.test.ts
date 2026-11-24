import { describe, expect, it } from 'vitest';
import { Battle } from '../core/battle.js';
import { autopilotDir } from '../core/bullets.js';
import { buildChapterPlan, type EncounterPlan } from '../core/plan.js';
import { createRng } from '../core/rng.js';
import { newRun } from '../core/run.js';

/**
 * R2861 (Dan 11-23: "much harder, mini bosses hard too, a 12-year-old dies a few times and learns"): first-try clear
 * rate of every gate mini boss and guardian, by three pilots, on a fresh trip (no gear, no snacks, no magic words):
 *   still   — never moves the voice bubble (talks perfectly)
 *   kid     — a 12-year-old stand-in: looks every 0.25 s (reaction time), freezes on a quarter of those looks,
 *             talks at 2 stars most of the time
 *   pilot   — the page's perfect dodger (talks at 3 stars)
 * The numbers are printed (the report quotes them) and held to bands: the kid loses most first meetings with a
 * guardian but not all of them, the pilot wins most, standing still loses.
 */

type Pilot = 'still' | 'kid' | 'pilot';
type Res = { outcome: Battle['outcome']; turns: number; seconds: number };

function play(enc: EncounterPlan, pilot: Pilot, seed: number): Res {
  const b = new Battle(enc, createRng(seed), newRun());
  const look = createRng(seed * 7919 + 1);
  const ph = (): Battle['phase'] => b.phase;
  let turns = 0;
  let frames = 0;
  let talks = 0;
  let held = { x: 0, y: 0 };
  for (let guard = 0; guard < 60000 && ph() !== 'end'; guard++) {
    if (ph() === 'msg') b.advance();
    else if (ph() === 'menu') {
      if (b.spareReady) b.choose('friend');
      else {
        b.choose('talk');
        const plain = b.choices.find((c) => !c.skill) ?? b.choices[0]!;
        b.pickTalk(plain.id);
        talks += 1;
        const stars = pilot === 'kid' ? ([2, 2, 3, 2] as const)[talks % 4]! : 3;
        b.talkResult({ stars, score: stars === 3 ? 0.95 : 0.8, pass: true, missed: [] });
        frames += 60 * 8; // a spoken line takes a child about eight seconds
      }
    } else if (ph() === 'dodge') {
      turns += 1;
      let f = 0;
      while (ph() === 'dodge') {
        if (pilot === 'kid' && f % 15 === 0 && b.pattern) {
          const d = autopilotDir(b.pattern, b.soul);
          held = look() < 0.25 ? { x: 0, y: 0 } : d;
        }
        if (pilot === 'pilot') b.step(1 / 60, { x: 0, y: 0 }, true);
        else b.step(1 / 60, pilot === 'kid' ? held : { x: 0, y: 0 }, false);
        f += 1;
        frames += 1;
      }
    } else if (ph() === 'befriend') b.befriend();
    else b.step(1 / 60, { x: 0, y: 0 }, false);
  }
  return { outcome: b.outcome, turns, seconds: Math.round(frames / 60) };
}

const SEEDS = Array.from({ length: 12 }, (_, i) => i + 1);
/** Guardians are rarer to measure and noisier (a few wins in 12 is 0-25%), so they get 48 seeds: the floor below must not flap. */
const GSEEDS = Array.from({ length: 48 }, (_, i) => i + 1);
const win = (r: Res) => r.outcome === 'spared' || r.outcome === 'fought';
const rate = (rs: Res[]) => Math.round((rs.filter(win).length / rs.length) * 100);

describe('R2861 difficulty: first-try clear rates (12 seeds per mini boss, 48 per guardian)', () => {
  it('guardians and gate mini bosses are hard for a kid, beatable by a good dodger', () => {
    const report: Record<string, unknown> = {};
    const kidBoss: number[] = [];
    const pilotBoss: number[] = [];
    const stillBoss: number[] = [];
    const kidMini: number[] = [];
    for (const ch of [1, 2, 3, 4] as const) {
      const plan = buildChapterPlan({ chapter: ch, level: 1 });
      const minis = plan.encounters.filter((e) => e.creature.role !== 'guardian');
      const boss = plan.encounters.find((e) => e.creature.role === 'guardian')!;
      expect(minis.length, `island ${ch}: three gate mini bosses`).toBe(3);
      for (const m of minis) expect(m.stages.length, `${m.creature.id}: a staged mini boss`).toBeGreaterThanOrEqual(2);
      const row: Record<string, unknown> = {};
      for (const m of minis) {
        const kid = SEEDS.map((s) => play(m, 'kid', s));
        kidMini.push(rate(kid));
        row[m.creature.id] = { kid: `${rate(kid)}%`, kidSec: Math.round(kid.reduce((a, r) => a + r.seconds, 0) / kid.length) };
      }
      const still = GSEEDS.map((s) => play(boss, 'still', s));
      const kid = GSEEDS.map((s) => play(boss, 'kid', s));
      const pilot = GSEEDS.map((s) => play(boss, 'pilot', s));
      stillBoss.push(rate(still));
      kidBoss.push(rate(kid));
      pilotBoss.push(rate(pilot));
      row[boss.creature.id] = {
        still: `${rate(still)}%`,
        kid: `${rate(kid)}%`,
        pilot: `${rate(pilot)}%`,
        kidSec: Math.round(kid.reduce((a, r) => a + r.seconds, 0) / kid.length),
        pilotTurns: Math.round(pilot.reduce((a, r) => a + r.turns, 0) / pilot.length)
      };
      report[`island${ch}`] = row;
    }
    console.log(JSON.stringify({ firstTryClear: report }));
    for (let i = 0; i < 4; i++) {
      expect(stillBoss[i]!, `island ${i + 1}: standing still loses the guardian`).toBeLessThanOrEqual(25);
      expect(kidBoss[i]!, `island ${i + 1}: a kid loses most first meetings`).toBeLessThanOrEqual(50);
      expect(pilotBoss[i]!, `island ${i + 1}: a good dodger wins`).toBeGreaterThanOrEqual(66);
      // R2861 tuning (the first live try showed 0-25%): a guardian is never a wall for the kid, not even the Hushwind
      expect(kidBoss[i]!, `island ${i + 1}: a kid can win it first try now and then (not a wall)`).toBeGreaterThanOrEqual(8);
    }
    // a kid can win a guardian on the first try sometimes (it is learnable, not a wall), across the trip
    expect(kidBoss.some((r) => r > 0), 'the kid wins a guardian now and then').toBe(true);
    expect(kidBoss.reduce((a, b) => a + b, 0) / kidBoss.length, 'a kid wins about one guardian meeting in five (dies a few times, learns)').toBeGreaterThanOrEqual(15);
    // mini bosses: not free, not a wall
    expect(Math.min(...kidMini), 'a mini boss is never a wall').toBeGreaterThanOrEqual(25);
    expect(kidMini.reduce((a, b) => a + b, 0) / kidMini.length, 'mini bosses cost a kid a life now and then').toBeLessThanOrEqual(90);
  });
});
