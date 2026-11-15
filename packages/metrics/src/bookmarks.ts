/**
 * Hotkey bookmarks to report-draft material (WP-304/305, report draft T03).
 * The teacher presses F1/F2 during the lesson and only the timestamp is stored. After the lesson this
 * pure function cuts the transcript around each bookmark and proposes candidate expressions.
 * Time is always passed in (ms since lesson start); no clock access.
 */

export const BOOKMARK_WINDOW_MS = 30_000;
export const BOOKMARK_MAX_CANDIDATES_PER_MARK = 3;
export const BOOKMARK_MIN_CANDIDATE_WORDS = 2;

export type LessonBookmarkKind = 'coaching' | 'expression';

export interface LessonBookmark {
  kind: LessonBookmarkKind;
  at_ms: number;
}

export interface BookmarkTranscriptLine {
  at_ms: number;
  speaker: 'student' | 'teacher';
  text: string;
}

export interface BookmarkWindow {
  bookmark: LessonBookmark;
  window_start_ms: number;
  window_end_ms: number;
  lines: BookmarkTranscriptLine[];
  /** Student phrases worth pinning; only filled for 'expression' bookmarks. */
  candidate_expressions: string[];
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function normKey(text: string): string {
  return text.trim().toLowerCase().replace(/[.,!?]+$/g, '');
}

export function extractBookmarkWindows(
  bookmarks: readonly LessonBookmark[],
  transcript: readonly BookmarkTranscriptLine[],
  windowMs: number = BOOKMARK_WINDOW_MS
): BookmarkWindow[] {
  const sortedTranscript = [...transcript].sort((a, b) => a.at_ms - b.at_ms);
  return [...bookmarks]
    .sort((a, b) => a.at_ms - b.at_ms)
    .map((bookmark) => {
      const start = Math.max(0, bookmark.at_ms - windowMs);
      const end = bookmark.at_ms + windowMs;
      const lines = sortedTranscript.filter((l) => l.at_ms >= start && l.at_ms <= end);
      let candidates: string[] = [];
      if (bookmark.kind === 'expression') {
        // The teacher presses after hearing the phrase, so lines just before the mark rank first.
        candidates = lines
          .filter((l) => l.speaker === 'student' && wordCount(l.text) >= BOOKMARK_MIN_CANDIDATE_WORDS)
          .map((l) => ({ l, d: l.at_ms <= bookmark.at_ms ? bookmark.at_ms - l.at_ms : bookmark.at_ms - l.at_ms + 2 * windowMs + 1 }))
          .sort((a, b) => Math.abs(a.d) - Math.abs(b.d))
          .slice(0, BOOKMARK_MAX_CANDIDATES_PER_MARK)
          .map((x) => x.l.text.trim());
      }
      return {
        bookmark,
        window_start_ms: start,
        window_end_ms: end,
        lines,
        candidate_expressions: candidates
      };
    });
}

/** Flat, de-duplicated candidate list across all bookmarks, in lesson order, for the T03 draft. */
export function collectCandidateExpressions(windows: readonly BookmarkWindow[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of windows) {
    for (const c of w.candidate_expressions) {
      const k = normKey(c);
      if (!seen.has(k)) {
        seen.add(k);
        out.push(c);
      }
    }
  }
  return out;
}
