/**
 * Chunk mesher (WP-101): greedy meshing of full cubes with per-vertex ambient occlusion baked at mesh time
 * (docs/08 6.3 "블록 꼭짓점 주변 가림(AO)을 메싱 때 구움"), plus crossed quads for plants and sub-box shapes.
 * Pure and DOM-free: runs in the meshing Worker, and synchronously in tests / when Workers are unavailable.
 *
 * Input is a padded 18^3 block-id grid (the chunk plus a one-block border from neighbors) so faces and AO
 * at chunk edges are correct without touching other chunks.
 */
import { BLOCK_LOOKS, TILE_LAYER, blockLook, type Box16 } from './blocks.js';
import { LIGHT_PAD, MAX_LIGHT, computeLight } from './voxel-light.js';

export const CS = 16;
export const PAD = CS + 2;
export const PAD_VOLUME = PAD * PAD * PAD;

export function padIndex(x: number, y: number, z: number): number {
  // x, y, z in -1..16 (chunk-local); stored with +1 offset.
  return ((y + 1) * PAD + (z + 1)) * PAD + (x + 1);
}

export interface GeoBuffers {
  position: Float32Array;
  normal: Float32Array;
  /** (u, v) in block units for tiling, texture layer, glow 0..1 */
  tile: Float32Array;
  /** per vertex: r = AO brightness, g = sky light, b = block light (0..1 each; voxel-light.ts) */
  color: Float32Array;
  index: Uint32Array;
  quads: number;
}

export interface ChunkMesh {
  opaque: GeoBuffers;
  translucent: GeoBuffers;
}

const SHAPE_NONE = 0;
const SHAPE_CUBE = 1;
const SHAPE_CUTOUT = 2;
const SHAPE_GLASS = 3;
const SHAPE_WATER = 4;
const SHAPE_PLANT = 5;
const SHAPE_BOXES = 6;

const TABLE_SIZE = 256;
const shapeOf = new Uint8Array(TABLE_SIZE);
const tileTop = new Uint16Array(TABLE_SIZE);
const tileSide = new Uint16Array(TABLE_SIZE);
const tileBottom = new Uint16Array(TABLE_SIZE);
const glowOf = new Float32Array(TABLE_SIZE);
const boxesOf: Array<readonly Box16[] | undefined> = [];
(() => {
  const code = { none: 0, cube: 1, cutout: 2, glass: 3, water: 4, plant: 5, boxes: 6 } as const;
  for (let id = 0; id < TABLE_SIZE; id++) {
    const look = id < BLOCK_LOOKS.length ? blockLook(id) : blockLook(1);
    shapeOf[id] = id === 0 ? 0 : code[look.shape];
    tileTop[id] = TILE_LAYER[look.top] ?? 0;
    tileSide[id] = TILE_LAYER[look.side] ?? 0;
    tileBottom[id] = TILE_LAYER[look.bottom] ?? 0;
    glowOf[id] = look.glow / 15;
    boxesOf[id] = look.boxes;
  }
})();

const FENCE_ID = 22;
/** Lowest generated ground layer (town.ts terrain fills y = -2..h). */
export const GROUND_FLOOR_Y = -2;

/** AO level 0..3 to brightness. Level 3 = fully open. */
export const AO_CURVE = [0.5, 0.67, 0.83, 1.0] as const;

const FULL4: readonly number[] = [1, 1, 1, 1];
const ZERO4: readonly number[] = [0, 0, 0, 0];

/**
 * A grid with light (chunks.ts extractLit): side `n` = 16 + 2 * LIGHT_PAD, and which columns are open to the sky above
 * the grid's top. Without it the mesher reads the classic 18^3 grid and lights everything as open sky.
 */
export interface LitGrid {
  n: number;
  skyAbove: Uint8Array;
}

class Builder {
  pos: number[] = [];
  nor: number[] = [];
  tile: number[] = [];
  col: number[] = [];
  idx: number[] = [];
  quads = 0;

