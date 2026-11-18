// HUD layout check (R2627 review): the minimap must not cover any button, card or chip of the world HUD or the app
// layer, on a phone (portrait and landscape), a tablet and a PC. Opens /world/ headless (audio muted) twice per screen:
// in the plaza next to the guide (the talk button shows) and on the build plot (the build tools show). The review dock
// needs a signed-in child with review signs, so its box is placed as ReviewDock.tsx places it (reviewDockTop: touch
// 228, mouse 60; right 12; width min(300, 100vw - 24); at least 120 high) and checked too.
//
//   PLAYWRIGHT_CORE=<path to playwright-core/index.mjs> node tools/hud-layout.mjs <base /world/ url> <out dir>
//
// Exit code 1 when anything overlaps.
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const base = process.argv[2] ?? 'http://127.0.0.1:8915/world/';
const out = process.argv[3] ?? 'shots/hud-layout';
mkdirSync(out, { recursive: true });
const pw = process.env.PLAYWRIGHT_CORE ? await import(pathToFileURL(process.env.PLAYWRIGHT_CORE).href) : await import('playwright-core');
const chromium = pw.chromium ?? pw.default.chromium;
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

const VIEWPORTS = [
  { name: 'phone-390x844', width: 390, height: 844, touch: true },
  { name: 'phone-844x390', width: 844, height: 390, touch: true },
  { name: 'tablet-768x1024', width: 768, height: 1024, touch: true },
  { name: 'pc-1440x900', width: 1440, height: 900, touch: false },
  { name: 'pc-1280x720', width: 1280, height: 720, touch: false }
];

const results = [];
let bad = 0;
for (const vp of VIEWPORTS) {
 for (const scene of ['plaza', 'build_plot']) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1, hasTouch: vp.touch, isMobile: vp.touch });
  const page = await ctx.newPage();
  await page.goto(`${base}?scene=${scene}`, { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => !!window.__lcwWorld && (window.__lcwWorld.getStats().ground?.near ?? 1) === 0, null, { timeout: 180000 });
  await page.waitForTimeout(2500);
  const r = await page.evaluate((touch) => {
    const mini = document.querySelector('.lw-mini');
    if (!mini) return { error: 'no minimap' };
    const m = mini.getBoundingClientRect();
    const hits = [];
    const seen = new Set();
    for (const el of document.querySelectorAll('body *')) {
      if (el === mini || mini.contains(el) || el.contains(mini)) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.05) continue;
      const b = el.getBoundingClientRect();
      if (b.width < 4 || b.height < 4) continue;
      // full-screen layers (canvas, touch layer, HUD root) are not things the minimap can cover
      if (b.width >= innerWidth * 0.9 && b.height >= innerHeight * 0.9) continue;
      const interactive = el.matches('button, a, [role="button"], [role="region"], input, .lw-btn, .lb-btn, .lb-tools, .lb-sync, .lcw-review-dock, .lw-card, .lw-stars, .lw-chip, .lw-goal, .lw-slot, .lw-hotbar');
      if (!interactive) continue;
      const ix = Math.min(b.right, m.right) - Math.max(b.left, m.left);
      const iy = Math.min(b.bottom, m.bottom) - Math.max(b.top, m.top);
      if (ix > 0 && iy > 0) {
        const name = `${el.tagName.toLowerCase()}.${String(el.className).split(' ').filter(Boolean).slice(0, 2).join('.')} "${(el.textContent ?? '').trim().slice(0, 24)}"`;
        if (seen.has(name)) continue;
        seen.add(name);
        hits.push({ el: name, overlap: [Math.round(ix), Math.round(iy)] });
      }
    }
    // the review dock's box (see the header)
    const dw = Math.min(300, innerWidth - 24);
    const d = { left: innerWidth - 12 - dw, right: innerWidth - 12, top: touch ? 228 : 60, bottom: (touch ? 228 : 60) + 120 };
    const dx = Math.min(d.right, m.right) - Math.max(d.left, m.left);
    const dy = Math.min(d.bottom, m.bottom) - Math.max(d.top, m.top);
    if (dx > 0 && dy > 0) hits.push({ el: 'review dock (placed)', overlap: [Math.round(dx), Math.round(dy)] });
    const build = !!document.querySelector('.lb-tools') && getComputedStyle(document.querySelector('.lb-tools')).display !== 'none';
    return { mini: [Math.round(m.left), Math.round(m.top), Math.round(m.width), Math.round(m.height)], build, hits };
  }, vp.touch);
  await page.screenshot({ path: `${out}/${vp.name}-${scene}.png` });
  results.push({ viewport: vp.name, scene, ...r });
  if (r.error || r.hits.length) bad++;
  await ctx.close();
 }
}
await browser.close();
writeFileSync(`${out}/report.json`, JSON.stringify(results, null, 1));
console.log(JSON.stringify(results));
process.exit(bad ? 1 : 0);
