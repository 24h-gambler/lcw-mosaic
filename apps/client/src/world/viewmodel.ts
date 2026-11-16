/**
 * First-person hands (docs/03 4장, docs/08 7.1; Dan 11-16 09:20): in the default first-person view the child sees
 * their own right arm at the bottom right of the screen, holding the thing in hand (the same voxel model
 * `giveItem` puts in the third-person hand). The arm sways while walking and swings on a use.
 *
 * Drawn in its own small scene after the world with the depth cleared, so it never sinks into a wall or a counter,
 * and with its own camera (no dialog view offset: the hands hide while a dialog is open anyway).
 */
import * as THREE from 'three';
import { makeItemModel } from './props.js';

/** Size of one arm voxel in camera space (metres at ~0.45 m from the eye: the arm fills the lower right corner). */
const ARM_VOXEL = 0.026;

export interface HandLook {
  skin: number;
  shirt: number;
}

export class FirstPersonHands {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(70, 1, 0.01, 10);
  private readonly arm = new THREE.Group();
  private readonly holder = new THREE.Group();
  private item: THREE.Group | null = null;
  private itemKey: string | null = null;
  private walkPhase = 0;
  private sway = 0;
  private swingT = 0;
  private readonly mats: THREE.Material[] = [];
  private readonly geos: THREE.BufferGeometry[] = [];

  constructor(look: HandLook) {
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a6a, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(1, 2, 1.5);
    this.scene.add(sun);
    const box = (w: number, h: number, d: number, color: number, z: number): THREE.Mesh => {
      const g = new THREE.BoxGeometry(w, h, d);
      const m = new THREE.MeshLambertMaterial({ color });
      this.geos.push(g);
      this.mats.push(m);
      const mesh = new THREE.Mesh(g, m);
      mesh.position.z = z;
      return mesh;
    };
    // a 4x4 voxel arm reaching forward (the character's own proportions): sleeve, then the hand
    const A = ARM_VOXEL;
    this.arm.add(box(4 * A, 4 * A, 9 * A, look.shirt, 0));
    this.arm.add(box(4 * A, 4 * A, 3 * A, look.skin, -6 * A));
    this.holder.position.set(0, 2.6 * A, -7.6 * A);
    this.arm.add(this.holder);
    this.scene.add(this.arm);
    this.place(0, 0);
  }

  /** The thing in hand (null = an empty hand). */
  setItem(key: string | null): void {
    if (key === this.itemKey) return;
    if (this.item) this.holder.remove(this.item);
    this.item = key ? makeItemModel(key) : null;
    this.itemKey = key;
    if (this.item) {
      this.item.scale.setScalar(0.34);
      this.item.rotation.y = -0.5;
      this.holder.add(this.item);
      this.swing();
    }
  }

  get heldKey(): string | null {
    return this.itemKey;
  }

  /** A short swing (a use, a pick-up, a block placed). */
  swing(): void {
    this.swingT = 0.3;
  }

  /** Per frame: `speed` in m/s on the ground (0 in the air) and the canvas aspect. */
  update(dt: number, speed: number, aspect: number, fov: number): void {
    if (this.camera.aspect !== aspect || this.camera.fov !== fov) {
      this.camera.aspect = aspect;
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    const moving = Math.min(1, speed / 4);
    this.sway += (moving - this.sway) * (1 - Math.exp(-8 * dt));
    this.walkPhase += dt * (4 + speed * 1.6);
    this.swingT = Math.max(0, this.swingT - dt);
    this.place(this.sway, this.swingT / 0.3);
  }

  private place(sway: number, swing: number): void {
    // narrow screens (phones held upright) bring the arm in so it stays on screen
    const x = this.camera.aspect < 0.8 ? 0.13 : 0.24;
    const bobX = Math.cos(this.walkPhase) * 0.012 * sway;
    const bobY = Math.abs(Math.sin(this.walkPhase)) * 0.014 * sway;
    const s = Math.sin(swing * Math.PI);
    this.arm.position.set(x + bobX, -0.22 + bobY - s * 0.02, -0.42 - s * 0.03);
    this.arm.rotation.set(0.28 - s * 0.6, 0.3, 0.05);
    if (this.item) this.item.rotation.y = -0.5 + Math.sin(this.walkPhase * 0.25) * 0.05;
  }

  /** Draw over the world (call right after the world's own render). */
  render(renderer: THREE.WebGLRenderer): void {
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = auto;
  }

  dispose(): void {
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
  }
}
