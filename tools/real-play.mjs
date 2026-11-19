// R2625 real-play check (world + dialog lanes, one test). A first-time child plays with no adult help, the way Dan's
// lesson went on 11-16, through the real page and the real edge routes:
//
//   start -> pass the first-visit card -> Mia's errand at the honey cafe door -> order at the counter -> hand the drink
//   over -> the next goal (town goal chain when it is there) -> talk on until there is no goal (or 6 talks)
//
// Every talk is opened the way a child would: on a PC with a click on the NPC and with the E key, on a phone with a
// tap on the NPC and the talk button. The bot never calls world APIs to talk; it only reads getStats() to know where
// the NPC is drawn and what the world thinks (near, goal, prompt). It also jumps in place and walks into the town, and
// reports:
//   unwanted jumps (rose without the jump pressed + whole-block climbs with auto jump off) -> must be 0
//   click/tap talk success rate, E-key / talk-button success rate (the right NPC's dialog opened within 1.5 s)
//   camera rise during a pressed jump (first person view must stay steady, R2625 ①)
//   repeated first lines when the same NPC is visited again (dialog lane, R2625)
//   the hill: down the half-step ramp and back up by keys / stick only, no jump (LCW_REAL_PLAY_HILL=0 skips it)
//   in a lesson: the lesson NPC reopens the folded window by click and E; a passer-by stays quiet (#152)
//   failed requests by path; cached-only voice 404s (/v1/tts?…&c=1, by design under automation) counted apart
// The nightly audit (tools/nightly-audit.mjs) runs it on production and judges it with tools/real-play-judge.mjs.
//
//   PLAYWRIGHT_CORE=<playwright-core/index.mjs> node tools/real-play.mjs <base> <outDir> <pc|touch> [dev.json]
//
// dev.json = {"device_token": "..."} for a linked child. Without it, LCW_OPERATOR_TOKEN (env only, never printed or
// committed) makes a fresh test child through the admin routes; on production use smoke students only.
// Headless only, audio muted.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { layoutIssues } from './frame-layout.mjs';

const pw = process.env.PLAYWRIGHT_CORE ? await import(pathToFileURL(process.env.PLAYWRIGHT_CORE).href) : await import('playwright-core');
const chromium = pw.chromium ?? pw.default.chromium;
const [base, out, view = 'pc', devFile] = process.argv.slice(2);
if (!base || !out || !['pc', 'touch'].includes(view)) {
  console.error('usage: node tools/real-play.mjs <base> <outDir> <pc|touch> [dev.json]');
  process.exit(2);
}
mkdirSync(out, { recursive: true });
const touch = view === 'touch';
const [W, H] = touch ? [390, 844] : [1440, 900];

// Stall watchdog: no progress line for LCW_REAL_PLAY_STALL_MIN (10) minutes -> say after which step and stop, so the
// night audit keeps its time for the screens and knows where it stopped (11-18: a touch run sat 24 min with no line).
const STALL_MS = Number(process.env.LCW_REAL_PLAY_STALL_MIN ?? 10) * 60_000;
const P0 = Date.now();
let lastStep = { name: 'start', at: P0 };
const progress = (name) => {
  lastStep = { name, at: Date.now() };
};
setInterval(() => {
  if (Date.now() - lastStep.at < STALL_MS) return;
  console.log(JSON.stringify({ name: 'stalled', after: lastStep.name, t: Math.round((Date.now() - P0) / 1000) }));
  process.exit(3);
}, 15_000).unref();

