// The `_headers` file for the Worker's static assets (written by tools/build-site.mjs, checked by
// apps/edge/src/__tests__/site.test.ts).
//
// Why every HTML response says `no-transform`: the company zone has Cloudflare Web Analytics on, which injects
// static.cloudflareinsights.com/beacon.min.js into every proxied HTML page (/ and /world/ alike, seen in production
// 11-16). docs/14 §11 forbids third-party scripts on the site and on child screens, and Cloudflare leaves a response
// alone when its Cache-Control carries `no-transform`. The zone switch itself is outside this repo, so the opt-out
// travels with the pages.
//
// `_headers` matches paths, not content types, and HTML is served at open-ended paths (pre-rendered pages, the
// single-page fallback for /join, /director, /world/...), so the HTML value goes on `/*` and every non-HTML path
// detaches it (`! Cache-Control`) before setting its own. Without the detach, Cloudflare joins both values with a comma
// and a year-cached hashed file would also read `max-age=0`.

/** Cache-Control for HTML: revalidate every visit (Cloudflare's own default for assets) and forbid rewrites. */
export const HTML_CACHE_CONTROL = 'public, max-age=0, must-revalidate, no-transform';

const REVALIDATE = 'public, max-age=0, must-revalidate';

/** Non-HTML paths and their own Cache-Control. */
export const NON_HTML_CACHE = [
  // Content-hashed files (Vite assets, site captures) never change under one name: a year, no revalidation.
  ['/assets/*', 'public, max-age=31536000, immutable'],
  ['/world/assets/*', 'public, max-age=31536000, immutable'],
  // Chunks of builds made before the move to /world/: a tab opened on /game/ before a deploy still loads them lazily.
  ['/game/assets/*', 'public, max-age=31536000, immutable'],
  ['/media/*', 'public, max-age=31536000, immutable'],
  // Share pictures keep stable names (previewers cache by URL); a day is enough to pick up a re-capture.
  ['/og/*', 'public, max-age=86400'],
  ['/og-report.png', 'public, max-age=86400'],
  // Cloudflare's default for assets, written out: a detached header is not put back, and without any Cache-Control
  // browsers would guess a lifetime for these.
  ['/robots.txt', REVALIDATE],
  ['/sitemap.xml', REVALIDATE],
  ['/version.json', REVALIDATE],
  // Guardian push (docs/09 §12): the service worker and the manifest must pick up a new version on the next visit;
  // home-screen icons keep stable names like the share pictures.
  ['/family-sw.js', REVALIDATE],
  ['/family.webmanifest', REVALIDATE],
  ['/icons/*', 'public, max-age=86400']
];

/** @returns {string} the `_headers` file text */
export function siteHeadersFile() {
  const lines = [
    '/*',
    '  X-Content-Type-Options: nosniff',
    '  Referrer-Policy: strict-origin-when-cross-origin',
    '  Permissions-Policy: microphone=(self), camera=()',
    `  Cache-Control: ${HTML_CACHE_CONTROL}`
  ];
  for (const [path, value] of NON_HTML_CACHE) {
    lines.push(path, '  ! Cache-Control', `  Cache-Control: ${value}`);
  }
  return `${lines.join('\n')}\n`;
}
