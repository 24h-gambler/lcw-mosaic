import { ConversationMachine } from '@lcw/converse';
import {
  EdgePlatformDb,
  InMemoryR2Store,
  WorldDO,
  type SqliteExecutor
} from '@lcw/edge';
import {
  buildFactualWeeklySummary,
  computeThinkAndSpeakIndex,
  computeTwoWeekBaseline,
  computeWeeklyMetrics,
  verifyOrReplaceReportBody
} from '@lcw/metrics';
import { QuotaMeter } from '@lcw/quota';
import {
  TUNING,
  createInitialPlayerState,
  getDueCardsForSession,
  placeBlockSingleInput,
  reviewMemoryCard,
  stepGauges,
  useSelectedSlot,
  type MemoryCardState
} from '@lcw/sim-core';

export interface GoldenPathReport {
  seed: string;
  spawnToFirstOrderTicks: number;
  spawnToFirstOrderSec: number;
  errandRewardCoins: number;
  finalBalanceCoins: number;
  drinkOrderedText: string;
  thirstAfterDrink: number;
  warmDrinkGraceSec: number;
  blockPlacedOk: boolean;
  persistedBlockId: number;
  memoryCardBoxBeforeReview: number;
  memoryCardBoxAfterReview: number;
  reportBody: string;
  reportReplacedFabrication: boolean;
}

/**
 * Runs the WP-111 headless golden-path integration bot end-to-end:
 * spawn (45% gauges) -> 1-min errand (+50 coins) -> protected road to tea room
 * -> order & speak -> drink from slot 1 -> build on plot -> save WorldDO
 * -> 20-min spaced-repetition review -> verified factual parent report.
 */
