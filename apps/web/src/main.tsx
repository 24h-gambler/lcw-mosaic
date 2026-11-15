import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { KNOWN_ROUTES, reportTokenFromPath, routeFromPath } from './routes.js';

// Route table lives in routes.ts so App's back/forward handling parses URLs the same way as the first load.
export { KNOWN_ROUTES, routeFromPath };

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
