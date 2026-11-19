/**
 * Voxel light (docs/08 6.3 "횃불·랜턴은 0~15 단계 격자 조명 전파", R2627 realism): two light fields over a chunk and a
 * border of LIGHT_PAD blocks around it, computed in the meshing Worker.
 *
 *  - sky light: 15 straight down every column open to the sky (cut-outs such as ladders and bars take 2 per block,
 *    water 1; leaves and every full cube stop it), then spreading sideways and down one level per block. Rooms under a roof get only what comes in through doors and windows, so
 *    an interior reads as an interior; the shade under a tree canopy is darker than the open meadow.
 *  - block light: lanterns, torches and neon (BLOCK_PALETTE lightLevel) spreading the same way, drawn as warm light.
 *
 * Pure and DOM-free (Worker and tests). The mesher reads the fields at the cells in front of each face and smooths
 * them per vertex like the ambient occlusion, then packs them into the vertex colour (r = AO, g = sky, b = block).
 */
import { BLOCK_LOOKS } from './blocks.js';

/**
 * Blocks of border around the 16^3 chunk that the light sees. 14 = MAX_LIGHT - 1, the farthest any light travels, so a
 * cell on a chunk border gets the same light from both chunks (no seams along chunk lines).
 */
export const LIGHT_PAD = 14;
export const MAX_LIGHT = 15;

const TABLE = 256;
/** 255 = blocks light completely; otherwise extra levels lost when light enters the cell */
const extraLoss = new Uint8Array(TABLE);
const emit = new Uint8Array(TABLE);
(() => {
  for (let id = 0; id < TABLE; id++) {
    const look = BLOCK_LOOKS[id];
    if (!look || id === 0) {
      extraLoss[id] = 0;
      continue;
    }
    extraLoss[id] = look.shape === 'cube' ? 255 : look.shape === 'cutout' ? 2 : look.shape === 'water' ? 1 : 0;
    emit[id] = Math.max(0, Math.min(MAX_LIGHT, look.glow | 0));
  }
})();

export function blocksLight(id: number): boolean {
  return extraLoss[id] === 255;
}

/**
 * Light fields for a padded grid of side `n` (index ((y * n) + z) * n + x). `skyAbove[z * n + x]` is 1 when nothing
 * above the grid's top blocks that column. Returns sky and block light per cell (0..15).
 */
export function computeLight(vox: Uint16Array, n: number, skyAbove: Uint8Array | null): { sky: Uint8Array; block: Uint8Array } {
  const size = n * n * n;
  const sky = new Uint8Array(size);
  const block = new Uint8Array(size);
  const queue = new Int32Array(size);
  const nn = n * n;

  // ---- sky: columns open above get full light straight down until something opaque
  let qh = 0;
  let qt = 0;
  for (let z = 0; z < n; z++) {
    for (let x = 0; x < n; x++) {
      if (skyAbove && !skyAbove[z * n + x]) continue;
      let l = MAX_LIGHT;
      for (let y = n - 1; y >= 0; y--) {
        const i = (y * n + z) * n + x;
        const loss = extraLoss[vox[i]!]!;
        if (loss === 255) break;
        l -= loss;
        if (l <= 0) break;
        sky[i] = l;
      }
    }
  }
  // seed the spread only from lit cells that can still give light to a neighbour (an open meadow is all 15 and needs
  // no spreading; only the edges of shade, roofs and walls do) - same result, a fraction of the queue
  for (let y = 0; y < n; y++) {
    for (let z = 0; z < n; z++) {
      for (let x = 0; x < n; x++) {
        const i = (y * n + z) * n + x;
        const l = sky[i]!;
        if (l <= 1) continue;
        const t = l - 1;
        if (
          (x > 0 && sky[i - 1]! < t && extraLoss[vox[i - 1]!]! !== 255) ||
          (x < n - 1 && sky[i + 1]! < t && extraLoss[vox[i + 1]!]! !== 255) ||
          (z > 0 && sky[i - n]! < t && extraLoss[vox[i - n]!]! !== 255) ||
          (z < n - 1 && sky[i + n]! < t && extraLoss[vox[i + n]!]! !== 255) ||
          (y > 0 && sky[i - nn]! < t && extraLoss[vox[i - nn]!]! !== 255) ||
          (y < n - 1 && sky[i + nn]! < t && extraLoss[vox[i + nn]!]! !== 255)
        )
          queue[qt++] = i;
      }
    }
  }
  spread(vox, sky, queue, qh, qt, n, nn);

  // ---- block light from emitters
  qt = 0;
  for (let i = 0; i < size; i++) {
    const e = emit[vox[i]!]!;
    if (e > 0) {
      block[i] = e;
      queue[qt++] = i;
    }
  }
  spread(vox, block, queue, 0, qt, n, nn);
  return { sky, block };
}

/** Breadth-first spread: each step costs one level plus the entered cell's extra loss; opaque cells stop it. */
function spread(vox: Uint16Array, f: Uint8Array, queue: Int32Array, head: number, tail: number, n: number, nn: number): void {
  // the queue is a ring over the same buffer: every cell enters at most once per level drop, bounded by size
  const cap = queue.length;
  let h = head;
  let t = tail;
  let count = tail - head;
  let overflow = false;
  for (;;) {
    while (count > 0) {
      const i = queue[h]!;
      h = h + 1 === cap ? 0 : h + 1;
      count--;
      const l = f[i]!;
      if (l <= 1) continue;
      const x = i % n;
      const z = ((i - x) / n) % n;
      const y = (i - x - z * n) / nn;
      for (let k = 0; k < 6; k++) {
        let j: number;
        if (k === 0) {
          if (x === 0) continue;
          j = i - 1;
        } else if (k === 1) {
          if (x === n - 1) continue;
          j = i + 1;
        } else if (k === 2) {
          if (z === 0) continue;
          j = i - n;
        } else if (k === 3) {
          if (z === n - 1) continue;
          j = i + n;
        } else if (k === 4) {
          if (y === 0) continue;
          j = i - nn;
        } else {
          if (y === n - 1) continue;
          j = i + nn;
        }
        const loss = extraLoss[vox[j]!]!;
        if (loss === 255) continue;
        const nl = l - 1 - loss;
        if (nl > f[j]!) {
          f[j] = nl;
          if (count < cap) {
            queue[t] = j;
            t = t + 1 === cap ? 0 : t + 1;
            count++;
          } else overflow = true;
        }
      }
    }
    if (!overflow) return;
    // the ring was full and dropped a cell: re-seed every lit cell and spread again until nothing is dropped
    overflow = false;
    h = 0;
    t = 0;
    count = 0;
    for (let i = 0; i < f.length; i++) {
      if (f[i]! > 1) {
        queue[t] = i;
        t = t + 1 === cap ? 0 : t + 1;
        count++;
      }
    }
  }
}
