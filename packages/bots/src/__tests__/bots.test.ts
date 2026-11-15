import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import type { SqliteExecutor } from '@lcw/edge';
import { runGoldenPathBot } from '../index.js';

function createTestSqlite(): SqliteExecutor {
  const req = createRequire(import.meta.url);
  const { DatabaseSync } = req('node:sqlite') as {
    DatabaseSync: new (path: string) => {
      exec(sql: string): void;
      prepare(sql: string): {
        run(...p: unknown[]): unknown;
        get(...p: unknown[]): unknown;
        all(...p: unknown[]): unknown[];
      };
    };
  };
  const db = new DatabaseSync(':memory:');
  return {
    exec: (sql) => db.exec(sql),
    run: (sql, params = []) => {
      db.prepare(sql).run(...params);
    },
    get: <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) =>
      db.prepare(sql).get(...params) as T | undefined,
    all: <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) =>
      db.prepare(sql).all(...params) as T[]
  };
}

describe('packages/bots (WP-111 Golden Path)', () => {
  it('completes full golden path end-to-end with spawn-to-order < 3 minutes (3600 ticks)', async () => {
    const report = await runGoldenPathBot({
      seed: 'wp-111-golden',
      createSqlite: createTestSqlite
    });

    expect(report.spawnToFirstOrderTicks).toBeLessThan(3600);
    expect(report.spawnToFirstOrderSec).toBeLessThan(180);
    expect(report.errandRewardCoins).toBe(50);
    expect(report.thirstAfterDrink).toBeGreaterThan(45);
    expect(report.warmDrinkGraceSec).toBe(300);
    expect(report.blockPlacedOk).toBe(true);
    expect(report.persistedBlockId).toBe(2);
    expect(report.memoryCardBoxBeforeReview).toBe(0);
    expect(report.memoryCardBoxAfterReview).toBe(1);
    expect(report.reportReplacedFabrication).toBe(true);
    expect(report.reportBody).toContain('1건');
  });
});
