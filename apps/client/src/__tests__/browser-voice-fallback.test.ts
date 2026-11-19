import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { npcCast, voiceForCtx } from '@lcw/content';

/**
 * Dan 11-16 R2627 "pc에 기계음": a line the server voice cannot read (off, 429 quota meter, failure, slower than its
 * wait) is read by the browser voice (Kokoro on the device), never by the device's speechSynthesis voice — unless
 * the device cannot run the browser voice or the player turned "자연스러운 목소리" off.
 */

// The page's event target (sound.ts listens for the mic's voice cut on globalThis), before the modules load.
vi.hoisted(() => {
  const et = new EventTarget();
  const g = globalThis as unknown as { addEventListener?: unknown; dispatchEvent?: unknown };
  g.addEventListener ??= et.addEventListener.bind(et);
  g.dispatchEvent ??= et.dispatchEvent.bind(et);
});

const fake = vi.hoisted(() => ({
  available: true,
  line: { samples: new Float32Array(2400).fill(0.05), sampleRate: 24_000 } as { samples: Float32Array; sampleRate: number } | null,
  delayMs: 0,
  ready: true,
  cachedModel: true,
  loads: 0,
  calls: [] as Array<{ text: string; voice: unknown; speed: number }>,
  background: [] as string[]
}));

vi.mock('@lcw/audio', async (orig) => {
  const real = await orig<typeof import('@lcw/audio')>();
  const engine = {
    available: () => fake.available,
    state: () => (!fake.available ? 'off' : fake.ready ? 'ready' : 'loading'),
    load: async () => {
      fake.loads += 1;
      return fake.available;
    },
    modelCached: () => fake.cachedModel,
    cached: () => null,
    speak: (text: string, voice: unknown, speed = 1, _waitMs?: number, opts?: { background?: boolean }) => {
      if (opts?.background) fake.background.push(text);
      else fake.calls.push({ text, voice, speed });
      if (!fake.available) return Promise.resolve(null);
      return new Promise((r) => setTimeout(() => r(fake.line), fake.delayMs));
    },
    stats: () => ({})
  };
  return { ...real, browserVoice: () => engine, preloadBrowserVoiceWhenIdle: () => undefined };
});

import { micCue, resetBrowserSticky, speakEnglish, stopSpeaking } from '../dialog/sound.js';
import { browserVoiceMayDownload, neuralVoiceStatus, prefetchLines, resetNeuralVoice } from '../dialog/neural-voice.js';
import { NPC_VOICE_CUT_EVENT } from '../audio/runtime.js';

const played: string[] = [];
const spoken: string[] = [];

class FakeAudio {
  src = '';
  preload = '';
  duration = 1;
  playbackRate = 1;
  preservesPitch = true;
  onplaying: (() => void) | null = null;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  play() {
    played.push(this.src);
    setTimeout(() => {
      this.onplaying?.();
      this.onended?.();
    }, 0);
    return Promise.resolve();
  }
  pause() {}
  removeAttribute() {}
  load() {}
}

function serve(status: 'off' | 429 | 'ok') {
  globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
    const u = String(url);
    if (u.includes('/v1/tts/status')) return Response.json({ enabled: status !== 'off' });
    if (status === 429) return Response.json({ error: 'tts_quota', fallback: 'device' }, { status: 429 });
    return new Response(new Uint8Array([0xff, 0xfb, 0x90, 0x00]), { headers: { 'content-type': 'audio/mpeg' } });
  }) as typeof fetch;
}

beforeEach(() => {
  played.length = 0;
  spoken.length = 0;
  fake.available = true;
  fake.delayMs = 0;
  fake.calls.length = 0;
  fake.background.length = 0;
  fake.ready = true;
  fake.cachedModel = true;
  fake.loads = 0;
  fake.line = { samples: new Float32Array(2400).fill(0.05), sampleRate: 24_000 };
  const synth = { speak: (u: { text: string; onend?: () => void }) => (spoken.push(u.text), setTimeout(() => u.onend?.(), 0)), cancel: () => undefined, getVoices: () => [] };
  vi.stubGlobal('window', { speechSynthesis: synth, addEventListener: () => undefined });
  vi.stubGlobal('speechSynthesis', synth);
  vi.stubGlobal('SpeechSynthesisUtterance', class {
    lang = '';
    rate = 1;
    volume = 1;
    voice: unknown = null;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(public text: string) {}
  });
  vi.stubGlobal('Audio', FakeAudio);
});

