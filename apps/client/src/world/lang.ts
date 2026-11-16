/**
 * The language the child learns, and the Korean help line (Dan 11-16 14:3x: "배울 언어가 English 면 화면 글을 영어로,
 * 한국어 도움말은 켜고 끄는 보조"). One place every lane reads: the start flow, the world HUD (world/strings.ts),
 * the frame (menus, settings, map) and the dialog.
 *
 * - `learnLang()`: what the screen speaks. Only English is open, so an unchosen device speaks English too.
 * - `learnLangChosen()`: whether the child picked it yet (the start flow asks once after sign-up).
 * - `helpKoOn()`: whether a Korean line is shown under the English (off unless turned on).
 * - Changes are announced on window 'lcw:learn-lang' (both values), read with `onLearnLang`.
 *
 * Device: localStorage 'lcw.learnLang' and 'lcw.helpKo'. Server: POST /v1/my-world/lang keeps the language with the
 * child (edge my-world.ts), and GET /v1/my-world answers it back, so another device of the child speaks it too.
 */
import { DEFAULT_LEARN_LANG, readLearnLang, type LearnLang } from '@lcw/content';

export type { LearnLang } from '@lcw/content';

export const LEARN_LANG_KEY = 'lcw.learnLang';
export const HELP_KO_KEY = 'lcw.helpKo';
export const LEARN_LANG_EVENT = 'lcw:learn-lang';

function store(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
function read(key: string): string | null {
  try {
    return store()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}
function write(key: string, value: string): void {
  try {
    store()?.setItem(key, value);
  } catch {
    /* private window: the choice lasts for this page */
  }
}

/** Held for the page when storage is blocked, so a choice made now still holds until the page closes. */
let memoryLang: LearnLang | null = null;
let memoryHelpKo: boolean | null = null;

function announce(): void {
  try {
    globalThis.dispatchEvent?.(new CustomEvent(LEARN_LANG_EVENT, { detail: { learnLang: learnLang(), helpKo: helpKoOn() } }));
  } catch {
    /* no window (tests in node) */
  }
}

/** The chosen language, or null before the child chose. */
export function chosenLearnLang(): LearnLang | null {
  return readLearnLang(read(LEARN_LANG_KEY)) ?? memoryLang;
}
export function learnLangChosen(): boolean {
  return chosenLearnLang() !== null;
}
/** What the screen speaks: the chosen language, English until then. */
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
  const fire = () => cb({ learnLang: learnLang(), helpKo: helpKoOn() });
  const onStorage = (e: StorageEvent) => {
    if (e.key === LEARN_LANG_KEY || e.key === HELP_KO_KEY) fire();
  };
  globalThis.addEventListener?.(LEARN_LANG_EVENT, fire);
  globalThis.addEventListener?.('storage', onStorage as EventListener);
  return () => {
    globalThis.removeEventListener?.(LEARN_LANG_EVENT, fire);
    globalThis.removeEventListener?.('storage', onStorage as EventListener);
  };
}

/** Tests only. */
export function resetLangForTest(): void {
  memoryLang = null;
  memoryHelpKo = null;
}

/**
 * A screen line in the language the child learns, with the Korean help line when it is on: `{ text, help }`, where
 * `help` is null when the help is off or the two are the same. Strings tables keep both: `{ en: '...', ko: '...' }`.
 */
export interface Bi {
  en: string;
  ko: string;
}
export function say(line: Bi, help = helpKoOn()): { text: string; help: string | null } {
  return { text: line.en, help: help && line.ko && line.ko !== line.en ? line.ko : null };
}
