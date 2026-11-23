/**
 * The 3D world lives at /world/ (docs/21-glossary.md: the product never calls itself a "game", and the URL is user-visible).
 * /game/ was its first address; lesson links (`/game/?code=123456`), guest passes (`/game/?pass=`) and bookmarks still
 * point there, so every /game path is sent to the same place under /world/ with the query string untouched.
 * A temporary redirect (302) keeps the move reversible: browsers do not pin it the way they pin a 301.
 * /game/assets/* is the exception: a tab opened on /game/ before a deploy still lazy-loads its own hashed chunks from
 * there (the dialog panel, the lesson layer). Those files stay in the asset folder (tools/build-site.mjs never cleans
 * it) and are served as assets (wrangler.toml run_worker_first), never redirected to /world/assets/, where they do not exist.
 */
export const WORLD_PATH = '/world/';
const LEGACY_PREFIX = '/game';
const LEGACY_ASSETS = '/game/assets/';

/** The /world/ URL an old /game path now lives at, or null when the path is not under /game. */
export function legacyWorldLocation(url: URL): string | null {
  const p = url.pathname;
  if (p !== LEGACY_PREFIX && !p.startsWith(`${LEGACY_PREFIX}/`)) return null;
  if (p.startsWith(LEGACY_ASSETS)) return null;
  const rest = p.slice(LEGACY_PREFIX.length).replace(/^\//, '');
  return `${WORLD_PATH}${rest}${url.search}`;
}

/**
 * R329 (Dan 11-23 "lcw는 설명 페이지는 좋지만 실제 플레이와 연결이 없다"): the entrance order is the fix, before any
 * video. A first visit (no `lcw_seen` cookie) opens the introduction at /about; a revisit opens the world at /world/.
 * A lesson code in the query always opens the world, so a class never waits on /about. The cookie is set on the
 * first-visit redirect below (and on normal HTML pages by `withSeenCookie`), so a fresh profile still lands on
 * /about on its first `/` visit. 302 like the /game move, so it stays reversible.
 */
export const SEEN_COOKIE = 'lcw_seen';
/** The exact `set-cookie` value that marks this browser as a revisit (30 days, first-party only). */
export const SEEN_SET_COOKIE = `${SEEN_COOKIE}=1; Path=/; Max-Age=${30 * 24 * 60 * 60}; Secure; SameSite=Lax`;

/** True when the request carries the revisit marker. */
export function hasSeenCookie(cookieHeader: string | null | undefined): boolean {
  if (!cookieHeader) return false;
  return cookieHeader.split(';').some((part) => {
    const i = part.indexOf('=');
    if (i < 0) return false;
    return part.slice(0, i).trim() === SEEN_COOKIE && part.slice(i + 1).trim() === '1';
  });
}

/** Non-HTML responses and error pages never set the marker: only a real page view counts as a revisit. */
export function withSeenCookie(request: Request, res: Response): Response {
  if (request.method !== 'GET' || res.status >= 400) return res;
  if (hasSeenCookie(request.headers.get('cookie'))) return res;
  const out = new Response(res.body, res);
  out.headers.set('set-cookie', SEEN_SET_COOKIE);
  return out;
}

/**
 * Where `/` goes: the introduction on a first visit (/about), the world on a revisit (/world/) or with a lesson
 * code. Other paths are not the entrance and are left alone (null).
 */
export function rootLocation(url: URL, cookieHeader: string | null = null): string | null {
  if (url.pathname !== '/') return null;
  const code = url.searchParams.get('code')?.replace(/\D/g, '') ?? '';
  if (code.length === 6 || hasSeenCookie(cookieHeader)) return `${WORLD_PATH}${url.search}`;
  return `/about${url.search}`;
}

export function legacyWorldRedirect(url: URL, cookieHeader: string | null = null): Response | null {
  const legacy = legacyWorldLocation(url);
  if (legacy !== null) return new Response(null, { status: 302, headers: { location: legacy, 'cache-control': 'no-store', vary: 'Cookie' } });
  const root = rootLocation(url, cookieHeader);
  if (root === null) return null;
  const headers: Record<string, string> = { location: root, 'cache-control': 'no-store', vary: 'Cookie' };
  // A first visit going to /about becomes a revisit from here on; keeping it on the redirect is what makes a
  // clean profile's second `/` visit (and a hard reload) land on /world/ without another page in between.
  if (root.startsWith('/about')) headers['set-cookie'] = SEEN_SET_COOKIE;
  return new Response(null, { status: 302, headers });
}
