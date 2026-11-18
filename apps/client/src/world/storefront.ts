/**
 * Store fronts and landmarks (R2627, Dan 11-16: "어느 게 상점인지도 제대로 안나타나며"). The town's blocks stay the
 * server's (sim-core town.ts, every block through setBlock); what makes a store read as a store at a glance is drawn
 * here as client meshes on top of them:
 *
 *  - a fascia board over the awning with the store's name in the learning language and its icon;
 *  - a double-sided sign hanging from an arm over the curb, its board over head height (2 m), its one post at the
 *    building's end, readable from the plaza walking toward it and never in the way of a walking child;
 *  - a round landmark badge over the roof (always turned to the camera), the icon seen from anywhere in town;
 *  - warm light behind every window of the store, brighter at dusk and night.
 *
 * Every store is ONE draw call for its boards (one merged geometry, one canvas texture), the badges share one
 * material each, the window light of all stores is one merged mesh. Text is painted once into a canvas (again when
 * the web font arrives or the learning language / help switch changes), never per frame. Low tier boards are half
 * the canvas size.
 */
import * as THREE from 'three';
import type { VoxelWorld } from '@lcw/sim-core';
import { COLOR_TOKENS as C, TYPOGRAPHY_TOKENS as T } from '@lcw/ui';
import type { SceneId } from './api.js';
import { onLearnLang } from './lang.js';
import { SCENE_TITLES_EN } from './strings.js';

export type StoreIcon = 'cafe' | 'trade';

export interface StoreDef {
  id: 'honey_cafe' | 'trade_shop';
  /** scene whose NPC keeps the store */
  scene: SceneId;
  icon: StoreIcon;
  /** brand colour of the store (board frame, badge ring, minimap pin) */
  color: number;
  /** board paint */
  board: number;
  /** block box of the building (walls included) */
  box: { x0: number; x1: number; z0: number; z1: number; y1: number };
  /** the front wall: its x and the way it faces (+1 = east, -1 = west) */
  front: { x: number; facing: 1 | -1 };
  /** fascia board over the awning: z span and y span */
  fascia: { z0: number; z1: number; y0: number; y1: number };
  /** the road sign: the centre of its board, and which end its post stands at (-1 = the -z end, +1 = the +z end) */
  post: { x: number; z: number; end: 1 | -1 };
  /** landmark badge over the roof ridge */
  badge: { x: number; y: number; z: number };
  /** where the door is (the minimap pin and the way-finding target) */
  door: { x: number; z: number };
}

/** The two stores of the lesson town (block layout: packages/sim-core/src/town.ts honeyCafe / tradeShop). */
export const STORES: readonly StoreDef[] = [
  {
    id: 'honey_cafe',
    scene: 'honey_cafe',
    icon: 'cafe',
    color: 0xffc53d,
    board: 0x7a4a26,
    box: { x0: 166, x1: 178, z0: 128, z1: 140, y1: 6 },
    front: { x: 166, facing: -1 },
    fascia: { z0: 129.6, z1: 139.4, y0: 5.08, y1: 6.95 },
    // board over the cafe's front yard (its arm stops short of the awning at z 139), post on the curb (walker.3 cuts
    // the corner by the building)
    post: { x: 165.3, z: 140.4, end: 1 },
    badge: { x: 172.5, y: 17.2, z: 134.5 },
    door: { x: 165.2, z: 134.5 }
  },
  {
    id: 'trade_shop',
    scene: 'trade_shop',
    icon: 'trade',
    color: 0x3fa9f5,
    board: 0x2f3b52,
    box: { x0: 110, x1: 122, z0: 128, z1: 140, y1: 6 },
    front: { x: 123, facing: 1 },
    fascia: { z0: 129.6, z1: 139.4, y0: 5.08, y1: 6.95 },
    // board over the curb, post in the shop's yard
    post: { x: 123.3, z: 141.5, end: -1 },
    badge: { x: 116.5, y: 17.2, z: 134.5 },
    door: { x: 123.8, z: 135.5 }
  }
];

/** Half the road sign's board width (m). */
export const POST_HALF_W = 1.25;

/** Where the road sign's post stands: just past the board's end (post.end), so the post never crosses the name. */
export function signPost(def: Pick<StoreDef, 'post'>): { x: number; z: number } {
  return { x: def.post.x, z: def.post.z + def.post.end * (POST_HALF_W + 0.12) };
}
/** The road sign's board: bottom and top (block y; the ground's top is y 1), so its underside is 2 m above the ground. */
export const SIGN_Y0 = 3.0;
export const SIGN_Y1 = 3.95;
/** The top of the sign's post and arm. */
export const SIGN_TOP = SIGN_Y1 + 0.32;

