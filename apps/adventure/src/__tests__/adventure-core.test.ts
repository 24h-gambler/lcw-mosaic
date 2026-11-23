import { describe, expect, it } from 'vitest';
import { ADVENTURE_CHAPTERS, ADVENTURE_STORY, ADVENTURE_WORDS, adventureFixedLines, adventureLevelOf, adventureWordSentence, castVoices, fixedTtsLines, ttsVoiceId } from '@lcw/content';
import { AdventureEnvelopeSchema, EnglishDayFileSchema } from '@lcw/schemas';
import { buildChapterPlan, cleanSentence, cleanWord, misspellings, skillItem, talkChoices } from '../core/plan.js';
import { createRng } from '../core/rng.js';
import { gradeExact, gradePick, gradeSpelling, gradeSpoken } from '../core/grade.js';
import { earlierWords, emptyProgress, isUnlocked, kstDate, lockReason, mergeSettings, nextChapter, parseProgress, recordFinish, toSettings } from '../core/progress.js';
import { addLine, betterPlay, buildEnvelope, datedPlays, envelopeDate, chapterStars, startRecord, summaryKo, toActivity, wordHit } from '../core/record.js';
import { dayFileUrls, parseEdLink, readEdLink, resultUrl, safeBack } from '../core/edlink.js';
import { arenaRect, autopilotDir, cookiesReadable, startPattern, stepPattern } from '../core/bullets.js';
import { spellTiles } from '../core/plan.js';
import { Battle, MENU } from '../core/battle.js';
import { blocks, buildIsland, findPath, moveFeet, reachable, tileAt } from '../core/map.js';
import { ADV } from '../core/tuning.js';
import { buy, canBuy, heal, hitCost, hurt, learn, maxHp, newRun, openChest, parseRun, restAt, retrySpeed, revive } from '../core/run.js';

/** Read the phase fresh — TS narrows a field after one check and would call the next check impossible. */
const ph = (x: Battle): Battle['phase'] => x.phase;

const DAY = EnglishDayFileSchema.parse({
  v: 1,
  student: 'smoke-adventure',
  date: '2026-11-19',
  day: 2,
  level: 1,
  topic: 'animals',
  words: ['rabbit', 'owl', 'fox'],
  wordInfo: [{ w: 'rabbit', ko: '토끼(문서)', audio: null, img: null }],
  sentence: 'I have a rabbit.',
  review_words: ['puppy', 'eagle', 'turtle'],
  typing: ['I see an owl.', 'The fox is fast.', 'I have a rabbit.']
});

