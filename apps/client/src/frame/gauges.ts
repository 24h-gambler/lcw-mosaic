/**
 * G01 게이지 (docs/03 D1, docs/08 8.1, WP-104): hunger and thirst on the HUD, falling at the docs/03 rates
 * (hunger 100 -> 0 in 20 min, thirst in 14 min), starting at 45% on a new device. At 20% or less the player walks
 * slower (hunger -15%, thirst -30%); at 0% running stops. There is no death: the worst is "slower" (docs/03).
 *
 * What fills them: picking a food or drink from the hotbar and using it (tap the slot again / the use key). The thing
 * is a word the child earned by speaking, so using it does NOT destroy it (the bag stays server truth, AGENTS 4.7):
 * each thing refills once per `REFILL_EVERY_MS`, and the use goes to the server as a use (POST /v1/items/use).
 *
 * The clock stops while a lesson is live, a dialog or the menu is open, or the tab is hidden: children never come
 * back from a lesson slower than they left. Values live on the device (`lcw.gauges`), not on the server: they carry
 * no money and no learning record.
 */
import { TUNING } from '@lcw/sim-core';

export interface GaugeState {
  hunger: number;
  thirst: number;
}

export type GaugeKind = 'food' | 'drink';

export const GAUGES_KEY = 'lcw.gauges';
export const REFILL_EVERY_MS = 10 * 60_000;
const G = TUNING.gauges;

export function startGauges(): GaugeState {
  return { hunger: G.spawnStartPct, thirst: G.spawnStartPct };
}

const clamp = (v: number): number => Math.min(100, Math.max(0, v));

/** One tick of the clock (seconds). `frozen` stops it (lesson, dialog, menu, hidden tab). */
export function stepGauges(s: GaugeState, dtSec: number, frozen: boolean, thirstMult = 1): GaugeState {
  if (frozen || !(dtSec > 0)) return s;
  const dt = Math.min(dtSec, 5); // a long frame (tab switch, debugger) never drains a gauge at once
  return {
    hunger: clamp(s.hunger - G.hungerDecayPerSec * dt),
    thirst: clamp(s.thirst - G.thirstDecayPerSec * thirstMult * dt)
  };
}

/** docs/03 D1: 20% or less slows walking; 0% stops running. */
export function gaugeEffects(s: GaugeState): { speedMult: number; canRun: boolean; lowHunger: boolean; lowThirst: boolean } {
  const lowHunger = s.hunger <= G.lowThresholdPct;
  const lowThirst = s.thirst <= G.lowThresholdPct;
  let speedMult = 1;
  if (lowHunger) speedMult = Math.min(speedMult, G.hungerLowSpeedMult);
  if (lowThirst) speedMult = Math.min(speedMult, G.thirstLowSpeedMult);
  return { speedMult, canRun: s.hunger > 0 && s.thirst > 0, lowHunger, lowThirst };
}

const DRINK = /tea|latte|chocolate|cocoa|lemonade|milk|juice|smoothie|water|soda/;
const FOOD = /cookie|muffin|cake|sandwich|bread|apple|banana|pie|pizza|donut|candy|burger|rice|noodle|soup|egg|cheese/;

/** What a thing in the hotbar does to the gauges (null: not food or drink). */
export function refillOf(itemKey: string): { kind: GaugeKind; hunger: number; thirst: number } | null {
  const k = itemKey.toLowerCase();
  if (DRINK.test(k)) return { kind: 'drink', hunger: 0, thirst: k.includes('smoothie') ? G.smoothieRestore : G.waterRestore };
  if (FOOD.test(k)) return { kind: 'food', hunger: G.breadRestore, thirst: 0 };
  return null;
}

/** Use a thing: the new gauges, or null while that thing is resting (used in the last REFILL_EVERY_MS). */
export function useForGauges(
  s: GaugeState,
  itemKey: string,
  lastUsed: ReadonlyMap<string, number>,
  now: number
): GaugeState | null {
  const r = refillOf(itemKey);
  if (!r) return null;
  const at = lastUsed.get(itemKey);
  if (at !== undefined && now - at < REFILL_EVERY_MS) return null;
  return { hunger: clamp(s.hunger + r.hunger), thirst: clamp(s.thirst + r.thirst) };
}

/** Device record: gauges plus when each thing last refilled (so a reload does not reset the rest time). */
export interface GaugeRecord {
  g: GaugeState;
  used: Array<[string, number]>;
}

export function loadGauges(store: Pick<Storage, 'getItem'> | null): { g: GaugeState; used: Map<string, number> } {
  try {
    const raw = store?.getItem(GAUGES_KEY);
    if (raw) {
      const j = JSON.parse(raw) as Partial<GaugeRecord>;
      const h = Number(j.g?.hunger);
      const t = Number(j.g?.thirst);
      if (Number.isFinite(h) && Number.isFinite(t)) {
        const used = new Map<string, number>((Array.isArray(j.used) ? j.used : []).filter((x): x is [string, number] => Array.isArray(x) && typeof x[0] === 'string' && typeof x[1] === 'number').slice(0, 64));
        return { g: { hunger: clamp(h), thirst: clamp(t) }, used };
      }
    }
  } catch {
    /* storage blocked or bad record: start fresh */
  }
  return { g: startGauges(), used: new Map() };
}

export function saveGauges(store: Pick<Storage, 'setItem'> | null, g: GaugeState, used: ReadonlyMap<string, number>, now: number): void {
  try {
    const fresh = [...used].filter(([, at]) => now - at < REFILL_EVERY_MS);
    store?.setItem(GAUGES_KEY, JSON.stringify({ g: { hunger: Math.round(g.hunger * 10) / 10, thirst: Math.round(g.thirst * 10) / 10 }, used: fresh }));
  } catch {
    /* storage blocked */
  }
}
