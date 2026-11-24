/**
 * Pure rules shared by the lesson-mode screens (docs/18): director stage pushes, F1/F2 pins, feed merging, the
 * student join state machine, recall hints and report fact rows. No DOM, no clocks — time and randomness are inputs.
 */
import { LESSON_PLANS, maskInitials, type LessonPlan, type LessonStage, type LessonUtteranceMode } from '@lcw/content';
import { DIRECTOR_BOOKMARK_KEYS } from './director.js';
import type {
  DirectorLessonRecord,
  FeedPin,
  FeedUtterance,
  HintLevel,
  JoinResult,
  LessonFeed,
  PinInput,
  PinKind,
  StagePushInput,
  StudentLessonState,
  UtteranceResult
} from './lessonApi.js';
import { LESSON_STRINGS_KO as L } from './strings.js';

/** Both screens poll the server this often (docs/18 task: 3 s). */
export const LESSON_POLL_MS = 3_000;
/** Server limits (apps/edge lesson-mode schemas) mirrored so the form stops before the server says no. */
export const STAGE_TARGETS_MAX = 6;
export const TARGET_TEXT_MAX = 200;
export const PIN_NOTE_MAX = 300;
export const TEACHER_COMMENT_MAX = 400;
export const NEXT_LESSON_MAX = 60;
export const NICKNAME_MAX = 32;
export const BIRTH_YEAR_MIN = 2005;
export const BIRTH_YEAR_MAX = 2025;

/* ---------- ids ---------- */

/** `prefix-` + 10 base36 chars from the given random source (crypto in the browser, a seed in tests). */
export function randomId(prefix: string, rand: () => number): string {
  let s = '';
  for (let i = 0; i < 10; i++) s += Math.floor(rand() * 36).toString(36);
  return `${prefix}-${s}`;
}

export function newStudentIds(rand: () => number): { player_id: string; family_id: string; guardian_id: string } {
  return { player_id: randomId('stu', rand), family_id: randomId('fam', rand), guardian_id: randomId('gdn', rand) };
}

/** Browser crypto when present; tests pass their own source. */
export function cryptoRand(): number {
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint32Array) => Uint32Array } }).crypto;
  if (c?.getRandomValues) {
    const a = new Uint32Array(1);
    c.getRandomValues(a);
    return a[0]! / 0x1_0000_0000;
  }
  return Math.random();
}

/* ---------- student registration ---------- */

export interface NewStudentForm {
  nickname: string;
  birthYear: string;
  level: 'L1' | 'L2' | 'L3';
}

export function validateNewStudent(f: NewStudentForm): string | null {
  const nick = f.nickname.trim();
  if (!nick) return L.director.errNicknameEmpty;
  if (nick.length > NICKNAME_MAX) return L.director.errNicknameLong;
  if (f.birthYear.trim()) {
    const y = Number(f.birthYear);
    if (!Number.isInteger(y) || y < BIRTH_YEAR_MIN || y > BIRTH_YEAR_MAX) return L.director.errBirthYear;
  }
  return null;
}

/* ---------- join links (docs/19 §4) ---------- */

/**
 * The 3D client (/world/?code=) is the default student path (apps/client/src/lesson joins lessons); /join is the
 * word-card fallback for low-tier devices (docs/19 §4).
 */
export const STUDENT_3D_LESSON_READY = true;

export interface JoinLink {
  kind: '3d' | 'fallback';
  url: string;
}

export function studentJoinLinks(origin: string, code: string, ready3d = STUDENT_3D_LESSON_READY): JoinLink[] {
  const game: JoinLink = { kind: '3d', url: `${origin}/world/?code=${code}` };
  // lite=1: /join sends 3D-capable devices into /world/; the teacher's fallback link stays on the word cards.
  const fallback: JoinLink = { kind: 'fallback', url: `${origin}/join?code=${code}&lite=1` };
  return ready3d ? [game, fallback] : [fallback, game];
}

/** `?code=123456` on /join (the 3D client sends low-tier devices here with the code). */
export function joinCodeFromSearch(search: string): string | null {
  const m = /[?&]code=(\d{6})(?:&|$)/.exec(search);
  return m ? m[1]! : null;
}

/* ---------- director: stages ---------- */

