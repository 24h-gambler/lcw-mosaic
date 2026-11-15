import { scoreUtterance } from '@lcw/converse';
import {
  CAFE_MENU,
  GUIDE_PLACES,
  PHRASE_BANK,
  TRADE_SHOP_GOODS,
  UI_STRINGS_KO,
  bankItemKey,
  findBankOffer,
  type LangLevel
} from '@lcw/content';
import {
  TUNING,
  getHintLevelForBox,
  reviewMemoryCard,
  selectReviewSigns,
  type MemoryCardState
} from '@lcw/sim-core';
import type { HintLevel } from '@lcw/schemas';
import type { EdgePlatformDb, WorldDO } from './storage.js';

/**
 * Memory cards and their reviews (docs/03 D8, docs/09 P4, WP-310 20 min · 1 day, WP-406 review signs).
 *
 * - A sentence passed with 2+ stars becomes a `memory_cards` row bound to what it bought (world `items` row) or, for
 *   price-0 sentences and lesson lines, to the thing it named. The card's sentence is its utterance's target text.
 * - Review signs are computed when the child asks (no cron, docs/09 P4): due cards of gear that is equipped or was
 *   used in the last 7 days, highest `10 + days overdue` first, at most 3 (`selectReviewSigns`). Gear only kept in
 *   the chest gets no sign.
 * - A review is scored on the server against the card's own sentence with the hint and pass line of its box; the
 *   box moves with `reviewMemoryCard`. Mastery pays the master bonus into the player's ledger (the only coin record).
 */

const REVIEW_ID_PREFIX = 'mc-';
const EQUIPPED_LOCATIONS = new Set(['hotbar', 'socket', 'equipped']);

export type MemoryCardRow = {
  id: string;
  player_id: string;
  utterance_id: string;
  item_id: string;
  origin: string;
  box: number;
  next_review_at: number;
  lapses: number;
  mastered_at: number | null;
};

export function memoryCardId(dialogId: string): string {
  return `${REVIEW_ID_PREFIX}${dialogId}`;
}

/** `buy-<dialog>|<item>` / `ask-<dialog>|<key>` / `lesson-<utt>|<key>` → `<item>` */
export function itemKeyOfCard(itemId: string): string {
  const i = itemId.lastIndexOf('|');
  return i >= 0 ? itemId.slice(i + 1) : itemId;
}

const NAME_KO = new Map<string, { nameKo: string; emoji: string }>([
  ...CAFE_MENU.map((d) => [d.key, { nameKo: d.nameKo, emoji: d.emoji }] as const),
  ...TRADE_SHOP_GOODS.map((g) => [g.key, { nameKo: g.nameKo, emoji: g.emoji }] as const),
  ...GUIDE_PLACES.map((g) => [g.key, { nameKo: g.nameKo, emoji: g.emoji }] as const)
]);

export function itemLabelKo(itemKey: string): { nameKo: string; emoji: string } {
  return NAME_KO.get(itemKey) ?? { nameKo: itemKey.replace(/_/g, ' '), emoji: '🧩' };
}

export function recordItemUse(db: EdgePlatformDb, playerId: string, itemId: string, nowMs: number): void {
  db.sql.run(
    `insert into item_uses (player_id, item_id, at) values (?, ?, ?)
     on conflict(player_id, item_id) do update set at = max(item_uses.at, excluded.at)`,
    [playerId, itemId, nowMs]
  );
}

/**
 * Creates the card for a passed sentence (stars >= TUNING.memory.cardMinStars). One card per dialog window: "one
 * more star" in the same window points the card at the better sentence, it does not make a second card.
 */
