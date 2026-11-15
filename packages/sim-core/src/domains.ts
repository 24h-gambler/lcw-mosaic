import { FURNITURE_REGISTRY, RESIDENT_REGISTRY, type ResidentDef } from '@lcw/content';
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
    promptSentence = 'This room needs more space.';
  } else if (ceilingHeight < TUNING.building.roomMinCeiling) {
    missing.push('low_ceiling');
    promptSentence = 'This room needs a higher ceiling.';
  } else if (!hasDoor) {
    missing.push('door');
    promptSentence = 'This room needs a door.';
  } else if (!hasLight) {
    missing.push('light');
    promptSentence = 'This room needs a light source.';
  } else if (!hasRest) {
    missing.push('rest');
    promptSentence = 'This room needs a bed or a chair.';
  } else if (!hasFlat) {
    missing.push('flat');
    promptSentence = 'This room needs a table or workbench.';
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
