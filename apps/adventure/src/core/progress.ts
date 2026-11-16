import type { AdventureChapterId } from '@lcw/content';
import type { AdventureActivity, AdventureOutcome } from '@lcw/schemas';

/**
 * Progress across lesson days (docs/22 1.2): chapter 1 is always open; chapter k opens on a day after the one k-1 was
 * cleared on (Korea time), so the isles go one lesson day at a time. Cleared chapters can be replayed any time.
 * Kept in the device's localStorage and, for a linked child, in the server settings row (flat keys, 32-char values).
 */

export const CHAPTER_IDS: readonly AdventureChapterId[] = [1, 2, 3, 4];
export const STORAGE_KEY = 'lcw.adventure.v1';

export interface ChapterProgress {
  /** Korea-time day it was first cleared on. */
  clearedOn: string | null;
  stars: 0 | 1 | 2 | 3;
  outcome: AdventureOutcome | null;
  /** The words it was played with (replay and chapter 4 review use them). */
  words: string[];
  /** Last finished (or left) play, for the guardian summary. */
  last: AdventureActivity | null;
}

export interface Progress {
  v: 1;
  chapters: Partial<Record<AdventureChapterId, ChapterProgress>>;
}

export const emptyProgress = (): Progress => ({ v: 1, chapters: {} });

/** YYYY-MM-DD in Korea (UTC+9, no daylight time). */
export function kstDate(nowMs: number): string {
  return new Date(nowMs + 9 * 3600_000).toISOString().slice(0, 10);
}

export function isCleared(p: Progress, ch: AdventureChapterId): boolean {
  return Boolean(p.chapters[ch]?.clearedOn);
}

export function isUnlocked(p: Progress, ch: AdventureChapterId, today: string, opts: { unlockAll?: boolean } = {}): boolean {
  if (opts.unlockAll || ch === 1 || isCleared(p, ch)) return true;
  const prev = p.chapters[(ch - 1) as AdventureChapterId];
  return Boolean(prev?.clearedOn && prev.clearedOn < today);
}

/** Why a chapter is closed: 'previous' (finish the one before) or 'tomorrow' (cleared the one before today). */
export function lockReason(p: Progress, ch: AdventureChapterId, today: string): 'open' | 'previous' | 'next-day' {
  if (isUnlocked(p, ch, today)) return 'open';
  return isCleared(p, (ch - 1) as AdventureChapterId) ? 'next-day' : 'previous';
}

/** The chapter the island map points at: the first open one not cleared yet, else the last open one. */
export function nextChapter(p: Progress, today: string, opts: { unlockAll?: boolean } = {}): AdventureChapterId {
  const open = CHAPTER_IDS.filter((c) => isUnlocked(p, c, today, opts));
  return open.find((c) => !isCleared(p, c)) ?? open[open.length - 1] ?? 1;
}

export function recordFinish(
  p: Progress,
  ch: AdventureChapterId,
  today: string,
  r: { stars: 0 | 1 | 2 | 3; outcome: AdventureOutcome; words: string[]; activity: AdventureActivity }
): Progress {
  const prev = p.chapters[ch];
  const finished = r.outcome !== 'quit';
  const next: ChapterProgress = {
    clearedOn: prev?.clearedOn ?? (finished ? today : null),
    stars: Math.max(prev?.stars ?? 0, finished ? r.stars : 0) as ChapterProgress['stars'],
    outcome: finished ? (prev?.outcome === 'spared' ? 'spared' : r.outcome) : (prev?.outcome ?? null),
    words: prev?.words?.length ? prev.words : r.words,
    last: r.activity
  };
  return { v: 1, chapters: { ...p.chapters, [ch]: next } };
}

export function parseProgress(raw: string | null | undefined): Progress {
  if (!raw) return emptyProgress();
  try {
    const j = JSON.parse(raw) as Progress;
    if (j?.v !== 1 || typeof j.chapters !== 'object' || !j.chapters) return emptyProgress();
    const out = emptyProgress();
    for (const c of CHAPTER_IDS) {
      const x = j.chapters[c];
      if (!x) continue;
      out.chapters[c] = {
        clearedOn: typeof x.clearedOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x.clearedOn) ? x.clearedOn : null,
        stars: ([0, 1, 2, 3] as const).includes(x.stars) ? x.stars : 0,
        outcome: x.outcome === 'spared' || x.outcome === 'fought' || x.outcome === 'quit' ? x.outcome : null,
        words: Array.isArray(x.words) ? x.words.filter((w) => typeof w === 'string').slice(0, 6) : [],
        last: x.last && typeof x.last === 'object' ? x.last : null
      };
    }
    return out;
  } catch {
    return emptyProgress();
  }
}

/** Server settings keys (docs/19 3장: flat, ≤40 keys, values ≤32 chars). */
export function toSettings(p: Progress): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of CHAPTER_IDS) {
    const x = p.chapters[c];
    if (!x?.clearedOn) continue;
    out[`adv.c${c}`] = `${x.clearedOn}|${x.stars}|${x.outcome ?? ''}`.slice(0, 32);
    let w = '';
    for (const word of x.words) {
      const n = w ? `${w},${word}` : word;
      if (n.length > 32) break;
      w = n;
    }
    if (w) out[`adv.w${c}`] = w;
  }
  return out;
}

/** Merges what the server remembers into this device's progress (the earlier clear day and the higher stars win). */
export function mergeSettings(p: Progress, settings: Record<string, unknown> | null | undefined): Progress {
  if (!settings) return p;
  const out: Progress = { v: 1, chapters: { ...p.chapters } };
  for (const c of CHAPTER_IDS) {
    const v = settings[`adv.c${c}`];
    if (typeof v !== 'string') continue;
    const [day, s, outcome] = v.split('|');
    if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    const stars = Math.max(0, Math.min(3, Number(s) || 0)) as ChapterProgress['stars'];
    const w = settings[`adv.w${c}`];
    const words = typeof w === 'string' ? w.split(',').filter(Boolean) : [];
    const mine = out.chapters[c];
    out.chapters[c] = {
      clearedOn: mine?.clearedOn && mine.clearedOn < day ? mine.clearedOn : day,
      stars: Math.max(mine?.stars ?? 0, stars) as ChapterProgress['stars'],
      outcome: mine?.outcome === 'spared' || outcome === 'spared' ? 'spared' : outcome === 'fought' ? 'fought' : (mine?.outcome ?? null),
      words: mine?.words?.length ? mine.words : words,
      last: mine?.last ?? null
    };
  }
  return out;
}

/** Words of the chapters before `ch` (the tower reviews them). */
export function earlierWords(p: Progress, ch: AdventureChapterId): string[] {
  const out: string[] = [];
  for (const c of CHAPTER_IDS) if (c < ch) for (const w of p.chapters[c]?.words ?? []) if (!out.includes(w)) out.push(w);
  return out;
}
