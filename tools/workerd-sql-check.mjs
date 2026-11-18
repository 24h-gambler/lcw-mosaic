#!/usr/bin/env node
/**
 * Runs edge tests with SQL recording, then replays every recorded statement on workerd (tools/workerd-sql.mjs).
 * Exit 1 when a statement that worked in the tests fails on Cloudflare's SQLite. Run before deploying the edge.
 *
 *   pnpm test:workerd-sql                       # every edge test (apps/edge/src/__tests__)
 *   pnpm test:workerd-sql apps/edge/src/__tests__/lesson-autoclose.test.ts
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { replaySessions } from './workerd-sql.mjs';

const files = process.argv.slice(2);
const dir = mkdtempSync(join(tmpdir(), 'lcw-sql-'));
const t0 = Date.now();
const test = spawnSync('npx', ['vitest', 'run', ...(files.length ? files : ['apps/edge/src/__tests__']), '--testTimeout=60000'], {
  stdio: ['ignore', 'inherit', 'inherit'],
  env: { ...process.env, LCW_SQL_RECORD: dir, NO_COLOR: '1' },
  shell: process.platform === 'win32'
});
const sessions = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .flatMap((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
const statements = sessions.reduce((n, s) => n + s.stmts.length, 0);
console.log(`workerd-sql: ${sessions.length} test databases, ${statements} statements recorded (tests exit ${test.status})`);
const bad = await replaySessions(sessions);
console.log(`workerd-sql: replayed on workerd in ${Math.round((Date.now() - t0) / 1000)} s`);
if (bad.length) {
  const seen = new Set();
  for (const b of bad) {
    const k = `${b.error}|${b.query}`;
    if (seen.has(k)) continue;
    seen.add(k);
    console.log(`\n✖ ${b.error}\n  ${b.query}\n  (${b.session}, statement ${b.index})`);
  }
  console.log(`\nworkerd-sql: ${bad.length} test databases hit SQL that Cloudflare refuses (${seen.size} distinct).`);
  process.exit(1);
}
console.log('workerd-sql: every statement the tests ran also runs on workerd.');
if (test.status !== 0) process.exit(test.status ?? 1);
