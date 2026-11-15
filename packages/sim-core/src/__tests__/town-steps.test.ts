import { describe, expect, it } from 'vitest';
import { BK, VoxelWorld, buildTown, buildTownSteps } from '../index.js';

/** docs/08 TBT · first screen: the town is built in small steps on the client, with the same result as at once. */
function fingerprint(w: VoxelWorld): string {
  let h = 2166136261;
  const keys = [...w.chunks.keys()].sort();
  for (const k of keys) {
    const c = w.chunks.get(k)!;
    for (let ly = 0; ly < 16; ly++)
      for (let lz = 0; lz < 16; lz++)
        for (let lx = 0; lx < 16; lx++) {
          h ^= c.getVoxel(lx, ly, lz) + 31 * (lx + 16 * (ly + 16 * lz));
          h = Math.imul(h, 16777619) >>> 0;
        }
    h ^= k.length;
  }
  return `${keys.length}:${h}`;
}

describe('town in steps (start-up without long tasks)', () => {
  it('stepping gives the very same world as building at once, with many pause points', () => {
    const a = new VoxelWorld();
    const calls = buildTown(a);
    const b = new VoxelWorld();
    const steps = buildTownSteps(b);
    let pauses = 0;
    let r = steps.next();
    while (!r.done) {
      pauses++;
      r = steps.next();
    }
    expect(r.value).toBe(calls);
    expect(pauses).toBeGreaterThanOrEqual(15);
    expect(fingerprint(b)).toBe(fingerprint(a));
  });

  it('setBlock keeps the light registry exact and the zones for players', () => {
    const w = new VoxelWorld();
    const sys = { id: 'gen', isSystemGen: true };
    const lights = (): number => w.getLightSourcesInChunk(9, 0, 9).length;
    expect(w.setBlock(sys, 150, 3, 150, BK.torch).ok).toBe(true);
    expect(lights()).toBe(1);
    w.setBlock(sys, 150, 3, 150, BK.stone);
    expect(lights()).toBe(0);
    w.setBlock(sys, 150, 3, 150, BK.torch);
    w.setBlock(sys, 150, 3, 150, 0);
    expect(lights()).toBe(0);
    // the generator writes in the plaza; a player may not, and only the owner builds on the plot
    expect(w.setBlock({ id: 'kid' }, 150, 3, 150, BK.stone)).toMatchObject({ ok: false });
    expect(w.setBlock({ id: 'kid' }, 110, 3, 170, BK.stone)).toMatchObject({ ok: false });
    expect(w.setBlock({ id: 'kid', isOwner: true }, 110, 3, 170, BK.stone).ok).toBe(true);
    // negative coordinates inside a chunk (y below 0) land in the right cell
    w.setBlock(sys, 40, -2, 40, BK.stone);
    expect(w.getBlock(40, -2, 40)).toBe(BK.stone);
    expect(w.getBlock(40, -1, 40)).toBe(0);
  });
});
