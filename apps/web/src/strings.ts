/** Korean UI copy for the web UX additions (AGENTS.md 6: no inline screen strings). Child screens carry no price, payment or deadline. */

export const WEB_UX_STRINGS_KO = {
  site: {
    nav: {
      home: '소개',
      try: '5분 체험',
      parents: '학부모',
      teachers: '과외',
      safety: '안전·개인정보',
      worlds: '월드 구경'
    },
    backHome: '← 처음으로',
    heroTitle: '말하면 생기는 세계',
    heroBody: '짓고, 싸우고, 탐험하는 모든 순간에 영어로 말합니다. 더 좋은 문장이 더 좋은 장비가 됩니다.',
    forParents: '학부모님이세요?',
    forPlayers: '플레이어세요?',
    steps: [
      { title: '① 말한다', body: '"I want a jetpack"' },
      { title: '② 문장이 자란다', body: '★★★ so that I can fly' },
      { title: '③ 세계가 넓어진다', body: '하늘섬, 우주 정거장' }
    ],
    tryCta: '지금 5분 체험: 설치도 가입도 없이 음료 한 잔 주문해 보기',
    openGame: '게임 열기',
    sendToParent: '부모님께 소개 보내기',
    linkCopied: '소개 링크를 복사했어요. 부모님께 보내 주세요.'
  },
  inApp: {
    bannerTitle: '크롬/사파리로 열기',
    bannerBodyAndroid: '지금 앱 안의 브라우저라 마이크가 막힐 수 있어요. 크롬에서 다시 열어 주세요.',
    bannerBodyIos: '지금 앱 안의 브라우저라 마이크가 막힐 수 있어요. 오른쪽 아래 메뉴에서 사파리로 열기를 눌러 주세요.',
    openChrome: '크롬으로 열기',
    copyLink: '링크 복사',
    copied: '복사했어요. 사파리 주소창에 붙여 넣어 주세요.'
  },
  tryFlow: {
    cardsTitle: '단어 카드를 눌러 문장을 만들어 보세요',
    cardsHint: '순서대로 눌러 영어 문장을 완성해요.',
    reset: '다시 놓기',
    assembled: '문장을 완성했어요! 이제 소리 내어 말해 보세요.',
    startSpeak: '말하기 시작',
    stopSpeak: '다 말했어요',
    heardOk: '목소리가 잘 들렸어요!',
    heardShort: '조금 더 크게, 길게 말해 볼까요?',
    playback: '내 목소리 다시 듣기',
    noMicNote: '마이크를 쓸 수 없어 카드 조립으로 진행해요.',
    localOnly: '체험에서는 목소리가 이 기기 안에서만 쓰이고 저장되지 않아요.',
    recognitionTitle: '카페 주인에게 영어로 주문해 보세요',
    recognitionHint: '아래 문장을 소리 내어 말해요. 막히면 단어 카드를 눌러 순서를 맞춰 봐도 돼요.',
    listening: '듣고 있어요… 다 말하면 잠깐 기다려요',
    heardPrefix: '들린 문장:',
    recognitionPass: '주문 성공! 따뜻한 꿀차가 나왔어요.',
    recognitionRetry: '조금만 더 또박또박 말해 볼까요? 다시 눌러 말해 보세요.',
    recognitionFallback: '이 브라우저에서는 음성 인식이 막혀 있어요. 카드로 문장을 만들고 말해 봐요.'
  },
  guestEnd: {
    stored: (itemNameWithParticle: string) => `방금 만든 ${itemNameWithParticle} 임시 보관함에 들어갔어!`,
    storedNothing: '오늘 함께한 시간이 임시 보관함에 들어갔어!',
    firstWords: '첫 영어 한마디',
    guardianCode: '보호자 확인 코드',
    fallbackItemName: '물건'
  },
  claim: {
    title: '게스트 보관함 이어받기',
    codeLabel: '기기 코드 6자리',
    submit: '이어받기',
    ok: '임시 보관함의 물건과 첫 발화를 새 계정으로 옮길 준비를 했어요.',
    wrongCode: '코드가 맞지 않아요. 아이 화면의 코드를 다시 확인해 주세요.',
    none: '이 기기에는 이어받을 보관함이 없어요.',
    expired: '보관 기간(7일)이 지나 지워졌어요.',
    corrupt: '보관함을 읽을 수 없어요.',
    deviceNote: '같은 기기에서만 이어받을 수 있어요. 보관 기간은 7일입니다.'
  },
  lessonWindow: {
    title: '수업 창문',
    idle: '지금은 수업 중이 아니에요.',
    stale: '신호를 기다리는 중이에요.',
    targetLabel: '화면의 목표 문장',
    refreshNote: '10초마다 글로만 알려 드려요. 영상은 전송되지 않아요.'
  },
  director: {
    hotkeyHint: 'F1 코칭 순간 · F2 새 표현 (시각만 저장)',
    coaching: '코칭 순간',
    expression: '새 표현',
    bookmarkCount: (n: number) => `북마크 ${n}개`,
    avatarActive: '내 아바타: 학생 곁에서 활동 중',
    avatarSitting: '내 아바타: 벤치에 앉아 지도를 읽는 중',
    release: '빙의 해제',
    sparkle: '반짝임'
  }
} as const;

/** Korean subject particle (이/가) by final consonant of the last Hangul syllable. */
export function withSubjectParticle(noun: string): string {
  const last = noun.trim().slice(-1);
  const code = last.charCodeAt(0);
  const isHangul = code >= 0xac00 && code <= 0xd7a3;
  const hasFinal = isHangul && (code - 0xac00) % 28 !== 0;
  return `${noun}${hasFinal ? '이' : '가'}`;
}

/** Display names for guest keepsake item ids; unknown ids fall back to a generic noun. */
export const GUEST_ITEM_NAMES_KO: Readonly<Record<string, string>> = {
  pumpkin_helmet: '호박 헬멧',
  honey_tea: '꿀차',
  red_jetpack: '빨간 제트팩'
};
