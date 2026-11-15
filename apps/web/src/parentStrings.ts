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
  }
} as const;
