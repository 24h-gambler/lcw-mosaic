import { BLOCK_PALETTE } from '@lcw/content';
import { TUNING } from './tuning.js';
import { CHUNK_SIZE, CubicChunk } from './chunk.js';
import { fillNaturalChunk, naturalBlock } from './natural.js';

export type ZoneKind = 'oob' | 'core' | 'city' | 'plot' | 'wild';

export interface PlotBounds {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

const LIGHT_EMISSION_MAP = new Map(BLOCK_PALETTE.map((b) => [b.id, b.lightLevel]));

/** Who writes a block (WP-202): the zone rules below decide by this. */
export interface BlockActor {
  id: string;
  isOwner?: boolean;
  permittedOnPlot?: boolean;
  isSystemGen?: boolean;
  /**
   * R326 free build: the edit was judged by the town rules (sim-core plot.ts `buildCellRule`, which protects the town's
   * places by its own table). The old sector zones' road strips (`isRoadCoord`, from the generated sector layout) are
   * plain meadow in the hand-built town, so they do not refuse such an edit; the plot still needs its owner.
   */
  townRules?: boolean;
}

export class VoxelWorld {
  readonly chunks = new Map<string, CubicChunk>();
  readonly plot: PlotBounds;
  readonly roads = [46, 142, 238] as const;
  private lightSources = new Map<string, number>();
  /** last chunk setBlock wrote to: town building writes long runs into the same chunk */
  private lastChunk: CubicChunk | null = null;

  /**
   * R2861①: the world is the natural ground (natural.ts) wherever nothing was written: a new chunk starts filled with
   * it and a chunk never made reads as it. Off (`{ natural: false }`) only for tests of a bare grid.
   */
  readonly natural: boolean;

  constructor(plot: PlotBounds = { x0: 100, x1: 132, z0: 156, z1: 188 }, opts: { natural?: boolean } = {}) {
    this.plot = plot;
    this.natural = opts.natural ?? true;
  }

  static chunkKey(cx: number, cy: number, cz: number): string {
    return `${cx},${cy},${cz}`;
  }

  getOrCreateChunk(cx: number, cy: number, cz: number): CubicChunk {
    const key = VoxelWorld.chunkKey(cx, cy, cz);
    let chunk = this.chunks.get(key);
    if (!chunk) {
      chunk = new CubicChunk(cx, cy, cz);
      if (this.natural) fillNaturalChunk(chunk);
      this.chunks.set(key, chunk);
    }
    return chunk;
  }

