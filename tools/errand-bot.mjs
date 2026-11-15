// WP-111 acceptance bot (docs/11): a new linked child device opens the built game, passes the first-visit guide,
// takes Luna's errand, orders the cold water at the honey cafe and hands it over, through the real dialog window
// (keyboard input) and the real edge routes. Measures spawn -> first order (target: 3 minutes) and the server's
// activation clock. Headless only, audio muted.
//
//   PLAYWRIGHT_CORE=<path to playwright-core/index.mjs> node tools/errand-bot.mjs http://127.0.0.1:8951 dev.json shots/dialog [desktop|phone]
//
// dev.json = {"device_token": "..."} for a child linked through the guardian flow (never commit it).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const pw = process.env.PLAYWRIGHT_CORE ? await import(pathToFileURL(process.env.PLAYWRIGHT_CORE).href) : await import('playwright-core');
const chromium = pw.chromium ?? pw.default.chromium;
const [base, devFile, out, view = 'desktop'] = process.argv.slice(2);
const dev = JSON.parse(readFileSync(devFile, 'utf8'));
const sizes = { desktop: [1280, 800], phone: [390, 844] };
const [width, height] = sizes[view];
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: view !== 'desktop', deviceScaleFactor: 1 });
await ctx.addInitScript(([t]) => { localStorage.setItem('lcw.deviceToken', t); localStorage.setItem('lcw.deviceNickname', 'Juno'); }, [dev.device_token]);
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
const steps = [];
const T0 = Date.now();
const mark = (name, extra = {}) => { const s = { name, t: Date.now() - T0, ...extra }; steps.push(s); console.log(JSON.stringify(s)); };
const shot = async (name) => page.screenshot({ path: `${out}/${name}-${view}.png` });

await page.goto(`${base}/game/`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.__lcwWorld, null, { timeout: 120000 });
await page.waitForFunction(() => !document.body.innerText.includes('마을을 짓는 중'), null, { timeout: 120000 }).catch(() => {});
mark('spawn', { scene: await page.evaluate(() => window.__lcwWorld.getScene?.()) });

await page.waitForSelector('.lcw-firstvisit', { timeout: 30000 });
mark('intro');
await page.waitForTimeout(800);
await shot('50-firstvisit-intro');
await page.click('.lcw-firstvisit-go');
await page.waitForTimeout(1200);
const goal1 = await page.evaluate(() => document.body.innerText);
await shot('51-errand-goal');
mark('intro_done', { goalShown: goal1.includes('루나') || goal1.includes('심부름') });

const touch = view !== 'desktop';
async function talk(npcId) {
  for (let i = 0; i < 12; i++) {
    if (await page.$('.lcw-dlg')) return true;
    if (touch) {
      // tap the NPC on screen (projected by the world when available), else press E via keyboard
      await page.keyboard.press('KeyE');
    } else {
      await page.keyboard.press('KeyE');
    }
    await page.waitForTimeout(600);
    if (await page.$('.lcw-dlg')) return true;
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(180);
    await page.keyboard.up('KeyW');
    await page.waitForTimeout(400);
  }
  return !!(await page.$('.lcw-dlg'));
}

async function answer(stars, label) {
  const npcLine = await page.$eval('.lcw-dlg', (d) => d.innerText.split('\n').slice(0, 3).join(' | '));
  const offers = await page.$$eval('.lcw-offer', (os) => os.map((o) => ({ s: o.getAttribute('data-s'), text: o.innerText.replace(/[★☆🔊]/gu, '').split(/\n/).map((x) => x.trim()).filter(Boolean)[0] ?? '' })));
  const pick = offers.find((o) => o.s === String(stars)) ?? offers[0];
  await page.click(`.lcw-offer[data-s="${pick.s}"]`).catch(() => {});
  await page.waitForTimeout(300);
  await shot(label);
  await page.getByRole('button', { name: /글자로 쓰기/ }).first().click();
  await page.fill('.lcw-input', pick.text);
  await page.click('.lcw-cta--go');
  await page.waitForSelector('.lcw-res__fb', { timeout: 60000 });
  await page.waitForTimeout(700);
  const res = await page.$eval('.lcw-res', (r) => r.innerText.replace(/\s+/g, ' ').slice(0, 160));
  return { npcLine, offers: offers.map((o) => o.text), said: pick.text, res };
}

async function finish(label) {
  await shot(label);
  await page.click('.lcw-res .lcw-cta--go', { timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(900);
  let how = 'done';
  if (await page.$('.lcw-dlg')) { await page.click('.lcw-dlg__x').catch(() => {}); await page.waitForTimeout(700); how = 'x'; }
  if (await page.$('.lcw-dlg')) { await page.keyboard.press('Escape'); await page.waitForTimeout(700); how = 'esc'; }
  return { closedBy: how, stillOpen: !!(await page.$('.lcw-dlg')) };
}

const okLuna = await talk('guide');
mark('luna_open', { ok: okLuna });
const a1 = await answer(2, '52-errand-ask');
mark('accept_scored', a1);
const c1 = await finish('53-errand-accepted');
mark('accept_closed', c1);

await page.waitForSelector('.lcw-errand-walk', { timeout: 10000 });
const walk1 = await page.$eval('.lcw-errand-walk', (b) => b.innerText);
await shot('54-errand-walk-cafe');
await page.click('.lcw-errand-walk');
await page.waitForFunction(() => window.__lcwWorld.getScene?.() === 'honey_cafe', null, { timeout: 60000 });
await page.waitForTimeout(2500);
mark('at_cafe', { walk: walk1 });

const okHani = await talk('cafe_owner');
mark('hani_open', { ok: okHani });
const a2 = await answer(2, '55-errand-cafe-offers');
mark('first_order', a2);
const c2 = await finish('56-errand-water');
mark('order_closed', c2);

await page.waitForSelector('.lcw-errand-walk', { timeout: 10000 });
const walk2 = await page.$eval('.lcw-errand-walk', (b) => b.innerText);
await page.click('.lcw-errand-walk');
await page.waitForFunction(() => window.__lcwWorld.getScene?.() === 'plaza', null, { timeout: 60000 });
await page.waitForTimeout(2500);
mark('back_plaza', { walk: walk2 });
const okLuna2 = await talk('guide');
mark('luna2_open', { ok: okLuna2 });
const a3 = await answer(3, '57-errand-deliver');
mark('deliver_scored', a3);
const c3 = await finish('58-errand-deliver-result');
mark('deliver_closed', c3);
await page.waitForSelector('.lcw-errand-toast', { timeout: 5000 }).catch(() => {});
await shot('59-errand-reward');
const toast = await page.$eval('.lcw-errand-toast', (t) => t.innerText).catch(() => null);
mark('reward', { toast });

const e = await (await fetch(`${base}/v1/errand`, { headers: { authorization: `Bearer ${dev.device_token}` } })).json();
const report = {
  view,
  steps,
  errand: { state: e.state, reward_coins: e.reward_coins, first_pass_s: e.first_pass_at && (e.first_pass_at - e.started_at) / 1000, first_order_s: e.first_order_at && (e.first_order_at - e.started_at) / 1000, done_s: e.done_at && (e.done_at - e.started_at) / 1000 },
  bot_spawn_to_first_order_s: (steps.find((s) => s.name === 'first_order').t - steps.find((s) => s.name === 'spawn').t) / 1000,
  errs
};
writeFileSync(`${out}/errand-report-${view}.json`, JSON.stringify(report, null, 1));
console.log(JSON.stringify(report.errand), report.bot_spawn_to_first_order_s, errs.length);
await browser.close();
