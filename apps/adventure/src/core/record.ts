import type { AdventureActivity, AdventureEnvelope, AdventureLineMode, AdventureOutcome } from '@lcw/schemas';
import { AdventureEnvelopeSchema, ADVENTURE_ENVELOPE_MAX_BYTES } from '@lcw/schemas';
import type { AdventureChapterId, AdventureLevel } from '@lcw/content';
import { ADV } from './tuning.js';

/**
 * What one chapter play leaves behind (docs/22 3장, english-day contract v1): the lines the child said, picked, built or
 * spelled, the words caught in the bullet patterns, how it ended. The same record feeds the end screen (A05), the
 * guardian summary (A06) and the envelope sent to the student document.
 */

export interface LineEntry {
  en: string;
  ko: string;
  mode: AdventureLineMode;
  ok: boolean;
  tries: number;
  stars: 0 | 1 | 2 | 3;
  /** Said at a word stone (practice on the way; not counted for the chapter's three stars). */
  stone?: boolean;
}

export interface ChapterRecord {
  chapter: AdventureChapterId;
  level: AdventureLevel;
  /** The student's own level (L1-L6) when the document or device named it. */
  langLevel: string | null;
  startedMs: number;
  endedMs: number | null;
  lines: LineEntry[];
  words: Map<string, { caught: number; missed: number }>;
  hpLost: number;
  outcome: AdventureOutcome;
  /** Encounters befriended / fought out of three. */
  befriended: string[];
  fought: string[];
}

export function startRecord(chapter: AdventureChapterId, level: AdventureLevel, words: readonly string[], nowMs: number, langLevel: string | null = null): ChapterRecord {
  const m = new Map<string, { caught: number; missed: number }>();
  for (const w of words) m.set(w, { caught: 0, missed: 0 });
  return { chapter, level, langLevel: langLevel && /^L[1-6]$/.test(langLevel) ? langLevel : null, startedMs: nowMs, endedMs: null, lines: [], words: m, hpLost: 0, outcome: 'quit', befriended: [], fought: [] };
}

/** One TALK answered: the same sentence tried again updates its entry (tries go up, the best result stays). */
export function addLine(r: ChapterRecord, e: Omit<LineEntry, 'tries'> & { tries?: number }): void {
  const prev = r.lines.find((l) => l.en === e.en && (l.mode === e.mode || (isSpeech(l.mode) && isSpeech(e.mode))));
  if (prev) {
    prev.tries += e.tries ?? 1;
    if (e.ok && (!prev.ok || e.stars > prev.stars)) {
      prev.ok = true;
      prev.stars = e.stars;
      prev.mode = e.mode;
    }
    return;
  }
  if (r.lines.length >= ADV.recordMax.lines) return;
  r.lines.push({ en: e.en, ko: e.ko, mode: e.mode, ok: e.ok, tries: e.tries ?? 1, stars: e.stars, ...(e.stone ? { stone: true } : {}) });
}

const isSpeech = (m: AdventureLineMode) => m === 'voice' || m === 'typed';

export function wordHit(r: ChapterRecord, w: string, kind: 'caught' | 'missed'): void {
  const x = r.words.get(w) ?? { caught: 0, missed: 0 };
  x[kind] += 1;
  if (r.words.has(w) || r.words.size < ADV.recordMax.words) r.words.set(w, x);
}

/**
 * Lowercase words, punctuation gone, a contraction cut to its first word ("I'm fine. She'll swim!" → i fine she swim):
 * she'll is not "shell", we're is not "were". The day word goes through the same cut.
 */
function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/([a-z])'[a-z]+/g, '$1')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** A sentence's word is the day word or its plural (shell → shells, box → boxes, puppy → puppies). */
function sameWord(tok: string | undefined, base: string): boolean {
  if (tok === undefined) return false;
  return tok === base || tok === `${base}s` || tok === `${base}es` || (base.endsWith('y') && tok === `${base.slice(0, -1)}ies`);
}

/** Does the sentence hold this word or phrase as whole words ("good bye" also counts for goodbye)? */
export function saysWord(sentence: string, word: string): boolean {
  const t = tokens(sentence);
  const w = tokens(word);
  if (!w.length) return false;
  const joined = w.join('');
  for (let i = 0; i < t.length; i++) {
    if (w.every((x, k) => (k === w.length - 1 ? sameWord(t[i + k], x) : t[i + k] === x))) return true;
    // a word heard split in two or a phrase heard as one ("good bye", "thankyou")
    if (t[i] === joined || (i + 1 < t.length && t[i]! + t[i + 1]! === joined)) return true;
  }
  return false;
}

/**
 * The child said (or typed) a sentence: every day word in it counts as caught, once per answer (coordinator 11-19:
 * an island finished by speaking must not show the day's words as not done in the guardian's word column).
 */
export function wordsSaid(r: ChapterRecord, sentences: readonly string[]): string[] {
  const hit: string[] = [];
  for (const w of r.words.keys()) {
    if (sentences.some((s) => saysWord(s, w))) {
      wordHit(r, w, 'caught');
      hit.push(w);
    }
  }
  return hit;
}

