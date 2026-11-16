export interface BiomeManifestData {
  id: string;
  climate: {
    type: 'rain' | 'hot' | 'cold' | 'temperate' | 'humid' | 'neon';
    temp: 'hot' | 'mild' | 'warm' | 'cold';
    gauge_mods: Record<string, number>;
  };
  requires_gear: string[];
  penalty_without_gear: Record<string, number>;
  services: Array<'cafe' | 'boutique' | 'makers_lab' | 'exchange'>;
  service_skins: Record<string, string>;
  side_job: string;
  ore_table: Record<string, number>;
  underground_setpiece: string;
  sky_feature: string;
  vocab_themes: string[];
  ambient: { skybox: string; bgm: string };
}

export const BIOME_PACKS: readonly BiomeManifestData[] = [
  {
    id: 'biome.london_rain',
    climate: { type: 'rain', temp: 'mild', gauge_mods: { thirst: 0.8 } },
    requires_gear: ['umbrella|raincoat'],
    penalty_without_gear: { move_speed: 0.85 },
    services: ['boutique', 'cafe'],
    service_skins: { boutique: 'prefab.savile_tailor', cafe: 'prefab.tea_room' },
    side_job: 'job.umbrella_delivery',
    ore_table: { coal: 0.5, iron: 0.35, gold: 0.1, ruby: 0.05 },
    underground_setpiece: 'set.victorian_sewer',
    sky_feature: 'sky.airship_dock',
    vocab_themes: ['weather', 'clothing', 'politeness'],
    ambient: { skybox: 'sky.overcast', bgm: 'bgm.london' }
  },
  {
    id: 'biome.sahara',
    climate: { type: 'hot', temp: 'hot', gauge_mods: { thirst: 2.0 } },
    requires_gear: ['desert_cloak'],
    penalty_without_gear: { move_speed: 0.8 },
    services: ['cafe', 'exchange'],
    service_skins: { cafe: 'prefab.oasis_bar', exchange: 'prefab.caravan_exchange' },
    side_job: 'job.oasis_water_run',
    ore_table: { coal: 0.3, iron: 0.3, gold: 0.25, ruby: 0.15 },
    underground_setpiece: 'set.pyramid_mine',
    sky_feature: 'sky.sun_temple',
    vocab_themes: ['heat', 'drinks', 'bargaining'],
    ambient: { skybox: 'sky.desert_sun', bgm: 'bgm.sahara' }
  },
  {
    id: 'biome.alps',
    climate: { type: 'cold', temp: 'cold', gauge_mods: { temperature: 1.5 } },
    requires_gear: ['winter_coat'],
    penalty_without_gear: { move_speed: 0.6 },
    services: ['cafe', 'makers_lab'],
    service_skins: { cafe: 'prefab.alpine_cocoa', makers_lab: 'prefab.ice_workshop' },
    side_job: 'job.snow_rescue',
    ore_table: { coal: 0.35, iron: 0.35, gold: 0.1, diamond: 0.2 },
    underground_setpiece: 'set.ice_cavern',
    sky_feature: 'sky.glider_peak',
    vocab_themes: ['cold', 'clothing', 'rescue'],
    ambient: { skybox: 'sky.alpine_clear', bgm: 'bgm.alps' }
  },
  {
    id: 'biome.nyc',
    climate: { type: 'temperate', temp: 'mild', gauge_mods: { hunger: 1.1 } },
    requires_gear: [],
    penalty_without_gear: {},
    services: ['makers_lab', 'exchange', 'cafe'],
    service_skins: { makers_lab: 'prefab.skyline_lab', exchange: 'prefab.wall_exchange', cafe: 'prefab.deli_cafe' },
    side_job: 'job.taxi_dispatch',
    ore_table: { coal: 0.45, iron: 0.4, gold: 0.1, ruby: 0.05 },
    underground_setpiece: 'set.subway_vault',
    sky_feature: 'sky.rooftop_helipad',
    vocab_themes: ['city', 'jobs', 'negotiation'],
    ambient: { skybox: 'sky.clear_city', bgm: 'bgm.nyc' }
  },
  {
    id: 'biome.amazon',
    climate: { type: 'humid', temp: 'warm', gauge_mods: { thirst: 1.3 } },
    requires_gear: ['raincoat'],
    penalty_without_gear: { move_speed: 0.9 },
    services: ['cafe', 'makers_lab'],
    service_skins: { cafe: 'prefab.canopy_juice', makers_lab: 'prefab.treehouse_craft' },
    side_job: 'job.canopy_guide',
    ore_table: { coal: 0.4, iron: 0.35, gold: 0.2, ruby: 0.05 },
    underground_setpiece: 'set.moss_ruins',
    sky_feature: 'sky.vine_bridge',
    vocab_themes: ['nature', 'animals', 'directions'],
    ambient: { skybox: 'sky.jungle_mist', bgm: 'bgm.amazon' }
  },
  {
    id: 'biome.hawaii',
    climate: { type: 'hot', temp: 'warm', gauge_mods: { thirst: 1.4 } },
    requires_gear: [],
    penalty_without_gear: {},
    services: ['cafe', 'boutique'],
    service_skins: { cafe: 'prefab.coral_smoothie', boutique: 'prefab.surf_shop' },
    side_job: 'job.beach_lifeguard',
    ore_table: { coal: 0.4, iron: 0.3, gold: 0.2, ruby: 0.1 },
    underground_setpiece: 'set.coral_grotto',
    sky_feature: 'sky.cloud_atoll',
    vocab_themes: ['beach', 'food', 'colors'],
    ambient: { skybox: 'sky.tropical', bgm: 'bgm.hawaii' }
  },
  {
    id: 'biome.tokyo',
    climate: { type: 'neon', temp: 'mild', gauge_mods: { hunger: 1.0 } },
    requires_gear: [],
    penalty_without_gear: {},
    services: ['makers_lab', 'boutique', 'exchange'],
    service_skins: { makers_lab: 'prefab.akiba_makers', boutique: 'prefab.neon_tailor', exchange: 'prefab.arcade_exchange' },
    side_job: 'job.night_patrol',
    ore_table: { coal: 0.4, iron: 0.4, gold: 0.15, ruby: 0.05 },
    underground_setpiece: 'set.metro_tunnel',
    sky_feature: 'sky.neon_tower',
    vocab_themes: ['tech', 'shopping', 'directions'],
    ambient: { skybox: 'sky.neon_night', bgm: 'bgm.tokyo' }
  },
  {
    id: 'biome.texas',
    climate: { type: 'hot', temp: 'warm', gauge_mods: { thirst: 1.3 } },
    requires_gear: ['hat'],
    penalty_without_gear: { move_speed: 0.92 },
    services: ['exchange', 'cafe'],
    service_skins: { exchange: 'prefab.ranch_exchange', cafe: 'prefab.barn_diner' },
    side_job: 'job.farm_helper',
    ore_table: { coal: 0.35, iron: 0.35, gold: 0.25, ruby: 0.05 },
    underground_setpiece: 'set.copper_shaft',
    sky_feature: 'sky.windmill_island',
    vocab_themes: ['farm', 'tools', 'quantities'],
    ambient: { skybox: 'sky.golden_prairie', bgm: 'bgm.texas' }
  },
  {
    id: 'biome.nordic_fjord',
    climate: { type: 'cold', temp: 'cold', gauge_mods: { temperature: 1.4 } },
    requires_gear: ['winter_coat'],
    penalty_without_gear: { move_speed: 0.65 },
    services: ['makers_lab', 'boutique'],
    service_skins: { makers_lab: 'prefab.fjord_forge', boutique: 'prefab.wool_weaver' },
    side_job: 'job.lighthouse_keeper',
    ore_table: { coal: 0.35, iron: 0.4, gold: 0.1, diamond: 0.15 },
    underground_setpiece: 'set.frost_vault',
    sky_feature: 'sky.aurora_arch',
    vocab_themes: ['winter', 'crafting', 'safety'],
    ambient: { skybox: 'sky.aurora', bgm: 'bgm.fjord' }
  },
  {
    id: 'biome.cairo_bazaar',
    climate: { type: 'hot', temp: 'hot', gauge_mods: { thirst: 1.8 } },
    requires_gear: ['desert_cloak'],
    penalty_without_gear: { move_speed: 0.85 },
    services: ['exchange', 'boutique'],
    service_skins: { exchange: 'prefab.bazaar_exchange', boutique: 'prefab.silk_stall' },
    side_job: 'job.spice_courier',
    ore_table: { coal: 0.3, iron: 0.3, gold: 0.25, ruby: 0.15 },
    underground_setpiece: 'set.sunken_tomb',
    sky_feature: 'sky.star_observatory',
    vocab_themes: ['numbers', 'trade', 'colors'],
    ambient: { skybox: 'sky.warm_dusk', bgm: 'bgm.cairo' }
  },
  {
    id: 'biome.sydney_harbor',
    climate: { type: 'temperate', temp: 'warm', gauge_mods: { thirst: 1.1 } },
    requires_gear: [],
    penalty_without_gear: {},
    services: ['cafe', 'makers_lab'],
    service_skins: { cafe: 'prefab.harbor_roast', makers_lab: 'prefab.sail_lab' },
    side_job: 'job.ferry_crew',
    ore_table: { coal: 0.45, iron: 0.35, gold: 0.15, ruby: 0.05 },
    underground_setpiece: 'set.sea_cave',
    sky_feature: 'sky.skybridge',
    vocab_themes: ['travel', 'hobbies', 'requests'],
    ambient: { skybox: 'sky.harbor_blue', bgm: 'bgm.sydney' }
  },
  {
    id: 'biome.seoul_plaza',
    climate: { type: 'temperate', temp: 'mild', gauge_mods: { hunger: 1.0 } },
    requires_gear: [],
    penalty_without_gear: {},
    services: ['cafe', 'boutique', 'makers_lab', 'exchange'],
    service_skins: {
      cafe: 'prefab.hanok_tea',
      boutique: 'prefab.studio_fit',
      makers_lab: 'prefab.plaza_makers',
      exchange: 'prefab.central_exchange'
    },
    side_job: 'job.alley_delivery',
    ore_table: { coal: 0.45, iron: 0.35, gold: 0.15, ruby: 0.05 },
    underground_setpiece: 'set.stone_cistern',
    sky_feature: 'sky.lantern_island',
    vocab_themes: ['daily', 'politeness', 'building'],
    ambient: { skybox: 'sky.clear_day', bgm: 'bgm.seoul' }
  }
];