export function createMemoryCard(
  db: EdgePlatformDb,
  params: {
    cardId: string;
    playerId: string;
    utteranceId: string;
    itemId: string;
    origin: 'solo' | 'lesson';
    stars: number;
    nowMs: number;
    world?: WorldDO;
  }
): { id: string; next_review_at: number } | null {
  if (params.stars < TUNING.memory.cardMinStars) return null;
  const nextReviewAt = params.nowMs + TUNING.memory.intervalsMs[0];
  db.sql.run(
    `insert into memory_cards (id, player_id, utterance_id, item_id, origin, box, next_review_at, lapses, mastered_at)
     values (?, ?, ?, ?, ?, 0, ?, 0, null)
     on conflict(id) do update set utterance_id = excluded.utterance_id, item_id = excluded.item_id`,
    [params.cardId, params.playerId, params.utteranceId, params.itemId, params.origin, nextReviewAt]
  );
  recordItemUse(db, params.playerId, params.itemId, params.nowMs);
  if (params.world && params.itemId.startsWith('buy-')) {
    params.world.sql.run('update items set card_id = ? where id = ? and owner = ?', [
      params.cardId,
      params.itemId,
      params.playerId
    ]);
  }
  const row = db.sql.get<{ next_review_at: number }>('select next_review_at from memory_cards where id = ?', [
    params.cardId
  ]);
  return { id: params.cardId, next_review_at: Number(row?.next_review_at ?? nextReviewAt) };
}

function toState(r: MemoryCardRow): MemoryCardState {
  return {
    id: r.id,
    itemId: r.item_id,
    box: Number(r.box),
    nextReviewAtMs: Number(r.next_review_at),
    lapses: Number(r.lapses),
    masteredAtMs: r.mastered_at === null || r.mastered_at === undefined ? null : Number(r.mastered_at)
  };
}

export function reviewHintForBox(box: number): HintLevel {
  return getHintLevelForBox(box);
}

export function reviewPassLine(box: number): number {
  const t = TUNING.memory.reviewPassThreshold;
  return t[Math.max(0, Math.min(t.length - 1, box))]!;
}

export interface ReviewSign {
  card_id: string;
  item_key: string;
  item_name_ko: string;
  emoji: string;
  ctx: string;
  text: string;
  hint_tags: string[];
  hint: HintLevel;
  /** The sentence's voice may be played (20-minute review only, docs/03 D8). */
  listen: boolean;
  box: number;
  stars: number;
  due_at: number;
  overdue_days: number;
  label_ko: string;
}

type CardSentence = {
  text: string;
  ctx: string;
  stars: number;
  created_at: number;
  session_kind: string;
};

function cardSentence(db: EdgePlatformDb, utteranceId: string): CardSentence | null {
  const u = db.sql.get<CardSentence>(
    'select target_text as text, ctx, stars, created_at, session_kind from utterances where id = ?',
    [utteranceId]
  );
  return u && u.text ? u : null;
}

function hintTagsOf(ctx: string, text: string): string[] {
  return findBankOffer({ ctx, text })?.entry.hintTags.filter((t) => text.toLowerCase().includes(t.toLowerCase())) ?? [];
}

function equippedAndUsed(
  db: EdgePlatformDb,
  world: WorldDO | undefined,
  playerId: string
): { equipped: Set<string>; lastUsed: Record<string, number> } {
  const equipped = new Set<string>();
  if (world) {
    const rows = world.sql.all<{ id: string; location: string }>(
      'select id, location from items where owner = ? and card_id is not null',
      [playerId]
    );
    for (const r of rows) if (EQUIPPED_LOCATIONS.has(r.location) || r.location.startsWith('slot')) equipped.add(r.id);
  }
  const lastUsed: Record<string, number> = {};
  for (const u of db.sql.all<{ item_id: string; at: number }>('select item_id, at from item_uses where player_id = ?', [
    playerId
  ])) {
    lastUsed[u.item_id] = Number(u.at);
  }
  return { equipped, lastUsed };
}

export function listMemoryCards(db: EdgePlatformDb, playerId: string): MemoryCardRow[] {
  return db.sql.all<MemoryCardRow>('select * from memory_cards where player_id = ? order by next_review_at asc', [
    playerId
  ]);
}