  /** Corners in order c0 (0,0), c1 (w,0), c2 (w,h), c3 (0,h). */
  quad(
    c: readonly number[],
    n: readonly [number, number, number],
    uv: readonly number[],
    layer: number,
    glow: number,
    ao: readonly [number, number, number, number],
    flipWinding: boolean,
    flipDiagonal: boolean,
    sky: readonly number[] = FULL4,
    blk: readonly number[] = ZERO4
  ): void {
    const base = this.pos.length / 3;
    for (let i = 0; i < 4; i++) {
      this.pos.push(c[i * 3]!, c[i * 3 + 1]!, c[i * 3 + 2]!);
      this.nor.push(n[0], n[1], n[2]);
      this.tile.push(uv[i * 2]!, uv[i * 2 + 1]!, layer, glow);
      this.col.push(ao[i]!, sky[i]!, blk[i]!);
    }
    // Two triangles; diagonal chosen so AO interpolates without the anisotropy seam.
    let tri = flipDiagonal ? [1, 2, 3, 1, 3, 0] : [0, 1, 2, 0, 2, 3];
    if (flipWinding) tri = [tri[0]!, tri[2]!, tri[1]!, tri[3]!, tri[5]!, tri[4]!];
    for (const t of tri) this.idx.push(base + t);
    this.quads++;
  }

  finish(): GeoBuffers {
    return {
      position: new Float32Array(this.pos),
      normal: new Float32Array(this.nor),
      tile: new Float32Array(this.tile),
      color: new Float32Array(this.col),
      index: new Uint32Array(this.idx),
      quads: this.quads
    };
  }
}

interface FaceDef {
  axis: 0 | 1 | 2;
  sign: 1 | -1;
  u: 0 | 1 | 2;
  v: 0 | 1 | 2;
  normal: [number, number, number];
  /** true when (u x v) points against the normal, so the default winding must be flipped */
  flip: boolean;
  slot: 0 | 1 | 2; // 0 top, 1 side, 2 bottom
}

function makeFace(axis: 0 | 1 | 2, sign: 1 | -1): FaceDef {
  const u = (axis === 0 ? 2 : 0) as 0 | 1 | 2;
  const v = (axis === 1 ? 2 : 1) as 0 | 1 | 2;
  const uv = [0, 0, 0];
  const vv = [0, 0, 0];
  uv[u] = 1;
  vv[v] = 1;
  const cross = [
    uv[1]! * vv[2]! - uv[2]! * vv[1]!,
    uv[2]! * vv[0]! - uv[0]! * vv[2]!,
    uv[0]! * vv[1]! - uv[1]! * vv[0]!
  ];
  const normal: [number, number, number] = [0, 0, 0];
  normal[axis] = sign;
  const dot = cross[0]! * normal[0] + cross[1]! * normal[1] + cross[2]! * normal[2];
  return {
    axis,
    sign,
    u,
    v,
    normal,
    flip: dot < 0,
    slot: axis === 1 ? (sign > 0 ? 0 : 2) : 1
  };
}

export const FACES: readonly FaceDef[] = [
  makeFace(0, 1),
  makeFace(0, -1),
  makeFace(1, 1),
  makeFace(1, -1),
  makeFace(2, 1),
  makeFace(2, -1)
];

function tileFor(id: number, slot: 0 | 1 | 2): number {
  return slot === 0 ? tileTop[id]! : slot === 1 ? tileSide[id]! : tileBottom[id]!;
}

