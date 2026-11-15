/**
 * Typed client for the lesson-mode API (docs/18 §2). Same-origin JSON; every non-2xx response throws a LessonApiError
 * whose message is the server `error` code, so screens can map codes to friendly copy and offer a retry.
 */
import type { LessonPlan, LessonUtteranceMode } from '@lcw/content';

export type PlayerLevel = 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6';
export type PinKind = 'expression' | 'coaching' | 'highlight';
export type HintLevel = 'full' | 'keyword' | 'initial' | 'picture' | 'none';
export type SttSource = 'browser' | 'keyboard' | 'board' | 'device' | 'workers_ai';

export interface AdminStudent {
  player_id: string;
  nickname: string;
  level: PlayerLevel | string;
  birth_year: number | null;
  family_id: string;
  last_lesson_at: number | null;
  utterances_7d: number;
}

export interface CreatePlayerInput {
  family_id: string;
  guardian_id: string;
  player_id: string;
  nickname: string;
  birth_year?: number;
  level?: PlayerLevel;
}

export interface StartLessonResult {
  lesson_id: string;
  join_code: string;
  expires_at: number;
  plan: LessonPlan;
}

export interface StagePushInput {
  stage_id: string;
  targets: string[];
}

export interface PinInput {
  kind: PinKind;
  at_ms: number;
  note: string;
}

export interface FeedUtterance {
  id: string;
  at: number;
  target_text: string;
  transcript: string;
  stars: number;
  score: number;
  pass: boolean;
  hint_level: string;
  mode: string;
}

export interface FeedPin {
  id: string;
  kind: PinKind;
  at_ms: number;
  note: string;
}

export interface FeedLive {
  utterances: number;
  passes: number;
  stars_total: number;
  words_total: number;
  student_speaking_ms: number;
}

export interface LessonFeed {
  lesson: {
    id: string;
    player_id: string;
    nickname: string;
    started_at: number;
    ended_at: number | null;
    stage_id: string | null;
    targets: string[];
  };
  utterances: FeedUtterance[];
  pins: FeedPin[];
  live: FeedLive;
}

export interface EndLessonInput {
  teacher_comment?: string;
  next_lesson_at?: string;
  expires_at?: number;
}

export interface EndLessonResult {
  report_path: string;
  share_token: string;
  facts: Record<string, unknown>;
}

export interface StudentDailyRow {
  day: string;
  utterances: number;
  passes: number;
  words: number;
  speaking_ms: number;
  lessons: number;
}

export interface DailySummary {
  day: string;
  students: Array<{
    player_id: string;
    nickname: string;
    utterances: number;
    passes: number;
    words: number;
    speaking_ms: number;
    lessons: number;
    last_at: number | null;
  }>;
}

export interface JoinResult {
  student_token: string;
  lesson_id: string;
  player_id: string;
  nickname: string;
  level: string;
}

export interface StudentLessonState {
  lesson_id: string;
  stage_id: string | null;
  targets: string[];
  ended: boolean;
  /** Extra fields the server sends for the child screen (docs/18 §2 keeps the core four). */
  mode?: LessonUtteranceMode;
  stage_goal_ko?: string;
}

export interface UtteranceInput {
  target_text: string;
  transcript: string;
  chosen_stars: 1 | 2 | 3;
  hint_level: HintLevel;
  latency_ms: number;
  dur_ms: number;
  stt_source: SttSource;
  confidence: number;
}

export interface UtteranceResult {
  pass: boolean;
  score: number;
  stars: number;
  feedback_ko: string;
  coins_total: number;
  utterances_today: number;
}

export interface SharedReport {
  kind: string;
  ref_id: string;
  facts: Record<string, unknown>;
  body: string;
  clips: unknown[];
  created_at: number;
  teacher_comment?: string;
  next_lesson_at?: string;
}

/** Network failure (no response) uses this code so screens can say "check the connection". */
export const NETWORK_ERROR_CODE = 'network';

export class LessonApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(code: string, status: number) {
    super(code);
    this.name = 'LessonApiError';
    this.code = code;
    this.status = status;
  }
}

