import {
  ADVENTURE_SILLY_REPLIES,
  ADVENTURE_SKILLS,
  ADVENTURE_STORY,
  type AdventureBossStage,
  type AdventureSkillId,
  ADVENTURE_WORDS,
  adventureBankSentences,
  adventureChapter,
  adventureWordSentence,
  type AdventureChapter,
  type AdventureChapterId,
  type AdventureCreature,
  type AdventureLevel,
  type AdventureLine,
  type AdventurePatternId
} from '@lcw/content';
import type { EnglishDayFile } from '@lcw/schemas';
import { ADV, type CreatureClass } from './tuning.js';
import { createRng, hashSeed, pickOne, shuffle, type Rng } from './rng.js';
import { S } from '../ui/strings.js';

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
  /** A SKILL's magic words (picked or said): which skill it casts. */
  skill?: AdventureSkillId;
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
  /** A guardian's stages (R2734): new turns, faster and harder as it gets closer to a friend (or to leaving). */
  stages: AdventureBossStage[];
}

export interface ChapterPlan {
  chapter: AdventureChapter;
  level: AdventureLevel;
  words: WordCard[];
  /** Earlier words brought back (chapter 4 and the day file's review words). */
  review: WordCard[];
  /** Three gatekeeper mini bosses and the island guardian (R2861). */
  encounters: EncounterPlan[];
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
  // every word keeps its case ("I", names) except the sentence's own first capital; the new first word is capitalised
  const raw = s.replace(/[.!?]$/, '').split(' ');
  const first = raw[0] ?? '';
  const words = [/^I(?:'|$)/.test(first) ? first : first.charAt(0).toLowerCase() + first.slice(1), ...raw.slice(1)];
  const out = (ws: readonly string[]) => {
    const t = ws.join(' ');
    return `${t.charAt(0).toUpperCase()}${t.slice(1)}.`;
  };
  if (words.length < 3) return out([...words].reverse());
  for (let k = 0; k < 6; k++) {
    const t = shuffle(words, rng);
    if (t.join(' ') !== words.join(' ')) return out(t);
  }
  return out([...words].reverse());
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
  // letters only: a word with a space, hyphen or apostrophe is spelled by its letters (graded the same way)
  const letters = [...w.toLowerCase().replace(/[^a-z]/g, '')];
  const abc = 'abcdefghijklmnoprstuwy';
  const decoys = [pickOne([...abc].filter((c) => !letters.includes(c)), rng), pickOne([...abc], rng)];
  return shuffle([...letters, ...decoys], rng);
}

const LABELS: Record<TalkKind, { en: string; ko: string }> = S.talkKind;
const MODE_LABEL: Record<TalkMode, { en: string; ko: string }> = S.talkMode;

function item(id: string, kind: TalkKind, mode: TalkMode, target: string, ko: string | null, rng: Rng, extra: Partial<TalkItem> = {}): TalkItem {
  const label = mode === 'spell' ? S.spellLabel(extra.emoji ?? '') : LABELS[kind];
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
    labelEn: S.answerLabel(creature.asks).en,
    labelKo: S.answerLabel(creature.asks).ko,
    target: target.en,
    ko: target.ko,
    prompt: creature.asks,
    choices
  };
}

/** ✅ pick on a word: the islander asks for the word, the child picks the sentence in the right order. */
function wordPickItem(id: string, wc: WordCard, rng: Rng): TalkItem {
  const silly = pickOne(ADVENTURE_SILLY_REPLIES, rng);
  const prompt = { en: `Can you use the word "${wc.w}"?`, ko: `"${wc.w}" 낱말을 써서 말해 줄래?` };
  return {
    id,
    mode: 'pick',
    kind: 'word',
    labelEn: `${S.talkKind.word.en} · ${S.talkMode.pick.en}`,
    labelKo: `${S.talkKind.word.ko} · ${S.talkMode.pick.ko}`,
    target: wc.sentence,
    ko: wc.ko ? `${wc.w} = ${wc.ko}` : null,
    word: wc.w,
    emoji: wc.emoji,
    prompt,
    choices: shuffle([wc.sentence, scrambleSentence(wc.sentence, rng), silly], rng)
  };
}

/** A SKILL's magic words as a TALK: pick the right words (or say them with 🎤). */
export function skillItem(skill: AdventureSkillId, level: AdventureLevel, rng: Rng): TalkItem {
  const sk = ADVENTURE_SKILLS[skill];
  const chant = sk.chant[level];
  const silly = pickOne(ADVENTURE_SILLY_REPLIES, rng);
  return {
    id: `skill-${skill}`,
    mode: 'pick',
    kind: 'word',
    labelEn: sk.nameEn,
    labelKo: sk.nameKo,
    target: chant.en,
    ko: chant.ko,
    prompt: S.skillPrompt(sk.nameEn, sk.nameKo),
    choices: shuffle([chant.en, scrambleSentence(chant.en, rng), silly], rng),
    skill
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
  const bankKo: Record<string, string> = S.bankKo;
  const greet = chapter.greet[level];
  const feel = chapter.feel[level];
  const befriend = chapter.befriend[level];
  // an islander with its own reply to its question uses it; otherwise the island's greeting / feeling / bank line
  const answerFor = (c: AdventureCreature) =>
    c.answer ? { en: c.answer[level].en, ko: c.answer[level].ko } : c.askKind === 'greet' ? { en: greet.en, ko: greet.ko } : c.askKind === 'feel' ? { en: feel.en, ko: feel.ko } : { en: bankLine, ko: bankKo[chapter.ctx] ?? null };
  const wordKo = (wc: WordCard) => (wc.ko ? `${wc.w} = ${wc.ko}` : null);

  const critters = chapter.critters;
  const g = chapter.guardian;
  const w0 = words[0]!;
  const w1 = words[1] ?? w0;
  const w2 = words[2] ?? w0;
  const allWords = [...words, ...review];

  // R2861: every gate holds a real mini boss. Each one offers the same five kinds of English work (a spoken line,
  // a reply to pick, a sentence to build, a spelling, and the day's word used in a sentence).
  const critterTalks = (c: AdventureCreature, wc: WordCard, idx: number): TalkItem[] => [
    item(`c${idx}-greet`, 'greet', 'say', greet.en, greet.ko, rng),
    pickItem(`c${idx}-pick`, c, answerFor(c), rng),
    item(`c${idx}-word`, 'word', idx % 2 ? 'build' : 'say', wc.sentence, wordKo(wc), rng, { word: wc.w, emoji: wc.emoji }),
    item(`c${idx}-spell`, 'word', 'spell', wc.w, wordKo(wc), rng, { word: wc.w, emoji: wc.emoji }),
    wordPickItem(`c${idx}-wpick`, wc, rng)
  ];
  const guardianTalks: TalkItem[] = [
    item('g-bank', 'bank', 'say', bankLine, bankKo[chapter.ctx] ?? null, rng),
    ...words.map((wc, i) => item(`g-word-${i}`, 'word', i % 2 ? 'build' : 'say', wc.sentence, wordKo(wc), rng, { word: wc.w, emoji: wc.emoji })),
    ...words.map((wc, i) => item(`g-spell-${i}`, 'word', 'spell', wc.w, wordKo(wc), rng, { word: wc.w, emoji: wc.emoji })),
    item('g-feel', 'feel', 'build', feel.en, feel.ko, rng),
    pickItem('g-pick', g, answerFor(g), rng),
    ...words.map((wc, i) => wordPickItem(`g-wpick-${i}`, wc, rng)),
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
    // R2861: a gate mini boss is a real fight too: half way it gets serious (faster, harder hits, one more pattern)
    const stages = creature.role === 'guardian' ? [...ADVENTURE_STORY[chapter.id].stages] : miniBossStages(creature);
    return { creature, cls, calmMax: ADV.calmMax[cls], grumpMax: ADV.grumpMax[cls], talks, words: ewords, stages };
  };
  const wordFor = (i: number) => [w0, w1, w2][i % 3]!;
  return {
    chapter,
    level,
    words,
    review,
    encounters: [
      ...critters.map((c, i) => enc(c, critterTalks(c, wordFor(i), i), [wordFor(i)])),
      enc(g, guardianTalks, allWords)
    ],
    source,
    seed
  };
}

/** The three TALK choices offered this turn: one spoken line always among them, done ones (2+ stars) rotate out. */
export function talkChoices(talks: readonly TalkItem[], done: ReadonlySet<string>, turn: number): TalkItem[] {
  const open = talks.filter((t) => !done.has(t.id));
  const pool = open.length >= 3 ? open : [...open, ...talks.filter((t) => done.has(t.id))];
  const n = pool.length;
  if (n <= 3 && pool.some((t) => t.mode === 'say') && (pool.some((t) => t.mode === 'pick') || !talks.some((t) => t.mode === 'pick'))) return [...pool];
  const start = (turn * 2) % n;
  const out: TalkItem[] = [];
  for (let k = 0; out.length < 3 && k < n; k++) out.push(pool[(start + k) % n]!);
  if (!out.some((t) => t.mode === 'say')) {
    const say = pool.find((t) => t.mode === 'say' && !out.includes(t)) ?? talks.find((t) => t.mode === 'say' && !out.includes(t));
    if (say) out[2] = say;
  }
  // R2734: a reply to pick is always there too (a child with no microphone and no keyboard skill still goes on)
  if (!out.some((t) => t.mode === 'pick')) {
    const pick = pool.find((t) => t.mode === 'pick' && !out.includes(t)) ?? talks.find((t) => t.mode === 'pick' && !out.includes(t));
    const slot = out.findIndex((t) => t.mode !== 'say');
    if (pick) out[slot >= 0 ? slot : out.length - 1] = pick;
  }
  return out;
}

/** Two stages for a gate mini boss (R2861 "mini bosses hard too"): its own patterns, then faster with a twist. */
export function miniBossStages(c: AdventureCreature): AdventureBossStage[] {
  const pats = c.patterns.length ? c.patterns : (['acornDrop'] as AdventurePatternId[]);
  const twist = [...pats].reverse();
  return [
    { at: 0, patterns: [...pats], speed: ADV.miniBoss.speed[0], damage: ADV.miniBoss.damage[0], line: c.turns[0] ?? c.intro },
    {
      at: ADV.miniBoss.at,
      patterns: [...twist, pats[0]!],
      speed: ADV.miniBoss.speed[1],
      damage: ADV.miniBoss.damage[1],
      line: { en: `${c.nameEn} is not giving up! It gets faster!`, ko: `${c.nameKo}이(가) 포기하지 않아요! 더 빨라져요!` }
    }
  ];
}
