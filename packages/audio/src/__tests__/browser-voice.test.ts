import { describe, expect, it } from 'vitest';
import {
  audible,
  BROWSER_SPEAKERS,
  BROWSER_VOICE,
  browserSpeakerFor,
  chooseTier,
  createBrowserVoice,
  judgeFirstLine,
  type BrowserVoiceReply,
  type BrowserVoiceRequest,
  type BrowserVoiceVerdict,
  type DeviceFacts,
  type VoiceWorkerLike
} from '../browser-voice.js';

const PC: DeviceFacts = { worker: true, wasm: true, webgpu: true, memoryGb: 8, cores: 12 };

class FakeWorker implements VoiceWorkerLike {
  sent: BrowserVoiceRequest[] = [];
  onmessage: ((ev: { data: BrowserVoiceReply }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  terminated = false;
  /** synthesis ms reported per line, and audio length in samples (24 kHz) */
  constructor(private opts: { ran?: 'webgpu' | 'wasm'; synthMs?: number; audioSamples?: number; failLoad?: boolean; manual?: boolean; warmMs?: number } = {}) {}
  postMessage(msg: BrowserVoiceRequest): void {
    this.sent.push(msg);
    if (this.opts.manual) return;
    queueMicrotask(() => this.answer(msg));
  }
  answer(msg: BrowserVoiceRequest): void {
    if (msg.type === 'load') {
      if (this.opts.failLoad) this.onmessage?.({ data: { type: 'error', message: 'no model' } });
      else this.onmessage?.({ data: { type: 'ready', ran: this.opts.ran ?? msg.tier, loadMs: 1200, fetchedBytes: 92_000_000, warmMs: this.opts.warmMs ?? 300, warmAudioMs: 1500 } });
    } else {
      const n = this.opts.audioSamples ?? 48_000;
      this.onmessage?.({ data: { type: 'audio', id: msg.id, samples: new Float32Array(n).fill(0.1), sampleRate: 24_000, ms: this.opts.synthMs ?? 400 } });
    }
  }
  terminate(): void {
    this.terminated = true;
  }
}

function memStore(initial: BrowserVoiceVerdict | null = null) {
  let v = initial;
  return { get: () => v, set: (n: BrowserVoiceVerdict) => void (v = n), peek: () => v };
}

function engine(facts: DeviceFacts, w: FakeWorker, store = memStore()) {
  let made = 0;
  const e = createBrowserVoice({
    facts: () => facts,
    makeWorker: () => {
      made += 1;
      return w;
    },
    storage: store,
    nowMs: () => 1_000_000
  });
  return { e, store, made: () => made };
}

describe('browser voice policy (docs/04 4.8)', () => {
  it('picks WebGPU on a PC that has it, WASM otherwise', () => {
    expect(chooseTier(PC, null, 0).tier).toBe('webgpu');
    expect(chooseTier({ ...PC, webgpu: false }, null, 0).tier).toBe('wasm');
  });

  it('phones and tablets keep the device voice (Galaxy S7: 24-29x real time on WASM)', () => {
    expect(chooseTier({ ...PC, mobile: true }, null, 0)).toEqual({ tier: 'off', reason: 'mobile' });
  });

  it('a silent or NaN line is not a working backend (fp16 on WebGPU came out all zeros)', () => {
    expect(audible(new Float32Array(2400))).toBe(false);
    expect(audible(Float32Array.from([0.2, Number.NaN]))).toBe(false);
    expect(audible(Float32Array.from([0, 0.3, -0.2]))).toBe(true);
  });

  it('keeps the device voice on devices that cannot carry the model next to the 3D world', () => {
    expect(chooseTier({ ...PC, memoryGb: 2 }, null, 0)).toEqual({ tier: 'off', reason: 'memory' });
    expect(chooseTier({ ...PC, cores: 2 }, null, 0)).toEqual({ tier: 'off', reason: 'cores' });
    expect(chooseTier({ ...PC, worker: false }, null, 0).tier).toBe('off');
    // Safari reports neither: the measured first line decides there
    expect(chooseTier({ worker: true, wasm: true, webgpu: false }, null, 0).tier).toBe('wasm');
  });

  it('a slow verdict holds for a week, then the device is tried again', () => {
    const slow: BrowserVoiceVerdict = { tier: 'off', reason: 'slow', atMs: 0 };
    expect(chooseTier(PC, slow, BROWSER_VOICE.retestAfterMs - 1).tier).toBe('off');
    expect(chooseTier(PC, slow, BROWSER_VOICE.retestAfterMs + 1).tier).toBe('webgpu');
    // a device whose WebGPU fell back to WASM goes straight to WASM
    expect(chooseTier(PC, { tier: 'wasm', ran: 'wasm', atMs: 0 }, 10).tier).toBe('wasm');
  });

  it('judges the first line by real-time factor', () => {
    expect(judgeFirstLine(900, 2000)).toEqual({ ok: true, rtf: 0.45 });
    expect(judgeFirstLine(2600, 2000).ok).toBe(false);
  });

  it('reads model sentences in af_sarah (the prebuilt model sentences speaker, R2627) and gives every cast voice a Kokoro speaker', () => {
    expect(browserSpeakerFor({ engine: 'kokoro', speaker: 'af_sarah' })).toBe('af_sarah');
    expect(browserSpeakerFor({ engine: 'aura2', speaker: 'luna' })).toBe('af_sarah');
    for (const sp of ['athena', 'hera', 'apollo', 'delia']) expect(browserSpeakerFor({ engine: 'aura2', speaker: sp })).toMatch(/^[ab][fm]_[a-z]+$/);
    expect(browserSpeakerFor({ engine: 'aura2', speaker: 'apollo' })).toMatch(/^[ab]m_/); // Toby is a man
    expect(browserSpeakerFor(undefined)).toBe('af_sarah');
  });

  it('every mapped speaker is a Kokoro v1.0 voice', () => {
    for (const v of Object.values(BROWSER_SPEAKERS)) expect(v).toMatch(/^(af_(heart|alloy|aoede|bella|jessica|kore|nicole|nova|river|sarah|sky)|am_(adam|echo|eric|fenrir|liam|michael|onyx|puck|santa))$/);
  });

  it('the four NPCs and the model voice stay five different browser speakers', () => {
    const ids = ['athena', 'hera', 'apollo', 'delia'].map((sp) => browserSpeakerFor({ engine: 'aura2', speaker: sp }));
    expect(new Set([...ids, browserSpeakerFor({ engine: 'kokoro', speaker: 'af_sarah' })]).size).toBe(5);
  });
});

describe('browser voice engine', () => {
  it('loads once, synthesises, caches the line and stores the verdict', async () => {
    const w = new FakeWorker({ ran: 'webgpu' });
    const { e, store, made } = engine(PC, w);
    const [a, b] = await Promise.all([e.speak('Hello there.', { engine: 'aura2', speaker: 'hera' }), e.speak('Hello there.', { engine: 'aura2', speaker: 'hera' })]);
    expect(a?.sampleRate).toBe(24_000);
    expect(b).toBe(a);
    expect(made()).toBe(1);
    expect(w.sent.filter((m) => m.type === 'load')).toHaveLength(1);
    expect(w.sent.filter((m) => m.type === 'speak')).toHaveLength(1);
    const speak = w.sent.find((m) => m.type === 'speak');
    expect(speak && 'speaker' in speak ? speak.speaker : '').toBe(browserSpeakerFor({ engine: 'aura2', speaker: 'hera' }));
    expect(e.cached('Hello there.', { engine: 'aura2', speaker: 'hera' })).toBe(a);
    expect(store.peek()).toMatchObject({ tier: 'webgpu', ran: 'webgpu', cached: true });
    expect(e.stats()).toMatchObject({ state: 'ready', ran: 'webgpu', rtf: 0.2, lines: 1 });
  });

  it('a first line slower than real time still plays, then the device is off (device voice) and remembered', async () => {
    const w = new FakeWorker({ synthMs: 5000, audioSamples: 48_000 });
    const { e, store } = engine({ ...PC, webgpu: false }, w);
    const first = await e.speak('One two three.', undefined);
    expect(first).not.toBeNull();
    expect(e.state()).toBe('off');
    expect(w.terminated).toBe(true);
    expect(store.peek()).toMatchObject({ tier: 'off', reason: 'slow' });
    expect(await e.speak('Four five.', undefined)).toBeNull();
  });

  it('a warm-up line slower than real time turns it off before any real line is made', async () => {
    const w = new FakeWorker({ warmMs: 20_000 });
    const { e, store } = engine({ ...PC, webgpu: false }, w);
    expect(await e.speak('Hi.', undefined)).toBeNull();
    expect(w.sent.filter((m) => m.type === 'speak')).toHaveLength(0);
    expect(store.peek()).toMatchObject({ tier: 'off', reason: 'slow', ran: 'wasm' });
  });

  it('a failed load turns it off without hanging the caller', async () => {
    const { e } = engine(PC, new FakeWorker({ failLoad: true }));
    expect(await e.speak('Hi.', undefined)).toBeNull();
    expect(e.state()).toBe('off');
  });

  it('stops waiting after waitMs but keeps making the line for the next tap', async () => {
    const w = new FakeWorker({ manual: true });
    const { e } = engine(PC, w);
    const waited = e.speak('Slow line.', undefined, 1, 20);
    w.answer(w.sent[0]!);
    await new Promise((r) => setTimeout(r, 0));
    expect(await waited).toBeNull();
    const speak = w.sent.find((m) => m.type === 'speak')!;
    w.answer(speak);
    await new Promise((r) => setTimeout(r, 0));
    expect(e.cached('Slow line.', undefined)).not.toBeNull();
  });

  it('never builds a worker on a device that is off', async () => {
    const w = new FakeWorker();
    const { e, made } = engine({ ...PC, memoryGb: 1 }, w);
    expect(e.available()).toBe(false);
    expect(await e.speak('Hi.', undefined)).toBeNull();
    expect(made()).toBe(0);
  });
});
