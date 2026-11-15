import { createRequire } from 'node:module';
import type { SqliteExecutor } from './storage.js';

interface NodeSqliteModule {
  DatabaseSync: new (filename: string) => {
    exec(sql: string): void;
    prepare(sql: string): {
      run(...params: unknown[]): unknown;
      get(...params: unknown[]): unknown;
      all(...params: unknown[]): unknown[];
    };
    close(): void;
  };
}

export function createNodeSqliteExecutor(filename = ':memory:'): SqliteExecutor {
  const require = createRequire(import.meta.url);
  const { DatabaseSync } = require('node:sqlite') as NodeSqliteModule;
  const db = new DatabaseSync(filename);
  return {
    exec(sql: string): void {
      db.exec(sql);
    },
    run(sql: string, params: unknown[] = []): void {
      db.prepare(sql).run(...params);
    },
    get<T extends Record<string, unknown>>(sql: string, params: unknown[] = []): T | undefined {
      return db.prepare(sql).get(...params) as T | undefined;
    },
    all<T extends Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
      return db.prepare(sql).all(...params) as T[];
    },
    close(): void {
      db.close();
    }
  };
}
