/**
 * The town shop catalog (Dan 11-19 R326 ⑤⑪⑫): what coins buy, what the bought things make, and today's open
 * build challenge. One table for the server (prices, the purchase check, the quest check), the shop window, the
 * maker's book (recipes as pictures) and the phrase bank (the English order that gets the star discount).
 *
 * - Prices are bank (star-1) prices in coins; the world's weekly index (docs/09 P7) and the star discount
 *   (STAR_PRICE_FACTOR, lang-en-ko) apply on top, always on the server.
 * - `food` is the survival definition only (hunger/thirst points restored, 0..100 gauges). The world lane applies
 *   it when the child eats or drinks; this file never touches the gauges.
 * - `block` is a pack of build blocks (BLOCK_PALETTE keys): price = block price × count, so the block table stays
 *   the one source. The world/build lane moves owned packs into the build hotbar.
 * - Nothing here is bought with money: coins are earned by speaking only (docs/16 #11).
 */
import { BLOCK_PALETTE } from './registries.js';

export type ShopCategory = 'clothes' | 'tools' | 'home' | 'pets' | 'food' | 'materials';
export const SHOP_CATEGORIES: readonly ShopCategory[] = ['clothes', 'tools', 'home', 'pets', 'food', 'materials'];

export const SHOP_CATEGORY_NAMES: Readonly<Record<ShopCategory, { en: string; ko: string; emoji: string }>> = {
  clothes: { en: 'Clothes', ko: '옷', emoji: '👕' },
  tools: { en: 'Tools', ko: '도구', emoji: '🧰' },
  home: { en: 'Home', ko: '집 꾸미기', emoji: '🏠' },
  pets: { en: 'Pets', ko: '펫', emoji: '🐾' },
  food: { en: 'Food & Water', ko: '음식·물', emoji: '🍞' },
  materials: { en: 'Blocks', ko: '재료 블록', emoji: '🧱' }
};

export type WearSocket = 'Head_Socket' | 'Body_Socket' | 'Back_Socket' | 'Feet_Socket' | 'RightHand_Socket';

export interface ShopItemDef {
  key: string;
  cat: ShopCategory;
  /** English noun as said in the order ("hat", "rain boots"). */
  label: string;
  /** The adjective of the 2- and 3-star sentence ("red"). */
  adj: string;
  /** 'a' | 'an' | 'some' — "Can I have some rain boots?" */
  art: 'a' | 'an' | 'some';
  nameKo: string;
  emoji: string;
  /** Bank price in coins (star 1). */
  price: number;
  /** Where it is worn or held. */
  socket: WearSocket;
  /** Survival definition (world lane applies it): gauge points restored. */
  food?: { hunger: number; thirst: number };
  /** Build-block pack: BLOCK_PALETTE key and how many blocks. */
  block?: { key: string; count: number };
}

/** Why the child wants it, by category (the 3-star clause). */
export const SHOP_REASONS: Readonly<Record<ShopCategory, { because: string; soThat: string }>> = {
  clothes: { because: 'I want to look cool', soThat: 'I can look cool at the party' },
  tools: { because: 'I have work to do', soThat: 'I can do my work' },
  home: { because: 'my room is empty', soThat: 'my room looks nice' },
  pets: { because: 'I want a friend', soThat: 'I can play with a friend' },
  food: { because: 'I am hungry', soThat: 'I can keep exploring' },
  materials: { because: 'I want to build a house', soThat: 'I can build a house' }
};

