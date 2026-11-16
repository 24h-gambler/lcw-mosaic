import { ECHO_TRANSITION_LINE, FIRST_ERRAND, NPC_GENERIC_REACTIONS, NPC_OPENING_LINES, OPEN_ENDED_PROMPTS, PHRASE_BANK } from './lang-en-ko.js';
import { npcCast, voiceForCtx, type NpcVoice } from './npc-cast.js';

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
  return out;
}