export const DYE_COLORS_16 = [
  '#FFFFFF',
  '#FF6B4A',
  '#3FA9F5',
  '#3DBE6B',
  '#FFC53D',
  '#8E5BE8',
  '#E5484D',
  '#C9CED9',
  '#1B1F2A',
  '#E67E22',
  '#8A5A2B',
  '#35C6C0',
  '#FF4FA3',
  '#7AC74F',
  '#6A7FDB',
  '#FFD98A'
] as const;

export interface BlockDef {
  id: number;
  key: string;
  category:
    | 'air'
    | 'earth_sand'
    | 'stone'
    | 'wood'
    | 'glass_light'
    | 'metal'
    | 'roof'
    | 'sector'
    | 'special';
  blastResistance: number;
  lightLevel: number;
  priceCoins: number;
}

export const BLOCK_PALETTE: readonly BlockDef[] = [
  { id: 0, key: 'air', category: 'air', blastResistance: 0, lightLevel: 0, priceCoins: 0 },
  { id: 1, key: 'stone', category: 'stone', blastResistance: 6, lightLevel: 0, priceCoins: 2 },
  { id: 2, key: 'dirt', category: 'earth_sand', blastResistance: 0.5, lightLevel: 0, priceCoins: 2 },
  { id: 3, key: 'grass', category: 'earth_sand', blastResistance: 0.6, lightLevel: 0, priceCoins: 2 },
  { id: 4, key: 'brick', category: 'stone', blastResistance: 6, lightLevel: 0, priceCoins: 4 },
  { id: 5, key: 'road', category: 'special', blastResistance: Infinity, lightLevel: 0, priceCoins: 0 },
  { id: 6, key: 'bedrock', category: 'special', blastResistance: Infinity, lightLevel: 0, priceCoins: 0 },
  { id: 7, key: 'dynamite', category: 'special', blastResistance: 0, lightLevel: 0, priceCoins: 30 },
  { id: 8, key: 'plank', category: 'wood', blastResistance: 3, lightLevel: 0, priceCoins: 3 },
  { id: 9, key: 'glass', category: 'glass_light', blastResistance: 0.3, lightLevel: 0, priceCoins: 4 },
  { id: 10, key: 'vault', category: 'special', blastResistance: 1200, lightLevel: 0, priceCoins: 20 },
  { id: 11, key: 'sand', category: 'earth_sand', blastResistance: 0.5, lightLevel: 0, priceCoins: 2 },
  { id: 12, key: 'gravel', category: 'earth_sand', blastResistance: 0.6, lightLevel: 0, priceCoins: 2 },
  { id: 13, key: 'snow_block', category: 'earth_sand', blastResistance: 0.5, lightLevel: 0, priceCoins: 3 },
  { id: 14, key: 'granite', category: 'stone', blastResistance: 6, lightLevel: 0, priceCoins: 5 },
  { id: 15, key: 'marble', category: 'stone', blastResistance: 6, lightLevel: 0, priceCoins: 8 },
  { id: 16, key: 'stone_stair', category: 'stone', blastResistance: 6, lightLevel: 0, priceCoins: 5 },
  { id: 17, key: 'stone_slab', category: 'stone', blastResistance: 6, lightLevel: 0, priceCoins: 3 },
  { id: 18, key: 'oak_plank', category: 'wood', blastResistance: 3, lightLevel: 0, priceCoins: 3 },
  { id: 19, key: 'birch_plank', category: 'wood', blastResistance: 3, lightLevel: 0, priceCoins: 3 },
  { id: 20, key: 'pine_plank', category: 'wood', blastResistance: 3, lightLevel: 0, priceCoins: 3 },
  { id: 21, key: 'log', category: 'wood', blastResistance: 3.5, lightLevel: 0, priceCoins: 4 },
  { id: 22, key: 'fence', category: 'wood', blastResistance: 2.5, lightLevel: 0, priceCoins: 3 },
  { id: 23, key: 'door', category: 'wood', blastResistance: 3, lightLevel: 0, priceCoins: 8 },
  { id: 24, key: 'ladder', category: 'wood', blastResistance: 1.5, lightLevel: 0, priceCoins: 4 },
  { id: 25, key: 'stained_glass', category: 'glass_light', blastResistance: 0.3, lightLevel: 0, priceCoins: 6 },
  { id: 26, key: 'torch', category: 'glass_light', blastResistance: 0.1, lightLevel: 14, priceCoins: 5 },
  { id: 27, key: 'lantern', category: 'glass_light', blastResistance: 2, lightLevel: 15, priceCoins: 10 },
  { id: 28, key: 'neon_block', category: 'glass_light', blastResistance: 2, lightLevel: 13, priceCoins: 15 },
  { id: 29, key: 'iron_plate', category: 'metal', blastResistance: 12, lightLevel: 0, priceCoins: 10 },
  { id: 30, key: 'copper_plate', category: 'metal', blastResistance: 10, lightLevel: 0, priceCoins: 8 },
  { id: 31, key: 'gold_trim', category: 'metal', blastResistance: 10, lightLevel: 0, priceCoins: 18 },
  { id: 32, key: 'iron_bars', category: 'metal', blastResistance: 10, lightLevel: 0, priceCoins: 6 },
  { id: 33, key: 'roof_tile_red', category: 'roof', blastResistance: 5, lightLevel: 0, priceCoins: 5 },
  { id: 34, key: 'roof_tile_blue', category: 'roof', blastResistance: 5, lightLevel: 0, priceCoins: 5 },
  { id: 35, key: 'roof_slate', category: 'roof', blastResistance: 5, lightLevel: 0, priceCoins: 6 },
  { id: 36, key: 'thatch', category: 'roof', blastResistance: 1.5, lightLevel: 0, priceCoins: 3 },
  { id: 37, key: 'sandstone', category: 'sector', blastResistance: 4, lightLevel: 0, priceCoins: 6 },
  { id: 38, key: 'ice_brick', category: 'sector', blastResistance: 3, lightLevel: 0, priceCoins: 7 },
  { id: 39, key: 'bamboo_wall', category: 'sector', blastResistance: 2.5, lightLevel: 0, priceCoins: 6 },
  { id: 40, key: 'station_panel', category: 'sector', blastResistance: 14, lightLevel: 2, priceCoins: 16 },
  { id: 41, key: 'scaffold', category: 'special', blastResistance: 0.1, lightLevel: 0, priceCoins: 2 },
  { id: 42, key: 'nameplate', category: 'special', blastResistance: 2, lightLevel: 0, priceCoins: 10 },
  { id: 43, key: 'carpet', category: 'sector', blastResistance: 0.5, lightLevel: 0, priceCoins: 4 },
  { id: 44, key: 'flower_pot_block', category: 'sector', blastResistance: 0.5, lightLevel: 0, priceCoins: 5 },
  // Town scenery and decoration (world domain, docs/03 D13 "장식"·"흙·모래"·"나무" rows, docs/08 6.1).
  { id: 45, key: 'leaves', category: 'wood', blastResistance: 0.2, lightLevel: 0, priceCoins: 2 },
  { id: 46, key: 'water', category: 'special', blastResistance: 100, lightLevel: 0, priceCoins: 0 },
  { id: 47, key: 'flower_red', category: 'sector', blastResistance: 0, lightLevel: 0, priceCoins: 2 },
  { id: 48, key: 'flower_yellow', category: 'sector', blastResistance: 0, lightLevel: 0, priceCoins: 2 },
  { id: 49, key: 'tall_grass', category: 'earth_sand', blastResistance: 0, lightLevel: 0, priceCoins: 1 },
  { id: 50, key: 'honeycomb', category: 'sector', blastResistance: 1, lightLevel: 0, priceCoins: 6 },
  { id: 51, key: 'wool_white', category: 'sector', blastResistance: 0.8, lightLevel: 0, priceCoins: 3 },
  { id: 52, key: 'wool_red', category: 'sector', blastResistance: 0.8, lightLevel: 0, priceCoins: 3 },
  { id: 53, key: 'wool_yellow', category: 'sector', blastResistance: 0.8, lightLevel: 0, priceCoins: 3 },
  { id: 54, key: 'wool_blue', category: 'sector', blastResistance: 0.8, lightLevel: 0, priceCoins: 3 },
  { id: 55, key: 'wool_green', category: 'sector', blastResistance: 0.8, lightLevel: 0, priceCoins: 3 },
  { id: 56, key: 'wool_orange', category: 'sector', blastResistance: 0.8, lightLevel: 0, priceCoins: 3 },
  { id: 57, key: 'crate', category: 'wood', blastResistance: 2.5, lightLevel: 0, priceCoins: 4 },
  { id: 58, key: 'barrel', category: 'wood', blastResistance: 2.5, lightLevel: 0, priceCoins: 5 },
  { id: 59, key: 'hay_bale', category: 'earth_sand', blastResistance: 0.5, lightLevel: 0, priceCoins: 3 },
  { id: 60, key: 'cobblestone', category: 'stone', blastResistance: 6, lightLevel: 0, priceCoins: 2 },
  { id: 61, key: 'jar_shelf', category: 'wood', blastResistance: 1.5, lightLevel: 0, priceCoins: 8 },
  { id: 62, key: 'dark_plank', category: 'wood', blastResistance: 3, lightLevel: 0, priceCoins: 3 },
  { id: 63, key: 'storage_chest', category: 'special', blastResistance: 2.5, lightLevel: 0, priceCoins: 12 },
  { id: 64, key: 'dirt_path', category: 'earth_sand', blastResistance: 0.6, lightLevel: 0, priceCoins: 2 },
  { id: 65, key: 'wool_pink', category: 'sector', blastResistance: 0.8, lightLevel: 0, priceCoins: 3 },
  { id: 66, key: 'wool_purple', category: 'sector', blastResistance: 0.8, lightLevel: 0, priceCoins: 3 },
  { id: 67, key: 'terracotta_honey', category: 'stone', blastResistance: 4, lightLevel: 0, priceCoins: 5 },
  { id: 68, key: 'flower_blue', category: 'sector', blastResistance: 0, lightLevel: 0, priceCoins: 2 },
  { id: 69, key: 'chalkboard', category: 'sector', blastResistance: 2, lightLevel: 0, priceCoins: 6 },
  { id: 70, key: 'stone_brick', category: 'stone', blastResistance: 6, lightLevel: 0, priceCoins: 4 },
  // Mine veins (docs/03 D2 광물표; play domain, packages/sim-core/src/play-sites.ts). Mined through the server
  // (/v1/play/mine), never broken into blocks, so they are not sold as building blocks (price 0).
  { id: 71, key: 'ore_coal', category: 'special', blastResistance: 6, lightLevel: 0, priceCoins: 0 },
  { id: 72, key: 'ore_iron', category: 'special', blastResistance: 6, lightLevel: 0, priceCoins: 0 },
  { id: 73, key: 'ore_gold', category: 'special', blastResistance: 6, lightLevel: 0, priceCoins: 0 },
  { id: 74, key: 'ore_ruby', category: 'special', blastResistance: 6, lightLevel: 0, priceCoins: 0 },
  { id: 75, key: 'ore_diamond', category: 'special', blastResistance: 6, lightLevel: 0, priceCoins: 0 }
];