const W = (key: string, label: string, adj: string, nameKo: string, emoji: string, price: number, socket: WearSocket, art: ShopItemDef['art'] = 'a'): ShopItemDef => ({
  key,
  cat: 'clothes',
  label,
  adj,
  art,
  nameKo,
  emoji,
  price,
  socket
});
const T = (key: string, label: string, adj: string, nameKo: string, emoji: string, price: number, art: ShopItemDef['art'] = 'a'): ShopItemDef => ({
  key,
  cat: 'tools',
  label,
  adj,
  art,
  nameKo,
  emoji,
  price,
  socket: 'RightHand_Socket'
});
const H = (key: string, label: string, adj: string, nameKo: string, emoji: string, price: number, art: ShopItemDef['art'] = 'a'): ShopItemDef => ({
  key,
  cat: 'home',
  label,
  adj,
  art,
  nameKo,
  emoji,
  price,
  socket: 'RightHand_Socket'
});
const P = (key: string, label: string, adj: string, nameKo: string, emoji: string, price: number, art: ShopItemDef['art'] = 'a'): ShopItemDef => ({
  key,
  cat: 'pets',
  label,
  adj,
  art,
  nameKo,
  emoji,
  price,
  socket: 'RightHand_Socket'
});
const F = (key: string, label: string, adj: string, nameKo: string, emoji: string, price: number, hunger: number, thirst: number, art: ShopItemDef['art'] = 'a'): ShopItemDef => ({
  key,
  cat: 'food',
  label,
  adj,
  art,
  nameKo,
  emoji,
  price,
  socket: 'RightHand_Socket',
  food: { hunger, thirst }
});

/** Block packs: price comes from BLOCK_PALETTE (block price × count). */
const MATERIAL_PACKS: ReadonlyArray<{ block: string; count: number; label: string; adj: string; nameKo: string; emoji: string }> = [
  { block: 'plank', count: 16, label: 'planks', adj: 'wooden', nameKo: '나무 판자 16개', emoji: '🪵' },
  { block: 'log', count: 8, label: 'logs', adj: 'big', nameKo: '통나무 8개', emoji: '🪵' },
  { block: 'brick', count: 16, label: 'bricks', adj: 'red', nameKo: '벽돌 16개', emoji: '🧱' },
  { block: 'stone_brick', count: 16, label: 'stone bricks', adj: 'gray', nameKo: '돌벽돌 16개', emoji: '🪨' },
  { block: 'glass', count: 8, label: 'windows', adj: 'clear', nameKo: '유리 8개', emoji: '🪟' },
  { block: 'roof_tile_red', count: 16, label: 'roof tiles', adj: 'red', nameKo: '빨간 지붕 16개', emoji: '🏠' },
  { block: 'roof_tile_blue', count: 16, label: 'roof tiles', adj: 'blue', nameKo: '파란 지붕 16개', emoji: '🏘️' },
  { block: 'door', count: 1, label: 'door', adj: 'wooden', nameKo: '나무 문', emoji: '🚪' },
  { block: 'fence', count: 8, label: 'fences', adj: 'wooden', nameKo: '울타리 8개', emoji: '🚧' },
  { block: 'ladder', count: 4, label: 'ladders', adj: 'long', nameKo: '사다리 4개', emoji: '🪜' },
  { block: 'torch', count: 4, label: 'torches', adj: 'bright', nameKo: '횃불 4개', emoji: '🔥' },
  { block: 'lantern', count: 2, label: 'lanterns', adj: 'shiny', nameKo: '랜턴 블록 2개', emoji: '🏮' },
  { block: 'carpet', count: 8, label: 'carpets', adj: 'soft', nameKo: '카펫 8개', emoji: '🟥' },
  { block: 'wool_white', count: 8, label: 'wool blocks', adj: 'white', nameKo: '흰 양털 8개', emoji: '⬜' },
  { block: 'wool_blue', count: 8, label: 'wool blocks', adj: 'blue', nameKo: '파란 양털 8개', emoji: '🟦' },
  { block: 'hay_bale', count: 8, label: 'hay bales', adj: 'yellow', nameKo: '건초 8개', emoji: '🌾' },
  { block: 'flower_pot_block', count: 4, label: 'flower pots', adj: 'pretty', nameKo: '화분 블록 4개', emoji: '🪴' },
  { block: 'leaves', count: 16, label: 'leaves', adj: 'green', nameKo: '나뭇잎 16개', emoji: '🍃' },
  { block: 'sand', count: 16, label: 'sand blocks', adj: 'yellow', nameKo: '모래 16개', emoji: '🏖️' },
  { block: 'iron_plate', count: 4, label: 'iron plates', adj: 'strong', nameKo: '철판 4개', emoji: '🔩' }
];

function blockPrice(key: string): number {
  const b = BLOCK_PALETTE.find((x) => x.key === key);
  if (!b || b.priceCoins <= 0) throw new Error(`shop-catalog: block ${key} has no price`);
  return b.priceCoins;
}

