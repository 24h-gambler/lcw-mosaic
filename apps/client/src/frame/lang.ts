/**
 * The language the child learns and the Korean help switch, as the frame reads them, plus the frame's screen language.
 *
 * Temporary stand-in for the world lane's `world/lang.ts` (main dd3618c, #101): same names, same device keys
 * ('lcw.learnLang', 'lcw.helpKo'), same event ('lcw:learn-lang' with both values, other tabs through 'storage').
 * Once this branch has that file, this module becomes a re-export of it plus `uiLang()`; frame code relies on these
 * names only: LearnLang, learnLang, learnLangChosen, chosenLearnLang, setLearnLang, helpKoOn, setHelpKo, onLearnLang,
 * Bi, say, uiLang.
 */
import { LANG_PACK_MANIFEST } from '@lcw/content';

export type LearnLang = 'en';

const LEARN_LANG_KEY = 'lcw.learnLang';
const HELP_KO_KEY = 'lcw.helpKo';
const LEARN_LANG_EVENT = 'lcw:learn-lang';
const READY: readonly LearnLang[] = ['en'];
/** The content pack's target language until the child picks one. */
const DEFAULT_LEARN_LANG: LearnLang = LANG_PACK_MANIFEST.target_lang;

function read(key: string): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
  } catch {
    /* private window: the choice lasts for this page */
  }
}

let memoryLang: LearnLang | null = null;
let memoryHelpKo: boolean | null = null;

function readLearnLang(raw: unknown): LearnLang | null {
  return (READY as readonly unknown[]).includes(raw) ? (raw as LearnLang) : null;
}

function announce(): void {
  try {
    globalThis.dispatchEvent?.(new CustomEvent(LEARN_LANG_EVENT, { detail: { learnLang: learnLang(), helpKo: helpKoOn() } }));
  } catch {
    /* no window (tests in node) */
  }
}

export function chosenLearnLang(): LearnLang | null {
  return readLearnLang(read(LEARN_LANG_KEY)) ?? memoryLang;
}
export function learnLangChosen(): boolean {
  return chosenLearnLang() !== null;
}
/** What the screen speaks: the chosen language, the content pack's target language until then. */
export function learnLang(): LearnLang {
  return chosenLearnLang() ?? DEFAULT_LEARN_LANG;
}
export function setLearnLang(lang: LearnLang): void {
  const ok = readLearnLang(lang);
  if (!ok) return;
  memoryLang = ok;
  write(LEARN_LANG_KEY, ok);
  announce();
}

export function helpKoOn(): boolean {
  const v = read(HELP_KO_KEY);
  if (v === '1') return true;
  if (v === '0') return false;
  return memoryHelpKo ?? false;
}
export function setHelpKo(on: boolean): void {
  memoryHelpKo = on;
  write(HELP_KO_KEY, on ? '1' : '0');
  announce();
}

/** Called on every change of either value; returns the undo. Also hears other tabs (the storage event). */
export function onLearnLang(cb: (v: { learnLang: LearnLang; helpKo: boolean }) => void): () => void {
  const fire = (): void => cb({ learnLang: learnLang(), helpKo: helpKoOn() });
  const onStorage = (e: StorageEvent): void => {
    if (e.key === LEARN_LANG_KEY || e.key === HELP_KO_KEY) fire();
  };
  globalThis.addEventListener?.(LEARN_LANG_EVENT, fire);
  globalThis.addEventListener?.('storage', onStorage as EventListener);
  return () => {
    globalThis.removeEventListener?.(LEARN_LANG_EVENT, fire);
    globalThis.removeEventListener?.('storage', onStorage as EventListener);
  };
}

export interface Bi {
  en: string;
  ko: string;
}
export function say(line: Bi, help = helpKoOn()): { text: string; help: string | null } {
  return { text: line.en, help: help && line.ko && line.ko !== line.en ? line.ko : null };
}

/** Frame only: the screens show in the language being learned (every learn language is also a screen language). */
export function uiLang(): 'en' | 'ko' {
  return learnLang();
}

/** Tests only (stand-in for world/lang resetLangForTest). */
export function resetLangForTest(): void {
  memoryLang = null;
  memoryHelpKo = null;
}
