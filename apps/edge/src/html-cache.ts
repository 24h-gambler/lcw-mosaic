// HTML the Worker builds itself (report and showroom share pages) or passes through from ASSETS must carry
// `Cache-Control: no-transform` like the static pages (tools/site-headers.mjs): with it Cloudflare's zone-level
// Web Analytics leaves the page alone instead of injecting its third-party beacon (docs/14 §11).

/** Same value tools/site-headers.mjs puts on static HTML (a test keeps the two equal). */
export const HTML_CACHE_CONTROL = 'public, max-age=0, must-revalidate, no-transform';

const NO_TRANSFORM = /(?:^|,)\s*no-transform\s*(?:,|$)/i;

/** Adds `no-transform` to an HTML response's Cache-Control; any other response is returned untouched. */
export function htmlNoTransform(res: Response): Response {
  if (res.status === 101 || !/^\s*text\/html\b/i.test(res.headers.get('content-type') ?? '')) return res;
  const cacheControl = res.headers.get('cache-control');
  if (cacheControl && NO_TRANSFORM.test(cacheControl)) return res;
  const out = new Response(res.body, res);
  out.headers.set('cache-control', cacheControl ? `${cacheControl}, no-transform` : HTML_CACHE_CONTROL);
  return out;
}
