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

export interface HeardAlternative {
  transcript: string;
  confidence: number;
}

const words = (t: string) => t.toLowerCase().replace(/[^a-z' ]/g, ' ').split(/\s+/).filter(Boolean);

/**
 * Of the recognizer's alternatives, the one that covers most of the target's words (free talk: the first). The
 * server still scores it; this only stops a near-miss first guess from hiding a better second one (same as /join).
 */
export function pickHeard(alts: readonly HeardAlternative[], target: string, free: boolean): HeardAlternative | null {
  const clean = alts.filter((a) => a.transcript.trim());
  if (!clean.length) return null;
  if (free || !target.trim()) return clean[0]!;
  const want = words(target);
  const cover = (t: string) => {
    const heard = words(t);
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
  return clean.reduce((best, a) => (cover(a.transcript) > cover(best.transcript) ? a : best), clean[0]!);
}

/** Recognizer errors after which the microphone will not work this lesson: switch to typing and say why. */
export const MIC_BLOCKING_ERRORS: ReadonlySet<string> = new Set(['not-allowed', 'service-not-allowed', 'audio-capture', 'network']);

/** iOS in-app web views (KakaoTalk, Instagram, WKWebView) expose a recognizer that never answers. */
export function micUnreliable(ua: string): boolean {
  const ios = /iPhone|iPad|iPod/i.test(ua);
  if (!ios) return false;
  if (/KAKAOTALK|Instagram|FBAN|FBAV|NAVER\(inapp|\bLine\/\d|DaumApps/i.test(ua)) return true;
  return /AppleWebKit/i.test(ua) && !/Safari\//i.test(ua);
}
