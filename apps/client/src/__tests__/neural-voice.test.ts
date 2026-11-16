import { afterEach, describe, expect, it, vi } from 'vitest';
import { npcCast, voiceForCtx } from '@lcw/content';
import { loadLine, loudnessGain, NEURAL_RETRY_METER_MS, NEURAL_RETRY_MS, NEURAL_VOICE, neuralVoiceOn, neuralVoiceStatus, resetNeuralVoice, ttsUrl, within } from '../dialog/neural-voice.js';

/** Dan 11-16 "목소리 자연스러움": the client side of the neural NPC voice (server: edge tts.ts). */

const sine = (amp: number, n = 24_000) => Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * 220 * i) / 24_000));
const dbOf = (g: number) => 20 * Math.log10(g);

describe('neural NPC voice (client)', () => {
  afterEach(() => resetNeuralVoice());

  it('asks the server once and stays on the device voice while it is off or unreachable', async () => {
    const f = vi.fn(async () => Response.json({ enabled: false }));
    expect(await neuralVoiceStatus('', f as unknown as typeof fetch)).toBe(false);
    expect(await neuralVoiceStatus('', f as unknown as typeof fetch)).toBe(false);
    expect(f).toHaveBeenCalledTimes(1);
    expect(neuralVoiceOn()).toBe(false);
    resetNeuralVoice();
    expect(await neuralVoiceStatus('', (async () => { throw new TypeError('offline'); }) as unknown as typeof fetch)).toBe(false);
    resetNeuralVoice();
    expect(await neuralVoiceStatus('', (async () => Response.json({ enabled: true })) as unknown as typeof fetch)).toBe(true);
    expect(neuralVoiceOn()).toBe(true);
  });

  it('builds the cached line URL from the cast voice and the normalized text', () => {
    expect(ttsUrl('', voiceForCtx('cafe'), '  Welcome  to the honey cafe! ')).toBe('/v1/tts?v=aura2-hera&t=Welcome%20to%20the%20honey%20cafe!');
    // the model voice is the local open-weights speaker (R2625); the edge serves its uploaded lines under this id
    expect(ttsUrl('', npcCast().modelVoice, 'Hi')).toContain('v=kokoro-af_heart');
  });

  it('downloads a line once, and a refused line is tried again later', async () => {
    let n = 0;
    const ok = vi.fn(async () => {
      n += 1;
      return new Response(new Uint8Array(500), { headers: { 'content-type': 'audio/mpeg' } });
    });
    const v = voiceForCtx('cafe');
    const a = await loadLine(v, 'Hello there!', '', ok as unknown as typeof fetch);
    const b = await loadLine(v, 'Hello there!', '', ok as unknown as typeof fetch);
    expect(a?.byteLength).toBe(500);
    expect(b).toBe(a);
    expect(n).toBe(1);
    const no = vi.fn(async () => Response.json({ error: 'child_token_required', fallback: 'device' }, { status: 401 }));
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      expect(await loadLine(v, 'Not a fixed line', '', no as unknown as typeof fetch)).toBeNull();
      await Promise.resolve();
      // not again at once (the dialog prefetches on every lesson poll): only after NEURAL_RETRY_MS
      expect(await loadLine(v, 'Not a fixed line', '', no as unknown as typeof fetch)).toBeNull();
      expect(no).toHaveBeenCalledTimes(1);
      vi.setSystemTime(Date.now() + NEURAL_RETRY_MS + 1);
      expect(await loadLine(v, 'Not a fixed line', '', no as unknown as typeof fetch)).toBeNull();
      expect(no).toHaveBeenCalledTimes(2);
      // the meter's 429 waits five minutes
      const meter = vi.fn(async () => Response.json({ error: 'tts_budget' }, { status: 429 }));
      expect(await loadLine(v, 'Metered line', '', meter as unknown as typeof fetch)).toBeNull();
      await Promise.resolve();
      vi.setSystemTime(Date.now() + NEURAL_RETRY_MS + 1);
      expect(await loadLine(v, 'Metered line', '', meter as unknown as typeof fetch)).toBeNull();
      expect(meter).toHaveBeenCalledTimes(1);
      vi.setSystemTime(Date.now() + NEURAL_RETRY_METER_MS);
      expect(await loadLine(v, 'Metered line', '', meter as unknown as typeof fetch)).toBeNull();
      expect(meter).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a slow line gives way to the device voice after waitMs', async () => {
    vi.useFakeTimers();
    const slow = new Promise<ArrayBuffer | null>(() => undefined);
    const p = within(slow, NEURAL_VOICE.waitMs);
    vi.advanceTimersByTime(NEURAL_VOICE.waitMs + 1);
    expect(await p).toBeNull();
    vi.useRealTimers();
    expect(await within(Promise.resolve(new ArrayBuffer(4)), 50)).toBeInstanceOf(ArrayBuffer);
  });

  it('matches a line to the voice bus loudness and keeps its peak under the limiter', () => {
    // a quiet line (RMS -29 dBFS) is lifted toward -16 LUFS: +12.6 dB wanted, capped by maxGainDb
    expect(dbOf(loudnessGain(sine(0.05)))).toBeCloseTo(NEURAL_VOICE.maxGainDb, 1);
    // a loud, peaky line (peak -0.9 dBFS) is lifted only up to the ceiling
    const g = loudnessGain(sine(0.9));
    expect(dbOf(g) + dbOf(0.9)).toBeLessThanOrEqual(NEURAL_VOICE.peakCeilingDb + 0.01);
    // a mid line (RMS -20 dBFS) comes up ~4.4 dB to the -16 target (0.4 dB RMS/LUFS offset)
    expect(dbOf(loudnessGain(sine(0.1414)))).toBeCloseTo(4.4, 0);
    expect(loudnessGain(new Float32Array(100))).toBe(1);
  });
});
