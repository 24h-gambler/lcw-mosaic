/**
 * What building looks like in 3D (docs/03 D13 미리보기 외곽선, docs/08 6.1): the aim outline (white = ok, red =
 * refused), a filling box while a break is held, and every piece of plot furniture merged into ONE mesh (one draw
 * call however much furniture there is). Furniture shapes are LCW's own 1/16 m toy pieces, drawn here.
 */
import * as THREE from 'three';
import { furnitureDef, type PlotFurniture } from '@lcw/sim-core';
import { mergePieces } from './props.js';

const V = 1 / 16;

interface P {
  w: number;
  h: number;
  d: number;
  color: number;
  /** box centre from the cell corner, 1/16 m */
  x: number;
  y: number;
  z: number;
}
const p = (w: number, h: number, d: number, color: number, x: number, y: number, z: number): P => ({ w, h, d, color, x, y, z });

const WOOD = 0xc98a4a;
const WOOD_D = 0x8a5a2b;
const CREAM = 0xfff3d6;
const HONEY = 0xffc53d;
const CORAL = 0xff6b4a;
const SKY = 0x3fa9f5;
const LEAF = 0x3dbe6b;
const STONE = 0x9aa3b2;
const IRON = 0x5a6170;

function legs(h: number, inset: number, color: number): P[] {
  const a = inset + 1;
  const b = 16 - inset - 1;
  return [p(2, h, 2, color, a, h / 2, a), p(2, h, 2, color, b, h / 2, a), p(2, h, 2, color, a, h / 2, b), p(2, h, 2, color, b, h / 2, b)];
}

/** Toy furniture by registry id; anything without its own shape gets a role-coloured crate with a ribbon. */
export function furniturePieces(key: string): P[] {
  switch (key) {
    case 'furn_chair_wood':
      return [...legs(7, 3, WOOD_D), p(10, 2, 10, WOOD, 8, 8, 8), p(10, 8, 2, WOOD, 8, 13, 3.5)];
    case 'furn_armchair':
    case 'furn_sofa_cozy':
      return [p(14, 5, 12, CORAL, 8, 4.5, 8), p(14, 7, 3, CORAL, 8, 10, 3), p(3, 4, 12, CORAL, 2, 8, 8), p(3, 4, 12, CORAL, 14, 8, 8), p(12, 1.5, 9, CREAM, 8, 7.5, 9)];
    case 'furn_bed_single':
    case 'furn_bed_bunk':
      return [...legs(3, 0, WOOD_D), p(16, 3, 16, WOOD, 8, 4.5, 8), p(15, 2.5, 15, CREAM, 8, 7, 8), p(15, 2.6, 9, SKY, 8, 7.2, 11), p(8, 2, 4, 0xffffff, 8, 9, 3), p(16, 6, 2, WOOD_D, 8, 9, 1)];
    case 'furn_table_dining':
    case 'furn_desk_study':
      return [...legs(12, 1, WOOD_D), p(16, 2, 16, WOOD, 8, 13, 8)];
    case 'furn_workbench':
    case 'furn_counter_kitchen':
      return [...legs(11, 1, WOOD_D), p(16, 3, 16, WOOD, 8, 12.5, 8), p(14, 1.5, 14, WOOD_D, 8, 4, 8), p(4, 2, 2, IRON, 5, 15, 6)];
    case 'furn_lamp_table':
      return [p(6, 1.5, 6, WOOD_D, 8, 0.75, 8), p(1.5, 7, 1.5, WOOD_D, 8, 5, 8), p(8, 5, 8, HONEY, 8, 10.5, 8), p(6, 1, 6, 0xfff9ee, 8, 13.5, 8)];
    case 'furn_lamp_floor':
      return [p(6, 1.5, 6, IRON, 8, 0.75, 8), p(1.5, 18, 1.5, IRON, 8, 10, 8), p(9, 6, 9, HONEY, 8, 21, 8)];
    case 'furn_chandelier':
    case 'furn_lantern_wall':
      return [p(1, 4, 1, IRON, 8, 14, 8), p(7, 6, 7, HONEY, 8, 9, 8), p(8, 1, 8, IRON, 8, 5.5, 8)];
    case 'job_stove':
      return [p(14, 12, 14, STONE, 8, 6, 8), p(8, 5, 2, 0x2a2320, 8, 5, 1.2), p(6, 3, 1, CORAL, 8, 4, 0.6), p(4, 6, 4, IRON, 11, 15, 11)];
    case 'job_flower_shelf':
      return [p(14, 2, 6, WOOD, 8, 6, 8), p(14, 2, 6, WOOD, 8, 12, 8), p(3, 3, 3, LEAF, 4, 8.5, 8), p(3, 3, 3, CORAL, 8, 8.5, 8), p(3, 3, 3, HONEY, 12, 14.5, 8)];
    case 'job_mailbox':
      return [p(2, 10, 2, WOOD_D, 8, 5, 8), p(6, 5, 8, CORAL, 8, 12.5, 8)];
    case 'job_easel':
      return [p(1.5, 18, 1.5, WOOD, 4, 9, 9), p(1.5, 18, 1.5, WOOD, 12, 9, 9), p(11, 9, 1, 0xffffff, 8, 13, 8), p(5, 3, 1.2, SKY, 7, 14, 7.6)];
    default: {
      const role = furnitureDef(key)?.role ?? 'decor';
      const c = role === 'job' ? SKY : role === 'light' ? HONEY : role === 'rest' ? CORAL : role === 'flat' ? WOOD : LEAF;
      return [p(10, 10, 10, c, 8, 5, 8), p(10.4, 2, 2.4, CREAM, 8, 5, 8), p(2.4, 10.4, 10.4, CREAM, 8, 5, 8)];
    }
  }
}