/**
 * Name painted on a store's signs: its scene's title in the learning language only. The Korean help never goes on
 * a sign (it would halve the letters, and the sign is a word the child reads).
 */
export function storeName(def: Pick<StoreDef, 'scene'>): string {
  return SCENE_TITLES_EN[def.scene as keyof typeof SCENE_TITLES_EN] ?? def.scene;
}

const SIGN_FONT = T.fonts.target;
const INK = C['ink-900'];
const CREAM = C['paper-50'];

function css(c: number): string {
  return `#${c.toString(16).padStart(6, '0')}`;
}

/** The store's icon in a box of size `s` centred at (cx, cy): vector paths only (no emoji, no image). */
export function drawStoreIcon(g: CanvasRenderingContext2D, icon: StoreIcon, cx: number, cy: number, s: number, ink: string, accent: string): void {
  g.save();
  g.translate(cx, cy);
  g.scale(s / 100, s / 100);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  if (icon === 'cafe') {
    // a mug with a honey drip and two curls of steam
    g.fillStyle = accent;
    g.strokeStyle = ink;
    g.lineWidth = 7;
    g.beginPath();
    g.roundRect(-34, -10, 54, 46, 10);
    g.fill();
    g.stroke();
    g.beginPath();
    g.arc(26, 12, 13, -Math.PI / 2, Math.PI / 2);
    g.stroke();
    g.fillStyle = ink;
    g.beginPath();
    g.moveTo(-28, -10);
    g.quadraticCurveTo(-24, 8, -18, 6);
    g.quadraticCurveTo(-14, -2, -10, -10);
    g.closePath();
    g.fill();
    g.lineWidth = 6;
    for (const x of [-18, 2]) {
      g.beginPath();
      g.moveTo(x, -20);
      g.bezierCurveTo(x - 10, -30, x + 10, -38, x, -48);
      g.stroke();
    }
  } else {
    // two arrows passing each other: give one thing, get another
    g.strokeStyle = ink;
    g.fillStyle = accent;
    g.lineWidth = 7;
    const arrow = (y: number, dir: 1 | -1): void => {
      g.beginPath();
      g.moveTo(-36 * dir, y - 9);
      g.lineTo(14 * dir, y - 9);
      g.lineTo(14 * dir, y - 22);
      g.lineTo(40 * dir, y);
      g.lineTo(14 * dir, y + 22);
      g.lineTo(14 * dir, y + 9);
      g.lineTo(-36 * dir, y + 9);
      g.closePath();
      g.fill();
      g.stroke();
    };
    arrow(-20, 1);
    g.fillStyle = CREAM;
    arrow(22, -1);
  }
  g.restore();
}

/** Paint a sign board (wood plank with a coloured frame, the icon, the name) into a canvas of w x h px. */
export function paintBoard(g: CanvasRenderingContext2D, def: StoreDef, name: string, w: number, h: number): void {
  const frame = Math.round(h * 0.09);
  g.clearRect(0, 0, w, h);
  g.fillStyle = css(def.color);
  g.beginPath();
  g.roundRect(0, 0, w, h, h * 0.16);
  g.fill();
  const grd = g.createLinearGradient(0, frame, 0, h - frame);
  const b = new THREE.Color(def.board);
  const lighter = b.clone().lerp(new THREE.Color(0xffffff), 0.12);
  grd.addColorStop(0, `#${lighter.getHexString()}`);
  grd.addColorStop(1, css(def.board));
  g.fillStyle = grd;
  g.beginPath();
  g.roundRect(frame, frame, w - frame * 2, h - frame * 2, h * 0.1);
  g.fill();
  // plank seams and a little grain so the board reads as painted wood, not a flat UI rectangle
  g.strokeStyle = 'rgba(0,0,0,0.16)';
  g.lineWidth = Math.max(1, h * 0.012);
  for (let k = 1; k < 3; k++) {
    const y = frame + ((h - frame * 2) * k) / 3;
    g.beginPath();
    g.moveTo(frame * 1.5, y);
    g.lineTo(w - frame * 1.5, y);
    g.stroke();
  }
  g.strokeStyle = 'rgba(255,255,255,0.05)';
  for (let i = 0; i < 26; i++) {
    const y = frame + ((i * 37) % 100) * (h - frame * 2) * 0.01;
    g.beginPath();
    g.moveTo(frame * 2 + ((i * 53) % 60), y);
    g.lineTo(w - frame * 2 - ((i * 31) % 80), y + h * 0.01);
    g.stroke();
  }
  const iconS = h * 0.62;
  const iconX = frame + h * 0.12 + iconS / 2;
  g.fillStyle = CREAM;
  g.beginPath();
  g.arc(iconX, h / 2, iconS * 0.62, 0, Math.PI * 2);
  g.fill();
  drawStoreIcon(g, def.icon, iconX, h / 2 + iconS * 0.04, iconS * 0.86, INK, css(def.color));
  const left = iconX + iconS * 0.75;
  const room = w - left - frame * 2.2;
  let size = h * 0.5;
  g.font = `700 ${size}px ${SIGN_FONT}`;
  const text = name.toUpperCase();
  const tw = g.measureText(text).width;
  if (tw > room) size *= room / tw;
  g.font = `700 ${size}px ${SIGN_FONT}`;
  g.textBaseline = 'middle';
  g.textAlign = 'center';
  const cx = left + room / 2;
  g.lineWidth = size * 0.16;
  g.strokeStyle = 'rgba(27,31,42,0.85)';
  g.strokeText(text, cx, h / 2 + size * 0.04);
  g.fillStyle = CREAM;
  g.fillText(text, cx, h / 2 + size * 0.04);
}

