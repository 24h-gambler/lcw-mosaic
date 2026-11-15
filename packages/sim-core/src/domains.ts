import {
  FURNITURE_REGISTRY,
  LESSON_ARC_STAGE_GUIDES,
  RESIDENT_REGISTRY,
  type LessonArcStageGuide,
  type ResidentDef
} from '@lcw/content';
import { mulberry32 } from '@lcw/destruction';
import { TUNING } from './tuning.js';
import { VoxelWorld } from './world.js';

export interface LedgerEntry {
  seq: number;
  playerId: string;
  delta: number;
  reason: string;
  ref: string;
  atMs: number;
}

export class Ledger {
  readonly entries: LedgerEntry[] = [];
  private nextSeq = 1;

  record(playerId: string, delta: number, reason: string, ref: string, atMs: number): LedgerEntry {
    const entry: LedgerEntry = {
      seq: this.nextSeq++,
      playerId,
      delta,
      reason,
      ref,
      atMs
    };
    this.entries.push(entry);
    return entry;
  }

  getBalance(playerId: string): number {
    let sum = 0;
    for (const e of this.entries) {
      if (e.playerId === playerId) sum += e.delta;
    }
    return sum;
  }
}

export function computeOfferPrice(params: {
  basePrice: number;
  stars: 1 | 2 | 3;
  sectorFactor?: number;
  marketIndex?: number;
  hintLevel?: string;
}): { finalPrice: number; hintRefund: number } {
  const sectorFactor = params.sectorFactor ?? 1.0;
  const marketIndex = Math.max(
    TUNING.economy.marketIndexMin,
    Math.min(TUNING.economy.marketIndexMax, params.marketIndex ?? 1.0)
  );
  const starDiscount = TUNING.economy.starDiscount[params.stars];
  const finalPrice = Math.max(
    0,
    Math.round(params.basePrice * sectorFactor * marketIndex * (1 - starDiscount))
  );
  const bonusRate = TUNING.economy.hintBonusRate[params.hintLevel ?? 'full'] ?? 0;
  const hintRefund = Math.round(finalPrice * bonusRate);
  return { finalPrice, hintRefund };
}

export function canMineOre(oreId: string, toolTier: number): boolean {
  const ore = TUNING.mining.ores[oreId];
  if (!ore) return false;
  return toolTier >= ore.requiredToolTier;
}

export function updateMarketIndexMeanReverting(
  currentIndex: number,
  unitsSoldInWorld: number
): number {
  const pressure = -unitsSoldInWorld * 0.01;
  const meanReversion = (1.0 - currentIndex) * 0.1;
  const next = currentIndex + pressure + meanReversion;
  return Number(
    Math.max(TUNING.economy.marketIndexMin, Math.min(TUNING.economy.marketIndexMax, next)).toFixed(4)
  );
}

export interface MemoryCardState {
  id: string;
  itemId: string;
  box: number; // 0..5 -> 6 intervals, 6 -> mastered
  nextReviewAtMs: number;
  lapses: number;
  masteredAtMs: number | null;
}

export function getHintLevelForBox(box: number): 'full' | 'keyword' | 'initial' | 'picture' | 'none' {
  if (box <= 1) return 'full';
  if (box === 2) return 'keyword';
  if (box === 3) return 'initial';
  if (box === 4) return 'picture';
  return 'none';
}

export function reviewMemoryCard(
  card: MemoryCardState,
  passed: boolean,
  nowMs: number
): MemoryCardState {
  if (!passed) {
    const nextBox = Math.max(0, card.box - 1);
    const interval = TUNING.memory.intervalsMs[nextBox]!;
    return {
      ...card,
      box: nextBox,
      lapses: card.lapses + 1,
      nextReviewAtMs: nowMs + interval
    };
  }
  const nextBox = card.box + 1;
  if (nextBox >= TUNING.memory.intervalsMs.length) {
    return {
      ...card,
      box: nextBox,
      nextReviewAtMs: Number.MAX_SAFE_INTEGER,
      masteredAtMs: nowMs
    };
  }
  return {
    ...card,
    box: nextBox,
    nextReviewAtMs: nowMs + TUNING.memory.intervalsMs[nextBox]!
  };
}

