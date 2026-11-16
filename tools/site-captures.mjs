// Real /world captures for the public site (docs/14 §10.3 "실제 플레이 화면만"): page stills, 1200×630 share pictures
// and the short clips, all taken from the running game. Re-run it whenever the world changes; it rewrites
//   apps/web/public/media/*   page stills (.webp, content-hashed names) and clips (.mp4 + poster)
//   apps/web/public/og/*.jpg  share pictures (stable names: KakaoTalk and search cache them by URL)
//   apps/web/src/site/media.ts the manifest the pages import (sizes, caption times)
//
//   PLAYWRIGHT_CORE=<path to playwright-core/index.mjs> node tools/site-captures.mjs [base] [rawDir]
//
// base defaults to production. Needs Chrome and ffmpeg (libx264 + libwebp). Headless, muted, GPU (set SWIFTSHADER=1 on
// machines without one). Nothing is invented on screen: the only stand-in is the microphone — a demo recogniser types
// the ★★★ sentence the way the browser recogniser would (no child voice is ever used, docs/14 §10.3), and the site
// labels these pictures as a demonstration.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const base = (process.argv[2] ?? 'https://lcw.worldwidesomething.com').replace(/\/$/, '');
const raw = process.argv[3] ?? join(root, 'node_modules/.lcw-site-captures', String(Date.now()));
const pub = join(root, 'apps/web/public');
mkdirSync(raw, { recursive: true });
const pw = process.env.PLAYWRIGHT_CORE ? await import(pathToFileURL(process.env.PLAYWRIGHT_CORE).href) : await import('playwright-core');
const chromium = pw.chromium ?? pw.default.chromium;

/** Browser recogniser stand-in: interim words one by one, then the final sentence (same events Chrome fires). */
const DEMO_RECOGNISER = `(() => {
  class DemoRec {
    constructor() { this.lang = 'en-US'; this.continuous = true; this.interimResults = true; this.maxAlternatives = 1; this._t = []; }
    start() {
      const text = String(window.__lcwDemoSay || 'Hello.');
      const words = text.split(' ');
      const at = (ms, f) => this._t.push(setTimeout(f, ms));
      at(150, () => { this.onaudiostart && this.onaudiostart({}); this.onstart && this.onstart({}); this.onspeechstart && this.onspeechstart({}); });
      words.forEach((_, i) => at(450 + i * 330, () => {
        const r = [{ transcript: words.slice(0, i + 1).join(' '), confidence: 0.9 }]; r.isFinal = false;
        this.onresult && this.onresult({ resultIndex: 0, results: [r] });
      }));
      at(450 + words.length * 330 + 250, () => {
        const r = [{ transcript: text, confidence: 0.93 }]; r.isFinal = true;
        this.onresult && this.onresult({ resultIndex: 0, results: [r] });
        this.onspeechend && this.onspeechend({}); this.onend && this.onend({});
      });
    }
    stop() { setTimeout(() => this.onend && this.onend({}), 50); }
    abort() { this._t.forEach(clearTimeout); this.onend && this.onend({}); }
    addEventListener(k, f) { this['on' + k] = f; }
    removeEventListener() {}
  }
  window.SpeechRecognition = DemoRec; window.webkitSpeechRecognition = DemoRec;
})();`;

const gpuArgs = process.env.SWIFTSHADER ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'];
const browser = process.env.ENCODE_ONLY === '1' ? null : await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', ...gpuArgs] });

async function openGame(scene, w, h) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await ctx.addInitScript(DEMO_RECOGNISER);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.slice(0, 200)));
  page.on('console', (m) => m.type() === 'error' && errs.push(m.text().slice(0, 200)));
  await page.goto(`${base}/world/?scene=${scene}&tier=high`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => !!window.__lcwWorld, null, { timeout: 90000 });
  await page.waitForFunction(() => !document.body.innerText.includes('마을을 짓는 중'), null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2500);
  // a little further back than the default follow camera
  await page.mouse.move(w / 2, h / 3);
  await page.mouse.wheel(0, 700);
  await page.waitForTimeout(600);
  return { ctx, page, errs };
}

