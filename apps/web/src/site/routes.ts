/** Public site map (docs/14 §2). Pure so the router, the tests and the build share one table. */
import { LEARN_PAGES, META } from './copy.js';

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
  return META[loc.path] ?? META['/']!;
}

/** Paths the static build pre-renders so crawlers and link previews get real HTML (docs/14 §11). */
export function prerenderPaths(): string[] {
  return [...Object.keys(EXACT), ...LEARN_PAGES.map((p) => `/learn/${p.slug}`)];
}