export const SHOP_CATALOG: readonly ShopItemDef[] = [
  // clothes
  W('hat_red', 'hat', 'red', '빨간 모자', '🎩', 60, 'Head_Socket'),
  W('cap_blue', 'cap', 'blue', '파란 야구모자', '🧢', 50, 'Head_Socket'),
  W('sunglasses', 'sunglasses', 'cool', '멋진 선글라스', '🕶️', 80, 'Head_Socket', 'some'),
  W('crown_gold', 'crown', 'gold', '금 왕관', '👑', 300, 'Head_Socket'),
  W('hoodie_green', 'hoodie', 'green', '초록 후드티', '🧥', 120, 'Body_Socket'),
  W('shirt_striped', 'shirt', 'striped', '줄무늬 셔츠', '👕', 90, 'Body_Socket'),
  W('dress_pink', 'dress', 'pink', '분홍 원피스', '👗', 120, 'Body_Socket'),
  W('coat_winter', 'coat', 'warm', '따뜻한 겨울 코트', '🧥', 200, 'Body_Socket'),
  W('sneakers_red', 'sneakers', 'red', '빨간 운동화', '👟', 100, 'Feet_Socket', 'some'),
  W('rain_boots', 'rain boots', 'yellow', '노란 장화', '🥾', 90, 'Feet_Socket', 'some'),
  W('cape_hero', 'cape', 'hero', '영웅 망토', '🦸', 250, 'Back_Socket'),
  W('wings_fairy', 'wings', 'sparkly', '반짝이 요정 날개', '🧚', 400, 'Back_Socket', 'some'),
  // tools
  T('fishing_rod', 'fishing rod', 'long', '긴 낚싯대', '🎣', 120),
  T('shovel', 'shovel', 'small', '작은 삽', '🪏', 80),
  // R2861① (Dan 11-23: "axe 를 구하러 trade market 에 갔는데 안 줌"): the axe for the open land's trees and the town's wood
  T('axe', 'axe', 'sharp', '날카로운 도끼', '🪓', 100, 'an'),
  // R2904① (Dan R2904 "곡괭이·도끼·삽·칼이 부수는 속도와 종류를 바꾸게"): the pickaxe tiers the deep ores ask for
  // (docs/03 D2 표, sim-core plot.ts pickTier: wooden pickaxe 1 → coal·iron, iron pickaxe 2 → gold·ruby, drill 3 →
  // diamond; 철 곡괭이 300·드릴 350 as the table) and the sword for the soft things (leaves, hay, wool)
  T('pickaxe', 'pickaxe', 'wooden', '나무 곡괭이', '⛏️', 120),
  T('iron_pickaxe', 'iron pickaxe', 'strong', '튼튼한 철 곡괭이', '⚒️', 300),
  T('drill', 'drill', 'powerful', '힘센 드릴', '🔩', 350),
  T('sword', 'sword', 'shiny', '반짝이는 칼', '🗡️', 150),
  T('watering_can', 'watering can', 'green', '초록 물뿌리개', '🚿', 60),
  T('magnifier', 'magnifying glass', 'big', '큰 돋보기', '🔍', 70),
  T('flashlight', 'flashlight', 'bright', '밝은 손전등', '🔦', 90),
  T('paint_brush', 'paint brush', 'blue', '파란 붓', '🖌️', 50),
  T('camera', 'camera', 'new', '새 카메라', '📷', 200),
  T('kite', 'kite', 'colorful', '알록달록 연', '🪁', 110),
  // home
  H('flower_vase', 'flower vase', 'pretty', '예쁜 꽃병', '💐', 40),
  H('rug_round', 'rug', 'round', '둥근 러그', '🟠', 70),
  H('wall_clock', 'clock', 'big', '큰 벽시계', '🕰️', 90),
  H('bookshelf', 'bookshelf', 'tall', '키 큰 책장', '📚', 150),
  H('plant_pot', 'plant', 'green', '초록 화분', '🪴', 45),
  H('picture_frame', 'picture', 'funny', '웃긴 그림 액자', '🖼️', 60),
  H('fish_tank', 'fish tank', 'blue', '파란 어항', '🐠', 220),
  H('snow_globe', 'snow globe', 'tiny', '작은 스노볼', '🔮', 80),
  // pets
  P('pet_puppy', 'puppy', 'brown', '갈색 강아지', '🐶', 400),
  P('pet_kitten', 'kitten', 'white', '하얀 고양이', '🐱', 400),
  P('pet_bunny', 'bunny', 'fluffy', '복슬복슬 토끼', '🐰', 350),
  P('pet_hamster', 'hamster', 'little', '작은 햄스터', '🐹', 250),
  P('pet_parrot', 'parrot', 'green', '초록 앵무새', '🦜', 450),
  P('pet_turtle', 'turtle', 'slow', '느린 거북이', '🐢', 300),
  P('pet_bed', 'pet bed', 'soft', '푹신한 펫 침대', '🛏️', 80),
  P('pet_bowl', 'pet bowl', 'red', '빨간 밥그릇', '🥣', 30),
  P('pet_ball', 'ball', 'bouncy', '통통 공', '⚽', 25),
  // food & water (survival: the world lane applies hunger/thirst)
  F('bread', 'bread', 'fresh', '갓 구운 빵', '🍞', 15, 30, 0, 'some'),
  F('apple', 'apple', 'red', '빨간 사과', '🍎', 10, 15, 5, 'an'),
  F('banana', 'banana', 'yellow', '노란 바나나', '🍌', 10, 15, 0),
  F('sandwich', 'sandwich', 'big', '큰 샌드위치', '🥪', 30, 50, 0),
  F('soup', 'soup', 'hot', '뜨거운 수프', '🍲', 25, 35, 15, 'some'),
  F('rice_ball', 'rice ball', 'tasty', '맛있는 주먹밥', '🍙', 20, 35, 0),
  F('cookie', 'cookie', 'sweet', '달콤한 쿠키', '🍪', 12, 10, 0),
  F('water_bottle', 'water bottle', 'cold', '시원한 물병', '💧', 10, 0, 40),
  F('juice_box', 'juice box', 'apple', '사과 주스 팩', '🧃', 15, 5, 30),
  // build blocks
  ...MATERIAL_PACKS.map(
    (m): ShopItemDef => ({
      key: `mat_${m.block}`,
      cat: 'materials',
      label: m.label,
      adj: m.adj,
      art: m.count === 1 ? 'a' : 'some',
      nameKo: m.nameKo,
      emoji: m.emoji,
      price: blockPrice(m.block) * m.count,
      socket: 'RightHand_Socket',
      block: { key: m.block, count: m.count }
    })
  )
];

