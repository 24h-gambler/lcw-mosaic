/**
 * Which sentences a market hall NPC offers right now (docs/04 4.2), from the server's PlayState. The sentences are
 * the shared phrase bank's (play-bank.ts); the dialog domain scores them as usual and the server play module turns
 * the granted stars into a job, pay or coins. When there is nothing to say yet (office closed, no suit), the NPC
 * answers with a bubble and the layer says why in Korean: no dialog opens.
 */
import {
  BOSS_QUESTIONS,
  CUSTOMER_SCENARIOS,
  EXCHANGE_ORES,
  INTERVIEW_QUESTIONS,
  NEGOTIATION,
  PHRASE_BANK,
  bankEntriesFor,
  bankItemKey,
  type InterviewTurn,
  type LangLevel
} from '@lcw/content';
import type { NpcContext } from '@lcw/schemas';
import type { NpcRef } from '../world/api.js';
import type { PlayState } from './api.js';
import { PLAY_KO } from './strings.js';

export interface PlayOffer {
  stars: 1 | 2 | 3;
  text: string;
  hintTags: string[];
}

export type PlayDialog =
  | { kind: 'dialog'; npc: NpcRef; offers: PlayOffer[]; npcLine: string }
  | { kind: 'gate'; lineEn: string; ko: string };

/** NPC ids of the play domain (town.ts NPC_DEFS, play-sites.ts). */
export const PLAY_NPC_IDS: ReadonlySet<string> = new Set(['tailor', 'maker', 'exchange_clerk', 'office_boss', 'office_customer']);

/** The bank's three sentences for one item of a context, at the child's level (nearest level when missing). */
export function playOffers(ctx: string, key: string, level: LangLevel): PlayOffer[] {
  const same = PHRASE_BANK.find((e) => e.ctx === ctx && e.level === level && bankItemKey(e) === key);
  const entry =
    same ??
    bankEntriesFor(ctx, level).find((e) => bankItemKey(e) === key) ??
    PHRASE_BANK.filter((e) => e.ctx === ctx && bankItemKey(e) === key).sort((a, b) => Math.abs(Number(a.level.slice(1)) - Number(level.slice(1))) - Math.abs(Number(b.level.slice(1)) - Number(level.slice(1))))[0];
  if (!entry) return [];
  return entry.offers.map((o) => ({ stars: o.stars, text: o.text, hintTags: entry.hintTags }));
}

const as = (npc: NpcRef, ctx: NpcContext): NpcRef => (npc.ctx === ctx ? npc : { ...npc, ctx });

/**
 * The dialog of a play NPC. `state` is null for a guest (no token): the counters still talk (practice, nothing is
 * granted, docs/19 3) so a guest hears how the hall works.
 */