async function call(method, p, body, token) {
  const r = await fetch(base + p, {
    signal: AbortSignal.timeout(30_000),
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const t = await r.text();
  let j = null;
  try {
    j = t ? JSON.parse(t) : null;
  } catch {
    j = t.slice(0, 200);
  }
  return { status: r.status, body: j };
}

/** A fresh linked child (guardian consent, device code, link), the same steps a family goes through. */
async function newChild() {
  const op = process.env.LCW_OPERATOR_TOKEN;
  if (!op) throw new Error('no dev.json and no LCW_OPERATOR_TOKEN');
  const kid = `${process.env.LCW_KID_PREFIX ?? 'play'}-${Date.now().toString(36)}`;
  const fam = `fam-${kid}`;
  await call('POST', '/v1/admin/players', { family_id: fam, guardian_id: `g-${fam}`, player_id: kid, nickname: 'Juno', birth_year: 2016, level: 'L1' }, op);
  const inv = await call('POST', '/v1/admin/family-invites', { player_id: kid }, op);
  const sess = await call('POST', '/v1/family/session', { invite: inv.body.invite_path.split('#k=')[1] });
  const g = sess.body.guardian_token;
  await call('POST', '/v1/family/service-consent', { granted: true }, g);
  await call('POST', '/v1/admin/seats', { payer_guardian_id: `g-${fam}`, plan: 'solo', term: 'month', player_ids: [kid] }, op);
  const code = await call('POST', `/v1/family/children/${kid}/device-code`, {}, g);
  const link = await call('POST', '/v1/device/link', { code: code.body.code, label: 'play' });
  if (!link.body?.device_token) throw new Error(`link failed ${link.status}`);
  return { kid, device_token: link.body.device_token };
}

const dev = devFile ? JSON.parse(readFileSync(devFile, 'utf8')) : await newChild();
progress('child');
console.log(JSON.stringify({ name: 'child', t: Math.round((Date.now() - P0) / 1000) }));
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--mute-audio', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
});
const ctx = await browser.newContext({
  viewport: { width: W, height: H },
  permissions: ['microphone'],
  ...(touch ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {})
});
await ctx.addInitScript(([t]) => {
  localStorage.setItem('lcw.deviceToken', t);
  localStorage.setItem('lcw.deviceNickname', 'Juno');
}, [dev.device_token]);
const page = await ctx.newPage();
progress('browser');
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 200)));
page.on('console', (m) => {
  // the browser's own "Failed to load resource" line names no URL: the response listener below records those instead
  if (m.type() === 'error' && !/^Failed to load resource/.test(m.text())) errs.push(m.text().slice(0, 200));
});
// Failed requests by path (never the query: tts lines carry the sentence). A cached-only voice line that is not cached
// (`/v1/tts?...&c=1` -> 404, edge tts.ts) is by design under automation and smoke students: the device voice reads it, a
// child's browser never asks with c=1. Those are counted apart, everything else is an error.
const httpFails = [];
let ttsCacheMiss = 0;
const ttsJudging = [];
page.on('response', (r) => {
  const st = r.status();
  if (st < 400) return;
  let u;
  try {
    u = new URL(r.url());
  } catch {
    return;
  }
  const fail = (why = '') => {
    httpFails.push(`${st} ${u.host}${u.pathname}${why}`);
    errs.push(`http ${st} ${u.host}${u.pathname}${why}`);
  };
  // only `tts_not_cached` is the by-design miss: `tts_not_made` / `tts_off` would reach a child too (review of #158)
  if (st === 404 && u.pathname === '/v1/tts' && u.searchParams.get('c') === '1') {
    ttsJudging.push(
      r
        .json()
        .then((b) => (b?.error === 'tts_not_cached' ? ttsCacheMiss++ : fail(` ${b?.error ?? ''}`)))
        .catch(() => fail())
    );
    return;
  }
  fail();
});
const T0 = Date.now();
const log = [];
const mark = (name, extra = {}) => {
  const s = { name, t: Math.round((Date.now() - T0) / 100) / 10, ...extra };
  log.push(s);
  progress(name);
  console.log(JSON.stringify(s));
};
// Kid-screen layout at each step as the child sees it (tools/frame-layout.mjs, the frame lane's measure): parts that
// overlap, run off the screen or cut their own text. A problem counts when it is still there 0.6 s later (a card
// sliding in or a name plate passing is not a layout fault).
const hud = [];
async function hudCheck(step) {
  const a = await layoutIssues(page).catch(() => null);
  if (!a) return;
  let problems = [];
  if (a.problems.length) {
    await wait(600);
    const b = await layoutIssues(page).catch(() => null);
    problems = b ? a.problems.filter((x) => b.problems.includes(x)) : [];
  }
  hud.push({ step, parts: a.parts.length, problems });
  if (problems.length) await shot(`hud-${hud.length}-${step}`);
}
const shot = (name) => page.screenshot({ path: `${out}/${view}-${name}.png` }).catch(() => {});
const stats = () => page.evaluate(() => window.__lcwWorld?.getStats?.() ?? null);
const wait = (ms) => page.waitForTimeout(ms);
const dlgOpen = async () => !!(await page.$('.lcw-dlg'));
const dlgHead = async () => (await page.$eval('.lcw-dlg', (d) => d.innerText.slice(0, 120)).catch(() => '')) ?? '';
const firstLine = async () => (await page.$eval('.lcw-dlg__bubble', (d) => d.innerText.trim()).catch(() => '')) ?? '';

const counts = { clickTry: 0, clickOk: 0, keyTry: 0, keyOk: 0, wrongNpc: 0 };
const lines = new Map(); // npc id -> first lines seen, in order
const jumpView = [];

async function closeDlg() {
  for (let i = 0; i < 3 && (await dlgOpen()); i++) {
    await page.click('.lcw-dlg__x', { timeout: 1500 }).catch(() => page.keyboard.press('Escape'));
    await wait(700);
  }
}

/** Pass the start cards (language, name, intro, mic check) the way a child does: press the main button. */
async function passStart() {
  const clicked = [];
  const until = Date.now() + 90000;
  let idle = 0;
  while (Date.now() < until) {
    if (await page.$('.lcw-firstvisit-go')) {
      await page.click('.lcw-firstvisit-go').catch(() => {});
      clicked.push('firstvisit');
      await wait(1200);
      continue;
    }
    const inp = page.locator('input[placeholder]').first();
    if ((await inp.count()) && (await inp.isVisible().catch(() => false)) && !(await inp.inputValue().catch(() => 'x'))) await inp.fill('Juno').catch(() => {});
    const b = page.getByRole('button', { name: /^(Aa\s*)?English|Start|Let's go|Skip|^Make|Create|Next|^OK|Play|Go in|시작|들어가|다음|건너뛰|좋아/i }).first();
    if ((await b.count()) && (await b.isVisible().catch(() => false))) {
      clicked.push(((await b.textContent()) ?? '').trim().slice(0, 24));
      await b.click().catch(() => {});
      idle = 0;
      await wait(1500);
      continue;
    }
    // in the town: the errand's goal is set (or, for a world without it, nothing left to press for a while)
    const s = await stats();
    if (s?.interact?.goal && clicked.includes('firstvisit')) break;
    if (++idle > 12) break;
    await wait(1000);
  }
  return clicked;
}

/** Turn the view (mouse drag on PC, a look drag on the right half on touch) by about `px` screen pixels. */
async function turn(px) {
  if (touch) {
    const cdp = await ctx.newCDPSession(page);
    const y = H * 0.4;
    const x0 = W * 0.75;
    const steps = 8;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y, id: 7 }] });
    for (let i = 1; i <= steps; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (px * i) / steps, y, id: 7 }] });
      await wait(16);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  } else {
    const y = H * 0.35;
    const x0 = W / 2;
    await page.mouse.move(x0, y);
    await page.mouse.down();
    await page.mouse.move(x0 + px, y, { steps: 10 });
    await page.mouse.up();
  }
  await wait(250);
}

