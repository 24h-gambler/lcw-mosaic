/**
 * The /try cafe order (docs/14 §8, docs/01 §3): its three sentences and the matcher. Shared by the site, which grades
 * as the visitor speaks, and the server, which repeats the same grade before it counts the order (one per session),
 * so the two never disagree.
 */
import { FIRST_LESSON_PLAN } from './lesson-plans.js';

export interface TryOffer {
  stars: 1 | 2 | 3;
  text: string;
  /** Words that must be heard for this star level (the connector that makes it a 3-star sentence). */
  required?: readonly string[];
}

export interface OfferMatch {
  stars: 0 | 1 | 2 | 3;
  /** The offer the transcript matched (or the closest one when nothing passed). */
  offer: TryOffer;
  ratio: number;
}

/** Share of target words the browser recognizer must hear for the recognition path to pass. */
export const TRY_RECOGNITION_PASS_RATIO = 0.6;

const cafeStage = FIRST_LESSON_PLAN.stages.find((s) => s.id === 'cafe_order');

/** Same three sentences the first lesson uses for the cafe, so /try and the lesson agree. */
export const TRY_CAFE_OFFERS: readonly TryOffer[] = ([1, 2, 3] as const).map((n) => {
  const t = cafeStage?.targets.find((x) => x.stars === n);
  const fallback = ['Honey tea, please.', 'Can I have a warm honey tea?', 'Can I have a warm honey tea so that I stay warm?'][n - 1]!;
  return { stars: n, text: t?.text ?? fallback, ...(n === 3 ? { required: ['so', 'that'] } : {}) };
});

export function sentenceWords(sentence: string): string[] {
  return sentence.trim().split(/\s+/).filter(Boolean);
}

/** Compares assembled cards to the target, ignoring case and trailing punctuation. */
export function isSentenceAssembled(picked: readonly string[], target: string): boolean {
  const norm = (w: string) => w.toLowerCase().replace(/[.,!?]+$/g, '');
  const t = sentenceWords(target).map(norm);
  return picked.length === t.length && picked.every((w, i) => norm(w) === t[i]);
}

const normWords = (t: string): string[] =>
  t
    .toLowerCase()
    .replace(/[^a-z' ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

/** Share of the target's words heard in the transcript (order-free, each target word counted once). */
export function transcriptMatchRatio(transcript: string, target: string): number {
  const want = normWords(target);
  if (want.length === 0) return 0;
  const heard = normWords(transcript);
  let hit = 0;
  for (const w of want) {
    const i = heard.indexOf(w);
    if (i >= 0) {
      hit++;
      heard.splice(i, 1);
    }
  }
  return hit / want.length;
}

/** Per target word: was it heard in the transcript (order-free, each heard word used once)? Drives the green/underline paint. */
export function wordHits(transcript: string, target: string): boolean[] {
  const heard = normWords(transcript);
  return sentenceWords(target).map((raw) => {
    const w = normWords(raw)[0];
    if (!w) return true;
    const i = heard.indexOf(w);
    if (i < 0) return false;
    heard.splice(i, 1);
    return true;
  });
}

/**
 * Scores a transcript against every offer and keeps the highest star level that passes, so a child who aimed at
 * ★★★ but said the ★ sentence still gets their drink (forgiving, 08 §10). A level only passes when its required
 * connector words were heard.
 */
export function bestOfferMatch(transcript: string, offers: readonly TryOffer[], passRatio = TRY_RECOGNITION_PASS_RATIO): OfferMatch {
  let best: OfferMatch | null = null;
  let closest: OfferMatch | null = null;
  const heard = normWords(transcript);
  for (const o of offers) {
    const ratio = transcriptMatchRatio(transcript, o.text);
    const reqOk = (o.required ?? []).every((w) => heard.includes(w.toLowerCase()));
    if (!closest || ratio > closest.ratio) closest = { stars: 0, offer: o, ratio };
    if (ratio >= passRatio && reqOk && (!best || o.stars > best.stars)) best = { stars: o.stars, offer: o, ratio };
  }
  return best ?? closest ?? { stars: 0, offer: offers[0]!, ratio: 0 };
}

/** Stars for an order finished on word cards: a confirmed voice keeps the chosen level, cards alone stop at two (docs/04 4.1). */
export function cardOrderStars(aim: 1 | 2 | 3, spoke: boolean): 1 | 2 | 3 {
  return spoke ? aim : aim >= 2 ? 2 : 1;
}

export type TryOrderPath = 'recognition' | 'wordcards_with_loudness' | 'wordcards_only';

/**
 * The one grade of a /try order, run by the site while the visitor speaks and again by the server before it counts:
 * recognition → the best passing offer; word cards → the chosen sentence must be assembled exactly, then two stars at
 * most unless the loudness check heard a voice.
 */
export function gradeTryOrder(p: { aim: 1 | 2 | 3; text: string; path: TryOrderPath; spoke?: boolean }, offers: readonly TryOffer[] = TRY_CAFE_OFFERS): 0 | 1 | 2 | 3 {
  if (p.path === 'recognition') return bestOfferMatch(p.text, offers).stars;
  const target = offers.find((o) => o.stars === p.aim);
  if (!target || !isSentenceAssembled(sentenceWords(p.text), target.text)) return 0;
  return cardOrderStars(p.aim, p.path === 'wordcards_with_loudness' && p.spoke === true);
}
