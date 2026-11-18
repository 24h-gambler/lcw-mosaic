// THROWAWAY independent verifier probe (scratch clone only, never committed). Prints; asserts nothing.
import { it } from 'vitest';
import { LESSON_PLANS } from '@lcw/content';
import { createNodeSqliteExecutor } from '../node-sqlite.js';
import { D1_SCHEMA_SQL } from '../storage.js';
import { buildLessonParentFacts, mergeLessonParentFacts, publicFacts, publicSafeText, pickQuotes } from '../parent-report.js';

const L: string[] = [];
const log = (s: string) => L.push(s);
const pf = (t: string, names: string[]) => {
  const o = publicFacts({ lesson: { quotes: [{ text: t, stars: 3 }], expressions: [t], home_practice: [t] } }, names) as any;
  return `${o.lesson.quotes.length}/${o.lesson.expressions.length}/${o.lesson.home_practice.length}`;
};

it('O1 names', () => {
  const cases: [string, string[]][] = [
    ['I like seoyeon', ['서연']],
    ['Thank you seoyeon', ['서연']],
    ['seoyeon can I have tea', ['서연']],
    ['Seoyeon can I have tea', ['서연']],
    ['I like Seoyeon', ['서연']],
    ['(Seoyeon) can I have tea', ['서연']],
    ['"Seoyeon, can I have tea"', ['서연']],
    ['...Seoyeon can I have tea', ['서연']],
    ['Hi,Seoyeon', ['서연']],
    ['I like ji-woo', ['지우']],
    ['I like juno', ['Juno']],
    ["Juno's tea please", ['Juno']],
    ['May I have tea', ['May']],
    ['Can I have honey tea', ['Honey']],
    ['June is my sister', ['지우']],
    ['Mark is here', ['지우']],
    ['Sky is blue', ['지우']]
  ];
  for (const [t, n] of cases) log(`O1 ${JSON.stringify(t)} names=${JSON.stringify(n)} safe=${publicSafeText(t, n)} pf(q/e/h)=${pf(t, n)}`);
});

it('O2 legit + plan targets', () => {
  for (const t of ['Okay', 'Yes', 'No', 'Pizza is good', 'I like cats', 'Can I have a warm honey tea?', 'I am building a tower', 'Thank you! See you next time.', 'Apples are red', 'It is my turn'])
    log(`O2 ${JSON.stringify(t)} safe=${publicSafeText(t, [])}`);
  let n = 0;
  const dropped: string[] = [];
  for (const pl of LESSON_PLANS) for (const st of pl.stages) for (const tg of st.targets) if (!tg.text.includes('___')) { n++; if (!publicSafeText(tg.text, [])) dropped.push(tg.text); }
  log(`O2 plan targets dropped ${dropped.length}/${n} ${JSON.stringify(dropped)}`);
});

