/**
 * The things side of a lesson trade with the teacher (Dan 11-19 R325, docs/18 §11): the child's home world keeps the
 * child's things (items table, the same rows the bag, the chest and the hotbar read), so a trade moves rows there in
 * one transaction. The teacher's stock is content (TEACHER_STOCK): it never runs out and is never stored; what the
 * child hands over goes to the lesson's teacher (owner `lesson-teacher:<lesson id>`, location 'given'), so it leaves the
 * bag and stays on record (journal `lesson.trade`, with its inverse).
 *
 * The sentence, the score and the duplicate guard live in lesson-mode.ts (POST /v1/lesson/trade); this file only moves
 * things the server already decided to move.
 */
import { teacherStockItem } from '@lcw/content';
import { itemKeyOfCard, landingPlace } from './review.js';
import { runInTransaction, type WorldDO } from './storage.js';

export interface TradeOwned {
  item_id: string;
  item_key: string;
  location: string;
}

export type TradeApply =
  | { ok: true; got_item_id: string | null; got_location: 'bag' | 'chest' | null; gave_key: string | null }
  | { ok: false; reason: 'item_not_owned' | 'unknown_stock' | 'nothing_to_trade' };

/** The child's things that can be handed over: carried or stored, not worn and not already given. */
export function ownedForTrade(world: WorldDO | undefined, playerId: string): TradeOwned[] {
  if (!world) return [];
  return world.sql
    .all<{ id: string; location: string }>(
      // a memory card's item stays with its card (review.ts): never handed over (R326 review)
      "select id, location from items where owner = ? and location in ('bag', 'hotbar', 'chest') and card_id is null order by rowid asc",
      [playerId]
    )
    .map((r) => ({ item_id: r.id, item_key: itemKeyOfCard(r.id), location: r.location }));
}

export function teacherOwnerOf(lessonId: string): string {
  return `lesson-teacher:${lessonId}`;
}

/**
 * One trade: the child's thing (if any) goes to the teacher, the teacher's thing (if any) lands in the bag, or the
 * chest when the bag is full (docs/03 D13). The new row's id is `trade-<trade id>|<key>` (itemKeyOfCard reads the key),
 * so the same trade id applied twice grants one thing (insert or ignore), never two.
 */
export function applyLessonTrade(
  world: WorldDO | undefined,
  p: { playerId: string; lessonId: string; tradeId: string; giveItemId: string | null; getKey: string | null; nowMs: number }
): TradeApply {
  if (!world) return { ok: false, reason: 'item_not_owned' };
  if (!p.giveItemId && !p.getKey) return { ok: false, reason: 'nothing_to_trade' };
  const stock = p.getKey ? teacherStockItem(p.getKey) : null;
  if (p.getKey && !stock) return { ok: false, reason: 'unknown_stock' };
  let gaveKey: string | null = null;
  if (p.giveItemId) {
    const own = ownedForTrade(world, p.playerId).find((r) => r.item_id === p.giveItemId);
    if (!own) return { ok: false, reason: 'item_not_owned' };
    gaveKey = own.item_key;
  }
  const gotId = stock ? `trade-${p.tradeId}|${stock.key}` : null;
  let place: 'bag' | 'chest' | null = null;
  runInTransaction(world.sql, () => {
    if (p.giveItemId) {
      world.sql.run("update items set owner = ?, location = 'given' where id = ? and owner = ?", [teacherOwnerOf(p.lessonId), p.giveItemId, p.playerId]);
    }
    if (gotId && stock) {
      place = landingPlace(world, p.playerId, gotId) === 'chest' ? 'chest' : 'bag';
      world.sql.run(
        `insert or ignore into items (id, owner, spec, location, durability, card_id) values (?, ?, ?, ?, 100, null)`,
        [gotId, p.playerId, JSON.stringify({ kind: 'lesson_trade', item: stock.key, lesson: p.lessonId }), place]
      );
    }
    world.sql.run('insert into journal (at, actor, op, payload, inverse) values (?, ?, ?, ?, ?)', [
      p.nowMs,
      p.playerId,
      'lesson.trade',
      JSON.stringify({ tradeId: p.tradeId, lessonId: p.lessonId, gave: p.giveItemId, got: gotId }),
      JSON.stringify({ giveBack: p.giveItemId, takeBack: gotId })
    ]);
  });
  return { ok: true, got_item_id: gotId, got_location: place, gave_key: gaveKey };
}
