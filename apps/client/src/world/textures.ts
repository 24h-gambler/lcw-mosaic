/**
 * Realistic block materials (R2627, Dan 11-16: "3d 환경자체가 리얼하지 않던데"). Every tile is generated here by code
 * (no image files, nothing traced from any game, AGENTS 4.11): tileable fractal noise, cell noise and simple shapes give
 * each material its own structure — wood grain and plank seams, mortar between bricks, rounded cobbles, overlapping roof
 * tiles, woven wool, brushed and riveted metal — at 64 x 64 texels per block face.
 *
 * Each tile has three outputs, all 64 x 64:
 *  - albedo (RGBA, sRGB): the colour with the cavities darkened; alpha < 0.5 = a hole (leaves, bars), alpha < 1 on
 *    glass and water = see-through;
 *  - material (RGBA, linear): normal x/y in tangent space (from the generated height), roughness, metalness.
 * The colours stay those of the town (honey cafe yellow, trade shop blue, red roofs), only real.
 */
import type { TileName } from './blocks.js';

export const TEX_PX = 64;
const S = TEX_PX;
const N = S * S;

// ---------------------------------------------------------------------------------------------------------------
// noise (all tileable with period S, deterministic)

function ihash(seed: number, x: number, y: number): number {
  let h = (Math.imul(seed | 0, 0x27d4eb2d) ^ Math.imul(x | 0, 0x165667b1) ^ Math.imul(y | 0, 0x9e3779b1)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca77);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae3d);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Value noise on a lattice of `cells` per tile side, wrapping at the tile edge. x, y in texels. */
function vnoise(seed: number, x: number, y: number, cells: number): number {
  const fx = (x / S) * cells;
  const fy = (y / S) * cells;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const w = (v: number): number => ((v % cells) + cells) % cells;
  const a = ihash(seed, w(x0), w(y0));
  const b = ihash(seed, w(x0 + 1), w(y0));
  const c = ihash(seed, w(x0), w(y0 + 1));
  const d = ihash(seed, w(x0 + 1), w(y0 + 1));
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** Fractal noise: `oct` octaves from `cells`, each doubling the lattice. Output ~0..1. */
function fbm(seed: number, x: number, y: number, cells: number, oct = 4, gain = 0.5): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let c = cells;
  for (let o = 0; o < oct; o++) {
    sum += vnoise(seed + o * 131, x, y, c) * amp;
    norm += amp;
    amp *= gain;
    c *= 2;
  }
  return sum / norm;
}

/** Cell noise: distance to the nearest and second-nearest feature point (wrapping), and the nearest cell's id. */
function cells(seed: number, x: number, y: number, n: number, jitter = 1): { f1: number; f2: number; id: number } {
  const fx = (x / S) * n;
  const fy = (y / S) * n;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  let f1 = 9;
  let f2 = 9;
  let id = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = ix + dx;
      const cy = iy + dy;
      const wx = ((cx % n) + n) % n;
      const wy = ((cy % n) + n) % n;
      const px = cx + 0.5 + (ihash(seed, wx, wy) - 0.5) * jitter;
      const py = cy + 0.5 + (ihash(seed + 7, wx, wy) - 0.5) * jitter;
      const d = Math.hypot(fx - px, fy - py);
      if (d < f1) {
        f2 = f1;
        f1 = d;
        id = wy * n + wx;
      } else if (d < f2) f2 = d;
    }
  }
  return { f1, f2, id };
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, v: number): number => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

type RGB = readonly [number, number, number];
function hex(h: number): RGB {
  return [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
}
function lerp3(a: RGB, b: RGB, t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
/** Colour from a ramp of stops over t in 0..1. */
function ramp(stops: readonly RGB[], t: number): [number, number, number] {
  const v = clamp01(t) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(v));
  return lerp3(stops[i]!, stops[i + 1]!, v - i);
}

// ---------------------------------------------------------------------------------------------------------------
// a tile under construction

export class TileBuf {
  readonly r = new Float32Array(N);
  readonly g = new Float32Array(N);
  readonly b = new Float32Array(N);
  readonly a = new Float32Array(N).fill(1);
  /** height 0..1 (normals come from it), roughness 0..1, metalness 0..1 */
  readonly h = new Float32Array(N).fill(0.5);
  readonly rough = new Float32Array(N).fill(0.85);
  readonly metal = new Float32Array(N);
  /** normal strength for this tile (height difference of 1 across one texel = this many texels of slope) */
  bump = 2.2;
  /** darken cavities (low height) in the albedo, 0..1 */
  cavity = 0.35;
  set(i: number, c: readonly number[], h?: number): void {
    this.r[i] = c[0]!;
    this.g[i] = c[1]!;
    this.b[i] = c[2]!;
    if (h !== undefined) this.h[i] = h;
  }
  each(f: (x: number, y: number, i: number) => void): void {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) f(x, y, y * S + x);
  }
}

type Paint = (t: TileBuf, seed: number) => void;

// ---------------------------------------------------------------------------------------------------------------
// material families

function ground(stops: readonly RGB[], scale: number, rough: number, bump = 1.6): Paint {
  return (t, s) => {
    t.bump = bump;
    t.each((x, y, i) => {
      const n = fbm(s, x, y, scale, 5);
      const fine = vnoise(s + 9, x, y, 32);
      t.set(i, ramp(stops, n * 0.85 + fine * 0.25 - 0.05), n * 0.7 + fine * 0.3);
      t.rough[i] = rough;
    });
  };
}

function grassTop(t: TileBuf, s: number): void {
  const stops = [hex(0x3b7d2a), hex(0x4f9a33), hex(0x69b241), hex(0x86c454)];
  t.bump = 1.8;
  t.each((x, y, i) => {
    const big = fbm(s, x, y, 3, 3);
    // blades: stretched fine noise, two directions
    const b1 = vnoise(s + 3, x * 0.6, y * 2.2, 32);
    const b2 = vnoise(s + 5, x * 2.1, y * 0.7, 32);
    const blade = Math.max(b1, b2);
    const c = ramp(stops, big * 0.55 + blade * 0.6 - 0.1);
    t.set(i, c, blade * 0.8 + big * 0.2);
    t.rough[i] = 0.92;
  });
  // a few clover dots and dry tips
  for (let k = 0; k < 18; k++) {
    const cx = Math.floor(ihash(s, k, 1) * S);
    const cy = Math.floor(ihash(s, k, 2) * S);
    const dry = ihash(s, k, 3) < 0.4;
    const c = dry ? hex(0xa8b45a) : hex(0x9fd16b);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (Math.abs(dx) + Math.abs(dy) > 1) continue;
      const i = ((cy + dy + S) % S) * S + ((cx + dx + S) % S);
      t.set(i, lerp3([t.r[i]!, t.g[i]!, t.b[i]!], c, 0.6), 0.85);
    }
  }
}

