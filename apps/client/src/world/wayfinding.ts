/**
 * "Where do I go next" (R2627): a corner minimap with the stores and the people to talk to, an arrow at the screen
 * edge pointing at the goal when it is out of view (with the distance), and a soft beam of light standing on the
 * goal in the world so it is seen across the town. The goal itself is the world lane's (`setGoalNpc`): the engine
 * hands this module where that NPC stands each frame, or null.
 *
 * Cost: the minimap's ground is painted once from the blocks (one 2D canvas, built a few rows per step so start-up
 * has no long task); per frame only the arrow's transform is written when it shows, and the minimap is redrawn at
 * most 12 times a second and only while it is on screen and something on it moved. The beam is one mesh with one
 * additive material.
 *
 * Place on screen (docs/08 7.2): a mouse screen has it in the bottom-right corner (148 px); a touch screen in the right
 * column under the view button (72 px, 96 px on a tablet), clear of the talk / jump thumb zone, the goal card and
 * the star chip.
 */
import * as THREE from 'three';
import { COLOR_TOKENS as C, SHAPE_TOKENS as S, TYPOGRAPHY_TOKENS as T } from '@lcw/ui';
import { STORES, drawStoreIcon, type StoreDef } from './storefront.js';

export interface GoalTarget {
  x: number;
  y: number;
  z: number;
  /** the NPC id the goal points at (its store gets the highlight on the minimap) */
  npcId: string;
}

export interface MapPerson {
  id: string;
  x: number;
  z: number;
}

/** Town area the minimap covers (block coords), and how many metres the round map shows from its centre. */
export const MINIMAP_AREA = { x0: 92, z0: 92, x1: 200, z1: 200 } as const;
export const MINIMAP_RADIUS_M = 34;

/**
 * Ground colours for the minimap, one RGBA texel per block column: the top block's colour, lighter the higher it is.
 * `colorOf` gives an id's top-face colour (the atlas average), or null for air / plants to look through.
 */
export function minimapPixels(
  getBlock: (x: number, y: number, z: number) => number,
  colorOf: (id: number) => readonly [number, number, number] | null,
  area: { x0: number; z0: number; x1: number; z1: number } = MINIMAP_AREA,
  yTop = 24
): Uint8ClampedArray {
  const steps = minimapSteps(getBlock, colorOf, area, yTop);
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
  }
}

/** The same, 12 rows per step (start-up runs it sliced, handing the main thread back between steps). */
export function* minimapSteps(
  getBlock: (x: number, y: number, z: number) => number,
  colorOf: (id: number) => readonly [number, number, number] | null,
  area: { x0: number; z0: number; x1: number; z1: number } = MINIMAP_AREA,
  yTop = 24
): Generator<void, Uint8ClampedArray> {
  const w = area.x1 - area.x0;
  const h = area.z1 - area.z0;
  const px = new Uint8ClampedArray(w * h * 4);
  for (let z = 0; z < h; z++) {
    if (z > 0 && z % 12 === 0) yield;
    for (let x = 0; x < w; x++) {
      let col: readonly [number, number, number] | null = null;
      let y = yTop;
      for (; y >= -2; y--) {
        const id = getBlock(area.x0 + x, y, area.z0 + z);
        if (id === 0) continue;
        col = colorOf(id);
        if (col) break;
      }
      const i = (z * w + x) * 4;
      const c = col ?? [120, 160, 90];
      // buildings stand out: every block above the ground lifts the colour a little, the edge of a roof darkens
      const lift = Math.max(0, Math.min(1, y / 14));
      px[i] = c[0] * (0.82 + lift * 0.3);
      px[i + 1] = c[1] * (0.82 + lift * 0.3);
      px[i + 2] = c[2] * (0.82 + lift * 0.3);
      px[i + 3] = 255;
    }
  }
  return px;
}

