import {
  CAFE_MENU,
  COMMON_WORDS_EN,
  FUNCTION_WORDS,
  getLessonPlan,
  LESSON_PLANS,
  LEXICON_L1_KO_EN,
  NAME_LIKE_WORDS
} from '@lcw/content';
import * as CONTENT from '@lcw/content';
import { filterSpeechBubble } from '@lcw/converse';
import { meaningfulExpression } from '@lcw/metrics';
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
/** 'At home' on the report: a parent can carry one or two sentences into the week, not a list. */
export const MAX_HOME_PRACTICE = 2;

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
  /** The practice scene itself (plan stage parentMain), not warm-up, recall or wrap-up. */
  main: boolean;
  utterances: number;
  passes: number;
}

export interface LessonParentFacts {
  lesson_day: string;
  /** 1 for the child's first lesson: the page says the numbers become the baseline only then. */
  lesson_number: number;
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
  /**
   * The child's lesson before this one that has any English in it (an abandoned lesson with nothing said is skipped),
   * counted by the same rules, so the page can say what changed ('얼마나 늘었는지'); null for the first such lesson.
   */
  previous: LessonParentCompare | null;
  /**
   * Up to two sentences to say again at home: the lesson's target sentences the child passed (the teacher's own,
   * well-formed wording; most stars first), then the expressions, then the quotes. A sentence inside another is one.
   */
  home_practice: string[];
}

export interface LessonParentCompare {
  utterances: number;
  passes: number;
  speaking_sec: number;
  free_words: number;
}

