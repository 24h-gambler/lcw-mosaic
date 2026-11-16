import { describe, expect, it } from 'vitest';
import { ADVENTURE_CHAPTERS, ADVENTURE_WORDS, adventureFixedLines, adventureLevelOf, adventureWordSentence, castVoices, fixedTtsLines, ttsVoiceId } from '@lcw/content';
import { AdventureEnvelopeSchema, EnglishDayFileSchema } from '@lcw/schemas';
import { buildChapterPlan, cleanSentence, cleanWord, misspellings, talkChoices } from '../core/plan.js';
import { createRng } from '../core/rng.js';
import { gradeExact, gradePick, gradeSpoken } from '../core/grade.js';
import { earlierWords, emptyProgress, isUnlocked, kstDate, lockReason, mergeSettings, nextChapter, parseProgress, recordFinish, toSettings } from '../core/progress.js';
import { addLine, buildEnvelope, chapterStars, startRecord, summaryKo, toActivity, wordHit } from '../core/record.js';
import { dayFileUrls, parseEdLink, readEdLink, resultUrl, safeBack } from '../core/edlink.js';
import { arenaRect, autopilotDir, startPattern, stepPattern } from '../core/bullets.js';
import { Battle } from '../core/battle.js';
import { blocks, buildIsland, findPath, moveFeet, reachable, tileAt } from '../core/map.js';
import { ADV } from '../core/tuning.js';

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
        const g = p.encounters[2];
        expect(g.talks.find((t) => t.kind === 'bank')!.target.length).toBeGreaterThan(3);
        expect(g.calmMax).toBe(ch.id === 4 ? ADV.calmMax.final : ADV.calmMax.guardian);
        if (ch.id === 4) expect(g.talks.filter((t) => t.id.startsWith('g-review')).length).toBeGreaterThan(0);
      }
    }
  });

  it('three choices per turn always include one spoken sentence and rotate past finished ones', () => {
    const p = buildChapterPlan({ chapter: 3, level: 2 });
    const talks = p.encounters[2].talks;
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
});

describe('adventure progress (one island per lesson day)', () => {
  it('chapter 1 is open; the next opens on a later Korea-time day; replay stays open', () => {
    let p = emptyProgress();
    const day1 = '2026-11-16';
    expect(isUnlocked(p, 1, day1)).toBe(true);
    expect(isUnlocked(p, 2, day1)).toBe(false);
    expect(lockReason(p, 2, day1)).toBe('previous');
    const rec = startRecord(1, 1, ['puppy'], Date.UTC(2026, 10, 16, 8));
    rec.outcome = 'spared';
    p = recordFinish(p, 1, day1, { stars: 2, outcome: 'spared', words: ['puppy'], activity: toActivity(rec, Date.UTC(2026, 10, 16, 8, 10)) });
    expect(isUnlocked(p, 2, day1)).toBe(false);
    expect(lockReason(p, 2, day1)).toBe('next-day');
    expect(nextChapter(p, day1)).toBe(1);
    expect(isUnlocked(p, 2, '2026-11-19')).toBe(true);
    expect(nextChapter(p, '2026-11-19')).toBe(2);
    expect(isUnlocked(p, 3, '2026-11-19', { unlockAll: true })).toBe(true);
    expect(earlierWords(p, 4)).toEqual(['puppy']);
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
  it('TALK fills calm, FRIEND ends spared; POKE ends fought; voice 0 restarts kindly', () => {
    const plan = buildChapterPlan({ chapter: 1, level: 1 });
    const enc = plan.encounters[0];
    const b = new Battle(enc, createRng(1), { honeyDrop: 1, berryBun: 0 });
    expect(b.phase).toBe('msg');
    b.advance();
    expect(b.phase).toBe('menu');
    b.choose('friend');
    expect(b.phase).toBe('msg');
    b.advance();
    b.choose('talk');
    expect(b.choices.length).toBe(3);
    b.pickTalk(b.choices[0]!.id);
    expect(b.talkResult({ stars: 0, score: 0.1, pass: false, missed: [] })).toBe('retry');
    expect(b.talkResult({ stars: 3, score: 1, pass: true, missed: [] })).toBe('next');
    expect(b.calm).toBe(enc.calmMax);
    while (b.phase === 'msg') b.advance();
    expect(b.phase).toBe('menu');
    b.choose('friend');
    expect(b.phase).toBe('befriend');
    b.befriend();
    b.advance();
    expect(b.phase).toBe('end');
    expect(b.outcome).toBe('spared');

    const f = new Battle(enc, createRng(2), { honeyDrop: 0, berryBun: 0 });
    f.advance();
    for (let k = 0; k < 20 && f.phase !== 'end'; k++) {
      if (f.phase === 'menu') {
        f.choose('poke');
        f.ring = 0.25;
        f.strike();
      }
      while (f.phase === 'msg') f.advance();
      while (f.phase === 'dodge') f.step(1 / 60, { x: 0, y: 0 }, true);
    }
    expect(f.outcome).toBe('fought');

    const d = new Battle(plan.encounters[2], createRng(3), { honeyDrop: 0, berryBun: 0 });
    d.advance();
    d.choose('poke');
    d.ring = 0;
    d.step(1 / 60, { x: 0, y: 0 });
    while (d.phase === 'msg') d.advance();
    expect(d.phase).toBe('dodge');
    d.hp = 1;
    // stand still in the middle of a pattern until something lands
    for (let i = 0; i < 60 * 12 && d.phase === 'dodge'; i++) d.step(1 / 60, { x: 0, y: 0 });
    if (d.downs) {
      expect(d.msgs[0]!.line.en).toContain('try again');
      d.advance();
      expect(d.hp).toBe(ADV.hp.max);
      expect(d.slow).toBe(ADV.retrySlow);
    }
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
      expect(tileAt(m, m.start.tx, m.start.ty)).not.toBe('wall');
      const crit = m.entities.filter((e) => e.kind === 'critter');
      expect(crit.length).toBe(2);
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
