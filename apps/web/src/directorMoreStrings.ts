/**
 * Console strings (Korean UI) for the trimmed /director (Dan 11-16 R2625: "쓸데없는 기능이나 버튼들이 많이 있던데 …
 * 별도로 조종 안해도 됩니다"): what stays on screen and the folded "필요할 때만" sections. Kept apart from strings.ts so
 * lanes editing it do not collide. What was removed and why: docs/18 §8.
 */
export const M = {
  /** `/director?prep=<student>` (the hub's day-record card '다음 수업 준비', 11-18): that student's row is marked. */
  prepHere: (nick: string) => `다음 수업 준비 · ${nick} — 위에서 오늘 수업안을 고르고 이 학생의 「수업 시작」을 누르세요.`,
  prepMissing: '카드의 학생이 목록에 없어요. 「새로 고침」을 누르거나 가입 승인을 확인하세요.',
  keyMore: '선생님 열쇠 · 로그인',
  csvMore: '오늘 기록 내려받기 (CSV)',
  modeMore: '1PC · 2PC 로 하는 법',
  newStudentMore: '새 학생 직접 등록 (보통은 보호자 가입 → 승인)',
  teacherMore: '학생 화면에 보일 이름 · 1PC 잠금 번호 (필요할 때만)',
  audioMore: '보호자에게 수업 소리 들려주기 (필요할 때만)',
  stepsMore: '분 단위 진행 방법 보기',
  feedTitle: (said: number, passed: number, stars: number) => `아이가 한 말 · 말 ${said}번 · 통과 ${passed} · 별 ${stars}`,
  pushThis: '이 단계로 바꾸기',
  pushNext: '다음 단계로 ▶',
  /** R325 (Dan 11-19 "콘솔이 너무 난잡"): one '더 보기' for everything a lesson rarely uses. */
  liveMore: '더 보기 · 직접 조종·이벤트 · 수업 소리',
  stagesLabel: '단계',
  guideMore: '이 단계 진행 안내',
  codeMore: '참가 주소 · 다른 기기로 들어오기',
  /** The stages wait for the teacher while the teacher walks in the world (docs/18 §11). */
  holdOn: '선생님이 월드에 있어요: 단계는 선생님이 넘길 때까지 기다려요.',
  /** R326: the stage's minutes are up and the child has not said anything in it (skips only). */
  holdQuiet: '계획한 시간이 지났지만 아이가 이 단계에서 아직 말하지 않았어요. 넘어가려면 「다음 단계로」(선생님 승인).',
  /** R326: skips in the feed title row and the abuse warning. */
  skipLine: (total: number, untried: number, stage: number) => `건너뛰기 ${total}번 (말 안 하고 ${untried}번) · 이 단계 ${stage}번`,
  skipHeavy: '말하지 않고 건너뛰기가 많아요 — 말을 걸어 주거나 쉬운 문장으로 바꿔 주세요.',
  skipKind: (kind: string, tried: boolean) => (kind === 'close' ? '말 없이 창 닫음' : tried ? '해 보고 넘김' : '말 없이 넘김'),
  holdReady: (why: string) =>
    `이 단계 끝 — ${why === 'passes' ? '목표 문장 통과' : why === 'followups' ? '후속 질문 끝' : why === 'time' ? '계획한 시간이 다 됨' : '준비됨'}. 「다음 단계로」를 누르세요.`,
  /** The teacher's own voice in the child's world (R325): a bubble over the teacher and the child's side panel. */
  sayTitle: '선생님 말하기 (학생 월드에 말풍선)',
  sayPlaceholder: '영어로 한마디 (예: Follow me to the cafe!)',
  saySend: '말하기',
  sayDone: '학생 화면에 보냈어요',
  sayFailed: '보내지 못했어요. 다시 눌러 주세요',
  /** Trades with the child (R325): give, and what the child traded. */
  tradeTitle: (n: number) => `주고받기 · ${n}번`,
  giveLabel: '물건 주기 (누르면 바로 아이 가방에)',
  given: (label: string) => `${label} 줬어요`,
  tradesEmpty: '아직 주고받은 것이 없어요. 아이가 선생님에게 E·탭 → 거래 창에서 영어로 말하면 여기 나와요.',
  tradeRow: (kind: string, get: string | null, give: string | null) =>
    kind === 'gift' ? `🎁 ${get ?? ''} 줌` : `🤝 ${give ? `${give} → ` : ''}${get ?? ''}`,
  /** Auto-advance (docs/18 §9): the rule under the running stage, and the line after it moved by itself. */
  autoRule: (need: number, minutes: number, last: boolean) =>
    last
      ? '마지막 단계예요. 「수업 끝」을 누르면 끝나요.'
      : `자동 진행: 목표 문장 ${need}개를 통과하거나, 후속 질문을 다 하거나, ${minutes}분이 지나면 다음 단계로 넘어가요. 지금 넘기려면 아래 버튼.`,
  autoMoved: (why: 'passes' | 'followups' | 'time' | string, at: string) =>
    `${at} 에 자동으로 넘어왔어요 · ${why === 'passes' ? '목표 문장 통과' : why === 'followups' ? '후속 질문 끝' : why === 'time' ? '계획한 시간이 다 됨' : '자동'}`
} as const;
