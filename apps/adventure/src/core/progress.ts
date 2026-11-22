import type { AdventureChapterId } from '@lcw/content';
import type { AdventureActivity, AdventureOutcome } from '@lcw/schemas';
import { betterPlay } from './record.js';

/**
 * Progress across the isles (docs/22 1.2): chapter 1 is always open; chapter k opens as soon as k-1 is cleared (R2734:
 * the trip goes on — the boat sails straight to the next island; the old next-lesson-day lock stopped the story).
 * Cleared chapters can be replayed any time. Kept in the device's localStorage and, for a linked child, in one server
 * settings key. `today` is kept in the signatures: the day a chapter was cleared is still recorded.
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

export function isUnlocked(p: Progress, ch: AdventureChapterId, _today: string, opts: { unlockAll?: boolean } = {}): boolean {
  if (opts.unlockAll || ch === 1 || isCleared(p, ch)) return true;
  return isCleared(p, (ch - 1) as AdventureChapterId);
}

/** Why a chapter is closed: 'previous' (finish the one before). */
export function lockReason(p: Progress, ch: AdventureChapterId, today: string): 'open' | 'previous' {
  return isUnlocked(p, ch, today) ? 'open' : 'previous';
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
    // a worse replay (in any tab) does not replace the island's best play in the guardian summary
    last: !prev?.last || betterPlay(r.activity, prev.last) ? r.activity : prev.last
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

/**
 * The server settings row holds ONE key for the adventure (docs/19 3장: flat, ≤40 keys, values ≤32 chars; the world
 * already uses most keys). `adv` = "1" + per chapter 5 characters: the lesson day it was cleared on (3 base-36 digits,
 * days since 2024-01-01), stars (0-3), outcome (s spared / f fought / q quit / - none); "-----" = not cleared yet.
 * The words stay on the device (a new device plays the island's own words).
 */
export const SETTINGS_KEY = 'adv';
const DAY0 = Date.UTC(2024, 0, 1);
const DAY_MS = 86_400_000;

function dayCode(day: string): string | null {
  const ms = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(ms)) return null;
  const n = Math.round((ms - DAY0) / DAY_MS);
  if (n < 0 || n >= 36 ** 3) return null;
  return n.toString(36).padStart(3, '0');
}

function codeDay(code: string): string | null {
  if (!/^[0-9a-z]{3}$/.test(code)) return null;
  return new Date(DAY0 + parseInt(code, 36) * DAY_MS).toISOString().slice(0, 10);
}

const OUT_CODE: Record<AdventureOutcome, string> = { spared: 's', fought: 'f', quit: 'q' };
const CODE_OUT: Record<string, AdventureOutcome> = { s: 'spared', f: 'fought', q: 'quit' };

export function toSettings(p: Progress): Record<string, string> {
  let v = '1';
  let any = false;
  for (const c of CHAPTER_IDS) {
    const x = p.chapters[c];
    const d = x?.clearedOn ? dayCode(x.clearedOn) : null;
    if (!x || !d) {
      v += '-----';
      continue;
    }
    any = true;
    v += `${d}${x.stars}${x.outcome ? OUT_CODE[x.outcome] : '-'}`;
  }
  return any ? { [SETTINGS_KEY]: v } : {};
}

/** Merges what the server remembers into this device's progress (the earlier clear day and the higher stars win). */
export function mergeSettings(p: Progress, settings: Record<string, unknown> | null | undefined): Progress {
  const v = settings?.[SETTINGS_KEY];
  if (typeof v !== 'string' || v[0] !== '1' || v.length !== 1 + 5 * CHAPTER_IDS.length) return p;
  const out: Progress = { v: 1, chapters: { ...p.chapters } };
  CHAPTER_IDS.forEach((c, i) => {
    const part = v.slice(1 + i * 5, 6 + i * 5);
    const day = codeDay(part.slice(0, 3));
    if (!day) return;
    const stars = Math.max(0, Math.min(3, Number(part[3]) || 0)) as ChapterProgress['stars'];
    const outcome = CODE_OUT[part[4] ?? ''] ?? null;
    const mine = out.chapters[c];
    out.chapters[c] = {
      clearedOn: mine?.clearedOn && mine.clearedOn < day ? mine.clearedOn : day,
      stars: Math.max(mine?.stars ?? 0, stars) as ChapterProgress['stars'],
      outcome: mine?.outcome === 'spared' || outcome === 'spared' ? 'spared' : outcome === 'fought' ? 'fought' : (mine?.outcome ?? outcome),
      words: mine?.words ?? [],
      last: mine?.last ?? null
    };
  });
  return out;
}

/** Words of the chapters before `ch` (the tower reviews them). */
export function earlierWords(p: Progress, ch: AdventureChapterId): string[] {
  const out: string[] = [];
  for (const c of CHAPTER_IDS) if (c < ch) for (const w of p.chapters[c]?.words ?? []) if (!out.includes(w)) out.push(w);
  return out;
}