export function getDueCardsForSession(cards: MemoryCardState[], nowMs: number): MemoryCardState[] {
  return cards
    .filter((c) => c.masteredAtMs === null && c.nextReviewAtMs <= nowMs)
    .sort((a, b) => a.nextReviewAtMs - b.nextReviewAtMs)
    .slice(0, TUNING.memory.maxDuePerSession);
}

export interface ReviewSignInput {
  /** Cards that may produce a wear sign. */
  cards: readonly MemoryCardState[];
  /** itemIds currently equipped or socketed. */
  equippedItemIds: ReadonlySet<string>;
  /** itemId -> last time the item was used (ms). */
  lastUsedMs: Readonly<Record<string, number>>;
  nowMs: number;
}

const DAY_MS_SIM = 86_400_000;

/** True when the item is equipped/socketed now or was used within the active-gear window. */
export function isActiveGear(
  itemId: string,
  equippedItemIds: ReadonlySet<string>,
  lastUsedMs: Readonly<Record<string, number>>,
  nowMs: number
): boolean {
  if (equippedItemIds.has(itemId)) return true;
  const used = lastUsedMs[itemId];
  return used !== undefined && nowMs - used <= TUNING.memory.activeGearWindowMs;
}

/**
 * docs/09 P4 / docs/03 D8: choose up to 3 wear signs per session.
 * priority = (used_or_equipped_in_last_7d ? 10 : 0) + days_overdue.
 * Gear that is only stored in the chest (not equipped, not used in 7 days) gets no sign;
 * it is reviewed only when the player picks it at the repair NPC (see selectRepairPickCards).
 */
export function selectReviewSigns(
  cards: readonly MemoryCardState[],
  equippedItemIds: ReadonlySet<string>,
  lastUsedMs: Readonly<Record<string, number>>,
  nowMs: number
): MemoryCardState[] {
  const scored: Array<{ card: MemoryCardState; priority: number }> = [];
  for (const card of cards) {
    if (card.masteredAtMs !== null || card.nextReviewAtMs > nowMs) continue;
    if (!isActiveGear(card.itemId, equippedItemIds, lastUsedMs, nowMs)) continue;
    const daysOverdue = (nowMs - card.nextReviewAtMs) / DAY_MS_SIM;
    scored.push({ card, priority: TUNING.memory.activeGearPriorityBonus + daysOverdue });
  }
  scored.sort((a, b) => b.priority - a.priority || a.card.id.localeCompare(b.card.id));
  return scored.slice(0, TUNING.memory.maxDuePerSession).map((s) => s.card);
}

/** Repair-NPC path: any due card whose item the player explicitly picked, chest gear included. */
export function selectRepairPickCards(
  cards: readonly MemoryCardState[],
  pickedItemIds: ReadonlySet<string>,
  nowMs: number
): MemoryCardState[] {
  return cards.filter(
    (c) => c.masteredAtMs === null && c.nextReviewAtMs <= nowMs && pickedItemIds.has(c.itemId)
  );
}

export interface WorldEconomyFlow {
  worldId: string;
  /** Cumulative coins earned in THIS world over the period. */
  income: number;
  /** Cumulative coins spent (sinks) in THIS world over the period. */
  spend: number;
}

/**
 * docs/09 P7: weekly price-index step for ONE world, from that world's own income vs spend.
 * Never takes server-wide or other-mode aggregates, so 2x-reward role-play towns cannot
 * inflate prices in survival-city worlds.
 */
export function updateWorldPriceIndex(currentIndex: number, flow: WorldEconomyFlow): number {
  const gross = Math.max(1, flow.income + flow.spend);
  const net = (flow.income - flow.spend) / gross; // -1..1, positive = coins piling up
  const step = Math.max(
    -TUNING.economy.priceIndexWeeklyStepMax,
    Math.min(TUNING.economy.priceIndexWeeklyStepMax, net * TUNING.economy.priceIndexWeeklyStepMax * 2)
  );
  const next = currentIndex * (1 + step);
  return Number(
    Math.max(TUNING.economy.marketIndexMin, Math.min(TUNING.economy.marketIndexMax, next)).toFixed(4)
  );
}

