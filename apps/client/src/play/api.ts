/**
 * Play domain client calls (edge play.ts through the platform): the child's lesson token first, else the linked
 * device token (same order as dialog/submit.ts). No token = a guest: nothing is kept, the layer shows practice only.
 */
import { readStudentToken } from '../dialog/submit.js';
import { noteSeatResponse } from '../world/seat.js';

export type JobRank = 'intern' | 'staff' | 'manager' | 'director';
export type OfficeHours = 'before_open' | 'on_time' | 'late' | 'closed';

/** Mirror of edge play.ts PlayState (server-decided; the client never computes coins, ores or ranks). */
export interface PlayState {
  clock: { day: number; minute: number; hhmm: string; hours: OfficeHours };
  job: {
    rank: JobRank | null;
    progress: { have: number; need: number; next: JobRank | null };
    has_suit: boolean;
    interview_turn: string | null;
    pay: number | null;
  };
  shift: { day: number; late: boolean; served: number; need: number; tips: number; paid: boolean } | null;
  next: { ctx: 'interview' | 'boss' | 'customer'; key: string } | null;
  ores: Record<string, number>;
  market: Record<string, number>;
  tool_tier: number;
  resting: Record<string, number>;
  exchange_total: number;
  coins: number | null;
}

/** What one scored sentence moved (edge play.ts PlayStepResult, carried in the score answer as `play`). */
export interface PlayStep {
  kind: 'interview' | 'shift' | 'customer' | 'exchange';
  blocked?: string;
  coins?: number;
  hired?: JobRank;
  promoted?: JobRank;
  pay?: number;
  tip?: number;
  units?: number;
  /** The same window said it again (edge play.ts retryTurn / sellOre). */
  retry?: 'better' | 'same';
  ore?: string;
  late?: boolean;
  interview_turn?: string | null;
  served?: number;
}

export type MineAnswer =
  | { ok: true; ore: string; vein_id: string; count: number; coins_total: number | null }
  | { ok: false; reason: 'unknown_vein' | 'no_world' | 'tool' | 'resting' | 'too_fast' | 'network' | 'guest' | 'seat'; wait_ms?: number; need_tier?: number };

type Fetch = typeof fetch;

export function playToken(deviceToken?: string): string {
  return readStudentToken() || deviceToken || '';
}

function isState(v: unknown): v is PlayState {
  return !!v && typeof v === 'object' && typeof (v as PlayState).clock?.hhmm === 'string' && typeof (v as PlayState).job === 'object';
}

export async function fetchPlayState(token: string, opts: { beat?: boolean; fetchImpl?: Fetch; baseUrl?: string } = {}): Promise<PlayState | null> {
  if (!token) return null;
  const f = opts.fetchImpl ?? fetch.bind(globalThis);
  const base = opts.baseUrl ?? '';
  try {
    const res = opts.beat
      ? await f(`${base}/v1/play/beat`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: '{}' })
      : await f(`${base}/v1/play/state`, { headers: { authorization: `Bearer ${token}` } });
    if (res.status === 403) await noteSeatResponse(res);
    if (!res.ok) return null;
    const j: unknown = await res.json();
    return isState(j) ? j : null;
  } catch {
    return null;
  }
}

export async function mineVein(token: string, veinId: string, opts: { fetchImpl?: Fetch; baseUrl?: string } = {}): Promise<MineAnswer> {
  if (!token) return { ok: false, reason: 'guest' };
  const f = opts.fetchImpl ?? fetch.bind(globalThis);
  try {
    const res = await f(`${opts.baseUrl ?? ''}/v1/play/mine`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ vein_id: veinId })
    });
    if (res.status === 403 && (await noteSeatResponse(res))) return { ok: false, reason: 'seat' };
    if (!res.ok && res.status !== 400) return { ok: false, reason: 'network' };
    return (await res.json()) as MineAnswer;
  } catch {
    return { ok: false, reason: 'network' };
  }
}
