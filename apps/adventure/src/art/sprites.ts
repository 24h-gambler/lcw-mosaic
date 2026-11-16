import { Px } from './pixels.js';
import type { PalKey } from './palette.js';

/**
 * Every character of the Hushwind Isles, drawn by code at its own pixel size (docs/22 1장: original art, no files).
 * `happy` is the befriended face. Creature sizes: path islanders 22×22, guardians 34×34 (battle draws them at 2×).
 */

type Painter = (p: Px, happy: boolean) => void;

function eyes(p: Px, x: number, y: number, gap: number, happy: boolean, c: PalKey = 'ink') {
  if (happy) {
    // closed smiling eyes ^ ^
    for (const ex of [x, x + gap]) {
      p.set(ex - 1, y + 1, c);
      p.set(ex, y, c);
      p.set(ex + 1, y + 1, c);
    }
  } else {
    for (const ex of [x, x + gap]) {
      p.rect(ex, y, 2, 2, c);
      p.set(ex + 1, y, 'white');
    }
  }
}

function mouth(p: Px, x: number, y: number, happy: boolean) {
  if (happy) {
    p.set(x - 1, y, 'ink');
    p.set(x, y + 1, 'ink');
    p.set(x + 1, y + 1, 'ink');
    p.set(x + 2, y, 'ink');
  } else p.rect(x, y + 1, 2, 1, 'ink');
}

const sprigget: Painter = (p, happy) => {
  p.tri(11, 2, 4, 6, 10, 9, 'leaf');
  p.tri(11, 2, 18, 5, 12, 9, 'leafD');
  p.line(11, 3, 11, 9, 'mossD');
  p.ellipse(11, 14, 6.5, 6, 'moss');
  p.ellipse(10, 12, 3, 2, 'mossL');
  eyes(p, 8, 13, 5, happy);
  mouth(p, 10, 16, happy);
  p.rect(7, 19, 2, 2, 'mossD');
  p.rect(13, 19, 2, 2, 'mossD');
  p.outline();
};

const puffmoth: Painter = (p, happy) => {
  p.ellipse(5, 9, 5, 6, 'grapeL');
  p.ellipse(17, 9, 5, 6, 'grapeL');
  p.ellipse(5, 9, 2, 3, 'white');
  p.ellipse(17, 9, 2, 3, 'white');
  p.ellipse(11, 12, 5.5, 6.5, 'cream');
  for (const [x, y] of [[8, 7], [13, 8], [9, 16], [14, 15], [11, 18]] as const) p.set(x, y, 'paper');
  p.line(9, 6, 7, 2, 'ink2');
  p.line(13, 6, 15, 2, 'ink2');
  p.set(7, 1, 'pink');
  p.set(15, 1, 'pink');
  eyes(p, 9, 11, 3, happy);
  p.set(8, 14, 'pink');
  p.set(15, 14, 'pink');
  p.outline();
};

const bramblebun: Painter = (p, happy) => {
  p.ellipse(17, 21, 14, 11, 'bread');
  p.ellipse(17, 24, 12, 7, 'sand');
  for (let i = 0; i < 9; i++) {
    const a = Math.PI * (1.05 + (0.9 * i) / 8);
    const bx = 17 + Math.cos(a) * 12;
    const by = 20 + Math.sin(a) * 9;
    p.tri(bx - 3, by + 2, bx + 3, by + 2, 17 + Math.cos(a) * 17, 20 + Math.sin(a) * 14, i % 2 ? 'moss' : 'mossD');
  }
  p.ellipse(17, 13, 10, 3, 'mossL');
  for (const [x, y] of [[7, 9], [17, 3], [27, 9]] as const) {
    p.circle(x, y, 2.4, happy ? 'sun' : 'stone');
    p.set(x, y + 2, 'ink');
  }
  eyes(p, 12, 21, 8, happy);
  p.set(10, 25, 'pink');
  p.set(25, 25, 'pink');
  mouth(p, 16, 25, happy);
  p.rect(9, 31, 4, 2, 'crust');
  p.rect(22, 31, 4, 2, 'crust');
  p.outline();
};

