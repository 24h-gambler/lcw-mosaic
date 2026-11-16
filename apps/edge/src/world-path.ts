/**
 * The 3D world lives at /world/ (docs/21-glossary.md: the product never calls itself a "game", and the URL is user-visible).
 * /game/ was its first address; lesson links (`/game/?code=123456`), guest passes (`/game/?pass=`) and bookmarks still
 * point there, so every /game path is sent to the same place under /world/ with the query string untouched.
 * A temporary redirect (302) keeps the move reversible: browsers do not pin it the way they pin a 301.
 */
export const WORLD_PATH = '/world/';
const LEGACY_PREFIX = '/game';

/** The /world/ URL an old /game path now lives at, or null when the path is not under /game. */
export function legacyWorldLocation(url: URL): string | null {
  const p = url.pathname;
  if (p !== LEGACY_PREFIX && !p.startsWith(`${LEGACY_PREFIX}/`)) return null;
  const rest = p.slice(LEGACY_PREFIX.length).replace(/^\//, '');
  return `${WORLD_PATH}${rest}${url.search}`;
}

export function legacyWorldRedirect(url: URL): Response | null {
  const location = legacyWorldLocation(url);
  if (location === null) return null;
  return new Response(null, { status: 302, headers: { location, 'cache-control': 'no-store' } });
}
