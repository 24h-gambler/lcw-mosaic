import { UI_STRINGS_KO } from './lang-en-ko.js';

/**
 * The child-facing dialog / first-visit / read-aloud / review lines in English (Dan 11-16: "배울 언어가 English 면
 * 화면 글을 영어로, 한국어 도움말은 켜고 끄는 보조"). Same keys as UI_STRINGS_KO, so the client swaps the table by
 * `learnLang()` (apps/client world/lang.ts) and shows the Korean line underneath only when `helpKoOn()`.
 * Short, warm, simple words a starter can read; never blames the child (docs/04 4.1).
 */

type Widen<T> = T extends string ? string : T extends (...a: infer A) => infer R ? (...a: A) => R : { [K in keyof T]: Widen<T[K]> };
export type UiStrings = Widen<typeof UI_STRINGS_KO>;

export const UI_STRINGS_EN: UiStrings = {
  player: {
    bubbleSubstituted: 'It went through like this!',
    micPrompt: 'Press Space and say the sentence you picked.',
    tryAgain: 'Shall we say it one more time?',
    poorAudio: "I couldn't hear you well. Come closer to the mic and say it again.",
    quotaFallback: "You can order with today's sentences right away.",
    blockProtected: 'This area is protected',
    blockOtherPlot: "This is someone else's plot",
    blockOccupied: 'Someone is standing here',
    offlineBanner: 'Playing on your own for now',
    lessonBanner: 'In class',
    observerNotice: 'A grown-up can listen to this class.',
    sendToParent: 'Send to my parents'
  },
  dialog: {
    feedback: {
      perfect: 'Perfect! 3 stars!',
      passNextUp: 'You did it! Next time, try for one more star?',
      pass: 'Great job! You did it!',
      almost: 'Almost there! Say it once more, slowly?',
      coreMissed: 'Good idea! Now say it just like the sentence.',
      coreMissedPhrase: "Good idea! Can you add '{p}'?",
      cappedCore: 'Nice! Say it just like the sentence for 3 stars.',
      cappedCorePhrase: "Nice! Add '{p}' for 3 stars.",
      cappedNonVoice: 'Nice cards! Say it out loud next time for 3 stars.',
      cappedKeyboard: 'Nice typing! Say it out loud next time for 3 stars.',
      echoDone: 'You said it all the way! Amazing.',
      shortOfCoins: 'Perfect sentence! Get a few more coins to buy it.',
      shortOfCoinsGood: 'Well said! Get a few more coins to buy it.',
      pickOffer: 'Pick one of these sentences and say it.'
    },
    chooseTitle: 'Pick a sentence to say',
    starsAria: '{n} stars',
    listen: 'Listen',
    listenAgain: 'Listen again',
    micStart: 'Tap to talk',
    micStop: "I'm done",
    micListening: 'Listening…',
    micHangover: 'Done? Tap once more',
    processing: 'Checking',
    processingSlow: 'Almost done',
    mySpeech: 'I said',
    converted: "Here it is in English",
    retry: 'Try again',
    tryHigher: 'Go for one more star',
    done: 'OK!',
    close: 'Close',
    boardOpen: 'Word cards',
    keyboardOpen: 'Type it',
    micOpen: 'Say it',
    boardTitle: 'Tap the word cards in order',
    boardUndo: 'Take one out',
    boardClear: 'Start over',
    boardSubmit: 'Say this',
    keyboardPlaceholder: 'Type in English',
    keyboardSubmit: 'Send',
    micDenied: "The mic isn't working. Word cards are fine too!",
    micUnsupported: "The mic doesn't work in this browser. Let's use word cards!",
    inAppBrowser: 'The mic may not work inside KakaoTalk.',
    openExternal: 'Open in another browser',
    noSpeech: "I couldn't hear you. Come closer to the mic and try again?",
    networkError: 'The connection dropped. Tap once more?',
    savedOffline: "The internet dropped. I saved what you said and will send it to your teacher when it's back.",
    submitError: 'Something went wrong. Try once more?',
    sessionEnded: "Class is over, so it wasn't saved. Please tell your teacher.",
    practiceNote: 'This is practice, so no coins or items. Link this device with a grown-up to collect them.',
    keepBest: 'Keep this one',
    echoTitle: 'Say it back, piece by piece',
    echoStep: '{i} / {n}',
    echoNext: 'Next piece',
    missedHint: 'Try adding the underlined words',
    tagHelp: 'Press and hold a tag to see what it means',
    previewBuy: 'This sentence: 🪙 {coins}',
    previewCheaper: 'With {stars}: 🪙 {coins}!',
    previewBest: 'The cheapest sentence to buy it',
    priceAria: '{coins} coins',
    freePrompt: 'Say what you want in English. Mixing in Korean is OK!',
    ideas: 'You can also say',
    coins: 'Coins',
    stars: 'Stars',
    hintLevel: {
      full: 'Whole sentence',
      keyword: 'Key words',
      initial: 'First letters',
      picture: 'Picture',
      none: 'On your own'
    }
  },
  readAloud: {
    cta: 'Read it aloud',
    listening: 'Listening… tap once more when you finish',
    got: 'Great reading! {kind} furniture is {pct}% off today.',
    already: 'Great reading! You already got the {kind} discount today. Come back tomorrow.',
    again: 'Read it a little more clearly?',
    voiceOnly: 'The discount is only for reading out loud.',
    hint: 'Read this sentence aloud for 10% off {kind} furniture!',
    where: 'You get it when you order from Toby at the trade shop.',
    kind: { light: 'light', rest: 'resting', flat: 'table' } as Record<string, string>
  },
  firstVisit: {
    title: 'Welcome! Your first order takes 3 minutes',
    headset: 'A headset or earphones help the mic hear you better.',
    volume: 'Set the volume together with a grown-up.',
    micTitle: 'Mic check',
    lessonMicTitle: 'Check the mic before class',
    micCta: 'Say "Hello!"',
    micListening: 'Listening… tap once more when you finish',
    micOk: 'I can hear you! "{heard}"',
    micQuiet: 'Can you say it a bit louder?',
    micNone: "This device can't use a mic. You can use word cards and typing.",
    skip: 'Skip',
    next: "OK, let's go!",
    goalErrand: 'Go talk to your neighbor {giver} in front of the cafe',
    goalOrder: 'Order {item} from {cafe} at the honey cafe',
    goalDeliver: 'Bring {item} to {giver} in front of the cafe',
    goalDone: 'Errand done! You got 50 coins',
    walkCafe: 'Walk to the cafe',
    walkGiver: 'Go to {giver}',
    rewardToast: '+{coins} coins! Errand done'
  },
  review: {
    dockTitle: 'Things to fix',
    signLine: '{item} has a lightning mark',
    fixCta: 'Fix it by talking',
    npcLine: 'Oh no, it is acting up! Can you say it again?',
    fixed: 'Fixed! Next check: {when}.',
    mastered: 'It is a master design now! It will not break again. Bonus {n} coins!',
    again: 'Almost! Say it once more to fix it.',
    notDue: 'It still works fine. Come back later.',
    stage: {
      0: '20-minute check',
      1: '1-day check',
      2: '3-day check',
      3: '7-day check',
      4: '16-day check',
      5: '35-day check'
    } as Record<number, string>
  },
  guardian: UI_STRINGS_KO.guardian
};

/**
 * The English line for a Korean feedback line (the server and the grader answer `feedback_ko`): same key, `{p}`
 * carried over. Null when the line is not one of the table's (then the Korean one stays).
 */
export function feedbackEnFromKo(ko: string): string | null {
  const KO = UI_STRINGS_KO.dialog.feedback as Record<string, string>;
  const EN = UI_STRINGS_EN.dialog.feedback as Record<string, string>;
  for (const [k, v] of Object.entries(KO)) {
    if (v === ko) return EN[k] ?? null;
    const i = v.indexOf('{p}');
    if (i >= 0) {
      const pre = v.slice(0, i);
      const post = v.slice(i + 3);
      if (ko.startsWith(pre) && ko.endsWith(post) && ko.length >= pre.length + post.length) {
        const p = ko.slice(pre.length, ko.length - post.length);
        return (EN[k] ?? '').replace('{p}', p);
      }
    }
  }
  return null;
}