/** Weekly cron body: each world is computed independently from its own flow only. */
export function computeWeeklyPriceIndexes(
  currentIndexByWorld: ReadonlyMap<string, number>,
  flows: readonly WorldEconomyFlow[]
): Map<string, number> {
  const out = new Map<string, number>();
  for (const flow of flows) {
    out.set(flow.worldId, updateWorldPriceIndex(currentIndexByWorld.get(flow.worldId) ?? 1.0, flow));
  }
  return out;
}

/** player|furnitureKind -> day key of the last read-aloud discount. */
export type ReadAloudDiscountState = Readonly<Record<string, number>>;

export function readAloudDayKey(nowMs: number): number {
  return Math.floor((nowMs + TUNING.economy.dayBoundaryOffsetMs) / DAY_MS_SIM);
}

/**
 * docs/03 D13 / docs/08 8.3: reading the missing-condition sentence aloud gives 10% off a furniture
 * kind, at most once per kind per day per player. Repeats never stack. Pure: returns the next state.
 */
export function claimReadAloudDiscount(
  state: ReadAloudDiscountState,
  playerId: string,
  furnitureKind: string,
  nowMs: number
): { discountPct: number; state: ReadAloudDiscountState } {
  const key = `${playerId}|${furnitureKind}`;
  const day = readAloudDayKey(nowMs);
  if (state[key] === day) return { discountPct: 0, state };
  return { discountPct: TUNING.economy.readAloudDiscountPct, state: { ...state, [key]: day } };
}

export function applyReadAloudDiscount(price: number, discountPct: number): number {
  return Math.max(0, Math.round(price * (1 - discountPct)));
}

export interface CareerState {
  rank: 'intern' | 'staff' | 'manager' | 'director';
  daysWorked: number;
  activePlayTimeSec: number;
  isOnline: boolean;
}

export function tickCareerClock(career: CareerState, dtSec: number): void {
  // Career clock advances ONLY while owner is online (WP-407)
  if (!career.isOnline) return;
  career.activePlayTimeSec += dtSec;
}

export function resolveCourtVerdict(params: {
  balance: number;
  choice: 'fine' | 'plea';
  pleaStars?: 1 | 2 | 3;
  offensesToday: number;
}): {
  outcome: 'fine' | 'community_service' | 'acquitted';
  fineCoins: number;
  cityExplosivesLocked: boolean;
} {
  const baseFine = Math.min(
    TUNING.court.fineMax,
    Math.max(TUNING.court.fineMin, Math.round(params.balance * TUNING.court.finePct))
  );
  const repeatMult = 1 + Math.max(0, params.offensesToday - 1) * TUNING.court.repeatFineStep;
  const escalatedFine = Math.round(baseFine * repeatMult);
  const lockExplosives = params.offensesToday >= TUNING.court.lockExplosivesAtOffenses;

  if (params.choice === 'fine') {
    return { outcome: 'fine', fineCoins: escalatedFine, cityExplosivesLocked: lockExplosives };
  }
  if (params.pleaStars === 3) {
    return { outcome: 'acquitted', fineCoins: 0, cityExplosivesLocked: lockExplosives };
  }
  if (params.pleaStars === 2) {
    return { outcome: 'community_service', fineCoins: 0, cityExplosivesLocked: lockExplosives };
  }
  return {
    outcome: 'fine',
    fineCoins: Math.round(escalatedFine * TUNING.court.oneStarFineFactor),
    cityExplosivesLocked: lockExplosives
  };
}