/**
 * Where the edge arrow sits: the point on the screen rectangle (inset by the margins) along the direction (dx, dy)
 * from the centre, and the arrow's angle (0 = pointing right, clockwise in screen space).
 */
export function edgePoint(dx: number, dy: number, w: number, h: number, inset: { top: number; right: number; bottom: number; left: number }): { x: number; y: number; angle: number } {
  const cx = w / 2;
  const cy = h / 2;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const tx = ux > 0 ? (w - inset.right - cx) / ux : ux < 0 ? (inset.left - cx) / ux : Infinity;
  const ty = uy > 0 ? (h - inset.bottom - cy) / uy : uy < 0 ? (inset.top - cy) / uy : Infinity;
  const t = Math.max(0, Math.min(tx, ty));
  return { x: cx + ux * t, y: cy + uy * t, angle: Math.atan2(uy, ux) };
}

/** The store whose keeper the goal is (its pin is highlighted), or null. */
export function storeOfNpc(npcId: string | null, stores: readonly StoreDef[] = STORES): StoreDef | null {
  if (!npcId) return null;
  if (npcId === 'cafe_owner') return stores.find((s) => s.id === 'honey_cafe') ?? null;
  if (npcId === 'shop_owner') return stores.find((s) => s.id === 'trade_shop') ?? null;
  return null;
}

const INK = C['ink-900'];
const CREAM = C['paper-50'];
/** where the minimap sits (CSS px), per kind of screen; the layout check in tools/hud-layout.mjs measures the result */
export const MINIMAP_PLACE = {
  mouse: { bottom: 24, right: 12, size: 148 },
  touch: { top: 124, right: 12, size: 72 },
  tablet: { top: 124, right: 12, size: 96 }
} as const;

const STYLE_ID = 'lcw-wayfinding-style';
function css(): string {
  const m = MINIMAP_PLACE;
  return `
.lw-mini{position:absolute;bottom:${m.mouse.bottom}px;right:${m.mouse.right}px;width:${m.mouse.size}px;height:${m.mouse.size}px;border-radius:50%;border:${S.borderWidthPx}px solid ${C['ink-900']};box-shadow:${S.shadowDefault};overflow:hidden;background:${C['paper-100']};pointer-events:none;transition:opacity 240ms ease-out}
.lw-mini canvas{width:100%;height:100%;display:block}
.lw-hud.dlg .lw-mini,.lw-hud.dlg .lw-edge{opacity:0}
.lw-edge{position:absolute;left:0;top:0;width:0;height:0;display:none;pointer-events:none;will-change:transform}
.lw-edge.on{display:block}
.lw-edge .a{position:absolute;left:-26px;top:-26px;width:52px;height:52px;border-radius:50%;background:${C.brand};border:${S.borderWidthPx}px solid ${C['ink-900']};box-shadow:${S.shadowDefault};display:flex;align-items:center;justify-content:center}
.lw-edge .a i{display:block;width:0;height:0;border-top:11px solid transparent;border-bottom:11px solid transparent;border-left:18px solid ${C['paper-0']};margin-left:4px}
.lw-edge .d{position:absolute;left:0;top:30px;transform:translateX(-50%);background:${C['ink-900']};color:${C['paper-0']};font-family:${T.fonts.ui};font-weight:800;font-size:${T.scale.small.sizePx}px;line-height:${T.scale.small.lineHeightPx}px;padding:1px 8px;border-radius:${S.radiusButtonPx}px;white-space:nowrap}
@keyframes lwedge{0%,100%{transform:scale(1)}50%{transform:scale(1.12)}}
.lw-edge .a{animation:lwedge 1.2s ease-in-out infinite}
@media (pointer:coarse){.lw-mini{bottom:auto;top:${m.tablet.top}px;right:${m.tablet.right}px;width:${m.tablet.size}px;height:${m.tablet.size}px}}
@media (pointer:coarse) and (max-width:600px),(pointer:coarse) and (max-height:500px){.lw-mini{width:${m.touch.size}px;height:${m.touch.size}px;top:${m.touch.top}px;right:${m.touch.right}px}}
@media (pointer:coarse){.lw-hud.off .lw-mini{top:calc(${m.touch.top}px + var(--lw-net-h,30px) + 2px)}}
@media (prefers-reduced-motion:reduce){.lw-edge .a{animation:none}}
.lw-edge.rm .a{animation:none}
`;
}

