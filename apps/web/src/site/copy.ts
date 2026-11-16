/**
 * Korean copy for the public site (docs/14). Tone: 해요체, no guarantees, no superlatives, samples marked as
 * samples (docs/14 §12, 08 §10). Student pages (/play, /try) carry no price, payment or deadline (AGENTS.md 4.9).
 * English target sentences stay English.
 */

import { npcPersona } from '@lcw/content';
import { FREE_PLAY_LIMITS } from '@lcw/schemas';

/** Free play limits the server enforces (docs/01 §3): the copy reads them, never types the numbers. */
const TRY_MIN = FREE_PLAY_LIMITS.tryMinutes;
const PASS_MIN = FREE_PLAY_LIMITS.guestPassMinutes;
const PASS_PER_MONTH = FREE_PLAY_LIMITS.guestPassesPerSeatPerMonth;
/** Refund rule (Dan 2026-11-16 09:20; the guardian lane runs it on the server): only before the seat is first used. */
export const REFUND_RULE = {
  short: '사용 시작 전까지 환불',
  line: '환불은 좌석을 쓰기 시작하기 전까지만 돼요. 쓰기 시작한 뒤에는 환불되지 않아요.',
  tryFirst: `결제 전에 ${TRY_MIN}분 체험과 친구 초대(${PASS_MIN}분)로 먼저 써 보세요.`
} as const;
export const BRAND = 'LCW';
export const BRAND_LONG = '말하면 생기는 세계';

export const NAV = {
  parents: '학부모',
  play: '학생',
  tutoring: '과외',
  pricing: '요금',
  try: `${TRY_MIN}분 체험`,
  menu: '메뉴',
  close: '닫기',
  skip: '본문으로 건너뛰기'
} as const;

export const HERO = {
  eyebrow: '영어로 말해야 물건이 생기는 3D 블록 게임',
  title: '말하면 생기는 세계',
  body: '짓고, 싸우고, 탐험하는 모든 순간에 영어로 말합니다. 더 좋은 문장이 더 좋은 장비가 됩니다.',
  parents: '학부모님이세요?',
  parentsSub: '성장이 어떻게 보이는지',
  players: '플레이어세요?',
  playersSub: '무엇을 할 수 있는지',
  tryCta: `지금 ${TRY_MIN}분 체험`,
  tryCtaLong: '설치도 가입도 없이 음료 한 잔 주문해 보기',
  trySub: '브라우저에서 바로 시작해요. 목소리는 저장되지 않아요.'
} as const;

/** 15-second loop (docs/14 §3): understandable with the sound off, captions on screen. */
/** Landing clip (docs/14 §3): a real /game capture of one cafe order, captions carry it with the sound off. */
export const LOOP = {
  label: '실제 게임 화면 반복 영상: 카페 주인에게 영어로 주문하면 문장이 자라고 별 3개를 받습니다',
  captions: [
    ['approach', '카페 주인이 영어로 말을 걸어요'],
    ['offers', '여기서는 말해야 얻어요. 문장은 세 가지'],
    ['speak', '더 좋은 문장을 소리 내어 말하면'],
    ['stars', '별 3개. 더 좋은 문장이 더 큰 보상이 됩니다']
  ] as ReadonlyArray<readonly [string, string]>
} as const;

/** Player page clip: the world's own auto-walk from the plaza to the cafe. */
export const TOUR = {
  label: '실제 게임 화면: 광장에서 마을 길을 따라 꿀 카페까지 걸어가는 장면',
  captions: [
    ['plaza', '광장에서 마을 길을 따라 걸어가요'],
    ['cafe', '꿀 카페 도착. 이제 영어로 주문할 차례']
  ] as ReadonlyArray<readonly [string, string]>
} as const;

/** NPC names on the site come from the world's cast pack (packages/content npc-cast.ts), never typed here. */
const castKo = (npcId: string): string => npcPersona(npcId)?.nameKo ?? '';
/** Korean particle after a name: `withBatchim` when the last syllable ends in a consonant (해나가, 루나 선생님이). */
export function josa(word: string, withBatchim: string, without: string): string {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  return `${word}${code >= 0 && code <= 11171 && code % 28 !== 0 ? withBatchim : without}`;
}

/** Labels on the real-game pictures (GameMedia.tsx). */
export const MEDIA = {
  realTag: '실제 게임 화면 · 시연',
  play: '재생',
  pause: '일시 정지',
  cafeOffers: `실제 게임 화면: ${josa(castKo('cafe_owner'), '이', '가')} 묻고, 별 1개부터 3개까지 세 가지 영어 문장이 펼쳐진 대화창`,
  cafeStars: '실제 게임 화면: 별 3개 문장 "Can I have some cold water, please?"를 말해 별 3개를 받은 대화창',
  tradeOffers: `실제 게임 화면: 물물교환 ${josa(castKo('shop_owner'), '과', '와')} 헬멧을 바꾸는 세 가지 영어 문장`,
  buildPlot: '실제 게임 화면: 울타리와 벽돌이 놓인 내 부지',
  guideOffers: `실제 게임 화면: ${josa(castKo('guide'), '이', '가')} 어디로 가고 싶은지 묻는 대화창`,
  cafeFront: '실제 게임 화면: 꿀 카페 앞에 선 플레이어',
  plaza: '실제 게임 화면: 분수가 있는 중앙 광장'
} as const;

