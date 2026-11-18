// THROWAWAY final-verifier probe (scratch clone only, never committed). Prints; asserts nothing.
import { it } from 'vitest';
import { LESSON_PLANS } from '@lcw/content';
import { createNodeSqliteExecutor } from '../node-sqlite.js';
import { D1_SCHEMA_SQL } from '../storage.js';
import { buildLessonParentFacts, mergeLessonParentFacts, publicFacts, publicSafeText } from '../parent-report.js';

const L: string[] = [];
const log = (s: string) => L.push(s);

it('V1 leak inputs (fresh, names=[민지] as Korean nickname)', () => {
  const names = ['민지'];
  for (const t of ['Bye minji', 'I play with minji', 'minji is here', 'Can I have tea minji', 'Thank you seojun', 'I sit next to doyun', 'Hi Minji', 'Minji can I have tea', 'my mom is kind']) {
    const pf = publicFacts({ lesson: { quotes: [{ text: t, stars: 3 }], expressions: [t], home_practice: [t] } }, names) as any;
    log(`V1 ${JSON.stringify(t)} safe=${publicSafeText(t, names)} q=${pf.lesson.quotes.length} e=${pf.lesson.expressions.length} h=${pf.lesson.home_practice.length}`);
  }
  // English nickname registered as 'Juno': lowercase is caught by name match
  log(`V1 juno-nick "i like juno" safe=${publicSafeText('i like juno', ['juno'])}`);
});

it('V2 summary_ko / stage title passthrough', () => {
  const pf = publicFacts({ lesson: { summary_ko: '지우 010-1234-5678', stages: [{ id: 'nope', title_ko: '지우네 집' }], quotes: [{ text: 'Can I have tea', stars: 3, stage_title_ko: '지우네 집' }] } }, ['지우']) as any;
  log(`V2 summary=${JSON.stringify(pf.lesson.summary_ko)} stage=${JSON.stringify(pf.lesson.stages[0].title_ko)} qstage=${JSON.stringify(pf.lesson.quotes[0]?.stage_title_ko)}`);
});

it('V3 legit drops (sample)', () => {
  for (const t of ['Okay', 'Pizza is good', 'It is cold today', 'I am building a tower', 'Thank you! See you next time.', 'Sometimes I play soccer', 'Can I have a warm honey tea?', 'I like cats']) log(`V3 ${JSON.stringify(t)} safe=${publicSafeText(t, [])}`);
  let n = 0, d = 0;
  const dropped: string[] = [];
  for (const pl of LESSON_PLANS) for (const st of pl.stages) for (const tg of st.targets) if (!tg.text.includes('___')) { n++; if (!publicSafeText(tg.text, [])) { d++; dropped.push(tg.text); } }
  log(`V3 plan targets dropped ${d}/${n} ${JSON.stringify(dropped)}`);
});

