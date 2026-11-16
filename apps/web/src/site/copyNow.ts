/**
 * Lines that are true today (audit 2026-11-16 item 1), next to the full claims in copy.ts. Each pair names the
 * features the full claim needs (featureStatus.ts); `whenLive` shows the full claim once all of them are live, so
 * nothing here has to be edited when a feature ships. Claims for features that are not live stay on the page with a
 * state tag. Words follow docs/21-glossary.md ('게임' is not used).
 */
import { lookupPhraseBank } from '@lcw/content';
import type { PaperOffer } from './widgets.js';
import type { FeatureId, FeatureState } from './featureStatus.js';

export const STATE_TAG: Readonly<Record<Exclude<FeatureState, 'live'>, string>> = {
  building: '만드는 중',
  planned: '준비 중'
};

/** Short Korean name of each feature, for the "지금 열려 있는 것" line. */
export const FEATURE_NAME_KO: Readonly<Record<FeatureId, string>> = {
  talk_order: '카페 주문',
  talk_trade: '상점 물물교환',
  build_plot: '내 부지 짓기',
  residents: '주민 입주',
  fight: '싸우기',
  earn: '벌기',
  explore_regions: '지역 탐험',
  court: '법정 변론',
  destruction: '터뜨리기',
  craft_gear: '장비 제작',
  jetpack: '제트팩',
  mine: '광산',
  sky_island: '하늘섬',
  space_station: '우주 정거장',
  friends_pass: '친구 초대',
  showroom: '쇼룸'
};

const bankOffers = (level: 'L1' | 'L3'): PaperOffer[] =>
  (lookupPhraseBank({ ctx: 'cafe', level, item: 'honey_tea', modifiers: ['warm'] })?.offers ?? []).map((o) => ({
    stars: o.stars,
    text: o.text,
    coins: o.price
  }));

/** The honey cafe's real 1~3 star offers for a warm honey tea (same phrase bank the world serves, with its prices). */
export const CAFE_OFFERS_NOW: readonly PaperOffer[] = bankOffers('L3');
const CAFE_L1 = bankOffers('L1');

/** "I'd love a warm honey tea so that ..." → "... so that ..." for the growing-sentence strip. */
function tail(text: string): string {
  const i = text.indexOf(' so that ');
  return i >= 0 ? `...${text.slice(i)}` : text;
}

export const LANDING_NOW = {
  heroBody: {
    needs: ['fight', 'explore_regions', 'craft_gear'] as const,
    now: '카페에서 주문하고, 상점에서 바꾸고, 내 땅에 집을 지을 때 영어로 말합니다. 더 좋은 문장이 더 좋은 값이 됩니다.'
  },
  step1Body: {
    needs: ['craft_gear'] as const,
    now: '음료를 사고, 물건을 바꾸고, 집을 지을 때마다 마을 이웃에게 영어로 말해요.'
  },
  step1En: { needs: ['jetpack'] as const, now: (CAFE_L1[0]?.text ?? 'Honey tea, please.').replace(/[.!?]$/, '') },
  step2Body: { needs: ['craft_gear'] as const, now: '같은 주문도 별 1개부터 3개까지. 긴 문장일수록 값이 싸져요.' },
  stepGrow: {
    needs: ['jetpack'] as const,
    now: [CAFE_OFFERS_NOW[0]?.text ?? '', CAFE_OFFERS_NOW[1]?.text ?? '', tail(CAFE_OFFERS_NOW[2]?.text ?? '')] as readonly string[]
  },
  step3Body: {
    needs: ['mine', 'sky_island', 'space_station'] as const,
    now: '광장에서 카페, 상점, 내 땅까지 걸어서 가요. 광산·하늘섬·우주 정거장은 만드는 중이에요.'
  },
  step3En: { needs: ['mine', 'sky_island', 'space_station'] as const, now: 'plaza · cafe · shop · my plot' },
  dialogBody: { needs: ['jetpack', 'craft_gear'] as const, now: '같은 꿀차도 문장에 따라 값이 달라져요. 문장을 눌러 들어 보세요.' },
  dialogOffers: { needs: ['jetpack', 'craft_gear'] as const, now: CAFE_OFFERS_NOW },
  playerDoorBody: {
    needs: ['destruction', 'sky_island'] as const,
    now: '네 월드는 네가 만든다. 카페에서 주문하고, 내 땅에 집을 지어. 필요한 건 영어 한 문장.'
  }
} as const;