export interface PartDef {
  id: string;
  category: 'primitive' | 'life' | 'weapon_tool' | 'nature' | 'machine';
  voxels: number;
}

const PRIMITIVE_PARTS = [
  'cube_unit', 'cube_flat', 'cube_tall', 'sphere_smooth', 'sphere_ridged',
  'cylinder_short', 'cylinder_long', 'cone_sharp', 'cone_blunt', 'prism_tri',
  'ring_thin', 'ring_thick', 'arch_half', 'wedge_slope', 'pyramid_step',
  'capsule_small', 'disk_round', 'bar_hex', 'plate_square', 'corner_bracket'
];
const LIFE_PARTS = [
  'eye_round', 'eye_tri', 'eye_visored', 'horn_curved', 'ear_fox',
  'ear_round', 'wing_small', 'wing_jet', 'tail_fluffy', 'knot_small',
  'buckle_brass', 'collar_trim', 'cape_hem', 'hat_brim', 'hat_crown',
  'shoe_sole', 'glove_cuff', 'badge_star', 'button_pair', 'pocket_patch',
  'visor_glass', 'strap_cross', 'belt_loop', 'hood_fold', 'scarf_tail'
];
const WEAPON_TOOL_PARTS = [
  'blade_short', 'blade_long', 'hilt_cross', 'pommel_gem', 'shaft_wood',
  'pick_head', 'hammer_head', 'axe_blade', 'drill_cone', 'barrel_tube',
  'nozzle_flare', 'shield_plate', 'shield_boss', 'wand_tip', 'orb_core',
  'bow_limb', 'string_line', 'quiver_body', 'wrench_jaw', 'hook_curve',
  'mallet_head', 'scope_tube', 'grip_wrapped', 'fin_stabilizer', 'guard_ring'
];
const NATURE_PARTS = [
  'stem_short', 'leaf_oval', 'leaf_pine', 'petal_five', 'vine_curl',
  'branch_fork', 'crystal_hex', 'crystal_cluster', 'shell_spiral', 'feather_plume',
  'coral_branch', 'cloud_puff', 'acorn_cap', 'mushroom_cap', 'bamboo_node',
  'stone_chunk', 'ice_spike', 'flame_lick', 'wave_crest', 'star_voxel',
  'sun_disc', 'moon_crescent', 'snowflake_6', 'seed_pod', 'moss_pad'
];
const MACHINE_PARTS = [
  'thruster_bell', 'fuel_tank', 'pipe_elbow', 'gear_8tooth', 'antenna_rod',
  'dish_radar', 'battery_cell', 'panel_vent', 'gauge_dial', 'rotor_blade',
  'spring_coil', 'piston_rod', 'valve_wheel', 'exhaust_stack', 'wire_bundle',
  'led_strip', 'sensor_dome', 'frame_truss', 'hinge_pin', 'latch_clip',
  'solar_wing', 'magnet_u', 'gyro_ring', 'switch_lever', 'core_casing'
];

