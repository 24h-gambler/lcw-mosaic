/**
 * G01 게이지 (docs/03 D1, docs/08 8.1, WP-104, R325): health, hunger, thirst and warmth, drawn as icon rows right over
 * the hotbar (world/hud.ts setGauges, Dan 11-19 R325). Hunger and thirst fall at the docs/03 rates (hunger 100 -> 0 in
 * 20 min, thirst in 14 min) from 45% on a new device. Warmth falls only in the cold (a winter world outdoors, snow or
 * ice underfoot, the teacher's snowstorm) and comes back indoors, out of the cold, and fastest next to a fire (a torch
 * or a lantern). Health falls while any of the three is empty and after a long fall, and comes back by itself while
 * all three are kept up. At 20% or less the player walks slower (hunger -15%, thirst -30%, cold -40%, health -20%); at
 * 0% hunger or thirst running stops. There is no death: an empty health bar is a rest at the square (useGauges walks
 * the child there with the gauges topped up).
 *
 * What fills them: picking a food or drink from the hotbar and using it (tap the slot again / the use key). The thing
 * is a word the child earned by speaking, so using it does NOT destroy it (the bag stays server truth, AGENTS 4.7):
 * each thing refills once per `REFILL_EVERY_MS`, and the use goes to the server as a use (POST /v1/items/use). A warm
 * drink (hot chocolate, tea, cocoa, latte) also warms and keeps the cold off for warmDrinkGraceSec; food heals a little.
 *
 * The clock stops while a lesson is live, a dialog or the menu is open, or the tab is hidden: children never come
 * back from a lesson slower than they left. Values live on the device (`lcw.gauges`), not on the server: they carry
 * no money and no learning record.
 */
import { TUNING } from '@lcw/sim-core';

export interface GaugeState {
  hunger: number;
  thirst: number;
  health: number;
  warmth: number;
}

/**
 * Where the child stands this second (world/engine.ts climate()): `cold` 0 = not cold, 1 = a winter world outdoors or
 * snow / ice underfoot, 2 = a snowstorm outdoors (the docs/03 cold-sector rate); `fire` = a torch or a lantern within
 * fireRadius blocks; `roof` = something over the head (indoors keeps the cold out).
 */
export interface Climate {
  cold: 0 | 1 | 2;
  fire: boolean;
  roof: boolean;
}
export const NO_CLIMATE: Climate = { cold: 0, fire: false, roof: false };

export type GaugeKind = 'food' | 'drink';

export const GAUGES_KEY = 'lcw.gauges';
export const REFILL_EVERY_MS = 10 * 60_000;
const G = TUNING.gauges;

export function startGauges(): GaugeState {
  return { hunger: G.spawnStartPct, thirst: G.spawnStartPct, health: G.healthStartPct, warmth: 100 };
}

const clamp = (v: number): number => Math.min(100, Math.max(0, v));

/** How fast warmth changes here (per second; negative = getting colder). `grace`: a warm drink keeps the cold off. */
export function warmthRate(c: Climate, grace = false): number {
  if (c.fire) return G.fireTempPerSec;
  if (c.cold > 0 && !c.roof && !grace) return -G.tempDecayPerSecNoGear * (c.cold === 2 ? 1 : G.winterTempMult);
  return G.tempRecoverPerSec;
}

/**
 * One tick of the clock (seconds). `frozen` stops it (lesson, dialog, menu, hidden tab). `climate` and `grace` (a warm
 * drink's minutes) move warmth; health follows the other three.
 */
export function stepGauges(
  s: GaugeState,
  dtSec: number,
  frozen: boolean,
  thirstMult = 1,
  climate: Climate = NO_CLIMATE,
  grace = false
): GaugeState {
  if (frozen || !(dtSec > 0)) return s;
  const dt = Math.min(dtSec, 5); // a long frame (tab switch, debugger) never drains a gauge at once
  const hunger = clamp(s.hunger - G.hungerDecayPerSec * dt);
  const thirst = clamp(s.thirst - G.thirstDecayPerSec * thirstMult * dt);
  const warmth = clamp(s.warmth + warmthRate(climate, grace) * dt);
  const empty = (hunger <= 0 ? 1 : 0) + (thirst <= 0 ? 1 : 0) + (warmth <= 0 ? 1 : 0);
  const kept = hunger >= G.regenMinPct && thirst >= G.regenMinPct && warmth >= G.regenMinPct;
  const health = clamp(s.health + (empty > 0 ? -G.emptyGaugeHealthPerSec * empty : kept ? G.healthRegenPerSec : 0) * dt);
  return { hunger, thirst, health, warmth };
}

/** A fall of `meters`: health lost past fallSafeMeters (unchanged for a short drop). */
export function afterFall(s: GaugeState, meters: number): GaugeState {
  const over = meters - G.fallSafeMeters;
  if (!(over > 0)) return s;
  return { ...s, health: clamp(s.health - over * G.fallHealthPerMeter) };
}

