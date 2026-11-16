/**
 * Season weather around the camera (packages/content world-setup.ts, G07): petals in spring, sun motes in summer,
 * maple leaves in autumn, snow in winter. One Points cloud in a box that follows the camera and wraps, so the cost
 * is the same everywhere (240 points on low, 480 otherwise). Calm, slow motion only (docs/08 6: no flashing).
 */
import * as THREE from 'three';
import type { WorldSeason } from '@lcw/content';

const LOOK: Record<WorldSeason, { colors: number[]; size: number; fall: number; sway: number; opacity: number }> = {
  spring: { colors: [0xffc6d6, 0xff9cc2, 0xfff1f5], size: 0.12, fall: 0.55, sway: 0.6, opacity: 0.95 },
  summer: { colors: [0xfff3b0, 0xffffff], size: 0.06, fall: -0.05, sway: 0.25, opacity: 0.55 },
  autumn: { colors: [0xe8742a, 0xd9622b, 0xffb347, 0xb5452a], size: 0.14, fall: 0.8, sway: 0.9, opacity: 0.95 },
  winter: { colors: [0xffffff, 0xeef6ff], size: 0.1, fall: 0.7, sway: 0.35, opacity: 0.95 }
};

const BOX = 22;
const HALF = BOX / 2;

export class SeasonWeather {
  readonly points: THREE.Points;
  readonly season: WorldSeason;
  private readonly geo: THREE.BufferGeometry;
  private readonly mat: THREE.PointsMaterial;
  private readonly base: Float32Array;
  private readonly phase: Float32Array;
  private t = 0;

  constructor(season: WorldSeason, count: number) {
    this.season = season;
    const look = LOOK[season];
    this.base = new Float32Array(count * 3);
    this.phase = new Float32Array(count);
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      this.base[i * 3] = Math.random() * BOX;
      this.base[i * 3 + 1] = Math.random() * BOX;
      this.base[i * 3 + 2] = Math.random() * BOX;
      this.phase[i] = Math.random() * Math.PI * 2;
      c.setHex(look.colors[i % look.colors.length]!);
      col.set([c.r, c.g, c.b], i * 3);
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.mat = new THREE.PointsMaterial({ size: look.size, vertexColors: true, transparent: true, opacity: look.opacity, depthWrite: false, sizeAttenuation: true });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
  }

  /** Per frame: drift and wrap the box around the camera. */
  update(dt: number, cam: THREE.Vector3): void {
    this.t += dt;
    const look = LOOK[this.season];
    const pos = this.geo.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const n = this.phase.length;
    const ox = cam.x - HALF;
    const oy = cam.y - HALF * 0.6;
    const oz = cam.z - HALF;
    for (let i = 0; i < n; i++) {
      const ph = this.phase[i]!;
      let y = this.base[i * 3 + 1]! - look.fall * dt;
      if (y < 0) y += BOX;
      if (y > BOX) y -= BOX;
      this.base[i * 3 + 1] = y;
      const sx = Math.sin(this.t * 0.7 + ph) * look.sway;
      const sz = Math.cos(this.t * 0.5 + ph * 1.3) * look.sway * 0.6;
      arr[i * 3] = ox + mod(this.base[i * 3]! + sx - ox, BOX);
      arr[i * 3 + 1] = oy + y;
      arr[i * 3 + 2] = oz + mod(this.base[i * 3 + 2]! + sz - oz, BOX);
    }
    pos.needsUpdate = true;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}

/** Positive modulo (world positions wrap into the box that follows the camera). */
export function mod(a: number, m: number): number {
  return ((a % m) + m) % m;
}
