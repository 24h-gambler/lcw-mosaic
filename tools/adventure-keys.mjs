// R2734 ①: the whole /adventure/ trip in a real headless browser with the keyboard only — opening story → island 1
// (the guardian wins the first meeting on purpose, the child wakes at the last lantern post, meets it again and wins)
// → the boat → islands 2-4 → the ending and the last words → back to the map. Every Z must change what is on screen
// (0 stalls). The key brain is the same one the engine test drives (tools/adventure-autoplay.mjs); here it presses
// real keys (page.keyboard) and reads the page's read-only handle window.__adv.debugState().
//
// Dodging is the page's own test pilot (?autopilot=1, only while no key is held); everything else is keys. No student
// id, no class code, no lesson: nothing is written anywhere, /v1/* answers 404 from the dev server. Audio muted
// (--mute-audio) — the music still runs in the audio graph, and the notes each track scheduled are read back.
//
//   node tools/adventure-keys.mjs http://127.0.0.1:8994/adventure/ <outDir> [p390|d1440 ...]
//   (PLAYWRIGHT_CORE=<path to playwright-core/index.mjs> if playwright-core is not resolvable)
//
// Writes <outDir>/<viewport>-NN-<what>.png (one per new scene / guardian stage / story page kind) and
// <outDir>/keys-<viewport>.json (actions, Z presses, stalls, downs, chests, buys, skills, replies, stages, tracks and
// the notes each track played, the audio context state). Exit code 1 when the trip did not end or Z stalled.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createAutoplay, zSignature } from './adventure-autoplay.mjs';

const base = process.argv[2] ?? 'http://127.0.0.1:8994/adventure/';
const out = process.argv[3] ?? 'shots/adventure-keys';
const want = process.argv.slice(4);
const VIEWPORTS = [
  { name: 'p390', width: 390, height: 844 },
  { name: 'd1440', width: 1440, height: 900 }
].filter((v) => !want.length || want.includes(v.name));

const pw = process.env.PLAYWRIGHT_CORE ? await import(pathToFileURL(process.env.PLAYWRIGHT_CORE).href) : await import('playwright-core');
const chromium = pw.chromium ?? pw.default.chromium;
const KEY = { z: 'z', x: 'x', up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };
const MAX_ACTIONS = 8000;
const MAX_MS = 25 * 60 * 1000;

mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'] });
let failed = false;

