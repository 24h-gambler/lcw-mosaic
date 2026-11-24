/**
 * Start flow words (docs/08 §8.4 G07, §8.6 G15; Dan 11-16 R2555). The screen speaks the language the child learns
 * (Dan 11-16 14:3x, world/lang.ts): every line is `{ en, ko }`, English on the screen and Korean as the optional help
 * line. Player screens never say "게임" (Dan 11-16) and never show prices or dates (AGENTS §4).
 */
import type { Bi } from '../world/lang.js';

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

const bi = (en: string, ko: string): Bi => ({ en, ko });

export const START_STRINGS = {
  brand: 'LCW',
  tagline: bi('Speak English, build your town', '말하면 생기는 영어 마을'),
  loading: bi('Loading your town…', '마을을 불러오는 중이에요'),
  hello: (name: string) => bi(`Hi, ${name}!`, `${name}, 어서 와요!`),
  helloGuest: bi('Welcome!', '어서 와요!'),
  lessonLive: bi('Your teacher started the class', '선생님이 수업을 시작했어요'),
  lessonEnter: bi('Your teacher is coming to your world', '선생님이 내 월드로 와요'),
  lessonJoining: bi('Getting ready for your teacher…', '선생님을 맞이하는 중이에요'),
  continueWorld: (world: string) => bi(`Go to ${world}`, ro(world) ? `${world}${ro(world)} 가기` : `${world} 열기`),
  start: bi('Start', '시작하기'),
  makeWorld: bi('Make my world', '내 월드 만들기'),
  /** A guest sees only these (Dan 11-16 14:3x: no world before sign-up; a trial is /try). */
  signUp: bi('Sign up', '가입하기'),
  signUpHint: bi('Sign up to make your own world', '가입하면 내 월드를 만들 수 있어요'),
  signIn: bi('I have an account · Sign in', '이미 가입했어요 · 로그인'),
  tryIt: bi('Try it for 3 minutes', '3분 체험해 보기'),
  lessonJoin: bi('Join the class: enter code', '수업 참가: 숫자 6개 입력'),
  lessonCodeLabel: bi('6-digit class number from your teacher', '선생님이 알려 준 숫자 6개'),
  lessonCodeGo: bi('Join', '들어가기'),
  lessonCodeHint: bi('Enter the number to join the class in your world', '숫자를 넣으면 내 월드에서 수업에 들어가요'),
  lessonCodeJoining: bi('Joining the class…', '수업에 들어가는 중이에요'),
  lessonJoined: (name: string) => bi(`Joining as ${name}…`, `${name} 이름표로 들어가는 중이에요`),
  lessonJoinFailed: bi("That number didn't work. Check it and try again.", '그 숫자로 못 들어갔어요. 확인하고 다시 눌러 주세요.'),
  friendWorld: bi("Go to a friend's world: enter code", '친구 월드 가기: 코드 입력'),
  codeLabel: bi('6-digit code from your friend', '친구가 알려 준 코드 6자리'),
  codeGo: bi('Go', '가기'),
  codeHint: bi("Enter the code to go to your friend's world", '코드를 넣으면 친구 월드로 가요'),
  linkDevice: bi('I have a device code from my parent', '보호자가 준 기기 연결 코드가 있어요'),
  helpKoOn: '한국어 도움말 켜기',
  helpKoOff: '한국어 도움말 끄기',
  lang: {
    title: bi('What language do you want to learn?', '어떤 언어를 배울까요?'),
    lead: bi('Your town will speak this language.', '고른 언어로 마을이 말해요.'),
    soon: bi('Coming soon', '준비 중'),
    pick: bi('Choose', '고르기'),
    saving: bi('Saving…', '저장하는 중이에요')
  },
  make: {
    title: bi('Make my world', '내 월드 만들기'),
    lead: bi('Give it a name and pick a few fun things. The rest is a surprise!', '이름과 재밌는 것 몇 가지만 골라요. 나머지는 무작위로 만들어져요.'),
    nameLabel: bi('World name', '월드 이름'),
    namePlaceholder: 'Juno Town',
    nameDefault: (nick: string) => `${nick} Town`,
    nameRule: bi('Up to 12 letters or numbers', '한글·영어·숫자로 12자까지'),
    season: bi('Season', '계절'),
    time: bi('Sky', '하늘'),
    buddy: bi('First animal friend', '첫 동물 친구'),
    dice: bi('Pick for me', '아무거나 골라 줘'),
    submit: bi('Make it!', '만들기'),
    making: bi('Making…', '만드는 중이에요'),
    failed: bi("Can't make it right now. Try again in a moment.", '지금은 만들 수 없어요. 잠깐 뒤에 다시 눌러 주세요.')
  },
  reveal: {
    title: (name: string) => bi(`${name} is ready!`, `${name} 완성!`),
    lead: bi('Your town is in the middle. You can visit the eight places around it later.', '가운데가 내 마을이고, 둘레 여덟 곳은 나중에 가 볼 수 있는 곳이에요.'),
    center: bi('My town', '내 마을'),
    enter: bi('Go in', '들어가기'),
    seed: (seed: string) => `Seed ${seed.slice(0, 6).toUpperCase()}`
  },
  invite: {
    title: bi('Your teacher is in your world!', '선생님이 내 월드에 왔어요!')
  },
  pass: {
    entering: bi("Going to your friend's world…", '친구 월드로 들어가는 중이에요'),
    // No clock on the child's screen (AGENTS §4.9, docs/10 §7): the 30 minutes run and end out of sight.
    chip: (host: string) => (host ? bi(`🎟️ Visiting with ${host}'s invite`, `🎟️ ${host}의 초대로 놀러 왔어요`) : bi("🎟️ Visiting with a friend's invite", '🎟️ 친구 초대로 놀러 왔어요')),
    inUse: bi('This code is being used on another device', '이 코드는 다른 기기에서 쓰고 있어요'),
    inUseHint: bi('You can keep playing only on the first device.', '처음 들어간 기기에서만 이어서 놀 수 있어요.'),
    notFound: bi("We can't find this code", '코드를 찾을 수 없어요'),
    notFoundHint: bi('Check the link or code again.', '받은 링크나 코드를 다시 확인해 주세요.'),
    busy: bi('Lots of people are coming in right now', '지금은 들어가는 사람이 많아요'),
    busyHint: bi('Please open it again a little later.', '조금 있다가 다시 열어 주세요.'),
    retry: bi("Can't connect right now", '지금은 연결이 안 돼요'),
    retryHint: bi('Please try again in a moment.', '잠깐 뒤에 다시 눌러 주세요.'),
    again: bi('Try again', '다시 해 보기'),
    home: bi('Back to start', '처음으로')
  }
} as const;