// the world turns the view by 0.006 rad per mouse pixel and 0.008 per touch pixel (engine.ts), the camera is 70° tall
const RAD_PER_PX = touch ? 0.008 : 0.006;
const FOCAL = H / 2 / Math.tan((70 * Math.PI) / 360);

/** Face the NPC: turn until its body is near the middle of the screen. */
let faceMiss = null;
// every face miss with what the scene graph had for that NPC (engine getStats().npcScene): the judge tells "not drawn"
// (a product fault) from "drawn, the bot did not get it on screen" (not checked)
const faceMisses = [];
// every measured drag of every face(): how many turned the view (shows the yaw measure works on a night with no miss)
const look = { drags: 0, turned: 0 };
async function face(id) {
  progress('face');
  // did any drag turn the view? (getStats().player.yaw; null on a page from before) - a look input that does nothing
  // makes every face miss, and must not pass as "the bot missed a drawn NPC" (review of #168)
  let turns = 0;
  let turned = 0;
  let yaw0 = null;
  for (let i = 0; i < 16; i++) {
    const s = await stats();
    const yaw = s?.player?.yaw;
    if (yaw0 !== null && typeof yaw === 'number') {
      turns++;
      look.drags++;
      if (Math.abs(Math.atan2(Math.sin(yaw - yaw0), Math.cos(yaw - yaw0))) > 0.01) {
        turned++;
        look.turned++;
      }
    }
    yaw0 = null;
    const n = s?.npcView?.find((v) => v.id === id);
    if (n && n.vis && n.sx > 0 && n.sx < W && Math.abs(n.sx - W / 2) < W * 0.1) return n;
    // pressed against the NPC (1 m): its feet and head both leave the screen, so no turn finds it; step back first
    // (local run 11-19: errand_neighbor at 1 m, three face misses in the lesson)
    if (n && !n.vis && n.dist < 1.4) {
      await back(350);
      continue;
    }
    // not on screen: about 50° to the right; on screen: the angle to it (dragging right turns the view right)
    const px = !n || !n.vis || n.sx < 0 || n.sx > W ? 0.9 / RAD_PER_PX : Math.atan((n.sx - W / 2) / FOCAL) / RAD_PER_PX;
    // only drags big enough to see (over ~3 degrees) are checked for turning the view
    if (Math.abs(px * RAD_PER_PX) > 0.05 && typeof yaw === 'number') yaw0 = yaw;
    await turn(px);
  }
  const s = await stats();
  const n = s?.npcView?.find((v) => v.id === id);
  faceMiss = {
    id,
    step: lastStep.name,
    view: n ? { vis: n.vis, sx: Math.round(n.sx), dist: n.dist } : null,
    sceneKnown: Array.isArray(s?.npcScene),
    // false: the bot dragged and the view never turned; null: no yaw on this page or no drag measured
    turned: turns === 0 ? null : turned > 0,
    turns,
    drawn: s?.npcScene?.find((x) => x.id === id) ?? null,
    walking: s?.interact?.walking ?? null,
    paused: s?.interact?.paused ?? null,
    dlg: await dlgOpen().catch(() => null)
  };
  faceMisses.push(faceMiss);
  return null;
}

/** Hold a key for ms (walking). */
async function hold(key, ms) {
  await page.keyboard.down(key);
  await wait(ms);
  await page.keyboard.up(key);
}

async function walkStick(dz, ms) {
  // the left half of the screen is the stick: hold a finger and push it forward (dz < 0) or back
  const cdp = await ctx.newCDPSession(page);
  const x = W * 0.22;
  const y = H * 0.72;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 3 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + dz * 40, id: 3 }] });
  await wait(ms);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
  await wait(200);
}

const back = (ms) => (touch ? walkStick(1, ms) : hold('KeyS', ms));
const forward = (ms) => (touch ? walkStick(-1, ms) : hold('KeyW', ms));

/** Walk up to the NPC (facing it) until it is within `want` metres. */
async function approach(id, want) {
  for (let i = 0; i < 12; i++) {
    const n = await face(id);
    if (!n) return null;
    if (n.dist <= want) return n;
    await forward(Math.min(900, 220 * (n.dist - want) + 120));
  }
  const s = await stats();
  return s?.npcView?.find((v) => v.id === id) ?? null;
}

