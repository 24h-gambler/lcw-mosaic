// First screen inside 3 s (coordinator, 11-16): padded extraction is exact, only the first ring is meshed before
// the reveal, regions never wait on chunks out of range, and the HTML splash uses the design tokens.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CHUNK_SIZE, VoxelWorld, naturalHeight, naturalSurfaceChunkRange } from '@lcw/sim-core';
import { COLOR_TOKENS } from '@lcw/ui';
import { ChunkRenderer, extractPadded } from '../chunks.js';
import { PAD } from '../mesher.js';
import { buildTown } from '../town.js';
import { FIRST_RING } from '../engine.js';

const town = new VoxelWorld();
buildTown(town);
const mats = { opaque: new THREE.MeshBasicMaterial(), translucent: new THREE.MeshBasicMaterial() };

describe('padded chunk extraction', () => {
  it('matches getBlock for every cell, borders included', () => {
    for (const [cx, cy, cz] of [
      [9, 0, 9],
      [8, 0, 7],
      [10, 1, 8]
    ] as const) {
      const p = extractPadded(town, cx, cy, cz);
      let i = 0;
      let mismatch = 0;
      for (let y = 0; y < PAD; y++)
        for (let z = 0; z < PAD; z++)
          for (let x = 0; x < PAD; x++) {
            const want = town.getBlock(cx * CHUNK_SIZE + x - 1, cy * CHUNK_SIZE + y - 1, cz * CHUNK_SIZE + z - 1);
            if (p[i++] !== want) mismatch++;
          }
      expect(mismatch).toBe(0);
    }
  });
});

describe('first ring before the reveal', () => {
  it('meshes only the chunks around the start spot and shows them', () => {
    expect(FIRST_RING).toBeLessThanOrEqual(2);
    const r = new ChunkRenderer(town, mats, 0);
    const x = 163.5;
    const z = 134.5; // honey cafe spot: its region straddles chunks far outside the first ring
    for (let k = 0; k < 400 && r.outstanding(x, z, FIRST_RING) > 0; k++) r.update(x, z, FIRST_RING, 64);
    expect(r.outstanding(x, z, FIRST_RING)).toBe(0);
    // the town's chunks in the ring and the natural surface chunks of the ring's columns (R2861① the open land)
    const pcx = Math.floor(x / CHUNK_SIZE);
    const pcz = Math.floor(z / CHUNK_SIZE);
    const keys = new Set(
      [...town.chunks.values()]
        .filter((c) => Math.max(Math.abs(c.cx - pcx), Math.abs(c.cz - pcz)) <= FIRST_RING)
        .map((c) => `${c.cx},${c.cy},${c.cz}`)
    );
    for (let cz = pcz - FIRST_RING; cz <= pcz + FIRST_RING; cz++) {
      for (let cx = pcx - FIRST_RING; cx <= pcx + FIRST_RING; cx++) {
        const [lo, hi] = naturalSurfaceChunkRange(cx, cz);
        for (let cy = lo; cy <= hi; cy++) keys.add(`${cx},${cy},${cz}`);
      }
    }
    const ringChunks = keys.size;
    expect(r.meshed).toBe(ringChunks);
    expect(r.meshed).toBeLessThan(town.chunks.size);
    expect(r.group.children.length).toBeGreaterThan(0);
  });

  it('the rest streams in afterwards without leaving a region unmerged', () => {
    const r = new ChunkRenderer(town, mats, 0);
    const x = 163.5;
    const z = 134.5;
    for (let k = 0; k < 400 && r.outstanding(x, z, FIRST_RING) > 0; k++) r.update(x, z, FIRST_RING, 64);
    for (let k = 0; k < 2000 && r.outstanding(x, z, 6) > 0; k++) r.update(x, z, 6, 64);
    expect(r.outstanding(x, z, 6)).toBe(0);
  });
});

