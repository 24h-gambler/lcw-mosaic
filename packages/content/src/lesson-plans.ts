/**
 * Lesson-mode plans (docs/18). A plan is what the teacher runs without the 3D world: stages, the target sentences
 * the student sees, and the teacher's own guide. Korean text is teacher/parent copy; English is what the child says.
 */
export type LessonUtteranceMode = 'free' | 'guided' | 'read' | 'recall';
/** Scenes of the 3D lesson world (docs/19 §2 SceneId). */
export type LessonSceneId = 'plaza' | 'honey_cafe' | 'trade_shop' | 'build_plot' | 'open_hill';
export type LessonHintLevel = 'full' | 'keyword' | 'initial' | 'picture' | 'none';

/** Subset of @lcw/schemas NpcContext the lesson NPCs use (content does not depend on schemas). */
export type LessonNpcContext = 'guide' | 'cafe' | 'trade_shop' | 'resident' | 'exchange';

/** NPCs the teacher can possess in lesson scenes (docs/19 §4). The world domain spawns them under these ids. */
export interface LessonNpc {
  id: string;
  nameKo: string;
  nameEn: string;
  /** Conversation-bank context the dialog panel falls back to (docs/04 ctx). */
  ctx: LessonNpcContext;
}

export const LESSON_NPCS: readonly LessonNpc[] = [
  { id: 'guide', nameKo: '안내인 선생님', nameEn: 'Guide', ctx: 'guide' },
  { id: 'cafe_owner', nameKo: '카페 주인', nameEn: 'Cafe owner', ctx: 'cafe' },
  { id: 'shop_owner', nameKo: '상점 주인', nameEn: 'Shop owner', ctx: 'trade_shop' }
];

export function getLessonNpc(id: string | null | undefined): LessonNpc | undefined {
  return LESSON_NPCS.find((n) => n.id === id);
}

export interface LessonTarget {
  stars: 1 | 2 | 3;
  text: string;
  /**
   * Core-pattern phrases scored at 45% (docs/04 §4.6). For a 3-star target list only the connector that makes it
   * 3-star: the star cap applies when none of the core tokens is said, so a shared opener would hide a missing connector.
   */
  hintTags: string[];
}

export interface LessonStage {
  id: string;
  order: number;
  titleKo: string;
  minutes: number;
  mode: LessonUtteranceMode;
  /** What the teacher does now and how the platform helps — shown on the director console. */
  teacherGuideKo: string;
  teacherScriptEn: string;
  /** What the child sees as the goal (Korean, no prices or deadlines). */
  studentGoalKo: string;
  /** Where the student's 3D client goes for this stage and who talks there (docs/19 §4 table). */
  sceneId: LessonSceneId;
  npcId: string;
  hint: LessonHintLevel;
  /** Minute-by-minute steps for the teacher (shown under the guide): what to do when, when stuck, when to move on. */
  stepsKo?: string[];
  /** More lines the teacher can say as the stage NPC with one tap, after the script line. */
  followUpsEn?: string[];
  targets: LessonTarget[];
}

export interface LessonPlan {
  id: string;
  titleKo: string;
  totalMinutes: number;
  stages: LessonStage[];
}