describe('adventure plan', () => {
  it('uses the student document words and sentences when the day file has them', () => {
    const p = buildChapterPlan({ chapter: 2, level: 1, day: DAY });
    expect(p.source).toBe('document');
    expect(p.words.map((w) => w.w)).toEqual(['rabbit', 'owl', 'fox']);
    expect(p.words[0]!.sentence).toBe('I have a rabbit.');
    expect(p.words[0]!.ko).toBe('토끼(문서)');
    expect(p.words[1]!.sentence).toBe('I see an owl.');
    expect(p.words[2]!.sentence).toBe('The fox is fast.');
    expect(p.review.map((w) => w.w)).toEqual(['puppy', 'eagle', 'turtle']);
  });

  it('falls back to the island words, then to saved words on replay', () => {
    expect(buildChapterPlan({ chapter: 1, level: 1 }).words.map((w) => w.w)).toEqual(['puppy', 'eagle', 'turtle']);
    const saved = buildChapterPlan({ chapter: 1, level: 2, savedWords: ['whale', 'fox'] });
    expect(saved.source).toBe('saved');
    expect(saved.words.map((w) => w.w)).toEqual(['whale', 'fox']);
    expect(saved.words[0]!.sentence).toBe('Look! There is a whale over there.');
  });

  it('every encounter offers a spoken line, a word and the island phrase-bank sentence on the guardian', () => {
    for (const ch of ADVENTURE_CHAPTERS) {
      for (const lv of [1, 2, 3] as const) {
        const p = buildChapterPlan({ chapter: ch.id, level: lv, earlierWords: ['puppy', 'shell'] });
        for (const e of p.encounters) {
          expect(e.talks.some((t) => t.mode === 'say')).toBe(true);
          expect(e.talks.some((t) => t.mode === 'spell')).toBe(true);
          expect(e.talks.some((t) => t.mode === 'pick')).toBe(true);
          for (const t of e.talks) {
            if (t.mode === 'pick') expect(t.choices).toContain(t.target);
            if (t.mode === 'build') expect([...t.tiles!].sort()).toEqual(t.target.split(' ').sort());
            if (t.mode === 'spell') {
              for (const c of t.target) expect(t.tiles).toContain(c);
              // the label shows the picture, never the spelling itself
              expect(t.labelEn.toLowerCase()).not.toContain(t.target);
            }
          }
        }
        const g = p.encounters.at(-1)!;
        expect(g.talks.find((t) => t.kind === 'bank')!.target.length).toBeGreaterThan(3);
        expect(g.calmMax).toBe(ch.id === 4 ? ADV.calmMax.final : ADV.calmMax.guardian);
        if (ch.id === 4) expect(g.talks.filter((t) => t.id.startsWith('g-review')).length).toBeGreaterThan(0);
      }
    }
  });

  it('three choices per turn always include one spoken sentence and rotate past finished ones', () => {
    const p = buildChapterPlan({ chapter: 3, level: 2 });
    const talks = p.encounters.at(-1)!.talks;
    const done = new Set<string>();
    for (let turn = 0; turn < 12; turn++) {
      const c = talkChoices(talks, done, turn);
      expect(c.length).toBe(3);
      expect(c.some((t) => t.mode === 'say')).toBe(true);
      done.add(c[0]!.id);
    }
  });

  it('cleans what comes from outside (words and sentences)', () => {
    expect(cleanWord(' Rabbit ')).toBe('rabbit');
    expect(cleanWord('<b>x</b>')).toBeNull();
    expect(cleanWord('ice cream')).toBe('ice cream');
    expect(cleanSentence('I see a fox.')).toBe('I see a fox.');
    expect(cleanSentence('<script>alert(1)</script>')).toBeNull();
    expect(cleanSentence('x'.repeat(130))).toBeNull();
  });

  it('mixed-up reply choices keep "I" capitalised and start with a capital', () => {
    for (const c of ADVENTURE_CHAPTERS)
      for (const level of [1, 2, 3] as const)
        for (const e of buildChapterPlan({ chapter: c.id, level }).encounters)
          for (const t of e.talks.filter((x) => x.mode === 'pick'))
            for (const choice of t.choices!) {
              expect(choice, choice).not.toMatch(/(?:^|\s)i(?:\s|'|[.!?]|$)/);
              expect(choice[0], choice).toMatch(/[A-Z]/);
            }
  });

  it('wrong spellings are never the word', () => {
    const rng = createRng(7);
    for (const w of Object.keys(ADVENTURE_WORDS)) {
      const m = misspellings(w, rng, 2);
      expect(m.length).toBe(2);
      expect(m).not.toContain(w);
    }
  });

  it('a sentence exists at every level for every bank word, and levels map L1..L6 to three tiers', () => {
    for (const w of Object.keys(ADVENTURE_WORDS)) for (const lv of [1, 2, 3] as const) expect(adventureWordSentence(w, lv)).toMatch(/^[A-Z].+[.!?]$/);
    expect(adventureWordSentence('eagle', 1)).toBe('I see an eagle.');
    expect(adventureLevelOf('L1')).toBe(1);
    expect(adventureLevelOf('L5')).toBe(3);
    expect(adventureLevelOf(2)).toBe(2);
    expect(adventureLevelOf(null)).toBe(1);
  });
});

describe('adventure grading', () => {
  it('spoken lines use the world scorer: exact = 3 stars, close = fewer, off = retry', () => {
    expect(gradeSpoken('I see a puppy.', ['i see a puppy'], 1).stars).toBe(3);
    expect(gradeSpoken('I see a puppy.', ['completely different words'], 1).stars).toBe(0);
    expect(gradeSpoken('I feel happy today because I met you.', ['', 'i feel happy today because i met you'], 2).stars).toBe(3);
    const partial = gradeSpoken('I feel happy today because I met you.', ['i feel happy today'], 2);
    expect(partial.stars).toBeLessThan(3);
  });

  it('built and spelled answers are exact; picks cap at two stars', () => {
    expect(gradeExact('puppy', 'puppy', 1).stars).toBe(3);
    expect(gradeExact('puppy', 'PUPPY', 2).stars).toBe(2);
    expect(gradeExact('puppy', 'pupy', 1).stars).toBe(0);
    expect(gradePick('Hello! Nice to meet you.', 'Hello! Nice to meet you.', 1).stars).toBe(2);
    expect(gradePick('Hello! Nice to meet you.', 'Banana, banana, banana!', 1).pass).toBe(false);
  });

  it('spelling counts letters only (a word with a space or an apostrophe)', () => {
    const tiles = spellTiles('ice cream', createRng(3));
    expect(tiles.join('')).not.toMatch(/[^a-z]/);
    expect(gradeSpelling('ice cream', 'icecream', 1).stars).toBe(3);
    expect(gradeSpelling("don't", 'dont', 2).stars).toBe(2);
    expect(gradeSpelling('T-rex', 'trex', 1).pass).toBe(true);
    expect(gradeSpelling('puppy', 'pupy', 1).pass).toBe(false);
  });
});

describe('adventure progress (the next island opens when the one before is done — R2734)', () => {
  it('chapter 1 is open; the next opens as soon as the one before is finished, the same day; replay stays open', () => {
    let p = emptyProgress();
    const day1 = '2026-11-16';
    expect(isUnlocked(p, 1, day1)).toBe(true);
    expect(isUnlocked(p, 2, day1)).toBe(false);
    expect(lockReason(p, 2, day1)).toBe('previous');
    const rec = startRecord(1, 1, ['puppy'], Date.UTC(2026, 10, 16, 8));
    rec.outcome = 'spared';
    p = recordFinish(p, 1, day1, { stars: 2, outcome: 'spared', words: ['puppy'], activity: toActivity(rec, Date.UTC(2026, 10, 16, 8, 10)) });
    // R2734: no waiting for a later day — the story goes on in the same lesson
    expect(isUnlocked(p, 2, day1)).toBe(true);
    expect(lockReason(p, 2, day1)).toBe('open');
    expect(nextChapter(p, day1)).toBe(2);
    expect(isUnlocked(p, 1, day1)).toBe(true);
    expect(isUnlocked(p, 3, day1)).toBe(false);
    expect(isUnlocked(p, 3, day1, { unlockAll: true })).toBe(true);
    expect(earlierWords(p, 4)).toEqual(['puppy']);
  });

  it("a worse replay keeps the island's best play for the guardian summary", () => {
    const play = (outcome: 'spared' | 'fought') => {
      const r = startRecord(1, 1, [], 0);
      r.outcome = outcome;
      if (outcome === 'spared') r.befriended.push('a', 'b', 'c');
      return toActivity(r, 1000);
    };
    let p = recordFinish(emptyProgress(), 1, '2026-11-19', { stars: 2, outcome: 'spared', words: ['puppy'], activity: play('spared') });
    p = recordFinish(p, 1, '2026-11-19', { stars: 1, outcome: 'fought', words: ['puppy'], activity: play('fought') });
    expect(p.chapters[1]!.last!.extra.outcome).toBe('spared');
    expect(p.chapters[1]!.outcome).toBe('spared');
  });

  it('Korea time decides the day (23:30 UTC is the next morning in Seoul)', () => {
    expect(kstDate(Date.UTC(2026, 10, 18, 23, 30))).toBe('2026-11-19');
    expect(kstDate(Date.UTC(2026, 10, 18, 14, 59))).toBe('2026-11-18');
  });

  it('round-trips through localStorage text and the server settings row', () => {
    let p = emptyProgress();
    const rec = startRecord(1, 1, ['puppy', 'eagle', 'turtle'], 0);
    rec.outcome = 'spared';
    p = recordFinish(p, 1, '2026-11-16', { stars: 3, outcome: 'spared', words: ['puppy', 'eagle', 'turtle'], activity: toActivity(rec, 1000) });
    expect(parseProgress(JSON.stringify(p))).toEqual(p);
    expect(parseProgress('{broken')).toEqual(emptyProgress());
    const s = toSettings(p);
    // one key for the whole adventure: the world already uses most of the 40 keys
    expect(Object.keys(s)).toEqual(['adv']);
    for (const [k, v] of Object.entries(s)) {
      expect(k).toMatch(/^[a-z][a-zA-Z0-9_.]{0,39}$/);
      expect(v.length).toBeLessThanOrEqual(32);
    }
    const other = mergeSettings(emptyProgress(), { ...s, 'frame.quality': 'auto' });
    expect(other.chapters[1]).toMatchObject({ clearedOn: '2026-11-16', stars: 3, outcome: 'spared' });
    expect(other.chapters[2]).toBeUndefined();
    expect(mergeSettings(emptyProgress(), { adv: 'garbage' })).toEqual(emptyProgress());
    expect(toSettings(emptyProgress())).toEqual({});
    expect(isUnlocked(other, 2, '2026-11-19')).toBe(true);
  });
});

describe('adventure record and the english-day envelope', () => {
  it('builds a contract v1 envelope with lines, words, stars and a Korean summary', () => {
    const r = startRecord(2, 1, ['rabbit', 'owl'], Date.UTC(2026, 10, 19, 8, 40));
    addLine(r, { en: 'I have a rabbit.', ko: 'rabbit = 토끼', mode: 'voice', ok: false, stars: 0 });
    addLine(r, { en: 'I have a rabbit.', ko: 'rabbit = 토끼', mode: 'typed', ok: true, stars: 3 });
    addLine(r, { en: 'owl', ko: 'owl = 부엉이', mode: 'spell', ok: true, stars: 3 });
    addLine(r, { en: 'Hi! I like your shell.', ko: '', mode: 'voice', ok: true, stars: 2 });
    addLine(r, { en: 'I feel excited today because I am at the beach.', ko: '', mode: 'voice', ok: true, stars: 3 });
    wordHit(r, 'rabbit', 'caught');
    wordHit(r, 'owl', 'missed');
    r.outcome = 'spared';
    r.befriended.push('bubblit', 'shellbop', 'clatterclaw');
    r.hpLost = 6;
    r.endedMs = Date.UTC(2026, 10, 19, 8, 52);
    const act = toActivity(r, r.endedMs);
    expect(act.lines.find((l) => l.en === 'I have a rabbit.')).toMatchObject({ tries: 2, ok: true, mode: 'typed' });
    expect(act).toMatchObject({ id: 'ch2', kind: 'chapter', label: '모험 2장', seconds: 720, stars: 3, correct: 4, total: 4, extra: { outcome: 'spared', hp_lost: 6, level: 'L1' } });
    expect(act.startedAt).toBe('2026-11-19T17:40:00+09:00');
    expect(act.words).toEqual([
      { w: 'rabbit', ok: true, caught: 1, missed: 0 },
      { w: 'owl', ok: false, caught: 0, missed: 1 }
    ]);
    const env = buildEnvelope('smoke-adventure', '2026-11-19', [act])!;
    expect(AdventureEnvelopeSchema.safeParse(env).success).toBe(true);
    expect(env.summaryKo).toContain('모험 2장');
    expect(env.summaryKo).toContain('말로 친구가 되어 끝냄');
    expect(summaryKo([])).toBe('아직 모험 기록이 없어요');
  });

  it('chapter stars: 3 needs every islander befriended and three spoken lines; fighting gives 1', () => {
    const r = startRecord(1, 1, [], 0);
    r.outcome = 'fought';
    expect(chapterStars(r)).toBe(1);
    r.outcome = 'spared';
    r.befriended.push('a', 'b', 'c');
    expect(chapterStars(r)).toBe(2);
    for (const en of ['a b c.', 'd e f.', 'g h i.']) addLine(r, { en, ko: '', mode: 'voice', ok: true, stars: 2 });
    expect(chapterStars(r)).toBe(3);
    r.outcome = 'quit';
    expect(chapterStars(r)).toBe(0);
  });

  it("word stone lines are kept but do not count for three stars; the student's own level is reported", () => {
    const r = startRecord(1, 3, [], 0, 'L5');
    r.outcome = 'spared';
    r.befriended.push('a', 'b', 'c');
    for (const en of ['puppy', 'I see a puppy.', 'owl']) addLine(r, { en, ko: '', mode: 'voice', ok: true, stars: 3, stone: true });
    expect(r.lines).toHaveLength(3);
    expect(chapterStars(r)).toBe(2);
    const act = toActivity(r, 1000);
    expect(act.extra.level).toBe('L5');
    expect(toActivity(startRecord(1, 2, [], 0, 'nope'), 1000).extra.level).toBe('L2');
  });

  it('the envelope keeps the lesson day unless the document would refuse it', () => {
    expect(envelopeDate('2026-11-16', '2026-11-18')).toBe('2026-11-16');
    expect(envelopeDate('2026-11-08', '2026-11-18')).toBe('2026-11-08');
    expect(envelopeDate('2026-11-07', '2026-11-18')).toBe('2026-11-18');
    expect(envelopeDate('2026-11-21', '2026-11-18')).toBe('2026-11-18');
    expect(envelopeDate(null, '2026-11-18')).toBe('2026-11-18');
    // an old link: today's date, the lesson day kept on each play, and the receiver's schema takes it
    const r = startRecord(1, 1, ['puppy'], Date.UTC(2026, 10, 18, 8));
    r.outcome = 'spared';
    const old = datedPlays('2026-11-01', '2026-11-18', [toActivity(r, Date.UTC(2026, 10, 18, 8, 5))]);
    expect(old.date).toBe('2026-11-18');
    expect(old.acts[0]!.extra.lessonDate).toBe('2026-11-01');
    expect(buildEnvelope('smoke-adv', old.date, old.acts)).not.toBeNull();
    expect(datedPlays('2026-11-16', '2026-11-18', old.acts.map((a) => ({ ...a, extra: { ...a.extra, lessonDate: undefined } }))).acts[0]!.extra.lessonDate).toBeUndefined();
  });

  it('a replay replaces the sent play only when it is as good or better', () => {
    const play = (outcome: 'spared' | 'fought' | 'quit', stars: number) => {
      const r = startRecord(1, 1, [], 0);
      r.outcome = outcome;
      if (outcome === 'spared') r.befriended.push('a', 'b', 'c');
      for (let i = 0; i < stars - 2; i++) for (const en of ['a b.', 'c d.', 'e f.']) addLine(r, { en, ko: '', mode: 'voice', ok: true, stars: 2 });
      return toActivity(r, 1000);
    };
    expect(betterPlay(play('fought', 1), play('spared', 3))).toBe(false);
    expect(betterPlay(play('spared', 2), play('fought', 1))).toBe(true);
    expect(betterPlay(play('spared', 3), play('spared', 2))).toBe(true);
    expect(betterPlay(play('spared', 2), play('spared', 3))).toBe(false);
  });

  it('reads the document link and keeps it for the tab; refuses a foreign way back', () => {
    const q = '?ed=oreo&edd=2026-11-19&edk=abcdefghijklmnopqrstuvwx&edr=' + encodeURIComponent('https://english-day.pages.dev/oreo/');
    const link = parseEdLink(q)!;
    expect(link).toEqual({ student: 'oreo', date: '2026-11-19', key: 'abcdefghijklmnopqrstuvwx', back: 'https://english-day.pages.dev/oreo/' });
    expect(dayFileUrls(link)).toEqual(['https://english-day.pages.dev/oreo/days/2026-11-19.json', 'https://english-day.pages.dev/oreo/today.json']);
    expect(resultUrl(link)).toBe('https://english-day.pages.dev/api/result?k=abcdefghijklmnopqrstuvwx');
    expect(safeBack('https://evil.example/oreo/')).toBeNull();
    expect(safeBack('http://engday.pages.dev/oreo/')).toBeNull();
    // the short student address: back, day file and results all go to the site the link came from
    const short = parseEdLink('?ed=smoke-adv&edd=2026-11-19&edk=abcdefghijklmnopqrstuvwx&edr=' + encodeURIComponent('https://engday.pages.dev/smoke-adv/'))!;
    expect(short.back).toBe('https://engday.pages.dev/smoke-adv/');
    expect(dayFileUrls(short)[0]).toBe('https://engday.pages.dev/smoke-adv/days/2026-11-19.json');
    expect(resultUrl(short)).toBe('https://engday.pages.dev/api/result?k=abcdefghijklmnopqrstuvwx');
    expect(parseEdLink('?ed=<x>')).toBeNull();
    expect(parseEdLink('')).toBeNull();
    const store = new Map<string, string>();
    const session = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    expect(readEdLink(q, session)).toEqual(link);
    expect(readEdLink('', session)).toEqual(link);
  });
});

describe('adventure bullet patterns', () => {
  const words = buildChapterPlan({ chapter: 1, level: 1 }).words;
  const ids = ['acornDrop', 'leafRing', 'letterCatch', 'spellBubbles', 'shellSweep', 'bubbleRise', 'rollBounce', 'sprinkleRain', 'wordCookies', 'windSpiral', 'inkRain', 'kiteDive'] as const;

  it('word cookies need a picture per word, else the page catches spellings', () => {
    expect(cookiesReadable(words)).toBe(true);
    const unknown = [{ w: 'zork', ko: null, emoji: '✨', sentence: 'I see a zork.' }, { w: 'blip', ko: null, emoji: '✨', sentence: 'I see a blip.' }];
    expect(cookiesReadable(unknown)).toBe(false);
    expect(startPattern('wordCookies', unknown, createRng(1), { duration: 6 }).id).toBe('spellBubbles');
    expect(startPattern('wordCookies', words, createRng(1), { duration: 6 }).id).toBe('wordCookies');
  });

  it('every pattern spawns inside its page and is deterministic for a seed', () => {
    for (const id of ids) {
      const run = () => {
        const ps = startPattern(id, words, createRng(42), { duration: 6 });
        const soul = { x: ps.arena.x + ps.arena.w / 2, y: ps.arena.y + ps.arena.h / 2 };
        let seen = 0;
        for (let i = 0; i < 360; i++) {
          stepPattern(ps, 1 / 60, soul, false);
          seen = Math.max(seen, ps.bullets.filter((b) => b.alive).length);
        }
        return { seen, sig: ps.bullets.map((b) => `${b.x.toFixed(2)},${b.y.toFixed(2)}`).join(';') };
      };
      const a = run();
      expect(a.seen, id).toBeGreaterThan(0);
      expect(a.seen, id).toBeLessThanOrEqual(160);
      expect(run().sig, id).toBe(a.sig);
    }
  });

  it('letter catch: catching the letters in order spells the word', () => {
    const ps = startPattern('letterCatch', words, createRng(3), { duration: 60 });
    const target = ps.words[ps.wordIdx]!.w;
    let complete = false;
    for (let i = 0; i < 60 * 60 && !complete; i++) {
      // stand under the next good letter (perfect catcher)
      const good = ps.bullets.find((b) => b.alive && b.role === 'good' && b.y > ps.arena.y);
      const soul = good ? { x: good.x, y: good.y } : { x: 0, y: 0 };
      stepPattern(ps, 1 / 60, soul, true);
      for (const e of ps.events) if (e.type === 'letter' && e.complete) complete = e.word === target;
      ps.events.length = 0;
    }
    expect(complete).toBe(true);
  });

  it('the autopilot survives a guardian turn of every pattern with voice left', () => {
    for (const id of ids) {
      const ps = startPattern(id, words, createRng(9), { duration: 8 });
      const soul = { x: ps.arena.x + ps.arena.w / 2, y: ps.arena.y + ps.arena.h * 0.62 };
      let hurt = 0;
      let invuln = 0;
      for (let i = 0; i < 8 * 60; i++) {
        const d = autopilotDir(ps, soul);
        soul.x = Math.max(ps.arena.x + 4, Math.min(ps.arena.x + ps.arena.w - 4, soul.x + d.x * ADV.soul.speed / 60));
        soul.y = Math.max(ps.arena.y + 4, Math.min(ps.arena.y + ps.arena.h - 4, soul.y + d.y * ADV.soul.speed / 60));
        invuln = Math.max(0, invuln - 1 / 60);
        stepPattern(ps, 1 / 60, soul, invuln <= 0);
        for (const e of ps.events) if (e.type === 'hurt' || e.type === 'wrongLetter' || (e.type !== 'letter' && !e.ok)) {
          hurt += e.type === 'hurt' ? e.dmg : 2;
          invuln = 1;
        }
        ps.events.length = 0;
      }
      expect(hurt, id).toBeLessThan(ADV.hp.max);
    }
    expect(arenaRect('letterCatch').w).toBeGreaterThan(arenaRect('acornDrop').w);
  });
});

describe('adventure encounter flow', () => {
  it('TALK fills calm, LET GO ends spared; attack alone never ends; voice 0 ends as "down"', () => {
    const plan = buildChapterPlan({ chapter: 1, level: 1 });
    const enc = plan.encounters[0]!;
    const b = new Battle(enc, createRng(1), newRun());
    expect(b.phase).toBe('msg');
    while (ph(b) === 'msg') b.advance(); // intro + the mini boss's first stage line
    expect(b.phase).toBe('menu');
    // R2861: the four choices are exactly attack, talk, item, let go
    expect(MENU).toEqual(['poke', 'talk', 'pouch', 'friend']);
    // no calm yet: letting go is refused (and it takes the islander's turn only after a real talk)
    b.choose('friend');
    expect(b.phase).toBe('msg');
    b.advance();
    // three perfect talks fill a gate mini boss's calm
    for (let k = 0; k < 6 && !b.ready; k++) {
      b.choose('talk');
      expect(b.choices.length).toBeLessThanOrEqual(4);
      expect(b.choices.some((t) => t.mode === 'pick')).toBe(true);
      // R2861: a SAID line is what counts as English (a pick would fill calm but never open the let-go)
      b.pickTalk(b.choices.find((t) => t.mode === 'say' && !t.skill)!.id);
      expect(b.talkResult({ stars: 0, score: 0.1, pass: false, missed: [] })).toBe('retry');
      expect(b.talkResult({ stars: 3, score: 1, pass: true, missed: [] })).toBe('next');
      while (ph(b) === 'msg') b.advance();
      while (ph(b) === 'dodge') b.step(1 / 60, { x: 0, y: 0 }, true);
      while (ph(b) === 'msg') b.advance();
    }
    expect(b.calm).toBe(enc.calmMax);
    expect(b.spareReady).toBe(true);
    b.choose('friend');
    expect(b.phase).toBe('befriend');
    b.befriend();
    b.advance();
    expect(b.phase).toBe('end');
    expect(b.outcome).toBe('spared');

    // attack alone never ends a meeting: at 0 grump it covers its ears until one English talk passed
    const f = new Battle(enc, createRng(2), newRun());
    while (ph(f) === 'msg') f.advance();
    for (let k = 0; k < 12 && ph(f) !== 'end'; k++) {
      if (ph(f) === 'menu') {
        f.choose('poke');
        f.ring = 0.25;
        f.strike();
      }
      while (ph(f) === 'msg') f.advance();
      while (ph(f) === 'dodge') f.step(1 / 60, { x: 0, y: 0 }, true);
    }
    expect(f.outcome).toBeNull();
    expect(f.grump).toBe(1);
    // one passed talk unlocks the attack finish
    while (ph(f) === 'dodge') f.step(1 / 60, { x: 0, y: 0 }, true);
    while (ph(f) === 'msg') f.advance();
    // a picked reply passes the panel but is not English said: the ears stay covered
    f.choose('talk');
    f.pickTalk(f.choices.find((t) => t.mode === 'pick' && !t.skill)!.id);
    f.talkResult({ stars: 2, score: 1, pass: true, missed: [] });
    expect(f.talkPasses, 'a pick is not a said line').toBe(0);
    while (ph(f) === 'msg') f.advance();
    while (ph(f) === 'dodge') f.step(1 / 60, { x: 0, y: 0 }, true);
    while (ph(f) === 'msg') f.advance();
    f.choose('talk');
    f.pickTalk(f.choices.find((t) => t.mode === 'say' && !t.skill)!.id);
    f.talkResult({ stars: 3, score: 1, pass: true, missed: [] });
    expect(f.talkPasses, 'a said line is').toBe(1);
    while (ph(f) === 'msg') f.advance();
    while (ph(f) === 'dodge') f.step(1 / 60, { x: 0, y: 0 }, true);
    while (ph(f) === 'msg') f.advance();
    f.choose('poke');
    f.ring = 0.25;
    f.strike();
    while (ph(f) === 'msg') f.advance();
    expect(f.outcome).toBe('fought');

    // the voice is the trip's: a hit in this meeting is still missing in the next one
    const run = newRun();
    run.hp = 1;
    const d = new Battle(plan.encounters.at(-1)!, createRng(3), run);
    while (ph(d) === 'msg') d.advance();
    d.choose('poke');
    d.ring = 0;
    d.step(1 / 60, { x: 0, y: 0 });
    while (ph(d) === 'msg') d.advance();
    expect(d.phase).toBe('dodge');
    // stand still in the middle of a pattern until something lands
    for (let i = 0; i < 60 * 30 && ph(d) === 'dodge'; i++) d.step(1 / 60, { x: 0, y: 0 });
    expect(run.hp).toBe(0);
    while (ph(d) === 'msg') d.advance();
    expect(d.phase).toBe('end');
    expect(d.outcome).toBe('down');
  });

  it('a guardian has stages: harder patterns and bigger hits as it calms, each with its own line', () => {
    for (const ch of [1, 2, 3, 4] as const) {
      const st = ADVENTURE_STORY[ch].stages;
      expect(st.length, `ch${ch}`).toBeGreaterThanOrEqual(3);
      for (let i = 1; i < st.length; i++) {
        expect(st[i]!.at).toBeGreaterThan(st[i - 1]!.at);
        expect(st[i]!.speed).toBeGreaterThanOrEqual(st[i - 1]!.speed);
        expect(st[i]!.damage).toBeGreaterThanOrEqual(st[i - 1]!.damage);
        expect(st[i]!.patterns.length).toBeGreaterThanOrEqual(2);
      }
    }
    const plan = buildChapterPlan({ chapter: 1, level: 1 });
    const g = plan.encounters.at(-1)!;
    expect(g.stages.length).toBe(ADVENTURE_STORY[1].stages.length);
    const stages: number[] = [];
    const b = new Battle(g, createRng(4), newRun(), { stage: (s) => stages.push(s) });
    while (ph(b) === 'msg') b.advance();
    // three good talks move the guardian through its stages
    for (let k = 0; k < 12 && !b.ready; k++) {
      if (ph(b) === 'menu') {
        b.choose('talk');
        b.pickTalk(b.choices[0]!.id);
        b.talkResult({ stars: 3, score: 1, pass: true, missed: [] });
      }
      while (ph(b) === 'msg') b.advance();
      while (ph(b) === 'dodge') b.step(1 / 60, { x: 0, y: 0 }, true);
      while (ph(b) === 'msg') b.advance();
    }
    expect(stages.length).toBeGreaterThanOrEqual(1);
    expect(b.stage).toBeGreaterThanOrEqual(1);
  });

  it('SKILL: magic words are said (picked) and then work once a meeting — heal, shield, slow wind, bright spark', () => {
    const plan = buildChapterPlan({ chapter: 2, level: 1 });
    const run = newRun();
    expect(learn(run, 'warmHeal')).toBe(true);
    learn(run, 'brightSpark');
    run.hp = 5;
    const b = new Battle(plan.encounters[0]!, createRng(5), run);
    while (ph(b) === 'msg') b.advance();
    // R2861: magic words are offered inside TALK (no fifth SKILL command)
    b.choose('talk');
    const heal = b.choices.find((t) => t.skill === 'warmHeal')!;
    expect(heal).toBeTruthy();
    b.pickTalk(heal.id);
    expect(b.phase).toBe('talk');
    expect(b.current?.mode).toBe('pick');
    expect(b.current?.choices).toContain(b.current?.target);
    b.talkResult({ stars: 2, score: 1, pass: true, missed: [] });
    expect(run.hp).toBe(5 + ADV.skill.heal);
    expect(b.usedSkills.has('warmHeal')).toBe(true);
    while (ph(b) === 'msg') b.advance();
    while (ph(b) === 'dodge') b.step(1 / 60, { x: 0, y: 0 }, true);
    while (ph(b) === 'msg') b.advance();
    if (ph(b) === 'menu') {
      const calm = b.calm;
      b.choose('talk');
      const spark = b.choices.find((t) => t.skill === 'brightSpark')!;
      expect(spark).toBeTruthy();
      b.pickTalk(spark.id);
      b.talkResult({ stars: 2, score: 1, pass: true, missed: [] });
      expect(b.calm).toBeGreaterThan(calm);
    }
    expect(skillItem('shieldSong', 3, createRng(1)).choices!.length).toBe(3);
  });
});

describe('adventure trip (voice, coins, pouch, gear, chests, lantern posts)', () => {
  it('chests pay once; the cart sells for coins and says why not; gear changes the numbers', () => {
    const r = newRun();
    for (const ch of [1, 2, 3, 4] as const) {
      expect(ADVENTURE_STORY[ch].chests.length).toBeGreaterThanOrEqual(1);
      const got = openChest(r, ch, 0);
      expect(got).not.toBeNull();
      expect(openChest(r, ch, 0)).toBeNull();
    }
    expect(r.coins).toBeGreaterThan(0);
    const coat = ADVENTURE_STORY[1].stock.find((g) => g.id === 'braveCoat')!;
    r.coins = coat.cost - 1;
    expect(canBuy(r, coat)).toBe('coins');
    expect(buy(r, coat)).toBe('coins');
    r.coins = coat.cost;
    expect(buy(r, coat)).toBe('ok');
    expect(r.coins).toBe(0);
    expect(canBuy(r, coat)).toBe('owned');
    expect(hitCost(r, 3)).toBe(3 - ADV.gear.coatBlock);
    expect(hitCost(r, 1)).toBe(1);
    const scarf = ADVENTURE_STORY[2].stock.find((g) => g.id === 'bigScarf')!;
    r.coins = 999;
    buy(r, scarf);
    expect(maxHp(r)).toBe(ADV.hp.max + ADV.gear.scarfHp);
    const honey = ADVENTURE_STORY[1].stock.find((g) => g.id === 'honeyDrop')!;
    r.items.honeyDrop = ADV.items.maxEach;
    expect(canBuy(r, honey)).toBe('full');
  });

  it('out of voice: wake at the last lantern post with full voice, keep everything; a guardian retry is never easier', () => {
    const r = newRun();
    r.coins = 30;
    restAt(r, { chapter: 2, id: 'post-1' });
    hurt(r, 999);
    expect(r.hp).toBe(0);
    revive(r, 2);
    expect(r.hp).toBe(maxHp(r));
    expect(r.coins).toBe(30);
    expect(r.post).toEqual({ chapter: 2, id: 'post-1' });
    expect(r.bossTries[2]).toBe(1);
    // R2861: retrySpeed is always 1 — no "it gets slower after you lose" easing
    expect(retrySpeed(r, 2)).toBe(1);
    expect(retrySpeed(r, 1)).toBe(1);
    for (let i = 0; i < 20; i++) revive(r, 2);
    expect(retrySpeed(r, 2)).toBe(1);
    expect(heal(r, 5)).toBe(0);
    // round trip, and junk falls back to a fresh trip
    expect(parseRun(JSON.stringify(r))).toEqual(r);
    expect(parseRun('{nope')).toEqual(newRun());
    expect(parseRun(JSON.stringify({ ...r, hp: -5, coins: 1e9, post: { chapter: 9, id: 'x' } })).hp).toBe(1);
  });
});

describe('adventure islands', () => {
  it('every island can be walked from start to guardian and every gate holds its islander', () => {
    for (const ch of [1, 2, 3, 4] as const) {
      const m = buildIsland(ch);
      const r = reachable(m);
      for (const e of m.entities) {
        const near = [
          [0, 0],
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1]
        ].some(([dx, dy]) => r.has((e.ty + dy!) * m.w + e.tx + dx!));
        expect(near, `${ch} ${e.id}`).toBe(true);
      }
      for (const k of ['villager', 'merchant', 'chest', 'post', 'stone', 'critter', 'guardian', 'gate']) expect(m.entities.some((e) => e.kind === k), `${ch} ${k}`).toBe(true);
      expect(m.entities.filter((e) => e.kind === 'chest').length).toBeGreaterThanOrEqual(1);
      expect(tileAt(m, m.start.tx, m.start.ty)).not.toBe('wall');
      const crit = m.entities.filter((e) => e.kind === 'critter');
      // R2861: three gate mini bosses, and a locked gate behind each
      expect(crit.length).toBe(3);
      expect(m.entities.filter((e) => e.kind === 'gate').length).toBe(3);
      // the gate column is wall everywhere except the path rows
      for (const c of crit) for (const y of [3, 4, 10]) expect(blocks(tileAt(m, c.tx, y))).toBe(true);
      const p = moveFeet(m, 40, 120, -100, 0);
      expect(p.x).toBe(40);
    }
  });
});

describe('adventure voice lines', () => {
  it('islanders speak only cast voices and their lines are fixed lines (guests hear them too)', () => {
    const cast = new Set(castVoices().map(ttsVoiceId));
    const lines = adventureFixedLines();
    for (const l of lines) expect(cast.has(ttsVoiceId(l.voice))).toBe(true);
    const fixed = new Set(fixedTtsLines().map((l) => `${ttsVoiceId(l.voice)}|${l.text}`));
    const intro = ADVENTURE_CHAPTERS[0]!.guardian.intro.en;
    expect([...fixed].some((k) => k.endsWith(`|${intro}`))).toBe(true);
    expect([...fixed].some((k) => k.endsWith('|I see an eagle.'))).toBe(true);
  });
});

describe('adventure tap-to-walk', () => {
  it('tap-to-walk goes round a stone and stops next to a tapped islander', () => {
    const m = buildIsland(1);
    const stone = m.entities.find((e) => e.kind === 'stone')!;
    const critter = m.entities.find((e) => e.kind === 'critter')!;
    const solid = (tx: number, ty: number) => (tx === stone.tx && ty === stone.ty) || (tx === critter.tx && ty === critter.ty);
    // from the tile left of the stone to the tile right of it
    const from = { tx: stone.tx - 1, ty: stone.ty };
    const steps = findPath(m, from, { tx: stone.tx + 1, ty: stone.ty }, solid);
    expect(steps.at(-1)).toEqual({ tx: stone.tx + 1, ty: stone.ty });
    expect(steps.some((s) => s.tx === stone.tx && s.ty === stone.ty)).toBe(false);
    for (const s of steps) expect(blocks(tileAt(m, s.tx, s.ty))).toBe(false);
    // each step is one tile away from the one before
    let prev = from;
    for (const s of steps) {
      expect(Math.abs(s.tx - prev.tx) + Math.abs(s.ty - prev.ty)).toBe(1);
      prev = s;
    }
    // a tapped islander: the walk ends beside it
    const toCritter = findPath(m, m.start, { tx: critter.tx, ty: critter.ty }, solid);
    const last = toCritter.at(-1)!;
    expect(Math.abs(last.tx - critter.tx) + Math.abs(last.ty - critter.ty)).toBe(1);
    // water or a wall cannot be reached: the walk gets as close as it can
    const far = findPath(m, m.start, { tx: 0, ty: 0 }, solid);
    expect(far.length).toBeGreaterThan(0);
    expect(blocks(tileAt(m, far.at(-1)!.tx, far.at(-1)!.ty))).toBe(false);
  });
});
