/**
 * The hand-built lesson town in the central sector (docs/03 3.5, WP-102): plaza, honey cafe, trade shop,
 * my build plot, and the windy hill, plus the meadow around them. Every block goes through
 * `VoxelWorld.setBlock` (AGENTS 4.1) with the system-generation actor; the builder is deterministic.
 */
import { LANG_PACK_MANIFEST, npcPersona } from '@lcw/content';
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
  /** a fixed place outside any scene's NPC spot (the errand giver at the cafe door) */
  spot?: Spot;
  /**
   * Solo play only (the errand giver): hidden and not talkable while a lesson runs, so the stage NPC is the only one
   * E or a tap can reach in the lesson's scenes (review L4: the neighbour stood 1.2 m farther than the cafe owner).
   */
  soloOnly?: true;
}


/**
 * The world's own NPC table. Names here are only the fallback: the cast pack of the world's target language
 * (`npcPersona`, packages/content/src/npc-cast.ts, Dan 11-16 "원어민 이름") names every NPC it knows, so the
 * name plates, the dialog header and the voice read one table (`NPCS` below).
 */
const NPC_DEFS: readonly NpcDef[] = [
  {
    id: 'guide',
    ctx: 'guide',
    nameKo: '안내인 선생님',
    nameEn: 'Guide',
    home: 'plaza',
    roams: ['plaza', 'open_hill', 'build_plot'],
    look: { skin: 0xf2c7a5, hair: 0xd9622b, shirt: 0xff6b4a, pants: 0x2f3b52, shoes: 0x3a4152, hairStyle: 'long', hat: 0x3fa9f5 }
  },
  {
    id: 'cafe_owner',
    ctx: 'cafe',
    nameKo: '카페 주인',
    nameEn: 'Cafe owner',
    home: 'honey_cafe',
    look: { skin: 0xf6d2b5, hair: 0x6b4226, shirt: 0xffc53d, pants: 0x7a5235, shoes: 0x4a3322, apron: 0xfff9ee, hairStyle: 'bun' }
  },
  {
    id: 'shop_owner',
    ctx: 'trade_shop',
    nameKo: '상점 주인',
    nameEn: 'Shop owner',
    home: 'trade_shop',
    look: { skin: 0xc68e62, hair: 0x2a2320, shirt: 0xf3efe7, pants: 0x2f3b52, shoes: 0x2a2320, apron: 0x2f6fae, hairStyle: 'cap', hat: 0x3dbe6b }
  },
  {
    // docs/03 D1 first-visit errand: a neighbour waiting by the honey cafe door, facing the road from the plaza
    // (2.5 m west of the walk to the counter, so the cafe two-shot stays clear).
    id: 'errand_neighbor',
    ctx: 'errand',
    nameKo: '이웃',
    nameEn: 'Neighbour',
    home: 'honey_cafe',
    spot: { x: 161.0, y: 1, z: 139.0, yaw: 0 },
    soloOnly: true,
    look: { skin: 0xf2c7a5, hair: 0x2a2320, shirt: 0x3dbe6b, pants: 0x3fa9f5, shoes: 0xf3efe7, hairStyle: 'bun', hat: 0xffc53d }
  }
];

/** NPC table with names from the cast pack of `lang` (the world's target language); unknown ids keep their own. */
export function castNpcs(lang: string = LANG_PACK_MANIFEST.target_lang): readonly NpcDef[] {
  return NPC_DEFS.map((d) => {
    const p = npcPersona(d.id, lang);
    return p ? { ...d, nameKo: p.nameKo, nameEn: p.nameEn } : d;
  });
}

export const NPCS: readonly NpcDef[] = castNpcs();

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
    player: { x: 144.5, y: 1, z: 152.3, yaw: Math.PI },
    npc: { id: 'guide', spot: { x: 144.5, y: 1, z: 150.0, yaw: 0 } },
    cameraYaw: 0,
    path: [[144.5, 152.3]]
  },
  honey_cafe: {
    id: 'honey_cafe',
    titleKo: SCENE_TITLES_KO.honey_cafe,
    // at the counter (x 166): 2.3 m from the owner, inside E reach on arrival
    player: { x: 165.2, y: 1, z: 134.5, yaw: Math.PI / 2 },
    npc: { id: 'cafe_owner', spot: { x: 167.5, y: 1, z: 134.5, yaw: -Math.PI / 2 } },
    cameraYaw: 0,
    camPitch: 0.2,
    camDist: 5,
    path: [[152, 144], [160.5, 144], [163.5, 141], [163.5, 136.5], [165.2, 134.5]]
  },
  trade_shop: {
    id: 'trade_shop',
    titleKo: SCENE_TITLES_KO.trade_shop,
    // at the counter (x 122): the keeper stands right behind it, 2.3 m from the child, inside E reach on arrival;
    // one cell south of the crate on the counter (122, 2, 133), so the dialog shot over the shoulder sees his face
    player: { x: 123.8, y: 1, z: 135.5, yaw: -Math.PI / 2 },
    npc: { id: 'shop_owner', spot: { x: 121.5, y: 1, z: 135.5, yaw: Math.PI / 2 } },
    cameraYaw: -0.45,
    camPitch: 0.14,
    camDist: 4.6,
    path: [[136, 144], [126.5, 144], [124.5, 141], [124.2, 137.5], [123.8, 135.5]]
  },
  build_plot: {
    id: 'build_plot',
    titleKo: SCENE_TITLES_KO.build_plot,
    player: { x: 122.8, y: 1, z: 162.2, yaw: 0.92 },
    npc: { id: 'guide', spot: { x: 124.5, y: 1, z: 163.5, yaw: -Math.PI * 0.75 } },
    cameraYaw: 0,
    path: [[138, 156], [133, 158], [121.5, 158], [122.8, 162.2]]
  },
  open_hill: {
    id: 'open_hill',
    titleKo: SCENE_TITLES_KO.open_hill,
    player: { x: 144.5, y: 10, z: 102.2, yaw: 0 },
    npc: { id: 'guide', spot: { x: 144.5, y: 10, z: 104.5, yaw: Math.PI } },
    cameraYaw: 0,
    // the last steps pass beside the guide (not through) to stop in front of her, looking down at the town
    path: [[150.5, 152], [150.5, 135], [144.5, 127], [144.5, 112], [146.0, 107], [145.6, 103.5], [144.5, 102.2]]
  }
};

