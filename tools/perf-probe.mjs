// Client performance probe (docs/08 6.6, docs/02 §11): the 3D world at four screen sizes, normal and with the CPU
// throttled 4x (a low-end tablet), headless and muted. Per run: time to the first screen and to complete ground,
// FPS over 8 s standing and 5 s walking, frame gaps while walking, long tasks, JS heap, draw calls, every console
// warning/error and failed request ("잔에러").
//
//   PLAYWRIGHT_CORE=<path to playwright-core/index.mjs> node tools/perf-probe.mjs https://lcw.worldwidesomething.com/game/ out.json [gpu]
//
// `gpu` uses the machine's GPU (ANGLE d3d11/default) instead of SwiftShader software GL.
// Headless Chrome paces frames at about 30 fps whatever the GPU (measured: a blank WebGL page draws 32 rAF/s on an
// RTX 3080). `PROBE_UNCAPPED=1` lifts that pace (--disable-gpu-vsync --disable-frame-rate-limit) to see the headroom;
// without it a 60 fps tier looks capped at 30, which is also how the governor's frame-cap path is checked.
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const base = process.argv[2] ?? 'http://127.0.0.1:8910/game/';
const out = process.argv[3] ?? 'perf.json';
const gpu = process.argv[4] === 'gpu';
const only = process.env.PROBE_ONLY ?? '';
const pw = process.env.PLAYWRIGHT_CORE ? await import(pathToFileURL(process.env.PLAYWRIGHT_CORE).href) : await import('playwright-core');
const chromium = pw.chromium ?? pw.default.chromium;
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--mute-audio', '--ignore-gpu-blocklist', '--enable-precise-memory-info', ...(gpu ? ['--enable-gpu'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']),
    ...(process.env.PROBE_UNCAPPED === '1' ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : [])]
});

const VIEWPORTS = [
  { name: '1440', width: 1440, height: 900, touch: false },
  { name: '1024', width: 1024, height: 768, touch: true },
  { name: '390', width: 390, height: 844, touch: true },
  { name: '844x390', width: 844, height: 390, touch: true }
];
const RUNS = [];
for (const vp of VIEWPORTS) for (const cpu of [1, 4]) RUNS.push({ vp, cpu, query: process.env.PROBE_QUERY ?? 'fps=1' });

const INIT = () => {
  window.__lt = { n: 0, total: 0, max: 0 };
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        window.__lt.n++;
        window.__lt.total += e.duration;
        window.__lt.max = Math.max(window.__lt.max, e.duration);
      }
    }).observe({ type: 'longtask', buffered: true });
  } catch {}
};

async function frames(page, ms) {
  return page.evaluate(async (ms) => {
    const gaps = [];
    let last = performance.now();
    let run = true;
    const tick = (t) => {
      gaps.push(t - last);
      last = t;
      if (run) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    await new Promise((r) => setTimeout(r, ms));
    run = false;
    gaps.shift();
    const s = [...gaps].sort((a, b) => a - b);
    const fps = gaps.length / (ms / 1000);
    return { fps: Math.round(fps * 10) / 10, p95: Math.round(s[Math.floor(s.length * 0.95)] ?? 0), max: Math.round(s[s.length - 1] ?? 0), over50: gaps.filter((g) => g > 50).length };
  }, ms);
}

const results = [];
for (const r of RUNS) {
  const key = `${r.vp.name}-cpu${r.cpu}`;
  if (only && !key.includes(only)) continue;
  const ctx = await browser.newContext({ viewport: { width: r.vp.width, height: r.vp.height }, deviceScaleFactor: 1, hasTouch: r.vp.touch, isMobile: r.vp.touch && r.vp.width < 900 });
  const page = await ctx.newPage();
  await page.addInitScript(INIT);
  const errs = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') errs.push(`${m.type()}: ${m.text().slice(0, 240)}`);
  });
  page.on('pageerror', (e) => errs.push(`pageerror: ${String(e.message).slice(0, 240)}`));
  page.on('response', (res) => {
    if (res.status() >= 400) errs.push(`http ${res.status()}: ${res.url()}`);
  });
  page.on('requestfailed', (q) => errs.push(`requestfailed: ${q.url()} ${q.failure()?.errorText ?? ''}`));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  if (r.cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: r.cpu });
  const t0 = Date.now();
  let row = { run: key, gpu };
  try {
    await page.goto(`${base}?${r.query}`, { waitUntil: 'load', timeout: 90000 });
    await page.waitForFunction(() => !!window.__lcwWorld, null, { timeout: 120000 });
    const worldMs = Date.now() - t0;
    await page.waitForFunction(() => (window.__lcwWorld.getStats?.().ground?.near ?? 1) === 0, null, { timeout: 120000 }).catch(() => undefined);
    const nearMs = Date.now() - t0;
    await page.waitForFunction(() => (window.__lcwWorld.getStats?.().ground?.view ?? 1) === 0, null, { timeout: 60000 }).catch(() => undefined);
    const viewMs = Date.now() - t0;
    const idle = await frames(page, 8000);
    await page.mouse.click(r.vp.width / 2, r.vp.height / 2).catch(() => undefined);
    await page.keyboard.down('KeyW');
    const walk = await frames(page, 5000);
    await page.keyboard.up('KeyW');
    const st = await page.evaluate(() => window.__lcwWorld.getStats());
    const lt = await page.evaluate(() => window.__lt);
    const m = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
    row = {
      ...row,
      world_ms: worldMs,
      ground_near_ms: nearMs,
      ground_view_ms: viewMs,
      fps_idle: idle.fps,
      fps_walk: walk.fps,
      walk_gap_p95: walk.p95,
      walk_gap_max: walk.max,
      walk_over50: walk.over50,
      idle_gap_max: idle.max,
      longtasks: lt.n,
      longtask_max: Math.round(lt.max),
      longtask_total: Math.round(lt.total),
      heap_mb: Math.round((m.JSHeapUsedSize ?? 0) / 1e5) / 10,
      tier: st.tier,
      autoTier: st.autoTier ?? null,
      scale: st.renderScale,
      draw: st.drawCalls,
      tris: st.triangles,
      chunks: st.chunksVisible,
      startup: st.startup,
      errors: errs
    };
  } catch (e) {
    row = { ...row, failed: String(e).slice(0, 300), errors: errs };
  }
  console.log(JSON.stringify(row));
  results.push(row);
  await ctx.close();
}
await browser.close();
writeFileSync(out, JSON.stringify(results, null, 2));