const nameOf = { guide: /Luna|루나/, cafe_owner: /Hannah|해나/, shop_owner: /Toby|토비/, errand_neighbor: /Mia|미아/ };
// the dialog says which NPC it is with (DialogPanel data-npc); the cast name is only the fallback for a page from before
const dlgJudgedBy = { attr: 0, name: 0 };
const rightNpc = async (id) => {
  const dn = await page.$eval('.lcw-dlg', (d) => d.getAttribute('data-npc')).catch(() => null);
  if (dn) {
    dlgJudgedBy.attr++;
    return dn === id;
  }
  dlgJudgedBy.name++;
  const head = await dlgHead();
  return nameOf[id] ? nameOf[id].test(head) : head.length > 0;
};

let lastClick = null;
/** One talk opened by a click/tap on the NPC's body. */
async function tryClick(id) {
  const n = await face(id);
  // null: the bot never got the NPC on screen, so nothing was tried (not checked; review 2 of #158)
  if (!n) return null;
  counts.clickTry++;
  const s = await stats();
  const v = s?.npcView?.find((x) => x.id === id) ?? n;
  lastClick = { at: [v.sx, v.sy], dist: v.dist, top: await page.evaluate(([x, y]) => (document.elementFromPoint(x, y)?.className ?? '').toString().slice(0, 50), [v.sx, v.sy]) };
  if (touch) await page.touchscreen.tap(v.sx, v.sy);
  else await page.mouse.click(v.sx, v.sy);
  await page.waitForSelector('.lcw-dlg', { timeout: 1500 }).catch(() => {});
  const ok = (await dlgOpen()) && (await rightNpc(id));
  if (ok) counts.clickOk++;
  else if (await dlgOpen()) {
    counts.wrongNpc++;
    await closeDlg();
  }
  return ok;
}

/** One talk opened by the E key (PC) or the talk button (touch), facing the NPC in reach. */
async function tryKey(id) {
  // like tryClick: a try counts once the NPC is on screen, or when the dialog opens anyway (E reads the NPC in reach),
  // so the bot missing the NPC on screen is not a failed talk (review of #158)
  const faced = await face(id);
  const s = await stats();
  let button = null;
  if (touch) {
    const b = await page.$('.lw-btn.talk.on');
    if (b) {
      const box = await b.boundingBox().catch(() => null);
      // what is under the button's middle: the button itself (or its icon inside it), or something over it
      button = box
        ? await page.evaluate(([x, y]) => {
            const e = document.elementFromPoint(x, y);
            const own = e?.closest('.lw-btn.talk');
            if (own) return 'talk';
            // name what covers it: the nearest box with a class, role, test id or text
            const named = e?.closest('[class]:not([class=""]),[role],[data-testid]') ?? e;
            const cls = (named?.className ?? '').toString().trim().split(/\s+/).slice(0, 2).join('.');
            const t = (named?.getAttribute?.('data-testid') || named?.getAttribute?.('role') || '') + ' "' + (named?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 28) + '"';
            return `${named?.tagName ?? '-'}${cls ? '.' + cls : ''} ${t}`;
          }, [box.x + box.width / 2, box.y + box.height / 2])
        : 'no box';
      // a talk button showing but covered by another screen part: the child's tap lands on that part
      if (button !== 'talk' && button !== 'no box') {
        hud.push({ step: `talk-button(${id})`, parts: 0, problems: [`talk button covered: .lw-btn.talk / ${button}`] });
        await hudCheck(`talk-button(${id})`);
      }
      await b.tap().catch(() => {});
    } else button = 'hidden';
  } else await page.keyboard.press('KeyE');
  await page.waitForSelector('.lcw-dlg', { timeout: 1500 }).catch(() => {});
  const ok = (await dlgOpen()) && (await rightNpc(id));
  // diagnosis only (the 1.5 s rule stays): did it open later, and what was on screen instead
  let late = null;
  if (!ok) {
    late = await page.waitForSelector('.lcw-dlg', { timeout: 3000 }).then(() => true).catch(() => false);
    if (!late) await shot(`key-miss-${id}-${counts.keyTry}`);
  }
  if (faced || ok) counts.keyTry++;
  if (ok) counts.keyOk++;
  else if (await dlgOpen()) {
    counts.wrongNpc++;
    await closeDlg();
  }
  return { ok, faced: !!faced, near: s?.interact?.near ?? null, goal: s?.interact?.goal ?? null, prompt: s?.interact?.prompt ?? null, why: s?.interact?.promptWhy, paused: s?.interact?.paused, walking: s?.interact?.walking, ...(late === null ? {} : { late }), ...(touch ? { button } : {}) };
}

