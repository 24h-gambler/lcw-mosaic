import { describe, expect, it } from 'vitest';
import {
  ADVENTURE_CHAPTERS,
  ADVENTURE_CREDITS,
  ADVENTURE_ENDING,
  ADVENTURE_FERRY,
  ADVENTURE_GEAR,
  ADVENTURE_ITEMS,
  ADVENTURE_MERCHANT,
  ADVENTURE_POST,
  ADVENTURE_PROLOGUE,
  ADVENTURE_SAIL,
  ADVENTURE_SILLY_REPLIES,
  ADVENTURE_SKILLS,
  ADVENTURE_STORY,
  ADVENTURE_WORDS,
  KID_MAX_WORDS,
  TRADE_SHOP_GOODS,
  adventureBankSentences,
  adventureFixedLines,
  checkKidEnglish,
  kidNameSet,
  type AdventureChapterId,
  type AdventureLevel
} from '@lcw/content';
import { buildChapterPlan } from '../core/plan.js';
import { S } from '../ui/strings.js';

/**
 * R2734 (Dan 11-19: "the English is not all at a 12-year-old's level"): every English line of the adventure — the
 * story pages, every islander's talk and choices, the guardians' stages, the cart, chests, posts, magic words, TALK
 * sentences at every level, the screen's own words — passes the 12-year-old check (@lcw/content kid-english):
 * everyday words only (or the story's names / the lesson's words), at most KID_MAX_WORDS words a sentence.
 */

type Found = { at: string; en: string };

/** Every English string under an `en` key (and the plain strings of string arrays), with where it was found. */
function collect(v: unknown, at: string, out: Found[]): void {
  if (typeof v === 'string') return;
  if (typeof v === 'function') {
    // the screen's line makers: called with sample names and numbers that fit their parameters
    const fn = v as (...a: unknown[]) => unknown;
    const key = at.split('.').pop() ?? '';
    const item = { en: 'Honey Drop', ko: '꿀 사탕' };
    const sample: Record<string, unknown[]> = {
      chestOpen: [5, item],
      answerLabel: [{ en: 'How are you?', ko: '어떻게 지내?' }],
      spellLabel: ['🍎'],
      ate: ['Honey Drop', '꿀 사탕', 5]
    };
    const args = sample[key] ?? Array.from({ length: fn.length }, (_, i) => (i === 0 ? 'Honey Drop' : i === 1 ? '꿀 사탕' : 5));
    const r = fn(...args);
    if (typeof r === 'object') collect(r, `${at}()`, out);
    if (key === 'chestOpen') collect(fn(5, null), `${at}(null)`, out);
    return;
  }
  if (Array.isArray(v)) {
    v.forEach((x, i) => (typeof x === 'string' ? out.push({ at: `${at}[${i}]`, en: x }) : collect(x, `${at}[${i}]`, out)));
    return;
  }
  if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      // ko lines, and the ids of the guardians' dodge patterns (never shown)
      if (k === 'ko' || k.endsWith('Ko') || k === 'patterns') continue;
      if ((k === 'en' || k === 'nameEn' || k === 'islandEn' || k === 'labelEn') && typeof x === 'string') out.push({ at: `${at}.${k}`, en: x });
      else collect(x, `${at}.${k}`, out);
    }
  }
}