it('V4 DB: previous for merged lesson and for the lesson AFTER a merged lesson; home_practice', () => {
  const sql = createNodeSqliteExecutor();
  sql.exec(D1_SCHEMA_SQL);
  const T0 = Date.parse('2026-11-10T05:00:00Z');
  const H = 3_600_000, DAY = 24 * H;
  sql.run("insert into players (id, family_id, kind, nickname, level, birth_year) values ('k','f','human','지우','L1',2016)", []);
  const lesson = (id: string, at: number) => sql.run('insert into lessons (id, player_id, world_id, started_at, ended_at, plan) values (?,?,?,?,?,?)', [id, 'k', 'w', at, at + H / 2, 'first_lesson_v1']);
  let uid = 0;
  const utt = (lid: string, at: number, text: string, o: Partial<{ target: string; stars: number; mode: string; ctx: string; dur: number }> = {}) =>
    sql.run(
      `insert into utterances (id, player_id, world_id, session_id, session_kind, ctx, mode, interlocutor, first_text, target_text, final_text, words, l1_words, dur_ms, latency_ms, stars, hint_level, attempts, score, confidence, source, created_at)
       values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [`u${++uid}`, 'k', 'w', lid, 'lesson', o.ctx ?? 'cafe_order', o.mode ?? 'guided', 'teacher', text, o.target ?? '', text, text.split(' ').length, 0, o.dur ?? 2000, 0, o.stars ?? 2, 'none', 1, 1, 1, 'stt', at]
    );
  // Yesterday: one lesson in two parts A (6 lines) and B (2 lines). Today: C with 8 lines.
  lesson('A', T0 - DAY);
  for (let i = 0; i < 6; i++) utt('A', T0 - DAY + 1000 * (i + 1), 'can i have a warm honey tea', { target: 'Can I have a warm honey tea?', stars: 3 });
  lesson('B', T0 - DAY + 2 * H);
  for (let i = 0; i < 2; i++) utt('B', T0 - DAY + 2 * H + 1000 * (i + 1), 'can i have a cold juice please', { target: 'Can I have a cold juice, please?', stars: 2 });
  lesson('C', T0);
  for (let i = 0; i < 8; i++) utt('C', T0 + 1000 * (i + 1), 'can i have a warm honey tea', { target: 'Can I have a warm honey tea?', stars: 3 });
  const fa = buildLessonParentFacts(sql, 'A', T0)!;
  const fb = buildLessonParentFacts(sql, 'B', T0)!;
  const m = mergeLessonParentFacts([fb, fa])!;
  const fc = buildLessonParentFacts(sql, 'C', T0 + H)!;
  log(`V4 yesterday merged: number=${m.lesson_number} utt=${m.utterances} passes=${m.passes} sec=${m.speaking_sec} previous=${JSON.stringify(m.previous)} home=${JSON.stringify(m.home_practice)}`);
  log(`V4 today C: number=${fc.lesson_number} utt=${fc.utterances} previous=${JSON.stringify(fc.previous)}  (parent saw yesterday utt=${m.utterances})`);
  // home de-dup: same target in both parts + one-word expression inside another sentence
  const mk = (over: Partial<typeof fa>) => ({ ...fa, ...over });
  const m2 = mergeLessonParentFacts([
    mk({ started_at: 1, home_practice: ['Can I have a warm honey tea?'], expressions: [], quotes: [] }),
    mk({ started_at: 2, home_practice: ['Can I have a warm honey tea, please?', 'I want steak'], expressions: ['Tea'], quotes: [] })
  ])!;
  log(`V4 dedup home=${JSON.stringify(m2.home_practice)}`);
  const m3 = mergeLessonParentFacts([
    mk({ started_at: 1, home_practice: ['I want steak'], expressions: [], quotes: [] }),
    mk({ started_at: 2, home_practice: ['Tea please'], expressions: [], quotes: [] })
  ])!;
  log(`V4 substring home=${JSON.stringify(m3.home_practice)}`);
  const m4 = mergeLessonParentFacts([
    mk({ started_at: 1, home_practice: ['I want steak'], expressions: [], quotes: [] }),
    mk({ started_at: 2, home_practice: [], expressions: ['tea'], quotes: [] })
  ])!;
  log(`V4 oneword home=${JSON.stringify(m4.home_practice)} expressions=${JSON.stringify(m4.expressions)}`);
  const m5 = mergeLessonParentFacts([
    mk({ started_at: 1, home_practice: ['Can I have a tea?'], expressions: [], quotes: [] }),
    mk({ started_at: 2, home_practice: ['Can I have a tea, please?'], expressions: ['tea'], quotes: [] })
  ])!;
  log(`V4 normal home=${JSON.stringify(m5.home_practice)}`);
  const pub = publicFacts({ lesson: { ...m, home_practice: [...m.home_practice, 'I like jiwoo'] } }, ['지우']) as any;
  log(`V4 public home=${JSON.stringify(pub.lesson.home_practice)} previous=${JSON.stringify(pub.lesson.previous)}`);
});

it('zz print', () => {
  console.log('\n' + L.join('\n'));
});
