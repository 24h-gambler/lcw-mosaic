import { npcPersona } from '@lcw/content';
import type { SceneId } from '../world/api.js';
import { learnLang } from '../world/lang.js';
import { ui } from './strings.js';

/**
 * The town goals after the first-visit errand (R2625, Dan 11-16: "게임 자체가 진행이 아예 안됐고요"). The errand
 * (docs/03 D1) ended with an empty goal line and every NPC said the same thing again, so a child had nowhere to go next.
 * This chain walks a new player through the three talking places of the town, one step per goal line:
 *
 *   ask_way      ask the guide (Luna) the way — her answer walks the child to the place (App guideDestination)
 *   trade        trade or buy something from the shop owner (Toby) at the trade shop
 *   three_stars  order at the honey cafe with a ★★★ sentence (docs/04: the better sentence is the cheaper one)
 *
 * A step is done by a passed dialog with that NPC (the result the window hands back, never a guess). Children with a
 * device start after the errand; guests (no server errand) start at once. Progress is this device's own (localStorage):
 * the goals are a tour, not a ledger — coins and items stay on the server.
 */

export type GoalId = 'ask_way' | 'trade' | 'three_stars';
export const GOAL_CHAIN: readonly GoalId[] = ['ask_way', 'trade', 'three_stars'];

export interface GoalDef {
  id: GoalId;
  /** NPC context whose passed dialog completes the step. */
  ctx: 'guide' | 'trade_shop' | 'cafe';
  /** World NPC to walk to, and its scene for worlds without walkToNpc. */
  npcId: string;
  scene: SceneId;
  /** Fewest stars that count (the ★★★ step). */
  minStars: number;
}

export const GOALS: Record<GoalId, GoalDef> = {
  ask_way: { id: 'ask_way', ctx: 'guide', npcId: 'guide', scene: 'plaza', minStars: 1 },
  trade: { id: 'trade', ctx: 'trade_shop', npcId: 'shop_owner', scene: 'trade_shop', minStars: 1 },
  three_stars: { id: 'three_stars', ctx: 'cafe', npcId: 'cafe_owner', scene: 'honey_cafe', minStars: 3 }
};

const KEY = 'lcw.townGoals';

function read(): GoalId[] {
  try {
    const raw = localStorage.getItem(KEY);
    const v = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(v) ? v.filter((x): x is GoalId => GOAL_CHAIN.includes(x as GoalId)) : [];
  } catch {
    return [];
  }
}

function write(done: GoalId[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(done));
  } catch {
    /* private mode: the tour starts over next visit, harmless */
  }
}

/** The step the child is on, or null when the tour is finished. */
export function currentGoal(): GoalDef | null {
  const done = new Set(read());
  const id = GOAL_CHAIN.find((g) => !done.has(g));
  return id ? GOALS[id] : null;
}

type Listener = (g: GoalDef | null, finished: GoalId | null) => void;
const listeners = new Set<Listener>();

export function onGoalChange(cb: Listener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/**
 * A solo dialog finished (App passes the window's result with the NPC it was with). Moves the chain when it is the
 * current step's NPC and the result passed with enough stars; returns the step it completed.
 */
export function noteSoloResult(npcCtx: string, r: { pass: boolean; stars: number }): GoalId | null {
  const g = currentGoal();
  if (!g || !r.pass || npcCtx !== g.ctx || r.stars < g.minStars) return null;
  write([...read(), g.id]);
  const next = currentGoal();
  for (const l of listeners) l(next, g.id);
  return g.id;
}

/** Test seam. */
export function resetGoalsForTest(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

function nameOf(npcId: string): string {
  const p = npcPersona(npcId);
  return (learnLang() === 'en' ? p?.nameEn : p?.nameKoShort) ?? '';
}

/** The goal line on top of the screen, in the language the child learns. */
export function goalLine(g: GoalDef): string {
  const F = ui().firstVisit;
  const t = g.id === 'ask_way' ? F.goalAskWay : g.id === 'trade' ? F.goalTrade : F.goalThreeStars;
  return t.replace('{guide}', nameOf('guide')).replace('{shop}', nameOf('shop_owner')).replace('{cafe}', nameOf('cafe_owner'));
}

/** The walk button's label for a step. */
export function goalWalkLabel(g: GoalDef): string {
  const F = ui().firstVisit;
  const emoji = g.id === 'ask_way' ? '🦊' : g.id === 'trade' ? '🏪' : '☕';
  return `${emoji} ${F.walkGiver.replace('{giver}', nameOf(g.npcId))}`;
}