export const LOOP_OFFERS = [
  { stars: 1 as const, text: "I'd like a red jetpack, please.", coins: 2000 },
  { stars: 2 as const, text: 'Could you build a fast red jetpack?', coins: 1600 },
  { stars: 3 as const, text: "I'm looking for a red jetpack so that I can fly to the sky island!", coins: 1000 }
];

export const STEPS = [
  { n: '1', title: '말한다', body: '물건을 사고, 만들고, 고칠 때마다 NPC에게 영어로 말해요.', en: 'I want a jetpack' },
  { n: '2', title: '문장이 자란다', body: '같은 주문도 별 1개부터 3개까지. 긴 문장일수록 싸고 강해져요.', en: '' },
  { n: '3', title: '세계가 넓어진다', body: '땅속 광산에서 하늘섬, 우주 정거장까지 말로 열어 가요.', en: 'sky island · space station' }
] as const;

export const STEP_GROW = ['I want a jetpack.', 'Can I have a fast jetpack?', '... so that I can fly!'] as const;

export const LANDING = {
  doorsTitle: '같은 세계, 두 개의 입구',
  doorsBody: '아이는 놀러 오고, 부모님은 아이가 말하는 시간을 확인합니다.',
  parentDoor: {
    title: '학부모님께',
    body: '대본 없이 말한 단어 수, 한 번에 말하는 길이, 그리고 아이의 실제 목소리를 매주 보여 드려요.',
    cta: '성장이 보이는 방법'
  },
  playerDoor: {
    title: '플레이어에게',
    body: '네 월드는 네가 만든다. 짓고, 터뜨리고, 하늘섬까지 날아가. 필요한 건 영어 한 문장.',
    cta: '무엇을 할 수 있는지'
  },
  dialogTitle: '이것이 실제 대화창이에요',
  dialogBody: '같은 제트팩도 문장에 따라 값이 달라져요. 문장을 눌러 들어 보세요.',
  dialogNote: '코인은 게임 안에서만 쓰는 돈이에요. 현금으로 살 수 없어요.',
  tutoringTitle: '선생님과 함께하면',
  tutoringBody: '선생님이 아이의 월드에 NPC로 들어가 말을 걸고, 수업이 끝나면 숫자가 검증된 리포트를 보내 드려요.',
  tutoringCta: '과외 수업 보기'
} as const;

export const PARENTS = {
  title: '아이가 영어로 자기 생각을 말하는 시간을 보여 드립니다',
  lead: '게임하는 줄 알았는데, 들어 보니 말을 하고 있습니다. 매주 대본 없이 말한 양과 길이를 숫자와 육성으로 확인하세요.',
  sampleTag: '예시 화면',
  sampleNote: '실제 데이터가 쌓이기 전이라 예시 숫자로 그렸어요.',
  voiceTag: '기계 음성 시연',
  voiceNote: '아래 재생은 브라우저의 합성 음성으로 만든 시연이에요. 실제 아이 목소리가 아닙니다.',
  problemTitle: '단어는 아는데 말이 안 나오는 이유',
  problemBody:
    '읽고 외우는 시간은 많지만, 대본 없이 말해 볼 일은 드뭅니다. 말이 나오려면 머릿속에서 문장을 직접 조립해 보는 경험이 쌓여야 해요.',
  problemRows: [
    { k: '읽기·듣기', v: '교재, 영상, 단어장', on: true },
    { k: '외워서 말하기', v: '대본, 낭독, 따라 말하기', on: true },
    { k: '대본 없이 말하기', v: '내가 원하는 걸 내 문장으로', on: false }
  ],
  problemFoot: 'LCW는 세 번째 칸을 채우는 곳이에요.',
  methodTitle: '말해야 얻는 세계',
  methodBody: '주문, 제작, 흥정, 변론. 게임에서 물건을 얻는 길이 전부 말하기예요. 문장이 좋을수록 값이 싸고 효과가 커집니다.',
  proofTitle: '낭독이 아닌 "자기 말"만 셉니다',
  proofBody:
    '따라 읽은 말과 스스로 만든 말을 나눠서 잽니다. 성장 그래프에는 아이가 스스로 만든 말만 올라가요. 늘지 않으면 늘지 않은 대로 보입니다.',
  modes: [
    { k: '자유', d: '아이가 스스로 만든 말', counted: true },
    { k: '유도', d: '힌트를 보고 만든 말', counted: false },
    { k: '낭독', d: '보이는 문장을 읽은 말', counted: false },
    { k: '회상', d: '힌트 없이 다시 떠올린 말', counted: false }
  ],
  indexTitle: '생각말하기 지수는 이렇게 계산해요',
  indexBody: '아이 자신의 첫 2주를 100으로 둡니다. 다른 아이와 비교하는 점수가 아니에요.',
  indexParts: [
    { w: 30, k: '한 번에 말하는 길이' },
    { w: 20, k: '말하는 속도' },
    { w: 15, k: '단어당 준비 시간(짧을수록 좋음)' },
    { w: 15, k: '접속 표현(because, so that) 사용' },
    { w: 10, k: '영어로 말한 비율' },
    { w: 10, k: '힌트 없이 말한 비율' }
  ],
  memoryTitle: '한 달 뒤에도 말할 수 있어야 배운 것입니다',
  memoryBody:
    '한 번 말한 문장은 아이템에 남고, 시간이 지나면 그 아이템이 고장 납니다. 수리소에서 힌트 없이 그 문장을 다시 말하면 고쳐져요. 6단계를 넘기면 금색 마스터 도안이 됩니다.',
  memorySteps: ['20분', '1일', '3일', '7일', '16일', '35일', '마스터'],
  museumTitle: '눈이 아니라 귀로 확인하세요',
  museumBody: '음성 박물관에는 첫 발화와 한 달 뒤 발화가 나란히 놓입니다. 음성 저장에 동의하신 경우에만 만들어져요.',
  museumBefore: '첫 주',
  museumAfter: '4주 뒤',
  tutoringTitle: '선생님과 함께하면',
  tutoringBody: '수업 중에는 수업 창문으로 언제든 들어와 들으실 수 있고, 수업이 끝나면 대표 장면과 숫자가 담긴 리포트가 옵니다.',
  safetyTitle: '아이의 목소리는 가족의 것입니다',
  safetyItems: [
    '동의는 네 가지로 나눠 따로 켜고 끕니다. 한 번에 모두 켜는 버튼은 없어요.',
    '낯선 사람과 자유 음성 대화를 하지 않아요. 다른 사람에게는 걸러진 말풍선만 보입니다.',
    '아이 월드를 누구에게 보여 줄지는 보호자가 정합니다. 기본은 비공개예요.',
    '아이 화면에는 가격·결제·기한이 없습니다. 현금으로 사는 게임 재화도 없어요.'
  ],
  timeTitle: '게임 시간이 걱정되신다면',
  timeBody: '플레이 시간 안내를 정해 두면 시간이 되었을 때 게임 안에서 부드럽게 알려 줍니다. 연속 접속을 압박하는 알림은 없고, 매주 요약을 보내 드려요.',
  priceTitle: '요금은 단순합니다',
  priceBody: `모든 좌석은 전 기능이에요. ${REFUND_RULE.line} ${REFUND_RULE.tryFirst}`,
  priceCta: '요금 자세히 보기',
  faqTitle: '자주 묻는 질문'
} as const;