describe('block material follows the tier (shadows on any world)', () => {
  it('setMaterials swaps the material on every mesh, and new meshes use it too', () => {
    const r = new ChunkRenderer(town, mats, 0);
    const x = 163.5;
    const z = 134.5;
    for (let k = 0; k < 400 && r.outstanding(x, z, FIRST_RING) > 0; k++) r.update(x, z, FIRST_RING, 64);
    const lit = { opaque: new THREE.MeshLambertMaterial(), translucent: new THREE.MeshLambertMaterial({ transparent: true }) };
    r.setMaterials(lit);
    const meshes = r.group.children as THREE.Mesh[];
    expect(meshes.length).toBeGreaterThan(0);
    for (const m of meshes) expect([lit.opaque, lit.translucent]).toContain(m.material);
    for (let k = 0; k < 2000 && r.outstanding(x, z, 4) > 0; k++) r.update(x, z, 4, 64);
    for (const m of r.group.children as THREE.Mesh[]) expect([lit.opaque, lit.translucent]).toContain(m.material);
    r.setMaterials(mats);
    for (const m of r.group.children as THREE.Mesh[]) expect([mats.opaque, mats.translucent]).toContain(m.material);
  });
});

describe('HTML splash', () => {
  it('uses the @lcw/ui token colours (index.html cannot import them)', () => {
    const html = readFileSync(fileURLToPath(new URL('../../../index.html', import.meta.url)), 'utf8');
    const splash = html.slice(html.indexOf('.lcw-splash'), html.indexOf('@keyframes lcwhop'));
    const used = new Set((splash.match(/#[0-9A-Fa-f]{6}\b/g) ?? []).map((h) => h.toUpperCase()));
    const tokens = new Set(Object.values(COLOR_TOKENS).map((h) => String(h).toUpperCase()));
    expect(used.size).toBeGreaterThan(0);
    for (const h of used) expect(tokens.has(h)).toBe(true);
  });

  it('fonts never block the first paint', () => {
    const html = readFileSync(fileURLToPath(new URL('../../../index.html', import.meta.url)), 'utf8');
    for (const line of html.split(/\r?\n/).filter((l) => l.includes('rel="stylesheet"'))) expect(line).toContain('media="print"');
  });
});

describe('the open land streams in (R2861①)', () => {
  it('far from the town the renderer meshes the natural ground without the world making a chunk, and gives far meshes back', () => {
    const w = new VoxelWorld();
    const r = new ChunkRenderer(w, mats, 0);
    const x = 5000.5;
    const z = -5000.5;
    for (let k = 0; k < 400 && r.outstanding(x, z, 3) > 0; k++) r.update(x, z, 3, 64);
    expect(r.outstanding(x, z, 3)).toBe(0);
    expect(w.chunks.size).toBe(0);
    expect(r.naturalColumns).toBe(49);
    expect(r.triangles).toBeGreaterThan(1000);
    // walking 2 km away gives the old meshes and columns back (no growth while walking on)
    const x2 = x + 2000;
    for (let k = 0; k < 400 && r.outstanding(x2, z, 3) > 0; k++) r.update(x2, z, 3, 64);
    r.update(x2, z, 3, 64);
    expect(r.naturalColumns).toBeLessThanOrEqual(49 + 49);
    for (let k = 0; k < 400 && r.outstanding(x2 + 16, z, 3) > 0; k++) r.update(x2 + 16, z, 3, 64);
    r.update(x2 + 16, z, 3, 64);
    expect(r.naturalColumns).toBeLessThanOrEqual(7 * 9 + 49);
  });

  it('a dig deep under the ground shows the tunnel walls (the next chunk is the natural ground, meshed on demand)', () => {
    const w = new VoxelWorld();
    const r = new ChunkRenderer(w, mats, 0);
    const x = 3000;
    const z = 3000;
    const y = -500;
    // a tunnel along x across a chunk border
    for (let i = -3; i <= 3; i++) {
      for (const dy of [0, 1]) {
        w.setBlock({ id: 'k', townRules: true }, x + i, y + dy, z, 0);
        r.markDirtyAt(x + i, y + dy, z);
      }
    }
    for (let k = 0; k < 400 && r.outstanding(x, z, 2) > 0; k++) r.update(x + 0.5, z + 0.5, 2, 64);
    expect(r.triangles).toBeGreaterThan(0);
    // the ground beside the tunnel is still the deep stone
    expect(w.getBlock(x, y, z + 1)).not.toBe(0);
    expect(naturalHeight(x, z)).toBeGreaterThanOrEqual(0);
  });
});
