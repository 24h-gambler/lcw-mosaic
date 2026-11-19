import { bankEntriesFor, type LangLevel } from './lang-en-ko.js';
import { npcCast, type NpcVoice } from './npc-cast.js';

/**
 * The Hushwind Isles — the /adventure/ story (docs/22, R2625 ⑧⑨). Every name, line and place here was written for
 * LCW; nothing is borrowed from another work (apps/adventure/src/__tests__/adventure-originality.test.ts scans for that).
 *
 * The child walks four islands, one per lesson day. Islanders who lost their words throw letters and ink; the child
 * calms them by speaking that day's English (TALK), and a calm islander becomes a friend (FRIEND). English is what the
 * child reads and hears; `ko` is the Korean help line shown when the help switch is on.
 */

export type AdventureChapterId = 1 | 2 | 3 | 4;
export type AdventureLevel = 1 | 2 | 3;
export type AdventureWordPos = 'n' | 'nu' | 'adj' | 'v';

export interface AdventureLine {
  en: string;
  ko: string;
}

/** Islanders borrow a voice from the world cast pack (edge tts.ts only speaks cast voices). */
export type AdventureVoiceRef = 'guide' | 'cafe_owner' | 'shop_owner' | 'errand_neighbor';

export type AdventurePatternId =
  | 'acornDrop'
  | 'leafRing'
  | 'letterCatch'
  | 'spellBubbles'
  | 'shellSweep'
  | 'bubbleRise'
  | 'rollBounce'
  | 'sprinkleRain'
  | 'wordCookies'
  | 'windSpiral'
  | 'inkRain'
  | 'kiteDive';

export interface AdventureCreature {
  id: string;
  nameEn: string;
  nameKo: string;
  /** 'guardian' ends the chapter; 'critter' waits on the path. */
  role: 'critter' | 'guardian';
  voice: AdventureVoiceRef;
  sprite: string;
  /** Bullet patterns it uses, in turn order (repeats). */
  patterns: AdventurePatternId[];
  intro: AdventureLine;
  /** A line before each of its turns (cycled). */
  turns: AdventureLine[];
  /** After a TALK, by stars 0..3 (0 = not yet). */
  react: [AdventureLine, AdventureLine, AdventureLine, AdventureLine];
  /** Calm is full: FRIEND now works. */
  ready: AdventureLine;
  /** Became a friend. */
  friend: AdventureLine;
  /** Hit by POKE. */
  poked: AdventureLine;
  /** Grump ran out after POKEs: it leaves, sad. */
  leaves: AdventureLine;
  /** The reply prompt for a ✅ pick TALK (what it says, the child answers). */
  asks: AdventureLine;
  /** Which of the island's sentences answers `asks` (greet / feel / the phrase-bank line). */
  askKind: 'greet' | 'feel' | 'bank';
  /** Its own right reply to `asks` per level, when the island's sentence does not answer that question. */
  answer?: Record<AdventureLevel, AdventureLine>;
}

export interface AdventureChapter {
  id: AdventureChapterId;
  islandEn: string;
  islandKo: string;
  /** docs/22 1.1: the LCW phrase-bank situation this island practises. */
  ctx: 'guide' | 'trade_shop' | 'cafe' | 'errand';
  /** Topic and words used when the student document gave none. */
  defaultTopic: string;
  defaultWords: [string, string, string];
  mood: AdventureLine;
  /** Shown on the island map and when the island opens. */
  intro: AdventureLine;
  /** A villager on the path (one line each, in order). */
  villager: { nameEn: string; nameKo: string; lines: AdventureLine[] };
  /** Spoken when the chapter is cleared. */
  outro: AdventureLine;
  greet: Record<AdventureLevel, AdventureLine>;
  feel: Record<AdventureLevel, AdventureLine>;
  befriend: Record<AdventureLevel, AdventureLine>;
  critters: [AdventureCreature, AdventureCreature];
  guardian: AdventureCreature;
  music: 'woods' | 'shore' | 'bakery' | 'tower';
}

const L = (en: string, ko: string): AdventureLine => ({ en, ko });

const REACT_DEFAULT: AdventureCreature['react'] = [
  L('Hmm? Say it one more time?', '응? 한 번만 더 말해 줄래?'),
  L('Oh... that is nice.', '오… 그거 좋다.'),
  L('Wow, I like that!', '와, 그 말 좋아!'),
  L('That was perfect. I feel so much better!', '완벽했어. 기분이 훨씬 좋아졌어!')
];

