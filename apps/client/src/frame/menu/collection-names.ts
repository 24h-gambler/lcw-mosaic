/**
 * English names for the collection book (G10). The server's GET /v1/collection answers Korean names only (`name_ko`,
 * apps/edge/src/collection.ts); the screen speaks the learn language, so the frame looks each entry and achievement up
 * here by its id and puts the server's Korean after it while the Korean help is on (world/strings.ts joinHelp). An id
 * this table does not know yet keeps the server's name, so a new server entry never shows as an empty line.
 */
import { CAFE_MENU, TRADE_SHOP_GOODS } from '@lcw/content';
import { BLOCK_NAMES_KO, joinHelp } from '../../world/strings.js';

/** packages/content ACHIEVEMENT_REGISTRY ids. */
export const ACHIEVEMENT_NAMES_EN: Readonly<Record<string, string>> = {
  first_order: 'First order',
  food_orders_20: 'Regular (20 food orders)',
  blocks_100: 'Place 100 blocks',
  blocks_1000: 'Place 1,000 blocks',
  blocks_10000: 'Place 10,000 blocks',
  mastered_1: 'First mastered design',
  mastered_10: '10 mastered designs'
};

const cap = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

/** Entry names by book (packages/content collection.ts registries); blocks come from the world's block names. */
export const COLLECTION_NAMES_EN: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  minerals: {
    coal: 'Coal',
    iron: 'Iron',
    gold: 'Gold',
    ruby: 'Ruby',
    diamond: 'Diamond',
    nether_crystal: 'Nether crystal',
    blackhole_shard: 'Black hole shard'
  },
  enemies: {
    slime: 'Slime',
    bat_swarm: 'Bat swarm',
    sand_scorpion: 'Sand scorpion',
    ice_golem: 'Ice golem',
    lava_spirit: 'Lava spirit',
    cloud_jelly: 'Cloud jelly',
    broken_drone: 'Broken drone',
    void_shard: 'Void shard'
  },
  food: Object.fromEntries(CAFE_MENU.map((d) => [d.key, cap(d.label)])),
  outfits: {
    ...Object.fromEntries(TRADE_SHOP_GOODS.map((g) => [g.key, cap(`${g.adj} ${g.label}`)])),
    raincoat: 'Yellow raincoat'
  }
};

/** An achievement's name on the screen: English by id (the server's Korean after it with the help on), else as sent. */
export function achievementName(id: string, nameKo: string): string {
  const en = ACHIEVEMENT_NAMES_EN[id];
  return en ? joinHelp(en, nameKo) : nameKo;
}

/**
 * A collection entry's name: English by book and key with the help after it; the expressions book already holds the
 * English sentence itself; an unknown key keeps the server's name.
 */
export function entryName(book: string, key: string, nameKo: string): string {
  if (book === 'blocks') return BLOCK_NAMES_KO[key] ?? nameKo;
  const en = COLLECTION_NAMES_EN[book]?.[key];
  return en ? joinHelp(en, nameKo) : nameKo;
}
