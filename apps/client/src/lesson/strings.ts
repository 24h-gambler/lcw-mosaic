/** Korean copy for the lesson layer (the help line under the English, LESSON_STRINGS below) of the 3D client (AGENTS 6). No prices, payments or deadlines (AGENTS 4.9). */
import { getLessonNpc, npcPersona, teacherLabel } from '@lcw/content';
import { helpKoOn } from '../world/lang.js';
export const LESSON_STRINGS_KO = {
  code: {
    title: '선생님이 알려 준 숫자 6개를 넣어요',
    sub: '수업 화면으로 바로 들어가요',
    enter: '들어가기',
    joining: '들어가는 중…',
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
    ok: (nickname: string, teacher?: string | null) =>
      `${nickname ? `${nickname} · ` : ''}${teacherLabel(teacher)}과 함께`,
    /** The teacher console stopped beating (teacher left, device asleep): the child plays on alone. */
    alone: (nickname: string) => `${nickname ? `${nickname} · ` : ''}혼자 놀기 — 선생님이 잠깐 자리를 비웠어요`,
    retrying: '다시 연결하는 중…',
    queued: (n: number) => `보낼 말 ${n}개 · 연결되면 보내요`,
    /** Same-tab link to the talk-to-befriend adventure (/adventure/): the lesson token in this tab goes along (docs/22). */
    adventure: '🗺 모험',
    adventureAsk: '모험으로 갈까요? 다 하면 마을로 돌아와요',
    adventureGo: '🗺 모험 가기',
    /** The adventure stage with the dialog window open: 🗺 shows in the status bar only once the window is folded. */
    adventureFold: '✕ 로 접고 → 🗺 모험',
    leave: '나가기',
    leaveAsk: '수업에서 나갈까요?',
    leaveYes: '나가기',
    leaveNo: '계속하기'
  },
  goal: {
    label: '오늘의 목표'
  },
  speak: {
    title: (npc: { nameEn: string; nameKo: string }) => `${npc.nameKo}에게 말하기`,
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

type Widen<T> = T extends string
  ? string
  : T extends (...a: infer A) => infer R
    ? (...a: A) => Widen<R>
    : T extends Record<string, string>
      ? Record<string, string>
      : T extends object
        ? { readonly [K in keyof T]: Widen<T[K]> }
        : T;
/** The lesson layer's copy, one shape for every language. */
export type LessonStrings = Widen<typeof LESSON_STRINGS_KO>;

/**
 * English copy for the lesson layer (the world is in the language the child learns; Korean only as the optional help
 * line). Very short words and an icon on every button, so a first-time child is never stuck; the teacher is there.
 */
export const LESSON_STRINGS_EN: LessonStrings = {
  code: {
    title: '🔢 Type the 6 numbers from your teacher',
    sub: 'You go right into the lesson',
    enter: '✅ Go',
    joining: 'Going in…',
    cancel: '🏠 Back to my town',
    errors: {
      invalid_code: '❌ Not the right numbers. Ask your teacher again.',
      too_many_attempts: '⏸ Lots of tries! Take a short break, then try again.',
      expired: '⌛ This lesson link ended. Ask for new numbers.',
      network: '📶 Check the internet.',
      default: "🔁 Couldn't get in. Try again?"
    }
  },
  status: {
    ok: (nickname: string, teacher?: string | null) => `${nickname ? `${nickname} · ` : ''}👩‍🏫 With ${teacher?.trim() || 'Teacher'}`,
    alone: (nickname: string) => `${nickname ? `${nickname} · ` : ''}Playing alone — your teacher stepped away`,
    retrying: 'Connecting again…',
    queued: (n: number) => `${n} to send · sends when online`,
    adventure: '🗺 Adventure',
    adventureAsk: 'Go to the adventure? Come back to the town after',
    adventureGo: '🗺 Go',
    adventureFold: 'Close with ✕ → 🗺 Adventure',
    leave: '🚪 Leave',
    leaveAsk: 'Leave the lesson?',
    leaveYes: '🚪 Leave',
    leaveNo: '▶️ Stay'
  },
  goal: {
    label: "🎯 Today's goal"
  },
  speak: {
    title: (npc: { nameEn: string; nameKo: string }) => `Talk to ${npc.nameEn || npc.nameKo}`,
    pickStars: 'Pick a sentence to try',
    mic: '🎤 Speak',
    micStop: '✅ Done',
    listening: '👂 Listening…',
    typeInstead: '⌨️ Type',
    typePlaceholder: 'Type in English',
    send: '📨 Send',
    sending: 'Sending…',
    heard: 'I heard',
    free: 'No wrong answers. Say anything in English — say a lot!',
    notHeard: "🙉 I couldn't hear you. Say it again, louder!",
    micBlocked: "🎤 No mic here — let's type.",
    failed: "🔁 Didn't send. Tap again!",
    queued: "📶 The internet dropped. I kept what you said and will send it when you're back."
  },
  result: {
    coins: (n: number) => `🪙 ${n} coins`
  },
  possessed: 'Teacher',
  ended: {
    title: '🎉 Lesson done! Great job!',
    body: 'See you next time.',
    today: (n: number) => `You said ${n} English sentences today`,
    stars: (n: number) => `⭐ ${n} stars this lesson`
  },
  lowTier: '🃏 This device does the lesson with word cards…'
};

/** "en · ko" when the Korean help is on and the two differ (world/lang.ts), else the English. */
function joinHelp(en: string, ko: unknown): string {
  if (!helpKoOn() || typeof ko !== 'string' || !ko || ko === en) return en;
  // A shared lead ("Oreo · …") is said once: the Korean keeps only what differs.
  const e = en.split(' · ');
  const k = ko.split(' · ');
  let i = 0;
  while (i < e.length - 1 && i < k.length - 1 && e[i] === k[i]) i += 1;
  return `${en} · ${k.slice(i).join(' · ')}`;
}
/** A nested table read through the language at the moment of use (like world/strings.ts biTable, all levels). */
function biDeep<T extends object>(en: T, ko: object | undefined): T {
  return new Proxy(en, {
    get(target, key) {
      const e = (target as Record<PropertyKey, unknown>)[key];
      const k = ko ? (ko as Record<PropertyKey, unknown>)[key] : undefined;
      if (typeof e === 'function') {
        return (...a: unknown[]) => joinHelp(String((e as (...x: unknown[]) => unknown)(...a)), typeof k === 'function' ? (k as (...x: unknown[]) => unknown)(...a) : undefined);
      }
      if (typeof e === 'string') return joinHelp(e, k);
      if (e && typeof e === 'object') return biDeep(e, k && typeof k === 'object' ? k : undefined);
      return e;
    }
  });
}

/**
 * What the lesson layer shows: the language the child learns (English is the only one open, so always English now),
 * with the Korean after a dot when the child turned the Korean help on (Dan 11-16 14:3x, world/lang.ts).
 */
export const LESSON_STRINGS: LessonStrings = biDeep(LESSON_STRINGS_EN, LESSON_STRINGS_KO);

/** The stage goal the child sees: the English goal (with the Korean help when on); the Korean alone from an older server. */
export function lessonGoal(en: string | undefined, ko: string): string {
  return en ? joinHelp(en, ko) : ko;
}

/** One line in the language the child learns, the Korean after a dot when the help is on (for tables outside this file). */
export function helpLine(en: string, ko: string): string {
  return joinHelp(en, ko);
}

/**
 * The name the child knows an NPC by: the cast name the world's name plate shows ("Hannah" · "카페 주인 해나"), the lesson
 * role name ("Cafe owner") only when the cast has no entry. One name for one character on every surface.
 */
export function childNpcName(id: string): { nameEn: string; nameKo: string } {
  const cast = npcPersona(id);
  const npc = getLessonNpc(id);
  return { nameEn: cast?.nameEn ?? npc?.nameEn ?? id, nameKo: cast?.nameKo ?? npc?.nameKo ?? id };
}
