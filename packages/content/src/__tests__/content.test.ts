import { describe, expect, it } from 'vitest';
import {
  ABILITY_TAG_REGISTRY,
  BIOME_PACKS,
  BLOCK_PALETTE,
  CAFE_DRINKS,
  CAFE_MODIFIERS,
  FURNITURE_REGISTRY,
  lookupPhraseBank,
  PART_REGISTRY,
  RESIDENT_REGISTRY
} from '../index.js';

describe('@lcw/content WP-107, WP-207, WP-402, WP-403, WP-602, WP-607 acceptance', () => {
  it('resolves all 12 drinks x 6 modifiers = 72 combinations across L1..L3 from the phrase bank (WP-107)', () => {
    expect(CAFE_DRINKS.length).toBe(12);
    expect(CAFE_MODIFIERS.length).toBe(6);

    let hits = 0;
    for (const level of ['L1', 'L2', 'L3'] as const) {
      for (const drink of CAFE_DRINKS) {
        for (const mod of CAFE_MODIFIERS) {
          const entry = lookupPhraseBank({
            ctx: 'cafe',
            level,
            item: drink.key,
            modifiers: [mod]
          });
          expect(entry).not.toBeNull();
          expect(entry!.offers).toHaveLength(3);
          hits++;
        }
      }
    }
    expect(hits).toBe(216);
  });

  it('hits the bank for all 4 essential shop contexts (WP-403)', () => {
    for (const ctx of ['cafe', 'makers_lab', 'boutique', 'exchange'] as const) {
      expect(lookupPhraseBank({ ctx, level: 'L2' })).not.toBeNull();
    }
  });

  it('provides 12 biome packs, 40+ blocks, 120+ parts, 44 ability tags, 80 furniture items, and 12 residents', () => {
    expect(BIOME_PACKS.length).toBe(12);
    expect(BLOCK_PALETTE.length).toBeGreaterThanOrEqual(40);
    expect(PART_REGISTRY.length).toBeGreaterThanOrEqual(120);
    expect(ABILITY_TAG_REGISTRY.length).toBe(44);
    expect(FURNITURE_REGISTRY.length).toBe(80);
    expect(RESIDENT_REGISTRY.length).toBe(12);
  });
});
