/**
 * The child's screen frame around the world (docs/08 8.6, frame domain): the HUD's always-on status (connection band,
 * coin chip) and the player menus. The world draws the HUD itself (`world/hud.ts`); this layer feeds it what only the
 * shell knows (who is playing, whether the server answers).
 */
import { useEffect } from 'react';
import type { WorldHandle } from '../world/api.js';
import type { PlayerIdentity } from '../world/identity.js';
import { watchConnection } from './connection.js';
import { getAudioRuntime } from '../audio/runtime.js';
import { storedStudentToken } from '../world/identity.js';
import { frameSettings, graphicsOf, lookSettingsOf, motionReduced, onFrameSettings, sameGraphics, startFrameSettings, type GraphicsSettings } from './settings.js';
import { startSettingsSync } from './settings-sync.js';

export interface FrameLayerProps {
  world: WorldHandle | null;
  identity: PlayerIdentity | null;
}

export function FrameLayer({ world, identity }: FrameLayerProps): null {
  // G14 settings: the device copy is put into effect at start (audio buses, text size, font, colours, motion, keys).
  useEffect(() => startFrameSettings(() => getAudioRuntime()), []);

  // ...and the world gets its part now and on every change (look speed, inversion, motion, FPS).
  useEffect(() => {
    if (!world) return;
    // Graphics: the start tier comes from savedTier() (App.pickTier); the performance lane's `setGraphics` (optional
    // until it lands) gets the whole choice at start and on every graphics change, applied live.
    const live = world as WorldHandle & { setGraphics?: (g: GraphicsSettings) => void };
    let sent: GraphicsSettings | null = null;
    const push = (): void => {
      const s = frameSettings();
      world.setLookSettings?.(lookSettingsOf(s));
      world.setReduceMotion?.(motionReduced());
      world.setShowFps?.(s.showFps);
      const g = graphicsOf(s);
      if (!sent || !sameGraphics(sent, g)) {
        sent = g;
        live.setGraphics?.(g);
      }
    };
    push();
    return onFrameSettings(push);
  }, [world]);

  // A linked child or a lesson student keeps the settings on the server too (other devices pick them up).
  const settingsToken = identity?.kind === 'child' ? identity.token : identity ? storedStudentToken() : null;
  useEffect(() => {
    if (!settingsToken) return;
    return startSettingsSync({ token: settingsToken });
  }, [settingsToken]);

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