export function planById(id: string | null | undefined): LessonPlan {
  return LESSON_PLANS.find((p) => p.id === id) ?? LESSON_PLANS[0]!;
}

export function stageById(plan: LessonPlan, id: string | null | undefined): LessonStage | null {
  return plan.stages.find((s) => s.id === id) ?? null;
}

export function nextStage(plan: LessonPlan, id: string | null | undefined): LessonStage | null {
  const i = plan.stages.findIndex((s) => s.id === id);
  return i >= 0 ? plan.stages[i + 1] ?? null : plan.stages[0] ?? null;
}

/**
 * The payload the teacher sends when a stage goes up: chosen plan sentences in plan order, then the teacher's own
 * lines, trimmed, de-duplicated, clipped to the server's limits.
 */
export function buildStagePush(
  stage: LessonStage,
  chosen: ReadonlySet<string>,
  custom: readonly string[] = []
): StagePushInput {
  const out: string[] = [];
  const add = (t: string) => {
    const v = t.trim().replace(/\s+/g, ' ').slice(0, TARGET_TEXT_MAX);
    if (v && !out.includes(v) && out.length < STAGE_TARGETS_MAX) out.push(v);
  };
  for (const t of stage.targets) if (chosen.has(t.text)) add(t.text);
  for (const t of custom) add(t);
  return { stage_id: stage.id, targets: out };
}

/** After a successful push: the stage being left banks its time; re-pushing the same stage keeps its clock. */
export function applyStagePush(rec: DirectorLessonRecord, stageId: string, nowMs: number): DirectorLessonRecord {
  if (rec.stage_id === stageId && rec.stage_started_at !== null) return rec;
  const stage_ms = { ...rec.stage_ms };
  if (rec.stage_id && rec.stage_started_at !== null) {
    stage_ms[rec.stage_id] = (stage_ms[rec.stage_id] ?? 0) + Math.max(0, nowMs - rec.stage_started_at);
  }
  return { ...rec, stage_id: stageId, stage_started_at: nowMs, stage_ms };
}

/** Elapsed time on a stage: banked time plus the running clock when it is the current one. */
export function stageElapsedMs(rec: DirectorLessonRecord, stageId: string, nowMs: number): number {
  const banked = rec.stage_ms[stageId] ?? 0;
  const running = rec.stage_id === stageId && rec.stage_started_at !== null ? Math.max(0, nowMs - rec.stage_started_at) : 0;
  return banked + running;
}

export type StageStatus = 'now' | 'done' | 'next';

export function stageStatus(plan: LessonPlan, rec: Pick<DirectorLessonRecord, 'stage_id'>, stageId: string): StageStatus {
  if (rec.stage_id === stageId) return 'now';
  const cur = plan.stages.findIndex((s) => s.id === rec.stage_id);
  const i = plan.stages.findIndex((s) => s.id === stageId);
  return cur >= 0 && i < cur ? 'done' : 'next';
}

/* ---------- director: pins ---------- */

/** F1 → coaching, F2 → expression (director.ts keeps the key map; this adds the note the server stores). */
export function pinKindForKey(key: string): PinKind | null {
  return DIRECTOR_BOOKMARK_KEYS[key] ?? null;
}

export function buildPin(
  kind: PinKind,
  nowMs: number,
  lessonStartedAtMs: number,
  ctx: { note: string; lastTranscript: string | null; stageTitle: string | null }
): PinInput {
  const typed = ctx.note.trim();
  const fallback = kind === 'expression' ? ctx.lastTranscript ?? '' : ctx.stageTitle ?? '';
  return {
    kind,
    at_ms: Math.max(0, Math.round(nowMs - lessonStartedAtMs)),
    note: (typed || fallback).slice(0, PIN_NOTE_MAX)
  };
}

/* ---------- director: feed ---------- */

export interface FeedView {
  utterances: FeedUtterance[];
  pins: FeedPin[];
  since: number;
}

export const EMPTY_FEED_VIEW: FeedView = { utterances: [], pins: [], since: 0 };