function hash3(x: number, y: number, z: number): number {
  let h = Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Mesh one chunk. `vox` is the padded grid; `origin` is the chunk's world min corner, used only to vary plants.
 */
export function meshChunk(vox: Uint16Array, origin: readonly [number, number, number] = [0, 0, 0], lit?: LitGrid): ChunkMesh {
  const opaque = new Builder();
  const trans = new Builder();
  const P = lit ? LIGHT_PAD : 1;
  const N = lit ? lit.n : PAD;
  const cell = (x: number, y: number, z: number): number => ((y + P) * N + (z + P)) * N + (x + P);
  const at = (x: number, y: number, z: number): number => vox[cell(x, y, z)]!;
  const solid = (x: number, y: number, z: number): boolean => shapeOf[at(x, y, z)] === SHAPE_CUBE;
  const light = lit ? computeLight(vox, N, lit.skyAbove) : null;
  /** sky and block light (0..15) of a cell; open sky and no lamps without a lit grid */
  const skyAt = (x: number, y: number, z: number): number => (light ? light.sky[cell(x, y, z)]! : MAX_LIGHT);
  const blkAt = (x: number, y: number, z: number): number => (light ? light.block[cell(x, y, z)]! : 0);
  const mask2 = new Int32Array(CS * CS);
  const skyV = [1, 1, 1, 1];
  const blkV = [0, 0, 0, 0];

  const mask = new Int32Array(CS * CS);
  const p = [0, 0, 0];
  const corners = new Array<number>(12).fill(0);
  const uvs = new Array<number>(8).fill(0);
  const ao: [number, number, number, number] = [1, 1, 1, 1];

  for (let pass = 0; pass < 2; pass++) {
    const out = pass === 0 ? opaque : trans;
    for (const f of FACES) {
      const { axis, sign, u, v } = f;
      for (let d = 0; d < CS; d++) {
        // Build the mask for this slice.
        let n = 0;
        for (let j = 0; j < CS; j++) {
          for (let i = 0; i < CS; i++) {
            p[axis] = d;
            p[u] = i;
            p[v] = j;
            const id = at(p[0]!, p[1]!, p[2]!);
            const sh = shapeOf[id]!;
            let key = 0;
            const inPass = pass === 0 ? sh === SHAPE_CUBE || sh === SHAPE_CUTOUT : sh === SHAPE_GLASS || sh === SHAPE_WATER;
            if (inPass) {
              const qx = p[0]! + (axis === 0 ? sign : 0);
              const qy = p[1]! + (axis === 1 ? sign : 0);
              const qz = p[2]! + (axis === 2 ? sign : 0);
              const nb = at(qx, qy, qz);
              const nbShape = shapeOf[nb]!;
              let visible = nbShape !== SHAPE_CUBE && nb !== id;
              // Nobody sees the underside of the ground: skip downward faces at or below the bottom layer.
              if (axis === 1 && sign < 0 && origin[1] + p[1]! <= GROUND_FLOOR_Y) visible = false;
              // Water surface under a non-water block still shows its lowered top.
              if (sh === SHAPE_WATER && axis === 1 && sign > 0 && nb !== id && nbShape === SHAPE_CUBE) visible = true;
              if (visible) {
                let aoPack = 0xff; // all 3s
                let lightPack = 0;
                {
                  // smooth light: per corner, the mean of the open cells among the face's front cell and its 3 neighbours
                  // at that corner (the corner cell only counts when the two sides are not both solid, like the AO)
                  for (let k = 0; k < 4; k++) {
                    const du = k === 1 || k === 2 ? 1 : -1;
                    const dv = k >= 2 ? 1 : -1;
                    const ax = qx + (u === 0 ? du : 0);
                    const ay = qy + (u === 1 ? du : 0);
                    const az = qz + (u === 2 ? du : 0);
                    const bx = qx + (v === 0 ? dv : 0);
                    const by = qy + (v === 1 ? dv : 0);
                    const bz = qz + (v === 2 ? dv : 0);
                    const sa = solid(ax, ay, az);
                    const sb = solid(bx, by, bz);
                    let ls = skyAt(qx, qy, qz);
                    let lb = blkAt(qx, qy, qz);
                    let cnt = 1;
                    if (!sa) {
                      ls += skyAt(ax, ay, az);
                      lb += blkAt(ax, ay, az);
                      cnt++;
                    }
                    if (!sb) {
                      ls += skyAt(bx, by, bz);
                      lb += blkAt(bx, by, bz);
                      cnt++;
                    }
                    if (!(sa && sb)) {
                      const cx2 = ax + (v === 0 ? dv : 0);
                      const cy2 = ay + (v === 1 ? dv : 0);
                      const cz2 = az + (v === 2 ? dv : 0);
                      if (!solid(cx2, cy2, cz2)) {
                        ls += skyAt(cx2, cy2, cz2);
                        lb += blkAt(cx2, cy2, cz2);
                        cnt++;
                      }
                    }
                    lightPack |= (Math.round(ls / cnt) << (k * 4)) | (Math.round(lb / cnt) << (16 + k * 4));
                  }
                }
                mask2[n] = lightPack;
                if (pass === 0) {
                  aoPack = 0;
                  for (let k = 0; k < 4; k++) {
                    const du = k === 1 || k === 2 ? 1 : -1;
                    const dv = k >= 2 ? 1 : -1;
                    const s1x = qx + (u === 0 ? du : 0) + (v === 0 ? 0 : 0);
                    const s1y = qy + (u === 1 ? du : 0);
                    const s1z = qz + (u === 2 ? du : 0);
                    const s2x = qx + (v === 0 ? dv : 0);
                    const s2y = qy + (v === 1 ? dv : 0);
                    const s2z = qz + (v === 2 ? dv : 0);
                    const s1 = solid(s1x, s1y, s1z) ? 1 : 0;
                    const s2 = solid(s2x, s2y, s2z) ? 1 : 0;
                    const cx = qx + (u === 0 ? du : 0) + (v === 0 ? dv : 0);
                    const cy = qy + (u === 1 ? du : 0) + (v === 1 ? dv : 0);
                    const cz = qz + (u === 2 ? du : 0) + (v === 2 ? dv : 0);
                    const c = solid(cx, cy, cz) ? 1 : 0;
                    const level = s1 && s2 ? 0 : 3 - (s1 + s2 + c);
                    aoPack |= level << (k * 2);
                  }
                }
                key = 1 + (tileFor(id, f.slot) | (aoPack << 10) | ((sh === SHAPE_WATER ? 1 : 0) << 18) | (Math.round(glowOf[id]! * 15) << 19));
              }
            }
            mask[n++] = key;
          }
        }
        // Greedy merge rectangles of equal keys.
        n = 0;
        for (let j = 0; j < CS; j++) {
          for (let i = 0; i < CS; ) {
            const key = mask[n]!;
            if (key === 0) {
              i++;
              n++;
              continue;
            }
            let w = 1;
            const lp = mask2[n]!;
            while (i + w < CS && mask[n + w] === key && mask2[n + w] === lp) w++;
            let h = 1;
            grow: for (; j + h < CS; h++) {
              for (let k = 0; k < w; k++) if (mask[n + k + h * CS] !== key || mask2[n + k + h * CS] !== lp) break grow;
            }
            const raw = key - 1;
            const layer = raw & 0x3ff;
            const aoPack = (raw >> 10) & 0xff;
            const isWater = ((raw >> 18) & 1) === 1;
            const glow = ((raw >> 19) & 0xf) / 15;
            const plane = d + (sign > 0 ? 1 : 0) - (isWater && axis === 1 && sign > 0 ? 2 / 16 : 0);
            const cu = [i, i + w, i + w, i];
            const cv = [j, j, j + h, j + h];
            for (let k = 0; k < 4; k++) {
              const c3 = [0, 0, 0];
              c3[axis] = plane;
              c3[u] = cu[k]!;
              c3[v] = cv[k]!;
              corners[k * 3] = c3[0]!;
              corners[k * 3 + 1] = c3[1]!;
              corners[k * 3 + 2] = c3[2]!;
              uvs[k * 2] = cu[k]! - i;
              uvs[k * 2 + 1] = cv[k]! - j;
              ao[k] = AO_CURVE[(aoPack >> (k * 2)) & 3]!;
              skyV[k] = ((lp >>> (k * 4)) & 15) / MAX_LIGHT;
              blkV[k] = ((lp >>> (16 + k * 4)) & 15) / MAX_LIGHT;
            }
            const flipDiag = ao[0] + ao[2] < ao[1] + ao[3];
            out.quad(corners, f.normal, uvs, layer, glow, ao, f.flip, flipDiag, skyV, blkV);
            for (let hh = 0; hh < h; hh++) for (let k = 0; k < w; k++) mask[n + k + hh * CS] = 0;
            i += w;
            n += w;
          }
        }
      }
    }
  }

  // Plants and sub-box shapes (not greedy; few per chunk).
  const one: [number, number, number, number] = [1, 1, 1, 1];
  for (let y = 0; y < CS; y++) {
    for (let z = 0; z < CS; z++) {
      for (let x = 0; x < CS; x++) {
        const id = at(x, y, z);
        const sh = shapeOf[id]!;
        if (sh === SHAPE_PLANT || sh === SHAPE_BOXES) {
          const ls = skyAt(x, y, z) / MAX_LIGHT;
          const lb = blkAt(x, y, z) / MAX_LIGHT;
          skyV[0] = skyV[1] = skyV[2] = skyV[3] = ls;
          blkV[0] = blkV[1] = blkV[2] = blkV[3] = lb;
        }
        if (sh === SHAPE_PLANT) {
          const r = hash3(x + origin[0], y + origin[1], z + origin[2]);
          const ox = x + 0.5 + (r - 0.5) * 0.3;
          const oz = z + 0.5 + (hash3(z, x, y) - 0.5) * 0.3;
          const s = 0.42;
          const hgt = 0.85 + r * 0.25;
          const layer = tileSide[id]!;
          const diag: Array<[number, number, number, number]> = [
            [ox - s, oz - s, ox + s, oz + s],
            [ox - s, oz + s, ox + s, oz - s]
          ];
          for (const [x0, z0, x1, z1] of diag) {
            const c = [x0, y, z0, x1, y, z1, x1, y + hgt, z1, x0, y + hgt, z0];
            const uv = [0, 0, 1, 0, 1, hgt, 0, hgt];
            opaque.quad(c, [0, 1, 0], uv, layer, 0, one, false, false, skyV, blkV);
            opaque.quad(c, [0, 1, 0], uv, layer, 0, one, true, false, skyV, blkV);
          }
        } else if (sh === SHAPE_BOXES) {
          const boxes: Box16[] = [...(boxesOf[id] ?? [])];
          if (id === FENCE_ID) {
            const link = (nx: number, nz: number): boolean => {
              const nb = at(x + nx, y, z + nz);
              return nb === FENCE_ID || shapeOf[nb] === SHAPE_CUBE;
            };
            if (link(1, 0)) boxes.push([10, 6, 7, 16, 9, 9], [10, 12, 7, 16, 15, 9]);
            if (link(-1, 0)) boxes.push([0, 6, 7, 6, 9, 9], [0, 12, 7, 6, 15, 9]);
            if (link(0, 1)) boxes.push([7, 6, 10, 9, 9, 16], [7, 12, 10, 9, 15, 16]);
            if (link(0, -1)) boxes.push([7, 6, 0, 9, 9, 6], [7, 12, 0, 9, 15, 6]);
          }
          const glow = glowOf[id]!;
          for (const b of boxes) {
            for (const f of FACES) {
              const { axis, sign, u, v } = f;
              const atEdge = sign > 0 ? b[axis + 3] === 16 : b[axis] === 0;
              if (atEdge) {
                const nx = x + (axis === 0 ? sign : 0);
                const ny = y + (axis === 1 ? sign : 0);
                const nz = z + (axis === 2 ? sign : 0);
                if (solid(nx, ny, nz)) continue;
              }
              const plane = (sign > 0 ? b[axis + 3]! : b[axis]!) / 16;
              const u0 = b[u]! / 16;
              const u1 = b[u + 3]! / 16;
              const v0 = b[v]! / 16;
              const v1 = b[v + 3]! / 16;
              const cu = [u0, u1, u1, u0];
              const cv = [v0, v0, v1, v1];
              const base = [x, y, z];
              for (let k = 0; k < 4; k++) {
                const c3 = [0, 0, 0];
                c3[axis] = base[axis]! + plane;
                c3[u] = base[u]! + cu[k]!;
                c3[v] = base[v]! + cv[k]!;
                corners[k * 3] = c3[0]!;
                corners[k * 3 + 1] = c3[1]!;
                corners[k * 3 + 2] = c3[2]!;
                uvs[k * 2] = cu[k]!;
                uvs[k * 2 + 1] = cv[k]!;
              }
              opaque.quad(corners, f.normal, uvs, tileFor(id, f.slot), glow, one, f.flip, false, skyV, blkV);
            }
          }
        }
        void SHAPE_NONE;
      }
    }
  }

  return { opaque: opaque.finish(), translucent: trans.finish() };
}
