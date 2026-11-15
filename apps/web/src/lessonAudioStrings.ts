/** Korean copy for the director console's "수업 소리 내보내기" box (LessonAudioBox.tsx, WP-307). AGENTS 6. */
export const LESSON_AUDIO_STRINGS_KO = {
  title: '수업 소리 내보내기',
  help: '수업 창문을 연 보호자가 선생님과 아이의 말소리를 듣기만 합니다. 녹음하지 않고, 보호자 쪽 소리는 들어오지 않습니다.',
  micLabel: '선생님 마이크',
  micDefault: '기본 마이크',
  micN: (n: number) => `마이크 ${n}`,
  secondLabel: '아이 소리 입력 (선택)',
  secondNone: '없음 — 선생님 마이크만',
  start: '소리 내보내기 시작',
  stop: '소리 내보내기 멈춤',
  starting: '연결하는 중…',
  live: (n: number) => (n > 0 ? `내보내는 중 · 보호자 ${n}명이 듣고 있어요` : '내보내는 중 · 아직 듣는 보호자가 없어요'),
  micDenied: '마이크 권한이 막혀 있어요. 주소창의 자물쇠에서 마이크를 허용한 뒤 다시 눌러 주세요.',
  noMic: '마이크를 찾지 못했어요. 연결을 확인하고 다시 눌러 주세요.',
  notConfigured: '실시간 음성 서버가 아직 설정되지 않았어요. 보호자 창문은 글로만 보여요.',
  lessonEnded: '수업이 끝나서 소리를 내보낼 수 없어요.',
  failed: '소리를 내보내지 못했어요. 다시 눌러 주세요.',
  mixFallback: '아이 소리 입력을 섞지 못해 지금은 선생님 마이크만 보내고 있어요. 멈춘 뒤 다시 시작해 보세요.',
  unsupported: '이 브라우저는 실시간 음성을 지원하지 않아요. 최신 크롬에서 열어 주세요.'
} as const;
