/**
 * Chunk renderer: pulls padded block grids out of the sim-core VoxelWorld (read only), meshes them in a
 * Worker pool (or synchronously when Workers are missing), and keeps one or two THREE meshes per chunk.
 * View distance follows the device tier (docs/08 6.6: horizontal 4 / 6 / 8 chunks).
 */
import * as THREE from 'three';
import { CHUNK_SIZE, VoxelWorld } from '@lcw/sim-core';
import { PAD, meshChunk, type ChunkMesh, type GeoBuffers } from './mesher.js';

interface ChunkEntry {
  key: string;
  cx: number;
  cy: number;
  cz: number;
  opaque: THREE.Mesh | null;
  translucent: THREE.Mesh | null;
  version: number;
  meshedVersion: number;
  inFlight: boolean;
  empty: boolean;
}

export interface ChunkMaterials {
  opaque: THREE.Material;
  translucent: THREE.Material;
}

export function extractPadded(world: VoxelWorld, cx: number, cy: number, cz: number): Uint16Array {
  const out = new Uint16Array(PAD * PAD * PAD);
  const x0 = cx * CHUNK_SIZE - 1;
  const y0 = cy * CHUNK_SIZE - 1;
  const z0 = cz * CHUNK_SIZE - 1;
  // Cache the up to 27 source chunks so each cell is one array read.
  const cache = new Map<string, ReturnType<VoxelWorld['chunks']['get']>>();
  const S = CHUNK_SIZE;
  let i = 0;
  for (let py = 0; py < PAD; py++) {
    const wy = y0 + py;
    const ccy = Math.floor(wy / S);
    const ly = wy - ccy * S;
    for (let pz = 0; pz < PAD; pz++) {
      const wz = z0 + pz;
      const ccz = Math.floor(wz / S);
      const lz = wz - ccz * S;
      for (let px = 0; px < PAD; px++) {
        const wx = x0 + px;
        const ccx = Math.floor(wx / S);
        const lx = wx - ccx * S;
        const key = `${ccx},${ccy},${ccz}`;
        let ch = cache.get(key);
        if (ch === undefined && !cache.has(key)) {
          ch = world.chunks.get(key);
          cache.set(key, ch);
        }
        out[i++] = ch ? ch.getVoxel(lx, ly, lz) : 0;
      }
    }
  }
  return out;
}

function toGeometry(g: GeoBuffers): THREE.BufferGeometry | null {
  if (g.quads === 0) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(g.position, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(g.normal, 3));
  geo.setAttribute('aTile', new THREE.BufferAttribute(g.tile, 4));
  geo.setAttribute('color', new THREE.BufferAttribute(g.color, 3));
  geo.setIndex(new THREE.BufferAttribute(g.index, 1));
  geo.computeBoundingSphere();
  return geo;
}

export class ChunkRenderer {
  private entries = new Map<string, ChunkEntry>();
  private workers: Worker[] = [];
  private nextWorker = 0;
  private jobId = 0;
  private pending = new Map<number, { key: string; version: number }>();
  private queue: string[] = [];
  readonly group = new THREE.Group();
  meshed = 0;
  visible = 0;
  triangles = 0;
  castShadows = false;

  constructor(
    private world: VoxelWorld,
    private materials: ChunkMaterials,
    workerCount: number,
    makeWorker?: () => Worker
  ) {
    this.group.name = 'chunks';
    if (makeWorker) {
      for (let i = 0; i < workerCount; i++) {
        try {
          const w = makeWorker();
          w.onmessage = (ev: MessageEvent<{ id: number; key: string; mesh: ChunkMesh }>) => this.onResult(ev.data);
          this.workers.push(w);
        } catch {
          break;
        }
      }
    }
    for (const ch of world.chunks.values()) this.track(ch.cx, ch.cy, ch.cz);
  }

  private track(cx: number, cy: number, cz: number): ChunkEntry {
    const key = `${cx},${cy},${cz}`;
    let e = this.entries.get(key);
    if (!e) {
      e = { key, cx, cy, cz, opaque: null, translucent: null, version: 1, meshedVersion: 0, inFlight: false, empty: false };
      this.entries.set(key, e);
    }
    return e;
  }

  /** Call after a setBlock at (x, y, z): remesh its chunk and any neighbor whose border it touches. */
  markDirtyAt(x: number, y: number, z: number): void {
    const S = CHUNK_SIZE;
    const cx = Math.floor(x / S);
    const cy = Math.floor(y / S);
    const cz = Math.floor(z / S);
    const lx = x - cx * S;
    const ly = y - cy * S;
    const lz = z - cz * S;
    const touch = (a: number, b: number, c: number): void => {
      const e = this.track(a, b, c);
      e.version++;
      e.empty = false;
      if (!this.queue.includes(e.key)) this.queue.unshift(e.key);
    };
    touch(cx, cy, cz);
    for (const dx of [-1, 0, 1]) {
      for (const dy of [-1, 0, 1]) {
        for (const dz of [-1, 0, 1]) {
          if (dx === 0 && dy === 0 && dz === 0) continue;
          if (dx === -1 && lx !== 0) continue;
          if (dx === 1 && lx !== S - 1) continue;
          if (dy === -1 && ly !== 0) continue;
          if (dy === 1 && ly !== S - 1) continue;
          if (dz === -1 && lz !== 0) continue;
          if (dz === 1 && lz !== S - 1) continue;
          if (this.world.chunks.has(`${cx + dx},${cy + dy},${cz + dz}`)) touch(cx + dx, cy + dy, cz + dz);
        }
      }
    }
  }

