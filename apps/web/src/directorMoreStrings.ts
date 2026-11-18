/**
 * Console strings (Korean UI) for the trimmed /director (Dan 11-16 R2625: "쓸데없는 기능이나 버튼들이 많이 있던데 …
 * 별도로 조종 안해도 됩니다"): what stays on screen and the folded "필요할 때만" sections. Kept apart from strings.ts so
 * lanes editing it do not collide. What was removed and why: docs/18 §8.
 */
export const M = {
  keyMore: '선생님 열쇠 · 로그인',
  csvMore: '오늘 기록 내려받기 (CSV)',
  modeMore: '1PC · 2PC 로 하는 법',
  newStudentMore: '새 학생 직접 등록 (보통은 보호자 가입 → 승인)',
  teacherMore: '학생 화면에 보일 이름 · 1PC 잠금 번호 (필요할 때만)',
  audioMore: '보호자에게 수업 소리 들려주기 (필요할 때만)',
  stepsMore: '분 단위 진행 방법 보기',
  feedTitle: (said: number, passed: number, stars: number) => `아이가 한 말 · 말 ${said}번 · 통과 ${passed} · 별 ${stars}`,
  pushThis: '이 단계로 바꾸기',
  pushNext: '다음 단계로 ▶'
} as const;
