/**
 * Cube particles (docs/08 6.5): star bursts, item sparkles, fountain spray, confetti and debris.
 * One InstancedMesh per look; the cap follows the tier (debris 200 / 400 / 600).
 */
import * as THREE from 'three';

interface P {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  size: number;
  grav: number;
  drag: number;
  spin: number;
  r: number;
  g: number;
  b: number;
  /** fly toward a target once life passes this fraction */
  home?: { x: number; y: number; z: number; at: number };
}

function starGeometry(): THREE.BufferGeometry {
  // A chunky 5-point star made of voxels, flattened: center block plus five arms.
  const parts: THREE.BufferGeometry[] = [];
  const add = (x: number, y: number, w: number, h: number): void => {
    const g = new THREE.BoxGeometry(w, h, 0.18);
    g.translate(x, y, 0);
    parts.push(g);
  };
  add(0, 0, 0.42, 0.42);
  add(0, 0.34, 0.16, 0.3);
  add(0.33, 0.1, 0.3, 0.16);
  add(-0.33, 0.1, 0.3, 0.16);
  add(0.2, -0.3, 0.16, 0.28);
  add(-0.2, -0.3, 0.16, 0.28);
  // merge
  let count = 0;
  for (const p of parts) count += p.getAttribute('position').count;
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  const idx: number[] = [];
  let off = 0;
  for (const p of parts) {
    pos.set(p.getAttribute('position').array as Float32Array, off * 3);
    nor.set(p.getAttribute('normal').array as Float32Array, off * 3);
    const ix = p.getIndex()!;
    for (let i = 0; i < ix.count; i++) idx.push(ix.getX(i) + off);
    off += p.getAttribute('position').count;
    p.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

class Pool {
  readonly mesh: THREE.InstancedMesh;
  private ps: P[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private s = new THREE.Vector3();
  private v = new THREE.Vector3();
  private c = new THREE.Color();

  constructor(geo: THREE.BufferGeometry, mat: THREE.Material, readonly cap: number) {
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
  }

  add(p: P): void {
    if (this.ps.length >= this.cap) this.ps.shift();
    this.ps.push(p);
  }

  get size(): number {
    return this.ps.length;
  }

  update(dt: number, t: number): void {
    let n = 0;
    const keep: P[] = [];
    for (const p of this.ps) {
      p.life += dt;
      if (p.life >= p.max) continue;
      const k = p.life / p.max;
      if (p.home && k > p.home.at) {
        const f = 1 - Math.exp(-7 * dt);
        p.x += (p.home.x - p.x) * f;
        p.y += (p.home.y - p.y) * f;
        p.z += (p.home.z - p.z) * f;
      } else {
        p.vy -= p.grav * dt;
        const dr = Math.exp(-p.drag * dt);
        p.vx *= dr;
        p.vy *= dr;
        p.vz *= dr;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
      }
      keep.push(p);
      const scale = p.size * (k < 0.15 ? k / 0.15 : k > 0.75 ? Math.max(0, (1 - k) / 0.25) : 1);
      this.e.set(t * p.spin, t * p.spin * 0.7, 0);
      this.q.setFromEuler(this.e);
      this.s.set(scale, scale, scale);
      this.v.set(p.x, p.y, p.z);
      this.m.compose(this.v, this.q, this.s);
      this.mesh.setMatrixAt(n, this.m);
      this.c.setRGB(p.r, p.g, p.b);
      this.mesh.setColorAt(n, this.c);
      n++;
    }
    this.ps = keep;
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

export class Effects {
  readonly group = new THREE.Group();
  private cubes: Pool;
  private stars: Pool;
  private t = 0;
  private seed = 1;

  constructor(cap: number) {
    const cubeMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this.cubes = new Pool(new THREE.BoxGeometry(1, 1, 1), cubeMat, cap);
    const starMat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x8f6200, emissiveIntensity: 0.6 });
    this.stars = new Pool(starGeometry(), starMat, 64);
    this.group.add(this.cubes.mesh, this.stars.mesh);
  }

  private rnd(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  /** Generic burst of cubes. */
  burst(x: number, y: number, z: number, color: THREE.Color, count: number, speed = 3, size = 0.12, life = 1.0): void {
    for (let i = 0; i < count; i++) {
      const a = this.rnd() * Math.PI * 2;
      const up = this.rnd();
      const sp = speed * (0.4 + this.rnd() * 0.8);
      this.cubes.add({
        x, y, z,
        vx: Math.cos(a) * sp * (1 - up * 0.5),
        vy: sp * (0.6 + up),
        vz: Math.sin(a) * sp * (1 - up * 0.5),
        life: 0,
        max: life * (0.7 + this.rnd() * 0.6),
        size: size * (0.7 + this.rnd() * 0.6),
        grav: 9,
        drag: 1.2,
        spin: 2 + this.rnd() * 6,
        r: color.r, g: color.g, b: color.b
      });
    }
  }

  /** Stars that pop out of (x,y,z) and then gather toward `home` (screen-anchored point in world space). */
  starBurst(x: number, y: number, z: number, n: number, color: THREE.Color, home: THREE.Vector3): void {
    for (let i = 0; i < n; i++) {
      const a = (i / Math.max(1, n)) * Math.PI * 2 + this.rnd() * 0.4;
      this.stars.add({
        x, y, z,
        vx: Math.cos(a) * 2.2,
        vy: 4.5 + this.rnd() * 1.5,
        vz: Math.sin(a) * 2.2,
        life: 0,
        max: 1.7,
        size: 0.9,
        grav: 6,
        drag: 1.5,
        spin: 3,
        r: color.r, g: color.g, b: color.b,
        home: { x: home.x, y: home.y, z: home.z, at: 0.5 }
      });
    }
    // confetti
    const conf = [0xff6b4a, 0x3fa9f5, 0xffc53d, 0x3dbe6b, 0x8e5be8].map((h) => new THREE.Color(h));
    for (let i = 0; i < 18 * n; i++) this.burst(x, y + 0.5, z, conf[i % conf.length]!, 1, 4.5, 0.08, 1.6);
  }

  sparkle(x: number, y: number, z: number): void {
    const c = new THREE.Color(0xffe08a);
    for (let i = 0; i < 10; i++) {
      this.cubes.add({
        x: x + (this.rnd() - 0.5) * 0.5,
        y: y + this.rnd() * 0.4,
        z: z + (this.rnd() - 0.5) * 0.5,
        vx: 0, vy: 0.8 + this.rnd(), vz: 0,
        life: 0, max: 0.9, size: 0.06, grav: 0, drag: 0.5, spin: 8,
        r: c.r, g: c.g, b: c.b
      });
    }
  }

  /** One frame of fountain spray from the spout (call every frame; emits a few drops). */
  spray(x: number, y: number, z: number, dt: number): void {
    const n = Math.min(4, Math.ceil(dt * 70));
    for (let i = 0; i < n; i++) {
      const a = this.rnd() * Math.PI * 2;
      const r = 0.8 + this.rnd() * 0.9;
      const light = this.rnd() < 0.4;
      this.cubes.add({
        x, y, z,
        vx: Math.cos(a) * r, vy: 3.6 + this.rnd() * 1.2, vz: Math.sin(a) * r,
        life: 0, max: 1.05, size: 0.09, grav: 9.8, drag: 0.2, spin: 4,
        r: light ? 0.85 : 0.45, g: light ? 0.95 : 0.75, b: 1
      });
    }
  }

  get count(): number {
    return this.cubes.size + this.stars.size;
  }

  update(dt: number): void {
    this.t += dt;
    this.cubes.update(dt, this.t);
    this.stars.update(dt, this.t);
  }
}