function grassSide(t: TileBuf, s: number): void {
  const dirt = [hex(0x5a3d26), hex(0x77543a), hex(0x8f6a4a)];
  const grass = [hex(0x3b7d2a), hex(0x5aa23a), hex(0x7cbd4c)];
  t.bump = 2;
  t.each((x, y, i) => {
    const n = fbm(s, x, y, 4, 4);
    const edge = 10 + vnoise(s + 2, x, 0, 16) * 7 + vnoise(s + 4, x, 0, 32) * 4;
    if (y < edge) {
      const b = vnoise(s + 6, x * 2.5, y * 0.6, 32);
      t.set(i, ramp(grass, n * 0.6 + b * 0.5 - 0.1), 0.7 + b * 0.25);
      t.rough[i] = 0.92;
    } else {
      const peb = cells(s + 8, x, y, 9);
      const stone = peb.f1 < 0.28 ? 1 : 0;
      const c = stone ? lerp3(hex(0x8d8173), hex(0x6f655a), ihash(s, peb.id, 1)) : ramp(dirt, n);
      // shade right under the turf
      const shade = 1 - 0.35 * (1 - smooth(edge, edge + 5, y));
      t.set(i, [c[0] * shade, c[1] * shade, c[2] * shade], stone ? 0.75 - peb.f1 : n * 0.5);
      t.rough[i] = 0.95;
    }
  });
}

function dirt(t: TileBuf, s: number): void {
  const stops = [hex(0x4e3522), hex(0x6b4b32), hex(0x8a6646)];
  t.bump = 2.2;
  t.each((x, y, i) => {
    const n = fbm(s, x, y, 4, 5);
    const peb = cells(s + 8, x, y, 10);
    const stone = peb.f1 < 0.25 && ihash(s, peb.id, 5) < 0.6;
    const c = stone ? lerp3(hex(0x8a7d6c), hex(0x655b50), ihash(s, peb.id, 1)) : ramp(stops, n);
    t.set(i, c, stone ? 0.8 - peb.f1 : n * 0.55);
    t.rough[i] = 0.96;
  });
}

function stoneFace(stops: readonly RGB[], crack = 0.06, scale = 3): Paint {
  return (t, s) => {
    t.bump = 2.6;
    t.each((x, y, i) => {
      const n = fbm(s, x, y, scale, 5);
      const c1 = cells(s + 3, x, y, 4);
      const cr = 1 - smooth(0, crack, c1.f2 - c1.f1);
      const col = ramp(stops, n * 0.9 + vnoise(s + 1, x, y, 32) * 0.15);
      const k = 1 - cr * 0.45;
      t.set(i, [col[0] * k, col[1] * k, col[2] * k], n * 0.7 - cr * 0.5 + 0.3);
      t.rough[i] = 0.82;
    });
  };
}

function cobbles(stops: readonly RGB[], mortar: RGB, n = 5, roundness = 0.16): Paint {
  return (t, s) => {
    t.bump = 3.2;
    t.cavity = 0.5;
    t.each((x, y, i) => {
      const c = cells(s, x, y, n, 0.85);
      const e = c.f2 - c.f1;
      const inStone = smooth(0.04, 0.04 + roundness, e);
      const tone = ihash(s, c.id, 3);
      const nz = fbm(s + 11, x, y, 8, 3);
      const stone = ramp(stops, tone * 0.7 + nz * 0.4 - 0.05);
      const m = lerp3(mortar, hex(0x000000), 0.1 + nz * 0.15);
      t.set(i, lerp3(m, stone, inStone), inStone * (0.75 + nz * 0.25));
      t.rough[i] = 0.8 + (1 - inStone) * 0.15;
    });
  };
}

/** Running-bond bricks: `rows` courses, bricks `perRow` per course, per-brick tone, chipped edges. */
function bricks(stops: readonly RGB[], mortar: RGB, rows = 8, perRow = 4, gap = 1.6): Paint {
  return (t, s) => {
    t.bump = 3;
    t.cavity = 0.45;
    const bh = S / rows;
    const bw = S / perRow;
    t.each((x, y, i) => {
      const row = Math.floor(y / bh);
      const off = row % 2 === 0 ? 0 : bw / 2;
      const xs = (x + off) % S;
      const col = Math.floor(xs / bw);
      const lx = xs - col * bw;
      const ly = y - row * bh;
      const chip = vnoise(s + 5, x, y, 16) * 1.2;
      const d = Math.min(lx, bw - lx, ly, bh - ly) - chip * 0.5;
      const inBrick = smooth(gap * 0.5, gap * 0.5 + 1.2, d);
      const id = (row * perRow + col) % (rows * perRow);
      const tone = ihash(s, id, 1);
      const nz = fbm(s + 2, x, y, 8, 3);
      const brick = ramp(stops, tone * 0.75 + nz * 0.35 - 0.05);
      const m = lerp3(mortar, hex(0x5a5550), nz * 0.25);
      t.set(i, lerp3(m, brick, inBrick), inBrick * (0.8 + nz * 0.2));
      t.rough[i] = 0.85;
    });
  };
}

/** Large dressed stone blocks (stone brick, sandstone courses). */
function ashlar(stops: readonly RGB[], mortar: RGB, rows = 2, perRow = 2): Paint {
  return (t, s) => {
    bricks(stops, mortar, rows, perRow, 2)(t, s);
    t.bump = 2.6;
    t.each((x, y, i) => {
      const n = fbm(s + 31, x, y, 6, 4);
      const k = 0.9 + n * 0.2;
      t.r[i]! *= k;
      t.g[i]! *= k;
      t.b[i]! *= k;
      t.h[i] = t.h[i]! * 0.85 + n * 0.15;
    });
  };
}

