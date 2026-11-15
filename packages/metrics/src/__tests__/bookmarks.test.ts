import { describe, expect, it } from 'vitest';
import {
  BOOKMARK_WINDOW_MS,
  collectCandidateExpressions,
  extractBookmarkWindows,
  type BookmarkTranscriptLine
} from '../bookmarks.js';

const T: BookmarkTranscriptLine[] = [
  { at_ms: 5_000, speaker: 'teacher', text: 'What would you like?' },
  { at_ms: 40_000, speaker: 'student', text: 'Can I have a warm honey tea' },
  { at_ms: 45_000, speaker: 'student', text: 'yes' },
  { at_ms: 50_000, speaker: 'teacher', text: 'Sure.' },
  { at_ms: 62_000, speaker: 'student', text: 'so I stay warm' },
  { at_ms: 200_000, speaker: 'student', text: 'I want a red jetpack please' }
];

describe('bookmark windows (WP-304/305, report draft T03)', () => {
  it('cuts a 30 second window each side and returns lines in order', () => {
    const [w] = extractBookmarkWindows([{ kind: 'expression', at_ms: 50_000 }], T);
    expect(BOOKMARK_WINDOW_MS).toBe(30_000);
    expect(w!.window_start_ms).toBe(20_000);
    expect(w!.window_end_ms).toBe(80_000);
    expect(w!.lines.map((l) => l.at_ms)).toEqual([40_000, 45_000, 50_000, 62_000]);
  });

  it('clamps the window start at zero and includes boundary lines', () => {
    const [w] = extractBookmarkWindows([{ kind: 'coaching', at_ms: 10_000 }], T);
    expect(w!.window_start_ms).toBe(0);
    expect(w!.lines.map((l) => l.at_ms)).toEqual([5_000, 40_000]);
  });

  it('proposes student phrases of 2+ words for expression marks, nearest-before first, none for coaching', () => {
    const expr = extractBookmarkWindows([{ kind: 'expression', at_ms: 50_000 }], T)[0]!;
    const coach = extractBookmarkWindows([{ kind: 'coaching', at_ms: 50_000 }], T)[0]!;
    expect(expr.candidate_expressions).toEqual(['Can I have a warm honey tea?', 'so I stay warm']);
    expect(coach.candidate_expressions).toEqual([]);
    expect(coach.lines.length).toBeGreaterThan(0);
  });

  it('sorts unsorted bookmarks and transcript, and handles empty input', () => {
    const out = extractBookmarkWindows(
      [
        { kind: 'expression', at_ms: 200_000 },
        { kind: 'expression', at_ms: 50_000 }
      ],
      [...T].reverse()
    );
    expect(out.map((w) => w.bookmark.at_ms)).toEqual([50_000, 200_000]);
    expect(out[1]!.candidate_expressions).toEqual(['I want a red jetpack please.']);
    expect(extractBookmarkWindows([], T)).toEqual([]);
    expect(extractBookmarkWindows([{ kind: 'expression', at_ms: 1 }], [])[0]!.candidate_expressions).toEqual([]);
  });

  it('de-duplicates candidates across overlapping windows', () => {
    const windows = extractBookmarkWindows(
      [
        { kind: 'expression', at_ms: 48_000 },
        { kind: 'expression', at_ms: 55_000 }
      ],
      T
    );
    const flat = collectCandidateExpressions(windows);
    expect(new Set(flat.map((s) => s.toLowerCase())).size).toBe(flat.length);
    expect(flat).toContain('Can I have a warm honey tea?');
  });
});
