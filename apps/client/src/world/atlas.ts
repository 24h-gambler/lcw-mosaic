/**
 * Procedural block textures (docs/08 6.1): 16 x 16 texels per face, 4~6 shades per block, light from above,
 * no outlines, little noise so blocks read as color masses from afar. Pure, deterministic, DOM-free.
 * Every pixel is generated here: no external or reference-game texture is used (AGENTS 4.11).
 */
import { TILE_NAMES, type TileName } from './blocks.js';

export const TILE_PX = 16;

type RGB = readonly [number, number, number];

function hex(h: number): RGB {
  return [(h >> 16) & 255, (h >> 8) & 255, h & 255];
}

/** Integer hash noise in [0, 1). Deterministic per (tile, x, y). */
function hash2(seed: number, x: number, y: number): number {
  let h = (seed * 374761393 + x * 668265263 + y * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return ((h >>> 0) % 10007) / 10007;
}

interface Painter {
  set(x: number, y: number, c: RGB, a?: number): void;
  fill(c: RGB): void;
  noise(ramp: readonly RGB[], seed: number, bias?: number): void;
}

function makePainter(buf: Uint8Array, base: number): Painter {
  const set = (x: number, y: number, c: RGB, a = 255): void => {
    if (x < 0 || y < 0 || x >= TILE_PX || y >= TILE_PX) return;
    // y = 0 is the top row of the tile (texture v = 1 in the shader).
    const i = base + ((TILE_PX - 1 - y) * TILE_PX + x) * 4;
    buf[i] = c[0];
    buf[i + 1] = c[1];
    buf[i + 2] = c[2];
    buf[i + 3] = a;
  };
  return {
    set,
    fill(c) {
      for (let y = 0; y < TILE_PX; y++) for (let x = 0; x < TILE_PX; x++) set(x, y, c);
    },
    noise(ramp, seed, bias = 0.5) {
      for (let y = 0; y < TILE_PX; y++) {
        for (let x = 0; x < TILE_PX; x++) {
          const n = hash2(seed, x, y);
          // Bias toward the middle shades: few dark/light specks.
          const t = Math.min(0.999, Math.max(0, (n - 0.5) * 1.2 + bias));
          set(x, y, ramp[Math.floor(t * ramp.length)]!);
        }
      }
    }
  };
}

const GRASS = [0x3f9a4a, 0x4cae52, 0x58bd5c, 0x67c965, 0x79d470].map(hex);
const DIRT = [0x7a5235, 0x8a5f3d, 0x996b45, 0xa8784e].map(hex);
const STONE = [0x7f8794, 0x8c94a1, 0x99a1ad, 0xa7aeb9].map(hex);
const SAND = [0xe0c487, 0xe8cd92, 0xefd79e, 0xf5e0aa].map(hex);
const MORTAR = hex(0xd8cbb6);

function planks(p: Painter, seed: number, ramp: readonly RGB[]): void {
  for (let y = 0; y < TILE_PX; y++) {
    const row = Math.floor(y / 4);
    const seamX = (row * 7 + 3) % 16;
    for (let x = 0; x < TILE_PX; x++) {
      const n = hash2(seed, x >> 1, y);
      let c = ramp[1 + Math.floor(n * (ramp.length - 2))]!;
      if (y % 4 === 3) c = ramp[0]!;
      else if (y % 4 === 0) c = ramp[ramp.length - 1]!;
      if (x === seamX && y % 4 !== 3) c = ramp[0]!;
      p.set(x, y, c);
    }
  }
}

function bricks(p: Painter, seed: number, ramp: readonly RGB[], mortar: RGB, rowH = 4, brickW = 8): void {
  for (let y = 0; y < TILE_PX; y++) {
    const row = Math.floor(y / rowH);
    const off = row % 2 === 0 ? 0 : brickW / 2;
    for (let x = 0; x < TILE_PX; x++) {
      const bx = (x + off) % brickW;
      const isMortar = y % rowH === rowH - 1 || bx === brickW - 1;
      if (isMortar) {
        p.set(x, y, mortar);
        continue;
      }
      const brickId = Math.floor((x + off) / brickW) + row * 3;
      const n = hash2(seed + brickId * 13, x, y);
      const shade = Math.floor(hash2(seed, brickId, row) * (ramp.length - 1));
      const c = ramp[Math.min(ramp.length - 1, shade + (n > 0.8 ? 1 : 0))]!;
      p.set(x, y, y % rowH === 0 ? ramp[ramp.length - 1]! : c);
    }
  }
}

function wool(p: Painter, seed: number, base: number): void {
  const c = hex(base);
  const ramp: RGB[] = [
    [c[0] * 0.86, c[1] * 0.86, c[2] * 0.86],
    [c[0] * 0.93, c[1] * 0.93, c[2] * 0.93],
    c,
    [Math.min(255, c[0] * 1.05 + 6), Math.min(255, c[1] * 1.05 + 6), Math.min(255, c[2] * 1.05 + 6)]
  ].map((v) => [Math.round(v[0]!), Math.round(v[1]!), Math.round(v[2]!)] as const);
  p.noise(ramp, seed, 0.55);
}

function plant(p: Painter, seed: number, stem: RGB, petal: RGB, center: RGB): void {
  for (let y = 0; y < TILE_PX; y++) for (let x = 0; x < TILE_PX; x++) p.set(x, y, stem, 0);
  for (let y = 6; y < 16; y++) p.set(7, y, stem);
  p.set(8, 11, stem);
  p.set(9, 10, stem);
  p.set(6, 12, stem);
  p.set(5, 11, stem);
  const petals: Array<[number, number]> = [
    [6, 2], [7, 2], [8, 2], [5, 3], [6, 3], [8, 3], [9, 3], [5, 4], [9, 4], [5, 5], [6, 5], [8, 5], [9, 5], [6, 6], [7, 6], [8, 6], [7, 1]
  ];
  for (const [x, y] of petals) p.set(x, y, petal);
  p.set(7, 3, center);
  p.set(7, 4, center);
  p.set(6, 4, center);
  p.set(8, 4, center);
  void seed;
}

const PAINT: Record<TileName, (p: Painter, seed: number) => void> = {
  grass_top: (p, s) => p.noise(GRASS, s, 0.55),
  grass_side: (p, s) => {
    p.noise(DIRT, s);
    for (let x = 0; x < TILE_PX; x++) {
      const depth = 3 + Math.floor(hash2(s, x, 99) * 3);
      for (let y = 0; y < depth; y++) p.set(x, y, GRASS[1 + ((x + y) % 3)]!);
    }
  },
  dirt: (p, s) => p.noise(DIRT, s),
  stone: (p, s) => {
    p.noise(STONE, s);
    for (let i = 0; i < 4; i++) {
      const cx = Math.floor(hash2(s, i, 1) * 14);
      const cy = Math.floor(hash2(s, i, 2) * 14);
      p.set(cx, cy, STONE[0]!);
      p.set(cx + 1, cy, STONE[0]!);
    }
  },
  brick: (p, s) => bricks(p, s, [0xa8452f, 0xb75038, 0xc45c40, 0xd06a4b].map(hex), MORTAR),
  road: (p, s) => p.noise([0x6c7280, 0x777d8a, 0x828895, 0x8c929e].map(hex), s, 0.5),
  bedrock: (p, s) => p.noise([0x2a2e38, 0x353b48, 0x444a58].map(hex), s),
  dynamite_side: (p, s) => {
    p.noise([0xc8382c, 0xd6443a, 0xe25546].map(hex), s);
    for (let x = 0; x < TILE_PX; x++) for (let y = 6; y < 10; y++) p.set(x, y, hex(0xf2ead8));
  },
  dynamite_top: (p, s) => {
    p.noise([0xc8382c, 0xd6443a].map(hex), s);
    p.set(7, 7, hex(0x3a3a3a));
    p.set(8, 8, hex(0x3a3a3a));
  },
  plank: (p, s) => planks(p, s, [0x8a6238, 0x9e7245, 0xae8150, 0xbc8f5c, 0xc99d68].map(hex)),
  glass: (p) => {
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        const edge = x === 0 || y === 0 || x === 15 || y === 15;
        const streak = (x + y === 10 || x + y === 11 || x + y === 20) && !edge;
        p.set(x, y, edge ? hex(0xe8f4fb) : streak ? hex(0xffffff) : hex(0xbfe3f5), edge ? 255 : streak ? 170 : 70);
      }
    }
  },
  vault: (p, s) => {
    p.noise([0x5b6270, 0x666d7b, 0x727988].map(hex), s);
    for (let i = 2; i < 14; i++) {
      p.set(i, 2, hex(0xffc53d));
      p.set(i, 13, hex(0xffc53d));
      p.set(2, i, hex(0xffc53d));
      p.set(13, i, hex(0xffc53d));
    }
  },
  sand: (p, s) => p.noise(SAND, s),
  gravel: (p, s) => p.noise([0x857e78, 0x938c85, 0xa29a92, 0xb2aaa1, 0x6f6963].map(hex), s),
  snow: (p, s) => p.noise([0xe9f1f7, 0xf1f6fa, 0xf8fbfd, 0xffffff].map(hex), s, 0.6),
  granite: (p, s) => p.noise([0x9a6a5c, 0xa87766, 0xb68473, 0xc49482].map(hex), s),
  marble: (p, s) => {
    p.noise([0xe8e4dc, 0xefebe4, 0xf5f2ec, 0xfbf9f5].map(hex), s, 0.6);
    for (let x = 0; x < TILE_PX; x++) {
      const y = Math.floor(6 + Math.sin(x * 0.7 + s) * 3);
      p.set(x, y, hex(0xd6d0c4));
    }
  },
  oak_plank: (p, s) => planks(p, s, [0x8f6436, 0xa47544, 0xb48452, 0xc29260, 0xcfa06d].map(hex)),
  birch_plank: (p, s) => planks(p, s, [0xc9b27c, 0xd7c08b, 0xe2cc98, 0xebd6a4, 0xf2dfb0].map(hex)),
  pine_plank: (p, s) => planks(p, s, [0x5f4027, 0x6e4c2f, 0x7b5737, 0x886140, 0x946b48].map(hex)),
  log_side: (p, s) => {
    const ramp = [0x5b3e26, 0x6a4a2e, 0x795636, 0x87613e].map(hex);
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        const n = hash2(s, x, y >> 2);
        p.set(x, y, ramp[x % 4 === 0 ? 0 : 1 + Math.floor(n * 3)]!);
      }
    }
  },
  log_top: (p) => {
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
        const ring = Math.floor(d) % 3;
        const c = d > 6.5 ? hex(0x6a4a2e) : ring === 0 ? hex(0xb88a58) : ring === 1 ? hex(0xc99d68) : hex(0xd7ad78);
        p.set(x, y, c);
      }
    }
  },
  door: (p, s) => {
    planks(p, s, [0x7b5432, 0x8a5f3a, 0x996b44, 0xa5764d].map(hex));
    for (let y = 2; y < 7; y++) for (let x = 3; x < 13; x++) p.set(x, y, hex(0xbfe3f5));
    p.set(12, 9, hex(0xffc53d));
    p.set(12, 10, hex(0xffc53d));
  },
  ladder: (p) => {
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        const rail = x === 2 || x === 3 || x === 12 || x === 13;
        const rung = y % 4 === 1 && x > 3 && x < 12;
        p.set(x, y, hex(0x9e7245), rail || rung ? 255 : 0);
      }
    }
  },
  stained_glass: (p) => {
    const cols = [0xff6b4a, 0x3fa9f5, 0xffc53d, 0x3dbe6b].map(hex);
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        const edge = x === 0 || y === 0 || x === 15 || y === 15 || x === 8 || y === 8;
        p.set(x, y, edge ? hex(0x3a4152) : cols[(x < 8 ? 0 : 1) + (y < 8 ? 0 : 2)]!, edge ? 255 : 150);
      }
    }
  },
  torch: (p) => {
    p.fill(hex(0x8a5f3d));
    for (let y = 0; y < 5; y++) for (let x = 0; x < TILE_PX; x++) p.set(x, y, y < 2 ? hex(0xfff1a8) : hex(0xffb347));
  },
  lantern: (p) => {
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        const frame = x < 2 || x > 13 || y < 2 || y > 13;
        const d = Math.hypot(x - 7.5, y - 8);
        p.set(x, y, frame ? hex(0x3a4152) : d < 3 ? hex(0xfff6c8) : d < 5 ? hex(0xffd36b) : hex(0xffb347));
      }
    }
  },
  neon: (p, s) => p.noise([0xff4fa3, 0xff6bb3, 0xff8cc4].map(hex), s, 0.6),
  iron_plate: (p, s) => {
    p.noise([0xa9b0bc, 0xb4bbc6, 0xbfc5cf].map(hex), s, 0.5);
    for (const [x, y] of [[2, 2], [13, 2], [2, 13], [13, 13]] as const) p.set(x, y, hex(0x7d8592));
  },
  copper: (p, s) => p.noise([0xb8693d, 0xc77a48, 0xd48955, 0xe09a66].map(hex), s),
  gold_trim: (p, s) => p.noise([0xd9a520, 0xe8b830, 0xf3c843, 0xffd966].map(hex), s, 0.6),
  iron_bars: (p) => {
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        const bar = x % 4 === 1 || y === 1 || y === 14;
        p.set(x, y, hex(0x5f6778), bar ? 255 : 0);
      }
    }
  },
  roof_red: (p, s) => bricks(p, s, [0xb4402e, 0xc44b36, 0xd2583f, 0xde6648].map(hex), hex(0x8e2f22), 4, 4),
  roof_blue: (p, s) => bricks(p, s, [0x2f6fae, 0x3a7dbd, 0x4689c9, 0x5296d4].map(hex), hex(0x225889), 4, 4),
  roof_slate: (p, s) => bricks(p, s, [0x4b5363, 0x555e70, 0x606a7c].map(hex), hex(0x3a4152), 4, 8),
  thatch: (p, s) => {
    const ramp = [0xb48a3c, 0xc69a46, 0xd6ab55, 0xe3ba62].map(hex);
    for (let y = 0; y < TILE_PX; y++) for (let x = 0; x < TILE_PX; x++) p.set(x, y, ramp[Math.floor(hash2(s, x, y >> 2) * 4)]!);
  },
  sandstone: (p, s) => {
    p.noise(SAND, s);
    for (let x = 0; x < TILE_PX; x++) {
      p.set(x, 4, hex(0xc9a86a));
      p.set(x, 11, hex(0xc9a86a));
    }
  },
  ice_brick: (p, s) => bricks(p, s, [0x9fd3f0, 0xb2ddf4, 0xc5e7f7].map(hex), hex(0xe8f6fd)),
  bamboo: (p, s) => {
    const ramp = [0x6c9a3a, 0x7cad45, 0x8cbf52].map(hex);
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        const node = y % 8 === 0;
        p.set(x, y, node ? hex(0x5a8030) : ramp[(x >> 2) % 3]!);
      }
    }
    void s;
  },
  station_panel: (p, s) => {
    p.noise([0xc7d0e0, 0xd0d8e6, 0xd9e0ec].map(hex), s, 0.5);
    for (let i = 4; i < 12; i++) p.set(i, 7, hex(0x6fe3ff));
  },
  scaffold: (p) => {
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        const frame = x < 2 || x > 13 || y < 2 || y > 13 || Math.abs(x - y) < 1.5;
        p.set(x, y, hex(0xd9b36c), frame ? 255 : 0);
      }
    }
  },
  nameplate: (p, s) => {
    planks(p, s, [0x8f6436, 0xa47544, 0xb48452, 0xc29260].map(hex));
    for (let y = 4; y < 12; y++) for (let x = 2; x < 14; x++) p.set(x, y, hex(0xf4ebdd));
    for (let x = 4; x < 12; x++) p.set(x, 8, hex(0x3a4152));
  },
  carpet: (p, s) => wool(p, s, 0xc0392b),
  flower_pot: (p, s) => p.noise([0xa65a3c, 0xb6674a, 0xc47557].map(hex), s),
  leaves: (p, s) => {
    const ramp = [0x2d7a3a, 0x358a42, 0x3f9a4a, 0x4cae52, 0x5bbb5d].map(hex);
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        const n = hash2(s, x >> 1, y >> 1) * 0.6 + hash2(s + 7, x, y) * 0.4;
        p.set(x, y, ramp[Math.floor(n * 4.99)]!);
      }
    }
  },
  water: (p, s) => {
    const ramp = [0x2f8fd8, 0x3a9be2, 0x46a8ea, 0x5ab6f0].map(hex);
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        const w = Math.sin((x + y * 0.5) * 0.8 + s) * 0.5 + 0.5;
        p.set(x, y, ramp[Math.floor(w * 3.99)]!, 190);
      }
    }
  },
  flower_red: (p, s) => plant(p, s, hex(0x3f9a4a), hex(0xe5484d), hex(0xffc53d)),
  flower_yellow: (p, s) => plant(p, s, hex(0x3f9a4a), hex(0xffc53d), hex(0xff8a3d)),
  flower_blue: (p, s) => plant(p, s, hex(0x3f9a4a), hex(0x5b8def), hex(0xffffff)),
  tall_grass: (p, s) => {
    for (let y = 0; y < TILE_PX; y++) for (let x = 0; x < TILE_PX; x++) p.set(x, y, GRASS[0]!, 0);
    for (let i = 0; i < 7; i++) {
      const x = 1 + i * 2 + Math.floor(hash2(s, i, 0) * 2);
      const top = 4 + Math.floor(hash2(s, i, 1) * 7);
      for (let y = top; y < 16; y++) p.set(x, y, GRASS[1 + (y % 3)]!);
    }
  },
  honeycomb: (p) => {
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        const row = Math.floor(y / 4);
        const ox = row % 2 === 0 ? 0 : 2;
        const cx = (x + ox) % 4;
        const wall = y % 4 === 0 || cx === 0;
        p.set(x, y, wall ? hex(0xd99a1e) : (x + y) % 5 === 0 ? hex(0xffe08a) : hex(0xffc53d));
      }
    }
  },
  wool_white: (p, s) => wool(p, s, 0xf3efe7),
  wool_red: (p, s) => wool(p, s, 0xe5484d),
  wool_yellow: (p, s) => wool(p, s, 0xffc53d),
  wool_blue: (p, s) => wool(p, s, 0x3fa9f5),
  wool_green: (p, s) => wool(p, s, 0x3dbe6b),
  wool_orange: (p, s) => wool(p, s, 0xff8a3d),
  wool_pink: (p, s) => wool(p, s, 0xff9cc2),
  wool_purple: (p, s) => wool(p, s, 0x8e5be8),
  crate: (p, s) => {
    planks(p, s, [0x9e7245, 0xae8150, 0xbc8f5c, 0xc99d68].map(hex));
    for (let i = 0; i < TILE_PX; i++) {
      p.set(i, 0, hex(0x6a4a2e));
      p.set(i, 15, hex(0x6a4a2e));
      p.set(0, i, hex(0x6a4a2e));
      p.set(15, i, hex(0x6a4a2e));
      p.set(i, i, hex(0x7b5737));
    }
  },
  barrel_side: (p, s) => {
    const ramp = [0x7b5737, 0x8a6240, 0x996d48].map(hex);
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        const hoop = y === 2 || y === 3 || y === 12 || y === 13;
        p.set(x, y, hoop ? hex(0x5f6778) : x % 4 === 0 ? ramp[0]! : ramp[1 + Math.floor(hash2(s, x, y >> 3) * 2)]!);
      }
    }
  },
  barrel_top: (p, s) => {
    planks(p, s, [0x8a6240, 0x996d48, 0xa5794f].map(hex));
    for (let i = 0; i < TILE_PX; i++) {
      p.set(i, 0, hex(0x5f6778));
      p.set(i, 15, hex(0x5f6778));
      p.set(0, i, hex(0x5f6778));
      p.set(15, i, hex(0x5f6778));
    }
  },
  hay_side: (p, s) => {
    const ramp = [0xc9a640, 0xd8b64c, 0xe5c45a, 0xf0d26a].map(hex);
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        const band = y === 4 || y === 11;
        p.set(x, y, band ? hex(0x9e5a2a) : ramp[Math.floor(hash2(s, x, y >> 2) * 4)]!);
      }
    }
  },
  hay_top: (p, s) => p.noise([0xc9a640, 0xd8b64c, 0xe5c45a, 0xf0d26a].map(hex), s),
  cobblestone: (p, s) => {
    const ramp = [0x6e7684, 0x7f8794, 0x8f97a3, 0xa1a8b3].map(hex);
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        const cell = Math.floor(hash2(s, x >> 2, y >> 2) * 4);
        const crack = hash2(s + 3, x, y) > 0.86;
        p.set(x, y, crack ? hex(0x5c6370) : ramp[cell]!);
      }
    }
  },
  bookshelf: (p, s) => {
    const books = [0xc0392b, 0x2f6fae, 0x3dbe6b, 0xffc53d, 0x8e5be8, 0xf3efe7].map(hex);
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        const shelf = y === 0 || y === 7 || y === 8 || y === 15;
        p.set(x, y, shelf ? hex(0xa47544) : books[Math.floor(hash2(s, x >> 1, y > 7 ? 1 : 0) * 6)]!);
      }
    }
  },
  dark_plank: (p, s) => planks(p, s, [0x4a3322, 0x563c28, 0x62452e, 0x6e4e34].map(hex)),
  chest_side: (p, s) => {
    planks(p, s, [0x8f6436, 0xa47544, 0xb48452, 0xc29260].map(hex));
    for (let x = 0; x < TILE_PX; x++) p.set(x, 5, hex(0x5b3e26));
    p.set(7, 6, hex(0xffc53d));
    p.set(8, 6, hex(0xffc53d));
    p.set(7, 7, hex(0xffc53d));
    p.set(8, 7, hex(0xffc53d));
  },
  chest_top: (p, s) => {
    planks(p, s, [0x8f6436, 0xa47544, 0xb48452, 0xc29260].map(hex));
    for (let i = 0; i < TILE_PX; i++) {
      p.set(i, 0, hex(0x5b3e26));
      p.set(i, 15, hex(0x5b3e26));
    }
  },
  path_top: (p, s) => p.noise([0x9a7a50, 0xa8875b, 0xb69566, 0xc3a272].map(hex), s),
  terracotta_honey: (p, s) => p.noise([0xd88a2a, 0xe39834, 0xeda640].map(hex), s, 0.55),
  chalkboard: (p, s) => {
    p.noise([0x24443a, 0x2a4d42, 0x30574a].map(hex), s);
    for (let i = 0; i < TILE_PX; i++) {
      p.set(i, 0, hex(0x8f6436));
      p.set(i, 15, hex(0x8f6436));
      p.set(0, i, hex(0x8f6436));
      p.set(15, i, hex(0x8f6436));
    }
    for (let x = 3; x < 12; x++) p.set(x, 5, hex(0xf4ebdd));
    for (let x = 3; x < 9; x++) p.set(x, 9, hex(0xf4ebdd));
  },
  stone_brick: (p, s) => bricks(p, s, [0xc2b39c, 0xcdbfa9, 0xd8cbb6, 0xe2d6c2].map(hex), hex(0xa8977e), 8, 8)
};

/** RGBA texels for all tiles, layer-major: layer i occupies [i*16*16*4, (i+1)*16*16*4). */
export function buildAtlasPixels(): Uint8Array<ArrayBuffer> {
  const layerBytes = TILE_PX * TILE_PX * 4;
  const buf = new Uint8Array(layerBytes * TILE_NAMES.length);
  TILE_NAMES.forEach((name, i) => {
    const p = makePainter(buf, i * layerBytes);
    p.fill([255, 0, 255]);
    PAINT[name](p, i * 31 + 7);
  });
  return buf;
}

/** Average color of a tile (for particles, minimap, debris). */
export function tileAverageColor(pixels: Uint8Array, layer: number): [number, number, number] {
  const layerBytes = TILE_PX * TILE_PX * 4;
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = layer * layerBytes; i < (layer + 1) * layerBytes; i += 4) {
    if (pixels[i + 3]! < 128) continue;
    r += pixels[i]!;
    g += pixels[i + 1]!;
    b += pixels[i + 2]!;
    n++;
  }
  if (n === 0) return [1, 1, 1];
  return [r / n / 255, g / n / 255, b / n / 255];
}