export class Wayfinder {
  readonly beam: THREE.Mesh;
  private readonly beamMat: THREE.ShaderMaterial;
  private readonly mini: HTMLDivElement;
  private readonly cv: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D | null;
  private ground: HTMLCanvasElement | null = null;
  private readonly edge: HTMLDivElement;
  private readonly arrow: HTMLElement;
  private readonly dist: HTMLElement;
  private lastDraw = 0;
  private distText = '';
  private edgeOn = false;
  private rm = false;
  /** what the last minimap picture showed (skip the redraw when nothing moved) */
  private drawnKey = '';
  private readonly v = new THREE.Vector3();
  private t = 0;

  constructor(hudRoot: HTMLElement) {
    if (typeof document !== 'undefined' && !document.getElementById(STYLE_ID)) {
      const st = document.createElement('style');
      st.id = STYLE_ID;
      st.textContent = css();
      document.head.appendChild(st);
    }
    this.mini = document.createElement('div');
    this.mini.className = 'lw-mini';
    this.mini.dataset.testid = 'minimap';
    this.cv = document.createElement('canvas');
    this.cv.width = 296;
    this.cv.height = 296;
    this.mini.appendChild(this.cv);
    this.g = this.cv.getContext('2d');
    hudRoot.appendChild(this.mini);
    this.edge = document.createElement('div');
    this.edge.className = 'lw-edge';
    this.edge.dataset.testid = 'goal-arrow';
    this.arrow = document.createElement('div');
    this.arrow.className = 'a';
    this.arrow.appendChild(document.createElement('i'));
    this.dist = document.createElement('div');
    this.dist.className = 'd';
    this.edge.append(this.arrow, this.dist);
    hudRoot.appendChild(this.edge);

    // a soft column of light on the goal: bright at the bottom, fading up, gently pulsing; seen through the town
    this.beamMat = new THREE.ShaderMaterial({
      uniforms: { uT: { value: 0 }, uA: { value: 0 }, uFlow: { value: 1 }, uCol: { value: new THREE.Color(C.sun) } },
      vertexShader: /* glsl */ `
varying float vH;
varying vec3 vN;
varying vec3 vV;
void main() {
  vH = uv.y;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`,
      fragmentShader: /* glsl */ `
uniform float uT;
uniform float uA;
uniform float uFlow;
uniform vec3 uCol;
varying float vH;
varying vec3 vN;
varying vec3 vV;
void main() {
  float rim = pow(1.0 - abs(dot(vN, vV)), 1.5);
  float fade = (1.0 - vH) * (1.0 - vH);
  float band = 0.75 + 0.25 * uFlow * sin(vH * 18.0 - uT * 3.0);
  float a = uA * fade * (0.35 + 0.65 * rim) * band;
  gl_FragColor = vec4(uCol * (1.2 + rim), a);
}`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: false
    });
    const geo = new THREE.CylinderGeometry(0.55, 0.75, 22, 20, 1, true);
    geo.translate(0, 11, 0);
    this.beam = new THREE.Mesh(geo, this.beamMat);
    this.beam.name = 'goal.beam';
    this.beam.frustumCulled = false;
    this.beam.renderOrder = 5;
    this.beam.visible = false;
  }

  /** Paint the minimap's ground once (call again after the town changes a lot; not needed per block). */
  setGround(px: Uint8ClampedArray, w: number, h: number): void {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    if (!g) return;
    g.putImageData(new ImageData(px as Uint8ClampedArray<ArrayBuffer>, w, h), 0, 0);
    this.ground = c;
    this.lastDraw = 0;
  }