for (const vp of VIEWPORTS) {
  const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message ?? e).slice(0, 300)));
  const url = new URL(base);
  url.searchParams.set('autopilot', '1');
  await page.goto(url.href, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__adv && window.__adv.debugState().scene !== 'boot', null, { timeout: 30000 }).catch(() => {});
  await page.locator('canvas').first().click({ position: { x: 5, y: 5 } }).catch(() => {}); // the page has focus
  const state = () => page.evaluate(() => window.__adv.debugState());

  const ap = createAutoplay({ failBoss: [1] });
  const stalls = [];
  const shots = [];
  const shotKeys = new Set();
  let zs = 0;
  let actions = 0;
  let last = null;
  let minHp = Infinity;
  const t0 = Date.now();
  const shot = async (s, what) => {
    if (shotKeys.has(what) || shots.length >= 100) return;
    shotKeys.add(what);
    // the words type in and a new place fades in: wait until the text stops growing, then a moment for the fade, so the
    // picture shows what a child reads (no key is held here, so the page's pilot keeps dodging meanwhile)
    let prev = -1;
    for (let i = 0; i < 40; i++) {
      const r = await page.evaluate(() => window.__adv.debugState().reveal);
      if (r === prev) break;
      prev = r;
      await page.waitForTimeout(60);
    }
    await page.waitForTimeout(300);
    const f =`${vp.name}-${String(shots.length + 1).padStart(2, '0')}-${what.replace(/[^a-z0-9-]+/gi, '_')}.png`;
    await page.screenshot({ path: path.join(out, f) });
    shots.push({ file: f, scene: s.scene, phase: s.phase ?? null, chapter: s.chapter ?? null });
  };
  for (; actions < MAX_ACTIONS && Date.now() - t0 < MAX_MS; actions++) {
    const s = await state();
    if (s.scene === 'battle' && typeof s.run?.hp === 'number') minHp = Math.min(minHp, s.run.hp);
    // one picture per new kind of screen: the story page, each island's map, each meeting's phase, each stage, …
    const ch = s.chapter ?? 0;
    const boss = !!s.battle?.boss;
    const what =
      s.scene === 'story'
        ? `story-${s.story?.kind ?? ''}-${ch}`
        : s.scene === 'battle'
          ? // every phase once on island 1, then the dodge page of each meeting and each guardian stage's turns
            ch === 1 && !boss
            ? `battle-1-critter-${s.phase}`
            : boss && ['msg', 'menu', 'talk', 'dodge'].includes(s.phase)
              ? `battle-${ch}-boss-stage${(s.battle.stage ?? 0) + 1}-${s.phase}`
              : !boss && s.phase === 'dodge'
                ? `battle-${ch}-critter-dodge`
                : null
          : s.scene === 'explore'
            ? `explore-${ch}${s.shop ? '-shop' : s.talkChoices?.length || s.choices?.length ? '-choices' : s.msg ? '-talk' : ''}`
            : `${s.scene}-${ch}`;
    if (what) await shot(s, what);
    const a = ap.next(s);
    last = a;
    if ('done' in a) break;
    if ('key' in a) {
      if (a.key === 'z') {
        zs += 1;
        const before = zSignature(s);
        await page.keyboard.press('z');
        // a Z either acts at once (the engine) or presses the panel's button (React re-renders next frame)
        let after = before;
        for (let i = 0; i < 6 && after === before; i++) {
          await page.waitForTimeout(20);
          after = zSignature(await state());
        }
        if (after === before) stalls.push(`${s.scene}/${s.phase ?? ''}: ${a.why ?? ''}`);
      } else {
        await page.keyboard.press(KEY[a.key]);
        await page.waitForTimeout(20);
      }
    } else if ('hold' in a) {
      await page.keyboard.down(KEY[a.hold]);
      await page.waitForTimeout(Math.max(17, a.ms));
      await page.keyboard.up(KEY[a.hold]);
    } else await page.waitForTimeout(Math.max(17, a.wait));
  }
  const st = await state();
  const seen = ap.mem.seen;
  await shot(st, 'final');
  const audio = st.audio;
  const tracks = [...new Set(audio.tracks)];
  const silent = tracks.filter((t) => !(audio.notes[t] > 0) && t !== 'down');
  const ok =
    !!last && 'done' in last && ap.mem.endingSeen && stalls.length === 0 && errors.length === 0 && seen.downs.some((d) => d.chapter === 1 && d.boss && d.where === 'post');
  const report = {
    viewport: vp,
    ok,
    seconds: Math.round((Date.now() - t0) / 1000),
    actions,
    zPresses: zs,
    stalls,
    pageErrors: errors,
    endingSeen: ap.mem.endingSeen,
    endScene: st.scene,
    chaptersDone: Object.keys(st.progress?.chapters ?? {}),
    minHpInBattle: minHp,
    downs: seen.downs,
    bossTries: st.run?.bossTries,
    chests: seen.chests,
    buys: seen.buys,
    skills: seen.skills,
    replies: seen.replies,
    stages: [...seen.stages],
    battles: seen.battles.length,
    audio: { ctx: audio.ctx, tracks, notes: audio.notes, silentTracks: silent, sfx: audio.sfx },
    shots
  };
  writeFileSync(path.join(out, `keys-${vp.name}.json`), JSON.stringify(report, null, 1));
  console.log(
    JSON.stringify({ viewport: vp.name, ok, seconds: report.seconds, actions, zs, stalls: stalls.length, errors: errors.length, downs: seen.downs.length, chests: seen.chests.length, buys: seen.buys.length, skills: seen.skills.length, stages: report.stages.length, tracks: tracks.length, ctx: audio.ctx, silent })
  );
  if (!ok) failed = true;
  await page.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
