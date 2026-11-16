import { NPC_GENERIC_REACTIONS, NPC_OPENING_LINES, NPC_REVISIT_LINES, UI_STRINGS_EN, UI_STRINGS_KO } from '@lcw/content';
import { evaluateOpenEndedAnswer, pickOpenEndedPrompt, shouldTriggerOpenEndedQuestion } from '@lcw/converse';
import { noteSoloResult } from './goals.js';
import type { DialogResult, Level, NpcRef, UtteranceSubmit } from './types.js';

/**
 * What a solo NPC says, visit by visit (R2625, Dan 11-16: "계속 반복되는 말만 나와서"). The first visit hears the NPC's
 * own greeting, later visits go round its revisit lines, and every fifth passed talk the NPC asks one open question in
 * the same window (docs/04 4.10 "한 마디 더": optional, no penalty, recorded as free talk). Counts are this device's.
 */

const VISITS_KEY = 'lcw.npcVisits';
const TURNS_KEY = 'lcw.soloTalks';

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeJson(key: string, v: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* private mode: every visit is the first, harmless */
  }
}

/** The line for visit `n` (0 = first) with an NPC of `ctx`: the greeting, then the revisit lines in turn. */
export function openingLineFor(ctx: string, n: number): string {
  const first = NPC_OPENING_LINES[ctx] ?? NPC_OPENING_LINES.guide!;
  const more = NPC_REVISIT_LINES[ctx] ?? [];
  if (n <= 0 || more.length === 0) return first;
  return more[(n - 1) % more.length]!;
}

/** Counts one opened window with this NPC and returns the line it opens with. */
export function nextOpeningLine(npcId: string, ctx: string): string {
  const visits = readJson<Record<string, number>>(VISITS_KEY, {});
  const n = typeof visits[npcId] === 'number' ? visits[npcId]! : 0;
  writeJson(VISITS_KEY, { ...visits, [npcId]: n + 1 });
  return openingLineFor(ctx, n);
}

/**
 * The open question for the window opening now, or none. The question comes after this window's pass, so the count
 * it is decided on is the talks passed so far plus this one.
 */
export function openQuestionForNextTalk(): string | null {
  const n = readJson<number>(TURNS_KEY, 0) + 1;
  return shouldTriggerOpenEndedQuestion(n) ? pickOpenEndedPrompt(n / 5 - 1) : null;
}

/** A solo window ended with a pass: one more talk on the count. */
export function noteSoloTalkPassed(): void {
  writeJson(TURNS_KEY, readJson<number>(TURNS_KEY, 0) + 1);
}

/**
 * Scores an open-question answer on the device (docs/04 4.10: 2 words at L1~L2, 4 above, grammar not checked). No
 * coins and no item: money stays with the server, and the question is a bonus, never a gate.
 */
export function createOpenAnswerScorer(ctx: string, level: Level): (u: UtteranceSubmit) => Promise<DialogResult> {
  let k = 0;
  return async (u) => {
    const r = evaluateOpenEndedAnswer({ level, ctx: ctx as never, transcript: u.transcript });
    if (!r.pass) return { pass: false, stars: 0, feedbackKo: UI_STRINGS_KO.dialog.openAnswerShort, feedbackEn: UI_STRINGS_EN.dialog.openAnswerShort };
    const reaction = NPC_GENERIC_REACTIONS[k++ % NPC_GENERIC_REACTIONS.length]!;
    return { pass: true, stars: Math.min(3, Math.max(1, Math.floor(r.targetWordCount / 3))), feedbackKo: UI_STRINGS_KO.dialog.openAnswerOk, feedbackEn: reaction };
  };
}

/** What a plain solo window says (no errand step, no lesson): taken once when the window opens (App). */
export interface SoloTalkPlan {
  npcLine: string;
  followUps?: string[];
  followUpSubmit?: (u: UtteranceSubmit) => Promise<DialogResult>;
}

export function soloTalkPlan(npc: NpcRef, level: Level): SoloTalkPlan {
  const npcLine = nextOpeningLine(npc.id, npc.ctx);
  const q = openQuestionForNextTalk();
  return q ? { npcLine, followUps: [q], followUpSubmit: createOpenAnswerScorer(npc.ctx, level) } : { npcLine };
}

/** A solo window finished: the talk count (open questions) and the town goal chain (goals.ts) move on a pass. */
export function noteSoloDone(npcCtx: string, r: { pass: boolean; stars: number }): void {
  if (!r.pass) return;
  noteSoloTalkPassed();
  noteSoloResult(npcCtx, r);
}

/** Test seam. */
export function resetNpcLinesForTest(): void {
  try {
    localStorage.removeItem(VISITS_KEY);
    localStorage.removeItem(TURNS_KEY);
  } catch {
    /* ignore */
  }
}
