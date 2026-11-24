import {
  bankEntriesFor,
  bankItemKey,
  bankTextKey,
  findBankOffer,
  PATTERN_GLOSS_KO,
  UI_STRINGS_KO,
  type LangLevel,
  type PhraseBankEntry,
  type PhraseOffer
} from '@lcw/content';
import type { HintLevel } from '@lcw/schemas';
import { scoreUtterance, type ScoringResult } from './scoring.js';

/**
 * Server-side reward decision for /v1/converse/score (docs/04 4.2, 4.6; AGENTS 4.7).
 * Everything that is worth something — the star grade of the sentence, the price, the item — comes from the
 * phrase bank on the server. The request only says which sentence the child tried and what they said.
 */

export type InputSource = 'device' | 'workers_ai' | 'browser' | 'keyboard' | 'board';

/** docs/04 4.1: typed (or card-assembled) input counts for at most 2 stars. */
export const NON_VOICE_STAR_CAP = 2;
/**
 * ECHO (docs/04 4.1) ends with the child repeating phrase by phrase; the joined phrases are scored against the
 * target. This floor only guards against an empty/garbage echo, the normal threshold would make ECHO pointless.
 */
export const ECHO_MIN_SCORE = 0.4;
/** A sentence the bank does not know (teacher-typed, or forged) may log at most 1 star and never buys anything. */
export const UNKNOWN_TARGET_STAR_CAP = 1;

export interface ConverseRewardInput {
  ctx: string;
  level: LangLevel;
  targetText: string;
  /** Client claim; only used when the bank does not know the sentence (then capped at 1). */
  chosenStars: 1 | 2 | 3;
  transcript: string;
  hintLevel: HintLevel;
  inputSource?: InputSource;
  /**
   * The child finished the phrase-by-phrase ECHO step. The caller passes this only after it has checked on the
   * server that the same dialog already missed twice (docs/04 4.1: ECHO from the 3rd miss); a client claim alone
   * must never lower the pass line.
   */
  echo?: boolean;
  /**
   * Student solo path: only bank sentences count (an unknown sentence gets nothing), and an empty target (free
   * talk) is matched to the closest bank sentence of this NPC at the child's level.
   */
  strictBank?: boolean;
}

export interface ConverseRewardDecision {
  pass: boolean;
  score: number;
  missed: string[];
  /** Stars granted (0 when not passed). */
  stars: 0 | 1 | 2 | 3;
  /** Star grade of the attempted sentence according to the bank (or the capped claim). */
  targetStars: 1 | 2 | 3;
  bank: { entry: PhraseBankEntry; itemKey: string } | null;
  /** Coins to charge for the granted stars (0 when nothing is bought). */
  priceCoins: number;
  /**
   * 'intent' / 'free_talk' (R2861①): free talk that passed no bank sentence but still counts — it named a thing this
   * NPC has (the child gets it at the 1-star price), or it was real English talk (3+ English words, 1 star, nothing sold).
   */
  capped: 'none' | 'core_pattern' | 'non_voice' | 'unknown_target' | 'echo' | 'intent' | 'free_talk';
  coreMissed: boolean;
  /** The pattern phrase the feedback should name when the core pattern was missed (e.g. "because"). */
  corePhrase: string | null;
  /** The sentence actually scored (the matched bank sentence when the request came without a target). */
  targetText: string;
  scoring: ScoringResult;
}

/** The pattern phrase (because, so that, can I have...) of a bank entry that appears in this sentence. */
export function corePhraseOf(entry: PhraseBankEntry | undefined, text: string): string | null {
  if (!entry) return null;
  const key = ` ${bankTextKey(text)} `;
  for (const tag of entry.hintTags) {
    const t = tag.toLowerCase().trim();
    if (PATTERN_GLOSS_KO[t] && key.includes(` ${bankTextKey(t)} `)) return tag;
  }
  return null;
}

/**
 * Free talk with no chosen sentence: the closest bank sentence for this NPC at the child's level. A passing
 * sentence with the most stars wins; with no pass, the best score (so the miss feedback is about something real).
 */
