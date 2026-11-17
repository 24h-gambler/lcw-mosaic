// THROWAWAY independent final-verifier probe (scratch clone only, never committed). Prints; asserts nothing.
import { it } from 'vitest';
import { createNodeSqliteExecutor } from '../node-sqlite.js';
import { D1_SCHEMA_SQL } from '../storage.js';
import { buildLessonParentFacts, mergeLessonParentFacts, publicFacts, publicSafeText, maskNickname } from '../parent-report.js';

const out: string[] = [];
const log = (s: string) => out.push(s);

it('P1 public leak — Korean nickname 하은, family.ts names shape', () => {
  const nick = '하은';
  const names = [nick, ...nick.split(/\s+/)];
  const inputs = [
    'I like haeun', 'Bye haeun', 'haeun can I have juice', 'Haeun can I have juice', 'Can I have juice Haeun',
    '"Haeun" can I have juice', '-Haeun can I have juice', 'I like ha-eun', 'my friend is minsu', 'I live in Mapo',
    'Can I have a warm honey tea?', 'I like playing soccer with my dad'
  ];
  for (const t of inputs) {
    const pf = publicFacts({ lesson: { quotes: [{ text: t, stars: 3 }], expressions: [t], home_practice: [t] } }, names) as any;
    log(`P1 ${JSON.stringify(t)} safe=${publicSafeText(t, names)} q/e/h=${pf.lesson.quotes.length}/${pf.lesson.expressions.length}/${pf.lesson.home_practice.length}`);
  }
  const pf2 = publicFacts({ lesson: { summary_ko: '하은 010-9999-0000', stages: [{ id: 'zz_unknown', title_ko: '하은이네' }], quotes: [{ text: 'Can I have juice', stars: 2, stage_title_ko: '하은이네 학교' }] } }, names) as any;
  log(`P1 summary=${JSON.stringify(pf2.lesson.summary_ko)} stage=${JSON.stringify(pf2.lesson.stages[0]?.title_ko)} qstage=${JSON.stringify(pf2.lesson.quotes[0]?.stage_title_ko)}`);
  log(`P1 mask teacher_comment ko=${JSON.stringify(maskNickname('하은이가 잘했어요', nick))} en=${JSON.stringify(maskNickname('Haeun did great', nick))}`);
  // English nickname registered: lowercase caught?
  log(`P1 english nick 'Sky' "i like sky" safe=${publicSafeText('i like sky', ['sky'])} | "Sky is blue" safe=${publicSafeText('Sky is blue', ['sky'])}`);
});

it('P2 previous — split lesson then next lesson; first lesson; empty previous', () => {
  const sql = createNodeSqliteExecutor();
  sql.exec(D1_SCHEMA_SQL);
  const T0 = Date.parse('2026-11-12T06:00:00Z');
  const H = 3_600_000, DAY = 86_400_000;
  sql.run("insert into players (id, family_id, kind, nickname, level, birth_year) values ('p','f','human','하은','L1',2017)", []);
  const lesson = (id: string, at: number) => sql.run('insert into lessons (id, player_id, world_id, started_at, ended_at, plan) values (?,?,?,?,?,?)', [id, 'p', 'w', at, at + H / 3, 'first_lesson_v1']);
  let uid = 0;
  const utt = (lid: string, at: number, text: string, target: string, stars: number, mode = 'guided') =>
    sql.run(
      `insert into utterances (id, player_id, world_id, session_id, session_kind, ctx, mode, interlocutor, first_text, target_text, final_text, words, l1_words, dur_ms, latency_ms, stars, hint_level, attempts, score, confidence, source, created_at)
       values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [`x${++uid}`, 'p', 'w', lid, 'lesson', 'cafe_order', mode, 'teacher', text, target, text, text.split(' ').length, 0, 3000, 0, stars, 'none', 1, 1, 1, 'stt', at]
    );
  lesson('L1', T0 - 3 * DAY);
  for (let i = 0; i < 2; i++) utt('L1', T0 - 3 * DAY + 1000 * (i + 1), 'can i have a cold juice please', 'Can I have a cold juice, please?', 2);
  lesson('E', T0 - 2 * DAY); // empty lesson, no utterances
  lesson('A', T0 - DAY);
  for (let i = 0; i < 3; i++) utt('A', T0 - DAY + 1000 * (i + 1), 'i like playing soccer with my dad', '', 3, 'free');
  lesson('B', T0 - DAY + H);
  for (let i = 0; i < 5; i++) utt('B', T0 - DAY + H + 1000 * (i + 1), 'can i have a warm honey tea', 'Can I have a warm honey tea?', 3);
  lesson('C', T0);
  for (let i = 0; i < 4; i++) utt('C', T0 + 1000 * (i + 1), 'can i have a warm honey tea', 'Can I have a warm honey tea?', 3);
  const f1 = buildLessonParentFacts(sql, 'L1', T0)!;
  const fe = buildLessonParentFacts(sql, 'E', T0)!;
  const fa = buildLessonParentFacts(sql, 'A', T0)!;
  const fb = buildLessonParentFacts(sql, 'B', T0)!;
  const m = mergeLessonParentFacts([fa, fb])!;
  const fc = buildLessonParentFacts(sql, 'C', T0 + H)!;
  log(`P2 first L1 number=${f1.lesson_number} previous=${JSON.stringify(f1.previous)}`);
  log(`P2 empty E previous=${JSON.stringify(fe.previous)} utt=${fe.utterances}`);
  log(`P2 merged A+B utt=${m.utterances} passes=${m.passes} sec=${m.speaking_sec} previous=${JSON.stringify(m.previous)} home=${JSON.stringify(m.home_practice)}`);
  log(`P2 next C utt=${fc.utterances} previous=${JSON.stringify(fc.previous)} (parent saw merged utt=${m.utterances}) home=${JSON.stringify(fc.home_practice)}`);
  log(`P2 single B home (target first)=${JSON.stringify(fb.home_practice)} A home=${JSON.stringify(fa.home_practice)}`);
});

it('P3 home_practice de-dup on merge', () => {
  const base = { lesson_day: '2026-11-12', lesson_number: 1, started_at: 0, ended_at: 1, duration_min: 1, utterances: 1, passes: 1, stars_total: 1, three_star_passes: 0, hintless_passes: 0, words_spoken: 1, free_words: 0, speaking_sec: 1, longest_words: 1, quotes: [], expressions: [], coaching_moments: 0, stages: [], summary_ko: '', previous: null, home_practice: [] as string[] };
  const run = (a: Partial<typeof base>, b: Partial<typeof base>) => mergeLessonParentFacts([{ ...base, ...a, started_at: 1 } as any, { ...base, ...b, started_at: 2 } as any])!.home_practice;
  log(`P3 same+period ${JSON.stringify(run({ home_practice: ['I like cats.'] }, { home_practice: ['I like cats', 'Can I have juice?'] }))}`);
  log(`P3 inside ${JSON.stringify(run({ home_practice: ['Can I have juice?'] }, { home_practice: ['Can I have juice, please?'] }))}`);
  log(`P3 substring-word 'hat' vs 'what' ${JSON.stringify(run({ home_practice: ['What is this?'] }, { expressions: ['hat'] }))}`);
  log(`P3 case 'HELLO' vs 'hello there' ${JSON.stringify(run({ home_practice: ['Hello there'] }, { home_practice: ['HELLO'] }))}`);
});

it('zz dump', () => {
  console.log('\n=====OPUS3=====\n' + out.join('\n') + '\n=====END=====');
});