/** Wooden boards: `boards` horizontal boards, grain along x, staggered butt joints, nail heads. */
function planks(stops: readonly RGB[], boards = 4, rough = 0.72): Paint {
  return (t, s) => {
    t.bump = 2.2;
    t.cavity = 0.5;
    const bh = S / boards;
    t.each((x, y, i) => {
      const b = Math.floor(y / bh);
      const ly = y - b * bh;
      const joint = (Math.floor(ihash(s, b, 9) * 4) * S) / 4;
      const jx = (x - joint + S) % S;
      const seamY = Math.min(ly, bh - ly);
      const seamX = Math.min(jx, S - jx);
      const seam = Math.min(smooth(0.3, 1.6, seamY), smooth(0.3, 1.4, seamX));
      const tone = ihash(s, b, 3);
      const grain = fbm(s + b * 17, x * 0.25, y * 4, 8, 4);
      const rings = 0.5 + 0.5 * Math.sin((grain * 9 + ly * 0.35) * Math.PI);
      const knot = cells(s + b * 5, x, y, 3);
      const kn = ihash(s, knot.id + b * 13, 2) < 0.18 ? 1 - smooth(0.05, 0.22, knot.f1) : 0;
      const c = ramp(stops, tone * 0.45 + rings * 0.35 + grain * 0.25 - kn * 0.6);
      t.set(i, [c[0] * (0.55 + 0.45 * seam), c[1] * (0.55 + 0.45 * seam), c[2] * (0.55 + 0.45 * seam)], 0.25 + seam * 0.6 + rings * 0.1 - kn * 0.15);
      t.rough[i] = rough;
    });
    // nail heads at the board ends
    for (let b = 0; b < boards; b++) {
      const joint = (Math.floor(ihash(s, b, 9) * 4) * S) / 4;
      for (const nx of [joint + 3, joint - 4]) {
        for (const ny of [b * bh + bh * 0.3, b * bh + bh * 0.7]) {
          const cx = ((Math.round(nx) % S) + S) % S;
          const cy = Math.round(ny);
          for (let dy = -1; dy <= 0; dy++) for (let dx = -1; dx <= 0; dx++) {
            const i = (((cy + dy) % S) + S) % S * S + (((cx + dx) % S) + S) % S;
            t.set(i, [0.28, 0.27, 0.26], 0.75);
            t.metal[i] = 0.8;
            t.rough[i] = 0.5;
          }
        }
      }
    }
  };
}

function bark(t: TileBuf, s: number): void {
  const stops = [hex(0x2f2216), hex(0x4a3524), hex(0x6a4e36), hex(0x7d6045)];
  t.bump = 3.4;
  t.cavity = 0.55;
  t.each((x, y, i) => {
    const ridge = fbm(s, x * 3, y * 0.35, 6, 4);
    const fine = vnoise(s + 3, x * 2, y, 32);
    const v = smooth(0.35, 0.75, ridge);
    t.set(i, ramp(stops, v * 0.8 + fine * 0.25), v * 0.85 + fine * 0.15);
    t.rough[i] = 0.95;
  });
}

function logTop(t: TileBuf, s: number): void {
  const wood = [hex(0x8a6440), hex(0xb38a5e), hex(0xc9a072)];
  t.bump = 1.8;
  t.each((x, y, i) => {
    const dx = x + 0.5 - S / 2;
    const dy = y + 0.5 - S / 2;
    const r = Math.hypot(dx, dy) + (fbm(s, x, y, 4, 3) - 0.5) * 4;
    const ring = 0.5 + 0.5 * Math.sin(r * 0.9);
    if (r > S * 0.44) {
      const b = fbm(s + 5, x, y, 10, 3);
      t.set(i, ramp([hex(0x2f2216), hex(0x5a412c)], b), 0.4 + b * 0.4);
    } else t.set(i, ramp(wood, ring * 0.6 + 0.3 - r / S), 0.5 + ring * 0.1);
    t.rough[i] = 0.8;
  });
}

/** Overlapping roof tiles: rows of rounded tile ends with a shadow line under each row. */
function roofTiles(stops: readonly RGB[], rows = 6, perRow = 5): Paint {
  return (t, s) => {
    t.bump = 3.2;
    t.cavity = 0.55;
    const rh = S / rows;
    const tw = S / perRow;
    t.each((x, y, i) => {
      const row = Math.floor(y / rh);
      const off = row % 2 === 0 ? 0 : tw / 2;
      const xs = (x + off) % S;
      const col = Math.floor(xs / tw);
      const lx = xs - col * tw - tw / 2;
      const ly = y - row * rh;
      // rounded lower edge of each tile (seen from below the eave: y grows down the roof)
      const bottom = rh - 1 - (lx * lx) / (tw * tw) * 4;
      const v = ly / rh;
      const shadow = smooth(bottom - 2.5, bottom, ly);
      const side = 1 - smooth(tw / 2 - 1.6, tw / 2, Math.abs(lx));
      const tone = ihash(s, row * 11 + col, 3);
      const nz = fbm(s + 3, x, y, 8, 3);
      const c = ramp(stops, tone * 0.5 + nz * 0.35 + (1 - v) * 0.2);
      const k = (1 - shadow * 0.55) * (0.75 + side * 0.25);
      t.set(i, [c[0] * k, c[1] * k, c[2] * k], (1 - v) * 0.6 + side * 0.25 - shadow * 0.3 + 0.2);
      t.rough[i] = 0.7;
    });
  };
}

function thatchStraw(stops: readonly RGB[], vertical = true): Paint {
  return (t, s) => {
    t.bump = 3;
    t.cavity = 0.5;
    t.each((x, y, i) => {
      const a = vertical ? x : y;
      const b = vertical ? y : x;
      const strand = vnoise(s, a * 4, b * 0.3, 32);
      const strand2 = vnoise(s + 9, a * 5.3, b * 0.25 + 7, 32);
      const v = Math.max(strand, strand2 * 0.9);
      const nz = fbm(s + 3, x, y, 4, 3);
      t.set(i, ramp(stops, v * 0.75 + nz * 0.3), v);
      t.rough[i] = 0.9;
    });
  };
}

/** Woven cloth: a fine over-under weave plus soft fibre noise. */
function wool(c: number): Paint {
  return (t, s) => {
    const base = hex(c);
    t.bump = 1.4;
    t.cavity = 0.3;
    t.each((x, y, i) => {
      const wx = Math.sin((x + 0.5) * Math.PI * 0.5);
      const wy = Math.sin((y + 0.5) * Math.PI * 0.5);
      const weave = ((Math.floor(x / 2) + Math.floor(y / 2)) % 2 === 0 ? wx : wy) * 0.5 + 0.5;
      const fib = fbm(s, x, y, 16, 3);
      const k = 0.82 + weave * 0.1 + fib * 0.16;
      t.set(i, [base[0] * k, base[1] * k, base[2] * k], weave * 0.5 + fib * 0.5);
      t.rough[i] = 1;
    });
  };
}