export function drawLotteryTicket(stars: 1 | 2 | 3, roll01: number): { rank: 0 | 1 | 2 | 3 | 4; coins: number } {
  let acc = 0;
  for (const prize of TUNING.lottery.prizes) {
    acc += prize.probsByStars[stars];
    if (roll01 < acc) {
      return { rank: prize.rank, coins: prize.coins };
    }
  }
  return { rank: 0, coins: 0 };
}

export function simulateLotteryMonteCarlo(stars: 1 | 2 | 3, trials: number, seed = 42): number {
  const rng = mulberry32(seed);
  let totalCoins = 0;
  for (let i = 0; i < trials; i++) {
    totalCoins += drawLotteryTicket(stars, rng()).coins;
  }
  return totalCoins / trials;
}

export function computeAttackDamage(params: {
  weaponId: string;
  targetArmorSum: number;
  voiceSkillGrade?: 'word' | 'phrase' | 'sentence' | null;
}): number {
  const base = TUNING.combat.weapons[params.weaponId] ?? 1;
  let mult = 1.0;
  if (params.voiceSkillGrade) {
    mult *= TUNING.combat.voiceSkillMultiplier[params.voiceSkillGrade];
    if (params.weaponId === 'wand') mult *= TUNING.combat.wandSkillBonus;
  }
  const raw = Math.round(base * mult);
  return Math.max(1, raw - params.targetArmorSum);
}

export function getVerticalBandAtY(y: number) {
  return (
    TUNING.verticalBands.find((b) => y >= b.minY && y <= b.maxY) ??
    TUNING.verticalBands[3]! // surface fallback
  );
}

export interface PlacedFurniture {
  id: string;
  x: number;
  y: number;
  z: number;
}

export interface RoomCheckResult {
  valid: boolean;
  volume: number;
  missingConditions: string[];
  promptSentence: string;
  eligibleResident: ResidentDef | null;
}

/**
 * docs/03 D13: the room check names what is missing in the target language. One table for the world (build screen)
 * and the server (read-aloud discount checks the child read exactly this sentence).
 */
export const ROOM_MISSING_SENTENCES = {
  too_small: 'This room needs more space.',
  low_ceiling: 'This room needs a higher ceiling.',
  door: 'This room needs a door.',
  light: 'This room needs a light source.',
  rest: 'This room needs a bed or a chair.',
  flat: 'This room needs a table or workbench.'
} as const;

/** Missing conditions that a furniture kind fixes (the read-aloud discount applies to these kinds only). */
export const FURNITURE_KINDS = ['light', 'rest', 'flat'] as const;
export type FurnitureKind = (typeof FURNITURE_KINDS)[number];

const FURNITURE_ROLE_MAP = new Map(FURNITURE_REGISTRY.map((f) => [f.id, f.role]));

/**
 * Flood-fills enclosed room from nameplate interior up to 400 blocks (WP-607).
 */
