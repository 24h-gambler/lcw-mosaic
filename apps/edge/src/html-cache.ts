// HTML leaves the Worker with `Cache-Control: no-transform` (static pages also get it from tools/site-headers.mjs):
// with it Cloudflare's zone-level Web Analytics leaves the page alone instead of injecting its third-party beacon
// (docs/14 §11). The same flag also stops Cloudflare from compressing the page (production 11-16: /play went out as
// 177 KB raw HTML, LCP 3.1 s), so the Worker compresses HTML itself: setting Content-Encoding on a Worker response makes
// the Workers runtime encode the body, which is not a zone transform.

/** Same value tools/site-headers.mjs puts on static HTML (a test keeps the two equal). */
export const HTML_CACHE_CONTROL = 'public, max-age=0, must-revalidate, no-transform';

const NO_TRANSFORM = /(?:^|,)\s*no-transform\s*(?:,|$)/i;

function isHtml(res: Response): boolean {
  return res.status !== 101 && /^\s*text\/html\b/i.test(res.headers.get('content-type') ?? '');
}

/** The encoding the Workers runtime should apply for this client: br, else gzip, else none. */
export function htmlEncodingFor(acceptEncoding: string | null): 'br' | 'gzip' | null {
  const offered = new Map<string, number>();
  for (const part of (acceptEncoding ?? '').toLowerCase().split(',')) {
    const [name, ...params] = part.trim().split(';');
    if (!name) continue;
    const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
    offered.set(name, q ? Number(q.slice(2)) || 0 : 1);
  }
  if ((offered.get('br') ?? 0) > 0) return 'br';
  if ((offered.get('gzip') ?? 0) > 0) return 'gzip';
  return null;
}

/** Adds `no-transform` to an HTML response's Cache-Control; any other response is returned untouched. */
export function htmlNoTransform(res: Response): Response {
  if (!isHtml(res)) return res;
  const cacheControl = res.headers.get('cache-control');
  if (cacheControl && NO_TRANSFORM.test(cacheControl)) return res;
  const out = new Response(res.body, res);
  out.headers.set('cache-control', cacheControl ? `${cacheControl}, no-transform` : HTML_CACHE_CONTROL);
  return out;
}

/**
 * The HTML response as it should leave the Worker: no-transform, and compressed for clients that accept br/gzip.
 * Bodies already encoded, empty bodies (HEAD, 304) and non-HTML responses keep their bytes.
 */
export function htmlForClient(res: Response, request: Request): Response {
  const marked = htmlNoTransform(res);
  if (!isHtml(marked) || marked.status !== 200 || !marked.body || request.method === 'HEAD') return marked;
  if (marked.headers.get('content-encoding')) return marked;
  const encoding = htmlEncodingFor(request.headers.get('accept-encoding'));
  const headers = new Headers(marked.headers);
  const vary = headers.get('vary');
  if (!vary || !/accept-encoding/i.test(vary)) headers.set('vary', vary ? `${vary}, Accept-Encoding` : 'Accept-Encoding');
  if (!encoding) return new Response(marked.body, { status: marked.status, statusText: marked.statusText, headers });
  headers.set('content-encoding', encoding);
  headers.delete('content-length');
  return new Response(marked.body, { status: marked.status, statusText: marked.statusText, headers });
}
