/**
 * Strings of the play domain. The screen speaks the language the child learns (Dan 11-16 14:3x, world/lang.ts): every
 * line is English, with the Korean after a dot when the child turned the Korean help on (the same biDeep reading as the
 * lesson layer). The export keeps its `_KO` name so callers stay as they are. docs/21: no '게임', no price/payment
 * words (coins are fine). The NPCs' English lines come from @lcw/content (play-bank.ts).
 */
import { PLAY_LABELS } from '@lcw/content';
import { helpKoOn } from '../world/lang.js';

const ORE_EN: Record<string, string> = { coal: 'coal', iron: 'iron ore', gold: 'gold', ruby: 'ruby', diamond: 'diamond', suit: 'suit', pickaxe: 'iron pickaxe', drill: 'drill' };
const oreEn = (k: string): string => ORE_EN[k] ?? k;
const oreKo = (k: string): string => PLAY_LABELS.find((l) => l.key === k)?.nameKo ?? k;

function joinHelp(en: string, ko: unknown): string {
  return helpKoOn() && typeof ko === 'string' && ko && ko !== en ? `${en} · ${ko}` : en;
}
/** A nested table read through the language at the moment of use (lesson/strings.ts biDeep). */
function biDeep<T extends object>(en: T, ko: object | undefined): T {
  return new Proxy(en, {
    get(target, key) {
      const e = (target as Record<PropertyKey, unknown>)[key];
      const k = ko ? (ko as Record<PropertyKey, unknown>)[key] : undefined;
      if (typeof e === 'function') {
        return (...a: unknown[]) => joinHelp(String((e as (...x: unknown[]) => unknown)(...a)), typeof k === 'function' ? (k as (...x: unknown[]) => unknown)(...a) : undefined);
      }
      if (typeof e === 'string') return joinHelp(e, k);
      if (e && typeof e === 'object') return biDeep(e, k && typeof k === 'object' ? k : undefined);
      return e;
    }
  });
}

const RANK_STRINGS_KO = { intern: '인턴', staff: '사원', manager: '매니저', director: '디렉터' };
const RANK_EN = { intern: 'Intern', staff: 'Staff', manager: 'Manager', director: 'Director' };
export const RANK_KO: typeof RANK_EN = biDeep(RANK_EN, RANK_STRINGS_KO);
const rk = (r: string): string => RANK_STRINGS_KO[r as keyof typeof RANK_STRINGS_KO] ?? r;
const re = (r: string): string => RANK_EN[r as keyof typeof RANK_EN] ?? r;
const MINE_FLOOR_STRINGS_KO: Record<string, string> = { mine: '광산 1층', mine_deep: '광산 2층', mine_core: '광산 3층' };
const MINE_FLOOR_EN: Record<string, string> = { mine: 'Mine B1', mine_deep: 'Mine B2', mine_core: 'Mine B3' };

const PLAY_STRINGS_KO = {
  cardTitle: '내 일',
  go: '상가로 가기',
  oreName: (ore: string) => oreKo(ore),
  clock: (hhmm: string) => `근무 시계 ${hhmm}`,
  hours: {
    before_open: (min: number) => `사무실 여는 시간까지 ${min}분`,
    on_time: (min: number) => `출근 ${min}분 전`,
    late: '지각이에요 · 사장님께 사정을 말해요',
    closed: '오늘 근무는 끝났어요 · 내일 09:00'
  },
  noJob: '아직 일이 없어요',
  rankLine: (rank: string, pay: number) => `${rk(rank)} · 일급 코인 ${pay}`,
  promo: (have: number, need: number, next: string) => `${rk(next)}까지 ${Math.min(have, need)}/${need}`,
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
    hired: (rank: string, bonus: number) => (bonus > 0 ? `함께 일하게 됐어요! ${rk(rank)}이 됐어요 · 계약 코인 +${bonus}` : `함께 일하게 됐어요! ${rk(rank)}이 됐어요`),
    clockedIn: '출근했어요! 손님이 곧 와요.',
    clockedInLate: '늦은 사정을 잘 말했어요. 손님이 기다려요.',
    tip: (n: number) => `손님이 고마워해요 · 팁 코인 +${n}`,
    served: '손님 문제를 해결했어요!',
    pay: (n: number) => `오늘 일급 코인 +${n}`,
    promoted: (rank: string) => `승진! 이제 ${rk(rank)}이에요`,
    sold: (units: number, ore: string, coins: number) => `${oreKo(ore)} ${units}개를 팔았어요 · 코인 +${coins}`,
    soldBetter: (coins: number) => `더 좋은 문장이라 코인 +${coins}`,
    better: '더 좋은 문장이에요! 별이 올랐어요.',
    noOre: (ore: string) => `가방에 ${oreKo(ore)}이 없어요. 광산에서 캐 와요.`,
    wrongTurn: '지금 할 이야기가 아니에요. 화면 위 할 일을 봐요.'
  },
  mine: {
    action: (ore: string) => `${oreKo(ore)} 캐기`,
    holding: '캐는 중…',
    got: (ore: string, n: number) => `${oreKo(ore)} +1 (가방에 ${n}개)`,
    tool: (tier: number) => (tier >= 3 ? '드릴이 있어야 캘 수 있어요 · 제작소 레오' : '철 곡괭이가 있어야 캘 수 있어요 · 제작소 레오'),
    resting: (min: number) => `다시 자라는 중이에요 · ${Math.max(1, min)}분 더 놀면 생겨요`,
    tooFast: '천천히 한 번씩 캐요',
    tired: (min: number) => `팔이 조금 아파요 · ${Math.max(1, min)}분 쉬었다 다시 캐요 (그동안 사무실이나 환전소에 가 봐요)`,
    guest: '연결된 기기에서만 광석을 가방에 담을 수 있어요',
    key: 'F'
  },
  elevator: {
    title: '엘리베이터',
    down: (floor: string) => `⬇ ${MINE_FLOOR_STRINGS_KO[floor] ?? floor}`,
    up: '⬆ 상가로'
  },
  market: {
    title: '오늘 광석 코인',
    mine: (n: number) => `내 가방 ${n}`,
    hint: '별 2개 문장이면 10%, 별 3개면 25% 더 받아요'
  }
};

