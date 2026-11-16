// Server Whisper rung end to end in a real browser: headless Chrome with a fake microphone playing a synthetic
// "Cold water, please." WAV, browser SpeechRecognition removed (like an in-app browser), the built game on local
// wrangler (Workers AI binding is remote). The child taps the mic at the cafe owner's; MediaRecorder records Opus, the turn
// goes to /v1/converse/stt, the transcript is scored.
//
//   PLAYWRIGHT_CORE=<path to playwright-core/index.mjs> node tools/stt-shot.mjs http://127.0.0.1:8951 dev.json speech.wav shots/dialog [desktop|phone]
//
// dev.json = {"device_token": "..."} of a linked child (never commit it); speech.wav = a synthetic sentence with
// ~1 s silence before and several seconds after (Chrome loops the file). Calls real Workers AI (a few neurons).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const pw = process.env.PLAYWRIGHT_CORE ? await import(pathToFileURL(process.env.PLAYWRIGHT_CORE).href) : await import('playwright-core');
const chromium = pw.chromium ?? pw.default.chromium;
const [base, devFile, wav, out, view = 'desktop'] = process.argv.slice(2);
const dev = JSON.parse(readFileSync(devFile, 'utf8'));
const sizes = { desktop: [1280, 800], phone: [390, 844] };
const [width, height] = sizes[view];
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--mute-audio', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`]
});
const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: view !== 'desktop' });
await ctx.grantPermissions(['microphone'], { origin: base });
await ctx.addInitScript(([t]) => {
  localStorage.setItem('lcw.deviceToken', t);
  localStorage.setItem('lcw.deviceNickname', 'Juno');
  localStorage.setItem('lcw.firstVisitSeen', '1');
  delete window.SpeechRecognition;
  delete window.webkitSpeechRecognition;
}, [dev.device_token]);
const page = await ctx.newPage();
const errs = [];
const stt = [];
page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 200)));
page.on('response', async (r) => {
  if (r.url().includes('/v1/converse/stt')) {
    const req = r.request();
    stt.push({ status: r.status(), type: req.headers()['content-type'], audio_ms: req.headers()['x-lcw-audio-ms'], bytes: (req.postDataBuffer() ?? Buffer.alloc(0)).length, body: await r.json().catch(() => null) });
  }
});
await page.goto(`${base}/world/?scene=honey_cafe`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.__lcwWorld, null, { timeout: 180000 });
await page.waitForFunction(() => !document.body.innerText.includes('마을을 짓는 중'), null, { timeout: 180000 }).catch(() => {});
await page.waitForTimeout(2000);
for (let i = 0; i < 10 && !(await page.$('.lcw-dlg')); i++) {
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(500);
  if (await page.$('.lcw-dlg')) break;
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(180);
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(300);
}
await page.waitForSelector('.lcw-mic', { timeout: 20000 });
const engine = await page.evaluate(() => ({ sr: 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window, mr: typeof MediaRecorder }));
await page.click('.lcw-offer[data-s="2"]').catch(() => {});
await page.waitForTimeout(300);
const t0 = Date.now();
await page.click('.lcw-mic');
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/70-stt-recording-${view}.png` });
await page.waitForSelector('.lcw-res__fb', { timeout: 40000 }).catch(() => {});
const tRes = Date.now() - t0;
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/71-stt-result-${view}.png` });
const res = await page.$eval('.lcw-res', (r) => r.innerText.replace(/\s+/g, ' ').slice(0, 200)).catch(() => null);
const report = { view, engine, stt, result: res, mic_to_result_ms: tRes, errs };
writeFileSync(`${out}/stt-report-${view}.json`, JSON.stringify(report, null, 1));
console.log(JSON.stringify(report));
await browser.close();
