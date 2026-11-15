import { getLessonPlan } from '@lcw/content';
import { filterSpeechBubble } from '@lcw/converse';
import type { SqliteExecutor } from './storage.js';

/**
 * Parent-facing facts for ONE lesson (docs/07 §5, docs/08 §9.3, WP-308). Every number the /r/<token> page shows comes
 * from this object, so the screen can never disagree with the fact sheet. Built only from this lesson's utterances and
 * pins; no player/guardian ids or names go in (the share link is public).
 */

/** docs/16 §2-18: a share link lives 30 days. */
export const REPORT_SHARE_TTL_MS = 30 * 86_400_000;
/** docs/07 §2.1: utterances under this recognizer confidence are not counted as evidence. */
export const MIN_QUOTE_CONFIDENCE = 0.5;
export const MAX_QUOTES = 3;
export const MAX_EXPRESSIONS = 8;

export interface LessonParentQuote {
  text: string;
  stars: number;
  mode: string;
  stage_title_ko: string;
  hintless: boolean;
}

export interface LessonParentStage {
  id: string;
  title_ko: string;
  utterances: number;
  passes: number;
}

export interface LessonParentFacts {
  lesson_day: string;
  started_at: number;
  ended_at: number;
  duration_min: number;
  utterances: number;
  passes: number;
  stars_total: number;
  three_star_passes: number;
  hintless_passes: number;
  words_spoken: number;
  free_words: number;
  speaking_sec: number;
  longest_words: number;
  quotes: LessonParentQuote[];
  expressions: string[];
  coaching_moments: number;
  stages: LessonParentStage[];
  summary_ko: string;
}

interface UttRow extends Record<string, unknown> {
  final_text: string;
  stars: number;
  mode: string;
  ctx: string;
  words: number;
  dur_ms: number;
  confidence: number;
  hint_level: string;
  created_at: number;
}

export function kstDayOf(ms: number): string {
  return new Date(ms + 9 * 3_600_000).toISOString().slice(0, 10);
}

