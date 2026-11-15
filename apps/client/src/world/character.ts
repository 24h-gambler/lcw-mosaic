/**
 * LCW toy figures (docs/08 6.2 sizes, own look). A character is ONE mesh and ONE draw call: every part is a
 * soft-edged box baked into a single geometry, tagged with its part index, and moved in the vertex shader by a
 * per-part matrix (legs, body, arms, head, possession ring). The figure reads as a painted wooden toy — rounded
 * head wider than tall, big oval eyes with highlights, rosy cheeks, sculpted fringe, mitten hands, round shoes,
 * an A-line shirt hem — not a cube-headed block person. Animation is part rotation only (idle, walk/run, talk
 * gestures + six mouth shapes, wave, celebrate). Blob shadows for all figures are one instanced draw (BlobShadows).
 */
import * as THREE from 'three';
import type { NpcLook } from './town.js';

const V = 1 / 16;
export const CHAR_HEIGHT = 27 * V;

type Mouth = 'closed' | 'small' | 'big' | 'wide' | 'o' | 'smile';

/** Part indices (the shader's uParts[]). */
const P = { legL: 0, legR: 1, body: 2, armL: 3, armR: 4, head: 5, ring: 6 } as const;
const PARTS = 7;

function rgb(hex: number, mul = 1): string {
  const r = Math.min(255, Math.round(((hex >> 16) & 255) * mul));
  const g = Math.min(255, Math.round(((hex >> 8) & 255) * mul));
  const b = Math.min(255, Math.round((hex & 255) * mul));
  return `rgb(${r},${g},${b})`;
}

// Face canvas: 64 x 64. The face fills [0, 48) x [0, 48); the white texel block at (56..64) colours every other face.
const FACE_PX = 64;
const FACE_W = 48;
const WHITE_UV = (60 / FACE_PX);

class FacePainter {
  readonly texture: THREE.Texture;
  private ctx: CanvasRenderingContext2D | null;
  private last = '';