export const SAMPLE_DASH = {
  name: '지우의 성장',
  headline: '이번 주 지우는 대본 없이 412단어를 말했습니다. 4주 전의 1.6배입니다.',
  kpis: [
    { k: '생각말하기', v: '127', d: '▲ 9 (4주)' },
    { k: '자유 발화', v: '412단어', d: '▲ 61%' },
    { k: '말한 시간', v: '38분', d: '▲ 22%' },
    { k: '마스터 문장', v: '14', d: '▲ 3' }
  ],
  chartTitle: '생각말하기 지수 (12주)',
  weekly: [100, 98, 104, 101, 108, 106, 112, 110, 118, 121, 119, 127],
  lessonWeeks: [2, 5, 8, 11],
  showTable: '표로 보기',
  hideTable: '그래프로 보기',
  weekLabel: (i: number) => `${i + 1}주`,
  colWeek: '주',
  colValue: '주간값',
  colAvg: '4주 평균',
  oneLiner: '이번 주의 한 마디',
  oneLinerEn: 'I think we should go down instead because the bridge is broken.'
} as const;

export const SITUATIONS = [
  { id: 'cafe', label: '주문', npc: '카페 주인', item: '따뜻한 꿀차' },
  { id: 'makers', label: '제작', npc: '장인', item: '빨간 제트팩' },
  { id: 'exchange', label: '흥정', npc: '환전상', item: '철광석' },
  { id: 'court', label: '변론', npc: '판사', item: '벌금' }
] as const;

export const PLAY = {
  title: '네 월드는 네가 만든다',
  lead: '빈 땅에 블록 하나. 거기서 시작해서 마을, 하늘섬, 우주 정거장까지. 필요한 건 영어 한 문장.',
  freeTitle: '오늘은 뭐 할래',
  modes: [
    { k: '짓기', d: '블록을 하나씩 쌓아 집과 마을을 지어. 주민이 이사 와.' },
    { k: '싸우기', d: '슬라임과 몬스터, 친구와 깃발 뺏기. 주문은 음성 스킬로.' },
    { k: '벌기', d: '광석을 캐서 팔고, 가게를 열고, 면접 보고 승진해.' },
    { k: '탐험하기', d: '사막, 눈 덮인 산, 네온 도시. 월드마다 다른 아홉 지역.' }
  ],
  halfTitle: '말하면 반값',
  halfBody: '장인에게 그냥 "jetpack" 하면 비싸. 별 3개 문장으로 말하면 반값에 연료 2배.',
  boomTitle: '터뜨려도 괜찮아',
  boomBody: '사무실을 날려도 보호 구역은 다시 서. 대신 법정에서 영어로 변명해야 해. 말만 잘하면 무죄!',
  boomLine: 'I did not mean to break it. I was testing my new rocket.',
  makeTitle: '세상에 하나뿐인 장비',
  makeBody: '말로 주문하면 장인이 만들어 줘. 호박 헬멧, 물폭탄, 로켓 부츠.',
  makeLine: 'Can you make a pumpkin helmet that glows at night?',
  buildTitle: '한 칸씩, 네 손으로',
  buildBody: '빈 땅에서 3층 집까지. 방에 문과 불빛과 쉴 곳이 있으면 주민이 들어와.',
  friendTitle: '친구를 초대해',
  friendBody: `내 월드에 친구를 ${PASS_MIN}분 동안 초대할 수 있어. 같이 짓고, 같이 싸워.`,
  upTitle: '땅속에서 우주까지',
  upBody: '광산 아래로 내려가고, 하늘섬 위로 올라가고, 정거장에서 블랙홀을 봐.',
  upBands: ['우주 정거장', '하늘섬', '지상', '지하 광산'],
  endTitle: '하고 싶으면',
  endBody: '부모님께 링크를 보내 줘. 부모님이 소개를 보고 정해 주실 거야.',
  send: '부모님께 소개 보내기',
  tryIt: `먼저 ${TRY_MIN}분 해 보기`
} as const;