  /**
   * Per frame. `camera` is the world camera after it moved; `heading` the yaw the view faces (forward = up on the map);
   * `goal` the NPC to reach or null; `people` the talkable NPCs (read at the minimap's pace); `w`/`h` the canvas size
   * in CSS px; `hidden` while a dialog, a pause or the title screen owns the screen; `reduceMotion` the app setting
   * (no pulsing, no flowing beam).
   */
  update(
    dt: number,
    camera: THREE.PerspectiveCamera,
    player: { x: number; z: number },
    heading: number,
    goal: GoalTarget | null,
    people: () => readonly MapPerson[],
    w: number,
    h: number,
    hidden: boolean,
    nowMs: number,
    reduceMotion = false
  ): void {
    this.t += dt;
    if (reduceMotion !== this.rm) {
      this.rm = reduceMotion;
      this.edge.classList.toggle('rm', reduceMotion);
      this.beamMat.uniforms.uFlow!.value = reduceMotion ? 0 : 1;
    }
    // ---- beam on the goal: fades out as the child arrives (the '!' over the NPC takes over up close)
    const d = goal ? Math.hypot(goal.x - player.x, goal.z - player.z) : 0;
    const want = goal && !hidden ? Math.max(0, Math.min(1, (d - 5) / 8)) : 0;
    const a = this.beamMat.uniforms.uA!;
    a.value += (want - a.value) * Math.min(1, dt * 4);
    this.beamMat.uniforms.uT!.value = this.t;
    this.beam.visible = a.value > 0.01;
    if (goal) this.beam.position.set(goal.x, goal.y, goal.z);

    // ---- edge arrow when the goal is out of view
    let showEdge = false;
    if (goal && !hidden && d > 3) {
      this.v.set(goal.x, goal.y + 1.2, goal.z).applyMatrix4(camera.matrixWorldInverse);
      const behind = this.v.z > 0;
      this.v.applyMatrix4(camera.projectionMatrix);
      let sx = this.v.x;
      let sy = -this.v.y;
      if (behind) {
        sx = -sx;
        sy = -sy;
      }
      const off = behind || Math.abs(sx) > 0.92 || Math.abs(sy) > 0.88;
      if (off) {
        showEdge = true;
        // clear of the goal card and the touch minimap at the top, the hotbar / jump at the bottom, the mouse minimap
        const narrow = w < 600;
        const p = edgePoint(sx * w, sy * h, w, h, { top: narrow ? 214 : 120, right: narrow ? 40 : 56, bottom: narrow ? 170 : 190, left: 40 });
        this.edge.style.transform = `translate(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px)`;
        this.arrow.style.transform = `rotate(${p.angle.toFixed(3)}rad)`;
        const txt = `${Math.round(d)} m`;
        if (txt !== this.distText) {
          this.distText = txt;
          this.dist.textContent = txt;
        }
      }
    }
    if (showEdge !== this.edgeOn) {
      this.edgeOn = showEdge;
      this.edge.classList.toggle('on', showEdge);
      this.edge.dataset.on = showEdge ? '1' : '0';
    }

    // ---- minimap (at most 12 Hz, only while shown, only when something on it changed)
    if (hidden || nowMs - this.lastDraw < 83) return;
    this.lastDraw = nowMs;
    const ps = people();
    let key = `${player.x.toFixed(1)},${player.z.toFixed(1)},${heading.toFixed(2)},${goal?.npcId ?? ''}`;
    for (const p of ps) key += `|${p.id}:${p.x.toFixed(1)},${p.z.toFixed(1)}`;
    // the goal ring pulses: keep drawing while a goal person is on the map (unless motion is reduced)
    const pulsing = !!goal && !reduceMotion && ps.some((p) => p.id === goal.npcId);
    if (!pulsing && key === this.drawnKey) return;
    this.drawnKey = key;
    this.drawMap(player, heading, goal, ps);
  }

