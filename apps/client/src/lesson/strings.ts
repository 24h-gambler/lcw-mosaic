/** Korean copy for the lesson layer of the 3D client (AGENTS 6). No prices, payments or deadlines (AGENTS 4.9). */
export const LESSON_STRINGS_KO = {
  code: {
    title: '선생님이 알려 준 숫자 6개를 넣어요',
    sub: '수업 화면으로 바로 들어가요',
    enter: '들어가기',
    joining: '들어가는 중…',
    /** The button on a bare /world/ (solo play) that opens the code entry. */
    openFromWorld: '🎓 수업 코드 넣기',
    cancel: '혼자 놀기로 돌아가기',
    errors: {
      invalid_code: '숫자가 맞지 않아요. 선생님께 다시 물어봐요.',
      too_many_attempts: '여러 번 해 봤네요. 잠깐 쉬었다가 다시 해 봐요.',
      expired: '수업 연결이 끝났어요. 새 숫자를 받아 주세요.',
      network: '인터넷 연결을 확인해 주세요.',
      default: '들어가지 못했어요. 다시 해 볼까요?'
    } as Record<string, string>
  },
  status: {
    ok: (nickname: string) => (nickname ? `${nickname} · 선생님과 연결됨` : '선생님과 연결됨'),
    retrying: '다시 연결하는 중…',
    queued: (n: number) => `보낼 말 ${n}개 · 연결되면 보내요`,
    leave: '나가기',
    leaveAsk: '수업에서 나갈까요?',
    leaveYes: '나가기',
    leaveNo: '계속하기'
  },
  goal: {
    label: '오늘의 목표'
  },
  speak: {
    title: (npc: string) => `${npc}에게 말하기`,
    pickStars: '도전할 문장을 골라요',
    mic: '말하기',
    micStop: '다 말했어요',
    listening: '듣고 있어요…',
    typeInstead: '글자로 쓰기',
    typePlaceholder: '영어로 써 봐요',
    send: '보내기',
    sending: '선생님께 보내는 중…',
    heard: '들린 말',
    free: '정답은 없어요. 하고 싶은 말을 영어로 길게 해 봐요!',
    notHeard: '잘 안 들렸어요. 한 번 더 크게 말해 볼까요?',
    micBlocked: '마이크를 쓸 수 없어서 글자로 써요.',
    failed: '보내지 못했어요. 한 번 더 눌러 볼까요?',
    queued: '인터넷이 잠깐 끊겼어요. 말한 건 저장해 두었다가 연결되면 선생님께 보낼게요.'
  },
  result: {
    coins: (n: number) => `코인 ${n}`
  },
  possessed: '선생님',
  ended: {
    title: '오늘 수업 끝! 정말 잘했어요',
    body: '다음 수업에서 또 만나요.',
    today: (n: number) => `오늘 영어로 말한 문장 ${n}개`,
    stars: (n: number) => `이번 수업에서 받은 별 ⭐ ${n}개`
  },
  lowTier: '이 기기에서는 단어 카드 화면으로 수업해요…'
} as const;