export const SHARE = {
  title: 'LCW — 말하면 생기는 세계',
  text: '영어로 말해야 물건이 생기는 게임이래요. 한번 봐 주세요!',
  copied: '링크를 복사했어요. 부모님께 붙여 넣어 보내 주세요.',
  failed: '복사가 안 됐어요. 주소창의 주소를 부모님께 보내 주세요.'
} as const;

export const TUTORING = {
  title: '선생님이 아이의 월드에 들어갑니다',
  lead: '정해진 교재 대신, 아이가 만든 세계에서 선생님이 NPC가 되어 말을 겁니다. 120분 동안 아이가 말하는 시간이 절반을 넘도록 설계했어요.',
  arcTitle: '수업은 이렇게 흘러가요',
  arcBody: '첫 수업 기준 120분. 아이의 수준에 맞춰 단계마다 별 1개 문장부터 3개 문장까지 올려 갑니다.',
  windowTitle: '수업 중에 들어와 보세요',
  windowBody:
    '수업 창문은 지금 아이가 어디서 무엇을 하는지, 화면의 목표 문장이 무엇인지 10초마다 글로 알려 드려요. 영상은 보내지 않습니다. 음성 청취는 동의하신 경우에만 열려요.',
  windowSample: { place: '꿀 카페 · 광장', situation: '카페 주인과 주문 중', target: 'Can I have a warm honey tea so that I stay warm?' },
  reportTitle: '수업이 끝나면',
  reportBody: '선생님이 확인한 뒤 링크로 보내 드려요. 로그인 없이 열리고, 30일 뒤 닫힙니다. 숫자는 기록과 자동으로 대조해 틀린 문장이 나가지 않게 했어요.',
  monthTitle: '한 달이 지나면',
  monthBody: '첫 수업과 같은 질문을 4주 뒤에 다시 합니다. 같은 과제에서 말한 단어와 문장 길이가 어떻게 바뀌었는지 나란히 보여 드려요.',
  teacherTitle: '선생님 소개',
  /** Written by the operator (docs/14 §7). Empty → the block is not shown rather than filled with invented text. */
  teacherIntro: '',
  formTitle: '상담 신청',
  formBody: '남겨 주시면 선생님이 직접 연락드려요. 연락처는 상담에만 쓰고 다른 곳에 쓰지 않습니다.',
  fName: '보호자 이름',
  fContact: '연락처(휴대폰 또는 이메일)',
  fGrade: '아이 학년',
  fDays: '희망 요일',
  fNote: '남기실 말 (선택)',
  grades: ['초1', '초2', '초3', '초4', '초5', '초6', '중1', '중2', '중3', '그 외'],
  days: ['월', '화', '수', '목', '금', '토', '일'],
  submit: '상담 신청하기',
  sending: '보내는 중…',
  sent: '신청을 받았어요. 선생님이 곧 연락드릴게요.',
  error: '지금은 보내지 못했어요. 잠시 뒤 다시 눌러 주세요.',
  invalid: '이름과 연락처를 확인해 주세요.',
  privacy: '입력하신 정보는 상담 연락에만 쓰고 상담이 끝나면 파기합니다.'
} as const;

export const SAMPLE_REPORT = {
  date: '11월 12일 수업 리포트',
  clip: '오늘의 대표 장면 (1분 42초)',
  clipCap: '지우가 직접 지은 다리를 설명합니다',
  rows: [
    { k: '지우가 말한 시간', v: '28분' },
    { k: '대본 없이 말한 단어', v: '386' },
    { k: '주고받기', v: '10분당 31회' }
  ],
  band: [5, 5, 4, 5, 5, 3, 5, 4, 5, 5, 2, 5, 5, 4, 5, 5, 5, 3, 5, 5, 4, 5, 5, 5],
  before: { d: '10월 15일', v: '41단어 · 5.1단어/문장' },
  after: { d: '11월 12일', v: '78단어 · 7.8단어/문장' },
  exprTitle: '오늘 수업에서 나온 표현 5개',
  exprs: ['instead of', 'as soon as', 'so that', 'because', 'I think'],
  solo: '지난 수업 표현, 혼자서도 썼어요 4/6',
  next: '다음 수업: 11월 16일 일요일'
} as const;

