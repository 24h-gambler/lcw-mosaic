/**
 * Voxel characters (docs/08 6.2): six boxes at 1/16 m — head 10^3, body 8x9x5, arms 3x9x3, legs 4x8x4,
 * 27 voxels ~ 1.7 m. Own proportions and UV-free coloring, so no other game's skin format fits (docs/15 2장).
 * Animation is part rotation only: idle, walk/run, talk (gesture + mouth shapes), wave, celebrate.
 */
import * as THREE from 'three';
import type { NpcLook } from './town.js';

const V = 1 / 16;
export const CHAR_HEIGHT = 27 * V;

type Mouth = 'closed' | 'small' | 'big' | 'wide' | 'o' | 'smile';

function css(hex: number, mul = 1): string {
  const r = Math.min(255, Math.round(((hex >> 16) & 255) * mul));
  const g = Math.min(255, Math.round(((hex >> 8) & 255) * mul));
  const b = Math.min(255, Math.round((hex & 255) * mul));
  return `rgb(${r},${g},${b})`;
}

class FacePainter {
  readonly canvas: HTMLCanvasElement | null;
  readonly texture: THREE.Texture;
  private ctx: CanvasRenderingContext2D | null;
  private last = '';

  constructor(private look: NpcLook) {
    if (typeof document !== 'undefined') {
      this.canvas = document.createElement('canvas');
      this.canvas.width = 10;
      this.canvas.height = 10;
      this.ctx = this.canvas.getContext('2d');
      this.texture = new THREE.CanvasTexture(this.canvas);
    } else {
      this.canvas = null;
      this.ctx = null;
      this.texture = new THREE.Texture();
    }
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.draw('smile', false);
  }

  draw(mouth: Mouth, blink: boolean): void {
    const key = `${mouth}:${blink}`;
    if (key === this.last || !this.ctx) return;
    this.last = key;
    const c = this.ctx;
    const L = this.look;
    c.fillStyle = css(L.skin);
    c.fillRect(0, 0, 10, 10);
    c.fillStyle = css(L.hair);
    c.fillRect(0, 0, 10, 2);
    if (L.hairStyle === 'long' || L.hairStyle === 'bun') {
      c.fillRect(0, 2, 1, 4);
      c.fillRect(9, 2, 1, 4);
    }
    // cheeks
    c.fillStyle = css(L.skin, 0.9);
    c.fillRect(1, 7, 1, 1);
    c.fillRect(8, 7, 1, 1);
    c.fillStyle = 'rgb(255,150,140)';
    c.globalAlpha = 0.55;
    c.fillRect(1, 6, 2, 1);
    c.fillRect(7, 6, 2, 1);
    c.globalAlpha = 1;
    // eyes 2 x 3
    c.fillStyle = 'rgb(27,31,42)';
    if (blink) {
      c.fillRect(2, 5, 2, 1);
      c.fillRect(6, 5, 2, 1);
    } else {
      c.fillRect(2, 3, 2, 3);
      c.fillRect(6, 3, 2, 3);
      c.fillStyle = 'rgb(255,255,255)';
      c.fillRect(2, 3, 1, 1);
      c.fillRect(6, 3, 1, 1);
    }
    // mouth (4 x 1 base, six shapes)
    c.fillStyle = 'rgb(110,40,40)';
    switch (mouth) {
      case 'closed':
        c.fillRect(3, 8, 4, 1);
        break;
      case 'small':
        c.fillRect(4, 8, 2, 1);
        break;
      case 'big':
        c.fillRect(3, 7, 4, 2);
        c.fillStyle = 'rgb(230,110,110)';
        c.fillRect(4, 8, 2, 1);
        break;
      case 'wide':
        c.fillRect(2, 8, 6, 1);
        break;
      case 'o':
        c.fillRect(4, 7, 2, 2);
        break;
      case 'smile':
        c.fillRect(3, 7, 1, 1);
        c.fillRect(6, 7, 1, 1);
        c.fillRect(4, 8, 2, 1);
        break;
    }
    this.texture.needsUpdate = true;
  }
}

function lambert(color: number): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color });
}

function box(w: number, h: number, d: number, mat: THREE.Material | THREE.Material[]): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.castShadow = true;
  m.receiveShadow = false;
  return m;
}

let blobTexture: THREE.Texture | null = null;
function getBlobTexture(): THREE.Texture {
  if (blobTexture) return blobTexture;
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - size / 2 + 0.5, y - size / 2 + 0.5) / (size / 2);
      const a = d >= 1 ? 0 : Math.pow(1 - d, 0.8) * 0.45;
      const i = (y * size + x) * 4;
      data[i] = 20;
      data[i + 1] = 24;
      data[i + 2] = 36;
      data[i + 3] = Math.round(a * 255);
    }
  }
  const t = new THREE.DataTexture(data, size, size);
  t.needsUpdate = true;
  blobTexture = t;
  return t;
}