const STEPS = {
  async walk(page) {
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(600);
    await page.keyboard.up('KeyW');
    await page.waitForTimeout(300);
  },
  async talk(page) {
    await page.keyboard.press('KeyE');
    await page.getByRole('button', { name: /눌러서 말하기/ }).first().waitFor({ timeout: 10000 });
    await page.waitForTimeout(1600);
  },
  async speak3(page) {
    const sentence = (await page.evaluate(() => {
      const el = [...document.querySelectorAll('*')].find((e) => e.children.length < 4 && /^★★★/.test((e.textContent ?? '').trim()));
      return (el?.textContent ?? '').replace(/^★+/, '').replace(/🔊/g, '').trim();
    })) || '';
    if (!sentence) throw new Error('no ★★★ sentence on screen');
    await page.getByText(sentence, { exact: false }).first().click();
    await page.evaluate((s) => { window.__lcwDemoSay = s; }, sentence);
    await page.getByRole('button', { name: /눌러서 말하기/ }).first().click();
    await page.getByText('별 3개').first().waitFor({ timeout: 15000 });
    await page.waitForTimeout(900);
    // [좋아요] plays the world's own star burst and the HUD chip counts up 1.3 s later
    await page.getByRole('button', { name: /좋아요/ }).first().click();
    await page.waitForTimeout(1500);

  }
};

/** Page stills (1200×900) and share pictures (1200×630) from one setup each. */
const STILLS = [
  { key: 'cafe-front', scene: 'honey_cafe', steps: [] },
  { key: 'cafe-offers', scene: 'honey_cafe', steps: ['walk', 'talk'] },
  { key: 'cafe-stars', scene: 'honey_cafe', steps: ['walk', 'talk', 'speak3'] },
  { key: 'trade-offers', scene: 'trade_shop', steps: ['walk', 'talk'] },
  { key: 'build-plot', scene: 'build_plot', steps: [] },
  { key: 'guide-offers', scene: 'build_plot', steps: ['walk', 'talk'] },
  { key: 'plaza', scene: 'plaza', steps: [] }
];
/** Share picture per page group (apps/web/src/site/routes.ts SHARE_IMAGES) → which still it is cut from. */
const OG_FROM = {
  home: 'cafe-front',
  parents: 'cafe-stars',
  play: 'plaza',
  try: 'cafe-offers',
  tutoring: 'guide-offers',
  'learn-cafe': 'cafe-offers',
  'learn-trade': 'trade-offers',
  'learn-build': 'build-plot',
  showroom: 'build-plot'
};

const encodeOnly = process.env.ENCODE_ONLY === '1';
const report = encodeOnly ? JSON.parse(readFileSync(join(raw, 'capture.json'), 'utf8')) : { base, stills: {}, clips: {}, errors: [] };
for (const s of encodeOnly ? [] : STILLS) {
  const { ctx, page, errs } = await openGame(s.scene, 1200, 900);
  try {
    for (const step of s.steps) await STEPS[step](page);
    await page.screenshot({ path: join(raw, `${s.key}.png`) });
    await page.setViewportSize({ width: 1200, height: 630 });
    await page.waitForTimeout(900);
    await page.screenshot({ path: join(raw, `${s.key}-og.png`) });
    report.stills[s.key] = 'ok';
  } catch (e) {
    report.stills[s.key] = `failed: ${e.message}`;
  }
  report.errors.push(...errs.map((x) => `${s.key}: ${x}`));
  await ctx.close();
}

