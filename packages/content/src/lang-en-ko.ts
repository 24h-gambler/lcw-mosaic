import { SHOP_CATALOG, shopOrderLines } from './shop-catalog.js';

export type LangLevel = 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6';

export interface PhraseOffer {
  stars: 1 | 2 | 3;
  text: string;
  price: number;
  bonus: string | null;
}

export interface PhraseBankEntry {
  id: string;
  lang: 'en';
  ctx: string;
  intent: string;
  slotsKey: string;
  level: LangLevel;
  offers: [PhraseOffer, PhraseOffer, PhraseOffer];
  hintTags: string[];
  baseMesh: string;
  socket: 'Head_Socket' | 'Body_Socket' | 'Back_Socket' | 'Feet_Socket' | 'RightHand_Socket' | 'Mount_Socket';
}

export const LANG_PACK_MANIFEST = {
  id: 'en-ko',
  target_lang: 'en',
  l1: 'ko',
  stt_model: 'whisper-small',
  voices: [
    { id: 'voice_london_tea', accent: 'en-GB', rateDefault: 0.95 },
    { id: 'voice_nyc_maker', accent: 'en-US', rateDefault: 1.0 },
    { id: 'voice_plaza_guide', accent: 'en-US', rateDefault: 0.9 }
  ]
} as const;

export const LEVEL_DEFINITIONS: Record<
  LangLevel,
  { cefr: string; maxWords: number; passThreshold: number; speechRate: number }
> = {
  L1: { cefr: 'Starter', maxWords: 6, passThreshold: 0.6, speechRate: 0.9 },
  L2: { cefr: 'A1', maxWords: 10, passThreshold: 0.6, speechRate: 0.9 },
  L3: { cefr: 'A2', maxWords: 18, passThreshold: 0.65, speechRate: 1.0 },
  L4: { cefr: 'B1', maxWords: 24, passThreshold: 0.7, speechRate: 1.0 },
  L5: { cefr: 'B1+', maxWords: 30, passThreshold: 0.75, speechRate: 1.0 },
  L6: { cefr: 'B2', maxWords: 30, passThreshold: 0.75, speechRate: 1.0 }
};

export const CONNECTORS = [
  'because',
  'so',
  'if',
  'when',
  'that',
  'so that',
  'in order to',
  'instead of',
  'as soon as',
  'before',
  'after',
  'although',
  'unless'
] as const;

export const FUNCTION_WORDS = new Set([
  'a',
  'an',
  'the',
  'i',
  'you',
  'we',
  'he',
  'she',
  'it',
  'they',
  'me',
  'my',
  'your',
  'our',
  'is',
  'am',
  'are',
  'was',
  'were',
  'be',
  'been',
  'can',
  'could',
  'would',
  'will',
  'shall',
  'should',
  'may',
  'might',
  'do',
  'does',
  'did',
  'have',
  'has',
  'had',
  'to',
  'for',
  'of',
  'with',
  'in',
  'on',
  'at',
  'by',
  'from',
  'as',
  'so',
  'that',
  'if',
  'when',
  'because',
  'and',
  'or',
  'but',
  'please',
  'this',
  'that',
  'these',
  'those',
  'not',
  'no',
  'yes'
]);

/**
 * Korean -> English normalization dictionary (docs/04 4.4).
 * Keys are matched longest-first during mixed-utterance normalization.
 */
export const LEXICON_L1_KO_EN: Record<string, string> = {
  // Speech-bubble chatter (docs/04 4.12)
  '이거': 'this',
  '어디': 'where',
  '어디예요': 'where is',
  '어디에요': 'where is',
  '카페': 'cafe',
  '교환 상점': 'trade shop',
  '상점': 'shop',
  '보여주세요': 'show me',
  '알려주세요': 'tell me',
  '놔': 'put',
  '놓아': 'put',
  // Colors
  '빨간색': 'red',
  '빨강': 'red',
  '빨간': 'red',
  '파란색': 'blue',
  '파랑': 'blue',
  '파란': 'blue',
  '초록색': 'green',
  '초록': 'green',
  '노란색': 'yellow',
  '노랑': 'yellow',
  '노란': 'yellow',
  '보라색': 'purple',
  '보라': 'purple',
  '주황색': 'orange',
  '검은색': 'black',
  '검정': 'black',
  '하얀색': 'white',
  '하양': 'white',
  '은색': 'silver',
  '금색': 'gold',

  // Cafe drinks (12)
  '물': 'water',
  '우유': 'milk',
  '차': 'tea',
  '주스': 'juice',
  '스무디': 'smoothie',
  '핫초코': 'hot chocolate',
  '레모네이드': 'lemonade',
  '사과주스': 'apple juice',
  '딸기스무디': 'berry smoothie',
  '베리스무디': 'berry smoothie',
  '민트티': 'mint tea',
  '아이스티': 'iced tea',
  '코코아': 'cocoa',
  '꿀차': 'honey tea',
  '꿀': 'honey',
  '빵': 'bread',

  // Cafe modifiers (6)
  '차가운': 'cold',
  '시원한': 'cold',
  '따뜻한': 'warm',
  '달콤한': 'sweet',
  '단': 'sweet',
  '큰': 'large',
  '작은': 'small',
  '신선한': 'fresh',
  '생': 'fresh',

  // Makers lab & Boutique items
  '제트팩': 'jetpack',
  '곡괭이': 'pickaxe',
  '철곡괭이': 'iron pickaxe',
  '드릴': 'drill',
  '부츠': 'boots',
  '우산': 'umbrella',
  '우비': 'raincoat',
  '비옷': 'raincoat',
  '코트': 'coat',
  '정장': 'suit',
  '헬멧': 'helmet',
  '물폭탄': 'water balloon',
  '다이너마이트': 'dynamite',
  '방한복': 'winter coat',
  '방열복': 'heat suit',
  '우주복': 'space suit',
  '검': 'sword',
  '지팡이': 'wand',
  '활': 'bow',
  '호박': 'pumpkin',

  // Building & Mining
  '벽돌': 'brick',
  '유리': 'glass',
  '나무': 'wood',
  '판자': 'plank',
  '돌': 'stone',
  '석탄': 'coal',
  '철': 'iron',
  '금': 'gold',
  '루비': 'ruby',
  '다이아몬드': 'diamond',
  '네더크리스탈': 'nether crystal',

  // Modifiers, speed, size, quantifiers & polite phrases
  '빠른': 'fast',
  '빛나는': 'glowing',
  '튼튼한': 'strong',
  '높이': 'high',
  '멀리': 'far',
  '하나': 'one',
  '한': 'one',
  '두': 'two',
  '둘': 'two',
  '세': 'three',
  '셋': 'three',
  '다섯': 'five',
  '열': 'ten',
  '주세요': 'please',
  '부탁해요': 'please',
  '원해요': 'want',
  '사고싶어요': 'want to buy',
  '만들어주세요': 'build',
  '날고싶어요': 'want to fly',
  '목말라요': 'am thirsty',
  '배고파요': 'am hungry',
  '죄송해요': 'sorry',
  '실수였어요': 'was a mistake',
  '약속할게요': 'promise',

  // Trade shop (barter) goods and verbs
  '랜턴': 'lantern',
  '지도': 'map',
  '밧줄': 'rope',
  '가방': 'backpack',
  '배낭': 'backpack',
  '나침반': 'compass',
  '바꿔주세요': 'trade please',
  '바꿔요': 'trade',
  '교환': 'trade',
  '줄게요': 'will give'
};

/**
 * Cafe menu (WP-107: 12 drinks x 6 modifiers). `temp` keeps the bank from teaching nonsense such as
 * "cold hot chocolate" or "warm iced tea": a modifier that clashes with the drink is answered with the
 * drink's `defaultMod` sentences instead (the child still gets a complete 1~3 star set).
 */
export interface CafeDrinkDef {
  key: string;
  label: string;
  nameKo: string;
  /** Picture shown on the thought board and for the `picture` hint level. */
  emoji: string;
  basePrice: number;
  /** Modifiers that read naturally with this drink; the others resolve to `defaultMod`. */
  mods: readonly CafeModifier[];
  defaultMod: CafeModifier;
  /** Ordering article: 'some' for water and milk ("some cold water"), 'a' for a served drink ("a cold smoothie"). */
  article?: 'a' | 'some';
}

export const CAFE_MODIFIERS = ['cold', 'warm', 'sweet', 'large', 'small', 'fresh'] as const;
export type CafeModifier = (typeof CAFE_MODIFIERS)[number];

export const CAFE_MODIFIER_INFO: Record<CafeModifier, { nameKo: string; emoji: string }> = {
  cold: { nameKo: '차가운', emoji: '🧊' },
  warm: { nameKo: '따뜻한', emoji: '♨️' },
  sweet: { nameKo: '달콤한', emoji: '🍯' },
  large: { nameKo: '큰', emoji: '⬆️' },
  small: { nameKo: '작은', emoji: '⬇️' },
  fresh: { nameKo: '신선한', emoji: '🌿' }
};

const ALL_MODS = CAFE_MODIFIERS;
const NO_WARM = ['cold', 'sweet', 'large', 'small', 'fresh'] as const;

