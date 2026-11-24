export const TUNING = {
  world: {
    sizeX: 288,
    sizeZ: 288,
    chunkSize: 16,
    chunksX: 18,
    chunksZ: 18,
    sectorSize: 96,
    sectorChunks: 6,
    /**
     * R2861① (Dan "끝없이 파고 짓기"): the open world. sizeX/Z stay the town map (288 m, the sectors, the minimap);
     * the land goes on past it to openMin..openMax (x and z, the end exclusive: 60 km across, natural.ts) and down to
     * the bedrock floor at yMin.
     */
    openMin: 144 - 30000,
    openMax: 144 + 30000,
    yMin: -2048,
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
    { id: 'deep_core', minY: -2048, maxY: -151, gravity: 1.0, hasOxygen: true, hasHeat: true, windForce: 0 }
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
    warmDrinkGraceSec: 300,
    /**
     * R325 (Dan 11-19): health and warmth next to hunger and thirst, in the icon rows over the hotbar. No death
     * (docs/03 D1): an empty health bar sends the child back to the square to rest. Health falls only while a gauge
     * is empty or after a long fall, and comes back by itself while fed, watered and warm.
     */
    healthStartPct: 100,
    /** per empty gauge (hunger, thirst or warmth at 0): 100 -> 0 in 10 minutes (a slow nudge, not a race: docs/03 D1) */
    emptyGaugeHealthPerSec: 100 / (10 * 60),
    /** fed, watered and warm (each at least regenMinPct): 0 -> 100 in 5 minutes */
    healthRegenPerSec: 100 / (5 * 60),
    regenMinPct: 50,
    healthLowSpeedMult: 0.8,
    /** what eating gives back to health on top of hunger */
    foodHealthRestore: 10,
    /** a fall longer than this (m) costs fallHealthPerMeter for each metre past it */
    fallSafeMeters: 4,
    fallHealthPerMeter: 8,
    /** R326 play fighting: health one hit takes (ten hits from full knock a child out: back at the square, never death) */
    pvpHitDamage: 10,
    /** how hard a hit pushes (m/s along the ground, and up) */
    pvpKnockback: 7,
    pvpKnockUp: 4,
    /** after a knock-out rest, hits do nothing for this long (ms) */
    pvpRestShieldMs: 4000,
    /** R326 drinking from water (a pond, a fountain, the river): thirst per sip, one sip per waterSipMs, no limit */
    waterSipRestore: 12,
    waterSipMs: 700,
    /** after the rest at the square: health back to this, hunger and thirst at least restMinPct, warm again */
    restHealthPct: 60,
    restMinPct: 60,
    /** a winter world outdoors (no roof over the head) or standing on snow or ice: 100 -> 0 in 6 minutes */
    winterTempMult: 0.25,
    /** warming up out of the cold: 0 -> 100 in 40 s; next to a fire (torch, lantern) in 12 s */
    tempRecoverPerSec: 100 / 40,
    fireTempPerSec: 100 / 12,
    /** blocks from the body a torch or a lantern warms */
    fireRadius: 3,
    warmDrinkRestore: 40
  },
  building: {
    maxReachMeters: 5,
    maxPlacePerSec: 4,
    undoHistoryMax: 20,
    roomMaxVolume: 400,
    roomMinVolume: 18,
    roomMinCeiling: 2,
    /**
     * R326 free build (docs/03 D13 자유 건축), R2861① endless: a child digs down to the layer over the bedrock floor
     * (the ground goes on under the town, natural.ts) and builds up to the top of the world.
     */
    freeMinY: -2048 + 1,
    freeMaxY: 1000,
    /**
     * Cells outside the plot that may differ from the town at once in one world (placed or dug). Bounds the server's
     * per-world delta (~2.5 MB at the cap, apps/edge/src/plot.ts) and the snapshot a device loads (~750 KB of JSON).
     * R2861①: 50 000 (was 20 000) — a shaft to -2047 is ~4 000 cells, a lesson of free digging stays far under it.
     */
    freeMaxCells: 50000,
    /**
     * R326 block relay through the room ('b', sim-core room.ts): what one frame may carry (the room refuses more),
     * what a device puts in one frame (under the 512-byte message cap), how long it gathers a burst, how many cells
     * at most a flush sends (2 frames each 150 ms = 13/s beside 10 poses/s, under the room's 30/s close), how many held
     * cells wait at most (the rest the others see at their next read), and how many cells others may draw into my view
     * before my next server read (a forged relay from someone who learned my world tag cannot fill my cap); reaching it
     * reads the plot again, at most once per remoteRefreshMinMs.
     */
    relay: { frameCells: 16, frameFurniture: 4, sendCells: 12, sendFurniture: 2, holdMs: 150, framesPerFlush: 2, resyncCellsMax: 512, remoteCellsMax: 2000, remoteRefreshMinMs: 30000 }
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
  },
  /**
   * Multi room (docs/03 D11 "멀티 월드 정원 8명", docs/02 §4·§11 measured capacity). One WorldRoomDO per room relays
   * poses; the server refuses the (capacity + 1)th player with `room_full`.
   */
  multi: {
    roomCapacity: 8,
    /**
     * Client pose sends per second while moving (docs/02 §11: 5 keeps a 2-hour lesson of two people under the free
     * 100k DO requests even if every received message counts as one). Checked poseTickHz times a second so a start,
     * stop or jump goes out at once; nothing is sent while standing still or while alone in the room.
     */
    poseHz: 10,
    poseTickHz: 20,
    /**
     * Pose budget per sender (docs/02 §11.3, operator 11-16 "8명이 2시간 걸어도 하루 10만 요청 안"): a pose goes out
     * only when the receivers' prediction (last pose + velocity × age) is off by more than poseErrM (poseErrFarM when
     * nobody is within poseNearM), the yaw by more than poseYawRad (far: poseYawFarRad), the animation changed, or
     * poseRefreshMs passed while moving; and never faster than a token bucket of poseBurst refilled poseBudgetHz a
     * second. 8 people × 2 h × 1.2 = 69,120 messages at the very worst (turning all the time), under 100k with the
     * platform's own requests. Receivers stop extrapolating after poseHorizonMs (a frozen tab does not walk away).
     */
    poseBudgetHz: 1.2,
    poseBurst: 3,
    poseErrM: 0.3,
    poseErrFarM: 1.0,
    poseYawRad: 0.35,
    poseYawFarRad: 0.8,
    poseNearM: 24,
    poseRefreshMs: 3000,
    poseHorizonMs: 4000,
    /** fastest ground speed a pose may carry (m/s; running is ~6) */
    maxPoseSpeed: 20,
    /** plain "ping" keep-alive (answered by the platform without waking the room) */
    idleKeepaliveMs: 5000,
    /** the room sends changed poses at once, then at most one batch per broadcastMs per socket */
    broadcastMs: 50,
    /** messages a socket may send in one second before it is closed (pose 10 + ping + emote, with slack) */
    maxMsgPerSec: 30,
    maxMsgBytes: 512,
    /** a socket that sent nothing for this long is dropped (the keep-alive is every 5 s) */
    silentDropMs: 20000,
    ticketTtlMs: 60000,
    /** |x|, |y|, |z| bound for a relayed pose (R2861①: the open world is 60 km across and 2 km deep, natural.ts) */
    coordLimit: 32768,
    emotes: ['wave', 'clap', 'cheer', 'jump'] as readonly string[],
    /** R326: how far the crosshair picks a friend to hit or trade with (m, from the feet; the room allows hitReachM) */
    hitPickM: 3.5,
    /** R326: a hit lands on one child at most once per this long, however many hit (no pile-on knock-out) */
    hitTakenGapMs: 500,
    /** R326: a hit only lands between children this close in height (m: a child on a roof cannot hit one below) */
    hitHeightM: 3,
    /** R326: a touch held this long and still on a classmate opens the trade (a short tap hits) */
    tradeHoldMs: 600,
    /** R326: after the pointer locks, "Esc frees the mouse" shows this long under the crosshair */
    escHintMs: 4000,
    /** R326: water and the shop counter answer the crosshair this far from the feet (m), along a ray of rayM */
    useReachM: 4.5,
    useRayM: 6,
    /** R326 play fighting: how far a hit reaches (m, between the two last poses: poses lag, so a little over arm's length) */
    hitReachM: 4.5,
    /** at most one hit per this long from one player */
    hitCooldownMs: 400
  }
} as const;
