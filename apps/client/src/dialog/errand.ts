import { FIRST_ERRAND, NPC_OPENING_LINES, UI_STRINGS_KO, npcPersona, type LangLevel } from '@lcw/content';
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
}

/**
 * What a solo dialog becomes while the errand runs: the giver asks / waits / takes the drink (ctx `errand`, so the
 * server scores the errand lines), and the cafe offers the asked drink. Null = a normal dialog.
 */
export function errandDialogFor(npc: NpcRef, errand: ErrandView | null, level: LangLevel): ErrandDialog | null {
  if (!errand || errand.state === 'done') return null;
  if (ERRAND_GIVER_CTXS.has(npc.ctx)) {
    // accepted: the giver reminds ("The honey cafe is right over there") and the child can say yes again (no step moves)
    const step = errand.state === 'carrying' ? 'errand_deliver' : 'errand_accept';
    const as: NpcRef = { ...npc, ctx: 'errand' };
    return { npc: as, offers: bankOffersFor(as, level, step), npcLine: errand.npc_line };
  }
  if (npc.ctx === 'cafe' && errand.state === 'accepted') {
    return { npc, offers: bankOffersFor(npc, level, FIRST_ERRAND.item, FIRST_ERRAND.mod), npcLine: NPC_OPENING_LINES.cafe! };
  }
  return null;
}

/** The goal line on top of the screen for each errand step (Korean, docs/08 8.1). */
export function errandGoalKo(errand: ErrandView): string {
  const F = UI_STRINGS_KO.firstVisit;
  const names = (t: string) => t.replace('{giver}', errandGiverNameKo()).replace('{cafe}', npcPersona('cafe_owner')?.nameKoShort ?? '');
  if (errand.state === 'offered') return names(F.goalErrand);
  if (errand.state === 'accepted') return names(F.goalOrder).replace('{item}', errand.item_ko);
  if (errand.state === 'carrying') return names(F.goalDeliver).replace('{item}', errand.item_ko);
  return F.goalDone;
}

/** The errand giver's short Korean name from the cast pack (npc-cast.ts), for goal lines and the walk button. */
export function errandGiverNameKo(): string {
  return npcPersona('errand_neighbor')?.nameKoShort ?? '';
}
