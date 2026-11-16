// Headless real-screen check of the child's screen frame (docs/08 8.6, frame domain) at 1440 / 1024 / 390 / 844x390.
// G01 HUD: place · band, weather · clock and coins always on; empty hotbar explained, never bare boxes; slot caption;
// connection band "Offline for a moment · Keep playing on your own" without covering the chips or buttons;
// first-person crosshair. The HUD frame words are in the screen language (English, the learn language);
// KO_HELP=1 turns Korean help on and checks the Korean in parentheses (expected words: tools/frame-lang-expect.mjs).
// Fails (exit 1) on a broken rule. Headless only, audio muted, no window.
//
//   PLAYWRIGHT_CORE=<path to playwright-core/index.mjs> node tools/frame-shots.mjs http://127.0.0.1:8981/world/ shots/frame
// FRAME_SETTINGS='{"textScale":1.5,"keys":{"talk":"KeyF"}}' runs the same rules with the player's settings on the device
// (G14: HUD text follows the text size, help lines name the remapped keys).
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { COPY, COPY_KO, FRAME_LANG, KO_HELP_SHOWN, inScreenLang, langInitScript } from './frame-lang-expect.mjs';

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
  { name: 'l844', width: 844, height: 390, touch: true },
  // EXTRA_SMALL=1: the smallest landscape phone too (gauges, a long goal and the Korean help squeeze the top row)
  ...(process.env.EXTRA_SMALL === '1' ? [{ name: 'l667', width: 667, height: 375, touch: true }] : [])
];

const SETTINGS = process.env.FRAME_SETTINGS ? JSON.parse(process.env.FRAME_SETTINGS) : null;