export const PRICING = {
  title: '요금',
  lead: `모든 좌석은 전 기능입니다. ${REFUND_RULE.line}`,
  plans: [
    {
      id: 'solo',
      name: 'Solo',
      seats: '1좌석',
      month: '14,900원',
      year: '119,000원',
      perSeatYear: '좌석당 월 9,917원',
      notes: ['전 기능', '미성년 좌석에는 보호자 대시보드 포함', '연 결제는 월 결제 대비 33% 낮음']
    },
    {
      id: 'duo',
      name: 'Duo',
      seats: '2좌석',
      month: '19,900원',
      year: '159,000원',
      perSeatYear: '좌석당 월 6,625원',
      notes: ['두 좌석 모두 전 기능', '가족이 아니어도 돼요 — 친구와 함께', '결제자는 한 명']
    },
    {
      id: 'extra',
      name: '좌석 추가',
      seats: '3번째 좌석부터',
      month: '7,000원',
      year: '59,000원',
      perSeatYear: '좌석당 월 4,917원',
      notes: ['가족·친구 묶음', '좌석마다 따로 월드 5개']
    }
  ],
  monthly: '월',
  yearly: '연',
  tutoringPlan: '과외 패키지는 과외비에 좌석과 수업 창문, 수업 리포트가 포함돼요. 과외비는 선생님이 정합니다.',
  promises: ['모든 좌석은 전 기능', REFUND_RULE.short, 'Duo는 가족이 아니어도 됩니다'],
  refundTitle: '환불과 해지',
  refundRows: [
    { k: '쓰기 시작하기 전', v: '이유를 묻지 않고 전액 환불해요.' },
    { k: '쓰기 시작한 뒤', v: `환불되지 않아요. ${REFUND_RULE.tryFirst}` },
    { k: '해지', v: '보호자 화면의 좌석 메뉴에서 바로 해지할 수 있어요. 남은 기간까지 쓰고 끝납니다.' },
    { k: 'Duo 한 좌석만 환불', v: '아직 쓰기 시작하지 않은 좌석 하나만 환불하면 남은 좌석은 Solo로 바뀌어요. 차액(월 5,000원, 연 40,000원)을 돌려드리거나, 남은 몫만큼 Solo 기간을 늘려 드립니다.' },
    { k: '해지 뒤 월드', v: '30일 동안 읽기 전용으로 남고, 그 뒤에는 보관됩니다.' }
  ],
  startTitle: '시작하기',
  startBody: '지금은 선생님이 직접 좌석을 열어 드려요. 상담 신청에 "좌석 문의"라고 남겨 주세요.',
  startCta: '좌석 문의하기',
  faqTitle: '자주 묻는 질문'
} as const;

/** docs/14 §6 FAQ. Answers describe how it is measured, never promise outcomes. */
export const FAQ = [
  {
    q: '무료로 해 볼 수 있나요?',
    a: `가입 없이 ${TRY_MIN}분 체험이 있어요. 이용 중인 친구가 있으면 ${PASS_MIN}분 초대권으로 함께 해 볼 수도 있습니다. ${REFUND_RULE.line} 그래서 결제 전에 먼저 써 보시길 권해요.`
  },
  {
    q: '몇 살부터 할 수 있나요?',
    a: '초등 저학년부터 중학생을 생각하고 만들었어요. 만 14세 미만은 보호자 계정 아래에서만 좌석을 만들고, 보호자 동의를 먼저 받습니다.'
  },
  {
    q: '정말 영어가 늘까요?',
    a: '약속 대신 측정 방식을 보여 드려요. 대본 없이 말한 양과 길이를 매주 보여 드리고, 늘지 않으면 늘지 않은 대로 보입니다.'
  },
  {
    q: '게임만 하게 되지 않을까요?',
    a: '게임 안에서 물건을 얻는 길이 전부 말하기예요. 플레이 시간 안내를 정할 수 있고, 매주 요약에서 아이가 말한 시간을 확인하실 수 있어요.'
  },
  {
    q: '아이 목소리는 어떻게 되나요?',
    a: '음성 저장에 동의하신 경우에만 저장하고, 보호자 화면에서 언제든 지울 수 있어요. 외부에 공개하지 않고, AI 학습에 쓰지 않습니다.'
  },
  {
    q: '모르는 사람과 대화하나요?',
    a: '공개 서버는 보호자가 허용한 경우에만 들어갈 수 있고, 거기서도 걸러진 말풍선으로만 이야기해요. 실제 목소리는 승인한 친구와 수업에서만 오갑니다.'
  },
  {
    q: '어떤 기기에서 되나요?',
    a: '설치 없이 브라우저(크롬, 사파리, 엣지)에서 실행돼요. 노트북이나 태블릿을 권장하고, 마이크가 있는 헤드셋이면 더 잘 들려요.'
  },
  {
    q: '과외를 받지 않아도 되나요?',
    a: '됩니다. 과외는 선택이에요. 과외를 받으면 수업 창문과 수업 리포트가 더해집니다.'
  },
  {
    q: '다른 언어도 있나요?',
    a: '지금은 한국어로 안내하고 영어로 말하는 구성만 있어요. 다른 언어는 준비 중입니다.'
  },
  {
    q: '해지하면 월드는 어떻게 되나요?',
    a: '해지 뒤 30일 동안 읽기 전용으로 남고, 그 뒤에는 보관됩니다. 저장된 음성은 처리방침에 따라 지워져요.'
  }
] as const;

