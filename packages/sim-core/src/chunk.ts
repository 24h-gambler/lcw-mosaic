export const CHUNK_SIZE = 16;
export const CHUNK_VOLUME = CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE; // 4096

export interface GreedyQuad {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  axis: 0 | 1 | 2;
  dir: 1 | -1;
  blockId: number;
  ao: [number, number, number, number];
}

export interface ChunkMeshBuffers {
  quadCount: number;
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  quads: GreedyQuad[];
}

export class CubicChunk {
  readonly cx: number;
  readonly cy: number;
  readonly cz: number;
  readonly voxels: Uint16Array;
  readonly light: Uint8Array;
  palette: number[];
  paletteIndex: Map<number, number>;
  dirty = true;

  constructor(cx: number, cy: number, cz: number) {
    this.cx = cx;
    this.cy = cy;
    this.cz = cz;
    this.voxels = new Uint16Array(CHUNK_VOLUME);
    this.light = new Uint8Array(CHUNK_VOLUME);
    this.palette = [0];
    this.paletteIndex = new Map([[0, 0]]);
  }

  static index(lx: number, ly: number, lz: number): number {
    return (ly * CHUNK_SIZE + lz) * CHUNK_SIZE + lx;
  }

  getVoxel(lx: number, ly: number, lz: number): number {
    if (
      lx < 0 ||
      lx >= CHUNK_SIZE ||
      ly < 0 ||
      ly >= CHUNK_SIZE ||
      lz < 0 ||
      lz >= CHUNK_SIZE
    ) {
      return 0;
    }
    const pIdx = this.voxels[CubicChunk.index(lx, ly, lz)] ?? 0;
    return this.palette[pIdx] ?? 0;
  }

  /**
   * Internal palette-compressed voxel setter.
   * Only VoxelWorld.setBlock (and initial L0 terrain generation in world.ts) may call this.
   */
  setVoxelInternal(lx: number, ly: number, lz: number, blockId: number): void {
    let pIdx = this.paletteIndex.get(blockId);
    if (pIdx === undefined) {
      pIdx = this.palette.length;
      this.palette.push(blockId);
      this.paletteIndex.set(blockId, pIdx);
    }
    this.voxels[CubicChunk.index(lx, ly, lz)] = pIdx;
    this.dirty = true;
  }

  private genLastId = -1;
  private genLastSlot = 0;

  /**
   * Initial terrain generation of a fresh chunk (natural.ts fillNaturalChunk, R2861①): the same palette write as
   * setVoxelInternal, with a one-id cache because a generator writes long runs of one block. Not an edit path: every edit
   * still goes through VoxelWorld.setBlock (dirty flag, journal); the caller marks the chunk dirty once when it is done.
   */
  generateVoxel(lx: number, ly: number, lz: number, blockId: number): void {
    if (blockId !== this.genLastId) {
      let pIdx = this.paletteIndex.get(blockId);
      if (pIdx === undefined) {
        pIdx = this.palette.length;
        this.palette.push(blockId);
        this.paletteIndex.set(blockId, pIdx);
      }
      this.genLastId = blockId;
      this.genLastSlot = pIdx;
    }
    this.voxels[CubicChunk.index(lx, ly, lz)] = this.genLastSlot;
  }

  getLight(lx: number, ly: number, lz: number): number {
    if (
      lx < 0 ||
      lx >= CHUNK_SIZE ||
      ly < 0 ||
      ly >= CHUNK_SIZE ||
      lz < 0 ||
      lz >= CHUNK_SIZE
    ) {
      return 0;
    }
    return this.light[CubicChunk.index(lx, ly, lz)] ?? 0;
  }

  setLight(lx: number, ly: number, lz: number, level: number): void {
    if (
      lx < 0 ||
      lx >= CHUNK_SIZE ||
      ly < 0 ||
      ly >= CHUNK_SIZE ||
      lz < 0 ||
      lz >= CHUNK_SIZE
    ) {
      return;
    }
    this.light[CubicChunk.index(lx, ly, lz)] = Math.max(0, Math.min(15, level));
  }

