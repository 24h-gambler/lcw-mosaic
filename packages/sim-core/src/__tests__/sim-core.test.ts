import { describe, expect, it } from 'vitest';
import {
  calculateTradeSettlement,
  canMineOre,
  computeAttackDamage,
  computeOfferPrice,
  createInitialPlayerState,
  CubicChunk,
  equipToSocket,
  evaluateLevelAdjustment,
  evaluateMentorDungeonGate,
  evaluateRoom,
  generateWorldLayout,
  getDueCardsForSession,
  getVerticalBandAtY,
  greedyMeshChunk,
  hashWorldLayout,
  Ledger,
  LessonProgressionTracker,
  placeBlockSingleInput,
  populateInitialWorld,
  propagateBlockLight,
  resolveCourtVerdict,
  reviewMemoryCard,
  simulateLotteryMonteCarlo,
  stepGauges,
  tickCareerClock,
  toggleMirrorCamera,
  toggleThirdPersonCamera,
  TUNING,
  undoLastBlock,
  useSelectedSlot,
  VoxelWorld
} from '../index.js';
import { scanSourceForDirectChunkWrite } from '../../../../tools/lint-invariants.mjs';
import { timeRuns } from '../../../../tools/timing.mjs';

describe('@lcw/sim-core acceptance tests', () => {
  it('WP-101 & WP-208: meshes a populated chunk in <4ms and propagates torch light in <8ms', () => {
    const world = new VoxelWorld();
    const actor = { id: 'test-gen', isSystemGen: true };
    for (let x = 0; x < 16; x++) {
      for (let z = 0; z < 16; z++) {
        for (let y = 0; y < 8; y++) {
          world.setBlock(actor, x, y, z, y === 7 ? 3 : 1);
        }
      }
    }
    const chunk = world.getOrCreateChunk(0, 0, 0);
    expect(greedyMeshChunk(chunk).quadCount).toBeGreaterThan(0);
    // warmed up, best of 9: the WP-101 budget (4 ms) on the fastest run, a loose guard on the median for a busy PC
    const mesh = timeRuns(() => greedyMeshChunk(chunk));
    expect(mesh.min).toBeLessThan(4);
    expect(mesh.median).toBeLessThan(15);

    const light = timeRuns(() => propagateBlockLight(chunk, [{ lx: 8, ly: 8, lz: 8, level: 14 }]));
    expect(chunk.getLight(8, 8, 8)).toBe(14);
    expect(chunk.getLight(9, 8, 8)).toBe(13);
    expect(light.min).toBeLessThan(8);
    expect(light.median).toBeLessThan(30);
  });

  it('WP-401: generates 100 deterministic seeds with all 4 required services and identical hashes', () => {
    for (let s = 1; s <= 100; s++) {
      const a = generateWorldLayout(`seed_${s}`, 1);
      const b = generateWorldLayout(`seed_${s}`, 1);
      expect(hashWorldLayout(a)).toBe(hashWorldLayout(b));

      const services = new Set(a.prefabs.map((p) => p.service).filter(Boolean));
      expect(services.has('cafe')).toBe(true);
      expect(services.has('boutique')).toBe(true);
      expect(services.has('makers_lab')).toBe(true);
      expect(services.has('exchange')).toBe(true);
    }
  });

  it('WP-102: populates Central Plaza and London Cafe connected by protected road', () => {
    // the legacy sector demo on a bare grid (R2861① the game world is natural ground, natural.ts)
    const world = new VoxelWorld(undefined, { natural: false });
    populateInitialWorld(world, 'london_demo', 1);
    // Spawn (144, 0, 144) down to cafe entrance (144, 0, 48) is road (block 5)
    for (let z = 48; z <= 144; z++) {
      expect(world.getBlock(144, 0, z)).toBe(5);
    }
    expect(world.getBlock(148, 1, 48)).toBe(0); // cafe door opening
  });

  it('WP-103 & WP-104: toggles F5/Tab cameras, attaches sockets, and decays gauges at D1 rates', () => {
    const p = createInitialPlayerState('p1');
    expect(p.gauges.hunger).toBe(45);
    expect(p.gauges.thirst).toBe(45);

    expect(toggleThirdPersonCamera(p)).toBe('third_person');
    expect(toggleMirrorCamera(p)).toBe('mirror');
    equipToSocket(p, 'Back_Socket', 'item_jetpack_01');
    expect(p.sockets.Back_Socket).toBe('item_jetpack_01');

    // Decay thirst below 20%
    const res = stepGauges(p, 400, {});
    expect(p.gauges.thirst).toBeLessThanOrEqual(20);
    expect(res.speedMultiplier).toBe(TUNING.gauges.thirstLowSpeedMult); // 0.70

    p.hotbar[0] = { itemId: 'berry_smoothie', name: 'Smoothie', kind: 'drink', count: 1 };
    useSelectedSlot(p);
    expect(p.gauges.thirst).toBeGreaterThan(20);
  });

  it('WP-201 & WP-202: enforces 4 blocks/sec, Z undo, and lint fails on direct chunk writes', () => {
    const world = new VoxelWorld();
    const p = createInitialPlayerState('p1');
    p.x = 110.5;
    p.y = 1;
    p.z = 170.5; // inside player plot

    // Protected core rejection
    expect(placeBlockSingleInput(world, p, 144, 1, 144, 4, 1000).ok).toBe(false);

    // 4 blocks per sec accepted, 5th rejected (within 5m reach from x=110.5, y=1, z=170.5)
    for (let i = 0; i < 4; i++) {
      expect(placeBlockSingleInput(world, p, 111 + i, 1, 170, 4, 1000 + i * 10).ok).toBe(true);
    }
    expect(placeBlockSingleInput(world, p, 114, 2, 170, 4, 1050).reason).toBe('rate_limit');

    // Z undo
    expect(undoLastBlock(world, p).ok).toBe(true);
    expect(world.getBlock(114, 1, 170)).toBe(0);

    // WP-202 fault-injection on linter
    const illegalWrite = 'chunk.' + 'voxels[0] = 5;';
    const violations = scanSourceForDirectChunkWrite(
      `export function bypass(chunk: any) { ${illegalWrite} }`,
      'packages/sim-core/src/cheat.ts'
    );
    expect(violations.length).toBeGreaterThan(0);
  });

  it('WP-404, WP-405, WP-406, WP-407, WP-408: verifies mining, ledger, 35-day review, career, and court', () => {
    expect(canMineOre('gold', 1)).toBe(false);
    expect(canMineOre('gold', 2)).toBe(true);

    const ledger = new Ledger();
    ledger.record('p1', 1000, 'init', 'r0', 0);
    const { finalPrice, hintRefund } = computeOfferPrice({
      basePrice: 2000,
      stars: 3,
      hintLevel: 'none'
    });
    expect(finalPrice).toBe(1000);
    expect(hintRefund).toBe(100);
    ledger.record('p1', -finalPrice + hintRefund, 'order', 'd1', 10);
    expect(ledger.getBalance('p1')).toBe(100);

    // 35-day spaced repetition acceleration
    let card = {
      id: 'mc_1',
      itemId: 'itm_1',
      box: 0,
      nextReviewAtMs: 0,
      lapses: 0,
      masteredAtMs: null as number | null
    };
    let t = 0;
    for (let step = 0; step < 6; step++) {
      const due = getDueCardsForSession([card], t);
      expect(due).toHaveLength(1);
      card = reviewMemoryCard(card, true, t);
      t = card.nextReviewAtMs;
    }
    expect(card.masteredAtMs).not.toBeNull();

    // Career online-only clock
    const career = { rank: 'intern' as const, daysWorked: 0, activePlayTimeSec: 0, isOnline: false };
    tickCareerClock(career, 3600);
    expect(career.activePlayTimeSec).toBe(0);
    career.isOnline = true;
    tickCareerClock(career, 120);
    expect(career.activePlayTimeSec).toBe(120);

    // Court verdict
    expect(resolveCourtVerdict({ balance: 2000, choice: 'plea', pleaStars: 3, offensesToday: 1 }).outcome).toBe(
      'acquitted'
    );
  });

  it('WP-409: 1,000,000-trial lottery simulation matches expected values 63 / 101 / 139', () => {
    const ev1 = simulateLotteryMonteCarlo(1, 1_000_000, 11);
    const ev2 = simulateLotteryMonteCarlo(2, 1_000_000, 22);
    const ev3 = simulateLotteryMonteCarlo(3, 1_000_000, 33);
    expect(ev1).toBeGreaterThan(61);
    expect(ev1).toBeLessThan(65);
    expect(ev2).toBeGreaterThan(99);
    expect(ev2).toBeLessThan(103);
    expect(ev3).toBeGreaterThan(136);
    expect(ev3).toBeLessThan(142);
  });

  it('WP-507, WP-607, WP-608: checks combat table, 400-block room flood-fill, and vertical bands', () => {
    expect(computeAttackDamage({ weaponId: 'diamond_sword', targetArmorSum: 3 })).toBe(4);
    expect(computeAttackDamage({ weaponId: 'wand', targetArmorSum: 0, voiceSkillGrade: 'sentence' })).toBe(8);

    // Build an enclosed 4x3x4 = 48 inner volume room inside plot (x: 100..105, y: 1..5, z: 160..165)
    const world = new VoxelWorld();
    const owner = { id: 'owner', isOwner: true };
    for (let x = 100; x <= 105; x++) {
      for (let z = 160; z <= 165; z++) {
        for (let y = 0; y <= 4; y++) {
          const wall = x === 100 || x === 105 || z === 160 || z === 165 || y === 0 || y === 4;
          if (wall) {
            const isDoor = x === 100 && z === 162 && (y === 1 || y === 2);
            world.setBlock(owner, x, y, z, isDoor ? 23 : 4);
          }
        }
      }
    }

    // Missing light initially
    const missingLight = evaluateRoom(world, { x: 102, y: 1, z: 162 }, [
      { id: 'furn_bed_single', x: 101, y: 1, z: 161 },
      { id: 'furn_table_dining', x: 102, y: 1, z: 161 },
      { id: 'job_stove', x: 103, y: 1, z: 161 }
    ]);
    expect(missingLight.valid).toBe(false);
    expect(missingLight.promptSentence).toBe('This room needs a light source.');

    // Add torch -> valid & Chef Leo moves in
    world.setBlock(owner, 102, 2, 161, 26);
    const complete = evaluateRoom(world, { x: 102, y: 1, z: 162 }, [
      { id: 'furn_bed_single', x: 101, y: 1, z: 161 },
      { id: 'furn_table_dining', x: 102, y: 1, z: 161 },
      { id: 'job_stove', x: 103, y: 1, z: 161 }
    ]);
    expect(complete.valid).toBe(true);
    expect(complete.eligibleResident?.id).toBe('res_chef');

    // Vertical band transitions
    expect(getVerticalBandAtY(400).gravity).toBe(0.2);
    expect(getVerticalBandAtY(400).hasOxygen).toBe(false);
    expect(getVerticalBandAtY(-200).hasHeat).toBe(true);
  });

  it('WP-311, WP-410, WP-509: verifies bilateral trade settlement, mentor dungeon gate, level ladder, and 7-stage continuous lesson tracker', () => {
    // WP-509: bilateral barter settlement requires both teacher and student speech
    const blocked = calculateTradeSettlement({
      baseValueCoins: 100,
      stars: 3,
      teacherSpoken: true,
      studentSpoken: false,
      studentPassed: true,
      studentCoins: 100
    });
    expect(blocked.settled).toBe(false);
    expect(blocked.reason).toBe('bilateral_utterance_required');

    const star1 = calculateTradeSettlement({
      baseValueCoins: 100,
      stars: 1,
      teacherSpoken: true,
      studentSpoken: true,
      studentPassed: true,
      studentCoins: 100
    });
    expect(star1.settled).toBe(true);
    expect(star1.feeCoins).toBe(10);
    expect(star1.bonusGranted).toBe(false);

    const star2 = calculateTradeSettlement({
      baseValueCoins: 100,
      stars: 2,
      teacherSpoken: true,
      studentSpoken: true,
      studentPassed: true,
      studentCoins: 100
    });
    expect(star2.settled).toBe(true);
    expect(star2.feeCoins).toBe(5);

    const star3 = calculateTradeSettlement({
      baseValueCoins: 100,
      stars: 3,
      teacherSpoken: true,
      studentSpoken: true,
      studentPassed: true,
      studentCoins: 100
    });
    expect(star3.settled).toBe(true);
    expect(star3.feeCoins).toBe(0);
    expect(star3.bonusGranted).toBe(true);

    // WP-311: Mentor Dungeon info-gap gate requires teacher clue AND student action
    const noClue = evaluateMentorDungeonGate({
      hazardCode: 'switch_maze_01',
      teacherPromptText: 'Look carefully around.',
      studentActionText: 'I pull the red lever.'
    });
    expect(noClue.gateOpened).toBe(false);
    expect(noClue.reason).toBe('teacher_clue_required');

    const noAction = evaluateMentorDungeonGate({
      hazardCode: 'switch_maze_01',
      teacherPromptText: 'Use the red lever first.',
      studentActionText: 'Okay.'
    });
    expect(noAction.gateOpened).toBe(false);
    expect(noAction.reason).toBe('student_action_required');

    const gateOpen = evaluateMentorDungeonGate({
      hazardCode: 'switch_maze_01',
      teacherPromptText: 'Pull the red lever beside the crystal bridge.',
      studentActionText: 'I will pull the red lever.'
    });
    expect(gateOpen.gateOpened).toBe(true);
    expect(gateOpen.synced).toBe(true);

    // WP-410: Level ladder rolling 20-attempt window & lock
    const locked = evaluateLevelAdjustment({
      currentLevel: 'L2',
      recentAttempts: Array.from({ length: 20 }, () => ({
        stars: 3 as const,
        firstTryPass: true,
        passed: true
      })),
      locked: true
    });
    expect(locked.changed).toBe(false);
    expect(locked.direction).toBe('stay');

    const promoted = evaluateLevelAdjustment({
      currentLevel: 'L2',
      recentAttempts: Array.from({ length: 20 }, (_, idx) => ({
        stars: (idx < 14 ? 3 : 2) as 1 | 2 | 3,
        firstTryPass: idx < 14,
        passed: true
      }))
    });
    expect(promoted.changed).toBe(true);
    expect(promoted.direction).toBe('up');
    expect(promoted.nextLevel).toBe('L3');

    const demoted = evaluateLevelAdjustment({
      currentLevel: 'L3',
      recentAttempts: Array.from({ length: 20 }, (_, idx) => ({
        stars: 1 as const,
        firstTryPass: false,
        passed: idx >= 8
      }))
    });
    expect(demoted.changed).toBe(true);
    expect(demoted.direction).toBe('down');
    expect(demoted.nextLevel).toBe('L2');

    // Continuous 7-stage lesson arc + sealed review chest loop
    const tracker = new LessonProgressionTracker();
    expect(tracker.getCurrentGuide().id).toBe('warmup_anchor');
    for (let i = 0; i < 6; i++) {
      tracker.completeCurrentStage(`step_${i + 1}`);
    }
    expect(tracker.getCurrentGuide().id).toBe('sealed_chest_campaign');
    tracker.completeCurrentStage('step_7');
    expect(tracker.getAllProgress().every((s) => s.status === 'completed')).toBe(true);

    tracker.plantSealedChest({
      id: 'chest_warm_tea',
      expression: 'Could I get two warm honey teas so that I can stay warm',
      rewardCoins: 30
    });
    expect(tracker.nextLessonTargets).toHaveLength(1);
    const unlockRes = tracker.unlockSealedChestByExpression(
      'Please give me two warm honey teas so that I can stay warm',
      1_763_250_000_000
    );
    expect(unlockRes.unlockedCount).toBe(1);
    expect(unlockRes.rewardCoins).toBe(30);
    expect(tracker.sealedChests[0]!.unlocked).toBe(true);
  });
});
