/**
 * Chunk renderer: pulls padded block grids out of the sim-core VoxelWorld (read only), meshes them in a
 * Worker pool (or synchronously when Workers are missing), and draws them as merged **region** meshes:
 * REGION x REGION chunk columns become one opaque and one translucent mesh, so the whole town costs a handful of
 * draw calls instead of one or two per chunk (WP-004 budget). A changed chunk re-merges only its own region.
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
  mesh: ChunkMesh | null;
  version: number;
  meshedVersion: number;
  inFlight: boolean;
  empty: boolean;
}

export interface ChunkMaterials {
  opaque: THREE.Material;
  translucent: THREE.Material;
}

/** Chunk columns per region side (4 x 16 m = 64 m). */
export const REGION = 4;

interface Region {
  key: string;
  rx: number;
  rz: number;
  opaque: THREE.Mesh | null;
  translucent: THREE.Mesh | null;
  dirty: boolean;
  chunks: Set<ChunkEntry>;
}

export function extractPadded(world: VoxelWorld, cx: number, cy: number, cz: number): Uint16Array {
  const out = new Uint16Array(PAD * PAD * PAD);
  const S = CHUNK_SIZE;
  // The padded grid touches at most 3 x 3 x 3 source chunks: look them up once (27 map reads instead of one string
  // key per voxel), then index by the per-axis neighbour slot (0 = previous chunk, 1 = this one, 2 = next).
  type Src = ReturnType<VoxelWorld['chunks']['get']>;
  const src: Src[] = new Array<Src>(27);
  for (let dy = 0; dy < 3; dy++) {
    for (let dz = 0; dz < 3; dz++) {
      for (let dx = 0; dx < 3; dx++) src[dy * 9 + dz * 3 + dx] = world.chunks.get(`${cx + dx - 1},${cy + dy - 1},${cz + dz - 1}`);
    }
  }
  // padded index p (0..PAD-1) maps to local coordinate p - 1 in this chunk: slot 0 for p = 0, slot 2 for p = S + 1
  const slot = (p: number): number => (p === 0 ? 0 : p === PAD - 1 ? 2 : 1);
  const local = (p: number): number => (p === 0 ? S - 1 : p === PAD - 1 ? 0 : p - 1);
  let i = 0;
  for (let py = 0; py < PAD; py++) {
    const sy = slot(py) * 9;
    const ly = local(py);
    for (let pz = 0; pz < PAD; pz++) {
      const syz = sy + slot(pz) * 3;
      const lz = local(pz);
      for (let px = 0; px < PAD; px++) {
        const ch = src[syz + slot(px)];
        out[i++] = ch ? ch.getVoxel(local(px), ly, lz) : 0;
      }
    }
  }
  return out;
}

/** Concatenate chunk buffers (each offset by its chunk origin relative to the region origin) into one geometry. */
export function mergeGeo(parts: Array<{ g: GeoBuffers; ox: number; oy: number; oz: number }>): THREE.BufferGeometry | null {
  let verts = 0;
  let idx = 0;
  for (const p of parts) {
    verts += p.g.position.length / 3;
    idx += p.g.index.length;
  }
  if (idx === 0) return null;
  const position = new Float32Array(verts * 3);
  const normal = new Int8Array(verts * 3);
  const tile = new Float32Array(verts * 4);
  const color = new Uint8Array(verts * 3);
  const index = verts > 65535 ? new Uint32Array(idx) : new Uint16Array(idx);
  let v = 0;
  let k = 0;
  for (const { g, ox, oy, oz } of parts) {
    const n = g.position.length / 3;
    for (let i = 0; i < n; i++) {
      const a = (v + i) * 3;
      const b = i * 3;
      position[a] = g.position[b]! + ox;
      position[a + 1] = g.position[b + 1]! + oy;
      position[a + 2] = g.position[b + 2]! + oz;
      normal[a] = Math.round(g.normal[b]! * 127);
      normal[a + 1] = Math.round(g.normal[b + 1]! * 127);
      normal[a + 2] = Math.round(g.normal[b + 2]! * 127);
      color[a] = Math.round(g.color[b]! * 255);
      color[a + 1] = Math.round(g.color[b + 1]! * 255);
      color[a + 2] = Math.round(g.color[b + 2]! * 255);
    }
    tile.set(g.tile, v * 4);
    for (let i = 0; i < g.index.length; i++) index[k + i] = g.index[i]! + v;
    v += n;
    k += g.index.length;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normal, 3, true));
  geo.setAttribute('aTile', new THREE.BufferAttribute(tile, 4));
  geo.setAttribute('color', new THREE.BufferAttribute(color, 3, true));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return geo;
}