export const PLAY_NOW = {
  lead: {
    needs: ['sky_island', 'space_station'] as const,
    now: '빈 땅에 블록 하나. 거기서 시작해서 집까지. 하늘섬과 우주 정거장은 만드는 중이야. 필요한 건 영어 한 문장.'
  },
  /** Line under "오늘은 뭐 할래": what is open today, built from the live features. */
  openNow: (names: readonly string[]) => (names.length ? `지금 열려 있는 것: ${names.join(', ')}. 나머지는 하나씩 열려.` : ''),
  /** A card for what is live today, shown first in the mode grid. */
  talkMode: {
    needs: ['talk_order', 'talk_trade'] as const,
    k: '주문하고 바꾸기',
    d: '꿀 카페에서 음료를 시키고, 상점에서 물건을 바꿔. 문장이 길수록 값이 싸져.'
  },
  /** The four modes of copy.ts PLAY.modes, in order: the feature that tags the card, and a today line where part is live. */
  modes: [
    { tag: 'build_plot', needs: ['build_plot', 'residents'], now: '블록을 하나씩 쌓아 내 땅에 집을 지어. 주민 입주는 만드는 중이야.' },
    { tag: 'fight', needs: ['fight'], now: null },
    { tag: 'earn', needs: ['earn'], now: null },
    { tag: 'explore_regions', needs: ['explore_regions'], now: null }
  ] as ReadonlyArray<{ tag: FeatureId; needs: readonly FeatureId[]; now: string | null }>,
  half: {
    needs: ['jetpack', 'craft_gear'] as const,
    now: '카페 주인에게 그냥 "Honey tea" 하면 제값이야. 별 3개 문장으로 말하면 반값.'
  },
  build: {
    needs: ['residents'] as const,
    now: '빈 땅에서 3층 집까지, 한 칸씩. 방에 문과 불빛과 쉴 곳을 갖추면 누가 들어올 수 있는지 알려 줘. 입주는 만드는 중이야.'
  },
  metaDescription: {
    needs: ['destruction', 'sky_island'] as const,
    now: '네 월드는 네가 만든다. 카페에서 주문하고, 내 땅에 집을 지어. 필요한 건 영어 한 문장.'
  }
} as const;

/** /play feature sections: which features each one shows (the tag uses the first one that is not live). */
export const PLAY_SECTION_FEATURES = {
  half: ['jetpack', 'craft_gear'],
  boom: ['destruction', 'court'],
  make: ['craft_gear'],
  build: ['build_plot'],
  friend: ['friends_pass'],
  up: ['mine', 'sky_island', 'space_station']
} as const satisfies Record<string, readonly FeatureId[]>;

/** /parents speaking-scene tabs (copy.ts SITUATIONS ids) → the feature behind each scene. */
export const SITUATION_FEATURE: Readonly<Record<string, FeatureId>> = {
  cafe: 'talk_order',
  makers: 'craft_gear',
  exchange: 'talk_trade',
  court: 'court'
};

/** /learn pages (copy.ts LEARN_PAGES ctx) → the feature behind each scene; open questions need no scene. */
export const LEARN_CTX_FEATURE: Readonly<Record<string, FeatureId>> = {
  cafe: 'talk_order',
  makers_lab: 'craft_gear',
  trade: 'talk_trade',
  court: 'court'
};
