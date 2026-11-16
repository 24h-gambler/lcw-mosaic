// Before/after pictures of the town's look (R2627): the market street, a store front, inside a store and the plaza at
// night, at 390 (phone) and 1440 (PC) wide, every tier, with draw calls, triangles and frame time for each picture.
// Headless only, audio muted. The poses go through WorldHandle.debugPose, so the same spot and view come out of every
// build that has it.
//
//   PLAYWRIGHT_CORE=<path to playwright-core/index.mjs> node tools/visual-shots.mjs <base /world/ url> <out dir> [gpu] [tiers]
//
// `gpu` renders on the machine's GPU (ANGLE default) instead of SwiftShader; `tiers` is a comma list (default low,mid,high).
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const base = process.argv[2] ?? 'http://127.0.0.1:8915/world/';
const out = process.argv[3] ?? 'shots/visual';
const gpu = process.argv[4] === 'gpu';
const tiers = (process.argv[5] ?? 'low,mid,high').split(',');
const only = process.env.SHOTS_ONLY ?? '';
mkdirSync(out, { recursive: true });
const pw = process.env.PLAYWRIGHT_CORE ? await import(pathToFileURL(process.env.PLAYWRIGHT_CORE).href) : await import('playwright-core');
const chromium = pw.chromium ?? pw.default.chromium;
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--mute-audio', '--ignore-gpu-blocklist', ...(gpu ? ['--enable-gpu'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'])]
});

const H = Math.PI / 2;
/** yaw: facing (sin yaw, 0, cos yaw); first-person pitch 0.3 looks level, more looks down. */
export const POSES = [
  { id: 'market-street', x: 136.5, z: 143.5, yaw: -H, pitch: 0.36, hour: 10.5 },
  { id: 'shop-front', x: 130.5, z: 134.5, yaw: -H, pitch: 0.2, hour: 10.5 },
  { id: 'cafe-front', x: 157.5, z: 136.5, yaw: H, pitch: 0.2, hour: 10.5 },
  { id: 'cafe-inside', x: 168.5, z: 138.2, yaw: H + 0.5, pitch: 0.32, hour: 10.5 },
  { id: 'shop-inside', x: 119.5, z: 131.5, yaw: -H - 0.6, pitch: 0.32, hour: 10.5 },
  { id: 'plaza-night', x: 144.5, z: 157.5, yaw: Math.PI, pitch: 0.26, hour: 21.5 }
];
const VIEWPORTS = [
  { name: '390', width: 390, height: 844, touch: true },
  { name: '1440', width: 1440, height: 900, touch: false }
];

const report = [];
for (const vp of VIEWPORTS) {
  for (const tier of tiers) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1, hasTouch: vp.touch, isMobile: vp.touch });
    const page = await ctx.newPage();
    const errs = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errs.push(m.text().slice(0, 300));
    });
    page.on('pageerror', (e) => errs.push(`pageerror: ${String(e.message).slice(0, 300)}`));
    await page.goto(`${base}?tier=${tier}&fps=1&scene=plaza`, { waitUntil: 'load', timeout: 90000 });
    await page.waitForFunction(() => !!window.__lcwWorld, null, { timeout: 120000 });
    await page.waitForTimeout(2500);
    for (const pose of POSES) {
      if (only && !`${vp.name}:${tier}:${pose.id}`.includes(only)) continue;
      const ok = await page.evaluate((p) => {
        const w = window.__lcwWorld;
        if (!w.debugPose) return false;
        w.debugPose(p);
        return true;
      }, pose);
      if (!ok) {
        report.push({ viewport: vp.name, tier, pose: pose.id, error: 'no debugPose in this build' });
        continue;
      }
      // the ground around the new spot streams in; wait for it, then let the frame time settle
      await page.waitForFunction(() => (window.__lcwWorld.getStats().ground?.near ?? 0) === 0, null, { timeout: 30000 }).catch(() => undefined);
      await page.waitForTimeout(1800);
      const s = await page.evaluate(async () => {
        let frames = 0;
        let run = true;
        const t0 = performance.now();
        const tick = () => {
          frames++;
          if (run) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        await new Promise((r) => setTimeout(r, 2000));
        run = false;
        const st = window.__lcwWorld.getStats();
        return { fps: Math.round((frames * 1000) / (performance.now() - t0)), frameMs: st.frameMs, drawCalls: st.drawCalls, triangles: st.triangles, renderScale: st.renderScale, tier: st.tier };
      });
      const file = `${out}/${vp.name}-${tier}-${pose.id}.png`;
      await page.screenshot({ path: file });
      report.push({ viewport: vp.name, pose: pose.id, ...s, file });
    }
    report.push({ viewport: vp.name, tier, errors: errs });
    await ctx.close();
  }
}
await browser.close();
writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 1));
console.log(JSON.stringify(report.filter((r) => !r.errors || r.errors.length), null, 0));
