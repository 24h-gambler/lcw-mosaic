// Browser voice probe (docs/04 4.8 브라우저 신경 음성): opens the dev-only /world/voice-probe.html headless and muted
// in a fresh profile, twice (first visit downloads the model into Cache Storage, the second must load it from there),
// and prints load time, bytes fetched from the network, first-line and per-line synthesis time, and the real-time
// factor, for each backend.
//
//   pnpm --filter @lcw/client dev --port 5199 &   (or any running client dev server)
//   PLAYWRIGHT_CORE=<path to playwright-core/index.mjs> node tools/browser-voice-probe.mjs [base] [out.json] [wasm,webgpu]
//
// PROBE_SPEAKERS=af_heart,am_michael and PROBE_WAV=<dir> write each line as WAV (pitch comparison with Aura-2).
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const base = process.argv[2] ?? 'http://127.0.0.1:5199/world/voice-probe.html';
const out = process.argv[3] ?? 'browser-voice.json';
const tiers = (process.argv[4] ?? 'wasm,webgpu').split(',');
const speakers = process.env.PROBE_SPEAKERS ?? 'af_heart';
const wavDir = process.env.PROBE_WAV ?? '';
const pw = process.env.PLAYWRIGHT_CORE ? await import(pathToFileURL(process.env.PLAYWRIGHT_CORE).href) : await import('playwright-core');
const chromium = pw.chromium ?? pw.default.chromium;

async function visit(userDir, tier) {
  const ctx = await chromium.launchPersistentContext(userDir, {
    channel: 'chrome',
    headless: true,
    args: ['--mute-audio', '--ignore-gpu-blocklist', '--enable-gpu', '--enable-unsafe-webgpu']
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  // Response bytes per host (content-length), page and worker. Cache Storage reads (the model and voices on a later
  // visit) make no request at all, so a second visit with no huggingface host is a cache hit; the ONNX runtime from
  // jsDelivr may still show here as an HTTP-cache hit (Playwright does not tell those apart).
  let netBytes = 0;
  const hosts = {};
  page.on('response', (r) => {
    try {
      const len = Number(r.headers()['content-length'] ?? 0);
      if (r.status() < 300) {
        const h = new URL(r.url()).host;
        hosts[h] = (hosts[h] ?? 0) + len;
        netBytes += len;
      }
    } catch {
      /* ignore */
    }
  });
  const errors = [];
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && errors.push(m.text().slice(0, 200)));
  const q = new URLSearchParams({ bvoice: tier, speakers });
  if (process.env.PROBE_DTYPE) q.set('bdtype', process.env.PROBE_DTYPE);
  if (wavDir) q.set('wav', '1');
  const t0 = Date.now();
  await page.goto(`${base}?${q}`);
  await page.waitForFunction(() => window.__probe?.done, null, { timeout: 600_000, polling: 500 });
  const res = await page.evaluate(() => window.__probe);
  const wallMs = Date.now() - t0;
  const gpu = await page.evaluate(async () => {
    try {
      const a = await navigator.gpu?.requestAdapter();
      return a ? { vendor: a.info?.vendor, arch: a.info?.architecture, fallback: a.info?.isFallbackAdapter ?? null } : null;
    } catch {
      return null;
    }
  });
  await ctx.close();
  if (wavDir && res.wavs) {
    mkdirSync(wavDir, { recursive: true });
    for (const [k, v] of Object.entries(res.wavs)) {
      const [sp, text] = k.split('|');
      const slug = text.replace(/[^a-z]+/gi, '_').slice(0, 24);
      writeFileSync(path.join(wavDir, `${sp}-${slug}.wav`), Buffer.from(v, 'base64'));
    }
    delete res.wavs;
  }
  return { wallMs, netBytes, hosts, gpu, errors: errors.slice(0, 10), ...res };
}

const report = {};
for (const tier of tiers) {
  const dir = mkdtempSync(path.join(process.env.PROBE_TMP ?? tmpdir(), `bvoice-${tier}-`));
  const first = await visit(dir, tier);
  const second = await visit(dir, tier);
  report[tier] = { first, second };
  console.log(tier, JSON.stringify({ first: { ...first, lines: first.lines?.length }, second: { ...second, lines: second.lines } }, null, 1));
}
writeFileSync(out, JSON.stringify(report, null, 1));
