import React from 'react';
import { createRoot } from 'react-dom/client';
import { App, type AppRoute } from './App.js';

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
  '/director'
];

/** Deep links (e.g. a KakaoTalk share of /try) open the matching page instead of always the intro. */
export function routeFromPath(pathname: string): AppRoute {
  const clean = (pathname.replace(/\/+$/, '') || '/') as AppRoute;
  return KNOWN_ROUTES.includes(clean) ? clean : '/';
}

if (typeof document !== 'undefined') {
  const rootEl = document.getElementById('root');
  if (rootEl) {
    createRoot(rootEl).render(
      React.createElement(App, { initialRoute: routeFromPath(window.location.pathname) })
    );
  }
}
