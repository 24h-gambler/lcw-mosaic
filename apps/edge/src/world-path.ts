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

export function legacyWorldRedirect(url: URL): Response | null {
  const location = legacyWorldLocation(url);
  if (location === null) return null;
  return new Response(null, { status: 302, headers: { location, 'cache-control': 'no-store' } });
}
