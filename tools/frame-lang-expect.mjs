// Expected frame copy for the real-screen scripts (frame-shots.mjs, frame-menu-shots.mjs). The screens show in the
// learn language (apps/client/src/frame/lang.ts uiLang; English is the only one today); Korean help is the lang.ts
// switch (helpKoOn / setHelpKo). Same words as apps/client/src/frame/strings.ts and world/strings.ts (frame-lang.test.ts checks those
// tables; this file only mirrors the few lines the scripts look for).
//
//   KO_HELP=1   Korean help on (lang.ts helpKoOn, device key lcw.helpKo): Korean lines under the menu words, Korean in parentheses on the
//               HUD connection band and low-gauge notices
export const KO_HELP = process.env.KO_HELP === '1' || process.env.KO_HELP === 'true';

export const COPY = {
  emptyBar: /Your bag is empty/,
  drank: /Gulp!/,
  useAgainFood: /Press again to eat/,
  offlineBand: /Keep playing on your own/,
  snow: /^Snow /,
  lowThirst: /Thirsty, so you're slower/,
  talkHelp: (k) => `${k} talk`,
  naturalVoice: /Natural voices/,
  screenWords: ['How far you see', 'Shadows', 'Sharpness', 'Auto'],
  helpKoTitle: 'Korean help'
};

/** The Korean that Korean help adds (HUD parentheses, the line under the menu words). */
export const COPY_KO = {
  offlineBand: /\(연결이 잠깐 끊겼어요 · 혼자 모드로 계속 중\)/,
  lowThirst: /\(목이 말라서 느려졌어요/,
  bagTab: '소지품',
  helpKoTitle: '한국어 도움말'
};

export const HANGUL = /[가-힣]/;
