import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { GATES } from '../core/map.js';
import { createAutoplay } from '../../../../tools/adventure-autoplay.mjs';

/**
 * R2861 (Dan 11-23: "English is never needed, the boss does not have to fall, you can walk straight to the boss"):
 * the paths that must stay shut, walked by the real engine with keys (the same bot brain as the full play-through).
 *   1. skip bot   — opens every TALK and backs out of the English every time (the old "Not now")
 *   2. no-talk    — pokes only, never says English
 *   3. loser bot  — talks, but loses every guardian meeting (the guardian's voice bar never runs out of grump)
 * For each: next island 0, guardian flag 0, and (1, 2) the player never stands past the first gate.
 * Bot 3 also shows the guardian is just as fast on the fourth try as on the first (no easing).
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

type Trace = {
  maxTx: number;
  bossMeetings: number;
  bossSpeeds: number[];
  downsAtBoss: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  last: any;
};

async function drive(opts: Parameters<typeof createAutoplay>[0], maxActions: number, stop?: (t: Trace) => boolean): Promise<Trace> {
  localStorage.clear();
  sessionStorage.clear();
  const { Engine } = await import('../engine.js');
  const e = new Engine();
  await e.boot();
  const ap = createAutoplay(opts);
  const frames = (n: number) => {
    for (let i = 0; i < n; i++) e.step(1 / 60);
  };
  const tr: Trace = { maxTx: 0, bossMeetings: 0, bossSpeeds: [], downsAtBoss: 0, last: null };
  let inBoss = false;
  let wasDown = false;
  for (let actions = 0; actions < maxActions; actions++) {
    const s = e.debugState();
    if (s.chapter === 1 && (s.scene === 'explore' || s.scene === 'battle')) tr.maxTx = Math.max(tr.maxTx, s.player.tx);
    const boss = s.scene === 'battle' && Boolean(s.battle?.boss);
    if (boss && !inBoss) {
      tr.bossMeetings += 1;
      tr.bossSpeeds.push(s.battle?.slow ?? -1);
    }
    inBoss = boss;
    const down = s.scene === 'down' && Boolean(s.down?.boss);
    if (down && !wasDown) tr.downsAtBoss += 1;
    wasDown = down;
    if (stop?.(tr)) break;
    const a = ap.next(s);
    if ('done' in a) break;
    if ('key' in a) {
      if (a.key === 'z') e.confirm();
      else if (a.key === 'x') e.cancel();
      else e.menuMove(a.key === 'up' ? -1 : 1);
      frames(1);
    } else if ('say' in a) {
      e.talkAttempt({ mode: 'typed', transcripts: [a.say] });
      frames(1);
    } else if ('hold' in a) {
      e.keys.add(a.hold);
      frames(Math.max(1, Math.round(a.ms / FRAME)));
      e.keys.delete(a.hold);
    } else frames(Math.max(1, Math.round(a.wait / FRAME)));
  }
  tr.last = e.debugState();
  return tr;
}

describe('R2861 shut paths, walked by the real engine', () => {
  it('skip bot: backing out of every English talk opens no gate and clears no island', async () => {
    const t = await drive({ skipTalk: true }, 6000);
    const st = t.last;
    expect(Object.keys(st.progress.chapters), 'next island 0').toEqual([]);
    expect(st.run.flags.filter((f: string) => f.startsWith('mini-') || f.startsWith('boss-') || f.startsWith('talk-')), 'no gatekeeper, no talk, no guardian').toEqual([]);
    expect(t.maxTx, 'never past gate 1').toBeLessThan(GATES[0]!);
    expect(t.bossMeetings, 'the guardian room is never reached').toBe(0);
    console.log(JSON.stringify({ skipBot: { maxTx: t.maxTx, gate0: GATES[0], scene: st.scene, phase: st.phase, flags: st.run.flags } }));
  }, 120_000);

  it('no-talk bot: poking only never opens the first gate', async () => {
    const t = await drive({ neverTalk: true }, 6000);
    const st = t.last;
    expect(Object.keys(st.progress.chapters)).toEqual([]);
    expect(t.maxTx).toBeLessThan(GATES[0]!);
    expect(t.bossMeetings).toBe(0);
    console.log(JSON.stringify({ noTalkBot: { maxTx: t.maxTx, gate0: GATES[0], battle: st.battle && { grump: st.battle.grump, calm: st.battle.calm, ready: st.battle.ready } } }));
  }, 120_000);

  it('pick-only bot: answering every 3-way reply (never saying or typing a line) opens no gate and clears no island', async () => {
    const t = await drive({ pickOnly: true }, 9000);
    const st = t.last;
    expect(Object.keys(st.progress.chapters), 'next island 0').toEqual([]);
    expect(st.run.flags.filter((f: string) => f.startsWith('talk-') || f.startsWith('boss-')), 'no said-English flag, no guardian').toEqual([]);
    expect(t.bossMeetings, 'the guardian room is never reached').toBe(0);
    expect(st.battle?.talkPasses ?? 0, 'picks never count as a said line').toBe(0);
    console.log(JSON.stringify({ pickOnlyBot: { maxTx: t.maxTx, gate0: GATES[0], flags: st.run.flags, scene: st.scene } }));
  }, 120_000);

  it('loser bot: four lost guardian meetings, still island 1, and the fourth is exactly as fast as the first', async () => {
    const t = await drive({ loseBossAlways: true }, 60000, (tr) => tr.downsAtBoss >= 4);
    const st = t.last;
    expect(t.downsAtBoss, 'the guardian won four times').toBeGreaterThanOrEqual(4);
    expect(st.chapter, 'still on island 1').toBe(1);
    expect(Object.keys(st.progress.chapters), 'next island 0').toEqual([]);
    expect(st.run.flags, 'no guardian flag').not.toContain('boss-1');
    expect(new Set(t.bossSpeeds), 'no easing on a retry').toEqual(new Set([1]));
    // the gatekeepers were passed the honest way: three mini bosses and real English before the guardian room
    for (let i = 0; i < 3; i++) expect(st.run.flags).toContain(`mini-1-${i}`);
    expect(st.run.flags).toContain('talk-1');
    console.log(JSON.stringify({ loserBot: { bossMeetings: t.bossMeetings, downsAtBoss: t.downsAtBoss, speeds: t.bossSpeeds, scene: st.scene } }));
  }, 240_000);
});
