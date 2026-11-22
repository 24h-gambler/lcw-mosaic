import type { AdventureChapterId, AdventureLevel, AdventureLine, AdventurePatternId } from './adventure.js';

/**
 * The Hushwind Isles as one story (R2734, docs/22 1.4): the prologue, the boat between islands, the people you can
 * talk to (with choices), chests, Tumble's shop, the skills and the guardians' stages, and the ending. Every name and
 * line was written for LCW. English is for a 12-year-old learner (apps/adventure/src/__tests__/adventure-english.test.ts
 * checks every sentence against a word list and a length limit); `ko` is the Korean help line.
 */

const L = (en: string, ko: string): AdventureLine => ({ en, ko });

/** Things for the pouch (used in a meeting from POUCH). */
export type AdventureItemId = 'honeyDrop' | 'berryBun' | 'starTea';
/** Things you wear (always on once bought). */
export type AdventureGearId = 'braveCoat' | 'bigScarf' | 'glowLantern';
/** Things you say in a meeting (SKILL). */
export type AdventureSkillId = 'warmHeal' | 'shieldSong' | 'brightSpark' | 'slowWind';
export type AdventureGoodsId = AdventureItemId | AdventureGearId | AdventureSkillId;

export interface AdventureItem {
  id: AdventureItemId;
  nameEn: string;
  nameKo: string;
  /** Voice (HP) it gives back. */
  heal: number;
}

export const ADVENTURE_ITEMS: Readonly<Record<AdventureItemId, AdventureItem>> = {
  honeyDrop: { id: 'honeyDrop', nameEn: 'Honey Drop', nameKo: '꿀 사탕', heal: 10 },
  berryBun: { id: 'berryBun', nameEn: 'Berry Bun', nameKo: '베리 빵', heal: 20 },
  starTea: { id: 'starTea', nameEn: 'Star Tea', nameKo: '별빛 차', heal: 99 }
};

export interface AdventureGear {
  id: AdventureGearId;
  nameEn: string;
  nameKo: string;
  info: AdventureLine;
}

export const ADVENTURE_GEAR: Readonly<Record<AdventureGearId, AdventureGear>> = {
  braveCoat: { id: 'braveCoat', nameEn: 'Brave Coat', nameKo: '용감한 외투', info: L('Every hit hurts one less.', '맞을 때마다 1 덜 아파요.') },
  bigScarf: { id: 'bigScarf', nameEn: 'Big Scarf', nameKo: '커다란 목도리', info: L('Your voice can hold 6 more.', '목소리 힘이 6 더 커져요.') },
  glowLantern: { id: 'glowLantern', nameEn: 'Glow Lantern', nameKo: '반짝 등불', info: L('Kind words calm them more.', '다정한 말이 마음을 더 많이 풀어요.') }
};

export interface AdventureSkill {
  id: AdventureSkillId;
  nameEn: string;
  nameKo: string;
  info: AdventureLine;
  /** The magic words, said (🎤) or picked, by sentence level. */
  chant: Record<AdventureLevel, AdventureLine>;
}

