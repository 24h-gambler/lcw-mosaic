import {
  ADVENTURE_SILLY_REPLIES,
  ADVENTURE_WORDS,
  adventureBankSentences,
  adventureChapter,
  adventureWordSentence,
  type AdventureChapter,
  type AdventureChapterId,
  type AdventureCreature,
  type AdventureLevel,
  type AdventureLine
} from '@lcw/content';
import type { EnglishDayFile } from '@lcw/schemas';
import { ADV, type CreatureClass } from './tuning.js';
import { createRng, hashSeed, pickOne, shuffle, type Rng } from './rng.js';

/**
 * One chapter's learning plan (docs/22 1.3): the day's words with their sentences, and for each encounter the TALK
 * choices the child can make. Pure: the same input (chapter, level, day file, seed) gives the same plan.
 */

export interface WordCard {
  w: string;
  ko: string | null;
  emoji: string;
  sentence: string;
}

export type TalkMode = 'say' | 'build' | 'pick' | 'spell';
export type TalkKind = 'greet' | 'feel' | 'word' | 'bank' | 'befriend';

export interface TalkItem {
  id: string;
  mode: TalkMode;
  kind: TalkKind;
  /** Button label (English) and its Korean help. */
  labelEn: string;
  labelKo: string;
  /** The sentence to say/build/pick, or the word to spell. */
  target: string;
  /** Korean help for the target (null when we have none: the word's meaning is shown instead). */
  ko: string | null;
  /** The word this item practises (word/spell items) and its picture. */
  emoji?: string;
  word?: string;
  /** pick: the islander's question and the three replies (target among them). */
  prompt?: AdventureLine;
  choices?: string[];
  /** build/spell: the pieces in shuffled order (with decoys for spell). */
  tiles?: string[];
}

export interface EncounterPlan {
  creature: AdventureCreature;
  cls: CreatureClass;
  calmMax: number;
  grumpMax: number;
  talks: TalkItem[];
  /** Words the bullet patterns spell (letter catch, spelling bubbles, word cookies). */
  words: WordCard[];
}

export interface ChapterPlan {
  chapter: AdventureChapter;
  level: AdventureLevel;
  words: WordCard[];
  /** Earlier words brought back (chapter 4 and the day file's review words). */
  review: WordCard[];
  encounters: [EncounterPlan, EncounterPlan, EncounterPlan];
  /** Where the words came from (the end screen and the parent summary say it). */
  source: 'document' | 'saved' | 'built-in';
  seed: number;
}

export interface PlanInput {
  chapter: AdventureChapterId;
  level: AdventureLevel;
  day?: EnglishDayFile | null;
  /** Words saved when this chapter was first played (replay keeps them). */
  savedWords?: readonly string[];
  /** Words of the chapters already cleared (chapter 4 reviews them). */
  earlierWords?: readonly string[];
  seed?: number;
}

