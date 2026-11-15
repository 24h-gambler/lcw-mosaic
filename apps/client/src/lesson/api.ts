/**
 * Student side of the lesson API (docs/18 §2, docs/19 §4). The token lives in sessionStorage under the same keys the
 * /join fallback screen uses (apps/web/src/lessonApi.ts), so a child moved between /game/ and /join keeps one session.
 * Scores, stars and coins are always the server's (AGENTS 4.7).
 */
import type { LessonDirectorEventKind, LessonHintLevel, LessonSceneId, LessonUtteranceMode } from '@lcw/content';

export const STUDENT_TOKEN_KEY = 'lcw.studentToken';
export const STUDENT_LESSON_KEY = 'lcw.studentLessonId';
export const STUDENT_NICKNAME_KEY = 'lcw.studentNickname';
export const STUDENT_LEVEL_KEY = 'lcw.studentLevel';

export type SttSource = 'browser' | 'keyboard' | 'board' | 'device' | 'workers_ai';
export type PlayerLevel = 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6';

export interface JoinResult {
  student_token: string;
  lesson_id: string;
  player_id: string;
  nickname: string;
  level: PlayerLevel;
}

export interface LessonOffer {
  stars: 1 | 2 | 3;
  text: string;
  hintTags: string[];
}

export interface LessonNpcLine {
  id: string;
  at: number;
  npc_id: string;
  text: string;
  /** Absent today: every line is the director speaking through that NPC (npc-say possesses it). */
  possessed?: boolean;
}

export interface LessonEventRow {
  id: string;
  at: number;
  kind: LessonDirectorEventKind;
  detail: string;
}

export interface StudentLessonState {
  lesson_id: string;
  stage_id: string | null;
  stage_goal_ko: string;
  mode: LessonUtteranceMode;
  scene_id: LessonSceneId;
  npc_id: string;
  hint: LessonHintLevel;
  targets: string[];
  offers: LessonOffer[];
  possessed_npc_id: string | null;
  npc_lines: LessonNpcLine[];
  events: LessonEventRow[];
  /** Row sequence of the last line/event delivered; send it back on the next poll. */
  cursor: number;
  ended: boolean;
  server_now: number;
}

/** Same shape as the /v1/lesson/utterance body (docs/19 §3 UtteranceSubmit). */
export interface UtteranceSubmit {
  target_text: string;
  transcript: string;
  chosen_stars: 1 | 2 | 3;
  hint_level: LessonHintLevel;
  latency_ms: number;
  dur_ms: number;
  stt_source: SttSource;
  confidence: number;
}

const STT_SOURCES: readonly SttSource[] = ['browser', 'keyboard', 'board', 'device', 'workers_ai'];
const HINTS: readonly LessonHintLevel[] = ['full', 'keyword', 'initial', 'picture', 'none'];

/**
 * The dialog domain's panel hands `submit` its own UtteranceSubmit (docs/19 §3, may carry extra fields such as
 * echo/attempt): keep the fields the lesson API takes, clamp numbers, default the rest. Throws on no transcript.
 */
