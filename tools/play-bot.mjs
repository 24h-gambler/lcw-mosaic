// Play modes acceptance bot (docs/01 6장, docs/03 D2·D4, docs/04 4.2): a linked child device opens the built world,
// opens the "내 일" card, goes to the market hall, rides the elevator to the mine, digs with the dig button (F key),
// sells ore at the exchange with a sentence, buys the suit, passes the interview, clocks in and serves the day's two
// customers — through the real dialog window (keyboard input) and the real edge routes. Headless only, audio muted.
//
//   PLAYWRIGHT_CORE=<path to playwright-core/index.mjs> node tools/play-bot.mjs http://127.0.0.1:8941 dev.json shots/play [desktop|phone]
//
// dev.json = {"device_token": "..."} for a child linked through the guardian flow (never commit it).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const pw = process.env.PLAYWRIGHT_CORE ? await import(pathToFileURL(process.env.PLAYWRIGHT_CORE).href) : await import('playwright-core');
const chromium = pw.chromium ?? pw.default.chromium;
const [base, devFile, out, view = 'desktop'] = process.argv.slice(2);
const dev = JSON.parse(readFileSync(devFile, 'utf8'));
const sizes = { desktop: [1440, 900], phone: [390, 844] };
const [width, height] = sizes[view];
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: view !== 'desktop', isMobile: view === 'phone', deviceScaleFactor: 1 });
await ctx.addInitScript(([t]) => {
  localStorage.setItem('lcw.deviceToken', t);
  localStorage.setItem('lcw.deviceNickname', 'Juno');
}, [dev.device_token]);
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 200)));
page.on('console', (m) => {
  if (m.type() === 'error') errs.push(m.text().slice(0, 200));
});
const steps = [];
const T0 = Date.now();
const mark = (name, extra = {}) => {
  const s = { name, t: Date.now() - T0, ...extra };
  steps.push(s);
  console.log(JSON.stringify(s));
};
const shot = async (name) => page.screenshot({ path: `${out}/${name}-${view}.png` });
const api = async (path, init = {}) => (await fetch(`${base}${path}`, { ...init, headers: { authorization: `Bearer ${dev.device_token}`, 'content-type': 'application/json', ...(init.headers ?? {}) } })).json();
const scene = () => page.evaluate(() => window.__lcwWorld.getScene?.());
const go = async (id) => {
  await page.evaluate((id) => window.__lcwWorld.goToScene(id), id);
  await page.waitForTimeout(1500);
};
const toasts = () => page.$$eval('[data-play="toast"]', (ts) => ts.map((t) => t.innerText));

await page.goto(`${base}/game/`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.__lcwWorld, null, { timeout: 120000 });
await page.waitForFunction(() => !document.body.innerText.includes('마을을 짓는 중'), null, { timeout: 120000 }).catch(() => {});
// the first-visit guide may cover the screen: close it if it is there
await page.waitForSelector('.lcw-firstvisit', { timeout: 15000 }).catch(() => {});
await page.click('.lcw-firstvisit-go', { timeout: 3000 }).catch(() => {});
await page.waitForTimeout(1200);
mark('spawn', { scene: await scene() });

// 1. the card and its 가기 button (no suit yet -> the tailor)
await page.waitForSelector('[data-play="card"]', { timeout: 20000 });
await page.click('[data-play="card"]');
await page.waitForSelector('[data-play="card-body"]');
await page.waitForTimeout(600);
await shot('60-play-card');
const task0 = await page.$eval('[data-play="task"]', (t) => t.innerText).catch(() => null);
mark('card', { task: task0 });
await page.click('[data-play="go"]');
await page.waitForFunction(() => window.__lcwWorld.getScene?.() === 'tailor', null, { timeout: 90000 });
await page.waitForTimeout(2500);
await shot('61-hall-tailor');
mark('at_tailor', { player: await page.evaluate(() => window.__lcwWorld.getStats().player) });
await page.click('[data-play="card"]').catch(() => {});

