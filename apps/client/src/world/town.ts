/**
 * The hand-built lesson town in the central sector (docs/03 3.5, WP-102): plaza, honey cafe, trade shop,
 * my build plot, and the windy hill, plus the meadow around them. Every block goes through
 * `VoxelWorld.setBlock` (AGENTS 4.1) with the system-generation actor; the builder is deterministic.
 */
import type { NpcContext } from '@lcw/schemas';
import { buildTown, buildTownSteps, terrainHeight, TOWN_CENTER, TERRAIN_MIN, TERRAIN_MAX, type VoxelWorld } from '@lcw/sim-core';
import { collideHeight } from './blocks.js';
import { SCENE_TITLES_KO } from './strings.js';

import type { SceneId } from './api.js';
export type { SceneId };
// The builder lives in sim-core so the WorldDO can start from the same town (server-side saves).
export { buildTown, buildTownSteps, terrainHeight, TOWN_CENTER, TERRAIN_MIN, TERRAIN_MAX };

export interface Spot {
  x: number;
  y: number;
  z: number;
  /** facing = (sin yaw, 0, cos yaw); yaw 0 faces +z (south) */
  yaw: number;
}

export interface SceneDef {
  id: SceneId;
  titleKo: string;
  /** where the player stands when the scene starts */
  player: Spot;
  /** the scene's main NPC id (if any) and where that NPC stands in this scene */
  npc?: { id: string; spot: Spot };
  /** where the camera should look from, relative to the player (yaw offset) */
  cameraYaw: number;
  /** camera pitch (radians above horizontal) and distance for this scene; tight spots use a lower, closer camera */
  camPitch?: number;
  camDist?: number;
  /** waypoints from the plaza hub to the scene (auto-walk path) */
  path: Array<[number, number]>;
}

export interface NpcLook {
  skin: number;
  hair: number;
  shirt: number;
  pants: number;
  shoes: number;
  apron?: number;
  hat?: number;
  hairStyle: 'short' | 'bun' | 'long' | 'cap';
}

export interface NpcDef {
  id: string;
  ctx: NpcContext;
  nameKo: string;
  nameEn: string;
  /** scene the NPC normally lives in */
  home: SceneId;
  look: NpcLook;
  /** guides follow the lesson to plaza / hill; shop keepers stay */
  roams?: readonly SceneId[];
}


export const NPCS: readonly NpcDef[] = [
  {
    id: 'guide',
    ctx: 'guide',
    nameKo: '안내인 선생님',
    nameEn: 'Luna',
    home: 'plaza',
    roams: ['plaza', 'open_hill', 'build_plot'],
    look: { skin: 0xf2c7a5, hair: 0xd9622b, shirt: 0xff6b4a, pants: 0x2f3b52, shoes: 0x3a4152, hairStyle: 'long', hat: 0x3fa9f5 }
  },
  {
    id: 'cafe_owner',
    ctx: 'cafe',
    nameKo: '카페 주인 하니',
    nameEn: 'Hani',
    home: 'honey_cafe',
    look: { skin: 0xf6d2b5, hair: 0x6b4226, shirt: 0xffc53d, pants: 0x7a5235, shoes: 0x4a3322, apron: 0xfff9ee, hairStyle: 'bun' }
  },
  {
    id: 'shop_owner',
    ctx: 'trade_shop',
    nameKo: '상점 주인 토비',
    nameEn: 'Toby',
    home: 'trade_shop',
    look: { skin: 0xc68e62, hair: 0x2a2320, shirt: 0xf3efe7, pants: 0x2f3b52, shoes: 0x2a2320, apron: 0x2f6fae, hairStyle: 'cap', hat: 0x3dbe6b }
  }
];

