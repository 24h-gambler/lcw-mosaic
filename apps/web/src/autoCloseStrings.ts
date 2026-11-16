/**
 * Console strings (Korean UI) for lessons the server closed as 'left without ending' (edge lesson-mode.ts
 * LESSON_IDLE_CLOSE_MS) and for the child's mic error line. Kept apart from strings.ts so lanes editing it do not collide.
 */
export const A = {
  boxTitle: '자동 마무리된 수업 · 리포트 아직 안 보냄',
  boxHelp:
    '선생님과 학생이 15분 넘게 없어서 서버가 닫은 수업이에요. 보호자에게는 아직 아무것도 가지 않았어요. 리포트를 확인하고 보내거나, 오늘 안에 이어 하면 두 수업이 한 리포트로 가요.',
  line: (nickname: string, plan: string, from: string, to: string, utterances: number, passes: number) =>
    `${nickname} · ${plan} · ${from}–${to} · 말 ${utterances}번 · 통과 ${passes}`,
  openReport: '리포트 확인·보내기',
  continueLesson: '이어 하기',
  continuing: '이어 하는 중…',
  // inside the lesson view
  endedAutoTitle: '자동 마무리됨 — 리포트를 확인하고 보내 주세요',
  endedAutoHelp:
    '선생님과 학생이 15분 넘게 없어서 서버가 이 수업을 닫았어요(끝 시각은 마지막 활동 때). 보호자에게는 아직 아무것도 가지 않았어요. 한마디를 적고 「보호자에게 리포트 보내기」를 누르면 그때 리포트가 만들어지고 보내져요.',
  draftLabel: '리포트 초안 (지금 숫자)',
  send: '보호자에게 리포트 보내기',
  sendConfirm: '정말 보낼까요? 한 번 더 누르면 보내요',
  sending: '보내는 중…',
  backToList: '첫 화면으로 (이어 하기는 거기서)',
  folded: '이어 한 수업의 리포트에 합쳐서 이미 보냈어요.',
  continued: (from: string) => `오늘 ${from} 에 자동 마무리된 수업을 이어 가요. 끝내면 두 수업이 한 리포트로 가요.`
} as const;

/**
 * The child's last mic error (talk lane PR 122 'lcw.micIssue': the issue and the browser's own code) as one line the
 * teacher can act on at once. null: nothing to say (a cut-off turn is not a mic problem).
 */
export function micIssueLine(issue: string, raw: string): string | null {
  if (issue === 'denied' && raw === 'audio-capture') {
    return '🎤 마이크를 못 잡았어요 — 다른 앱(통화·줌)이 쓰고 있지 않은지, 마이크가 꽂혀 있는지 보고 다시 말해 보게 해 주세요';
  }
  switch (issue) {
    case 'denied':
      return '🎤 마이크 권한이 막혔어요 — 학생 화면 주소창 자물쇠(🔒) → 마이크 「허용」 → 새로고침';
    case 'insecure':
      return '🎤 보안 주소가 아니라 마이크를 못 써요 — 학생 화면을 https:// 주소로 다시 열어 주세요';
    case 'in_app':
      return '🎤 카톡·인스타 같은 앱 안 브라우저라 마이크가 안 돼요 — 크롬이나 사파리로 열어 주세요';
    case 'unsupported':
      return '🎤 이 브라우저는 음성 인식을 못 해요 — 크롬(안드로이드·PC)이나 사파리(아이폰)로 열어 주세요';
    case 'network':
      return '🎤 음성 인식 서버에 닿지 않아요 — 학생 기기 인터넷을 확인하고 다시 말해 보게 해 주세요';
    case 'no_speech':
      return '🎤 소리가 안 들렸어요 — 마이크에 가까이 대고 조금 크게 말해 보게 해 주세요';
    default:
      return null;
  }
}
