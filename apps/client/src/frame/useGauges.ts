/**
 * The G01 gauge loop in the shell (frame/gauges.ts has the rules): one tick a second while the world runs, the icon
 * rows over the hotbar and the walking speed follow, the device keeps the values. Frozen during a lesson, a dialog, the
 * menu and a hidden tab. Using a food or drink from the hotbar (picking the slot in hand again) refills, once per thing
 * per REFILL_EVERY_MS, and goes to the server as a use (the thing stays in the bag). The world says where the child
 * stands each tick (climate: cold, a fire, a roof) and when a fall ended; an empty health bar is a rest at the square.
 */
import { useEffect, useRef } from 'react';
import { TUNING } from '@lcw/sim-core';
import type { WorldHandle } from '../world/api.js';
import { worldSay } from '../world/strings.js';
import {
  NO_CLIMATE,
  afterFall,
  gaugeEffects,
  loadGauges,
  refillOf,
  restAtSquare,
  saveGauges,
  stepGauges,
  useForGauges,
  type GaugeState
} from './gauges.js';

export type GaugeNotice = 'lowHunger' | 'lowThirst' | 'lowHealth' | 'lowWarmth' | 'rested' | 'ouch' | 'ate' | 'drank' | 'warmedUp' | 'restLater';

/** A one-off line over the bar: English, and the Korean help on a line of its own (a dot join was cut on a phone). */
export function noticeLine(key: GaugeNotice): string {
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
    /** a warm drink keeps the cold off until then (performance.now ms) */
    let warmUntil = -1;
    let resting = false;
    const was = { h: false, t: false, hp: false, w: false };
    let cold = false;
    const show = (): void => {
      const fx = gaugeEffects(g);
      world.setGauges?.({
        health: g.health,
        hunger: g.hunger,
        thirst: g.thirst,
        warmth: g.warmth,
        lowHealth: fx.lowHealth,
        lowHunger: fx.lowHunger,
        lowThirst: fx.lowThirst,
        lowWarmth: fx.lowWarmth,
        cold: cold || g.warmth < 99.5,
        slow: fx.speedMult < 1
      });
      world.setMove?.(fx.speedMult, fx.canRun);
      // say once why walking got slower, and what helps (the "reason to speak", docs/03 D1)
      if (fx.lowWarmth && !was.w) world.notice?.(noticeLine('lowWarmth'));
      else if (fx.lowThirst && !was.t) world.notice?.(noticeLine('lowThirst'));
      else if (fx.lowHunger && !was.h) world.notice?.(noticeLine('lowHunger'));
      else if (fx.lowHealth && !was.hp) world.notice?.(noticeLine('lowHealth'));
      was.h = fx.lowHunger;
      was.t = fx.lowThirst;
      was.hp = fx.lowHealth;
      was.w = fx.lowWarmth;
    };
    /** health ran out: a rest at the square, never death (docs/03 D1) */
    const rest = (): void => {
      if (resting || g.health > 0) return;
      resting = true;
      g = restAtSquare(g);
      saveGauges(store, g, used, Date.now());
      show();
      world.notice?.(noticeLine('rested'));
      void Promise.resolve(world.goToScene('plaza')).finally(() => {
        resting = false;
      });
    };
    show();
    let last = performance.now();
    let sinceSave = 0;
    const tick = window.setInterval(() => {
      const now = performance.now();
      const dt = (now - last) / 1000;
      last = now;
      const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
      const c = world.climate?.() ?? NO_CLIMATE;
      cold = c.cold > 0 && !c.roof;
      const next = stepGauges(g, dt, frozenRef.current || hidden || resting, 1, c, now < warmUntil);
      if (next === g) return;
      g = next;
      show();
      if (g.health <= 0) rest();
      sinceSave += dt;
      if (sinceSave >= 10) {
        sinceSave = 0;
        saveGauges(store, g, used, Date.now());
      }
    }, 1000);
    const offFall = world.onFall?.((m) => {
      if (frozenRef.current || resting) return;
      const next = afterFall(g, m);
      if (next === g) return;
      g = next;
      show();
      if (g.health <= 0) rest();
      else world.notice?.(noticeLine('ouch'));
    });
    const off = world.onUse?.((key) => {
      const r = refillOf(key);
      if (!r || frozenRef.current) return;
      const now = Date.now();
      const next = useForGauges(g, key, used, now);
      if (!next) {
        world.notice?.(noticeLine('restLater'));
        return;
      }
      g = next;
      if (r.warm) warmUntil = performance.now() + TUNING.gauges.warmDrinkGraceSec * 1000;
      used.set(key, now);
      saveGauges(store, g, used, now);
      show();
      world.notice?.(noticeLine(r.warm && cold ? 'warmedUp' : r.kind === 'food' ? 'ate' : 'drank'));
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
      offFall?.();
      save();
      world.setMove?.(1, true);
    };
  }, [world]);
}