  constructor(private look: NpcLook) {
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      canvas.width = FACE_PX;
      canvas.height = FACE_PX;
      this.ctx = canvas.getContext('2d');
      this.texture = new THREE.CanvasTexture(canvas);
    } else {
      this.ctx = null;
      this.texture = new THREE.Texture();
    }
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.draw('smile', false);
  }

  draw(mouth: Mouth, blink: boolean): void {
    const key = `${mouth}:${blink}`;
    if (key === this.last || !this.ctx) return;
    this.last = key;
    const c = this.ctx;
    const L = this.look;
    const W = FACE_W;
    c.clearRect(0, 0, FACE_PX, FACE_PX);
    c.fillStyle = '#ffffff';
    c.fillRect(52, 52, 12, 12);
    c.fillStyle = rgb(L.skin);
    c.fillRect(0, 0, W, W);
    // soft vertical shading: lighter forehead
    const g = c.createLinearGradient(0, 0, 0, W);
    g.addColorStop(0, 'rgba(255,255,255,0.10)');
    g.addColorStop(1, 'rgba(0,0,0,0.06)');
    c.fillStyle = g;
    c.fillRect(0, 0, W, W);
    // sculpted fringe: three rounded scallops across the forehead
    c.fillStyle = rgb(L.hair);
    c.fillRect(0, 0, W, 8);
    for (let i = 0; i < 3; i++) {
      c.beginPath();
      c.ellipse(8 + i * 16, 8, 9, 6.5, 0, 0, Math.PI);
      c.fill();
    }
    if (L.hairStyle === 'long' || L.hairStyle === 'bun') {
      c.fillRect(0, 8, 4, 22);
      c.fillRect(W - 4, 8, 4, 22);
    }
    // rosy round cheeks
    c.fillStyle = 'rgba(255,128,120,0.45)';
    for (const x of [10, W - 10]) {
      c.beginPath();
      c.arc(x, 31, 4.2, 0, Math.PI * 2);
      c.fill();
    }
    // big oval eyes with a highlight (or closed arcs while blinking)
    c.fillStyle = '#2b2f3c';
    c.strokeStyle = '#2b2f3c';
    c.lineWidth = 2.4;
    c.lineCap = 'round';
    for (const x of [15, W - 15]) {
      if (blink) {
        c.beginPath();
        c.arc(x, 23, 4, Math.PI * 0.15, Math.PI * 0.85);
        c.stroke();
      } else {
        c.beginPath();
        c.ellipse(x, 22, 3.6, 5, 0, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = '#ffffff';
        c.beginPath();
        c.arc(x - 1.2, 19.6, 1.5, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = '#2b2f3c';
      }
    }
    // mouth: six shapes (docs/08 6.2), drawn as soft curves
    c.fillStyle = '#8a3b3b';
    c.strokeStyle = '#8a3b3b';
    c.lineWidth = 2;
    const mx = W / 2;
    const my = 34;
    c.beginPath();
    switch (mouth) {
      case 'closed':
        c.moveTo(mx - 3.5, my);
        c.lineTo(mx + 3.5, my);
        c.stroke();
        break;
      case 'small':
        c.ellipse(mx, my, 2, 1.4, 0, 0, Math.PI * 2);
        c.fill();
        break;
      case 'big':
        c.ellipse(mx, my, 4.5, 3.6, 0, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = '#e8817a';
        c.beginPath();
        c.ellipse(mx, my + 1.6, 2.6, 1.4, 0, 0, Math.PI * 2);
        c.fill();
        break;
      case 'wide':
        c.ellipse(mx, my, 6, 1.8, 0, 0, Math.PI * 2);
        c.fill();
        break;
      case 'o':
        c.ellipse(mx, my, 2.6, 3, 0, 0, Math.PI * 2);
        c.fill();
        break;
      case 'smile':
        c.arc(mx, my - 2.5, 4.5, Math.PI * 0.2, Math.PI * 0.8);
        c.stroke();
        break;
    }
    this.texture.needsUpdate = true;
  }
}

// ---- Geometry builder: soft-edged boxes, vertex colours, part tags, and face UVs.
interface Builder {
  pos: number[];
  nrm: number[];
  col: number[];
  uv: number[];
  part: number[];
  idx: number[];
}

const tmpV = new THREE.Vector3();

/**
 * Add a soft box centred at (cx, cy, cz) in voxels, belonging to `part`. `face` maps the +z face to the face canvas.
 * Edges are chamfered by `r` voxels so every part reads as a rounded toy piece.
 */
function softBox(b: Builder, part: number, color: number, cx: number, cy: number, cz: number, w: number, h: number, d: number, r = 0.8, face = false): void {
  const g = new THREE.BoxGeometry(w * V, h * V, d * V, 2, 2, 2);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const hw = (w / 2 - r) * V;
  const hh = (h / 2 - r) * V;
  const hd = (d / 2 - r) * V;
  const rr = r * V;
  for (let i = 0; i < pos.count; i++) {
    tmpV.fromBufferAttribute(pos, i);
    const kx = Math.max(-hw, Math.min(hw, tmpV.x));
    const ky = Math.max(-hh, Math.min(hh, tmpV.y));
    const kz = Math.max(-hd, Math.min(hd, tmpV.z));
    const dx = tmpV.x - kx;
    const dy = tmpV.y - ky;
    const dz = tmpV.z - kz;
    const len = Math.hypot(dx, dy, dz);
    if (len > 1e-6) pos.setXYZ(i, kx + (dx / len) * rr, ky + (dy / len) * rr, kz + (dz / len) * rr);
  }
  g.computeVertexNormals();
  const nrm = g.attributes.normal as THREE.BufferAttribute;
  const uvs = g.attributes.uv as THREE.BufferAttribute;
  const index = g.index!;
  const base = b.pos.length / 3;
  const cr = ((color >> 16) & 255) / 255;
  const cg = ((color >> 8) & 255) / 255;
  const cb = (color & 255) / 255;
  // BoxGeometry groups: +x, -x, +y, -y, +z, -z; each face has (2+1)^2 = 9 vertices.
  const perFace = 9;
  for (let i = 0; i < pos.count; i++) {
    b.pos.push(pos.getX(i) + cx * V, pos.getY(i) + cy * V, pos.getZ(i) + cz * V);
    b.nrm.push(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
    const isFace = face && Math.floor(i / perFace) === 4;
    if (isFace) {
      // the face canvas is drawn top-down; flip v
      b.uv.push((uvs.getX(i) * FACE_W) / FACE_PX, 1 - ((1 - uvs.getY(i)) * FACE_W) / FACE_PX);
      b.col.push(1, 1, 1);
    } else {
      b.uv.push(WHITE_UV, 1 - WHITE_UV);
      b.col.push(cr, cg, cb);
    }
    b.part.push(part);
  }
  for (let i = 0; i < index.count; i++) b.idx.push(index.getX(i) + base);
  g.dispose();
}

let blobTexture: THREE.Texture | null = null;
function getBlobTexture(): THREE.Texture {
  if (blobTexture) return blobTexture;
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - size / 2 + 0.5, y - size / 2 + 0.5) / (size / 2);
      const a = d >= 1 ? 0 : Math.pow(1 - d, 0.8) * 0.42;
      const i = (y * size + x) * 4;
      data[i] = 40;
      data[i + 1] = 34;
      data[i + 2] = 30;
      data[i + 3] = Math.round(a * 255);
    }
  }
  const t = new THREE.DataTexture(data, size, size);
  t.needsUpdate = true;
  blobTexture = t;
  return t;
}