export const PART_REGISTRY: readonly PartDef[] = [
  ...PRIMITIVE_PARTS.map((id) => ({ id, category: 'primitive' as const, voxels: 16 })),
  ...LIFE_PARTS.map((id) => ({ id, category: 'life' as const, voxels: 12 })),
  ...WEAPON_TOOL_PARTS.map((id) => ({ id, category: 'weapon_tool' as const, voxels: 20 })),
  ...NATURE_PARTS.map((id) => ({ id, category: 'nature' as const, voxels: 14 })),
  ...MACHINE_PARTS.map((id) => ({ id, category: 'machine' as const, voxels: 24 }))
];

export const PART_ID_SET = new Set(PART_REGISTRY.map((p) => p.id));

export interface AbilityTagDef {
  id: string;
  group: 'movement' | 'combat' | 'life' | 'light_sound';
  powerCost: number;
  kernelCall: 'explode' | 'waterBomb' | 'rocket' | 'impulse' | 'passive';
}

export const ABILITY_TAG_REGISTRY: readonly AbilityTagDef[] = [
  { id: 'flight_jetpack', group: 'movement', powerCost: 5, kernelCall: 'impulse' },
  { id: 'fuel_x2', group: 'movement', powerCost: 4, kernelCall: 'passive' },
  { id: 'double_jump', group: 'movement', powerCost: 3, kernelCall: 'impulse' },
  { id: 'dash_burst', group: 'movement', powerCost: 3, kernelCall: 'impulse' },
  { id: 'glide_wing', group: 'movement', powerCost: 2, kernelCall: 'impulse' },
  { id: 'speed_up', group: 'movement', powerCost: 2, kernelCall: 'passive' },
  { id: 'swim_fin', group: 'movement', powerCost: 2, kernelCall: 'passive' },
  { id: 'feather_fall', group: 'movement', powerCost: 2, kernelCall: 'impulse' },
  { id: 'climb_grip', group: 'movement', powerCost: 2, kernelCall: 'passive' },
  { id: 'spring_step', group: 'movement', powerCost: 2, kernelCall: 'impulse' },
  { id: 'hover_pad', group: 'movement', powerCost: 4, kernelCall: 'impulse' },
  { id: 'rocket_boost', group: 'movement', powerCost: 4, kernelCall: 'rocket' },
  { id: 'throwable', group: 'combat', powerCost: 1, kernelCall: 'passive' },
  { id: 'water_burst', group: 'combat', powerCost: 3, kernelCall: 'waterBomb' },
  { id: 'range_up', group: 'combat', powerCost: 1, kernelCall: 'passive' },
  { id: 'blast_small', group: 'combat', powerCost: 4, kernelCall: 'explode' },
  { id: 'blast_medium', group: 'combat', powerCost: 6, kernelCall: 'explode' },
  { id: 'rocket_shot', group: 'combat', powerCost: 5, kernelCall: 'rocket' },
  { id: 'knockback_push', group: 'combat', powerCost: 2, kernelCall: 'impulse' },
  { id: 'armor_1', group: 'combat', powerCost: 2, kernelCall: 'passive' },
  { id: 'armor_2', group: 'combat', powerCost: 4, kernelCall: 'passive' },
  { id: 'armor_3', group: 'combat', powerCost: 6, kernelCall: 'passive' },
  { id: 'sword_edge_1', group: 'combat', powerCost: 2, kernelCall: 'passive' },
  { id: 'sword_edge_2', group: 'combat', powerCost: 4, kernelCall: 'passive' },
  { id: 'shield_block', group: 'combat', powerCost: 2, kernelCall: 'passive' },
  { id: 'skill_amp', group: 'combat', powerCost: 3, kernelCall: 'passive' },
  { id: 'rain_shield', group: 'life', powerCost: 2, kernelCall: 'passive' },
  { id: 'cold_insulation', group: 'life', powerCost: 2, kernelCall: 'passive' },
  { id: 'heat_shield', group: 'life', powerCost: 3, kernelCall: 'passive' },
  { id: 'oxygen_tank', group: 'life', powerCost: 4, kernelCall: 'passive' },
  { id: 'mine_speed_1', group: 'life', powerCost: 2, kernelCall: 'passive' },
  { id: 'mine_speed_2', group: 'life', powerCost: 4, kernelCall: 'passive' },
  { id: 'bag_magnet', group: 'life', powerCost: 2, kernelCall: 'passive' },
  { id: 'repair_bonus', group: 'life', powerCost: 1, kernelCall: 'passive' },
  { id: 'thirst_saver', group: 'life', powerCost: 2, kernelCall: 'passive' },
  { id: 'hunger_saver', group: 'life', powerCost: 2, kernelCall: 'passive' },
  { id: 'night_light', group: 'light_sound', powerCost: 2, kernelCall: 'passive' },
  { id: 'glow_aura', group: 'light_sound', powerCost: 1, kernelCall: 'passive' },
  { id: 'spark_trail', group: 'light_sound', powerCost: 1, kernelCall: 'passive' },
  { id: 'bell_chime', group: 'light_sound', powerCost: 1, kernelCall: 'passive' },
  { id: 'horn_call', group: 'light_sound', powerCost: 1, kernelCall: 'passive' },
  { id: 'bubble_trail', group: 'light_sound', powerCost: 1, kernelCall: 'passive' },
  { id: 'star_burst_fx', group: 'light_sound', powerCost: 1, kernelCall: 'passive' },
  { id: 'compass_ping', group: 'light_sound', powerCost: 1, kernelCall: 'passive' }
];

