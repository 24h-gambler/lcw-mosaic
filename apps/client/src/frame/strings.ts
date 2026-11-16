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
  repairMastered: '이 물건은 이미 완전히 익혔어요. 다른 물건을 골라 봐요.',
  repairAgain: '다음에 다시 해 봐요',
  hintStep: (n: number): string => `힌트 ${n}단계`,
  // G14
  settingsTitle: '설정',
  sControls: '조작',
  sSound: '소리',
  sScreen: '화면',
  sAccess: '접근성',
  sMic: '마이크 점검',
  settingsSavedHere: '바꾸면 바로 적용되고, 이 기기에 저장돼요.',
  settingsNotSaved: '이 기기에는 저장이 안 돼서, 이번에만 적용돼요.',
  on: '켜짐',
  off: '꺼짐',
  // G14 조작
  keysTitle: '키보드',
  keysHint: '"바꾸기"를 누르고 쓰고 싶은 키를 눌러요.',
  keyGroups: { move: '움직이기', act: '하기', menu: '메뉴', build: '짓기' } as Record<string, string>,
  keyActions: {
    forward: '앞으로',
    back: '뒤로',
    left: '왼쪽',
    right: '오른쪽',
    jump: '점프',
    run: '달리기 (누르고 있기)',
    talk: '말 걸기',
    view: '1인칭 ↔ 3인칭',
    mirror: '거울로 내 모습 보기',
    bag: '소지품 열기',
    map: '지도 열기',
    book: '도감 열기',
    rotate: '블록 돌리기',
    undo: '방금 놓은 블록 되돌리기',
    chest: '블록 상자 열기'
  } as Record<string, string>,
  keyFixedTitle: '늘 같은 키',
  keyFixed: [
    ['방향키', '움직이기'],
    ['마우스 끌기', '둘러보기'],
    ['마우스 휠', '3인칭 카메라 거리'],
    ['1 ~ 5', '손에 들 칸 고르기'],
    ['Esc', '창 닫기']
  ] as ReadonlyArray<readonly [string, string]>,
  rebind: '바꾸기',
  rebindWait: '쓰고 싶은 키를 눌러요',
  rebindCancel: '그만두기',
  rebindReserved: (k: string): string => `${k} 키는 정해진 일이 있어서 쓸 수 없어요.`,
  rebindSwapped: (k: string, other: string): string => `${k} 키를 쓰던 '${other}'와 키를 서로 바꿨어요.`,
  rebindDone: (k: string, action: string): string => `이제 ${k} 키로 '${action}'을 해요.`,
  keysReset: '키를 처음대로',
  keyNames: {
    Space: 'Space',
    ShiftLeft: '왼쪽 Shift',
    ShiftRight: '오른쪽 Shift',
    ControlLeft: '왼쪽 Ctrl',
    ControlRight: '오른쪽 Ctrl',
    AltLeft: '왼쪽 Alt',
    AltRight: '오른쪽 Alt',
    Tab: 'Tab',
    CapsLock: 'Caps Lock',
    Backspace: 'Backspace',
    Backquote: '`',
    Minus: '-',
    Equal: '=',
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/'
  } as Record<string, string>,
  touchTitle: '터치 화면',
  touchGuide: ['화면 왼쪽 절반을 끌면 움직여요.', '오른쪽 빈 곳을 끌면 둘러봐요.', '말 걸기·점프 버튼은 오른쪽 아래에 있어요.'] as readonly string[],
  lookTitle: '둘러보기',
  lookMouseTitle: '마우스로 끌 때 빠르기',
  lookTouchTitle: '손가락으로 끌 때 빠르기',
  invertYTitle: '위아래 반대로',
  invertYHint: '끌어 올리면 아래를 봐요.',
  slow: '느리게',
  fast: '빠르게',
  micModeTitle: '대화창 마이크 버튼',
  micModeToggle: '한 번 눌러 켜고, 다 말하면 한 번 더 눌러요',
  micModeHold: '누르고 있는 동안만 들어요',
  micModeHint: '마이크 버튼과 Space 키에 같이 쓰여요.',
  micHoldRelease: '손을 떼면 끝나요',
  // G14 소리
  volTitles: { master: '전체 소리', music: '배경 음악·주변 소리', effects: '효과음', voice: '목소리' } as Record<string, string>,
  volHint: '수업 중 친구·선생님 목소리는 "목소리"를 따라가요.',
  volTry: '들어 보기',
  npcVoiceTitle: '주민 목소리',
  voiceRateTitle: '말하는 빠르기',
  voiceRateNames: { '0.6': '아주 느리게', '0.7': '느리게', '0.8': '조금 느리게', '0.9': '조금 느리게', '1': '보통', '1.1': '조금 빠르게', '1.2': '빠르게' } as Record<string, string>,
  neuralTitle: '자연스러운 목소리',
  neuralHint: '켜면 주민마다 사람 같은 목소리로 말해요. 끄면 이 기기의 목소리로 말해요.',
  volTryLine: 'Hello! Nice to meet you.',
  volMuted: '꺼짐',
  // G14 화면
  textSizeTitle: '글자 크기',
  textSizeHint: '메뉴와 대화창 글자가 같이 커져요.',
  textSizeSample: '안녕! Can I have a cookie, please?',
  motionTitle: '움직임 줄이기',
  motionHint: '흔들림·반짝임·튀어나오는 효과를 줄여요.',
  motionDevice: '기기 설정을 따라요',
  qualityTitle: '화질',
  qualityHint: '다음에 시작할 때 바뀌어요. 화면이 끊기면 낮춰 봐요.',
  qualityHintLive: '바로 바뀌어요. 화면이 끊기면 낮춰 봐요.',
  qualities: { auto: '자동', low: '낮음', mid: '보통', high: '높음' } as Record<string, string>,
  qualityNow: (q: string): string => `지금: ${q}`,
  qualityAutoNow: (q: string): string => `자동(지금: ${q})`,
  viewChunksTitle: '시야 거리',
  viewChunksHint: '멀리까지 보이면 더 무거워져요.',
  shadowsTitle: '그림자',
  renderScaleTitle: '해상도 배율',
  renderScaleHint: '낮추면 조금 흐려지지만 더 부드러워져요.',
  tierDefault: '등급 기본',
  qualityRestart: '지금 다시 시작하기',
  fpsTitle: '초당 화면 수(FPS) 보기',
  fpsHint: '화면 오른쪽 아래에 숫자가 나와요.',
  // G14 접근성
  readableTitle: '읽기 쉬운 글자',
  readableHint: '글자 모양이 또렷한 서체로 바꿔요.',
  readableSample: 'b d p q · I l 1 · O 0',
  assistTitle: '색 구분 돕기',
  assistHint: '빨강·초록을 구분하기 어려울 때 성공·경고 색을 바꿔요.',
  assistOk: '통과',
  assistWarn: '조심',
  syllableTitle: '영어 문장 음절 나눠 보기',
  syllableHint: '대화창의 목표 문장을 음절마다 점으로 나눠 보여 줘요.',
  syllableSample: 'ba·na·na',
  focusTitle: '선택한 곳 테두리 크게',
  focusHint: '키보드로 고른 버튼에 굵은 테두리를 늘 보여 줘요.',
  noMicTitle: '마이크 없이 놀기',
  noMicHint: '말하기가 어려운 날엔 대화창의 🧩 단어 카드나 ⌨️ 글자로도 할 수 있어요.',
  // G14 마이크 점검
  micCheckIntro: '"Hello!" 하고 말해서 마이크가 잘 들리는지 봐요. 언제든 다시 할 수 있어요.',
  micCheckLast: '지난 점검',
  micCheckNever: '아직 안 했어요',
  micCheckStatus: { ok: '잘 들렸어요', quiet: '소리가 작았어요', none: '마이크를 쓸 수 없었어요', skipped: '건너뛰었어요' } as Record<string, string>,
  micCheckStart: '마이크 점검하기',
  micCheckTips: ['조용한 곳에서 마이크 가까이 말해요.', '브라우저가 마이크를 물어보면 "허용"을 눌러요.', '헤드셋을 쓰면 더 잘 들려요.'] as readonly string[]
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
