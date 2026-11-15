import { scoreUtterance } from '@lcw/converse';
import { FURNITURE_SHOP_GOODS, UI_STRINGS_KO, type LangLevel } from '@lcw/content';
import {
  FURNITURE_KINDS,
  ROOM_MISSING_SENTENCES,
  TUNING,
  applyReadAloudDiscount,
  claimReadAloudDiscount,
  readAloudDayKey,
  type FurnitureKind,
  type ReadAloudDiscountState
} from '@lcw/sim-core';
import type { EdgePlatformDb } from './storage.js';

/**
 * Read-aloud furniture discount (docs/03 D13, WP-405): reading the room check's missing-condition sentence aloud gives
 * 10% off that furniture kind, once per kind per day per player (KST day), never stacking. The claim is decided by
 * `claimReadAloudDiscount` over the stored claims; the discount is spent by the server on the next purchase of that
 * kind (/v1/converse/score at the trade shop) — the client never sends a price.
 */

export const READ_ALOUD_SCHEMA = `
create table if not exists read_aloud_claims (player_id text not null, kind text not null, day integer not null, pct real not null, at integer not null, used_ref text, primary key (player_id, kind, day))
`;

export function ensureReadAloudSchema(db: EdgePlatformDb): void {
  db.sql.exec(READ_ALOUD_SCHEMA);
}

export function isFurnitureKind(k: string): k is FurnitureKind {
  return (FURNITURE_KINDS as readonly string[]).includes(k);
}

function claimsState(db: EdgePlatformDb, playerId: string, day: number): ReadAloudDiscountState {
  const out: Record<string, number> = {};
  for (const r of db.sql.all<{ kind: string; day: number }>('select kind, day from read_aloud_claims where player_id = ? and day = ?', [
    playerId,
    day
  ])) {
    out[`${playerId}|${r.kind}`] = Number(r.day);
  }
  return out;
}

export interface ReadAloudInput {
  playerId: string;
  worldId: string;
  kind: FurnitureKind;
  transcript: string;
  sttSource: string;
  confidence: number;
  durMs: number;
  level: LangLevel;
  nowMs: number;
}

export interface ReadAloudResult {
  pass: boolean;
  score: number;
  missed: string[];
  sentence: string;
  kind: FurnitureKind;
  discount_pct: number;
  /** Today's discount for this kind was already given (repeat readings never stack). */
  already_claimed: boolean;
  feedback_ko: string;
}

export function claimReadAloud(db: EdgePlatformDb, input: ReadAloudInput): ReadAloudResult {
  ensureReadAloudSchema(db);
  const sentence = ROOM_MISSING_SENTENCES[input.kind];
  const r = scoreUtterance({ targetText: sentence, spokenTranscript: input.transcript, level: input.level, hintLevel: 'full' });
  // Typed or card-built text is not reading aloud.
  const voiced = input.sttSource !== 'keyboard' && input.sttSource !== 'board';
  const pass = r.pass && voiced;
  const day = readAloudDayKey(input.nowMs);
  let pct = 0;
  let already = false;
  if (pass) {
    const claim = claimReadAloudDiscount(claimsState(db, input.playerId, day), input.playerId, input.kind, input.nowMs);
    pct = claim.discountPct;
    already = pct === 0;
    if (pct > 0) {
      db.sql.run('insert or ignore into read_aloud_claims (player_id, kind, day, pct, at, used_ref) values (?, ?, ?, ?, ?, null)', [
        input.playerId,
        input.kind,
        day,
        pct,
        input.nowMs
      ]);
    }
  }
  db.logUtterance({
    id: `utt-readaloud-${input.playerId}-${input.nowMs}-${crypto.randomUUID().slice(0, 8)}`,
    player_id: input.playerId,
    world_id: input.worldId,
    session_id: `build-${day}`,
    session_kind: 'solo',
    ctx: 'resident',
    mode: 'read',
    interlocutor: 'self',
    first_text: input.transcript,
    target_text: sentence,
    final_text: input.transcript,
    words: input.transcript.trim().split(/\s+/).filter(Boolean).length,
    l1_words: 0,
    dur_ms: input.durMs,
    latency_ms: 0,
    stars: pass ? 1 : 0,
    hint_level: 'full',
    attempts: 1,
    score: r.score,
    confidence: input.confidence,
    source: input.sttSource,
    audio_first: null,
    audio_final: null,
    created_at: input.nowMs
  });
  const R = UI_STRINGS_KO.readAloud;
  const kindKo = R.kind[input.kind] ?? input.kind;
  return {
    pass,
    score: r.score,
    missed: r.missed,
    sentence,
    kind: input.kind,
    discount_pct: pct,
    already_claimed: already,
    feedback_ko: !voiced ? R.voiceOnly : !pass ? R.again : already ? R.already.replace('{kind}', kindKo) : R.got.replace('{kind}', kindKo).replace('{pct}', String(Math.round(pct * 100)))
  };
}

/** Today's read-aloud discounts of a player: kind → {pct, used}. */
export function readAloudStatus(db: EdgePlatformDb, playerId: string, nowMs: number): { day: number; kinds: Record<string, { pct: number; used: boolean }> } {
  ensureReadAloudSchema(db);
  const day = readAloudDayKey(nowMs);
  const kinds: Record<string, { pct: number; used: boolean }> = {};
  for (const r of db.sql.all<{ kind: string; pct: number; used_ref: string | null }>(
    'select kind, pct, used_ref from read_aloud_claims where player_id = ? and day = ?',
    [playerId, day]
  )) {
    kinds[r.kind] = { pct: Number(r.pct), used: r.used_ref !== null };
  }
  return { day, kinds };
}

/**
 * Price of a furniture purchase after today's read-aloud discount for its kind. The discount is bound to the first
 * purchase (`ref`) that uses it; the same purchase priced again ("one more star" in the same window) keeps it.
 */
export function priceWithReadAloud(
  db: EdgePlatformDb,
  params: { playerId: string; itemKey: string; price: number; ref: string; nowMs: number; commit: boolean }
): { price: number; discountPct: number } {
  const kind = FURNITURE_SHOP_GOODS.find((g) => g.key === params.itemKey)?.role;
  if (!kind || params.price <= 0) return { price: params.price, discountPct: 0 };
  ensureReadAloudSchema(db);
  const day = readAloudDayKey(params.nowMs);
  const row = db.sql.get<{ pct: number; used_ref: string | null }>(
    'select pct, used_ref from read_aloud_claims where player_id = ? and kind = ? and day = ?',
    [params.playerId, kind, day]
  );
  if (!row || (row.used_ref !== null && row.used_ref !== params.ref)) return { price: params.price, discountPct: 0 };
  if (params.commit && row.used_ref === null) {
    db.sql.run('update read_aloud_claims set used_ref = ? where player_id = ? and kind = ? and day = ? and used_ref is null', [
      params.ref,
      params.playerId,
      kind,
      day
    ]);
  }
  const pct = Number(row.pct) || TUNING.economy.readAloudDiscountPct;
  return { price: applyReadAloudDiscount(params.price, pct), discountPct: pct };
}