export const SHOP_ITEM_MAP: ReadonlyMap<string, ShopItemDef> = new Map(SHOP_CATALOG.map((i) => [i.key, i]));

export function shopItem(key: string): ShopItemDef | undefined {
  return SHOP_ITEM_MAP.get(key);
}

/**
 * Maker's book (Dan R326 ⑪⑫ "뭘 만들지 가이드"): build ideas as pictures — blocks and things in, the build out.
 * Each is also an open build challenge (one a day, `challengeOfDay`).
 */
export interface MakeRecipeDef {
  key: string;
  /** The open goal said in English ("Build a pet house"). */
  goal: string;
  nameKo: string;
  emoji: string;
  /** Blocks (shop pack keys) and things it uses. */
  needs: ReadonlyArray<{ item: string; n: number }>;
  /** Blocks placed today that count as done (server: the plot journal). */
  placeGoal: number;
  /** A tip in English and Korean. */
  tip: string;
  tipKo: string;
}

export const MAKE_RECIPES: readonly MakeRecipeDef[] = [
  {
    key: 'pet_house',
    goal: 'Build a pet house',
    nameKo: '펫 집 짓기',
    emoji: '🐶🏠',
    needs: [
      { item: 'mat_plank', n: 1 },
      { item: 'mat_roof_tile_red', n: 1 },
      { item: 'pet_bed', n: 1 }
    ],
    placeGoal: 20,
    tip: 'Make four walls, a roof and a soft bed inside.',
    tipKo: '벽 네 개, 지붕, 안에 푹신한 침대를 놓아요.'
  },
  {
    key: 'tree_house',
    goal: 'Build a tree house',
    nameKo: '나무 위 집 짓기',
    emoji: '🌳🏡',
    needs: [
      { item: 'mat_log', n: 1 },
      { item: 'mat_plank', n: 1 },
      { item: 'mat_ladder', n: 1 },
      { item: 'mat_leaves', n: 1 }
    ],
    placeGoal: 30,
    tip: 'Stack logs up, put a floor on top and climb with a ladder.',
    tipKo: '통나무를 쌓고 위에 바닥을 깔고 사다리로 올라가요.'
  },
  {
    key: 'raft',
    goal: 'Build a raft with a sail',
    nameKo: '돛단 뗏목 만들기',
    emoji: '⛵',
    needs: [
      { item: 'mat_log', n: 1 },
      { item: 'mat_wool_white', n: 1 }
    ],
    placeGoal: 15,
    tip: 'Lay logs side by side, then a white wool sail.',
    tipKo: '통나무를 나란히 놓고 흰 양털로 돛을 세워요.'
  },
  {
    key: 'go_kart',
    goal: 'Build a go-kart',
    nameKo: '고카트 만들기',
    emoji: '🏎️',
    needs: [
      { item: 'mat_iron_plate', n: 1 },
      { item: 'mat_wool_blue', n: 1 }
    ],
    placeGoal: 12,
    tip: 'Iron plates for wheels, a blue seat in the middle.',
    tipKo: '철판으로 바퀴, 가운데에 파란 의자.'
  },
  {
    key: 'flower_garden',
    goal: 'Make a flower garden',
    nameKo: '꽃밭 만들기',
    emoji: '🌷',
    needs: [
      { item: 'mat_flower_pot_block', n: 1 },
      { item: 'mat_fence', n: 1 },
      { item: 'watering_can', n: 1 }
    ],
    placeGoal: 15,
    tip: 'Put a fence around and flower pots inside.',
    tipKo: '울타리를 두르고 안에 화분을 놓아요.'
  },
  {
    key: 'lighthouse',
    goal: 'Build a lighthouse',
    nameKo: '등대 짓기',
    emoji: '🗼',
    needs: [
      { item: 'mat_stone_brick', n: 2 },
      { item: 'mat_glass', n: 1 },
      { item: 'mat_lantern', n: 1 }
    ],
    placeGoal: 40,
    tip: 'A tall stone tower with a light at the top.',
    tipKo: '높은 돌탑 꼭대기에 불을 달아요.'
  },
  {
    key: 'cozy_room',
    goal: 'Make a cozy room',
    nameKo: '아늑한 방 꾸미기',
    emoji: '🛋️',
    needs: [
      { item: 'mat_carpet', n: 1 },
      { item: 'bookshelf', n: 1 },
      { item: 'plant_pot', n: 1 }
    ],
    placeGoal: 10,
    tip: 'A carpet, a bookshelf and a green plant.',
    tipKo: '카펫, 책장, 초록 화분을 놓아요.'
  },
  {
    key: 'market_stall',
    goal: 'Build a market stall',
    nameKo: '시장 가판대 짓기',
    emoji: '🏪',
    needs: [
      { item: 'mat_plank', n: 1 },
      { item: 'mat_wool_blue', n: 1 },
      { item: 'mat_hay_bale', n: 1 }
    ],
    placeGoal: 20,
    tip: 'A wooden table, a blue roof and boxes to sell from.',
    tipKo: '나무 탁자, 파란 지붕, 물건 상자를 놓아요.'
  }
];

