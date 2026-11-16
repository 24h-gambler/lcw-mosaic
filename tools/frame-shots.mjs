// Headless real-screen check of the child's screen frame (docs/08 8.6, frame domain) at 1440 / 1024 / 390 / 844x390.
// G01 HUD: place · band, weather · clock and coins always on; empty hotbar explained, never bare boxes; slot caption;
// connection band "혼자 모드로 계속 중" without covering the chips or buttons; first-person crosshair.
// Fails (exit 1) on a broken rule. Headless only, audio muted, no window.
//
//   PLAYWRIGHT_CORE=<path to playwright-core/index.mjs> node tools/frame-shots.mjs http://127.0.0.1:8981/game/ shots/frame
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const base = process.argv[2] ?? 'http://127.0.0.1:8981/game/';
const out = process.argv[3] ?? 'shots/frame';
mkdirSync(out, { recursive: true });
const pw = process.env.PLAYWRIGHT_CORE ? await import(pathToFileURL(process.env.PLAYWRIGHT_CORE).href) : await import('playwright-core');
const chromium = pw.chromium ?? pw.default.chromium;
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--mute-audio', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
});

const VIEWPORTS = [
  { name: 'd1440', width: 1440, height: 900, touch: false },
  { name: 't1024', width: 1024, height: 768, touch: true },
  { name: 'p390', width: 390, height: 844, touch: true },
  { name: 'l844', width: 844, height: 390, touch: true }
];

const fails = [];
const report = [];
const check = (vp, ok, what) => {
  if (!ok) fails.push(`${vp}: ${what}`);
};
const overlap = (a, b) => a && b && a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

async function boxes(page) {
  return page.evaluate(() => {
    const r = (e) => {
      if (!e) return null;
      const b = e.getBoundingClientRect();
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0 || b.width === 0) return null;
      return { x: b.x, y: b.y, w: b.width, h: b.height, text: (e.textContent ?? '').trim().slice(0, 80) };
    };
    const q = (s) => r(document.querySelector(s));
    return {
      scene: q('.lw-chip .s'),
      clock: q('.lw-chip .w'),
      stars: q('.lw-stars'),
      coins: q('.lw-stars .cn'),
      cap: q('.lw-cap'),
      bar: q('.lw-hotbar'),
      net: q('.lw-net'),
      aim: q('.lw-aim'),
      help: q('.lw-help'),
      buttons: [...document.querySelectorAll('.lw-touch.on .lw-btn')].map(r).filter(Boolean),
      empties: document.querySelectorAll('.lw-slot.empty').length,
      vw: innerWidth,
      vh: innerHeight
    };
  });
}

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1, hasTouch: vp.touch, isMobile: vp.touch && vp.width < 500 });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errs.push(m.text().slice(0, 200));
  });
  page.on('pageerror', (e) => errs.push(`pageerror: ${e.message.slice(0, 200)}`));
  await page.goto(base, { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => !!window.__lcwWorld && document.querySelector('.lw-load.done'), null, { timeout: 120000 });
  await page.waitForTimeout(1200);

  // 1. start: status line, coins, explained empty bar
  const a = await boxes(page);
  await page.screenshot({ path: `${out}/${vp.name}-1start.png` });
  check(vp.name, /·/.test(a.scene?.text ?? ''), `place · band missing (${a.scene?.text})`);
  check(vp.name, /\d\d:\d\d/.test(a.clock?.text ?? ''), `weather · clock missing (${a.clock?.text})`);
  check(vp.name, !!a.coins, 'coin count not shown for a guest');
  check(vp.name, a.empties === 5, `expected 5 empty slots, got ${a.empties}`);
  check(vp.name, !!a.cap && /가방/.test(a.cap.text), `empty bar is not explained (${a.cap?.text})`);
  check(vp.name, !overlap(a.cap, a.help), 'caption covers the controls help');
  check(vp.name, !overlap(a.cap, a.bar), 'caption covers the hotbar');
  check(vp.name, !overlap(a.clock, a.stars), 'clock chip runs into the star/coin chip');
  for (const b of a.buttons) check(vp.name, !overlap(b, a.stars) && !overlap(b, a.clock), `touch button "${b.text}" covers a status chip`);

  // 2. things in the bag: icons, caption names the selected slot
  await page.evaluate(() => {
    window.__lcwWorld.giveItem('honey_tea');
    window.__lcwWorld.giveItem('cookie');
    window.__lcwWorld.setCoins?.(120);
  });
  await page.waitForTimeout(3200);
  await page.evaluate(() => document.querySelectorAll('.lw-slot')[1].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
  // a software-rendered 1440 frame can take a while: wait for the fade-in instead of a fixed sleep
  await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.lw-cap')).opacity) > 0.9, null, { timeout: 3000 }).catch(() => {});
  const b = await boxes(page);
  await page.screenshot({ path: `${out}/${vp.name}-2items.png` });
  check(vp.name, b.empties === 3, `expected 3 empty slots after two items, got ${b.empties}`);
  check(vp.name, b.cap?.text === '쿠키', `caption should name the selected slot (${b.cap?.text})`);
  check(vp.name, b.coins?.text === '120', `coins should read 120 (${b.coins?.text})`);

  // 3. connection band, snow, lesson tag: nothing covers anything
  await page.evaluate(() => {
    window.__lcwWorld.setOnline?.(false);
    window.__lcwWorld.playDirectorEvent?.('weather_shift', 'snow');
    window.__lcwWorld.setLessonBadge?.(true);
  });
  await page.waitForTimeout(1000);
  const c = await boxes(page);
  await page.screenshot({ path: `${out}/${vp.name}-3offline.png` });
  check(vp.name, !!c.net && /혼자 모드로 계속 중/.test(c.net.text), 'connection band missing');
  check(vp.name, !overlap(c.net, c.scene) && !overlap(c.net, c.stars), 'connection band covers the status chips');
  for (const btn of c.buttons) check(vp.name, !overlap(btn, c.stars) && !overlap(btn, c.net), `touch button "${btn.text}" covered while offline`);
  check(vp.name, /^눈 /.test(c.clock?.text ?? ''), `snow not shown in words (${c.clock?.text})`);

  // 4. back online + first person: band gone, crosshair centred
  await page.evaluate(() => {
    window.__lcwWorld.setOnline?.(true);
    document.querySelector('.lw-hud').classList.add('first');
  });
  await page.waitForTimeout(300);
  const d = await boxes(page);
  await page.screenshot({ path: `${out}/${vp.name}-4aim.png` });
  check(vp.name, !d.net, 'connection band stays after coming back');
  check(vp.name, !!d.aim && Math.abs(d.aim.x + d.aim.w / 2 - d.vw / 2) < 2 && Math.abs(d.aim.y + d.aim.h / 2 - d.vh / 2) < 2, 'crosshair not centred');
  check(vp.name, errs.length === 0, `console errors: ${errs.join(' | ')}`);
  report.push({ vp: vp.name, start: a, items: { cap: b.cap?.text, empties: b.empties, coins: b.coins?.text }, offline: { net: c.net?.text, clock: c.clock?.text }, errs });
  await ctx.close();
}
await browser.close();
writeFileSync(`${out}/report.json`, JSON.stringify({ fails, report }, null, 1));
console.log(fails.length ? `FAIL\n${fails.join('\n')}` : `PASS ${VIEWPORTS.length} viewports`);
process.exit(fails.length ? 1 : 0);
