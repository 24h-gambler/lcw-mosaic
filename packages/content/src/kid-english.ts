import { COMMON_WORDS_EN, NAME_LIKE_WORDS } from './common-words-en.js';
import { FUNCTION_WORDS } from './lang-en-ko.js';

/**
 * R2734 (Dan 11-19, "the English is not all at a 12-year-old's level"): a check that every English line a child reads
 * or hears in the adventure is at a 12-year-old's level — every word is an everyday word (common-words-en, the
 * function words, or the story words below), a name of the story, or a word of the lesson; and no sentence is longer
 * than KID_MAX_WORDS words. Run by apps/adventure/src/__tests__/adventure-english.test.ts over every line.
 */

/** The longest sentence a child reads in one go (words). */
export const KID_MAX_WORDS = 14;

/**
 * Story words a 12-year-old knows that the everyday list does not carry (lowercase; inflections are matched by
 * kidStems, so "glow" covers "glows / glowed / glowing"). Adding a word here is a judgement: a word a 12-year-old
 * meets in picture books and school readers, never a hard or rare one. The last row: the sounds of the story
 * ("Ding, ding!", "Hmph."), said the way a picture book says them.
 */
const KID_STORY_WORDS = `
acorn ago air anymore anyway arrow bakery become below berry bit blew blow boot bottom bouncy box bright bump bun bush
button buzz cannot captain careful cart ceiling chest circle claw clear code coin compass course crack crash crumb dark
basket bob bobs choices click covers curls drifts favourite flaps gate gatekeeper gates guardian guards lands least let
pocket rail swoops third wings
dive dodge done drag drip drop early earth empty end energy enter ever everywhere exercise explore fair fern fill fire
flat float fold forth forward friendship gently glass glow grab ground grow grumpy heal hear heard helmet hill himself
hum hurt ink inky iron job join lantern large late laugh less letter light live lot luck mean microphone mint minute
miss moss number oven pad page path peek pinch place poke polite pool pop post pouch pull quite quiz rainbow reach
reply rest ring rise roll rope round save scarf scary seen sentence shake shield shine shiny shoe shore shrink silent
sink smart smell smile sock sound space spark sparkle speak spelling spin splash sprinkle station stay stolen stomp story
sugar swing swirl teapot thing thorn though tight tip toast top touch treat trick voice way welcome wiggle work yet
zip zoom
blub bonk clack ding eh ha hmph ho ouch ow plip shhh squish yum
`;

const STORY = KID_STORY_WORDS.split(/\s+/).filter(Boolean);

export const KID_WORDS: ReadonlySet<string> = new Set(
  [...COMMON_WORDS_EN, ...NAME_LIKE_WORDS, ...[...FUNCTION_WORDS].map((w) => w.toLowerCase().replace(/'/g, '')), ...STORY].map((w) => w.toLowerCase())
);

const VOWEL = /[aeiou]/;

/** The forms a word may be the inflection of (plural, past, -ing, comparative, -ly), the word itself first. */
export function kidStems(word: string): string[] {
  const w = word.toLowerCase();
  const out = new Set<string>([w]);
  const add = (s: string) => {
    if (s.length >= 2) out.add(s);
  };
  const undouble = (s: string) => (s.length > 2 && s[s.length - 1] === s[s.length - 2] && !VOWEL.test(s[s.length - 1]!) ? s.slice(0, -1) : s);
  for (const [suf, rep] of [
    ['ies', 'y'],
    ['ied', 'y'],
    ['ier', 'y'],
    ['iest', 'y'],
    ['ily', 'y'],
    ['es', ''],
    ['s', ''],
    ['ed', ''],
    ['ed', 'e'],
    ['d', ''],
    ['ing', ''],
    ['ing', 'e'],
    ['er', ''],
    ['er', 'e'],
    ['est', ''],
    ['est', 'e'],
    ['ly', ''],
    ['ful', ''],
    ['ness', '']
  ] as const) {
    if (w.endsWith(suf) && w.length > suf.length + 1) {
      const base = w.slice(0, -suf.length) + rep;
      add(base);
      if (!rep) add(undouble(base));
    }
  }
  return [...out];
}

export interface KidProblem {
  kind: 'long' | 'word';
  /** the sentence (long) or the word (word) */
  detail: string;
  text: string;
}

/** Split a line into sentences (. ! ? and line breaks; quotes and dashes do not end one). */
export function kidSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])["”’)]*\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => /[A-Za-z]/.test(s));
}

/** The words of a sentence: letters with an inner apostrophe; 's / 'll / 're / 've / 'd / n't kept to the base. */
export function kidWords(sentence: string): string[] {
  return (sentence.match(/[A-Za-z]+(?:['’][A-Za-z]+)*/g) ?? []).map((t) => t.replace(/’/g, "'"));
}

function known(token: string, names: ReadonlySet<string>, extra: ReadonlySet<string>): boolean {
  if (names.has(token)) return true;
  let t = token.toLowerCase();
  // contractions the everyday list keeps without the apostrophe ("dont", "lets"), else the base word
  const flat = t.replace(/'/g, '');
  if (KID_WORDS.has(flat) || extra.has(flat)) return true;
  t = t.replace(/'(s|ll|re|ve|d|m)$/, '').replace(/n't$/, '');
  if (names.has(token.replace(/'s$/, ''))) return true;
  return kidStems(t).some((s) => KID_WORDS.has(s) || extra.has(s));
}

/**
 * The problems of one line: sentences longer than KID_MAX_WORDS and words outside the kid list. `names` are the
 * story's names, matched with their capital ("Old Fern", "Bramblebun"); `extra` the lesson's own words.
 */
export function checkKidEnglish(text: string, names: ReadonlySet<string> = new Set(), extra: ReadonlySet<string> = new Set()): KidProblem[] {
  const out: KidProblem[] = [];
  for (const s of kidSentences(text)) {
    const words = kidWords(s);
    if (words.length > KID_MAX_WORDS) out.push({ kind: 'long', detail: `${words.length} words: ${s}`, text });
    for (const w of words) if (!known(w, names, extra)) out.push({ kind: 'word', detail: w, text });
  }
  return out;
}

/** Every name word of a set of names ("Old Fern" → "Old", "Fern"), for checkKidEnglish. */
export function kidNameSet(names: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const n of names) for (const w of kidWords(n)) if (/^[A-Z]/.test(w)) out.add(w);
  return out;
}

/** How many words a line is (for picking the longest offer that still fits KID_MAX_WORDS in every sentence). */
export function kidLongestSentence(text: string): number {
  return Math.max(0, ...kidSentences(text).map((x) => kidWords(x).length));
}