const KST_MS = 9 * 3_600_000;
/** KST calendar day `YYYY-MM-DD` of a time. */
export function kstDay(nowMs: number): string {
  return new Date(nowMs + KST_MS).toISOString().slice(0, 10);
}
/** Start of the KST day that contains `nowMs`, in ms. */
export function kstDayStart(nowMs: number): number {
  const d = new Date(nowMs + KST_MS);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - KST_MS;
}

/** Today's build challenge: the same for every child on a KST day (no randomness, the server and the window agree). */
export function challengeOfDay(nowMs: number): MakeRecipeDef {
  const days = Math.floor((nowMs + KST_MS) / 86_400_000);
  return MAKE_RECIPES[days % MAKE_RECIPES.length]!;
}

/**
 * Coins (one table, AGENTS 4.10). Earned by speaking only:
 * - a passed solo sentence: stars × `soloPerStar`, once per dialog window, up to `soloDailyCap` a KST day;
 * - daily quests (`DAILY_QUESTS`), each once a KST day;
 * - lessons pay their own (lesson-mode COINS_PER_STAR).
 * Spending: the shop at list price (button) or the star price (said in English to the shopkeeper); selling back to
 * the shop gives `sellBackPct` of the list price.
 */
export const COIN_RULES = {
  soloPerStar: 5,
  soloDailyCap: 150,
  sellBackPct: 50,
  /** A child-to-child trade asks at most this many coins. */
  tradeMaxCoins: 1000,
  /** Open offers a child may have at once. */
  tradeOpenMax: 3,
  /** An open offer lapses after this. */
  tradeTtlMs: 30 * 60_000
} as const;

