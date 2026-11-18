import { FIRST_ERRAND, type LangLevel } from '@lcw/content';
import { nextOpeningLine, openingLineFor } from './npc-lines.js';
import { guideAskPlace } from './goals.js';
import { learnLang } from '../world/lang.js';
import { biLine, npcShortName } from './strings.js';
import { bankOffersFor } from './hints.js';
import { SubmitError } from './submit.js';
import type { DialogOffer, NpcRef } from './types.js';

/**
 * The first-visit errand from the child's side (docs/03 D1, docs/08 G15, WP-111). The server owns the state; this
 * module only reads it and picks what the errand giver and the cafe offer for the current step.
 */

export type ErrandState = 'offered' | 'accepted' | 'carrying' | 'done';

export interface ErrandView {
  id: string;
  state: ErrandState;
  item_key: string;
  item_mod: string;
  item_ko: string;
  reward_coins: number;
  npc_line: string;
  started_at: number;
  first_pass_at: number | null;
  first_order_at: number | null;
  done_at: number | null;
}

type Fetch = typeof fetch;

export async function fetchErrand(opts: { token: string; baseUrl?: string; fetchImpl?: Fetch }): Promise<ErrandView> {
  const f = opts.fetchImpl ?? fetch.bind(globalThis);
  let res: Response;
  try {
    res = await f(`${opts.baseUrl ?? ''}/v1/errand`, { headers: { authorization: `Bearer ${opts.token}` } });
  } catch (err) {
    throw new SubmitError('network', err instanceof Error ? err.message : String(err));
  }
  if (res.status === 401 || res.status === 403) throw new SubmitError('auth', `status ${res.status}`);
  if (!res.ok) throw new SubmitError('server', `status ${res.status}`);
  return (await res.json()) as ErrandView;
}

/**
 * Who gives the first errand: the neighbour (cast pack: Mia) at the honey cafe door (world `errand_neighbor`, ctx `errand`, docs/03
 * D1). Luna (guide) stays the guide: asking her the way to the cafe walks the child there.
 */
export const ERRAND_GIVER_CTXS: ReadonlySet<string> = new Set(['errand']);

export interface ErrandDialog {
  npc: NpcRef;
  offers: DialogOffer[];
  npcLine: string;
  /** Voice (and face) of another ctx than `npc.ctx`: the giver asked the way speaks in her own voice. */
  voiceCtx?: string;
}

/**
 * What a solo dialog becomes while the errand runs: the giver asks / waits / takes the drink (ctx `errand`, so the
 * server scores the errand lines), and the cafe offers the asked drink. Null = a normal dialog.
 */
export function errandDialogFor(npc: NpcRef, errand: ErrandView | null, level: LangLevel): ErrandDialog | null {
  if (!errand || errand.state === 'done') {
    // R2625: with no errand running (done, or a guest who has none) she asked for the water again on every visit.
    // Now she points the way like the guide (price-0 "where is" sentences; the answer walks the child there).
    if (!ERRAND_GIVER_CTXS.has(npc.ctx)) return null;
    const as: NpcRef = { ...npc, ctx: 'guide' };
    const line = nextOpeningLine(npc.id, 'errand');
    return { npc: as, offers: bankOffersFor(as, level, guideAskPlace() ?? undefined), npcLine: line === openingLineFor('errand', 0) ? openingLineFor('errand', 1) : line, voiceCtx: 'errand' };
  }
  if (ERRAND_GIVER_CTXS.has(npc.ctx)) {
    // accepted: the giver reminds ("The honey cafe is right over there") and the child can say yes again (no step moves)
    const step = errand.state === 'carrying' ? 'errand_deliver' : 'errand_accept';
    const as: NpcRef = { ...npc, ctx: 'errand' };
    return { npc: as, offers: bankOffersFor(as, level, step), npcLine: errand.npc_line };
  }
  if (npc.ctx === 'cafe' && errand.state === 'accepted') {
    // the order counts as a visit, so the next plain visit greets with a revisit line (R2625)
    return { npc, offers: bankOffersFor(npc, level, FIRST_ERRAND.item, FIRST_ERRAND.mod), npcLine: nextOpeningLine(npc.id, npc.ctx) };
  }
  return null;
}

/** The goal line on top of the screen for each errand step (docs/08 8.1), in the language the child learns. */
export function errandGoalKo(errand: ErrandView): string {
  return biLine((lang, t) => {
    const F = t.firstVisit;
    const item = lang === 'en' ? `${FIRST_ERRAND.mod ? `${FIRST_ERRAND.mod} ` : ''}${FIRST_ERRAND.item}` : errand.item_ko;
    const names = (s: string) => s.replace('{giver}', npcShortName('errand_neighbor', lang)).replace('{cafe}', npcShortName('cafe_owner', lang));
    if (errand.state === 'offered') return names(F.goalErrand);
    if (errand.state === 'accepted') return names(F.goalOrder).replace('{item}', item);
    if (errand.state === 'carrying') return names(F.goalDeliver).replace('{item}', item);
    return F.goalDone;
  });
}

/** The errand giver's short name from the cast pack (npc-cast.ts): English name when the child learns English. */
export function errandGiverNameKo(): string {
  return npcShortName('errand_neighbor', learnLang() === 'en' ? 'en' : 'ko');
}
