import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildIsland, findPath, GATES } from '../core/map.js';
import { buildChapterPlan } from '../core/plan.js';
import { Battle } from '../core/battle.js';
import { createRng } from '../core/rng.js';
import { newRun } from '../core/run.js';
import { createAutoplay } from '../../../../tools/adventure-autoplay.mjs';

/**
 * R2861 (Dan 11-23): the map's three gates cannot be walked around, English is needed to finish any meeting, and a
 * bot that never talks cannot clear even island 1. These are the acceptance tests behind the completion claim.
 */

function memStore(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => void m.delete(k),
    setItem: (k: string, v: string) => void m.set(k, String(v))
  };
}

beforeAll(() => {
  vi.stubGlobal('window', {});
  vi.stubGlobal('location', { search: '?autopilot=1' });
  vi.stubGlobal('localStorage', memStore());
  vi.stubGlobal('sessionStorage', memStore());
  vi.stubGlobal('fetch', () => Promise.reject(new Error('offline in the test')));
});
afterAll(() => vi.unstubAllGlobals());

const FRAME = 1000 / 60;

describe('R2861 gates: no boss rush, no silent pass', () => {
  it('the three gates block the path to the guardian; only opening them all reaches the boss room', () => {
    const m = buildIsland(1);
    expect(m.entities.filter((e) => e.kind === 'gate').length).toBe(3);
    const blocker = (tx: number, ty: number, opened: Set<number>) =>
      m.entities.some((e) => {
        if (e.kind !== 'gate' && e.kind !== 'critter' && e.kind !== 'guardian') return false;
        if (e.kind === 'guardian') return tx === e.tx && ty === e.ty;
        if (e.kind === 'gate' && opened.has(e.index)) return false;
        if (e.kind === 'critter' && opened.has(e.index)) return false;
        // the gate and its mini boss fill the three-tile opening (box 48 x 46), not just the centre tile
        return Math.abs(tx - e.tx) <= 1 && Math.abs(ty - e.ty) <= 1;
      });
    const guardian = m.entities.find((e) => e.kind === 'guardian')!;
    const path = (opened: Set<number>) => findPath(m, m.start, { tx: guardian.tx, ty: guardian.ty }, (tx, ty) => blocker(tx, ty, opened));

    const closed = path(new Set());
    expect(closed.some((s) => s.tx >= GATES[0]!), 'no step past gate 0 while all gates are closed').toBe(false);

    const one = path(new Set([0]));
    expect(one.some((s) => s.tx >= GATES[1]!), 'opening gate 0 alone does not reach gate 1').toBe(false);

    const all = path(new Set([0, 1, 2]));
    expect(all.length, 'all gates open: a real route exists').toBeGreaterThan(0);
    // the last step is next to the guardian (its own tile is solid)
    expect(Math.abs(all.at(-1)!.tx - guardian.tx) + Math.abs(all.at(-1)!.ty - guardian.ty)).toBeLessThanOrEqual(1);
  });

  it('attack alone never finishes a guardian; a full CALM with no English cannot be let go', () => {
    for (const ch of [1, 2, 3, 4] as const) {
      const enc = buildChapterPlan({ chapter: ch, level: 1 }).encounters.at(-1)!;
      const ph = (b: Battle) => b.phase;
      const b = new Battle(enc, createRng(ch), newRun());
      while (ph(b) === 'msg') b.advance();
      for (let n = 0; n < 60 && ph(b) !== 'end'; n++) {
        if (ph(b) === 'menu') {
          b.choose('poke');
          b.ring = 0.25;
          b.strike();
        }
        while (ph(b) === 'msg') b.advance();
        for (let i = 0; i < 60 * 12 && ph(b) === 'dodge'; i++) b.step(1 / 60, { x: 0, y: 0 }, true);
        while (ph(b) === 'msg') b.advance();
      }
      // never a "fought" or "spared" ending without English (it may run out of voice instead)
      expect(['fought', 'spared'], `ch${ch}: poking alone did not finish`).not.toContain(b.outcome);

      // a fresh meeting, CALM filled only by catching letters: "let go" is still refused without a talk
      const s = new Battle(enc, createRng(ch + 10), newRun());
      while (ph(s) === 'msg') s.advance();
      s.calm = s.enc.calmMax;
      s.talkPasses = 0;
      s.choose('friend');
      expect(ph(s), `ch${ch}: no silent spare`).not.toBe('befriend');
      expect(ph(s), `ch${ch}: no end`).not.toBe('end');
      // one real English talk unlocks it
      s.talkPasses = 1;
      while (ph(s) === 'msg') s.advance();
      s.choose('friend');
      expect(ph(s), `ch${ch}: a talked, calm guardian can be let go`).toBe('befriend');
    }
  });

  it('a bot that never talks cannot clear island 1 (0 chapters) and never sets the boss flag', async () => {
    const { Engine } = await import('../engine.js');
    const e = new Engine();
    await e.boot();
    const ap = createAutoplay({ neverTalk: true });
    for (let actions = 0; actions < 5000; actions++) {
      const s = e.debugState();
      const a = ap.next(s);
      if ('done' in a) break;
      if ('key' in a) {
        if (a.key === 'z') e.confirm();
        else if (a.key === 'x') e.cancel();
        else e.menuMove(a.key === 'up' ? -1 : 1);
        e.step(1 / FRAME);
      } else if ('say' in a) {
        e.talkAttempt({ mode: 'typed', transcripts: [a.say] });
        e.step(1 / FRAME);
      } else if ('hold' in a) {
        e.keys.add(a.hold);
        for (let i = 0; i < Math.max(1, Math.round(a.ms / FRAME)); i++) e.step(1 / FRAME);
        e.keys.delete(a.hold);
      } else for (let i = 0; i < Math.max(1, Math.round(a.wait / FRAME)); i++) e.step(1 / FRAME);
    }
    const st = e.debugState();
    expect(st.progress.chapters[1]?.clearedOn ?? null, 'no chapter was cleared').toBeNull();
    expect(Object.keys(st.progress.chapters), '0 cleared chapters').toEqual([]);
    expect(st.scene, 'never reached an end page').not.toBe('end');
    expect(st.run.flags, 'no guardian flag').not.toContain('boss-1');
    console.log(JSON.stringify({ noTalkBot: { seconds: Math.round(st.t), chapter: st.chapter, scene: st.scene, enemy: st.battle?.creature, clears: Object.keys(st.progress.chapters).length, bossFlag: st.run.flags.includes('boss-1') } }));
  }, 120_000);

  it('a calmed gatekeeper in a locked gate: the gate says the chest key is missing (not the friend line forever)', async () => {
    localStorage.clear();
    sessionStorage.clear();
    const { Engine } = await import('../engine.js');
    const e = new Engine();
    await e.boot();
    const ap = createAutoplay({});
    for (let n = 0; n < 400; n++) {
      const s = e.debugState();
      if (s.scene === 'explore' && s.chapter === 1 && !s.msg) break;
      const a = ap.next(s);
      if ('done' in a) break;
      if ('key' in a && a.key === 'z') e.confirm();
      else if ('say' in a) e.talkAttempt({ mode: 'typed', transcripts: [a.say] });
      for (let i = 0; i < 6; i++) e.step(1 / 60);
    }
    expect(e.debugState().scene).toBe('explore');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const eng = e as any;
    eng.run.flags.push('mini-1-0'); // the gatekeeper was calmed, but chest 0 was never opened
    const critter = eng.entities.find((x: { e: { id: string } }) => x.e.id === 'critter-0');
    critter.state = 'friend';
    eng.placeAt(GATES[0]! - 1, 7);
    eng.player.dir = 2;
    eng.player.flip = false;
    e.confirm();
    const st = e.debugState();
    expect(st.msgWho, 'the gate answers').toBe('Gate');
    expect(st.msg, 'and names the missing key').toMatch(/key 1/);
    expect(st.entities.find((x) => x.id === 'gate-0')?.state, 'still shut').toBe('idle');
  }, 60_000);
});
