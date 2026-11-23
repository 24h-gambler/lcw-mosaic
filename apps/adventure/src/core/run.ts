import {
  ADVENTURE_ITEMS,
  ADVENTURE_STORY,
  type AdventureChapterId,
  type AdventureGearId,
  type AdventureGoods,
  type AdventureItemId,
  type AdventureSkillId
} from '@lcw/content';
import { ADV } from './tuning.js';

/**
 * The trip across the isles (R2734): one voice (HP) that carries from meeting to meeting, coins, the pouch, what the
 * Keeper wears, the magic words learned, which chests are open and talks done, and the last lantern post touched
 * (where a Keeper who runs out of voice wakes up). Pure functions on a plain object, kept in localStorage.
 */

export const RUN_KEY = 'lcw.adventure.run.v2';

export interface LanternPost {
  chapter: AdventureChapterId;
  /** The post's entity id on the island ('post-0', 'post-1', 'post-2'). */
  id: string;
}

export interface Run {
  v: 2;
  hp: number;
  coins: number;
  items: Record<AdventureItemId, number>;
  gear: AdventureGearId[];
  skills: AdventureSkillId[];
  /** Once-only things done: 'chest-1-0', 'skill-warmHeal', 'quiz-1', 'post-1-post-0', 'met-old-fern' … */
  flags: string[];
  post: LanternPost | null;
  /** Saw the opening story. */
  prologue: boolean;
  /** Meetings with each island's guardian that ended with no voice left (kept for the report only). */
  bossTries: Partial<Record<AdventureChapterId, number>>;
  downs: number;
  coinsEarned: number;
  bought: number;
  skillsUsed: number;
}

export function newRun(): Run {
  return {
    v: 2,
    hp: ADV.hp.max,
    coins: 0,
    items: { honeyDrop: ADV.items.honeyDrop.startCount, berryBun: ADV.items.berryBun.startCount, starTea: 0 },
    gear: [],
    skills: [],
    flags: [],
    post: null,
    prologue: false,
    bossTries: {},
    downs: 0,
    coinsEarned: 0,
    bought: 0,
    skillsUsed: 0
  };
}

export function maxHp(r: Run): number {
  return ADV.hp.max + (r.gear.includes('bigScarf') ? ADV.gear.scarfHp : 0);
}

/** What a hit costs after the coat (never less than 1). */
export function hitCost(r: Run, raw: number): number {
  return Math.max(1, raw - (r.gear.includes('braveCoat') ? ADV.gear.coatBlock : 0));
}

/** Calm a kind word gives after the lantern. */
export function calmGain(r: Run, raw: number): number {
  return Math.round(raw * (r.gear.includes('glowLantern') ? ADV.gear.lanternCalm : 1));
}

export function heal(r: Run, n: number): number {
  const before = r.hp;
  r.hp = Math.min(maxHp(r), r.hp + Math.max(0, n));
  return r.hp - before;
}

export function hurt(r: Run, n: number): void {
  r.hp = Math.max(0, r.hp - Math.max(0, n));
}

export function hasFlag(r: Run, f: string): boolean {
  return r.flags.includes(f);
}

export function setFlag(r: Run, f: string): boolean {
  if (r.flags.includes(f)) return false;
  r.flags.push(f);
  return true;
}

export function addCoins(r: Run, n: number): void {
  r.coins = Math.min(ADV.coins.max, r.coins + n);
  r.coinsEarned += n;
}

export function learn(r: Run, s: AdventureSkillId): boolean {
  if (r.skills.includes(s)) return false;
  r.skills.push(s);
  return true;
}

export type BuyCheck = 'ok' | 'coins' | 'owned' | 'full';

export function canBuy(r: Run, g: AdventureGoods): BuyCheck {
  if (g.kind === 'gear' && r.gear.includes(g.id as AdventureGearId)) return 'owned';
  if (g.kind === 'skill' && r.skills.includes(g.id as AdventureSkillId)) return 'owned';
  if (g.kind === 'item' && r.items[g.id as AdventureItemId] >= ADV.items.maxEach) return 'full';
  return r.coins >= g.cost ? 'ok' : 'coins';
}

