import {
  CAFE_MENU,
  CAFE_MODIFIER_INFO,
  CONNECTORS,
  FUNCTION_WORDS,
  FURNITURE_SHOP_GOODS,
  TRADE_SHOP_GOODS,
  lookupPhraseBank,
  type CafeModifier,
  type LangLevel
} from '@lcw/content';
import { normalizeMixedUtterance, tokenizeForScoring, wordsMatch } from '@lcw/converse';
import type { DialogHint, DialogOffer, NpcRef } from './types.js';

/** One display token of a target sentence at a hint level (docs/08 8.2: full → keyword → initial → picture). */
export interface HintToken {
  /** Original word including trailing punctuation. */
  word: string;
  /** What the child sees. */
  shown: string;
  /** True when this word is part of a hint tag (rendered as a highlighted keyword). */
  key: boolean;
  /** Normalized form used to colour hits/misses after scoring. */
  norm: string;
}

const PUNCT_RE = /^([^A-Za-z0-9']*)(.*?)([^A-Za-z0-9']*)$/;

export function splitWords(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

function normWord(w: string): string {
  return w.toLowerCase().replace(/[^a-z0-9']/g, '');
}

/** Word positions covered by a hint tag phrase (case-insensitive, contiguous). */
export function keywordPositions(words: readonly string[], hintTags: readonly string[]): Set<number> {
  const norms = words.map(normWord);
  const out = new Set<number>();
  for (const tag of hintTags) {
    const phrase = splitWords(tag).map(normWord).filter(Boolean);
    if (phrase.length === 0) continue;
    for (let i = 0; i + phrase.length <= norms.length; i++) {
      let ok = true;
      for (let j = 0; j < phrase.length; j++) if (norms[i + j] !== phrase[j]) ok = false;
      if (ok) for (let j = 0; j < phrase.length; j++) out.add(i + j);
    }
  }
  return out;
}

function maskWord(word: string, keepFirst: boolean): string {
  const m = PUNCT_RE.exec(word);
  if (!m) return word;
  const [, pre, core, post] = m;
  if (!core) return word;
  const body = keepFirst ? core[0] + '_'.repeat(Math.max(1, core.length - 1)) : '_'.repeat(Math.max(2, core.length));
  return `${pre}${body}${post}`;
}

/**
 * keyword: hint-tag words stay, every other word becomes blanks of its length.
 * initial: first letter of every word plus blanks. none/picture: no letters at all (caller shows picture or nothing).
 */
export function renderHintTokens(text: string, hintTags: readonly string[], hint: DialogHint): HintToken[] {
  const words = splitWords(text);
  const keys = keywordPositions(words, hintTags);
  return words.map((word, i) => {
    const key = keys.has(i);
    let shown = word;
    if (hint === 'keyword') shown = key ? word : maskWord(word, false);
    else if (hint === 'initial') shown = maskWord(word, true);
    else if (hint === 'picture' || hint === 'none') shown = '';
    return { word, shown, key, norm: normWord(word) };
  });
}

/** docs/04 4.8: the listen button hides once the hint level rises above full. */
export function listenAllowed(hint: DialogHint): boolean {
  return hint === 'full';
}

/** Pictures for the `picture` hint and the thought board: the item and its modifier. */
export function picturesFor(text: string): string[] {
  const lower = text.toLowerCase();
  const out: string[] = [];
  const drink = [...CAFE_MENU].sort((a, b) => b.label.length - a.label.length).find((d) => lower.includes(d.label));
  if (drink) {
    const mod = (Object.keys(CAFE_MODIFIER_INFO) as CafeModifier[]).find((m) => new RegExp(`\\b${m}\\b`).test(lower));
    if (mod) out.push(CAFE_MODIFIER_INFO[mod].emoji);
    out.push(drink.emoji);
  }
  const good = TRADE_SHOP_GOODS.find((g) => new RegExp(`\\b${g.label}\\b`).test(lower));
  if (good) out.push(good.emoji);
  const furniture = [...FURNITURE_SHOP_GOODS].sort((a, b) => b.label.length - a.label.length).find((g) => lower.includes(g.label));
  if (furniture) out.push(furniture.emoji);
  if (/\bbecause\b|\bso that\b/.test(lower)) out.push('💬');
  return out.length > 0 ? out : ['💬'];
}

/** Offers for an NPC when the caller passed none (docs/19 3: "비면 뱅크에서 npc.ctx로 찾음"). */
export function bankOffersFor(npc: NpcRef, level: LangLevel, item?: string, modifier?: string): DialogOffer[] {
  const entry = lookupPhraseBank({ ctx: npc.ctx, level, item, modifiers: modifier ? [modifier] : undefined });
  if (!entry) return [];
  return entry.offers.map((o) => ({
    stars: o.stars,
    text: o.text,
    hintTags: entry.hintTags.filter((t) => keywordPositions(splitWords(o.text), [t]).size > 0)
  }));
}

/**
 * Toby's furniture lines for one kind of furniture (docs/03 D13): after the build screen says what the room lacks
 * (or the child read it aloud), the trade shop offers that kind instead of its default barter lines. The first good
 * of the kind is the one offered; the server prices it (and spends today's read-aloud discount on it).
 */
export function furnitureOffersFor(kind: 'light' | 'rest' | 'flat', level: LangLevel): DialogOffer[] {
  const good = FURNITURE_SHOP_GOODS.find((g) => g.role === kind);
  if (!good) return [];
  return bankOffersFor({ id: 'shop_owner', ctx: 'trade_shop', nameKo: '토비', nameEn: 'Toby' }, level, good.key, good.adj);
}

const CHUNK_BREAKERS = new Set(['because', 'so', 'for', 'with', 'to', 'if', 'when', 'and']);

/**
 * ECHO (docs/04 4.1, docs/08 8.2 "구 단위로 끊어 따라 말하기"): phrases of 2~4 words, broken at commas and before
 * connectors so a child repeats meaningful pieces.
 */
export function chunkPhrases(text: string, maxWords = 3): string[] {
  const words = splitWords(text);
  const chunks: string[][] = [];
  let cur: string[] = [];
  for (const w of words) {
    const n = normWord(w);
    if (cur.length >= 2 && CHUNK_BREAKERS.has(n)) {
      chunks.push(cur);
      cur = [];
    }
    cur.push(w);
    if ((/[,.?!]$/.test(w) && cur.length >= 2) || cur.length >= maxWords) {
      chunks.push(cur);
      cur = [];
    }
  }
  if (cur.length > 0) chunks.push(cur);
  // A lone word is not a phrase: glue it to its neighbour.
  for (let i = chunks.length - 1; i >= 0 && chunks.length > 1; i--) {
    if (chunks[i]!.length === 1) {
      if (i > 0) chunks[i - 1]!.push(...chunks[i]!);
      else chunks[1]!.unshift(...chunks[0]!);
      chunks.splice(i, 1);
    }
  }
  return chunks.map((c) => c.join(' '));
}

/** Small deterministic PRNG so the word-card order is stable for one sentence (no Math.random in render). */
function seededRandom(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

export interface WordCard {
  id: string;
  word: string;
}

/**
 * Word cards for the no-microphone path (조합판): the target's words, shuffled, plus up to two distractors so the
 * child still has to think. Punctuation is dropped from cards and restored on submit by the scorer's tokenizer.
 */
export function buildWordCards(text: string, distractors: readonly string[] = []): WordCard[] {
  const words = splitWords(text).map((w) => w.replace(/[.,!?]+$/g, ''));
  const pool = [...words, ...distractors.slice(0, 2)];
  const rnd = seededRandom(text);
  const cards = pool.map((word, i) => ({ id: `${i}-${word}`, word }));
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [cards[i], cards[j]] = [cards[j]!, cards[i]!];
  }
  // Never hand out the cards already in the right order.
  if (cards.map((c) => c.word).join(' ') === words.join(' ') && cards.length > 1) cards.reverse();
  return cards;
}

/** Distractor words for the word cards: other modifiers/items of the same context. */
export function distractorsFor(text: string): string[] {
  const lower = text.toLowerCase();
  const mods = (Object.keys(CAFE_MODIFIER_INFO) as CafeModifier[]).filter((m) => !lower.includes(m));
  const fn = ['the', 'is'];
  return [mods[0] ?? fn[0]!, fn[1]!];
}

export interface MixedSpeech {
  raw: string;
  /** English shown under the raw transcript when Korean words were swapped (docs/04 4.4); null when unchanged. */
  converted: string | null;
}

export function convertMixedSpeech(raw: string): MixedSpeech {
  if (!/[가-힣]/.test(raw)) return { raw, converted: null };
  const n = normalizeMixedUtterance(raw);
  if (n.replacedCount === 0) return { raw, converted: null };
  const t = n.normalized.replace(/\bi\b/g, 'I');
  return { raw, converted: t.charAt(0).toUpperCase() + t.slice(1) };
}

/**
 * Which target words were heard (display colouring only — the reward is the server's).
 * Same tokenizer as the server so contractions line up.
 */
export function heardMask(target: string, transcript: string): boolean[] {
  const spoken = tokenizeForScoring(transcript);
  const pool = [...spoken];
  return splitWords(target).map((w) => {
    const toks = tokenizeForScoring(w);
    if (toks.length === 0) return true;
    // the server's word match (lenient for near words), so a word the server counted is not shown as missed
    const at = (t: string) => {
      const exact = pool.indexOf(t);
      return exact >= 0 ? exact : pool.findIndex((s) => wordsMatch(t, s));
    };
    const ok = toks.every((t) => at(t) >= 0);
    if (ok) for (const t of toks) pool.splice(at(t), 1);
    return ok;
  });
}

export function isCoreWord(w: string): boolean {
  const n = normWord(w);
  return CONNECTORS.includes(n as (typeof CONNECTORS)[number]) || !FUNCTION_WORDS.has(n);
}