function closestBankSentence(input: ConverseRewardInput): { entry: PhraseBankEntry; offer: PhraseOffer; pass: boolean } | null {
  let best: { entry: PhraseBankEntry; offer: PhraseOffer; pass: boolean; score: number } | null = null;
  for (const entry of bankEntriesFor(input.ctx, input.level)) {
    for (const offer of entry.offers) {
      const r = scoreUtterance({
        targetText: offer.text,
        spokenTranscript: input.transcript,
        level: input.level,
        hintLevel: input.hintLevel,
        stars: offer.stars,
        hintTags: entry.hintTags
      });
      let better = !best;
      if (best) {
        if (r.pass !== best.pass) better = r.pass;
        else if (r.pass) better = offer.stars > best.offer.stars || (offer.stars === best.offer.stars && r.score > best.score);
        else better = r.score > best.score;
      }
      if (better) best = { entry, offer, pass: r.pass, score: r.score };
    }
  }
  return best ? { entry: best.entry, offer: best.offer, pass: best.pass } : null;
}

/** English words in what the child said (Korean or noise words do not count). */
export function englishWords(transcript: string): number {
  return (transcript.match(/[a-z]+(?:'[a-z]+)?/gi) ?? []).length;
}
/** Free talk this long passes as talk even when it names nothing this NPC has (R2861①, lesson-mode scoreFreeTalk too). */
export const FREE_TALK_MIN_WORDS = 3;
/** Naming a thing needs at least this many English words around it ("axe please", not a bare word). */
export const INTENT_MIN_WORDS = 2;

/**
 * R2861① (Dan 11-23 "정해진 대로만 진행 · 자유 회화 느낌이 전혀 없음"): the thing this NPC has that the child named in their
 * own words ("I need an axe to cut trees" -> the axe), the longest name first ("fish tank" before "fish"). The name is
 * the entry's first hint tag (the item label); the 1-star line of that entry stands for what was asked.
 */
export function intentBankSentence(ctx: string, level: LangLevel, transcript: string): { entry: PhraseBankEntry; offer: PhraseOffer } | null {
  if (englishWords(transcript) < INTENT_MIN_WORDS) return null;
  const said = ` ${bankTextKey(transcript)} `;
  let best: { entry: PhraseBankEntry; offer: PhraseOffer; len: number } | null = null;
  for (const entry of bankEntriesFor(ctx, level)) {
    const label = entry.hintTags[0]?.toLowerCase().trim();
    if (!label) continue;
    const key = bankTextKey(label);
    if (!key) continue;
    // the word or its plural ("axes", "boxes")
    const hit = said.includes(` ${key} `) || said.includes(` ${key}s `) || said.includes(` ${key}es `);
    if (!hit) continue;
    const offer = entry.offers.find((o) => o.stars === 1) ?? entry.offers[0];
    if (!offer) continue;
    if (!best || key.length > best.len) best = { entry, offer, len: key.length };
  }
  return best ? { entry: best.entry, offer: best.offer } : null;
}

export function decideConverseReward(input: ConverseRewardInput): ConverseRewardDecision {
  const emptyTarget = input.targetText.trim() === '';
  const closest = input.strictBank && emptyTarget ? closestBankSentence(input) : null;
  // R2861①: own words that pass no sentence of this NPC still count when they name a thing it has (asked for it) or
  // are real English talk; only then the plain miss ("almost") — never stuck on one fixed sentence.
  const intent = closest && !closest.pass && !input.echo ? intentBankSentence(input.ctx, input.level, input.transcript) : null;
  const freeTalk = !!closest && !closest.pass && !intent && !input.echo && englishWords(input.transcript) >= FREE_TALK_MIN_WORDS;
  if (intent || freeTalk) {
    const scoring = scoreUtterance({
      targetText: intent ? intent.offer.text : input.transcript,
      spokenTranscript: input.transcript,
      level: input.level,
      hintLevel: input.hintLevel,
      stars: 1,
      hintTags: intent?.entry.hintTags
    });
    return {
      pass: true,
      score: Math.max(scoring.score, 0.5),
      missed: [],
      stars: 1,
      targetStars: 1,
      bank: intent ? { entry: intent.entry, itemKey: bankItemKey(intent.entry) } : null,
      priceCoins: intent ? intent.offer.price : 0,
      capped: intent ? 'intent' : 'free_talk',
      coreMissed: false,
      corePhrase: null,
      targetText: intent ? intent.offer.text : '',
      scoring
    };
  }
  const hit =
    input.strictBank && emptyTarget
      ? closest
      : findBankOffer({ ctx: input.ctx, level: input.level, text: input.targetText });
  const targetText = hit && emptyTarget ? hit.offer.text : input.targetText;
  const targetStars: 1 | 2 | 3 = hit ? hit.offer.stars : (Math.min(input.chosenStars, UNKNOWN_TARGET_STAR_CAP) as 1);
  const scoring = scoreUtterance({
    targetText,
    spokenTranscript: input.transcript,
    level: input.level,
    hintLevel: input.hintLevel,
    stars: targetStars,
    hintTags: hit?.entry.hintTags
  });

  let capped: ConverseRewardDecision['capped'] = 'none';
  let pass = scoring.pass;
  let stars = 0;
  if (input.echo) {
    pass = scoring.score >= ECHO_MIN_SCORE;
    stars = pass ? Math.max(1, targetStars - 1) : 0;
    if (pass) capped = 'echo';
  } else if (pass) {
    stars = targetStars;
    if (scoring.starCap < stars) {
      stars = scoring.starCap;
      capped = 'core_pattern';
    }
  }
  const nonVoice = input.inputSource === 'keyboard' || input.inputSource === 'board';
  if (pass && nonVoice && stars > NON_VOICE_STAR_CAP) {
    stars = NON_VOICE_STAR_CAP;
    capped = 'non_voice';
  }
  if (!hit && input.chosenStars > UNKNOWN_TARGET_STAR_CAP && pass) capped = 'unknown_target';
  if (!hit && input.strictBank) {
    // Solo orders only count bank sentences: a made-up target ("hi" == "hi") earns nothing.
    pass = false;
    stars = 0;
    capped = 'unknown_target';
  }

  const granted = stars as 0 | 1 | 2 | 3;
  const priceCoins = hit && granted > 0 ? hit.entry.offers[granted - 1]!.price : 0;
  return {
    pass,
    score: scoring.score,
    missed: scoring.missed,
    stars: granted,
    targetStars,
    bank: hit ? { entry: hit.entry, itemKey: bankItemKey(hit.entry) } : null,
    priceCoins,
    capped,
    coreMissed: scoring.coreTotal > 0 && scoring.coreMatchRate === 0,
    corePhrase: corePhraseOf(hit?.entry, targetText),
    targetText,
    scoring
  };
}

/** Short, warm Korean feedback for the result card (docs/08 8.2; never blames the child, docs/04 4.1). */
export function converseFeedbackKo(
  d: Pick<ConverseRewardDecision, 'pass' | 'stars' | 'targetStars' | 'capped' | 'coreMissed'> & {
    corePhrase?: string | null;
    inputSource?: InputSource;
    bought?: boolean;
    shortOfCoins?: boolean;
  }
): string {
  const s = UI_STRINGS_KO.dialog.feedback;
  const phrase = d.corePhrase ?? null;
  if (!d.pass) {
    if (d.capped === 'unknown_target') return s.pickOffer;
    if (d.coreMissed) return phrase ? s.coreMissedPhrase.replace('{p}', phrase) : s.coreMissed;
    return s.almost;
  }
  // Not getting the item matters most to a child, so that reason comes first.
  if (d.shortOfCoins) return d.stars >= 3 && d.capped === 'none' ? s.shortOfCoins : s.shortOfCoinsGood;
  if (d.capped === 'echo') return s.echoDone;
  if (d.capped === 'intent') return s.intentOk;
  if (d.capped === 'free_talk') return s.freeTalkOk;
  if (d.capped === 'core_pattern') return phrase ? s.cappedCorePhrase.replace('{p}', phrase) : s.cappedCore;
  if (d.capped === 'non_voice') return d.inputSource === 'keyboard' ? s.cappedKeyboard : s.cappedNonVoice;
  if (d.stars >= 3) return s.perfect;
  return d.stars >= d.targetStars ? s.passNextUp : s.pass;
}