export function errorCodeOf(e: unknown): string {
  if (e instanceof LessonApiError) return e.code;
  if (e instanceof Error && e.message) return e.message;
  return 'unknown';
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface LessonApiOptions {
  fetch?: FetchLike;
  /** Prefix for every path; '' means same origin. */
  base?: string;
}

const parseMaybeJson = (v: unknown): unknown => {
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
};

export function createLessonApi(opts: LessonApiOptions = {}) {
  const base = opts.base ?? '';
  const doFetch: FetchLike =
    opts.fetch ?? ((input, init) => globalThis.fetch(input, init));

  async function request<T>(method: 'GET' | 'POST', path: string, token: string | null, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: 'no-store'
      });
    } catch {
      throw new LessonApiError(NETWORK_ERROR_CODE, 0);
    }
    let data: unknown = null;
    const text = await res.text().catch(() => '');
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }
    if (!res.ok) {
      const code =
        data && typeof data === 'object' && typeof (data as { error?: unknown }).error === 'string'
          ? (data as { error: string }).error
          : `http_${res.status}`;
      throw new LessonApiError(code, res.status);
    }
    return data as T;
  }

  const enc = encodeURIComponent;

  return {
    listStudents: (op: string) => request<AdminStudent[]>('GET', '/v1/admin/students', op),
    createPlayer: (op: string, input: CreatePlayerInput) =>
      request<{ ok: boolean }>('POST', '/v1/admin/players', op, input),
    startLesson: (op: string, input: { player_id: string; plan_id?: string }) =>
      request<StartLessonResult>('POST', '/v1/admin/lessons/start', op, input),
    pushStage: (op: string, lessonId: string, input: StagePushInput) =>
      request<{ ok: boolean }>('POST', `/v1/admin/lessons/${enc(lessonId)}/stage`, op, input),
    addPin: (op: string, lessonId: string, input: PinInput) =>
      request<{ ok: boolean; id: string }>('POST', `/v1/admin/lessons/${enc(lessonId)}/pins`, op, input),
    feed: (op: string, lessonId: string, since: number) =>
      request<LessonFeed>('GET', `/v1/admin/lessons/${enc(lessonId)}/feed?since=${Math.max(0, Math.floor(since))}`, op),
    endLesson: (op: string, lessonId: string, input: EndLessonInput) =>
      request<EndLessonResult>('POST', `/v1/admin/lessons/${enc(lessonId)}/end`, op, input),
    studentDaily: (op: string, playerId: string, days = 14) =>
      request<StudentDailyRow[]>('GET', `/v1/admin/students/${enc(playerId)}/daily?days=${days}`, op),
    daily: (op: string, day?: string) =>
      request<DailySummary>('GET', `/v1/admin/daily${day ? `?day=${enc(day)}` : ''}`, op),
    join: (code: string) => request<JoinResult>('POST', '/v1/join', null, { code }),
    lessonState: (studentToken: string) => request<StudentLessonState>('GET', '/v1/lesson/state', studentToken),
    postUtterance: (studentToken: string, input: UtteranceInput) =>
      request<UtteranceResult>('POST', '/v1/lesson/utterance', studentToken, input),
    /** With the operator token (director preview) the server does not record a parent open. */
    getReport: async (token: string, previewOp: string | null = null): Promise<SharedReport> => {
      const r = await request<SharedReport>(
        'GET',
        `/v1/reports/${enc(token)}${previewOp ? '?preview=1' : ''}`,
        previewOp
      );
      // Older servers return facts/clips as stored JSON text.
      const facts = parseMaybeJson(r.facts);
      const clips = parseMaybeJson(r.clips);
      return {
        ...r,
        facts: facts && typeof facts === 'object' ? (facts as Record<string, unknown>) : {},
        clips: Array.isArray(clips) ? clips : []
      };
    }
  };
}

export type LessonApi = ReturnType<typeof createLessonApi>;

/* ---------- device storage (try/catch: private mode and SSR have no storage) ---------- */