  inBounds(x: number, y: number, z: number): boolean {
    return (
      Number.isInteger(x) &&
      Number.isInteger(y) &&
      Number.isInteger(z) &&
      x >= TUNING.world.openMin &&
      x < TUNING.world.openMax &&
      z >= TUNING.world.openMin &&
      z < TUNING.world.openMax &&
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
    // The plot comes before the plaza square: their corners overlap (x 128..131, z 156..159) and every cell inside
    // the fence must be the owner's, or the aim shows green where the place is then refused.
    if (x >= this.plot.x0 && x < this.plot.x1 && z >= this.plot.z0 && z < this.plot.z1) return 'plot';
    if ((this.isRoadCoord(x) || this.isRoadCoord(z)) && y >= -2 && y < 5) return 'core';
    if (x >= 128 && x < 160 && z >= 128 && z < 160 && y >= -4 && y < 24) return 'core';
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
    if (!chunk) return this.natural ? naturalBlock(x, y, z) : 0;
    const lx = ((x % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const ly = ((y % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((z % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    return chunk.getVoxel(lx, ly, lz);
  }

  /**
   * Single block mutation entrypoint for VoxelWorld (WP-202).
   * Enforces bounds, zone permissions, and updates light source registry.
   */
  setBlock(actor: BlockActor, x: number, y: number, z: number, blockId: number): { ok: boolean; reason?: string } {
    const denied = this.editDenied(actor, x, y, z);
    if (denied) return denied;

    const cx = Math.floor(x / CHUNK_SIZE);
    const cy = Math.floor(y / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const last = this.lastChunk;
    const chunk = last && last.cx === cx && last.cy === cy && last.cz === cz ? last : this.getOrCreateChunk(cx, cy, cz);
    this.lastChunk = chunk;
    const lx = x - cx * CHUNK_SIZE;
    const ly = y - cy * CHUNK_SIZE;
    const lz = z - cz * CHUNK_SIZE;

    const prev = chunk.getVoxel(lx, ly, lz);
    chunk.setVoxelInternal(lx, ly, lz, blockId);

    // the light registry changes only when a light block comes or goes (no key string for every plain block)
    const light = LIGHT_EMISSION_MAP.get(blockId) ?? 0;
    if (light > 0) this.lightSources.set(`${x},${y},${z}`, light);
    else if ((LIGHT_EMISSION_MAP.get(prev) ?? 0) > 0) this.lightSources.delete(`${x},${y},${z}`);

    return { ok: true };
  }

  /** The bounds and zone checks of `setBlock` (null: the write may go ahead). */
  protected editDenied(actor: BlockActor, x: number, y: number, z: number): { ok: false; reason: string } | null {
    if (!this.inBounds(x, y, z)) return { ok: false, reason: 'oob' };
    // zones only limit players; the town generator writes everywhere (and skips the zone walk: ~320k writes at start)
    if (actor.isSystemGen) return null;
    const zone = this.getZone(x, y, z);
    if (zone === 'core' && !actor.townRules) return { ok: false, reason: '보호 구역이에요' };
    if (zone === 'plot' && !actor.isOwner && !actor.permittedOnPlot) return { ok: false, reason: '남의 부지예요' };
    return null;
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

const OPEN_W = TUNING.world.openMax - TUNING.world.openMin;

/**
 * One number per cell of the open world (x, z in openMin..openMax, y in yMin..yMax): 60 000 x 60 000 x 3 049 cells
 * is ~1.1e13, a safe integer (< 2^53). In memory only (the client's TownDelta, the server's OverlayWorld): the
 * stores keep x, y, z.
 */
export function cellIndex(x: number, y: number, z: number): number {
  return ((y - TUNING.world.yMin) * OPEN_W + (z - TUNING.world.openMin)) * OPEN_W + (x - TUNING.world.openMin);
}

/** The cell back from `cellIndex`. */
export function cellOfIndex(i: number): [number, number, number] {
  const x = i % OPEN_W;
  const r = (i - x) / OPEN_W;
  const z = r % OPEN_W;
  return [x + TUNING.world.openMin, (r - z) / OPEN_W + TUNING.world.yMin, z + TUNING.world.openMin];
}

/**
 * A child's world on the server (R326 free build, docs/03 D13): reads through to one shared town built once per
 * isolate and holds only the cells this child changed (one Map entry each, a cell set back to the town's block drops
 * out). The whole town is ~516 chunks (~6.7 MB); a copy per child would not fit the resident worlds of one Durable
 * Object, a delta of at most `TUNING.building.freeMaxCells` cells does. Every write still goes through `setBlock` with
 * the same bounds and zone checks (AGENTS 4.1). Light sources are not tracked here: the server never meshes or lights.
 */
export class OverlayWorld extends VoxelWorld {
  private readonly cells = new Map<number, number>();
  private outside = 0;

  constructor(readonly base: VoxelWorld) {
    super(base.plot, { natural: base.natural });
  }

  /** Changed cells outside the plot (the free-build budget counts these). */
  get changedOutsidePlot(): number {
    return this.outside;
  }

  get changedCount(): number {
    return this.cells.size;
  }

  private inPlotXZ(x: number, z: number): boolean {
    return x >= this.plot.x0 && x < this.plot.x1 && z >= this.plot.z0 && z < this.plot.z1;
  }

  override getBlock(x: number, y: number, z: number): number {
    if (!this.inBounds(x, y, z)) return 6;
    const v = this.cells.get(cellIndex(x, y, z));
    return v === undefined ? this.base.getBlock(x, y, z) : v;
  }

  override setBlock(actor: BlockActor, x: number, y: number, z: number, blockId: number): { ok: boolean; reason?: string } {
    const denied = this.editDenied(actor, x, y, z);
    if (denied) return denied;
    const k = cellIndex(x, y, z);
    const had = this.cells.has(k);
    const differs = blockId !== this.base.getBlock(x, y, z);
    if (differs) this.cells.set(k, blockId);
    else this.cells.delete(k);
    if (had !== differs && !this.inPlotXZ(x, z)) this.outside += differs ? 1 : -1;
    return { ok: true };
  }
}
