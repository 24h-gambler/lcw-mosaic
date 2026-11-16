import type { AdventureChapterId } from '@lcw/content';
import { ADV } from './tuning.js';
import { createRng, hashSeed } from './rng.js';

/**
 * Island maps (A02). One walk from the left edge to the guardian on the right, through two gates where the path
 * islanders wait. Generated from the chapter number (same island every time) so the layout and its rules — every
 * island can be crossed, every gate holds its islander — are checked by tests instead of by eye.
 */

export type Tile = 'wall' | 'ground' | 'path' | 'water' | 'flower' | 'house' | 'floor';
export type EntityKind = 'villager' | 'stone' | 'bell' | 'critter' | 'guardian';

export interface MapEntity {
  id: string;
  kind: EntityKind;
  /** Tile position. */
  tx: number;
  ty: number;
  /** Stone: index of the word; critter: 0 or 1. */
  index: number;
}

export interface IslandMap {
  w: number;
  h: number;
  tiles: Tile[];
  start: { tx: number; ty: number };
  entities: MapEntity[];
  theme: 'woods' | 'shore' | 'bakery' | 'tower';
}

export const MAP_W = 58;
export const MAP_H = 15;
const GATES = [18, 36, 47];
const PATH_ROWS = [6, 7, 8];

export function tileAt(m: IslandMap, tx: number, ty: number): Tile {
  if (tx < 0 || ty < 0 || tx >= m.w || ty >= m.h) return 'wall';
  return m.tiles[ty * m.w + tx]!;
}

export function blocks(t: Tile): boolean {
  return t === 'wall' || t === 'water' || t === 'house';
}

export function buildIsland(ch: AdventureChapterId): IslandMap {
  const theme = (['woods', 'shore', 'bakery', 'tower'] as const)[ch - 1]!;
  const rng = createRng(hashSeed('island', ch));
  const w = MAP_W;
  const h = MAP_H;
  const floor: Tile = theme === 'tower' ? 'floor' : 'ground';
  const tiles: Tile[] = new Array(w * h).fill(floor);
  const set = (x: number, y: number, t: Tile) => {
    if (x >= 0 && y >= 0 && x < w && y < h) tiles[y * w + x] = t;
  };
  const get = (x: number, y: number) => tiles[y * w + x]!;
  // borders
  for (let x = 0; x < w; x++) for (const y of [0, 1, h - 2, h - 1]) set(x, y, 'wall');
  for (let y = 0; y < h; y++) {
    set(0, y, 'wall');
    set(w - 1, y, 'wall');
  }
  // gates: a wall across the island with a three-tile opening on the path
  for (const gx of GATES) for (let y = 2; y < h - 2; y++) if (!PATH_ROWS.includes(y)) set(gx, y, 'wall');
  // the path
  for (let x = 1; x < w - 1; x++) for (const y of PATH_ROWS) if (get(x, y) !== 'wall' || GATES.includes(x)) set(x, y, 'path');
  // theme features
  if (theme === 'shore') {
    for (let x = 1; x < w - 1; x++) {
      set(x, 11, 'water');
      if (rng() < 0.5) set(x, 10, 'water');
    }
  }
  if (theme === 'bakery') {
    for (let x = 3; x < w - 4; x += 5) {
      if (GATES.some((g) => Math.abs(g - x) < 3 || Math.abs(g - (x + 1)) < 2)) continue;
      for (const [hx, hy] of [
        [x, 2],
        [x + 1, 2],
        [x, 3],
        [x + 1, 3]
      ] as const)
        set(hx, hy, 'house');
      if (rng() < 0.7) for (const [hx, hy] of [[x + 1, 10], [x + 2, 10], [x + 1, 11], [x + 2, 11]] as const) set(hx, hy, 'house');
    }
  }
  // scattered decor (trees, rocks, crates), kept off the path and away from the entities
  const keepClear = new Set<string>();
  const entities: MapEntity[] = [];
  const add = (e: MapEntity) => {
    entities.push(e);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) keepClear.add(`${e.tx + dx},${e.ty + dy}`);
  };
  add({ id: 'villager', kind: 'villager', tx: 6, ty: 4, index: 0 });
  add({ id: 'stone-0', kind: 'stone', tx: 11, ty: 5, index: 0 });
  add({ id: 'critter-0', kind: 'critter', tx: GATES[0]!, ty: 7, index: 0 });
  add({ id: 'stone-1', kind: 'stone', tx: 26, ty: 9, index: 1 });
  add({ id: 'bell', kind: 'bell', tx: 31, ty: 5, index: 0 });
  add({ id: 'critter-1', kind: 'critter', tx: GATES[1]!, ty: 7, index: 1 });
  add({ id: 'stone-2', kind: 'stone', tx: 42, ty: 5, index: 2 });
  add({ id: 'guardian', kind: 'guardian', tx: 53, ty: 7, index: 0 });
  const start = { tx: 3, ty: 7 };
  keepClear.add(`${start.tx},${start.ty}`);
  const density = theme === 'woods' ? 0.13 : theme === 'tower' ? 0.06 : 0.08;
  for (let y = 2; y < h - 2; y++)
    for (let x = 1; x < w - 1; x++) {
      if (get(x, y) !== floor || keepClear.has(`${x},${y}`)) continue;
      if (PATH_ROWS.includes(y)) continue;
      const roll = rng();
      if (roll < density) set(x, y, 'wall');
      else if (roll < density + 0.07 && theme !== 'tower') set(x, y, 'flower');
    }
  // the guardian's clearing stays open
  for (let x = GATES[2]! + 1; x < w - 1; x++) for (let y = 4; y <= 10; y++) if (get(x, y) === 'wall') set(x, y, floor);
  return { w, h, tiles, start, entities, theme };
}

/** Tiles reachable on foot from the start (critters and the guardian count as passable here: they are met, not walls). */
export function reachable(m: IslandMap): Set<number> {
  const seen = new Set<number>([m.start.ty * m.w + m.start.tx]);
  const q = [m.start.tx, m.start.ty];
  while (q.length) {
    const y = q.pop()!;
    const x = q.pop()!;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1]
    ] as const) {
      const nx = x + dx;
      const ny = y + dy;
      const k = ny * m.w + nx;
      if (seen.has(k) || blocks(tileAt(m, nx, ny))) continue;
      seen.add(k);
      q.push(nx, ny);
    }
  }
  return seen;
}

/** Pixel box of the player's feet at (px, py) = the feet centre. */
export function feetBox(px: number, py: number) {
  const { hitW, hitH } = ADV.player;
  return { x: px - hitW / 2, y: py - hitH, w: hitW, h: hitH };
}

export function boxBlocked(m: IslandMap, b: { x: number; y: number; w: number; h: number }): boolean {
  const T = ADV.tile;
  const x0 = Math.floor(b.x / T);
  const x1 = Math.floor((b.x + b.w - 0.01) / T);
  const y0 = Math.floor(b.y / T);
  const y1 = Math.floor((b.y + b.h - 0.01) / T);
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (blocks(tileAt(m, tx, ty))) return true;
  return false;
}

/** Moves with wall sliding: x then y, each undone alone when it would enter a wall. */
export function moveFeet(m: IslandMap, px: number, py: number, dx: number, dy: number): { x: number; y: number } {
  let x = px;
  let y = py;
  if (dx && !boxBlocked(m, feetBox(x + dx, y))) x += dx;
  if (dy && !boxBlocked(m, feetBox(x, y + dy))) y += dy;
  return { x, y };
}