async function answer(stars) {
  const offers = await page.$$eval('.lcw-offer', (os) =>
    os.map((o) => ({ s: o.getAttribute('data-s'), text: o.innerText.replace(/[★☆🔊🪙\d]/gu, '').split(/\n/).map((x) => x.trim()).filter(Boolean)[0] ?? '' }))
  );
  if (offers.length === 0) return { said: null, res: 'no offers' };
  const pick = offers.find((o) => o.s === String(stars)) ?? offers[0];
  await page.click(`.lcw-offer[data-s="${pick.s}"]`).catch(() => {});
  await wait(300);
  await page.getByRole('button', { name: /⌨️/ }).first().click({ timeout: 3000 }).catch(() => {});
  await page.fill('.lcw-input', pick.text).catch(() => {});
  await page.click('.lcw-dlg form .lcw-cta--go').catch(() => {});
  await page.waitForSelector('.lcw-res__fb', { timeout: 60000 }).catch(() => {});
  await page.waitForFunction(() => !document.querySelector('.lcw-dots'), null, { timeout: 60000 }).catch(() => {});
  await wait(600);
  const res = await page.$eval('.lcw-res', (r) => r.innerText.replace(/\s+/g, ' ').slice(0, 140)).catch(() => '');
  await page.click('.lcw-res .lcw-cta--go', { timeout: 3000 }).catch(() => {});
  await wait(900);
  await closeDlg();
  return { said: pick.text, res };
}

/** The jump check: three pressed jumps in place; the camera may rise only a little of what the body rises. */
async function jumpCheck() {
  for (let i = 0; i < 3; i++) {
    const samples = [];
    if (touch) {
      const b = await page.$('.lw-btn.jump');
      if (b) {
        const box = await b.boundingBox();
        const cdp = await ctx.newCDPSession(page);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2, id: 9 }] });
        await wait(90);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await cdp.detach();
      }
    } else {
      await page.keyboard.down('Space');
      await wait(90);
      await page.keyboard.up('Space');
    }
    for (let k = 0; k < 18; k++) {
      const s = await stats();
      if (s?.motion) samples.push([s.motion.bodyY, s.motion.camY]);
      await wait(40);
    }
    const by = samples.map((x) => x[0]);
    const cy = samples.map((x) => x[1]);
    jumpView.push({ bodyRise: Math.round((Math.max(...by) - Math.min(...by)) * 100) / 100, camRise: Math.round((Math.max(...cy) - Math.min(...cy)) * 100) / 100 });
    await wait(400);
  }
}

// ---- play
await page.goto(`${base}/world/`, { waitUntil: 'domcontentloaded' });
progress('page');
await page.waitForFunction(() => !!window.__lcwWorld, null, { timeout: 300000 });
await page.waitForFunction(() => (window.__lcwWorld.getStats?.()?.ground?.near ?? 1) === 0, null, { timeout: 120000 }).catch(() => {});
const s0 = await stats();
const npcSceneAtSpawn = s0?.npcScene ?? null;
mark('spawn', { scene: s0?.scene, npcs: npcSceneAtSpawn?.filter((x) => x.shown).map((x) => x.id) ?? null });
mark('start_cards', { clicked: await passStart() });
await wait(1500);
await shot('01-start');

const m0 = (await stats())?.motion;
await jumpCheck();
mark('jumps', { jumpView });
// a free walk through the town: forward and turning, into whatever is there (curbs, steps, fences)
for (let i = 0; i < 6; i++) {
  await forward(900);
  await turn(W * 0.18);
}
await hudCheck('walk');
mark('free_walk', { motion: (await stats())?.motion });

const talks = [];
const seenGoals = [];
for (let round = 0; round < 9; round++) {
  let s = await stats();
  // the next goal can come a few seconds after a step (reward line, the town goal chain fetching its state)
  for (let k = 0; k < 12 && !s?.interact?.goal; k++) {
    await wait(1000);
    s = await stats();
  }
  const goal = s?.interact?.goal ?? null;
  seenGoals.push(goal);
  if (!goal) break;
  // get there like a child: the goal card's walk button when it is there, else walk toward the marked NPC
  const walkBtn = await page.$('.lcw-errand-walk');
  let walked = null;
  if (walkBtn && !(s.npcView ?? []).some((v) => v.id === goal && v.dist < 14)) {
    walked = { taps: 0, ok: false, at: null };
    await shot(`0${round}-walk-button`);
    for (let k = 0; k < 3 && !walked.ok; k++) {
      walked.taps++;
      const box = await walkBtn.boundingBox().catch(() => null);
      walked.at = box ? [Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2)] : null;
      if (box && touch) await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
      else if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      if (k === 0 && round < 2) {
        await wait(1200);
        await hudCheck('walk-button');
      }
      walked.ok = await page
        .waitForFunction((g) => (window.__lcwWorld.getStats?.()?.npcView ?? []).some((v) => v.id === g && v.dist < 5), goal, { timeout: 25000 })
        .then(() => true)
        .catch(() => false);
    }
    walked.top = await page.evaluate(([x, y]) => (x === undefined ? null : (document.elementFromPoint(x, y)?.className ?? '').toString().slice(0, 60)), walked.at ?? []);
    await wait(1500);
  }
  // step back so the click and E are measured from a child's distance, not from the walk's end spot
  await back(500);
  faceMiss = null;
  const near = await approach(goal, 2.6);
  const t = { goal, walked, reached: !!near, ...(near ? {} : { faceMiss }), dist: near?.dist ?? null, promptOnGoal: (await stats())?.interact?.prompt ?? null };
  t.click = await tryClick(goal);
  // not on screen (null): the face miss explains it; the last click would point at an earlier talk
  if (t.click === null) t.clickMiss = { notOnScreen: faceMiss };
  else if (!t.click) t.clickMiss = lastClick;
  if (t.click) {
    t.lineClick = await firstLine();
    await closeDlg();
  }
  t.key = await tryKey(goal);
  if (!t.key.ok && !(await dlgOpen())) {
    // one more try the way a child would (closer, then E again)
    await approach(goal, 1.8);
    t.key2 = await tryKey(goal);
  }
  if (await dlgOpen()) {
    const line = await firstLine();
    const seen = lines.get(goal) ?? [];
    seen.push(line);
    lines.set(goal, seen);
    t.line = line;
    await shot(`1${round}-talk-${goal}`);
    if (round < 3) await hudCheck('dialog');
    t.answer = await answer(3);
  }
  await wait(1500);
  t.goalAfter = (await stats())?.interact?.goal ?? null;
  talks.push(t);
  mark('talk', t);
  if (t.goalAfter === goal && !t.answer) break; // stuck: no dialog at all
}
// R2625 ⑤: an NPC already talked to that is not the goal keeps quiet (no talk prompt / talk button popping up again)
const quiet = [];
{
  const s = await stats();
  for (const v of s?.npcView ?? []) {
    if (v.id === s.interact?.goal || !(s.interact?.talked ?? []).includes(v.id) || v.dist > 8) continue;
    const n = await approach(v.id, 2.4);
    await wait(400);
    const after = await stats();
    if (n && after?.interact?.near === v.id) quiet.push({ id: v.id, prompt: after.interact.prompt });
  }
}
mark('quiet', { quiet });

