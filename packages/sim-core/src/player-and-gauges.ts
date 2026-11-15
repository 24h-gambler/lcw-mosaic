import { TUNING } from './tuning.js';
import { VoxelWorld } from './world.js';

export type CameraMode = 'first_person' | 'third_person' | 'mirror';

export type SocketName =
  | 'Head_Socket'
  | 'Body_Socket'
  | 'Back_Socket'
  | 'Feet_Socket'
  | 'RightHand_Socket'
  | 'Mount_Socket';

export interface HotbarItem {
  itemId: string;
  name: string;
  kind: 'food' | 'drink' | 'tool' | 'block' | 'explosive' | 'gear';
  count: number;
  blockId?: number;
  durability?: number;
}

export interface SurvivalGauges {
  hunger: number;
  thirst: number;
  temperature: number;
  heat: number;
  oxygen: number;
  hp: number;
  warmDrinkGraceSec: number;
}

export interface PlayerState {
  id: string;
  x: number;
  y: number;
  z: number;
  cameraMode: CameraMode;
  gauges: SurvivalGauges;
  sockets: Record<SocketName, string | null>;
  hotbar: [HotbarItem | null, HotbarItem | null, HotbarItem | null, HotbarItem | null, HotbarItem | null];
  selectedSlot: 0 | 1 | 2 | 3 | 4;
  homeChest: HotbarItem[];
  coins: number;
  lastPlaceTimesMs: number[];
  undoStack: Array<{ x: number; y: number; z: number; prevBlockId: number; placedBlockId: number }>;
}

export function createInitialPlayerState(id: string): PlayerState {
  return {
    id,
    x: TUNING.world.spawn[0] + 0.5,
    y: TUNING.world.spawn[1],
    z: TUNING.world.spawn[2] + 0.5,
    cameraMode: 'first_person',
    gauges: {
      hunger: TUNING.gauges.spawnStartPct,
      thirst: TUNING.gauges.spawnStartPct,
      temperature: 100,
      heat: 100,
      oxygen: 100,
      hp: TUNING.combat.playerMaxHp,
      warmDrinkGraceSec: 0
    },
    sockets: {
      Head_Socket: null,
      Body_Socket: null,
      Back_Socket: null,
      Feet_Socket: null,
      RightHand_Socket: null,
      Mount_Socket: null
    },
    hotbar: [null, null, null, null, null],
    selectedSlot: 0,
    homeChest: [],
    coins: 200,
    lastPlaceTimesMs: [],
    undoStack: []
  };
}

export function toggleThirdPersonCamera(player: PlayerState): CameraMode {
  player.cameraMode = player.cameraMode === 'third_person' ? 'first_person' : 'third_person';
  return player.cameraMode;
}

export function toggleMirrorCamera(player: PlayerState): CameraMode {
  player.cameraMode = player.cameraMode === 'mirror' ? 'first_person' : 'mirror';
  return player.cameraMode;
}

export function equipToSocket(player: PlayerState, socket: SocketName, itemId: string): void {
  player.sockets[socket] = itemId;
}

export function stepGauges(
  player: PlayerState,
  dtSec: number,
  env: {
    thirstMultiplier?: number;
    inColdSector?: boolean;
    inDeepCore?: boolean;
    aboveStationAltitude?: boolean;
  }
): { speedMultiplier: number; canSprint: boolean; rescuedToHospital: boolean; rescuedToAirlock: boolean } {
  const g = player.gauges;
  g.hunger = Math.max(0, g.hunger - TUNING.gauges.hungerDecayPerSec * dtSec);
  g.thirst = Math.max(
    0,
    g.thirst - TUNING.gauges.thirstDecayPerSec * (env.thirstMultiplier ?? 1) * dtSec
  );

  if (g.warmDrinkGraceSec > 0) {
    g.warmDrinkGraceSec = Math.max(0, g.warmDrinkGraceSec - dtSec);
  }

  const hasWinterCoat = player.sockets.Body_Socket?.includes('winter_coat') ?? false;
  if (env.inColdSector && !hasWinterCoat && g.warmDrinkGraceSec <= 0) {
    g.temperature = Math.max(0, g.temperature - TUNING.gauges.tempDecayPerSecNoGear * dtSec);
  } else {
    g.temperature = Math.min(100, g.temperature + dtSec * 4);
  }

  let rescuedToHospital = false;
  const hasHeatSuit = player.sockets.Body_Socket?.includes('heat_suit') ?? false;
  if (env.inDeepCore && !hasHeatSuit) {
    g.heat = Math.max(0, g.heat - TUNING.gauges.heatDecayPerSecNoGear * dtSec);
    if (g.heat <= TUNING.gauges.lowThresholdPct) {
      g.hp = Math.max(0, g.hp - dtSec * 1.5);
    }
    if (g.heat <= 0) {
      rescuedToHospital = true;
      g.heat = 100;
      g.hp = TUNING.combat.playerMaxHp;
      player.x = TUNING.world.spawn[0] + 0.5;
      player.y = TUNING.world.spawn[1];
      player.z = TUNING.world.spawn[2] + 0.5;
    }
  } else {
    g.heat = Math.min(100, g.heat + dtSec * 5);
  }

  let rescuedToAirlock = false;
  const hasSpaceSuit = player.sockets.Body_Socket?.includes('space_suit') ?? false;
  if (env.aboveStationAltitude && !hasSpaceSuit) {
    g.oxygen = Math.max(0, g.oxygen - TUNING.gauges.oxygenDecayPerSecNoGear * dtSec);
    if (g.oxygen <= 0) {
      rescuedToAirlock = true;
      g.oxygen = 100;
    }
  } else {
    g.oxygen = Math.min(100, g.oxygen + dtSec * 10);
  }

  let speedMultiplier = 1.0;
  if (g.hunger <= TUNING.gauges.lowThresholdPct) {
    speedMultiplier = Math.min(speedMultiplier, TUNING.gauges.hungerLowSpeedMult);
  }
  if (g.thirst <= TUNING.gauges.lowThresholdPct) {
    speedMultiplier = Math.min(speedMultiplier, TUNING.gauges.thirstLowSpeedMult);
  }
  if (g.temperature <= TUNING.gauges.lowThresholdPct) {
    speedMultiplier = Math.min(speedMultiplier, TUNING.gauges.tempLowSpeedMult);
  }

  const canSprint = g.hunger > 0 && g.thirst > 0;
  return { speedMultiplier, canSprint, rescuedToHospital, rescuedToAirlock };
}