export const ADVENTURE_CHAPTERS: readonly AdventureChapter[] = [
  {
    id: 1,
    islandEn: 'Mossbell Woods',
    islandKo: '이끼종 숲',
    ctx: 'guide',
    defaultTopic: 'animals',
    defaultWords: ['puppy', 'eagle', 'turtle'],
    mood: L('happy', '행복한'),
    intro: L('The bells in the moss stopped ringing. Someone in the woods is hiding.', '이끼 속 방울이 울리지 않아요. 숲 속에 누군가 숨어 있어요.'),
    villager: {
      nameEn: 'Old Fern',
      nameKo: '고사리 할머니',
      lines: [
        L('Oh, a Keeper with a lantern! The Hushwind took our words.', '오, 등불지기로구나! 휘파람 바람이 우리 낱말을 가져갔단다.'),
        L('Bramblebun is hiding at the end of the path. Be kind and talk.', '길 끝에 브램블번이 숨어 있어. 다정하게 말을 걸어 보렴.')
      ]
    },
    outro: L('The moss bells ring again. Ding, ding!', '이끼 방울이 다시 울려요. 딩, 딩!'),
    greet: {
      1: L('Hello! Nice to meet you.', '안녕! 만나서 반가워.'),
      2: L('Hello! Are you okay? I want to help you.', '안녕! 괜찮아? 도와주고 싶어.'),
      3: L('Hi there! You look a little sad. Can I help you?', '안녕! 조금 슬퍼 보여. 내가 도와줄까?')
    },
    feel: {
      1: L('I am happy.', '나는 행복해.'),
      2: L('I feel happy today because I met you.', '오늘 너를 만나서 행복해.'),
      3: L('Actually, I feel happy today because I found a new friend.', '사실 오늘 새 친구를 찾아서 행복해.')
    },
    befriend: {
      1: L("Let's be friends!", '우리 친구 하자!'),
      2: L('Do you want to be my friend?', '나랑 친구 할래?'),
      3: L("I would love to be your friend. Let's play together!", '네 친구가 되고 싶어. 같이 놀자!')
    },
    critters: [
      {
        id: 'rootle',
        nameEn: 'Rootle',
        nameKo: '루틀',
        role: 'critter',
        voice: 'errand_neighbor',
        sprite: 'rootle',
        patterns: ['acornDrop', 'letterCatch'],
        intro: L('Rootle pops out of the ground! It shakes its leaves at you.', '루틀이 땅에서 쏙 나왔어요! 잎을 흔들어요.'),
        turns: [L('Rootle wiggles. Acorns fall!', '루틀이 꿈틀! 도토리가 떨어져요!'), L('Letters spin out of its leaves.', '잎에서 글자가 빙글빙글 나와요.')],
        react: REACT_DEFAULT,
        ready: L('Rootle stops wiggling. It looks calm.', '루틀이 꿈틀거림을 멈췄어요. 차분해 보여요.'),
        friend: L('Rootle gives you a tiny leaf. Friends!', '루틀이 작은 잎을 줬어요. 친구가 됐어요!'),
        poked: L('Ow! Rootle pulls in its leaves.', '아야! 루틀이 잎을 오므려요.'),
        leaves: L('Rootle hides back in the ground.', '루틀이 땅속으로 숨어 버렸어요.'),
        asks: L('Hello? Who is there?', '안녕? 거기 누구야?'),
        askKind: 'greet',
        answer: {
          1: L('It is me! Hello!', '나야! 안녕!'),
          2: L("Hi, it's me. I am a new friend.", '안녕, 나야. 나는 새 친구야.'),
          3: L("Hello! It's just me, a friend walking through the woods.", '안녕! 그냥 나야, 숲을 걷고 있는 친구.')
        }
      },
      {
        id: 'conekin',
        nameEn: 'Conekin',
        nameKo: '콘킨',
        role: 'critter',
        voice: 'errand_neighbor',
        sprite: 'conekin',
        patterns: ['leafRing', 'spellBubbles'],
        intro: L('A round Conekin rolls out from under a fern.', '동글동글 콘킨이 고사리 밑에서 데굴데굴 굴러 나와요.'),
        turns: [L('Conekin spins. Leaves fly in a circle!', '콘킨이 빙글! 잎이 동그랗게 날아요!'), L('Conekin shakes out word bubbles.', '콘킨이 몸을 흔들어 낱말 거품을 털어 내요.')],
        react: REACT_DEFAULT,
        ready: L('Conekin stops rolling and sits by your lantern. It is calm now.', '콘킨이 구르기를 멈추고 등불 옆에 앉았어요. 이제 차분해요.'),
        friend: L('Conekin gives you a tiny seed. You are friends!', '콘킨이 작은 씨앗을 줬어요. 친구가 됐어요!'),
        poked: L('Conekin rolls back a little.', '콘킨이 조금 뒤로 굴러가요.'),
        leaves: L('Conekin rolls far away.', '콘킨이 멀리 굴러가 버렸어요.'),
        asks: L('How do you feel?', '기분이 어때?'),
        askKind: 'feel'
      }
    ],
    guardian: {
      id: 'bramblebun',
      nameEn: 'Bramblebun',
      nameKo: '브램블번',
      role: 'guardian',
      voice: 'errand_neighbor',
      sprite: 'bramblebun',
      patterns: ['acornDrop', 'letterCatch', 'leafRing', 'spellBubbles', 'letterCatch'],
      intro: L('Bramblebun rolls out of the bushes! Its bells are silent.', '브램블번이 덤불에서 굴러 나왔어요! 방울이 조용해요.'),
      turns: [
        L('Go away! Nobody talks to me anyway.', '저리 가! 어차피 아무도 나랑 말 안 해.'),
        L('My bells lost their sound... and their letters!', '내 방울은 소리를… 글자도 잃어버렸어!'),
        L('Hmph. You are still here?', '흥. 아직도 여기 있어?')
      ],
      react: [
        L('Hmm? I did not hear you. Say it again?', '응? 못 들었어. 다시 말해 줄래?'),
        L('...You talked to me?', '…나한테 말 건 거야?'),
        L('Nobody said that to me before.', '그런 말 해 준 건 네가 처음이야.'),
        L('My bells... they are ringing a little!', '내 방울이… 조금 울려!')
      ],
      ready: L('Bramblebun is not rolling anymore. Its bells hum softly.', '브램블번이 더는 구르지 않아요. 방울이 살짝 울려요.'),
      friend: L('Ding! You are my first friend. Here, take back your words!', '딩! 넌 내 첫 친구야. 자, 네 낱말을 돌려줄게!'),
      poked: L('Ouch! Words would be nicer than that...', '아야! 그것보다 말이 더 좋을 텐데…'),
      leaves: L('Bramblebun rolls away into the dark woods.', '브램블번이 어두운 숲으로 굴러가 버렸어요.'),
      asks: L('You look lost. What do you want to ask me?', '길을 잃은 것 같네. 나한테 뭘 물어보고 싶어?'),
      askKind: 'bank'
    },
    music: 'woods'
  },
  {
    id: 2,
    islandEn: 'Saltglass Shore',
    islandKo: '소금유리 해변',
    ctx: 'trade_shop',
    defaultTopic: 'ocean',
    defaultWords: ['shell', 'island', 'boat'],
    mood: L('excited', '신나는'),
    intro: L('The sea glass sparkles, but the shore is quiet. A captain keeps every shell to himself.', '바다 유리는 반짝이지만 해변은 조용해요. 한 선장이 조개를 모두 혼자 가지고 있어요.'),
    villager: {
      nameEn: 'Dune',
      nameKo: '모래언덕 소년 듄',
      lines: [
        L('Hi, Keeper! I want to trade, but Captain Clatterclaw says no to everyone.', '안녕, 등불지기! 바꾸고 싶은데 클래터클로 선장이 다 싫대.'),
        L('Maybe he just wants someone to ask nicely.', '어쩌면 누가 예쁘게 부탁해 주길 바라는 걸지도 몰라.')
      ]
    },
    outro: L('Waves sing on the shore. Everyone is trading and laughing.', '파도가 해변에서 노래해요. 모두 물건을 바꾸며 웃어요.'),
    greet: {
      1: L('Hi! I like your shell.', '안녕! 네 조개 멋지다.'),
      2: L('Hi! Your shell is so cool.', '안녕! 네 조개 정말 멋지다.'),
      3: L('Hello! I have never seen a shell as cool as yours.', '안녕! 이렇게 멋진 조개는 처음 봐.')
    },
    feel: {
      1: L('I am excited.', '나는 신나.'),
      2: L('I feel excited today because I am at the beach.', '오늘 해변에 와서 신나.'),
      3: L('Actually, I feel excited today because the sea looks so beautiful.', '사실 오늘 바다가 너무 아름다워서 신나.')
    },
    befriend: {
      1: L("Let's trade and be friends!", '바꾸고 친구 하자!'),
      2: L('Can we be friends and trade together?', '우리 친구 하면서 같이 바꿀까?'),
      3: L("I hope we can be friends, so let's trade together every day.", '우리가 친구가 되면 좋겠어. 그러니 매일 같이 바꾸자.')
    },
    critters: [
      {
        id: 'bubblit',
        nameEn: 'Bubblit',
        nameKo: '버블릿',
        role: 'critter',
        voice: 'errand_neighbor',
        sprite: 'bubblit',
        patterns: ['bubbleRise', 'spellBubbles'],
        intro: L('Bubblit floats up from a tide pool. Blub!', '버블릿이 물웅덩이에서 둥실 떠올라요. 뽀글!'),
        turns: [L('Bubblit blows bubbles from below!', '버블릿이 아래에서 거품을 불어요!'), L('Some bubbles carry spellings.', '어떤 거품에는 철자가 들어 있어요.')],
        react: REACT_DEFAULT,
        ready: L('Bubblit floats slowly. It is calm.', '버블릿이 천천히 떠다녀요. 차분해요.'),
        friend: L('Bubblit gives you a shiny bubble. Friends!', '버블릿이 반짝 거품을 줬어요. 친구가 됐어요!'),
        poked: L('Pop! Bubblit shrinks a little.', '퐁! 버블릿이 조금 작아졌어요.'),
        leaves: L('Bubblit sinks back into the water.', '버블릿이 물속으로 가라앉아 버렸어요.'),
        asks: L('How do you feel at the beach?', '해변에 오니 기분이 어때?'),
        askKind: 'feel'
      },
      {
        id: 'shellbop',
        nameEn: 'Shellbop',
        nameKo: '셸밥',
        role: 'critter',
        voice: 'shop_owner',
        sprite: 'shellbop',
        patterns: ['shellSweep', 'letterCatch'],
        intro: L('Shellbop rolls across the sand and bumps into you!', '셸밥이 모래 위를 굴러와 쿵 부딪쳤어요!'),
        turns: [L('Shellbop rolls back and forth!', '셸밥이 이리저리 굴러요!'), L('Letters fall out of its shell.', '껍데기에서 글자가 쏟아져요.')],
        react: REACT_DEFAULT,
        ready: L('Shellbop peeks out of its shell. It is calm.', '셸밥이 껍데기 밖을 빼꼼 봐요. 차분해요.'),
        friend: L('Shellbop spins happily. Friends!', '셸밥이 신나게 빙글 돌아요. 친구가 됐어요!'),
        poked: L('Shellbop hides inside its shell.', '셸밥이 껍데기 속에 숨어요.'),
        leaves: L('Shellbop rolls far down the beach.', '셸밥이 해변 멀리 굴러가 버렸어요.'),
        asks: L('Who are you?', '너는 누구야?'),
        askKind: 'greet',
        answer: {
          1: L('I am your new friend.', '나는 너의 새 친구야.'),
          2: L("I'm a friend. I came here by boat.", '나는 친구야. 배를 타고 왔어.'),
          3: L("I'm a friend who sailed all the way here to say hello.", '나는 인사하려고 여기까지 배를 타고 온 친구야.')
        }
      }
    ],
    guardian: {
      id: 'clatterclaw',
      nameEn: 'Captain Clatterclaw',
      nameKo: '클래터클로 선장',
      role: 'guardian',
      voice: 'shop_owner',
      sprite: 'clatterclaw',
      patterns: ['shellSweep', 'spellBubbles', 'bubbleRise', 'letterCatch', 'shellSweep'],
      intro: L('Captain Clatterclaw clacks his claws. "No trades today! No trades ever!"', '클래터클로 선장이 집게를 딱딱! "오늘은 안 바꿔! 영원히 안 바꿔!"'),
      turns: [
        L('These shells are mine! All mine!', '이 조개는 내 거야! 전부 내 거!'),
        L('Nobody asks me nicely. They just grab!', '아무도 예쁘게 안 물어봐. 그냥 가져가!'),
        L('Clack, clack! Are you still talking?', '딱, 딱! 아직도 말하는 거야?')
      ],
      react: [
        L('Eh? Speak up, little Keeper!', '어? 크게 말해, 꼬마 등불지기!'),
        L('Hmm. That was polite.', '흠. 예의 바르군.'),
        L('Nobody asked me like that before!', '그렇게 물어본 건 네가 처음이야!'),
        L('Ho ho! Now that is how you trade!', '호호! 그래, 바로 그렇게 바꾸는 거지!')
      ],
      ready: L('The captain puts his claws down. He is listening.', '선장이 집게를 내렸어요. 귀 기울이고 있어요.'),
      friend: L('Fine, fine! A fair trade. Take your words back, friend!', '좋아, 좋아! 공정한 교환이야. 네 낱말을 돌려가, 친구!'),
      poked: L('Hey! Pinching is my job!', '야! 꼬집는 건 내 일이야!'),
      leaves: L('The captain grabs his shells and stomps away.', '선장이 조개를 챙겨 쿵쿵 가 버렸어요.'),
      asks: L('What do you want to trade?', '뭘 바꾸고 싶어?'),
      askKind: 'bank'
    },
    music: 'shore'
  },
  {
    id: 3,
    islandEn: 'Crumbtown',
    islandKo: '부스러기 마을',
    ctx: 'cafe',
    defaultTopic: 'food',
    defaultWords: ['sweet', 'snack', 'bake'],
    mood: L('hungry', '배고픈'),
    intro: L('Crumbtown smells like nothing at all. The big oven went cold.', '부스러기 마을에 아무 냄새도 안 나요. 큰 화덕이 식어 버렸어요.'),
    villager: {
      nameEn: 'Pip Toast',
      nameKo: '토스트 아저씨 핍',
      lines: [
        L('Welcome, Keeper! Nobody orders anything since the Hushwind came.', '어서 와, 등불지기! 휘파람 바람이 온 뒤로 아무도 주문을 안 해.'),
        L('Ovenna gets warm when someone orders politely. Try it!', '누가 예의 바르게 주문하면 오베나가 따뜻해진단다. 해 봐!')
      ]
    },
    outro: L('The oven is warm again. Fresh bread for everyone!', '화덕이 다시 따뜻해요. 모두에게 갓 구운 빵을!'),
    greet: {
      1: L('Hello! Your bread looks good.', '안녕하세요! 빵이 맛있어 보여요.'),
      2: L('Hello! Your bread smells so good.', '안녕하세요! 빵 냄새가 정말 좋아요.'),
      3: L('Good morning! Your bread smells so good that I want to try it.', '좋은 아침이에요! 빵 냄새가 너무 좋아서 먹어 보고 싶어요.')
    },
    feel: {
      1: L('I am hungry.', '나는 배고파.'),
      2: L('I feel hungry today because I did not eat lunch.', '점심을 안 먹어서 오늘 배고파.'),
      3: L('Actually, I feel very hungry today because I walked across the whole town.', '사실 마을을 다 걸어 다녀서 오늘 아주 배고파.')
    },
    befriend: {
      1: L('Thank you! You are my friend.', '고마워! 넌 내 친구야.'),
      2: L('Thank you so much! Can we be friends?', '정말 고마워! 우리 친구 할래?'),
      3: L('Thank you for the food. I want to come back here with my friends!', '음식 고마워. 친구들이랑 여기 다시 오고 싶어!')
    },
    critters: [
      {
        id: 'doughdot',
        nameEn: 'Doughdot',
        nameKo: '도우닷',
        role: 'critter',
        voice: 'cafe_owner',
        sprite: 'doughdot',
        patterns: ['rollBounce', 'wordCookies'],
        intro: L('Doughdot plops onto the road. Squish!', '도우닷이 길 위에 털썩. 말랑!'),
        turns: [L('Doughdot throws bouncy rolls!', '도우닷이 통통 튀는 빵을 던져요!'), L('Word cookies roll by. Catch the right one!', '낱말 쿠키가 굴러가요. 맞는 걸 잡아요!')],
        react: REACT_DEFAULT,
        ready: L('Doughdot rises softly. It is calm.', '도우닷이 몽글몽글 부풀어요. 차분해요.'),
        friend: L('Doughdot gives you a warm crumb. Friends!', '도우닷이 따뜻한 부스러기를 줬어요. 친구가 됐어요!'),
        poked: L('Doughdot gets a little flat.', '도우닷이 조금 납작해졌어요.'),
        leaves: L('Doughdot rolls into a bakery and hides.', '도우닷이 빵집으로 굴러가 숨어 버렸어요.'),
        asks: L('Are you hungry?', '배고파?'),
        askKind: 'feel'
      },
      {
        id: 'sugarfly',
        nameEn: 'Sugarfly',
        nameKo: '슈가플라이',
        role: 'critter',
        voice: 'errand_neighbor',
        sprite: 'sugarfly',
        patterns: ['sprinkleRain', 'letterCatch'],
        intro: L('A Sugarfly zips around your head!', '슈가플라이가 머리 주위를 쌩쌩 날아요!'),
        turns: [L('Sugarfly shakes rainbow sprinkles!', '슈가플라이가 무지개 스프링클을 흔들어요!'), L('Sugar letters drift down.', '설탕 글자가 살랑살랑 내려와요.')],
        react: REACT_DEFAULT,
        ready: L('Sugarfly hovers in one place. It is calm.', '슈가플라이가 한 자리에 떠 있어요. 차분해요.'),
        friend: L('Sugarfly draws a heart in sugar. Friends!', '슈가플라이가 설탕으로 하트를 그려요. 친구가 됐어요!'),
        poked: L('Sugarfly buzzes away a little.', '슈가플라이가 조금 윙 날아가요.'),
        leaves: L('Sugarfly zooms over the roofs.', '슈가플라이가 지붕 너머로 휙 날아가 버렸어요.'),
        asks: L('Hi! Who are you?', '안녕! 너는 누구야?'),
        askKind: 'greet',
        answer: {
          1: L('I am a friend. I like sweets!', '나는 친구야. 단 걸 좋아해!'),
          2: L("I'm a friend, and I love sweet snacks.", '나는 친구고, 달콤한 간식을 정말 좋아해.'),
          3: L("I'm a friend who came to Crumbtown because I love sweet snacks.", '나는 달콤한 간식을 좋아해서 부스러기 마을에 온 친구야.')
        }
      }
    ],
    guardian: {
      id: 'ovenna',
      nameEn: 'Ovenna',
      nameKo: '오베나',
      role: 'guardian',
      voice: 'cafe_owner',
      sprite: 'ovenna',
      patterns: ['rollBounce', 'wordCookies', 'sprinkleRain', 'letterCatch', 'wordCookies'],
      intro: L('Ovenna stomps forward. Her door creaks. "Nobody orders. So I bake... HOT SPARKS!"', '오베나가 쿵쿵 다가와요. 문이 삐걱. "아무도 주문 안 해. 그래서 난… 뜨거운 불꽃을 굽지!"'),
      turns: [
        L('Cold, cold, cold! My fire is going out.', '차가워, 차가워! 불이 꺼져 가.'),
        L('Do you even want to order something?', '너 뭐라도 주문하고 싶긴 해?'),
        L('Warm me up with a nice order!', '멋진 주문으로 날 데워 줘!')
      ],
      react: [
        L('Hmm? Order again, a little clearer?', '응? 조금 더 또박또박 다시 주문해 줄래?'),
        L('An order! My fire flickers.', '주문이다! 불이 깜빡여.'),
        L('Oh, so polite! I feel warmer.', '오, 정말 예의 바르구나! 따뜻해졌어.'),
        L('Ding! The oven is hot! Perfect order!', '딩! 화덕이 뜨거워! 완벽한 주문이야!')
      ],
      ready: L('Ovenna glows warm and orange. She is calm.', '오베나가 따뜻한 주황빛으로 빛나요. 차분해요.'),
      friend: L('Here you go, friend! A warm treat and your words, fresh from the oven!', '자, 친구! 따뜻한 간식이랑 네 낱말, 화덕에서 갓 나왔어!'),
      poked: L('Hey! Do not bonk the baker!', '야! 제빵사를 콩 하지 마!'),
      leaves: L('Ovenna turns her back and closes her door.', '오베나가 등을 돌리고 문을 닫아 버렸어요.'),
      asks: L('What would you like?', '뭘 드릴까요?'),
      askKind: 'bank'
    },
    music: 'bakery'
  },
  {
    id: 4,
    islandEn: 'Starloft Tower',
    islandKo: '별다락 탑',
    ctx: 'errand',
    defaultTopic: 'space',
    defaultWords: ['star', 'moon', 'rocket'],
    mood: L('brave', '용감한'),
    intro: L('At the top of the tower, a grey wind is holding every word from the isles.', '탑 꼭대기에서 잿빛 바람이 섬들의 낱말을 모두 붙잡고 있어요.'),
    villager: {
      nameEn: 'Nim the Lamplighter',
      nameKo: '등불 켜는 님',
      lines: [
        L('You came all the way up here! The Hushwind is at the top.', '여기까지 왔구나! 휘파람 바람은 꼭대기에 있어.'),
        L('Use every word you learned. Words from all four islands!', '배운 낱말을 모두 써 봐. 네 섬의 낱말 전부!')
      ]
    },
    outro: L('The wind is warm now. Every word flies home to the isles.', '이제 바람이 따뜻해요. 모든 낱말이 섬으로 날아가요.'),
    greet: {
      1: L('Hello! I am here to help.', '안녕! 도와주러 왔어.'),
      2: L('Hello! Can we talk for a minute?', '안녕! 잠깐 얘기할 수 있어?'),
      3: L('Hello! I climbed the whole tower because I wanted to talk to you.', '안녕! 너랑 얘기하고 싶어서 탑을 끝까지 올라왔어.')
    },
    feel: {
      1: L('I am brave.', '나는 용감해.'),
      2: L('I feel brave today because my friends helped me.', '친구들이 도와줘서 오늘 용감해.'),
      3: L('Actually, I feel brave today because I made friends on every island.', '사실 모든 섬에서 친구를 사귀어서 오늘 용감해.')
    },
    befriend: {
      1: L('You are not alone. I am your friend.', '넌 혼자가 아니야. 내가 네 친구야.'),
      2: L('You are not alone anymore. I will be your friend.', '이제 넌 혼자가 아니야. 내가 친구가 되어 줄게.'),
      3: L('You do not have to take words anymore, because I will talk with you every day.', '이제 낱말을 가져가지 않아도 돼. 내가 매일 너랑 얘기할 거니까.')
    },
    critters: [
      {
        id: 'blotling',
        nameEn: 'Blotling',
        nameKo: '블로틀링',
        role: 'critter',
        voice: 'guide',
        sprite: 'blotling',
        patterns: ['inkRain', 'letterCatch'],
        intro: L('A Blotling drips down from the ceiling. Plip!', '블로틀링이 천장에서 똑 떨어져요. 퐁!'),
        turns: [L('Blotling rains ink blots!', '블로틀링이 잉크 방울을 뿌려요!'), L('Inky letters swirl around.', '잉크 글자가 빙글빙글 돌아요.')],
        react: REACT_DEFAULT,
        ready: L('Blotling stops dripping. It is calm.', '블로틀링이 그만 떨어져요. 차분해요.'),
        friend: L('Blotling draws a smile on the wall. Friends!', '블로틀링이 벽에 웃는 얼굴을 그려요. 친구가 됐어요!'),
        poked: L('Blotling splashes and shrinks.', '블로틀링이 철벅 튀더니 작아져요.'),
        leaves: L('Blotling drips away through a crack.', '블로틀링이 틈 사이로 흘러가 버렸어요.'),
        asks: L('Hello? Who is there?', '안녕? 거기 누구야?'),
        askKind: 'greet',
        answer: {
          1: L('It is me! I came to help.', '나야! 도와주러 왔어.'),
          2: L("It's me, the Keeper. I came to help.", '나야, 등불지기. 도와주러 왔어.'),
          3: L("It's me, the Keeper. I climbed up here to bring the words home.", '나야, 등불지기. 낱말을 집으로 데려가려고 여기까지 올라왔어.')
        }
      },
      {
        id: 'paperkite',
        nameEn: 'Paperkite',
        nameKo: '페이퍼카이트',
        role: 'critter',
        voice: 'guide',
        sprite: 'paperkite',
        patterns: ['kiteDive', 'spellBubbles'],
        intro: L('A Paperkite swoops down the stairs!', '페이퍼카이트가 계단 아래로 휙 내려와요!'),
        turns: [L('Paperkite dives at you!', '페이퍼카이트가 휙 달려들어요!'), L('Paper bubbles float with spellings.', '종이 거품에 철자가 떠다녀요.')],
        react: REACT_DEFAULT,
        ready: L('Paperkite drifts gently. It is calm.', '페이퍼카이트가 살랑살랑 떠 있어요. 차분해요.'),
        friend: L('Paperkite folds into a little star. Friends!', '페이퍼카이트가 작은 별로 접혀요. 친구가 됐어요!'),
        poked: L('Paperkite crinkles a little.', '페이퍼카이트가 조금 구겨졌어요.'),
        leaves: L('Paperkite flies out of a window.', '페이퍼카이트가 창밖으로 날아가 버렸어요.'),
        asks: L('How do you feel?', '기분이 어때?'),
        askKind: 'feel'
      }
    ],
    guardian: {
      id: 'hushwind',
      nameEn: 'the Hushwind',
      nameKo: '휘파람 바람',
      role: 'guardian',
      voice: 'guide',
      sprite: 'hushwind',
      patterns: ['windSpiral', 'letterCatch', 'inkRain', 'spellBubbles', 'wordCookies', 'windSpiral', 'kiteDive'],
      intro: L('The Hushwind swirls. "Words are loud. Words are scary. I keep them all quiet."', '휘파람 바람이 휘몰아쳐요. "낱말은 시끄러워. 무서워. 내가 다 조용히 가지고 있을 거야."'),
      turns: [
        L('Shhh. Quiet is safe.', '쉿. 조용한 게 안전해.'),
        L('Nobody ever talked to me. So I took the words.', '아무도 나한테 말 걸지 않았어. 그래서 낱말을 가져갔지.'),
        L('Why do you keep talking to me?', '왜 자꾸 나한테 말을 걸어?'),
        L('Your words... they feel warm.', '네 낱말은… 따뜻하게 느껴져.')
      ],
      react: [
        L('...Say it once more. I want to hear it.', '…한 번만 더 말해 줘. 듣고 싶어.'),
        L('A word... for me?', '낱말… 나한테?'),
        L('That sounds kind. I did not know words could be kind.', '다정하게 들려. 낱말이 다정할 수 있는 줄 몰랐어.'),
        L('My wind is getting warm. Is this what a friend feels like?', '내 바람이 따뜻해져. 친구란 이런 느낌일까?')
      ],
      ready: L('The Hushwind stops spinning. It is listening to you.', '휘파람 바람이 그만 돌아요. 네 말을 듣고 있어요.'),
      friend: L('Thank you, Keeper. I will give the words back... if you visit me again.', '고마워, 등불지기. 낱말을 돌려줄게… 다시 놀러 와 준다면.'),
      poked: L('That does not help... I only get stronger.', '그건 소용없어… 난 더 세질 뿐이야.'),
      leaves: L('The Hushwind blows away into the clouds, still lonely.', '휘파람 바람이 여전히 외로운 채로 구름 속으로 날아가 버렸어요.'),
      asks: L('Can you help me? I feel so alone.', '나 좀 도와줄래? 너무 외로워.'),
      askKind: 'bank',
      answer: {
        1: L('Yes! I can help you.', '응! 내가 도와줄게.'),
        2: L("Of course I'll help. You are not alone.", '당연히 도와줄게. 너는 혼자가 아니야.'),
        3: L("Of course I'll help you. You're not alone anymore, because I'm here.", '당연히 도와줄게. 내가 있으니까 너는 이제 혼자가 아니야.')
      }
    },
    music: 'tower'
  }
];

