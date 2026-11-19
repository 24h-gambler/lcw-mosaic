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
    timeLeft: '{n} s left — finish your sentence',
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
    sttQuota: 'Listening is taking a short break. Build your sentence with word cards!',
    sttFailed: "I couldn't make out the recording. Say it once more?",
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
    followUpHint: 'Answer in your own English. Short is OK!',
    followUpSkip: 'Next',
    openAnswerOk: 'Nice answer!',
    openAnswerShort: 'Can you say a little more?',
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
    got: 'Great reading! Today, {kind} furniture is {pct}% off.',
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
    micChipOk: 'Mic OK',
    micChipQuiet: 'Mic is quiet',
    micChipNone: 'No mic',
    micChipSkipped: 'Mic not checked',
    micChipHint: 'Tap to check the mic',
    skip: 'Skip',
    next: "OK, let's go!",
    goalErrand: 'Go talk to your neighbor {giver} in front of the cafe',
    goalOrder: 'Order {item} from {cafe} at the honey cafe',
    goalDeliver: 'Bring {item} to {giver} in front of the cafe',
    goalDone: 'Errand done! You got 50 coins',
    walkCafe: 'Walk to the cafe',
    walkGiver: 'Go to {giver}',
    rewardToast: '+{coins} coins! Errand done',
    goalAskWay: 'Ask {guide} in the plaza the way to the trade shop',
    goalTrade: 'Trade or buy something from {shop} at the trade shop',
    goalCafeStars: 'Order at the honey cafe from {cafe} with a ★★ or better sentence',
    goalTourDone: 'You have seen the whole town! Talk to anyone you like',
    goalStepToast: 'Goal done! You have a new goal'
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
 * Korean values the server fills into feedback templates ({when} of a review, {kind} of a read-aloud discount) in
 * English. apps/edge review.ts WHEN_KO and the readAloud kind table are the sources.
 */
const FEEDBACK_VALUE_EN: Record<string, string> = {
  '20분 뒤': 'in 20 minutes',
  '내일': 'tomorrow',
  '3일 뒤': 'in 3 days',
  '7일 뒤': 'in 7 days',
  '16일 뒤': 'in 16 days',
  '35일 뒤': 'in 35 days',
  ...Object.fromEntries(
    Object.entries(UI_STRINGS_KO.readAloud.kind as Record<string, string>).map(([k, ko]) => [ko, (UI_STRINGS_EN.readAloud.kind as Record<string, string>)[k] ?? k])
  )
};

/** The feedback lines the server and the grader answer as `feedback_ko`: dialog grading, read-aloud and review. */
const FEEDBACK_TABLES: Array<[Record<string, unknown>, Record<string, unknown>]> = [
  [UI_STRINGS_KO.dialog.feedback, UI_STRINGS_EN.dialog.feedback],
  [UI_STRINGS_KO.readAloud, UI_STRINGS_EN.readAloud],
  [UI_STRINGS_KO.review, UI_STRINGS_EN.review]
];

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Placeholder values of `ko` when it is `tpl` filled in, else null. */
function fillOf(tpl: string, ko: string): Record<string, string> | null {
  const names: string[] = [];
  const re = tpl
    .split(/(\{\w+\})/)
    .map((part) => {
      const m = /^\{(\w+)\}$/.exec(part);
      if (!m) return escapeRe(part);
      names.push(m[1]!);
      return '(.+?)';
    })
    .join('');
  const hit = new RegExp(`^${re}$`, 's').exec(ko);
  if (!hit) return null;
  return Object.fromEntries(names.map((n, i) => [n, hit[i + 1]!]));
}

/**
 * The English line for a Korean feedback line (the server and the grader answer `feedback_ko`): same key in the same
 * section, placeholders carried over ({p} as said, {when} / {kind} turned into English, numbers as they are). Exact
 * lines are matched before templates. Null when the line is not one of the tables' (then the Korean one stays).
 */
export function feedbackEnFromKo(ko: string): string | null {
  const templated: Array<[string, string]> = [];
  for (const [KO, EN] of FEEDBACK_TABLES) {
    for (const [k, v] of Object.entries(KO)) {
      const en = EN[k];
      if (typeof v !== 'string' || typeof en !== 'string') continue;
      if (v === ko) return en;
      if (/\{\w+\}/.test(v)) templated.push([v, en]);
    }
  }
  for (const [v, en] of templated) {
    const fill = fillOf(v, ko);
    if (!fill) continue;
    return en.replace(/\{(\w+)\}/g, (all, n: string) => (n in fill ? (FEEDBACK_VALUE_EN[fill[n]!] ?? fill[n]!) : all));
  }
  return null;
}
