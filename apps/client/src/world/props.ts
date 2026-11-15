/** Moving props and hand-held item models (1/16 m voxels, docs/08 6.1 "손에 드는 아이템은 16³ 안"). */
import * as THREE from 'three';

const V = 1 / 16;

function cube(w: number, h: number, d: number, color: number, x: number, y: number, z: number, emissive = 0): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w * V, h * V, d * V),
    new THREE.MeshLambertMaterial({ color, emissive, emissiveIntensity: emissive ? 0.5 : 0 })
  );
  m.position.set(x * V, y * V, z * V);
  m.castShadow = true;
  return m;
}

/** Item held in the right hand (attached to the hand pivot, pointing forward). */
export function makeItemModel(key: string): THREE.Group {
  const g = new THREE.Group();
  const drink = /tea|latte|choco|juice|lemonade|milk|smoothie|coffee|cocoa/.test(key);
  const food = /cookie|muffin|cake|sandwich|bread|apple|banana/.test(key);
  if (drink) {
    const liquid = /choco|cocoa|latte|coffee/.test(key) ? 0x8a5a2b : /lemon|juice|orange/.test(key) ? 0xffb347 : /milk/.test(key) ? 0xffffff : /smoothie/.test(key) ? 0xff9cc2 : 0xffc53d;
    g.add(cube(4, 5, 4, 0xfff9ee, 0, 0, 2));
    g.add(cube(3.4, 0.6, 3.4, liquid, 0, 2.6, 2));
    g.add(cube(1, 3, 1, 0xfff9ee, 2.5, 0, 2));
    if (/honey/.test(key)) g.add(cube(4.2, 1, 4.2, 0xffc53d, 0, -1, 2));
  } else if (food) {
    const col = /apple/.test(key) ? 0xe5484d : /banana/.test(key) ? 0xffc53d : /cake/.test(key) ? 0xff9cc2 : 0xc98a4a;
    g.add(cube(4, 3, 4, col, 0, 0, 2));
    g.add(cube(1, 1.5, 1, 0x3dbe6b, 0, 2.2, 2));
  } else {
    g.add(cube(5, 5, 5, 0xff6b4a, 0, 0, 2.5));
    g.add(cube(5.2, 1, 1.2, 0xffc53d, 0, 0, 2.5));
    g.add(cube(1.2, 5.2, 5.2, 0xffc53d, 0, 0, 2.5));
    g.add(cube(3, 1.5, 1.5, 0xffc53d, 0, 3.2, 2.5));
  }
  return g;
}

/** Windmill sails on the hill tower: four cloth blades on a hub, turning slowly. */
export class Windmill {
  readonly root = new THREE.Group();
  private hub = new THREE.Group();

  constructor(x: number, y: number, z: number) {
    this.root.position.set(x, y, z);
    const wood = new THREE.MeshLambertMaterial({ color: 0x8f6436 });
    const cloth = new THREE.MeshLambertMaterial({ color: 0xfff9ee });
    const hubBox = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), wood);
    this.hub.add(hubBox);
    for (let i = 0; i < 4; i++) {
      const arm = new THREE.Group();
      const spar = new THREE.Mesh(new THREE.BoxGeometry(0.18, 5.2, 0.18), wood);
      spar.position.y = 2.6;
      const sail = new THREE.Mesh(new THREE.BoxGeometry(1.3, 3.8, 0.08), cloth);
      sail.position.set(0.75, 3.1, 0);
      sail.castShadow = true;
      arm.add(spar, sail);
      arm.rotation.z = (i * Math.PI) / 2;
      this.hub.add(arm);
    }
    this.root.add(this.hub);
  }

  update(dt: number): void {
    this.hub.rotation.z += dt * 0.6;
  }
}

/** Butterflies: two flapping squares drifting around a center (cheap life near flowers). */
export class Butterflies {
  readonly root = new THREE.Group();
  private flies: Array<{ g: THREE.Group; l: THREE.Mesh; r: THREE.Mesh; cx: number; cy: number; cz: number; a: number; s: number }> = [];
  private t = 0;

  constructor(spots: Array<[number, number, number]>) {
    const cols = [0xffc53d, 0xff9cc2, 0x3fa9f5, 0xfff9ee];
    spots.forEach(([x, y, z], i) => {
      const g = new THREE.Group();
      const mat = new THREE.MeshLambertMaterial({ color: cols[i % cols.length]!, side: THREE.DoubleSide });
      const l = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.14), mat);
      const r = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.14), mat);
      l.position.x = -0.08;
      r.position.x = 0.08;
      g.add(l, r);
      this.root.add(g);
      this.flies.push({ g, l, r, cx: x, cy: y, cz: z, a: i * 1.7, s: 0.6 + (i % 3) * 0.2 });
    });
  }

  update(dt: number): void {
    this.t += dt;
    for (const f of this.flies) {
      f.a += dt * f.s;
      const x = f.cx + Math.cos(f.a) * 1.6 + Math.sin(f.a * 2.3) * 0.4;
      const z = f.cz + Math.sin(f.a) * 1.6;
      const y = f.cy + 0.6 + Math.sin(f.a * 3.1) * 0.3;
      f.g.position.set(x, y, z);
      f.g.rotation.y = -f.a;
      const flap = Math.sin(this.t * 18 + f.a) * 1.1;
      f.l.rotation.y = flap;
      f.r.rotation.y = -flap;
    }
  }
}
