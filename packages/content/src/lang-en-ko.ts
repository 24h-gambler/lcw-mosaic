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