/** R326 play fighting: one hit takes pvpHitDamage health. */
export function afterHit(s: GaugeState): GaugeState {
  return { ...s, health: clamp(s.health - G.pvpHitDamage) };
}

/** R326: a sip of water (a pond, a fountain): thirst back by waterSipRestore, as often as the child likes. */
export function afterSip(s: GaugeState): GaugeState {
  return { ...s, thirst: clamp(s.thirst + G.waterSipRestore) };
}

/** The rest at the square after health ran out: never death (docs/03 D1), and not straight back to empty. */
export function restAtSquare(s: GaugeState): GaugeState {
  return {
    hunger: Math.max(s.hunger, G.restMinPct),
    thirst: Math.max(s.thirst, G.restMinPct),
    health: Math.max(s.health, G.restHealthPct),
    warmth: 100
  };
}

/** docs/03 D1 (+ R325 health): 20% or less slows walking; 0% hunger or thirst stops running. */
export function gaugeEffects(s: GaugeState): {
  speedMult: number;
  canRun: boolean;
  lowHunger: boolean;
  lowThirst: boolean;
  lowHealth: boolean;
  lowWarmth: boolean;
} {
  const lowHunger = s.hunger <= G.lowThresholdPct;
  const lowThirst = s.thirst <= G.lowThresholdPct;
  const lowHealth = s.health <= G.lowThresholdPct;
  const lowWarmth = s.warmth <= G.lowThresholdPct;
  let speedMult = 1;
  if (lowHunger) speedMult = Math.min(speedMult, G.hungerLowSpeedMult);
  if (lowThirst) speedMult = Math.min(speedMult, G.thirstLowSpeedMult);
  if (lowWarmth) speedMult = Math.min(speedMult, G.tempLowSpeedMult);
  if (lowHealth) speedMult = Math.min(speedMult, G.healthLowSpeedMult);
  return { speedMult, canRun: s.hunger > 0 && s.thirst > 0, lowHunger, lowThirst, lowHealth, lowWarmth };
}

const DRINK = /tea|latte|chocolate|cocoa|lemonade|milk|juice|smoothie|water|soda/;
const FOOD = /cookie|muffin|cake|sandwich|bread|apple|banana|pie|pizza|donut|candy|burger|rice|noodle|soup|egg|cheese/;
const WARM = /tea|latte|chocolate|cocoa|coffee|soup/;

export interface Refill {
  kind: GaugeKind;
  hunger: number;
  thirst: number;
  health: number;
  warmth: number;
  /** a warm thing: it also keeps the cold off for warmDrinkGraceSec */
  warm: boolean;
}

/** What a thing in the hotbar does to the gauges (null: not food or drink). */
export function refillOf(itemKey: string): Refill | null {
  const k = itemKey.toLowerCase();
  const warm = WARM.test(k) && !/iced|cold/.test(k);
  const warmth = warm ? G.warmDrinkRestore : 0;
  if (DRINK.test(k)) return { kind: 'drink', hunger: 0, thirst: k.includes('smoothie') ? G.smoothieRestore : G.waterRestore, health: 0, warmth, warm };
  if (FOOD.test(k)) return { kind: 'food', hunger: G.breadRestore, thirst: 0, health: G.foodHealthRestore, warmth, warm };
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
  return {
    hunger: clamp(s.hunger + r.hunger),
    thirst: clamp(s.thirst + r.thirst),
    health: clamp(s.health + r.health),
    warmth: clamp(s.warmth + r.warmth)
  };
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
      const j = JSON.parse(raw) as { g?: Partial<GaugeState>; used?: unknown };
      const h = Number(j.g?.hunger);
      const t = Number(j.g?.thirst);
      // a record from before R325 has no health or warmth: they start full
      const hp = j.g?.health === undefined ? G.healthStartPct : Number(j.g.health);
      const w = j.g?.warmth === undefined ? 100 : Number(j.g.warmth);
      if (Number.isFinite(h) && Number.isFinite(t) && Number.isFinite(hp) && Number.isFinite(w)) {
        const used = new Map<string, number>(
          (Array.isArray(j.used) ? (j.used as unknown[]) : [])
            .filter((x): x is [string, number] => Array.isArray(x) && typeof x[0] === 'string' && typeof x[1] === 'number')
            .slice(0, 64)
        );
        return { g: { hunger: clamp(h), thirst: clamp(t), health: clamp(hp), warmth: clamp(w) }, used };
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
    const r1 = (v: number): number => Math.round(v * 10) / 10;
    store?.setItem(GAUGES_KEY, JSON.stringify({ g: { hunger: r1(g.hunger), thirst: r1(g.thirst), health: r1(g.health), warmth: r1(g.warmth) }, used: fresh }));
  } catch {
    /* storage blocked */
  }
}
