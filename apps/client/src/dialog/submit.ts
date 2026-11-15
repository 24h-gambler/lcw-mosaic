import type { DialogResult, NpcRef, UtteranceSubmit } from './types.js';

/**
 * The two `submit` paths of docs/19 3. Both are server-scored; the client never computes stars or coins.
 * - lesson: POST /v1/lesson/utterance with the student token (docs/18 2)
 * - solo:   POST /v1/converse/score with the same token; the server forces player, world and level (AGENTS 4.7)
 */

export class SubmitError extends Error {
  constructor(
    readonly kind: 'network' | 'auth' | 'server',
    message: string
  ) {
    super(message);
  }
}

type Fetch = typeof fetch;

async function postJson(fetchImpl: Fetch, url: string, token: string, body: unknown): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body)
    });
  } catch (err) {
    throw new SubmitError('network', err instanceof Error ? err.message : String(err));
  }
  if (res.status === 401 || res.status === 403) throw new SubmitError('auth', `status ${res.status}`);
  if (!res.ok) throw new SubmitError('server', `status ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

export function lessonBody(u: UtteranceSubmit): Omit<UtteranceSubmit, 'echo' | 'attempt'> {
  const { echo: _e, attempt: _a, ...body } = u;
  return body;
}

export function createLessonSubmit(opts: { token: string; baseUrl?: string; fetchImpl?: Fetch }) {
  const f = opts.fetchImpl ?? fetch.bind(globalThis);
  return async (u: UtteranceSubmit): Promise<DialogResult> => {
    const j = await postJson(f, `${opts.baseUrl ?? ''}/v1/lesson/utterance`, opts.token, lessonBody(u));
    return {
      pass: j.pass === true,
      stars: num(j.stars) ?? 0,
      feedbackKo: typeof j.feedback_ko === 'string' ? j.feedback_ko : '',
      coinsTotal: num(j.coins_total)
    };
  };
}

export function createSoloSubmitWith(opts: {
  token: string;
  npc: NpcRef;
  baseUrl?: string;
  fetchImpl?: Fetch;
  /** Injected for tests; one id per opened dialog. */
  dialogId?: string;
}) {
  const f = opts.fetchImpl ?? fetch.bind(globalThis);
  const dialogId = opts.dialogId ?? `dlg_${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  return async (u: UtteranceSubmit): Promise<DialogResult> => {
    if (!opts.token) throw new SubmitError('auth', 'no_student_token');
    if (!u.target_text) throw new SubmitError('server', 'free_talk_needs_a_target');
    const j = await postJson(f, `${opts.baseUrl ?? ''}/v1/converse/score`, opts.token, {
      dialog_id: dialogId,
      npc_ctx: opts.npc.ctx,
      target_text: u.target_text,
      transcript: u.transcript,
      chosen_stars: u.chosen_stars,
      hint_level: u.hint_level,
      latency_ms: u.latency_ms,
      dur_ms: u.dur_ms,
      stt_source: u.stt_source,
      confidence: u.confidence,
      echo: u.echo ?? false,
      attempts: u.attempt ?? 1,
      mode: u.hint_level === 'full' ? 'read' : u.hint_level === 'none' ? 'free' : 'guided'
    });
    return {
      pass: j.pass === true,
      stars: num(j.stars) ?? 0,
      feedbackKo: typeof j.feedback_ko === 'string' ? j.feedback_ko : '',
      coinsTotal: num(j.coins_total),
      missed: Array.isArray(j.missed) ? (j.missed.filter((x) => typeof x === 'string') as string[]) : undefined,
      itemKey:
        j.granted && typeof (j.granted as { item_id?: unknown }).item_id === 'string'
          ? (j.granted as { item_id: string }).item_id
          : undefined
    };
  };
}

/**
 * Where the lesson domain (and apps/web /join) keeps the student token after /v1/join (docs/19 4). Swap for
 * lesson/api.ts getStudentToken() once that is on main.
 */
export const STUDENT_TOKEN_KEY = 'lcw.studentToken';

export function readStudentToken(): string | null {
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(STUDENT_TOKEN_KEY) : null;
  } catch {
    return null;
  }
}

/** Solo submit for the world domain (docs/19 3): the student token is read at call time. */
export function createSoloSubmit(npc: NpcRef): (u: UtteranceSubmit) => Promise<DialogResult> {
  const inner = createSoloSubmitWith({ token: '', npc });
  let bound: ((u: UtteranceSubmit) => Promise<DialogResult>) | null = null;
  let boundToken = '';
  return (u) => {
    const token = readStudentToken() ?? '';
    if (!token) return inner(u);
    if (!bound || token !== boundToken) {
      bound = createSoloSubmitWith({ token, npc });
      boundToken = token;
    }
    return bound(u);
  };
}
