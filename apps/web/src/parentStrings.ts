/**
 * Guardian-screen copy (docs/08 §10: 합쇼체, numbers first, one line of interpretation, no praise without evidence,
 * no comparison with other children, no "덕분에"). The child's name never appears on the public report page.
 */
export const PARENT_STRINGS_KO = {
  report: {
    brand: 'LCW 수업 리포트',
    lessonTitle: (md: string) => `${md} 영어 수업`,
    lessonMeta: (min: number) => (min > 0 ? `수업 ${min}분 · 선생님이 보낸 리포트` : '선생님이 보낸 리포트'),
    previewBanner: '미리 보기입니다. 이 화면은 학부모 열람으로 기록되지 않습니다.',
    quotesTitle: '오늘 아이가 직접 말한 영어',
    quotesNote: '수업 중 통과한 문장에서 골랐습니다. 들린 그대로 옮겼습니다.',
    quotesEmpty: '이번 수업에서는 인용할 만큼 또렷하게 인식된 문장이 없었습니다.',
    starsLabel: (n: number) => `별 ${n}개`,
    hintless: '힌트 없이',
    numbersTitle: '오늘의 숫자',
    speakingTime: '직접 말한 시간',
    speakingTimeNote: '아이 목소리가 인식된 시간의 합입니다.',
    attempts: '영어로 말한 횟수',
    attemptsValue: (n: number) => `${n}번`,
    attemptsNote: (passes: number) => `그중 ${passes}번 통과했습니다.`,
    freeWords: '대본 없이 말한 단어',
    freeWordsValue: (n: number) => `${n}개`,
    freeWordsNote: '화면의 문장을 보지 않고 스스로 말한 단어 수입니다.',
    firstLessonNote: '첫 수업의 숫자는 다음 수업부터 비교 기준이 됩니다.',
    flowTitle: '수업 흐름',
    flowRow: (passes: number, n: number) => `${n}번 중 ${passes}번 통과`,
    expressionsTitle: (n: number) => `오늘 수업에서 나온 표현 ${n}개`,
    teacherTitle: '선생님의 한마디',
    nextTitle: '다음 수업',
    detailsTitle: '숫자 자세히 보기',
    summaryTitle: '요약',
    footerExpires: (date: string) => `이 링크는 ${date}까지 열립니다.`,
    footerPrivacy: '아이의 음성 원본은 저장하지 않으며, 리포트에는 아이 이름을 싣지 않습니다.',
    goneTitle: '열 수 없는 리포트입니다',
    goneBody: '리포트 링크는 30일 동안 열리며, 보호자가 링크를 닫으면 바로 열리지 않습니다. 새 링크가 필요하면 선생님께 요청해 주세요.',
    weekday: ['일', '월', '화', '수', '목', '금', '토'] as const
  },
  family: {
    title: '우리 가족',
    loading: '가족 정보를 불러오는 중입니다…',
    noSessionTitle: '가족 초대 링크로 들어와 주세요',
    noSessionBody: '선생님이 보낸 가족 초대 링크를 이 휴대폰에서 한 번 열면, 다음부터는 바로 들어올 수 있습니다.',
    inviteInvalid: '초대 링크가 이미 쓰였거나 7일이 지났습니다. 선생님께 새 링크를 요청해 주세요.',
    errorBody: '지금 가족 정보를 불러오지 못했습니다. 인터넷 연결을 확인하고 다시 시도해 주세요.',
    retry: '다시 시도',
    logout: '이 기기에서 나가기',
    serviceTitle: '먼저 서비스 이용에 동의해 주세요 (필수)',
    serviceBody:
      '아이의 계정과 플레이 기록, 영어 발화의 글자 기록(전사문)과 성장 지표를 처리합니다. 아이의 음성 원본은 아래 "음성 저장"을 켰을 때만 저장합니다.',
    serviceRefuse: '동의하지 않으면 서비스를 이용할 수 없습니다.',
    serviceAccept: '동의하고 시작하기',
    consentsTitle: '선택 동의',
    consentsNote: '하나씩 따로 켜고 끌 수 있습니다. 끄면 바로 적용됩니다.',
    on: '켜짐',
    off: '꺼짐',
    refuseLabel: '끄면',
    consents: {
      voice_store: {
        title: '음성 저장',
        body: '아이의 발화 음성을 저장해 보호자가 다시 들을 수 있게 합니다. 끄면 저장된 음성도 바로 지웁니다.',
        refuse: '글자 기록과 지표만 남고 아이 목소리 클립은 없습니다.'
      },
      lesson_window: {
        title: '수업 창문',
        body: '수업 중에 보호자가 실시간으로 들을 수 있습니다. 듣기만 하며 보호자 마이크는 연결되지 않습니다.',
        refuse: '수업 창문이 열리지 않습니다.'
      },
      showroom_public: {
        title: '쇼룸 공개',
        body: '아이가 지은 월드의 정지 화면을 링크로 공유할 수 있습니다. 실시간 위치·음성·실명은 담기지 않습니다.',
        refuse: '쇼룸을 공유할 수 없습니다.'
      },
      public_server: {
        title: '공개 서버',
        body: '다른 사람이 연 "모두" 대상 공개 월드에 들어갈 수 있습니다. 말풍선은 필터를 거친 문장만 보입니다.',
        refuse: '비공개·초대 월드에만 들어갑니다.'
      },
      friend_voice: {
        title: '친구 음성',
        body: '보호자가 승인한 친구와 실제 목소리로 대화합니다.',
        refuse: '친구와는 말풍선으로만 대화합니다.'
      }
    },
    childMeta: (level: string, birthYear: number | null, lessons: number) =>
      `${level}${birthYear ? ` · ${birthYear}년생` : ''} · 수업 ${lessons}회`,
    devicesTitle: '아이 기기',
    devicesEmpty: '연결된 기기가 없습니다.',
    deviceSeen: (when: string) => `마지막 사용 ${when}`,
    deviceRemove: '연결 해제',
    deviceRemoveConfirm: (label: string) => `${label} 연결을 해제할까요? 그 기기에서는 다시 코드를 넣어야 합니다.`,
    makeCode: '기기 연결 코드 만들기',
    codeTitle: '아이 기기에서 이 코드를 입력하세요',
    codeHow: (path: string) => `아이 기기에서 ${path} 를 열고 아래 6자리를 넣으면 연결됩니다.`,
    codeLeft: (mm: string) => `${mm} 안에 입력해 주세요 (한 번만 쓸 수 있습니다)`,
    codeExpired: '코드 시간이 지났습니다. 새 코드를 만들어 주세요.',
    reportsTitle: '수업 리포트',
    reportsEmpty: '아직 받은 수업 리포트가 없습니다.',
    reportOpen: '열기',
    reportClose: '링크 닫기',
    reportCloseConfirm: '이 리포트 링크를 닫을까요? 링크를 받은 누구도 더 이상 열 수 없습니다.',
    reportState: { opened: '열어 봄', unopened: '아직 안 열어 봄', expired: '30일 지남', revoked: '링크 닫음' },
    addTitle: '아이 추가',
    addNickname: '게임 안에서 쓸 별명',
    addNicknameNote: '실명 대신 별명을 써 주세요. 다른 사람에게 보일 수 있습니다.',
    addBirthYear: '태어난 해',
    addSubmit: '아이 추가하기',
    addRejected: '그 별명은 쓸 수 없습니다. 전화번호·이메일처럼 보이거나 고운 말이 아닌 단어가 들어 있습니다.'
  },
  link: {
    title: '이 기기를 아이 기기로 연결',
    body: '보호자 화면의 "기기 연결 코드 만들기"에서 받은 6자리를 넣어 주세요.',
    codeLabel: '연결 코드 6자리',
    labelLabel: '기기 이름 (예: 거실 태블릿)',
    submit: '연결하기',
    done: (nick: string) => `연결됐어요! 이 기기는 이제 ${nick}의 기기예요.`,
    already: (nick: string) => `이 기기는 ${nick}의 기기로 연결되어 있어요.`,
    wrong: '코드가 맞지 않거나 시간이 지났어요. 보호자 화면에서 새 코드를 받아 주세요.',
    tooMany: '시도가 너무 많아요. 잠시 뒤에 다시 해 주세요.',
    network: '인터넷 연결을 확인하고 다시 해 주세요.',
    defaultLabel: '아이 기기',
    goGame: '게임 시작하기',
    relink: '다른 코드로 다시 연결하기'
  }
} as const;