export function useSelectedSlot(player: PlayerState): { used: boolean; effect?: string } {
  const item = player.hotbar[player.selectedSlot];
  if (!item || item.count <= 0) return { used: false };

  if (item.kind === 'food') {
    player.gauges.hunger = Math.min(100, player.gauges.hunger + TUNING.gauges.breadRestore);
    item.count--;
    if (item.count <= 0) player.hotbar[player.selectedSlot] = null;
    return { used: true, effect: 'hunger_restored' };
  }
  if (item.kind === 'drink') {
    const restore =
      item.itemId.includes('smoothie') ? TUNING.gauges.smoothieRestore : TUNING.gauges.waterRestore;
    player.gauges.thirst = Math.min(100, player.gauges.thirst + restore);
    if (item.itemId.includes('warm') || item.itemId.includes('hot') || item.itemId.includes('cocoa')) {
      player.gauges.warmDrinkGraceSec = TUNING.gauges.warmDrinkGraceSec;
    }
    item.count--;
    if (item.count <= 0) player.hotbar[player.selectedSlot] = null;
    return { used: true, effect: 'thirst_restored' };
  }
  return { used: true, effect: 'activated' };
}

export function placeBlockSingleInput(
  world: VoxelWorld,
  player: PlayerState,
  x: number,
  y: number,
  z: number,
  blockId: number,
  nowMs: number
): { ok: boolean; reason?: string } {
  const dist = Math.hypot(x + 0.5 - player.x, y + 0.5 - player.y, z + 0.5 - player.z);
  if (dist > TUNING.building.maxReachMeters) {
    return { ok: false, reason: '너무 멀어요' };
  }
  const px = Math.floor(player.x);
  const py = Math.floor(player.y);
  const pz = Math.floor(player.z);
  if (px === x && pz === z && (py === y || py + 1 === y)) {
    return { ok: false, reason: '누가 서 있어요' };
  }

  // Enforce 4 blocks/sec cap (WP-201)
  player.lastPlaceTimesMs = player.lastPlaceTimesMs.filter((t) => nowMs - t < 1000);
  if (player.lastPlaceTimesMs.length >= TUNING.building.maxPlacePerSec) {
    return { ok: false, reason: 'rate_limit' };
  }

  const prev = world.getBlock(x, y, z);
  if (prev !== 0) return { ok: false, reason: 'not_empty' };

  const res = world.setBlock({ id: player.id, isOwner: true }, x, y, z, blockId);
  if (!res.ok) return res;

  player.lastPlaceTimesMs.push(nowMs);
  player.undoStack.push({ x, y, z, prevBlockId: prev, placedBlockId: blockId });
  if (player.undoStack.length > TUNING.building.undoHistoryMax) {
    player.undoStack.shift();
  }
  return { ok: true };
}

export function undoLastBlock(
  world: VoxelWorld,
  player: PlayerState
): { ok: boolean; restored?: { x: number; y: number; z: number } } {
  const last = player.undoStack.pop();
  if (!last) return { ok: false };
  const res = world.setBlock({ id: player.id, isOwner: true }, last.x, last.y, last.z, last.prevBlockId);
  if (!res.ok) return { ok: false };
  return { ok: true, restored: { x: last.x, y: last.y, z: last.z } };
}