export const ADVENTURE_SKILLS: Readonly<Record<AdventureSkillId, AdventureSkill>> = {
  warmHeal: {
    id: 'warmHeal',
    nameEn: 'Warm Heal',
    nameKo: '따뜻한 회복',
    info: L('Get 12 voice back.', '목소리 힘을 12 되찾아요.'),
    chant: {
      1: L('I feel better!', '기분이 나아졌어!'),
      2: L('I feel warm and strong again.', '다시 따뜻하고 힘이 나.'),
      3: L('My lantern is warm, so I feel strong again.', '등불이 따뜻해서 다시 힘이 나.')
    }
  },
  shieldSong: {
    id: 'shieldSong',
    nameEn: 'Shield Song',
    nameKo: '방패 노래',
    info: L('Hits hurt half as much this turn.', '이번 차례에는 반만 아파요.'),
    chant: {
      1: L('Shield, please!', '방패야, 부탁해!'),
      2: L('Please keep me safe, shield.', '방패야, 나를 지켜 줘.'),
      3: L('Please keep me safe, shield, because the wind is strong.', '바람이 세니까 방패야, 나를 지켜 줘.')
    }
  },
  brightSpark: {
    id: 'brightSpark',
    nameEn: 'Bright Spark',
    nameKo: '반짝 불꽃',
    info: L('Your kind light fills CALM a lot.', '다정한 빛으로 마음(CALM)을 많이 채워요.'),
    chant: {
      1: L('Shine bright!', '밝게 빛나라!'),
      2: L('Shine bright, little light!', '작은 빛아, 밝게 빛나라!'),
      3: L('Shine bright, little light, and show my kind words.', '작은 빛아, 밝게 빛나서 내 다정한 말을 보여 줘.')
    }
  },
  slowWind: {
    id: 'slowWind',
    nameEn: 'Slow Wind',
    nameKo: '느린 바람',
    info: L('Everything moves slowly this turn.', '이번 차례에는 모든 게 느려져요.'),
    chant: {
      1: L('Slow down, please.', '천천히 해 줘.'),
      2: L('Please slow down, wind.', '바람아, 천천히 불어 줘.'),
      3: L('Please slow down, wind, so we can talk.', '바람아, 우리가 얘기할 수 있게 천천히 불어 줘.')
    }
  }
};

export interface AdventureGoods {
  id: AdventureGoodsId;
  kind: 'item' | 'gear' | 'skill';
  /** In coins found on the islands (never money). */
  cost: number;
}

export function adventureGoodsName(id: AdventureGoodsId): { en: string; ko: string } {
  const x = (ADVENTURE_ITEMS as Record<string, AdventureItem>)[id] ?? (ADVENTURE_GEAR as Record<string, AdventureGear>)[id] ?? ADVENTURE_SKILLS[id as AdventureSkillId];
  return { en: x.nameEn, ko: x.nameKo };
}

export function adventureGoodsInfo(id: AdventureGoodsId): AdventureLine {
  const item = (ADVENTURE_ITEMS as Record<string, AdventureItem>)[id];
  if (item) return item.heal >= 99 ? L('Get all your voice back.', '목소리 힘을 모두 되찾아요.') : L(`Get ${item.heal} voice back.`, `목소리 힘을 ${item.heal} 되찾아요.`);
  return ((ADVENTURE_GEAR as Record<string, AdventureGear>)[id] ?? ADVENTURE_SKILLS[id as AdventureSkillId]).info;
}

/** A talk with choices: lines, then (optionally) choices; `next` goes on by itself; `reward` is given once. */
export interface AdventureNode {
  lines: AdventureLine[];
  /** Said instead of `lines` once the node's reward was taken. */
  after?: AdventureLine[];
  choices?: Array<{ say: AdventureLine; to: string }>;
  /** Where to go after the lines ('@end' ends the talk, '@shop' opens the shop). */
  next?: string;
  reward?: { flag: string; coins?: number; item?: AdventureItemId; skill?: AdventureSkillId };
}

export interface AdventureNpc {
  id: string;
  nameEn: string;
  nameKo: string;
  /** The world cast role that lends the voice. */
  voice: 'guide' | 'cafe_owner' | 'shop_owner' | 'errand_neighbor';
  /** Starts at `start`. */
  tree: Record<string, AdventureNode>;
}

export interface AdventureChest {
  coins: number;
  item?: AdventureItemId;
}

/** A guardian's stage: from `at` (0..1 of the way to a friend or to leaving), its turns, speed and hit size. */
export interface AdventureBossStage {
  at: number;
  patterns: AdventurePatternId[];
  speed: number;
  damage: number;
  /** Said when the stage begins (stage 0: the meeting's first line). */
  line: AdventureLine;
}

