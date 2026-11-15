/**
 * How much of the target sentence the child sees (docs/04 hint ladder; docs/19 §4 per-stage hint):
 * full = the sentence, keyword = only the core phrases (others as blanks), initial = the first word only
 * (recall: "화면은 첫 단어만 보여 줍니다"), picture/none = nothing written.
 */
import type { LessonHintLevel } from '@lcw/content';

export function blankWord(w: string): string {
  const core = w.replace(/[^A-Za-z']/g, '');
  return core ? w.replace(core, '_'.repeat(Math.min(6, core.length))) : w;
}

export function maskTarget(text: string, hint: LessonHintLevel, hintTags: readonly string[] = []): string {
  if (hint === 'full') return text;
  if (hint === 'none' || hint === 'picture') return '';
  const words = text.split(/\s+/).filter(Boolean);
  if (hint === 'initial') return words.length ? `${words[0]} …` : '';
  // keyword: keep the words that belong to a core phrase, blank the rest
  const keep = new Set(
    hintTags.flatMap((t) => t.toLowerCase().split(/\s+/)).filter(Boolean)
  );
  return words.map((w) => (keep.has(w.toLowerCase().replace(/[^a-z']/g, '')) ? w : blankWord(w))).join(' ');
}
