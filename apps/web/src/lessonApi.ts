/**
 * Typed client for the lesson-mode API (docs/18 §2). Same-origin JSON; every non-2xx response throws a LessonApiError
 * whose message is the server `error` code, so screens can map codes to friendly copy and offer a retry.
 */
import type { LessonDirectorEventKind, LessonPlan, LessonUtteranceMode } from '@lcw/content';
import type { FeedLiveExtra } from './directorLiveState.js';

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

/** GET /v1/admin/lessons/live row: a running lesson, whichever device started it (server clock). */
export interface LiveLessonRow {
  lesson_id: string;
  join_code: string;
  expires_at: number;
  plan_id: string;
  player_id: string;
  nickname: string;
  started_at: number;
  stage_id: string | null;
  stage_started_at: number | null;
  stage_ms: Record<string, number>;
}

/**
 * A running lesson as this console's record. The console counts elapsed time on its own clock, so server times move
 * by (client now − server now): another device's clock being off does not show a wrong stage time.
 */
export function recordFromLive(row: LiveLessonRow, serverNow: number, clientNow: number): DirectorLessonRecord {
  const shift = clientNow - serverNow;
  return {
    lesson_id: row.lesson_id,
    join_code: row.join_code,
    expires_at: row.expires_at,
    plan_id: row.plan_id,
    player_id: row.player_id,
    nickname: row.nickname,
    started_at: row.started_at + shift,
    stage_id: row.stage_id,
    stage_started_at: row.stage_started_at === null ? null : row.stage_started_at + shift,
    stage_ms: { ...row.stage_ms },
    report_path: null
  };
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

/** Whether a teacher is with the child (edge lesson-mode.ts TeacherPresence: the console heartbeat). */
export interface TeacherPresence {
  present: boolean;
  name: string | null;
  since: number | null;
  /** Director feed only: false = a lesson from a console without heartbeat, present by rule. */
  tracked?: boolean;
  panel?: 'open' | 'closed' | null;
}

export interface LessonFeed {
  /** Absent on an older server. */
  teacher?: TeacherPresence;
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
  /** The guardian's voice_store consent (edge voice.ts): record spoken turns for the guardian's replay. */
  voice_store?: boolean;
}

export interface StudentLessonState {
  lesson_id: string;
  stage_id: string | null;
  targets: string[];
  ended: boolean;
  /** Extra fields the server sends for the child screen (docs/18 §2 keeps the core four). */
  mode?: LessonUtteranceMode;
  stage_goal_ko?: string;
  /** The child's one coin balance (home-world ledger), same as the 3D HUD. */
  coins_balance?: number | null;
  /** With the teacher now, or alone ("혼자 놀기"); absent on an older server = with the teacher. */
  teacher?: TeacherPresence;
  /** The lesson's plan (1PC teacher panel on this screen); absent on an older server. */
  plan_id?: string;
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
  /** One id per answer (packages/content lesson-outbox): a resend is the same answer on the server. */
  client_id?: string;
  /** The stage the child answered in (an answer kept offline may arrive after the teacher moved on). */
  stage_id?: string;
}

export interface UtteranceResult {
  pass: boolean;
  score: number;
  stars: number;
  feedback_ko: string;
  coins_total: number;
  utterances_today: number;
  /** Speech turn with voice_store on: POST the recorded turn once to /v1/voice/upload/<token> (edge voice.ts). */
  audio_upload?: { token: string; max_bytes: number; expires_at: number };
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
  /** Share links live 30 days (docs/16 §2-18). */
  expires_at?: number;
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
    liveLessons: (op: string, includeTest = false) =>
      request<{ lessons: LiveLessonRow[]; server_now: number }>('GET', `/v1/admin/lessons/live${includeTest ? '?include_test=1' : ''}`, op),
    createPlayer: (op: string, input: CreatePlayerInput) =>
      request<{ ok: boolean }>('POST', '/v1/admin/players', op, input),
    startLesson: (op: string, input: { player_id: string; plan_id?: string; presence?: boolean }) =>
      request<StartLessonResult>('POST', '/v1/admin/lessons/start', op, input),
    /** Teacher heartbeat (every TEACHER_BEAT_MS while the console shows the lesson). */
    /** The console's heartbeat. After "선생님 나가기" it counts again only with resume (left: true until then). */
    /** name: the name alone ('' clears it), null = say nothing about the name. */
    presence: (op: string, lessonId: string, panel: 'open' | 'closed' = 'open', resume = false, name: string | null = null) =>
      request<{ teacher: TeacherPresence; left?: boolean; beat_ms: number; present_ms: number }>(
        'POST',
        `/v1/admin/lessons/${enc(lessonId)}/presence`,
        op,
        { panel, source: 'console', ...(resume ? { resume: true } : {}), ...(name !== null ? { name } : {}) }
      ),
    /** The teacher steps away on purpose: the child is alone at once. */
    leave: (op: string, lessonId: string) =>
      request<{ teacher: TeacherPresence }>('POST', `/v1/admin/lessons/${enc(lessonId)}/presence/leave`, op, {}),
    /** 1PC teacher panel lock number (4-6 digits), checked on the server. */
    setPanelPin: (op: string, lessonId: string, pin: string) =>
      request<{ ok: boolean }>('POST', `/v1/admin/lessons/${enc(lessonId)}/panel-pin`, op, { pin }),
    panelPinState: (op: string, lessonId: string) =>
      request<{ set: boolean; set_at: number | null }>('GET', `/v1/admin/lessons/${enc(lessonId)}/panel-pin`, op),
    panelUnlock: (op: string, lessonId: string, pin: string) =>
      request<{ ok: boolean }>('POST', `/v1/admin/lessons/${enc(lessonId)}/panel-unlock`, op, { pin }),
    pushStage: (op: string, lessonId: string, input: StagePushInput) =>
      request<{ ok: boolean }>('POST', `/v1/admin/lessons/${enc(lessonId)}/stage`, op, input),
    addPin: (op: string, lessonId: string, input: PinInput) =>
      request<{ ok: boolean; id: string }>('POST', `/v1/admin/lessons/${enc(lessonId)}/pins`, op, input),
    feed: (op: string, lessonId: string, since: number, liveCursor = 0) =>
      request<LessonFeed & FeedLiveExtra>(
        'GET',
        `/v1/admin/lessons/${enc(lessonId)}/feed?since=${Math.max(0, Math.floor(since))}&live_cursor=${Math.max(0, Math.floor(liveCursor))}`,
        op
      ),
    npcSay: (op: string, lessonId: string, input: { npc_id: string; text: string }) =>
      request<{ ok: boolean; id: string; at: number }>('POST', `/v1/admin/lessons/${enc(lessonId)}/npc-say`, op, input),
    possess: (op: string, lessonId: string, npcId: string | null) =>
      request<{ ok: boolean; possessed_npc_id: string | null }>('POST', `/v1/admin/lessons/${enc(lessonId)}/possess`, op, {
        npc_id: npcId
      }),
    fireEvent: (op: string, lessonId: string, input: { kind: LessonDirectorEventKind; detail?: string }) =>
      request<{ ok: boolean; id: string; at: number }>('POST', `/v1/admin/lessons/${enc(lessonId)}/event`, op, input),
    endLesson: (op: string, lessonId: string, input: EndLessonInput) =>
      request<EndLessonResult>('POST', `/v1/admin/lessons/${enc(lessonId)}/end`, op, input),
    studentDaily: (op: string, playerId: string, days = 14) =>
      request<StudentDailyRow[]>('GET', `/v1/admin/students/${enc(playerId)}/daily?days=${days}`, op),
    daily: (op: string, day?: string) =>
      request<DailySummary>('GET', `/v1/admin/daily${day ? `?day=${enc(day)}` : ''}`, op),
    /**
     * Operator CSV export (edge export-csv.ts). It needs the Bearer token, so it cannot be a plain link: the console
     * fetches the file and saves the blob. Without `day` the server uses today in KST.
     */
    exportCsv: async (op: string, kind: 'utterances' | 'lesson-minutes', day?: string): Promise<{ blob: Blob; filename: string }> => {
      const path = `/v1/admin/export/${kind}.csv${day ? `?day=${enc(day)}` : ''}`;
      let res: Response;
      try {
        res = await doFetch(`${base}${path}`, { method: 'GET', headers: { authorization: `Bearer ${op}` }, cache: 'no-store' });
      } catch {
        throw new LessonApiError(NETWORK_ERROR_CODE, 0);
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: unknown } | null;
        throw new LessonApiError(typeof data?.error === 'string' ? data.error : `http_${res.status}`, res.status);
      }
      const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1];
      return { blob: await res.blob(), filename: name ?? `lcw-${kind}.csv` };
    },
    join: (code: string) => request<JoinResult>('POST', '/v1/join', null, { code }),
    /** mic: this tab's one-time lesson mic check (sessionStorage lcw.micStatus, set by the 3D screen), for the console. */
    lessonState: (studentToken: string, mic?: string | null) =>
      request<StudentLessonState>('GET', `/v1/lesson/state${mic ? `?mic=${encodeURIComponent(mic)}` : ''}`, studentToken),
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
/** '1' when /v1/join said voice_store is on (same key as apps/client lesson/api.ts). */
export const STUDENT_VOICE_KEY = 'lcw.studentVoice';
/** Same key as apps/client lesson/api.ts: the level the 3D lesson uses after a /join hand-off. */
export const STUDENT_LEVEL_KEY = 'lcw.studentLevel';
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
  voiceStore?: boolean;
  /** The student's level from /v1/join; the 3D client reads it from the same key (lcw.studentLevel). */
  level?: string;
}

export function loadStudentSession(store: KeyValue | null = sessionStore()): StudentSession | null {
  const token = readKey(store, STUDENT_TOKEN_KEY);
  const lessonId = readKey(store, STUDENT_LESSON_KEY);
  if (!token || !lessonId) return null;
  return { token, lessonId, nickname: readKey(store, STUDENT_NICKNAME_KEY) ?? '', voiceStore: readKey(store, STUDENT_VOICE_KEY) === '1' };
}

export function saveStudentSession(s: StudentSession | null, store: KeyValue | null = sessionStore()): void {
  writeKey(store, STUDENT_TOKEN_KEY, s ? s.token : null);
  writeKey(store, STUDENT_LESSON_KEY, s ? s.lessonId : null);
  writeKey(store, STUDENT_NICKNAME_KEY, s ? s.nickname : null);
  writeKey(store, STUDENT_VOICE_KEY, s?.voiceStore ? '1' : null);
  if (!s || s.level) writeKey(store, STUDENT_LEVEL_KEY, s?.level ?? null);
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