  private onResult(r: { id: number; key: string; mesh: ChunkMesh }): void {
    const job = this.pending.get(r.id);
    this.pending.delete(r.id);
    const e = this.entries.get(r.key);
    if (!e || !job) return;
    e.inFlight = false;
    this.install(e, r.mesh, job.version);
  }

  private install(e: ChunkEntry, mesh: ChunkMesh, version: number): void {
    for (const m of [e.opaque, e.translucent]) {
      if (m) {
        this.group.remove(m);
        m.geometry.dispose();
      }
    }
    e.opaque = null;
    e.translucent = null;
    const go = toGeometry(mesh.opaque);
    const gt = toGeometry(mesh.translucent);
    const ox = e.cx * CHUNK_SIZE;
    const oy = e.cy * CHUNK_SIZE;
    const oz = e.cz * CHUNK_SIZE;
    if (go) {
      const m = new THREE.Mesh(go, this.materials.opaque);
      m.position.set(ox, oy, oz);
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      m.castShadow = this.castShadows;
      m.receiveShadow = true;
      e.opaque = m;
      this.group.add(m);
    }
    if (gt) {
      const m = new THREE.Mesh(gt, this.materials.translucent);
      m.position.set(ox, oy, oz);
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      m.renderOrder = 2;
      e.translucent = m;
      this.group.add(m);
    }
    e.meshedVersion = version;
    e.empty = !go && !gt;
    this.meshed++;
  }

  /**
   * Schedule meshing for chunks around (px, pz) within `radius` chunks and toggle visibility.
   * `budget` limits synchronous meshes per call when no Worker is available.
   */
  update(px: number, pz: number, radius: number, budget = 4): void {
    const pcx = Math.floor(px / CHUNK_SIZE);
    const pcz = Math.floor(pz / CHUNK_SIZE);
    const want: Array<{ e: ChunkEntry; d: number }> = [];
    let vis = 0;
    let tris = 0;
    for (const e of this.entries.values()) {
      const d = Math.max(Math.abs(e.cx - pcx), Math.abs(e.cz - pcz));
      const inRange = d <= radius;
      if (e.opaque) e.opaque.visible = inRange;
      if (e.translucent) e.translucent.visible = inRange;
      if (inRange && (e.opaque || e.translucent)) {
        vis++;
        if (e.opaque) tris += (e.opaque.geometry.index?.count ?? 0) / 3;
        if (e.translucent) tris += (e.translucent.geometry.index?.count ?? 0) / 3;
      }
      if (inRange && !e.inFlight && e.meshedVersion < e.version) want.push({ e, d });
    }
    this.visible = vis;
    this.triangles = tris;
    want.sort((a, b) => a.d - b.d);
    if (this.workers.length > 0) {
      const maxInFlight = this.workers.length * 3;
      for (const { e } of want) {
        if (this.pending.size >= maxInFlight) break;
        this.dispatch(e);
      }
    } else {
      for (const { e } of want.slice(0, budget)) {
        const vox = extractPadded(this.world, e.cx, e.cy, e.cz);
        this.install(e, meshChunk(vox, [e.cx * CHUNK_SIZE, e.cy * CHUNK_SIZE, e.cz * CHUNK_SIZE]), e.version);
      }
    }
  }

  private dispatch(e: ChunkEntry): void {
    const vox = extractPadded(this.world, e.cx, e.cy, e.cz);
    const id = ++this.jobId;
    this.pending.set(id, { key: e.key, version: e.version });
    e.inFlight = true;
    const w = this.workers[this.nextWorker++ % this.workers.length]!;
    w.postMessage({ id, key: e.key, vox, origin: [e.cx * CHUNK_SIZE, e.cy * CHUNK_SIZE, e.cz * CHUNK_SIZE] }, [vox.buffer]);
  }

  /** Number of in-range chunks still waiting for a mesh. */
  outstanding(px: number, pz: number, radius: number): number {
    const pcx = Math.floor(px / CHUNK_SIZE);
    const pcz = Math.floor(pz / CHUNK_SIZE);
    let n = 0;
    for (const e of this.entries.values()) {
      const d = Math.max(Math.abs(e.cx - pcx), Math.abs(e.cz - pcz));
      if (d <= radius && e.meshedVersion < e.version) n++;
    }
    return n;
  }

  setShadows(on: boolean): void {
    this.castShadows = on;
    for (const e of this.entries.values()) if (e.opaque) e.opaque.castShadow = on;
  }

  dispose(): void {
    for (const w of this.workers) w.terminate();
    for (const e of this.entries.values()) {
      e.opaque?.geometry.dispose();
      e.translucent?.geometry.dispose();
    }
    this.entries.clear();
  }
}