export class ChunkRenderer {
  private entries = new Map<string, ChunkEntry>();
  private regions = new Map<string, Region>();
  private workers: Worker[] = [];
  private nextWorker = 0;
  private jobId = 0;
  private pending = new Map<number, { key: string; version: number }>();
  readonly group = new THREE.Group();
  meshed = 0;
  visible = 0;
  triangles = 0;
  castShadows = false;
  /** region merges done (stats/tests) */
  merges = 0;

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

  private regionOf(cx: number, cz: number): Region {
    const rx = Math.floor(cx / REGION);
    const rz = Math.floor(cz / REGION);
    const key = `${rx},${rz}`;
    let r = this.regions.get(key);
    if (!r) {
      r = { key, rx, rz, opaque: null, translucent: null, dirty: false, chunks: new Set() };
      this.regions.set(key, r);
    }
    return r;
  }

  private track(cx: number, cy: number, cz: number): ChunkEntry {
    const key = `${cx},${cy},${cz}`;
    let e = this.entries.get(key);
    if (!e) {
      e = { key, cx, cy, cz, mesh: null, version: 1, meshedVersion: 0, inFlight: false, empty: false };
      this.entries.set(key, e);
      this.regionOf(cx, cz).chunks.add(e);
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
    const empty = mesh.opaque.quads === 0 && mesh.translucent.quads === 0;
    const had = e.mesh !== null;
    e.mesh = empty ? null : mesh;
    e.meshedVersion = version;
    e.empty = empty;
    this.meshed++;
    if (!empty || had) this.regionOf(e.cx, e.cz).dirty = true;
  }

  private rebuild(r: Region): void {
    r.dirty = false;
    this.merges++;
    for (const m of [r.opaque, r.translucent]) {
      if (m) {
        this.group.remove(m);
        m.geometry.dispose();
      }
    }
    r.opaque = null;
    r.translucent = null;
    const ox = r.rx * REGION * CHUNK_SIZE;
    const oz = r.rz * REGION * CHUNK_SIZE;
    const op: Array<{ g: GeoBuffers; ox: number; oy: number; oz: number }> = [];
    const tr: Array<{ g: GeoBuffers; ox: number; oy: number; oz: number }> = [];
    for (const e of r.chunks) {
      if (!e.mesh) continue;
      const at = { ox: e.cx * CHUNK_SIZE - ox, oy: e.cy * CHUNK_SIZE, oz: e.cz * CHUNK_SIZE - oz };
      if (e.mesh.opaque.quads > 0) op.push({ g: e.mesh.opaque, ...at });
      if (e.mesh.translucent.quads > 0) tr.push({ g: e.mesh.translucent, ...at });
    }
    const go = mergeGeo(op);
    const gt = mergeGeo(tr);
    if (go) {
      const m = new THREE.Mesh(go, this.materials.opaque);
      m.position.set(ox, 0, oz);
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      m.castShadow = this.castShadows;
      m.receiveShadow = this.castShadows;
      r.opaque = m;
      this.group.add(m);
    }
    if (gt) {
      const m = new THREE.Mesh(gt, this.materials.translucent);
      m.position.set(ox, 0, oz);
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      m.renderOrder = 2;
      r.translucent = m;
      this.group.add(m);
    }
  }

  /**
   * Schedule meshing for chunks around (px, pz) within `radius` chunks, re-merge changed regions and toggle region
   * visibility. `budget` limits synchronous meshes per call when no Worker is available.
   */
  update(px: number, pz: number, radius: number, budget = 4): void {
    const pcx = Math.floor(px / CHUNK_SIZE);
    const pcz = Math.floor(pz / CHUNK_SIZE);
    const want: Array<{ e: ChunkEntry; d: number }> = [];
    for (const e of this.entries.values()) {
      const d = Math.max(Math.abs(e.cx - pcx), Math.abs(e.cz - pcz));
      if (d <= radius && !e.inFlight && e.meshedVersion < e.version) want.push({ e, d });
    }
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
    // Merge at most two regions per call so a burst of results never stalls one frame for long.
    const dirty = [...this.regions.values()].filter((r) => r.dirty);
    dirty.sort((a, b) => this.regionDist(a, pcx, pcz) - this.regionDist(b, pcx, pcz));
    let merges = 0;
    for (const r of dirty) {
      if (merges >= 2) break;
      // A region merges once every chunk of it that is in range is meshed (one merge instead of one per chunk).
      // Chunks outside the range never hold it back: they are not scheduled, and merge later when they come in range.
      if (this.regionPending(r, pcx, pcz, radius)) continue;
      this.rebuild(r);
      merges++;
    }
    let vis = 0;
    let tris = 0;
    for (const r of this.regions.values()) {
      const inRange = this.regionDist(r, pcx, pcz) <= radius;
      for (const m of [r.opaque, r.translucent]) {
        if (!m) continue;
        m.visible = inRange;
        if (inRange) tris += (m.geometry.index?.count ?? 0) / 3;
      }
      if (inRange) for (const e of r.chunks) if (e.mesh) vis++;
    }
    this.visible = vis;
    this.triangles = tris;
  }

  /** Chebyshev distance in chunks from the player chunk to the nearest chunk column of the region. */
  private regionDist(r: Region, pcx: number, pcz: number): number {
    const x0 = r.rx * REGION;
    const z0 = r.rz * REGION;
    const dx = pcx < x0 ? x0 - pcx : pcx > x0 + REGION - 1 ? pcx - (x0 + REGION - 1) : 0;
    const dz = pcz < z0 ? z0 - pcz : pcz > z0 + REGION - 1 ? pcz - (z0 + REGION - 1) : 0;
    return Math.max(dx, dz);
  }

  private regionPending(r: Region, pcx: number, pcz: number, radius: number): boolean {
    for (const e of r.chunks) {
      if (Math.max(Math.abs(e.cx - pcx), Math.abs(e.cz - pcz)) > radius) continue;
      if (e.inFlight || e.meshedVersion < e.version) return true;
    }
    return false;
  }

  private dispatch(e: ChunkEntry): void {
    const vox = extractPadded(this.world, e.cx, e.cy, e.cz);
    const id = ++this.jobId;
    this.pending.set(id, { key: e.key, version: e.version });
    e.inFlight = true;
    const w = this.workers[this.nextWorker++ % this.workers.length]!;
    w.postMessage({ id, key: e.key, vox, origin: [e.cx * CHUNK_SIZE, e.cy * CHUNK_SIZE, e.cz * CHUNK_SIZE] }, [vox.buffer]);
  }

  /** In-range chunks still waiting for a mesh, plus in-range regions waiting to be merged. */
  outstanding(px: number, pz: number, radius: number): number {
    const pcx = Math.floor(px / CHUNK_SIZE);
    const pcz = Math.floor(pz / CHUNK_SIZE);
    let n = 0;
    for (const e of this.entries.values()) {
      const d = Math.max(Math.abs(e.cx - pcx), Math.abs(e.cz - pcz));
      if (d <= radius && e.meshedVersion < e.version) n++;
    }
    for (const r of this.regions.values()) if (r.dirty && this.regionDist(r, pcx, pcz) <= radius) n++;
    return n;
  }

  /** Region meshes currently visible (each is one draw call before frustum culling). */
  get drawMeshes(): number {
    let n = 0;
    for (const r of this.regions.values()) {
      if (r.opaque?.visible) n++;
      if (r.translucent?.visible) n++;
    }
    return n;
  }

  setShadows(on: boolean): void {
    this.castShadows = on;
    for (const r of this.regions.values()) {
      if (r.opaque) {
        r.opaque.castShadow = on;
        r.opaque.receiveShadow = on;
      }
    }
  }

  dispose(): void {
    for (const w of this.workers) w.terminate();
    for (const r of this.regions.values()) {
      r.opaque?.geometry.dispose();
      r.translucent?.geometry.dispose();
    }
    this.regions.clear();
    this.entries.clear();
  }
}