/** Names of the places around the town (packages/content BIOME_PACKS ids): English on the card, Korean as help. */
export const BIOME_NAMES: Readonly<Record<string, { name: Bi; emoji: string }>> = {
  'biome.london_rain': { name: bi('Rainy London', '비 내리는 런던'), emoji: '☔' },
  'biome.sahara': { name: bi('Sahara Desert', '사하라 사막'), emoji: '🏜️' },
  'biome.alps': { name: bi('Snowy Alps', '알프스 설산'), emoji: '🏔️' },
  'biome.nyc': { name: bi('New York Street', '뉴욕 거리'), emoji: '🗽' },
  'biome.amazon': { name: bi('Amazon Forest', '아마존 숲'), emoji: '🌳' },
  'biome.hawaii': { name: bi('Hawaii Beach', '하와이 해변'), emoji: '🏝️' },
  'biome.tokyo': { name: bi('Tokyo Alley', '도쿄 골목'), emoji: '🏮' },
  'biome.texas': { name: bi('Texas Fields', '텍사스 들판'), emoji: '🌾' },
  'biome.nordic_fjord': { name: bi('Nordic Fjord', '북유럽 피오르'), emoji: '⛵' },
  'biome.cairo_bazaar': { name: bi('Cairo Market', '카이로 시장'), emoji: '🐪' },
  'biome.sydney_harbor': { name: bi('Sydney Harbor', '시드니 항구'), emoji: '⚓' },
  'biome.seoul_plaza': { name: bi('Seoul Plaza', '서울 광장'), emoji: '🏙️' }
};