// The hill (R2625: no automatic hop onto a whole block any more): from the top down the half-step ramp and back up by
// keys or the stick only, never pressing jump. The scene walk takes the child to the top (the walk button's own path).
/**
 * Walk by keys/stick along the line x = lineX toward z = endZ, steering every step from the heading the last steps
 * measured. It aims at the line a few metres ahead, not at the far end: the ramp is 3 cells wide, and aiming at the top
 * from the side walked the bot onto the whole-block slope next to it (11-18 runs: stuck at x 151..157).
 */
async function walkTo(lineX, endZ, done) {
  let minY = Infinity;
  let maxY = -Infinity;
  let stuck = 0;
  const trace = [];
  for (let i = 0; i < 40; i++) {
    progress('hill-walk');
    const a = (await stats()).player;
    if (done(a)) break;
    await forward(350);
    const b = (await stats()).player;
    minY = Math.min(minY, b.y);
    maxY = Math.max(maxY, b.y);
    const moved = Math.hypot(b.x - a.x, b.z - a.z);
    if (done(b)) break;
    if (moved > 0.15) {
      stuck = 0;
      const dir = Math.sign(endZ - b.z) || 1;
      const tx = lineX;
      const tz = Math.abs(endZ - b.z) < 3 ? endZ : b.z + dir * 3;
      let err = Math.atan2(tx - b.x, tz - b.z) - Math.atan2(b.x - a.x, b.z - a.z);
      while (err > Math.PI) err -= 2 * Math.PI;
      while (err < -Math.PI) err += 2 * Math.PI;
      trace.push([+b.x.toFixed(1), +b.y.toFixed(1), +b.z.toFixed(1), +err.toFixed(2)]);
      // the view turns by -dx * k (engine onLook): a positive yaw error is a drag to the left; big turns in two goes
      if (Math.abs(err) > 0.08) await turn(-Math.max(-1.6, Math.min(1.6, err)) / RAD_PER_PX);
      // a big turn (turning round at the bottom) is only turned, then measured again: walking on would carry the bot
      // sideways off the line (11-18: 7 m west of the ramp)
      if (Math.abs(err) > 1.2) continue;
    } else {
      // against a block or an NPC: step back, turn ~40 degrees and aim again from the next step's heading
      // (turning blind kept the bot on the ramp's side wall; backing alone walked into the hill guide 8 times, 11-18)
      trace.push(['stuck', +b.x.toFixed(1), +b.y.toFixed(1), +b.z.toFixed(1)]);
      if (++stuck > 8) break;
      await back(400);
      await turn(0.7 / RAD_PER_PX);
      continue;
    }
    // shorter steps while off the line, so a correction lands before the bot leaves the ramp
    await forward(Math.abs(b.x - lineX) > 0.8 ? 450 : 900);
    const c = (await stats()).player;
    minY = Math.min(minY, c.y);
    maxY = Math.max(maxY, c.y);
  }
  const e = (await stats()).player;
  return { end: { x: +e.x.toFixed(2), y: +e.y.toFixed(2), z: +e.z.toFixed(2) }, minY: +minY.toFixed(2), maxY: +maxY.toFixed(2), trace };
}
// the ramp (packages/sim-core town.ts): x 143..145, half a block a cell from z 126 (ground) to z 109 (the top, y 10)
// down along x 143.6 (still on the ramp): the hill scene's spot faces the guide standing on the centre line 2.3 m south
const HILL_RAMP = { x: 144.5, downX: 143.6, bottomZ: 131, topZ: 103, topY: 10 };
const hill = { ran: false };
if (process.env.LCW_REAL_PLAY_HILL !== '0') {
  await closeDlg();
  await page.evaluate(() => window.__lcwWorld.goToScene('open_hill'));
  await page
    .waitForFunction(() => { const s = window.__lcwWorld.getStats(); return s.scene === 'open_hill' && !s.interact.walking; }, null, { timeout: 60000 })
    .catch(() => {});
  await wait(1200);
  const top = (await stats()).player;
  // a few tries: the bot's steering can leave the 3-wide ramp on a big turn at the bottom (11-18 run 1), a child's does not
  let climbed = null; // a try that got down and climbed (to the top or not)
  const sums = { pressedJumpsUp: 0, unwantedJumpsUp: 0, autoClimbsUp: 0 };
  for (let tryNo = 1; tryNo <= 3 && !hill.reachedTop; tryNo++) {
    const down = await walkTo(HILL_RAMP.downX, HILL_RAMP.bottomZ, (p) => p.z > HILL_RAMP.bottomZ - 2);
    // the climb counts only from the bottom: a walk that never got down "reaches the top" without climbing (11-18)
    const reachedBottom = down.end.y < 2 && down.end.z > HILL_RAMP.bottomZ - 3;
    const mUp = (await stats()).motion;
    const up = reachedBottom ? await walkTo(HILL_RAMP.x, HILL_RAMP.topZ, (p) => p.z < HILL_RAMP.topZ + 3.5) : { end: down.end, trace: [] };
    const mTop = (await stats()).motion;
    const cur = {
      ran: true,
      tries: tryNo,
      startY: top.y,
      bottomY: down.end.y,
      reachedBottom,
      downTrace: reachedBottom ? undefined : down.trace,
      topY: up.end.y,
      reachedTop: reachedBottom && up.end.z < HILL_RAMP.topZ + 3.5 && up.end.y > HILL_RAMP.topY - 0.6,
      pressedJumpsUp: mTop.jumps - mUp.jumps,
      unwantedJumpsUp: mTop.unpressedJumps - mUp.unpressedJumps,
      autoClimbsUp: mTop.autoClimbs - mUp.autoClimbs,
      camOverBody: +(mTop.camY - mTop.bodyY).toFixed(2),
      upTrace: up.trace
    };
    if (reachedBottom) {
      for (const k of Object.keys(sums)) sums[k] += cur[k];
      climbed = cur;
    }
    // a later try that never got down must not hide an earlier failed climb (review 2 of #158)
    Object.assign(hill, climbed && !reachedBottom ? { ...climbed, tries: tryNo } : cur);
  }
  // jumps / climbs on the way up over every try that climbed: one jump on a failed try still counts
  if (climbed) Object.assign(hill, sums);
  await shot('70-hill-top');
  await hudCheck('hill');
  await page.evaluate(() => window.__lcwWorld.goToScene('plaza'));
  await page.waitForFunction(() => !window.__lcwWorld.getStats().interact.walking, null, { timeout: 60000 }).catch(() => {});
  mark('hill', { ...hill, upTrace: undefined, downTrace: undefined });
}