function allLines(): Found[] {
  const out: Found[] = [];
  collect(ADVENTURE_CHAPTERS, 'chapters', out);
  collect(ADVENTURE_STORY, 'story', out);
  collect(ADVENTURE_MERCHANT, 'merchant', out);
  collect({ ferry: ADVENTURE_FERRY }, 'ferry', out);
  collect(ADVENTURE_PROLOGUE, 'prologue', out);
  collect(ADVENTURE_SAIL, 'sail', out);
  collect(ADVENTURE_ENDING, 'ending', out);
  collect(ADVENTURE_CREDITS, 'credits', out);
  collect(ADVENTURE_ITEMS, 'items', out);
  collect(ADVENTURE_GEAR, 'gear', out);
  collect(ADVENTURE_SKILLS, 'skills', out);
  collect(ADVENTURE_POST, 'post', out);
  collect([...ADVENTURE_SILLY_REPLIES], 'silly', out);
  collect(S, 'S', out);
  for (const l of adventureFixedLines()) out.push({ at: 'fixed', en: l.text });
  for (const [w, info] of Object.entries(ADVENTURE_WORDS)) collect(info, `words.${w}`, out);
  for (const ch of [1, 2, 3, 4] as AdventureChapterId[])
    for (const level of [1, 2, 3] as AdventureLevel[]) {
      const c = ADVENTURE_CHAPTERS[ch - 1]!;
      for (const s of adventureBankSentences(c, level)) out.push({ at: `bank ch${ch} L${level}`, en: s });
      const plan = buildChapterPlan({ chapter: ch, level });
      for (const w of plan.words) out.push({ at: `plan ch${ch} L${level} word ${w.w}`, en: w.sentence });
      for (const e of plan.encounters)
        for (const t of e.talks) {
          out.push({ at: `plan ch${ch} L${level} ${e.creature.id} ${t.id}`, en: t.target });
          for (const c2 of t.choices ?? []) out.push({ at: `plan ch${ch} L${level} ${e.creature.id} ${t.id} choice`, en: c2 });
          if (t.prompt) out.push({ at: `plan ch${ch} L${level} ${e.creature.id} ${t.id} prompt`, en: t.prompt.en });
          out.push({ at: `plan ch${ch} L${level} ${e.creature.id} ${t.id} label`, en: t.labelEn });
        }
    }
  return out.filter((f) => /[A-Za-z]/.test(f.en));
}

/** The story's names (said with their capital), and the screen's command labels. */
function names(): Set<string> {
  const n: string[] = [ADVENTURE_FERRY.nameEn, ADVENTURE_MERCHANT.nameEn, 'Hushwind Isles', 'LCW', 'POKE', 'TALK', 'SKILL', 'POUCH', 'FRIEND', 'STAGE', 'VOICE', 'CALM', 'Z', 'X'];
  for (const c of ADVENTURE_CHAPTERS) {
    n.push(c.islandEn, c.villager.nameEn, c.guardian.nameEn, ...c.critters.map((x) => x.nameEn));
    n.push(ADVENTURE_STORY[c.id].villager.nameEn);
  }
  return kidNameSet(n);
}

describe('adventure English at a 12-year-old level (R2734)', () => {
  it('every line: everyday words, names or lesson words; sentences of at most KID_MAX_WORDS words', () => {
    const lines = allLines();
    expect(lines.length).toBeGreaterThan(400);
    const nm = names();
    // the lesson's words: the adventure's word cards, and the shore's trade goods (each shown with its picture)
    const lesson = new Set(Object.keys(ADVENTURE_WORDS).map((w) => w.toLowerCase()));
    for (const g of TRADE_SHOP_GOODS) for (const w of `${g.label} ${g.adj} ${g.give}`.toLowerCase().match(/[a-z]+/g) ?? []) lesson.add(w);
    const problems = lines.flatMap((l) => checkKidEnglish(l.en, nm, lesson).map((p) => ({ ...p, at: l.at })));
    const words = [...new Set(problems.filter((p) => p.kind === 'word').map((p) => p.detail.toLowerCase()))].sort();
    const long = problems.filter((p) => p.kind === 'long').map((p) => `${p.at}: ${p.detail}`);
    if (words.length || long.length) console.log(JSON.stringify({ words, long }, null, 1));
    expect(long).toEqual([]);
    expect(words).toEqual([]);
    expect(KID_MAX_WORDS).toBeLessThanOrEqual(14);
  });

  it('the check itself: knows inflections and contractions, refuses hard words and long sentences', () => {
    const nm = kidNameSet(['Old Fern']);
    expect(checkKidEnglish("Old Fern's dogs were running. I don't know!", nm)).toEqual([]);
    expect(checkKidEnglish('The happiest puppies jumped.', nm)).toEqual([]);
    expect(checkKidEnglish('We must reconcile the ephemeral.', nm).map((p) => p.detail)).toEqual(['reconcile', 'ephemeral']);
    expect(checkKidEnglish('one two three four five six seven eight nine ten one two three four five.', nm)[0]?.kind).toBe('long');
  });
});