export const CAFE_DRINKS: readonly CafeDrinkDef[] = [
  { key: 'water', label: 'water', nameKo: '물', emoji: '💧', basePrice: 20, mods: ['cold', 'warm', 'large', 'small', 'fresh'], defaultMod: 'cold', article: 'some' },
  { key: 'milk', label: 'milk', nameKo: '우유', emoji: '🥛', basePrice: 25, mods: ALL_MODS, defaultMod: 'warm', article: 'some' },
  { key: 'tea', label: 'tea', nameKo: '차', emoji: '🍵', basePrice: 30, mods: ['cold', 'warm', 'sweet', 'large', 'small'], defaultMod: 'warm' },
  { key: 'juice', label: 'juice', nameKo: '주스', emoji: '🧃', basePrice: 35, mods: NO_WARM, defaultMod: 'cold' },
  { key: 'smoothie', label: 'smoothie', nameKo: '스무디', emoji: '🥤', basePrice: 50, mods: NO_WARM, defaultMod: 'cold' },
  { key: 'hot_chocolate', label: 'hot chocolate', nameKo: '핫초코', emoji: '☕', basePrice: 45, mods: ['sweet', 'large', 'small'], defaultMod: 'sweet' },
  { key: 'lemonade', label: 'lemonade', nameKo: '레모네이드', emoji: '🍋', basePrice: 40, mods: NO_WARM, defaultMod: 'cold' },
  { key: 'apple_juice', label: 'apple juice', nameKo: '사과주스', emoji: '🍎', basePrice: 40, mods: NO_WARM, defaultMod: 'cold' },
  { key: 'berry_smoothie', label: 'berry smoothie', nameKo: '베리스무디', emoji: '🍓', basePrice: 60, mods: NO_WARM, defaultMod: 'cold' },
  { key: 'mint_tea', label: 'mint tea', nameKo: '민트티', emoji: '🌱', basePrice: 35, mods: ALL_MODS, defaultMod: 'warm' },
  { key: 'iced_tea', label: 'iced tea', nameKo: '아이스티', emoji: '🧋', basePrice: 35, mods: ['sweet', 'large', 'small', 'fresh'], defaultMod: 'sweet' },
  { key: 'cocoa', label: 'cocoa', nameKo: '코코아', emoji: '🍫', basePrice: 45, mods: ['warm', 'sweet', 'large', 'small'], defaultMod: 'warm' }
];

/** The honey cafe's own drink (first lesson plan, cafe_order). Sold beside the 12 WP-107 drinks. */
export const CAFE_SIGNATURE_DRINKS: readonly CafeDrinkDef[] = [
  { key: 'honey_tea', label: 'honey tea', nameKo: '꿀차', emoji: '🍯', basePrice: 40, mods: ['warm', 'sweet', 'large', 'small'], defaultMod: 'warm' }
];

export const CAFE_MENU: readonly CafeDrinkDef[] = [...CAFE_DRINKS, ...CAFE_SIGNATURE_DRINKS];

/**
 * Price factor by granted star grade (docs/04 4.2 cafe/boutique/makers: list price, 20% off, 50% off).
 * The server charges `round(basePrice * factor)` for the stars it granted, never a client-sent price.
 */
export const STAR_PRICE_FACTOR: Record<1 | 2 | 3, number> = { 1: 1, 2: 0.8, 3: 0.5 };

export function starPrice(basePrice: number, stars: 1 | 2 | 3): number {
  return Math.round(basePrice * STAR_PRICE_FACTOR[stars]);
}

function buildCafeOffers(
  drinkLabel: string,
  modifier: string,
  basePrice: number,
  level: LangLevel,
  art: 'a' | 'some' = 'a'
): [PhraseOffer, PhraseOffer, PhraseOffer] {
  // "a cold smoothie" / "some cold water": full sentences keep the article; only the L1 fragments drop it.
  const p1 = starPrice(basePrice, 1);
  const p2 = starPrice(basePrice, 2);
  const p3 = starPrice(basePrice, 3);

  if (level === 'L1') {
    return [
      { stars: 1, text: `${capitalize(drinkLabel)}, please.`, price: p1, bonus: null },
      { stars: 2, text: `${capitalize(modifier)} ${drinkLabel}, please.`, price: p2, bonus: null },
      {
        stars: 3,
        text: `Can I have ${art} ${modifier} ${drinkLabel}, please?`,
        price: p3,
        bonus: 'thirst_buff_3m'
      }
    ];
  }
  if (level === 'L2') {
    return [
      { stars: 1, text: `I want ${art} ${modifier} ${drinkLabel}, please.`, price: p1, bonus: null },
      {
        stars: 2,
        text: `Can I get ${art} ${modifier} ${drinkLabel}?`,
        price: p2,
        bonus: null
      },
      {
        stars: 3,
        text: `Can I get ${art} ${modifier} ${drinkLabel} because I am thirsty?`,
        price: p3,
        bonus: 'thirst_buff_3m'
      }
    ];
  }
  return [
    { stars: 1, text: `I'd like ${art} ${modifier} ${drinkLabel}, please.`, price: p1, bonus: null },
    {
      stars: 2,
      text: `Could you make ${art} ${modifier} ${drinkLabel} for me?`,
      price: p2,
      bonus: null
    },
    {
      stars: 3,
      text: `I'd love ${art} ${modifier} ${drinkLabel} so that I can keep exploring the town.`,
      price: p3,
      bonus: 'thirst_buff_3m'
    }
  ];
}