// Talk to the NPC whose name matches; another NPC's window is closed.
async function talk(name) {
  for (let i = 0; i < 10; i++) {
    if (await page.$('.lcw-dlg')) {
      const who = await page.$eval('.lcw-dlg', (d) => d.innerText.slice(0, 120));
      if (name.test(who)) return true;
      await page.click('.lcw-dlg__x').catch(() => page.keyboard.press('Escape'));
      await page.waitForTimeout(700);
    }
    await page.keyboard.press('KeyE');
    await page.waitForTimeout(900);
    if (await page.$('.lcw-dlg')) continue;
    // a gate answers with a bubble and a toast instead of the window
    const t = await toasts();
    if (t.length) return { gate: t };
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
  await page.waitForFunction(() => {
    const r = document.querySelector('.lcw-res');
    return !!r && !!document.querySelector('.lcw-res__fb') && !r.textContent.includes('확인하는 중');
  }, null, { timeout: 60000 });
  await page.waitForTimeout(700);
  const res = await page.$eval('.lcw-res', (r) => r.innerText.replace(/\s+/g, ' ').slice(0, 160));
  return { npcLine, offers: offers.map((o) => o.text), said: pick.text, res };
}
async function finish(label) {
  await page.click('.lcw-res .lcw-cta--go', { timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(900);
  if (await page.$('.lcw-dlg')) {
    await page.click('.lcw-dlg__x').catch(() => {});
    await page.waitForTimeout(700);
  }
  if (await page.$('.lcw-dlg')) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(700);
  }
  await page.waitForTimeout(400);
  const t = await toasts();
  await shot(label);
  return { toasts: t, stillOpen: !!(await page.$('.lcw-dlg')) };
}

// 2. the office says "come in a suit" (a gate, no window)
await go('office');
const gate = await talk(/사장님|Olivia|Boss/);
await shot('62-office-no-suit');
mark('office_gate', { gate });
await page.waitForTimeout(4500);

// 3. the mine: elevator panel, walk to the first vein, dig with F
await go('mine');
await page.waitForTimeout(2000);
await page.waitForSelector('[data-play="elevator"]', { timeout: 10000 });
await shot('63-mine-elevator');
const floors = await page.$$eval('[data-play="elevator"] button', (bs) => bs.map((b) => b.innerText));
mark('elevator', { floors, player: await page.evaluate(() => window.__lcwWorld.getStats().player) });
await page.click('[data-floor="mine_deep"]');
await page.waitForFunction(() => window.__lcwWorld.getScene?.() === 'mine_deep', null, { timeout: 30000 });
await page.waitForTimeout(2500);
await shot('64-mine-deep');
mark('mine_deep', { player: await page.evaluate(() => window.__lcwWorld.getStats().player) });
await page.click('[data-floor="mine"]');
await page.waitForFunction(() => window.__lcwWorld.getScene?.() === 'mine', null, { timeout: 30000 });
await page.waitForTimeout(2000);
for (let i = 0; i < 30 && !(await page.$('[data-play="dig"]')); i++) {
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(150);
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(150);
}
const dig = await page.$eval('[data-play="dig"]', (b) => ({ vein: b.getAttribute('data-vein'), text: b.innerText })).catch(() => null);
await shot('65-mine-dig-button');
mark('dig_button', { dig, player: await page.evaluate(() => window.__lcwWorld.getStats().player) });
// desktop holds F; a phone holds the button (pointer)
if (view === 'desktop') await page.keyboard.down('KeyF');
else await page.dispatchEvent('[data-play="dig"]', 'pointerdown');
await page.waitForTimeout(700);
await shot('66-mine-digging');
await page.waitForTimeout(1200);
if (view === 'desktop') await page.keyboard.up('KeyF');
else await page.dispatchEvent('[data-play="dig"]', 'pointerup').catch(() => {});
await page.waitForTimeout(800);
const dug = await toasts();
await shot('67-mine-dug');
mark('dug', { toasts: dug });

// the rest of floor 1 through the same route (the walk between walls is not what this bot measures)
// floor 1 vein ids (sim-core mineVeins: 12 per floor, `mine.<i>`)
const ids = Array.from({ length: 12 }, (_, i) => `mine.${i}`);
// four rounds (veins grow back on play time; the open page's heartbeat moves it) = docs/03 D3 "채굴 초반 10분"
let swings = 0;
for (let round = 0; round < 4; round++) {
  for (let w = 0; w < 80; w++) {
    const s = await api('/v1/play/state');
    if (Object.keys(s.resting).length === 0) break;
    await new Promise((r) => setTimeout(r, 5000));
  }
  for (const id of ids) {
    await new Promise((r) => setTimeout(r, 1300));
    const r = await api('/v1/play/mine', { method: 'POST', body: JSON.stringify({ vein_id: id }) });
    if (r.ok) swings++;
  }
  mark('mine_round', { round, swings });
}
await shot('67b-mine-resting');
const afterMine = await api('/v1/play/state');
mark('mined', { swings, ores: afterMine.ores, coins: afterMine.coins, clock: afterMine.clock });

// 4. the exchange: board + sell each ore with a 3-star sentence
await page.click('[data-floor="mine_deep"]').catch(() => {});
await go('exchange');
await page.waitForTimeout(2500);
await shot('68-exchange-board');
for (const ore of Object.keys(afterMine.ores)) {
  const ok = await talk(/오스카|Oscar|환전/);
  if (ok !== true) {
    mark('exchange_open_failed', { ok });
    break;
  }
  const a = await answer(3, `69-exchange-${ore}-offers`);
  const f = await finish(`70-exchange-${ore}-sold`);
  mark('sold', { ore, ...a, ...f });
}
let st = await api('/v1/play/state');
mark('after_exchange', { coins: st.coins, ores: st.ores, exchange_total: st.exchange_total });

// 5. the suit
await go('tailor');
await page.waitForTimeout(1500);
if ((await talk(/헨리|Henry|재단/)) === true) {
  const a = await answer(3, '71-tailor-offers');
  const f = await finish('72-tailor-suit');
  mark('suit', { ...a, ...f });
}
st = await api('/v1/play/state');
mark('after_suit', { has_suit: st.job.has_suit, coins: st.coins, clock: st.clock });

// 6. the office opens at 08:00 (work clock = the child's play time): wait for the next morning, on time
for (let w = 0; w < 200; w++) {
  st = await api('/v1/play/state');
  if (st.clock.hours === 'on_time') break;
  await new Promise((r) => setTimeout(r, 10000));
}
mark('morning', { clock: st.clock });
// interview (3 turns), clock-in, two customers
await go('office');
await page.waitForTimeout(1500);
for (let turn = 0; turn < 3; turn++) {
  const ok = await talk(/올리비아|Olivia|사장/);
  if (ok !== true) {
    mark('interview_open_failed', { turn, ok });
    break;
  }
  const a = await answer(3, `73-interview-${turn}`);
  const f = await finish(`74-interview-${turn}-done`);
  mark('interview', { turn, ...a, ...f });
}
st = await api('/v1/play/state');
mark('hired', { rank: st.job.rank, next: st.next, clock: st.clock });
if ((await talk(/올리비아|Olivia|사장/)) === true) {
  const a = await answer(2, '75-clockin-offers');
  const f = await finish('76-clockin-done');
  mark('clock_in', { ...a, ...f });
}
for (let n = 0; n < 2; n++) {
  await page.evaluate(() => window.__lcwWorld.walkToNpc?.('office_customer'));
  await page.waitForTimeout(1500);
  const ok = await talk(/벤|Ben|손님/);
  if (ok !== true) {
    mark('customer_open_failed', { n, ok });
    break;
  }
  const a = await answer(3, `77-customer-${n}`);
  const f = await finish(`78-customer-${n}-done`);
  mark('customer', { n, ...a, ...f });
}
await page.click('[data-play="card"]').catch(() => {});
await page.waitForTimeout(600);
await shot('79-day-done-card');
st = await api('/v1/play/state');
mark('end', { job: st.job, shift: st.shift, coins: st.coins, clock: st.clock });

const report = { view, steps, errors: errs };
writeFileSync(`${out}/play-bot-${view}.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ view, errors: errs.length, end: steps[steps.length - 1] }));
await browser.close();
