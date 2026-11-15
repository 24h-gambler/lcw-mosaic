import React from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { App, type AppRoute } from './App.js';
import { reportTokenFromPath } from './lessonFlow.js';
import { isSitePath } from './site/routes.js';

const KNOWN_ROUTES: readonly AppRoute[] = [
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
  '/join',
  '/family',
  '/link',
  '/seats'
];

/** Deep links (e.g. a KakaoTalk share of /try) open the matching page instead of always the intro. */
export function routeFromPath(pathname: string): AppRoute {
  if (reportTokenFromPath(pathname)) return '/r';
  const clean = (pathname.replace(/\/+$/, '') || '/') as AppRoute;
  if (KNOWN_ROUTES.includes(clean)) return clean;
  // Public site paths, including /learn/<slug>, /s/<token> and old aliases (/teachers).
  return isSitePath(clean) ? clean : '/';
}

if (typeof document !== 'undefined') {
  const rootEl = document.getElementById('root');
  if (rootEl) {
    const initialRoute = routeFromPath(window.location.pathname);
    const app = React.createElement(App, {
      initialRoute,
      initialReportToken: reportTokenFromPath(window.location.pathname)
    });
    // Public pages arrive pre-rendered (tools/prerender-site.mjs): attach to that HTML instead of rebuilding it.
    // Any other address gets an empty root (the file's guard clears it), so it renders from scratch.
    if (rootEl.firstElementChild && isSitePath(initialRoute)) hydrateRoot(rootEl, app);
    else createRoot(rootEl).render(app);
  }
}
