/**
 * Korean UI strings of the play domain (AGENTS 6 문자열; docs/21 용어: no '게임', no price/payment words on the child
 * screen — coins are fine, docs/21 2장). English lines the NPCs say come from @lcw/content (play-bank.ts).
 */
import { itemNameKo } from '../world/strings.js';

export const RANK_KO = { intern: '인턴', staff: '사원', manager: '매니저', director: '디렉터' } as const;

export const PLAY_KO = {
  cardTitle: '내 일',
  go: '상가로 가기',
  oreName: (ore: string) => itemNameKo(ore),
  clock: (hhmm: string) => `근무 시계 ${hhmm}`,
  hours: {
    before_open: (min: number) => `사무실 여는 시간까지 ${min}분`,
    on_time: (min: number) => `출근 ${min}분 전`,
    late: '지각이에요 · 사장님께 사정을 말해요',
    closed: '오늘 근무는 끝났어요 · 내일 09:00'
  },
  noJob: '아직 일이 없어요',
  rankLine: (rank: string, pay: number) => `${rank} · 일급 코인 ${pay}`,
  promo: (have: number, need: number, next: string) => `${next}까지 ${Math.min(have, need)}/${need}`,
  topRank: '가장 높은 직급이에요',
  served: (n: number, need: number) => `손님 응대 ${n}/${need}`,
  paidToday: '오늘 일급을 받았어요',
  next: {
    interview: '사장님과 면접 보기',
    boss_report: '사장님께 출근 인사하기',
    boss_late: '사장님께 늦은 사정 말하기',
    customer: '손님 벤의 이야기 들어 주기'
  } as Record<string, string>,
  needSuit: '면접은 정장을 입고 와요 · 옷가게 헨리',
  // gates: the NPC is tapped but there is nothing to say yet (the bubble says it in English, this says it in Korean)
  gate: {
    no_suit: '면접은 정장을 입고 와야 해요. 옷가게에서 정장을 사 와요.',
    before_open: (hhmm: string) => `사무실은 08:00에 열어요. 지금은 ${hhmm}이에요.`,
    closed: '오늘 근무는 끝났어요. 내일 아침에 다시 와요.',
    clock_in_first: '먼저 사장님께 출근 인사를 해요.',
    customers_waiting: '손님이 기다려요. 손님 벤에게 말을 걸어요.',
    day_done: '오늘 일을 다 했어요! 내일 또 와요.',
    no_ore: '광산에서 광석을 캐 오면 사 줘요. 상가 왼쪽 엘리베이터로 내려가요.',
    customer_idle: '손님은 근무 시간에 이야기를 들려줘요.'
  },
  result: {
    interviewNext: '좋아요! 사장님이 다음 질문을 해요.',
    hired: (rank: string, bonus: number) => (bonus > 0 ? `함께 일하게 됐어요! ${rank}이 됐어요 · 계약 코인 +${bonus}` : `함께 일하게 됐어요! ${rank}이 됐어요`),
    clockedIn: '출근했어요! 손님이 곧 와요.',
    clockedInLate: '늦은 사정을 잘 말했어요. 손님이 기다려요.',
    tip: (n: number) => `손님이 고마워해요 · 팁 코인 +${n}`,
    served: '손님 문제를 해결했어요!',
    pay: (n: number) => `오늘 일급 코인 +${n}`,
    promoted: (rank: string) => `승진! 이제 ${rank}이에요`,
    sold: (units: number, ore: string, coins: number) => `${itemNameKo(ore)} ${units}개를 팔았어요 · 코인 +${coins}`,
    soldBetter: (coins: number) => `더 좋은 문장이라 코인 +${coins}`,
    better: '더 좋은 문장이에요! 별이 올랐어요.',
    noOre: (ore: string) => `가방에 ${itemNameKo(ore)}이 없어요. 광산에서 캐 와요.`,
    wrongTurn: '지금 할 이야기가 아니에요. 화면 위 할 일을 봐요.'
  },
  mine: {
    action: (ore: string) => `${itemNameKo(ore)} 캐기`,
    holding: '캐는 중…',
    got: (ore: string, n: number) => `${itemNameKo(ore)} +1 (가방에 ${n}개)`,
    tool: (tier: number) => (tier >= 3 ? '드릴이 있어야 캘 수 있어요 · 제작소 레오' : '철 곡괭이가 있어야 캘 수 있어요 · 제작소 레오'),
    resting: (min: number) => `다시 자라는 중이에요 · ${Math.max(1, min)}분 더 놀면 생겨요`,
    tooFast: '천천히 한 번씩 캐요',
    tired: (min: number) => `팔이 조금 아파요 · ${Math.max(1, min)}분 쉬었다 다시 캐요 (그동안 사무실이나 환전소에 가 봐요)`,
    guest: '연결된 기기에서만 광석을 가방에 담을 수 있어요',
    key: 'F'
  },
  elevator: {
    title: '엘리베이터',
    down: (label: string) => `⬇ ${label}`,
    up: '⬆ 상가로'
  },
  market: {
    title: '오늘 광석 코인',
    mine: (n: number) => `내 가방 ${n}`,
    hint: '별 2개 문장이면 10%, 별 3개면 25% 더 받아요'
  }
} as const;

export const MINE_FLOOR_KO: Record<string, string> = { mine: '광산 1층', mine_deep: '광산 2층', mine_core: '광산 3층' };