export const ABILITY_TAG_MAP = new Map(ABILITY_TAG_REGISTRY.map((t) => [t.id, t]));

export interface FurnitureDef {
  id: string;
  role: 'light' | 'rest' | 'flat' | 'job' | 'decor';
  nameEn: string;
}

const CORE_FURNITURE: FurnitureDef[] = [
  { id: 'furn_lamp_table', role: 'light', nameEn: 'table lamp' },
  { id: 'furn_lamp_floor', role: 'light', nameEn: 'floor lamp' },
  { id: 'furn_chandelier', role: 'light', nameEn: 'chandelier' },
  { id: 'furn_lantern_wall', role: 'light', nameEn: 'wall lantern' },
  { id: 'furn_bed_single', role: 'rest', nameEn: 'single bed' },
  { id: 'furn_bed_bunk', role: 'rest', nameEn: 'bunk bed' },
  { id: 'furn_chair_wood', role: 'rest', nameEn: 'wooden chair' },
  { id: 'furn_sofa_cozy', role: 'rest', nameEn: 'cozy sofa' },
  { id: 'furn_armchair', role: 'rest', nameEn: 'armchair' },
  { id: 'furn_table_dining', role: 'flat', nameEn: 'dining table' },
  { id: 'furn_desk_study', role: 'flat', nameEn: 'study desk' },
  { id: 'furn_workbench', role: 'flat', nameEn: 'workbench' },
  { id: 'furn_counter_kitchen', role: 'flat', nameEn: 'kitchen counter' },
  // 12 Job furniture pieces matching docs/03 D13
  { id: 'job_stove', role: 'job', nameEn: 'cooking stove' },
  { id: 'job_sewing_machine', role: 'job', nameEn: 'sewing machine' },
  { id: 'job_stone_bench', role: 'job', nameEn: 'stone workbench' },
  { id: 'job_saw_bench', role: 'job', nameEn: 'saw workbench' },
  { id: 'job_anvil', role: 'job', nameEn: 'blacksmith anvil' },
  { id: 'job_flower_shelf', role: 'job', nameEn: 'flower shelf' },
  { id: 'job_display_stand', role: 'job', nameEn: 'shop display stand' },
  { id: 'job_mailbox', role: 'job', nameEn: 'mailbox' },
  { id: 'job_easel', role: 'job', nameEn: 'painting easel' },
  { id: 'job_map_table', role: 'job', nameEn: 'map table' },
  { id: 'job_instrument', role: 'job', nameEn: 'grand piano' },
  { id: 'job_lab_desk', role: 'job', nameEn: 'science lab desk' }
];

