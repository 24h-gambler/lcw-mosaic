/**
 * Moving props and hand-held item models (1/16 m voxels, docs/08 6.1 "손에 드는 아이템은 16³ 안").
 * Each prop is ONE draw call: its boxes are merged into a single vertex-coloured geometry (soft edges via
 * roundedBox), and the butterflies share one instanced mesh.
 */
import * as THREE from 'three';
import { roundedBox } from './sky.js';

const V = 1 / 16;

interface Piece {
  w: number;
  h: number;
  d: number;
  color: number;
  x: number;
  y: number;
  z: number;
  /** rotation about z (radians) around the model origin, applied after the piece's translation */
  rz?: number;
}

/** Merge soft boxes (sizes/positions in metres) into one geometry with per-vertex colour. */
export function mergePieces(pieces: readonly Piece[], radius = 0.04): THREE.BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const m = new THREE.Matrix4();
  const r = new THREE.Matrix4();
  const nm = new THREE.Matrix3();
  const v = new THREE.Vector3();
  for (const p of pieces) {
    const g = roundedBox(p.w, p.h, p.d, Math.min(radius, p.w / 3, p.h / 3, p.d / 3));
    m.makeTranslation(p.x, p.y, p.z);
    if (p.rz) {
      r.makeRotationZ(p.rz);
      m.premultiply(r);
    }
    nm.getNormalMatrix(m);
    const gp = g.attributes.position as THREE.BufferAttribute;
    const gn = g.attributes.normal as THREE.BufferAttribute;
    const base = pos.length / 3;
    const c = new THREE.Color(p.color);
    for (let i = 0; i < gp.count; i++) {
      v.fromBufferAttribute(gp, i).applyMatrix4(m);
      pos.push(v.x, v.y, v.z);
      v.fromBufferAttribute(gn, i).applyMatrix3(nm).normalize();
      nrm.push(v.x, v.y, v.z);
      col.push(c.r, c.g, c.b);
    }
    const gi = g.index!;
    for (let i = 0; i < gi.count; i++) idx.push(gi.getX(i) + base);
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.setIndex(idx);
  out.computeBoundingSphere();
  return out;
}

const vox = (w: number, h: number, d: number, color: number, x: number, y: number, z: number): Piece => ({
  w: w * V,
  h: h * V,
  d: d * V,
  color,
  x: x * V,
  y: y * V,
  z: z * V
});

let propMat: THREE.MeshLambertMaterial | null = null;
function sharedMat(): THREE.MeshLambertMaterial {
  propMat ??= new THREE.MeshLambertMaterial({ vertexColors: true });
  return propMat;
}

/** Item held in the right hand (attached to the hand pivot, pointing forward). One mesh. */
export function makeItemModel(key: string): THREE.Group {
  const g = new THREE.Group();
  const drink = /water|tea|latte|choco|juice|lemonade|milk|smoothie|coffee|cocoa/.test(key);
  const food = /cookie|muffin|cake|sandwich|bread|apple|banana/.test(key);
  const pieces: Piece[] = [];
  if (drink) {
    const liquid = /choco|cocoa|latte|coffee/.test(key) ? 0x8a5a2b : /lemon|juice|orange/.test(key) ? 0xffb347 : /milk/.test(key) ? 0xffffff : /smoothie/.test(key) ? 0xff9cc2 : /water/.test(key) ? 0x9fd8ff : 0xffc53d;
    pieces.push(vox(4, 5, 4, 0xfff9ee, 0, 0, 2), vox(3.4, 0.6, 3.4, liquid, 0, 2.6, 2), vox(1, 3, 1, 0xfff9ee, 2.5, 0, 2));
    if (/honey/.test(key)) pieces.push(vox(4.2, 1, 4.2, 0xffc53d, 0, -1, 2));
  } else if (food) {
    const col = /apple/.test(key) ? 0xe5484d : /banana/.test(key) ? 0xffc53d : /cake/.test(key) ? 0xff9cc2 : 0xc98a4a;
    pieces.push(vox(4, 3, 4, col, 0, 0, 2), vox(1, 1.5, 1, 0x3dbe6b, 0, 2.2, 2));
  } else if (/pickaxe|(^|_)axe($|_)|shovel/.test(key)) {
    // R2861①: hand tools (own voxel shapes): a wooden handle with a head — the axe a wedge to one side, the pickaxe a
    // bar across, the shovel a flat blade at the end
    const iron = /iron|steel/.test(key) ? 0xd5dde6 : 0xa9b4bf;
    pieces.push(vox(1, 9, 1, 0x9a6a3a, 0, 1.5, 2));
    if (/pickaxe/.test(key)) pieces.push(vox(7, 1.2, 1.2, iron, 0, 6, 2), vox(1.2, 1.6, 1.2, iron, -3.4, 5.4, 2), vox(1.2, 1.6, 1.2, iron, 3.4, 5.4, 2));
    else if (/shovel/.test(key)) pieces.push(vox(3.2, 3.6, 0.6, iron, 0, -4.2, 2), vox(2.4, 0.8, 0.8, 0x9a6a3a, 0, 6.2, 2));
    else pieces.push(vox(3, 3, 0.9, iron, 1.8, 5, 2), vox(0.9, 3.6, 1, 0xe8edf2, 3.4, 5, 2));
  } else {
    pieces.push(vox(5, 5, 5, 0xff6b4a, 0, 0, 2.5), vox(5.2, 1, 1.2, 0xffc53d, 0, 0, 2.5), vox(1.2, 5.2, 5.2, 0xffc53d, 0, 0, 2.5), vox(3, 1.5, 1.5, 0xffc53d, 0, 3.2, 2.5));
  }
  g.add(new THREE.Mesh(mergePieces(pieces, 0.012), sharedMat()));
  return g;
}