export const FIRST_LESSON_PLAN: LessonPlan = {
  id: 'first_lesson_v1',
  titleKo: '첫 수업 · 카페에서 시작하는 영어 (대면 120분)',
  totalMinutes: 120,
  stages: [
    {
      id: 'warmup_anchor',
      order: 1,
      titleKo: '① 인사와 고정 과제',
      minutes: 15,
      mode: 'free',
      teacherGuideKo:
        '이름·좋아하는 것을 영어로 물어 보세요. 아이가 대본 없이 2분 말하면 첫 기준선이 저장되고, 4주 뒤 같은 질문과 비교해 부모 리포트에 성장으로 나옵니다.',
      teacherScriptEn: 'Hi! What is your name? What do you like to do after school?',
      studentGoalKo: '선생님 질문에 영어로 내 이야기를 해 봐요',
      sceneId: 'plaza',
      npcId: 'guide',
      hint: 'full',
      stepsKo: [
        "0–3분 · 인사하고 「학생 화면」이 '연결됨 · 광장'인지 확인해요.",
        '3–8분 · 안내인 선생님으로 빙의해 이름·나이·좋아하는 것을 하나씩 물어요. 질문마다 5초 이상 기다려 주세요.',
        '8–13분 · 고정 과제: 방과 후에 하는 일을 대본 없이 2분 이어 말하게 해요. 4주 뒤 같은 질문과 비교돼요.',
        '13–15분 · 잘한 문장에 F2, 「별 축하」(6)로 마무리하고 ② 카페로 넘어가요.'
      ],
      followUpsEn: ['How old are you?', 'What is your favorite food?', 'Why do you like it?', 'Tell me more!'],
      targets: [
        { stars: 1, text: 'My name is ___.', hintTags: ['my name is'] },
        { stars: 2, text: 'I like playing games after school.', hintTags: ['i like'] },
        { stars: 3, text: 'I like drawing because it makes me happy.', hintTags: ['because'] }
      ]
    },
    {
      id: 'cafe_order',
      order: 2,
      titleKo: '② 카페 주문 (1성 → 3성)',
      minutes: 25,
      mode: 'guided',
      teacherGuideKo:
        '카페 주인 역할을 해 주세요. 아이가 1성 문장부터 말하고, 통과하면 2성·3성으로 올려 주세요. 3성은 so that·because 같은 연결어가 있어야 통과합니다(빠지면 2성까지만).',
      teacherScriptEn: 'Welcome to the honey cafe! What would you like today?',
      studentGoalKo: '카페에서 영어로 음료를 주문해요. 별 3개에 도전!',
      sceneId: 'honey_cafe',
      npcId: 'cafe_owner',
      hint: 'full',
      stepsKo: [
        '0–5분 · 카페 주인으로 빙의해 대사를 보내요. 아이는 1성 문장부터 골라 말해요.',
        '5–15분 · 통과하면 "Anything else?"로 2성·3성을 이끌어요. 따뜻한·차가운 메뉴로 바꿔 같은 문장을 세 번 이상 말하게 해요.',
        '15–22분 · 3성이 막히면 so that 을 짚어 주고, 「NPC 질문」(3)으로 이유를 묻게 해요.',
        '22–25분 · 가장 긴 문장에 F2, 「별 축하」(6) 뒤 ③으로.'
      ],
      followUpsEn: ['Anything else?', 'Hot or cold?', 'Why do you want it warm?', 'Here you are! Enjoy your honey tea.'],
      targets: [
        { stars: 1, text: 'Honey tea, please.', hintTags: ['please'] },
        { stars: 2, text: 'Can I have a warm honey tea?', hintTags: ['can i have'] },
        { stars: 3, text: 'Can I have a warm honey tea so that I stay warm?', hintTags: ['so that'] }
      ]
    },
    {
      id: 'trade_roleplay',
      order: 3,
      titleKo: '③ 선생님과 물물교환 역할극',
      minutes: 25,
      mode: 'guided',
      teacherGuideKo:
        '가게 주인이 되어 물건을 바꿔 달라고 해 보세요. 아이가 왜 필요한지(because) 말하게 하면 3성입니다. 좋은 표현이 나오면 F2 를 눌러 표시하세요 — 수업 뒤 리포트 초안에 앞뒤 30초가 같이 들어갑니다.',
      teacherScriptEn: 'I have a shiny red helmet. What will you give me for it, and why?',
      studentGoalKo: '선생님과 물건을 바꿔요. 왜 필요한지도 말해 봐요',
      sceneId: 'trade_shop',
      npcId: 'shop_owner',
      hint: 'keyword',
      stepsKo: [
        '0–5분 · 상점 주인으로 빙의해 빨간 헬멧을 보여 줘요. 아이는 원하는 물건을 1성으로 말해요.',
        '5–15분 · "What will you give me?"로 바꿀 물건(for)을, "Why?"로 이유(because)를 끌어내요.',
        '15–22분 · 「복습 상자」(5)·「멘토 던전 문」(4)으로 새 물건과 이유를 만들어 같은 패턴을 다시 쓰게 해요.',
        '22–25분 · because 문장이 나온 순간 F2, ④로.'
      ],
      followUpsEn: ['What will you give me for it?', 'Why do you need a helmet?', 'One blue stone is not enough. What else do you have?', 'Deal! Here is your helmet.'],
      targets: [
        { stars: 1, text: 'I want the red helmet.', hintTags: ['i want'] },
        { stars: 2, text: 'Can I trade my blue stone for the helmet?', hintTags: ['can i', 'for'] },
        {
          stars: 3,
          text: 'I want to trade my blue stone because I need a helmet for the cave.',
          hintTags: ['because']
        }
      ]
    },
    {
      id: 'open_question',
      order: 4,
      titleKo: '④ 열린 질문',
      minutes: 20,
      mode: 'free',
      teacherGuideKo:
        '정답이 없는 질문을 하고 기다려 주세요(5초 이상). 아이 말이 길어질수록 생각말하기 지수가 오릅니다. 막히면 한국어 단어를 섞어도 화면이 영어로 바꿔 보여 줍니다.',
      teacherScriptEn: 'If you could build any place in a new world, what would you build? Why?',
      studentGoalKo: '내가 만들고 싶은 곳을 영어로 설명해요',
      sceneId: 'open_hill',
      npcId: 'guide',
      hint: 'none',
      stepsKo: [
        '0–3분 · 언덕에서 열린 질문을 보내고 5초 이상 기다려요.',
        '3–12분 · 아이 말을 따라 "What else?" "Why?"로 이어 가요. 한국어가 섞여도 끊지 말고 영어로 다시 말해 주세요.',
        '12–18분 · 「눈보라」(1)·「정전」(2)으로 상황을 바꿔 "What would you do?"를 물어요.',
        '18–20분 · 가장 긴 설명에 F2, ⑤로.'
      ],
      followUpsEn: ['What else would you put there?', 'Why?', 'Who would come to your place?', 'What would you do if it snowed?'],
      targets: [
        { stars: 1, text: 'I would build a cafe.', hintTags: ['i would'] },
        { stars: 2, text: 'I would build a big cafe with a garden.', hintTags: ['i would', 'with'] },
        { stars: 3, text: 'I would build a big cafe so that my friends can meet there.', hintTags: ['so that'] }
      ]
    },
    {
      id: 'recall_today',
      order: 5,
      titleKo: '⑤ 오늘 표현 회상 (힌트 없이)',
      minutes: 20,
      mode: 'recall',
      teacherGuideKo:
        '오늘 나온 문장을 힌트 없이 다시 말하게 하세요. 화면은 첫 단어만 보여 줍니다. 여기서 통과한 문장이 다음 수업의 복습 카드가 됩니다.',
      teacherScriptEn: 'Do you remember how to order your honey tea? Try it without looking!',
      studentGoalKo: '오늘 배운 문장을 기억해서 말해요',
      sceneId: 'honey_cafe',
      npcId: 'cafe_owner',
      hint: 'initial',
      stepsKo: [
        '0–3분 · 카페로 돌아와 화면이 첫 단어만 보여 준다고 알려 줘요.',
        '3–12분 · 2성 문장부터. 막히면 카페 주인으로 첫 단어만 말해 주고, 그래도 막히면 「복습 상자」(5).',
        '12–18분 · 물물교환 3성(because) 문장을 기억해 말하게 해요. 통과한 문장이 다음 수업 복습 카드가 돼요.',
        '18–20분 · 「별 축하」(6) 뒤 ⑥으로.'
      ],
      followUpsEn: ['What did you order today?', 'Do you remember what you traded?', 'Say it one more time, nice and slow.'],
      targets: [
        { stars: 2, text: 'Can I have a warm honey tea?', hintTags: ['can i have'] },
        { stars: 3, text: 'I want to trade my blue stone because I need a helmet for the cave.', hintTags: ['because'] }
      ]
    },
    {
      id: 'wrap_up',
      order: 6,
      titleKo: '⑥ 마무리와 다음 수업 예고',
      minutes: 15,
      mode: 'free',
      teacherGuideKo:
        '오늘 가장 잘한 문장 하나를 칭찬하고 다음 수업을 예고하세요. 「수업 끝」을 누르면 숫자가 검증된 부모 리포트 링크가 만들어집니다 — 문자로 보내기 전에 한 번 읽어 보세요.',
      teacherScriptEn: 'Great job today! Next time, we will build our own shop. See you!',
      studentGoalKo: '오늘 제일 잘한 문장을 한 번 더 말해요',
      sceneId: 'plaza',
      npcId: 'guide',
      hint: 'full',
      stepsKo: [
        '0–5분 · 오늘 가장 잘한 문장을 칭찬하고 한 번 더 말하게 해요.',
        '5–10분 · 다음 수업(내 가게 만들기)을 예고하고 인사 문장을 말하게 해요.',
        '10–15분 · 「수업 끝」 칸에 한마디와 다음 수업 날짜를 쓰고 리포트를 만들어요. 미리보기로 읽은 뒤 링크를 보내요.'
      ],
      followUpsEn: ['You did a great job today!', 'Next time, we will build our own shop.', 'See you next time!'],
      targets: [{ stars: 1, text: 'Thank you! See you next time.', hintTags: ['see you'] }]
    }
  ]
};

