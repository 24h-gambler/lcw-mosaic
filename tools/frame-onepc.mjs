#!/usr/bin/env node
/**
 * 1PC lesson screen layout check (docs/08 §8.6, R2722 follow-up): one PC for teacher and child, so the child's 3D
 * screen carries the small teacher button (lesson/TeacherPanel.tsx, shown when this browser holds the /director
 * operator sign-in). 1280 touch: the button lay on the view button. Every kid-screen part (tools/frame-layout.mjs, real
 * boxes) against every other one, mouse and touch, at 390 / 1280 / 1440.
 *
 * No server behind it: the lesson is a stand-in answered here (join, state with the teacher present), the operator
 * sign-in a fake token, every other server call cut like a dropped line. Nothing is written anywhere.
 *
 *   node tools/frame-onepc.mjs http://127.0.0.1:8986/world/ [outDir]
 * Env: PLAYWRIGHT_CORE (path to playwright-core index.mjs), FRAME_LANG / KO_HELP (tools/frame-lang-expect.mjs),
 * FRAME_SETTINGS (JSON player settings, e.g. '{"textScale":1.5}').
 * Prints PASS n viewports or FAIL with one line per problem; exit 1 on FAIL.
 */
import { mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { layoutIssues } from './frame-layout.mjs';
import { langInitScript, cacheWebFonts } from './frame-lang-expect.mjs';

const base = process.argv[2] ?? 'http://127.0.0.1:8986/world/';
const out = process.argv[3] ?? null;
if (out) mkdirSync(out, { recursive: true });
const pw = await import(process.env.PLAYWRIGHT_CORE ? pathToFileURL(process.env.PLAYWRIGHT_CORE).href : 'playwright-core');
const chromium = pw.chromium ?? pw.default.chromium;

const VIEWPORTS = [
  { name: 'p390-touch', width: 390, height: 844, touch: true },
  { name: 'p390-mouse', width: 390, height: 844, touch: false },
  { name: 'l844-touch', width: 844, height: 390, touch: true },
  // a phone with the browser's bars and a small phone: a tall lesson sheet leaves little room above it
  { name: 'p390x664-touch', width: 390, height: 664, touch: true },
  { name: 'p360x640-touch', width: 360, height: 640, touch: true },
  // a 1PC browser window with its tabs and address bar
  { name: 'd1280x680-mouse', width: 1280, height: 680, touch: false },
  { name: 't1280-touch', width: 1280, height: 800, touch: true },
  { name: 'd1280-mouse', width: 1280, height: 800, touch: false },
  { name: 't1440-touch', width: 1440, height: 900, touch: true },
  { name: 'd1440-mouse', width: 1440, height: 900, touch: false }
];

// the stage's sentences: none (the lesson's own speak panel) or one (the dialog window, folded by its ✕ in 'folded')
const OFFERS = [{ stars: 1, text: 'My name is Mina.', hintTags: [] }];
const STATE = (offers) => ({
  lesson_id: 'fs-lesson',
  stage_id: 'warmup_anchor',
  stage_goal_ko: '선생님 질문에 영어로 내 이야기를 해 봐요',
  stage_goal_en: 'Tell your teacher about you',
  mode: 'free',
  scene_id: 'plaza',
  npc_id: 'guide',
  hint: 'full',
  targets: [],
  offers,
  possessed_npc_id: null,
  npc_lines: [],
  events: [],
  cursor: 0,
  ended: false,
  coins_balance: 120,
  lesson_stars: 2,
  teacher: { present: true, name: 'Ms. Teacher', since: Date.now() - 60000 },
  plan_id: 'first_lesson_v1',
  server_now: Date.now()
});
const JOIN = { student_token: 'frame-onepc-student-token', lesson_id: 'fs-lesson', player_id: 'fs-player', nickname: 'Mina', level: 'L1' };

const SETTINGS = process.env.FRAME_SETTINGS ? JSON.parse(process.env.FRAME_SETTINGS) : null;
const fails = [];
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--mute-audio', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
});
/** Every button the child or the teacher can press: its middle is itself, nothing lies on it (a real tap lands). */
const PRESS = '[data-lcw-lesson] button, [data-lcw-lesson] a[href], .lw-touch.on .lw-btn, .lcw-hudbtn';
async function covered(page) {
  return page.evaluate((sel) => {
    const bad = [];
    const say = (n) => (n.getAttribute?.('aria-label') || n.textContent || String(n.className || n.tagName)).replace(/\s+/g, ' ').trim().slice(0, 30);
    for (const b of document.querySelectorAll(sel)) {
      const r = b.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      let o = 1;
      let hidden = false;
      for (let n = b; n && n !== document.documentElement; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (cs.display === 'none' || cs.visibility === 'hidden') hidden = true;
        o *= Number(cs.opacity);
      }
      if (hidden || o < 0.3) continue;
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
      const at = document.elementFromPoint(x, y);
      if (!at || !(at === b || b.contains(at))) bad.push(`a tap on "${say(b)}" lands on "${at ? say(at) : 'nothing'}"`);
    }
    return bad;
  }, PRESS);
}