function placed(pieces: P[], x: number, y: number, z: number, rot: number): Array<{ w: number; h: number; d: number; color: number; x: number; y: number; z: number }> {
  return pieces.map((q) => {
    let dx = q.x - 8;
    let dz = q.z - 8;
    let w = q.w;
    let d = q.d;
    for (let i = 0; i < (rot & 3); i++) {
      const t = dx;
      dx = -dz;
      dz = t;
      const s = w;
      w = d;
      d = s;
    }
    return { w: w * V, h: q.h * V, d: d * V, color: q.color, x: x + (8 + dx) * V, y: y + q.y * V, z: z + (8 + dz) * V };
  });
}

export class BuildView {
  readonly group = new THREE.Group();
  private outline: THREE.LineSegments;
  private fill: THREE.Mesh;
  private furniture: THREE.Mesh | null = null;
  private readonly lineMat: THREE.LineBasicMaterial;
  private readonly fillMat: THREE.MeshBasicMaterial;
  private readonly furnMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  furnitureCount = 0;

  constructor() {
    this.group.name = 'build';
    const box = new THREE.BoxGeometry(1.02, 1.02, 1.02);
    this.lineMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthTest: true });
    this.outline = new THREE.LineSegments(new THREE.EdgesGeometry(box), this.lineMat);
    this.outline.visible = false;
    this.outline.renderOrder = 5;
    this.fillMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25, depthWrite: false });
    this.fill = new THREE.Mesh(box, this.fillMat);
    this.fill.visible = false;
    this.fill.renderOrder = 4;
    this.group.add(this.outline, this.fill);
  }

  /** Outline at a cell; `bad` draws it red (the reason is shown by the HUD). */
  showAim(cell: { x: number; y: number; z: number } | null, bad: boolean): void {
    if (!cell) {
      this.outline.visible = false;
      this.fill.visible = false;
      return;
    }
    this.outline.position.set(cell.x + 0.5, cell.y + 0.5, cell.z + 0.5);
    this.outline.visible = true;
    this.lineMat.color.setHex(bad ? 0xe5484d : 0xffffff);
  }

  /** Break progress 0..1 on the aimed cell (a box that fills and shrinks as the block gives way). */
  showBreak(cell: { x: number; y: number; z: number } | null, progress: number): void {
    if (!cell || progress <= 0) {
      this.fill.visible = false;
      return;
    }
    const s = 1.04 - 0.12 * progress;
    this.fill.position.set(cell.x + 0.5, cell.y + 0.5, cell.z + 0.5);
    this.fill.scale.setScalar(s);
    this.fillMat.opacity = 0.15 + 0.45 * progress;
    this.fill.visible = true;
  }

  /** Rebuild the one furniture mesh from the plot's furniture map. */
  setFurniture(map: ReadonlyMap<string, PlotFurniture>): void {
    if (this.furniture) {
      this.group.remove(this.furniture);
      this.furniture.geometry.dispose();
      this.furniture = null;
    }
    const all: ReturnType<typeof placed> = [];
    for (const [k, f] of map) {
      const [x, y, z] = k.split(',').map(Number) as [number, number, number];
      all.push(...placed(furniturePieces(f.key), x, y, z, f.rot));
    }
    this.furnitureCount = map.size;
    if (all.length === 0) return;
    this.furniture = new THREE.Mesh(mergePieces(all, 0.015), this.furnMat);
    this.furniture.castShadow = true;
    this.furniture.receiveShadow = true;
    this.group.add(this.furniture);
  }

  dispose(): void {
    this.furniture?.geometry.dispose();
    this.outline.geometry.dispose();
    this.fill.geometry.dispose();
  }
}