/**
 * The auto-walk to a scene (goToScene): out along the current scene's path, in along the target's, starting from
 * where the player actually is. Already in the target scene (talked to the neighbour by the cafe door, then "카페로 걸어가기"),
 * only the rest of that scene's own path, never out to the plaza and back in. A route starts at the waypoint nearest
 * the player, or the next one when the player already stands on the stretch between them (no corner is cut).
 */
export function sceneRoute(from: SceneId, to: SceneId, x: number, z: number): Array<[number, number]> {
  const src = SCENES[from];
  const dst = SCENES[to];
  let pts: Array<[number, number]>;
  if (to === from) pts = [...dst.path];
  else if (to === 'plaza') pts = [...src.path].reverse().slice(1).concat([[dst.player.x, dst.player.z]]);
  else if (from === 'plaza') pts = [...dst.path];
  else pts = [...src.path].reverse().slice(1).concat(dst.path);
  let i = 0;
  let best = Infinity;
  for (let k = 0; k < pts.length; k++) {
    const d = Math.hypot(pts[k]![0] - x, pts[k]![1] - z);
    if (d < best) {
      best = d;
      i = k;
    }
  }
  if (i + 1 < pts.length) {
    const [ax, az] = pts[i]!;
    const [bx, bz] = pts[i + 1]!;
    const len = Math.hypot(bx - ax, bz - az) || 1;
    const t = ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / (len * len);
    const off = Math.abs((x - ax) * (bz - az) - (z - az) * (bx - ax)) / len;
    if (t > 0 && t < 1 && off < 1) i++;
  }
  return pts.slice(i);
}

/** Who E or a tap may reach: everyone in solo play, only lesson NPCs while a lesson runs. */
export function npcTalkable(def: Pick<NpcDef, 'soloOnly'>, lesson: boolean): boolean {
  return !(lesson && def.soloOnly);
}

/**
 * Where the player stands to talk to an NPC (walkToNpc): `dist` m in front of it (its facing), else to its sides or
 * behind, on ground no higher than a step from the NPC's feet with two free cells above and nothing solid between
 * (not across a counter). null when boxed in.
 */
export function talkSpotFor(world: VoxelWorld, npc: { x: number; y: number; z: number; yaw: number }, dist = 1.5): { x: number; z: number } | null {
  for (const turn of [0, Math.PI / 2, -Math.PI / 2, Math.PI / 4, -Math.PI / 4, Math.PI]) {
    const a = npc.yaw + turn;
    const x = npc.x + Math.sin(a) * dist;
    const z = npc.z + Math.cos(a) * dist;
    const y = standHeight(world, x, z, Math.ceil(npc.y) + 2);
    if (Math.abs(y - npc.y) > 1.05) continue;
    const by = Math.ceil(y - 0.01);
    if (collideHeight(world.getBlock(Math.floor(x), by, Math.floor(z))) > 0) continue;
    if (collideHeight(world.getBlock(Math.floor(x), by + 1, Math.floor(z))) > 0) continue;
    const mx = (npc.x + x) / 2;
    const mz = (npc.z + z) / 2;
    if (collideHeight(world.getBlock(Math.floor(mx), by, Math.floor(mz))) > 0) continue;
    return { x, z };
  }
  return null;
}

/** Topmost walkable surface at a column at or below `fromY` (for spawning and NPC placement). */
export function standHeight(world: VoxelWorld, x: number, z: number, fromY = 40): number {
  const bx = Math.floor(x);
  const bz = Math.floor(z);
  // down to 40 m under the start (the mine floors under the market hall sit at y -24, -72, -120)
  for (let y = fromY; y > Math.min(-8, fromY - 40); y--) {
    const h = collideHeight(world.getBlock(bx, y, bz));
    if (h > 0) return y + h;
  }
  return 0;
}
