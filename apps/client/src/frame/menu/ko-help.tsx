/**
 * Korean help (world/lang.ts helpKoOn, the same switch as the start screen's): while the screens show the learn language, a
 * small Korean line under the menu's tab labels, panel and section titles, setting names and hint paragraphs. Off, or
 * on Korean screens, it draws nothing. Read at render time; the frame re-renders the menu when either value changes
 * (FrameLayer, onLearnLang).
 */
import React from 'react';
import { helpKoOn } from '../../world/lang.js';
import { FRAME_STRINGS_BY_LANG, FRAME_STRINGS_KO, frameLang, type FrameStrings } from '../strings.js';

/** Korean help shows now: the player turned it on and the frame is not in Korean already. */
export function koHelpActive(): boolean {
  return frameLang() !== 'ko' && helpKoOn();
}

/** The Korean of one frame string (picked from the Korean table), or null while Korean help is off. */
export function ko(get: (t: FrameStrings) => string | undefined): string | null {
  if (!koHelpActive()) return null;
  return get(FRAME_STRINGS_KO as FrameStrings) ?? null;
}

/** Screen-language text -> Korean, for strings passed around as plain text (setting rows). First match wins. */
const reverse = new Map<string, Map<string, string>>();
function reverseOf(lang: string): Map<string, string> {
  let m = reverse.get(lang);
  if (m) return m;
  m = new Map();
  const walk = (a: unknown, k: unknown): void => {
    if (typeof a === 'string' && typeof k === 'string') {
      if (!m!.has(a)) m!.set(a, k);
    } else if (a && k && typeof a === 'object' && typeof k === 'object') {
      for (const key of Object.keys(a)) walk((a as Record<string, unknown>)[key], (k as Record<string, unknown>)[key]);
    }
  };
  walk(FRAME_STRINGS_BY_LANG[lang as keyof typeof FRAME_STRINGS_BY_LANG], FRAME_STRINGS_KO);
  reverse.set(lang, m);
  return m;
}

export function koOf(text: string | undefined): string | null {
  if (!text || !koHelpActive()) return null;
  return reverseOf(frameLang()).get(text) ?? null;
}

/** `<KoHelp get={(t) => t.bagTitle} />` or `<KoHelp of={title} />`: the small Korean line, or nothing. */
export function KoHelp(props: { get?: (t: FrameStrings) => string | undefined; of?: string }): React.ReactElement | null {
  const text = props.get ? ko(props.get) : koOf(props.of);
  if (!text) return null;
  return (
    <span className="ko" lang="ko">
      {text}
    </span>
  );
}
