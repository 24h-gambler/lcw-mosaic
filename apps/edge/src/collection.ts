import {
  ACHIEVEMENT_REGISTRY,
  BLOCK_PALETTE,
  CAFE_MENU,
  COLLECTION_BOOKS,
  COLLECTION_BOOK_IDS,
  MINERAL_ALIASES,
  bankItemKey,
  expressionKey,
  findBankOffer,
  type AchievementMetric,
  type CollectionBookId
} from '@lcw/content';
import { itemKeyOfCard } from './review.js';
import type { EdgePlatformDb, WorldDO } from './storage.js';

export interface CollectionBook {
  id: CollectionBookId;
  total: number;
  found: number;
  entries: Array<{ key: string; name_ko: string; emoji?: string; found: boolean }>;
}

/**
 * The six collection books (docs/03 D12, G10). What exists comes from content; what the child found comes only from
 * server records: things bought or handed over (world `items`), memory cards, passed sentences (`utterances`) and the
 * block kinds standing on the child's plot (`plot_cells`). Enemies have no server record yet (no combat route), so
 * that book is listed but never found.
 */
export interface AchievementView {
  id: string;
  name_ko: string;
  done: boolean;
  progress: number;
  goal: number;
}

const FOOD_KEYS = new Set(CAFE_MENU.map((d) => d.key));

/** Successful `place` ops this child made on the plot (`plot_journal`, the server's record of every edit). */
function blocksPlaced(world: WorldDO, playerId: string): number {
  let n = 0;
  for (const r of world.sql.all<{ ops: string; results: string }>('select ops, results from plot_journal where actor = ?', [playerId])) {
    const ops = JSON.parse(r.ops) as Array<{ op?: string }>;
    const results = JSON.parse(r.results) as Array<{ ok?: boolean }>;
    ops.forEach((o, i) => {
      if (o?.op === 'place' && results[i]?.ok === true) n++;
    });
  }
  return n;
}

function achievementCounts(db: EdgePlatformDb, world: WorldDO | undefined, playerId: string, hasPlot: boolean): Record<AchievementMetric, number> {
  let orders = 0;
  let food = 0;
  if (world) {
    // One ledger row per purchase (`purchase:<ctx>:<item>:<stars>`); "one more star" refunds carry `:better_stars`.
    for (const r of world.sql.all<{ reason: string }>("select reason from ledger where player = ? and reason like 'purchase:%' and delta <= 0", [playerId])) {
      if (r.reason.endsWith(':better_stars')) continue;
      orders++;
      if (FOOD_KEYS.has(r.reason.split(':')[2] ?? '')) food++;
    }
  }
  const mastered = Number(
    db.sql.get<{ n: number }>('select count(*) as n from memory_cards where player_id = ? and mastered_at is not null', [playerId])?.n ?? 0
  );
  return { orders, food_orders: food, mastered, blocks_placed: world && hasPlot ? blocksPlaced(world, playerId) : 0 };
}

export function listCollection(
  db: EdgePlatformDb,
  world: WorldDO | undefined,
  playerId: string
): { books: CollectionBook[]; achievements: AchievementView[] } {
  const thingKeys = new Set<string>();
  for (const r of db.sql.all<{ item_id: string }>('select item_id from memory_cards where player_id = ?', [playerId])) {
    thingKeys.add(itemKeyOfCard(r.item_id));
  }
  const blockKeys = new Set<string>();
  let plotTables = false;
  if (world) {
    for (const r of world.sql.all<{ id: string }>('select id from items where owner = ?', [playerId])) thingKeys.add(itemKeyOfCard(r.id));
    const hasPlot = world.sql.get<{ n: number }>("select count(*) as n from sqlite_master where type = 'table' and name = 'plot_cells'");
    plotTables = Number(hasPlot?.n ?? 0) > 0;
    if (plotTables) {
      const byId = new Map(BLOCK_PALETTE.map((b) => [b.id, b.key]));
      for (const r of world.sql.all<{ id: number }>('select distinct id from plot_cells where id > 0')) {
        const key = byId.get(Number(r.id));
        if (key) {
          blockKeys.add(key);
          // R2904①: an ore set down somewhere was mined first (an ore is never in a new chest)
          if (key in MINERAL_ALIASES) thingKeys.add(key);
        }
      }
      // R2904①: the ores the child mined and still holds (hand or chest: `b71`… in plot_inv)
      const inv = world.sql.get<{ data: string }>('select data from plot_inv where player = ?', [playerId]);
      if (inv) {
        try {
          const d = JSON.parse(inv.data) as { slots?: Array<{ ref?: string } | null>; chest?: Record<string, number> };
          const refs = [...(d.slots ?? []).map((x) => x?.ref ?? ''), ...Object.entries(d.chest ?? {}).filter(([, n]) => n > 0).map(([r]) => r)];
          for (const ref of refs) {
            const key = /^b\d+$/.test(ref) ? byId.get(Number(ref.slice(1))) : undefined;
            if (key && key in MINERAL_ALIASES) thingKeys.add(key);
          }
        } catch {
          // a broken row is ignored here (plot.ts rebuilds it on the next read)
        }
      }
    }
  }
  const expressionKeys = new Set<string>();
  for (const u of db.sql.all<{ ctx: string; text: string }>(
    'select distinct ctx, target_text as text from utterances where player_id = ? and stars > 0',
    [playerId]
  )) {
    const hit = findBankOffer({ ctx: u.ctx, text: u.text });
    if (!hit) continue;
    const key = bankItemKey(hit.entry);
    expressionKeys.add(expressionKey(u.ctx, key));
    thingKeys.add(key);
  }
  for (const [alias, mineral] of Object.entries(MINERAL_ALIASES)) if (thingKeys.has(alias)) thingKeys.add(mineral);

  const foundIn: Record<CollectionBookId, ReadonlySet<string>> = {
    blocks: blockKeys,
    minerals: thingKeys,
    enemies: new Set(),
    food: thingKeys,
    outfits: thingKeys,
    expressions: expressionKeys
  };
  const books = COLLECTION_BOOK_IDS.map((id): CollectionBook => {
    const entries = COLLECTION_BOOKS[id].map((e) => ({
      key: e.key,
      name_ko: e.nameKo,
      ...(e.emoji ? { emoji: e.emoji } : {}),
      found: foundIn[id].has(e.key)
    }));
    return { id, total: entries.length, found: entries.filter((e) => e.found).length, entries };
  });
  const counts = achievementCounts(db, world, playerId, plotTables);
  const achievements = ACHIEVEMENT_REGISTRY.map((a): AchievementView => {
    const progress = Math.min(a.goal, counts[a.metric]);
    return { id: a.id, name_ko: a.nameKo, done: progress >= a.goal, progress, goal: a.goal };
  });
  return { books, achievements };
}
