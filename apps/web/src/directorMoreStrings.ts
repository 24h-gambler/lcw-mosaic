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
  /** Auto-advance (docs/18 §9): the rule under the running stage, and the line after it moved by itself. */
  autoRule: (need: number, minutes: number, last: boolean) =>
    last
      ? '마지막 단계예요. 「수업 끝」을 누르면 끝나요.'
      : `자동 진행: 목표 문장 ${need}개를 통과하거나, 후속 질문을 다 하거나, ${minutes}분이 지나면 다음 단계로 넘어가요. 지금 넘기려면 아래 버튼.`,
  autoMoved: (why: 'passes' | 'followups' | 'time' | string, at: string) =>
    `${at} 에 자동으로 넘어왔어요 · ${why === 'passes' ? '목표 문장 통과' : why === 'followups' ? '후속 질문 끝' : why === 'time' ? '계획한 시간이 다 됨' : '자동'}`
} as const;