/** docs/09 P4: what to show now. `next_due_at` lets the client wake up for the 20-minute review of this session. */
export function listReviewSigns(
  db: EdgePlatformDb,
  world: WorldDO | undefined,
  playerId: string,
  nowMs: number
): { signs: ReviewSign[]; next_due_at: number | null; cards_total: number; mastered: number } {
  const rows = listMemoryCards(db, playerId);
  const { equipped, lastUsed } = equippedAndUsed(db, world, playerId);
  const picked = selectReviewSigns(rows.map(toState), equipped, lastUsed, nowMs);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const R = UI_STRINGS_KO.review;
  const signs: ReviewSign[] = [];
  for (const card of picked) {
    const row = byId.get(card.id)!;
    const s = cardSentence(db, row.utterance_id);
    if (!s) continue;
    const key = itemKeyOfCard(row.item_id);
    const label = itemLabelKo(key);
    signs.push({
      card_id: card.id,
      item_key: key,
      item_name_ko: label.nameKo,
      emoji: label.emoji,
      ctx: s.ctx,
      text: s.text,
      hint_tags: hintTagsOf(s.ctx, s.text),
      hint: reviewHintForBox(card.box),
      listen: card.box <= TUNING.memory.reviewListenMaxBox,
      box: card.box,
      stars: Number(s.stars),
      due_at: card.nextReviewAtMs,
      overdue_days: Math.max(0, Math.floor((nowMs - card.nextReviewAtMs) / 86_400_000)),
      label_ko: R.signLine.replace('{item}', label.nameKo)
    });
  }
  const pending = rows.filter((r) => r.mastered_at === null).map((r) => Number(r.next_review_at));
  const future = pending.filter((t) => t > nowMs);
  return {
    signs,
    next_due_at: future.length > 0 ? Math.min(...future) : null,
    cards_total: rows.length,
    mastered: rows.length - pending.length
  };
}

/** Bank sentences that name the same thing as the card (any level, any star): "same meaning, other words". */
function sameMeaningSentences(ctx: string, text: string): string[] {
  const hit = findBankOffer({ ctx, text });
  if (!hit) return [];
  const key = bankItemKey(hit.entry);
  const out: string[] = [];
  for (const e of PHRASE_BANK) {
    if (e.ctx !== ctx || bankItemKey(e) !== key) continue;
    for (const o of e.offers) if (o.text !== text) out.push(o.text);
  }
  return out;
}

const SAME_MEANING_BOX = 4;

export interface ReviewAttemptInput {
  playerId: string;
  worldId: string;
  cardId: string;
  transcript: string;
  sttSource: string;
  confidence: number;
  durMs: number;
  latencyMs: number;
  level: LangLevel;
  nowMs: number;
}

export type ReviewAttemptResult =
  | { ok: false; status: 404 | 409; error: 'card_not_found' | 'not_due' | 'already_mastered' }
  | {
      ok: true;
      pass: boolean;
      score: number;
      threshold: number;
      missed: string[];
      box: number;
      next_review_at: number | null;
      mastered: boolean;
      bonus_coins: number;
      coins_total?: number;
      stars: number;
      feedback_ko: string;
      matched_text?: string;
    };

const WHEN_KO = ['20분 뒤', '내일', '3일 뒤', '7일 뒤', '16일 뒤', '35일 뒤'] as const;

