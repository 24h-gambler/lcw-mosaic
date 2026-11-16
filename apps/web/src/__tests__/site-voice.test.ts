import { describe, expect, it } from 'vitest';
import { fixedTtsLines, normalizeTtsText } from '@lcw/content';
import { LEARN_PAGES, LOOP_OFFERS, PLAY, SAMPLE_DASH, TUTORING } from '../site/copy.js';
import { CAFE_OFFERS_NOW } from '../site/copyNow.js';
import { TRY_NPC, TRY_OFFERS } from '../site/tryState.js';

/**
 * Dan 11-16 "아직도 목소리가 기계음": the site speaks in the world's neural voices. Visitors have no token, so the
 * server only makes fixed lines for them; every sentence a page can speak must be one (@lcw/content
 * SITE_SPOKEN_LINES), or that 🔊 falls back to the device voice.
 */

/** Parents page demo lines (inline in pages/Parents.tsx). */
const PARENTS_DEMO = ['I want tea.', 'Can I have a warm honey tea so that I stay warm?'];

function siteSpoken(): string[] {
  return [
    TRY_NPC.welcome,
    TRY_NPC.serve(3),
    TRY_NPC.serve(1),
    ...TRY_OFFERS.map((o) => o.text),
    ...LOOP_OFFERS.map((o) => o.text),
    ...CAFE_OFFERS_NOW.map((o) => o.text),
    ...LEARN_PAGES.flatMap((p) => p.offers.map((o) => o.text)),
    PLAY.boomLine,
    PLAY.makeLine,
    SAMPLE_DASH.oneLinerEn,
    TUTORING.windowSample.target,
    ...PARENTS_DEMO
  ];
}

describe('site voice', () => {
  it('every sentence the site speaks is a fixed neural line', () => {
    const fixed = new Set(fixedTtsLines().map((l) => l.text));
    const missing = siteSpoken().filter((t) => !fixed.has(normalizeTtsText(t)));
    expect(missing).toEqual([]);
  });
});
