/**
 * The child's screen frame around the world (docs/08 8.6, frame domain): the HUD's always-on status (connection band,
 * coin chip) and the player menus. The world draws the HUD itself (`world/hud.ts`); this layer feeds it what only the
 * shell knows (who is playing, whether the server answers).
 */
import { useEffect } from 'react';
import type { WorldHandle } from '../world/api.js';
import type { PlayerIdentity } from '../world/identity.js';
import { watchConnection } from './connection.js';

export interface FrameLayerProps {
  world: WorldHandle | null;
  identity: PlayerIdentity | null;
}

export function FrameLayer({ world, identity }: FrameLayerProps): null {
  // Connection band: the world keeps running on the device while the server is away.
  useEffect(() => {
    if (!world?.setOnline) return;
    const startOnline = typeof navigator === 'undefined' || navigator.onLine !== false;
    return watchConnection({ setOnline: (on) => world.setOnline?.(on), startOnline });
  }, [world]);

  // Coins are always on the HUD (docs/08 8.1). A guest has no ledger: nothing is ever granted on a guest device, so its
  // balance is 0. A lesson's poll and a linked child's answers bring the server ledger total.
  useEffect(() => {
    if (world && identity?.kind === 'guest') world.setCoins?.(0);
  }, [world, identity]);

  return null;
}