/** CDP screencast → JPEG frames with timestamps; marks are seconds from the first frame. */
async function record(page, dir, script) {
  mkdirSync(dir, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  const marks = {};
  cdp.on('Page.screencastFrame', (f) => {
    const name = `f${String(frames.length).padStart(5, '0')}.jpg`;
    writeFileSync(join(dir, name), Buffer.from(f.data, 'base64'));
    frames.push({ name, ts: f.metadata.timestamp });
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 95, everyNthFrame: 1 });
  const wall = {};
  await script((label) => { wall[label] = Date.now() / 1000; });
  await cdp.send('Page.stopScreencast');
  await page.waitForTimeout(300);
  const first = frames[0].ts;
  for (const [k, v] of Object.entries(wall)) marks[k] = +(v - first).toFixed(2);
  const lines = [];
  frames.forEach((f, i) => lines.push(`file '${f.name}'`, `duration ${((frames[i + 1]?.ts ?? f.ts + 1 / 30) - f.ts).toFixed(4)}`));
  lines.push(`file '${frames.at(-1).name}'`);
  writeFileSync(join(dir, 'list.txt'), lines.join('\n'));
  return { marks, seconds: +(frames.at(-1).ts - first).toFixed(2), frames: frames.length };
}

const CLIPS = {
  /** Landing (docs/14 §3): the cafe owner asks, three sentences open, the ★★★ one is said, three stars. */
  'hero-cafe': async (page, mark) => {
    await page.waitForTimeout(900);
    mark('approach');
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(650);
    await page.keyboard.up('KeyW');
    await page.evaluate(() => window.__lcwWorld.npcSay('cafe_owner', 'Welcome to the honey cafe!'));
    await page.waitForTimeout(1700);
    mark('offers');
    await page.keyboard.press('KeyE');
    await page.getByRole('button', { name: /눌러서 말하기/ }).first().waitFor({ timeout: 10000 });
    await page.waitForTimeout(1500);
    const sentence = await page.evaluate(() => {
      const el = [...document.querySelectorAll('*')].find((e) => e.children.length < 4 && /^★★★/.test((e.textContent ?? '').trim()));
      return (el?.textContent ?? '').replace(/^★+/, '').replace(/🔊/g, '').trim();
    });
    await page.getByText(sentence).first().click();
    await page.waitForTimeout(700);
    await page.evaluate((s) => { window.__lcwDemoSay = s; }, sentence);
    mark('speak');
    await page.getByRole('button', { name: /눌러서 말하기/ }).first().click();
    await page.getByText('별 3개').first().waitFor({ timeout: 15000 });
    mark('stars');
    await page.waitForTimeout(1600);
    await page.getByRole('button', { name: /좋아요/ }).first().click();
    await page.waitForTimeout(2300);
    mark('end');
  },
  /** Player page: a walk from the plaza through the gate to the honey cafe (the world's own auto-walk). */
  'tour-town': async (page, mark) => {
    await page.waitForTimeout(1200);
    mark('plaza');
    const go = page.evaluate(() => window.__lcwWorld.goToScene('honey_cafe'));
    await page.waitForTimeout(3500);
    mark('street');
    await go;
    mark('cafe');
    await page.waitForTimeout(1500);
    mark('end');
  }
};
const CLIP_SCENE = { 'hero-cafe': 'honey_cafe', 'tour-town': 'plaza' };
for (const [key, script] of encodeOnly ? [] : Object.entries(CLIPS)) {
  const { ctx, page, errs } = await openGame(CLIP_SCENE[key], 1200, 900);
  try {
    report.clips[key] = await record(page, join(raw, key), (mark) => script(page, mark));
  } catch (e) {
    report.clips[key] = { failed: e.message };
  }
  report.errors.push(...errs.map((x) => `${key}: ${x}`));
  await ctx.close();
}
await browser?.close();
// Saved before encoding so a failed encode resumes with ENCODE_ONLY=1 instead of capturing again.
if (!encodeOnly) writeFileSync(join(raw, 'capture.json'), JSON.stringify(report, null, 2));

// A half-filled manifest would drop pictures from the pages: stop here and leave the repo as it was.
const failed = [...Object.entries(report.stills).filter(([, v]) => v !== 'ok'), ...Object.entries(report.clips).filter(([, v]) => v.failed)];
if (failed.length > 0) {
  writeFileSync(join(raw, 'report.json'), JSON.stringify(report, null, 2));
  console.error(JSON.stringify({ raw, failed }, null, 1));
  process.exit(1);
}

// ---------- encode ----------
// cwd: the concat demuxer resolves frame names against the working directory when the list path uses backslashes.
const ff = (args, cwd) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], cwd ? { cwd } : {});
const hash8 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 8);
mkdirSync(join(pub, 'media'), { recursive: true });
mkdirSync(join(pub, 'og'), { recursive: true });
// Hashed names: keep one copy per name; old ones are moved aside by the caller's git diff, not deleted here.
function hashed(tmp, stem, ext) {
  const name = `${stem}.${hash8(tmp)}.${ext}`;
  renameSync(tmp, join(pub, 'media', name));
  return `/media/${name}`;
}
const manifest = { stills: {}, clips: {} };
for (const s of STILLS) {
  if (report.stills[s.key] !== 'ok') continue;
  const src = join(raw, `${s.key}.png`);
  const out = {};
  for (const w of [960, 480]) {
    const tmp = join(raw, `${s.key}-${w}.webp`);
    ff(['-i', src, '-vf', `scale=${w}:-2:flags=lanczos`, '-c:v', 'libwebp', '-quality', '78', '-compression_level', '6', tmp]);
    out[w] = hashed(tmp, `${s.key}-${w}`, 'webp');
  }
  manifest.stills[s.key] = { src: out[960], src480: out[480], width: 960, height: 720 };
}
for (const [og, from] of Object.entries(OG_FROM)) {
  if (report.stills[from] !== 'ok') continue;
  ff(['-i', join(raw, `${from}-og.png`), '-vf', 'scale=1200:630:flags=lanczos', '-q:v', '4', join(pub, 'og', `${og}.jpg`)]);
}
for (const [key, r] of Object.entries(report.clips)) {
  if (r.failed) continue;
  const dir = join(raw, key);
  const to = String(r.marks.end ?? r.seconds);
  const tmp = join(raw, `${key}.mp4`);
  // docs/14 §11: a 15 s loop stays under 1.5 MB → about 100 KB per second; raise CRF until the clip fits.
  const budget = Math.round(+to * 100 * 1024);
  for (let crf = 28; crf <= 40; crf += 2) {
    ff(['-f', 'concat', '-safe', '0', '-i', 'list.txt', '-to', to, '-vf', 'fps=30,scale=960:-2:flags=lanczos', '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-profile:v', 'high', tmp], dir);
    if (readFileSync(tmp).length <= budget) break;
  }
  // poster: the frame that tells the most without motion (three sentences / arriving), else the first frame
  const at = key === 'hero-cafe' ? (r.marks.offers ?? 0) + 1.8 : 0.2;
  const ptmp = join(raw, `${key}-poster.webp`);
  ff(['-ss', String(at), '-i', tmp, '-frames:v', '1', '-c:v', 'libwebp', '-quality', '78', ptmp]);
  manifest.clips[key] = { src: hashed(tmp, key, 'mp4'), poster: hashed(ptmp, `${key}-poster`, 'webp'), width: 960, height: 720, seconds: +to, marks: r.marks };
}