/** Townsfolk who stroll around and make the town feel lived in (not talkable). */
export const WANDERERS: readonly { id: string; look: NpcLook; route: Array<[number, number]> }[] = [
  {
    id: 'walker.1',
    look: { skin: 0xe8b894, hair: 0x2a2320, shirt: 0x3dbe6b, pants: 0x5f6778, shoes: 0x3a4152, hairStyle: 'short' },
    route: [[134, 136], [154, 136], [154, 152], [134, 152]]
  },
  {
    id: 'walker.2',
    look: { skin: 0xf6d2b5, hair: 0xe0b04a, shirt: 0x8e5be8, pants: 0x3a4152, shoes: 0x1b1f2a, hairStyle: 'long' },
    route: [[150, 131], [157, 140], [150, 157], [138, 157], [131, 148], [138, 131]]
  },
  {
    id: 'walker.3',
    look: { skin: 0x9a6a4a, hair: 0x1b1f2a, shirt: 0x3fa9f5, pants: 0x7a5235, shoes: 0x3a4152, hairStyle: 'cap', hat: 0xffc53d },
    route: [[144, 126], [144, 116], [139, 110], [144, 126], [160, 144], [176, 147]]
  }
];

export const SCENES: Readonly<Record<SceneId, SceneDef>> = {
  plaza: {
    id: 'plaza',
    titleKo: SCENE_TITLES_KO.plaza,
    player: { x: 144.5, y: 1, z: 153.5, yaw: Math.PI },
    npc: { id: 'guide', spot: { x: 144.5, y: 1, z: 150.0, yaw: 0 } },
    cameraYaw: 0,
    path: [[144.5, 153.5]]
  },
  honey_cafe: {
    id: 'honey_cafe',
    titleKo: SCENE_TITLES_KO.honey_cafe,
    player: { x: 163.5, y: 1, z: 134.5, yaw: Math.PI / 2 },
    npc: { id: 'cafe_owner', spot: { x: 167.5, y: 1, z: 134.5, yaw: -Math.PI / 2 } },
    cameraYaw: 0,
    camPitch: 0.2,
    camDist: 5,
    path: [[152, 144], [160.5, 144], [163.5, 141], [163.5, 134.5]]
  },
  trade_shop: {
    id: 'trade_shop',
    titleKo: SCENE_TITLES_KO.trade_shop,
    player: { x: 124.5, y: 1, z: 134.5, yaw: -Math.PI / 2 },
    npc: { id: 'shop_owner', spot: { x: 120.5, y: 1, z: 134.5, yaw: Math.PI / 2 } },
    cameraYaw: -0.45,
    camPitch: 0.14,
    camDist: 4.6,
    path: [[136, 144], [126.5, 144], [124.5, 141], [124.5, 134.5]]
  },
  build_plot: {
    id: 'build_plot',
    titleKo: SCENE_TITLES_KO.build_plot,
    player: { x: 121.5, y: 1, z: 161.5, yaw: 0 },
    npc: { id: 'guide', spot: { x: 124.5, y: 1, z: 163.5, yaw: -Math.PI * 0.75 } },
    cameraYaw: 0,
    path: [[138, 156], [133, 158], [121.5, 158], [121.5, 161.5]]
  },
  open_hill: {
    id: 'open_hill',
    titleKo: SCENE_TITLES_KO.open_hill,
    player: { x: 144.5, y: 10, z: 100.5, yaw: 0 },
    npc: { id: 'guide', spot: { x: 144.5, y: 10, z: 104.5, yaw: Math.PI } },
    cameraYaw: 0,
    path: [[150.5, 152], [150.5, 135], [144.5, 127], [144.5, 112], [144.5, 100.5]]
  }
};

/** Topmost walkable surface at a column at or below `fromY` (for spawning and NPC placement). */
export function standHeight(world: VoxelWorld, x: number, z: number, fromY = 40): number {
  const bx = Math.floor(x);
  const bz = Math.floor(z);
  for (let y = fromY; y > -8; y--) {
    const h = collideHeight(world.getBlock(bx, y, bz));
    if (h > 0) return y + h;
  }
  return 0;
}
