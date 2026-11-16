import { BLOCK_PALETTE } from './registries.js';
import { CAFE_MENU, PHRASE_BANK, TRADE_SHOP_GOODS, bankItemKey } from './lang-en-ko.js';

/**
 * The six collection books (docs/03 D12: 블록, 광물, 적, 음식, 의상, 표현). Each book lists every entry it can hold;
 * the server marks an entry found only from its own records (apps/edge/src/collection.ts).
 */
export type CollectionBookId = 'blocks' | 'minerals' | 'enemies' | 'food' | 'outfits' | 'expressions';
export const COLLECTION_BOOK_IDS: readonly CollectionBookId[] = ['blocks', 'minerals', 'enemies', 'food', 'outfits', 'expressions'];

export interface CollectionEntryDef {
  key: string;
  nameKo: string;
  emoji?: string;
}

/** Korean names of the 40 build blocks a child can place (same names the build screen shows). */
export const BUILD_BLOCK_NAMES_KO: Readonly<Record<string, string>> = {
  grass: '잔디', dirt: '흙', sand: '모래', gravel: '자갈', stone: '돌', cobblestone: '조약돌', stone_brick: '돌벽돌',
  brick: '벽돌', granite: '화강암', marble: '대리석', stone_slab: '돌 반 블록', stone_stair: '돌 계단', oak_plank: '참나무 판자',
  birch_plank: '자작나무 판자', pine_plank: '소나무 판자', dark_plank: '짙은 판자', plank: '판자', log: '통나무', fence: '울타리',
  door: '문', glass: '유리', stained_glass: '색유리', torch: '횃불', lantern: '등불', roof_tile_red: '빨간 지붕',
  roof_tile_blue: '파란 지붕', roof_slate: '석판 지붕', thatch: '초가 지붕', wool_white: '흰 양털', wool_red: '빨간 양털',
  wool_yellow: '노란 양털', wool_blue: '파란 양털', wool_green: '초록 양털', carpet: '카펫', flower_pot_block: '화분',
  leaves: '나뭇잎', hay_bale: '건초', jar_shelf: '꿀단지 선반', scaffold: '발판', nameplate: '문패'
};

/** docs/03 D2 mineral table (석탄 … 블랙홀 파편). */
export const MINERAL_REGISTRY: readonly CollectionEntryDef[] = [
  { key: 'coal', nameKo: '석탄', emoji: '⚫' },
  { key: 'iron', nameKo: '철', emoji: '🔩' },
  { key: 'gold', nameKo: '금', emoji: '🪙' },
  { key: 'ruby', nameKo: '루비', emoji: '🔴' },
  { key: 'diamond', nameKo: '다이아몬드', emoji: '💎' },
  { key: 'nether_crystal', nameKo: '네더 크리스탈', emoji: '🔮' },
  { key: 'blackhole_shard', nameKo: '블랙홀 파편', emoji: '🌑' }
];

/** Item keys that count as a mineral (a trade's ore, the exchange's gold). */
export const MINERAL_ALIASES: Readonly<Record<string, string>> = { iron_ore: 'iron', gold_ore: 'gold' };

/** docs/03 D9 enemy table (8 kinds). */
export const ENEMY_REGISTRY: readonly CollectionEntryDef[] = [
  { key: 'slime', nameKo: '슬라임', emoji: '🟢' },
  { key: 'bat_swarm', nameKo: '박쥐 떼', emoji: '🦇' },
  { key: 'sand_scorpion', nameKo: '모래 전갈', emoji: '🦂' },
  { key: 'ice_golem', nameKo: '얼음 골렘', emoji: '🧊' },
  { key: 'lava_spirit', nameKo: '용암 정령', emoji: '🔥' },
  { key: 'cloud_jelly', nameKo: '구름 해파리', emoji: '☁️' },
  { key: 'broken_drone', nameKo: '고장 난 드론', emoji: '🤖' },
  { key: 'void_shard', nameKo: '공허 파편', emoji: '🕳️' }
];

/** Things worn in the head, body, back and feet sockets that the shops sell today. */
export const OUTFIT_REGISTRY: readonly CollectionEntryDef[] = [
  ...TRADE_SHOP_GOODS.filter((g) => ['helmet', 'boots', 'backpack'].includes(g.key)).map((g) => ({ key: g.key, nameKo: g.nameKo, emoji: g.emoji })),
  { key: 'raincoat', nameKo: '노란 비옷', emoji: '🧥' }
];

/** Contexts whose sentences are scaffolding, not expressions to collect (the first errand's accept/hand-over). */
const NOT_EXPRESSIONS = new Set(['errand']);

/** One expression per (place, thing) of the phrase bank: `<ctx>:<item key>`, named by its first 1-star sentence. */
export function expressionKey(ctx: string, itemKey: string): string {
  return `${ctx}:${itemKey}`;
}

function buildExpressionBook(): CollectionEntryDef[] {
  const seen = new Map<string, CollectionEntryDef>();
  for (const e of PHRASE_BANK) {
    if (NOT_EXPRESSIONS.has(e.ctx)) continue;
    const key = expressionKey(e.ctx, bankItemKey(e));
    if (!seen.has(key)) seen.set(key, { key, nameKo: e.offers[0].text });
  }
  return [...seen.values()];
}

export const COLLECTION_BOOKS: Readonly<Record<CollectionBookId, readonly CollectionEntryDef[]>> = {
  blocks: BLOCK_PALETTE.filter((b) => b.key in BUILD_BLOCK_NAMES_KO).map((b) => ({ key: b.key, nameKo: BUILD_BLOCK_NAMES_KO[b.key]! })),
  minerals: MINERAL_REGISTRY,
  enemies: ENEMY_REGISTRY,
  food: CAFE_MENU.map((d) => ({ key: d.key, nameKo: d.nameKo, emoji: d.emoji })),
  outfits: OUTFIT_REGISTRY,
  expressions: buildExpressionBook()
};