export const SAFETY = {
  title: '안전 설계',
  lead: '아이가 혼자 들어와도 괜찮도록, 처음부터 막아 둔 것들을 적었어요.',
  rows: [
    { k: '낯선 사람', v: '자유 텍스트·음성 채팅이 없어요. 다른 사람에게 보이는 말은 인식 → 영어 판별 → 필터를 거친 말풍선뿐이에요.' },
    { k: '개인정보', v: '말풍선 필터가 전화번호·주소·계정 아이디 모양을 막아요. 닉네임에 실명을 쓰지 않도록 안내합니다.' },
    { k: '공개 서버', v: '미성년 계정은 보호자가 허용하고 "모두" 대상인 서버만 보여요.' },
    { k: '괴롭힘', v: '서로 다른 3명이 신고하면 그 월드에서 말풍선이 자동으로 멈춰요. PvP는 기본으로 꺼져 있어요.' },
    { k: '구매 압박', v: '아이 화면에 가격·결제·기한이 없어요. 현금으로 사는 게임 재화가 없습니다.' },
    { k: '과몰입', v: '플레이 시간 안내, 연속 접속 압박 알림 없음. 보호자 알림은 주 1회까지.' },
    { k: 'AI가 만든 것', v: 'AI는 정해진 부품 안에서 제안만 해요. 건물이나 주민을 AI가 만들지 않고, 이름·설명은 필터를 지나요.' },
    { k: '쇼룸', v: '정지된 장면만 보여 줘요. 실시간 위치·음성·실명이 없고 기본은 비공개예요.' },
    { k: '수업 참관', v: '참관은 그 학생의 보호자만. 선생님 화면에 항상 표시되고, 학생에게 수업 시작 때 알려요.' }
  ],
  consentTitle: '동의는 나눠서 받아요',
  consents: [
    { k: '음성 저장', v: '보호자가 아이 목소리를 다시 들을 수 있게 저장해요. 끄면 글과 숫자만 남아요.' },
    { k: '수업 창문', v: '수업 중 보호자가 실시간으로 들을 수 있어요.' },
    { k: '쇼룸 공개', v: '아이 월드의 정지 화면을 링크로 보여 줄 수 있어요.' },
    { k: '공개 서버', v: '다른 사람이 연 공개 월드에 들어갈 수 있어요.' }
  ],
  consentFoot: '한 화면에서 전부 켜는 버튼은 두지 않았어요. 언제든 따로 끌 수 있습니다.',
  tryTitle: `${TRY_MIN}분 체험에서는`,
  tryBody: '체험은 브라우저의 음성 인식을 쓰고, 목소리를 서버로 보내거나 저장하지 않아요. 계정도 만들지 않습니다.'
} as const;

export const LEGAL = {
  termsTitle: '이용약관 요약',
  privacyTitle: '개인정보 처리방침 요약',
  draft: '정식 문서는 전문가 검토를 마친 뒤 이 자리에 게시합니다. 아래는 지금 운영하는 방식의 요약이에요.',
  terms: [
    { k: '서비스', v: '영어 말하기 게임과 보호자 화면, 선택형 과외 수업 도구를 제공합니다.' },
    { k: '좌석', v: '좌석 하나에 플레이어 한 명. 미성년 좌석은 보호자 계정 아래에서만 만들어집니다.' },
    { k: '결제와 환불', v: '좌석을 쓰기 시작하기 전까지만 전액 환불되고, 쓰기 시작한 뒤에는 환불되지 않습니다. Duo 한 좌석 환불 시 남은 좌석은 Solo로 바뀝니다.' },
    { k: '해지', v: '보호자 화면에서 언제든 해지. 월드는 30일 읽기 전용 뒤 보관됩니다.' },
    { k: '이용 규칙', v: '다른 사람을 괴롭히거나 개인정보를 올리는 행위는 말풍선 정지·입장 제한 대상이에요.' }
  ],
  privacy: [
    { k: '모으는 것', v: '보호자 연락처, 아이 닉네임·학년, 플레이 기록, 발화 전사문과 지표. 음성은 동의한 경우에만.' },
    { k: '쓰는 곳', v: '게임 진행, 성장 그래프와 리포트, 수업 진행. 광고에 쓰지 않습니다.' },
    { k: '보관 기간', v: '수업 원본 30일. 음성 클립은 좌석을 쓰는 동안과 그 뒤 12개월. 게스트·체험 음성은 저장하지 않아요.' },
    { k: '맡기는 곳', v: '클라우드 운영(Cloudflare)과 음성 인식·문장 처리(Cloudflare Workers AI). AI에는 이름·계정 없이 문장만 보냅니다.' },
    { k: '보호자의 권리', v: '보기, 고치기, 지우기, 동의 철회를 보호자 화면에서 바로 할 수 있어요.' },
    { k: '방문 통계', v: '이 사이트는 쿠키를 쓰지 않는 방문 통계만 남겨요. 제3자 추적 스크립트가 없습니다.' }
  ]
} as const;

