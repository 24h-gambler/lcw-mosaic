/**
 * Tiny isometric voxel renderer for the public site (docs/08 §6: everything is voxels, top face one step lighter).
 * The site must stay light (docs/14 §11: 600KB, 3D only on /try and /s), so pages draw voxel scenes as SVG
 * polygons instead of loading the WebGL client. Colours come only from @lcw/ui tokens.
 */
import React from 'react';
import { TOKENS, type ColorTokenName } from '@lcw/ui';

export interface Vox {
  x: number;
  y: number;
  z: number;
  c: ColorTokenName;
  /** Optional part name so scenes can show/hide pieces (jetpack, flame, cup...). */
  p?: string;
}

export function box(
  x0: number,
  y0: number,
  z0: number,
  dx: number,
  dy: number,
  dz: number,
  c: ColorTokenName,
  p?: string
): Vox[] {
  const out: Vox[] = [];
  for (let x = x0; x < x0 + dx; x++)
    for (let y = y0; y < y0 + dy; y++)
      for (let z = z0; z < z0 + dz; z++) out.push(p ? { x, y, z, c, p } : { x, y, z, c });
  return out;
}

/** Later voxels replace earlier ones at the same cell (paint over). */
export function merge(...lists: Vox[][]): Vox[] {
  const m = new Map<string, Vox>();
  for (const l of lists) for (const v of l) m.set(`${v.x},${v.y},${v.z}`, v);
  return [...m.values()];
}

export function shift(list: Vox[], dx: number, dy: number, dz: number): Vox[] {
  return list.map((v) => ({ ...v, x: v.x + dx, y: v.y + dy, z: v.z + dz }));
}

