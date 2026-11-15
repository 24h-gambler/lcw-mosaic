// First screen inside 3 s (coordinator, 11-16): padded extraction is exact, only the first ring is meshed before
// the reveal, regions never wait on chunks out of range, and the HTML splash uses the design tokens.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CHUNK_SIZE, VoxelWorld } from '@lcw/sim-core';
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
    const ringChunks = [...town.chunks.values()].filter(
      (c) => Math.max(Math.abs(c.cx - Math.floor(x / CHUNK_SIZE)), Math.abs(c.cz - Math.floor(z / CHUNK_SIZE))) <= FIRST_RING
    ).length;
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
