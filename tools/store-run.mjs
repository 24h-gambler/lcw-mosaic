// Store-finding run (R2627): a fresh child (no saved state) opens /world/ on a 390 px phone and a 1440 px PC and has
// to name and reach the trade shop within 30 s. Headless, audio muted.
//
// The bot plays the way a child does, with keys and a mouse drag: it turns toward the next point (a mouse drag on the
// canvas, the same input a child uses), holds W, and follows the street the minimap shows (the trade shop's pin) —
// the waypoints are the town's own auto-walk path to the shop. It dismisses the first-visit card with its button.
// Pictures every 3 s and on arrival show what the child sees: the sign in the learning language, the fascia, the pin.
//
//   PLAYWRIGHT_CORE=<path to playwright-core/index.mjs> node tools/store-run.mjs <base /world/ url> <out dir> [gpu]
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const base = process.argv[2] ?? 'http://127.0.0.1:8915/world/';
const out = process.argv[3] ?? 'shots/store-run';
const gpu = process.argv[4] === 'gpu';
mkdirSync(out, { recursive: true });
const pw = process.env.PLAYWRIGHT_CORE ? await import(pathToFileURL(process.env.PLAYWRIGHT_CORE).href) : await import('playwright-core');
const chromium = pw.chromium ?? pw.default.chromium;
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--mute-audio', '--ignore-gpu-blocklist', ...(gpu ? ['--enable-gpu'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'])]
});

// the town's auto-walk path from the plaza to the trade shop counter (apps/client/src/world/town.ts SCENES.trade_shop)
const PATH = [
  [136, 144],
  [126.5, 144],
  [124.5, 141],
  [124.2, 137.5],
  [123.8, 135.5]
];
const ARRIVE_M = 1.6;
const LIMIT_S = 30;
const VIEWPORTS = [
  { name: '390', width: 390, height: 844, touch: true },
  { name: '1440', width: 1440, height: 900, touch: false }
];
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

const results = [];
for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1, hasTouch: vp.touch });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 200)));
  // /try (a guest) lands in the plaza scene: the same entry without the edge server
  await page.goto(`${base}?fps=1&scene=plaza`, { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => !!window.__lcwWorld && (window.__lcwWorld.getStats().ground?.near ?? 1) === 0, null, { timeout: 180000 });
  await page.waitForTimeout(1500);
  const shot = async (tag) => {
    const file = `${out}/${vp.name}-${tag}.png`;
    await page.screenshot({ path: file });
    return file;
  };
  const first = await shot('00-arrive');
  // a fresh child with no account: the start card's "try it" button (a guest starts on the town goals at once), then
  // any welcome card's button
  const tryBtn = page.getByRole('button', { name: /Try it|체험/ }).first();
  if (await tryBtn.isVisible().catch(() => false)) {
    await tryBtn.click().catch(() => undefined);
    await page.waitForTimeout(2500);
  }
  const card = page.locator('.lcw-firstvisit-go').first();
  if (await card.isVisible().catch(() => false)) {
    await card.click().catch(() => undefined);
    await page.waitForTimeout(800);
  }
  await shot('01-start');
  const goalLine = await page.evaluate(() => (document.querySelector('.lw-goal')?.innerText ?? '').replace(/\s+/g, ' '));
  const canvas = await page.locator('canvas').first().boundingBox();
  const cx = canvas.x + canvas.width * 0.6;
  const cy = canvas.y + canvas.height * 0.5;
  const t0 = Date.now();
  let wp = 0;
  let arrivedAt = null;
  let nextShot = 3;
  const track = [];
  await page.keyboard.down('KeyW');
  while ((Date.now() - t0) / 1000 < LIMIT_S + 10) {
    const m = await page.evaluate(() => window.__lcwWorld.getMap().player);
    const [tx, tz] = PATH[wp];
    const d = Math.hypot(tx - m.x, tz - m.z);
    if (wp === PATH.length - 1 && d < ARRIVE_M) {
      arrivedAt = (Date.now() - t0) / 1000;
      break;
    }
    if (wp < PATH.length - 1 && d < 1.8) {
      wp++;
      continue;
    }
    // facing (sin yaw, cos yaw); a drag of dx px turns the view by -dx * 0.006 rad (engine pointerMove)
    const want = Math.atan2(tx - m.x, tz - m.z);
    const turn = wrap(want - m.yaw);
    if (Math.abs(turn) > 0.08) {
      if (vp.touch) {
        // a phone: a finger drag on the right half looks around (hud onLook: -dx * 0.008 rad)
        const dx = Math.max(-150, Math.min(150, -turn / 0.008));
        const x0 = vp.width * 0.72;
        const y0 = vp.height * 0.45;
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0, id: 1 }] });
        for (let i = 1; i <= 4; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (dx * i) / 4, y: y0, id: 1 }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      } else {
        const dx = Math.max(-260, Math.min(260, -turn / 0.006));
        await page.mouse.move(cx, cy);
        await page.mouse.down();
        await page.mouse.move(cx + dx, cy, { steps: 4 });
        await page.mouse.up();
      }
    }
    const t = (Date.now() - t0) / 1000;
    track.push([Math.round(t * 10) / 10, Math.round(m.x * 10) / 10, Math.round(m.z * 10) / 10]);
    if (t >= nextShot) {
      await shot(`t${String(nextShot).padStart(2, '0')}`);
      nextShot += 3;
    }
    await page.waitForTimeout(120);
  }
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(400);
  const last = await shot('zz-end');
  const mini = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="minimap"], .lw-mini');
    return el ? { goal: el.dataset.goal ?? null, shown: getComputedStyle(el).display !== 'none' } : null;
  });
  results.push({ viewport: vp.name, goalLine, arrivedS: arrivedAt, withinLimit: arrivedAt !== null && arrivedAt <= LIMIT_S, minimap: mini, first, last, track: track.filter((_, i) => i % 5 === 0), errors: errs });
  await ctx.close();
}
await browser.close();
writeFileSync(`${out}/report.json`, JSON.stringify(results, null, 1));
console.log(JSON.stringify(results.map(({ track, ...r }) => r)));
