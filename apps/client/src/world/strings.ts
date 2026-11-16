/** Player-facing Korean strings of the world domain (AGENTS 6 "문자열"). English target sentences come from content. */

export const WORLD_STRINGS = {
  loading: '마을을 짓는 중…',
  /** multi room at capacity (docs/03 D11, server room.ts 4003) */
  roomFull: '방이 가득 찼어요. 조금 뒤에 다시 들어가 볼게요',
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
  hotbarAllEmpty: '가방이 비어 있어요 · 영어로 주문하면 여기에 들어와요',
  offlineBand: '연결이 잠깐 끊겼어요 · 혼자 모드로 계속 중',
  weatherClear: '맑음',
  weatherSnow: '눈',
  weatherNight: '밤',
  lessonBadge: '수업 중',
  teacherDefault: '선생님',
  teacherWith: (name: string): string => `👩‍🏫 ${name} 함께`,
  solo: '혼자 놀기',
  coinsLabel: '코인',
  // Seat paused (docs/19 6장): no price or payment words on a child screen, only "tell your grown-up".
  seatPausedTitle: '지금은 혼자 놀기가 쉬는 중이에요',
  seatPausedBody: '마을은 둘러볼 수 있어요. 다시 같이 놀고 싶으면 보호자에게 말해 주세요.',
  seatPausedOk: '알겠어요',
  seatPausedChip: '둘러보기만',
  controlsDesktop: 'WASD 이동 · 마우스 끌기 시점 · Space 점프 · E 말 걸기',
  controlsTouch: '왼쪽을 끌어 이동 · 오른쪽을 끌어 둘러보기',
  // Building on my plot (docs/03 D13).
  buildHelpDesktop: '내 부지예요! 오른쪽 클릭 놓기 · 왼쪽 길게 누르기 부수기 · 1~5 고르기 · Z 되돌리기 · R 돌리기',
  buildHelpTouch: '내 부지예요! 톡 누르면 놓기 · 부수기를 고르고 길게 누르기',
  toolPlace: '놓기',
  toolBreak: '부수기',
  chest: '상자',
  undo: '되돌리기',
  rotate: '돌리기',
  chestTitle: '보관 상자',
  chestHint: '고르면 선택한 칸으로 와요. 손에 든 건 5칸까지예요.',
  chestHand: '손에 든 것',
  chestStore: '넣기',
  chestEmpty: '상자가 비었어요',
  close: '닫기',
  syncSaved: '저장됨',
  syncSaving: '저장 중…',
  syncOffline: '인터넷이 끊겨서 기기에 모아 두는 중',
  syncLocal: '연습 중 · 저장 안 돼요',
  syncLoading: '내 부지를 불러오는 중…',
  roomTitle: '방 검사',
  roomOk: '확인',
  buildCount: (n: number): string => `${n}개`,
  // 쇼룸 공개 (docs/19 7장): only the build's shape and colours go up — say so on the card.
  showroomBtn: '쇼룸 공개',
  showroomTitle: '내 부지를 쇼룸에 올려요',
  showroomHint: '블록 모양과 색만 올라가요. 내 이름이나 위치는 올라가지 않아요.',
  showroomName: '쇼룸 이름',
  showroomDefault: '나의 꿀벌 집',
  showroomGo: '공개하기',
  showroomBusyNow: '올리는 중…',
  showroomDone: '올렸어요! 이 주소를 가족에게 보여 주세요',
  showroomCopy: '주소 복사',
  showroomCopied: '복사했어요'
} as const;

/** Why the showroom did not go up (no prices, no blame: what to do next). */
export const SHOWROOM_REASONS_KO: Readonly<Record<string, string>> = {
  consent: '보호자가 쇼룸 공개를 허락해야 해요. 보호자에게 말해 주세요.',
  title: '다른 이름으로 해 볼까요?',
  busy: '조금 뒤에 다시 해요',
  offline: '인터넷이 연결되면 다시 해요',
  unlinked: '보호자와 연결된 기기에서만 올릴 수 있어요',
  seat: '지금은 혼자 놀기가 쉬는 중이에요',
  server: '지금은 안 돼요. 조금 뒤에 다시 해요'
};

