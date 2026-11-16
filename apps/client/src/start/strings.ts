/**
 * Start flow words (docs/08 §8.4 G07, §8.6 G15; Dan 11-16 R2555). Player screens never say "게임" (Dan 11-16) and
 * never show prices or dates (AGENTS §4).
 */
/** Final consonant of the last Hangul syllable: null when the word does not end in Hangul. */
function batchim(word: string): number | null {
  const c = word.trim().codePointAt(word.trim().length - 1) ?? 0;
  return c >= 0xac00 && c <= 0xd7a3 ? (c - 0xac00) % 28 : null;
}
/** 으로/로 after a Hangul word (ㄹ and open syllables take 로); null when the word ends in a letter or digit. */
export const ro = (w: string): string | null => {
  const b = batchim(w);
  return b === null ? null : b > 0 && b !== 8 ? '으로' : '로';
};

export const START_STRINGS = {
  brand: 'LCW',
  tagline: '말하면 생기는 영어 마을',
  loading: '마을을 불러오는 중이에요',
  hello: (name: string) => `${name}, 어서 와요!`,
  helloGuest: '어서 와요!',
  lessonLive: '선생님이 수업을 시작했어요',
  lessonEnter: '선생님이 내 월드로 와요',
  lessonJoining: '선생님을 맞이하는 중이에요',
  lessonGone: '수업이 방금 끝났어요. 내 월드에서 놀아요.',
  continueWorld: (world: string) => (ro(world) ? `${world}${ro(world)} 가기` : `${world} 열기`),
  start: '시작하기',
  makeWorld: '내 월드 만들기',
  signIn: '로그인 · 가입',
  signInHint: '가입하면 어느 기기에서든 내 월드와 수업이 이어져요',
  friendWorld: '친구 월드 가기: 코드 입력',
  codeLabel: '친구가 알려 준 코드 6자리',
  codeGo: '가기',
  codeHint: '코드를 넣으면 친구 월드로 가요',
  linkDevice: '보호자가 준 기기 연결 코드가 있어요',
  make: {
    title: '내 월드 만들기',
    lead: '이름과 재밌는 것 몇 가지만 골라요. 나머지는 무작위로 만들어져요.',
    nameLabel: '월드 이름',
    namePlaceholder: '예: 지우의 마을',
    nameDefault: (nick: string) => `${nick}의 마을`,
    nameRule: '한글·영어·숫자로 12자까지',
    season: '계절',
    time: '하늘',
    buddy: '첫 동물 친구',
    dice: '아무거나 골라 줘',
    submit: '만들기',
    making: '만드는 중이에요',
    failed: '지금은 만들 수 없어요. 잠깐 뒤에 다시 눌러 주세요.'
  },
  reveal: {
    title: (name: string) => `${name} 완성!`,
    lead: '가운데가 내 마을이고, 둘레 여덟 곳은 나중에 가 볼 수 있는 곳이에요.',
    center: '내 마을',
    enter: '들어가기',
    seed: (seed: string) => `씨앗 ${seed.slice(0, 6).toUpperCase()}`
  },
  invite: {
    title: '선생님이 내 월드에 왔어요!'
  },
  pass: {
    entering: '친구 월드로 들어가는 중이에요',
    // No clock on the child's screen (AGENTS §4.9, docs/10 §7): the 30 minutes run and end out of sight.
    chip: (host: string) => (host ? `🎟️ ${host}의 초대로 놀러 왔어요` : '🎟️ 친구 초대로 놀러 왔어요'),
    inUse: '이 코드는 다른 기기에서 쓰고 있어요',
    inUseHint: '처음 들어간 기기에서만 이어서 놀 수 있어요.',
    notFound: '코드를 찾을 수 없어요',
    notFoundHint: '받은 링크나 코드를 다시 확인해 주세요.',
    busy: '지금은 들어가는 사람이 많아요',
    busyHint: '조금 있다가 다시 열어 주세요.',
    retry: '지금은 연결이 안 돼요',
    retryHint: '잠깐 뒤에 다시 눌러 주세요.',
    again: '다시 해 보기',
    home: '처음으로'
  }
} as const;

/** Korean names of the eight places around the town (packages/content BIOME_PACKS ids). */
export const BIOME_NAMES_KO: Readonly<Record<string, { name: string; emoji: string }>> = {
  'biome.london_rain': { name: '비 내리는 런던', emoji: '☔' },
  'biome.sahara': { name: '사하라 사막', emoji: '🏜️' },
  'biome.alps': { name: '알프스 설산', emoji: '🏔️' },
  'biome.nyc': { name: '뉴욕 거리', emoji: '🗽' },
  'biome.amazon': { name: '아마존 숲', emoji: '🌳' },
  'biome.hawaii': { name: '하와이 해변', emoji: '🏝️' },
  'biome.tokyo': { name: '도쿄 골목', emoji: '🏮' },
  'biome.texas': { name: '텍사스 들판', emoji: '🌾' },
  'biome.nordic_fjord': { name: '북유럽 피오르', emoji: '⛵' },
  'biome.cairo_bazaar': { name: '카이로 시장', emoji: '🐪' },
  'biome.sydney_harbor': { name: '시드니 항구', emoji: '⚓' },
  'biome.seoul_plaza': { name: '서울 광장', emoji: '🏙️' }
};