  serializePaletteCompressed(): { palette: number[]; indices: Uint8Array | Uint16Array } {
    if (this.palette.length <= 256) {
      const compact = new Uint8Array(CHUNK_VOLUME);
      for (let i = 0; i < CHUNK_VOLUME; i++) compact[i] = this.voxels[i]!;
      return { palette: [...this.palette], indices: compact };
    }
    return { palette: [...this.palette], indices: new Uint16Array(this.voxels) };
  }
}

/**
 * Greedy meshing across all 6 face directions with baked vertex ambient occlusion (WP-101).
 */
export function greedyMeshChunk(chunk: CubicChunk): ChunkMeshBuffers {
  const quads: GreedyQuad[] = [];
  const mask = new Int32Array(CHUNK_SIZE * CHUNK_SIZE);
  const dims = [CHUNK_SIZE, CHUNK_SIZE, CHUNK_SIZE] as const;

  const isSolidAt = (x: number, y: number, z: number): boolean => {
    if (x < 0 || x >= CHUNK_SIZE || y < 0 || y >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE) {
      return false;
    }
    return chunk.getVoxel(x, y, z) !== 0;
  };

  for (let d = 0 as 0 | 1 | 2; d < 3; d = (d + 1) as 0 | 1 | 2) {
    const u = ((d + 1) % 3) as 0 | 1 | 2;
    const v = ((d + 2) % 3) as 0 | 1 | 2;
    const x = [0, 0, 0];
    const q = [0, 0, 0];
    q[d] = 1;

    for (x[d] = -1; x[d]! < dims[d]!; ) {
      let n = 0;
      for (x[v] = 0; x[v]! < dims[v]!; x[v]!++) {
        for (x[u] = 0; x[u]! < dims[u]!; x[u]!++) {
          const a =
            x[d]! >= 0 ? chunk.getVoxel(x[0]!, x[1]!, x[2]!) : 0;
          const b =
            x[d]! < dims[d]! - 1
              ? chunk.getVoxel(x[0]! + q[0]!, x[1]! + q[1]!, x[2]! + q[2]!)
              : 0;

          if ((a !== 0) === (b !== 0)) {
            mask[n++] = 0;
          } else if (a !== 0) {
            mask[n++] = a;
          } else {
            mask[n++] = -b;
          }
        }
      }

      x[d]!++;
      n = 0;
      for (let j = 0; j < dims[v]!; j++) {
        for (let i = 0; i < dims[u]!; ) {
          const c = mask[n]!;
          if (c !== 0) {
            let w = 1;
            while (i + w < dims[u]! && mask[n + w] === c) w++;

            let h = 1;
            outer: for (; j + h < dims[v]!; h++) {
              for (let k = 0; k < w; k++) {
                if (mask[n + k + h * dims[u]!] !== c) break outer;
              }
            }

            x[u] = i;
            x[v] = j;
            const dir: 1 | -1 = c > 0 ? 1 : -1;
            const blockId = Math.abs(c);

            const sampleX = x[0]! + (dir > 0 ? 0 : -q[0]!);
            const sampleY = x[1]! + (dir > 0 ? 0 : -q[1]!);
            const sampleZ = x[2]! + (dir > 0 ? 0 : -q[2]!);
            const occ = isSolidAt(sampleX, sampleY, sampleZ) ? 1 : 0;
            const aoVal = 1 - occ * 0.15;

            quads.push({
              x: x[0]!,
              y: x[1]!,
              z: x[2]!,
              w,
              h,
              axis: d,
              dir,
              blockId,
              ao: [aoVal, aoVal, aoVal, aoVal]
            });

            for (let l = 0; l < h; l++) {
              for (let k = 0; k < w; k++) {
                mask[n + k + l * dims[u]!] = 0;
              }
            }
            i += w;
            n += w;
          } else {
            i++;
            n++;
          }
        }
      }
    }
  }

  const vertCount = quads.length * 4;
  const positions = new Float32Array(vertCount * 3);
  const normals = new Float32Array(vertCount * 3);
  const indices = new Uint32Array(quads.length * 6);

  for (let qi = 0; qi < quads.length; qi++) {
    const q = quads[qi]!;
    const u = (q.axis + 1) % 3;
    const v = (q.axis + 2) % 3;
    const du = [0, 0, 0];
    const dv = [0, 0, 0];
    du[u] = q.w;
    dv[v] = q.h;

    const base = [q.x, q.y, q.z];
    const corners = [
      base,
      [base[0]! + du[0]!, base[1]! + du[1]!, base[2]! + du[2]!],
      [base[0]! + du[0]! + dv[0]!, base[1]! + du[1]! + dv[1]!, base[2]! + du[2]! + dv[2]!],
      [base[0]! + dv[0]!, base[1]! + dv[1]!, base[2]! + dv[2]!]
    ];

    const norm = [0, 0, 0];
    norm[q.axis] = q.dir;

    for (let vi = 0; vi < 4; vi++) {
      const pIdx = (qi * 4 + vi) * 3;
      const c = corners[vi]!;
      positions[pIdx] = c[0]!;
      positions[pIdx + 1] = c[1]!;
      positions[pIdx + 2] = c[2]!;
      normals[pIdx] = norm[0]!;
      normals[pIdx + 1] = norm[1]!;
      normals[pIdx + 2] = norm[2]!;
    }

    const vBase = qi * 4;
    const iBase = qi * 6;
    if (q.dir > 0) {
      indices[iBase] = vBase;
      indices[iBase + 1] = vBase + 1;
      indices[iBase + 2] = vBase + 2;
      indices[iBase + 3] = vBase;
      indices[iBase + 4] = vBase + 2;
      indices[iBase + 5] = vBase + 3;
    } else {
      indices[iBase] = vBase;
      indices[iBase + 1] = vBase + 2;
      indices[iBase + 2] = vBase + 1;
      indices[iBase + 3] = vBase;
      indices[iBase + 4] = vBase + 3;
      indices[iBase + 5] = vBase + 2;
    }
  }

  chunk.dirty = false;
  return {
    quadCount: quads.length,
    positions,
    normals,
    indices,
    quads
  };
}