/**
 * Second lesson (11-19): lesson 1's sentences come back without hints first, then the child builds a shop on the
 * empty lot (lesson 1's wrap-up promised it). The cafe/trade patterns (can I have, because, so that) return about new
 * things on purpose: the same pattern said in a new place is what transfer looks like in the report.
 */
export const SECOND_LESSON_PLAN: LessonPlan = {
  id: 'second_lesson_v1',
  titleKo: '두 번째 수업 · 지난 표현 복습과 내 가게 만들기 (120분)',
  totalMinutes: 120,
  stages: [
    {
      id: 'recall_last',
      order: 1,
      titleKo: '① 지난 수업 문장 떠올리기',
      minutes: 15,
      mode: 'recall',
      teacherGuideKo:
        '지난 수업에서 통과한 문장을 힌트 없이 다시 말하게 하세요. 화면은 첫 단어만 보여 줍니다. 막히면 카페 주인으로 빙의해 첫 단어만 말해 주세요(대사 칸에 쓰고 Enter). 통과하면 바로 다음 문장으로 넘어가세요.',
      teacherScriptEn: 'Welcome back to the honey cafe! Do you remember how to order your drink?',
      studentGoalKo: '지난 시간에 배운 문장을 기억해서 말해요',
      sceneId: 'honey_cafe',
      npcId: 'cafe_owner',
      hint: 'initial',
      stepsKo: [
        '0–3분 · 꿀 카페에서 다시 만나요. 화면이 첫 단어만 보여 준다고 알려 줘요.',
        '3–10분 · 1성 → 2성 순서로. 막히면 카페 주인으로 첫 단어만 말해 주세요.',
        '10–14분 · 지난 물물교환 3성(because) 문장을 떠올리게 해요.',
        '14–15분 · 「별 축하」(6) 뒤 ② 빈 땅으로.'
      ],
      followUpsEn: ['What would you like today?', 'Do you remember what you traded last time?', 'Can you say it again, slowly?'],
      targets: [
        { stars: 1, text: 'Honey tea, please.', hintTags: ['please'] },
        { stars: 2, text: 'Can I have a warm honey tea?', hintTags: ['can i have'] },
        { stars: 3, text: 'I want to trade my blue stone because I need a helmet for the cave.', hintTags: ['because'] }
      ]
    },
    {
      id: 'shop_idea',
      order: 2,
      titleKo: '② 빈 땅에 지을 가게 정하기',
      minutes: 20,
      mode: 'guided',
      teacherGuideKo:
        '빈 땅에 서서 어떤 가게를 지을지 물어 보세요. 빵집·꽃집·장난감 가게 무엇이든 좋습니다. 3성은 so that 으로 이유까지 말해야 통과합니다 — 아이가 고른 가게 이름을 다음 단계 내내 써 주세요.',
      teacherScriptEn: 'This empty lot is yours! What shop do you want to build here?',
      studentGoalKo: '빈 땅에 어떤 가게를 지을지 영어로 말해요',
      sceneId: 'build_plot',
      npcId: 'guide',
      hint: 'full',
      stepsKo: [
        '0–4분 · 빈 땅에서 대사를 보내고, 어떤 가게든 좋다고 말해 줘요.',
        '4–12분 · 고른 가게에 "What will it look like?"로 모양(with)을 더하게 해요.',
        '12–18분 · "Why?"로 so that 이유를 끌어내 3성까지.',
        '18–20분 · 가게 이름을 정하고 F2, ③ 상점으로.'
      ],
      followUpsEn: ['What will your shop look like?', 'Why do you want to build it?', 'What is the name of your shop?'],
      targets: [
        { stars: 1, text: 'I want a bakery.', hintTags: ['i want'] },
        { stars: 2, text: 'I want to build a bakery with a big window.', hintTags: ['i want to', 'with'] },
        { stars: 3, text: 'I want to build a bakery so that my friends can eat fresh bread.', hintTags: ['so that'] }
      ]
    },
    {
      id: 'buy_materials',
      order: 3,
      titleKo: '③ 상점에서 재료 사기',
      minutes: 25,
      mode: 'guided',
      teacherGuideKo:
        '상점 주인이 되어 가게 재료를 팔아 주세요. 지난 수업의 Can I have·because 가 새 물건에서 다시 나오는지 보세요 — 나오면 F2 로 표시하세요(리포트 초안에 앞뒤 30초가 같이 들어갑니다).',
      teacherScriptEn: 'Hello again! What do you need for your new shop?',
      studentGoalKo: '가게를 지을 재료를 영어로 달라고 해요',
      sceneId: 'trade_shop',
      npcId: 'shop_owner',
      hint: 'keyword',
      stepsKo: [
        '0–5분 · 상점 주인으로 빙의해 무엇이 필요한지 물어요.',
        '5–15분 · 나무·유리·문으로 재료를 바꿔 가며 Can I have 를 여러 번 쓰게 해요.',
        '15–22분 · "Why do you need it?"으로 because 3성. 「복습 상자」(5)로 지난 표현을 다시 꺼내도 좋아요.',
        '22–25분 · 지난 수업 패턴이 새 물건에 나온 순간 F2, ④로.'
      ],
      followUpsEn: ['How many do you need?', 'Why do you need so many?', 'Anything else for your shop?', 'Here you are. Good luck with your shop!'],
      targets: [
        { stars: 1, text: 'Wood, please.', hintTags: ['please'] },
        { stars: 2, text: 'Can I have ten wooden blocks?', hintTags: ['can i have'] },
        { stars: 3, text: 'Can I have ten wooden blocks because I am building a bakery?', hintTags: ['because'] }
      ]
    },
    {
      id: 'open_shop',
      order: 4,
      titleKo: '④ 가게 문 열기 (아이가 주인)',
      minutes: 25,
      mode: 'guided',
      teacherGuideKo:
        '이번에는 선생님이 손님입니다. 안내인 선생님으로 들어가 아이 가게에 무엇이 있는지 물어 보세요. 아이가 손님에게 권하며 because 로 이유를 말하면 3성입니다.',
      teacherScriptEn: 'Hi! I am so hungry. What do you have in your shop?',
      studentGoalKo: '내 가게에 온 손님을 영어로 맞이해요',
      sceneId: 'build_plot',
      npcId: 'guide',
      hint: 'keyword',
      stepsKo: [
        '0–5분 · 안내인 선생님(손님)으로 가게에 들어가 아이의 인사를 기다려요.',
        '5–15분 · "What do you have?"로 상품을 말하게(We have) 하고 몇 가지 골라 보세요.',
        '15–22분 · "Which one is the best?"로 권하는 문장과 because 이유를 끌어내요.',
        '22–25분 · 손님으로 고맙다고 말하고 F2, ⑤로.'
      ],
      followUpsEn: ['What is the best thing in your shop?', 'Why should I try it?', 'Can I have one, please?', 'Thank you! I love your shop.'],
      targets: [
        { stars: 1, text: 'Welcome to my shop!', hintTags: ['welcome'] },
        { stars: 2, text: 'We have bread and honey cake.', hintTags: ['we have'] },
        { stars: 3, text: 'You should try the honey cake because it is sweet and warm.', hintTags: ['because'] }
      ]
    },
    {
      id: 'open_question',
      order: 5,
      titleKo: '⑤ 열린 질문',
      minutes: 15,
      mode: 'free',
      teacherGuideKo:
        '정답이 없는 질문을 하고 5초 이상 기다려 주세요. 첫 수업 ④와 같은 방식입니다 — 말이 길어질수록 생각말하기 지수가 오르고, 한국어 단어를 섞어도 화면이 영어로 바꿔 보여 줍니다.',
      teacherScriptEn: 'What makes your shop special? Why will people come to your shop?',
      studentGoalKo: '내 가게가 왜 특별한지 영어로 설명해요',
      sceneId: 'open_hill',
      npcId: 'guide',
      hint: 'none',
      stepsKo: [
        '0–3분 · 언덕에서 열린 질문을 보내고 5초 이상 기다려요.',
        '3–12분 · "What else?" "Why?"로 이어 가요. 「눈보라」(1)로 "What would you do?"를 물어도 좋아요.',
        '12–15분 · 가장 긴 설명에 F2, ⑥으로.'
      ],
      followUpsEn: ['What else makes it special?', 'Who will come first?', 'What would you do if it snowed?'],
      targets: [
        { stars: 1, text: 'My shop is special.', hintTags: ['my shop'] },
        { stars: 2, text: 'My shop has a garden for kids.', hintTags: ['has', 'for'] },
        { stars: 3, text: 'People will come to my shop because it has the best bread.', hintTags: ['because'] }
      ]
    },
    {
      id: 'recall_today',
      order: 6,
      titleKo: '⑥ 오늘 표현 회상 (힌트 없이)',
      minutes: 12,
      mode: 'recall',
      teacherGuideKo:
        '오늘 나온 문장을 힌트 없이 다시 말하게 하세요. 화면은 첫 단어만 보여 줍니다. 여기서 통과한 문장이 다음 수업의 복습 카드가 됩니다.',
      teacherScriptEn: 'Can you tell me again what you bought for your shop? Try it without looking!',
      studentGoalKo: '오늘 배운 문장을 기억해서 말해요',
      sceneId: 'trade_shop',
      npcId: 'shop_owner',
      hint: 'initial',
      stepsKo: [
        '0–8분 · 오늘 산 재료와 손님에게 권한 문장을 힌트 없이 말하게 해요. 막히면 상점 주인으로 첫 단어만.',
        '8–12분 · 통과하면 「별 축하」(6), ⑦로.'
      ],
      followUpsEn: ['What did you buy for your shop?', 'What did you tell your customer?'],
      targets: [
        { stars: 2, text: 'Can I have ten wooden blocks?', hintTags: ['can i have'] },
        { stars: 3, text: 'You should try the honey cake because it is sweet and warm.', hintTags: ['because'] }
      ]
    },
    {
      id: 'wrap_up',
      order: 7,
      titleKo: '⑦ 마무리와 다음 수업 예고',
      minutes: 8,
      mode: 'free',
      teacherGuideKo:
        '오늘 가장 잘한 문장 하나를 칭찬하고 다음 수업을 예고하세요. 「수업 끝」을 누르면 숫자가 검증된 부모 리포트 링크가 만들어집니다 — 문자로 보내기 전에 한 번 읽어 보세요.',
      teacherScriptEn: 'Great job today! Next time, friends will visit your shop. See you!',
      studentGoalKo: '오늘 제일 잘한 문장을 한 번 더 말해요',
      sceneId: 'plaza',
      npcId: 'guide',
      hint: 'full',
      stepsKo: [
        '0–3분 · 오늘 가장 잘한 문장을 칭찬하고 한 번 더 말하게 해요.',
        '3–5분 · 다음 수업을 예고하고 인사해요.',
        '5–8분 · 「수업 끝」에 한마디와 다음 수업 날짜를 쓰고 리포트 링크를 만들어 미리보기 뒤 보내요.'
      ],
      followUpsEn: ['You did a great job today!', 'Next time, friends will visit your shop.', 'See you next time!'],
      targets: [{ stars: 1, text: 'Thank you! See you next time.', hintTags: ['see you'] }]
    }
  ]
};

/** In teaching order: the console offers them in this order and shows the one after the current as "next lesson". */
export const LESSON_PLANS: readonly LessonPlan[] = [FIRST_LESSON_PLAN, SECOND_LESSON_PLAN];

export function getLessonPlan(id: string | undefined): LessonPlan {
  return LESSON_PLANS.find((p) => p.id === id) ?? FIRST_LESSON_PLAN;
}