const bubblit: Painter = (p, happy) => {
  p.ellipse(11, 9, 8, 7, 'sea');
  p.ellipse(11, 8, 6.5, 5, 'foam');
  p.ellipse(8, 6, 2, 1.5, 'white');
  for (const x of [5, 8, 11, 14, 17]) p.line(x, 15, x + (x % 2 ? -1 : 1), 20, 'seaD');
  eyes(p, 8, 9, 5, happy, 'skyD');
  mouth(p, 10, 12, happy);
  p.outline('seaD');
};

const shellbop: Painter = (p, happy) => {
  p.circle(12, 11, 8, 'pink');
  p.circle(12, 11, 5.5, 'sand');
  p.circle(12, 11, 3, 'pink');
  p.circle(12, 11, 1, 'pinkD');
  p.ellipse(5, 17, 4, 3, 'sandD');
  eyes(p, 3, 15, 3, happy);
  p.rect(8, 19, 9, 2, 'pinkD');
  p.outline();
};

const clatterclaw: Painter = (p, happy) => {
  // teapot shell on the back
  p.ellipse(17, 14, 10, 8, 'skyD');
  p.ellipse(17, 13, 8, 6, 'sky');
  p.rect(26, 11, 5, 2, 'skyD');
  p.rect(29, 9, 2, 3, 'skyD');
  p.ellipse(17, 6, 3, 1.5, 'white');
  // body
  p.ellipse(17, 23, 11, 6, 'brand');
  p.ellipse(15, 21, 5, 2, 'brandD');
  // claws
  p.circle(4, 17, 4, 'brand');
  p.tri(1, 12, 5, 15, 3, 17, 'white');
  p.circle(30, 17, 4, 'brand');
  p.tri(33, 12, 29, 15, 31, 17, 'white');
  p.line(6, 20, 9, 22, 'brandD');
  p.line(28, 20, 25, 22, 'brandD');
  // legs
  for (const x of [9, 13, 21, 25]) p.line(x, 28, x + (x < 17 ? -2 : 2), 32, 'brandD');
  // captain hat
  p.rect(12, 0, 10, 4, 'night2');
  p.rect(10, 4, 14, 2, 'night');
  p.circle(17, 2, 1.2, 'sun');
  eyes(p, 13, 21, 6, happy);
  mouth(p, 16, 25, happy);
  p.outline();
};

const doughdot: Painter = (p, happy) => {
  p.ellipse(11, 14, 9, 7, 'sand');
  p.ellipse(11, 12, 7, 4, 'cream');
  for (const [x, y] of [[6, 11], [15, 10], [12, 16], [8, 17]] as const) p.set(x, y, 'white');
  if (happy) eyes(p, 8, 13, 5, true);
  else {
    p.rect(7, 14, 3, 1, 'ink');
    p.rect(13, 14, 3, 1, 'ink');
  }
  mouth(p, 10, 16, happy);
  p.outline('breadD');
};

const sugarfly: Painter = (p, happy) => {
  for (const [cx, cy, r] of [[5, 7, 5], [17, 7, 5], [6, 15, 3.5], [16, 15, 3.5]] as const) {
    p.circle(cx, cy, r, 'pink');
    p.line(cx - r + 1, cy, cx + r - 1, cy, 'white');
  }
  p.ellipse(11, 11, 2, 7, 'ink2');
  p.line(10, 4, 8, 1, 'ink');
  p.line(12, 4, 14, 1, 'ink');
  p.circle(11, 5, 2.5, 'ink2');
  if (happy) {
    p.set(10, 5, 'white');
    p.set(12, 5, 'white');
  } else {
    p.set(10, 5, 'sun');
    p.set(12, 5, 'sun');
  }
  p.outline();
};