export function evaluateRoom(
  world: VoxelWorld,
  startAir: { x: number; y: number; z: number },
  furniture: PlacedFurniture[]
): RoomCheckResult {
  const seen = new Set<string>();
  const queue: Array<[number, number, number]> = [[startAir.x, startAir.y, startAir.z]];
  const key = (x: number, y: number, z: number): string => `${x},${y},${z}`;
  seen.add(key(startAir.x, startAir.y, startAir.z));

  let minY = startAir.y;
  let maxY = startAir.y;
  let hasDoor = false;
  let hasLightBlock = false;
  let overflowed = false;

  const isPassable = (b: number): boolean => b === 0 || b === 26 || b === 27 || b === 42;

  while (queue.length > 0) {
    const [cx, cy, cz] = queue.shift()!;
    minY = Math.min(minY, cy);
    maxY = Math.max(maxY, cy);

    for (const [dx, dy, dz] of [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1]
    ] as const) {
      const nx = cx + dx;
      const ny = cy + dy;
      const nz = cz + dz;
      const blk = world.getBlock(nx, ny, nz);
      if (blk === 23) hasDoor = true;
      if (blk === 26 || blk === 27) hasLightBlock = true;

      if (isPassable(blk)) {
        const nk = key(nx, ny, nz);
        if (!seen.has(nk)) {
          seen.add(nk);
          if (seen.size > TUNING.building.roomMaxVolume) {
            overflowed = true;
            break;
          }
          queue.push([nx, ny, nz]);
        }
      }
    }
    if (overflowed) break;
  }

  if (overflowed) {
    return {
      valid: false,
      volume: seen.size,
      missingConditions: ['not_enclosed_or_too_large'],
      promptSentence: 'This room is too big or not enclosed.',
      eligibleResident: null
    };
  }

  const insideFurniture = furniture.filter((f) => seen.has(key(f.x, f.y, f.z)));
  const roles = new Set(insideFurniture.map((f) => FURNITURE_ROLE_MAP.get(f.id) ?? 'decor'));
  const hasLight = hasLightBlock || roles.has('light');
  const hasRest = roles.has('rest');
  const hasFlat = roles.has('flat');
  const ceilingHeight = maxY - minY + 1;

  const missing: string[] = [];
  let promptSentence = 'This room is ready for a resident!';

  if (seen.size < TUNING.building.roomMinVolume) {
    missing.push('too_small');
    promptSentence = ROOM_MISSING_SENTENCES.too_small;
  } else if (ceilingHeight < TUNING.building.roomMinCeiling) {
    missing.push('low_ceiling');
    promptSentence = ROOM_MISSING_SENTENCES.low_ceiling;
  } else if (!hasDoor) {
    missing.push('door');
    promptSentence = ROOM_MISSING_SENTENCES.door;
  } else if (!hasLight) {
    missing.push('light');
    promptSentence = ROOM_MISSING_SENTENCES.light;
  } else if (!hasRest) {
    missing.push('rest');
    promptSentence = ROOM_MISSING_SENTENCES.rest;
  } else if (!hasFlat) {
    missing.push('flat');
    promptSentence = ROOM_MISSING_SENTENCES.flat;
  }

  const jobFurniture = insideFurniture.find((f) => FURNITURE_ROLE_MAP.get(f.id) === 'job');
  const eligibleResident =
    missing.length === 0 && jobFurniture
      ? (RESIDENT_REGISTRY.find((r) => r.jobFurnitureId === jobFurniture.id) ?? null)
      : null;

  return {
    valid: missing.length === 0,
    volume: seen.size,
    missingConditions: missing,
    promptSentence,
    eligibleResident
  };
}

export interface TradeSettlementResult {
  settled: boolean;
  reason?: 'bilateral_utterance_required' | 'insufficient_coins_for_fee';
  feeCoins: number;
  bonusGranted: boolean;
}

/**
 * Bilateral player-teacher / player-player barter settlement (WP-509, docs/03 D11).
 * Both parties must speak before items swap and star-based fees (10% / 5% / 0%) settle.
 */
export function calculateTradeSettlement(params: {
  baseValueCoins: number;
  stars: 1 | 2 | 3;
  teacherSpoken: boolean;
  studentSpoken: boolean;
  studentPassed: boolean;
  studentCoins: number;
}): TradeSettlementResult {
  if (!params.teacherSpoken || !params.studentSpoken || !params.studentPassed) {
    return {
      settled: false,
      reason: 'bilateral_utterance_required',
      feeCoins: 0,
      bonusGranted: false
    };
  }
  const rate = TUNING.trade.feeRateByStars[params.stars];
  const feeCoins = Math.max(0, Math.round(params.baseValueCoins * rate));
  if (params.studentCoins < feeCoins) {
    return {
      settled: false,
      reason: 'insufficient_coins_for_fee',
      feeCoins,
      bonusGranted: false
    };
  }
  return {
    settled: true,
    feeCoins,
    bonusGranted: params.stars === 3
  };
}

const DUNGEON_CLUE_TOKENS = new Set([
  'red',
  'blue',
  'green',
  'yellow',
  'gold',
  'left',
  'right',
  'north',
  'south',
  'east',
  'west',
  'first',
  'second',
  'switch',
  'lever',
  'door',
  'plate',
  'crystal',
  'bridge',
  'gate'
]);