export interface AdventureIsleStory {
  chapter: AdventureChapterId;
  /** The villager on the path, now with choices (replaces the one-way lines). */
  villager: AdventureNpc;
  chests: [AdventureChest, AdventureChest];
  /** What Tumble sells on this island. */
  stock: AdventureGoods[];
  /** Said before the guardian's meeting begins. */
  bossTalk: AdventureLine[];
  stages: AdventureBossStage[];
  /** Words after the guardian becomes a friend (before the island's end). */
  bossAfter: AdventureLine[];
}

const GOODS = {
  honeyDrop: { id: 'honeyDrop', kind: 'item', cost: 4 },
  berryBun: { id: 'berryBun', kind: 'item', cost: 8 },
  starTea: { id: 'starTea', kind: 'item', cost: 14 },
  braveCoat: { id: 'braveCoat', kind: 'gear', cost: 15 },
  bigScarf: { id: 'bigScarf', kind: 'gear', cost: 18 },
  glowLantern: { id: 'glowLantern', kind: 'gear', cost: 20 },
  shieldSong: { id: 'shieldSong', kind: 'skill', cost: 12 },
  brightSpark: { id: 'brightSpark', kind: 'skill', cost: 16 },
  slowWind: { id: 'slowWind', kind: 'skill', cost: 16 }
} as const satisfies Record<string, AdventureGoods>;

const bye = (en: string, ko: string): AdventureNode => ({ lines: [L(en, ko)], next: '@end' });

export const ADVENTURE_PROLOGUE: readonly AdventureLine[] = [
  L('Long ago, four islands sang with words.', '아주 먼 옛날, 네 섬은 낱말로 노래했어요.'),
  L('Then the Hushwind came. It blew all the words away.', '그런데 휘파람 바람이 와서 낱말을 모두 날려 버렸어요.'),
  L('Now the people here cannot say how they feel.', '이제 섬 주민들은 자기 기분을 말하지 못해요.'),
  L('You are a Keeper. Your lantern keeps words safe.', '당신은 등불지기예요. 등불은 낱말을 지켜 줘요.'),
  L('Find the lost words. Make friends. Bring the songs back!', '잃어버린 낱말을 찾고, 친구를 사귀고, 노래를 되찾아요!')
];

/** The ferry between islands (after island 1, 2 and 3). */
export const ADVENTURE_FERRY = { nameEn: 'Oarly the Otter', nameKo: '노 젓는 수달 오얼리' } as const;

export const ADVENTURE_SAIL: Readonly<Record<1 | 2 | 3, readonly AdventureLine[]>> = {
  1: [
    L('Hop in, Keeper! I am Oarly. I take friends across the sea.', '타, 등불지기! 나는 오얼리야. 친구들을 바다 건너로 태워 줘.'),
    L('Next stop is Saltglass Shore. A crab there is very grumpy.', '다음은 소금유리 해변이야. 거기 게가 아주 심술궂대.'),
    L('Hold your lantern tight. The waves are big today!', '등불을 꼭 잡아. 오늘은 파도가 커!')
  ],
  2: [
    L('Welcome back, Keeper! Next stop is Crumbtown.', '다시 왔구나, 등불지기! 다음은 부스러기 마을이야.'),
    L('The big oven there went cold. Nobody can smell bread.', '거기 큰 화덕이 식었대. 아무도 빵 냄새를 못 맡아.'),
    L('Look! The Hushwind is flying over the tower far away.', '봐! 저 멀리 탑 위로 휘파람 바람이 날고 있어.')
  ],
  3: [
    L('This is the last trip, Keeper. Next is Starloft Tower.', '마지막 여행이야, 등불지기. 다음은 별다락 탑이야.'),
    L('The Hushwind lives at the very top. It is strong.', '휘파람 바람은 맨 꼭대기에 살아. 아주 세.'),
    L('But you have friends now. Your words are strong too!', '하지만 이제 친구들이 있잖아. 네 말도 세!')
  ]
};