// Files from earlier runs that the new manifest no longer names move out of the repo (into the raw folder), never deleted.
const keep = new Set([...Object.values(manifest.stills).flatMap((v) => [v.src, v.src480]), ...Object.values(manifest.clips).flatMap((v) => [v.src, v.poster])].map((p) => p.replace('/media/', '')));
mkdirSync(join(raw, 'stale'), { recursive: true });
for (const f of readdirSync(join(pub, 'media'))) if (!keep.has(f)) renameSync(join(pub, 'media', f), join(raw, 'stale', f));

const ts = `// Generated by tools/site-captures.mjs from the real /world (${base}). Do not edit by hand; re-run the tool.
/* eslint-disable */
export interface SiteStill { src: string; src480: string; width: number; height: number }
export interface SiteClip { src: string; poster: string; width: number; height: number; seconds: number; marks: Readonly<Record<string, number>> }

export const SITE_STILLS = ${JSON.stringify(manifest.stills, null, 2)} as const satisfies Readonly<Record<string, SiteStill>>;

export const SITE_CLIPS = ${JSON.stringify(manifest.clips, null, 2)} as const satisfies Readonly<Record<string, SiteClip>>;

export type SiteStillKey = keyof typeof SITE_STILLS;
export type SiteClipKey = keyof typeof SITE_CLIPS;
`;
writeFileSync(join(root, 'apps/web/src/site/media.ts'), ts);
writeFileSync(join(raw, 'report.json'), JSON.stringify(report, null, 2));
const kb = (p) => Math.round(readFileSync(p).length / 1024);
console.log(JSON.stringify({ raw, stills: report.stills, clips: Object.fromEntries(Object.entries(manifest.clips).map(([k, v]) => [k, { ...v, kb: kb(join(pub, v.src)) }])), og: readdirSync(join(pub, 'og')), errors: report.errors }, null, 1));
