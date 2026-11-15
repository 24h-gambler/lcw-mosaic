import { describe, expect, it } from 'vitest';
import { lookupPhraseBank } from '@lcw/content';
import { decideConverseReward, soundKey, wordsMatch } from '../index.js';

/**
 * Lenient word matching for children's speech through Workers AI Whisper (docs/04 4.6). The production run on
 * 2026-11-16 transcribed every synthetic turn right (37/37: slow, Korean voice, Hangul-read English, broken, quiet,
 * noisy, child pitch); what lost points were near words: "code" for cold, "smoothies" for smoothie.
 */

const L1 = (item: string, mod: string | undefined, stars: 1 | 2 | 3) =>
  lookupPhraseBank({ ctx: 'cafe', level: 'L1', item, modifiers: mod ? [mod] : undefined })!.offers[stars - 1]!.text;
const say = (target: string, transcript: string, level: 'L1' | 'L2' = 'L1') =>
  decideConverseReward({ ctx: 'cafe', level, targetText: target, chosenStars: 1, transcript, hintLevel: 'full', inputSource: 'workers_ai', strictBank: true });

describe('wordsMatch', () => {
  it('accepts the near words a child or the recogniser produces', () => {
    for (const [t, s] of [
      ['cold', 'code'],
      ['cold', 'colt'],
      ['cold', 'gold'],
      ['water', 'warter'],
      ['water', 'wata'],
      ['smoothie', 'smoothies'],
      ['smoothie', 'smoothy'],
      ['smoothie', 'smoothi'],
      ['thirsty', 'tursty'],
      ['please', 'pleaz'],
      ['two', '2']
    ]) expect(wordsMatch(t!, s!), `${t} ~ ${s}`).toBe(true);
  });
  it('keeps different words apart', () => {
    for (const [t, s] of [
      ['cold', 'hot'],
      ['water', 'later'],
      ['smoothie', 'juice'],
      ['a', 'i'],
      ['is', 'it'],
      ['want', 'what'],
      ['lamp', 'map']
    ]) expect(wordsMatch(t!, s!), `${t} !~ ${s}`).toBe(false);
  });
  it('sound keys fold Korean-English confusions', () => {
    expect(soundKey('please')).toBe(soundKey('pleaz'));
    expect(soundKey('very')).toBe(soundKey('bery'));
    expect(soundKey('rice')).toBe(soundKey('lice'));
  });
});

describe('lenient scoring on bank sentences', () => {
  it('one blurred word no longer fails a short sentence', () => {
    expect(say(L1('smoothie', undefined, 1), 'Smoothies, please.')).toMatchObject({ pass: true, stars: 1 });
    expect(say(L1('water', 'cold', 2), 'Code water, please.')).toMatchObject({ pass: true, score: 1 });
    expect(say(L1('smoothie', 'cold', 3), 'Can I have cold smoothies please')).toMatchObject({ pass: true, stars: 3 });
    const l2 = lookupPhraseBank({ ctx: 'cafe', level: 'L2', item: 'smoothie', modifiers: ['cold'] })!.offers[2]!.text;
    expect(say(l2, "Can I get a cold smoothie cuz I'm thirsty", 'L2')).toMatchObject({ pass: true, stars: 3 });
  });
  it('still fails what is not the sentence', () => {
    expect(say(L1('water', 'cold', 2), 'Banana.').pass).toBe(false);
    expect(say(L1('smoothie', undefined, 1), 'Juice, please.').pass).toBe(false);
    expect(say(L1('water', 'cold', 2), 'please').pass).toBe(false);
    expect(say(L1('water', 'cold', 2), '시원한 물 주세요').pass).toBe(false);
  });
});