const ovenna: Painter = (p, happy) => {
  // bread hat
  p.ellipse(17, 5, 9, 4.5, 'bread');
  for (const x of [12, 16, 20]) p.line(x, 3, x + 2, 6, 'breadD');
  // body
  p.rect(5, 9, 24, 21, 'brick');
  p.rect(5, 9, 24, 3, 'brickD');
  p.rect(26, 2, 3, 7, 'stoneD');
  // door window
  p.rect(9, 18, 16, 9, 'night2');
  p.rect(10, 19, 14, 7, happy ? 'sun' : 'ink2');
  if (happy) p.rect(12, 21, 10, 3, 'brand');
  p.rect(15, 27, 4, 1, 'stone');
  eyes(p, 11, 13, 10, happy);
  p.rect(7, 30, 5, 3, 'brickD');
  p.rect(22, 30, 5, 3, 'brickD');
  p.outline();
};

const inkling: Painter = (p, happy) => {
  p.tri(11, 1, 4, 13, 18, 13, 'grapeD');
  p.circle(11, 14, 7, 'grapeD');
  p.ellipse(8, 12, 2, 3, 'grape');
  eyes(p, 8, 13, 5, happy, 'white');
  if (happy) mouth(p, 10, 17, true);
  p.circle(17, 20, 1.5, 'grapeD');
  p.outline();
};

const paperkite: Painter = (p, happy) => {
  p.tri(11, 0, 2, 9, 11, 18, 'white');
  p.tri(11, 0, 20, 9, 11, 18, 'cream');
  p.line(11, 0, 11, 18, 'line');
  p.line(2, 9, 20, 9, 'line');
  eyes(p, 8, 7, 5, happy);
  for (const [x, y] of [[12, 19], [14, 20], [13, 21]] as const) p.set(x, y, 'ink2');
  p.rect(14, 19, 3, 2, 'brand');
  p.outline();
};

const hushwind: Painter = (p, happy) => {
  for (const [cx, cy, r] of [[10, 17, 8], [18, 12, 10], [26, 17, 7], [17, 21, 9]] as const) p.circle(cx, cy, r, happy ? 'line' : 'fog');
  p.circle(16, 10, 5, happy ? 'white' : 'fog');
  for (const [cx, cy, r] of [[10, 16, 5], [19, 14, 6]] as const) p.circle(cx, cy, r, happy ? 'white' : 'silver');
  // scarf
  p.rect(7, 23, 21, 3, 'brand');
  p.rect(22, 25, 3, 7, 'brandD');
  p.rect(26, 25, 3, 5, 'brand');
  eyes(p, 13, 16, 7, happy, 'ink2');
  if (!happy) {
    p.set(12, 15, 'ink2');
    p.set(22, 15, 'ink2');
  }
  mouth(p, 16, 19, happy);
  // wisps
  p.line(0, 9, 5, 9, 'fogD');
  p.line(29, 6, 33, 6, 'fogD');
  p.line(1, 27, 6, 27, 'fogD');
  p.outline('ink2');
};

export const CREATURE_PAINTERS: Readonly<Record<string, { size: number; paint: Painter }>> = {
  sprigget: { size: 22, paint: sprigget },
  puffmoth: { size: 22, paint: puffmoth },
  bramblebun: { size: 34, paint: bramblebun },
  bubblit: { size: 22, paint: bubblit },
  shellbop: { size: 22, paint: shellbop },
  clatterclaw: { size: 34, paint: clatterclaw },
  doughdot: { size: 22, paint: doughdot },
  sugarfly: { size: 22, paint: sugarfly },
  ovenna: { size: 34, paint: ovenna },
  inkling: { size: 22, paint: inkling },
  paperkite: { size: 22, paint: paperkite },
  hushwind: { size: 34, paint: hushwind }
};

export function paintCreature(id: string, happy: boolean): Px {
  const c = CREATURE_PAINTERS[id] ?? CREATURE_PAINTERS.sprigget!;
  const p = new Px(c.size, c.size);
  c.paint(p, happy);
  return p;
}