/** Paint the round landmark badge (icon on cream in the store's colour ring). */
export function paintBadge(g: CanvasRenderingContext2D, def: StoreDef, s: number): void {
  g.clearRect(0, 0, s, s);
  const r = s / 2;
  g.fillStyle = 'rgba(27,31,42,0.35)';
  g.beginPath();
  g.arc(r, r + s * 0.02, r * 0.96, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = css(def.color);
  g.beginPath();
  g.arc(r, r, r * 0.94, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = CREAM;
  g.beginPath();
  g.arc(r, r, r * 0.76, 0, Math.PI * 2);
  g.fill();
  drawStoreIcon(g, def.icon, r, r + s * 0.03, s * 0.56, INK, css(def.color));
}

function canvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  return new OffscreenCanvas(w, h);
}

/** A rectangle facing +x/-x (the board planes) as 4 corners + uv, pushed into merged arrays. */
function pushQuad(
  pos: number[],
  uv: number[],
  nrm: number[],
  idx: number[],
  x: number,
  facing: 1 | -1,
  z0: number,
  z1: number,
  y0: number,
  y1: number,
  u0: number,
  u1: number,
  v0: number,
  v1: number
): void {
  const base = pos.length / 3;
  // seen from the facing side, the left edge is at larger z for +x facing, smaller z for -x facing
  const zl = facing === 1 ? z1 : z0;
  const zr = facing === 1 ? z0 : z1;
  pos.push(x, y0, zl, x, y0, zr, x, y1, zr, x, y1, zl);
  uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
  for (let i = 0; i < 4; i++) nrm.push(facing, 0, 0);
  idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

/** A box (posts, the board's edge) without uv detail: samples one texel strip of the frame colour. */
function pushBox(pos: number[], uv: number[], nrm: number[], idx: number[], cx: number, cz: number, y0: number, y1: number, hw: number, hd: number, u: number, v: number): void {
  const faces: Array<[[number, number, number], number[][]]> = [
    [[1, 0, 0], [[cx + hw, y0, cz + hd], [cx + hw, y0, cz - hd], [cx + hw, y1, cz - hd], [cx + hw, y1, cz + hd]]],
    [[-1, 0, 0], [[cx - hw, y0, cz - hd], [cx - hw, y0, cz + hd], [cx - hw, y1, cz + hd], [cx - hw, y1, cz - hd]]],
    [[0, 0, 1], [[cx - hw, y0, cz + hd], [cx + hw, y0, cz + hd], [cx + hw, y1, cz + hd], [cx - hw, y1, cz + hd]]],
    [[0, 0, -1], [[cx + hw, y0, cz - hd], [cx - hw, y0, cz - hd], [cx - hw, y1, cz - hd], [cx + hw, y1, cz - hd]]],
    [[0, 1, 0], [[cx - hw, y1, cz + hd], [cx + hw, y1, cz + hd], [cx + hw, y1, cz - hd], [cx - hw, y1, cz - hd]]]
  ];
  for (const [n, c] of faces) {
    const base = pos.length / 3;
    for (const p of c) {
      pos.push(p[0]!, p[1]!, p[2]!);
      uv.push(u, v);
      nrm.push(n[0], n[1], n[2]);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

/** How dark it is, 0 (day) .. 1 (night), from the hour: drives the sign back-light and the window glow. */
export function nightAmount(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  if (h >= 7.5 && h <= 16.5) return 0;
  if (h > 16.5 && h < 19.5) return (h - 16.5) / 3;
  if (h >= 4.5 && h < 7.5) return 1 - (h - 4.5) / 3;
  return 1;
}

/**
 * Windows of a store: the glass blocks in its walls (block coords + outward normal). Door and counter openings get no
 * glow plane, so the room behind them stays in plain view.
 */
export function storeWindows(world: Pick<VoxelWorld, 'getBlock'>, def: StoreDef, glassId = 9): Array<{ x: number; y: number; z: number; nx: number; nz: number }> {
  const out: Array<{ x: number; y: number; z: number; nx: number; nz: number }> = [];
  const { x0, x1, z0, z1, y1 } = def.box;
  for (let y = 1; y <= y1 - 1; y++) {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const wallX = x === x0 || x === x1;
        const wallZ = z === z0 || z === z1;
        if (!wallX && !wallZ) continue;
        if (wallX && wallZ) continue;
        const id = world.getBlock(x, y, z);
        if (id !== glassId) continue;
        const nx = wallX ? (x === x0 ? -1 : 1) : 0;
        const nz = wallZ ? (z === z0 ? -1 : 1) : 0;
        out.push({ x, y, z, nx, nz });
      }
    }
  }
  return out;
}

export class Storefronts {
  readonly root = new THREE.Group();
  private readonly boards: Array<{ def: StoreDef; mat: THREE.MeshLambertMaterial; tex: THREE.CanvasTexture; c: HTMLCanvasElement | OffscreenCanvas }> = [];
  private readonly badges: Array<{ sprite: THREE.Sprite; baseY: number; phase: number }> = [];
  private readonly glowMat: THREE.MeshBasicMaterial;
  private night = -1;
  private t = 0;
  private readonly offLang: () => void;

  /** `small`: the low tier's half-size canvases (about 1.2 MB of texture instead of 4.7 MB). */
  constructor(world: Pick<VoxelWorld, 'getBlock'>, anisotropy = 1, small = false) {
    const BW = small ? 512 : 1024;
    const BH = small ? 96 : 192;
    const BADGE = small ? 128 : 256;
    for (const def of STORES) {
      const c = canvas(BW, BH * 2);
      const tex = new THREE.CanvasTexture(c as HTMLCanvasElement);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = anisotropy;
      const mat = new THREE.MeshLambertMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.18 });
      this.boards.push({ def, mat, tex, c });
      // one merged geometry: fascia (top half of the canvas), the road sign's two faces, its post and edges
      const pos: number[] = [];
      const uv: number[] = [];
      const nrm: number[] = [];
      const idx: number[] = [];
      const f = def.fascia;
      const fx = def.front.x + (def.front.facing === 1 ? 0.04 : -0.04);
      pushQuad(pos, uv, nrm, idx, fx, def.front.facing, f.z0, f.z1, f.y0, f.y1, 0, 1, 0.5, 1);
      // the road sign: a board 2.5 x 0.95 m over head height on one post, both faces painted (bottom half of the canvas)
      const p = def.post;
      const sw = POST_HALF_W;
      const sy0 = SIGN_Y0;
      const sy1 = SIGN_Y1;
      pushQuad(pos, uv, nrm, idx, p.x + 0.06, 1, p.z - sw, p.z + sw, sy0, sy1, 0, 1, 0, 0.5);
      pushQuad(pos, uv, nrm, idx, p.x - 0.06, -1, p.z - sw, p.z + sw, sy0, sy1, 0, 1, 0, 0.5);
      // posts and the board's edge: frame colour (a texel at the canvas's coloured rim)
      const fu = 0.004;
      const fv = 0.25;
      // the post at the building end and the arm the board hangs from (the text is never crossed by the post)
      const pp = signPost(def);
      pushBox(pos, uv, nrm, idx, pp.x, pp.z, 1, SIGN_TOP, 0.09, 0.09, fu, fv);
      const far = p.z - p.end * sw;
      pushBox(pos, uv, nrm, idx, p.x, (pp.z + far) / 2, sy1 + 0.18, sy1 + 0.3, 0.07, Math.abs(far - pp.z) / 2 + 0.05, fu, fv);
      for (const hz of [p.z - sw + 0.25, p.z + sw - 0.25]) pushBox(pos, uv, nrm, idx, p.x, hz, sy1, sy1 + 0.18, 0.02, 0.02, fu, fv);
      pushBox(pos, uv, nrm, idx, p.x, p.z, sy1, sy1 + 0.06, 0.055, sw, fu, fv);
      pushBox(pos, uv, nrm, idx, p.x, p.z, sy0 - 0.06, sy0, 0.055, sw, fu, fv);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx);
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = `storefront.${def.id}`;
      this.root.add(mesh);

      // landmark badge over the roof
      const bc = canvas(BADGE, BADGE);
      paintBadge(bc.getContext('2d') as CanvasRenderingContext2D, def, BADGE);
      const btex = new THREE.CanvasTexture(bc as HTMLCanvasElement);
      btex.colorSpace = THREE.SRGBColorSpace;
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: btex, transparent: true, depthWrite: false, fog: false }));
      sprite.scale.set(3.4, 3.4, 1);
      sprite.position.set(def.badge.x, def.badge.y, def.badge.z);
      sprite.name = `badge.${def.id}`;
      this.root.add(sprite);
      this.badges.push({ sprite, baseY: def.badge.y, phase: this.badges.length * 1.7 });
    }
    this.paint();

    // warm light behind every window (one merged mesh for all stores)
    const pos: number[] = [];
    const idx: number[] = [];
    for (const def of STORES) {
      for (const o of storeWindows(world, def)) {
        // the plane sits on the inner face of the glass, facing out, so it is seen through the window
        const base = pos.length / 3;
        if (o.nx !== 0) {
          const x = o.nx > 0 ? o.x - 0.02 : o.x + 1.02;
          const zz = o.nx > 0 ? [o.z + 1, o.z] : [o.z, o.z + 1];
          pos.push(x, o.y, zz[0]!, x, o.y, zz[1]!, x, o.y + 1, zz[1]!, x, o.y + 1, zz[0]!);
        } else {
          const z = o.nz > 0 ? o.z - 0.02 : o.z + 1.02;
          const xx = o.nz > 0 ? [o.x, o.x + 1] : [o.x + 1, o.x];
          pos.push(xx[0]!, o.y, z, xx[1]!, o.y, z, xx[1]!, o.y + 1, z, xx[0]!, o.y + 1, z);
        }
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    this.glowMat = new THREE.MeshBasicMaterial({ color: C.sun, transparent: true, opacity: 0.2, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    const glow = new THREE.Mesh(geo, this.glowMat);
    glow.name = 'storefront.windowLight';
    glow.renderOrder = 2;
    this.root.add(glow);

    // the web font arrives after the first paint: paint the names again with it
    const fonts = (globalThis as { document?: Document }).document?.fonts;
    if (fonts?.load) {
      void fonts
        .load(`700 64px ${SIGN_FONT}`)
        .then(() => this.paint())
        .catch(() => undefined);
    }
    // the learning language or the help switch changed: the names follow
    this.offLang = onLearnLang(() => this.paint());
  }

  /** (Re)paint every board: fascia on the top half of its canvas, the road sign on the bottom half. */
  paint(): void {
    for (const b of this.boards) {
      const g = b.c.getContext('2d') as CanvasRenderingContext2D | null;
      if (!g) continue;
      const w = b.c.width;
      const h = b.c.height / 2;
      const name = storeName(b.def);
      g.save();
      paintBoard(g, b.def, name, w, h);
      g.translate(0, h);
      paintBoard(g, b.def, name, w, h);
      g.restore();
      b.tex.needsUpdate = true;
    }
  }

  /** Per frame: the badges bob a little (not with reduced motion); the back-light and window glow follow the hour. */
  update(dt: number, hour: number, reduceMotion = false): void {
    this.t += dt;
    for (const b of this.badges) b.sprite.position.y = reduceMotion ? b.baseY : b.baseY + Math.sin(this.t * 1.4 + b.phase) * 0.18;
    const n = nightAmount(hour);
    if (Math.abs(n - this.night) < 0.01) return;
    this.night = n;
    for (const b of this.boards) b.mat.emissiveIntensity = 0.18 + n * 0.62;
    this.glowMat.opacity = 0.16 + n * 0.6;
  }

  dispose(): void {
    this.offLang();
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      // sprites share one geometry inside three.js: only meshes own theirs
      if (m.geometry && !(o instanceof THREE.Sprite)) m.geometry.dispose();
      const mat = m.material as THREE.Material | undefined;
      if (mat) {
        const map = (mat as THREE.MeshBasicMaterial).map;
        map?.dispose();
        mat.dispose();
      }
    });
  }
}
