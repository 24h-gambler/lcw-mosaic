import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PlayerMenu } from './PlayerMenu.js';
import type { MenuTab } from './types.js';
import { getAudioRuntime } from '../../audio/runtime.js';
import { startFrameSettings } from '../settings.js';

/**
 * Dev-only stand-alone page for the player menu (vite dev: /game/menu-preview.html). Not part of the build.
 * Query: tab=bag|mirror|map|book|repair|settings (default settings). Settings apply to this page as in the app.
 */
const q = new URLSearchParams(location.search);
startFrameSettings(() => getAudioRuntime());

function Preview(): React.ReactElement {
  const [tab, setTab] = useState<MenuTab>((q.get('tab') as MenuTab) ?? 'settings');
  const [open, setOpen] = useState(true);
  if (!open) return <button onClick={() => setOpen(true)}>open</button>;
  return <PlayerMenu tab={tab} onTab={setTab} onClose={() => setOpen(false)} world={null} identity={null} auth={{ token: null, kind: 'guest' }} lessonOn={false} />;
}

createRoot(document.getElementById('root')!).render(<Preview />);