export function adventureChapter(id: number): AdventureChapter {
  return ADVENTURE_CHAPTERS.find((c) => c.id === id) ?? ADVENTURE_CHAPTERS[0]!;
}

/** The voice a world role speaks with (the cast pack's own voice for that role). */
export function adventureVoice(ref: AdventureVoiceRef, lang: string = 'en'): NpcVoice {
  const pack = npcCast(lang);
  return (pack.npcs[ref] ?? pack.npcs.guide!).voice;
}

/**
 * The voice one islander speaks with: its own entry in the cast pack's `islanders` table (a creature's id, a villager's
 * English name), else its role's world voice.
 */
export function islanderVoice(key: string, ref: AdventureVoiceRef, lang: string = 'en'): NpcVoice {
  return npcCast(lang).islanders[key] ?? adventureVoice(ref, lang);
}

/** Words of the daily-opener bank (automation server/daily_opener_bank.json words_by_topic) with Korean and a picture. */
export interface AdventureWordInfo {
  ko: string;
  pos: AdventureWordPos;
  emoji: string;
  /** Hand-written sentences [L1, L2, L3] where the part-of-speech frame would read oddly. */
  say?: [string, string, string];
}

const W = (ko: string, pos: AdventureWordPos, emoji: string, say?: [string, string, string]): AdventureWordInfo => (say ? { ko, pos, emoji, say } : { ko, pos, emoji });

