import { createRequire } from 'node:module';
import { afterAll, expect } from 'vitest';
import type { DurableStorageLike } from '../do-sqlite.js';

/**
 * LCW_SQL_RECORD=<dir> (tools/workerd-sql-check.mjs): every fake storage keeps the statements it ran, in order, and
 * each test file writes them to <dir> after its tests, so they can be replayed on workerd's SQLite (its limits are tighter).
 */
type Recorded = { q: string; b: unknown[]; ok: boolean };
const recordDir = process.env.LCW_SQL_RECORD;
const recorded: Array<{ name: string; stmts: Recorded[] }> = [];
if (recordDir) {
  // Vitest runs this module once per test file (isolated): write that file's databases after its tests.
  afterAll(() => {
    if (!recorded.length) return;
    const require = createRequire(import.meta.url);
    const { writeFileSync } = require('node:fs') as typeof import('node:fs');
    writeFileSync(`${recordDir}/${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`, JSON.stringify(recorded));
  });
}
const encodeBinding = (v: unknown): unknown =>
  v instanceof Uint8Array ? { $bytes: Buffer.from(v).toString('base64') } : typeof v === 'bigint' ? Number(v) : v;

/**
 * Fake of the Durable Object SQLite storage: like the real API it refuses BEGIN/COMMIT/ROLLBACK/SAVEPOINT
 * through exec() and offers transactionSync instead — so these tests fail if storage code
 * falls back to SQL transaction statements in production.
 */
export function fakeDurableStorage(): DurableStorageLike & { forbiddenSeen: string[] } {
  const require = createRequire(import.meta.url);
  const { DatabaseSync } = require('node:sqlite') as {
    DatabaseSync: new (f: string) => {
      exec(s: string): void;
      prepare(s: string): { all(...p: unknown[]): Array<Record<string, unknown>> };
    };
  };
  const db = new DatabaseSync(':memory:');
  const forbiddenSeen: string[] = [];
  const log: Recorded[] | null = recordDir ? [] : null;
  if (log) recorded.push({ name: `${process.pid}-${recorded.length}-${expect.getState().currentTestName ?? ''}`.slice(0, 200), stmts: log });
  return {
    forbiddenSeen,
    sql: {
      exec(query: string, ...bindings: unknown[]) {
        if (/^\s*(begin|commit|rollback|savepoint|release)\b/i.test(query)) {
          forbiddenSeen.push(query);
          throw new Error('DO SQLite: use transactionSync()');
        }
        if (query.includes(';') && query.trim().replace(/;\s*$/, '').includes(';')) {
          throw new Error('fake: one statement per exec');
        }
        if (!log) {
          const rows = db.prepare(query).all(...bindings);
          return { toArray: () => rows };
        }
        const entry: Recorded = { q: query, b: bindings.map(encodeBinding), ok: false };
        log.push(entry);
        const rows = db.prepare(query).all(...bindings);
        entry.ok = true;
        return { toArray: () => rows };
      }
    },
    transactionSync<T>(fn: () => T): T {
      db.exec('BEGIN');
      try {
        const out = fn();
        db.exec('COMMIT');
        return out;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    }
  };
}