export const PASS = {
  title: '친구가 초대했어요',
  lead: `친구 월드에 ${PASS_MIN}분 동안 들어가서 같이 놀 수 있어요. 목소리는 저장되지 않아요.`,
  codeLabel: '초대 코드',
  go: '친구 월드로 가기',
  invalid: '코드를 다시 확인해 줘. 초대 코드는 영어와 숫자 8자리야.',
  state: {
    ended: '이 초대 코드는 시간이 다 됐어. 친구에게 새 코드를 부탁해 봐.',
    expired: '이 초대 코드는 받은 지 오래돼서 더는 쓸 수 없어. 친구에게 새 코드를 부탁해 봐.',
    revoked: '친구가 이 초대 코드를 거둬들였어. 친구에게 물어봐.',
    busy: '코드를 너무 여러 번 넣었어. 조금 뒤에 다시 해 봐.',
    error: '연결이 잠깐 끊겼어. 다시 눌러 봐.'
  },
  rules: [
    `처음 들어간 때부터 ${PASS_MIN}분 동안 친구 월드의 모든 기능을 쓸 수 있어요.`,
    `친구는 한 달에 초대 코드를 ${PASS_PER_MONTH}개까지 받을 수 있어요. 코드 하나는 한 기기에서만 쓸 수 있어요.`,
    '내 물건은 저장되지 않지만, 처음 만든 물건 하나와 첫 영어 한마디는 이 기기에 7일 동안 남아요.',
    '어린이 게스트는 친구의 보호자가 허용한 경우에만 들어갈 수 있어요.'
  ]
} as const;

export const SHOWROOM = {
  title: '월드 구경',
  lead: '친구가 지은 월드를 돌려 보세요. 정지된 장면이라 실시간 위치나 목소리, 실명은 담기지 않아요.',
  sampleTag: '예시 월드',
  turnLeft: '왼쪽으로 돌리기',
  turnRight: '오른쪽으로 돌리기',
  share: '링크 복사',
  copied: '쇼룸 링크를 복사했어요.',
  notFound: '이 쇼룸을 찾을 수 없어요. 링크가 끝났거나 비공개로 바뀌었을 수 있어요.',
  blocks: (n: number) => `블록 ${n.toLocaleString('ko-KR')}개`,
  cta: '나도 만들어 보기',
  galleryTitle: '구경할 수 있는 월드'
} as const;

export const LEARN = {
  indexTitle: '상황별 영어 표현',
  indexLead: '게임 속 장면에서 실제로 쓰는 문장이에요. 별 1개부터 3개까지, 문장이 어떻게 자라는지 보세요.',
  starsTitle: '같은 말, 세 가지 문장',
  explainTitle: '이렇게 생각하면 쉬워요',
  mistakeTitle: '자주 틀리는 부분',
  tryCta: '이 장면 해 보기',
  listen: '듣기',
  stars: (n: number) => '★'.repeat(n),
  back: '← 모든 표현'
} as const;

/** Expression pages (W07): one per bank context/intent. Korean explanation and common mistakes are authored here. */
export const LEARN_PAGES = [
  {
    slug: 'order-a-drink',
    ctx: 'cafe',
    title: '카페에서 음료 주문하기',
    scene: '꿀 카페 주인에게 따뜻한 음료를 시켜요.',
    explain: [
      'please 하나만 붙여도 주문이 돼요. "Honey tea, please."',
      'Can I have ~? 는 "~ 주실 수 있어요?"에 가까운 부드러운 부탁이에요.',
      'so that 뒤에는 이유가 와요. "so that I stay warm" = 몸이 따뜻하게.'
    ],
    mistakes: [
      { wrong: 'I want honey tea give me.', right: 'Can I have a honey tea?', why: '"주세요"를 give me 로 끝에 붙이지 않아요.' },
      { wrong: 'Can I have warm honey tea so I warm?', right: '... so that I stay warm?', why: 'warm 은 형용사라 stay 같은 동사가 필요해요.' }
    ],
    offers: [
      { stars: 1, text: 'Honey tea, please.' },
      { stars: 2, text: 'Can I have a warm honey tea?' },
      { stars: 3, text: 'Can I have a warm honey tea so that I stay warm?' }
    ]
  },
  {
    slug: 'order-gear',
    ctx: 'makers_lab',
    title: '장비 주문하기',
    scene: '장인에게 원하는 장비를 말로 주문해요.',
    explain: [
      "I'd like ~ 는 I want ~ 보다 공손한 주문이에요.",
      'Could you build ~? 처럼 질문으로 바꾸면 부탁이 돼요.',
      "I'm looking for ~ so that I can ~ 은 무엇을, 왜 원하는지 한 번에 말하는 3성 문장이에요."
    ],
    mistakes: [
      { wrong: 'I want jetpack.', right: 'I want a jetpack.', why: '하나를 말할 때는 a 를 붙여요.' },
      { wrong: 'so that I can flying', right: 'so that I can fly', why: 'can 뒤에는 동사 원래 모양이 와요.' }
    ],
    offers: [
      { stars: 1, text: "I'd like a red jetpack, please." },
      { stars: 2, text: 'Could you build a fast red jetpack with a big fuel tank?' },
      { stars: 3, text: "I'm looking for a fuel-efficient red jetpack so that I can fly to the space station!" }
    ]
  },
  {
    slug: 'trade-items',
    ctx: 'trade',
    title: '물건 바꾸기 흥정',
    scene: '상점 주인과 내 물건을 바꿔요. 왜 필요한지 말하면 더 잘 바꿔 줘요.',
    explain: [
      'trade A for B = A 를 주고 B 를 받다.',
      'because 뒤에 이유를 붙이면 흥정이 3성이 돼요.',
      'Can I ~? 로 물어보면 부탁처럼 들려요.'
    ],
    mistakes: [
      { wrong: 'Can I trade the helmet my stone?', right: 'Can I trade my stone for the helmet?', why: '주는 것 + for + 받는 것 순서예요.' },
      { wrong: 'because I need helmet', right: 'because I need a helmet', why: '하나일 때는 a 를 잊지 마세요.' }
    ],
    offers: [
      { stars: 1, text: 'I want the red helmet.' },
      { stars: 2, text: 'Can I trade my blue stone for the helmet?' },
      { stars: 3, text: 'I want to trade my blue stone because I need a helmet for the cave.' }
    ]
  },
  {
    slug: 'say-sorry',
    ctx: 'court',
    title: '실수했을 때 변명하기',
    scene: '사무실을 터뜨렸어요. 판사에게 영어로 사정을 설명해요.',
    explain: [
      "I'm sorry 로 시작하면 대부분 잘 풀려요.",
      "I didn't mean to ~ = 일부러 그런 게 아니에요.",
      'I will ~ 으로 앞으로 할 일을 약속하면 3성이에요.'
    ],
    mistakes: [
      { wrong: "I didn't mean break it.", right: "I didn't mean to break it.", why: 'mean 뒤에는 to 가 필요해요.' },
      { wrong: 'I will fixing it.', right: 'I will fix it.', why: 'will 뒤에는 동사 원래 모양.' }
    ],
    offers: [
      { stars: 1, text: "I'm sorry. It was a mistake." },
      { stars: 2, text: "I'm sorry. I didn't mean to break the window." },
      { stars: 3, text: "I didn't mean to break it, and I will fix the wall so that the shop can open again." }
    ]
  },
  {
    slug: 'build-a-place',
    ctx: 'open_question',
    title: '내가 짓고 싶은 곳 말하기',
    scene: '정답이 없는 질문. 내가 만들고 싶은 곳을 설명해요.',
    explain: ['I would build ~ = 나라면 ~ 을 지을 거예요.', 'with ~ 로 꾸며 주면 2성.', 'so that 으로 왜 짓는지 말하면 3성.'],
    mistakes: [
      { wrong: 'I would building a cafe.', right: 'I would build a cafe.', why: 'would 뒤에는 동사 원래 모양이에요.' },
      { wrong: 'so that my friends meet can', right: 'so that my friends can meet', why: 'can 은 동사 앞에 와요.' }
    ],
    offers: [
      { stars: 1, text: 'I would build a cafe.' },
      { stars: 2, text: 'I would build a big cafe with a garden.' },
      { stars: 3, text: 'I would build a big cafe so that my friends can meet there.' }
    ]
  }
] as const;

