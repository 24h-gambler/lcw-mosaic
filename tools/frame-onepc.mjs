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
  { name: 't1280-touch', width: 1280, height: 800, touch: true },
  { name: 'd1280-mouse', width: 1280, height: 800, touch: false },
  { name: 't1440-touch', width: 1440, height: 900, touch: true },
  { name: 'd1440-mouse', width: 1440, height: 900, touch: false }
];

const STATE = () => ({
  lesson_id: 'fs-lesson',
  stage_id: 'warmup_anchor',
  stage_goal_ko: '선생님 질문에 영어로 내 이야기를 해 봐요',
  stage_goal_en: 'Tell your teacher about you',
  mode: 'free',
  scene_id: 'plaza',
  npc_id: 'guide',
  hint: 'full',
  targets: [],
  offers: [],
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
try {
  for (const vp of VIEWPORTS) {
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
    await ctx.route('**/v1/**', (r) => {
      const path = new URL(r.request().url()).pathname;
      const json = (o) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
      if (path === '/v1/join') return json(JOIN);
      if (path === '/v1/lesson/state') return json(STATE());
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
      for (const name of [/^(시작하기|Start)/, /^(건너뛰기|Skip)$/, /^(좋아요, 출발!|OK, let's go!)$/]) {
        const b = page.getByRole('button', { name });
        if (await b.first().isVisible().catch(() => false)) await b.first().click({ timeout: 4000 }).catch(() => {});
      }
      if (await page.getByTestId('teacher-panel-toggle').isVisible().catch(() => false)) break;
      await page.waitForTimeout(2000);
    }
    const shown = await page.getByTestId('teacher-panel-toggle').isVisible().catch(() => false);
    if (!shown) fails.push(`${vp.name}: teacher button not on the screen (1PC lesson did not come up)`);
    // let the goal card, the teacher tag and the measures settle
    await page.waitForTimeout(2500);
    const { problems } = await layoutIssues(page);
    for (const p of problems) fails.push(`${vp.name}: ${p}`);
    for (const e of errs) fails.push(`${vp.name}: ${e}`);
    if (out) await page.screenshot({ path: `${out}/${vp.name}.png` });
    await ctx.close();
  }
} finally {
  await browser.close();
}
console.log(fails.length ? `FAIL\n${fails.join('\n')}` : `PASS ${VIEWPORTS.length} viewports`);
process.exit(fails.length ? 1 : 0);