/** The Keeper: rain hood, paper lantern. dir 0 down, 1 up, 2 side (right; left is mirrored). */
export function paintKeeper(dir: 0 | 1 | 2, frame: 0 | 1): Px {
  const p = new Px(16, 18);
  const step = frame ? 1 : 0;
  // legs
  p.rect(5, 15, 2, 2 + (step ? 0 : 1), 'ink2');
  p.rect(9, 15, 2, 2 + (step ? 1 : 0), 'ink2');
  // coat
  p.rect(4, 10, 8, 6, 'sky');
  p.rect(4, 14, 8, 1, 'skyD');
  // hood + face
  p.ellipse(8, 6, 6, 5.5, 'sun');
  p.set(3, 2, 'sun');
  p.set(13, 2, 'sun');
  if (dir === 0) {
    p.ellipse(8, 7.5, 4, 3.2, 'cream');
    p.set(6, 7, 'ink');
    p.set(10, 7, 'ink');
    p.set(5, 9, 'pink');
    p.set(11, 9, 'pink');
  } else if (dir === 2) {
    p.ellipse(10, 7.5, 3, 3.2, 'cream');
    p.set(11, 7, 'ink');
    p.set(12, 9, 'pink');
  } else {
    p.line(8, 2, 8, 9, 'sunD');
  }
  // lantern on a stick
  const lx = dir === 2 ? 13 : 13;
  p.line(11, 11, lx, 9, 'bark');
  p.rect(lx - 1, 9, 3, 4, 'glow');
  p.set(lx, 13, 'brand');
  p.outline();
  return p;
}

export function paintSoul(): Px {
  const p = new Px(10, 10);
  p.grid(0, 1, ['.kkkkkkkk.', 'kwwwwwwwwk', 'kwsssssswk', 'kwsssssswk', 'kwwwwwwwwk', '.kkwkkkkk.', '..kwk.....', '..kk......'], {
    k: 'ink',
    w: 'sun',
    s: 'glow'
  });
  return p;
}

/** A villager: same build, own colours (Old Fern, Dune, Pip Toast, Nim). */
export function paintVillager(ch: 1 | 2 | 3 | 4): Px {
  const robe: PalKey = (['leafD', 'sandD', 'breadD', 'grape'] as const)[ch - 1]!;
  const hat: PalKey = (['moss', 'brand', 'cream', 'sun'] as const)[ch - 1]!;
  const p = new Px(16, 18);
  p.rect(4, 9, 8, 8, robe);
  p.circle(8, 6, 4, 'cream');
  p.set(6, 6, 'ink');
  p.set(10, 6, 'ink');
  if (ch === 1) {
    p.tri(3, 3, 8, -1, 13, 3, hat);
    p.line(8, -1, 8, 3, 'mossD');
  } else if (ch === 2) p.rect(3, 2, 10, 2, hat);
  else if (ch === 3) {
    p.ellipse(8, 2, 5, 2.5, hat);
    p.rect(4, 3, 8, 1, 'line');
  } else {
    p.tri(4, 3, 8, -1, 12, 3, hat);
    p.rect(12, 9, 1, 8, 'bark');
    p.circle(13, 8, 1.5, 'glow');
  }
  p.outline();
  return p;
}

export function paintStone(lit: boolean): Px {
  const p = new Px(16, 16);
  p.ellipse(8, 9, 6, 6.5, 'stone');
  p.ellipse(7, 7, 3, 3, 'silver');
  p.line(6, 8, 10, 8, lit ? 'glow' : 'stoneD');
  p.line(8, 6, 8, 12, lit ? 'glow' : 'stoneD');
  p.set(7, 11, lit ? 'sun' : 'stoneD');
  p.set(9, 11, lit ? 'sun' : 'stoneD');
  p.outline();
  return p;
}

export function paintBell(rung: boolean): Px {
  const p = new Px(16, 20);
  p.rect(7, 4, 2, 15, 'bark');
  p.rect(3, 3, 10, 2, 'barkD');
  p.tri(5, 13, 8, 6, 11, 13, rung ? 'sun' : 'sunD');
  p.rect(5, 12, 7, 2, rung ? 'sun' : 'sunD');
  p.set(8, 14, 'ink');
  p.outline();
  return p;
}