/** Round soft shadows under every figure as ONE instanced draw. */
export class BlobShadows {
  readonly mesh: THREE.InstancedMesh;
  private used = 0;
  private readonly m = new THREE.Matrix4();
  constructor(max = 24) {
    const geo = new THREE.PlaneGeometry(0.95, 0.95);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ map: getBlobTexture(), transparent: true, depthWrite: false }), max);
    this.mesh.renderOrder = 1;
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
  }
  claim(): number {
    const i = this.used++;
    this.mesh.count = this.used;
    this.m.makeScale(0, 0, 0);
    this.mesh.setMatrixAt(i, this.m);
    return i;
  }
  place(i: number, x: number, y: number, z: number, scale: number): void {
    this.m.makeScale(scale, 1, scale).setPosition(x, y + 0.02, z);
    this.mesh.setMatrixAt(i, this.m);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export interface CharacterAnim {
  speed: number; // m/s
  talking: boolean;
  lookYaw: number; // head turn relative to body
}

const PART_VERT_HEAD = /* glsl */ `#include <common>
attribute float aPart;
uniform mat4 uParts[${PARTS}];`;

export class VoxelCharacter {
  readonly root = new THREE.Group();
  // Transform nodes (not drawn): the part matrices are read from these every frame.
  readonly body = new THREE.Group();
  readonly head = new THREE.Group();
  readonly armL = new THREE.Group();
  readonly armR = new THREE.Group();
  readonly legL = new THREE.Group();
  readonly legR = new THREE.Group();
  readonly ring = new THREE.Group();
  /** attach held items here (a real child of the right arm) */
  readonly hand = new THREE.Group();
  readonly mesh: THREE.Mesh;
  private readonly mat: THREE.MeshLambertMaterial;
  private readonly partMats: THREE.Matrix4[] = Array.from({ length: PARTS }, () => new THREE.Matrix4());
  private readonly nodes: THREE.Object3D[];
  private readonly invRoot = new THREE.Matrix4();
  private readonly zero = new THREE.Matrix4().makeScale(0, 0, 0);
  private face: FacePainter;
  private phase = 0;
  private t = 0;
  private blinkAt = 2 + Math.random() * 3;
  private waveT = 0;
  private cheerT = 0;
  private mouthT = 0;
  private talkLevel = 0;
  private headYaw = 0;
  private headVisible = true;
  private shadowSlot = -1;
  possessed = false;
  static shadows: BlobShadows | null = null;

  constructor(look: NpcLook) {
    this.face = new FacePainter(look);
    const b: Builder = { pos: [], nrm: [], col: [], uv: [], part: [], idx: [] };
    const skin = look.skin;
    const shirt = look.shirt;
    // Legs (pivot at the hip): short rounded legs and big round toy shoes.
    for (const part of [P.legL, P.legR] as const) {
      softBox(b, part, look.pants, 0, -3, 0, 3.6, 6, 3.8, 1);
      softBox(b, part, look.shoes, 0, -7, 0.6, 4.4, 2.6, 5.6, 1.2);
    }
    // Body: rounded torso with an A-line hem (flares at the bottom), optional apron.
    softBox(b, P.body, shirt, 0, 4.8, 0, 8, 8.4, 5.6, 1.6);
    softBox(b, P.body, shirt, 0, 1.1, 0, 9.2, 2.4, 6.4, 1.1);
    if (look.apron !== undefined) softBox(b, P.body, look.apron, 0, 3.2, 3, 6.4, 6.6, 0.8, 0.4);
    // Arms (pivot at the shoulder): sleeves + mitten hands.
    for (const part of [P.armL, P.armR] as const) {
      softBox(b, part, shirt, 0, -2, 0, 3, 4.4, 3.2, 1.1);
      softBox(b, part, skin, 0, -5.8, 0, 2.6, 4, 2.6, 1);
      softBox(b, part, skin, 0, -8.4, 0.2, 3.4, 3, 3.4, 1.4);
    }
    // Head: wider than tall, rounded; the +z face carries the painted face; hair shell on top and back.
    softBox(b, P.head, skin, 0, 5, 0, 11, 10, 10, 2.2, true);
    if (look.hairStyle !== 'cap') softBox(b, P.head, look.hair, 0, 9.4, -0.6, 11.8, 2.8, 11, 1.4);
    const backLen = look.hairStyle === 'long' ? 11 : 6.5;
    softBox(b, P.head, look.hair, 0, 10.4 - backLen / 2, -5, 11.8, backLen, 1.8, 0.9);
    if (look.hairStyle === 'bun') softBox(b, P.head, look.hair, 0, 12, -3.4, 4.6, 4.2, 4.6, 2);
    if (look.hat !== undefined) {
      softBox(b, P.head, look.hat, 0, 10.6, -0.2, 12, 3.4, 11.6, 1.6);
      softBox(b, P.head, look.hat, 0, 9.4, 6.4, 9, 1, 4, 0.5);
      softBox(b, P.head, 0xffffff, 0, 12.2, -0.2, 2.4, 1.2, 2.4, 0.6);
    }
    // Possession ring: four little sun cubes around the head (scaled to zero when off).
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      softBox(b, P.ring, 0xffc53d, Math.cos(a) * 9, 0, Math.sin(a) * 9, 1.6, 1.6, 1.6, 0.5);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.nrm, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
    geo.setAttribute('aPart', new THREE.Float32BufferAttribute(b.part, 1));
    geo.setIndex(b.idx);
    geo.computeBoundingSphere();
    if (geo.boundingSphere) geo.boundingSphere.radius += 1.2; // parts move; keep culling generous

    this.mat = new THREE.MeshLambertMaterial({ vertexColors: true, map: this.face.texture });
    const parts = this.partMats;
    this.mat.onBeforeCompile = (shader) => {
      shader.uniforms.uParts = { value: parts };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', PART_VERT_HEAD)
        .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nobjectNormal = mat3(uParts[int(aPart + 0.5)]) * objectNormal;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed = (uParts[int(aPart + 0.5)] * vec4(transformed, 1.0)).xyz;');
    };
    this.mat.customProgramCacheKey = () => 'lcw-figure';
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = true;
    this.root.add(this.mesh);

    // Transform hierarchy (pivots in voxels).
    this.legL.position.set(-2 * V, 8 * V, 0);
    this.legR.position.set(2 * V, 8 * V, 0);
    this.body.position.y = 8 * V;
    this.armL.position.set(-5.6 * V, 8.6 * V, 0);
    this.armR.position.set(5.6 * V, 8.6 * V, 0);
    this.head.position.y = 9.2 * V;
    this.ring.position.y = 9.2 * V + 15 * V;
    this.hand.position.set(0, -8.6 * V, 1.6 * V);
    this.armR.add(this.hand);
    this.body.add(this.armL, this.armR, this.head);
    this.root.add(this.legL, this.legR, this.body);
    this.body.add(this.ring);
    this.nodes = [this.legL, this.legR, this.body, this.armL, this.armR, this.head, this.ring];
    if (VoxelCharacter.shadows) this.shadowSlot = VoxelCharacter.shadows.claim();
  }

  wave(): void {
    this.waveT = 1.6;
  }

  cheer(): void {
    this.cheerT = 1.4;
  }

  /** Keep the mouth moving for `seconds` (speech bubble typing). */
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
    let armLz = 0.1;
    let armRz = -0.1;
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
    this.ring.rotation.y = this.t * 2.2;
    this.ring.position.y = 9.2 * V + 15 * V + Math.sin(this.t * 4) * 0.05;

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

    this.syncParts();
    if (this.shadowSlot >= 0 && VoxelCharacter.shadows) {
      const p = this.root.position;
      VoxelCharacter.shadows.place(this.shadowSlot, p.x, p.y, p.z, this.root.visible ? 1 : 0);
    }
  }

  /** Part matrices relative to the figure root (what the vertex shader multiplies each part by). */
  private syncParts(): void {
    this.root.updateMatrixWorld(true);
    this.invRoot.copy(this.root.matrixWorld).invert();
    for (let i = 0; i < PARTS; i++) {
      const m = this.partMats[i]!;
      if ((i === P.head && !this.headVisible) || (i === P.ring && !this.possessed)) {
        m.copy(this.zero);
        continue;
      }
      m.multiplyMatrices(this.invRoot, this.nodes[i]!.matrixWorld);
    }
  }

  setHeadVisible(v: boolean): void {
    this.headVisible = v;
  }

  private fade = 1;
  /** Fade the figure (1 = solid) so a camera squeezed against the player in tight rooms can see past it. */
  setFade(alpha: number): void {
    const a = Math.max(0.15, Math.min(1, alpha));
    if (Math.abs(a - this.fade) < 0.02) return;
    this.fade = a;
    const solid = a >= 0.99;
    if (this.mat.transparent !== !solid) {
      this.mat.transparent = !solid;
      this.mat.needsUpdate = true;
    }
    this.mat.opacity = a;
    this.mat.depthWrite = solid;
  }
}
