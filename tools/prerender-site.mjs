// Writes static HTML for every public page into apps/web/dist (<path>.html) (docs/14 §11), plus sitemap.xml and robots.txt.
// Run after `vite build` (apps/web "build" script does both). The SSR bundle goes under node_modules, never into dist.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const web = join(root, 'apps/web');
const dist = join(web, 'dist');
// Inside apps/web/node_modules so the bundle resolves react from the web package (and stays out of git).
const ssrOut = join(web, 'node_modules/.lcw-site-ssr');

const viteBin = join(root, 'node_modules/vite/bin/vite.js');
execFileSync(process.execPath, [viteBin, 'build', '--ssr', 'src/site/prerender.tsx', '--outDir', ssrOut, '--emptyOutDir', '--logLevel', 'warn'], {
  cwd: web,
  stdio: 'inherit'
});
const mod = await import(pathToFileURL(join(ssrOut, 'prerender.js')).href);

const shell = readFileSync(join(dist, 'index.html'), 'utf8');
if (!shell.includes('<div id="root"></div>')) throw new Error('dist/index.html is not a fresh Vite shell (already pre-rendered?)');
const pages = mod.allPages();
for (const page of pages) {
  // `/parents` → parents.html: Workers static assets (html_handling auto-trailing-slash) serve it at /parents with no redirect.
  const file = page.path === '/' ? join(dist, 'index.html') : join(dist, `${page.path.slice(1)}.html`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, mod.fillShell(shell, page));
}
const origin = mod.SITE_ORIGIN;
writeFileSync(
  join(dist, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages
    .filter((p) => p.index)
    .map((p) => `  <url><loc>${origin}${p.path}</loc></url>`)
    .join('\n')}\n</urlset>\n`
);
// Lesson, family and game screens stay out of search; public pages are open. Report (/r/) and showroom (/s/) links are
// NOT disallowed: link previewers such as KakaoTalk honour robots.txt, and a blocked page previews as a bare link. They
// stay out of search through their own noindex (meta + X-Robots-Tag: apps/edge/src/report-page.ts, showroom-page.ts).
writeFileSync(join(dist, 'robots.txt'), mod.robotsTxt(origin));
console.log(`pre-rendered ${pages.length} pages into ${dist}`);
