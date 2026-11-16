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
  /** Calm needed to befriend. */
  calmMax: { critter: 50, guardian: 150, final: 200 },
  /** Calm one TALK gives by stars (0 = not yet). */
  calmByStars: [5, 35, 45, 60] as const,
  /** ✅ pick replies cap at 2 stars (choosing is easier than saying). */
  pickStarCap: 2 as const,
  grumpMax: { critter: 30, guardian: 80, final: 100 },
  /** POKE damage at a perfect hit; scaled by accuracy (min 30%). */
  pokeDamage: 22,
  pokeRingMs: 1400,
  /** Enemy turn length (seconds). */
  turnSec: { critter: [5, 6] as const, guardian: [7, 9] as const },
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
    berryBun: { heal: 20, startCount: 1 }
  },
  /** Neural line must arrive by then, else the device voice reads it. */
  voiceWaitMs: 1500,
  /** Text box typing speed (characters per second). */
  textCps: 45,
  /** docs/08 MOTION_TOKENS: no more than 3 flashes a second, shake ≤ 0.3° / 300 ms (we shake by pixels ≤ 2). */
  hitFlashMs: 340,
  shakePx: 2,
  shakeMs: 240
} as const;

export type CreatureClass = 'critter' | 'guardian' | 'final';
