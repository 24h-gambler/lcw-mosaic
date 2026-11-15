import type { ObjectStore, SqliteExecutor } from './storage.js';

/**
 * Minimal shape of the Durable Object SQLite storage API we rely on.
 * Declared locally so the edge package does not need @cloudflare/workers-types.
 */
export interface DurableSqlCursor {
  toArray(): Array<Record<string, unknown>>;
}
export interface DurableSqlStorage {
  exec(query: string, ...bindings: unknown[]): DurableSqlCursor;
}
export interface DurableStorageLike {
  sql: DurableSqlStorage;
  transactionSync<T>(fn: () => T): T;
}

/** Splits a schema script into single statements (schema text has no semicolons inside literals). */
export function splitStatements(script: string): string[] {
  const withoutComments = script
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  return withoutComments
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * SqliteExecutor backed by Durable Object SQLite. The DO SQL API is synchronous, which matches
 * the synchronous EdgePlatformDb/WorldDO code, so the same storage logic runs in tests (node:sqlite)
 * and in production unchanged.
 */
export function createDurableSqliteExecutor(storage: DurableStorageLike): SqliteExecutor {
  const sql = storage.sql;
  return {
    exec(script: string): void {
      for (const stmt of splitStatements(script)) sql.exec(stmt);
    },
    run(query: string, params: unknown[] = []): void {
      sql.exec(query, ...params);
    },
    get<T extends Record<string, unknown>>(query: string, params: unknown[] = []): T | undefined {
      return sql.exec(query, ...params).toArray()[0] as T | undefined;
    },
    all<T extends Record<string, unknown>>(query: string, params: unknown[] = []): T[] {
      return sql.exec(query, ...params).toArray() as T[];
    },
    transaction<T>(fn: () => T): T {
      return storage.transactionSync(fn);
    }
  };
}

/** Tables owned by WorldDO (WORLD_DO_SCHEMA_SQL). */
export const WORLD_TABLES = ['meta', 'chunks', 'objects', 'items', 'ledger', 'journal', 'snapshots'] as const;

/**
 * Lets several worlds share one SQLite database by giving each world its own table names
 * (w_<id>_chunks …). Production runs every world inside one platform Durable Object until
 * traffic needs one DO per world (docs/02 §6); this keeps the WorldDO code unchanged.
 */
export function prefixedExecutor(base: SqliteExecutor, prefix: string): SqliteExecutor {
  if (!/^[a-z0-9_]{1,48}$/.test(prefix)) throw new Error('invalid_world_prefix');
  const re = new RegExp(`\\b(${WORLD_TABLES.join('|')})\\b`, 'g');
  const rw = (q: string): string => q.replace(re, `${prefix}_$1`);
  return {
    exec: (q) => base.exec(rw(q)),
    run: (q, p) => base.run(rw(q), p),
    get: (q, p) => base.get(rw(q), p),
    all: (q, p) => base.all(rw(q), p),
    transaction: base.transaction ? <T,>(fn: () => T): T => base.transaction!(fn) : undefined
  };
}

/** World id → safe table prefix. */
export function worldPrefix(worldId: string): string {
  const slug = worldId.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 40);
  return `w_${slug}`;
}

/**
 * ObjectStore kept in the same SQLite database (R2 needs a payment method on the account;
 * snapshots are small JSON). Swap for the R2 binding when R2 is enabled.
 */
export class SqliteBlobStore implements ObjectStore {
  constructor(private readonly sql: SqliteExecutor) {
    sql.exec('create table if not exists blobs (k text primary key, v text not null)');
  }
  put(key: string, value: string | Uint8Array): void {
    const v = typeof value === 'string' ? value : new TextDecoder().decode(value);
    this.sql.run('insert or replace into blobs (k, v) values (?, ?)', [key, v]);
  }
  get(key: string): string | null {
    return this.sql.get<{ v: string }>('select v from blobs where k = ?', [key])?.v ?? null;
  }
  delete(key: string): void {
    this.sql.run('delete from blobs where k = ?', [key]);
  }
}