const DUNGEON_ACTION_TOKENS = new Set([
  'pull',
  'push',
  'press',
  'open',
  'turn',
  'activate',
  'step',
  'flip',
  'switch',
  'lever',
  'door',
  'plate',
  'gate'
]);

/**
 * Info-gap Mentor Dungeon Gate (WP-311, docs/06 & docs/10):
 * requires the teacher (map holder) to speak a clue and the student (actor) to state an action.
 */
export function evaluateMentorDungeonGate(params: {
  hazardCode: string;
  teacherPromptText: string;
  studentActionText: string;
}): {
  gateOpened: boolean;
  synced: boolean;
  hazardCode: string;
  reason?: 'teacher_clue_required' | 'student_action_required';
} {
  const teacherTokens = (params.teacherPromptText.toLowerCase().match(/[a-z]+/g) ?? []);
  const studentTokens = (params.studentActionText.toLowerCase().match(/[a-z]+/g) ?? []);

  const hasTeacherClue = teacherTokens.some((tok) => DUNGEON_CLUE_TOKENS.has(tok));
  if (!hasTeacherClue) {
    return {
      gateOpened: false,
      synced: false,
      hazardCode: params.hazardCode,
      reason: 'teacher_clue_required'
    };
  }

  const hasStudentAction =
    studentTokens.length >= 2 && studentTokens.some((tok) => DUNGEON_ACTION_TOKENS.has(tok));
  if (!hasStudentAction) {
    return {
      gateOpened: false,
      synced: false,
      hazardCode: params.hazardCode,
      reason: 'student_action_required'
    };
  }

  return {
    gateOpened: true,
    synced: true,
    hazardCode: params.hazardCode
  };
}

export type SimLevel = 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6';

const ORDERED_LEVELS: readonly SimLevel[] = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'];

/**
 * Automatic Level Ladder adjustment across a rolling 20-attempt window (WP-410, docs/04 4.3).
 */
export function evaluateLevelAdjustment(params: {
  currentLevel: SimLevel;
  recentAttempts: ReadonlyArray<{ stars: 1 | 2 | 3; firstTryPass: boolean; passed: boolean }>;
  locked?: boolean;
}): {
  nextLevel: SimLevel;
  changed: boolean;
  direction: 'up' | 'down' | 'stay';
  reason: string;
} {
  if (params.locked) {
    return {
      nextLevel: params.currentLevel,
      changed: false,
      direction: 'stay',
      reason: 'locked_by_guardian_or_teacher'
    };
  }

  const window = params.recentAttempts.slice(-TUNING.levelLadder.windowSize);
  if (window.length < TUNING.levelLadder.windowSize) {
    return {
      nextLevel: params.currentLevel,
      changed: false,
      direction: 'stay',
      reason: 'insufficient_window'
    };
  }

  const currentIdx = ORDERED_LEVELS.indexOf(params.currentLevel);
  const threeStarFirstTryCount = window.filter(
    (a) => a.passed && a.firstTryPass && a.stars === 3
  ).length;
  const failCount = window.filter((a) => !a.passed).length;

  const promoteRatio = threeStarFirstTryCount / window.length;
  const failRatio = failCount / window.length;

  if (promoteRatio >= TUNING.levelLadder.promoteThreeStarPassRatio && currentIdx < ORDERED_LEVELS.length - 1) {
    return {
      nextLevel: ORDERED_LEVELS[currentIdx + 1]!,
      changed: true,
      direction: 'up',
      reason: 'three_star_first_try_threshold_met'
    };
  }

  if (failRatio >= TUNING.levelLadder.demoteFailRatio && currentIdx > 0) {
    return {
      nextLevel: ORDERED_LEVELS[currentIdx - 1]!,
      changed: true,
      direction: 'down',
      reason: 'fail_threshold_exceeded'
    };
  }

  return {
    nextLevel: params.currentLevel,
    changed: false,
    direction: 'stay',
    reason: 'within_target_band'
  };
}

export type LessonArcStageId = LessonArcStageGuide['id'];

