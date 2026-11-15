import { describe, expect, it } from 'vitest';
import { FIRST_LESSON_PLAN } from '@lcw/content';
import { formatExpression, isWholeExpression, meaningfulExpression, meaningfulExpressions } from '../expressions.js';

const targets = FIRST_LESSON_PLAN.stages.flatMap((s) => s.targets);
const said = [
  'can I have a warm honey tea',
  'I will give you my red hat for your cookie',
  'I want to trade my blue stone because I need a helmet for the cave',
  'I want a jetpack so that I can fly to school'
];

describe('parent-readable expressions (report "오늘 수업에서 나온 표현", WP-310)', () => {
  it('grows fragments to the child\'s whole sentence or clause; never shows "Can I have" or "for your"', () => {
    expect(meaningfulExpression('Can I have', { utterances: said, targets })).toBe('Can I have a warm honey tea?');
    expect(meaningfulExpression('for your', { utterances: said, targets })).toBe('I will give you my red hat for your cookie.');
    expect(meaningfulExpression('because', { utterances: said, targets })).toBe('because I need a helmet for the cave');
    expect(meaningfulExpression('so that', { utterances: said, targets })).toBe('so that I can fly to school');
  });

  it('falls back to the plan sentence when the child did not say it, and drops what nothing explains', () => {
    expect(meaningfulExpression('Can I have', { utterances: [], targets })).toBe('Can I have a warm honey tea?');
    expect(meaningfulExpression('for your', { utterances: [], targets })).toBeNull();
    expect(meaningfulExpression('my name is', { utterances: [], targets })).toBeNull(); // the plan only has 'My name is ___.'
    expect(meaningfulExpression('  ', { utterances: said, targets })).toBeNull();
    expect(meaningfulExpression('네, 좋아요', { utterances: said, targets })).toBeNull();
  });

  it('keeps whole phrases as said, tidied for the page', () => {
    expect(meaningfulExpression('“Honey tea, please”', { utterances: [], targets })).toBe('Honey tea, please.');
    expect(meaningfulExpression('i like drawing because it makes me happy', { utterances: [], targets })).toBe('I like drawing because it makes me happy.');
    expect(meaningfulExpression('warm honey tea', { utterances: [], targets })).toBe('Warm honey tea.');
    expect(isWholeExpression('Can I have a')).toBe(false);
    expect(isWholeExpression('I want to trade my')).toBe(false);
    expect(isWholeExpression('give it to me')).toBe(true);
    expect(formatExpression('what is your name')).toBe('What is your name?');
  });

  it('a long whole line is cut to the clause with the plan\'s core pattern', () => {
    const long = 'yesterday after school I went to the shop with my mom because I need a helmet for the cave trip';
    expect(meaningfulExpression(long, { utterances: [], targets })).toBe('because I need a helmet for the cave trip');
  });

  it('every word of a kept expression is in its source: nothing is invented', () => {
    const out = meaningfulExpressions(['Can I have', 'for your', 'so that', 'can I have a warm honey tea', 'the'], { utterances: said, targets });
    expect(out).toEqual(['Can I have a warm honey tea?', 'I will give you my red hat for your cookie.', 'so that I can fly to school']);
    const vocab = new Set(said.join(' ').toLowerCase().split(/\s+/));
    for (const e of out) for (const w of e.toLowerCase().replace(/[.?!,]/g, '').split(/\s+/)) expect(vocab.has(w)).toBe(true);
  });
});
