/**
 * The G01 gauge loop in the shell (frame/gauges.ts has the rules): one tick a second while the world runs, the HUD
 * bars and the walking speed follow, the device keeps the values. Frozen during a lesson, a dialog, the menu and a
 * hidden tab. Using a food or drink from the hotbar (picking the slot in hand again) refills, once per thing per
 * REFILL_EVERY_MS, and goes to the server as a use (the thing stays in the bag).
 */
import { useEffect, useRef } from 'react';
import type { WorldHandle } from '../world/api.js';
import { WORLD_STRINGS as W, worldSay } from '../world/strings.js';
import { gaugeEffects, loadGauges, refillOf, saveGauges, stepGauges, useForGauges, type GaugeState } from './gauges.js';

/** A low-gauge notice: the English, and the Korean help on a second line (a long line, never cut off on phones). */
export function lowNotice(key: 'lowHunger' | 'lowThirst'): string {
  const s = worldSay(key);
  return s.help ? `${s.text}
${s.help}` : s.text;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function useGauges(world: WorldHandle | null, frozen: boolean, onUse: (itemKey: string) => void): void {
  const frozenRef = useRef(frozen);
  frozenRef.current = frozen;
  const useRef_ = useRef(onUse);
  useRef_.current = onUse;

  useEffect(() => {
    if (!world?.setGauges) return;
    const store = storage();
    const rec = loadGauges(store);
    let g: GaugeState = rec.g;
    const used = rec.used;
    let wasLowH = false;
    let wasLowT = false;
    const show = (): void => {
      const fx = gaugeEffects(g);
      world.setGauges?.({ hunger: g.hunger, thirst: g.thirst, lowHunger: fx.lowHunger, lowThirst: fx.lowThirst, slow: fx.speedMult < 1 });
      world.setMove?.(fx.speedMult, fx.canRun);
      // say once why walking got slower, and what helps (the "reason to speak", docs/03 D1)
      if (fx.lowThirst && !wasLowT) world.notice?.(lowNotice('lowThirst'));
      else if (fx.lowHunger && !wasLowH) world.notice?.(lowNotice('lowHunger'));
      wasLowH = fx.lowHunger;
      wasLowT = fx.lowThirst;
    };
    show();
    let last = performance.now();
    let sinceSave = 0;
    const tick = window.setInterval(() => {
      const now = performance.now();
      const dt = (now - last) / 1000;
      last = now;
      const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
      const next = stepGauges(g, dt, frozenRef.current || hidden);
      if (next === g) return;
      g = next;
      show();
      sinceSave += dt;
      if (sinceSave >= 10) {
        sinceSave = 0;
        saveGauges(store, g, used, Date.now());
      }
    }, 1000);
    const off = world.onUse?.((key) => {
      const r = refillOf(key);
      if (!r || frozenRef.current) return;
      const now = Date.now();
      const next = useForGauges(g, key, used, now);
      if (!next) {
        world.notice?.(W.restLater);
        return;
      }
      g = next;
      used.set(key, now);
      saveGauges(store, g, used, now);
      show();
      world.notice?.(r.kind === 'food' ? W.ate : W.drank);
      useRef_.current(key);
    });
    const save = (): void => saveGauges(store, g, used, Date.now());
    // a phone often never fires pagehide: also save when the tab goes to the background
    const onHidden = (): void => {
      if (document.visibilityState === 'hidden') save();
    };
    window.addEventListener('pagehide', save);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      window.clearInterval(tick);
      window.removeEventListener('pagehide', save);
      document.removeEventListener('visibilitychange', onHidden);
      off?.();
      save();
      world.setMove?.(1, true);
    };
  }, [world]);
}
