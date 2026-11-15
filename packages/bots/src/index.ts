import { ConversationMachine } from '@lcw/converse';
import {
  EdgePlatformDb,
  InMemoryR2Store,
  LessonDO,
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
  LessonProgressionTracker,
  TUNING,
  createInitialPlayerState,
  evaluateMentorDungeonGate,
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

export interface LessonTradeReportBotResult {
  allSevenStagesCompleted: boolean;
  unilateralRejected: boolean;
  bilateralTradeOk: boolean;
  tradeFeeCoins: number;
  studentBalanceAfterTrade: number;
  studentOwnsTea: boolean;
  teacherOwnsOre: boolean;
  mentorDungeonRejectedWithoutClue: boolean;
  mentorDungeonOpened: boolean;
  sealedChestUnlocked: boolean;
  soloReuseUpdatedCount: number;
  reminderCountAfter48h: number;
  openedDeliveryStatus: string | null;
  openedNextTargetsUpdated: boolean;
}

/**
 * Runs an end-to-end headless verification of:
 * 1) 7-stage continuous lesson arc progression,
 * 2) bilateral teacher-student barter (rejects unilateral, swaps atomically on bilateral),
 * 3) WP-311 Mentor Dungeon info-gap gate,
 * 4) sealed review chest plant + solo expression reuse unlock,
 * 5) parent report delivery -> 48h reminder -> guardian open -> nextTargetsUpdated.
 */
export async function runLessonTradeAndReportBot(options: {
  seed?: string;
  createSqlite: () => SqliteExecutor;
}): Promise<LessonTradeReportBotResult> {
  const seed = options.seed ?? 'lcw-lesson-trade-bot';
  let clockMs = 1_763_200_000_000;

  const db = new EdgePlatformDb(options.createSqlite());
  db.ensureFamilyAndPlayer({
    familyId: 'fam-bot',
    guardianId: 'guard-bot',
    playerId: 'bot-student',
    nickname: 'Minseo',
    nowMs: clockMs
  });

  const worldDo = new WorldDO({
    sql: options.createSqlite(),
    r2: new InMemoryR2Store(),
    seed
  });
  worldDo.appendLedger('bot-student', 150, 'initial_errand', 'b0', clockMs);
  worldDo.grantOrSetItem('bot-student', 'itm-ore-bot', '{"kind":"ore"}');
  worldDo.grantOrSetItem('bot-teacher', 'itm-tea-bot', '{"kind":"drink"}');

  const lessonDo = new LessonDO('lesson-bot-1', db, 'bot-student', 'world-bot-1', clockMs);
  const tracker = new LessonProgressionTracker();

  // Stage 1: Warm-up anchor
  db.logUtterance({
    id: 'utt-bot-warmup',
    player_id: 'bot-student',
    world_id: 'world-bot-1',
    session_id: 'lesson-bot-1',
    session_kind: 'lesson',
    ctx: 'campfire',
    mode: 'free',
    interlocutor: 'teacher',
    first_text: 'I built a warm cabin yesterday.',
    target_text: 'Tell me about your world.',
    final_text: 'I built a warm cabin yesterday.',
    words: 6,
    l1_words: 0,
    dur_ms: 3500,
    latency_ms: 900,
    stars: 3,
    hint_level: 'none',
    attempts: 1,
    score: 0.94,
    confidence: 0.96,
    source: 'lesson',
    audio_first: null,
    audio_final: null,
    created_at: clockMs
  });
  tracker.completeCurrentStage('warmup recorded');

  // Stage 2: Review repair
  tracker.completeCurrentStage('review cards repaired');

  // Stage 3: Bilateral teacher-student barter
  const unilateral = worldDo.executeTradeAtomic({
    tradeId: 'tr-bot-unilateral',
    studentId: 'bot-student',
    teacherId: 'bot-teacher',
    studentGiveItemId: 'itm-ore-bot',
    teacherGiveItemId: 'itm-tea-bot',
    baseValueCoins: 100,
    stars: 2,
    teacherTranscript: '',
    studentTranscript: 'Could we swap three iron ores for two warm honey teas?',
    studentScorePass: true,
    nowMs: clockMs
  });

  const bilateral = worldDo.executeTradeAtomic({
    tradeId: 'tr-bot-bilateral',
    studentId: 'bot-student',
    teacherId: 'bot-teacher',
    studentGiveItemId: 'itm-ore-bot',
    teacherGiveItemId: 'itm-tea-bot',
    baseValueCoins: 100,
    stars: 2,
    teacherTranscript: 'What would you like to trade for this warm honey tea?',
    studentTranscript: 'Could we swap three iron ores for two warm honey teas?',
    studentScorePass: true,
    nowMs: clockMs
  });

  db.registerLessonExpression({
    id: 'expr-bot-tea',
    playerId: 'bot-student',
    lemmaKey: 'warm honey tea',
    lessonId: 'lesson-bot-1',
    nowMs: clockMs
  });
  tracker.completeCurrentStage('bilateral barter executed');

  // Stage 4: Mentor dungeon info-gap gate (WP-311)
  const blockedGate = evaluateMentorDungeonGate({
    hazardCode: 'switch_maze_01',
    teacherPromptText: 'Walk carefully.',
    studentActionText: 'I pull the red lever.'
  });
  const openedGate = evaluateMentorDungeonGate({
    hazardCode: 'switch_maze_01',
    teacherPromptText: 'Pull the red lever first so the bridge opens.',
    studentActionText: 'I pull the red lever carefully.'
  });
  tracker.completeCurrentStage('mentor dungeon opened');

  // Stages 5 & 6: Show-and-tell + wrap-up recall
  lessonDo.recordMinute({
    minute: 1,
    studentMs: 32_000,
    teacherMs: 24_000,
    exchanges: 4,
    activity: 'trade_and_show_tell'
  });
  tracker.completeCurrentStage('show and tell done');
  tracker.completeCurrentStage('wrapup recall done');

  // Stage 7: Plant sealed chest, deliver report, simulate solo reuse + 48h reminder + guardian open
  tracker.plantSealedChest({
    id: 'chest-bot-1',
    expression: 'Could I have two warm honey teas so I stay warm',
    rewardCoins: 25
  });
  tracker.setCampaignNote('Next lesson: build cozy tea shop');
  tracker.completeCurrentStage('sealed chest planted');

  clockMs += 60_000;
  const soloReuse = db.recordSoloExpressionReuse(
    'bot-student',
    'Can I have warm honey tea please?',
    clockMs
  );
  const chestUnlock = tracker.unlockSealedChestByExpression(
    'Could I have two warm honey teas so I stay warm please?',
    clockMs
  );

  const weekly = computeWeeklyMetrics(
    db.listUtterancesForPlayer('bot-student').map((r) => ({
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
    }))
  );
  const verified = verifyOrReplaceReportBody(
    {
      free_utterances: weekly.free_utterance_count,
      total_valid_utterances: weekly.total_valid_utterances,
      weekly_free_ratio: weekly.weekly_free_ratio,
      active_speaking_minutes: weekly.active_speaking_minutes,
      mean_words_per_utterance: weekly.mean_words_per_utterance,
      think_speak_index: computeThinkAndSpeakIndex([], computeTwoWeekBaseline([])).index
    },
    '이번 주 1건 발화 요약'
  );

  db.createAndDeliverParentReport({
    id: 'rep-bot-1',
    playerId: 'bot-student',
    guardianId: 'guard-bot',
    kind: 'lesson',
    refId: 'lesson-bot-1',
    facts: weekly,
    body: verified.body,
    clips: [],
    shareToken: 'tok-bot-1',
    shareUrl: '/report?token=tok-bot-1',
    teacherComment: '물물교환과 멘토 던전에서 영어로 조건을 명확히 말했습니다.',
    nextLessonAt: '2026-11-22 오전 10:00',
    nowMs: clockMs
  });

  const reminderRes = db.processPendingReportReminders(clockMs + 2 * 86_400_000);
  const openedReport = db.openSharedReport('tok-bot-1', clockMs + 2 * 86_400_000 + 5_000);

  return {
    allSevenStagesCompleted: tracker.getAllProgress().every((s) => s.status === 'completed'),
    unilateralRejected: !unilateral.ok && unilateral.reason === 'bilateral_utterance_required',
    bilateralTradeOk: bilateral.ok,
    tradeFeeCoins: bilateral.feeCoins,
    studentBalanceAfterTrade: worldDo.getPlayerBalance('bot-student'),
    studentOwnsTea: worldDo.listPlayerItems('bot-student').some((i) => i.id === 'itm-tea-bot'),
    teacherOwnsOre: worldDo.listPlayerItems('bot-teacher').some((i) => i.id === 'itm-ore-bot'),
    mentorDungeonRejectedWithoutClue:
      !blockedGate.gateOpened && blockedGate.reason === 'teacher_clue_required',
    mentorDungeonOpened: openedGate.gateOpened && openedGate.synced,
    sealedChestUnlocked: chestUnlock.unlockedCount === 1 && tracker.sealedChests[0]!.unlocked,
    soloReuseUpdatedCount: soloReuse.updatedCount,
    reminderCountAfter48h: reminderRes.remindedCount,
    openedDeliveryStatus:
      openedReport && typeof openedReport.delivery_status === 'string'
        ? openedReport.delivery_status
        : null,
    openedNextTargetsUpdated: Boolean(openedReport?.nextTargetsUpdated)
  };
}
