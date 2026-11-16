/**
 * The animal friend a child picked when making their world (packages/content world-setup.ts, G07): a small voxel
 * animal that trots beside the player, settles when the player stops, and hops to catch up. One mesh, its own
 * blob shadow from the ground height the engine passes in. Not talkable and not solid (players and NPCs pass).
 */
import * as THREE from 'three';
import type { WorldBuddy } from '@lcw/content';
import { mergePieces } from './props.js';

const V = 1 / 16;
type Box = [w: number, h: number, d: number, color: number, x: number, y: number, z: number];

const LOOKS: Record<WorldBuddy, { body: number; belly: number; dark: number; nose: number }> = {
  puppy: { body: 0xd9a066, belly: 0xfff1dc, dark: 0x6b4226, nose: 0x1b1f2a },
  kitten: { body: 0x8e98a8, belly: 0xf4ebdd, dark: 0x3a4152, nose: 0xff9cc2 },
  bunny: { body: 0xfff9ee, belly: 0xffffff, dark: 0xffc6d6, nose: 0xff9cc2 },
  chick: { body: 0xffd84d, belly: 0xffe98a, dark: 0xff9b2f, nose: 0xff9b2f }
};

/** Boxes in voxels (1/16 m), facing +z, feet at y=0. */
function boxes(kind: WorldBuddy): Box[] {
  const c = LOOKS[kind];
  const eye = 0x1b1f2a;
  if (kind === 'chick') {
    return [
      [5, 5, 5, c.body, 0, 3.5, 0],
      [4, 4, 4, c.body, 0, 7.2, 1],
      [1.6, 1, 1.6, c.nose, 0, 7, 3.4],
      [0.8, 0.8, 0.4, eye, -1.1, 7.8, 3.1],
      [0.8, 0.8, 0.4, eye, 1.1, 7.8, 3.1],
      [0.8, 2, 0.8, c.dark, -1.2, 0.6, 0],
      [0.8, 2, 0.8, c.dark, 1.2, 0.6, 0],
      [1, 3, 3, c.belly, -2.8, 4, 0],
      [1, 3, 3, c.belly, 2.8, 4, 0]
    ];
  }
  const ears: Box[] =
    kind === 'bunny'
      ? [
          [1.4, 5, 1, c.body, -1.2, 11.6, 0.6],
          [1.4, 5, 1, c.body, 1.2, 11.6, 0.6],
          [0.8, 4, 0.4, c.dark, -1.2, 11.6, 1.1],
          [0.8, 4, 0.4, c.dark, 1.2, 11.6, 1.1]
        ]
      : kind === 'kitten'
        ? [
            [1.6, 1.8, 1, c.body, -1.6, 10.2, 1.4],
            [1.6, 1.8, 1, c.body, 1.6, 10.2, 1.4]
          ]
        : [
            [1.4, 3, 1.2, c.dark, -2.6, 7.4, 2],
            [1.4, 3, 1.2, c.dark, 2.6, 7.4, 2]
          ];
  const tail: Box = kind === 'bunny' ? [2, 2, 2, c.belly, 0, 4.4, -4.6] : kind === 'kitten' ? [1, 1, 5, c.dark, 0, 6, -6] : [1.2, 1.2, 4, c.body, 0, 5.6, -5.4];
  return [
    [5, 4, 8, c.body, 0, 4, 0],
    [4, 1, 6, c.belly, 0, 2.2, 0.4],
    [5, 5, 5, c.body, 0, 7.4, 3.4],
    [3, 2, 1.6, c.belly, 0, 6.4, 6.4],
    [1.2, 1, 0.6, c.nose, 0, 7, 7.3],
    [0.8, 1, 0.4, eye, -1.2, 8.4, 6],
    [0.8, 1, 0.4, eye, 1.2, 8.4, 6],
    [1.4, 2.4, 1.4, c.body, -1.6, 1.2, 2.6],
    [1.4, 2.4, 1.4, c.body, 1.6, 1.2, 2.6],
    [1.4, 2.4, 1.4, c.body, -1.6, 1.2, -2.6],
    [1.4, 2.4, 1.4, c.body, 1.6, 1.2, -2.6],
    tail,
    ...ears
  ];
}

export function makeBuddyGeometry(kind: WorldBuddy): THREE.BufferGeometry {
  return mergePieces(
    boxes(kind).map(([w, h, d, color, x, y, z]) => ({ w: w * V, h: h * V, d: d * V, color, x: x * V, y: y * V, z: z * V })),
    0.02
  );
}

/**
 * Where the buddy wants to stand: a couple of steps ahead and to the side, so a child in first person sees their friend at the
 * edge of the view (behind the player it would never be seen). Low enough (under 0.8 m) to stay under the line from
 * the eyes to a face in a dialog.
 */
export function buddyTarget(px: number, pz: number, playerYaw: number, side = 1): { x: number; z: number } {
  // 2.2 m ahead: nearer, the low animal falls under the bottom of a first-person view (eye 1.55 m)
  const ahead = 2.2;
  const off = 0.9 * side;
  return { x: px + Math.sin(playerYaw) * ahead - Math.cos(playerYaw) * off, z: pz + Math.cos(playerYaw) * ahead + Math.sin(playerYaw) * off };
}

export class Buddy {
  readonly root = new THREE.Group();
  readonly kind: WorldBuddy;
  private readonly mesh: THREE.Mesh;
  private readonly mat: THREE.MeshLambertMaterial;
  private x: number;
  private z: number;
  private y: number;
  private yaw = 0;
  private hop = 0;
  private t = 0;

  constructor(kind: WorldBuddy, x: number, y: number, z: number) {
    this.kind = kind;
    this.mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.mesh = new THREE.Mesh(makeBuddyGeometry(kind), this.mat);
    this.root.add(this.mesh);
    this.x = x;
    this.y = y;
    this.z = z;
    this.root.position.set(x, y, z);
  }

  /** Per frame: follow the player (feet at px,py,pz facing playerYaw); groundAt gives the floor under a point. */
  update(dt: number, px: number, py: number, pz: number, playerYaw: number, groundAt: (x: number, z: number, fromY: number) => number): void {
    this.t += dt;
    const want = buddyTarget(px, pz, playerYaw);
    const dx = want.x - this.x;
    const dz = want.z - this.z;
    const d = Math.hypot(dx, dz);
    // far behind (a scene change, a fade): appear next to the player
    if (d > 14 || Math.abs(py - this.y) > 6) {
      this.x = want.x;
      this.z = want.z;
      this.y = py;
    } else if (d > 0.25) {
      const speed = Math.min(6.5, 1.2 + d * 2.4);
      const step = Math.min(d, speed * dt);
      this.x += (dx / d) * step;
      this.z += (dz / d) * step;
      this.yaw = Math.atan2(dx, dz);
      this.hop += dt * (this.kind === 'bunny' || this.kind === 'chick' ? 11 : 14);
    } else {
      // settled: turn to look the way the player looks
      let a = playerYaw - this.yaw;
      a = Math.atan2(Math.sin(a), Math.cos(a));
      this.yaw += a * (1 - Math.exp(-3 * dt));
      this.hop = 0;
    }
    const floor = groundAt(this.x, this.z, Math.ceil(py) + 2);
    this.y += (floor - this.y) * (1 - Math.exp(-12 * dt));
    const lift = this.hop > 0 ? Math.abs(Math.sin(this.hop)) * (this.kind === 'bunny' ? 0.16 : 0.06) : Math.sin(this.t * 2) * 0.008;
    this.root.position.set(this.x, this.y + lift, this.z);
    this.root.rotation.y = this.yaw;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}
