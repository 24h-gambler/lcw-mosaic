import { AUDIO_LIMITS } from '@lcw/audio';

/** Every number of the adventure in one place (AGENTS 4.10, docs/22 4장). */
export const ADV = {
  /** Logical screen (the canvas draws at an integer multiple of this). */
  screen: { w: 320, h: 240 },
  tile: 16,
  stepHz: 60,
  /** Longest real time one frame may advance (a hidden tab must not jump the bullets). */
  maxFrameMs: 100,
  player: { speed: 72, hitW: 10, hitH: 8 },
  soul: { speed: 96, size: 8, hitRadius: 3, invulnMs: 1000 },
  hp: { max: 20 },
  /**
   * Calm needed to befriend. R2734 (Dan 11-19: "the boss is too easy"): a guardian takes four perfect talks (three of
   * its turns between them, each stage fiercer), the Hushwind six — a child who never dodges runs out of voice
   * (adventure-difficulty.test.ts measures it).
   */
  calmMax: { critter: 50, guardian: 240, final: 320 },
  /** Calm one TALK gives by stars (0 = not yet). */
  calmByStars: [5, 35, 45, 60] as const,
  /** ✅ pick replies cap at 2 stars (choosing is easier than saying). */
  pickStarCap: 2 as const,
  grumpMax: { critter: 30, guardian: 80, final: 100 },
  /** POKE damage at a perfect hit; scaled by accuracy (min 30%). */
  pokeDamage: 22,
  pokeRingMs: 1400,
  /** Enemy turn length (seconds). */
  turnSec: { critter: [5, 6] as const, guardian: [7, 9] as const, final: [8, 10] as const },
  damage: { hurt: 3, wrongCatch: 2 },
  catchCalm: { letter: 4, word: 15, bubble: 10, cookie: 10 },
  /** After the soul runs out of voice: same encounter again, bullets slower (docs/22 4장). */
  retrySlow: 0.8,
  /** Score → stars (scoreUtterance score; pass is the level threshold). */
  stars: { three: 0.9, two: 0.75 },
  /** Chapter stars: spoken lines with 2+ stars needed for 3 stars. */
  chapterThreeStarSpoken: 3,
  items: {
    honeyDrop: { heal: 10, startCount: 2 },
    berryBun: { heal: 20, startCount: 1 },
    starTea: { heal: 99, startCount: 0 },
    /** Most of one thing the pouch holds. */
    maxEach: 9
  },
  /** R2734 coins: found in chests and quizzes, given by new friends; spent at Tumble's cart (never money). */
  coins: { max: 999, critterFriend: 6, guardianFriend: 12, stoneLit: 2 },
  /** What Tumble's gear does. */
  gear: { coatBlock: 1, scarfHp: 6, lanternCalm: 1.25 },
  /** SKILL (R2734): magic words said or picked, once per meeting each. */
  skill: { heal: 12, sparkCalm: 0.3, shieldFactor: 0.5, slowFactor: 0.6 },
  /** A guardian met again after running out of voice: bullets slower by `step` per try, never below `floor`. */
  retry: { step: 0.1, floor: 0.7 },
  /** Neural line must arrive by then, else the device voice reads it. */
  voiceWaitMs: 1500,
  /** Text box typing speed (characters per second). */
  textCps: 45,
  /** docs/08 MOTION_TOKENS: no more than 3 flashes a second, shake ≤ 0.3° / 300 ms (we shake by pixels ≤ 2). */
  hitFlashMs: 340,
  /** The voice bubble's blink after a hit (on-off cycles a second, ≤ 3). */
  hitBlinkHz: 2.5,
  shakePx: 2,
  shakeMs: 240,
  /** Result POST at a chapter end: first try, then two retries after these waits (docs/22 3장). */
  resultRetryMs: [0, 1500, 4000],
  /** Longest wait for the day file and the server progress before the islands open anyway. */
  bootWaitMs: 4000,
  /** Days around today (KST) the document takes an envelope for. */
  envelopeDays: { before: 10, after: 2 },
  /** What one play may hold (english-day contract v1 limits). */
  recordMax: { lines: 60, words: 60, text: 300, activities: 50 },
  /** Solid boxes on the island (pixels): critters fill their three-tile gate, the guardian is big, the rest small. */
  entityBox: { small: { w: 14, h: 12 }, critter: { w: 14, h: 44, below: 14 }, guardian: { w: 28, h: 40 } },
  /** The server settings row's key limit (docs/19 3장). */
  settingsMaxKeys: 40,
  /**
   * The 🎤 turn on the server Whisper path (docs/22 1.3, the same /v1/converse/stt as the LCW dialog): it ends
   * `silenceStopMs` after the child's voice stops (the LCW dialog's own value: L2 children pause 1.0-1.8 s mid-clause,
   * @lcw/audio), or when nobody spoke for `noVoiceMs`, and never runs past `maxMs`.
   */
  listen: { silenceStopMs: AUDIO_LIMITS.DIALOG_MIC_AUTO_STOP_SILENCE_MS, noVoiceMs: 7000, maxMs: 20000 },
  /** In a lesson: how often the adventure tells the lesson it is still here (audio/presence.ts; the lesson closes after 15 idle minutes). */
  lessonPingMs: 60_000,
  /** A class code is 6 digits (edge makeJoinCode). */
  joinCodeDigits: 6
} as const;

export type CreatureClass = 'critter' | 'guardian' | 'final';