afterEach(() => {
  stopSpeaking();
  resetNeuralVoice();
  resetBrowserSticky();
  vi.unstubAllGlobals();
});

const hera = voiceForCtx('cafe');

describe('browser voice replaces the device voice when the server voice cannot read a line', () => {
  it('quota meter 429: the NPC line is read by the browser voice, not speechSynthesis', async () => {
    serve(429);
    await speakEnglish('A brand new line from the AI.', 'L1', hera);
    expect(fake.calls).toEqual([{ text: 'A brand new line from the AI.', voice: hera, speed: 1 }]);
    expect(played).toHaveLength(1);
    expect(played[0]).toMatch(/^blob:/);
    expect(spoken).toEqual([]);
  });

  it('server voice off: the model sentence is read by the browser voice (the cast pack Kokoro speaker, as prebuilt)', async () => {
    serve('off');
    await speakEnglish('I want a red jetpack.', 'L1', npcCast().modelVoice);
    expect(fake.calls[0]?.voice).toEqual(npcCast().modelVoice);
    expect(spoken).toEqual([]);
  });

  it('a line without a cast voice (settings volume try) uses the browser voice too', async () => {
    serve('ok');
    await speakEnglish('Can you hear me?', 'L1');
    expect(fake.calls).toHaveLength(1);
    expect(spoken).toEqual([]);
  });

  it('the server line that arrives plays as before and the browser voice is not asked', async () => {
    serve('ok');
    await speakEnglish('Welcome to the honey cafe! What would you like today?', 'L1', hera);
    expect(fake.calls).toEqual([]);
    expect(played).toHaveLength(1);
    expect(spoken).toEqual([]);
  });

  it('a device that cannot run the browser voice keeps the device voice', async () => {
    serve(429);
    fake.available = false;
    await speakEnglish('A brand new line from the AI.', 'L1', hera);
    expect(spoken).toEqual(['A brand new line from the AI.']);
    expect(played).toEqual([]);
  });

  it('the browser voice giving up (null) falls to the device voice', async () => {
    serve(429);
    fake.line = null;
    await speakEnglish('Another new line.', 'L1', hera);
    expect(spoken).toEqual(['Another new line.']);
  });

  it('a mic tap (micCue, no voice playing yet) while the browser line is still being made drops it', async () => {
    serve(429);
    fake.delayMs = 30;
    const p = speakEnglish('A slow new line.', 'L1', hera);
    await new Promise((r) => setTimeout(r, 10));
    void micCue();
    await p;
    expect(played).toEqual([]);
    expect(spoken).toEqual([]);
  });

  it('a mic tap before the browser voice gives up keeps the device voice from reading over the recording', async () => {
    serve(429);
    fake.line = null;
    fake.delayMs = 30;
    const p = speakEnglish('Another slow line.', 'L1', hera);
    await new Promise((r) => setTimeout(r, 10));
    void micCue();
    await p;
    expect(spoken).toEqual([]);
    expect(played).toEqual([]);
  });

  it('the voice cut event (a playing NPC cut by the mic) also drops a line being made', async () => {
    serve(429);
    fake.delayMs = 30;
    const p = speakEnglish('A slow new line.', 'L1', hera);
    await new Promise((r) => setTimeout(r, 10));
    globalThis.dispatchEvent?.(new Event(NPC_VOICE_CUT_EVENT));
    await p;
    expect(played).toEqual([]);
  });

  it('during the first model download the line does not wait: device voice now, the download goes on', async () => {
    serve(429);
    fake.ready = false;
    fake.cachedModel = false;
    await speakEnglish('A line while downloading.', 'L1', hera);
    expect(spoken).toEqual(['A line while downloading.']);
    expect(fake.calls).toEqual([]);
    expect(fake.loads).toBe(1);
  });

  it('with the model already on disk a loading engine is waited for (seconds), not skipped', async () => {
    serve(429);
    fake.ready = false;
    fake.cachedModel = true;
    await speakEnglish('A line while loading from disk.', 'L1', hera);
    expect(fake.calls).toHaveLength(1);
    expect(spoken).toEqual([]);
  });

  it('after one miss the NPC stays in the browser voice (no engine flip-flop line by line), other NPCs keep the server', async () => {
    serve(429);
    await speakEnglish('A brand new line from the AI.', 'L1', hera);
    serve('ok');
    await speakEnglish('Welcome to the honey cafe! What would you like today?', 'L1', hera);
    expect(fake.calls.map((c) => c.text)).toEqual(['A brand new line from the AI.', 'Welcome to the honey cafe! What would you like today?']);
    await speakEnglish('Hi there! Where do you want to go?', 'L1', voiceForCtx('guide'));
    expect(fake.calls).toHaveLength(2);
    expect(spoken).toEqual([]);
  });
});

