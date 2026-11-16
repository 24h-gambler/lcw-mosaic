import {
  BLOCK_PALETTE,
  COLLECTION_BOOKS,
  COLLECTION_BOOK_IDS,
  MINERAL_ALIASES,
  bankItemKey,
  expressionKey,
  findBankOffer,
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
export function listCollection(db: EdgePlatformDb, world: WorldDO | undefined, playerId: string): { books: CollectionBook[] } {
  const thingKeys = new Set<string>();
  for (const r of db.sql.all<{ item_id: string }>('select item_id from memory_cards where player_id = ?', [playerId])) {
    thingKeys.add(itemKeyOfCard(r.item_id));
  }
  const blockKeys = new Set<string>();
  if (world) {
    for (const r of world.sql.all<{ id: string }>('select id from items where owner = ?', [playerId])) thingKeys.add(itemKeyOfCard(r.id));
    const hasPlot = world.sql.get<{ n: number }>("select count(*) as n from sqlite_master where type = 'table' and name = 'plot_cells'");
    if (Number(hasPlot?.n ?? 0) > 0) {
      const byId = new Map(BLOCK_PALETTE.map((b) => [b.id, b.key]));
      for (const r of world.sql.all<{ id: number }>('select distinct id from plot_cells where id > 0')) {
        const key = byId.get(Number(r.id));
        if (key) blockKeys.add(key);
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
  return { books };
}
