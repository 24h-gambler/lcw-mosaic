// Expected frame copy for the real-screen scripts (frame-shots.mjs, frame-menu-shots.mjs), by screen language. The
// screens show in the learn language (world/lang.ts learnLang; English is the only one today) unless the device pins
// the Korean screens (localStorage lcw.uiLang = 'ko', frame/strings.ts uiLang). Korean help is world/lang.ts
// helpKoOn (device key lcw.helpKo). Same words as apps/client/src/frame/strings.ts and world/strings.ts
// (frame-lang.test.ts checks those tables; this file only mirrors the few lines the scripts look for).
//
//   FRAME_LANG=en (default) | ko   the screen language (ko pins lcw.uiLang)
//   KO_HELP=1                      Korean help on: Korean lines under the menu words, Korean on the HUD band and
//                                  low-gauge notices (shown only on English screens)
export const FRAME_LANG = process.env.FRAME_LANG === 'ko' ? 'ko' : 'en';
export const KO_HELP = process.env.KO_HELP === '1' || process.env.KO_HELP === 'true';
/** Korean help lines are drawn only when the screen is not Korean already. */
export const KO_HELP_SHOWN = KO_HELP && FRAME_LANG !== 'ko';

const EN = {
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
const KO = {
  emptyBar: /가방/,
  drank: /꿀꺽/,
  useAgainFood: /한 번 더 누르면 먹어요/,
  offlineBand: /혼자 모드로 계속 중/,
  snow: /^눈 /,
  lowThirst: /목이 말라서/,
  talkHelp: (k) => `${k} 말 걸기`,
  naturalVoice: /자연스러운 목소리/,
  screenWords: ['시야 거리', '그림자', '해상도 배율', '자동'],
  helpKoTitle: '한국어 도움말'
};
export const COPY = FRAME_LANG === 'ko' ? KO : EN;

/** The Korean that Korean help adds on English screens (HUD band and notices, the line under the menu words). */
export const COPY_KO = {
  offlineBand: /\(연결이 잠깐 끊겼어요 · 혼자 모드로 계속 중\)/,
  lowThirst: /\n\(목이 말라서 느려졌어요/,
  bagTab: '소지품',
  helpKoTitle: '한국어 도움말'
};

export const HANGUL = /[가-힣]/;
/** Frame words in the screen language: no Hangul on English screens, some Hangul on Korean ones. */
export const inScreenLang = (text) => (FRAME_LANG === 'ko' ? HANGUL.test(text) : !HANGUL.test(text));

/** Put the page in the asked mode before it loads (an init script). */
export function langInitScript(ctx) {
  return ctx.addInitScript(
    ({ lang, koHelp }) => {
      try {
        if (lang === 'ko') localStorage.setItem('lcw.uiLang', 'ko');
        else localStorage.removeItem('lcw.uiLang');
        localStorage.setItem('lcw.helpKo', koHelp ? '1' : '0');
      } catch {
        /* storage blocked */
      }
    },
    { lang: FRAME_LANG, koHelp: KO_HELP }
  );
}
