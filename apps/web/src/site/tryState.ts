/**
 * /try scene flow (docs/14 §8): 시작(소리 켜기) → 10초 이동 → 카페 → 마이크 → 음성 주문 1회 → 슬롯 수령 → 마시기 →
 * "이 월드를 저장할까요" → 끝 화면. Pure reducer so the whole path is testable without a browser and without a server.
 */
import { TRY_CAFE_OFFERS, type TryOffer } from '@lcw/content';

export type TryPhase = 'start' | 'walk' | 'greet' | 'choose' | 'speak' | 'receive' | 'drink' | 'save' | 'end';

/** Steps from the plaza to the cafe door (about ten seconds of tapping or holding →). */
export const TRY_WALK_STEPS = 12;
/** In-game coins the visitor starts with (game currency only, never money). */
export const TRY_WALLET = 50;
/** Better sentence, lower price (01 §1). */
export const TRY_PRICES: Readonly<Record<1 | 2 | 3, number>> = { 1: 30, 2: 24, 3: 15 };

/** Same three sentences the first lesson uses for the cafe (content/try-order.ts), graded the same way by the server. */
export const TRY_OFFERS: readonly TryOffer[] = TRY_CAFE_OFFERS;

export const TRY_NPC = {
  welcome: 'Welcome to the honey cafe! What would you like today?',
  serve: (stars: number) =>
    stars >= 3 ? 'Here you go! A warm honey tea, and a honey cookie for that great sentence!' : 'Here you go! One warm honey tea.'
} as const;

export interface TryState {
  phase: TryPhase;
  step: number;
  soundOn: boolean;
  aim: 1 | 2 | 3;
  stars: 0 | 1 | 2 | 3;
  said: string;
  coins: number;
  cup: boolean;
  cookie: boolean;
  drank: boolean;
  saved: boolean | null;
}

export const TRY_INITIAL: TryState = {
  phase: 'start',
  step: 0,
  soundOn: false,
  aim: 3,
  stars: 0,
  said: '',
  coins: TRY_WALLET,
  cup: false,
  cookie: false,
  drank: false,
  saved: null
};

export type TryAction =
  | { type: 'start'; sound: boolean }
  | { type: 'walk'; steps?: number }
  | { type: 'greeted' }
  | { type: 'pick'; stars: 1 | 2 | 3 }
  | { type: 'repick' }
  | { type: 'spoke'; stars: 1 | 2 | 3; text: string }
  | { type: 'drink' }
  | { type: 'drank' }
  | { type: 'save'; yes: boolean }
  | { type: 'restart' };

export function tryReducer(s: TryState, a: TryAction): TryState {
  switch (a.type) {
    case 'start':
      return s.phase === 'start' ? { ...s, phase: 'walk', soundOn: a.sound } : s;
    case 'walk': {
      if (s.phase !== 'walk') return s;
      const step = Math.min(TRY_WALK_STEPS, s.step + (a.steps ?? 1));
      return { ...s, step, phase: step >= TRY_WALK_STEPS ? 'greet' : 'walk' };
    }
    case 'greeted':
      return s.phase === 'greet' ? { ...s, phase: 'choose' } : s;
    case 'pick':
      return s.phase === 'choose' ? { ...s, phase: 'speak', aim: a.stars } : s;
    case 'repick':
      return s.phase === 'speak' ? { ...s, phase: 'choose' } : s;
    case 'spoke':
      if (s.phase !== 'speak') return s;
      return {
        ...s,
        phase: 'receive',
        stars: a.stars,
        said: a.text,
        coins: Math.max(0, s.coins - TRY_PRICES[a.stars]),
        cup: true,
        cookie: a.stars === 3
      };
    case 'drink':
      return s.phase === 'receive' ? { ...s, phase: 'drink', cup: false, drank: true } : s;
    case 'drank':
      return s.phase === 'drink' ? { ...s, phase: 'save' } : s;
    case 'save':
      return s.phase === 'save' ? { ...s, phase: 'end', saved: a.yes } : s;
    case 'restart':
      return { ...TRY_INITIAL, phase: 'choose', step: TRY_WALK_STEPS, soundOn: s.soundOn };
    default:
      return s;
  }
}