const PLAY_EN = {
  cardTitle: 'My job',
  go: 'Go to the market hall',
  oreName: (ore: string) => oreEn(ore),
  clock: (hhmm: string) => `Work clock ${hhmm}`,
  hours: {
    before_open: (min: number) => `The office opens in ${min} min`,
    on_time: (min: number) => `Work starts in ${min} min`,
    late: "You're late · tell the boss why",
    closed: 'Work is over for today · tomorrow 09:00'
  },
  noJob: 'No job yet',
  rankLine: (rank: string, pay: number) => `${re(rank)} · day pay ${pay} coins`,
  promo: (have: number, need: number, next: string) => `To ${re(next)}: ${Math.min(have, need)}/${need}`,
  topRank: 'The top job!',
  served: (n: number, need: number) => `Customers helped ${n}/${need}`,
  paidToday: 'Day pay received',
  next: {
    interview: 'Job interview with the boss',
    boss_report: 'Say good morning to the boss',
    boss_late: 'Tell the boss why you are late',
    customer: 'Listen to Ben, the customer'
  } as Record<string, string>,
  needSuit: 'Wear a suit to the interview · Henry, Tailor Shop',
  gate: {
    no_suit: 'You need a suit for the interview. Get one at the Tailor Shop.',
    before_open: (hhmm: string) => `The office opens at 08:00. It is ${hhmm} now.`,
    closed: 'Work is over for today. Come back tomorrow morning.',
    clock_in_first: 'Say good morning to the boss first.',
    customers_waiting: 'A customer is waiting. Talk to Ben.',
    day_done: 'All done for today! See you tomorrow.',
    no_ore: 'Bring ore from the mine and I will buy it. Take the elevator on the left of the hall.',
    customer_idle: 'Customers talk to you during work hours.'
  },
  result: {
    interviewNext: 'Good! The boss asks the next question.',
    hired: (rank: string, bonus: number) => (bonus > 0 ? `You got the job as ${re(rank)}! · bonus +${bonus} coins` : `You got the job as ${re(rank)}!`),
    clockedIn: 'You are at work! A customer is coming.',
    clockedInLate: 'You told the boss why. A customer is waiting.',
    tip: (n: number) => `The customer says thanks · tip +${n} coins`,
    served: 'You solved the problem!',
    pay: (n: number) => `Day pay +${n} coins`,
    promoted: (rank: string) => `Promoted! You are now ${re(rank)}`,
    sold: (units: number, ore: string, coins: number) => `Sold ${units} ${oreEn(ore)} · +${coins} coins`,
    soldBetter: (coins: number) => `A better sentence · +${coins} coins`,
    better: 'A better sentence! More stars.',
    noOre: (ore: string) => `No ${oreEn(ore)} in your bag. Dig some in the mine.`,
    wrongTurn: 'Not this one now. Look at the task at the top.'
  },
  mine: {
    action: (ore: string) => `Dig ${oreEn(ore)}`,
    holding: 'Digging…',
    got: (ore: string, n: number) => `${oreEn(ore)} +1 (${n} in your bag)`,
    tool: (tier: number) => (tier >= 3 ? 'You need a drill · Leo, Maker\'s Lab' : 'You need an iron pickaxe · Leo, Maker\'s Lab'),
    resting: (min: number) => `Growing back · ready in ${Math.max(1, min)} min of play`,
    tooFast: 'One dig at a time',
    tired: (min: number) => `Your arms are tired · dig again in ${Math.max(1, min)} min (visit the office or the exchange)`,
    guest: 'Only a linked device keeps ore in the bag',
    key: 'F'
  },
  elevator: {
    title: 'Elevator',
    down: (floor: string) => `⬇ ${MINE_FLOOR_EN[floor] ?? floor}`,
    up: '⬆ Market hall'
  },
  market: {
    title: "Today's ore coins",
    mine: (n: number) => `In my bag ${n}`,
    hint: '2-star sentence +10%, 3-star +25%'
  }
};

/** What the play layer shows: English, the Korean after a dot with the help on. */
export const PLAY_KO: typeof PLAY_EN = biDeep(PLAY_EN, PLAY_STRINGS_KO);

/** A floor's name in the screen language (the elevator buttons take the floor id). */
export const MINE_FLOOR_KO: Record<string, string> = biDeep(MINE_FLOOR_EN, MINE_FLOOR_STRINGS_KO);
