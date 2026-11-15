/** Player-facing Korean strings of the world domain (AGENTS 6 "문자열"). English target sentences come from content. */

export const WORLD_STRINGS = {
  loading: '마을을 짓는 중…',
  loadingHint: '잠깐만요, 블록을 하나씩 쌓고 있어요',
  talk: '말 걸기',
  talkKey: 'E',
  jump: '점프',
  view: '시점',
  viewThird: '3인칭',
  viewFirst: '1인칭',
  viewMirror: '거울',
  goalLabel: '지금 할 일',
  noWebglTitle: '이 기기에서는 3D 마을을 열 수 없어요',
  noWebglBody: '단어 카드 화면으로 같은 수업을 할 수 있어요.',
  noWebglCta: '단어 카드로 하기',
  starsAgain: '한 번 더 해 볼까요?',
  starsGot: (n: number): string => `별 ${n}개!`,
  itemGot: (name: string): string => `${name}${objectParticle(name)} 받았어요`,
  hotbarEmpty: '빈 칸',
  lessonBadge: '수업 중',
  controlsDesktop: 'WASD 이동 · 마우스 끌기 시점 · Space 점프 · E 말 걸기',
  controlsTouch: '왼쪽을 끌어 이동 · 오른쪽을 끌어 둘러보기'
} as const;

export const SCENE_TITLES_KO = {
  plaza: '중앙 광장',
  honey_cafe: '꿀 카페',
  trade_shop: '물물교환 상점',
  build_plot: '내 부지',
  open_hill: '바람 언덕'
} as const;

/** Item names shown when giveItem() puts something in a slot. Unknown keys fall back to a gift box. */
export const ITEM_NAMES_KO: Record<string, string> = {
  honey_tea: '꿀차',
  warm_honey_tea: '따뜻한 꿀차',
  iced_honey_tea: '시원한 꿀차',
  honey_latte: '꿀 라테',
  hot_chocolate: '핫초코',
  lemonade: '레몬에이드',
  milk: '우유',
  juice: '주스',
  orange_juice: '오렌지 주스',
  apple_juice: '사과 주스',
  smoothie: '스무디',
  cookie: '쿠키',
  honey_cookie: '꿀 쿠키',
  muffin: '머핀',
  cake: '케이크',
  sandwich: '샌드위치',
  bread: '빵',
  apple: '사과',
  banana: '바나나',
  sticker: '스티커',
  toy_car: '장난감 자동차',
  ball: '공',
  kite: '연',
  hat: '모자',
  umbrella: '우산',
  book: '책',
  pencil: '연필',
  flower: '꽃',
  map: '지도',
  shell: '조개껍데기',
  marble: '구슬',
  helmet: '헬멧',
  gift: '선물'
};

/** What an NPC says when tapped and no dialog module is attached (target language, docs/12 7장 voice is the dialog domain's). */
export const NPC_GREETINGS_EN: Record<string, string> = {
  guide: 'Hi! Welcome to our town. Look around!',
  cafe_owner: 'Welcome to the Honey Cafe! What would you like?',
  shop_owner: 'Hello! Do you want to trade something?'
};

/** The guide's first line for a linked child (target language, nickname as the guardian typed it). */
export const welcomeBackEn = (name: string): string => `Hi, ${name}! Welcome back to our town.`;

export function itemNameKo(key: string): string {
  return ITEM_NAMES_KO[key] ?? ITEM_NAMES_KO.gift!;
}

/** 을/를 by whether the last Hangul syllable has a final consonant (받침). Non-Hangul endings fall back to 을(를). */
export function objectParticle(word: string): string {
  const last = word.trim().slice(-1);
  const code = last.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return '을(를)';
  return code % 28 === 0 ? '를' : '을';
}