export interface SealedReviewChest {
  id: string;
  expression: string;
  rewardCoins: number;
  unlocked: boolean;
  unlockedAtMs: number | null;
}

export interface LessonStageProgressItem extends LessonArcStageGuide {
  status: 'completed' | 'current' | 'upcoming';
  evidenceNote: string | null;
}

/**
 * Deterministic tracker for the 120-minute 7-stage lesson arc and between-lesson
 * sealed chest continuity loop (docs/06 & docs/10 §2).
 */
export class LessonProgressionTracker {
  private currentStageIndex = 0;
  private readonly completed = new Map<LessonArcStageId, string>();
  readonly sealedChests: SealedReviewChest[] = [];
  readonly nextLessonTargets: string[] = [];
  campaignNote = '';

  getCurrentGuide(): LessonArcStageGuide {
    return (
      LESSON_ARC_STAGE_GUIDES[this.currentStageIndex] ??
      LESSON_ARC_STAGE_GUIDES[LESSON_ARC_STAGE_GUIDES.length - 1]!
    );
  }

  getAllProgress(): LessonStageProgressItem[] {
    return LESSON_ARC_STAGE_GUIDES.map((guide, idx) => {
      const evidenceNote = this.completed.get(guide.id) ?? null;
      const status: LessonStageProgressItem['status'] =
        evidenceNote !== null
          ? 'completed'
          : idx === this.currentStageIndex
            ? 'current'
            : 'upcoming';
      return {
        ...guide,
        status,
        evidenceNote
      };
    });
  }

  completeCurrentStage(evidenceNote = 'completed'): LessonStageProgressItem[] {
    const current = this.getCurrentGuide();
    this.completed.set(current.id, evidenceNote);
    if (this.currentStageIndex < LESSON_ARC_STAGE_GUIDES.length - 1) {
      this.currentStageIndex += 1;
    }
    return this.getAllProgress();
  }

  plantSealedChest(params: { id: string; expression: string; rewardCoins: number }): SealedReviewChest {
    const chest: SealedReviewChest = {
      id: params.id,
      expression: params.expression,
      rewardCoins: params.rewardCoins,
      unlocked: false,
      unlockedAtMs: null
    };
    this.sealedChests.push(chest);
    const normalized = params.expression.trim().toLowerCase();
    if (normalized && !this.nextLessonTargets.includes(normalized)) {
      this.nextLessonTargets.push(normalized);
    }
    return chest;
  }

  /**
   * Unlocks any sealed review chest whose target phrase or core content tokens appear in solo play.
   */
  unlockSealedChestByExpression(
    spokenText: string,
    nowMs: number
  ): { unlockedCount: number; unlockedIds: string[]; rewardCoins: number } {
    const normalizedSpoken = spokenText.toLowerCase().replace(/[^a-z0-9\s']/g, ' ');
    const spokenTokens = new Set(normalizedSpoken.split(/\s+/).filter((t) => t.length > 0));
    const unlockedIds: string[] = [];
    let rewardCoins = 0;

    for (const chest of this.sealedChests) {
      if (chest.unlocked) continue;
      const targetNorm = chest.expression.toLowerCase().replace(/[^a-z0-9\s']/g, ' ').trim();
      if (!targetNorm) continue;
      const exactMatch = normalizedSpoken.includes(targetNorm);
      const targetTokens = targetNorm.split(/\s+/).filter((t) => t.length > 2);
      const hits = targetTokens.filter((t) => spokenTokens.has(t)).length;
      const ratioMatch = targetTokens.length > 0 && hits / targetTokens.length >= 0.7;
      if (exactMatch || ratioMatch) {
        chest.unlocked = true;
        chest.unlockedAtMs = nowMs;
        unlockedIds.push(chest.id);
        rewardCoins += chest.rewardCoins;
      }
    }

    return {
      unlockedCount: unlockedIds.length,
      unlockedIds,
      rewardCoins
    };
  }

  setCampaignNote(note: string): void {
    this.campaignNote = note;
  }
}