function metalPlate(c: number, rivets = true, brushed = true, metal = 1, rough = 0.42): Paint {
  return (t, s) => {
    const base = hex(c);
    t.bump = 2;
    t.cavity = 0.3;
    t.each((x, y, i) => {
      const br = brushed ? vnoise(s, x * 0.1, y * 6, 32) * 0.5 + vnoise(s + 2, x * 0.2, y * 3, 32) * 0.5 : fbm(s, x, y, 8, 3);
      const edge = Math.min(x, y, S - 1 - x, S - 1 - y);
      const bevel = smooth(0, 3, edge);
      const k = 0.78 + br * 0.2 + (1 - bevel) * -0.15;
      t.set(i, [base[0] * k, base[1] * k, base[2] * k], 0.4 + bevel * 0.4 + br * 0.05);
      t.metal[i] = metal;
      t.rough[i] = rough + br * 0.15;
    });
    if (rivets) {
      for (const [cx, cy] of [[6, 6], [S - 7, 6], [6, S - 7], [S - 7, S - 7]] as const) {
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
          const d = Math.hypot(dx, dy);
          if (d > 2.4) continue;
          const i = (cy + dy) * S + (cx + dx);
          t.h[i] = 0.95 - d * 0.1;
          const k = 0.95 - d * 0.08;
          t.set(i, [base[0] * k, base[1] * k, base[2] * k]);
        }
      }
    }
  };
}

function copper(t: TileBuf, s: number): void {
  metalPlate(0xb8693c, true, false, 1, 0.38)(t, s);
  t.each((x, y, i) => {
    const p = fbm(s + 40, x, y, 5, 4);
    const patina = smooth(0.55, 0.75, p);
    if (patina > 0) {
      const c = lerp3([t.r[i]!, t.g[i]!, t.b[i]!], hex(0x5fa58f), patina);
      t.set(i, c);
      t.metal[i] = 1 - patina;
      t.rough[i] = 0.4 + patina * 0.5;
    }
  });
}

function glass(tint: number, alpha = 0.22, frame = 0xd8dde3): Paint {
  return (t, s) => {
    const c = hex(tint);
    const f = hex(frame);
    t.bump = 1.5;
    t.cavity = 0;
    t.each((x, y, i) => {
      const edge = Math.min(x, y, S - 1 - x, S - 1 - y);
      if (edge < 2) {
        t.set(i, f, 0.9);
        t.a[i] = 1;
        t.rough[i] = 0.5;
        return;
      }
      // a soft diagonal glint and faint waviness of old glass
      const g = Math.exp(-(((x - y - 6) / 5) ** 2)) * 0.5 + Math.exp(-(((x - y + 16) / 2.5) ** 2)) * 0.35;
      const w = vnoise(s, x, y, 6);
      t.set(i, [c[0] + g, c[1] + g, c[2] + g], 0.5 + w * 0.05);
      t.a[i] = alpha + g * 0.5;
      t.rough[i] = 0.05;
    });
  };
}

function stainedGlass(t: TileBuf, s: number): void {
  const cols = [hex(0xd9483b), hex(0xf2b33d), hex(0x3f86c8), hex(0x4aa25c), hex(0x8e5be8)];
  t.cavity = 0;
  t.bump = 2;
  t.each((x, y, i) => {
    const c = cells(s, x, y, 4, 0.8);
    const lead = c.f2 - c.f1 < 0.08 || Math.min(x, y, S - 1 - x, S - 1 - y) < 2;
    if (lead) {
      t.set(i, [0.18, 0.18, 0.2], 0.9);
      t.a[i] = 1;
      t.metal[i] = 0.6;
      t.rough[i] = 0.5;
      return;
    }
    const col = cols[c.id % cols.length]!;
    const w = vnoise(s + 3, x, y, 8);
    t.set(i, [col[0] * (0.85 + w * 0.3), col[1] * (0.85 + w * 0.3), col[2] * (0.85 + w * 0.3)], 0.5);
    t.a[i] = 0.62;
    t.rough[i] = 0.1;
  });
}

function leaves(t: TileBuf, s: number): void {
  const stops = [hex(0x24581f), hex(0x356f28), hex(0x4f8f36), hex(0x6aa846)];
  t.bump = 2.6;
  t.cavity = 0.6;
  t.each((_x, _y, i) => {
    t.a[i] = 0;
    t.set(i, stops[0]!, 0.2);
  });
  // many small leaves: rotated ellipses, darker underneath, a few gaps to the sky
  for (let k = 0; k < 150; k++) {
    const cx = ihash(s, k, 1) * S;
    const cy = ihash(s, k, 2) * S;
    const ang = ihash(s, k, 3) * Math.PI;
    const len = 4 + ihash(s, k, 4) * 4;
    const wid = len * 0.45;
    const tone = ihash(s, k, 5);
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    for (let dy = -8; dy <= 8; dy++) {
      for (let dx = -8; dx <= 8; dx++) {
        const u = (dx * ca + dy * sa) / len;
        const v = (-dx * sa + dy * ca) / wid;
        const d = u * u + v * v;
        if (d > 1) continue;
        const x = ((Math.floor(cx + dx) % S) + S) % S;
        const y = ((Math.floor(cy + dy) % S) + S) % S;
        const i = y * S + x;
        const vein = Math.abs(v) < 0.12 ? 0.85 : 1;
        const c = ramp(stops, tone * 0.8 + (1 - d) * 0.25);
        t.set(i, [c[0] * vein, c[1] * vein, c[2] * vein], 0.4 + (1 - d) * 0.6);
        t.a[i] = 1;
        t.rough[i] = 0.7;
      }
    }
  }
}

