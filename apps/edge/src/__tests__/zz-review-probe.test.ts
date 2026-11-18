// THROWAWAY review probe (scratch clone only, never committed). Prints a table; asserts nothing.
import { describe, it } from 'vitest';
import { CAFE_MENU, LESSON_PLANS } from '@lcw/content';
import { createNodeSqliteExecutor } from '../node-sqlite.js';
import { D1_SCHEMA_SQL } from '../storage.js';
import {
  buildLessonParentFacts,
  mergeLessonParentFacts,
  pickQuotes,
  publicFacts,
  publicSafeText
} from '../parent-report.js';

const out: string[] = [];
const log = (s: string) => out.push(s);

describe('probe', () => {
  it('A. publicSafeText leak candidates (want false = blocked)', () => {
    const leaks: Array<[string, string[]]> = [
      ['Jiwoo, can I have tea?', ['juno']],
      ['jiwoo can i have tea', []],
      ['Can I sit with jiwoo', []],
      ['I like jiwoo', []],
      ['Hi jiwoo', []],
      ['Hello Jiwoo', []],
      ['Can I have tea Jiwoo?', []],
      ['Please call Minsu', []],
      ["My name's Jiwoo", []],
      ['Call me Jiwoo', []],
      ["I'm Jiwoo", []],
      ['I am Jiwoo', []],
      ['i am jiwoo', []],
      ['this is jiwoo', []],
      ['Jiwoo here', []],
      ['June is my friend', []],
      ['Will likes tea', []],
      ['Mark is my friend', []],
      ['Rose is my friend', []],
      ['Grace can swim', []],
      ['April is my sister', []],
      ['we live at mapo apartment', []],
      ['I go to hannuri school', []],
      ['I go to Hannuri Elementary', []],
      ['my friend jiwoo likes cats', []],
      ['zero one zero one two three four five six', []],
      ['kim dot jiwoo at gmail dot com', []],
      ['I like JIWOO', []],
      ['I like Ji-woo', []],
      ["I like Jiwoo's cat", []],
      ['I like jiwoo.', ['지우']],
      ['I like JIWOO KIM', ['juno']],
      ['Can I have tea? Jiwoo', []],
      ['Yes. Jiwoo is my name', []],
      ['The teacher is Jane', []],
      ['I love Seoul', []],
      ['I live in Seoul', []],
      ["I'm in Mapo", []],
      ['I study at Gwangun', []],
      ['I am in grade 3', []],
      ['I am in third grade', []],
      ['I am nine', []],
      ['My mom works at Samsung', []]
    ];
    for (const [t, names] of leaks) log(`LEAK? ${JSON.stringify(t)} names=${JSON.stringify(names)} -> safe=${publicSafeText(t, names)}`);
  });

  it('B. legit sentences wrongly dropped (want true = kept)', () => {
    const legit = [
      'Can I have a warm honey tea',
      'Can I have a warm honey tea, please?',
      'Yes, please',
      'Okay',
      'Thank you',
      'Thanks a lot',
      'Sure',
      'Water, please',
      'Coffee please',
      'Apple juice, please',
      'Maybe next time',
      'Soccer is my favorite',
      'Pizza is good',
      'Dogs are cute',
      'Dinosaurs are cool',
      'Because I like it',
      'Sometimes I play soccer',
      'Everybody likes pizza',
      'Nothing',
      'Tomorrow I will play',
      'Actually I like cats',
      'Pink is my favorite color',
      'Drawing is fun',
      'Summer is hot',
      'Sunday is fun',
      'Banana',
      'Chicken is good',
      'Minecraft is fun',
      'Robots can fly',
      'I want a jetpack so that I can fly to school',
      'I like playing soccer with my dad on Sunday',
      'My favorite food is Pizza',
      'I have a dog and a cat. I like them',
      'Yes I do. Can I have tea?',
      'I like Korea',
      'I like English',
      'I am happy',
      "I'm hungry",
      "It's cold today",
      'How much is it?',
      'Here you are',
      'Welcome to my shop',
      'Excuse me',
      'See you tomorrow',
      'Good morning',
      'Nice to meet you',
      'Let me think',
      'Nobody knows',
      'Please give me a pickaxe',
      "I don't know",
      'No thank you',
      'We can go together',
      'Two apples, please',
      'Do you have a jetpack?',
      'Wait a moment',
      'Hmm, I think so'
    ];
    const dropped = legit.filter((t) => !publicSafeText(t, ['juno']));
    log(`LEGIT dropped ${dropped.length}/${legit.length}: ${JSON.stringify(dropped)}`);
  });

  it('C. plan targets / menu labels vs the filter', () => {
    const bad: string[] = [];
    let n = 0;
    for (const pl of LESSON_PLANS) for (const st of pl.stages) for (const t of st.targets) { n++; if (!publicSafeText(t.text, [])) bad.push(`${pl.id}/${st.id}: ${t.text}`); }
    log(`PLAN targets dropped ${bad.length}/${n}: ${JSON.stringify(bad)}`);
    const bad2: string[] = [];
    for (const d of CAFE_MENU) for (const s of [`Can I have a ${d.label}, please?`, `I want a ${d.label}`, `${d.label} please`]) if (!publicSafeText(s, [])) bad2.push(s);
    log(`MENU sentences dropped ${bad2.length}: ${JSON.stringify(bad2.slice(0, 20))}`);
  });

  it('D. common first names vs SENTENCE_STARTERS ("X can I have tea")', () => {
    const names = 'Jiwoo Minjun Seojun Haneul Yuna Sophie Emma Tom Amy Mark Rose Grace Joy Sunny Ben Max Will Bill Pat Ray Jack Jane Kim Lee Park Choi Ian Leo Mia Luna Lily Sky Ivy Iris Daisy Hope Faith Honey Candy Cookie Bear Coco Mimi Momo Nana Jun Jin Sun Sue Dan Dave Eric Fred Gus Hank Jim Joe Ken Kyle Liam Mike Neil Paul Ryan Sam Ted Tim Tony Zoe Alice Anna Bella Chloe Ella Eva Hannah Judy Kate Lucy Mary Nora Olivia Ruby Sara Tina Vera Wendy May June April Amber Hazel Pearl Penny Ginger Summer Autumn Rain River Jazz Joy Art Bob Cat Dot Gene Guy Harry Herb Jay Lance Mason Miles Moss Nick Noah Ray Rich Rob Rod Ross Russ Sean Seth Todd Troy Vic Wade Walt Wes Zack'.split(' ');
    const through = [...new Set(names)].filter((nm) => publicSafeText(`${nm} can I have tea`, []));
    log(`NAMES that pass as first word (${through.length}): ${through.join(' ')}`);
  });

  it('E. publicFacts end-to-end on a crafted/old report', () => {
    const facts = {
      lesson: {
        lesson_number: 3,
        summary_ko: '이번 수업에서 영어로 3번 말했고…',
        quotes: [
          { text: 'Jiwoo, can I have a tea', stars: 3, mode: 'guided', stage_title_ko: '카페', hintless: true },
          { text: 'can i have a tea', stars: 3, mode: 'guided', stage_title_ko: '지우네 집', hintless: true },
          { text: 'My name is Jiwoo', stars: 1, mode: 'free', stage_title_ko: '', hintless: true },
          { text: 'Can I sit with Juno', stars: 1, mode: 'free', stage_title_ko: '', hintless: false },
          { text: 'Hi jiwoo', stars: 1, mode: 'free', stage_title_ko: '', hintless: false }
        ],
        expressions: ['Juno loves cars', 'Hannuri Elementary', 'so that', 'jiwoo kim'],
        home_practice: ['Can I have tea? My name is Jiwoo', 'Jiwoo', 'Juno', 'Can I have a warm honey tea?', 'Hi jiwoo'],
        stages: [
          { id: 'cafe_order', title_ko: '지우 카페', utterances: 3, passes: 2 },
          { id: 'weird_stage_id', title_ko: '지우네 집 010-1234-5678', utterances: 1, passes: 1 }
        ],
        previous: { utterances: 4, passes: 3, speaking_sec: 20, free_words: 0, note: 'Jiwoo said hi', nested: { x: 1 } },
        pin_windows: [{ text: 'Jiwoo' }],
        teacher_note: 'Jiwoo is shy'
      },
      progress: { a: 1, nick: 'Jiwoo', deep: { b: 2, name: 'x' } },
      ids: 'player-123'
    };
    const pub = publicFacts(facts, ['Juno', 'Juno']);
    log(`PUBLICFACTS ${JSON.stringify(pub)}`);
  });

  it('F. DB: merged parts, previous, home_practice', () => {
    const sql = createNodeSqliteExecutor();
    sql.exec(D1_SCHEMA_SQL);
    const T0 = Date.parse('2026-11-10T05:00:00Z');
    const DAY = 86_400_000;
    sql.run("insert into players (id, family_id, kind, nickname, level, birth_year) values ('k','f','human','지우','L1',2016)", []);
    const hasPlayers = true;
    void hasPlayers;
    const lesson = (id: string, at: number, plan = 'first_lesson_v1') =>
      sql.run('insert into lessons (id, player_id, world_id, started_at, ended_at, plan) values (?,?,?,?,?,?)', [id, 'k', 'w', at, at + 3_600_000, plan]);
    let uid = 0;
    const utt = (lid: string, at: number, text: string, o: Partial<{ target: string; stars: number; mode: string; ctx: string; words: number; dur: number; hint: string }> = {}) =>
      sql.run(
        `insert into utterances (id, player_id, world_id, session_id, session_kind, ctx, mode, interlocutor, first_text, target_text, final_text, words, l1_words, dur_ms, latency_ms, stars, hint_level, attempts, score, confidence, source, created_at)
         values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [`u${++uid}`, 'k', 'w', lid, 'lesson', o.ctx ?? 'cafe_order', o.mode ?? 'guided', 'teacher', text, o.target ?? '', text, o.words ?? text.split(' ').length, 0, o.dur ?? 2000, 0, o.stars ?? 2, o.hint ?? 'none', 1, 1, 1, 'stt', at]
      );
    // L-1: two days before, 4 utterances; L0 empty abandoned yesterday-noon; today part A (warm-up free talk), part B (cafe targets)
    lesson('Lm1', T0 - 2 * DAY);
    for (let i = 0; i < 4; i++) utt('Lm1', T0 - 2 * DAY + 1000 * (i + 1), 'I like playing soccer', { ctx: 'warmup_anchor', mode: 'free', stars: 1, dur: 3000 });
    lesson('L0', T0 - DAY); // zero utterances
    lesson('A', T0);
    utt('A', T0 + 1000, 'I like playing soccer with my dad', { ctx: 'warmup_anchor', mode: 'free', stars: 3, dur: 4000 });
    utt('A', T0 + 2000, 'I want a new robot for my birthday', { ctx: 'warmup_anchor', mode: 'free', stars: 3, dur: 4000 });
    lesson('B', T0 + 2 * 3_600_000);
    utt('B', T0 + 2 * 3_600_000 + 1000, 'can i have a warm honey tea', { target: 'Can I have a warm honey tea?', ctx: 'cafe_order', stars: 3, dur: 2500 });
    utt('B', T0 + 2 * 3_600_000 + 2000, 'can i have a cold juice please', { target: 'Can I have a cold juice, please?', ctx: 'cafe_order', stars: 2, dur: 2500 });
    const fa = buildLessonParentFacts(sql, 'A', T0 + 3_600_000)!;
    const fb = buildLessonParentFacts(sql, 'B', T0 + 3 * 3_600_000)!;
    const f1 = buildLessonParentFacts(sql, 'Lm1', T0)!;
    const f0 = buildLessonParentFacts(sql, 'L0', T0)!;
    log(`DB Lm1(first ever): number=${f1.lesson_number} previous=${JSON.stringify(f1.previous)}`);
    log(`DB L0(empty): number=${f0.lesson_number} utt=${f0.utterances} previous=${JSON.stringify(f0.previous)}`);
    log(`DB A: number=${fa.lesson_number} previous=${JSON.stringify(fa.previous)} home=${JSON.stringify(fa.home_practice)} quotes=${JSON.stringify(fa.quotes.map((q) => q.text))}`);
    log(`DB B: number=${fb.lesson_number} previous=${JSON.stringify(fb.previous)} home=${JSON.stringify(fb.home_practice)} quotes=${JSON.stringify(fb.quotes.map((q) => q.text))}`);
    const m = mergeLessonParentFacts([fb, fa])!;
    log(`DB MERGED: number=${m.lesson_number} previous=${JSON.stringify(m.previous)} home=${JSON.stringify(m.home_practice)} quotes=${JSON.stringify(m.quotes.map((q) => q.text))} utt=${m.utterances} dur=${m.duration_min} stages=${JSON.stringify(m.stages.map((s) => s.title_ko + ':' + s.main))}`);
    // Order reversed in time: part with later id sorted? previous must come from the earliest started_at
    const publicM = publicFacts({ lesson: m }, ['지우']);
    log(`DB MERGED public home=${JSON.stringify((publicM as any).lesson.home_practice)} previous=${JSON.stringify((publicM as any).lesson.previous)}`);
    // pickQuotes with Korean nickname + romanised lowercase name
    const r = pickQuotes(
      [{ final_text: 'i like jiwoo', stars: 3, mode: 'free', ctx: 'x', words: 3, dur_ms: 1000, confidence: 1, hint_level: 'none', created_at: 1, target_text: '' } as any],
      () => 'T',
      ['지우']
    );
    log(`pickQuotes hangul nickname, lowercase romanised name in mid sentence: ${JSON.stringify(r.map((q) => q.text))}`);
  });

  it('Z. flush', () => {
    console.log('\n=====PROBE-OUTPUT=====\n' + out.join('\n') + '\n=====END=====');
  });
});