export function attemptReview(
  db: EdgePlatformDb,
  world: WorldDO | undefined,
  input: ReviewAttemptInput
): ReviewAttemptResult {
  const row = db.sql.get<MemoryCardRow>('select * from memory_cards where id = ? and player_id = ?', [
    input.cardId,
    input.playerId
  ]);
  if (!row) return { ok: false, status: 404, error: 'card_not_found' };
  if (row.mastered_at !== null && row.mastered_at !== undefined) {
    return { ok: false, status: 409, error: 'already_mastered' };
  }
  // A card cannot be pushed up the boxes by saying it again before it is due.
  if (Number(row.next_review_at) > input.nowMs) return { ok: false, status: 409, error: 'not_due' };
  const s = cardSentence(db, row.utterance_id);
  if (!s) return { ok: false, status: 404, error: 'card_not_found' };

  const box = Number(row.box);
  const hint = reviewHintForBox(box);
  const threshold = reviewPassLine(box);
  const tags = hintTagsOf(s.ctx, s.text);
  const scoreAgainst = (text: string) =>
    scoreUtterance({ targetText: text, spokenTranscript: input.transcript, level: input.level, hintLevel: hint, hintTags: tags });
  let best = scoreAgainst(s.text);
  let matched: string | undefined;
  if (box >= SAME_MEANING_BOX && best.score < threshold) {
    for (const alt of sameMeaningSentences(s.ctx, s.text)) {
      const r = scoreAgainst(alt);
      if (r.score > best.score) {
        best = r;
        matched = alt;
      }
    }
  }
  const pass = best.score >= threshold;
  const next = reviewMemoryCard(toState(row), pass, input.nowMs);
  const mastered = next.masteredAtMs !== null;
  db.sql.run('update memory_cards set box = ?, next_review_at = ?, lapses = ?, mastered_at = ? where id = ?', [
    next.box,
    mastered ? Number.MAX_SAFE_INTEGER : next.nextReviewAtMs,
    next.lapses,
    next.masteredAtMs,
    row.id
  ]);

  // Master bonus is paid once per card, into the ledger of the player's world (the single coin record).
  let bonus = 0;
  if (mastered && world) {
    const ref = `master:${row.id}`;
    if (!world.sql.get('select 1 as x from ledger where player = ? and ref = ?', [input.playerId, ref])) {
      bonus = TUNING.memory.masterBonusCoins;
      world.appendLedger(input.playerId, bonus, 'memory_master', ref, input.nowMs);
    }
  }

  const words = input.transcript.trim().split(/\s+/).filter(Boolean).length;
  db.logUtterance({
    id: `utt-review-${row.id}-${input.nowMs}-${crypto.randomUUID().slice(0, 8)}`,
    player_id: input.playerId,
    world_id: input.worldId,
    session_id: `review-${row.id}`,
    session_kind: 'solo',
    ctx: s.ctx,
    // docs/04 4.9: from the 3-day review on the hint is reduced, so the line is a recall.
    mode: box >= 2 ? 'recall' : 'read',
    interlocutor: 'npc',
    first_text: input.transcript,
    target_text: matched ?? s.text,
    final_text: input.transcript,
    words,
    l1_words: 0,
    dur_ms: input.durMs,
    latency_ms: input.latencyMs,
    stars: pass ? Number(s.stars) : 0,
    hint_level: hint,
    attempts: 1,
    score: best.score,
    confidence: input.confidence,
    source: input.sttSource,
    audio_first: null,
    audio_final: null,
    created_at: input.nowMs
  });
  if (pass) {
    recordItemUse(db, input.playerId, row.item_id, input.nowMs);
    db.recordSoloExpressionReuse(input.playerId, input.transcript, input.nowMs);
  }

  const R = UI_STRINGS_KO.review;
  const feedback = !pass
    ? R.again
    : mastered
      ? R.mastered.replace('{n}', String(bonus))
      : R.fixed.replace('{when}', WHEN_KO[Math.min(WHEN_KO.length - 1, next.box)]!);
  return {
    ok: true,
    pass,
    score: best.score,
    threshold,
    missed: best.missed,
    box: next.box,
    next_review_at: mastered ? null : next.nextReviewAtMs,
    mastered,
    bonus_coins: bonus,
    coins_total: world ? world.getPlayerBalance(input.playerId) : undefined,
    stars: pass ? Number(s.stars) : 0,
    feedback_ko: feedback,
    matched_text: matched
  };
}