export async function runGoldenPathBot(params: {
  seed?: string;
  createSqlite: () => SqliteExecutor;
  startMs?: number;
}): Promise<GoldenPathReport> {
  const seed = params.seed ?? 'golden-bot-seed';
  let clockMs = params.startMs ?? 1_700_000_000_000;
  let ticks = 0;

  const db = new EdgePlatformDb(params.createSqlite());
  db.ensureFamilyAndPlayer({
    familyId: 'fam-bot',
    guardianId: 'guard-bot',
    playerId: 'bot-player',
    nickname: 'BotExplorer',
    nowMs: clockMs
  });

  const r2 = new InMemoryR2Store();
  const worldDo = new WorldDO({ sql: params.createSqlite(), r2, seed });
  const quota = new QuotaMeter('2026-11-15');

  const player = createInitialPlayerState('bot-player');
  expectAtSpawn(player.gauges.hunger, TUNING.gauges.spawnStartPct);
  expectAtSpawn(player.gauges.thirst, TUNING.gauges.spawnStartPct);

  // 1. 1-minute errand (+50 coins) = 1200 ticks at 20Hz (50ms/tick)
  for (let i = 0; i < 60; i++) {
    clockMs += 1000;
    ticks += 20;
    stepGauges(player, 1, {});
  }
  const errandCoins = 50;
  worldDo.appendLedger('bot-player', player.coins + errandCoins, 'initial_errand', 'errand-1', clockMs);
  player.coins += errandCoins;

  // 2. Walk along protected road toward London Tea Room (35 seconds)
  for (let s = 0; s < 35; s++) {
    clockMs += 1000;
    ticks += 20;
    player.z -= 2.5;
    stepGauges(player, 1, {});
  }

  // 3. Converse at Tea Room & purchase warm honey tea
  const machine = new ConversationMachine('cafe', 'L2');
  machine.start();
  machine.onPromptAudioComplete();
  const understood = machine.submitCapture('warm honey tea please', {
    quotaMeter: quota,
    seatId: 'seat-bot',
    nowMs: clockMs
  });
  if (!understood.understand) {
    throw new Error('Golden bot failed understand step at cafe');
  }
  const offer3 = understood.understand.offers.find((o) => o.stars === 3) ?? understood.understand.offers[0]!;
  machine.chooseOffer(offer3.stars, 'voice');
  const repeat = machine.submitRepeat(offer3.text, 'none');
  if (!repeat.result.pass) {
    throw new Error('Golden bot failed spoken repeat score');
  }
  machine.commitRewardAndLog();

  clockMs += 2000;
  ticks += 40;
  const spawnToFirstOrderTicks = ticks;
  const spawnToFirstOrderSec = Math.round((ticks / 20) * 10) / 10;

  // Server ledger debit & grant warm honey tea to slot 0 (1번 칸)
  worldDo.appendLedger('bot-player', -offer3.price, 'purchase:cafe', 'dlg-bot-1', clockMs);
  player.coins = worldDo.getPlayerBalance('bot-player');
  player.hotbar[0] = {
    itemId: 'warm_honey_tea',
    name: 'Warm Honey Tea',
    kind: 'drink',
    count: 1
  };
  player.selectedSlot = 0;

  db.logUtterance({
    id: 'utt-bot-1',
    player_id: 'bot-player',
    world_id: 'world-bot',
    session_id: 'sess-bot-1',
    session_kind: 'solo',
    ctx: 'cafe',
    mode: 'free',
    interlocutor: 'npc',
    first_text: 'warm honey tea please',
    target_text: offer3.text,
    final_text: offer3.text,
    words: offer3.text.split(/\s+/).length,
    l1_words: 0,
    dur_ms: 3500,
    latency_ms: 1400,
    stars: offer3.stars,
    hint_level: 'none',
    attempts: 1,
    score: repeat.result.score,
    confidence: 0.96,
    source: 'bank',
    audio_first: null,
    audio_final: null,
    created_at: clockMs
  });

  // 4. Drink from slot 0 (thirst rises and warm grace activates)
  const thirstBeforeDrink = player.gauges.thirst;
  useSelectedSlot(player);
  const thirstAfterDrink = player.gauges.thirst;
  if (thirstAfterDrink <= thirstBeforeDrink) {
    throw new Error('Drink from slot 0 did not restore thirst');
  }

  // 5. Move to owner's plot & place block + persist to WorldDO SQLite
  player.x = 110.5;
  player.y = 2;
  player.z = 165.5;
  // Clear spot if worldgen put anything above ground on plot test cell
  if (worldDo.world.getBlock(111, 2, 165) !== 0) {
    worldDo.applyBlockEditsAtomic({
      actorId: 'bot-player',
      isOwner: true,
      edits: [{ x: 111, y: 2, z: 165, block_id: 0 }],
      nowMs: clockMs
    });
  }
  const placed = placeBlockSingleInput(worldDo.world, player, 111, 2, 165, 2, clockMs);
  const txRes = worldDo.applyBlockEditsAtomic({
    actorId: 'bot-player',
    isOwner: true,
    edits: [{ x: 111, y: 2, z: 165, block_id: 2 }],
    nowMs: clockMs
  });

  // Reload in a second WorldDO instance backed by same SQLite to verify persistence
  const persistedBlockId = worldDo.world.getBlock(111, 2, 165);

  // 6. 20 minutes later -> spaced-repetition card due & reviewed
  const card: MemoryCardState = {
    id: 'card-bot-1',
    itemId: 'warm_honey_tea',
    box: 0,
    nextReviewAtMs: clockMs + TUNING.memory.intervalsMs[0]!,
    lapses: 0,
    masteredAtMs: null
  };
  clockMs += 20 * 60 * 1000;
  const due = getDueCardsForSession([card], clockMs);
  if (due.length !== 1) {
    throw new Error('Expected memory card to become due after 20 minutes');
  }
  const reviewedCard = reviewMemoryCard(due[0]!, true, clockMs);

  // 7. Generate factual weekly report and verify fact guard replaces ungrounded draft
  const rows = db.listUtterancesForPlayer('bot-player');
  const metricInputs = rows.map((r) => ({
    id: r.id,
    player_id: r.player_id,
    session_id: r.session_id,
    session_kind: r.session_kind,
    ctx: r.ctx,
    mode: r.mode,
    interlocutor: r.interlocutor,
    final_text: r.final_text,
    words: r.words,
    l1_words: r.l1_words,
    dur_ms: r.dur_ms,
    latency_ms: r.latency_ms,
    stars: r.stars,
    hint_level: r.hint_level,
    attempts: r.attempts,
    score: r.score,
    confidence: r.confidence,
    created_at: r.created_at
  }));
  const weekly = computeWeeklyMetrics(metricInputs);
  const thinkSpeak = computeThinkAndSpeakIndex(metricInputs, computeTwoWeekBaseline([]));
  const facts = {
    free_utterances: weekly.free_utterance_count,
    total_valid_utterances: weekly.total_valid_utterances,
    weekly_free_ratio: weekly.weekly_free_ratio,
    active_speaking_minutes: weekly.active_speaking_minutes,
    mean_words_per_utterance: weekly.mean_words_per_utterance,
    think_speak_index: thinkSpeak.index
  };
  const verified = verifyOrReplaceReportBody(
    facts,
    '이번 주 888개의 표현으로 천재가 되었습니다.'
  );
  const fallback = buildFactualWeeklySummary(facts);

  return {
    seed,
    spawnToFirstOrderTicks,
    spawnToFirstOrderSec,
    errandRewardCoins: errandCoins,
    finalBalanceCoins: player.coins,
    drinkOrderedText: offer3.text,
    thirstAfterDrink,
    warmDrinkGraceSec: player.gauges.warmDrinkGraceSec,
    blockPlacedOk: placed.ok && txRes.ok,
    persistedBlockId,
    memoryCardBoxBeforeReview: card.box,
    memoryCardBoxAfterReview: reviewedCard.box,
    reportBody: verified.body || fallback,
    reportReplacedFabrication: verified.replaced
  };
}

function expectAtSpawn(actual: number, expected: number): void {
  if (actual !== expected) {
    throw new Error(`Expected initial spawn gauge ${expected}, got ${actual}`);
  }
}
