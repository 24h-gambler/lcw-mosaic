/**
 * Director events (WP-305, docs/12 §6.2 `dir.<event>`): the six things a teacher can make happen in the student's
 * world during a lesson. Kinds match `DirectorEventKind` in apps/edge/src/storage.ts. Korean is teacher/child copy,
 * English is a sentence the teacher can put up as the target right after the event.
 */
export type LessonDirectorEventKind =
  | 'weather_shift'
  | 'blackout'
  | 'npc_prompt'
  | 'mentor_dungeon_gate'
  | 'review_chest'
  | 'star_celebration';

export interface LessonDirectorEvent {
  kind: LessonDirectorEventKind;
  /** Big button label on the director console. */
  labelKo: string;
  /** Glyph shown on the button and the student's banner (no image asset needed). */
  icon: string;
  /** One line the child sees as a banner when the event lands. */
  studentBannerKo: string;
  /** What the teacher should do right after pressing it. */
  teacherTipKo: string;
  /** Sentence the console offers to put up as the target in one tap. */
  suggestedTargetEn: string;
  /** docs/12 sound key. */
  sound: string;
  /** Default 1-9 keyboard shortcut on the director console. */
  hotkey: string;
}

export const LESSON_DIRECTOR_EVENTS: readonly LessonDirectorEvent[] = [
  {
    kind: 'weather_shift',
    labelKo: '눈보라',
    icon: '❄',
    studentBannerKo: '갑자기 눈보라가 몰아쳐요! 몸을 녹일 무언가가 필요해요',
    teacherTipKo: '"It is so cold! What do you need?" 하고 물어 따뜻한 음료 주문으로 이어 가세요.',
    suggestedTargetEn: 'I need a warm drink, please.',
    sound: 'dir.weather_shift',
    hotkey: '1'
  },
  {
    kind: 'blackout',
    labelKo: '정전',
    icon: '⚡',
    studentBannerKo: '뚝! 불이 꺼졌어요. 영어로 도움을 청해 봐요',
    teacherTipKo: '아이가 도움을 청하면 불을 다시 켜 주세요(「별 축하」로 마무리하면 좋아요).',
    suggestedTargetEn: 'Can you help me, please?',
    sound: 'dir.blackout',
    hotkey: '2'
  },
  {
    kind: 'npc_prompt',
    labelKo: 'NPC 질문',
    icon: '❓',
    studentBannerKo: '누군가 질문을 했어요! 말풍선을 보고 대답해 봐요',
    teacherTipKo: '빙의 입력창의 질문이 NPC 말풍선으로 뜹니다. 5초 이상 기다려 주세요.',
    suggestedTargetEn: 'Yes, I like it because it is sweet.',
    sound: 'dir.npc_prompt',
    hotkey: '3'
  },
  {
    kind: 'mentor_dungeon_gate',
    labelKo: '멘토 던전 문',
    icon: '🚪',
    studentBannerKo: '수수께끼 문이 나타났어요! 선생님과 둘이 말해야 열려요',
    teacherTipKo: '지도를 보는 사람(선생님)이 길을 영어로 알려 주고, 아이가 되묻게 하세요(정보 격차).',
    suggestedTargetEn: 'Which way do I go?',
    sound: 'dir.mentor_dungeon_gate',
    hotkey: '4'
  },
  {
    kind: 'review_chest',
    labelKo: '복습 상자',
    icon: '🎁',
    studentBannerKo: '복습 상자 등장! 오늘 배운 문장을 말하면 열려요',
    teacherTipKo: '오늘 통과한 문장을 힌트 없이 말하게 하세요. 통과하면 다음 수업 복습 카드가 됩니다.',
    suggestedTargetEn: 'Can I have a warm honey tea?',
    sound: 'dir.review_chest',
    hotkey: '5'
  },
  {
    kind: 'star_celebration',
    labelKo: '별 축하',
    icon: '⭐',
    studentBannerKo: '최고예요! 하늘에서 별이 쏟아져요',
    teacherTipKo: '방금 잘한 문장을 한 번 더 말해 달라고 하면 기억에 오래 남아요.',
    suggestedTargetEn: 'Thank you!',
    sound: 'dir.star_celebration',
    hotkey: '6'
  }
];

export function getDirectorEvent(kind: string): LessonDirectorEvent | undefined {
  return LESSON_DIRECTOR_EVENTS.find((e) => e.kind === kind);
}
