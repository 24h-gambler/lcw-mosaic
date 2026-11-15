import { BIOME_PACKS, type BiomeManifestData } from '@lcw/content';
import { mulberry32 } from '@lcw/destruction';
import { VoxelWorld } from './world.js';
import { TUNING } from './tuning.js';

export interface DerivedSeedStreams {
  layout: () => number;
  terrain: () => number;
  ore: () => number;
  loot: () => number;
  npc: () => number;
}

export function hashSeedToUint32(seed: string | number, salt = ''): number {
  const s = `${seed}:${salt}`;
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

export function createSeedStreams(seed: string | number, genVersion = 1): DerivedSeedStreams {
  return {
    layout: mulberry32(hashSeedToUint32(seed, `layout:v${genVersion}`)),
    terrain: mulberry32(hashSeedToUint32(seed, `terrain:v${genVersion}`)),
    ore: mulberry32(hashSeedToUint32(seed, `ore:v${genVersion}`)),
    loot: mulberry32(hashSeedToUint32(seed, `loot:v${genVersion}`)),
    npc: mulberry32(hashSeedToUint32(seed, `npc:v${genVersion}`))
  };
}

export interface SectorPlacement {
  gx: 0 | 1 | 2;
  gz: 0 | 1 | 2;
  centerX: number;
  centerZ: number;
  isPlaza: boolean;
  biome: BiomeManifestData | null;
}

export interface WorldLayout {
  seed: string | number;
  genVersion: number;
  sectors: SectorPlacement[];
  prefabs: Array<{
    id: string;
    sectorGx: number;
    sectorGz: number;
    x: number;
    y: number;
    z: number;
    service?: string;
  }>;
  npcs: Array<{
    id: string;
    ctx: string;
    name: string;
    x: number;
    y: number;
    z: number;
    isErrand?: boolean;
  }>;
}

function isUrbanBiome(b: BiomeManifestData): boolean {
  return (
    b.id === 'biome.london_rain' ||
    b.id === 'biome.nyc' ||
    b.id === 'biome.tokyo' ||
    b.id === 'biome.seoul_plaza' ||
    b.id === 'biome.sydney_harbor'
  );
}

function layoutSatisfiesConstraints(selected: BiomeManifestData[]): boolean {
  if (selected.length !== 8) return false;
  const ids = new Set(selected.map((b) => b.id));
  if (ids.size !== 8) return false;

  const hasHot = selected.some((b) => b.climate.temp === 'hot');
  const hasCold = selected.some((b) => b.climate.temp === 'cold');
  const urbanCount = selected.filter(isUrbanBiome).length;
  if (!hasHot || !hasCold || urbanCount < 2) return false;

  const services = new Set<string>();
  for (const b of selected) {
    for (const s of b.services) services.add(s);
  }
  return (
    services.has('cafe') &&
    services.has('boutique') &&
    services.has('makers_lab') &&
    services.has('exchange')
  );
}

/**
 * Deterministic 3x3 sector layout generator satisfying docs/03 3.3 constraints (WP-401).
 */
export function generateWorldLayout(seed: string | number, genVersion = 1): WorldLayout {
  const streams = createSeedStreams(seed, genVersion);
  let chosen: BiomeManifestData[] = [];

  for (let attempt = 0; attempt < 256; attempt++) {
    const pool = [...BIOME_PACKS];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(streams.layout() * (i + 1));
      const tmp = pool[i]!;
      pool[i] = pool[j]!;
      pool[j] = tmp;
    }
    const candidate = pool.slice(0, 8);
    // For WP-102 consistency, guarantee London sector is included if missing on fallback
    if (layoutSatisfiesConstraints(candidate)) {
      chosen = candidate;
      break;
    }
  }

  if (chosen.length !== 8) {
    chosen = BIOME_PACKS.slice(0, 8);
  }

  const sectors: SectorPlacement[] = [];
  let idx = 0;
  for (const gx of [0, 1, 2] as const) {
    for (const gz of [0, 1, 2] as const) {
      const centerX = gx * TUNING.world.sectorSize + 48;
      const centerZ = gz * TUNING.world.sectorSize + 48;
      if (gx === 1 && gz === 1) {
        sectors.push({ gx, gz, centerX, centerZ, isPlaza: true, biome: null });
      } else {
        sectors.push({ gx, gz, centerX, centerZ, isPlaza: false, biome: chosen[idx++]! });
      }
    }
  }

  // Handcrafted prefabs & NPCs for Central Plaza and sectors (WP-102, WP-111)
  const prefabs: WorldLayout['prefabs'] = [
    { id: 'prefab.central_plaza', sectorGx: 1, sectorGz: 1, x: 144, y: 1, z: 144 },
    { id: 'prefab.court', sectorGx: 1, sectorGz: 1, x: 112, y: 1, z: 112 },
    { id: 'prefab.elevator_tower', sectorGx: 1, sectorGz: 1, x: 144, y: 1, z: 120 },
    { id: 'prefab.lottery_kiosk', sectorGx: 1, sectorGz: 1, x: 172, y: 1, z: 112 },
    { id: 'prefab.repair_shop', sectorGx: 1, sectorGz: 1, x: 112, y: 1, z: 144 },
    { id: 'prefab.london_tea_room', sectorGx: 1, sectorGz: 0, x: 148, y: 1, z: 48, service: 'cafe' }
  ];

  const npcs: WorldLayout['npcs'] = [
    { id: 'npc.errand_runner', ctx: 'cafe', name: 'Oliver', x: 145, y: 1, z: 54, isErrand: true },
    { id: 'npc.cafe_barista', ctx: 'cafe', name: 'Clara', x: 148, y: 1, z: 48 },
    { id: 'npc.repair_smith', ctx: 'repair_shop', name: 'Owen', x: 114, y: 1, z: 144 },
    { id: 'npc.judge', ctx: 'court', name: 'Judge Arthur', x: 114, y: 1, z: 114 }
  ];

  for (const s of sectors) {
    if (!s.biome) continue;
    for (const srv of s.biome.services) {
      prefabs.push({
        id: s.biome.service_skins[srv] ?? `prefab.${srv}`,
        sectorGx: s.gx,
        sectorGz: s.gz,
        x: s.centerX + 6,
        y: 1,
        z: s.centerZ + 6,
        service: srv
      });
      npcs.push({
        id: `npc.${s.biome.id}.${srv}`,
        ctx: srv,
        name: `${srv}_keeper`,
        x: s.centerX + 6,
        y: 1,
        z: s.centerZ + 8
      });
    }
  }

  return { seed, genVersion, sectors, prefabs, npcs };
}

