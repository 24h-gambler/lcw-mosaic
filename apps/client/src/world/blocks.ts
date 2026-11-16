/**
 * Block render/collision table for the client (docs/08 6.1, docs/03 D13).
 * Ids come from `@lcw/content` BLOCK_PALETTE; this file only says how each id looks and collides.
 * Shared by the main thread and the meshing Worker, so it must stay DOM-free.
 */

export type BlockShape =
  | 'none' // air
  | 'cube' // full opaque cube, greedy-meshed with AO
  | 'cutout' // full cube with alpha-tested holes (bars, scaffold, leaves)
  | 'glass' // translucent full cube, faces between equal blocks culled
  | 'water' // translucent, top face lowered
  | 'plant' // two crossed quads
  | 'boxes'; // fixed sub-boxes in 1/16 m units (slab, carpet, lantern, ...)

/** Sub-box in 1/16 m units: [x0, y0, z0, x1, y1, z1]. */
export type Box16 = readonly [number, number, number, number, number, number];

export interface BlockLook {
  id: number;
  shape: BlockShape;
  /** Tile names for top / side / bottom faces (keys of TILE_NAMES). */
  top: string;
  side: string;
  bottom: string;
  boxes?: readonly Box16[];
  /** Collision height in meters (0 = walk through). */
  collideH: number;
  /** Light the block gives off (0..15), mirrors BLOCK_PALETTE.lightLevel for emissive tint. */
  glow: number;
  /** Material family for sounds (docs/12 6.2 재질 6종). */
  sound: 'stone' | 'wood' | 'glass' | 'metal' | 'dirt' | 'sand' | 'cloth' | 'plant';
}

/** Every procedural tile the atlas draws, in layer order. */
export const TILE_NAMES = [
  'grass_top',
  'grass_side',
  'dirt',
  'stone',
  'brick',
  'road',
  'bedrock',
  'dynamite_side',
  'dynamite_top',
  'plank',
  'glass',
  'vault',
  'sand',
  'gravel',
  'snow',
  'granite',
  'marble',
  'oak_plank',
  'birch_plank',
  'pine_plank',
  'log_side',
  'log_top',
  'door',
  'ladder',
  'stained_glass',
  'torch',
  'lantern',
  'neon',
  'iron_plate',
  'copper',
  'gold_trim',
  'iron_bars',
  'roof_red',
  'roof_blue',
  'roof_slate',
  'thatch',
  'sandstone',
  'ice_brick',
  'bamboo',
  'station_panel',
  'scaffold',
  'nameplate',
  'carpet',
  'flower_pot',
  'leaves',
  'water',
  'flower_red',
  'flower_yellow',
  'tall_grass',
  'honeycomb',
  'wool_white',
  'wool_red',
  'wool_yellow',
  'wool_blue',
  'wool_green',
  'wool_orange',
  'crate',
  'barrel_side',
  'barrel_top',
  'hay_side',
  'hay_top',
  'cobblestone',
  'jar_shelf',
  'dark_plank',
  'chest_side',
  'chest_top',
  'path_top',
  'wool_pink',
  'wool_purple',
  'terracotta_honey',
  'flower_blue',
  'chalkboard',
  'stone_brick',
  'ore_coal',
  'ore_iron',
  'ore_gold',
  'ore_ruby',
  'ore_diamond'
] as const;

export type TileName = (typeof TILE_NAMES)[number];

export const TILE_LAYER: Readonly<Record<string, number>> = Object.fromEntries(
  TILE_NAMES.map((n, i) => [n, i])
);

const cube = (
  id: number,
  tile: TileName,
  sound: BlockLook['sound'],
  extra: Partial<BlockLook> = {}
): BlockLook => ({
  id,
  shape: 'cube',
  top: tile,
  side: tile,
  bottom: tile,
  collideH: 1,
  glow: 0,
  sound,
  ...extra
});

const B16 = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Box16 =>
  [x0, y0, z0, x1, y1, z1] as const;