export function playDialogFor(npc: NpcRef, state: PlayState | null, level: LangLevel): PlayDialog | null {
  if (!PLAY_NPC_IDS.has(npc.id)) return null;
  if (npc.id === 'tailor') return { kind: 'dialog', npc, offers: playOffers('boutique', 'suit', level), npcLine: 'Welcome! Do you need something nice to wear?' };
  if (npc.id === 'maker') {
    const tool = state && state.tool_tier >= 2 ? 'drill' : 'pickaxe';
    return { kind: 'dialog', npc, offers: playOffers('makers_lab', tool, level), npcLine: 'Hi! I make tools for the mine. What do you need?' };
  }
  if (npc.id === 'exchange_clerk') {
    // the ore the child carries most of; a guest practises with coal
    const carried = state ? EXCHANGE_ORES.map((o) => ({ key: o.key, n: state.ores[o.key] ?? 0 })).filter((o) => o.n > 0).sort((a, b) => b.n - a.n) : [];
    if (state && carried.length === 0) return { kind: 'gate', lineEn: 'Bring me some ore from the mine, and I will buy it!', ko: PLAY_KO.gate.no_ore };
    const ore = carried[0]?.key ?? 'coal';
    const price = state?.market[ore];
    return {
      kind: 'dialog',
      npc,
      offers: playOffers('exchange', ore, level),
      npcLine: price ? `Today I pay ${price} coins for each piece. How many do you want to sell?` : 'What do you want to sell today?'
    };
  }
  const hours = state?.clock.hours ?? 'on_time';
  if (npc.id === 'office_boss') {
    if (!state) return { kind: 'dialog', npc: as(npc, 'interview'), offers: playOffers('interview', 'interview_intro', level), npcLine: INTERVIEW_QUESTIONS.interview_intro };
    if (!state.job.rank && !state.job.has_suit) return { kind: 'gate', lineEn: 'Please come back in a suit for the interview.', ko: PLAY_KO.gate.no_suit };
    if (hours === 'before_open') return { kind: 'gate', lineEn: 'The office opens at eight.', ko: PLAY_KO.gate.before_open(state.clock.hhmm) };
    if (hours === 'closed') return { kind: 'gate', lineEn: 'We are closed now. See you tomorrow morning!', ko: PLAY_KO.gate.closed };
    const next = state.next;
    if (next?.ctx === 'interview') {
      const turn = next.key as InterviewTurn;
      return { kind: 'dialog', npc: as(npc, 'interview'), offers: playOffers('interview', turn, level), npcLine: INTERVIEW_QUESTIONS[turn] ?? INTERVIEW_QUESTIONS.interview_intro };
    }
    if (next?.ctx === 'boss') {
      const key = next.key as 'boss_report' | 'boss_late';
      return { kind: 'dialog', npc: as(npc, 'boss'), offers: playOffers('boss', key, level), npcLine: BOSS_QUESTIONS[key] };
    }
    if (next?.ctx === 'customer') return { kind: 'gate', lineEn: 'A customer needs help. Please go and talk to Ben.', ko: PLAY_KO.gate.customers_waiting };
    return { kind: 'gate', lineEn: 'Great work today! See you tomorrow.', ko: PLAY_KO.gate.day_done };
  }
  // office_customer
  if (!state) {
    const s = CUSTOMER_SCENARIOS[0];
    return { kind: 'dialog', npc: as(npc, 'customer'), offers: playOffers('customer', s.key, level), npcLine: s.lineEn };
  }
  const next = state.next;
  if (next?.ctx === 'customer') {
    const scenario = CUSTOMER_SCENARIOS.find((c) => c.key === next.key);
    const line = scenario?.lineEn ?? (next.key === NEGOTIATION.key ? NEGOTIATION.lineEn : 'Excuse me, can you help me?');
    return { kind: 'dialog', npc: as(npc, 'customer'), offers: playOffers('customer', next.key, level), npcLine: line };
  }
  if (next?.ctx === 'boss') return { kind: 'gate', lineEn: 'Hello! Is the office open yet?', ko: PLAY_KO.gate.clock_in_first };
  return { kind: 'gate', lineEn: 'Hi! I am just looking around.', ko: PLAY_KO.gate.customer_idle };
}

/** The Korean line for what a sentence moved (shown as a toast after the dialog result). */
export function playStepKo(step: { kind: string; blocked?: string; coins?: number; hired?: string; promoted?: string; pay?: number; tip?: number; units?: number; ore?: string; late?: boolean; interview_turn?: string | null }, rankKo: (r: string) => string): string[] {
  const out: string[] = [];
  const R = PLAY_KO.result;
  if (step.blocked) {
    if (step.blocked === 'no_ore' && step.ore) out.push(R.noOre(step.ore));
    else if (step.blocked === 'no_suit') out.push(PLAY_KO.gate.no_suit);
    else if (step.blocked === 'wrong_turn') out.push(R.wrongTurn);
    else if (step.blocked === 'closed') out.push(PLAY_KO.gate.closed);
    return out;
  }
  if (step.kind === 'interview') {
    if (step.hired) out.push(R.hired(rankKo(step.hired), step.coins ?? 0));
    else out.push(R.interviewNext);
  } else if (step.kind === 'shift') {
    out.push(step.late ? R.clockedInLate : R.clockedIn);
  } else if (step.kind === 'customer') {
    out.push(step.tip ? R.tip(step.tip) : R.served);
    if (step.pay) out.push(R.pay(step.pay));
    if (step.promoted) out.push(R.promoted(rankKo(step.promoted)));
  } else if (step.kind === 'exchange' && step.ore) {
    if (step.units && (step.coins ?? 0) > 0) out.push(R.sold(step.units, step.ore, step.coins ?? 0));
  }
  return out;
}