/** Adds new utterances (by id, oldest first) and replaces pins; `since` is the newest utterance time seen. */
export function mergeFeed(prev: FeedView, feed: Pick<LessonFeed, 'utterances' | 'pins'>): FeedView {
  const seen = new Set(prev.utterances.map((u) => u.id));
  const added = feed.utterances.filter((u) => !seen.has(u.id));
  const utterances = added.length ? [...prev.utterances, ...added].sort((a, b) => a.at - b.at) : prev.utterances;
  const since = utterances.reduce((m, u) => Math.max(m, u.at), prev.since);
  return { utterances, pins: feed.pins ?? prev.pins, since };
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function starsText(n: number): string {
  const k = Math.max(0, Math.min(3, Math.round(n)));
  return k === 0 ? '☆' : '★'.repeat(k);
}

/** Korean wall-clock label (lessons run in KST whatever the laptop's zone is). */
export function kstLabel(ms: number | null | undefined, withTime = true): string {
  if (!ms) return '—';
  const d = new Date(ms + 9 * 3_600_000);
  const md = `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일`;
  if (!withTime) return `${d.getUTCFullYear()}년 ${md}`;
  return `${md} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/* ---------- operator error copy ---------- */

export function directorErrorText(code: string): string {
  const m: Record<string, string> = {
    operator_only: L.director.errOperator,
    operator_token_not_configured: L.director.errNotConfigured,
    network: L.director.errNetwork,
    lesson_not_found: L.director.errLessonNotFound,
    player_not_found: L.director.errPlayerNotFound,
    invalid: L.director.errInvalid
  };
  return m[code] ?? `${L.director.errUnknown} (${code})`;
}

/* ---------- student: join state machine ---------- */

export type JoinPhase = 'code' | 'joining' | 'lesson' | 'ended';

export interface JoinState {
  phase: JoinPhase;
  code: string;
  error: string | null;
  token: string | null;
  lessonId: string | null;
  nickname: string;
  lesson: StudentLessonState | null;
  /** Consecutive failed polls; the child sees a gentle "reconnecting" line, never a raw code. */
  pollFailures: number;
  last: UtteranceResult | null;
  /** Ledger balance: from the first state poll, then each answer's coins_total. */
  coins: number | null;
  saidCount: number;
  starsEarned: number;
}

export type JoinAction =
  | { type: 'code_changed'; value: string }
  | { type: 'submit' }
  | { type: 'join_ok'; result: JoinResult }
  | { type: 'join_failed'; code: string }
  | { type: 'resume'; token: string; lessonId: string; nickname: string }
  | { type: 'state'; state: StudentLessonState }
  | { type: 'state_failed'; code: string }
  | { type: 'utterance_result'; result: UtteranceResult }
  /** Answers sent from the device outbox: counters and coins move, the result panel's last answer does not. */
  | { type: 'outbox_results'; results: UtteranceResult[] }
  | { type: 'leave' };

export const INITIAL_JOIN_STATE: JoinState = {
  phase: 'code',
  code: '',
  error: null,
  token: null,
  lessonId: null,
  nickname: '',
  lesson: null,
  pollFailures: 0,
  last: null,
  coins: null,
  saidCount: 0,
  starsEarned: 0
};

export function normalizeJoinCode(raw: string): string {
  return raw.replace(/\D+/g, '').slice(0, 6);
}

export function joinErrorText(code: string): string {
  const m: Record<string, string> = {
    invalid_code: L.join.errCode,
    too_many_attempts: L.join.errTooMany,
    network: L.join.errNetwork,
    student_only: L.join.errSessionGone
  };
  return m[code] ?? L.join.errGeneric;
}

export function joinReducer(s: JoinState, a: JoinAction): JoinState {
  switch (a.type) {
    case 'code_changed':
      return { ...s, code: normalizeJoinCode(a.value), error: null };
    case 'submit':
      if (s.phase !== 'code') return s;
      if (s.code.length !== 6) return { ...s, error: L.join.errSixDigits };
      return { ...s, phase: 'joining', error: null };
    case 'join_ok':
      return {
        ...INITIAL_JOIN_STATE,
        phase: 'lesson',
        token: a.result.student_token,
        lessonId: a.result.lesson_id,
        nickname: a.result.nickname
      };
    case 'join_failed':
      return { ...s, phase: 'code', error: joinErrorText(a.code), code: a.code === 'invalid_code' ? '' : s.code };
    case 'resume':
      return { ...INITIAL_JOIN_STATE, phase: 'lesson', token: a.token, lessonId: a.lessonId, nickname: a.nickname };
    case 'state':
      if (s.phase !== 'lesson' && s.phase !== 'ended') return s;
      return {
        ...s,
        lesson: a.state,
        pollFailures: 0,
        phase: a.state.ended ? 'ended' : 'lesson',
        coins: typeof a.state.coins_balance === 'number' ? a.state.coins_balance : s.coins
      };
    case 'state_failed':
      // A token the server no longer knows (lesson ended long ago, new tab) sends the child back to the code box.
      if (a.code === 'student_only') {
        return { ...INITIAL_JOIN_STATE, error: s.phase === 'ended' ? null : joinErrorText(a.code) };
      }
      return { ...s, pollFailures: s.pollFailures + 1 };
    case 'utterance_result':
      return {
        ...s,
        last: a.result,
        coins: a.result.coins_total,
        saidCount: s.saidCount + 1,
        starsEarned: s.starsEarned + Math.max(0, a.result.stars)
      };
    case 'outbox_results': {
      const latest = a.results[a.results.length - 1];
      if (!latest) return s;
      return {
        ...s,
        coins: latest.coins_total,
        saidCount: s.saidCount + a.results.length,
        starsEarned: s.starsEarned + a.results.reduce((n, r) => n + Math.max(0, r.stars), 0)
      };
    }
    case 'leave':
      return INITIAL_JOIN_STATE;
    default:
      return s;
  }
}

/* ---------- student: targets ---------- */

export interface TargetCard {
  text: string;
  stars: 1 | 2 | 3;
}

/** Star level of a pushed sentence: the plan's own rating when it came from a plan, else its position (1..3). */
export function targetCards(targets: readonly string[]): TargetCard[] {
  const known = new Map<string, 1 | 2 | 3>();
  for (const p of LESSON_PLANS) for (const st of p.stages) for (const t of st.targets) known.set(t.text, t.stars);
  return targets.map((text, i) => ({ text, stars: known.get(text) ?? ((Math.min(3, i + 1) as 1 | 2 | 3)) }));
}

/** Recall stage shows each word's first letter (docs/18 §4 ⑤), the same as the 3D dialog window. */
export function recallHint(text: string): string {
  return maskInitials(text.trim()) || '…';
}

export function hintLevelFor(mode: LessonUtteranceMode | undefined): HintLevel {
  return mode === 'recall' ? 'initial' : 'full';
}

export function displayTarget(text: string, mode: LessonUtteranceMode | undefined): string {
  return mode === 'recall' ? recallHint(text) : text;
}

/* ---------- student: speech ---------- */

const normWords = (t: string): string[] =>
  t
    .toLowerCase()
    .replace(/[^a-z' ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

/** Which target words the recognizer heard (UI colouring only — the server does the scoring). */
export function heardWordMask(transcript: string, target: string): boolean[] {
  const heard = normWords(transcript);
  return target
    .trim()
    .split(/\s+/)
    .map((w) => {
      const n = normWords(w)[0];
      if (!n) return true;
      const i = heard.indexOf(n);
      if (i < 0) return false;
      heard.splice(i, 1);
      return true;
    });
}

export interface SpeechAlternative {
  transcript: string;
  confidence: number;
}

/**
 * Picks one of the recognizer's own hypotheses: the closest to the chosen sentence when there is one (children's
 * accents often land the right words in the 2nd guess), else the top guess. Free talk always sends the top guess.
 */
export function pickAlternative(
  alts: readonly SpeechAlternative[],
  target: string,
  mode: LessonUtteranceMode | undefined
): SpeechAlternative | null {
  const clean = alts.filter((a) => a.transcript.trim());
  if (clean.length === 0) return null;
  if (mode === 'free' || !target.trim()) return clean[0]!;
  const want = normWords(target);
  const ratio = (t: string) => {
    const heard = normWords(t);
    let hit = 0;
    for (const w of want) {
      const i = heard.indexOf(w);
      if (i >= 0) {
        hit++;
        heard.splice(i, 1);
      }
    }
    return want.length ? hit / want.length : 0;
  };
  return clean.reduce((best, a) => (ratio(a.transcript) > ratio(best.transcript) ? a : best), clean[0]!);
}

export function clampMs(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(600_000, Math.round(v)));
}

/* ---------- parent report ---------- */

export interface FactRow {
  key: string;
  label: string;
  value: string;
}

const FACT_ORDER = [
  'active_speaking_minutes',
  'total_valid_utterances',
  'free_utterances',
  'weekly_free_ratio',
  'mean_words_per_utterance',
  'think_speak_index',
  'new_expressions',
  'solo_reused_expressions'
] as const;

function fmtNum(n: number, digits = 1): string {
  return Number.isInteger(n) ? n.toLocaleString('ko-KR') : n.toFixed(digits);
}

export function formatFact(key: string, v: unknown): string {
  if (v === null || v === undefined) return key === 'think_speak_index' ? L.report.baselinePending : '—';
  if (typeof v !== 'number') return String(v);
  switch (key) {
    case 'active_speaking_minutes':
      // A first lesson can be under a minute of speech: show seconds instead of "0.0분".
      return v > 0 && v < 1 ? `${Math.max(1, Math.round(v * 60))}초` : `${fmtNum(v)}분`;
    case 'total_valid_utterances':
    case 'free_utterances':
      return `${fmtNum(v)}문장`;
    case 'weekly_free_ratio':
      return `${Math.round(v * 100)}%`;
    case 'mean_words_per_utterance':
      return `${fmtNum(v)}단어`;
    case 'new_expressions':
    case 'solo_reused_expressions':
      return `${fmtNum(v)}개`;
    default:
      return fmtNum(v);
  }
}

/** This-lesson facts (`facts.lesson`), in the order a parent reads them. */
const LESSON_FACT_ORDER = [
  'speaking_sec',
  'utterances',
  'passes',
  'free_words',
  'hintless_passes',
  'stars_total',
  'teacher_trades',
  'longest_words'
] as const;

function lessonFactOf(facts: Record<string, unknown>): Record<string, unknown> | null {
  const l = facts.lesson;
  return l && typeof l === 'object' && !Array.isArray(l) && typeof (l as Record<string, unknown>).utterances === 'number'
    ? (l as Record<string, unknown>)
    : null;
}

export function formatLessonFact(key: string, v: unknown): string {
  if (typeof v !== 'number') return '—';
  switch (key) {
    case 'speaking_sec': {
      const s = Math.max(0, Math.round(v));
      const m = Math.floor(s / 60);
      return m > 0 ? (s % 60 ? `${m}분 ${s % 60}초` : `${m}분`) : `${s}초`;
    }
    case 'utterances':
    case 'passes':
    case 'hintless_passes':
    case 'teacher_trades':
      return `${fmtNum(v)}번`;
    case 'free_words':
    case 'longest_words':
      return `${fmtNum(v)}단어`;
    case 'stars_total':
      return `${fmtNum(v)}개`;
    default:
      return fmtNum(v);
  }
}

/**
 * Known facts first in a fixed order with Korean labels; anything else the server adds follows as-is.
 * When the report carries this lesson's own facts (`facts.lesson`), the table shows only those —
 * the same numbers the summary sentence uses — so a parent never sees "10초" in the sentence and
 * "7초" in the table (weekly aggregates count a different base and belong on the dashboard).
 */
export function reportFactRows(facts: Record<string, unknown>): FactRow[] {
  const labels = L.report.factLabels as Record<string, string>;
  const rows: FactRow[] = [];
  const lesson = lessonFactOf(facts);
  if (lesson) {
    const ll = L.report.lessonFactLabels as Record<string, string>;
    for (const k of LESSON_FACT_ORDER) {
      if (typeof lesson[k] === 'number') rows.push({ key: `lesson.${k}`, label: ll[k] ?? k, value: formatLessonFact(k, lesson[k]) });
    }
    return rows;
  }
  for (const k of FACT_ORDER) {
    if (k in facts) rows.push({ key: k, label: labels[k] ?? k, value: formatFact(k, facts[k]) });
  }
  for (const [k, v] of Object.entries(facts)) {
    if ((FACT_ORDER as readonly string[]).includes(k) || k === 'notes') continue;
    if (typeof v === 'number' || typeof v === 'string') rows.push({ key: k, label: labels[k] ?? k, value: formatFact(k, v) });
  }
  return rows;
}

/** `/r/<token>` → token; anything else → null. */
export function reportTokenFromPath(pathname: string): string | null {
  const m = /^\/r\/([A-Za-z0-9_-]{1,128})\/?$/.exec(pathname);
  return m ? m[1]! : null;
}