export function buy(r: Run, g: AdventureGoods): BuyCheck {
  const c = canBuy(r, g);
  if (c !== 'ok') return c;
  r.coins -= g.cost;
  r.bought += 1;
  if (g.kind === 'item') r.items[g.id as AdventureItemId] += 1;
  else if (g.kind === 'gear') {
    r.gear.push(g.id as AdventureGearId);
    // a bigger scarf holds more voice: the new room starts full
    if (g.id === 'bigScarf') r.hp = Math.min(maxHp(r), r.hp + ADV.gear.scarfHp);
  } else learn(r, g.id as AdventureSkillId);
  return 'ok';
}

/** A chest on island `ch` (index 0 or 1): what it gave, or null when it was open already. */
export function openChest(r: Run, ch: AdventureChapterId, i: 0 | 1): { coins: number; item: AdventureItemId | null } | null {
  if (!setFlag(r, `chest-${ch}-${i}`)) return null;
  const c = ADVENTURE_STORY[ch].chests[i];
  if (c.coins) addCoins(r, c.coins);
  if (c.item) r.items[c.item] = Math.min(ADV.items.maxEach, r.items[c.item] + 1);
  return { coins: c.coins, item: c.item ?? null };
}

/** A lantern post: full voice, and the trip is kept here. */
export function restAt(r: Run, post: LanternPost): void {
  r.hp = maxHp(r);
  r.post = post;
}

/** Out of voice: wake at the last lantern post with full voice (the pouch, coins and everything learned stay). */
export function revive(r: Run, guardianOf?: AdventureChapterId): void {
  r.downs += 1;
  if (guardianOf) r.bossTries[guardianOf] = (r.bossTries[guardianOf] ?? 0) + 1;
  r.hp = maxHp(r);
}

/** R2861: a guardian met again after running out of voice is exactly as hard as the first time (no easing). */
export function retrySpeed(_r: Run, _ch: AdventureChapterId): number {
  return 1;
}

const ITEM_IDS = Object.keys(ADVENTURE_ITEMS) as AdventureItemId[];
const GEAR_IDS: AdventureGearId[] = ['braveCoat', 'bigScarf', 'glowLantern'];
const SKILL_IDS: AdventureSkillId[] = ['warmHeal', 'shieldSong', 'brightSpark', 'slowWind'];

export function parseRun(raw: string | null | undefined): Run {
  const out = newRun();
  if (!raw) return out;
  try {
    const j = JSON.parse(raw) as Partial<Run>;
    if (j?.v !== 2) return out;
    const n = (x: unknown, lo: number, hi: number, d: number) => (typeof x === 'number' && Number.isFinite(x) ? Math.max(lo, Math.min(hi, Math.round(x))) : d);
    out.gear = Array.isArray(j.gear) ? GEAR_IDS.filter((g) => j.gear!.includes(g)) : [];
    out.skills = Array.isArray(j.skills) ? SKILL_IDS.filter((s) => j.skills!.includes(s)) : [];
    out.hp = n(j.hp, 1, maxHp(out), maxHp(out));
    out.coins = n(j.coins, 0, ADV.coins.max, 0);
    for (const k of ITEM_IDS) out.items[k] = n(j.items?.[k], 0, ADV.items.maxEach, out.items[k]);
    out.flags = Array.isArray(j.flags) ? j.flags.filter((f): f is string => typeof f === 'string' && f.length < 40).slice(0, 200) : [];
    const p = j.post;
    out.post = p && [1, 2, 3, 4].includes(p.chapter) && typeof p.id === 'string' && /^post-\d$/.test(p.id) ? { chapter: p.chapter, id: p.id } : null;
    out.prologue = j.prologue === true;
    for (const c of [1, 2, 3, 4] as const) {
      const t = j.bossTries?.[c];
      if (typeof t === 'number') out.bossTries[c] = n(t, 0, 99, 0);
    }
    out.downs = n(j.downs, 0, 9999, 0);
    out.coinsEarned = n(j.coinsEarned, 0, 99999, 0);
    out.bought = n(j.bought, 0, 9999, 0);
    out.skillsUsed = n(j.skillsUsed, 0, 9999, 0);
    return out;
  } catch {
    return out;
  }
}