export const ADVENTURE_WORDS: Readonly<Record<string, AdventureWordInfo>> = {
  // animals
  whale: W('고래', 'n', '🐋'),
  puppy: W('강아지', 'n', '🐶'),
  eagle: W('독수리', 'n', '🦅'),
  turtle: W('거북', 'n', '🐢'),
  rabbit: W('토끼', 'n', '🐰'),
  shark: W('상어', 'n', '🦈'),
  owl: W('부엉이', 'n', '🦉'),
  fox: W('여우', 'n', '🦊'),
  bear: W('곰', 'n', '🐻'),
  penguin: W('펭귄', 'n', '🐧'),
  horse: W('말', 'n', '🐴'),
  frog: W('개구리', 'n', '🐸'),
  // ocean
  wave: W('파도', 'n', '🌊'),
  shell: W('조개껍데기', 'n', '🐚'),
  deep: W('깊은', 'adj', '🌊', ['The sea is deep.', 'The water here is very deep.', 'The sea is so deep that I cannot see the bottom.']),
  island: W('섬', 'n', '🏝️'),
  boat: W('배', 'n', '⛵'),
  coral: W('산호', 'n', '🪸', ['I see red coral.', 'The coral under the sea is pretty.', 'I want to swim near the coral because it is so colorful.']),
  tide: W('밀물과 썰물', 'n', '🌊', ['The tide is high.', 'The tide comes in every day.', 'When the tide goes out, we can find shells on the sand.']),
  sail: W('항해하다', 'v', '⛵'),
  beach: W('해변', 'n', '🏖️', ['I like the beach.', "Let's play on the beach today.", 'I want to go to the beach because the sand is warm.']),
  pearl: W('진주', 'n', '🦪'),
  storm: W('폭풍', 'n', '⛈️', ['The storm is coming.', 'There is a big storm at sea.', 'We should stay inside because the storm is very strong.']),
  calm: W('잔잔한', 'adj', '😌', ['The sea is calm.', 'The sea is calm and quiet today.', 'The sea is calm now, so we can sail the boat.']),
  // space
  rocket: W('로켓', 'n', '🚀'),
  planet: W('행성', 'n', '🪐'),
  star: W('별', 'n', '⭐'),
  moon: W('달', 'n', '🌙', ['I see the moon.', 'The moon is bright tonight.', 'I want to fly to the moon in a big rocket.']),
  orbit: W('궤도', 'n', '🛰️', ['The moon is in orbit.', 'The moon goes in orbit around the Earth.', 'The space station stays in orbit so that it does not fall.']),
  astronaut: W('우주 비행사', 'n', '🧑‍🚀', ['I am an astronaut.', 'I want to be an astronaut.', 'I want to be an astronaut because I want to see the stars.']),
  comet: W('혜성', 'n', '☄️'),
  galaxy: W('은하', 'n', '🌌'),
  telescope: W('망원경', 'n', '🔭'),
  gravity: W('중력', 'nu', '🍎', ['Gravity pulls me down.', 'Gravity keeps us on the ground.', 'Without gravity, we would float into space.']),
  launch: W('발사하다', 'v', '🚀', ["Let's launch the rocket!", 'The rocket will launch today.', 'We will launch the rocket as soon as everyone is ready.']),
  alien: W('외계인', 'n', '👽'),
  // sports
  goal: W('골', 'n', '🥅', ['I made a goal!', 'I want to make a goal today.', 'I will practice hard so that I can make a goal.']),
  kick: W('차다', 'v', '⚽', ['I can kick the ball.', 'I like to kick the ball with my friends.', 'I kick the ball every day because I want to be good at soccer.']),
  score: W('점수를 내다', 'v', '🏅', ['I can score!', 'I want to score a goal.', 'I will run fast so that I can score a goal.']),
  team: W('팀', 'n', '👫', ['We are a team!', 'My team is the best.', 'I like my team because we help each other.']),
  race: W('경주', 'n', '🏁', ["Let's race!", 'I want to win the race.', 'I will run in the race even though I am a little scared.']),
  jump: W('뛰다', 'v', '🦘'),
  winner: W('우승자', 'n', '🏆', ['You are a winner!', 'The winner gets a medal.', 'Everyone can be a winner if they try hard.']),
  practice: W('연습하다', 'v', '📋'),
  coach: W('코치', 'n', '🧢', ['My coach is nice.', 'My coach helps me every day.', 'My coach says that practice makes me better.']),
  medal: W('메달', 'n', '🥇'),
  fast: W('빠른', 'adj', '💨', ['I am fast!', 'My dog can run very fast.', 'I want to run fast so that I can win the race.']),
  strong: W('강한', 'adj', '💪', ['I am strong!', 'I am strong because I exercise.', 'I want to be strong so that I can help my friends.']),
  // food
  spicy: W('매운', 'adj', '🌶️'),
  sweet: W('달콤한', 'adj', '🍬'),
  fresh: W('신선한', 'adj', '🥬'),
  bake: W('굽다', 'v', '🍞'),
  taste: W('맛보다', 'v', '👅', ["Let's taste it!", 'I want to taste the cake.', 'Can I taste it before I choose one?']),
  hungry: W('배고픈', 'adj', '🍽️', ['I am hungry.', 'I am very hungry now.', 'I am so hungry that I could eat a whole cake.']),
  recipe: W('요리법', 'n', '📖', ['I have a recipe.', "This is my mom's recipe.", 'I want to learn this recipe so that I can cook for my family.']),
  chewy: W('쫄깃한', 'adj', '🍡'),
  crunchy: W('바삭한', 'adj', '🥨'),
  delicious: W('맛있는', 'adj', '😋'),
  snack: W('간식', 'n', '🍪', ['I want a snack.', 'Can I have a snack, please?', 'I want a snack because I am a little hungry.']),
  feast: W('잔치', 'n', '🍗', ["Let's have a feast!", 'We have a big feast today.', 'We are having a feast because it is my birthday.']),
  // school
  pencil: W('연필', 'n', '✏️'),
  library: W('도서관', 'n', '📚', ['I like the library.', 'I read books in the library.', 'I go to the library because it is quiet there.']),
  question: W('질문', 'n', '❓', ['I have a question.', 'Can I ask you a question?', 'I have a question about the story we read.']),
  answer: W('대답', 'n', '💡', ['I know the answer!', 'I think I know the answer.', 'I know the answer because I read the book.']),
  friend: W('친구', 'n', '🤝', ['You are my friend.', 'My friend is very kind.', 'I like my friend because she always helps me.']),
  teacher: W('선생님', 'n', '🧑‍🏫'),
  notebook: W('공책', 'n', '📓'),
  club: W('동아리', 'n', '🎨', ['I am in a club.', 'I am in the art club.', 'I joined the club because I love drawing.']),
  lunch: W('점심', 'nu', '🍱', ['It is time for lunch.', 'I eat lunch with my friends.', 'I am happy because we have pizza for lunch.']),
  homework: W('숙제', 'nu', '📝', ['I did my homework.', 'I do my homework after school.', 'I finished my homework, so now I can play.']),
  eraser: W('지우개', 'n', '🧽'),
  bell: W('종', 'n', '🔔'),
  // games (the topic name in the opener bank)
  level: W('단계', 'n', '🎚️', ['I am on level two.', 'This level is a little hard.', 'I want to finish this level before dinner.']),
  quest: W('모험 임무', 'n', '🗺️', ["Let's go on a quest!", 'We have a quest today.', 'Our quest is to find the lost words of the island.']),
  treasure: W('보물', 'nu', '💎', ['I found the treasure!', 'The treasure is in the box.', 'We found the treasure because we read the map carefully.']),
  map: W('지도', 'n', '🗺️'),
  boss: W('대장', 'n', '👑'),
  win: W('이기다', 'v', '🏆', ['We can win!', 'I want to win this time.', 'We can win if we work together.']),
  skill: W('기술', 'n', '✨', ['I have a new skill.', 'My new skill is very cool.', 'I practiced every day, so I have a new skill.']),
  magic: W('마법', 'nu', '🪄', ['I like magic.', 'I want to learn magic.', 'If I could use magic, I would make it snow.']),
  sword: W('칼', 'n', '🗡️'),
  puzzle: W('퍼즐', 'n', '🧩'),
  adventure: W('모험', 'n', '🧭', ["Let's go on an adventure!", 'This adventure is so fun.', 'I want to go on an adventure with my best friend.']),
  // music
  melody: W('멜로디', 'n', '🎶', ['I like this melody.', 'This melody is so pretty.', 'I hum this melody when I feel happy.']),
  rhythm: W('리듬', 'nu', '🥁', ['I can feel the rhythm.', 'Clap to the rhythm with me.', 'I like this song because the rhythm is fun.']),
  sing: W('노래하다', 'v', '🎤'),
  stage: W('무대', 'n', '🎭'),
  piano: W('피아노', 'n', '🎹', ['I can play the piano.', 'I play the piano after school.', 'I practice the piano every day so that I can play a song.']),
  drum: W('북', 'n', '🥁', ['I can play the drum.', 'I like to play the drum loudly.', 'I want to play the drum in a band when I grow up.']),
  chorus: W('합창 부분', 'n', '🎵', ["Let's sing the chorus.", 'I know the chorus of this song.', 'I like the chorus because everyone sings together.']),
  dance: W('춤추다', 'v', '💃'),
  loud: W('시끄러운', 'adj', '📢'),
  soft: W('부드러운', 'adj', '🧸'),
  song: W('노래', 'n', '🎵', ['I like this song.', 'This is my favorite song.', 'I like this song because it makes me happy.']),
  band: W('밴드', 'n', '🎸'),
  // daily
  morning: W('아침', 'n', '🌅', ['Good morning!', 'I wake up early in the morning.', 'In the morning, I brush my teeth before breakfast.']),
  breakfast: W('아침밥', 'nu', '🥞', ['I eat breakfast.', 'I eat toast for breakfast.', 'I always eat breakfast because it gives me energy.']),
  bus: W('버스', 'n', '🚌', ['I take the bus.', 'I go to school by bus.', 'I take the bus because my school is far away.']),
  weather: W('날씨', 'nu', '🌤️', ['The weather is nice.', 'The weather is sunny today.', 'The weather is so nice that we can play outside.']),
  dinner: W('저녁밥', 'nu', '🍲', ['It is time for dinner.', 'I eat dinner with my family.', 'After dinner, I read a book with my mom.']),
  sleepy: W('졸린', 'adj', '😴', ['I am sleepy.', 'I am very sleepy now.', 'I am sleepy because I stayed up late last night.']),
  weekend: W('주말', 'n', '📅', ['I like the weekend.', 'I play outside on the weekend.', 'On the weekend, I visit my grandma with my family.']),
  family: W('가족', 'n', '👪', ['I love my family.', 'My family is very funny.', 'I love my family because they always help me.']),
  walk: W('걷다', 'v', '🚶'),
  shop: W('가게', 'n', '🏪', ['I go to the shop.', 'I buy milk at the shop.', 'I go to the shop with my dad on Sundays.']),
  park: W('공원', 'n', '🏞️', ['I go to the park.', 'I play in the park with my friends.', 'I like the park because there are many trees.'])
};