function tallGrass(t: TileBuf, s: number): void {
  const stops = [hex(0x2f6a22), hex(0x4f9a33), hex(0x8cc65a)];
  t.cavity = 0;
  t.bump = 1.5;
  t.each((_x, _y, i) => {
    t.a[i] = 0;
  });
  for (let k = 0; k < 22; k++) {
    const bx = 4 + ihash(s, k, 1) * (S - 8);
    const lean = (ihash(s, k, 2) - 0.5) * 18;
    const top = 6 + ihash(s, k, 3) * 26;
    const w0 = 1.2 + ihash(s, k, 4) * 1.4;
    for (let y = Math.floor(top); y < S; y++) {
      const f = (S - y) / (S - top);
      const cx = bx + lean * f * f;
      const w = w0 * (1 - f * 0.85);
      for (let x = Math.floor(cx - w - 1); x <= cx + w + 1; x++) {
        if (x < 0 || x >= S) continue;
        const cov = clamp01(w + 0.5 - Math.abs(x + 0.5 - cx));
        if (cov <= 0.2) continue;
        const i = y * S + x;
        t.set(i, ramp(stops, f * 0.9 + ihash(s, k, 5) * 0.2), 0.5);
        t.a[i] = 1;
        t.rough[i] = 0.8;
      }
    }
  }
}

function flower(petal: number, center: number, petals = 5): Paint {
  return (t, s) => {
    tallGrass(t, s + 1);
    // thin the grass to a stem and two leaves, then the bloom
    t.each((x, y, i) => {
      if (Math.abs(x + 0.5 - S / 2) > 2.2 && !(y > 38 && Math.abs(x + 0.5 - S / 2) < 10 && (x + y) % 3 !== 0)) t.a[i] = 0;
    });
    const pc = hex(petal);
    const cc = hex(center);
    const cy = 20;
    for (let y = 0; y < 40; y++) {
      for (let x = 0; x < S; x++) {
        const dx = x + 0.5 - S / 2;
        const dy = y + 0.5 - cy;
        const r = Math.hypot(dx, dy);
        const a = Math.atan2(dy, dx);
        const edge = 9 + 4 * Math.cos(a * petals + s);
        const i = y * S + x;
        if (r < 3.4) {
          t.set(i, [cc[0], cc[1], cc[2]], 0.9);
          t.a[i] = 1;
        } else if (r < edge) {
          const k = 0.75 + 0.25 * (r / edge) + vnoise(s, x, y, 16) * 0.1;
          t.set(i, [pc[0] * k, pc[1] * k, pc[2] * k], 0.6 + (1 - r / edge) * 0.3);
          t.a[i] = 1;
          t.rough[i] = 0.6;
        }
      }
    }
  };
}

function water(t: TileBuf, s: number): void {
  t.cavity = 0;
  t.bump = 1.2;
  t.each((x, y, i) => {
    const n = fbm(s, x, y, 3, 4);
    const c = cells(s + 4, x, y, 4);
    const caustic = 1 - smooth(0, 0.18, c.f2 - c.f1);
    t.set(i, lerp3(hex(0x1f6f8a), hex(0x4fb0c4), n * 0.6 + caustic * 0.4), n);
    t.a[i] = 0.62;
    t.rough[i] = 0.04;
  });
}

function honeycomb(t: TileBuf, s: number): void {
  t.bump = 3;
  t.cavity = 0.5;
  const r = S / 8;
  t.each((x, y, i) => {
    // hex grid
    const hx = x / (r * 1.732);
    const row = Math.floor(y / (r * 1.5));
    const off = row % 2 === 0 ? 0 : 0.5;
    const col = Math.floor(hx + off);
    let best = 9;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const rr = row + dr;
        const o = rr % 2 === 0 ? 0 : 0.5;
        const cx = (col + dc - o + 0.5) * r * 1.732;
        const cy = (rr + 0.5) * r * 1.5;
        best = Math.min(best, Math.hypot(x + 0.5 - cx, y + 0.5 - cy));
      }
    }
    const wall = smooth(r * 0.62, r * 0.8, best);
    const nz = fbm(s, x, y, 8, 3);
    const honey = lerp3(hex(0xc77a12), hex(0xf2b33d), 1 - best / r + nz * 0.2);
    const wax = lerp3(hex(0xe5b860), hex(0xf6d68f), nz);
    t.set(i, lerp3(honey, wax, wall), 0.3 + wall * 0.6);
    t.rough[i] = 0.25 + wall * 0.45;
  });
}

function framed(inner: Paint, frame: readonly RGB[], width = 5): Paint {
  return (t, s) => {
    inner(t, s);
    t.each((x, y, i) => {
      const e = Math.min(x, y, S - 1 - x, S - 1 - y);
      if (e >= width) return;
      const g = fbm(s + 50, x * (x < width || x > S - 1 - width ? 4 : 0.25), y * (y < width || y > S - 1 - width ? 4 : 0.25), 8, 3);
      const c = ramp(frame, g);
      const bevel = e === 0 || e === width - 1 ? 0.75 : 1;
      t.set(i, [c[0] * bevel, c[1] * bevel, c[2] * bevel], 0.85 - (e === width - 1 ? 0.3 : 0));
      t.rough[i] = 0.75;
      t.metal[i] = 0;
    });
  };
}

const OAK = [hex(0x6e4a2b), hex(0x8f6339), hex(0xa97a4b), hex(0xbf9160)];
const BIRCH = [hex(0xb89a6a), hex(0xd2b989), hex(0xe2cca0), hex(0xeadbb6)];
const PINE = [hex(0x5c3c24), hex(0x7a5232), hex(0x936641), hex(0xa77b52)];
const DARK = [hex(0x3a281b), hex(0x4f3726), hex(0x634632), hex(0x76553c)];
const IRON = 0x8d949c;