// Lesson part (R2625 ③④: in Dan's lesson a click or E on an NPC did nothing): the operator starts a lesson for this
// child (the world joins it by itself), the child folds the lesson's dialog with ✕, then a click/tap on the lesson NPC
// and E / the talk button must each bring the dialog back.
const lesson = { started: false, npc: null, reopenByClick: null, reopenByKey: null };
if (process.env.LCW_OPERATOR_TOKEN && dev.kid && process.env.LCW_REAL_PLAY_LESSON !== '0') {
  const st = await call('POST', '/v1/admin/lessons/start', { player_id: dev.kid }, process.env.LCW_OPERATOR_TOKEN);
  lesson.started = st.status === 201;
  lesson.id = st.body?.lesson_id ?? null;
  if (lesson.started) {
    const open = await page.waitForSelector('[data-testid="lesson-dialog"] .lcw-dlg', { timeout: 90000 }).then(() => true).catch(() => false);
    lesson.dialogOpened = open;
    // the once-per-lesson mic check card sits over the dialog: the child presses its main button
    await wait(1500);
    const mic = page.getByRole('button', { name: /OK, let's go|^Skip/i }).first();
    if ((await mic.count()) && (await mic.isVisible().catch(() => false))) {
      await mic.click().catch(() => {});
      await wait(1200);
    }
    lesson.npc = (await stats())?.interact?.goal ?? null;
    await shot('80-lesson-dialog');
    if (open) await hudCheck('lesson-dialog');
    const fold = async () => {
      await page.click('.lcw-dlg__x', { timeout: 3000 }).catch(() => {});
      return page.waitForSelector('[data-testid="lesson-reopen"]', { timeout: 5000 }).then(() => true).catch(() => false);
    };
    if (open && lesson.npc && (await fold())) {
      await hudCheck('lesson-folded');
      // a passer-by in the lesson (#152): no talk prompt or talk button over them, a tap and E stay quiet (no dialog,
      // the lesson window stays folded), and the lesson NPC still reopens it afterwards (the click/E checks below)
      const passerId = ['cafe_owner', 'shop_owner', 'guide'].find((id) => id !== lesson.npc);
      const walkToNpc = (id) => page.evaluate((n) => (window.__lcwWorld.walkToNpc ? window.__lcwWorld.walkToNpc(n) : null), id).catch(() => null);
      await walkToNpc(passerId);
      await page.waitForFunction(() => !window.__lcwWorld.getStats().interact.walking, null, { timeout: 60000 }).catch(() => {});
      await wait(1000);
      const pn = await approach(passerId, 2.4);
      const s0 = await stats();
      const passer = { id: passerId, dist: pn?.dist ?? null, near: s0?.interact?.near ?? null, prompt: s0?.interact?.prompt ?? null };
      if (touch) passer.talkButton = (await page.$('.lw-btn.talk.on')) !== null;
      const pv = await face(passerId);
      passer.faced = !!pv;
      const t0 = s0?.interact?.passerTaps ?? 0;
      if (pv) {
        if (touch) await page.touchscreen.tap(pv.sx, pv.sy);
        else await page.mouse.click(pv.sx, pv.sy);
      }
      await wait(1500);
      if (!touch) await page.keyboard.press('KeyE');
      await wait(1200);
      const s1 = await stats();
      passer.quietTaps = (s1?.interact?.passerTaps ?? 0) - t0;
      passer.dialogOpened = await dlgOpen();
      passer.stillFolded = (await page.$('[data-testid="lesson-reopen"]')) !== null;
      // null when the bot could not get the passer-by on screen: not checked, not a failure (review of #158)
      passer.ok = !passer.faced ? null : passer.near !== passerId && !passer.prompt && !passer.talkButton && passer.quietTaps >= 1 && !passer.dialogOpened && passer.stillFolded;
      lesson.passer = passer;
      await shot('80b-lesson-passer');
      if (passer.dialogOpened) await fold();
      await walkToNpc(lesson.npc);
      await page.waitForFunction(() => !window.__lcwWorld.getStats().interact.walking, null, { timeout: 60000 }).catch(() => {});
      await approach(lesson.npc, 2.4);
      // null when the bot could not get the lesson NPC on screen: not checked, not a failure (review 2 of #158)
      lesson.reopenByClick = await tryClick(lesson.npc);
      await shot('81-lesson-click');
      if (await fold()) {
        await approach(lesson.npc, 2.4);
        // the talk prompt must hold steady while the child stands by the lesson NPC (no flicker)
        const seq = [];
        for (let i = 0; i < 40; i++) {
          const x = await stats();
          const v = x?.npcView?.find((n) => n.id === lesson.npc);
          seq.push(`${x?.interact?.near === lesson.npc ? 'N' : '-'}${x?.interact?.prompt ? 'P' : '.' + (x?.interact?.promptWhy ?? '')}${v ? v.dist.toFixed(1) : 'x'}`);
          await wait(50);
        }
        lesson.promptOnShare = seq.filter((q) => q[1] === 'P').length / seq.length;
        lesson.promptSeq = seq.join(' ');
        const k = await tryKey(lesson.npc);
        lesson.reopenByKey = k.faced || k.ok ? k.ok : null;
        lesson.key = k;
      }
    }
    await call('POST', `/v1/admin/lessons/${lesson.id}/end`, {}, process.env.LCW_OPERATOR_TOKEN);
  }
  mark('lesson', lesson);
}
await shot('90-end');
const end = await stats();
const motion = end?.motion ?? {};
const errand = await call('GET', '/v1/errand', undefined, dev.device_token);
const repeats = [...lines.entries()].map(([id, ls]) => ({ id, visits: ls.length, distinct: new Set(ls).size }));
await Promise.allSettled(ttsJudging);
const report = {
  hud,
  faceMisses,
  look,
  dlgJudgedBy,
  npcSceneAtSpawn,
  view,
  size: `${W}x${H}`,
  kid: dev.kid ?? null,
  unwantedJumps: (motion.unpressedJumps ?? 0) + (motion.autoJump ? 0 : (motion.autoClimbs ?? 0)),
  motion,
  motionAtStart: m0,
  jumpView,
  clickSuccess: `${counts.clickOk}/${counts.clickTry}`,
  keySuccess: `${counts.keyOk}/${counts.keyTry}`,
  wrongNpc: counts.wrongNpc,
  goals: seenGoals,
  talks,
  repeats,
  quietAfterTalk: quiet,
  hill,
  lesson,
  errand: { status: errand.status, state: errand.body?.state ?? null },
  talked: end?.interact?.talked ?? [],
  errs: errs.slice(0, 20),
  httpFails: httpFails.slice(0, 20),
  ttsCacheMiss,
  seconds: Math.round((Date.now() - T0) / 1000)
};
writeFileSync(`${out}/real-play-${view}.json`, JSON.stringify(report, null, 1));
console.log(
  JSON.stringify({
    view,
    unwantedJumps: report.unwantedJumps,
    click: report.clickSuccess,
    key: report.keySuccess,
    wrongNpc: counts.wrongNpc,
    goals: seenGoals,
    errand: report.errand.state,
    camRise: jumpView.map((j) => `${j.camRise}/${j.bodyRise}`).join(' '),
    hill: hill.ran ? { bottom: hill.reachedBottom, top: hill.reachedTop, y: hill.topY, jumps: hill.pressedJumpsUp + hill.unwantedJumpsUp, tries: hill.tries } : 'skipped',
    passer: lesson.passer ? lesson.passer.ok : null,
    errs: errs.length,
    ttsCacheMiss
  })
);
await browser.close();
