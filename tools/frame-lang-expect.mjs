// Expected frame copy for the real-screen scripts (frame-shots.mjs, frame-menu-shots.mjs). The screens speak the learn
// language (world/lang.ts learnLang; English is the only one open, #111), and the Korean help (world/lang.ts helpKoOn,
// device key lcw.helpKo) adds the Korean: after a dot on menu words, on a line of its own on the HUD band and notices.
// Same words as apps/client/src/frame/strings.ts and world/strings.ts (frame-lang.test.ts checks those tables; this file
// only mirrors the few lines the scripts look for).
//
//   KO_HELP=1   Korean help on
export const FRAME_LANG = 'en';
export const KO_HELP = process.env.KO_HELP === '1' || process.env.KO_HELP === 'true';
export const KO_HELP_SHOWN = KO_HELP;

export const COPY = {
  emptyBar: /^Your bag is empty/,
  drank: /^Gulp!/,
  cookie: 'Cookie',
  useAgainFood: /Press again to eat/,
  offlineBand: /^Connection lost for a moment · Playing on your own/,
  snow: /^Snow /,
  lowThirst: /^Thirsty, so you are slow/,
  talkHelp: (k) => `${k} talk`,
  naturalVoice: /Natural voices/,
  screenWords: ['How far you see', 'Shadows', 'Sharpness', 'Auto'],
  helpKoTitle: 'Korean help'
};

/** The Korean the help adds (its own line on the HUD band and notices, the line under the menu words). */
export const COPY_KO = {
  offlineBand: /\n연결이 잠깐 끊겼어요 · 혼자 모드로 계속 중/,
  lowThirst: /\n목이 말라서 느려졌어요/,
  bagTab: '소지품',
  helpKoTitle: '한국어 도움말'
};

export const HANGUL = /[가-힣]/;
/** Frame words in the screen language: no Hangul (the Korean help sits in its own element or line). */
export const inScreenLang = (text) => !HANGUL.test(text);

/** Put the page in the asked mode before it loads (an init script). */
export function langInitScript(ctx) {
  return ctx.addInitScript(
    ({ lang, koHelp }) => {
      try {
        localStorage.setItem('lcw.learnLang', lang);
        localStorage.setItem('lcw.helpKo', koHelp ? '1' : '0');
      } catch {
        /* storage blocked */
      }
    },
    { lang: FRAME_LANG, koHelp: KO_HELP }
  );
}