export type DailyQuestKey = 'talk5' | 'buy_english' | 'build_today' | 'show_build';
export interface DailyQuestDef {
  key: DailyQuestKey;
  en: string;
  ko: string;
  emoji: string;
  reward: number;
  /** Server count that must reach `goal` today. */
  goal: number;
}
export const DAILY_QUESTS: readonly DailyQuestDef[] = [
  { key: 'talk5', en: 'Say 5 sentences to people in town', ko: '마을 사람에게 문장 5개 말하기', emoji: '🗣️', reward: 30, goal: 5 },
  { key: 'buy_english', en: 'Buy something by asking in English', ko: '영어로 주문해서 하나 사기', emoji: '🛍️', reward: 20, goal: 1 },
  { key: 'build_today', en: "Today's challenge", ko: '오늘의 만들기 도전', emoji: '🏗️', reward: 50, goal: 1 },
  { key: 'show_build', en: 'Show your build to friends (showroom)', ko: '내 작품을 쇼룸에 보여 주기', emoji: '📸', reward: 30, goal: 1 }
];

/** English shop order lines for one item at a level (1★ plain, 2★ with the adjective, 3★ polite + reason). */
export function shopOrderLines(item: ShopItemDef, level: 'L1' | 'L2' | 'L3'): [string, string, string] {
  const r = SHOP_REASONS[item.cat];
  const a = item.art;
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  if (level === 'L1') {
    // The 1-star line is the bare word, unless another thing shares it (red / blue roof tiles): then the server could
    // not tell which one the child asked for, so the describing word stays in (review of PR 189).
    const shared = SHOP_CATALOG.some((o) => o.key !== item.key && o.label === item.label);
    return [
      shared ? `${cap(item.adj)} ${item.label}, please.` : `${cap(artBefore(a, item.label))} ${item.label}, please.`,
      `${cap(artBefore(a, item.adj))} ${item.adj} ${item.label}, please.`,
      `Can I have ${artBefore(a, item.adj)} ${item.adj} ${item.label}, please?`
    ];
  }
  if (level === 'L2') {
    return [
      `I want ${artBefore(a, item.adj)} ${item.adj} ${item.label}.`,
      `Can I get ${artBefore(a, item.adj)} ${item.adj} ${item.label}?`,
      `Can I get ${artBefore(a, item.adj)} ${item.adj} ${item.label} because ${r.because}?`
    ];
  }
  return [
    `I'd like ${artBefore(a, item.adj)} ${item.adj} ${item.label}, please.`,
    `Could you sell me ${artBefore(a, item.adj)} ${item.adj} ${item.label}?`,
    `Could you sell me ${artBefore(a, item.adj)} ${item.adj} ${item.label} so that ${r.soThat}?`
  ];
}

/** The article in front of the adjective: "an orange", "a red", "some". */
function artBefore(a: ShopItemDef['art'], next: string): string {
  if (a === 'some') return 'some';
  return /^[aeiou]/i.test(next) ? 'an' : 'a';
}

/**
 * Child-to-child trade lines (WP-509 "양쪽 발화 후에만 성사", Dan R326 ⑫): the seller offers in English, the buyer
 * asks in English; the server scores both before anything moves.
 */
export function tradeLines(itemKey: string): { offer: string; accept: string } {
  const i = shopItem(itemKey);
  const name = i ? `${i.adj} ${i.label}` : itemKey.replace(/^furn_/, '').replace(/_/g, ' ');
  return { offer: `Do you want my ${name}?`, accept: `Can I buy your ${name}, please?` };
}
