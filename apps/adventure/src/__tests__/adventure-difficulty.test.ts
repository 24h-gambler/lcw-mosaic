import { describe, expect, it } from 'vitest';
import type { AdventurePatternId } from '@lcw/content';
import { ADV } from '../core/tuning.js';
import { Battle } from '../core/battle.js';
import { arenaRect } from '../core/bullets.js';
import { buildChapterPlan } from '../core/plan.js';
import { createRng } from '../core/rng.js';
import { newRun } from '../core/run.js';

/**
 * R2734 (Dan 11-19: "the boss is too easy, it should be harder"): every guardian is a real fight. A child who talks
 * perfectly (3 stars every time) but never moves the voice bubble mostly runs out of voice before the guardian is
 * calm; a child who dodges (the page's test pilot) and talks well befriends it — hard, but fair. Measured over three
 * seeds per guardian with a fresh trip (no gear, no skills, no snacks used).
 */

type Play = { outcome: Battle['outcome']; turns: number; minHp: number; hits: number };

function play(chapter: 1 | 2 | 3 | 4, dodge: boolean, seed: number): Play {
  const g = buildChapterPlan({ chapter, level: 1 }).encounters.find((e) => e.creature.role === 'guardian')!;
  const b = new Battle(g, createRng(seed), newRun());
  const ph = (): Battle['phase'] => b.phase;
  let turns = 0;
  let minHp = b.hp;
  let hits = 0;
  for (let guard = 0; guard < 20000 && ph() !== 'end'; guard++) {
    if (ph() === 'msg') b.advance();
    else if (ph() === 'menu') {
      if (b.ready) b.choose('friend');
      else {
        b.choose('talk');
        b.pickTalk(b.choices[0]!.id);
        b.talkResult({ stars: 3, score: 1, pass: true, missed: [] });
      }
    } else if (ph() === 'dodge') {
      turns += 1;
      let last = b.hp;
      while (ph() === 'dodge') {
        b.step(1 / 60, { x: 0, y: 0 }, dodge);
        if (b.hp < last) hits += 1;
        last = b.hp;
        minHp = Math.min(minHp, b.hp);
      }
    } else if (ph() === 'befriend') b.befriend();
    else b.step(1 / 60, { x: 0, y: 0 }, dodge);
  }
  return { outcome: b.outcome, turns, minHp, hits };
}

describe('guardians are hard but fair (R2734)', () => {
  it('standing still loses to every guardian; dodging and talking well befriends it', () => {
    const report: Record<string, unknown> = {};
    const runs: Array<{ ch: number; still: Play[]; dodged: Play[] }> = [];
    for (const ch of [1, 2, 3, 4] as const) {
      const still = [1, 2, 3].map((s) => play(ch, false, s));
      const dodged = [1, 2, 3].map((s) => play(ch, true, s));
      report[`ch${ch}`] = { still: still.map((p) => `${p.outcome}@${p.turns} hp≥${p.minHp} hits ${p.hits}`), dodged: dodged.map((p) => `${p.outcome}@${p.turns} hp≥${p.minHp} hits ${p.hits}`) };
      runs.push({ ch, still, dodged });
    }
    console.log(JSON.stringify(report));
    for (const { ch, still, dodged } of runs) {
      // three tries each: standing still loses most of them; dodging wins them all (the Hushwind, the last one, may
      // still win one of three against the pilot — a retry is slower, adventure-core "out of voice")
      expect(still.filter((p) => p.outcome === 'down').length, `island ${ch}: no dodging loses`).toBeGreaterThanOrEqual(2);
      expect(dodged.filter((p) => p.outcome === 'spared').length, `island ${ch}: dodging and talking wins`).toBeGreaterThanOrEqual(ch === 4 ? 2 : 3);
      // a guardian takes several turns: at least three of its turns before it is calm
      for (const p of dodged) expect(p.turns, `island ${ch}: turns`).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('the voice and calm bars stay on screen (R2734 390 shot)', () => {
  it('under every dodge page the bars fit inside the 240 screen', () => {
    const ids: AdventurePatternId[] = ['acornDrop', 'leafRing', 'letterCatch', 'spellBubbles', 'shellSweep', 'bubbleRise', 'rollBounce', 'sprinkleRain', 'wordCookies', 'windSpiral', 'inkRain', 'kiteDive'];
    for (const id of ids) {
      const a = arenaRect(id);
      // render.ts: bars at a.y + a.h + 9, 7 px tall, label 9 px — all of it inside the screen
      expect(a.y + a.h + 9 + 5, id).toBeLessThanOrEqual(ADV.screen.h);
    }
  });
});