const PAINT: Record<TileName, Paint> = {
  grass_top: grassTop,
  grass_side: grassSide,
  dirt,
  stone: stoneFace([hex(0x6c6e70), hex(0x86888a), hex(0x9c9d9e), hex(0xb0b0ae)]),
  brick: bricks([hex(0x8c3a28), hex(0xa4472f), hex(0xb85a3c), hex(0xc46d4c)], hex(0xc8bfb2), 8, 4),
  road: cobbles([hex(0x5f6166), hex(0x75777b), hex(0x8b8c8e), hex(0x9d9b97)], hex(0x3f3f40), 6, 0.12),
  bedrock: stoneFace([hex(0x202226), hex(0x34363b), hex(0x4a4c52)], 0.1, 5),
  dynamite_side: (t, s) => {
    planks([hex(0xa8281f), hex(0xc4372b), hex(0xd44a3a)], 1, 0.6)(t, s);
    t.each((x, y, i) => {
      if (y > 26 && y < 38) t.set(i, lerp3(hex(0xe8dcc6), hex(0xd4c6ad), fbm(s, x, y, 8, 2)), 0.7);
      if (x % 16 === 0) t.set(i, [t.r[i]! * 0.6, t.g[i]! * 0.6, t.b[i]! * 0.6], 0.2);
    });
  },
  dynamite_top: (t, s) => {
    t.each((x, y, i) => {
      const cx = (x % 16) - 7.5;
      const cy = (y % 16) - 7.5;
      const r = Math.hypot(cx, cy);
      const c = r < 2 ? hex(0x2a2a2a) : r < 7 ? lerp3(hex(0xc4372b), hex(0xa8281f), vnoise(s, x, y, 16)) : hex(0x3a1c16);
      t.set(i, c, r < 7 ? 0.8 - r * 0.03 : 0.2);
    });
  },
  plank: planks(OAK),
  glass: glass(0xcfe8f2, 0.18),
  vault: (t, s) => {
    metalPlate(0x6c737c, true, true, 1, 0.35)(t, s);
    t.each((x, y, i) => {
      const r = Math.hypot(x + 0.5 - S / 2, y + 0.5 - S / 2);
      if (r < 14 && r > 11) t.set(i, [0.75, 0.74, 0.7], 0.9);
      if (r < 3) t.set(i, [0.2, 0.2, 0.22], 0.3);
    });
  },
  sand: (t, s) => {
    ground([hex(0xc9ad7d), hex(0xdcc293), hex(0xe9d4a8)], 4, 0.95, 1.2)(t, s);
    t.each((x, y, i) => {
      const rip = Math.sin((y + fbm(s + 3, x, y, 3, 2) * 14) * 0.55) * 0.5 + 0.5;
      t.h[i] = t.h[i]! * 0.6 + rip * 0.4;
    });
  },
  gravel: cobbles([hex(0x6d6a66), hex(0x8b8781), hex(0xa29d95), hex(0xb7b1a7)], hex(0x4b4845), 11, 0.08),
  snow: ground([hex(0xd9e4ee), hex(0xeef4fa), hex(0xffffff)], 3, 0.6, 0.8),
  granite: (t, s) => {
    t.bump = 1.4;
    t.each((x, y, i) => {
      const n = fbm(s, x, y, 6, 4);
      const sp = vnoise(s + 1, x, y, 32);
      const sp2 = vnoise(s + 2, x, y, 64);
      const base = ramp([hex(0x8d6f66), hex(0xa98a7e), hex(0xbf9f91)], n);
      const c = sp > 0.78 ? hex(0x2e2a2a) : sp2 > 0.82 ? hex(0xe8ddd6) : base;
      t.set(i, c, n * 0.5 + sp * 0.2);
      t.rough[i] = 0.45;
    });
  },
  marble: (t, s) => {
    t.bump = 0.8;
    t.cavity = 0.1;
    t.each((x, y, i) => {
      const n = fbm(s, x, y, 3, 5);
      const vein = Math.abs(Math.sin((x * 0.06 + y * 0.03 + n * 4) * Math.PI));
      const v = 1 - smooth(0, 0.08, vein);
      const c = lerp3(lerp3(hex(0xe6e3dd), hex(0xf7f5f1), n), hex(0x9c9ea4), v * 0.7);
      t.set(i, c, 0.6 - v * 0.1);
      t.rough[i] = 0.22;
    });
  },
  oak_plank: planks(OAK),
  birch_plank: planks(BIRCH, 4, 0.66),
  pine_plank: planks(PINE),
  log_side: bark,
  log_top: logTop,
  door: (t, s) => {
    planks(OAK, 1, 0.7)(t, s);
    // vertical boards: rotate the pattern by reading it transposed
    const r = Float32Array.from(t.r);
    const g = Float32Array.from(t.g);
    const b = Float32Array.from(t.b);
    const h = Float32Array.from(t.h);
    t.each((x, y, i) => {
      const j = x * S + y;
      t.set(i, [r[j]!, g[j]!, b[j]!], h[j]);
      if (x % 16 < 1) t.set(i, [t.r[i]! * 0.55, t.g[i]! * 0.55, t.b[i]! * 0.55], 0.15);
    });
    framed((tt) => tt, DARK, 4)(t, s);
    for (let y = 30; y < 36; y++) for (let x = 50; x < 55; x++) {
      const i = y * S + x;
      t.set(i, [0.78, 0.62, 0.3], 0.95);
      t.metal[i] = 1;
      t.rough[i] = 0.3;
    }
  },
  ladder: (t, s) => {
    planks(OAK, 1, 0.7)(t, s);
    t.each((x, y, i) => {
      const rail = x < 8 || x > S - 9;
      const rung = y % 16 > 4 && y % 16 < 10;
      if (!rail && !rung) t.a[i] = 0;
    });
  },
  stained_glass: stainedGlass,
  torch: (t, s) => {
    t.cavity = 0;
    t.each((x, y, i) => {
      const dx = Math.abs(x + 0.5 - S / 2);
      t.a[i] = 0;
      if (y > 22 && dx < 3.5) {
        t.set(i, lerp3(hex(0x5a3d22), hex(0x7a5534), vnoise(s, x, y, 16)), 0.6);
        t.a[i] = 1;
      } else if (y <= 22) {
        const f = Math.hypot(dx * 1.4, y - 16) ;
        if (f < 8) {
          t.set(i, lerp3(hex(0xfff2b0), hex(0xff8a2a), f / 8), 0.5);
          t.a[i] = 1;
        }
      }
    });
  },
  lantern: (t, s) => {
    glass(0xffd27a, 0.95, 0x2a2a2c)(t, s);
    t.each((x, y, i) => {
      const e = Math.min(x, y, S - 1 - x, S - 1 - y);
      if (e >= 2) {
        const r = Math.hypot(x + 0.5 - S / 2, y + 0.5 - S / 2) / (S / 2);
        t.set(i, lerp3(hex(0xfff0c0), hex(0xf0a040), r), 0.5);
        t.a[i] = 1;
      } else t.metal[i] = 1;
      if (x % 21 === 10) t.set(i, [0.16, 0.16, 0.17], 0.9);
    });
  },
  neon: (t, s) => {
    t.each((x, y, i) => {
      const tube = Math.abs(Math.sin(y * 0.2 + Math.sin(x * 0.1) * 2)) < 0.25;
      t.set(i, tube ? hex(0xff6fd8) : lerp3(hex(0x1a1630), hex(0x2a2448), vnoise(s, x, y, 8)), tube ? 0.8 : 0.4);
      t.rough[i] = 0.2;
    });
  },
  iron_plate: metalPlate(IRON),
  copper,
  gold_trim: metalPlate(0xd9a63a, false, true, 1, 0.3),
  iron_bars: (t, s) => {
    metalPlate(0x5d636b, false, true, 1, 0.45)(t, s);
    t.each((x, y, i) => {
      const bar = x % 16 > 5 && x % 16 < 11;
      const band = y < 4 || y > S - 5;
      if (!bar && !band) t.a[i] = 0;
    });
  },
  roof_red: roofTiles([hex(0x7d2a1e), hex(0x9b3a26), hex(0xb24a30), hex(0xc25b3c)]),
  roof_blue: roofTiles([hex(0x1f4f7d), hex(0x2c6596), hex(0x3a78aa), hex(0x4a88b8)]),
  roof_slate: roofTiles([hex(0x353b44), hex(0x454c57), hex(0x56606b), hex(0x66707b)], 8, 4),
  thatch: thatchStraw([hex(0x7a6232), hex(0x9e8345), hex(0xbfa35a), hex(0xd4bb72)]),
  sandstone: ashlar([hex(0xc29a63), hex(0xd3ad76), hex(0xe0bf8a)], hex(0xa88655), 4, 2),
  ice_brick: (t, s) => {
    bricks([hex(0x9fcde6), hex(0xb7dcef), hex(0xd2ecf7)], hex(0xe9f6fb), 4, 2)(t, s);
    t.each((_x, _y, i) => {
      t.rough[i] = 0.12;
    });
  },
  bamboo: (t, s) => {
    t.bump = 2.6;
    t.each((x, y, i) => {
      const stalk = x % 16;
      const round = Math.sin(((stalk + 0.5) / 16) * Math.PI);
      const node = Math.abs(((y + Math.floor(x / 16) * 9) % 24) - 12) < 1.2;
      const c = lerp3(hex(0x6b8a2e), hex(0xa9bf55), round * 0.7 + vnoise(s, x, y * 0.2, 16) * 0.3);
      t.set(i, node ? lerp3(c, hex(0x4a5a20), 0.5) : c, round * 0.8 + (node ? 0.15 : 0));
      t.rough[i] = 0.4;
    });
  },
  station_panel: (t, s) => {
    metalPlate(0xc9ced6, true, false, 0.8, 0.35)(t, s);
    t.each((x, y, i) => {
      if (x === 31 || x === 32 || y === 31 || y === 32) t.set(i, [0.35, 0.37, 0.4], 0.1);
      if (x > 40 && x < 46 && y > 8 && y < 12) t.set(i, [0.4, 0.95, 0.8], 0.7);
    });
  },
  scaffold: (t, s) => {
    planks(BIRCH, 1, 0.7)(t, s);
    t.each((x, y, i) => {
      const e = Math.min(x, y, S - 1 - x, S - 1 - y);
      const diag = Math.abs(x - y) < 4 || Math.abs(x + y - (S - 1)) < 4;
      if (e > 5 && !diag) t.a[i] = 0;
    });
  },
  nameplate: framed(planks(BIRCH, 2, 0.6), [hex(0x8a6a2e), hex(0xc9a24a), hex(0xe0c070)], 5),
  carpet: (t, s) => {
    wool(0xb8453a)(t, s);
    t.each((x, y, i) => {
      const e = Math.min(x, y, S - 1 - x, S - 1 - y);
      if (e > 4 && e < 8) t.set(i, [0.86, 0.7, 0.32]);
    });
  },
  flower_pot: (t, s) => {
    t.bump = 1.6;
    t.each((x, y, i) => {
      const n = fbm(s, x, y, 6, 3);
      const rim = y < 10;
      const c = lerp3(hex(0xa4532f), hex(0xc06a3f), n);
      t.set(i, rim ? lerp3(c, hex(0xd98a5a), 0.3) : c, rim ? 0.8 : 0.5 + n * 0.1);
      if (y === 10) t.set(i, [c[0] * 0.6, c[1] * 0.6, c[2] * 0.6], 0.2);
      t.rough[i] = 0.85;
    });
  },
  leaves,
  water,
  flower_red: flower(0xd8352a, 0xf2c23d),
  flower_yellow: flower(0xf2c23d, 0xd9732a, 8),
  flower_blue: flower(0x4a7fd6, 0xf6f1e4, 6),
  tall_grass: tallGrass,
  honeycomb,
  wool_white: wool(0xe9e4da),
  wool_red: wool(0xb8382d),
  wool_yellow: wool(0xe2b23a),
  wool_blue: wool(0x2f6fb0),
  wool_green: wool(0x3f8f45),
  wool_orange: wool(0xd9742e),
  crate: (t, s) => {
    planks(PINE, 4, 0.75)(t, s);
    framed((tt) => tt, DARK, 7)(t, s);
    t.each((x, y, i) => {
      if (Math.abs(x - y) < 4 && Math.min(x, y, S - 1 - x, S - 1 - y) >= 7) {
        const c = ramp(DARK, fbm(s + 9, x * 0.5, y * 0.5, 8, 3) + 0.3);
        t.set(i, c, 0.85);
      }
    });
  },
  barrel_side: (t, s) => {
    planks(OAK, 1, 0.7)(t, s);
    const r = Float32Array.from(t.r);
    const g = Float32Array.from(t.g);
    const b = Float32Array.from(t.b);
    t.each((x, y, i) => {
      const j = x * S + y;
      t.set(i, [r[j]!, g[j]!, b[j]!]);
      const stave = Math.sin(((x % 10.67) / 10.67) * Math.PI);
      t.h[i] = 0.3 + stave * 0.5;
      const hoop = (y > 8 && y < 14) || (y > S - 15 && y < S - 9);
      if (hoop) {
        t.set(i, [0.3, 0.3, 0.32], 0.95);
        t.metal[i] = 1;
        t.rough[i] = 0.5;
      }
    });
  },
  barrel_top: (t, s) => {
    planks(OAK, 4, 0.7)(t, s);
    t.each((x, y, i) => {
      const r = Math.hypot(x + 0.5 - S / 2, y + 0.5 - S / 2);
      if (r > S / 2 - 5) {
        t.set(i, [0.3, 0.3, 0.32], 0.9);
        t.metal[i] = 1;
        t.rough[i] = 0.5;
      }
    });
  },
  hay_side: thatchStraw([hex(0x9c8233), hex(0xc4a845), hex(0xdcc260), hex(0xe9d47a)], true),
  hay_top: thatchStraw([hex(0x9c8233), hex(0xc4a845), hex(0xdcc260)], false),
  cobblestone: cobbles([hex(0x5e6064), hex(0x77797c), hex(0x8f8f8e), hex(0xa29f99)], hex(0x3d3c3b), 5, 0.18),
  jar_shelf: (t, s) => {
    planks(DARK, 2, 0.7)(t, s);
    for (const row of [0, 1]) {
      for (let k = 0; k < 3; k++) {
        const cx = 11 + k * 21;
        const base = row * 32 + 28;
        const amber = k % 2 === 0;
        for (let y = base - 18; y < base; y++) {
          for (let x = cx - 7; x <= cx + 7; x++) {
            const i = y * S + x;
            const lid = y < base - 15;
            const dx = Math.abs(x + 0.5 - cx) / 7;
            const c = lid ? hex(0xc94a3a) : amber ? lerp3(hex(0xd98a12), hex(0xf6c050), 1 - dx) : lerp3(hex(0x7a3f1a), hex(0xb26a30), 1 - dx);
            const shine = Math.abs(x - cx + 3) < 1 && !lid ? 0.3 : 0;
            t.set(i, [c[0] + shine, c[1] + shine, c[2] + shine], 0.9 - dx * 0.4);
            t.rough[i] = lid ? 0.5 : 0.15;
          }
        }
      }
    }
  },
  dark_plank: planks(DARK),
  chest_side: (t, s) => {
    planks(OAK, 3, 0.7)(t, s);
    framed((tt) => tt, [hex(0x2e2e30), hex(0x45464a), hex(0x5a5b60)], 4)(t, s);
    t.each((x, y, i) => {
      if (x > 27 && x < 37 && y > 18 && y < 30) {
        t.set(i, [0.78, 0.62, 0.3], 0.95);
        t.metal[i] = 1;
        t.rough[i] = 0.3;
      }
      if (Math.min(x, y, S - 1 - x, S - 1 - y) < 4) t.metal[i] = 1;
    });
  },
  chest_top: (t, s) => {
    planks(OAK, 3, 0.7)(t, s);
    framed((tt) => tt, [hex(0x2e2e30), hex(0x45464a), hex(0x5a5b60)], 4)(t, s);
  },
  path_top: (t, s) => {
    dirt(t, s);
    t.each((x, y, i) => {
      const n = fbm(s + 30, x, y, 3, 4);
      const k = 1.08 + n * 0.12;
      t.set(i, [Math.min(1, t.r[i]! * k + 0.05), Math.min(1, t.g[i]! * k + 0.04), Math.min(1, t.b[i]! * k + 0.02)], t.h[i]! * 0.7 + 0.15);
    });
  },
  wool_pink: wool(0xd98aa8),
  wool_purple: wool(0x7a4fc0),
  terracotta_honey: (t, s) => {
    bricks([hex(0xb8682a), hex(0xcf7d34), hex(0xe0923f)], hex(0x8e4f22), 4, 4, 1.2)(t, s);
    t.each((_x, _y, i) => {
      t.rough[i] = 0.55;
    });
  },
  chalkboard: (t, s) => {
    t.bump = 1;
    t.each((x, y, i) => {
      const n = fbm(s, x, y, 5, 4);
      const smudge = fbm(s + 5, x, y, 3, 3);
      t.set(i, lerp3(hex(0x1f3a2c), hex(0x3e5e4a), n * 0.4 + smudge * 0.35), 0.5);
      t.rough[i] = 0.95;
    });
    // a few chalk strokes (loose letters and a drawn cup)
    for (let k = 0; k < 5; k++) {
      const y0 = 16 + k * 8;
      const len = 14 + ihash(s, k, 1) * 22;
      for (let x = 10; x < 10 + len; x++) {
        const y = Math.round(y0 + Math.sin(x * 0.7 + k) * 1.2);
        const i = y * S + x;
        if (ihash(s, x, k) < 0.75) t.set(i, [0.86, 0.88, 0.85], 0.55);
      }
    }
    framed((tt) => tt, OAK, 5)(t, s);
  },
  stone_brick: ashlar([hex(0x8d8a84), hex(0xa29f98), hex(0xb6b2aa)], hex(0x6c6964), 2, 2)
};