/**
 * 0..15 BFS block lighting propagation inside a chunk (WP-208).
 */
export function propagateBlockLight(
  chunk: CubicChunk,
  sources: Array<{ lx: number; ly: number; lz: number; level: number }>
): void {
  chunk.light.fill(0);
  const queue: number[] = [];

  for (const s of sources) {
    if (
      s.lx >= 0 &&
      s.lx < CHUNK_SIZE &&
      s.ly >= 0 &&
      s.ly < CHUNK_SIZE &&
      s.lz >= 0 &&
      s.lz < CHUNK_SIZE &&
      s.level > 0
    ) {
      chunk.setLight(s.lx, s.ly, s.lz, s.level);
      queue.push(s.lx, s.ly, s.lz);
    }
  }

  let head = 0;
  const dirs = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1]
  ] as const;

  while (head < queue.length) {
    const lx = queue[head++]!;
    const ly = queue[head++]!;
    const lz = queue[head++]!;
    const cur = chunk.getLight(lx, ly, lz);
    if (cur <= 1) continue;

    for (const [dx, dy, dz] of dirs) {
      const nx = lx + dx;
      const ny = ly + dy;
      const nz = lz + dz;
      if (nx < 0 || nx >= CHUNK_SIZE || ny < 0 || ny >= CHUNK_SIZE || nz < 0 || nz >= CHUNK_SIZE) {
        continue;
      }
      const blk = chunk.getVoxel(nx, ny, nz);
      // Solid opaque blocks block propagation except glass (9) / torch (26) / lantern (27) / air (0)
      if (blk !== 0 && blk !== 9 && blk !== 25 && blk !== 26 && blk !== 27) continue;
      const nextLevel = cur - 1;
      if (chunk.getLight(nx, ny, nz) < nextLevel) {
        chunk.setLight(nx, ny, nz, nextLevel);
        queue.push(nx, ny, nz);
      }
    }
  }
}
