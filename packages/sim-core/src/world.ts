import { BLOCK_PALETTE } from '@lcw/content';
import { TUNING } from './tuning.js';
import { CHUNK_SIZE, CubicChunk } from './chunk.js';

export type ZoneKind = 'oob' | 'core' | 'city' | 'plot' | 'wild';

export interface PlotBounds {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

const LIGHT_EMISSION_MAP = new Map(BLOCK_PALETTE.map((b) => [b.id, b.lightLevel]));

export class VoxelWorld {
  readonly chunks = new Map<string, CubicChunk>();
  readonly plot: PlotBounds;
  readonly roads = [46, 142, 238] as const;
  private lightSources = new Map<string, number>();

  constructor(plot: PlotBounds = { x0: 100, x1: 132, z0: 156, z1: 188 }) {
    this.plot = plot;
  }

  static chunkKey(cx: number, cy: number, cz: number): string {
    return `${cx},${cy},${cz}`;
  }

  getOrCreateChunk(cx: number, cy: number, cz: number): CubicChunk {
    const key = VoxelWorld.chunkKey(cx, cy, cz);
    let chunk = this.chunks.get(key);
    if (!chunk) {
      chunk = new CubicChunk(cx, cy, cz);
      this.chunks.set(key, chunk);
    }
    return chunk;
  }

  inBounds(x: number, y: number, z: number): boolean {
    return (
      Number.isInteger(x) &&
      Number.isInteger(y) &&
      Number.isInteger(z) &&
      x >= 0 &&
      x < TUNING.world.sizeX &&
      z >= 0 &&
      z < TUNING.world.sizeZ &&
      y >= TUNING.world.yMin &&
      y <= TUNING.world.yMax
    );
  }

  isRoadCoord(v: number): boolean {
    return (v >= 46 && v < 50) || (v >= 142 && v < 146) || (v >= 238 && v < 242);
  }

  getZone(x: number, y: number, z: number): ZoneKind {
    if (!this.inBounds(x, y, z)) return 'oob';
    if (y === TUNING.world.yMin) return 'core';
    if ((this.isRoadCoord(x) || this.isRoadCoord(z)) && y >= -2 && y < 5) return 'core';
    if (x >= 128 && x < 160 && z >= 128 && z < 160 && y >= -4 && y < 24) return 'core';
    if (x >= this.plot.x0 && x < this.plot.x1 && z >= this.plot.z0 && z < this.plot.z1 && y > TUNING.world.yMin) {
      return 'plot';
    }
    // Check city prefab zones in each sector center
    for (const cx of [48, 144, 240]) {
      for (const cz of [48, 144, 240]) {
        if (cx === 144 && cz === 144) continue;
        if (x >= cx + 4 && x < cx + 20 && z >= cz + 4 && z < cz + 20 && y >= -2 && y < 16) {
          return 'city';
        }
      }
    }
    return 'wild';
  }

  getBlock(x: number, y: number, z: number): number {
    if (!this.inBounds(x, y, z)) return 6; // bedrock outside bounds
    const cx = Math.floor(x / CHUNK_SIZE);
    const cy = Math.floor(y / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const chunk = this.chunks.get(VoxelWorld.chunkKey(cx, cy, cz));
    if (!chunk) return 0;
    const lx = ((x % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const ly = ((y % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((z % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    return chunk.getVoxel(lx, ly, lz);
  }

  /**
   * Single block mutation entrypoint for VoxelWorld (WP-202).
   * Enforces bounds, zone permissions, and updates light source registry.
   */
  setBlock(
    actor: { id: string; isOwner?: boolean; permittedOnPlot?: boolean; isSystemGen?: boolean },
    x: number,
    y: number,
    z: number,
    blockId: number
  ): { ok: boolean; reason?: string } {
    if (!this.inBounds(x, y, z)) return { ok: false, reason: 'oob' };
    const zone = this.getZone(x, y, z);
    if (zone === 'core' && !actor.isSystemGen) {
      return { ok: false, reason: '보호 구역이에요' };
    }
    if (zone === 'plot' && !actor.isOwner && !actor.permittedOnPlot && !actor.isSystemGen) {
      return { ok: false, reason: '남의 부지예요' };
    }

    const cx = Math.floor(x / CHUNK_SIZE);
    const cy = Math.floor(y / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const chunk = this.getOrCreateChunk(cx, cy, cz);
    const lx = ((x % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const ly = ((y % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((z % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;

    chunk.setVoxelInternal(lx, ly, lz, blockId);

    const posKey = `${x},${y},${z}`;
    const light = LIGHT_EMISSION_MAP.get(blockId) ?? 0;
    if (light > 0) this.lightSources.set(posKey, light);
    else this.lightSources.delete(posKey);

    return { ok: true };
  }

  getLightSourcesInChunk(
    cx: number,
    cy: number,
    cz: number
  ): Array<{ lx: number; ly: number; lz: number; level: number }> {
    const out: Array<{ lx: number; ly: number; lz: number; level: number }> = [];
    const x0 = cx * CHUNK_SIZE;
    const y0 = cy * CHUNK_SIZE;
    const z0 = cz * CHUNK_SIZE;
    for (const [k, level] of this.lightSources) {
      const [xs, ys, zs] = k.split(',');
      const x = Number(xs);
      const y = Number(ys);
      const z = Number(zs);
      if (
        x >= x0 &&
        x < x0 + CHUNK_SIZE &&
        y >= y0 &&
        y < y0 + CHUNK_SIZE &&
        z >= z0 &&
        z < z0 + CHUNK_SIZE
      ) {
        out.push({ lx: x - x0, ly: y - y0, lz: z - z0, level });
      }
    }
    return out;
  }
}
