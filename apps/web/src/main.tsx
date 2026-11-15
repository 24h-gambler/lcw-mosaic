import React from 'react';
import { createRoot } from 'react-dom/client';
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
    createRoot(rootEl).render(
      React.createElement(App, {
        initialRoute: routeFromPath(window.location.pathname),
        initialReportToken: reportTokenFromPath(window.location.pathname)
      })
    );
  }
}
