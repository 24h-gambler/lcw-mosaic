/** Entry of /adventure/ (docs/22): the talk-to-befriend adventure on the Hushwind Isles. */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { Engine } from './engine.js';
import { App } from './ui/App.js';
import { CSS } from './ui/styles.js';

declare global {
  interface Window {
    /** Read-only handle for the headless checks (tools/adventure-play.mjs, docs/22 5장); the page never reads it. */
    __adv?: Engine;
  }
}

if (typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const engine = new Engine();
  window.__adv = engine;
  const rootEl = document.getElementById('root');
  if (rootEl) createRoot(rootEl).render(<App engine={engine} />);
  void engine.boot();
  // a child who closes the tab mid-island still leaves what they said in the document (same id overwrites later)
  const leave = () => engine.sendResults(true);
  window.addEventListener('pagehide', leave);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') leave();
  });
}