/** Only plain English words reach the screen and the speech checker. */
export function cleanWord(w: unknown): string | null {
  if (typeof w !== 'string') return null;
  const s = w.trim().toLowerCase();
  return /^[a-z][a-z' -]{0,18}[a-z]$|^[a-z]$/.test(s) ? s : null;
}

/** A sentence from the document: plain English, one line. */
export function cleanSentence(s: unknown): string | null {
  if (typeof s !== 'string') return null;
  const t = s.replace(/\s+/g, ' ').replace(/[’‘]/g, "'").trim();
  if (t.length < 2 || t.length > 120) return null;
  return /^[A-Za-z0-9 ,.'!?-]+$/.test(t) && /[A-Za-z]/.test(t) ? t : null;
}

const uniq = <T,>(xs: T[]) => xs.filter((x, i) => xs.indexOf(x) === i);

function containsWord(sentence: string, w: string): boolean {
  return new RegExp(`\\b${w.replace(/[^a-z]/g, '.')}`, 'i').test(sentence);
}

export function wordCard(w: string, level: AdventureLevel, day?: EnglishDayFile | null): WordCard {
  const info = ADVENTURE_WORDS[w];
  const docKo = day?.wordInfo?.find((x) => cleanWord(x.w) === w)?.ko;
  const docLines = [...(day?.typing ?? []), day?.sentence ?? ''].map(cleanSentence).filter((x): x is string => Boolean(x));
  const docLine = docLines.find((s) => containsWord(s, w));
  return {
    w,
    ko: (typeof docKo === 'string' && docKo.trim() ? docKo.trim().slice(0, 40) : null) ?? info?.ko ?? null,
    emoji: info?.emoji ?? '✨',
    sentence: docLine ?? adventureWordSentence(w, level)
  };
}

/** Three wrong spellings of a word (swap, double, drop, vowel change), never the word itself. */
export function misspellings(w: string, rng: Rng, n = 2): string[] {
  const out = new Set<string>();
  const vowels = 'aeiou';
  const tries: Array<() => string> = [
    () => {
      const i = 1 + Math.floor(rng() * Math.max(1, w.length - 2));
      return i + 1 < w.length ? w.slice(0, i) + w[i + 1] + w[i] + w.slice(i + 2) : w + w[w.length - 1];
    },
    () => {
      const i = Math.floor(rng() * w.length);
      return w.slice(0, i) + w[i] + w.slice(i);
    },
    () => {
      const i = 1 + Math.floor(rng() * Math.max(1, w.length - 1));
      return w.length > 3 ? w.slice(0, i) + w.slice(i + 1) : w + 'e';
    },
    () => {
      const idx = [...w].map((c, i) => (vowels.includes(c) ? i : -1)).filter((i) => i >= 0);
      if (!idx.length) return w + 'h';
      const i = pickOne(idx, rng);
      const nv = pickOne([...vowels].filter((v) => v !== w[i]), rng);
      return w.slice(0, i) + nv + w.slice(i + 1);
    }
  ];
  for (let k = 0; out.size < n && k < 40; k++) {
    const m = tries[k % tries.length]!();
    if (m !== w && m.length > 0) out.add(m);
  }
  return [...out].slice(0, n);
}

/** Same words, another order (the build TALK's wrong choice in ✅ pick). */
function scrambleSentence(s: string, rng: Rng): string {
  const words = s.replace(/[.!?]$/, '').split(' ');
  if (words.length < 3) return `${words.reverse().join(' ')}.`;
  for (let k = 0; k < 6; k++) {
    const t = shuffle(words, rng).join(' ');
    if (t !== words.join(' ')) return `${t[0]!.toUpperCase()}${t.slice(1).toLowerCase()}.`;
  }
  return `${[...words].reverse().join(' ')}.`;
}

/** Word pieces for 🧩 build: the sentence's words, shuffled (never already in order when it has 3+ words). */
export function buildTiles(s: string, rng: Rng): string[] {
  const words = s.split(' ');
  if (words.length < 2) return words;
  for (let k = 0; k < 8; k++) {
    const t = shuffle(words, rng);
    if (t.join(' ') !== s) return t;
  }
  return [...words].reverse();
}

/** Letter pieces for 🔤 spell: the word's letters plus two decoys, shuffled. */
export function spellTiles(w: string, rng: Rng): string[] {
  const letters = [...w.replace(/[^a-z]/g, '')];
  const abc = 'abcdefghijklmnoprstuwy';
  const decoys = [pickOne([...abc].filter((c) => !letters.includes(c)), rng), pickOne([...abc], rng)];
  return shuffle([...letters, ...decoys], rng);
}

const LABELS: Record<TalkKind, { en: string; ko: string }> = {
  greet: { en: 'Say hello', ko: '인사하기' },
  feel: { en: 'Share a feeling', ko: '기분 말하기' },
  word: { en: 'Use a new word', ko: '새 낱말로 말하기' },
  bank: { en: 'Ask nicely', ko: '예의 바르게 묻기' },
  befriend: { en: 'Offer friendship', ko: '친구 하자고 말하기' }
};
const MODE_LABEL: Record<TalkMode, { en: string; ko: string }> = {
  say: { en: 'say it', ko: '말하기' },
  build: { en: 'build it', ko: '문장 조립' },
  pick: { en: 'pick a reply', ko: '대답 고르기' },
  spell: { en: 'spell it', ko: '철자 맞히기' }
};

function item(id: string, kind: TalkKind, mode: TalkMode, target: string, ko: string | null, rng: Rng, extra: Partial<TalkItem> = {}): TalkItem {
  const label = mode === 'spell' ? { en: `Spell the word ${extra.emoji ?? ''}`.trim(), ko: '낱말 철자 맞히기' } : LABELS[kind];
  const t: TalkItem = {
    id,
    mode,
    kind,
    labelEn: mode === 'spell' ? label.en : `${label.en} · ${MODE_LABEL[mode].en}`,
    labelKo: mode === 'spell' ? label.ko : `${label.ko} · ${MODE_LABEL[mode].ko}`,
    target,
    ko,
    ...extra
  };
  if (mode === 'build') t.tiles = buildTiles(target, rng);
  if (mode === 'spell') t.tiles = spellTiles(target, rng);
  return t;
}

function pickItem(id: string, creature: AdventureCreature, target: { en: string; ko: string | null }, rng: Rng): TalkItem {
  const silly = pickOne(ADVENTURE_SILLY_REPLIES, rng);
  const choices = shuffle([target.en, scrambleSentence(target.en, rng), silly], rng);
  return {
    id,
    mode: 'pick',
    kind: creature.askKind === 'bank' ? 'bank' : creature.askKind,
    labelEn: `Answer "${creature.asks.en}"`,
    labelKo: `"${creature.asks.ko}"에 대답하기`,
    target: target.en,
    ko: target.ko,
    prompt: creature.asks,
    choices
  };
}

export function classOf(chapter: AdventureChapter, creature: AdventureCreature): CreatureClass {
  if (creature.role === 'critter') return 'critter';
  return chapter.id === 4 ? 'final' : 'guardian';
}

export function buildChapterPlan(input: PlanInput): ChapterPlan {
  const chapter = adventureChapter(input.chapter);
  const level = input.level;
  const seed = input.seed ?? hashSeed('adv', chapter.id, level, input.day?.date ?? '', (input.day?.words ?? []).join(','));
  const rng = createRng(seed);
  const docWords = uniq((input.day?.words ?? []).map(cleanWord).filter((x): x is string => Boolean(x))).slice(0, 4);
  const saved = uniq((input.savedWords ?? []).map(cleanWord).filter((x): x is string => Boolean(x))).slice(0, 4);
  const source: ChapterPlan['source'] = docWords.length ? 'document' : saved.length ? 'saved' : 'built-in';
  const ws = docWords.length ? docWords : saved.length ? saved : [...chapter.defaultWords];
  const words = ws.map((w) => wordCard(w, level, input.day));
  const reviewRaw = uniq([...(input.earlierWords ?? []), ...(input.day?.review_words ?? [])].map(cleanWord).filter((x): x is string => Boolean(x)))
    .filter((w) => !ws.includes(w))
    .slice(0, chapter.id === 4 ? 6 : 3);
  const review = reviewRaw.map((w) => wordCard(w, level, input.day));
  const bank = adventureBankSentences(chapter, level);
  const bankLine = bank.length ? pickOne(bank, rng) : chapter.greet[level].en;
  const bankKo: Record<AdventureChapter['ctx'], string> = {
    guide: '길을 묻는 문장 (LCW 마을 안내인에게도 써요)',
    trade_shop: '물건을 바꾸자는 문장 (LCW 교환 상점에서도 써요)',
    cafe: '주문하는 문장 (LCW 카페에서도 써요)',
    errand: '도와주겠다는 문장 (LCW 심부름에서도 써요)'
  };
  const greet = chapter.greet[level];
  const feel = chapter.feel[level];
  const befriend = chapter.befriend[level];
  const answerFor = (c: AdventureCreature) =>
    c.askKind === 'greet' ? { en: greet.en, ko: greet.ko } : c.askKind === 'feel' ? { en: feel.en, ko: feel.ko } : { en: bankLine, ko: bankKo[chapter.ctx] };
  const wordKo = (wc: WordCard) => (wc.ko ? `${wc.w} = ${wc.ko}` : null);

  const [c1, c2] = chapter.critters;
  const g = chapter.guardian;
  const w0 = words[0]!;
  const w1 = words[1] ?? w0;
  const allWords = [...words, ...review];

  const critter1: TalkItem[] = [
    item('c1-greet', 'greet', 'say', greet.en, greet.ko, rng),
    item('c1-word', 'word', 'build', w0.sentence, wordKo(w0), rng, { word: w0.w, emoji: w0.emoji }),
    item('c1-spell', 'word', 'spell', w0.w, wordKo(w0), rng, { word: w0.w, emoji: w0.emoji }),
    pickItem('c1-pick', c1, answerFor(c1), rng)
  ];
  const critter2: TalkItem[] = [
    item('c2-feel', 'feel', 'say', feel.en, feel.ko, rng),
    item('c2-word', 'word', 'say', w1.sentence, wordKo(w1), rng, { word: w1.w, emoji: w1.emoji }),
    item('c2-spell', 'word', 'spell', w1.w, wordKo(w1), rng, { word: w1.w, emoji: w1.emoji }),
    pickItem('c2-pick', c2, answerFor(c2), rng)
  ];
  const guardianTalks: TalkItem[] = [
    item('g-bank', 'bank', 'say', bankLine, bankKo[chapter.ctx], rng),
    ...words.map((wc, i) => item(`g-word-${i}`, 'word', i % 2 ? 'build' : 'say', wc.sentence, wordKo(wc), rng, { word: wc.w, emoji: wc.emoji })),
    ...words.map((wc, i) => item(`g-spell-${i}`, 'word', 'spell', wc.w, wordKo(wc), rng, { word: wc.w, emoji: wc.emoji })),
    item('g-feel', 'feel', 'build', feel.en, feel.ko, rng),
    pickItem('g-pick', g, answerFor(g), rng),
    item('g-befriend', 'befriend', 'say', befriend.en, befriend.ko, rng)
  ];
  if (chapter.id === 4) {
    review.forEach((wc, i) => {
      guardianTalks.push(item(`g-review-${i}`, 'word', i % 2 ? 'build' : 'say', wc.sentence, wordKo(wc), rng, { word: wc.w, emoji: wc.emoji }));
      guardianTalks.push(item(`g-review-spell-${i}`, 'word', 'spell', wc.w, wordKo(wc), rng, { word: wc.w, emoji: wc.emoji }));
    });
  }
  const enc = (creature: AdventureCreature, talks: TalkItem[], ewords: WordCard[]): EncounterPlan => {
    const cls = classOf(chapter, creature);
    return { creature, cls, calmMax: ADV.calmMax[cls], grumpMax: ADV.grumpMax[cls], talks, words: ewords };
  };
  return {
    chapter,
    level,
    words,
    review,
    encounters: [enc(c1, critter1, [w0]), enc(c2, critter2, [w1]), enc(g, guardianTalks, allWords)],
    source,
    seed
  };
}

/** The three TALK choices offered this turn: one spoken line always among them, done ones (2+ stars) rotate out. */
export function talkChoices(talks: readonly TalkItem[], done: ReadonlySet<string>, turn: number): TalkItem[] {
  const open = talks.filter((t) => !done.has(t.id));
  const pool = open.length >= 3 ? open : [...open, ...talks.filter((t) => done.has(t.id))];
  const n = pool.length;
  if (n <= 3 && pool.some((t) => t.mode === 'say')) return [...pool];
  const start = (turn * 2) % n;
  const out: TalkItem[] = [];
  for (let k = 0; out.length < 3 && k < n; k++) out.push(pool[(start + k) % n]!);
  if (!out.some((t) => t.mode === 'say')) {
    const say = pool.find((t) => t.mode === 'say' && !out.includes(t)) ?? talks.find((t) => t.mode === 'say' && !out.includes(t));
    if (say) out[2] = say;
  }
  return out;
}
