// KakaoTalk in-app ladder check (docs/19 입력 사다리): a phone-size headless Chrome with the KAKAOTALK user agent and
// no browser SpeechRecognition (like the in-app web view) plays a linked child's first visit by voice only:
// the "Hello!" mic check, the neighbour Mia's errand at the honey cafe door, the cafe order and the hand-over. The microphone is a WebAudio stream of
// synthetic WAV clips (one per turn); MediaRecorder, /v1/converse/stt (Workers AI) and scoring are the real ones.
//
//   PLAYWRIGHT_CORE=<path to playwright-core/index.mjs> node tools/kakao-ladder.mjs <base> dev.json <clips dir> <out dir>
//
// clips dir: hello.wav, accept.wav, order.wav, deliver.wav (speech after ~0.7 s, then ~3 s of silence).
// dev.json = {"device_token": "..."} of a smoke- child (never commit it). Calls real Workers AI (a few neurons).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const pw = process.env.PLAYWRIGHT_CORE ? await import(pathToFileURL(process.env.PLAYWRIGHT_CORE).href) : await import('playwright-core');
const chromium = pw.chromium ?? pw.default.chromium;
const [base, devFile, clips, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const dev = JSON.parse(readFileSync(devFile, 'utf8'));
const UA =
  'Mozilla/5.0 (Linux; Android 14; SM-S918N Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.6668.100 Mobile Safari/537.36 KAKAOTALK/25.8.2 (INAPP)';
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
});
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: UA, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
await ctx.route('**/__clip/*', (route) => {
  const name = new URL(route.request().url()).pathname.split('/').pop();
  route.fulfill({ status: 200, contentType: 'audio/wav', body: readFileSync(`${clips}/${name}.wav`) });
});
await ctx.addInitScript(([t]) => {
  localStorage.setItem('lcw.deviceToken', t);
  localStorage.setItem('lcw.deviceNickname', 'Juno');
  delete window.SpeechRecognition;
  delete window.webkitSpeechRecognition;
  // The microphone: each getUserMedia plays the clip named in window.__clip into a MediaStream.
  window.__clip = 'hello';
  window.__gum = 0;
  navigator.mediaDevices.getUserMedia = async () => {
    window.__gum += 1;
    const ac = new AudioContext();
    const buf = await (await fetch(`/__clip/${window.__clip}`)).arrayBuffer();
    const audio = await ac.decodeAudioData(buf);
    const src = ac.createBufferSource();
    src.buffer = audio;
    const dest = ac.createMediaStreamDestination();
    src.connect(dest);
    // the clip starts once the recorder runs (a busy machine can start MediaRecorder after a clip that began at once)
    window.__pendingClip = src;
    setTimeout(() => window.__pendingClip === src && (window.__pendingClip = null, src.start()), 4000);
    return dest.stream;
  };
  const start = MediaRecorder.prototype.start;
  MediaRecorder.prototype.start = function (...a) {
    const r = start.apply(this, a);
    const src = window.__pendingClip;
    window.__pendingClip = null;
    if (src) setTimeout(() => src.start(), 200);
    return r;
  };
}, [dev.device_token]);
const page = await ctx.newPage();
const errs = [];
const stt = [];
const scores = [];
page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 200)));
page.on('response', async (r) => {
  const u = r.url();
  if (u.includes('/v1/converse/stt')) stt.push({ status: r.status(), body: await r.json().catch(() => null) });
  if (u.includes('/v1/converse/score')) {
    const b = await r.json().catch(() => null);
    scores.push({ status: r.status(), pass: b?.pass, stars: b?.stars, stt_source: JSON.parse(r.request().postData() ?? '{}').stt_source, errand: b?.errand ?? null });
  }
});
const steps = [];
const T0 = Date.now();
const mark = (name, extra = {}) => {
  const s = { name, t: Math.round((Date.now() - T0) / 100) / 10, ...extra };
  steps.push(s);
  console.log(JSON.stringify(s));
};
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });

await page.goto(`${base}/world/`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.__lcwWorld, null, { timeout: 180000 });
await page.waitForFunction(() => !document.body.innerText.includes('마을을 짓는 중'), null, { timeout: 180000 }).catch(() => {});
mark('spawn', { ua_kakao: await page.evaluate(() => /KAKAOTALK/.test(navigator.userAgent)), browser_sr: await page.evaluate(() => 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window) });