export const OPERATOR_TOKEN_KEY = 'lcw.operatorToken';
export const STUDENT_TOKEN_KEY = 'lcw.studentToken';
export const STUDENT_LESSON_KEY = 'lcw.studentLessonId';
export const STUDENT_NICKNAME_KEY = 'lcw.studentNickname';
/** The teacher's running lesson survives a page reload during class. */
export const DIRECTOR_LESSON_KEY = 'lcw.directorLesson';

export interface KeyValue {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

function storageOf(kind: 'localStorage' | 'sessionStorage'): KeyValue | null {
  try {
    const s = (globalThis as unknown as Record<string, KeyValue | undefined>)[kind];
    return s ?? null;
  } catch {
    return null;
  }
}

export function readKey(store: KeyValue | null, key: string): string | null {
  if (!store) return null;
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}

export function writeKey(store: KeyValue | null, key: string, value: string | null): boolean {
  if (!store) return false;
  try {
    if (value === null) store.removeItem(key);
    else store.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export const localStore = (): KeyValue | null => storageOf('localStorage');
export const sessionStore = (): KeyValue | null => storageOf('sessionStorage');

export function loadOperatorToken(store: KeyValue | null = localStore()): string | null {
  const v = readKey(store, OPERATOR_TOKEN_KEY);
  return v && v.trim() ? v.trim() : null;
}

export function saveOperatorToken(token: string | null, store: KeyValue | null = localStore()): boolean {
  return writeKey(store, OPERATOR_TOKEN_KEY, token && token.trim() ? token.trim() : null);
}

export interface StudentSession {
  token: string;
  lessonId: string;
  nickname: string;
}

export function loadStudentSession(store: KeyValue | null = sessionStore()): StudentSession | null {
  const token = readKey(store, STUDENT_TOKEN_KEY);
  const lessonId = readKey(store, STUDENT_LESSON_KEY);
  if (!token || !lessonId) return null;
  return { token, lessonId, nickname: readKey(store, STUDENT_NICKNAME_KEY) ?? '' };
}

export function saveStudentSession(s: StudentSession | null, store: KeyValue | null = sessionStore()): void {
  writeKey(store, STUDENT_TOKEN_KEY, s ? s.token : null);
  writeKey(store, STUDENT_LESSON_KEY, s ? s.lessonId : null);
  writeKey(store, STUDENT_NICKNAME_KEY, s ? s.nickname : null);
}

export interface DirectorLessonRecord {
  lesson_id: string;
  join_code: string;
  expires_at: number;
  plan_id: string;
  player_id: string;
  nickname: string;
  /** Client clock when the lesson started; the feed's started_at replaces it once it arrives. */
  started_at: number;
  stage_id: string | null;
  stage_started_at: number | null;
  /** Time spent on stages already left (ms), so the rail can show per-stage elapsed after a reload. */
  stage_ms: Record<string, number>;
  report_path: string | null;
}

export function loadDirectorLesson(store: KeyValue | null = localStore()): DirectorLessonRecord | null {
  const raw = readKey(store, DIRECTOR_LESSON_KEY);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<DirectorLessonRecord>;
    if (typeof v.lesson_id !== 'string' || typeof v.join_code !== 'string') return null;
    return {
      lesson_id: v.lesson_id,
      join_code: v.join_code,
      expires_at: Number(v.expires_at ?? 0),
      plan_id: typeof v.plan_id === 'string' ? v.plan_id : 'first_lesson_v1',
      player_id: String(v.player_id ?? ''),
      nickname: String(v.nickname ?? ''),
      started_at: Number(v.started_at ?? 0),
      stage_id: typeof v.stage_id === 'string' ? v.stage_id : null,
      stage_started_at: typeof v.stage_started_at === 'number' ? v.stage_started_at : null,
      stage_ms: v.stage_ms && typeof v.stage_ms === 'object' ? (v.stage_ms as Record<string, number>) : {},
      report_path: typeof v.report_path === 'string' ? v.report_path : null
    };
  } catch {
    return null;
  }
}

export function saveDirectorLesson(rec: DirectorLessonRecord | null, store: KeyValue | null = localStore()): void {
  writeKey(store, DIRECTOR_LESSON_KEY, rec ? JSON.stringify(rec) : null);
}
