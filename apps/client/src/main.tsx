import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  VoxelWorld,
  createInitialPlayerState,
  populateInitialWorld
} from '@lcw/sim-core';
import { understandUtterance } from '@lcw/converse';
import { GameCanvas } from './GameCanvas.js';
import { HudOverlay } from './HudOverlay.js';

export function ClientApp(): React.ReactElement {
  const world = useMemo(() => {
    const w = new VoxelWorld();
    populateInitialWorld(w, 'mosaic-client-default', 1);
    return w;
  }, []);
  const [player] = useState(() => createInitialPlayerState('local-explorer'));
  const [fontScale, setFontScale] = useState(1);
  const [micActive, setMicActive] = useState(false);
  const [thoughtBoardOpen, setThoughtBoardOpen] = useState(false);
  const [selectedStars, setSelectedStars] = useState<1 | 2 | 3>(2);
  const initialUnderstand = useMemo(
    () =>
      understandUtterance({
        ctx: 'cafe',
        level: 'L2',
        transcript: 'warm honey tea please'
      }),
    []
  );
  const [offers, setOffers] = useState(initialUnderstand.offers);

  return React.createElement(
    'main',
    null,
    React.createElement(GameCanvas, { world, player }),
    React.createElement(HudOverlay, {
      player,
      zoneLabel: '잉글리시 코어 플라자 (보호 구역)',
      offers,
      selectedStars,
      fontScale,
      micActive,
      thoughtBoardOpen,
      onSelectOffer: setSelectedStars,
      onToggleMic: () => setMicActive((m) => !m),
      onToggleThoughtBoard: () => setThoughtBoardOpen((o) => !o),
      onSelectBoardItem: (item, modifier) => {
        const res = understandUtterance({
          ctx: 'cafe',
          level: 'L2',
          transcript: `${modifier ?? ''} ${item}`.trim()
        });
        setOffers(res.offers);
      },
      onChangeFontScale: setFontScale
    })
  );
}

if (typeof document !== 'undefined') {
  const rootEl = document.getElementById('root');
  if (rootEl) {
    createRoot(rootEl).render(React.createElement(ClientApp));
  }
}
