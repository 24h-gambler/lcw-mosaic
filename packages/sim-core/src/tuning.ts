export const TUNING = {
  world: {
    sizeX: 288,
    sizeZ: 288,
    chunkSize: 16,
    chunksX: 18,
    chunksZ: 18,
    sectorSize: 96,
    sectorChunks: 6,
    yMin: -400,
    yMax: 1000,
    dayDurationSec: 24 * 60, // 24 real-time minutes = 1 game day
    maxMultiPlayers: 8,
    spawn: [144, 1, 144] as readonly [number, number, number],
    walkSpeedMps: 4.5,
    sprintSpeedMps: 6.8
  },
  verticalBands: [
    { id: 'deep_space', minY: 600, maxY: 1000, gravity: 0.05, hasOxygen: false, hasHeat: false, windForce: 0 },
    { id: 'space_station', minY: 300, maxY: 599, gravity: 0.2, hasOxygen: false, hasHeat: false, windForce: 0 },
    { id: 'sky_island', minY: 80, maxY: 299, gravity: 1.0, hasOxygen: true, hasHeat: false, windForce: 1.5 },
    { id: 'surface', minY: -8, maxY: 79, gravity: 1.0, hasOxygen: true, hasHeat: false, windForce: 0 },
    { id: 'mine', minY: -150, maxY: -9, gravity: 1.0, hasOxygen: true, hasHeat: false, windForce: 0 },
    { id: 'deep_core', minY: -400, maxY: -151, gravity: 1.0, hasOxygen: true, hasHeat: true, windForce: 0 }
  ] as const,
  character: {
    headVoxels: [10, 10, 10] as const,
    bodyVoxels: [8, 9, 5] as const,
    armVoxels: [3, 9, 3] as const,
    legVoxels: [4, 8, 4] as const,
    totalHeightVoxels: 27,
    collisionBoxMeters: [0.6, 1.8, 0.6] as const
  },
  gauges: {
    spawnStartPct: 45,
    lowThresholdPct: 20,
    hungerDecayPerSec: 100 / (20 * 60),
    thirstDecayPerSec: 100 / (14 * 60),
    tempDecayPerSecNoGear: 100 / 90,
    heatDecayPerSecNoGear: 100 / 60,
    oxygenDecayPerSecNoGear: 100 / 30,
    hungerLowSpeedMult: 0.85,
    thirstLowSpeedMult: 0.7,
    tempLowSpeedMult: 0.6,
    breadRestore: 35,
    smoothieRestore: 50,
    waterRestore: 30,
    warmDrinkGraceSec: 300
  },
  building: {
    maxReachMeters: 5,
    maxPlacePerSec: 4,
    undoHistoryMax: 20,
    roomMaxVolume: 400,
    roomMinVolume: 18,
    roomMinCeiling: 2
  },
  economy: {
    errandRewardCoins: 50,
    starDiscount: { 1: 0, 2: 0.2, 3: 0.5 } as Record<1 | 2 | 3, number>,
    hintBonusRate: { full: 0, keyword: 0.05, initial: 0.05, picture: 0.1, none: 0.1 } as Record<
      string,
      number
    >,
    marketIndexMin: 0.8,
    marketIndexMax: 1.25,
    repairNonReviewPct: 0.1,
    /** docs/09 P7: weekly price-index step cap, applied per world (never server-wide). */
    priceIndexWeeklyStepMax: 0.05,
    /** docs/03 D13: read-aloud discount on a furniture kind, once per kind per day per player. */
    readAloudDiscountPct: 0.1,
    /** Day boundary for once-per-day rules: KST midnight (UTC+9). */
    dayBoundaryOffsetMs: 9 * 60 * 60 * 1000
  },
  /** docs/03 D2: separate item IDs. A bundle is its own SKU, never a discount on the parts. */
  equipment: {
    dynamite_x5: { basePrice: 150, threeStarPrice: 75 },
    drill: { basePrice: 350, threeStarPrice: 175 },
    drill_bundle: {
      basePrice: 500,
      threeStarPrice: 250,
      contains: ['drill', 'dynamite_x5'] as readonly string[]
    }
  } as Record<string, { basePrice: number; threeStarPrice: number; contains?: readonly string[] }>,
  mining: {
    ores: {
      coal: { price: 4, requiredToolTier: 1, minY: -60, maxY: -9 },
      iron: { price: 10, requiredToolTier: 1, minY: -90, maxY: -20 },
      gold: { price: 35, requiredToolTier: 2, minY: -130, maxY: -60 },
      ruby: { price: 50, requiredToolTier: 2, minY: -130, maxY: -50 },
      diamond: { price: 90, requiredToolTier: 3, minY: -150, maxY: -100 },
      nether_crystal: { price: 220, requiredToolTier: 4, minY: -400, maxY: -151 },
      void_shard: { price: 600, requiredToolTier: 4, minY: 1000, maxY: 600 }
    } as Record<string, { price: number; requiredToolTier: number; minY: number; maxY: number }>
  },
  career: {
    ranks: {
      intern: { dailyPay: 400, nextRank: 'staff', promoDaysRequired: 3 },
      staff: { dailyPay: 700, nextRank: 'manager', promoThreeStarCustomers: 5 },
      manager: { dailyPay: 1200, nextRank: 'director', promoOnTimeDays: 5 },
      director: { dailyPay: 2000, nextRank: null, promoNegotiations: 3 }
    }
  },
  court: {
    finePct: 0.4,
    fineMin: 200,
    fineMax: 3000,
    oneStarFineFactor: 0.5,
    communityServiceReward: 100,
    repeatFineStep: 0.5,
    lockExplosivesAtOffenses: 3
  },
  lottery: {
    ticketPrice: 100,
    maxTicketsPerGameDay: 3,
    prizes: [
      { rank: 1, coins: 5000, probsByStars: { 1: 0.001, 2: 0.002, 3: 0.003 } },
      { rank: 2, coins: 3000, probsByStars: { 1: 0.005, 2: 0.01, 3: 0.015 } },
      { rank: 3, coins: 300, probsByStars: { 1: 0.06, 2: 0.12, 3: 0.18 } },
      { rank: 4, coins: 100, probsByStars: { 1: 0.25, 2: 0.25, 3: 0.25 } }
    ] as const
  },
  memory: {
    intervalsMs: [
      20 * 60 * 1000, // 20 minutes
      1 * 24 * 60 * 60 * 1000, // 1 day
      3 * 24 * 60 * 60 * 1000, // 3 days
      7 * 24 * 60 * 60 * 1000, // 7 days
      16 * 24 * 60 * 60 * 1000, // 16 days
      35 * 24 * 60 * 60 * 1000 // 35 days -> master
    ] as const,
    maxDuePerSession: 3,
    /** docs/09 P4: gear equipped/socketed or used within this window gets review signs first. */
    activeGearWindowMs: 7 * 24 * 60 * 60 * 1000,
    activeGearPriorityBonus: 10,
    masterBonusCoins: 200,
    /**
     * docs/03 D8 table, by the box being reviewed (20 min, 1 d, 3 d, 7 d, 16 d, 35 d): pass line of the review.
     * The 16-day review also accepts another bank sentence for the same thing (same meaning, other words).
     */
    reviewPassThreshold: [0.7, 0.7, 0.7, 0.65, 0.6, 0.6] as const,
    /** docs/03 D8: the 20-minute review may play the sentence; from the 1-day review on it is shown without voice. */
    reviewListenMaxBox: 0,
    /** docs/03 D8: only sentences passed with at least this many stars become memory cards. */
    cardMinStars: 2
  },
  combat: {
    playerMaxHp: 20,
    weapons: {
      hand: 1,
      wood_sword: 3,
      iron_sword: 5,
      diamond_sword: 7,
      bow: 4,
      wand: 2
    } as Record<string, number>,
    enemies: {
      slime: { hp: 8, damage: 2, dropCoins: 5, band: 'surface' },
      bat: { hp: 6, damage: 1, dropCoins: 8, band: 'mine' },
      scorpion: { hp: 16, damage: 3, dropCoins: 18, band: 'mine' },
      ice_golem: { hp: 40, damage: 4, dropCoins: 45, band: 'mine' },
      lava_spirit: { hp: 60, damage: 5, dropCoins: 80, band: 'deep_core' },
      cloud_jellyfish: { hp: 20, damage: 3, dropCoins: 30, band: 'sky_island' },
      broken_drone: { hp: 30, damage: 4, dropCoins: 55, band: 'space_station' },
      void_fragment: { hp: 80, damage: 6, dropCoins: 150, band: 'deep_space' }
    } as Record<string, { hp: number; damage: number; dropCoins: number; band: string }>,
    voiceSkillMultiplier: { word: 1.0, phrase: 1.5, sentence: 2.5 } as const,
    voiceSkillCooldownSec: 8,
    wandSkillBonus: 1.5,
    hospitalFeePct: 0.05,
    hospitalFeeMax: 100,
    dizzyDurationSec: 30,
    dizzySpeedMult: 0.7
  },
  trade: {
    feeRateByStars: { 1: 0.1, 2: 0.05, 3: 0 } as Record<1 | 2 | 3, number>
  },
  levelLadder: {
    windowSize: 20,
    promoteThreeStarPassRatio: 0.7,
    demoteFailRatio: 0.4
  }
} as const;
