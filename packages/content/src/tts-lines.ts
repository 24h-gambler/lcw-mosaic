import { ECHO_TRANSITION_LINE, FIRST_ERRAND, NPC_GENERIC_REACTIONS, NPC_OPENING_LINES, OPEN_ENDED_PROMPTS, PHRASE_BANK } from './lang-en-ko.js';
import { npcCast, voiceForCtx, type NpcVoice } from './npc-cast.js';
import { TRY_CAFE_OFFERS } from './try-order.js';
import { adventureFixedLines } from './adventure.js';

/**
 * English the public site speaks (apps/web: /try cafe owner, 🔊 buttons on the pages). Kept here so the server can
 * make them for visitors without a token like the other fixed lines; apps/web's site-voice test fails when a page
 * speaks a sentence that is missing here (copy it in when a page line changes).
 */
export const SITE_SPOKEN_LINES = {
  /** The /try cafe owner (cafe voice). */
  npc: [
    'Welcome to the honey cafe! What would you like today?',
    'Here you go! A warm honey tea, and a honey cookie for that great sentence!',
    'Here you go! One warm honey tea.'
  ],
  /** Sample sentences on the pages (model voice). */
  model: [
    "I'd like a red jetpack, please.",
    'Could you build a fast red jetpack?',
    "I'm looking for a red jetpack so that I can fly to the sky island!",
    'I did not mean to break it. I was testing my new rocket.',
    'Can you make a pumpkin helmet that glows at night?',
    'I think we should go down instead because the bridge is broken.',
    'Can I have a warm honey tea so that I stay warm?',
    'I want tea.',
    "I'm looking for a fuel-efficient red jetpack so that I can fly to the space station!",
    'I want to trade my blue stone because I need a helmet for the cave.',
    "I'm sorry. It was a mistake.",
    "I'm sorry. I didn't mean to break the window.",
    "I didn't mean to break it, and I will fix the wall so that the shop can open again.",
    'I would build a cafe.',
    'I would build a big cafe with a garden.',
    'I would build a big cafe so that my friends can meet there.'
  ]
} as const;

/**
 * The fixed lines the neural voice reads (docs/04 4.8 "뱅크 문장은 미리 합성"): what the NPCs say (openings, the
 * errand, reactions, the echo step) in their own voice, and every offer sentence in the model voice. The edge makes
 * these for anyone (guests too: the set is finite and each is made once, then served from R2), prebuilds them on the
 * operator's call, and makes any other text only for a child's own token through the quota meter.
 */
export interface TtsLine {
  text: string;
  voice: NpcVoice;
}

/** Same text everywhere: trimmed, single spaces (the cache key is built from this). */
export function normalizeTtsText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function ttsVoiceId(v: NpcVoice): string {
  return `${v.engine}-${v.speaker}`;
}

export function fixedTtsLines(lang: string = 'en'): TtsLine[] {
  const out: TtsLine[] = [];
  const seen = new Set<string>();
  const add = (text: string, voice: NpcVoice) => {
    const t = normalizeTtsText(text);
    const k = `${ttsVoiceId(voice)}|${t}`;
    if (!t || seen.has(k)) return;
    seen.add(k);
    out.push({ text: t, voice });
  };
  for (const [ctx, line] of Object.entries(NPC_OPENING_LINES)) add(line, voiceForCtx(ctx, lang));
  const giver = voiceForCtx('errand', lang);
  for (const line of Object.values(FIRST_ERRAND.lines)) add(line, giver);
  for (const ctx of Object.keys(npcCast(lang).ctxNpc)) {
    for (const line of NPC_GENERIC_REACTIONS) add(line, voiceForCtx(ctx, lang));
    for (const line of OPEN_ENDED_PROMPTS) add(line, voiceForCtx(ctx, lang));
    add(ECHO_TRANSITION_LINE.text, voiceForCtx(ctx, lang));
  }
  const model = npcCast(lang).modelVoice;
  for (const entry of PHRASE_BANK) for (const o of entry.offers) add(o.text, model);
  for (const o of TRY_CAFE_OFFERS) add(o.text, model);
  const cafe = voiceForCtx('cafe', lang);
  for (const line of SITE_SPOKEN_LINES.npc) add(line, cafe);
  for (const line of SITE_SPOKEN_LINES.model) add(line, model);
  // The /adventure/ islanders and its built-in sentences (docs/22 3장), last so the prebuild reaches the world first.
  for (const l of adventureFixedLines(lang)) add(l.text, l.voice);
  return out;
}