/** Chapter stars (docs/22 4장). */
export function chapterStars(r: ChapterRecord): 0 | 1 | 2 | 3 {
  if (r.outcome === 'quit') return 0;
  if (r.outcome !== 'spared') return 1;
  const spoken = r.lines.filter((l) => !l.stone && isSpeech(l.mode) && l.ok && l.stars >= 2).length;
  return r.befriended.length >= 3 && spoken >= ADV.chapterThreeStarSpoken ? 3 : 2;
}

function iso(ms: number): string {
  // Korea time with its offset, as the contract shows ("2026-11-19T17:40:00+09:00")
  return `${new Date(ms + 9 * 3600_000).toISOString().slice(0, 19)}+09:00`;
}

export function toActivity(r: ChapterRecord, nowMs: number): AdventureActivity {
  const end = r.endedMs ?? nowMs;
  const words = [...r.words.entries()].slice(0, ADV.recordMax.words).map(([w, x]) => ({ w, ok: x.caught > 0 && x.caught >= x.missed, caught: x.caught, missed: x.missed }));
  return {
    id: `ch${r.chapter}`,
    kind: 'chapter',
    label: `모험 ${r.chapter}장`,
    startedAt: iso(r.startedMs),
    endedAt: iso(end),
    seconds: Math.max(0, Math.round((end - r.startedMs) / 1000)),
    stars: chapterStars(r),
    starsMax: 3,
    correct: r.lines.filter((l) => l.ok).length,
    total: r.lines.length,
    words,
    lines: r.lines.slice(0, ADV.recordMax.lines).map((l) => ({ en: l.en.slice(0, ADV.recordMax.text), ko: l.ko.slice(0, ADV.recordMax.text), mode: l.mode, ok: l.ok, tries: Math.max(1, l.tries) })),
    extra: { outcome: r.outcome, hp_lost: r.hpLost, level: r.langLevel ?? `L${r.level}` }
  };
}

const OUTCOME_RANK = { quit: 0, fought: 1, spared: 2 } as const;

/** A replay sends only when it is at least as good as the play already sent for that island (spared, then stars). */
export function betterPlay(a: AdventureActivity, b: AdventureActivity): boolean {
  const ra = OUTCOME_RANK[a.extra.outcome];
  const rb = OUTCOME_RANK[b.extra.outcome];
  return ra !== rb ? ra > rb : a.stars >= b.stars;
}

/**
 * The envelope's day: the lesson day, unless the document would refuse it (the receiver takes KST today -10 … +2 days
 * with a student key, english-day contract v1); then today, so a result from an old link is not lost.
 */
export function envelopeDate(lessonDay: string | null | undefined, today: string): string {
  if (!lessonDay || !/^\d{4}-\d{2}-\d{2}$/.test(lessonDay)) return today;
  const d = (Date.parse(`${lessonDay}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000;
  return d >= -ADV.envelopeDays.before && d <= ADV.envelopeDays.after ? lessonDay : today;
}

/** The envelope's date and its plays: a play for a lesson day outside the window goes under today with `extra.lessonDate`. */
export function datedPlays(lessonDay: string | null | undefined, today: string, acts: readonly AdventureActivity[]): { date: string; acts: AdventureActivity[] } {
  const date = envelopeDate(lessonDay, today);
  if (!lessonDay || date === lessonDay || !/^\d{4}-\d{2}-\d{2}$/.test(lessonDay)) return { date, acts: [...acts] };
  return { date, acts: acts.map((a) => ({ ...a, extra: { ...a.extra, lessonDate: lessonDay } })) };
}

const OUTCOME_KO: Record<AdventureOutcome, string> = { spared: '말로 친구가 되어 끝냄', fought: '콕 찌르기로 끝냄', quit: '중간에 멈춤' };

/** One Korean line for the guardian (contract `summaryKo`). */
export function summaryKo(acts: readonly AdventureActivity[]): string {
  if (!acts.length) return '아직 모험 기록이 없어요';
  return acts
    .map((a) => {
      const caught = a.words.filter((w) => w.ok).length;
      const spoken = a.lines.filter((l) => l.ok && (l.mode === 'voice' || l.mode === 'typed')).length;
      return `${a.label}: ${OUTCOME_KO[a.extra.outcome]}, 별 ${a.stars}/3, 문장 ${a.correct}/${a.total}개 성공(말·타이핑 ${spoken}개), 낱말 ${a.words.length}개 중 ${caught}개 잡음`;
    })
    .join(' · ')
    .slice(0, ADV.recordMax.text);
}

/** The envelope (contract v1); null when it would not pass the receiver's checks. */
export function buildEnvelope(student: string, date: string, acts: readonly AdventureActivity[]): AdventureEnvelope | null {
  if (!acts.length) return null;
  const env: AdventureEnvelope = { v: 1, source: 'lcw-adventure', student, date, activities: acts.slice(0, ADV.recordMax.activities), summaryKo: summaryKo(acts) };
  const ok = AdventureEnvelopeSchema.safeParse(env);
  if (!ok.success) return null;
  if (new TextEncoder().encode(JSON.stringify(env)).length > ADVENTURE_ENVELOPE_MAX_BYTES) return null;
  return env;
}