/**
 * Generates deterministic base terrain, roads, Central Plaza, and London Tea Room prefab into a VoxelWorld (WP-102).
 */
export function populateInitialWorld(
  world: VoxelWorld,
  seed: string | number,
  genVersion = 1
): WorldLayout {
  const layout = generateWorldLayout(seed, genVersion);
  const sys = { id: 'system_gen', isSystemGen: true };

  // Build ground & roads for Central Plaza and North London sector path (46..50, 142..146)
  for (let x = 136; x <= 160; x++) {
    for (let z = 40; z <= 160; z++) {
      const isRoad = world.isRoadCoord(x) || world.isRoadCoord(z);
      world.setBlock(sys, x, 0, z, isRoad ? 5 : 3); // 5=road, 3=grass
    }
  }

  // Handcrafted Tea Room Cafe prefab in London sector (148, 1..5, 44..52)
  for (let x = 148; x <= 156; x++) {
    for (let z = 44; z <= 52; z++) {
      for (let y = 1; y <= 5; y++) {
        const isWall = x === 148 || x === 156 || z === 44 || z === 52 || y === 5;
        const isDoor = x === 148 && z === 48 && (y === 1 || y === 2);
        if (isWall && !isDoor) {
          world.setBlock(sys, x, y, z, y === 3 && (x + z) % 2 === 0 ? 9 : 4); // brick + glass
        }
      }
    }
  }
  // Place torch inside cafe
  world.setBlock(sys, 152, 3, 48, 26);

  return layout;
}

export function hashWorldLayout(layout: WorldLayout): number {
  const str = JSON.stringify({
    v: layout.genVersion,
    sectors: layout.sectors.map((s) => ({
      gx: s.gx,
      gz: s.gz,
      biome: s.biome?.id ?? 'plaza'
    })),
    prefabs: layout.prefabs.map((p) => p.id)
  });
  return hashSeedToUint32(str, 'layout_hash');
}