/** Windmill sails on the hill tower: four cloth blades on a hub, turning slowly. One mesh. */
export class Windmill {
  readonly root = new THREE.Group();
  private hub: THREE.Mesh;

  constructor(x: number, y: number, z: number) {
    this.root.position.set(x, y, z);
    const pieces: Piece[] = [{ w: 0.6, h: 0.6, d: 0.6, color: 0xc98b4a, x: 0, y: 0, z: 0 }];
    for (let i = 0; i < 4; i++) {
      // arm-local positions; mergePieces rotates each piece about the hub (rotation after translation)
      const rz = (i * Math.PI) / 2;
      pieces.push({ w: 0.2, h: 5.2, d: 0.2, color: 0xa8743f, x: 0, y: 2.6, z: 0, rz });
      pieces.push({ w: 1.3, h: 3.8, d: 0.1, color: i % 2 === 0 ? 0xfff9ee : 0xffd6c9, x: 0.75, y: 3.1, z: 0, rz });
    }
    this.hub = new THREE.Mesh(mergePieces(pieces, 0.05), sharedMat());
    this.root.add(this.hub);
  }

  update(dt: number): void {
    this.hub.rotation.z += dt * 0.6;
  }
}

/** Butterflies: two flapping wings drifting around a centre (cheap life near flowers). One instanced draw. */
export class Butterflies {
  readonly root = new THREE.Group();
  private mesh: THREE.InstancedMesh;
  private flies: Array<{ cx: number; cy: number; cz: number; a: number; s: number }> = [];
  private t = 0;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly p = new THREE.Vector3();
  private readonly one = new THREE.Vector3(1, 1, 1);

  constructor(spots: Array<[number, number, number]>) {
    const cols = [0xffc53d, 0xff9cc2, 0x3fa9f5, 0xfff9ee];
    const geo = new THREE.PlaneGeometry(0.16, 0.14);
    geo.translate(0.08, 0, 0); // hinge at the body
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }), spots.length * 2);
    this.mesh.frustumCulled = false;
    spots.forEach(([x, y, z], i) => {
      const c = new THREE.Color(cols[i % cols.length]!);
      this.mesh.setColorAt(i * 2, c);
      this.mesh.setColorAt(i * 2 + 1, c);
      this.flies.push({ cx: x, cy: y, cz: z, a: i * 1.7, s: 0.6 + (i % 3) * 0.2 });
    });
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.root.add(this.mesh);
  }

  update(dt: number): void {
    this.t += dt;
    this.flies.forEach((f, i) => {
      f.a += dt * f.s;
      this.p.set(f.cx + Math.cos(f.a) * 1.6 + Math.sin(f.a * 2.3) * 0.4, f.cy + 0.6 + Math.sin(f.a * 3.1) * 0.3, f.cz + Math.sin(f.a) * 1.6);
      const flap = Math.sin(this.t * 18 + f.a) * 1.1;
      for (const side of [0, 1]) {
        // right wing: hinge points +x; left wing mirrored by a half turn about y
        this.e.set(0, -f.a + (side === 0 ? flap : Math.PI - flap), 0);
        this.q.setFromEuler(this.e);
        this.mesh.setMatrixAt(i * 2 + side, this.m.compose(this.p, this.q, this.one));
      }
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