describe('the first model download (326 MB) starts only when a line really needs it (review of #150)', () => {
  const noModel = () => {
    fake.ready = false;
    fake.cachedModel = false;
  };

  it('a line without a cast voice (settings volume try) never starts it: the device voice reads it', async () => {
    serve('ok');
    noModel();
    await speakEnglish('Can you hear me?', 'L1');
    expect(spoken).toEqual(['Can you hear me?']);
    expect(fake.loads).toBe(0);
    expect(fake.calls).toEqual([]);
  });

  it('a failed status check (5xx) is not "server off": no download, no background lines', async () => {
    globalThis.fetch = vi.fn(async () => new Response('down', { status: 503 })) as typeof fetch;
    noModel();
    await neuralVoiceStatus();
    expect(browserVoiceMayDownload('server_off')).toBe(false);
    await speakEnglish('Welcome to the honey cafe!', 'L1', hera);
    prefetchLines([{ voice: hera, text: 'One more line.' }]);
    await new Promise((r) => setTimeout(r, 20));
    expect(fake.loads).toBe(0);
    expect(fake.background).toEqual([]);
    expect(spoken).toEqual(['Welcome to the honey cafe!']);
  });

  it('the server itself saying off still allows it (outside a lesson)', async () => {
    serve('off');
    noModel();
    await neuralVoiceStatus();
    expect(browserVoiceMayDownload('server_off')).toBe(true);
    await speakEnglish('Welcome to the honey cafe!', 'L1', hera);
    expect(fake.loads).toBe(1);
  });

  it('in a lesson (?code=) a server miss reads with the device voice and downloads nothing; a model already cached is used', async () => {
    vi.stubGlobal('location', { search: '?code=123456' });
    serve(429);
    noModel();
    expect(browserVoiceMayDownload('server_missed')).toBe(false);
    await speakEnglish('A teacher line the meter refused.', 'L1', hera);
    prefetchLines([{ voice: hera, text: 'Another refused line.' }]);
    await new Promise((r) => setTimeout(r, 20));
    expect(fake.loads).toBe(0);
    expect(fake.background).toEqual([]);
    expect(spoken).toEqual(['A teacher line the meter refused.']);
    fake.cachedModel = true;
    await speakEnglish('A second refused line.', 'L1', hera);
    expect(fake.calls.map((c) => c.text)).toEqual(['A second refused line.']);
  });
});

describe('prefetch (🔊 and suggestions) warms the browser voice only for lines the server voice cannot make', () => {
  const lines = [
    { voice: hera, text: 'Welcome to the honey cafe!' },
    { voice: npcCast().modelVoice, text: 'I want a red jetpack.' }
  ];
  const settle = () => new Promise((r) => setTimeout(r, 20));

  it('server voice off: every line is made in the background (behind the line being spoken)', async () => {
    serve('off');
    await neuralVoiceStatus();
    prefetchLines(lines);
    await settle();
    expect(fake.background).toEqual(lines.map((l) => l.text));
    expect(fake.calls).toEqual([]);
  });

  it('server voice on and the lines arrive: the browser voice is not asked', async () => {
    serve('ok');
    await neuralVoiceStatus();
    prefetchLines(lines);
    await settle();
    expect(fake.background).toEqual([]);
  });

  it('server voice on but the meter refuses (429): the refused lines are made in the background', async () => {
    serve(429);
    await neuralVoiceStatus();
    prefetchLines(lines);
    await settle();
    expect(fake.background.sort()).toEqual(lines.map((l) => l.text).sort());
  });

  it('a device that cannot run the browser voice asks nothing', async () => {
    serve('off');
    fake.available = false;
    await neuralVoiceStatus();
    prefetchLines(lines);
    await settle();
    expect(fake.background).toEqual([]);
  });
});
