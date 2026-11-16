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
//
//   PLAYWRIGHT_CORE=<playwright-core/index.mjs> node tools/real-play.mjs <base> <outDir> <pc|touch> [dev.json]
//
// dev.json = {"device_token": "..."} for a linked child. Without it, LCW_OPERATOR_TOKEN (env only, never printed or
// committed) makes a fresh test child through the admin routes; on production use smoke students only.
// Headless only, audio muted.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

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

async function call(method, p, body, token) {
  const r = await fetch(base + p, {
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
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 200)));
page.on('console', (m) => {
  if (m.type() === 'error') errs.push(m.text().slice(0, 200));
});
const T0 = Date.now();
const log = [];
const mark = (name, extra = {}) => {
  const s = { name, t: Math.round((Date.now() - T0) / 100) / 10, ...extra };
  log.push(s);
  console.log(JSON.stringify(s));
};
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
async function face(id) {
  for (let i = 0; i < 16; i++) {
    const s = await stats();
    const n = s?.npcView?.find((v) => v.id === id);
    if (n && n.vis && n.sx > 0 && n.sx < W && Math.abs(n.sx - W / 2) < W * 0.1) return n;
    // not on screen: about 50° to the right; on screen: the angle to it (dragging right turns the view right)
    const px = !n || !n.vis || n.sx < 0 || n.sx > W ? 0.9 / RAD_PER_PX : Math.atan((n.sx - W / 2) / FOCAL) / RAD_PER_PX;
    await turn(px);
  }
  const s = await stats();
  const n = s?.npcView?.find((v) => v.id === id);
  faceMiss = { id, view: n ? { vis: n.vis, sx: Math.round(n.sx), dist: n.dist } : null, walking: s?.interact?.walking ?? null, paused: s?.interact?.paused ?? null, dlg: await dlgOpen().catch(() => null) };
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
const rightNpc = async (id) => {
  const head = await dlgHead();
  return nameOf[id] ? nameOf[id].test(head) : head.length > 0;
};

let lastClick = null;
/** One talk opened by a click/tap on the NPC's body. */
async function tryClick(id) {
  const n = await face(id);
  if (!n) return false;
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
  await face(id);
  counts.keyTry++;
  const s = await stats();
  let button = null;
  if (touch) {
    const b = await page.$('.lw-btn.talk.on');
    if (b) {
      const box = await b.boundingBox().catch(() => null);
      button = box ? await page.evaluate(([x, y]) => (document.elementFromPoint(x, y)?.className ?? '').toString().slice(0, 40), [box.x + box.width / 2, box.y + box.height / 2]) : 'no box';
      await b.tap().catch(() => {});
    } else button = 'hidden';
  } else await page.keyboard.press('KeyE');
  await page.waitForSelector('.lcw-dlg', { timeout: 1500 }).catch(() => {});
  const ok = (await dlgOpen()) && (await rightNpc(id));
  if (ok) counts.keyOk++;
  else if (await dlgOpen()) {
    counts.wrongNpc++;
    await closeDlg();
  }
  return { ok, near: s?.interact?.near ?? null, goal: s?.interact?.goal ?? null, prompt: s?.interact?.prompt ?? null, why: s?.interact?.promptWhy, paused: s?.interact?.paused, walking: s?.interact?.walking, ...(touch ? { button } : {}) };
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
await page.waitForFunction(() => !!window.__lcwWorld, null, { timeout: 300000 });
await page.waitForFunction(() => (window.__lcwWorld.getStats?.()?.ground?.near ?? 1) === 0, null, { timeout: 120000 }).catch(() => {});
mark('spawn', { scene: (await stats())?.scene });
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
  if (!t.click) t.clickMiss = lastClick;
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
    const fold = async () => {
      await page.click('.lcw-dlg__x', { timeout: 3000 }).catch(() => {});
      return page.waitForSelector('[data-testid="lesson-reopen"]', { timeout: 5000 }).then(() => true).catch(() => false);
    };
    if (open && lesson.npc && (await fold())) {
      await approach(lesson.npc, 2.4);
      const c0 = counts.clickOk;
      await tryClick(lesson.npc);
      lesson.reopenByClick = counts.clickOk > c0;
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
        lesson.reopenByKey = k.ok;
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
const report = {
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
  lesson,
  errand: { status: errand.status, state: errand.body?.state ?? null },
  talked: end?.interact?.talked ?? [],
  errs: errs.slice(0, 20),
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
    errs: errs.length
  })
);
await browser.close();
