import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';

if (typeof document !== 'undefined') {
  const rootEl = document.getElementById('root');
  if (rootEl) {
    createRoot(rootEl).render(React.createElement(App));
  }
}