/** Render table by block id. Missing ids render as a plain stone cube. */
export const BLOCK_LOOKS: ReadonlyArray<BlockLook | undefined> = (() => {
  const t: Array<BlockLook | undefined> = [];
  const put = (b: BlockLook): void => {
    t[b.id] = b;
  };
  put({ id: 0, shape: 'none', top: 'stone', side: 'stone', bottom: 'stone', collideH: 0, glow: 0, sound: 'stone' });
  put(cube(1, 'stone', 'stone'));
  put(cube(2, 'dirt', 'dirt'));
  put(cube(3, 'grass_side', 'dirt', { top: 'grass_top', bottom: 'dirt' }));
  put(cube(4, 'brick', 'stone'));
  put(cube(5, 'road', 'stone'));
  put(cube(6, 'bedrock', 'stone'));
  put(cube(7, 'dynamite_side', 'cloth', { top: 'dynamite_top', bottom: 'dynamite_top' }));
  put(cube(8, 'plank', 'wood'));
  put({ ...cube(9, 'glass', 'glass'), shape: 'glass' });
  put(cube(10, 'vault', 'metal'));
  put(cube(11, 'sand', 'sand'));
  put(cube(12, 'gravel', 'sand'));
  put(cube(13, 'snow', 'sand'));
  put(cube(14, 'granite', 'stone'));
  put(cube(15, 'marble', 'stone'));
  put({
    ...cube(16, 'stone', 'stone'),
    shape: 'boxes',
    boxes: [B16(0, 0, 0, 16, 8, 16), B16(0, 8, 8, 16, 16, 16)],
    collideH: 1
  });
  put({ ...cube(17, 'stone', 'stone'), shape: 'boxes', boxes: [B16(0, 0, 0, 16, 8, 16)], collideH: 0.5 });
  put(cube(18, 'oak_plank', 'wood'));
  put(cube(19, 'birch_plank', 'wood'));
  put(cube(20, 'pine_plank', 'wood'));
  put(cube(21, 'log_side', 'wood', { top: 'log_top', bottom: 'log_top' }));
  put({ ...cube(22, 'oak_plank', 'wood'), shape: 'boxes', boxes: [B16(6, 0, 6, 10, 16, 10)], collideH: 1 });
  // a door is walked through (a room on my plot needs one to be entered, D13 출입구)
  put(cube(23, 'door', 'wood', { top: 'oak_plank', bottom: 'oak_plank', collideH: 0 }));
  put({ ...cube(24, 'ladder', 'wood'), shape: 'cutout', collideH: 0 });
  put({ ...cube(25, 'stained_glass', 'glass'), shape: 'glass' });
  put({
    ...cube(26, 'torch', 'wood'),
    shape: 'boxes',
    boxes: [B16(7, 0, 7, 9, 10, 9), B16(6, 10, 6, 10, 13, 10)],
    collideH: 0,
    glow: 14
  });
  put({
    ...cube(27, 'lantern', 'metal'),
    shape: 'boxes',
    boxes: [B16(4, 1, 4, 12, 10, 12), B16(6, 10, 6, 10, 12, 10)],
    collideH: 0.75,
    glow: 15
  });
  put(cube(28, 'neon', 'glass', { glow: 13 }));
  put(cube(29, 'iron_plate', 'metal'));
  put(cube(30, 'copper', 'metal'));
  put(cube(31, 'gold_trim', 'metal'));
  put({ ...cube(32, 'iron_bars', 'metal'), shape: 'cutout' });
  put(cube(33, 'roof_red', 'stone'));
  put(cube(34, 'roof_blue', 'stone'));
  put(cube(35, 'roof_slate', 'stone'));
  put(cube(36, 'thatch', 'plant'));
  put(cube(37, 'sandstone', 'sand'));
  put(cube(38, 'ice_brick', 'glass'));
  put(cube(39, 'bamboo', 'wood'));
  put(cube(40, 'station_panel', 'metal', { glow: 2 }));
  put({ ...cube(41, 'scaffold', 'wood'), shape: 'cutout' });
  put(cube(42, 'nameplate', 'wood', { top: 'oak_plank', bottom: 'oak_plank' }));
  put({ ...cube(43, 'carpet', 'cloth'), shape: 'boxes', boxes: [B16(0, 0, 0, 16, 1, 16)], collideH: 0 });
  put({
    ...cube(44, 'flower_pot', 'stone'),
    shape: 'boxes',
    boxes: [B16(5, 0, 5, 11, 6, 11)],
    collideH: 0.4
  });
  put(cube(45, 'leaves', 'plant'));
  put({ ...cube(46, 'water', 'glass'), shape: 'water', collideH: 0 });
  put({ ...cube(47, 'flower_red', 'plant'), shape: 'plant', collideH: 0 });
  put({ ...cube(48, 'flower_yellow', 'plant'), shape: 'plant', collideH: 0 });
  put({ ...cube(49, 'tall_grass', 'plant'), shape: 'plant', collideH: 0 });
  put(cube(50, 'honeycomb', 'cloth'));
  put(cube(51, 'wool_white', 'cloth'));
  put(cube(52, 'wool_red', 'cloth'));
  put(cube(53, 'wool_yellow', 'cloth'));
  put(cube(54, 'wool_blue', 'cloth'));
  put(cube(55, 'wool_green', 'cloth'));
  put(cube(56, 'wool_orange', 'cloth'));
  put(cube(57, 'crate', 'wood'));
  put(cube(58, 'barrel_side', 'wood', { top: 'barrel_top', bottom: 'barrel_top' }));
  put(cube(59, 'hay_side', 'plant', { top: 'hay_top', bottom: 'hay_top' }));
  put(cube(60, 'cobblestone', 'stone'));
  put(cube(61, 'jar_shelf', 'wood', { top: 'oak_plank', bottom: 'oak_plank' }));
  put(cube(62, 'dark_plank', 'wood'));
  put(cube(63, 'chest_side', 'wood', { top: 'chest_top', bottom: 'dark_plank' }));
  put({
    ...cube(64, 'dirt', 'dirt', { top: 'path_top' }),
    shape: 'boxes',
    boxes: [B16(0, 0, 0, 16, 15, 16)],
    collideH: 15 / 16
  });
  put(cube(65, 'wool_pink', 'cloth'));
  put(cube(66, 'wool_purple', 'cloth'));
  put(cube(67, 'terracotta_honey', 'stone'));
  put({ ...cube(68, 'flower_blue', 'plant'), shape: 'plant', collideH: 0 });
  put(cube(69, 'chalkboard', 'wood', { top: 'dark_plank', bottom: 'dark_plank' }));
  put(cube(70, 'stone_brick', 'stone'));
  // mine veins (play domain): stone with big gems, mined through the server, never broken into blocks
  put(cube(71, 'ore_coal', 'stone'));
  put(cube(72, 'ore_iron', 'stone'));
  put(cube(73, 'ore_gold', 'stone', { glow: 3 }));
  put(cube(74, 'ore_ruby', 'stone', { glow: 3 }));
  put(cube(75, 'ore_diamond', 'stone', { glow: 5 }));
  return t;
})();