interface UttRow extends Record<string, unknown> {
  final_text: string;
  /** The sentence on screen ('' in free talk); older callers of pickQuotes leave it out. */
  target_text?: string;
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

/** Lowercase words only; apostrophes and hyphens split words so "Juno's" and "JUNO-KIM" still show "juno". */
const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Self-introductions name the child, the school or where they live ("My name is Jiwoo", "I live in Mapo"): never
 * shown on a link that can be forwarded (docs/16 §1 "실명 없음"). Tested on norm()-ed text.
 */
export const SELF_IDENTIFYING_PATTERN =
  /\b(?:my name|name s|names is|call me|i live|live in|i m from|i am from|come from|my school|elementary|middle school|my class is|my teacher is|my address|my phone|my number|years old|my birthday|my mom is|my dad is|my brother is|my sister is|my friend is)\b/;

/**
 * "I'm Jiwoo", "this is Juno": after these openers only ordinary words may follow (a name would come next).
 * Over-blocking is fine — there are always other passed sentences to quote.
 */
const INTRO_OPENER = /\b(?:i m|i am|this is|it s me|me is)\s+([a-z]+)/g;
const INTRO_SAFE_NEXT = new Set(
  (
    'a an the so very not really too just going gonna trying looking playing eating drinking reading drawing making ' +
    'happy hungry thirsty tired sad sorry fine good ok okay ready cold hot warm full sleepy excited busy here home ' +
    'my your his her our their it this that what how in on at with for from to sure done back late first next'
  ).split(' ')
);
/** Proper nouns kept by the recognizer (names, places, schools). Days, months and languages are ordinary words. */
const COMMON_CAPITALISED = new Set(
  (
    'i im ill ive id ok english korean korea mr mrs ms monday tuesday wednesday thursday friday saturday sunday ' +
    'january february march april may june july august september october november december'
  ).split(' ')
);

/**
 * Words a sentence may start with: every sentence starts with a capital, so the proper-noun check below skips the first
 * word — "Jiwoo, can I have tea?" would pass. The first word must be an ordinary word (everyday English for children,
 * function words, the words in our lessons and menus); anything else at the start is treated like a name. Checked in
 * any case: a recognizer may hand us "minji likes cookies" in lowercase. Words that are also given names are never
 * starters, even when a lesson sentence uses them. Over-blocking is fine (above), but not so much that a lesson without
 * a script has no sentence to quote (#131 review: 11 of 25 ordinary sentences were dropped by a lesson-only list).
 */
const NAME_LIKE = new Set(NAME_LIKE_WORDS);

/**
 * Words our own English content writes in lowercase inside a phrase (menus, shop goods, NPC lines, UI: "table lamp",
 * "Tap the word cards", "Sounds like a great plan"): ordinary words of the world the child plays in. A name is never
 * written in lowercase there, and a word that also appears capitalised mid-phrase is left out (it may be a name).
 * Single-token strings are skipped (ids and voice names such as 'athena').
 */
function contentWords(root: unknown): string[] {
  const lower = new Set<string>();
  const capitalised = new Set<string>();
  const seen = new Set<unknown>();
  const walk = (v: unknown, depth: number) => {
    if (depth > 10 || v == null || seen.has(v)) return;
    if (typeof v === 'string') {
      const words = v.trim().split(/\s+/);
      if (words.length < 2 || !/^[A-Za-z][A-Za-z' ,.!?-]*$/.test(v.trim())) return;
      words.forEach((raw, i) => {
        const w = raw.replace(/[^A-Za-z']/g, '').replace(/'/g, '');
        if (!w) return;
        if (/^[a-z]+$/.test(w)) lower.add(w);
        else if (i > 0 && /^[A-Z]/.test(w)) capitalised.add(w.toLowerCase());
      });
      return;
    }
    if (typeof v !== 'object') return;
    seen.add(v);
    const vals = v instanceof Map || v instanceof Set ? [...v.values()] : Array.isArray(v) ? v : Object.values(v as object);
    for (const x of vals) walk(x, depth + 1);
  };
  walk(root, 0);
  return [...lower].filter((w) => !capitalised.has(w));
}

const SENTENCE_STARTERS = new Set(
  [
    ...COMMON_WORDS_EN,
    ...FUNCTION_WORDS,
    ...COMMON_CAPITALISED,
    ...Object.values(LEXICON_L1_KO_EN),
    ...CAFE_MENU.map((d) => d.label),
    ...LESSON_PLANS.flatMap((pl) =>
      pl.stages.flatMap((st) => [st.teacherScriptEn, st.studentGoalEn, ...(st.followUpsEn ?? []), ...st.targets.map((t) => t.text)])
    ),
    ...contentWords(CONTENT)
  ]
    .flatMap((x) => x.toLowerCase().split(/[^a-z']+/).map((w) => w.replace(/'/g, '')).filter(Boolean))
    .filter((w) => !NAME_LIKE.has(w))
);

/** A starter word, or the plural of one ("Elephants are big", "Strawberries …", "Boxes …"). */
function isSentenceStarter(w: string): boolean {
  if (SENTENCE_STARTERS.has(w)) return true;
  const singular = [w.replace(/ies$/, 'y'), w.replace(/es$/, ''), w.replace(/s$/, '')].filter((s) => s !== w && s.length >= 2);
  return singular.some((s) => SENTENCE_STARTERS.has(s) && !NAME_LIKE.has(s));
}

/** Text that may appear on the public report: English, no PII/profanity, no names, no self-introduction. */
export function publicSafeText(text: string, names: string[]): boolean {
  const t = text.trim();
  if (!t || /[가-힣]/.test(t) || t.includes('___')) return false;
  // Numbers a child might read out (phone, address, door code) in any spacing: "010 1234 5678", "1 2 3 4".
  if (/\d{3,}/.test(t) || /\d(?:[\s.-]*\d){3,}/.test(t)) return false;
  const n = ` ${norm(t)} `;
  if (SELF_IDENTIFYING_PATTERN.test(n)) return false;
  for (const m of n.matchAll(INTRO_OPENER)) if (!INTRO_SAFE_NEXT.has(m[1]!)) return false;
  if (names.some((x) => x.length >= 2 && n.includes(` ${x} `))) return false;
  // "Minji, can I …" is stopped here too: a name is not a starter. (A comma rule on top of this only blocked the
  // child's café orders — "Water, please." — so there is none; registered names are blocked anywhere, name-keys.ts.)
  const first = norm(t.split(/\s+/)[0] ?? '').replace(/ /g, '');
  if (first && !isSentenceStarter(first)) return false;
  const words = t.split(/\s+/).slice(1);
  if (words.some((w) => /^[A-Z]/.test(w) && !COMMON_CAPITALISED.has(norm(w).replace(/ /g, '')))) return false;
  const f = filterSpeechBubble(t);
  return f.allowed && !f.substituted;
}

/** Sentences safe to quote: passed, heard clearly, and publicSafeText. */
function quotable(u: UttRow, names: string[]): boolean {
  if (u.stars <= 0 || u.confidence < MIN_QUOTE_CONFIDENCE || u.words < 2) return false;
  return publicSafeText(u.final_text, names);
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

/** The first MAX_HOME_PRACTICE candidates, in order, with a sentence inside another counted once. */
function pickHomePractice(candidates: readonly string[]): string[] {
  const out: string[] = [];
  for (const s of candidates) {
    if (out.length >= MAX_HOME_PRACTICE) break;
    const k = norm(s);
    // 'Can I have a warm honey tea?' is inside 'Can I have a warm honey tea, please?': one sentence for home.
    if (!k || out.some((h) => norm(h).includes(k) || k.includes(norm(h)))) continue;
    out.push(s);
  }
  return out;
}

export function buildLessonParentFacts(sql: SqliteExecutor, lessonId: string, nowMs: number): LessonParentFacts | null {
  const lesson = sql.get<{ player_id: string; started_at: number; ended_at: number | null; plan: string }>(
    'select player_id, started_at, ended_at, plan from lessons where id = ?',
    [lessonId]
  );
  if (!lesson) return null;
  const plan = getLessonPlan(lesson.plan || undefined);
  // Parent wording: the plan's parentKo, else the title without the step number and the teacher's note in brackets
  // ("② 카페 주문 (1성 → 3성)" → "카페 주문").
  const titleOf = (id: string) => {
    const st = plan.stages.find((s) => s.id === id);
    return st ? st.parentKo ?? st.titleKo.replace(/^[①-⑩]\s*/, '').replace(/\s*\([^)]*\)\s*$/, '') : '';
  };
  const rowsOf = (id: string) =>
    sql.all<UttRow>(
      `select final_text, target_text, stars, mode, ctx, words, dur_ms, confidence, hint_level, created_at
       from utterances where session_id = ? and player_id = ? order by created_at`,
      [id, lesson.player_id]
    );
  const rows = rowsOf(lessonId);
  const pins = sql.all<{ kind: string; note: string; at_ms: number }>(
    'select kind, note, at_ms from pins where lesson_id = ? order by at_ms',
    [lessonId]
  );
  const passes = rows.filter((u) => u.stars > 0);
  const sum = (xs: UttRow[], f: (u: UttRow) => number) => xs.reduce((a, u) => a + f(u), 0);
  const compare = (xs: UttRow[]): LessonParentCompare => ({
    utterances: xs.length,
    passes: xs.filter((u) => u.stars > 0).length,
    speaking_sec: Math.round(sum(xs, (u) => u.dur_ms) / 1000),
    free_words: sum(
      xs.filter((u) => u.mode === 'free'),
      (u) => u.words
    )
  });
  const prevLesson = sql.get<{ id: string }>(
    `select l.id from lessons l where l.player_id = ? and l.started_at < ? and l.id <> ?
       and exists (select 1 from utterances u where u.session_id = l.id and u.player_id = l.player_id)
     order by l.started_at desc limit 1`,
    [lesson.player_id, lesson.started_at, lessonId]
  );
  const ended = lesson.ended_at ?? nowMs;

  const names = childNames(sql, lesson.player_id).map(norm).filter(Boolean);
  const exprSeen = new Set<string>();
  const expressions: string[] = [];
  const targets = plan.stages.flatMap((s) => s.targets);
  for (const p of pins) {
    if (p.kind !== 'expression') continue;
    // F2 notes default to the child's last utterance (docs/10 §2) but teachers also type fragments ("Can I have",
    // "for your"): grow each to a whole unit from the child's lines nearest the pin (before it first), then the plan.
    const at = lesson.started_at + p.at_ms;
    // Grow only from lines that could be quoted themselves (passed, heard clearly, public-safe) and the plan.
    const near = rows
      .filter((u) => quotable(u, names))
      .sort((a, b) => (a.created_at <= at ? at - a.created_at : a.created_at - at + 3_600_000) - (b.created_at <= at ? at - b.created_at : b.created_at - at + 3_600_000))
      .map((u) => u.final_text);
    const note = meaningfulExpression(p.note, { utterances: near, targets });
    // Same public filter as quotes.
    if (!note || !publicSafeText(note, names)) continue;
    const k = note.toLowerCase().replace(/[.?!]$/, '');
    if (exprSeen.has(k)) continue;
    exprSeen.add(k);
    expressions.push(note);
    if (expressions.length >= MAX_EXPRESSIONS) break;
  }

  const stages: LessonParentStage[] = plan.stages
    .map((s) => {
      const mine = rows.filter((u) => u.ctx === s.id);
      return {
        id: s.id,
        title_ko: titleOf(s.id),
        main: s.parentMain === true,
        utterances: mine.length,
        passes: mine.filter((u) => u.stars > 0).length
      };
    })
    .filter((s) => s.utterances > 0);

  const quotes = pickQuotes(rows, titleOf, names);
  const passedTargets = passes
    .filter((u) => u.mode !== 'free' && (u.target_text ?? '').trim().split(/\s+/).length >= 2 && publicSafeText(u.target_text ?? '', names))
    .sort((a, b) => b.stars - a.stars || (b.target_text ?? '').length - (a.target_text ?? '').length || b.created_at - a.created_at)
    .map((u) => (u.target_text ?? '').trim());
  const home_practice = pickHomePractice([...passedTargets, ...expressions, ...quotes.map((q) => q.text)]);

  const base = {
    lesson_day: kstDayOf(lesson.started_at),
    lesson_number: Number(
      sql.get<{ n: number }>('select count(*) as n from lessons where player_id = ? and started_at <= ?', [
        lesson.player_id,
        lesson.started_at
      ])?.n ?? 1
    ),
    started_at: lesson.started_at,
    ended_at: ended,
    duration_min: Math.max(0, Math.round((ended - lesson.started_at) / 60_000)),
    utterances: rows.length,
    passes: passes.length,
    stars_total: sum(passes, (u) => u.stars),
    three_star_passes: passes.filter((u) => u.stars >= 3).length,
    hintless_passes: passes.filter((u) => u.hint_level === 'none' || u.mode === 'free' || u.mode === 'recall').length,
    // Same base as utterances and speaking_sec (every recorded utterance of this lesson), so the numbers add up.
    words_spoken: sum(rows, (u) => u.words),
    free_words: sum(
      rows.filter((u) => u.mode === 'free'),
      (u) => u.words
    ),
    speaking_sec: Math.round(sum(rows, (u) => u.dur_ms) / 1000),
    longest_words: rows.reduce((m, u) => Math.max(m, u.stars > 0 ? u.words : 0), 0),
    quotes,
    expressions,
    coaching_moments: pins.filter((p) => p.kind === 'coaching').length,
    stages
  };
  return { ...base, summary_ko: lessonSummaryKo(base), previous: prevLesson ? compare(rowsOf(prevLesson.id)) : null, home_practice };
}

/**
 * One report for a lesson that was continued (lesson-mode.ts: an auto-closed lesson picked up again the same day): the
 * parts in time order become one lesson for the parent. Counts add up, the time spans the first start to the last end
 * while the minutes are the parts' own (the gap between them is not lesson time), quotes and expressions stay within
 * their limits, and the one-liner is rebuilt from the summed numbers.
 */
export function mergeLessonParentFacts(parts: readonly LessonParentFacts[]): LessonParentFacts | null {
  const xs = [...parts].sort((a, b) => a.started_at - b.started_at);
  const first = xs[0];
  if (!first) return null;
  if (xs.length === 1) return first;
  const sum = (f: (p: LessonParentFacts) => number) => xs.reduce((a, p) => a + f(p), 0);
  const stages = new Map<string, LessonParentStage>();
  for (const s of xs.flatMap((p) => p.stages)) {
    const prev = stages.get(s.id);
    stages.set(s.id, prev ? { ...prev, utterances: prev.utterances + s.utterances, passes: prev.passes + s.passes } : { ...s });
  }
  const seen = new Set<string>();
  const expressions = xs
    .flatMap((p) => p.expressions)
    .filter((e) => {
      const k = e.toLowerCase().replace(/[.?!]$/, '');
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, MAX_EXPRESSIONS);
  const base = {
    lesson_day: first.lesson_day,
    lesson_number: first.lesson_number,
    started_at: first.started_at,
    ended_at: Math.max(...xs.map((p) => p.ended_at)),
    duration_min: sum((p) => p.duration_min),
    utterances: sum((p) => p.utterances),
    passes: sum((p) => p.passes),
    stars_total: sum((p) => p.stars_total),
    three_star_passes: sum((p) => p.three_star_passes),
    hintless_passes: sum((p) => p.hintless_passes),
    words_spoken: sum((p) => p.words_spoken),
    free_words: sum((p) => p.free_words),
    speaking_sec: sum((p) => p.speaking_sec),
    longest_words: Math.max(...xs.map((p) => p.longest_words)),
    // Each part already picked its best lines; keep the strongest of them, shown in time order.
    quotes: xs
      .flatMap((p, i) => p.quotes.map((q, j) => ({ q, i, j })))
      .sort((a, b) => b.q.stars - a.q.stars || a.i - b.i || a.j - b.j)
      .slice(0, MAX_QUOTES)
      .sort((a, b) => a.i - b.i || a.j - b.j)
      .map((x) => x.q),
    expressions,
    coaching_moments: sum((p) => p.coaching_moments),
    stages: [...stages.values()]
  };
  return {
    ...base,
    summary_ko: lessonSummaryKo(base),
    // The lesson before this one: the first part's (a later part's 'previous' is the same day's earlier part).
    previous: first.previous,
    // Each part's picks come in priority order (passed targets, then expressions, then quotes); earlier part first.
    home_practice: pickHomePractice([...xs.flatMap((p) => p.home_practice), ...expressions, ...base.quotes.map((q) => q.text)])
  };
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

/** Stage id → plan stage (ids like wrap_up repeat across plans with the same parent wording). */
const PLAN_STAGES = new Map(LESSON_PLANS.flatMap((pl) => pl.stages).map((st) => [st.id, st] as const));

const isNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v);

/** Only numbers (and nested objects of numbers) — e.g. the lesson lane's facts.progress. Strings and arrays are dropped. */
function numbersOnly(v: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (isNum(x) || x === null || typeof x === 'boolean') out[k] = x;
    else if (x && typeof x === 'object' && !Array.isArray(x)) out[k] = numbersOnly(x);
  }
  return out;
}

const LESSON_NUMBER_KEYS = [
  'lesson_number',
  'started_at',
  'ended_at',
  'duration_min',
  'utterances',
  'passes',
  'stars_total',
  'three_star_passes',
  'hintless_passes',
  'words_spoken',
  'free_words',
  'speaking_sec',
  'longest_words',
  'coaching_moments'
] as const;

/**
 * Allow-list of what a public share link may carry (docs/16 §1): top-level numbers, facts.lesson's known fields with
 * its texts re-checked, and numbers-only facts.progress. Anything else a lane adds later (raw transcripts such as
 * pin_windows, teacher notes, ids) is not public until it is added here on purpose.
 */
export function publicFacts(facts: unknown, names: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!facts || typeof facts !== 'object') return out;
  const f = facts as Record<string, unknown>;
  for (const [k, v] of Object.entries(f)) if (isNum(v) || v === null) out[k] = v;
  if (f.progress && typeof f.progress === 'object') out.progress = numbersOnly(f.progress);
  const l = f.lesson as Record<string, unknown> | undefined;
  if (l && typeof l === 'object') {
    const keyNames = names.map(norm).filter(Boolean);
    const lesson: Record<string, unknown> = {};
    for (const k of LESSON_NUMBER_KEYS) if (isNum(l[k]) || l[k] === null) lesson[k] = l[k];
    if (typeof l.lesson_day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(l.lesson_day)) lesson.lesson_day = l.lesson_day;
    if (typeof l.summary_ko === 'string') lesson.summary_ko = l.summary_ko;
    const arr = (v: unknown) => (Array.isArray(v) ? v : []);
    lesson.quotes = arr(l.quotes)
      .map((q) => (q ?? {}) as Record<string, unknown>)
      .filter((q) => typeof q.text === 'string' && publicSafeText(q.text, keyNames))
      .map((q) => ({
        text: q.text,
        stars: isNum(q.stars) ? q.stars : 0,
        mode: typeof q.mode === 'string' ? q.mode : '',
        stage_title_ko: typeof q.stage_title_ko === 'string' ? q.stage_title_ko : '',
        hintless: q.hintless === true
      }));
    lesson.expressions = arr(l.expressions).filter((e): e is string => typeof e === 'string' && publicSafeText(e, keyNames));
    lesson.home_practice = arr(l.home_practice).filter((e): e is string => typeof e === 'string' && publicSafeText(e, keyNames));
    // Numbers only (the lesson before), like facts.progress.
    // null = no earlier lesson with words (the page says so); left out on a report made before the field existed.
    if (l.previous && typeof l.previous === 'object' && !Array.isArray(l.previous)) lesson.previous = numbersOnly(l.previous);
    else if (l.previous === null) lesson.previous = null;
    else delete lesson.previous;
    lesson.stages = arr(l.stages)
      .map((x) => (x ?? {}) as Record<string, unknown>)
      .map((x) => {
        const id = typeof x.id === 'string' ? x.id : '';
        // Reports stored before parentKo/parentMain read the plan's current parent wording ("인사와 고정 과제" → plain).
        const st = PLAN_STAGES.get(id);
        return {
          id,
          title_ko: st?.parentKo ?? (typeof x.title_ko === 'string' ? x.title_ko : ''),
          main: typeof x.main === 'boolean' ? x.main : st?.parentMain === true,
          utterances: isNum(x.utterances) ? x.utterances : 0,
          passes: isNum(x.passes) ? x.passes : 0
        };
      });
    out.lesson = lesson;
  }
  return out;
}

/**
 * Free text the teacher typed (comment, next lesson) is public too: the child's nickname becomes "아이"
 * ("지우가 잘했어요" → "아이가 잘했어요"), the rest is left as written.
 */
export function maskNickname(text: string, nickname: string): string {
  const n = nickname.trim();
  if (n.length < 2) return text;
  return text.split(n).join('아이');
}
