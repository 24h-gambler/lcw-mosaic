import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
// plain .mjs shared with the headless browser bot (types: adventure-autoplay.d.mts)
import { createAutoplay, zSignature, type AutoplayAction } from '../../../../tools/adventure-autoplay.mjs';

/**
 * R2734 ①: the whole trip with keys only — opening story → island 1 (the guardian wins the first meeting, the child
 * wakes at the last lantern post and meets it again) → the boat → islands 2-4 → the ending and the last words — and
 * Z never stalls: every Z changes what is on screen. The same key brain drives tools/adventure-keys.mjs in a browser.
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
  // dodging is the page's own test pilot (only while no key is held); everything else below is keys
  vi.stubGlobal('location', { search: '?autopilot=1' });
  vi.stubGlobal('localStorage', memStore());
  vi.stubGlobal('sessionStorage', memStore());
  vi.stubGlobal('fetch', () => Promise.reject(new Error('offline in the test')));
});
afterAll(() => vi.unstubAllGlobals());

const FRAME = 1000 / 60;

describe('adventure play-through with keys only (R2734 ①)', () => {
  it('title → every island → the guardian wins once → lantern post → retry → ending, with 0 stalls', async () => {
    const { Engine } = await import('../engine.js');
    const e = new Engine();
    await e.boot();
    const ap = createAutoplay({ failBoss: [1] });
    let simFrames = 0;
    const frames = (n: number) => {
      simFrames += n;
      for (let i = 0; i < n; i++) e.step(1 / 60);
    };
    const stalls: string[] = [];
    let zs = 0;
    let actions = 0;
    let last: AutoplayAction | null = null;
    const hpSeen: number[] = [];
    for (; actions < 60000; actions++) {
      const s = e.debugState();
      if (s.scene === 'battle') hpSeen.push(s.run.hp);
      const a = ap.next(s);
      last = a;
      if ('done' in a) break;
      if ('key' in a) {
        if (a.key === 'z') {
          zs += 1;
          const before = zSignature(s);
          const ok = e.confirm();
          frames(1);
          if (!ok || zSignature(e.debugState()) === before) stalls.push(`${s.scene}/${s.phase ?? ''}: ${a.why ?? ''}`);
        } else if (a.key === 'x') {
          e.cancel();
          frames(1);
        } else {
          expect(e.wantsArrows(), `${s.scene}/${s.phase}: arrows go to a list`).toBe(true);
          e.menuMove(a.key === 'up' ? -1 : 1);
          frames(1);
        }
      } else if ('say' in a) {
        e.talkAttempt({ mode: 'typed', transcripts: [a.say] });
        frames(1);
      } else if ('hold' in a) {
        e.keys.add(a.hold);
        frames(Math.max(1, Math.round(a.ms / FRAME)));
        e.keys.delete(a.hold);
      } else frames(Math.max(1, Math.round(a.wait / FRAME)));
    }
    const st = e.debugState();
    const seen = ap.mem.seen;
    console.log(JSON.stringify({ actions, zs, simSeconds: Math.round(simFrames / 60), stalls: stalls.length, downs: seen.downs, buys: seen.buys, skills: seen.skills, chests: seen.chests.length, replies: seen.replies.map((r) => `${r.chapter}:${r.who}:${r.reply}`), runSkills: st.run.skills, minHp: Math.min(...hpSeen), battles: seen.battles.length, stages: [...seen.stages], chapterSeconds: seen.chapterSeconds, bossTry: seen.bossTry, bossRun: seen.bossRun, skipped: [...ap.mem.skipped], coins: st.run.coins, tracks: [...new Set(st.audio.tracks)] }));
    // the ending was reached and the trip is back on the map
    expect(last && 'done' in last ? last.why ?? 'done' : 'ran out of actions').toBe('done');
    expect(ap.mem.endingSeen).toBe(true);
    expect(st.scene).toBe('title');
    expect(st.run.flags).toContain('ending');
    for (const ch of [1, 2, 3, 4] as const) expect(st.progress.chapters[ch]?.stars ?? -1, `island ${ch} finished`).toBeGreaterThanOrEqual(0);
    // Z never stalled
    expect(stalls).toEqual([]);
    expect(zs).toBeGreaterThan(100);
    // the guardian of island 1 won the first meeting: down, woke at the lantern post with full voice, met it again
    const down = seen.downs.find((d) => d.chapter === 1 && d.boss);
    expect(down, 'the first guardian meeting was lost').toBeTruthy();
    expect(down!.where).toBe('post');
    expect(Math.min(...hpSeen)).toBe(0);
    expect(st.run.bossTries[1]).toBeGreaterThanOrEqual(1);
    expect(seen.battles.filter((b) => b.chapter === 1 && b.boss).length).toBeGreaterThanOrEqual(2);
    // every island: a chest opened, a talk with choices, three gate mini bosses and the guardian met
    for (const ch of [1, 2, 3, 4]) {
      expect(st.run.flags.some((f: string) => f.startsWith(`chest-${ch}-`)), `chest on island ${ch}`).toBe(true);
      expect(seen.replies.some((r) => r.chapter === ch), `a reply on island ${ch}`).toBe(true);
      expect(seen.battles.filter((b) => b.chapter === ch).length, `meetings on island ${ch}`).toBeGreaterThanOrEqual(4);
      for (let i = 0; i < 3; i++) expect(st.run.flags, `mini ${i} on island ${ch}`).toContain(`mini-${ch}-${i}`);
      expect([...seen.stages].some((k) => k.startsWith(`${ch}:`)), `guardian stages on island ${ch}`).toBe(true);
    }
    // the cart sold something, a magic word was used, the quiz paid
    expect(seen.buys.length).toBeGreaterThanOrEqual(1);
    expect(seen.skills.length).toBeGreaterThanOrEqual(1);
    expect(st.run.flags).toContain('quiz-1');
    // R2861 bot metrics: each island took real engine seconds, and the first guardian try was recorded per island
    expect(seen.chapterSeconds.length, 'chapter seconds measured').toBe(4);
    for (const c of seen.chapterSeconds) expect(c.seconds, `island ${c.chapter} seconds`).toBeGreaterThan(0);
    const firstTries = seen.bossRun.filter((r) => r.attempt === 1);
    expect(firstTries.length, 'four first guardian tries').toBe(4);
    // the bot deliberately loses island 1's first try (failBoss), then wins; the other three are first-try clears
    expect(firstTries.filter((r) => r.outcome !== 'down').length).toBeGreaterThanOrEqual(3);
    // music: each island, each guardian, the cart, the post, the down page, the boat and the ending all reached the player
    const tracks = new Set(st.audio.tracks);
    for (const t of ['story', 'shop', 'post', 'down', 'sail', 'ending', 'battle', 'friend']) expect(tracks.has(t as never), `track ${t}`).toBe(true);
    expect(tracks.size).toBeGreaterThanOrEqual(16);
  }, 120_000);
});