export function readUtteranceSubmit(u: unknown): UtteranceSubmit {
  const o = (u && typeof u === 'object' ? u : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const transcript = str(o.transcript).trim();
  if (!transcript) throw new LessonHttpError(400, 'empty_transcript');
  const stars = Math.round(num(o.chosen_stars));
  return {
    target_text: str(o.target_text),
    transcript,
    chosen_stars: (stars === 2 || stars === 3 ? stars : 1) as 1 | 2 | 3,
    hint_level: HINTS.includes(o.hint_level as LessonHintLevel) ? (o.hint_level as LessonHintLevel) : 'full',
    latency_ms: Math.max(0, Math.round(num(o.latency_ms))),
    dur_ms: Math.max(0, Math.round(num(o.dur_ms))),
    stt_source: STT_SOURCES.includes(o.stt_source as SttSource) ? (o.stt_source as SttSource) : 'browser',
    confidence: Math.min(1, Math.max(0, typeof o.confidence === 'number' ? o.confidence : 0.5))
  };
}

export interface UtteranceResult {
  pass: boolean;
  score: number;
  stars: number;
  feedback_ko: string;
  coins_total: number;
  utterances_today: number;
}

/** docs/19 §3 DialogResult. */
export interface DialogResult {
  pass: boolean;
  stars: number;
  feedbackKo: string;
  coinsTotal?: number;
}

export class LessonHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string
  ) {
    super(`${status} ${code}`);
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface StudentSession {
  token: string;
  lessonId: string;
  nickname: string;
  level: PlayerLevel;
}

export interface KeyValue {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

export function sessionStore(): KeyValue | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

export function loadStudentSession(store: KeyValue | null = sessionStore()): StudentSession | null {
  try {
    const token = store?.getItem(STUDENT_TOKEN_KEY);
    const lessonId = store?.getItem(STUDENT_LESSON_KEY);
    if (!token || !lessonId) return null;
    return {
      token,
      lessonId,
      nickname: store?.getItem(STUDENT_NICKNAME_KEY) ?? '',
      level: (store?.getItem(STUDENT_LEVEL_KEY) as PlayerLevel | null) ?? 'L1'
    };
  } catch {
    return null;
  }
}

export function saveStudentSession(s: StudentSession | null, store: KeyValue | null = sessionStore()): void {
  try {
    if (!store) return;
    if (!s) {
      for (const k of [STUDENT_TOKEN_KEY, STUDENT_LESSON_KEY, STUDENT_NICKNAME_KEY, STUDENT_LEVEL_KEY]) store.removeItem(k);
      return;
    }
    store.setItem(STUDENT_TOKEN_KEY, s.token);
    store.setItem(STUDENT_LESSON_KEY, s.lessonId);
    store.setItem(STUDENT_NICKNAME_KEY, s.nickname);
    store.setItem(STUDENT_LEVEL_KEY, s.level);
  } catch {
    /* private mode: the session simply lasts as long as the page */
  }
}

/** The current student token in this tab, for other client domains (dialog solo submit). */
export function getStudentToken(store: KeyValue | null = sessionStore()): string | null {
  return loadStudentSession(store)?.token ?? null;
}

/** `?code=123456` in the /game/ URL (link from the director console). */
export function codeFromSearch(search: string): string | null {
  const m = /[?&]code=(\d{6})(?:&|$)/.exec(search);
  return m ? m[1]! : null;
}

export function createStudentLessonApi(opts: { fetch?: FetchLike; base?: string } = {}) {
  const f: FetchLike = opts.fetch ?? ((i, init) => globalThis.fetch(i, init));
  const base = opts.base ?? '';
  async function request<T>(method: string, path: string, token: string | null, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await f(`${base}${path}`, {
        method,
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(body === undefined ? {} : { 'content-type': 'application/json' })
        },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    } catch {
      throw new LessonHttpError(0, 'network');
    }
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new LessonHttpError(res.status, data.error ?? `http_${res.status}`);
    return data as T;
  }
  return {
    join: (code: string) => request<JoinResult>('POST', '/v1/join', null, { code }),
    state: (token: string, q: { cursor?: number | null; scene?: string; ui?: '3d' | 'cards' } = {}) => {
      const p = new URLSearchParams();
      if (q.cursor !== undefined && q.cursor !== null) p.set('cursor', String(Math.floor(q.cursor)));
      if (q.scene) p.set('scene', q.scene);
      if (q.ui) p.set('ui', q.ui);
      const qs = p.toString();
      return request<StudentLessonState>('GET', `/v1/lesson/state${qs ? `?${qs}` : ''}`, token);
    },
    utterance: (token: string, u: UtteranceSubmit) => request<UtteranceResult>('POST', '/v1/lesson/utterance', token, u)
  };
}

export type StudentLessonApi = ReturnType<typeof createStudentLessonApi>;

/** DialogPanel `submit` for a lesson (docs/19 §3): the server scores, the panel only shows the result. */
export function makeLessonSubmit(api: StudentLessonApi, token: string): (u: UtteranceSubmit) => Promise<DialogResult> {
  return async (u) => {
    const r = await api.utterance(token, u);
    return { pass: r.pass, stars: r.stars, feedbackKo: r.feedback_ko, coinsTotal: r.coins_total };
  };
}