const EXTRA_DECOR_FURNITURE: FurnitureDef[] = Array.from({ length: 55 }, (_, i) => ({
  id: `furn_decor_${String(i + 1).padStart(2, '0')}`,
  role: 'decor' as const,
  nameEn: `decor item ${i + 1}`
}));

export const FURNITURE_REGISTRY: readonly FurnitureDef[] = [
  ...CORE_FURNITURE,
  ...EXTRA_DECOR_FURNITURE
];

export interface ResidentDef {
  id: string;
  nameKo: string;
  nameEn: string;
  jobFurnitureId: string;
  unlockRequirement: string;
  benefit: string;
}

/**
 * Fixed 12-resident roster (docs/03 D13 lines 400-414). AI never generates residents.
 */
export const RESIDENT_REGISTRY: readonly ResidentDef[] = [
  { id: 'res_chef', nameKo: '요리사', nameEn: 'Chef Leo', jobFurnitureId: 'job_stove', unlockRequirement: 'food_orders_20', benefit: 'home_food_orders' },
  { id: 'res_tailor', nameKo: '재단사', nameEn: 'Tailor Leo', jobFurnitureId: 'job_sewing_machine', unlockRequirement: 'outfits_5', benefit: 'home_dye_repair' },
  { id: 'res_mason', nameKo: '석공', nameEn: 'Mason Theo', jobFurnitureId: 'job_stone_bench', unlockRequirement: 'blocks_500', benefit: 'stone_discount' },
  { id: 'res_carpenter', nameKo: '목수', nameEn: 'Carpenter Nora', jobFurnitureId: 'job_saw_bench', unlockRequirement: 'wood_blocks_300', benefit: 'wood_discount' },
  { id: 'res_blacksmith', nameKo: '대장장이', nameEn: 'Smith Owen', jobFurnitureId: 'job_anvil', unlockRequirement: 'iron_pickaxe_owned', benefit: 'home_tool_repair' },
  { id: 'res_gardener', nameKo: '정원사', nameEn: 'Gardener Ivy', jobFurnitureId: 'job_flower_shelf', unlockRequirement: 'flower_pots_10', benefit: 'seeds_and_flowers' },
  { id: 'res_merchant', nameKo: '상인', nameEn: 'Merchant Sam', jobFurnitureId: 'job_display_stand', unlockRequirement: 'exchange_5000', benefit: 'player_shop' },
  { id: 'res_postman', nameKo: '우체부', nameEn: 'Postman Ben', jobFurnitureId: 'job_mailbox', unlockRequirement: 'friend_visit_1', benefit: 'send_gifts' },
  { id: 'res_painter', nameKo: '화가', nameEn: 'Painter Aria', jobFurnitureId: 'job_easel', unlockRequirement: 'frames_5', benefit: 'paint_signs' },
  { id: 'res_explorer', nameKo: '탐험가', nameEn: 'Explorer Kai', jobFurnitureId: 'job_map_table', unlockRequirement: 'bands_3', benefit: 'maps_compass' },
  { id: 'res_musician', nameKo: '음악가', nameEn: 'Musician Hana', jobFurnitureId: 'job_instrument', unlockRequirement: 'encyclopedia_30pct', benefit: 'home_bgm_select' },
  { id: 'res_scientist', nameKo: '과학자', nameEn: 'Scientist Dr. Ray', jobFurnitureId: 'job_lab_desk', unlockRequirement: 'station_reached', benefit: 'advanced_gear_plans' }
];
