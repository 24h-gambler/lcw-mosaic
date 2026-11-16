import { UI_STRINGS_KO } from '@lcw/content';
// notDue stays Korean here like the server's lines: the panel turns every feedback line into the screen language
// (strings.ts feedbackLine, content ui-strings-en feedbackEnFromKo covers the review section).
import type { DialogHint, DialogResult, UtteranceSubmit } from './types.js';
import { SubmitError } from './submit.js';
import { noteSeatResponse } from '../world/seat.js';

/**
 * Memory-card reviews from the child's side (docs/03 D8, docs/09 P4). The server decides everything: which cards
 * show a sign (equipped / recently used gear first, 3 at most), the hint of each box and whether a review passed.
 */

export interface ReviewSignView {
  card_id: string;
  item_key: string;
  item_name_ko: string;
  emoji: string;
  ctx: string;
  text: string;
  hint_tags: string[];
  hint: DialogHint;
  listen: boolean;
  box: number;
  stars: number;
  due_at: number;
  overdue_days: number;
  label_ko: string;
}

export interface ReviewDue {
  signs: ReviewSignView[];
  next_due_at: number | null;
}

type Fetch = typeof fetch;

export async function fetchReviewDue(opts: { token: string; baseUrl?: string; fetchImpl?: Fetch }): Promise<ReviewDue> {
  const f = opts.fetchImpl ?? fetch.bind(globalThis);
  const res = await f(`${opts.baseUrl ?? ''}/v1/review/due`, { headers: { authorization: `Bearer ${opts.token}` } });
  if (res.status === 401 || res.status === 403) throw new SubmitError('auth', `status ${res.status}`);
  if (!res.ok) throw new SubmitError('server', `status ${res.status}`);
  const j = (await res.json()) as Partial<ReviewDue>;
  return { signs: Array.isArray(j.signs) ? j.signs : [], next_due_at: typeof j.next_due_at === 'number' ? j.next_due_at : null };
}

/** `submit` for a DialogPanel opened on one review card: the server scores against the card's own sentence. */
export function createReviewSubmit(opts: { token: string; cardId: string; baseUrl?: string; fetchImpl?: Fetch }) {
  const f = opts.fetchImpl ?? fetch.bind(globalThis);
  return async (u: UtteranceSubmit): Promise<DialogResult> => {
    let res: Response;
    try {
      res = await f(`${opts.baseUrl ?? ''}/v1/review/attempt`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${opts.token}` },
        body: JSON.stringify({
          card_id: opts.cardId,
          transcript: u.transcript,
          stt_source: u.stt_source,
          confidence: u.confidence,
          dur_ms: u.dur_ms,
          latency_ms: u.latency_ms
        })
      });
    } catch (err) {
      throw new SubmitError('network', err instanceof Error ? err.message : String(err));
    }
    if (res.status === 403 && (await noteSeatResponse(res))) throw new SubmitError('auth', 'seat_inactive');
    if (res.status === 401 || res.status === 403) throw new SubmitError('auth', `status ${res.status}`);
    const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.status === 409) {
      // Already fixed elsewhere (another tab) or not due yet: nothing to score.
      return { pass: false, stars: 0, feedbackKo: UI_STRINGS_KO.review.notDue };
    }
    if (!res.ok) throw new SubmitError(res.status === 400 ? 'invalid' : 'server', `status ${res.status}`);
    return {
      pass: j.pass === true,
      stars: typeof j.stars === 'number' ? j.stars : 0,
      feedbackKo: typeof j.feedback_ko === 'string' ? j.feedback_ko : '',
      coinsTotal: typeof j.coins_total === 'number' ? j.coins_total : undefined,
      missed: Array.isArray(j.missed) ? (j.missed.filter((x) => typeof x === 'string') as string[]) : undefined,
      matchedText: typeof j.matched_text === 'string' ? j.matched_text : undefined
    };
  };
}

/** Ms until the client should ask again: the next due card (20-minute review of this session), else a minute. */
export function nextPollDelay(due: ReviewDue, nowMs: number, fallbackMs = 60_000): number {
  if (due.next_due_at === null) return fallbackMs;
  return Math.max(1_000, Math.min(fallbackMs * 5, due.next_due_at - nowMs + 500));
}