/** Why an edit did not happen (docs/03 D13 "빨강=불가+이유"). */
export const BUILD_REASONS_KO: Readonly<Record<string, string>> = {
  not_my_plot: '내 부지 안에서만 지을 수 있어요',
  fence: '울타리와 문은 그대로 둬요',
  too_low: '더 깊이는 못 파요',
  too_high: '더 높이는 못 쌓아요',
  chest: '보관 상자 자리예요',
  empty_slot: '손에 든 게 없어요 · 상자에서 꺼내요',
  occupied: '이미 뭔가 있어요',
  no_block: '여기엔 부술 게 없어요',
  unbreakable: '이건 부술 수 없어요',
  not_buildable: '이건 놓을 수 없어요',
  no_support: '가구는 바닥 위에 놓아요',
  bag_full: '손이 가득 찼어요',
  bad_op: '다시 해 볼까요?',
  rate: '천천히 하나씩!',
  far: '너무 멀어요 · 가까이 가요',
  self: '내가 서 있는 자리예요',
  paused: '지금은 혼자 놀기가 쉬는 중이에요',
  loading: '내 부지를 불러오는 중이에요'
};

/** Korean gloss under the English room sentence (the English line is the one to read aloud). */
export const ROOM_GLOSS_KO: Readonly<Record<string, string>> = {
  closed: '방이 막혀 있지 않거나 너무 커요',
  size: '방이 너무 좁아요',
  ceiling: '천장이 두 칸은 높아야 해요',
  door: '문이 필요해요',
  light: '불빛이 필요해요',
  rest: '침대나 의자가 필요해요',
  flat: '탁자나 작업대가 필요해요',
  ok: '멋진 방이에요!',
  resident: '주민이 이사 올 수 있어요!'
};

/** Names of the 40 build blocks (content BLOCK_PALETTE keys). */
export const BLOCK_NAMES_KO: Readonly<Record<string, string>> = {
  grass: '잔디', dirt: '흙', sand: '모래', gravel: '자갈', stone: '돌', cobblestone: '조약돌', stone_brick: '돌벽돌',
  brick: '벽돌', granite: '화강암', marble: '대리석', stone_slab: '돌 반 블록', stone_stair: '돌 계단', oak_plank: '참나무 판자',
  birch_plank: '자작나무 판자', pine_plank: '소나무 판자', dark_plank: '짙은 판자', plank: '판자', log: '통나무', fence: '울타리',
  door: '문', glass: '유리', stained_glass: '색유리', torch: '횃불', lantern: '등불', roof_tile_red: '빨간 지붕',
  roof_tile_blue: '파란 지붕', roof_slate: '석판 지붕', thatch: '초가 지붕', wool_white: '흰 양털', wool_red: '빨간 양털',
  wool_yellow: '노란 양털', wool_blue: '파란 양털', wool_green: '초록 양털', carpet: '카펫', flower_pot_block: '화분',
  leaves: '나뭇잎', hay_bale: '건초', jar_shelf: '꿀단지 선반', scaffold: '발판', nameplate: '문패'
};

/** Names of shop furniture (content FURNITURE_REGISTRY ids); others read as "가구". */
export const FURNITURE_NAMES_KO: Readonly<Record<string, string>> = {
  furn_lamp_table: '탁자 등', furn_lamp_floor: '스탠드', furn_chandelier: '샹들리에', furn_lantern_wall: '벽등',
  furn_bed_single: '침대', furn_bed_bunk: '이층 침대', furn_chair_wood: '나무 의자', furn_sofa_cozy: '소파', furn_armchair: '안락의자',
  furn_table_dining: '식탁', furn_desk_study: '책상', furn_workbench: '작업대', furn_counter_kitchen: '부엌 조리대',
  job_stove: '화덕', job_sewing_machine: '재봉틀', job_stone_bench: '석재 작업대', job_saw_bench: '톱 작업대', job_anvil: '모루',
  job_flower_shelf: '화분 선반', job_display_stand: '진열대', job_mailbox: '우편함', job_easel: '이젤', job_map_table: '지도 탁자',
  job_instrument: '피아노', job_lab_desk: '실험대'
};

export const SCENE_TITLES_KO = {
  plaza: '중앙 광장',
  honey_cafe: '꿀 카페',
  trade_shop: '물물교환 상점',
  build_plot: '내 부지',
  open_hill: '바람 언덕'
} as const;

/** Vertical band names (docs/03 3.2) next to the scene title on the HUD. Keys are TUNING.verticalBands ids. */
export const BAND_NAMES_KO = {
  deep_space: '심우주',
  space_station: '우주 정거장',
  sky_island: '하늘섬',
  surface: '지상',
  mine: '광산',
  deep_core: '네더'
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

/** Sector names on the map (docs/08 G06). The central sector is the hand-built town; generated sectors bring their own. */
export const SECTOR_NAMES_KO = {
  town: '중앙 마을'
} as const;