export const FOOTER = {
  tagline: '말하면 생기는 세계. 영어로 말해야 물건이 생기는 3D 블록 게임이에요.',
  colSite: '둘러보기',
  colLearn: '배우기',
  colTrust: '믿을 수 있게',
  learn: '상황별 표현',
  worlds: '월드 구경',
  pass: '초대 코드',
  safety: '안전 설계',
  terms: '이용약관',
  privacy: '개인정보 처리방침',
  note: '쿠키 없는 방문 통계만 씁니다. 제3자 추적 스크립트가 없어요.',
  copyright: '© LCW'
} as const;

export const META: Readonly<Record<string, { title: string; description: string }>> = {
  '/': { title: 'LCW — 말하면 생기는 세계', description: `영어로 말해야 물건이 생기는 3D 블록 월드. 설치·가입 없이 ${TRY_MIN}분 체험.` },
  '/parents': { title: '학부모님께 — LCW', description: '아이가 대본 없이 영어로 말한 양과 길이를 매주 숫자와 육성으로 확인하세요.' },
  '/play': { title: '플레이어에게 — LCW', description: '네 월드는 네가 만든다. 짓고, 터뜨리고, 하늘섬까지. 필요한 건 영어 한 문장.' },
  '/tutoring': { title: '과외 수업 — LCW', description: '선생님이 아이의 월드에 NPC로 들어가는 120분 영어 회화 수업과 수업 리포트.' },
  '/pricing': { title: '요금 — LCW', description: `Solo·Duo·좌석 추가. 모든 좌석은 전 기능, ${REFUND_RULE.short}.` },
  '/try': { title: `${TRY_MIN}분 체험 — LCW`, description: '설치도 가입도 없이 카페에서 영어로 음료 한 잔 주문해 보기.' },
  '/safety': { title: '안전 설계 — LCW', description: '낯선 사람 대화 없음, 동의 4종 분리, 아이 화면에 가격 없음.' },
  '/terms': { title: '이용약관 — LCW', description: 'LCW 이용약관 요약.' },
  '/privacy': { title: '개인정보 처리방침 — LCW', description: 'LCW 개인정보 처리방침 요약.' },
  '/learn': { title: '상황별 영어 표현 — LCW', description: '카페 주문, 장비 주문, 흥정, 변명. 별 1개부터 3개까지 자라는 영어 문장.' },
  '/worlds': { title: '월드 구경 — LCW', description: '친구가 지은 월드를 돌려 보는 쇼룸.' },
  '/pass': { title: '친구 초대 — LCW', description: `친구 월드에 ${PASS_MIN}분 동안 함께 들어가기.` }
};