export interface TileTexels {
  /** RGBA sRGB albedo */
  albedo: Uint8Array;
  /** RGBA linear: normal.x, normal.y (0..255 = -1..1), roughness, metalness */
  material: Uint8Array;
}

/** Generate one tile's albedo and material texels into the given buffers at `offset` (bytes). */
export function paintTile(name: TileName, seed: number, albedo: Uint8Array, material: Uint8Array, offset: number): void {
  const t = new TileBuf();
  PAINT[name](t, seed);
  const toSrgb = (v: number): number => Math.round(clamp01(v) * 255);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      // normal from the height field (wrapping, so the edges tile)
      const hl = t.h[y * S + ((x + S - 1) % S)]!;
      const hr = t.h[y * S + ((x + 1) % S)]!;
      const hu = t.h[((y + S - 1) % S) * S + x]!;
      const hd = t.h[((y + 1) % S) * S + x]!;
      // y = 0 is the top row of the tile (texture v = 1): "up" in texture space is -y in the buffer
      let nx = (hl - hr) * t.bump;
      let ny = (hd - hu) * t.bump;
      const nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      const cav = 1 - t.cavity * (1 - clamp01(t.h[i]! * 1.6));
      const o = offset + ((S - 1 - y) * S + x) * 4;
      albedo[o] = toSrgb(t.r[i]! * cav);
      albedo[o + 1] = toSrgb(t.g[i]! * cav);
      albedo[o + 2] = toSrgb(t.b[i]! * cav);
      albedo[o + 3] = toSrgb(t.a[i]!);
      material[o] = Math.round((nx * 0.5 + 0.5) * 255);
      material[o + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      material[o + 2] = toSrgb(t.rough[i]!);
      material[o + 3] = toSrgb(t.metal[i]!);
    }
  }
}
