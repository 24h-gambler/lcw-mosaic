/** URL ↔ screen mapping shared by main.tsx (first load) and App (back/forward). */
import type { AppRoute } from './App.js';
import { reportTokenFromPath } from './lessonFlow.js';

export const KNOWN_ROUTES: readonly AppRoute[] = [
  '/',
  '/try',
  '/play',
  '/parents',
  '/safety',
  '/teachers',
  '/worlds',
  '/pass',
  '/report',
  '/dashboard',
  '/director',
  '/guest-end',
  '/claim',
  '/window',
  '/join'
];

/** Deep links (e.g. a KakaoTalk share of /try or a parent report /r/<token>) open the matching page. */
export function routeFromPath(pathname: string): AppRoute {
  if (reportTokenFromPath(pathname)) return '/r';
  const clean = (pathname.replace(/\/+$/, '') || '/') as AppRoute;
  return KNOWN_ROUTES.includes(clean) ? clean : '/';
}

export { reportTokenFromPath };
