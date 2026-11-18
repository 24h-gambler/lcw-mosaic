// HUD layout check (R2627 review): the minimap must not cover any button, card or chip of the world HUD or the app
// layer, on a phone (portrait and landscape), a tablet and a PC. Opens /world/ headless (audio muted), stands next to
// the guide so the talk button shows, and reports every visible element whose box meets the minimap's box.
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
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1, hasTouch: vp.touch, isMobile: vp.touch });
  const page = await ctx.newPage();
  await page.goto(`${base}?scene=plaza`, { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => !!window.__lcwWorld && (window.__lcwWorld.getStats().ground?.near ?? 1) === 0, null, { timeout: 180000 });
  await page.waitForTimeout(2500);
  const r = await page.evaluate(() => {
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
      const interactive = el.matches('button, a, [role="button"], input, .lw-card, .lw-stars, .lw-chip, .lw-goal, .lw-slot, .lw-hotbar');
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
    return { mini: [Math.round(m.left), Math.round(m.top), Math.round(m.width), Math.round(m.height)], hits };
  });
  await page.screenshot({ path: `${out}/${vp.name}.png` });
  results.push({ viewport: vp.name, ...r });
  if (r.error || r.hits.length) bad++;
  await ctx.close();
}
await browser.close();
writeFileSync(`${out}/report.json`, JSON.stringify(results, null, 1));
console.log(JSON.stringify(results));
process.exit(bad ? 1 : 0);
