import { describe, expect, it } from 'vitest';
import { AutoTierPicker, TIER_SETTINGS, gpuClassOf, graphicsFor } from '../tiers.js';
import { pickTier } from '../../App.js';

describe("G14 quality 'auto' (AutoTierPicker)", () => {
  it('ignores the warm-up, then settles on a tier that holds its frame target', () => {
    const a = new AutoTierPicker('high');
    for (let i = 0; i < 4; i++) expect(a.sample(5, true)).toBeNull(); // meshing the ground: never judged
    for (let i = 0; i < 6; i++) expect(a.sample(58, false)).toBeNull();
    expect(a.settled).toBe('high');
  });

  it('steps down one tier after 5 slow seconds at the resolution floor, then measures again', () => {
    const a = new AutoTierPicker('high');
    for (let i = 0; i < 4; i++) a.sample(60, false);
    const got: Array<string | null> = [];
    for (let i = 0; i < 5; i++) got.push(a.sample(40, true));
    expect(got).toEqual([null, null, null, null, 'mid']);
    expect(a.settled).toBeNull();
    for (let i = 0; i < 5; i++) a.sample(30, true);
    expect(a.tier).toBe('low');
    // low is the floor: no further step (the word-card hand-off is FrameFloorWatch's job)
    for (let i = 0; i < 30; i++) expect(a.sample(10, true)).toBeNull();
  });

  it('slow frames above the floor are the resolution governor’s to fix, not a tier change', () => {
    const a = new AutoTierPicker('mid');
    for (let i = 0; i < 30; i++) expect(a.sample(35, false)).toBeNull();
  });

  it('never steps up', () => {
    const a = new AutoTierPicker('low');
    for (let i = 0; i < 30; i++) expect(a.sample(120, false)).toBeNull();
    expect(a.tier).toBe('low');
  });
});

describe('graphicsFor (G14 values over a tier)', () => {
  const none = { viewChunks: null, shadows: null, renderScale: null };
  it('null follows the tier', () => {
    expect(graphicsFor('mid', none, false)).toMatchObject({ viewChunks: TIER_SETTINGS.mid.viewChunks, shadows: false, renderScale: 1 });
    expect(graphicsFor('high', none, true)).toMatchObject({ viewChunks: 8, shadows: true });
  });
  it('clamps view distance 3..8 and resolution 0.5..1; shadows only with the lit material', () => {
    expect(graphicsFor('mid', { viewChunks: 20, shadows: true, renderScale: 0.1 }, false)).toMatchObject({ viewChunks: 8, shadows: false, renderScale: 0.5, minScale: 0.5 });
    expect(graphicsFor('high', { viewChunks: 1, shadows: false, renderScale: 3 }, true)).toMatchObject({ viewChunks: 3, shadows: false, renderScale: 1 });
  });
});

describe('start tier from the GPU (docs/02 §11: 16-core desktop on software GL ran high at 5.9 fps)', () => {
  it('classifies renderer names', () => {
    expect(gpuClassOf('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)')).toBe('software');
    expect(gpuClassOf('llvmpipe (LLVM 15.0.7, 256 bits)')).toBe('software');
    expect(gpuClassOf('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('integrated');
    expect(gpuClassOf('ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('discrete');
    expect(gpuClassOf('Apple M1')).toBe('discrete');
    expect(gpuClassOf('Adreno (TM) 650')).toBe('integrated');
    expect(gpuClassOf(null)).toBe('unknown');
  });
  it('software GL starts low, an integrated GPU never starts high, ?tier= still wins', () => {
    const big = { hardwareConcurrency: 16, deviceMemory: 16 };
    expect(pickTier('', big, false, null, 'software')).toBe('low');
    expect(pickTier('', big, false, null, 'integrated')).toBe('mid');
    expect(pickTier('', big, false, null, 'discrete')).toBe('high');
    expect(pickTier('', big, false)).toBe('high');
    expect(pickTier('?tier=high', big, false, null, 'software')).toBe('high');
    expect(pickTier('', big, false, 'mid', 'software')).toBe('mid'); // the quality picked in settings beats the GPU guess
  });
});