try {
  for (const vp of VIEWPORTS) {
    for (const phase of ['speak', 'folded']) {
      const name = `${vp.name}-${phase}`;
      const fail = (m) => fails.push(`${name}: ${m}`);
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, isMobile: false });
      await cacheWebFonts(ctx);
      await langInitScript(ctx);
      await ctx.addInitScript((set) => {
        try {
          localStorage.setItem('lcw.operatorToken', 'frame-onepc-operator-token');
          // FRAME_SETTINGS: the player's settings on this device (text size 150% and so on), as tools/frame-shots.mjs
          if (set) localStorage.setItem('lcw.settings', JSON.stringify({ ...set, updatedAt: Date.now() }));
        } catch {
          /* no storage: no teacher button, the check says so */
        }
      }, SETTINGS);
      const offers = phase === 'folded' ? OFFERS : [];
      await ctx.route('**/v1/**', (r) => {
        const path = new URL(r.request().url()).pathname;
        const json = (o) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
        if (path === '/v1/join') return json(JOIN);
        if (path === '/v1/lesson/state') return json(STATE(offers));
        if (path === '/v1/tts/status') return json({ enabled: false });
        return r.abort('aborted');
      });
      const page = await ctx.newPage();
      page.setDefaultTimeout(60000);
      const errs = [];
      page.on('pageerror', (e) => errs.push(`pageerror: ${e.message.slice(0, 200)}`));
      const sep = base.includes('?') ? '&' : '?';
      await page.goto(`${base}${sep}scene=plaza&code=123456`, { waitUntil: 'domcontentloaded', timeout: 90000 });
      await page.waitForFunction(() => !!window.__lcwWorld && document.querySelector('.lw-load.done'), null, { timeout: 120000 });
      // title and first-visit / mic cards: past them like a child
      for (let n = 0; n < 6; n++) {
        for (const nm of [/^(시작하기|Start)/, /^(건너뛰기|Skip)$/, /^(좋아요, 출발!|OK, let's go!)$/]) {
          const b = page.getByRole('button', { name: nm });
          if (await b.first().isVisible().catch(() => false)) await b.first().click({ timeout: 4000 }).catch(() => {});
        }
        if (await page.getByTestId('teacher-panel-toggle').isVisible().catch(() => false)) break;
        if (await page.locator('.lcw-dlg__x').first().isVisible().catch(() => false)) break;
        await page.waitForTimeout(2000);
      }
      if (phase === 'folded') {
        // the dialog window comes up with the stage's sentence; its ✕ folds it (the reopen button and the status row)
        const x = page.locator('.lcw-dlg__x');
        if (await x.first().waitFor({ state: 'visible', timeout: 15000 }).then(() => true, () => false)) await x.first().click({ timeout: 4000 }).catch(() => {});
        if (!(await page.getByTestId('lesson-reopen').waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false))) fail('the lesson dialog window did not fold (no reopen button)');
      }
      const toggle = page.getByTestId('teacher-panel-toggle');
      const shown = await toggle.waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false);
      if (!shown) fail('teacher button not on the screen (1PC lesson did not come up)');
      // let the goal card, the teacher tag and the measures settle
      await page.waitForTimeout(2500);
      if (process.env.ONEPC_DEBUG) console.log(name, JSON.stringify(await page.evaluate(() => { const r = document.querySelector('.lw-hud'); const d = document.documentElement; const cs = getComputedStyle(d); return { cls: r?.className, floor: r?.style.getPropertyValue('--lw-floor'), mode: d.getAttribute('data-lcw-floor'), max: cs.getPropertyValue('--lcw-hud-sheet-max'), top: cs.getPropertyValue('--lcw-hud-sheet-top'), help: document.querySelector('.lw-help')?.className, cap: document.querySelector('.lw-cap')?.className }; })));
      // the floor mode settles: two reads 1.5 s apart (a mode that feeds itself flips every measure; review of #181)
      const modeNow = () => page.evaluate(() => {
        const r = document.querySelector('.lw-hud');
        return `${r?.className} ${r?.style.getPropertyValue('--lw-floor')} ${getComputedStyle(document.documentElement).getPropertyValue('--lcw-hud-sheet-top')}`;
      });
      const m1 = await modeNow();
      await page.waitForTimeout(1500);
      const m2 = await modeNow();
      if (m1 !== m2) fail(`the HUD keeps re-placing itself: "${m1}" then "${m2}"`);
      const { problems } = await layoutIssues(page);
      for (const p of problems) fail(p);
      for (const p of await covered(page)) fail(p);
      if (out) await page.screenshot({ path: `${out}/${name}.png` });
      // the HUD's Talk (touch, by an NPC) opens the folded window again: tapped like a child
      const talk = page.locator('.lw-touch.on .lw-btn.talk.on');
      // the child stands by the lesson NPC: on touch the Talk button must be there to tap
      // (a small phone with no room above the folded window hides it: the window's own button is there instead)
      const noTalk = await page.evaluate(() => !!document.querySelector('.lw-hud.floor-notalk'));
      if (vp.touch && !(await talk.count()) && !(noTalk && (await page.getByTestId('lesson-reopen').isVisible().catch(() => false)))) fail('Talk button not shown on touch by the lesson NPC');
      if ((await talk.count()) && !noTalk) {
        // the tap reaches the world's talk (the Talk button runs the same talk as the E key: interact.byKey counts it,
        // a tap on the NPC itself counts byTap); by the lesson's own NPC it opens the window again (folded phase)
        await page.evaluate(() => {
          window.__talkEv = [];
          window.addEventListener('lcw:lesson-talk', (e) => window.__talkEv.push(e.detail));
        });
        const before = await page.evaluate(() => window.__lcwWorld.getStats().interact ?? null);
        await talk.first().tap({ timeout: 4000 }).catch((e) => fail(`Talk tap: ${String(e).slice(0, 80)}`));
        // the window is a fixed modal inside a zero-size holder (lesson-dialog): its own box is what shows
        const opened = await page.locator('[data-testid="lesson-dialog"] .lcw-dlg__win').first().waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false);
        const after = await page.evaluate(() => window.__lcwWorld.getStats().interact ?? null);
        const reached = !!before && !!after && (after.byTap > before.byTap || after.byKey > before.byKey);
        if (!reached && !opened) fail(`a tap on Talk does not reach the world (near ${before?.near ?? '-'})`);
        else if (phase === 'folded' && before?.near === STATE([]).npc_id && !opened) fail(`a tap on Talk by the lesson NPC does not open the lesson dialog window (events ${JSON.stringify(await page.evaluate(() => window.__talkEv))}, interact ${JSON.stringify(after)})`);
      }
      if (shown && phase === 'speak') {
        // the teacher can press it: the lock card opens and leaves the button uncovered
        await toggle.click({ timeout: 4000 }).catch(() => {});
        const lock = page.getByTestId('teacher-panel-lock');
        if (!(await lock.waitFor({ state: 'visible', timeout: 4000 }).then(() => true, () => false))) fail('teacher button does not open the lock card');
        else {
          const [a, b] = await Promise.all([toggle.boundingBox(), lock.boundingBox()]);
          if (a && b && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height) fail('the lock card covers the teacher button');
          if (out) await page.screenshot({ path: `${out}/${name}-lock.png` });
          await toggle.click({ timeout: 4000 }).catch(() => {});
        }
      }
      for (const e of errs) fail(e);
      await ctx.close();
    }
  }
} finally {
  await browser.close();
}
console.log(fails.length ? `FAIL\n${fails.join('\n')}` : `PASS ${VIEWPORTS.length} viewports x 2 (speak panel, folded window)`);
process.exit(fails.length ? 1 : 0);