export interface CharacterAnim {
  speed: number; // m/s
  talking: boolean;
  lookYaw: number; // head turn relative to body
}

export class VoxelCharacter {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  readonly head = new THREE.Group();
  readonly armL = new THREE.Group();
  readonly armR = new THREE.Group();
  readonly legL = new THREE.Group();
  readonly legR = new THREE.Group();
  readonly hand = new THREE.Group();
  readonly shadow: THREE.Mesh;
  readonly sparkle = new THREE.Group();
  private face: FacePainter;
  private phase = 0;
  private t = 0;
  private blinkAt = 2 + Math.random() * 3;
  private waveT = 0;
  private cheerT = 0;
  private mouthT = 0;
  private talkLevel = 0;
  private headYaw = 0;
  possessed = false;

  constructor(look: NpcLook) {
    this.face = new FacePainter(look);
    const skin = lambert(look.skin);
    const shirt = lambert(look.shirt);
    const pants = lambert(look.pants);
    const shoes = lambert(look.shoes);
    const hair = lambert(look.hair);
    const faceMat = new THREE.MeshLambertMaterial({ map: this.face.texture });

    // Legs (pivot at the hip, 8 voxels long, last 2 voxels are shoes).
    for (const [g, sx] of [[this.legL, -2], [this.legR, 2]] as const) {
      g.position.set(sx * V, 8 * V, 0);
      const leg = box(4 * V, 6 * V, 4 * V, pants);
      leg.position.y = -3 * V;
      const shoe = box(4.2 * V, 2 * V, 4.6 * V, shoes);
      shoe.position.set(0, -7 * V, 0.3 * V);
      g.add(leg, shoe);
      this.root.add(g);
    }
    // Body
    this.body.position.y = 8 * V;
    const torso = box(8 * V, 9 * V, 5 * V, shirt);
    torso.position.y = 4.5 * V;
    this.body.add(torso);
    if (look.apron !== undefined) {
      const apron = box(7 * V, 7 * V, 0.6 * V, lambert(look.apron));
      apron.position.set(0, 3 * V, 2.75 * V);
      this.body.add(apron);
    }
    this.root.add(this.body);
    // Arms (pivot at the shoulder).
    for (const [g, sx] of [[this.armL, -5.5], [this.armR, 5.5]] as const) {
      g.position.set(sx * V, 9 * V, 0);
      const sleeve = box(3 * V, 4 * V, 3 * V, shirt);
      sleeve.position.y = -2 * V;
      const arm = box(2.8 * V, 5 * V, 2.8 * V, skin);
      arm.position.y = -6.5 * V;
      g.add(sleeve, arm);
      this.body.add(g);
    }
    this.hand.position.set(0, -8.5 * V, 1.5 * V);
    this.armR.add(this.hand);
    // Head: +z is the face.
    this.head.position.y = 9 * V;
    const headMesh = box(10 * V, 10 * V, 10 * V, [skin, skin, hair, skin, faceMat, hair]);
    headMesh.position.y = 5 * V;
    this.head.add(headMesh);
    const hairTop = box(10.6 * V, 2 * V, 10.6 * V, hair);
    hairTop.position.set(0, 9.6 * V, -0.1 * V);
    this.head.add(hairTop);
    const backLen = look.hairStyle === 'long' ? 11 : 6;
    const hairBack = box(10.6 * V, backLen * V, 1.4 * V, hair);
    hairBack.position.set(0, (10.6 - backLen / 2) * V, -5.1 * V);
    this.head.add(hairBack);
    if (look.hairStyle === 'bun') {
      const bun = box(4 * V, 4 * V, 4 * V, hair);
      bun.position.set(0, 11.5 * V, -3.5 * V);
      this.head.add(bun);
    }
    if (look.hat !== undefined) {
      const hatMat = lambert(look.hat);
      const cap = box(11 * V, 3 * V, 11 * V, hatMat);
      cap.position.set(0, 10.8 * V, 0);
      const brim = box(9 * V, 0.8 * V, 4 * V, hatMat);
      brim.position.set(0, 9.6 * V, 6.5 * V);
      this.head.add(cap, brim);
    }
    this.body.add(this.head);

    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(0.95, 0.95),
      new THREE.MeshBasicMaterial({ map: getBlobTexture(), transparent: true, depthWrite: false })
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.02;
    this.shadow.renderOrder = 1;
    this.root.add(this.shadow);

    // Possession sparkle: four little sun-colored cubes circling the head.
    const sparkMat = new THREE.MeshBasicMaterial({ color: 0xffc53d });
    for (let i = 0; i < 4; i++) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.09), sparkMat);
      this.sparkle.add(s);
    }
    this.sparkle.visible = false;
    this.root.add(this.sparkle);
  }

  wave(): void {
    this.waveT = 1.6;
  }

  cheer(): void {
    this.cheerT = 1.4;
  }

  /** `level` 0..1 = speech loudness; picks one of the six mouth shapes. */
  speak(seconds: number): void {
    this.mouthT = Math.max(this.mouthT, seconds);
  }

  update(dt: number, anim: CharacterAnim): void {
    this.t += dt;
    const moving = anim.speed > 0.3;
    const stride = Math.min(1, anim.speed / 4.5);
    this.phase += dt * (moving ? 6 + anim.speed * 1.4 : 0);
    const swing = moving ? Math.sin(this.phase) * 0.75 * stride : 0;
    const settle = 1 - Math.exp(-10 * dt);
    this.legL.rotation.x += (swing - this.legL.rotation.x) * settle;
    this.legR.rotation.x += (-swing - this.legR.rotation.x) * settle;
    let armLx = -swing * 0.8;
    let armRx = swing * 0.8;
    let armLz = 0.06;
    let armRz = -0.06;
    let bodyY = 8 * V + (moving ? Math.abs(Math.cos(this.phase)) * 0.04 * stride : Math.sin(this.t * 2) * 0.006);

    const talking = anim.talking || this.mouthT > 0;
    if (this.mouthT > 0) this.mouthT -= dt;
    if (talking && !moving) {
      armRx = -0.5 + Math.sin(this.t * 5) * 0.35;
      armRz = -0.25;
    }
    if (this.waveT > 0) {
      this.waveT -= dt;
      armRx = -2.7;
      armRz = -0.3 + Math.sin(this.t * 14) * 0.35;
    }
    if (this.cheerT > 0) {
      this.cheerT -= dt;
      const k = Math.sin(Math.min(1, (1.4 - this.cheerT) / 0.25) * Math.PI * 0.5);
      armLx = -2.9 * k;
      armRx = -2.9 * k;
      armLz = 0.35 * k;
      armRz = -0.35 * k;
      bodyY += Math.abs(Math.sin((1.4 - this.cheerT) * 9)) * 0.22 * k;
    }
    this.armL.rotation.x += (armLx - this.armL.rotation.x) * settle;
    this.armR.rotation.x += (armRx - this.armR.rotation.x) * settle;
    this.armL.rotation.z += (armLz - this.armL.rotation.z) * settle;
    this.armR.rotation.z += (armRz - this.armR.rotation.z) * settle;
    this.body.position.y = bodyY;
    this.legL.position.y = bodyY;
    this.legR.position.y = bodyY;

    this.headYaw += (Math.max(-0.9, Math.min(0.9, anim.lookYaw)) - this.headYaw) * (1 - Math.exp(-6 * dt));
    this.head.rotation.y = this.headYaw;
    this.head.rotation.x = talking ? Math.sin(this.t * 7) * 0.04 : 0;

    // Face: blink and mouth shapes.
    this.blinkAt -= dt;
    const blink = this.blinkAt < 0.12;
    if (this.blinkAt < 0) this.blinkAt = 2.5 + ((this.t * 7.13) % 1) * 3;
    let mouth: Mouth = 'smile';
    if (talking) {
      this.talkLevel = 0.5 + 0.5 * Math.sin(this.t * 17) * Math.sin(this.t * 5.3);
      const shapes: Mouth[] = ['closed', 'small', 'o', 'big', 'wide'];
      mouth = shapes[Math.min(4, Math.floor(this.talkLevel * 5))]!;
    } else if (this.cheerT > 0) mouth = 'big';
    this.face.draw(mouth, blink);

    this.sparkle.visible = this.possessed;
    if (this.possessed) {
      this.sparkle.children.forEach((s, i) => {
        const a = this.t * 2.2 + (i * Math.PI) / 2;
        s.position.set(Math.cos(a) * 0.55, CHAR_HEIGHT + 0.15 + Math.sin(this.t * 4 + i) * 0.08, Math.sin(a) * 0.55);
        s.rotation.set(this.t * 3, this.t * 2, 0);
      });
    }
  }

  setHeadVisible(v: boolean): void {
    this.head.visible = v;
  }
}
