import { describe, expect, it } from 'vitest';
import { chooseSttPath, classifyDeviceTier } from '../stt.js';

describe('on-device STT gating (docs/02 6, docs/04 4.4, docs/08 6.6)', () => {
  it('never loads on-device Whisper on low tier, even with WebGPU', () => {
    for (const isIOS of [false, true]) {
      expect(chooseSttPath('low', true, isIOS)).toBe('server_opus16');
      expect(chooseSttPath('low', false, isIOS)).toBe('server_opus16');
    }
  });

  it('allows high and medium with WebGPU on non-iOS', () => {
    expect(chooseSttPath('high', true, false)).toBe('on_device_whisper');
    expect(chooseSttPath('medium', true, false)).toBe('on_device_whisper');
  });

  it('falls back to server without WebGPU', () => {
    expect(chooseSttPath('high', false, false)).toBe('server_opus16');
    expect(chooseSttPath('medium', false, false)).toBe('server_opus16');
  });

  it('on iOS only a high tier may load the model (tight tab memory)', () => {
    expect(chooseSttPath('high', true, true)).toBe('on_device_whisper');
    expect(chooseSttPath('medium', true, true)).toBe('server_opus16');
  });

  it('classifies tiers from frame time, memory and form factor', () => {
    expect(classifyDeviceTier({ meanFrameMs: 12, deviceMemoryGb: 16, isMobile: false })).toBe('high');
    expect(classifyDeviceTier({ meanFrameMs: 25, deviceMemoryGb: 8, isMobile: false })).toBe('medium');
    expect(classifyDeviceTier({ meanFrameMs: 50, deviceMemoryGb: 16, isMobile: false })).toBe('low');
    expect(classifyDeviceTier({ meanFrameMs: 12, deviceMemoryGb: 2, isMobile: false })).toBe('low');
    expect(classifyDeviceTier({ meanFrameMs: 12, deviceMemoryGb: null, isMobile: true })).toBe('low');
    expect(classifyDeviceTier({ meanFrameMs: 12, deviceMemoryGb: 4, isMobile: true })).toBe('medium');
    expect(classifyDeviceTier({ meanFrameMs: 12, deviceMemoryGb: 8, isMobile: true })).toBe('high');
    expect(classifyDeviceTier({ meanFrameMs: 12, deviceMemoryGb: null, isMobile: false })).toBe('high');
  });
});