export const ADVENTURE_ENDING: readonly AdventureLine[] = [
  L('The wind is soft and warm now.', '이제 바람이 부드럽고 따뜻해요.'),
  L('The Hushwind was lonely. Nobody ever talked to it.', '휘파람 바람은 외로웠어요. 아무도 말을 걸지 않았거든요.'),
  L('Now it carries kind words to every island.', '이제 바람은 모든 섬에 다정한 말을 실어 날라요.'),
  L('Bells ring in the woods. Waves sing on the shore.', '숲에서는 방울이 울리고, 해변에서는 파도가 노래해요.'),
  L('The oven is warm, and the tower is full of stars.', '화덕은 따뜻하고, 탑은 별로 가득해요.'),
  L('Thank you, Keeper. You brought our words home!', '고마워요, 등불지기. 우리 낱말을 집으로 데려와 줬어요!')
];

export const ADVENTURE_CREDITS: readonly AdventureLine[] = [
  L('The Hushwind Isles', '휘파람 바람 섬'),
  L('Story, pictures and music made for LCW', 'LCW 를 위해 만든 이야기·그림·음악'),
  L('Every kind word was yours.', '모든 다정한 말은 당신의 것이었어요.'),
  L('The End', '끝')
];

/** Tumble the hedgehog sells things on every island. */
export const ADVENTURE_MERCHANT: AdventureNpc = {
  id: 'tumble',
  nameEn: 'Tumble',
  nameKo: '고슴도치 상인 텀블',
  voice: 'shop_owner',
  tree: {
    start: {
      lines: [L('Hi hi! I am Tumble. My cart has good things!', '안녕안녕! 나는 텀블이야. 내 수레엔 좋은 게 많아!')],
      choices: [
        { say: L('Can I see your shop?', '가게 좀 볼 수 있어요?'), to: '@shop' },
        { say: L('What are coins for?', '동전은 어디에 써요?'), to: 'coins' },
        { say: L('Bye for now!', '다음에 봐요!'), to: 'bye' }
      ]
    },
    coins: {
      lines: [
        L('Open chests and make friends. You get coins!', '상자를 열고 친구를 사귀면 동전이 생겨!'),
        L('Then you can buy snacks, coats and magic words here.', '그 동전으로 여기서 간식, 외투, 마법 말을 살 수 있어.')
      ],
      next: 'start'
    },
    bye: bye('Come back soon, friend!', '또 와, 친구!')
  }
};

