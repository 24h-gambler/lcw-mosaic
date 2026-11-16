/**
 * The language the child is learning, and the language the frame's screens show (frame domain).
 *
 * Stand-in for the world lane's `world/lang.ts` (same names, same device key, same event). When that file lands this
 * module becomes `export * from '../world/lang.js'` plus `uiLang()`, so frame code may rely on these six names only:
 * LearnLang, learnLang, setLearnLang, learnLangChosen, onLearnLang, uiLang.
 */
import { LANG_PACK_MANIFEST } from '@lcw/content';

export type LearnLang = 'en';

const LEARN_LANG_KEY = 'lcw.learnLang';
const LEARN_LANG_EVENT = 'lcw:learn-lang';

const SUPPORTED: readonly LearnLang[] = ['en'];
/** The content pack's target language is the default until the child picks one. */
const DEFAULT_LANG: LearnLang = LANG_PACK_MANIFEST.target_lang;

function stored(): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(LEARN_LANG_KEY);
  } catch {
    return null;
  }
}

/** The language being learned; unknown or missing reads as the content pack's target language. */
export function learnLang(): LearnLang {
  const v = stored();
  return (SUPPORTED as readonly string[]).includes(v ?? '') ? (v as LearnLang) : DEFAULT_LANG;
}

/** True once the child (or a grown-up) has picked a language on this device. */
export function learnLangChosen(): boolean {
  const v = stored();
  return v !== null && (SUPPORTED as readonly string[]).includes(v);
}

export function setLearnLang(l: LearnLang): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(LEARN_LANG_KEY, l);
  } catch {
    // private mode or storage full: the change still applies for this visit through the event
  }
  try {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(LEARN_LANG_EVENT, { detail: l }));
  } catch {
    // no window (tests)
  }
}

export function onLearnLang(cb: (l: LearnLang) => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const h = (): void => cb(learnLang());
  window.addEventListener(LEARN_LANG_EVENT, h);
  return () => window.removeEventListener(LEARN_LANG_EVENT, h);
}

/** The screens show in the language being learned (every supported learn language is also a screen language). */
export function uiLang(): 'en' | 'ko' {
  return learnLang();
}
