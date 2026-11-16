/** Teacher presence and 1PC/2PC strings (Korean UI). Kept apart from strings.ts so lanes editing it do not collide. */
import { teacherLabel } from '@lcw/content';
export const P = {
  consoleBeatStarting: '학생 화면에 선생님 표시를 켜는 중…',
  consolePresent: '학생 화면: 선생님과 함께 (이 콘솔이 켜져 있는 동안)',
  consoleAbsent: '학생 화면: 혼자 놀기 — 콘솔 신호가 끊겼어요',
  consoleLeft: '학생 화면: 혼자 놀기 — 선생님 패널에서 「선생님 나가기」를 눌렀어요',
  consoleResume: '다시 수업하기 (선생님 돌아옴)',
  consoleLeave: '선생님 나가기 (학생 화면을 바로 혼자 놀기로)',
  /** Same tab into the 3D world as the teacher's avatar in the lesson room; "콘솔로" there comes back. */
  consoleWorld: '🧭 월드에서 1인칭으로',
  consoleBeatFailing: '선생님 신호를 못 보냈어요. 인터넷을 확인하세요 — 45초가 지나면 학생 화면이 혼자 놀기로 바뀌어요',
  boxTitle: '선생님 표시 · 1PC 잠금',
  nameLabel: '학생 화면에 보일 이름 (예: 김민지 → 「김민지 선생님」) · 비우면 「선생님」',
  namePlaceholder: '김민지',
  pinLabel: '1PC 잠금 번호 (4~6자리)',
  pinChange: '1PC 잠금 번호 바꾸기',
  pinSave: '번호 저장',
  pinSaved: '저장했어요. 학생 화면의 선생님 패널은 이 번호로 열려요.',
  pinFailed: '저장하지 못했어요. 다시 눌러 주세요.',
  pinInvalid: '숫자 4~6자리로 넣어 주세요.',
  pinIsSet: '번호가 정해져 있어요.',
  pinNotSet: '1PC 로 한다면 번호를 정해 두세요 (2PC 는 필요 없어요).',
  helpSummary: '1PC 로 할 때 / 2PC 로 할 때',
  help2pcTitle: '2PC 로 할 때 (선생님 기기 하나, 학생 기기 하나)',
  help2pc: [
    '선생님 기기(태블릿·노트북)에서 이 콘솔을 열고 학생을 골라 「수업 시작」을 누릅니다.',
    '학생 기기에서 학생 화면을 열고 6자리 코드를 넣습니다.',
    '수업 내내 이 콘솔을 켜 두세요. 콘솔이 켜져 있는 동안 학생 화면에 「선생님」이 보입니다.',
    '콘솔을 닫거나 기기가 잠들면 45초 뒤 학생 화면이 「혼자 놀기」로 바뀌고, 다시 열면 바로 수업으로 돌아옵니다.'
  ],
  help1pcTitle: '1PC 로 할 때 (한 PC 로 선생님과 학생이 함께)',
  help1pc: [
    '그 PC 에서 이 콘솔로 수업을 시작하고, 아래 「1PC 잠금 번호」(4자리)를 정합니다. 번호는 학생에게 보여 주지 마세요.',
    '같은 PC 의 새 창에서 학생 화면을 열고 6자리 코드를 넣은 뒤, 학생에게 그 창을 보여 줍니다. 콘솔 창은 학생이 보는 화면에 두지 마세요(대본·정답이 보입니다).',
    '학생 화면에서 Ctrl+Alt+T(또는 오른쪽 위 「선생님」 단추) → 잠금 번호를 넣으면 선생님 패널이 열립니다: 지금 단계의 대본·정답, 「다음 단계로」.',
    '다시 Ctrl+Alt+T(또는 「닫기」)를 누르면 패널이 닫히고 대본·정답이 화면에서 지워집니다. 닫혀 있어도 선생님은 「함께」로 보입니다.',
    '자리를 비울 때는 패널의 「선생님 나가기」(또는 이 콘솔의 「선생님 나가기」)를 누르세요. 학생 화면이 바로 「혼자 놀기」가 되고, 콘솔이 켜져 있어도 패널 잠금을 다시 풀거나 콘솔에서 「다시 수업하기」를 누르기 전까지 그대로입니다.',
    '이 PC 브라우저에는 콘솔 로그인이 남아 있어 학생이 주소창에 /director 를 치면 콘솔이 열립니다. 수업 중에는 학생 곁을 지키고, 수업 뒤에는 콘솔 탭을 닫으세요.'
  ],
  helpAlone: '「혼자 놀기」 동안 아이가 한 말도 기록되고, 기록에는 수업(선생님과 함께)과 혼자가 나뉘어 남습니다.',
  /** Director student row: the child's one-time mic check on the lesson device. */
  mic: (m: 'ok' | 'quiet' | 'none' | 'skipped' | null): string =>
    `마이크: ${m === 'ok' ? '잘 들림' : m === 'quiet' ? '작음' : m === 'none' ? '마이크 없음' : m === 'skipped' ? '안 해 봄' : '—'}`,
  // child side
  /** name alone, or null → "김민지 선생님과 함께" / "선생님과 함께" (teacherLabel, @lcw/content). */
  childWithTeacher: (name: string | null) => `${teacherLabel(name)}과 함께`,
  childAlone: '혼자 놀기',
  childAloneDetail: '선생님이 잠깐 자리를 비웠어요. 혼자 말해 봐도 돼요!'
} as const;