export const ADVENTURE_STORY: Readonly<Record<AdventureChapterId, AdventureIsleStory>> = {
  1: {
    chapter: 1,
    villager: {
      id: 'old-fern',
      nameEn: 'Old Fern',
      nameKo: '고사리 할머니',
      voice: 'guide',
      tree: {
        start: {
          lines: [L('Oh, a Keeper with a lantern! The Hushwind took our words.', '오, 등불지기로구나! 휘파람 바람이 우리 낱말을 가져갔단다.')],
          choices: [
            { say: L('Who is at the end of the path?', '길 끝에는 누가 있어요?'), to: 'who' },
            { say: L('Can you teach me a trick?', '비법을 가르쳐 주실래요?'), to: 'teach' },
            { say: L('Can I try your quiz?', '퀴즈를 풀어 봐도 돼요?'), to: 'quiz' },
            { say: L('Bye, Old Fern!', '안녕히 계세요!'), to: 'bye' }
          ]
        },
        who: {
          lines: [
            L('Bramblebun lives there. It took the bell sounds.', '브램블번이 살아. 방울 소리를 가져갔지.'),
            L('It is a strong one. Rest at a lantern post first.', '아주 센 녀석이야. 먼저 등불 기둥에서 쉬어 가렴.')
          ],
          next: 'start'
        },
        teach: {
          lines: [L('Here is my old trick. It is called Warm Heal.', '내 오랜 비법이야. 따뜻한 회복이라고 해.'), L('Say the magic words in a meeting, and you feel better!', '만남 중에 마법 말을 하면 기운이 나지!')],
          after: [L('You know Warm Heal now. Use it when you are tired!', '이제 따뜻한 회복을 알지. 힘들 때 쓰렴!')],
          reward: { flag: 'skill-warmHeal', skill: 'warmHeal' },
          next: 'start'
        },
        quiz: {
          lines: [L('Here is my quiz. Which one can fly?', '내 퀴즈야. 어느 것이 날 수 있을까?')],
          choices: [
            { say: L('An eagle can fly.', '독수리는 날 수 있어요.'), to: 'right' },
            { say: L('A turtle can fly.', '거북은 날 수 있어요.'), to: 'wrong' },
            { say: L('A rock can fly.', '돌은 날 수 있어요.'), to: 'wrong' }
          ]
        },
        right: {
          lines: [L('Yes! Eagles fly high. Here are 5 coins!', '맞아! 독수리는 높이 날지. 동전 5개 받으렴!')],
          after: [L('Yes! You are so smart.', '맞아! 정말 똑똑하구나.')],
          reward: { flag: 'quiz-1', coins: 5 },
          next: 'start'
        },
        wrong: { lines: [L('Hmm, not quite. Think again!', '음, 그건 아니야. 다시 생각해 보렴!')], next: 'quiz' },
        bye: bye('Be kind, and talk a lot. Good luck!', '다정하게, 많이 말하렴. 행운을 빌어!')
      }
    },
    chests: [{ coins: 10 }, { coins: 3, item: 'berryBun' }],
    stock: [GOODS.honeyDrop, GOODS.berryBun, GOODS.braveCoat],
    bossTalk: [
      L('Bramblebun jumps out of the bushes!', '브램블번이 덤불에서 튀어나와요!'),
      L('"Go home! These bell sounds are mine now!"', '"집에 가! 이 방울 소리는 이제 내 거야!"')
    ],
    stages: [
      { at: 0, patterns: ['acornDrop', 'letterCatch', 'leafRing'], speed: 1, damage: 4, line: L('Bramblebun shakes its thorns at you!', '브램블번이 가시를 흔들어요!') },
      { at: 0.34, patterns: ['leafRing', 'acornDrop', 'spellBubbles'], speed: 1.15, damage: 4, line: L('Bramblebun spins fast! Leaves fly everywhere!', '브램블번이 빠르게 돌아요! 잎이 사방으로 날아요!') },
      { at: 0.67, patterns: ['leafRing', 'letterCatch', 'acornDrop', 'leafRing'], speed: 1.3, damage: 5, line: L('Its bells shake hard. This is its last try!', '방울이 마구 흔들려요. 마지막 힘이에요!') }
    ],
    bossAfter: [L('Ding, ding! The moss bells ring again.', '딩, 딩! 이끼 방울이 다시 울려요.')]
  },
  2: {
    chapter: 2,
    villager: {
      id: 'dune',
      nameEn: 'Dune',
      nameKo: '모래언덕 소년 듄',
      voice: 'errand_neighbor',
      tree: {
        start: {
          lines: [L('Hi, Keeper! Captain Clatterclaw says no to every trade.', '안녕, 등불지기! 클래터클로 선장이 모든 교환을 거절해.')],
          choices: [
            { say: L('Why is the captain so grumpy?', '선장은 왜 그렇게 심술궂어?'), to: 'why' },
            { say: L('Can I try your quiz?', '퀴즈 풀어 봐도 돼?'), to: 'quiz' },
            { say: L('See you later!', '나중에 봐!'), to: 'bye' }
          ]
        },
        why: {
          lines: [L('Nobody asks him nicely. They just grab his shells.', '아무도 예쁘게 안 물어보고 그냥 조개를 가져가거든.'), L('His claws hit hard. Buy a coat from Tumble!', '집게가 아주 세. 텀블한테 외투를 사 둬!')],
          next: 'start'
        },
        quiz: {
          lines: [L('Here is my quiz. Where does a boat go?', '내 퀴즈야. 배는 어디로 다닐까?')],
          choices: [
            { say: L('A boat goes on the sea.', '배는 바다 위로 다녀.'), to: 'right' },
            { say: L('A boat goes in the sky.', '배는 하늘로 다녀.'), to: 'wrong' },
            { say: L('A boat goes in a cake.', '배는 케이크 속으로 다녀.'), to: 'wrong' }
          ]
        },
        right: {
          lines: [L('Right! Here are 5 coins for you.', '맞아! 동전 5개 줄게.')],
          after: [L('Right! You know boats well.', '맞아! 배를 잘 아는구나.')],
          reward: { flag: 'quiz-2', coins: 5 },
          next: 'start'
        },
        wrong: { lines: [L('Ha ha, no! Try again.', '하하, 아니야! 다시 해 봐.')], next: 'quiz' },
        bye: bye('Ask the captain nicely. He will listen!', '선장한테 예쁘게 물어봐. 들어줄 거야!')
      }
    },
    chests: [{ coins: 12 }, { coins: 2, item: 'starTea' }],
    stock: [GOODS.honeyDrop, GOODS.berryBun, GOODS.braveCoat, GOODS.shieldSong, GOODS.bigScarf],
    bossTalk: [
      L('Captain Clatterclaw clacks his big claws.', '클래터클로 선장이 큰 집게를 딱딱거려요.'),
      L('"No trades! Not today, not ever!"', '"교환은 없어! 오늘도, 앞으로도!"')
    ],
    stages: [
      { at: 0, patterns: ['shellSweep', 'spellBubbles', 'bubbleRise'], speed: 1, damage: 4, line: L('The captain swings his claws!', '선장이 집게를 휘둘러요!') },
      { at: 0.34, patterns: ['bubbleRise', 'shellSweep', 'letterCatch'], speed: 1.2, damage: 5, line: L('Big waves crash in! The captain is angry!', '큰 파도가 덮쳐요! 선장이 화났어요!') },
      { at: 0.67, patterns: ['shellSweep', 'bubbleRise', 'shellSweep', 'spellBubbles'], speed: 1.35, damage: 5, line: L('The captain spins like a storm! Hold on!', '선장이 폭풍처럼 돌아요! 버텨요!') }
    ],
    bossAfter: [L('Waves sing on the shore. Everyone is trading again.', '파도가 해변에서 노래해요. 모두 다시 물건을 바꿔요.')]
  },
  3: {
    chapter: 3,
    villager: {
      id: 'pip-toast',
      nameEn: 'Pip Toast',
      nameKo: '토스트 아저씨 핍',
      voice: 'cafe_owner',
      tree: {
        start: {
          lines: [L('Welcome, Keeper! Nobody orders bread since the Hushwind came.', '어서 와, 등불지기! 휘파람 바람이 온 뒤로 아무도 빵을 주문 안 해.')],
          choices: [
            { say: L('How can I help Ovenna?', '오베나를 어떻게 도와요?'), to: 'help' },
            { say: L('Can I try your quiz?', '퀴즈 풀어 봐도 돼요?'), to: 'quiz' },
            { say: L('I have to go. Bye!', '가 봐야 해요. 안녕히 계세요!'), to: 'bye' }
          ]
        },
        help: {
          lines: [L('Order politely. Say please and thank you.', '예의 바르게 주문해. 부탁해요, 고마워요를 말하렴.'), L('Ovenna throws hot rolls. Bright Spark helps a lot!', '오베나는 뜨거운 빵을 던져. 반짝 불꽃이 큰 도움이 될 거야!')],
          next: 'start'
        },
        quiz: {
          lines: [L('Here is my quiz. Which one is sweet?', '내 퀴즈야. 어느 것이 달콤할까?')],
          choices: [
            { say: L('A cookie is sweet.', '쿠키는 달콤해요.'), to: 'right' },
            { say: L('A shoe is sweet.', '신발은 달콤해요.'), to: 'wrong' },
            { say: L('A stone is sweet.', '돌은 달콤해요.'), to: 'wrong' }
          ]
        },
        right: {
          lines: [L('Yum, yes! Here are 6 coins.', '냠, 맞아! 동전 6개 받으렴.')],
          after: [L('Yum, yes! Cookies are the best.', '냠, 맞아! 쿠키가 최고지.')],
          reward: { flag: 'quiz-3', coins: 6 },
          next: 'start'
        },
        wrong: { lines: [L('Oh no, do not eat that! Try again.', '어이쿠, 그건 먹으면 안 돼! 다시 해 봐.')], next: 'quiz' },
        bye: bye('Warm her up with a nice order!', '멋진 주문으로 오베나를 데워 주렴!')
      }
    },
    chests: [{ coins: 15 }, { coins: 5, item: 'berryBun' }],
    stock: [GOODS.honeyDrop, GOODS.berryBun, GOODS.starTea, GOODS.brightSpark, GOODS.glowLantern, GOODS.bigScarf],
    bossTalk: [
      L('Ovenna stomps out. Her door swings open.', '오베나가 쿵쿵 걸어 나와요. 문이 삐걱 열려요.'),
      L('"Nobody orders. So I bake hot sparks!"', '"아무도 주문 안 해. 그래서 뜨거운 불꽃을 굽지!"')
    ],
    stages: [
      { at: 0, patterns: ['rollBounce', 'wordCookies', 'sprinkleRain'], speed: 1.05, damage: 4, line: L('Ovenna throws hot rolls!', '오베나가 뜨거운 빵을 던져요!') },
      { at: 0.34, patterns: ['sprinkleRain', 'rollBounce', 'letterCatch'], speed: 1.25, damage: 5, line: L('The oven gets red hot! Sparks rain down!', '화덕이 빨갛게 달아요! 불꽃 비가 내려요!') },
      { at: 0.67, patterns: ['rollBounce', 'sprinkleRain', 'wordCookies', 'rollBounce'], speed: 1.4, damage: 5, line: L('Ovenna bakes as fast as she can! Watch out!', '오베나가 있는 힘껏 구워요! 조심해요!') }
    ],
    bossAfter: [L('The oven is warm again. Fresh bread for everyone!', '화덕이 다시 따뜻해요. 모두에게 갓 구운 빵을!')]
  },
  4: {
    chapter: 4,
    villager: {
      id: 'nim',
      nameEn: 'Nim the Lamplighter',
      nameKo: '등불 켜는 님',
      voice: 'guide',
      tree: {
        start: {
          lines: [L('You came all the way up here! The Hushwind is at the top.', '여기까지 왔구나! 휘파람 바람은 꼭대기에 있어.')],
          choices: [
            { say: L('Why did the Hushwind take the words?', '휘파람 바람은 왜 낱말을 가져갔어요?'), to: 'why' },
            { say: L('Can I try your quiz?', '퀴즈 풀어 봐도 돼요?'), to: 'quiz' },
            { say: L('I am ready. Bye!', '준비됐어요. 안녕히 계세요!'), to: 'bye' }
          ]
        },
        why: {
          lines: [
            L('I think it is very lonely. Nobody ever talks to it.', '아주 외로운 것 같아. 아무도 말을 걸지 않거든.'),
            L('It is very strong. It has three kinds of wind.', '아주 세. 바람이 세 가지나 돼.'),
            L('If you fall, the lantern post here will help you.', '쓰러지면 여기 등불 기둥이 도와줄 거야.')
          ],
          next: 'start'
        },
        quiz: {
          lines: [L('Here is my quiz. What do we see at night?', '내 퀴즈야. 밤에는 무엇이 보일까?')],
          choices: [
            { say: L('We see the moon.', '달이 보여요.'), to: 'right' },
            { say: L('We see the sun.', '해가 보여요.'), to: 'wrong' },
            { say: L('We see a sandwich.', '샌드위치가 보여요.'), to: 'wrong' }
          ]
        },
        right: {
          lines: [L('Yes! The moon is bright at night. Take 6 coins!', '맞아! 밤에는 달이 밝지. 동전 6개 가져가!')],
          after: [L('Yes! You know the night sky.', '맞아! 밤하늘을 잘 아는구나.')],
          reward: { flag: 'quiz-4', coins: 6 },
          next: 'start'
        },
        wrong: { lines: [L('Hmm, look up again. Try once more!', '음, 다시 올려다봐. 한 번 더 해 봐!')], next: 'quiz' },
        bye: bye('Use every word you learned. Good luck!', '배운 낱말을 모두 써 봐. 행운을 빌어!')
      }
    },
    chests: [{ coins: 15 }, { coins: 5, item: 'starTea' }],
    stock: [GOODS.honeyDrop, GOODS.berryBun, GOODS.starTea, GOODS.slowWind, GOODS.shieldSong, GOODS.brightSpark],
    bossTalk: [
      L('A cold wind fills the room. The stars go dark.', '차가운 바람이 방을 채워요. 별들이 어두워져요.'),
      L('"Words are loud. Words are scary. I keep them quiet."', '"낱말은 시끄럽고 무서워. 내가 조용히 가지고 있을 거야."'),
      L('"You will not take them back. Not you, not anyone!"', '"넌 못 가져가. 너도, 누구도!"')
    ],
    stages: [
      { at: 0, patterns: ['windSpiral', 'inkRain', 'letterCatch'], speed: 1.1, damage: 4, line: L('The Hushwind spins around you!', '휘파람 바람이 당신 주위를 돌아요!') },
      { at: 0.3, patterns: ['kiteDive', 'windSpiral', 'spellBubbles'], speed: 1.25, damage: 5, line: L('The Hushwind grows big! Paper birds dive down!', '휘파람 바람이 커져요! 종이 새가 내리꽂혀요!') },
      { at: 0.6, patterns: ['windSpiral', 'inkRain', 'kiteDive', 'wordCookies'], speed: 1.4, damage: 5, line: L('A storm! Every stolen word flies at you!', '폭풍이에요! 훔친 낱말이 모두 날아와요!') },
      { at: 0.85, patterns: ['windSpiral', 'kiteDive', 'windSpiral'], speed: 1.55, damage: 6, line: L('"Stop talking! Please... I do not know what to do!"', '"그만 말해! 제발… 어떻게 해야 할지 모르겠어!"') }
    ],
    bossAfter: [
      L('"You talked to me, even when I was mean."', '"내가 못되게 굴 때도 너는 말을 걸어 줬어."'),
      L('"Nobody did that before. Thank you, Keeper."', '"그런 건 처음이야. 고마워, 등불지기."'),
      L('"I will give every word back. Can I be your friend?"', '"낱말을 모두 돌려줄게. 나도 네 친구가 될 수 있을까?"')
    ]
  }
};

/** The lantern post: rest, full voice, and the trip is kept here. */
export const ADVENTURE_POST = {
  nameEn: 'Lantern Post',
  nameKo: '등불 기둥',
  first: L('The lantern post glows. Your voice is full again! Your trip is kept here.', '등불 기둥이 빛나요. 목소리 힘이 가득 찼어요! 여기서부터 다시 할 수 있어요.'),
  again: L('The lantern post glows. Your voice is full again!', '등불 기둥이 빛나요. 목소리 힘이 가득 찼어요!')
} as const;