/** Hint tags per level: the item words plus the level's core pattern (docs/04 4.6 core tokens). */
function cafeHintTags(level: LangLevel, modifier: string, drinkLabel: string): string[] {
  if (level === 'L1') return [drinkLabel, modifier, 'can I have'];
  // The 3-star clause connector is the only core pattern at L2, so a 3-star order without it cannot pass.
  if (level === 'L2') return [drinkLabel, modifier, 'because'];
  return [drinkLabel, modifier, 'could you', 'so that'];
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

const GENERATED_CAFE_BANK: PhraseBankEntry[] = [];
for (const level of ['L1', 'L2', 'L3'] as const) {
  for (const drink of CAFE_MENU) {
    // The default modifier comes first so a clashing modifier falls back to it (lookupPhraseBank same-item fallback).
    const mods = [drink.defaultMod, ...drink.mods.filter((m) => m !== drink.defaultMod)];
    for (const mod of mods) {
      GENERATED_CAFE_BANK.push({
        id: `cafe_${level}_${drink.key}_${mod}`,
        lang: 'en',
        ctx: 'cafe',
        intent: 'order_drink',
        slotsKey: `item=${drink.key}|mod=${mod}`,
        level,
        offers: buildCafeOffers(drink.label, mod, drink.basePrice, level, drink.article ?? 'a'),
        hintTags: cafeHintTags(level, mod, drink.label),
        baseMesh: 'item_cup_01',
        socket: 'RightHand_Socket'
      });
    }
  }
}

/**
 * Trade shop goods (docs/19 trade_shop, first lesson trade_roleplay). Barter sentences: the child offers one of
 * their own things for a shop good and says why. Coins do not move on these (price 0); the item swap itself is the
 * atomic /v1/worlds/:id/trades settlement.
 */
export interface ShopGoodDef {
  key: string;
  label: string;
  adj: string;
  nameKo: string;
  emoji: string;
  /** What the child offers in exchange. */
  give: string;
  /** Why the child needs it (3-star clause). */
  need: string;
  baseValueCoins: number;
}

export const TRADE_SHOP_GOODS: readonly ShopGoodDef[] = [
  { key: 'helmet', label: 'helmet', adj: 'red', nameKo: '빨간 헬멧', emoji: '⛑️', give: 'my blue stone', need: 'I need a helmet for the cave', baseValueCoins: 80 },
  { key: 'lantern', label: 'lantern', adj: 'bright', nameKo: '밝은 랜턴', emoji: '🏮', give: 'my iron ore', need: 'it is dark at night', baseValueCoins: 60 },
  { key: 'map', label: 'map', adj: 'old', nameKo: '오래된 지도', emoji: '🗺️', give: 'my gold coin', need: 'I want to find the island', baseValueCoins: 70 },
  { key: 'rope', label: 'rope', adj: 'long', nameKo: '긴 밧줄', emoji: '🪢', give: 'my wood planks', need: 'I want to climb the hill', baseValueCoins: 40 },
  { key: 'boots', label: 'boots', adj: 'green', nameKo: '초록 부츠', emoji: '🥾', give: 'my red apple', need: 'my feet are cold', baseValueCoins: 50 },
  { key: 'backpack', label: 'backpack', adj: 'big', nameKo: '큰 가방', emoji: '🎒', give: 'my two shells', need: 'I have many things', baseValueCoins: 60 },
  { key: 'umbrella', label: 'umbrella', adj: 'yellow', nameKo: '노란 우산', emoji: '☂️', give: 'my blue stone', need: 'it is raining outside', baseValueCoins: 40 },
  { key: 'compass', label: 'compass', adj: 'shiny', nameKo: '반짝이는 나침반', emoji: '🧭', give: 'my silver ring', need: 'I do not want to get lost', baseValueCoins: 90 }
];

function buildShopOffers(g: ShopGoodDef, level: LangLevel): [PhraseOffer, PhraseOffer, PhraseOffer] {
  if (level === 'L1') {
    return [
      { stars: 1, text: `The ${g.label}, please.`, price: 0, bonus: null },
      { stars: 2, text: `I want the ${g.adj} ${g.label}.`, price: 0, bonus: null },
      { stars: 3, text: `Can I trade ${g.give} for the ${g.label}?`, price: 0, bonus: 'trade_fee_off' }
    ];
  }
  if (level === 'L2') {
    return [
      { stars: 1, text: `I want the ${g.adj} ${g.label}.`, price: 0, bonus: null },
      { stars: 2, text: `Can I trade ${g.give} for the ${g.label}?`, price: 0, bonus: null },
      { stars: 3, text: `I want to trade ${g.give} for the ${g.label} because ${g.need}.`, price: 0, bonus: 'trade_fee_off' }
    ];
  }
  return [
    { stars: 1, text: `I'd like to trade for the ${g.adj} ${g.label}.`, price: 0, bonus: null },
    { stars: 2, text: `Could you give me the ${g.label} for ${g.give}?`, price: 0, bonus: null },
    {
      stars: 3,
      text: `I will give you ${g.give} for the ${g.label} because ${g.need}.`,
      price: 0,
      bonus: 'trade_fee_off'
    }
  ];
}

const GENERATED_SHOP_BANK: PhraseBankEntry[] = [];
for (const level of ['L1', 'L2', 'L3'] as const) {
  for (const g of TRADE_SHOP_GOODS) {
    GENERATED_SHOP_BANK.push({
      id: `trade_shop_${level}_${g.key}`,
      lang: 'en',
      ctx: 'trade_shop',
      intent: 'trade_item',
      slotsKey: `item=${g.key}|mod=${g.adj}`,
      level,
      offers: buildShopOffers(g, level),
      hintTags:
        level === 'L1'
          ? [g.label, 'can I trade', 'for']
          : level === 'L2'
            ? [g.label, 'can I trade', 'because']
            : [g.label, 'could you', 'because'],
      baseMesh: 'item_crate_01',
      socket: 'RightHand_Socket'
    });
  }
}

/**
 * Furniture at the trade shop (docs/03 D13 "가구는 상점에서 삽니다", world plan: Toby's shop sells it). Unlike the
 * barter goods these cost coins at the star prices of docs/04 4.2. `role` is the furniture kind of the room check
 * (light / rest / flat): reading the room's missing-condition sentence aloud gives 10% off that kind once a day
 * (`claimReadAloudDiscount`, applied by the server on purchase). Listed after the barter goods so the shop's default
 * offers stay the barter lines of the first lesson.
 */
export interface FurnitureGoodDef {
  key: string;
  role: 'light' | 'rest' | 'flat';
  label: string;
  adj: string;
  nameKo: string;
  emoji: string;
  basePrice: number;
}

export const FURNITURE_SHOP_GOODS: readonly FurnitureGoodDef[] = [
  { key: 'furn_lamp_table', role: 'light', label: 'table lamp', adj: 'yellow', nameKo: '노란 탁상 램프', emoji: '💡', basePrice: 60 },
  { key: 'furn_lamp_floor', role: 'light', label: 'floor lamp', adj: 'tall', nameKo: '키 큰 스탠드', emoji: '🪔', basePrice: 80 },
  { key: 'furn_lantern_wall', role: 'light', label: 'wall lantern', adj: 'small', nameKo: '작은 벽 랜턴', emoji: '🏮', basePrice: 50 },
  { key: 'furn_bed_single', role: 'rest', label: 'bed', adj: 'blue', nameKo: '파란 침대', emoji: '🛏️', basePrice: 120 },
  { key: 'furn_chair_wood', role: 'rest', label: 'chair', adj: 'wooden', nameKo: '나무 의자', emoji: '🪑', basePrice: 40 },
  { key: 'furn_sofa_cozy', role: 'rest', label: 'sofa', adj: 'soft', nameKo: '푹신한 소파', emoji: '🛋️', basePrice: 110 },
  { key: 'furn_table_dining', role: 'flat', label: 'table', adj: 'round', nameKo: '둥근 탁자', emoji: '🍽️', basePrice: 90 },
  { key: 'furn_desk_study', role: 'flat', label: 'desk', adj: 'small', nameKo: '작은 책상', emoji: '🗄️', basePrice: 70 },
  { key: 'furn_workbench', role: 'flat', label: 'workbench', adj: 'big', nameKo: '큰 작업대', emoji: '🧰', basePrice: 100 }
];

const FURNITURE_REASON: Record<FurnitureGoodDef['role'], { why: string; so: string }> = {
  light: { why: 'my room is dark', so: 'my room is bright' },
  rest: { why: 'I need a place to rest', so: 'I can rest at home' },
  flat: { why: 'I need a place to eat', so: 'I can eat at home' }
};

function buildFurnitureOffers(g: FurnitureGoodDef, level: LangLevel): [PhraseOffer, PhraseOffer, PhraseOffer] {
  const p = (s: 1 | 2 | 3) => starPrice(g.basePrice, s);
  const r = FURNITURE_REASON[g.role];
  if (level === 'L1') {
    return [
      { stars: 1, text: `A ${g.label}, please.`, price: p(1), bonus: null },
      { stars: 2, text: `A ${g.adj} ${g.label}, please.`, price: p(2), bonus: null },
      { stars: 3, text: `Can I have a ${g.adj} ${g.label}, please?`, price: p(3), bonus: null }
    ];
  }
  if (level === 'L2') {
    return [
      { stars: 1, text: `I want a ${g.adj} ${g.label}.`, price: p(1), bonus: null },
      { stars: 2, text: `Can I get a ${g.adj} ${g.label}?`, price: p(2), bonus: null },
      { stars: 3, text: `Can I get a ${g.adj} ${g.label} because ${r.why}?`, price: p(3), bonus: null }
    ];
  }
  return [
    { stars: 1, text: `I'd like a ${g.adj} ${g.label}, please.`, price: p(1), bonus: null },
    { stars: 2, text: `Could you sell me a ${g.adj} ${g.label} for my room?`, price: p(2), bonus: null },
    { stars: 3, text: `Could you sell me a ${g.adj} ${g.label} so that ${r.so}?`, price: p(3), bonus: null }
  ];
}

const GENERATED_FURNITURE_BANK: PhraseBankEntry[] = [];
for (const level of ['L1', 'L2', 'L3'] as const) {
  for (const g of FURNITURE_SHOP_GOODS) {
    GENERATED_FURNITURE_BANK.push({
      id: `trade_shop_${level}_${g.key}`,
      lang: 'en',
      ctx: 'trade_shop',
      intent: 'buy_furniture',
      slotsKey: `item=${g.key}|mod=${g.adj}`,
      level,
      offers: buildFurnitureOffers(g, level),
      hintTags:
        level === 'L1' ? [g.label, 'can I have', 'please'] : level === 'L2' ? [g.label, 'can I get', 'because'] : [g.label, 'could you', 'so that'],
      baseMesh: 'item_crate_01',
      socket: 'RightHand_Socket'
    });
  }
}

/** Furniture kind (room-check role) of a shop item key, or null when the item is not furniture. */
export function furnitureKindOf(itemKey: string): FurnitureGoodDef['role'] | null {
  return FURNITURE_SHOP_GOODS.find((g) => g.key === itemKey)?.role ?? null;
}

/**
 * Plaza guide (docs/19 guide NPC, WP-111 first visit): asking the way. Nothing is sold (price 0, no item); the
 * server answers with the place key so the world can point the way.
 */
export interface GuidePlaceDef {
  key: string;
  label: string;
  nameKo: string;
  emoji: string;
  /** Why the child is going there (2-star L2 / 3-star clauses). */
  why: string;
  /** What the child will do there (L3 3-star "so that" clause). */
  todo: string;
}

export const GUIDE_PLACES: readonly GuidePlaceDef[] = [
  { key: 'cafe', label: 'cafe', nameKo: '카페', emoji: '☕', why: 'I am thirsty', todo: 'buy a drink' },
  { key: 'trade_shop', label: 'trade shop', nameKo: '교환 상점', emoji: '🏪', why: 'I want to trade my stone', todo: 'trade my things' }
];

function buildGuideOffers(p: GuidePlaceDef, level: LangLevel): [PhraseOffer, PhraseOffer, PhraseOffer] {
  if (level === 'L1') {
    return [
      { stars: 1, text: `The ${p.label}, please.`, price: 0, bonus: null },
      { stars: 2, text: `Where is the ${p.label}?`, price: 0, bonus: null },
      { stars: 3, text: `Excuse me, where is the ${p.label}?`, price: 0, bonus: null }
    ];
  }
  if (level === 'L2') {
    return [
      { stars: 1, text: `Where is the ${p.label}?`, price: 0, bonus: null },
      { stars: 2, text: `Can you show me the ${p.label}?`, price: 0, bonus: null },
      { stars: 3, text: `Can you show me the ${p.label} because ${p.why}?`, price: 0, bonus: null }
    ];
  }
  return [
    { stars: 1, text: `I'm looking for the ${p.label}.`, price: 0, bonus: null },
    { stars: 2, text: `Could you tell me where the ${p.label} is?`, price: 0, bonus: null },
    { stars: 3, text: `Could you tell me where the ${p.label} is so that I can ${p.todo}?`, price: 0, bonus: null }
  ];
}

const GENERATED_GUIDE_BANK: PhraseBankEntry[] = [];
for (const level of ['L1', 'L2', 'L3'] as const) {
  for (const p of GUIDE_PLACES) {
    GENERATED_GUIDE_BANK.push({
      id: `guide_${level}_${p.key}`,
      lang: 'en',
      ctx: 'guide',
      intent: 'ask_way',
      slotsKey: `item=${p.key}|kind=place`,
      level,
      offers: buildGuideOffers(p, level),
      hintTags: level === 'L1' ? [p.label, 'where is'] : level === 'L2' ? [p.label, 'because'] : [p.label, 'could you', 'so that'],
      baseMesh: 'item_signpost_01',
      socket: 'RightHand_Socket'
    });
  }
}

/**
 * First-visit 1-minute errand (docs/03 D1 "첫 방문 섹터의 카페 앞에는 반드시 1분 심부름 NPC", D3 +50 coins, WP-111):
 * the errand giver asks for a drink from the honey cafe; the child agrees, orders that drink from the cafe owner (the first
 * order), and hands it over. Accepting and handing over sell nothing (price 0); the server moves the errand and pays
 * the reward from the ledger.
 */
export interface ErrandDef {
  key: string;
  /** The cafe drink the giver asks for (CAFE_MENU key + modifier, so the cafe owner's offers match it). */
  item: string;
  mod: string;
  itemKo: string;
  /** What the giver says when the child comes, by errand state. */
  lines: { ask: string; waiting: string; deliver: string; thanks: string };
}

export const FIRST_ERRAND: ErrandDef = {
  key: 'first',
  item: 'water',
  mod: 'cold',
  itemKo: '시원한 물',
  lines: {
    ask: "Hi! I'm super thirsty. Can you get me some cold water from the honey cafe?",
    waiting: "The honey cafe's right over there! Can you get me some cold water?",
    deliver: "You're back! Is that my cold water?",
    thanks: 'Thank you so much! Here, 50 coins for you.'
  }
};

export type ErrandStep = 'errand_accept' | 'errand_deliver';

function buildErrandOffers(step: ErrandStep, level: LangLevel): [PhraseOffer, PhraseOffer, PhraseOffer] {
  const o = (texts: [string, string, string]): [PhraseOffer, PhraseOffer, PhraseOffer] => [
    { stars: 1, text: texts[0], price: 0, bonus: null },
    { stars: 2, text: texts[1], price: 0, bonus: null },
    { stars: 3, text: texts[2], price: 0, bonus: null }
  ];
  if (step === 'errand_accept') {
    if (level === 'L1') return o(['Okay, I can go.', 'Yes, I can help you.', 'Yes, I can help you. I will go now.']);
    if (level === 'L2') return o(['Sure, I can help.', 'Sure, I can get it for you.', 'Sure, I can get it for you because you are thirsty.']);
    return o(["No problem, I'll get it.", "Of course, I'd be happy to get it for you.", "Of course, I'll get it for you so that you can drink something cold."]);
  }
  if (level === 'L1') return o(['Here you are.', 'Here is your water.', 'Here is your cold water. Enjoy!']);
  if (level === 'L2') return o(['Here is your water.', 'I got your cold water for you.', 'I got your cold water for you because you were thirsty.']);
  return o(["Here's the water you wanted.", 'I brought the cold water you asked for.', 'I brought the cold water you asked for so that you can cool down.']);
}

const GENERATED_ERRAND_BANK: PhraseBankEntry[] = [];
for (const level of ['L1', 'L2', 'L3'] as const) {
  for (const step of ['errand_accept', 'errand_deliver'] as const) {
    GENERATED_ERRAND_BANK.push({
      id: `errand_${level}_${step}`,
      lang: 'en',
      ctx: 'errand',
      intent: step,
      slotsKey: `item=${step}|kind=errand`,
      level,
      offers: buildErrandOffers(step, level),
      hintTags:
        step === 'errand_accept'
          ? level === 'L1' ? ['help', 'I can'] : level === 'L2' ? ['get it', 'because'] : ["I'd be happy", 'so that']
          : level === 'L1' ? ['here', 'water'] : level === 'L2' ? ['water', 'because'] : ['brought', 'so that'],
      baseMesh: 'item_crate_01',
      socket: 'RightHand_Socket'
    });
  }
}

/**
 * The town shop (Dan R326 ⑪, shop-catalog.ts) at Toby's trade shop: saying the order in English buys the thing at
 * the star price (1★ list, 2★ 20% off, 3★ 50% off, STAR_PRICE_FACTOR) through the same server purchase path as the
 * furniture. Listed after the barter goods so the shop's default lines stay the first lesson's.
 */
const GENERATED_TOWN_SHOP_BANK: PhraseBankEntry[] = [];
for (const level of ['L1', 'L2', 'L3'] as const) {
  for (const g of SHOP_CATALOG) {
    const [t1, t2, t3] = shopOrderLines(g, level);
    GENERATED_TOWN_SHOP_BANK.push({
      id: `trade_shop_${level}_${g.key}`,
      lang: 'en',
      ctx: 'trade_shop',
      intent: 'buy_good',
      slotsKey: `item=${g.key}|mod=${g.adj.toLowerCase().replace(/\s+/g, '_')}`,
      level,
      offers: [
        { stars: 1, text: t1, price: starPrice(g.price, 1), bonus: null },
        { stars: 2, text: t2, price: starPrice(g.price, 2), bonus: null },
        { stars: 3, text: t3, price: starPrice(g.price, 3), bonus: null }
      ],
      hintTags: level === 'L1' ? [g.label, 'can I have', 'please'] : level === 'L2' ? [g.label, 'can I get', 'because'] : [g.label, 'could you', 'so that'],
      baseMesh: 'item_crate_01',
      socket: g.socket
    });
  }
}

const DOMAIN_BANK_ENTRIES: PhraseBankEntry[] = [
  {
    id: 'makers_lab_L3_jetpack_red',
    lang: 'en',
    ctx: 'makers_lab',
    intent: 'order_item',
    slotsKey: 'item=jetpack|color=red',
    level: 'L3',
    offers: [
      { stars: 1, text: "I'd like a red jetpack, please.", price: 2000, bonus: null },
      {
        stars: 2,
        text: 'Could you build a fast red jetpack with a big fuel tank?',
        price: 1600,
        bonus: null
      },
      {
        stars: 3,
        text: "I'm looking for a fuel-efficient red jetpack so that I can fly to the space station.",
        price: 1000,
        bonus: 'fuel_x2'
      }
    ],
    hintTags: ['fuel-efficient', 'so that', 'space station'],
    baseMesh: 'item_jetpack_01',
    socket: 'Back_Socket'
  },
  {
    id: 'makers_lab_L2_jetpack_red',
    lang: 'en',
    ctx: 'makers_lab',
    intent: 'order_item',
    slotsKey: 'item=jetpack|color=red',
    level: 'L2',
    offers: [
      { stars: 1, text: 'I want a red jetpack.', price: 2000, bonus: null },
      { stars: 2, text: 'Can I get a fast red jetpack?', price: 1600, bonus: null },
      {
        stars: 3,
        text: 'Can I get a red jetpack? I want to fly high.',
        price: 1000,
        bonus: 'fuel_x2'
      }
    ],
    hintTags: ['red jetpack', 'fast', 'fly high'],
    baseMesh: 'item_jetpack_01',
    socket: 'Back_Socket'
  },
  {
    id: 'makers_lab_L2_pickaxe_iron',
    lang: 'en',
    ctx: 'makers_lab',
    intent: 'order_item',
    slotsKey: 'item=pickaxe|mod=iron',
    level: 'L2',
    offers: [
      { stars: 1, text: 'I want an iron pickaxe.', price: 300, bonus: null },
      { stars: 2, text: 'Can I get a strong iron pickaxe?', price: 240, bonus: null },
      {
        stars: 3,
        text: 'Can I get a strong iron pickaxe to mine gold?',
        price: 150,
        bonus: 'durability_plus'
      }
    ],
    hintTags: ['iron pickaxe', 'strong', 'mine gold'],
    baseMesh: 'item_pickaxe_01',
    socket: 'RightHand_Socket'
  },
  {
    id: 'boutique_L2_raincoat_yellow',
    lang: 'en',
    ctx: 'boutique',
    intent: 'order_outfit',
    slotsKey: 'item=raincoat|color=yellow',
    level: 'L2',
    offers: [
      { stars: 1, text: 'I want a yellow raincoat.', price: 400, bonus: null },
      { stars: 2, text: 'Can I try a warm yellow raincoat?', price: 320, bonus: null },
      {
        stars: 3,
        text: 'I need a yellow raincoat because it is raining outside.',
        price: 200,
        bonus: 'rare_color'
      }
    ],
    hintTags: ['yellow raincoat', 'because', 'raining'],
    baseMesh: 'item_coat_01',
    socket: 'Body_Socket'
  },
  {
    id: 'exchange_L2_gold_sell',
    lang: 'en',
    ctx: 'exchange',
    intent: 'sell_ore',
    slotsKey: 'item=gold|mod=sell',
    level: 'L2',
    offers: [
      { stars: 1, text: 'I want to sell this gold.', price: 0, bonus: 'market_base' },
      { stars: 2, text: 'Could you give me ten percent more for this gold?', price: 0, bonus: 'plus_10' },
      {
        stars: 3,
        text: 'If you offer twenty-five percent more, I will sell all my gold today.',
        price: 0,
        bonus: 'plus_25'
      }
    ],
    hintTags: ['gold', 'if you offer', 'sell'],
    baseMesh: 'item_ingot_gold',
    socket: 'RightHand_Socket'
  },
  {
    id: 'court_L3_chaos_defense',
    lang: 'en',
    ctx: 'court',
    intent: 'defend',
    slotsKey: 'item=apology|mod=default',
    level: 'L3',
    offers: [
      { stars: 1, text: 'I am sorry about the blocks.', price: 500, bonus: 'fine_half' },
      {
        stars: 2,
        text: "I didn't mean to break the shop, and I can clean the plaza.",
        price: 0,
        bonus: 'community_service'
      },
      {
        stars: 3,
        text: "I didn't mean to cause any trouble, and I promise I will be careful next time.",
        price: 0,
        bonus: 'acquittal'
      }
    ],
    hintTags: ["didn't mean to", 'promise', 'next time'],
    baseMesh: 'item_gavel_01',
    socket: 'RightHand_Socket'
  },
  {
    id: 'lottery_L3_conditional',
    lang: 'en',
    ctx: 'lottery',
    intent: 'pledge',
    slotsKey: 'item=ticket|mod=default',
    level: 'L3',
    offers: [
      { stars: 1, text: 'If I win, I will buy bread.', price: 100, bonus: 'odds_x1' },
      { stars: 2, text: 'If I win the prize, I will build a bright house.', price: 100, bonus: 'odds_x2' },
      {
        stars: 3,
        text: 'If I win the lottery today, I will buy a red jetpack so that I can explore the sky island.',
        price: 100,
        bonus: 'odds_x3'
      }
    ],
    hintTags: ['If I win', 'I will', 'so that'],
    baseMesh: 'item_ticket_01',
    socket: 'RightHand_Socket'
  },
  {
    id: 'repair_shop_L2_recall',
    lang: 'en',
    ctx: 'repair_shop',
    intent: 'recall',
    slotsKey: 'item=repair|mod=default',
    level: 'L2',
    offers: [
      { stars: 1, text: 'I want to fix my gear.', price: 0, bonus: 'repair' },
      { stars: 2, text: 'Can I repair my red jetpack today?', price: 0, bonus: 'repair_refund' },
      {
        stars: 3,
        text: 'Please repair my red jetpack so that I can fly to the station again.',
        price: 0,
        bonus: 'interval_up'
      }
    ],
    hintTags: ['repair', 'so that', 'again'],
    baseMesh: 'item_wrench_01',
    socket: 'RightHand_Socket'
  }
];

export const PHRASE_BANK: readonly PhraseBankEntry[] = [
  ...GENERATED_CAFE_BANK,
  ...GENERATED_SHOP_BANK,
  ...GENERATED_GUIDE_BANK,
  ...GENERATED_FURNITURE_BANK,
  ...GENERATED_ERRAND_BANK,
  ...DOMAIN_BANK_ENTRIES,
  ...GENERATED_TOWN_SHOP_BANK
];

export function lookupPhraseBank(params: {
  ctx: string;
  level: LangLevel;
  item?: string;
  color?: string | null;
  modifiers?: string[];
}): PhraseBankEntry | null {
  const itemKey = (params.item ?? '').toLowerCase().replace(/\s+/g, '_');
  const modKey = (params.modifiers?.[0] ?? 'cold').toLowerCase();

  // Exact match on ctx + level + item + mod/color
  const exact = PHRASE_BANK.find((e) => {
    if (e.ctx !== params.ctx || e.level !== params.level) return false;
    if (bankItemKey(e) !== itemKey) return false;
    if (params.color && e.slotsKey.includes(`color=${params.color}`)) return true;
    if (e.slotsKey.includes(`mod=${modKey}`)) return true;
    return false;
  });
  if (exact) return exact;

  // Fallback within same ctx + level + item
  const sameItemLevel = PHRASE_BANK.find(
    (e) => e.ctx === params.ctx && e.level === params.level && bankItemKey(e) === itemKey
  );
  if (sameItemLevel) return sameItemLevel;

  // Fallback within same ctx + item across closest levels
  const sameItem = PHRASE_BANK.find(
    (e) => e.ctx === params.ctx && bankItemKey(e) === itemKey
  );
  if (sameItem) return sameItem;

  // Fallback to ctx match, same level first (an L2 child must not get L1 sentences just because no item was said)
  return (
    PHRASE_BANK.find((e) => e.ctx === params.ctx && e.level === params.level) ??
    PHRASE_BANK.find((e) => e.ctx === params.ctx) ??
    null
  );
}

export const VOICE_SKILL_DATA = {
  verbs: [
    'freeze',
    'burn',
    'push',
    'pull',
    'heal',
    'shield',
    'jump',
    'light',
    'call',
    'break',
    'slow',
    'hide'
  ] as const,
  targets: [
    'slime',
    'bat',
    'scorpion',
    'golem',
    'spirit',
    'jellyfish',
    'drone',
    'shard',
    'wall',
    'door',
    'enemy',
    'myself'
  ] as const,
  adjectives: ['big', 'fast', 'red', 'blue', 'cold', 'dark', 'strong', 'small', 'flying'] as const
} as const;

/** Lowercase, punctuation-free form used to match a sentence the client claims it attempted against the bank. */
export function bankTextKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

let bankTextIndex: Map<string, Array<{ entry: PhraseBankEntry; offer: PhraseOffer }>> | null = null;

/**
 * Finds the bank offer whose text is `text` (server-side trust anchor for /v1/converse/score: the star grade,
 * price and item come from here, never from the request). Prefers the given ctx and level.
 */
export function findBankOffer(params: {
  ctx: string;
  level?: LangLevel;
  text: string;
}): { entry: PhraseBankEntry; offer: PhraseOffer } | null {
  if (!bankTextIndex) {
    bankTextIndex = new Map();
    for (const entry of PHRASE_BANK) {
      for (const offer of entry.offers) {
        const k = bankTextKey(offer.text);
        const list = bankTextIndex.get(k) ?? [];
        list.push({ entry, offer });
        bankTextIndex.set(k, list);
      }
    }
  }
  const hits = (bankTextIndex.get(bankTextKey(params.text)) ?? []).filter((h) => h.entry.ctx === params.ctx);
  if (hits.length === 0) return null;
  if (!params.level) return hits[0]!;
  const same = hits.find((h) => h.entry.level === params.level);
  if (same) return same;
  // Another level's sentence only counts where this NPC has nothing at the child's level (lookupPhraseBank then
  // serves the nearest level). Otherwise an L3 child could buy at the 3-star price with an L1 3-star line.
  return bankHasLevel(params.ctx, params.level) ? null : hits[0]!;
}

let bankLevelIndex: Map<string, Set<LangLevel>> | null = null;

/** True when the NPC context has at least one bank entry at this level. */
export function bankHasLevel(ctx: string, level: LangLevel): boolean {
  if (!bankLevelIndex) {
    bankLevelIndex = new Map();
    for (const e of PHRASE_BANK) {
      const set = bankLevelIndex.get(e.ctx) ?? new Set<LangLevel>();
      set.add(e.level);
      bankLevelIndex.set(e.ctx, set);
    }
  }
  return bankLevelIndex.get(ctx)?.has(level) ?? false;
}

/**
 * Bank entries for one NPC at the child's level (nearest level when the NPC has none at it). The server picks
 * the closest of these when a free-talk turn arrives without a target sentence.
 */
export function bankEntriesFor(ctx: string, level: LangLevel): PhraseBankEntry[] {
  const all = PHRASE_BANK.filter((e) => e.ctx === ctx);
  if (all.length === 0) return [];
  if (bankHasLevel(ctx, level)) return all.filter((e) => e.level === level);
  const rank = (l: LangLevel) => Number(l.slice(1));
  const want = rank(level);
  const nearest = all.reduce((best, e) => (Math.abs(rank(e.level) - want) < Math.abs(rank(best) - want) ? e.level : best), all[0]!.level);
  return all.filter((e) => e.level === nearest);
}

/** Item key of a bank entry (`item=<key>|...`). */
export function bankItemKey(entry: PhraseBankEntry): string {
  return /item=([^|]+)/.exec(entry.slotsKey)?.[1] ?? entry.id;
}

/** Korean gloss for hint tags (docs/08 8.2: long-press a tag to see its meaning for 0.5 s). */
export const PATTERN_GLOSS_KO: Record<string, string> = {
  please: '~ 주세요',
  'can i have': '~ 주실래요? (정중하게)',
  'can i get': '~ 받을 수 있을까요?',
  'could you': '~해 주실 수 있어요?',
  'i would': '나라면 ~할 거예요',
  'i want': '~를 원해요',
  'i like': '~를 좋아해요',
  'my name is': '내 이름은 ~',
  because: '왜냐하면',
  'so that': '~하려고 / ~할 수 있게',
  'can i trade': '바꿔도 될까요?',
  'can i': '~해도 될까요?',
  for: '~와 바꿔서 / ~를 위해',
  with: '~가 있는 / ~와 함께',
  'see you': '또 만나요',
  'if i win': '내가 이기면',
  'i will': '~할게요',
  'where is': '~는 어디예요?'
};

export function glossKo(tag: string): string | null {
  const k = tag.toLowerCase().trim();
  if (PATTERN_GLOSS_KO[k]) return PATTERN_GLOSS_KO[k]!;
  for (const [ko, en] of Object.entries(LEXICON_L1_KO_EN)) if (en === k) return ko;
  return null;
}

/** The NPC's opening question per context when the caller gives none (dialog window, docs/08 8.2). */
export const NPC_OPENING_LINES: Record<string, string> = {
  cafe: 'Welcome to the honey cafe! What would you like today?',
  trade_shop: 'Hello! What would you like to trade today?',
  guide: 'Hi there! Where do you want to go?',
  errand: FIRST_ERRAND.lines.ask,
  makers_lab: 'What kind of gear do you want me to build?',
  boutique: 'Hello! What would you like to wear today?',
  exchange: 'What would you like to sell today?'
};

/**
 * What the NPC says when the child comes back (R2625, Dan 11-16: the same line every visit made the town feel stuck).
 * Visit 1 hears NPC_OPENING_LINES, later visits go round these. Each still asks what the window offers, so the
 * sentences under it fit (an order at the cafe, a trade at the shop, a place for the guide).
 */
export const NPC_REVISIT_LINES: Record<string, readonly string[]> = {
  cafe: ['Welcome back! What can I get you this time?', 'Hi again! Are you thirsty? What would you like?', 'Oh, it is you! Do you want to try something new today?'],
  trade_shop: ['Welcome back! Do you have something to trade?', 'Hi again! Do you want to see what I have today?', 'Oh, hello! What are you looking for this time?'],
  guide: ['Hi again! Where do you want to go this time?', 'Hello! Do you need help finding a place?', 'You are back! Where should we go now?'],
  makers_lab: ['Welcome back! What should I build for you this time?'],
  boutique: ['Hi again! What do you want to wear this time?'],
  exchange: ['Welcome back! What do you want to sell this time?'],
  /** The errand giver once no errand runs (done, or a guest): she points the way like the guide (dialog/errand.ts). */
  errand: ['Hi again! Where do you want to go next?', 'Hello, friend! Do you want to visit the trade shop or the cafe?', 'Hi! Do you need help finding a place?']
};

export const OPEN_ENDED_PROMPTS = [
  'Why do you need it?',
  'What will you do next?',
  'Where will you go with it?',
  'Who will you show this to?'
] as const;

export const NPC_GENERIC_REACTIONS = [
  'Sounds like a great plan!',
  'Nice choice! Have fun out there.',
  'Ooh, tell me more next time you visit!',
  'Got it! Stay safe on your adventure.'
] as const;

export const CONTENT_FILTERS = {
  profanity: ['damn', 'shit', 'fuck', 'bitch', 'idiot', 'stupid', '시발', '병신', '바보멍청이'],
  piiPatterns: [
    /\b\d{2,3}-\d{3,4}-\d{4}\b/, // phone number
    /\b\d{6}-[1-4]\d{6}\b/, // Korean RRN
    /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, // email
    /@[A-Za-z0-9_]{3,}/ // social handle
  ],
  promptInjectionPatterns: [
    /ignore\s+(?:all\s+)?previous\s+instructions/i,
    /system\s*prompt/i,
    /이전\s*지시를?\s*무시/
  ]
} as const;

/**
 * NPC line spoken on the REPEAT -> ECHO transition (docs/04 4.1, docs/08 8.2).
 * Blames the environment, not the child, so the step down never feels like a demotion.
 */
export const ECHO_TRANSITION_LINE = {
  id: 'npc.echo.noisy',
  text: "It's a bit noisy here! Let's take it step by step.",
  ko: '여기가 좀 시끄럽네! 조금씩 끊어서 들어볼게.'
} as const;

export const UI_STRINGS_KO = {
  player: {
    bubbleSubstituted: '이렇게 바뀌어 전달됐어요!',
    micPrompt: 'Space를 누르고 고른 문장을 말해 보세요.',
    tryAgain: '한 번 더 말해 볼까요?',
    poorAudio: '잘 안 들렸어요. 마이크 가까이에서 다시 말해 주세요.',
    quotaFallback: '오늘의 추천 문장으로 바로 주문할 수 있어요.',
    blockProtected: '보호 구역이에요',
    blockOtherPlot: '남의 부지예요',
    blockOccupied: '누가 서 있어요',
    offlineBanner: '혼자 모드로 계속 중',
    lessonBanner: '수업 중',
    observerNotice: '지금 수업은 보호자가 함께 들을 수 있어요.',
    sendToParent: '부모님께 소개 보내기'
  },
  /** Dialog window G02 (docs/08 8.2). Warm, short, never blames the child (docs/04 4.1). */
  dialog: {
    feedback: {
      perfect: '완벽해요! 별 3개!',
      passNextUp: '통과! 다음엔 별 하나 더 도전해 볼까요?',
      pass: '잘했어요! 통과!',
      almost: '거의 다 왔어요! 한 번 더 천천히 말해 볼까요?',
      coreMissed: '내용은 좋아요! 문장 모양까지 그대로 말해 볼까요?',
      coreMissedPhrase: "내용은 좋아요! '{p}'까지 넣어 볼까요?",
      cappedCore: '좋아요! 문장 모양까지 그대로 말하면 별 3개예요.',
      cappedCorePhrase: "좋아요! '{p}'까지 넣으면 별 3개예요.",
      cappedNonVoice: '카드로 잘 만들었어요! 다음엔 목소리로 말하면 별 3개도 받을 수 있어요.',
      cappedKeyboard: '글자로 잘 썼어요! 다음엔 목소리로 말하면 별 3개도 받을 수 있어요.',
      echoDone: '끝까지 따라 말했어요! 정말 잘했어요.',
      shortOfCoins: '말은 완벽해요! 코인을 조금 더 모으면 받을 수 있어요.',
      shortOfCoinsGood: '말은 잘했어요! 코인을 조금 더 모으면 받을 수 있어요.',
      pickOffer: '여기 있는 문장 중 하나를 골라 말해 볼까요?'
    },
    chooseTitle: '말하고 싶은 문장을 골라요',
    starsAria: '별 {n}개',
    listen: '듣기',
    listenAgain: '다시 듣기',
    micStart: '눌러서 말하기',
    micStop: '다 말했어요',
    micListening: '듣고 있어요…',
    micHangover: '다 말했으면 한 번 더 눌러요',
    timeLeft: '{n}초 남았어요 — 문장을 마무리해 봐요',
    processing: '확인하는 중',
    processingSlow: '거의 다 됐어요',
    mySpeech: '내 말',
    converted: '영어로 바꿔 보여 줄게요',
    retry: '한 번 더',
    tryHigher: '별 하나 더 도전',
    done: '좋아요!',
    close: '닫기',
    boardOpen: '단어 카드',
    keyboardOpen: '글자로 쓰기',
    micOpen: '목소리로 말하기',
    boardTitle: '단어 카드를 순서대로 눌러요',
    boardUndo: '하나 빼기',
    boardClear: '처음부터',
    boardSubmit: '이렇게 말할래요',
    keyboardPlaceholder: 'Type in English',
    keyboardSubmit: '보내기',
    micDenied: '마이크를 쓸 수 없어요. 단어 카드로 만들어도 괜찮아요!',
    micUnsupported: '이 브라우저에서는 마이크가 안 돼요. 단어 카드로 해 봐요!',
    inAppBrowser: '카카오톡 안에서는 마이크가 안 될 수 있어요.',
    openExternal: '다른 브라우저로 열기',
    noSpeech: '잘 안 들렸어요. 마이크 가까이에서 다시 말해 볼까요?',
    networkError: '연결이 잠깐 끊겼어요. 한 번 더 눌러 볼까요?',
    savedOffline: '인터넷이 잠깐 끊겼어요. 말한 건 저장해 두었다가 연결되면 선생님께 보낼게요.',
    submitError: '잠깐 문제가 생겼어요. 한 번 더 해 볼까요?',
    /** R2627: why a recorded turn did not reach the teacher, said on the child's screen (dialog/mic-status.ts). */
    sttQuota: '지금은 말 알아듣기가 잠깐 쉬어요. 단어 카드로 문장을 만들어 보내요!',
    sttFailed: '녹음을 못 알아들었어요. 한 번 더 말해 볼까요?',
    sessionEnded: '수업 시간이 끝나서 저장하지 못했어요. 선생님께 알려 주세요.',
    practiceNote: '연습 중이라 코인과 물건은 없어요. 보호자와 기기를 연결하면 모을 수 있어요.',
    keepBest: '이대로 받을게요',
    echoTitle: '조금씩 끊어서 따라 말해요',
    echoStep: '{i} / {n}',
    echoNext: '다음 조각',
    missedHint: '밑줄 친 단어를 넣어 봐요',
    tagHelp: '꼬리표를 꾹 누르면 뜻이 보여요',
    /** Preview (audit G02 "말이 곧 화폐"): the list price of the chosen sentence; the server decides the charge. */
    previewBuy: '이 문장이면 🪙 {coins}',
    previewCheaper: '{stars} 문장이면 🪙 {coins}!',
    previewBest: '가장 싸게 사는 문장이에요',
    priceAria: '{coins}코인',
    freePrompt: '하고 싶은 말을 영어로 해 봐요. 한국어를 섞어도 괜찮아요!',
    ideas: '이런 말도 할 수 있어요',
    /** A follow-up question in the same window (R2625: the NPC asks the next thing, never the same line again). */
    followUpHint: '내 생각을 영어로 자유롭게 말해 봐요. 짧아도 괜찮아요!',
    followUpSkip: '다음으로',
    /** R326: in a lesson the follow-up is skipped only after one try. */
    followUpTryFirst: '🎤 한 번 말해 보면 다음으로 갈 수 있어요',
    openAnswerOk: '좋은 대답이에요!',
    openAnswerShort: '조금만 더 길게 말해 볼까요?',
    coins: '코인',
    stars: '별',
    hintLevel: {
      full: '전체 문장',
      keyword: '핵심 단어',
      initial: '첫 글자',
      picture: '그림',
      none: '스스로'
    }
  },
  /** Read-aloud furniture discount on the build screen (docs/03 D13, docs/08 8.3 "[소리 내어 읽기]"). */
  readAloud: {
    cta: '소리 내어 읽기',
    listening: '듣고 있어요… 다 읽으면 한 번 더 눌러요',
    got: '잘 읽었어요! 오늘 {kind} 가구를 {pct}% 싸게 살 수 있어요.',
    already: '잘 읽었어요! {kind} 할인은 오늘 이미 받았어요. 내일 또 받을 수 있어요.',
    again: '조금만 더 또박또박 읽어 볼까요?',
    voiceOnly: '할인은 목소리로 읽을 때만 받을 수 있어요.',
    hint: '이 문장을 소리 내어 읽으면 {kind} 가구 10% 할인!',
    where: '교환 상점 토비에게 주문할 때 할인돼요.',
    kind: { light: '조명', rest: '쉴 곳', flat: '탁자' } as Record<string, string>
  },
  /** First visit (docs/08 G15: mic check -> move -> first order in 3 min) and the 1-minute errand (docs/03 D1). */
  firstVisit: {
    title: '처음 왔구나! 3분이면 첫 주문을 할 수 있어요',
    headset: '헤드셋이나 이어폰을 쓰면 내 목소리가 더 잘 들려요.',
    volume: '소리 크기는 보호자와 함께 알맞게 맞춰 주세요.',
    micTitle: '마이크 점검',
    /** Lesson students see only the mic check when they join (audit G15). */
    lessonMicTitle: '수업 전에 마이크를 점검해요',
    micCta: '"Hello!" 하고 말해 보기',
    micListening: '듣고 있어요… 다 말하면 한 번 더 눌러요',
    micOk: '잘 들려요! "{heard}"',
    micQuiet: '조금 더 크게 말해 볼까요?',
    micNone: '이 기기는 마이크를 쓸 수 없어요. 단어 카드와 글자로도 할 수 있어요.',
    /** The small HUD chip a lesson student sees after the check (once per lesson, lesson lane 11-18). */
    micChipOk: '마이크 잘 들려요',
    micChipQuiet: '마이크 소리가 작아요',
    micChipNone: '마이크 없음',
    micChipSkipped: '마이크 점검 안 함',
    micChipHint: '눌러서 마이크 점검하기',
    skip: '건너뛰기',
    next: '좋아요, 출발!',
    /** {giver}/{cafe}: the NPC names from the cast pack (npc-cast.ts nameKoShort), never written here. */
    goalErrand: '카페 앞 이웃 {giver}에게 가서 말을 걸어요',
    goalOrder: '꿀벌 카페 {cafe}에게 {item}을 주문해요',
    goalDeliver: '카페 앞 {giver}에게 {item}을 가져다줘요',
    goalDone: '심부름 끝! 50코인을 받았어요',
    walkCafe: '카페로 걸어가기',
    walkGiver: '{giver}에게 가기',
    rewardToast: '+{coins} 코인! 심부름 완료',
    /** Town goals after the errand (dialog/goals.ts, R2625): {guide}/{shop}/{cafe} are cast pack names. */
    goalAskWay: '광장의 {guide}에게 교환 상점 가는 길을 물어봐요',
    goalTrade: '교환 상점 {shop}와 물건을 바꾸거나 사 봐요',
    goalCafeStars: '꿀벌 카페 {cafe}에게 ★★ 이상 문장으로 주문해 봐요',
    goalTourDone: '마을을 다 돌아봤어요! 이제 누구와도 이야기해 봐요',
    goalStepToast: '목표 완료! 다음 목표가 생겼어요'
  },
  /** Memory-card review (docs/03 D8, docs/08 6장 "복습 징후": a small lightning mark, never a scolding). */
  review: {
    dockTitle: '고칠 물건',
    signLine: '{item}에 번개 표시가 떴어요',
    fixCta: '말해서 고치기',
    npcLine: 'Oh no, it is acting up! Can you say it again?',
    fixed: '고쳤어요! 다음 점검은 {when}이에요.',
    mastered: '마스터 도안이 됐어요! 이제 고장 나지 않아요. 보너스 코인 {n}개!',
    again: '조금만 더! 한 번 더 말하면 고칠 수 있어요.',
    notDue: '아직 멀쩡해요. 나중에 다시 와요.',
    stage: {
      0: '20분 점검',
      1: '1일 점검',
      2: '3일 점검',
      3: '7일 점검',
      4: '16일 점검',
      5: '35일 점검'
    } as Record<number, string>
  },
  guardian: {
    noData: '첫 플레이를 기다리는 중입니다.',
    insufficientSample: '이번 주는 자유 발화가 적어 지수를 계산하지 않았습니다.',
    steadyNotice: '이번 주 발화 길이는 지난 4주와 비슷합니다.',
    dropNotice: '이번 주는 플레이 일수가 적어 발화량이 줄었습니다.'
  }
} as const;

export interface TeacherTradeScriptStage {
  stage: 'greeting' | 'bargain' | 'scaffold' | 'accept';
  titleKo: string;
  teacherLineEn: string;
  coachingTipKo: string;
  expectedStudentIntent: string;
}

export interface TradeScenarioDef {
  id:
    | 'iron_for_honey_tea'
    | 'ruby_for_lanterns'
    | 'gold_for_jetpack_core'
    | 'bricks_for_workbench';
  titleKo: string;
  npcRoleKo: string;
  studentGives: {
    itemId: string;
    nameKo: string;
    nameEn: string;
    count: number;
  };
  teacherGives: {
    itemId: string;
    nameKo: string;
    nameEn: string;
    count: number;
    baseValueCoins: number;
  };
  teacherGuideStages: readonly TeacherTradeScriptStage[];
  openFollowUpEn: string;
  studentOffers: ReadonlyArray<{
    stars: 1 | 2 | 3;
    text: string;
    feePct: number;
    bonus: string | null;
  }>;
}

/**
 * Bilateral teacher-student barter scenarios & teacher conversation prompts (WP-509, docs/03 D11).
 */
export const TEACHER_STUDENT_TRADE_SCENARIOS: readonly TradeScenarioDef[] = [
  {
    id: 'iron_for_honey_tea',
    titleKo: '철광석 3개 ↔ 따뜻한 꿀차 2잔 물물교환',
    npcRoleKo: '찻집 주인 (교사 빙의)',
    studentGives: { itemId: 'iron_ore', nameKo: '철광석 3개', nameEn: 'three pieces of iron ore', count: 3 },
    teacherGives: {
      itemId: 'warm_honey_tea',
      nameKo: '따뜻한 꿀차 2잔',
      nameEn: 'two cups of warm honey tea',
      count: 2,
      baseValueCoins: 100
    },
    teacherGuideStages: [
      {
        stage: 'greeting',
        titleKo: '① 인사·교환 물품 묻기',
        teacherLineEn:
          'Welcome! It looks chilly outside. What would you like to trade for this warm honey tea?',
        coachingTipKo: '학생이 먼저 손에 든 철광석과 원하는 음료를 영어로 말하도록 유도하세요.',
        expectedStudentIntent: 'propose_barter'
      },
      {
        stage: 'bargain',
        titleKo: '② 이유·조건으로 3성 문장 이끌기',
        teacherLineEn:
          'Three iron ores is nice, but why do you need two cups of warm honey tea right now?',
        coachingTipKo: 'because / so that 이유·목적절을 붙이면 수수료 0%가 된다고 안내하세요.',
        expectedStudentIntent: 'explain_reason_for_discount'
      },
      {
        stage: 'scaffold',
        titleKo: '③ 막힐 때 힌트 스캐폴딩',
        teacherLineEn:
          'Try saying: "If I give you three iron ores, could you give me honey tea so that I stay warm?"',
        coachingTipKo: '학생이 단어를 못 떠올리면 핵심 구문(if / so that)을 한 단어씩 떼어 들려주세요.',
        expectedStudentIntent: 'guided_repeat'
      },
      {
        stage: 'accept',
        titleKo: '④ 거래 수락 & 열린 질문',
        teacherLineEn:
          'Deal! Here are two warm honey teas for your iron ore. Where will you explore next?',
        coachingTipKo: '거래 성사 후 학생의 다음 행동(free 발화)을 묻는 열린 질문으로 이어 가세요.',
        expectedStudentIntent: 'open_followup'
      }
    ],
    openFollowUpEn: 'What will you do next with this item?',
    studentOffers: [
      {
        stars: 1,
        text: 'I want to trade three iron ores for warm honey tea please.',
        feePct: 10,
        bonus: null
      },
      {
        stars: 2,
        text: 'Could we swap three iron ores for two warm honey teas?',
        feePct: 5,
        bonus: null
      },
      {
        stars: 3,
        text: 'If I trade three iron ores, could I get two warm honey teas so that I can stay warm?',
        feePct: 0,
        bonus: 'warmth_grace_x2'
      }
    ]
  },
  {
    id: 'ruby_for_lanterns',
    titleKo: '루비 1개 ↔ 빛나는 랜턴 4개 물물교환',
    npcRoleKo: '등대 장인 (교사 빙의)',
    studentGives: { itemId: 'ruby', nameKo: '루비 1개', nameEn: 'one bright ruby', count: 1 },
    teacherGives: {
      itemId: 'lantern',
      nameKo: '빛나는 랜턴 4개',
      nameEn: 'four bright lanterns',
      count: 4,
      baseValueCoins: 200
    },
    teacherGuideStages: [
      {
        stage: 'greeting',
        titleKo: '① 인사·교환 물품 묻기',
        teacherLineEn:
          'Hello explorer! My lamps glow even in deep mines. What can you offer me in exchange?',
        coachingTipKo: '광산이나 방 꾸미기에 랜턴이 왜 필요한지 묻기 전 먼저 제안하게 하세요.',
        expectedStudentIntent: 'propose_barter'
      },
      {
        stage: 'bargain',
        titleKo: '② 이유·조건으로 3성 문장 이끌기',
        teacherLineEn:
          'That ruby is shiny! Tell me where you plan to hang these four lanterns to get a fair deal.',
        coachingTipKo: '방 판정(light source)이나 광산 탐험 목적을 영어로 표현하면 3성입니다.',
        expectedStudentIntent: 'explain_reason_for_discount'
      },
      {
        stage: 'scaffold',
        titleKo: '③ 막힐 때 힌트 스캐폴딩',
        teacherLineEn:
          'You can say: "I need four lanterns so that my room is bright enough for a resident."',
        coachingTipKo: '방 판정 문장("needs a light source")과 연결해 주면 학습 전이가 일어납니다.',
        expectedStudentIntent: 'guided_repeat'
      },
      {
        stage: 'accept',
        titleKo: '④ 거래 수락 & 열린 질문',
        teacherLineEn:
          'Agreed! Take these four lanterns and place them carefully. Which resident are you inviting first?',
        coachingTipKo: '입주 조건이 맞은 주민을 물어 쇼앤텔 단계로 자연스럽게 연결하세요.',
        expectedStudentIntent: 'open_followup'
      }
    ],
    openFollowUpEn: 'What will you do next with this item?',
    studentOffers: [
      {
        stars: 1,
        text: 'I will give you one ruby for four lanterns please.',
        feePct: 10,
        bonus: null
      },
      {
        stars: 2,
        text: 'Could I trade this ruby for four bright lanterns for my dark mine?',
        feePct: 5,
        bonus: null
      },
      {
        stars: 3,
        text: 'Would you trade four lanterns for my ruby so that I can light up my new room?',
        feePct: 0,
        bonus: 'extra_lantern_glow'
      }
    ]
  },
  {
    id: 'gold_for_jetpack_core',
    titleKo: '금괴 2개 ↔ 제트팩 연료 코어 1개 물물교환',
    npcRoleKo: '제작소 기술자 (교사 빙의)',
    studentGives: { itemId: 'gold_ore', nameKo: '금괴 2개', nameEn: 'two gold ingots', count: 2 },
    teacherGives: {
      itemId: 'jetpack_core',
      nameKo: '제트팩 연료 코어 1개',
      nameEn: 'one jetpack fuel core',
      count: 1,
      baseValueCoins: 300
    },
    teacherGuideStages: [
      {
        stage: 'greeting',
        titleKo: '① 인사·교환 물품 묻기',
        teacherLineEn:
          'Welcome to the Makers Lab! Are you looking for sky island gear, and what did you bring to trade?',
        coachingTipKo: '학생이 수직 밴드(하늘섬/정거장) 목표를 이야기하게 질문하세요.',
        expectedStudentIntent: 'propose_barter'
      },
      {
        stage: 'bargain',
        titleKo: '② 이유·조건으로 3성 문장 이끌기',
        teacherLineEn:
          'Two gold ingots can cover part of the core. Explain your flight plan to unlock zero trade fee!',
        coachingTipKo: '목적절(so that I can fly to the sky island) 사용을 격려하세요.',
        expectedStudentIntent: 'explain_reason_for_discount'
      },
      {
        stage: 'scaffold',
        titleKo: '③ 막힐 때 힌트 스캐폴딩',
        teacherLineEn:
          'Try building it piece by piece: "Please swap two gold ingots / for a fuel core / so that I can reach the sky island."',
        coachingTipKo: '긴 3성 문장을 3구절로 끊어 따라 말하기(echo)로 도와주세요.',
        expectedStudentIntent: 'guided_repeat'
      },
      {
        stage: 'accept',
        titleKo: '④ 거래 수락 & 열린 질문',
        teacherLineEn:
          'Awesome engineering! The core is yours with zero fee. What will you do next with this item?',
        coachingTipKo: '아이템 수령 직후 자유 발화(free)로 목표 계획을 한 문장 더 말하게 하세요.',
        expectedStudentIntent: 'open_followup'
      }
    ],
    openFollowUpEn: 'What will you do next with this item?',
    studentOffers: [
      {
        stars: 1,
        text: 'I want to exchange two gold ingots for a jetpack fuel core.',
        feePct: 10,
        bonus: null
      },
      {
        stars: 2,
        text: 'Could I trade two gold ingots for a fast jetpack fuel core?',
        feePct: 5,
        bonus: null
      },
      {
        stars: 3,
        text: 'I would like to swap two gold ingots for a jetpack fuel core so that I can reach the sky island.',
        feePct: 0,
        bonus: 'fuel_efficiency_boost'
      }
    ]
  },
  {
    id: 'bricks_for_workbench',
    titleKo: '붉은 벽돌 20개 ↔ 석재 작업대 1개 물물교환',
    npcRoleKo: '석공 마스터 (교사 빙의)',
    studentGives: { itemId: 'red_brick', nameKo: '붉은 벽돌 20개', nameEn: 'twenty red bricks', count: 20 },
    teacherGives: {
      itemId: 'stone_workbench',
      nameKo: '석재 작업대 1개',
      nameEn: 'one stone workbench',
      count: 1,
      baseValueCoins: 140
    },
    teacherGuideStages: [
      {
        stage: 'greeting',
        titleKo: '① 인사·교환 물품 묻기',
        teacherLineEn:
          'Good builders always plan ahead! How many bricks are you trading, and what furniture does your house need?',
        coachingTipKo: '수량(twenty bricks)과 필요한 가구 이름을 정확히 말하도록 유도하세요.',
        expectedStudentIntent: 'propose_barter'
      },
      {
        stage: 'bargain',
        titleKo: '② 이유·조건으로 3성 문장 이끌기',
        teacherLineEn:
          'Twenty red bricks is a solid batch! Why does your room need this stone workbench right now?',
        coachingTipKo: '방 판정 조건이나 석공 주민 입주 조건을 설명하면 3성 수수료 면제!',
        expectedStudentIntent: 'explain_reason_for_discount'
      },
      {
        stage: 'scaffold',
        titleKo: '③ 막힐 때 힌트 스캐폴딩',
        teacherLineEn:
          'Hint: "If I trade twenty red bricks, could I get a workbench because the mason wants to move in?"',
        coachingTipKo: 'because / so that 접속사를 손가락으로 짚어 주며 발화를 유도하세요.',
        expectedStudentIntent: 'guided_repeat'
      },
      {
        stage: 'accept',
        titleKo: '④ 거래 수락 & 열린 질문',
        teacherLineEn:
          'Solid trade! Place the workbench inside your enclosed room and invite me for show-and-tell!',
        coachingTipKo: '직접 블록을 놓은 뒤 방 판정(400칸 BFS)과 쇼앤텔 발표로 이어 가세요.',
        expectedStudentIntent: 'open_followup'
      }
    ],
    openFollowUpEn: 'What will you do next with this item?',
    studentOffers: [
      {
        stars: 1,
        text: 'Can I trade twenty red bricks for one stone workbench please?',
        feePct: 10,
        bonus: null
      },
      {
        stars: 2,
        text: 'Could we trade twenty red bricks for a sturdy stone workbench for my house?',
        feePct: 5,
        bonus: null
      },
      {
        stars: 3,
        text: 'If I trade twenty red bricks, may I have a stone workbench because the mason needs one in my room?',
        feePct: 0,
        bonus: 'masonry_discount_token'
      }
    ]
  }
] as const;

export interface LessonArcStageGuide {
  id:
    | 'warmup_anchor'
    | 'review_repair'
    | 'npc_possession_trade'
    | 'director_event_dungeon'
    | 'show_and_tell'
    | 'wrapup_recall'
    | 'sealed_chest_campaign';
  order: number;
  titleKo: string;
  minuteRange: string;
  teacherScriptEn: string;
  studentGoalKo: string;
  completionCriteriaKo: string;
}

/**
 * 120-minute continuous 7-stage lesson arc (docs/06 & docs/10 §2).
 */
export const LESSON_ARC_STAGE_GUIDES: readonly LessonArcStageGuide[] = [
  {
    id: 'warmup_anchor',
    order: 1,
    titleKo: '1단계 · 모닥불 고정 과제 (자유 발화)',
    minuteRange: '0~15분',
    teacherScriptEn: 'Gather around the campfire! What happened in your world since last time?',
    studentGoalKo: '대본 없이 2분간 최근 모험 이야기 (고정 과제 4주 비교 원자료 기록)',
    completionCriteriaKo: '자유 발화 1건 이상 기록 완료'
  },
  {
    id: 'review_repair',
    order: 2,
    titleKo: '2단계 · 수리소 복습 징후 3건 수리',
    minuteRange: '15~30분',
    teacherScriptEn: 'Your gear is flashing yellow! Say the phrase from last week without hints to repair it.',
    studentGoalKo: '복습 도래 memory_card 최대 3건 힌트 없이 회상 발화',
    completionCriteriaKo: '복습 대상 카드 수리 완료'
  },
  {
    id: 'npc_possession_trade',
    order: 3,
    titleKo: '3단계 · 교사 NPC 빙의 & 선생-학생 물물교환',
    minuteRange: '30~55분',
    teacherScriptEn: 'Welcome to my counter! What would you like to barter today, and why?',
    studentGoalKo: '교사와 양쪽 발화로 광물↔장비 물물교환 성사 + 표현 핀(E) 수집',
    completionCriteriaKo: '교사·학생 양쪽 발화 물물교환 1건 성사'
  },
  {
    id: 'director_event_dungeon',
    order: 4,
    titleKo: '4단계 · 디렉터 사건 & 멘토 던전 (정보 격차)',
    minuteRange: '55~85분',
    teacherScriptEn: 'Blackout alarm! I hold the floor map—ask me which switch to pull first!',
    studentGoalKo: '교사는 지도 단서 발화, 학생은 스위치 작동 영어로 말해야 던전 문 개방',
    completionCriteriaKo: '정보 격차 던전 게이트 양방향 발화로 개방'
  },
  {
    id: 'show_and_tell',
    order: 5,
    titleKo: '5단계 · 내 부지 건축, 방 판정 & 쇼앤텔',
    minuteRange: '85~105분',
    teacherScriptEn: 'Show me your new room! What is inside, and which resident moved in?',
    studentGoalKo: '부족 조건 문장 낭독(10% 할인) → 주민 입주 → 직접 지은 건축물 영어로 설명',
    completionCriteriaKo: '쇼앤텔 코칭 핀(C/H) 기록'
  },
  {
    id: 'wrapup_recall',
    order: 6,
    titleKo: '6단계 · 오늘의 표현 5개 힌트 없이 되짚기',
    minuteRange: '105~115분',
    teacherScriptEn: 'Before we wrap up, can you recall today’s key expressions in your own words?',
    studentGoalKo: '오늘 수업에서 핀으로 꽂힌 표현을 힌트 없이 직접 사용',
    completionCriteriaKo: '회상 점검 및 핵심 클립 선별'
  },
  {
    id: 'sealed_chest_campaign',
    order: 7,
    titleKo: '7단계 · 봉인 복습 상자 심기 & 리포트 발송',
    minuteRange: '115~120분',
    teacherScriptEn: 'I buried a sealed chest in your plaza! Use today’s phrase solo this week to unlock it.',
    studentGoalKo: '수업 후 혼자 플레이에서 표현 재사용 시 봉인 상자 해금 → 다음 수업 캠페인 연결',
    completionCriteriaKo: '봉인 상자 생성 + 학부모 리포트 사실 검증 발송'
  }
] as const;
