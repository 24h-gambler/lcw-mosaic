/**
 * Sky, sun, fog and drifting voxel clouds (docs/08 6.3). The time-of-day table is the spec's; the lesson town
 * holds late morning by default so the first lesson is bright, and time can run (24 min per game day, docs/03 3.1).
 */
import * as THREE from 'three';

export interface SkyKey {
  hour: number;
  top: number;
  horizon: number;
  sun: number;
  ambient: number;
}

/** docs/08 6.3 table, keyed at the middle of each band. */
export const SKY_TABLE: readonly SkyKey[] = [
  { hour: 6, top: 0x6a7fdb, horizon: 0xffc4a3, sun: 0xffd8a8, ambient: 0.55 },
  { hour: 12, top: 0x4fa8f0, horizon: 0xcfeaff, sun: 0xffffff, ambient: 0.8 },
  { hour: 18, top: 0x5a5fcb, horizon: 0xff9a6b, sun: 0xffb37a, ambient: 0.55 },
  { hour: 24, top: 0x0e1330, horizon: 0x27305a, sun: 0xb8c6ff, ambient: 0.25 }
];

export function skyAt(hour: number): { top: THREE.Color; horizon: THREE.Color; sun: THREE.Color; ambient: number } {
  const h = ((hour % 24) + 24) % 24;
  // Bands: dawn 05-07, day 07-17, dusk 17-19, night 19-05; blend over one hour at each edge.
  const pick = (k: number): SkyKey => SKY_TABLE[k]!;
  let a = pick(3);
  let b = pick(3);
  let t = 0;
  if (h >= 4.5 && h < 6) [a, b, t] = [pick(3), pick(0), (h - 4.5) / 1.5];
  else if (h >= 6 && h < 7) [a, b, t] = [pick(0), pick(0), 0];
  else if (h >= 7 && h < 8) [a, b, t] = [pick(0), pick(1), h - 7];
  else if (h >= 8 && h < 17) [a, b, t] = [pick(1), pick(1), 0];
  else if (h >= 17 && h < 18) [a, b, t] = [pick(1), pick(2), h - 17];
  else if (h >= 18 && h < 19) [a, b, t] = [pick(2), pick(2), 0];
  else if (h >= 19 && h < 20) [a, b, t] = [pick(2), pick(3), h - 19];
  const lerp = (x: number, y: number): THREE.Color => new THREE.Color(x).lerp(new THREE.Color(y), t);
  return {
    top: lerp(a.top, b.top),
    horizon: lerp(a.horizon, b.horizon),
    sun: lerp(a.sun, b.sun),
    ambient: a.ambient + (b.ambient - a.ambient) * t
  };
}

