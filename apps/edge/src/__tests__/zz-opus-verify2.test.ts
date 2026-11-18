// THROWAWAY independent verifier probe (scratch clone only, never committed).
import { it } from 'vitest';
import { createNodeSqliteExecutor } from '../node-sqlite.js';
import { D1_SCHEMA_SQL } from '../storage.js';
import { buildLessonParentFacts, mergeLessonParentFacts } from '../parent-report.js';
it('O4 real fold markers', () => {
  const sql = createNodeSqliteExecutor();
  sql.exec(D1_SCHEMA_SQL);
  sql.exec('create table if not exists lesson_auto_close (lesson_id text primary key, closed_at integer not null, last_activity_at integer not null, draft text not null, sent_at integer, folded_into text, empty integer not null default 0); create table if not exists lesson_continuations (lesson_id text primary key, continues_from text not null, at integer not null);');
  const H = 3_600_000, DAY = 24 * H, T0 = Date.parse('2026-11-12T05:00:00Z');
  sql.run("insert into players (id, family_id, kind, nickname, level, birth_year) values ('k','f','human','서연','L1',2016)", []);
  const lesson = (id: string, at: number) => sql.run('insert into lessons (id, player_id, world_id, started_at, ended_at, plan) values (?,?,?,?,?,?)', [id, 'k', 'w', at, at + H / 2, 'first_lesson_v1']);
  let uid = 0;
  const utt = (lid: string, at: number) => sql.run(`insert into utterances (id, player_id, world_id, session_id, session_kind, ctx, mode, interlocutor, first_text, target_text, final_text, words, l1_words, dur_ms, latency_ms, stars, hint_level, attempts, score, confidence, source, created_at) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [`u${++uid}`, 'k', 'w', lid, 'lesson', 'cafe_order', 'guided', 'teacher', 'can i have a tea', 'Can I have a tea?', 'can i have a tea', 5, 0, 2000, 0, 2, 'none', 1, 1, 1, 'stt', at]);
  lesson('A', T0 - DAY); for (let i = 0; i < 6; i++) utt('A', T0 - DAY + 1000 * (i + 1));
  lesson('B', T0 - DAY + H); for (let i = 0; i < 2; i++) utt('B', T0 - DAY + H + 1000 * (i + 1));
  sql.run("insert into lesson_auto_close values ('A', ?, ?, '{}', null, 'B', 0)", [T0 - DAY + H / 2, T0 - DAY + H / 2]);
  sql.run("insert into lesson_continuations values ('B', 'A', ?)", [T0 - DAY + H]);
  lesson('C', T0); for (let i = 0; i < 8; i++) utt('C', T0 + 1000 * (i + 1));
  const m = mergeLessonParentFacts([buildLessonParentFacts(sql, 'A', T0)!, buildLessonParentFacts(sql, 'B', T0)!])!;
  const c = buildLessonParentFacts(sql, 'C', T0 + H)!;
  console.log(`O4 folded A->B: parent saw yesterday utt=${m.utterances}; today C utt=${c.utterances} previous=${JSON.stringify(c.previous)} lesson_number=${c.lesson_number}`);
});
