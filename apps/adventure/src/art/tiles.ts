import { Px } from './pixels.js';
import type { PalKey } from './palette.js';
import { tileAt, type IslandMap, type Tile } from '../core/map.js';
import { hashSeed } from '../core/rng.js';

/**
 * Island ground, drawn once per island into one canvas (the renderer copies the visible part each frame).
 * Four looks: moss woods, sea-glass shore, crumb town, star tower.
 */

const T = 16;

interface Theme {
  ground: [PalKey, PalKey];
  path: [PalKey, PalKey];
  wall: (p: Px, x: number, y: number, v: number, m: IslandMap, tx: number, ty: number) => void;
}

function speck(p: Px, x: number, y: number, v: number, c: PalKey, n = 4) {
  for (let i = 0; i < n; i++) {
    const h = hashSeed(v, i);
    p.set(x + (h % 14) + 1, y + ((h >> 8) % 14) + 1, c);
  }
}

const tree = (p: Px, x: number, y: number, v: number) => {
  p.rect(x + 6, y + 10, 4, 6, 'barkD');
  p.circle(x + 8, y + 7, 7, v % 3 ? 'mossD' : 'leafD');
  p.circle(x + 6, y + 5, 3, 'moss');
  if (v % 4 === 0) p.set(x + 10, y + 4, 'pink');
};
const rock = (p: Px, x: number, y: number, v: number) => {
  p.ellipse(x + 8, y + 9, 7, 6, v % 2 ? 'stone' : 'stoneD');
  p.ellipse(x + 6, y + 7, 3, 2, 'silver');
};
const crate = (p: Px, x: number, y: number, v: number) => {
  if (v % 2) {
    p.rect(x + 2, y + 3, 12, 12, 'bark');
    p.line(x + 2, y + 3, x + 13, y + 14, 'barkD');
    p.line(x + 13, y + 3, x + 2, y + 14, 'barkD');
  } else {
    p.ellipse(x + 8, y + 9, 6, 7, 'bark');
    p.rect(x + 2, y + 6, 12, 1, 'barkD');
    p.rect(x + 2, y + 12, 12, 1, 'barkD');
  }
};
const brickWall = (p: Px, x: number, y: number) => {
  p.rect(x, y, T, T, 'stoneD');
  for (let r = 0; r < 4; r++) for (let c = 0; c < 2; c++) p.rect(x + c * 8 + (r % 2) * 4 - 2, y + r * 4, 7, 3, 'stone');
};

const THEMES: Record<IslandMap['theme'], Theme> = {
  woods: { ground: ['moss', 'mossD'], path: ['sand', 'sandD'], wall: (p, x, y, v) => tree(p, x, y, v) },
  shore: { ground: ['sand', 'sandD'], path: ['paper', 'sandD'], wall: (p, x, y, v) => rock(p, x, y, v) },
  bakery: { ground: ['paper', 'line'], path: ['brick', 'brickD'], wall: (p, x, y, v) => crate(p, x, y, v) },
  tower: { ground: ['night2', 'night'], path: ['grapeD', 'grape'], wall: (p, x, y) => brickWall(p, x, y) }
};

function paintTile(p: Px, m: IslandMap, tx: number, ty: number, t: Tile) {
  const th = THEMES[m.theme];
  const x = tx * T;
  const y = ty * T;
  const v = hashSeed(m.theme, tx, ty);
  const base = (cs: [PalKey, PalKey]) => {
    p.rect(x, y, T, T, cs[0]);
    speck(p, x, y, v, cs[1], m.theme === 'tower' ? 2 : 5);
  };
  switch (t) {
    case 'ground':
    case 'floor':
      base(th.ground);
      if (m.theme === 'tower') {
        p.rect(x, y + 15, T, 1, 'night');
        p.rect(x + 15, y, 1, T, 'night');
        if (v % 9 === 0) p.set(x + 7, y + 7, 'glow');
      }
      break;
    case 'path':
      base(th.path);
      if (m.theme === 'bakery') for (let r = 0; r < 4; r++) p.rect(x + ((r % 2) * 8), y + r * 4 + 3, 8, 1, 'brickD');
      break;
    case 'flower':
      base(th.ground);
      if (m.theme === 'shore') {
        p.circle(x + 5 + (v % 6), y + 8, 1.6, 'pink');
        p.set(x + 11, y + 12, 'white');
      } else {
        for (let i = 0; i < 3; i++) {
          const h = hashSeed(v, 'f', i);
          const fx = x + 2 + (h % 12);
          const fy = y + 2 + ((h >> 6) % 12);
          p.set(fx, fy, i % 2 ? 'pink' : 'sun');
          p.set(fx, fy + 1, 'leafD');
        }
      }
      break;
    case 'water': {
      p.rect(x, y, T, T, 'sea');
      const top = tileAt(m, tx, ty - 1) !== 'water';
      if (top) p.rect(x, y, T, 2, 'foam');
      p.line(x + 2 + (v % 5), y + 7, x + 6 + (v % 5), y + 7, 'seaD');
      p.line(x + 8, y + 12, x + 12, y + 12, 'foam');
      break;
    }
    case 'house': {
      const roof = tileAt(m, tx, ty - 1) !== 'house';
      p.rect(x, y, T, T, roof ? 'brandD' : 'cream');
      if (roof) {
        for (let r = 0; r < 4; r++) p.rect(x, y + r * 4 + 2, T, 1, 'brand');
      } else {
        p.rect(x, y, T, 1, 'line');
        const left = tileAt(m, tx - 1, ty) !== 'house';
        if (left) p.rect(x + 4, y + 4, 6, 6, 'sky');
        else p.rect(x + 3, y + 5, 7, 11, 'bark');
      }
      break;
    }
    case 'wall':
      base(th.ground);
      th.wall(p, x, y, v, m, tx, ty);
      break;
  }
}

export function paintIsland(m: IslandMap): Px {
  const p = new Px(m.w * T, m.h * T);
  for (let ty = 0; ty < m.h; ty++) for (let tx = 0; tx < m.w; tx++) paintTile(p, m, tx, ty, tileAt(m, tx, ty));
  return p;
}
