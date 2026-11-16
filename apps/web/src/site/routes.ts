/** Public site map (docs/14 §2). Pure so the router, the tests and the build share one table. */
import { LEARN_PAGES, META } from './copy.js';
import { PLAY_NOW } from './copyNow.js';
import { liveOr } from './featureStatus.js';

export type SitePage =
  | 'home'
  | 'parents'
  | 'play'
  | 'tutoring'
  | 'pricing'
  | 'try'
  | 'safety'
  | 'terms'
  | 'privacy'
  | 'learn'
  | 'learnPage'
  | 'worlds'
  | 'showroom'
  | 'pass';

export interface SiteLocation {
  page: SitePage;
  /** Canonical path (aliases such as /teachers resolve to /tutoring). */
  path: string;
  /** Slug for /learn/<slug>, token for /s/<token>. */
  param?: string;
}

const EXACT: Readonly<Record<string, SitePage>> = {
  '/': 'home',
  '/parents': 'parents',
  '/play': 'play',
  '/tutoring': 'tutoring',
  '/pricing': 'pricing',
  '/try': 'try',
  '/safety': 'safety',
  '/terms': 'terms',
  '/privacy': 'privacy',
  '/learn': 'learn',
  '/worlds': 'worlds',
  '/pass': 'pass'
};

/** Older links that must keep working. */
const ALIASES: Readonly<Record<string, string>> = {
  '/teachers': '/tutoring'
};

const PARAM_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function parseSitePath(pathname: string): SiteLocation | null {
  const raw = (pathname.split(/[?#]/)[0] ?? '/').replace(/\/+$/, '') || '/';
  const clean = ALIASES[raw] ?? raw;
  const exact = EXACT[clean];
  if (exact) return { page: exact, path: clean };
  const learn = /^\/learn\/([^/]+)$/.exec(clean);
  if (learn && PARAM_RE.test(learn[1]!)) return { page: 'learnPage', path: clean, param: learn[1]! };
  const show = /^\/s\/([^/]+)$/.exec(clean);
  if (show && PARAM_RE.test(show[1]!)) return { page: 'showroom', path: clean, param: show[1]! };
  return null;
}

export function isSitePath(pathname: string): boolean {
  return parseSitePath(pathname) !== null;
}

/** Child-facing pages: no price, payment or deadline may appear (AGENTS.md 4.9, docs/14 §1.4). */
export const CHILD_PAGES: readonly SitePage[] = ['play', 'try', 'pass'];

export function metaFor(loc: SiteLocation): { title: string; description: string } {
  if (loc.page === 'learnPage') {
    const p = LEARN_PAGES.find((x) => x.slug === loc.param);
    if (p) return { title: `${p.title} — 영어 표현 — LCW`, description: `${p.scene} 별 1개부터 3개까지 자라는 영어 문장.` };
    return META['/learn']!;
  }
  if (loc.page === 'showroom') return { title: '쇼룸 — LCW', description: '친구가 지은 월드를 돌려 보세요.' };
  const m = META[loc.path] ?? META['/']!;
  // Link previews and search show what is true today (copyNow.ts), the full line once its features are live.
  if (loc.path === '/play') return { ...m, description: liveOr(PLAY_NOW.metaDescription, m.description) };
  return m;
}

/** Paths the static build pre-renders so crawlers and link previews get real HTML (docs/14 §11). */
export function prerenderPaths(): string[] {
  return [...Object.keys(EXACT), ...LEARN_PAGES.map((p) => `/learn/${p.slug}`)];
}

/**
 * Share picture per page (docs/14 §11 "페이지별 대표 그림"): 1200×630 JPEGs captured from the real /game
 * (tools/site-captures.mjs). Stable names under /og/ so KakaoTalk and search keep their cached copies valid.
 */
export type ShareImage = 'home' | 'parents' | 'play' | 'try' | 'tutoring' | 'learn-cafe' | 'learn-trade' | 'learn-build' | 'showroom';
export const SHARE_IMAGES: readonly ShareImage[] = ['home', 'parents', 'play', 'try', 'tutoring', 'learn-cafe', 'learn-trade', 'learn-build', 'showroom'];
export const SHARE_IMAGE_SIZE = { width: 1200, height: 630 } as const;
const LEARN_SHARE: Readonly<Record<string, ShareImage>> = { cafe: 'learn-cafe', trade: 'learn-trade', open_question: 'learn-build' };

export function shareImageFor(loc: SiteLocation): ShareImage {
  if (loc.page === 'learnPage') {
    const ctx = LEARN_PAGES.find((x) => x.slug === loc.param)?.ctx;
    return (ctx && LEARN_SHARE[ctx]) || 'learn-cafe';
  }
  if (loc.page === 'showroom' || loc.page === 'worlds') return 'showroom';
  if (loc.page === 'parents' || loc.page === 'play' || loc.page === 'try' || loc.page === 'tutoring') return loc.page;
  if (loc.page === 'pass') return 'play';
  return 'home';
}

/** Pages search engines should list. The invite page only makes sense with a code from a friend. */
export function indexable(loc: SiteLocation): boolean {
  return loc.page !== 'pass' && loc.page !== 'showroom';
}