/** Quarter turns around the vertical axis (used by the showroom to "turn" a build). */
export function rotateQuarter(list: Vox[], turns: number): Vox[] {
  const t = ((turns % 4) + 4) % 4;
  let out = list;
  for (let i = 0; i < t; i++) out = out.map((v) => ({ ...v, x: -v.y - 1, y: v.x }));
  return out;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Mix a token colour toward white (amt > 0) or black (amt < 0). */
export function shade(token: ColorTokenName, amt: number): string {
  const [r, g, b] = hexToRgb(TOKENS.colors[token]);
  const f = (v: number) => Math.round(amt >= 0 ? v + (255 - v) * amt : v * (1 + amt));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

export interface IsoPoly {
  key: string;
  points: string;
  fill: string;
  part?: string;
}

export interface IsoResult {
  polys: IsoPoly[];
  minX: number;
  minY: number;
  width: number;
  height: number;
}

/** 2:1 isometric projection. The viewer sits at +x,+y,+z, so top, +x and +y faces are the visible ones. */
export function projectIso(voxels: readonly Vox[], unit = 10): IsoResult {
  const occ = new Set(voxels.map((v) => `${v.x},${v.y},${v.z}`));
  const has = (x: number, y: number, z: number) => occ.has(`${x},${y},${z}`);
  const P = (x: number, y: number, z: number): [number, number] => [(x - y) * unit, ((x + y) * unit) / 2 - z * unit];
  const sorted = [...voxels].sort((a, b) => a.x + a.y + a.z - (b.x + b.y + b.z) || a.z - b.z || a.x - b.x);
  const polys: IsoPoly[] = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const face = (pts: [number, number][], fill: string, key: string, part?: string) => {
    for (const [px, py] of pts) {
      if (px < minX) minX = px;
      if (py < minY) minY = py;
      if (px > maxX) maxX = px;
      if (py > maxY) maxY = py;
    }
    polys.push({ key, fill, part, points: pts.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join(' ') });
  };
  for (const v of sorted) {
    const { x, y, z } = v;
    const k = `${x},${y},${z}`;
    if (!has(x, y, z + 1))
      face([P(x, y, z + 1), P(x + 1, y, z + 1), P(x + 1, y + 1, z + 1), P(x, y + 1, z + 1)], shade(v.c, 0.18), `${k}t`, v.p);
    if (!has(x + 1, y, z))
      face([P(x + 1, y, z), P(x + 1, y + 1, z), P(x + 1, y + 1, z + 1), P(x + 1, y, z + 1)], shade(v.c, -0.12), `${k}r`, v.p);
    if (!has(x, y + 1, z))
      face([P(x, y + 1, z), P(x + 1, y + 1, z), P(x + 1, y + 1, z + 1), P(x, y + 1, z + 1)], shade(v.c, 0), `${k}l`, v.p);
  }
  if (polys.length === 0) return { polys, minX: 0, minY: 0, width: 1, height: 1 };
  return { polys, minX, minY, width: maxX - minX, height: maxY - minY };
}

export interface VoxelSvgProps {
  voxels: readonly Vox[];
  unit?: number;
  /** Fixed viewBox so several layers (scene, character) line up; defaults to the model bounds. */
  viewBox?: { x: number; y: number; w: number; h: number };
  title?: string;
  className?: string;
  style?: React.CSSProperties;
  /** Parts to wrap in a <g className> (e.g. flame flicker). */
  partClass?: Readonly<Record<string, string>>;
  hideParts?: readonly string[];
}

export function VoxelSvg({
  voxels,
  unit = 10,
  viewBox,
  title,
  className,
  style,
  partClass,
  hideParts
}: VoxelSvgProps): React.ReactElement {
  const shown = hideParts?.length ? voxels.filter((v) => !v.p || !hideParts.includes(v.p)) : voxels;
  const iso = React.useMemo(() => projectIso(shown, unit), [shown, unit]);
  const pad = unit;
  const vb = viewBox ?? { x: iso.minX - pad, y: iso.minY - pad, w: iso.width + pad * 2, h: iso.height + pad * 2 };
  const groups: React.ReactNode[] = [];
  let current: { cls: string | undefined; items: React.ReactNode[] } | null = null;
  const flush = () => {
    if (!current) return;
    groups.push(
      current.cls
        ? <g key={`g${groups.length}`} className={current.cls}>{current.items}</g>
        : <React.Fragment key={`g${groups.length}`}>{current.items}</React.Fragment>
    );
  };
  for (const p of iso.polys) {
    const cls = p.part ? partClass?.[p.part] : undefined;
    if (!current || current.cls !== cls) {
      flush();
      current = { cls, items: [] };
    }
    current.items.push(<polygon key={p.key} points={p.points} fill={p.fill} />);
  }
  flush();
  return (
    <svg
      viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
      className={className}
      style={style}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      shapeRendering="crispEdges"
    >
      {groups}
    </svg>
  );
}

/** Polygons of one model as a <g>, for composing several layers inside one <svg>. */
export function IsoGroup({
  voxels,
  unit = 10,
  className,
  transform,
  partClass,
  hideParts
}: {
  voxels: readonly Vox[];
  unit?: number;
  className?: string;
  transform?: string;
  partClass?: Readonly<Record<string, string>>;
  hideParts?: readonly string[];
}): React.ReactElement {
  const shown = React.useMemo(
    () => (hideParts?.length ? voxels.filter((v) => !v.p || !hideParts.includes(v.p)) : voxels),
    [voxels, hideParts]
  );
  const iso = React.useMemo(() => projectIso(shown, unit), [shown, unit]);
  const nodes: React.ReactNode[] = [];
  let cls: string | undefined;
  let items: React.ReactNode[] = [];
  const flush = () => {
    if (items.length === 0) return;
    nodes.push(cls ? <g key={nodes.length} className={cls}>{items}</g> : <g key={nodes.length}>{items}</g>);
    items = [];
  };
  for (const p of iso.polys) {
    const c = p.part ? partClass?.[p.part] : undefined;
    if (c !== cls) {
      flush();
      cls = c;
    }
    items.push(<polygon key={p.key} points={p.points} fill={p.fill} />);
  }
  flush();
  return (
    <g className={className} transform={transform}>
      {nodes}
    </g>
  );
}

/** Screen position of a model-space point under the same projection (for placing HTML overlays). */
export function isoPoint(x: number, y: number, z: number, unit = 10): [number, number] {
  return [(x - y) * unit, ((x + y) * unit) / 2 - z * unit];
}

/** Move a model so its footprint centre sits at (cx, cy) on the ground. */
export function placeAt(list: readonly Vox[], cx: number, cy: number, z = 0): Vox[] {
  if (list.length === 0) return [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  for (const v of list) {
    minX = Math.min(minX, v.x);
    maxX = Math.max(maxX, v.x);
    minY = Math.min(minY, v.y);
    maxY = Math.max(maxY, v.y);
    minZ = Math.min(minZ, v.z);
  }
  const dx = Math.round(cx - (minX + maxX + 1) / 2);
  const dy = Math.round(cy - (minY + maxY + 1) / 2);
  return shift([...list], dx, dy, z - minZ);
}

export function isoBounds(voxels: readonly Vox[], unit = 10): { x: number; y: number; w: number; h: number } {
  const r = projectIso(voxels, unit);
  return { x: r.minX - unit, y: r.minY - unit, w: r.width + unit * 2, h: r.height + unit * 2 };
}

/* ---------- models ---------- */

export interface CharacterOpts {
  shirt?: ColorTokenName;
  pants?: ColorTokenName;
  hair?: ColorTokenName;
  jetpack?: boolean;
  cup?: boolean;
  waveArm?: boolean;
}

/**
 * Chunky player figure, facing +y (towards the viewer's left). Proportions follow 08 §6.2 loosely:
 * the head is bigger than the body so the face reads at small sizes.
 */
export function character(o: CharacterOpts = {}): Vox[] {
  const shirt = o.shirt ?? 'brand';
  const pants = o.pants ?? 'sky-d';
  const hair = o.hair ?? 'ink-700';
  const parts: Vox[][] = [
    box(0, 1, 0, 2, 2, 4, pants),
    box(2, 1, 0, 2, 2, 4, pants),
    box(0, 1, 0, 2, 2, 1, 'ink-900'),
    box(2, 1, 0, 2, 2, 1, 'ink-900'),
    box(0, 1, 4, 4, 2, 5, shirt),
    // arms
    box(-1, 1, 4, 1, 2, 5, shirt),
    o.waveArm ? box(4, 1, 8, 1, 2, 4, shirt) : box(4, 1, 4, 1, 2, 5, shirt),
    box(-1, 1, 4, 1, 2, 1, 'paper-100'),
    o.waveArm ? box(4, 1, 11, 1, 2, 1, 'paper-100') : box(4, 1, 4, 1, 2, 1, 'paper-100'),
    // head
    box(-0, 0, 9, 4, 4, 4, 'paper-100'),
    box(0, 0, 12, 4, 4, 1, hair),
    box(0, 0, 10, 4, 1, 3, hair),
    box(0, 0, 9, 1, 4, 3, hair),
    // eyes and mouth on the +y face
    [
      { x: 1, y: 3, z: 11, c: 'ink-900' },
      { x: 3, y: 3, z: 11, c: 'ink-900' },
      { x: 2, y: 3, z: 9, c: 'brand-d' }
    ]
  ];
  if (o.jetpack) {
    parts.push(
      box(0, -1, 5, 2, 1, 4, 'silver', 'jetpack'),
      box(2, -1, 5, 2, 1, 4, 'silver', 'jetpack'),
      box(-1, -1, 8, 6, 1, 1, 'brand-d', 'jetpack'),
      box(0, -1, 4, 1, 1, 1, 'ink-700', 'jetpack'),
      box(3, -1, 4, 1, 1, 1, 'ink-700', 'jetpack'),
      box(0, -1, 2, 1, 1, 2, 'sun', 'flame'),
      box(3, -1, 2, 1, 1, 2, 'sun', 'flame'),
      box(0, -1, 1, 1, 1, 1, 'brand', 'flame'),
      box(3, -1, 1, 1, 1, 1, 'brand', 'flame')
    );
  }
  if (o.cup) {
    parts.push(box(4, 3, 5, 2, 2, 2, 'paper-0', 'cup'), box(4, 3, 7, 2, 2, 1, 'sun-d', 'cup'));
  }
  return merge(...parts);
}

export function grass(w: number, d: number, z = -1): Vox[] {
  const out: Vox[] = [];
  for (let x = 0; x < w; x++)
    for (let y = 0; y < d; y++) out.push({ x, y, z, c: (x * 7 + y * 3) % 11 === 0 ? 'leaf-d' : 'leaf' });
  return out;
}

export function road(x0: number, y0: number, len: number, wide: number, z = -1): Vox[] {
  const out: Vox[] = [];
  for (let x = x0; x < x0 + len; x++)
    for (let y = y0; y < y0 + wide; y++) out.push({ x, y, z, c: (x + y) % 2 === 0 ? 'paper-100' : 'line-200' });
  return out;
}

export function tree(): Vox[] {
  return merge(box(1, 1, 0, 1, 1, 4, 'sun-d'), box(0, 0, 4, 3, 3, 3, 'leaf'), box(1, 1, 7, 1, 1, 1, 'leaf-d'));
}

/** A small cafe front: cream walls, coral awning, sky window, sun sign. Door faces +y. */
export function cafe(): Vox[] {
  const w = 10;
  const d = 7;
  const h = 8;
  const walls: Vox[] = [];
  for (let x = 0; x < w; x++)
    for (let y = 0; y < d; y++)
      for (let z = 0; z < h; z++) {
        const edge = x === 0 || y === 0 || x === w - 1 || y === d - 1;
        if (!edge) continue;
        walls.push({ x, y, z, c: z === 0 ? 'ink-500' : 'paper-0' });
      }
  const door = box(2, d - 1, 1, 2, 1, 4, 'sun-d');
  const win = box(5, d - 1, 2, 3, 1, 3, 'sky');
  const winR = box(w - 1, 2, 2, 1, 3, 3, 'sky');
  const awning: Vox[] = [];
  for (let x = 0; x < w; x++) awning.push({ x, y: d, z: 5, c: x % 2 === 0 ? 'brand' : 'paper-0' });
  const roof = box(-1, -1, h, w + 2, d + 2, 1, 'brand-d');
  const roof2 = box(0, 0, h + 1, w, d, 1, 'brand-d');
  const sign = box(3, d, 6, 4, 1, 2, 'sun', 'sign');
  const mug = box(4, d + 1, 6, 2, 1, 1, 'brand-d', 'sign');
  return merge(walls, door, win, winR, awning, roof, roof2, sign, mug);
}

/** Three-storey house used for the "한 칸씩" build montage and the showroom sample. */
export function house(): Vox[] {
  const out: Vox[][] = [];
  const W = 9;
  const D = 7;
  const floorH = 4;
  for (let f = 0; f < 3; f++) {
    const z0 = f * floorH;
    const wall: ColorTokenName = f === 0 ? 'paper-100' : f === 1 ? 'paper-0' : 'paper-100';
    for (let x = 0; x < W; x++)
      for (let y = 0; y < D; y++)
        for (let z = z0; z < z0 + floorH; z++) {
          const edge = x === 0 || y === 0 || x === W - 1 || y === D - 1;
          if (!edge && z !== z0) continue;
          const corner = (x === 0 || x === W - 1) && (y === 0 || y === D - 1);
          out.push([{ x, y, z, c: corner ? 'sun-d' : z === z0 ? 'sun-d' : wall }]);
        }
    out.push(box(2, D - 1, z0 + 1, 2, 1, 2, 'sky'), box(6, D - 1, z0 + 1, 2, 1, 2, 'sky'), box(W - 1, 2, z0 + 1, 1, 3, 2, 'sky'));
  }
  out.push(box(4, D - 1, 0, 1, 1, 3, 'brand-d'));
  for (let i = 0; i < 4; i++) out.push(box(-1 + i, -1 + i, 12 + i, W + 2 - i * 2, D + 2 - i * 2, 1, i % 2 === 0 ? 'brand-d' : 'brand'));
  return merge(...out);
}

/** Sort for a "built one block at a time" reveal: bottom layer first, then back to front. */
export function buildOrder(list: readonly Vox[]): Vox[] {
  return [...list].sort((a, b) => a.z - b.z || a.y - b.y || a.x - b.x);
}

export function honeyCup(): Vox[] {
  return merge(box(0, 0, 0, 3, 3, 3, 'paper-0'), box(0, 0, 3, 3, 3, 1, 'sun-d'), box(3, 1, 1, 1, 1, 1, 'paper-0'));
}

export function floatingIsland(top: ColorTokenName, body: ColorTokenName): Vox[] {
  return merge(box(0, 0, 0, 6, 6, 1, top), box(1, 1, -1, 4, 4, 1, body), box(2, 2, -2, 2, 2, 1, body));
}