it('O3 previous / merge / home (real schema)', () => {
  const sql = createNodeSqliteExecutor();
  sql.exec(D1_SCHEMA_SQL);
  const H = 3_600_000, DAY = 24 * H;
  const T0 = Date.parse('2026-11-12T05:00:00Z');
  sql.run("insert into players (id, family_id, kind, nickname, level, birth_year) values ('k','f','human','서연','L1',2016)", []);
  const lesson = (id: string, at: number) => sql.run('insert into lessons (id, player_id, world_id, started_at, ended_at, plan) values (?,?,?,?,?,?)', [id, 'k', 'w', at, at + H / 2, 'first_lesson_v1']);
  let uid = 0;
  const utt = (lid: string, at: number, text: string, o: Partial<{ target: string; stars: number; mode: string; ctx: string; dur: number }> = {}) =>
    sql.run(
      `insert into utterances (id, player_id, world_id, session_id, session_kind, ctx, mode, interlocutor, first_text, target_text, final_text, words, l1_words, dur_ms, latency_ms, stars, hint_level, attempts, score, confidence, source, created_at)
       values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [`u${++uid}`, 'k', 'w', lid, 'lesson', o.ctx ?? 'cafe_order', o.mode ?? 'guided', 'teacher', text, o.target ?? '', text, text.split(' ').length, 0, o.dur ?? 3000, 0, o.stars ?? 2, 'none', 1, 1, 1, 'stt', at]
    );
  // Day -3: first ever lesson F (3 lines). Day -2: abandoned E (0 lines). Day -1: split P1 (5) + P2 (3). Day 0: split Q1 (free talk quote) + Q2 (cafe target).
  lesson('F', T0 - 3 * DAY);
  for (let i = 0; i < 3; i++) utt('F', T0 - 3 * DAY + 1000 * (i + 1), 'can i have a tea', { target: 'Can I have a tea?', stars: 2 });
  lesson('E', T0 - 2 * DAY);
  lesson('P1', T0 - DAY);
  for (let i = 0; i < 5; i++) utt('P1', T0 - DAY + 1000 * (i + 1), 'can i have a warm honey tea', { target: 'Can I have a warm honey tea?', stars: 3 });
  lesson('P2', T0 - DAY + H);
  for (let i = 0; i < 3; i++) utt('P2', T0 - DAY + H + 1000 * (i + 1), 'can i have a cold juice please', { target: 'Can I have a cold juice, please?', stars: 2 });
  lesson('Q1', T0);
  utt('Q1', T0 + 1000, 'i like playing soccer with my dad', { mode: 'free', ctx: 'free_talk', stars: 2 });
  utt('Q1', T0 + 2000, 'i like seoyeon very much', { mode: 'free', ctx: 'free_talk', stars: 2 });
  lesson('Q2', T0 + H);
  for (let i = 0; i < 2; i++) utt('Q2', T0 + H + 1000 * (i + 1), 'can i have a warm honey tea', { target: 'Can I have a warm honey tea?', stars: 3 });
  const f = buildLessonParentFacts(sql, 'F', T0)!;
  const e = buildLessonParentFacts(sql, 'E', T0)!;
  log(`O3 F first: number=${f.lesson_number} previous=${JSON.stringify(f.previous)}`);
  log(`O3 E empty: number=${e.lesson_number} utt=${e.utterances} previous=${JSON.stringify(e.previous)}`);
  const p1 = buildLessonParentFacts(sql, 'P1', T0)!;
  const p2 = buildLessonParentFacts(sql, 'P2', T0)!;
  const mp = mergeLessonParentFacts([p2, p1])!;
  log(`O3 P2 alone previous=${JSON.stringify(p2.previous)} (= P1 same day)`);
  log(`O3 merged P: number=${mp.lesson_number} utt=${mp.utterances} passes=${mp.passes} sec=${mp.speaking_sec} previous=${JSON.stringify(mp.previous)} (expect F {3,3,9,0})`);
  const q1 = buildLessonParentFacts(sql, 'Q1', T0 + 2 * H)!;
  const q2 = buildLessonParentFacts(sql, 'Q2', T0 + 2 * H)!;
  const mq = mergeLessonParentFacts([q1, q2])!;
  log(`O3 merged Q: number=${mq.lesson_number} previous=${JSON.stringify(mq.previous)} (parent saw yesterday utt=${mp.utterances} passes=${mp.passes} sec=${mp.speaking_sec})`);
  log(`O3 merged Q home=${JSON.stringify(mq.home_practice)} q1.home=${JSON.stringify(q1.home_practice)} q2.home=${JSON.stringify(q2.home_practice)} quotes=${JSON.stringify(mq.quotes.map((q) => q.text))}`);
  const pub = publicFacts({ lesson: mq }, ['서연']) as any;
  log(`O3 public Q home=${JSON.stringify(pub.lesson.home_practice)} quotes=${JSON.stringify(pub.lesson.quotes.map((q: any) => q.text))}`);
  // single-lesson version of Q (no split) for comparison of home order
  const mk = (over: any) => ({ ...p1, ...over });
  const md = mergeLessonParentFacts([mk({ started_at: 1, home_practice: ['I want steak'], expressions: [], quotes: [] }), mk({ started_at: 2, home_practice: [], expressions: ['tea'], quotes: [] })])!;
  log(`O3 substring dedup home=${JSON.stringify(md.home_practice)}`);
  const md2 = mergeLessonParentFacts([mk({ started_at: 1, home_practice: ['Can I have a tea?'], expressions: [], quotes: [] }), mk({ started_at: 2, home_practice: ['can i have a tea, please?', 'Can I have a tea?'], expressions: [], quotes: [] })])!;
  log(`O3 normal dedup home=${JSON.stringify(md2.home_practice)}`);
});

it('zz print', () => {
  console.log('\n' + L.join('\n'));
});
