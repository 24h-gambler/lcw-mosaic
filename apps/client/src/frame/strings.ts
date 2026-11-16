/**
 * Player-facing Korean strings of the frame domain (docs/08 8.6 G03 G04 G06 G10 G11 G14; AGENTS 6 "문자열").
 * Tone: short 해요체, never blaming (docs/08 10장). No prices, payment or deadlines on a child screen (AGENTS 4.9).
 */

export const FRAME_STRINGS = {
  menu: '메뉴',
  close: '닫기',
  tabs: {
    bag: '소지품',
    mirror: '거울',
    map: '지도',
    book: '도감',
    repair: '수리소',
    settings: '설정'
  },
  /** Desktop keys (shown on the tabs). Tab and R stay the world's (mirror camera, build rotate). */
  keys: {
    bag: 'I',
    map: 'M',
    book: 'K'
  } as Record<string, string>,
  loading: '불러오는 중…',
  offline: '지금은 서버와 연결이 안 돼요. 연결되면 다시 보여 줄게요.',
  guestNote: '손님으로 노는 중이라 이 기기에서만 보여요.',
  // G03
  bagTitle: '들고 다니는 것',
  bagHint: '5칸까지 들고 다닐 수 있어요. 더 있는 건 집 상자에 넣어 둬요.',
  bagEmpty: '아직 들고 있는 게 없어요. 가게에서 영어로 주문해 봐요.',
  socketsTitle: '입은 것',
  chestTitle: '집 상자',
  chestHint: '상자는 칸 제한이 없어요. 넣어 둔 물건은 수리소에서 다시 연습할 수 있어요.',
  chestEmpty: '상자가 비어 있어요.',
  toChest: '상자에 넣기',
  toBag: '꺼내 들기',
  bagFull: '가방이 가득 찼어요. 하나를 상자에 넣고 다시 해 봐요.',
  hold: '손에 들기',
  needsRepair: '고쳐 줘야 해요',
  mastered: '마스터',
  socketEmpty: '비어 있음',
  sockets: {
    Head_Socket: '머리',
    Body_Socket: '몸',
    Back_Socket: '등',
    Feet_Socket: '발',
    RightHand_Socket: '오른손',
    Mount_Socket: '탈것'
  },
  // G04
  mirrorTitle: '거울',
  mirrorHint: '끌어서 돌려 봐요.',
  turnLeft: '왼쪽으로 돌리기',
  turnRight: '오른쪽으로 돌리기',
  wearing: '지금 입은 것',
  // G06
  mapTitle: '지도',
  youAreHere: '나',
  unexplored: '아직 안 가 본 곳',
  /** the same words in two lines for a small map cell */
  unexploredLines: ['아직 안', '가 본 곳'] as readonly string[],
  legend: '구역',
  zoneKinds: {
    town: '마을',
    biome: '자연',
    ruin: '유적',
    plot: '내 부지'
  } as Record<string, string>,
  bandsTitle: '높이',
  bandHere: '지금 여기',
  bandLocked: '아직 못 가 본 높이',
  goThere: '여기로 가기',
  goVerb: '가기',
  mapWorldTitle: '온 세상 9칸',
  mapWorldHint: '칸을 누르면 크게 보여요.',
  mapPlaces: '갈 수 있는 곳',
  mapLessonNote: '수업 중에는 선생님이 갈 곳을 정해요.',
  mapNorth: '북',
  mapBackToMe: '내 위치 보기',
  mapUnexploredDetail: '아직 안 가 본 곳이에요. 가 보면 지도가 채워져요.',
  mapNoWorld: '월드가 열리면 지도가 보여요.',
  mapHereScene: '지금 여기',
  mapNoPlaces: '이 칸에는 아직 갈 수 있는 곳이 없어요.',
  /** Zone legend of docs/08 2.3 (SEMANTIC_TOKENS.zone keys). */
  zones: {
    core: '보호 구역',
    city: '도시',
    plot: '내 부지',
    wild: '자유 구역'
  },
  legendPlace: '갈 수 있는 곳',
  legendYou: '나와 보는 쪽',
  bandsAria: '높이 엘리베이터',
  bandLockedShort: '잠김',
  bandsHint: '지금은 지상만 다닐 수 있어요. 새 높이에 한 번 가 보면 광장 엘리베이터에 정류장이 생겨요.',
  /** Clockwise from north, 45° apart (map-model compassKo). */
  compass: ['북', '북동', '동', '남동', '남', '남서', '서', '북서'] as readonly string[],
  mapNow: (place: string, band: string, facing: string): string => `지금 ${place} · ${band} · ${facing}쪽을 봐요`,
  mapSummaryIntro: (total: number, explored: number): string => `지도예요. 온 세상 ${total}칸 중 ${explored}칸을 가 봤어요.`,
  mapSummaryNear: (scene: string): string => `${scene} 근처`,
  mapSummaryHere: (sector: string, near: string, band: string, facing: string): string =>
    `나는 ${sector}${near ? ` ${near}` : ''}, ${band}에서 ${facing}쪽을 보고 있어요.`,
  mapSummaryPlaces: (names: readonly string[]): string => `갈 수 있는 곳은 ${withCopula(names.join(', '))}.`,
  // G10
  bookTitle: '도감',
  books: {
    blocks: '블록',
    minerals: '광물',
    enemies: '적',
    food: '음식',
    outfits: '의상',
    expressions: '표현'
  } as Record<string, string>,
  bookProgress: (found: number, total: number): string => `${found} / ${total}`,
  bookNotFound: '?',
  bookEmptyBook: '이 책은 곧 채울 수 있어요.',
  achievementsTitle: '업적',
  // G11
  repairTitle: '수리소',
  repairIntro: '상자에 넣어 둔 물건을 골라 그 문장을 다시 말하면 고쳐져요.',
  repairEmpty: '고칠 물건이 없어요. 상자에 넣어 둔 물건이 고칠 때가 되면 여기에 나와요.',
  repairDue: '지금 고칠 수 있어요',
  repairLater: '아직 멀쩡해요',
  repairPick: '이걸 고칠래요',
  repairDone: '고쳤어요!',
  repairAgain: '다음에 다시 해 봐요',
  hintStep: (n: number): string => `힌트 ${n}단계`,
  // G14
  settingsTitle: '설정',
  sControls: '조작',
  sSound: '소리',
  sScreen: '화면',
  sAccess: '접근성',
  sMic: '마이크 점검'
} as const;

/** True when the last Hangul syllable has a final consonant (받침); non-Hangul endings count as none. */
function hasBatchim(word: string): boolean {
  const code = word.trim().slice(-1).charCodeAt(0) - 0xac00;
  return code >= 0 && code <= 11171 && code % 28 !== 0;
}

/** "언덕이에요" / "카페예요". */
export function withCopula(word: string): string {
  return `${word}${hasBatchim(word) ? '이에요' : '예요'}`;
}

/** "광장으로" / "카페로" / "길로" (ㄹ 받침 takes 로). */
export function withDirection(word: string): string {
  const code = word.trim().slice(-1).charCodeAt(0) - 0xac00;
  const rieul = code >= 0 && code <= 11171 && code % 28 === 8;
  return `${word}${hasBatchim(word) && !rieul ? '으로' : '로'}`;
}