const FALLBACK = BLOCK_LOOKS[1]!;

export function blockLook(id: number): BlockLook {
  return BLOCK_LOOKS[id] ?? FALLBACK;
}

/** Numeric shape codes packed for the meshing Worker (no object lookups in the hot loop). */
export const SHAPE_CODE: Record<BlockShape, number> = {
  none: 0,
  cube: 1,
  cutout: 2,
  glass: 3,
  water: 4,
  plant: 5,
  boxes: 6
};

export interface PackedBlockTable {
  shape: Uint8Array;
  /** tile layer per [id*3 + 0 top, 1 side, 2 bottom] */
  tiles: Uint16Array;
}

export function packBlockTable(): PackedBlockTable {
  const n = 256;
  const shape = new Uint8Array(n);
  const tiles = new Uint16Array(n * 3);
  for (let id = 0; id < n; id++) {
    const look = id < BLOCK_LOOKS.length ? blockLook(id) : FALLBACK;
    shape[id] = SHAPE_CODE[look.shape];
    tiles[id * 3] = TILE_LAYER[look.top] ?? 0;
    tiles[id * 3 + 1] = TILE_LAYER[look.side] ?? 0;
    tiles[id * 3 + 2] = TILE_LAYER[look.bottom] ?? 0;
  }
  shape[0] = 0;
  return { shape, tiles };
}

/** True when the block fully hides the face of a neighbor and casts ambient occlusion. */
export function isOpaqueCube(id: number): boolean {
  if (id === 0) return false;
  return blockLook(id).shape === 'cube';
}

export function collideHeight(id: number): number {
  if (id === 0) return 0;
  return blockLook(id).collideH;
}

/** Named ids used by the town builder, so prefabs read like the palette, not magic numbers. */
/** Named block ids (shared with the town builder in sim-core). */
export { BK } from '@lcw/sim-core';