const articleOf = (w: string) => (/^[aeiou]/i.test(w) ? 'an' : 'a');

/** Part-of-speech frames (docs/22 1.3): a sentence per level for a word with no hand-written line. */
export const ADVENTURE_WORD_FRAMES: Readonly<Record<AdventureWordPos | 'unknown', Record<AdventureLevel, string>>> = {
  n: { 1: 'I see {a} {w}.', 2: 'Look! There is {a} {w} over there.', 3: 'I can see {a} {w}, and it looks really amazing.' },
  nu: { 1: 'I like {w}.', 2: 'I want to learn about {w}.', 3: 'I want to learn more about {w} because it is interesting.' },
  adj: { 1: 'It is so {w}!', 2: 'This one is very {w}.', 3: 'I think this one is really {w}, and I like it.' },
  v: { 1: "Let's {w}!", 2: 'I like to {w} with my friends.', 3: 'I want to {w} every day because it is fun.' },
  unknown: { 1: 'I know the word {w}.', 2: 'Today I learned the word {w}.', 3: 'Today I learned the word {w}, and I can use it in a sentence.' }
};

/** The sentence for one word at one level: the hand-written line, else the frame for its part of speech. */
export function adventureWordSentence(word: string, level: AdventureLevel): string {
  const w = word.toLowerCase();
  const info = ADVENTURE_WORDS[w];
  if (info?.say) return info.say[level - 1]!;
  const frame = ADVENTURE_WORD_FRAMES[info?.pos ?? 'unknown'][level];
  return frame.replace('{a}', articleOf(w)).replace('{w}', w);
}

