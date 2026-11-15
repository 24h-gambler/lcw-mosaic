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
  '약속할게요': 'promise'
};

export const CAFE_DRINKS = [
  { key: 'water', label: 'water', basePrice: 20 },
  { key: 'milk', label: 'milk', basePrice: 25 },
  { key: 'tea', label: 'tea', basePrice: 30 },
  { key: 'juice', label: 'juice', basePrice: 35 },
  { key: 'smoothie', label: 'smoothie', basePrice: 50 },
  { key: 'hot_chocolate', label: 'hot chocolate', basePrice: 45 },
  { key: 'lemonade', label: 'lemonade', basePrice: 40 },
  { key: 'apple_juice', label: 'apple juice', basePrice: 40 },
  { key: 'berry_smoothie', label: 'berry smoothie', basePrice: 60 },
  { key: 'mint_tea', label: 'mint tea', basePrice: 35 },
  { key: 'iced_tea', label: 'iced tea', basePrice: 35 },
  { key: 'cocoa', label: 'cocoa', basePrice: 45 }
] as const;

export const CAFE_MODIFIERS = ['cold', 'warm', 'sweet', 'large', 'small', 'fresh'] as const;

function buildCafeOffers(
  drinkLabel: string,
  modifier: string,
  basePrice: number,
  level: LangLevel
): [PhraseOffer, PhraseOffer, PhraseOffer] {
  const p1 = basePrice;
  const p2 = Math.round(basePrice * 0.8);
  const p3 = Math.round(basePrice * 0.5);

  if (level === 'L1') {
    return [
      { stars: 1, text: `${capitalize(drinkLabel)}, please.`, price: p1, bonus: null },
      { stars: 2, text: `${capitalize(modifier)} ${drinkLabel}, please.`, price: p2, bonus: null },
      {
        stars: 3,
        text: `Can I have ${modifier} ${drinkLabel}, please?`,
        price: p3,
        bonus: 'thirst_buff_3m'
      }
    ];
  }
  if (level === 'L2') {
    return [
      { stars: 1, text: `I want ${modifier} ${drinkLabel}, please.`, price: p1, bonus: null },
      {
        stars: 2,
        text: `Can I get a ${modifier} ${drinkLabel}?`,
        price: p2,
        bonus: null
      },
      {
        stars: 3,
        text: `Can I get a ${modifier} ${drinkLabel} because I am thirsty?`,
        price: p3,
        bonus: 'thirst_buff_3m'
      }
    ];
  }
  return [
    { stars: 1, text: `I'd like a ${modifier} ${drinkLabel}, please.`, price: p1, bonus: null },
    {
      stars: 2,
      text: `Could you make a ${modifier} ${drinkLabel} for me?`,
      price: p2,
      bonus: null
    },
    {
      stars: 3,
      text: `I'd love a ${modifier} ${drinkLabel} so that I can keep exploring the town.`,
      price: p3,
      bonus: 'thirst_buff_3m'
    }
  ];
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

const GENERATED_CAFE_BANK: PhraseBankEntry[] = [];
for (const level of ['L1', 'L2', 'L3'] as const) {
  for (const drink of CAFE_DRINKS) {
    for (const mod of CAFE_MODIFIERS) {
      GENERATED_CAFE_BANK.push({
        id: `cafe_${level}_${drink.key}_${mod}`,
        lang: 'en',
        ctx: 'cafe',
        intent: 'order_drink',
        slotsKey: `item=${drink.key}|mod=${mod}`,
        level,
        offers: buildCafeOffers(drink.label, mod, drink.basePrice, level),
        hintTags: [mod, drink.label, level === 'L3' ? 'so that' : 'please'],
        baseMesh: 'item_cup_01',
        socket: 'RightHand_Socket'
      });
    }
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
  ...DOMAIN_BANK_ENTRIES
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
    if (!e.slotsKey.includes(`item=${itemKey}`)) return false;
    if (params.color && e.slotsKey.includes(`color=${params.color}`)) return true;
    if (e.slotsKey.includes(`mod=${modKey}`)) return true;
    return false;
  });
  if (exact) return exact;

  // Fallback within same ctx + level + item
  const sameItemLevel = PHRASE_BANK.find(
    (e) => e.ctx === params.ctx && e.level === params.level && e.slotsKey.includes(`item=${itemKey}`)
  );
  if (sameItemLevel) return sameItemLevel;

  // Fallback within same ctx + item across closest levels
  const sameItem = PHRASE_BANK.find(
    (e) => e.ctx === params.ctx && e.slotsKey.includes(`item=${itemKey}`)
  );
  if (sameItem) return sameItem;

  // Fallback to ctx match
  return PHRASE_BANK.find((e) => e.ctx === params.ctx) ?? null;
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

export const UI_STRINGS_KO = {
  player: {
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
  guardian: {
    noData: '첫 플레이를 기다리는 중입니다.',
    insufficientSample: '이번 주는 자유 발화가 적어 지수를 계산하지 않았습니다.',
    steadyNotice: '이번 주 발화 길이는 지난 4주와 비슷합니다.',
    dropNotice: '이번 주는 플레이 일수가 적어 발화량이 줄었습니다.'
  }
} as const;
