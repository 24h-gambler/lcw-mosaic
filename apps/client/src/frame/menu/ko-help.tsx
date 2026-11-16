/**
 * Korean help (world/lang.ts helpKoOn, the same switch as the start screen's): a small Korean line under the menu's
 * English tab labels, panel and section titles, setting names and hint paragraphs (world/lang.ts `say`: the English
 * stays the screen line, the Korean is the help). Off, it draws nothing. Read at render time; the frame re-renders the
 * menu when the switch changes (FrameLayer, onLearnLang). Short words elsewhere get the Korean after a dot instead
 * (frame/strings.ts FRAME_STRINGS).
 */
import React from 'react';
import { helpKoOn, say } from '../../world/lang.js';
import { FRAME_STRINGS_EN, FRAME_STRINGS_KO, type FrameStrings } from '../strings.js';

/** Korean help shows now. */
export function koHelpActive(): boolean {
  return helpKoOn();
}

/** The Korean of one frame string (picked from the Korean table), or null while Korean help is off. */
export function ko(get: (t: FrameStrings) => string | undefined): string | null {
  const en = get(FRAME_STRINGS_EN);
  return say({ en: en ?? '', ko: get(FRAME_STRINGS_KO as FrameStrings) ?? '' }).help;
}

/** English text -> Korean, for strings passed around as plain text (setting rows). First match wins. */
let reverse: Map<string, string> | null = null;
function reverseMap(): Map<string, string> {
  if (reverse) return reverse;
  const m = new Map<string, string>();
  const walk = (a: unknown, k: unknown): void => {
    if (typeof a === 'string' && typeof k === 'string') {
      if (!m.has(a)) m.set(a, k);
    } else if (a && k && typeof a === 'object' && typeof k === 'object') {
      for (const key of Object.keys(a)) walk((a as Record<string, unknown>)[key], (k as Record<string, unknown>)[key]);
    }
  };
  walk(FRAME_STRINGS_EN, FRAME_STRINGS_KO);
  reverse = m;
  return m;
}

export function koOf(text: string | undefined): string | null {
  if (!text) return null;
  return say({ en: text, ko: reverseMap().get(text) ?? '' }).help;
}

/**
 * `<KoHelp get={(t) => t.bagTitle} />`, `<KoHelp of={englishText} />` or `<KoHelp text={korean} />`: the small Korean
 * line, or nothing while the help is off.
 */
export function KoHelp(props: { get?: (t: FrameStrings) => string | undefined; of?: string; text?: string | null }): React.ReactElement | null {
  const text = props.get ? ko(props.get) : props.of !== undefined ? koOf(props.of) : props.text && helpKoOn() ? props.text : null;
  if (!text) return null;
  return (
    <span className="ko" lang="ko">
      {text}
    </span>
  );
}
