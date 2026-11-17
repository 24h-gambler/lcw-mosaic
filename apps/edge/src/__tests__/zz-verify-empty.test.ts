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


describe('v', () => {
  it('empty first lesson', () => {
    const sql = createNodeSqliteExecutor();
    sql.exec(D1_SCHEMA_SQL);
    const T0 = Date.parse('2026-11-10T05:00:00Z');
    const DAY = 86_400_000;
    sql.run("insert into players (id, family_id, kind, nickname, level, birth_year) values ('k','f','human','지우','L1',2016)", []);
    sql.run('insert into lessons (id, player_id, world_id, started_at, ended_at, plan) values (?,?,?,?,?,?)', ['E','k','w',T0-DAY,T0-DAY+3600000,'first_lesson_v1']);
    sql.run('insert into lessons (id, player_id, world_id, started_at, ended_at, plan) values (?,?,?,?,?,?)', ['N','k','w',T0,T0+3600000,'first_lesson_v1']);
    sql.run(`insert into utterances (id, player_id, world_id, session_id, session_kind, ctx, mode, interlocutor, first_text, target_text, final_text, words, l1_words, dur_ms, latency_ms, stars, hint_level, attempts, score, confidence, source, created_at) values ('u1','k','w','N','lesson','cafe_order','guided','teacher','x','','can i have tea',4,0,2000,0,2,'none',1,1,1,'stt',?)`, [T0+1000]);
    const f = buildLessonParentFacts(sql, 'N', T0 + 3600000)!;
    console.log('VERIFY-EMPTYFIRST number=' + f.lesson_number + ' previous=' + JSON.stringify(f.previous));
  });
});