/** "can i have a tea" → "Can I have a tea": the child's words, only the casing a recognizer drops. */
export function tidyQuote(t: string): string {
  const s = t.trim().replace(/\s+/g, ' ').replace(/(^|\s)i(?=\s|'|$)/g, '$1I');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9' ]+/g, '').replace(/\s+/g, ' ').trim();

/**
 * Self-introductions name the child, the school or where they live ("My name is Jiwoo", "I live in Mapo"): never
 * quoted on a link that can be forwarded (docs/16 §1 "실명 없음").
 */
export const SELF_IDENTIFYING_PATTERN =
  /(?:name(?:'s| is)|call me|i live|i'm from|i am from|my school|my teacher is|my address|years old)/i;

/** Sentences safe to quote on a public page: passed, heard clearly, English, no PII/profanity/names (docs/16 §1). */
function quotable(u: UttRow, names: string[]): boolean {
  if (u.stars <= 0 || u.confidence < MIN_QUOTE_CONFIDENCE || u.words < 2) return false;
  if (SELF_IDENTIFYING_PATTERN.test(u.final_text)) return false;
  const lower = ` ${norm(u.final_text)} `;
  if (names.some((n) => n.length >= 2 && lower.includes(` ${n} `))) return false;
  if (/[가-힣]/.test(u.final_text) || u.final_text.includes('___')) return false;
  const f = filterSpeechBubble(u.final_text);
  return f.allowed && !f.substituted;
}

function quoteScore(u: UttRow): number {
  const hintless = u.hint_level === 'none' || u.mode === 'free' || u.mode === 'recall';
  return u.stars * 100 + Math.min(u.words, 20) * 4 + (hintless ? 25 : 0);
}

/** Up to 3 different sentences: best per stage first (so the quotes tell the lesson's story), then the next best. */
export function pickQuotes(rows: UttRow[], stageTitle: (id: string) => string, names: string[] = []): LessonParentQuote[] {
  const seen = new Set<string>();
  const nameKeys = names.map(norm).filter(Boolean);
  const ranked = rows
    .filter((u) => quotable(u, nameKeys))
    .sort((a, b) => quoteScore(b) - quoteScore(a) || a.created_at - b.created_at)
    .filter((u) => {
      const k = norm(u.final_text);
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  const picked: UttRow[] = [];
  const stagesUsed = new Set<string>();
  for (const u of ranked) {
    if (picked.length >= MAX_QUOTES) break;
    if (stagesUsed.has(u.ctx)) continue;
    stagesUsed.add(u.ctx);
    picked.push(u);
  }
  for (const u of ranked) {
    if (picked.length >= MAX_QUOTES) break;
    if (!picked.includes(u)) picked.push(u);
  }
  return picked
    .sort((a, b) => a.created_at - b.created_at)
    .map((u) => ({
      text: tidyQuote(u.final_text),
      stars: u.stars,
      mode: u.mode,
      stage_title_ko: stageTitle(u.ctx),
      hintless: u.hint_level === 'none' || u.mode === 'free' || u.mode === 'recall'
    }));
}

/** Factual one-liner in 합쇼체 (docs/08 §10). Only numbers from the facts, no praise or causal words (docs/07 §5). */
export function lessonSummaryKo(f: Pick<LessonParentFacts, 'utterances' | 'passes' | 'speaking_sec' | 'free_words'>): string {
  if (f.utterances === 0) return '이번 수업에서는 기록된 영어 발화가 없습니다.';
  const min = Math.floor(f.speaking_sec / 60);
  const sec = f.speaking_sec % 60;
  const time = min > 0 ? `${min}분${sec > 0 ? ` ${sec}초` : ''}` : `${sec}초`;
  const free = f.free_words > 0 ? ` 대본 없이 말한 단어는 ${f.free_words}개입니다.` : '';
  return `이번 수업에서 영어로 ${f.utterances}번 말했고 그중 ${f.passes}번 통과했습니다. 직접 말한 시간은 ${time}입니다.${free}`;
}

/** The child's nickname and each of its words: none of them may appear in a public quote. */
function childNames(sql: SqliteExecutor, playerId: string): string[] {
  const nick = sql.get<{ nickname: string }>('select nickname from players where id = ?', [playerId])?.nickname ?? '';
  return [nick, ...nick.split(/\s+/)].filter((x) => x.trim().length >= 2);
}

export function buildLessonParentFacts(sql: SqliteExecutor, lessonId: string, nowMs: number): LessonParentFacts | null {
  const lesson = sql.get<{ player_id: string; started_at: number; ended_at: number | null; plan: string }>(
    'select player_id, started_at, ended_at, plan from lessons where id = ?',
    [lessonId]
  );
  if (!lesson) return null;
  const plan = getLessonPlan(lesson.plan || undefined);
  const titleOf = (id: string) => plan.stages.find((s) => s.id === id)?.titleKo.replace(/^[①-⑩]\s*/, '') ?? '';
  const rows = sql.all<UttRow>(
    `select final_text, stars, mode, ctx, words, dur_ms, confidence, hint_level, created_at
     from utterances where session_id = ? and player_id = ? order by created_at`,
    [lessonId, lesson.player_id]
  );
  const pins = sql.all<{ kind: string; note: string }>('select kind, note from pins where lesson_id = ? order by at_ms', [
    lessonId
  ]);
  const passes = rows.filter((u) => u.stars > 0);
  const counted = rows.filter((u) => u.confidence >= MIN_QUOTE_CONFIDENCE);
  const sum = (xs: UttRow[], f: (u: UttRow) => number) => xs.reduce((a, u) => a + f(u), 0);
  const ended = lesson.ended_at ?? nowMs;

  const exprSeen = new Set<string>();
  const expressions: string[] = [];
  for (const p of pins) {
    const note = p.note.trim();
    if (p.kind !== 'expression' || !note || /[가-힣]/.test(note) || SELF_IDENTIFYING_PATTERN.test(note)) continue;
    if (!filterSpeechBubble(note).allowed) continue;
    const k = note.toLowerCase();
    if (exprSeen.has(k)) continue;
    exprSeen.add(k);
    expressions.push(note);
    if (expressions.length >= MAX_EXPRESSIONS) break;
  }

  const stages: LessonParentStage[] = plan.stages
    .map((s) => {
      const mine = rows.filter((u) => u.ctx === s.id);
      return { id: s.id, title_ko: titleOf(s.id), utterances: mine.length, passes: mine.filter((u) => u.stars > 0).length };
    })
    .filter((s) => s.utterances > 0);

  const base = {
    lesson_day: kstDayOf(lesson.started_at),
    started_at: lesson.started_at,
    ended_at: ended,
    duration_min: Math.max(0, Math.round((ended - lesson.started_at) / 60_000)),
    utterances: rows.length,
    passes: passes.length,
    stars_total: sum(passes, (u) => u.stars),
    three_star_passes: passes.filter((u) => u.stars >= 3).length,
    hintless_passes: passes.filter((u) => u.hint_level === 'none' || u.mode === 'free' || u.mode === 'recall').length,
    words_spoken: sum(counted, (u) => u.words),
    free_words: sum(
      counted.filter((u) => u.mode === 'free'),
      (u) => u.words
    ),
    speaking_sec: Math.round(sum(rows, (u) => u.dur_ms) / 1000),
    longest_words: rows.reduce((m, u) => Math.max(m, u.stars > 0 ? u.words : 0), 0),
    quotes: pickQuotes(rows, titleOf, childNames(sql, lesson.player_id)),
    expressions,
    coaching_moments: pins.filter((p) => p.kind === 'coaching').length,
    stages
  };
  return { ...base, summary_ko: lessonSummaryKo(base) };
}

/** What the public /v1/reports/:token returns. Explicit allow-list: nothing else from the rows reaches the page. */
export interface PublicReportView {
  kind: string;
  ref_id: string;
  facts: unknown;
  body: string;
  clips: unknown[];
  created_at: number;
  expires_at: number;
  teacher_comment: string;
  next_lesson_at: string;
}

const IDENTIFYING_FACT_KEYS = new Set(['player_id', 'guardian_id', 'family_id', 'nickname', 'name']);

/** Defence in depth: strips identifier keys anywhere in the facts tree before it leaves the server. */
export function stripIdentifiers(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripIdentifiers);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (!IDENTIFYING_FACT_KEYS.has(k)) out[k] = stripIdentifiers(x);
    }
    return out;
  }
  return v;
}
