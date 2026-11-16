import { describe, expect, it } from 'vitest';
import {
  applyReadAloudDiscount,
  claimReadAloudDiscount,
  computeOfferPrice,
  computeWeeklyPriceIndexes,
  activeGearWindowMs,
  selectRepairPickCards,
  selectReviewSigns,
  TUNING,
  updateWorldPriceIndex,
  type MemoryCardState
} from '../index.js';

const DAY = 86_400_000;
const NOW = 1_800_000_000_000;

function card(id: string, itemId: string, overdueDays: number): MemoryCardState {
  return {
    id,
    itemId,
    box: 2,
    nextReviewAtMs: NOW - overdueDays * DAY,
    lapses: 0,
    masteredAtMs: null
  };
}

describe('review signs (docs/09 P4, docs/03 D8)', () => {
  it('puts equipped / recently used gear ahead of older chest gear and caps at 3', () => {
    const cards = [
      card('c-old-chest', 'wood_sword', 40),
      card('c-jet', 'jetpack', 1),
      card('c-drill', 'drill', 2),
      card('c-used', 'iron_pickaxe', 3),
      card('c-extra', 'boots', 0.5)
    ];
    const equipped = new Set(['jetpack', 'drill', 'boots']);
    const lastUsed = { iron_pickaxe: NOW - 6 * DAY, wood_sword: NOW - 30 * DAY };
    const signs = selectReviewSigns(cards, equipped, lastUsed, NOW, new Set(['wood_sword']));
    expect(signs.map((c) => c.id)).toEqual(['c-used', 'c-drill', 'c-jet']);
    expect(signs.some((c) => c.id === 'c-old-chest')).toBe(false);
  });

  it('leaves chest-only gear unsigned, then reviews it when picked at the repair NPC', () => {
    const cards = [card('c-old', 'wood_sword', 40)];
    expect(selectReviewSigns(cards, new Set(), {}, NOW, new Set(['wood_sword']))).toEqual([]);
    expect(selectRepairPickCards(cards, new Set(['wood_sword']), NOW)).toHaveLength(1);
    expect(selectRepairPickCards(cards, new Set(['jetpack']), NOW)).toHaveLength(0);
  });

  it('ignores mastered and not-yet-due cards; the active bonus window is inclusive', () => {
    const mastered = { ...card('m', 'jetpack', 5), masteredAtMs: NOW - DAY };
    const future = card('f', 'jetpack', -2);
    const edge = card('e', 'axe', 1);
    const older = card('o', 'pick', 3);
    // box 2 (3-day interval): the window is the 7 days of docs/09 P4
    const out = selectReviewSigns([mastered, future, older, edge], new Set(), { axe: NOW - 7 * DAY }, NOW);
    expect(out.map((c) => c.id)).toEqual(['e', 'o']); // 10 + 1 day beats 0 + 3 days
    // one millisecond out of the window: still due and shown, only without the bonus
    expect(selectReviewSigns([older, edge], new Set(), { axe: NOW - 7 * DAY - 1 }, NOW).map((c) => c.id)).toEqual(['o', 'e']);
  });

  it('every due card gets its turn; the window stretches with the interval so 7-, 16- and 35-day reviews come (12-week simulation)', () => {
    expect(activeGearWindowMs(0)).toBe(7 * DAY);
    expect(activeGearWindowMs(3)).toBe(8 * DAY);
    expect(activeGearWindowMs(4)).toBe(17 * DAY);
    expect(activeGearWindowMs(5)).toBe(36 * DAY);
    // reviewed 7 days ago into box 3: due now, still "recently used", so it beats an older unused card
    const box3 = { ...card('b3', 'tea', 0), box: 3 };
    const plain = card('p', 'map', 2);
    expect(selectReviewSigns([plain, box3], new Set(), { tea: NOW - 7 * DAY }, NOW).map((c) => c.id)).toEqual(['b3', 'p']);
    // a card whose thing is not gear at all (a lesson line) still comes due
    expect(selectReviewSigns([card('l', 'lesson-u1|cafe', 9)], new Set(), {}, NOW)).toHaveLength(1);
  });
});

describe('per-world price index (docs/09 P7 vs docs/03 D10)', () => {
  it('computes each world from its own flow; a 2x role-play world cannot move a survival world', () => {
    const current = new Map([
      ['survival', 1.0],
      ['roleplay', 1.0]
    ]);
    const base = computeWeeklyPriceIndexes(current, [
      { worldId: 'survival', income: 1000, spend: 1000 },
      { worldId: 'roleplay', income: 1000, spend: 1000 }
    ]);
    const withRoleplayBoom = computeWeeklyPriceIndexes(current, [
      { worldId: 'survival', income: 1000, spend: 1000 },
      { worldId: 'roleplay', income: 2000, spend: 1000 }
    ]);
    expect(withRoleplayBoom.get('survival')).toBe(base.get('survival'));
    expect(withRoleplayBoom.get('roleplay')!).toBeGreaterThan(base.get('roleplay')!);
  });

  it('caps the weekly step at +-5% and the range at 0.8..1.25', () => {
    expect(updateWorldPriceIndex(1.0, { worldId: 'w', income: 99999, spend: 0 })).toBe(1.05);
    expect(updateWorldPriceIndex(1.0, { worldId: 'w', income: 0, spend: 99999 })).toBe(0.95);
    expect(updateWorldPriceIndex(1.24, { worldId: 'w', income: 99999, spend: 0 })).toBe(1.25);
    expect(updateWorldPriceIndex(0.81, { worldId: 'w', income: 0, spend: 99999 })).toBe(0.8);
    expect(updateWorldPriceIndex(1.0, { worldId: 'w', income: 0, spend: 0 })).toBe(1.0);
  });
});

describe('read-aloud furniture discount (docs/03 D13, docs/08 8.3)', () => {
  it('gives 10% once per furniture kind per day per player, never stacking', () => {
    let state = {};
    const first = claimReadAloudDiscount(state, 'p1', 'lamp', NOW);
    expect(first.discountPct).toBe(0.1);
    state = first.state;
    for (let i = 0; i < 10; i += 1) {
      const again = claimReadAloudDiscount(state, 'p1', 'lamp', NOW + i * 1000);
      expect(again.discountPct).toBe(0);
      state = again.state;
    }
    expect(claimReadAloudDiscount(state, 'p1', 'bed', NOW).discountPct).toBe(0.1);
    expect(claimReadAloudDiscount(state, 'p2', 'lamp', NOW).discountPct).toBe(0.1);
    expect(claimReadAloudDiscount(state, 'p1', 'lamp', NOW + DAY).discountPct).toBe(0.1);
    expect(applyReadAloudDiscount(200, 0.1)).toBe(180);
  });
});

describe('equipment prices (docs/03 D2)', () => {
  it('keeps dynamite x5, drill and drill_bundle as separate SKUs matching the 3-star formula', () => {
    const e = TUNING.equipment;
    expect(e.dynamite_x5).toEqual({ basePrice: 150, threeStarPrice: 75 });
    expect(e.drill).toEqual({ basePrice: 350, threeStarPrice: 175 });
    expect(e.drill_bundle!.basePrice).toBe(500);
    expect(e.drill_bundle!.threeStarPrice).toBe(250);
    expect(e.drill_bundle!.contains).toEqual(['drill', 'dynamite_x5']);
    for (const sku of Object.values(e)) {
      expect(computeOfferPrice({ basePrice: sku.basePrice, stars: 3 }).finalPrice).toBe(
        sku.threeStarPrice
      );
    }
  });
});