  private drawMap(player: { x: number; z: number }, heading: number, goal: GoalTarget | null, people: readonly MapPerson[]): void {
    const g = this.g;
    if (!g) return;
    const W = this.cv.width;
    const R = W / 2;
    const k = R / MINIMAP_RADIUS_M; // px per metre
    g.save();
    g.clearRect(0, 0, W, W);
    g.fillStyle = C['paper-100'];
    g.fillRect(0, 0, W, W);
    g.translate(R, R);
    // forward is up: turn the world so the view direction (sin h, cos h) points to -y on the canvas
    g.rotate(Math.PI + heading);
    g.scale(k, k);
    g.translate(-player.x, -player.z);
    // map x -> canvas x, map z -> canvas y; with the turn above, heading (sin h, cos h) points up
    if (this.ground) {
      g.imageSmoothingEnabled = false;
      g.drawImage(this.ground, MINIMAP_AREA.x0, MINIMAP_AREA.z0);
    }
    g.restore();
    const toMap = (x: number, z: number): [number, number] => {
      const dx = x - player.x;
      const dz = z - player.z;
      const c = Math.cos(Math.PI + heading);
      const s = Math.sin(Math.PI + heading);
      return [R + (dx * c - dz * s) * k, R + (dx * s + dz * c) * k];
    };
    const clampEdge = (p: [number, number], m: number): [number, number, boolean] => {
      const dx = p[0] - R;
      const dy = p[1] - R;
      const len = Math.hypot(dx, dy);
      if (len <= R - m) return [p[0], p[1], false];
      return [R + (dx / len) * (R - m), R + (dy / len) * (R - m), true];
    };
    const goalStore = storeOfNpc(goal?.npcId ?? null);
    // store pins: round badge with the icon, clamped to the rim when far
    for (const s of STORES) {
      const [x, y] = clampEdge(toMap(s.door.x, s.door.z), 22);
      const big = goalStore === s;
      const r = big ? 21 : 16;
      g.fillStyle = INK;
      g.beginPath();
      g.arc(x, y, r + 3, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = `#${s.color.toString(16).padStart(6, '0')}`;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
      drawStoreIcon(g, s.icon, x, y + 1, r * 1.35, INK, CREAM);
    }
    // people to talk to: small dots; the goal person a pulsing star-yellow ring with '!'
    for (const p of people) {
      const isGoal = goal?.npcId === p.id;
      const [x, y, edge] = clampEdge(toMap(p.x, p.z), isGoal ? 16 : 8);
      if (edge && !isGoal) continue;
      if (isGoal) {
        const pulse = this.rm ? 1 : 1 + Math.sin(this.t * 5) * 0.18;
        g.fillStyle = C.sun;
        g.strokeStyle = INK;
        g.lineWidth = 4;
        g.beginPath();
        g.arc(x, y, 13 * pulse, 0, Math.PI * 2);
        g.fill();
        g.stroke();
        g.fillStyle = INK;
        g.font = `800 20px ${T.fonts.ui}`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('!', x, y + 1);
      } else {
        g.fillStyle = CREAM;
        g.strokeStyle = INK;
        g.lineWidth = 3;
        g.beginPath();
        g.arc(x, y, 6, 0, Math.PI * 2);
        g.fill();
        g.stroke();
      }
    }
    // the player: an arrow in the middle pointing up (the view direction)
    g.fillStyle = C.brand;
    g.strokeStyle = INK;
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(R, R - 16);
    g.lineTo(R + 11, R + 12);
    g.lineTo(R, R + 6);
    g.lineTo(R - 11, R + 12);
    g.closePath();
    g.fill();
    g.stroke();
    this.mini.dataset.goal = goal?.npcId ?? '';
  }

  dispose(): void {
    this.mini.remove();
    this.edge.remove();
    this.beam.geometry.dispose();
    this.beamMat.dispose();
  }
}
