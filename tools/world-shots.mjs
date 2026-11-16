// Headless check of the 3D world (/world/): every scene at desktop / tablet / phone sizes, FPS, console errors,
// and the WorldHandle calls other domains use (goal line, bubbles, item, stars). Headless only, audio muted.
//
//   PLAYWRIGHT_CORE=<path to playwright-core/index.mjs> node tools/world-shots.mjs http://127.0.0.1:8910/world/ shots/world
//
// playwright-core is not a repo dependency (it is only a dev tool); point PLAYWRIGHT_CORE at any install.
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const base = process.argv[2] ?? 'http://127.0.0.1:8910/world/';
const out = process.argv[3] ?? 'shots/world';
const only = process.argv[4] ?? '';
mkdirSync(out, { recursive: true });
const pw = process.env.PLAYWRIGHT_CORE ? await import(pathToFileURL(process.env.PLAYWRIGHT_CORE).href) : await import('playwright-core');
const chromium = pw.chromium ?? pw.default.chromium;

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--mute-audio', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
});

const SCENES = ['plaza', 'honey_cafe', 'trade_shop', 'build_plot', 'open_hill'];
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900, touch: false },
  { name: 'tablet', width: 1024, height: 768, touch: true },
  { name: 'phone', width: 390, height: 844, touch: true }
];

const report = [];
async function open(vp, query) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1, hasTouch: vp.touch, isMobile: vp.touch && vp.width < 500 });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errs.push(m.text().slice(0, 300));
  });
  page.on('pageerror', (e) => errs.push(`pageerror: ${String(e.message).slice(0, 300)}`));
  page.on('response', (r) => {
    if (r.status() >= 400) errs.push(`http ${r.status()}: ${r.url()}`);
  });
  page.on('requestfailed', (r) => errs.push(`requestfailed: ${r.url()} ${r.failure()?.errorText ?? ''}`));
  const t0 = Date.now();
  await page.goto(`${base}?${query}`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => !!window.__lcwWorld, null, { timeout: 90000 });
  const readyMs = Date.now() - t0;
  return { ctx, page, errs, readyMs };
}

async function fpsOver(page, ms) {
  return page.evaluate(async (ms) => {
    const w = window.__lcwWorld;
    let frames = 0;
    let run = true;
    const tick = () => {
      frames++;
      if (run) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    await new Promise((r) => setTimeout(r, ms));
    run = false;
    const s = w.getStats();
    return { fps: (frames * 1000) / ms, drawCalls: s.drawCalls, triangles: s.triangles, chunksVisible: s.chunksVisible, chunksMeshed: s.chunksMeshed, scene: s.scene, player: s.player, renderScale: s.renderScale, tier: s.tier };
  }, ms);
}

for (const vp of VIEWPORTS) {
  for (const scene of SCENES) {
    if (only && !`${vp.name}:${scene}`.includes(only)) continue;
    const { ctx, page, errs, readyMs } = await open(vp, `scene=${scene}&tier=mid&fps=1`);
    // let the dynamic-resolution governor settle (it adjusts once a second), then measure
    await page.waitForTimeout(6000);
    const stats = await fpsOver(page, 3000);
    const file = `${out}/${vp.name}-${scene}.png`;
    await page.screenshot({ path: file });
    report.push({ viewport: vp.name, scene, readyMs, ...stats, errors: errs, file });
    await ctx.close();
  }
}

// Interaction pass on the tablet: goal, NPC line, walking to the cafe, item + 3 stars, possession, director events.
if (!only || only === 'flow') {
  const vp = VIEWPORTS[1];
  const { ctx, page, errs } = await open(vp, 'tier=mid&fps=1');
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const w = window.__lcwWorld;
    w.setGoal('안내인에게 인사해 보세요', 'Hi! My name is Minji.');
    w.npcSay('guide', 'Hello! How are you today?');
  });
  await page.waitForTimeout(1600);
  await page.screenshot({ path: `${out}/flow-1-goal-bubble.png` });
  const t0 = Date.now();
  await page.evaluate(() => window.__lcwWorld.goToScene('honey_cafe'));
  const walkMs = Date.now() - t0;
  await page.evaluate(() => {
    const w = window.__lcwWorld;
    w.setGoal('카페 주인에게 꿀차를 주문해 보세요', 'Can I have a warm honey tea, please?');
    w.npcSay('cafe_owner', 'Welcome to the Honey Cafe! What would you like?');
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/flow-2-cafe.png` });
  await page.evaluate(() => {
    const w = window.__lcwWorld;
    w.setPaused(true);
    w.playerSay('Can I have a warm honey tea, please?');
  });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}/flow-3-paused-player-bubble.png` });
  await page.evaluate(() => {
    const w = window.__lcwWorld;
    w.celebrate(3);
    w.giveItem('warm_honey_tea');
  });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${out}/flow-4-stars-item.png` });
  await page.waitForTimeout(1600);
  await page.evaluate(() => {
    const w = window.__lcwWorld;
    w.setPaused(false);
  });
  const t1 = Date.now();
  await page.evaluate(() => window.__lcwWorld.goToScene('trade_shop'));
  const fadeMs = Date.now() - t1;
  await page.evaluate(() => {
    const w = window.__lcwWorld;
    w.setPossessed('shop_owner');
    w.npcSay('shop_owner', 'I have a red kite. What do you have?', { possessed: true });
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/flow-5-shop-possessed.png` });
  await page.evaluate(() => window.__lcwWorld.playDirectorEvent('weather_shift', ''));
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/flow-6-snow.png` });
  // keyboard walk + E to talk on desktop-ish input
  const before = await page.evaluate(() => window.__lcwWorld.getStats().player);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(800);
  await page.keyboard.up('KeyW');
  const after = await page.evaluate(() => window.__lcwWorld.getStats().player);
  let talked = null;
  await page.evaluate(() => {
    window.__talked = null;
    window.__lcwWorld.onNpcInteract((n) => {
      window.__talked = n;
    });
  });
  await page.evaluate(() => window.__lcwWorld.goToScene('trade_shop'));
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(300);
  talked = await page.evaluate(() => window.__talked);
  report.push({ flow: true, walkToCafeMs: walkMs, fadeToShopMs: fadeMs, moved: Math.hypot(after.x - before.x, after.z - before.z), talkedTo: talked, errors: errs });
  await ctx.close();
}

await browser.close();
writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1));
