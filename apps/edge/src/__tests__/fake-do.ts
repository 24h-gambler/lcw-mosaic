import { createRequire } from 'node:module';
import type { DurableStorageLike } from '../do-sqlite.js';

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
        const rows = db.prepare(query).all(...bindings);
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

