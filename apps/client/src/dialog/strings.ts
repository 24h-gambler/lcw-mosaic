import { UI_STRINGS_EN, UI_STRINGS_KO, feedbackEnFromKo, npcPersona, type UiStrings } from '@lcw/content';
import { helpLine } from '../lesson/strings.js';
import { helpKoOn, learnLang } from '../world/lang.js';

/**
 * The dialog-domain screen lines in the language the child learns (world/lang.ts, Dan 11-16): English tables when
 * the child learns English, with the Korean line under it only when the Korean help is on.
 *
 * `ui()` is read at render time, so a language change applies from the next render. `live(section)` gives an object
 * that always reads the current table (for the module-level `S` / `F` / `R` shorthands the components use).
 */
export function ui(): UiStrings {
  return learnLang() === 'en' ? UI_STRINGS_EN : (UI_STRINGS_KO as unknown as UiStrings);
}

/** Korean help line for an English screen line: the Korean text when the help is on, else null. */
export function helpKo(ko: string | null | undefined, shown: string): string | null {
  if (!ko || learnLang() !== 'en' || !helpKoOn() || ko === shown) return null;
  return ko;
}

export function live<K extends keyof UiStrings>(section: K): UiStrings[K] {
  return new Proxy({} as object, {
    get: (_t, key) => (ui()[section] as Record<string | symbol, unknown>)[key],
    has: (_t, key) => key in (ui()[section] as object),
    ownKeys: () => Reflect.ownKeys(ui()[section] as object),
    getOwnPropertyDescriptor: (_t, key) => Object.getOwnPropertyDescriptor(ui()[section] as object, key)
  }) as UiStrings[K];
}

/**
 * A line built from the tables (names and values filled in per language): the language the child learns, with the
 * Korean after a dot when the Korean help is on, the same "English · 한국어" as the rest of the frame (lesson/strings.ts
 * joinHelp). Goal line, walk button and reward toast go through this (they were English only with the help on).
 */
export function biLine(make: (lang: 'en' | 'ko', t: UiStrings) => string): string {
  const koT = UI_STRINGS_KO as unknown as UiStrings;
  if (learnLang() !== 'en') return make('ko', koT);
  return helpLine(make('en', UI_STRINGS_EN), make('ko', koT));
}

/** An NPC's short cast name in one language (the English name plate name, or the short Korean one). */
export function npcShortName(npcId: string, lang: 'en' | 'ko'): string {
  const p = npcPersona(npcId);
  return (lang === 'en' ? p?.nameEn : p?.nameKoShort) ?? '';
}

/** The Korean section, for the help line under an English one. */
export function ko<K extends keyof UiStrings>(section: K): UiStrings[K] {
  return UI_STRINGS_KO[section] as unknown as UiStrings[K];
}

/** Result feedback (answered in Korean by the grader / server) in the screen language, plus its help line. */
export function feedbackLine(feedbackKo: string, feedbackEn?: string | null): { text: string; help: string | null } {
  if (learnLang() !== 'en') return { text: feedbackKo, help: null };
  const en = feedbackEn?.trim() || feedbackEnFromKo(feedbackKo);
  if (!en) return { text: feedbackKo, help: null };
  return { text: en, help: helpKo(feedbackKo, en) };
}