// the title screen (world lane) and the first-visit / mic cards (dialog domain): step past them like a child would
async function passTitle(page) {
  const start = page.getByRole('button', { name: /^(시작하기|Start)/ });
  // the title can come up a moment after the load bar on a busy machine: wait for it rather than count once
  if (await start.first().waitFor({ state: 'visible', timeout: 4000 }).then(() => true, () => false)) {
    await start.first().click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(2500);
  }
  await dismissCards(page);
  await page.waitForTimeout(600);
}
/** The first-visit / mic card (dialog domain, English since #111) can come up a little later: close it like a child. */
async function dismissCards(page) {
  let hit = false;
  for (const name of [/^(건너뛰기|Skip)$/, /^(좋아요, 출발!|OK, let's go!)$/]) {
    const b = page.getByRole('button', { name });
    if (await b.count()) {
      await b.first().click({ timeout: 2000 }).then(() => (hit = true)).catch(() => {});
    }
  }
  if (hit) await page.waitForTimeout(500);
}
const fails = [];
const report = [];
const check = (vp, ok, what) => {
  if (!ok) fails.push(`${vp}: ${what}`);
};
const overlap = (a, b) => a && b && a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** Boxes of the HUD parts, read in the page (also set as window.__frameBoxes so a step can tap and read in one go). */
const SNAP = () => {
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
      badge: q('.lw-chip .l'),
      goal: q('.lw-goal.on'),
      aim: q('.lw-aim'),
      help: q('.lw-help'),
      buttons: [...document.querySelectorAll('.lw-touch.on .lw-btn')].map(r).filter(Boolean),
      empties: document.querySelectorAll('.lw-slot.empty').length,
      gauges: [...document.querySelectorAll('.lw-chip .gz [role="meter"]')].map((m) => Number(m.getAttribute('aria-valuenow'))),
      vw: innerWidth,
      vh: innerHeight
    };
};
async function boxes(page) {
  await dismissCards(page);
  return page.evaluate(SNAP);
}

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1, hasTouch: vp.touch, isMobile: vp.touch && vp.width < 500 });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errs.push(m.text().slice(0, 200));
  });
  page.on('pageerror', (e) => errs.push(`pageerror: ${e.message.slice(0, 200)}`));
  page.on('response', (r) => {
    if (r.status() >= 400) errs.push(`${r.status()} ${new URL(r.url()).pathname}`);
  });
  // no edge server behind the dev page: the neural-voice switch answers "off" (the device voice reads)
  await ctx.route('**/v1/tts/status', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"enabled":false}' }));
  // screen language and Korean help (world/lang.ts lcw.helpKo, one switch with the start screen)
  await langInitScript(ctx);
  await ctx.addInitScript(`window.__frameBoxes = ${SNAP.toString()};`);
  if (SETTINGS) {
    await ctx.addInitScript((s) => {
      try {
        if (!sessionStorage.getItem('frameShotsSet')) {
          localStorage.setItem('lcw.settings', JSON.stringify({ ...s, updatedAt: Date.now() }));
          sessionStorage.setItem('frameShotsSet', '1');
        }
      } catch {
        /* storage blocked */
      }
    }, SETTINGS);
  }
  await page.goto(base, { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => !!window.__lcwWorld && document.querySelector('.lw-load.done'), null, { timeout: 120000 });
  await page.waitForTimeout(1200);
  await passTitle(page);

  // 1. start: status line, coins, explained empty bar
  // the empty-bar line shows for 6 s after loading; a busy machine can get here later, so pick slot 1 to bring it back
  // On a busy machine one page round trip can take 1-3 s, longer than the 2.4 s line: tap slot 1 and read the boxes in
  // one page call as soon as the line has faded in (a key press can also land while a late first-visit card holds focus)
  await dismissCards(page);
  let a = null;
  for (let n = 0; n < 3 && !a?.cap; n++) {
    a = await page.evaluate(async (tap) => {
      const c = document.querySelector('.lw-cap');
      const shown = () => !!c && c.classList.contains('on') && Number(getComputedStyle(c).opacity) > 0.9;
      const until = async (ms) => {
        const t0 = performance.now();
        while (!shown() && performance.now() - t0 < ms) await new Promise((res) => setTimeout(res, 30));
        return shown();
      };
      if (!(await until(tap ? 0 : 400))) {
        document.querySelectorAll('.lw-slot')[0].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        await until(3000);
      }
      return window.__frameBoxes();
    }, n > 0);
    if (!a.cap) await dismissCards(page);
  }
  await page.screenshot({ path: `${out}/${vp.name}-1start.png` });
  check(vp.name, /·/.test(a.scene?.text ?? ''), `place · band missing (${a.scene?.text})`);
  check(vp.name, /\d\d:\d\d/.test(a.clock?.text ?? ''), `weather · clock missing (${a.clock?.text})`);
  check(vp.name, !!a.coins, 'coin count not shown for a guest');
  check(vp.name, a.empties === 5, `expected 5 empty slots, got ${a.empties}`);
  // G01 gauges: hunger and thirst on the status chip from the start (45% on a new device)
  check(vp.name, a.gauges.length === 2 && a.gauges.every((v) => v >= 40 && v <= 46), `gauges hunger/thirst near 45 (${a.gauges})`);
  if (SETTINGS?.textScale) {
    const fs = await page.evaluate(() => [parseFloat(getComputedStyle(document.querySelector('.lw-goal .g') ?? document.body).fontSize), parseFloat(getComputedStyle(document.querySelector('.lw-help')).fontSize)]);
    // the HUD follows the text size up to 125% (115% on phones and short landscape screens); menus and dialogs take all of it
    const cap = vp.width <= 600 || vp.height <= 500 ? 1.15 : 1.25;
    check(vp.name, Math.abs(fs[1] - 12 * Math.min(SETTINGS.textScale, cap)) < 0.6, `HUD help text should follow the text size ${SETTINGS.textScale} (${fs[1]}px)`);
  }
  if (SETTINGS?.keys?.talk && !vp.touch) {
    const want = SETTINGS.keys.talk.replace(/^Key/, '');
    const t = await page.evaluate(() => ({ help: document.querySelector('.lw-help')?.textContent ?? '', kbd: document.querySelector('.lw-prompt kbd')?.textContent ?? '' }));
    check(vp.name, t.help.includes(COPY.talkHelp(want)) && t.kbd === want, `remapped talk key not shown (${t.help} / ${t.kbd})`);
  }
  check(vp.name, !!a.cap && COPY.emptyBar.test(a.cap.text), `empty bar is not explained (${a.cap?.text})`);
  // the frame's HUD words are in the learn language; the Korean help may follow after a dot
  const enPart = (t) => (t ?? '').split(' · ').filter((x) => !/[가-힣]/.test(x)).length > 0 && (KO_HELP_SHOWN || inScreenLang(t ?? ''));
  check(vp.name, [a.clock?.text, a.cap?.text].every(enPart), `HUD frame words not in the screen language (${a.clock?.text} / ${a.cap?.text})`);
  check(vp.name, (await page.evaluate(() => document.documentElement.lang)) === FRAME_LANG, '<html lang> should be the screen language');
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
  // the thing's name as a title (world/strings itemTitle); a food in hand adds how to eat it (G01)
  check(vp.name, (b.cap?.text ?? '').startsWith(COPY.cookie) && COPY.useAgainFood.test(b.cap?.text ?? ''), `caption should name the selected slot (${b.cap?.text})`);
  check(vp.name, b.coins?.text === '120', `coins should read 120 (${b.coins?.text})`);
  // drink: the honey tea in slot 1, picked twice (the second pick uses the slot in hand)
  for (let n = 0; n < 2; n++) {
    await page.evaluate(() => document.querySelectorAll('.lw-slot')[0].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(700);
  const dr = await page.evaluate(() => ({ cap: document.querySelector('.lw-cap')?.textContent ?? '', thirst: Number(document.querySelectorAll('.lw-chip .gz [role="meter"]')[1]?.getAttribute('aria-valuenow')) }));
  await page.screenshot({ path: `${out}/${vp.name}-2drink.png` });
  check(vp.name, COPY.drank.test(dr.cap) && dr.thirst >= 70, `drinking the honey tea should fill thirst (${dr.cap} / ${dr.thirst})`);

  // 3. a lesson screen (tag, goal card, four-digit coins), then the connection band and snow: nothing covers anything
  await page.evaluate(() => {
    window.__lcwWorld.setLessonBadge?.(true);
    window.__lcwWorld.setCoins?.(1450);
    window.__lcwWorld.setGoal('꿀 카페에서 꿀차를 주문해요', 'Can I have a honey tea, please?');
  });
  await page.waitForTimeout(800);
  const l = await boxes(page);
  await page.screenshot({ path: `${out}/${vp.name}-3lesson.png` });
  const inView = (r) => r && r.x >= 0 && r.y >= 0 && r.x + r.w <= l.vw + 0.5 && r.y + r.h <= l.vh + 0.5;
  check(vp.name, !!l.badge, 'lesson tag not shown');
  check(vp.name, !overlap(l.badge, l.stars) && !overlap(l.badge, l.goal), 'lesson tag covered (stars or goal card)');
  check(vp.name, !overlap(l.scene, l.stars) && !overlap(l.scene, l.goal), 'status chip covered (stars or goal card)');
  check(vp.name, inView(l.goal), 'goal card leaves the screen');
  await page.evaluate(() => {
    window.__lcwWorld.setOnline?.(false);
    window.__lcwWorld.playDirectorEvent?.('weather_shift', 'snow');
  });
  await page.waitForTimeout(1000);
  const c = await boxes(page);
  check(vp.name, inView(c.goal), 'goal card leaves the screen while offline');
  check(vp.name, !overlap(c.goal, c.net) && !overlap(c.badge, c.stars) && !overlap(c.scene, c.goal), 'offline: band, chips and goal card overlap');
  await page.screenshot({ path: `${out}/${vp.name}-3offline.png` });
  check(vp.name, !!c.net && COPY.offlineBand.test(c.net.text), `connection band missing (${c.net?.text})`);
  check(vp.name, !!c.net && COPY_KO.offlineBand.test(c.net.text) === KO_HELP_SHOWN, `connection band Korean help ${KO_HELP_SHOWN ? 'missing' : 'shown while off'} (${c.net?.text})`);
  const netOneLine = await page.evaluate(() => {
    const s = document.querySelector('.lw-net span');
    if (!s) return null;
    const band = s.parentElement.getBoundingClientRect();
    const b = s.getBoundingClientRect();
    return { lines: Math.round(b.height / parseFloat(getComputedStyle(s).lineHeight || '20')), clipped: b.left < band.left - 0.5 || b.right > band.right + 0.5 || s.scrollWidth > s.clientWidth + 1 };
  });
  report.push({ vp: vp.name, netOneLine });
  check(vp.name, !overlap(c.net, c.scene) && !overlap(c.net, c.stars), 'connection band covers the status chips');
  check(vp.name, !!netOneLine && !netOneLine.clipped, `connection band text clipped (${JSON.stringify(netOneLine)})`);
  for (const btn of c.buttons) check(vp.name, !overlap(btn, c.stars) && !overlap(btn, c.net), `touch button "${btn.text}" covered while offline`);
  check(vp.name, COPY.snow.test(c.clock?.text ?? ''), `snow not shown in words (${c.clock?.text})`);

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
  if (vp.name === 'd1440' || vp.name === 'p390') {
    // low gauges from the device record: slower walking is said once and shown on the chip
    // set at the new page's start: the old page saves its own values on pagehide
    await ctx.addInitScript(() => {
      try {
        localStorage.setItem('lcw.gauges', JSON.stringify({ g: { hunger: 50, thirst: 12 }, used: [] }));
      } catch {
        /* storage blocked */
      }
    });
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => !!window.__lcwWorld && document.querySelector('.lw-load.done'), null, { timeout: 120000 });
    await page.waitForTimeout(1500);
    await passTitle(page);
    const lo = await page.evaluate(() => ({ slow: !!document.querySelector('.lw-chip .gz.slow'), low: !!document.querySelector('.lw-chip .gz .t.low'), cap: document.querySelector('.lw-cap')?.textContent ?? '' }));
    await page.screenshot({ path: `${out}/${vp.name}-5low.png` });
    check(vp.name, lo.slow && lo.low && COPY.lowThirst.test(lo.cap), `low thirst: slow ${lo.slow}, low ${lo.low}, said "${lo.cap}"`);
    check(vp.name, COPY_KO.lowThirst.test(lo.cap) === KO_HELP_SHOWN, `low thirst Korean help ${KO_HELP_SHOWN ? 'missing' : 'shown while off'} ("${lo.cap}")`);
  }
  check(vp.name, errs.length === 0, `console errors: ${errs.join(' | ')}`);
  report.push({ vp: vp.name, start: a, items: { cap: b.cap?.text, empties: b.empties, coins: b.coins?.text }, offline: { net: c.net?.text, clock: c.clock?.text }, errs });
  await ctx.close();
}
await browser.close();
writeFileSync(`${out}/report.json`, JSON.stringify({ fails, report }, null, 1));
console.log(fails.length ? `FAIL\n${fails.join('\n')}` : `PASS ${VIEWPORTS.length} viewports`);
process.exit(fails.length ? 1 : 0);