/** LCW level (L1..L6) → adventure sentence tier (L4+ read the L3 lines, docs/22 1.3). */
export function adventureLevelOf(level: LangLevel | number | string | null | undefined): AdventureLevel {
  if (typeof level === 'number' && Number.isFinite(level)) return Math.max(1, Math.min(3, Math.round(level))) as AdventureLevel;
  const m = /^L?([1-6])$/i.exec(String(level ?? '').trim());
  if (!m) return 1;
  return Math.min(3, Number(m[1])) as AdventureLevel;
}

export function adventureLangLevel(level: AdventureLevel): LangLevel {
  return `L${level}` as LangLevel;
}

/** The island's phrase-bank sentences at this level (the same sentences the 3D world grades). */
export function adventureBankSentences(chapter: AdventureChapter, level: AdventureLevel): string[] {
  const entries = bankEntriesFor(chapter.ctx, adventureLangLevel(level));
  const pick = level === 3 ? 2 : 1;
  const out: string[] = [];
  // The errand bank also has "here is your water" hand-over lines; the tower only needs the offer to help.
  // the shore only trades (its bank also has furniture shopping, which does not answer "What do you want to trade?")
  const own = chapter.ctx === 'trade_shop' ? entries.filter((x) => x.intent === 'trade_item') : entries;
  for (const e of chapter.ctx === 'errand' ? own.filter((x) => x.intent !== 'errand_deliver').slice(0, 1) : own) {
    const t = e.offers[pick]?.text;
    // A bakery orders something warm or sweet, not "large water"
    if (chapter.ctx === 'cafe' && /\bwater\b/i.test(t ?? '')) continue;
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

/** Silly but harmless wrong replies for the ✅ pick TALK (never "wrong", just funny). */
export const ADVENTURE_SILLY_REPLIES: readonly string[] = [
  'My shoe is a sandwich.',
  'Banana, banana, banana!',
  'Good night, little sock.',
  'The cloud ate my homework.',
  'I am a teapot today.',
  'Socks can fly on Tuesday.'
];

/** Everything the islanders say, in their voice; and every built-in sentence a child may hear in the model voice. */
export function adventureFixedLines(lang: string = 'en'): Array<{ text: string; voice: NpcVoice }> {
  const out: Array<{ text: string; voice: NpcVoice }> = [];
  const model = npcCast(lang).modelVoice;
  for (const ch of ADVENTURE_CHAPTERS) {
    for (const c of [...ch.critters, ch.guardian]) {
      const v = islanderVoice(c.id, c.voice, lang);
      for (const l of [c.intro, ...c.turns, ...c.react, c.ready, c.friend, c.poked, c.leaves, c.asks]) out.push({ text: l.en, voice: v });
    }
    const guide = islanderVoice(ch.villager.nameEn, 'guide', lang);
    for (const l of ch.villager.lines) out.push({ text: l.en, voice: guide });
    for (const lv of [1, 2, 3] as const) {
      out.push({ text: ch.greet[lv].en, voice: model }, { text: ch.feel[lv].en, voice: model }, { text: ch.befriend[lv].en, voice: model });
    }
  }
  for (const w of Object.keys(ADVENTURE_WORDS)) {
    out.push({ text: w, voice: model });
    for (const lv of [1, 2, 3] as const) out.push({ text: adventureWordSentence(w, lv), voice: model });
  }
  return out;
}