const SKY_VERT = `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const SKY_FRAG = `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
varying vec3 vDir;
void main() {
  float h = clamp(vDir.y, -1.0, 1.0);
  float t = pow(clamp(h, 0.0, 1.0), 0.55);
  vec3 col = mix(uHorizon, uTop, t);
  col = mix(col, uHorizon * 0.92, clamp(-h * 3.0, 0.0, 1.0));
  float s = max(dot(normalize(vDir), normalize(uSunDir)), 0.0);
  col += uSunColor * (pow(s, 900.0) * 1.6 + pow(s, 40.0) * 0.18);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

export class Sky {
  readonly dome: THREE.Mesh;
  readonly clouds = new THREE.Group();
  private cloudMesh: THREE.InstancedMesh | null = null;
  private cloudParts: Array<{ cloud: number; ox: number; oy: number; oz: number; sx: number; sy: number; sz: number }> = [];
  private cloudPos: THREE.Vector3[] = [];
  readonly hemi: THREE.HemisphereLight;
  readonly sun: THREE.DirectionalLight;
  readonly fog: THREE.Fog;
  private mat: THREE.ShaderMaterial;
  hour = 10.5;
  timeFlows = false;
  private cloudSpeed = 0.6;

  constructor(scene: THREE.Scene, viewDistance: number) {
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uTop: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3) },
        uSunColor: { value: new THREE.Color() }
      },
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(400, 24, 12), this.mat);
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    scene.add(this.dome);

    this.hemi = new THREE.HemisphereLight(0xcfeaff, 0x7a6a4a, 1.0);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 2.2);
    scene.add(this.sun);
    scene.add(this.sun.target);
    this.fog = new THREE.Fog(0xcfeaff, viewDistance * 0.8, viewDistance);
    scene.fog = this.fog;

    this.buildClouds();
    scene.add(this.clouds);
    this.apply();
  }

  /** Puffy rounded clouds as ONE instanced draw (26 clouds, 3–6 soft boxes each). */
  private buildClouds(): void {
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0xfff9ee, emissiveIntensity: 0.45, fog: false });
    let seed = 17;
    const rnd = (): number => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < 26; i++) {
      const parts = 3 + Math.floor(rnd() * 4);
      for (let k = 0; k < parts; k++) {
        this.cloudParts.push({
          cloud: i,
          sx: 6 + rnd() * 10,
          sy: 2 + rnd() * 1.5,
          sz: 5 + rnd() * 8,
          ox: (rnd() - 0.5) * 14,
          oy: rnd() * 1.5,
          oz: (rnd() - 0.5) * 9
        });
      }
      this.cloudPos.push(new THREE.Vector3(144 + (rnd() - 0.5) * 420, 58 + rnd() * 18, 144 + (rnd() - 0.5) * 420));
    }
    // a box with bevelled (rounded-looking) edges: soft toy clouds rather than hard cubes
    const geo = roundedBox(1, 1, 1, 0.18);
    this.cloudMesh = new THREE.InstancedMesh(geo, mat, this.cloudParts.length);
    this.cloudMesh.frustumCulled = false;
    this.clouds.add(this.cloudMesh);
    this.layoutClouds();
  }

  private layoutClouds(): void {
    if (!this.cloudMesh) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    this.cloudParts.forEach((p, i) => {
      const c = this.cloudPos[p.cloud]!;
      pos.set(c.x + p.ox, c.y + p.oy, c.z + p.oz);
      scl.set(p.sx, p.sy, p.sz);
      this.cloudMesh!.setMatrixAt(i, m.compose(pos, q, scl));
    });
    this.cloudMesh.instanceMatrix.needsUpdate = true;
  }

  apply(): void {
    const s = skyAt(this.hour);
    this.mat.uniforms.uTop!.value.copy(s.top);
    this.mat.uniforms.uHorizon!.value.copy(s.horizon);
    this.mat.uniforms.uSunColor!.value.copy(s.sun);
    this.fog.color.copy(s.horizon);
    this.hemi.color.copy(s.horizon).lerp(new THREE.Color(0xffffff), 0.3);
    this.hemi.intensity = 0.55 + s.ambient * 1.1;
    this.sun.color.copy(s.sun);
    // Sun arc: rises east (+x), sets west; a bit south so building fronts are lit.
    const a = ((this.hour - 6) / 12) * Math.PI;
    const dir = new THREE.Vector3(Math.cos(a) * 0.75, Math.max(0.12, Math.sin(a)), 0.45).normalize();
    if (this.hour < 5 || this.hour > 19) dir.set(-0.3, 0.8, 0.4).normalize();
    this.mat.uniforms.uSunDir!.value.copy(dir);
    this.sun.intensity = s.ambient * 2.8;
    this.sunDir.copy(dir);
  }

  readonly sunDir = new THREE.Vector3(0.4, 0.8, 0.3);

  update(dt: number, center: THREE.Vector3): void {
    if (this.timeFlows) {
      this.hour = (this.hour + (dt / (24 * 60)) * 24) % 24;
      this.apply();
    }
    this.dome.position.copy(center);
    for (const c of this.cloudPos) {
      c.x += this.cloudSpeed * dt;
      if (c.x > center.x + 230) c.x -= 460;
    }
    this.layoutClouds();
    this.sun.position.copy(center).addScaledVector(this.sunDir, 80);
    this.sun.target.position.copy(center);
  }

  setViewDistance(d: number): void {
    this.fog.near = d * 0.8;
    this.fog.far = d;
  }
}

/** Unit box with chamfered edges (8 corners pulled in), normals smoothed so it shades like a soft toy cushion. */
export function roundedBox(w: number, h: number, d: number, r: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d, 3, 3, 3);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  const hw = w / 2 - r;
  const hh = h / 2 - r;
  const hd = d / 2 - r;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const cx = Math.max(-hw, Math.min(hw, v.x));
    const cy = Math.max(-hh, Math.min(hh, v.y));
    const cz = Math.max(-hd, Math.min(hd, v.z));
    const dx = v.x - cx;
    const dy = v.y - cy;
    const dz = v.z - cz;
    const len = Math.hypot(dx, dy, dz) || 1;
    pos.setXYZ(i, cx + (dx / len) * r, cy + (dy / len) * r, cz + (dz / len) * r);
  }
  g.computeVertexNormals();
  return g;
}
