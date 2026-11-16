import { PAL, type PalKey } from './palette.js';

/**
 * A tiny raster for drawing the sprites at their own pixel size: filled shapes, then an automatic dark outline, then
 * to an offscreen canvas the renderer scales up with smoothing off. Every creature and tile in the adventure is drawn
 * by code through this — no image files (docs/22 1장).
 */
export class Px {
  readonly data: Array<PalKey | null>;
  constructor(
    readonly w: number,
    readonly h: number
  ) {
    this.data = new Array(w * h).fill(null);
  }
  set(x: number, y: number, c: PalKey | null) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.data[y * this.w + x] = c;
  }
  get(x: number, y: number): PalKey | null {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return null;
    return this.data[y * this.w + x]!;
  }
  rect(x: number, y: number, w: number, h: number, c: PalKey) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
  }
  ellipse(cx: number, cy: number, rx: number, ry: number, c: PalKey) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.set(x, y, c);
      }
  }
  circle(cx: number, cy: number, r: number, c: PalKey) {
    this.ellipse(cx, cy, r, r, c);
  }
  line(x0: number, y0: number, x1: number, y1: number, c: PalKey) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= n; i++) this.set(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, c);
  }
  tri(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, c: PalKey) {
    const minX = Math.floor(Math.min(ax, bx, cx));
    const maxX = Math.ceil(Math.max(ax, bx, cx));
    const minY = Math.floor(Math.min(ay, by, cy));
    const maxY = Math.ceil(Math.max(ay, by, cy));
    const s = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) => (px - rx) * (qy - ry) - (qx - rx) * (py - ry);
    for (let y = minY; y <= maxY; y++)
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        const d1 = s(px, py, ax, ay, bx, by);
        const d2 = s(px, py, bx, by, cx, cy);
        const d3 = s(px, py, cx, cy, ax, ay);
        const neg = d1 < 0 || d2 < 0 || d3 < 0;
        const pos = d1 > 0 || d2 > 0 || d3 > 0;
        if (!(neg && pos)) this.set(x, y, c);
      }
  }
  /** Rows of characters → palette keys (for the small hand-drawn sprites). */
  grid(x0: number, y0: number, rows: readonly string[], keys: Readonly<Record<string, PalKey>>) {
    rows.forEach((row, y) => [...row].forEach((ch, x) => ch !== '.' && keys[ch] && this.set(x0 + x, y0 + y, keys[ch]!)));
  }
  /** Dark outline around everything drawn so far (the pixel-art look). */
  outline(c: PalKey = 'ink') {
    const add: Array<[number, number]> = [];
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        if (this.get(x, y)) continue;
        if (this.get(x + 1, y) || this.get(x - 1, y) || this.get(x, y + 1) || this.get(x, y - 1)) add.push([x, y]);
      }
    for (const [x, y] of add) this.set(x, y, c);
  }
  mirrorX(): Px {
    const o = new Px(this.w, this.h);
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) o.set(this.w - 1 - x, y, this.get(x, y));
    return o;
  }
  toCanvas(): HTMLCanvasElement {
    const cv = document.createElement('canvas');
    cv.width = this.w;
    cv.height = this.h;
    const ctx = cv.getContext('2d')!;
    const img = ctx.createImageData(this.w, this.h);
    for (let i = 0; i < this.data.length; i++) {
      const k = this.data[i];
      if (!k) continue;
      const [r, g, b, a] = rgba(PAL[k]);
      img.data[i * 4] = r;
      img.data[i * 4 + 1] = g;
      img.data[i * 4 + 2] = b;
      img.data[i * 4 + 3] = a;
    }
    ctx.putImageData(img, 0, 0);
    return cv;
  }
}

const cache = new Map<string, [number, number, number, number]>();
export function rgba(css: string): [number, number, number, number] {
  const hit = cache.get(css);
  if (hit) return hit;
  let out: [number, number, number, number] = [0, 0, 0, 255];
  const m = /^#([0-9a-f]{6})$/i.exec(css);
  if (m) {
    const n = parseInt(m[1]!, 16);
    out = [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
  } else {
    const r = /rgba?\(([^)]+)\)/.exec(css);
    if (r) {
      const p = r[1]!.split(',').map((s) => Number(s.trim()));
      out = [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0, Math.round((p[3] ?? 1) * 255)];
    }
  }
  cache.set(css, out);
  return out;
}