// 1. first-visit mic check through the server rung
await page.waitForSelector('.lcw-firstvisit', { timeout: 30000 });
await page.evaluate(() => (window.__clip = 'hello'));
await page.click('.lcw-firstvisit-mic');
await page.waitForTimeout(1500);
await page.waitForFunction(
  () => (document.querySelector('.lcw-firstvisit [aria-live]')?.textContent ?? '').trim() !== '' && document.querySelector('.lcw-firstvisit-mic')?.getAttribute('data-on') !== 'true',
  null,
  { timeout: 40000 }
).catch(() => {});
await page.waitForTimeout(500);
const micNote = await page.$eval('.lcw-firstvisit', (d) => d.innerText.split('\n').slice(-4).join(' | '));
await shot('80-kakao-miccheck');
mark('mic_check', { note: micNote });
await page.click('.lcw-firstvisit-go');
await page.waitForTimeout(800);

// Talk to the NPC whose name matches: a dialog with someone else is closed (nothing bought) and the walk goes on.
// TALK_BY=E presses E instead of tapping the "말 걸기" button.
const TALK_BY = process.env.TALK_BY ?? 'tap';
// Reports how it got there: the first press (the "말 걸기" tap when shown, else E), who opened, wrong NPCs, steps.
async function talk(name, move = true) {
  const r = { ok: false, presses: [], wrong: [], steps: 0 };
  for (let i = 0; i < 12; i++) {
    if (await page.$('.lcw-dlg')) {
      const who = await page.$eval('.lcw-dlg', (d) => d.innerText.split(/\n/).slice(0, 2).join(' '));
      r.presses[r.presses.length - 1].opened = who.replace(/\s+/g, ' ').slice(0, 40);
      if (name.test(who)) return { ...r, ok: true, first_try: r.presses.length === 1 && r.wrong.length === 0 };
      r.wrong.push(who.slice(0, 30));
      await page.click('.lcw-dlg__x').catch(() => page.keyboard.press('Escape'));
      await page.waitForTimeout(700);
    }
    // the world's touch "말 걸기" button (hud .lw-btn.talk, shown with .on when an NPC is in reach)
    const tap = TALK_BY !== 'E' && (await page.$('.lw-btn.talk.on')) !== null;
    r.presses.push({ by: tap ? 'tap' : 'E' });
    if (tap) await page.tap('.lw-btn.talk.on', { timeout: 1500 }).catch(() => {});
    else await page.keyboard.press('KeyE');
    await page.waitForTimeout(700);
    if (await page.$('.lcw-dlg') || !move) continue;
    r.steps += 1;
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(180);
    await page.keyboard.up('KeyW');
    await page.waitForTimeout(300);
  }
  return r;
}
// Mia's spot at the honey cafe door (apps/client/src/world/town.ts errand_neighbor).
const MINA_SPOT = { x: 161, z: 139 };
const pos = () => page.evaluate(() => window.__lcwWorld.getStats?.().player ?? null);
async function hold(key, ms) {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
  await page.waitForTimeout(150);
}
// A world without walkToNpc stops at the counter: walk up to the spot like a child would (learn which key moves
// where from the measured position, then step towards it).
async function approach(tx, tz, within = 2.4) {
  let dirs = null;
  for (let i = 0; i < 40; i++) {
    const p = await pos();
    if (!p) return null;
    const dx = tx - p.x;
    const dz = tz - p.z;
    const d = Math.hypot(dx, dz);
    if (d < within) return Math.round(d * 10) / 10;
    if (!dirs || i % 8 === 0) {
      dirs = {};
      for (const k of ['KeyW', 'KeyD', 'KeyS', 'KeyA']) {
        const a = await pos();
        await hold(k, 250);
        const b = await pos();
        dirs[k] = [b.x - a.x, b.z - a.z];
      }
      continue;
    }
    let best = 'KeyW';
    let bv = -Infinity;
    for (const [k, [vx, vz]] of Object.entries(dirs)) {
      const v = (vx * dx + vz * dz) / (Math.hypot(vx, vz) || 1);
      if (v > bv) [bv, best] = [v, k];
    }
    await hold(best, Math.min(400, 120 + d * 60));
  }
  const p = await pos();
  return p ? Math.round(Math.hypot(tx - p.x, tz - p.z) * 10) / 10 : null;
}
async function walk() {
  await page.waitForSelector('.lcw-errand-walk', { timeout: 15000 });
  const label = await page.$eval('.lcw-errand-walk', (b) => b.innerText);
  await page.click('.lcw-errand-walk');
  await page.waitForFunction(() => window.__lcwWorld.getScene?.() === 'honey_cafe', null, { timeout: 60000 });
  // the walk is over when the player stops (a same-scene walk can take a long way round)
  const t0 = Date.now();
  let last = await pos();
  let still = 0;
  while (Date.now() - t0 < 30000 && still < 3) {
    await page.waitForTimeout(400);
    const p = await pos();
    still = p && last && Math.hypot(p.x - last.x, p.z - last.z) < 0.05 ? still + 1 : 0;
    last = p;
  }
  const walkMs = Date.now() - t0;
  const toMina = /미아/.test(label);
  const byWorld = await page.evaluate(() => typeof window.__lcwWorld.walkToNpc === 'function');
  const left = toMina && !byWorld ? await approach(MINA_SPOT.x, MINA_SPOT.z) : null;
  return { label, walkToNpc: byWorld, walk_s: Math.round(walkMs / 100) / 10, approach_left_m: left };
}
// TAP=1: the child taps the sentence first; default: just speaks one of the sentences on screen (voice picks it).
const TAP = process.env.TAP === '1';
async function speak(clip, label, text) {
  await page.evaluate((c) => (window.__clip = c), clip);
  const issue = await page.$eval('.lcw-dlg', (d) => d.innerText.includes('카카오톡') || d.innerText.includes('다른 브라우저'));
  const offers = await page.$$eval('.lcw-dlg [aria-pressed]', (bs) => bs.map((x) => ({ text: x.innerText.replace(/\s+/g, ' ').trim(), on: x.getAttribute('aria-pressed') === 'true' })));
  if (TAP) await page.locator('.lcw-dlg [aria-pressed]', { hasText: text }).first().click({ timeout: 3000 }).catch(() => {});
  await page.click('.lcw-mic');
  await page.waitForTimeout(1500);
  await shot(`${label}-listening`);
  await page.waitForSelector('.lcw-res__fb', { timeout: 40000 });
  await page.waitForTimeout(500);
  const res = await page.$eval('.lcw-res', (r) => r.innerText.replace(/\s+/g, ' ').slice(0, 140));
  await shot(`${label}-result`);
  await page.click('.lcw-res .lcw-cta--go', { timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(900);
  return { said: text, offers, res, kakaoNotice: issue, closed: !(await page.$('.lcw-dlg')) };
}

mark('to_mina', { walk: await walk() });
mark('mina_open', await talk(/미아|Mia/, false));
mark('accept', await speak('accept', '81-kakao-accept', 'Yes, I can help you.'));
mark('to_cafe', { walk: await walk() });
mark('hani_open', await talk(/해나|Hannah/));
mark('first_order', await speak('order', '82-kakao-order', 'Cold water, please.'));
mark('back_to_mina', { walk: await walk() });
mark('mina2_open', await talk(/미아|Mia/, false));
mark('deliver', await speak('deliver', '83-kakao-deliver', 'Here is your cold water. Enjoy!'));
await page.waitForSelector('.lcw-errand-toast', { timeout: 6000 }).catch(() => {});
await shot('84-kakao-reward');
mark('reward', { toast: await page.$eval('.lcw-errand-toast', (t) => t.innerText).catch(() => null) });

const report = { base, ua: UA, tap: TAP, talk_by: TALK_BY, steps, stt, scores, mic_opens: await page.evaluate(() => window.__gum), errs };
writeFileSync(`${out}/kakao-report.json`, JSON.stringify(report, null, 1));
console.log(JSON.stringify({ stt: stt.map((s) => [s.status, s.body?.transcript]), scores, errs }));
await browser.close();
