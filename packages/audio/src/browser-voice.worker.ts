/**
 * The browser voice engine (browser-voice.ts): Kokoro-82M through kokoro-js in a dedicated worker. WebGPU first when
 * asked, WASM when WebGPU will not load; lines are made one at a time (one ONNX session) in arrival order.
 *
 * kokoro-js is imported at run time from its pinned web build on jsDelivr (BROWSER_VOICE.libUrl), not bundled: the
 * bundled npm package put a 2.2 MB worker chunk and a 21.6 MB ONNX Runtime wasm into the site's assets that were never
 * used (transformers.js fetches its wasm from jsDelivr anyway), and pulled Node-only packages (onnxruntime-node,
 * sharp) with install scripts into the workspace. Only the pages that need the voice ever fetch it.
 */
import { audible } from './browser-voice-check.js';
import type { BrowserVoiceReply, BrowserVoiceRequest, BrowserVoiceTier } from './browser-voice.js';

interface WorkerScope {
  onmessage: ((ev: MessageEvent<BrowserVoiceRequest>) => void) | null;
  postMessage(msg: BrowserVoiceReply, transfer?: Transferable[]): void;
}
const scope = self as unknown as WorkerScope;

/** The part of kokoro-js 1.2 this worker uses. */
interface KokoroAudio {
  audio: Float32Array;
  sampling_rate: number;
}
interface KokoroTTS {
  generate(text: string, opts: { voice: string; speed?: number }): Promise<KokoroAudio>;
}
interface KokoroModule {
  KokoroTTS: {
    from_pretrained(id: string, opts: { dtype: string; device: string; progress_callback?: (p: unknown) => void }): Promise<KokoroTTS>;
  };
}

let tts: KokoroTTS | null = null;

let queue: Promise<unknown> = Promise.resolve();

async function load(m: Extract<BrowserVoiceRequest, { type: 'load' }>): Promise<void> {
  const t0 = performance.now();
  const files = new Map<string, number>();
  const progress = (p: { status?: string; file?: string; loaded?: number; total?: number }) => {
    if (p.status === 'progress' && p.file && typeof p.total === 'number') {
      files.set(p.file, p.total);
      scope.postMessage({ type: 'progress', loaded: p.loaded ?? 0, total: p.total });
    }
  };
  const order: Array<Exclude<BrowserVoiceTier, 'off'>> = m.tier === 'webgpu' ? ['webgpu', 'wasm'] : ['wasm'];
  let lastErr: unknown = null;
  for (const device of order) {
    try {
      if (device === 'webgpu') {
        // No adapter (Android before 12 still exposes navigator.gpu) or a software one: straight to WASM, before
        // the 326 MB WebGPU weights are fetched for nothing.
        const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ info?: { isFallbackAdapter?: boolean } } | null> } }).gpu;
        const adapter = await gpu?.requestAdapter().catch(() => null);
        if (!adapter || adapter.info?.isFallbackAdapter) throw new Error('no_webgpu_adapter');
      }
      const lib = (await import(/* @vite-ignore */ m.libUrl)) as KokoroModule;
      tts = await lib.KokoroTTS.from_pretrained(m.modelId, { dtype: m.dtype[device], device, progress_callback: progress as (p: unknown) => void });
      // A tiny warm-up line: the first run compiles the graph (WebGPU shaders); a child's first line should not pay it.
      const w0 = performance.now();
      const warm = await tts.generate('Hi there, how are you?', { voice: 'af_sarah' });
      const warmMs = Math.round(performance.now() - w0);
      const warmAudioMs = Math.round((warm.audio.length / warm.sampling_rate) * 1000);
      if (!audible(warm.audio)) throw new Error(`silent output on ${device}`);
      let bytes = 0;
      for (const v of files.values()) bytes += v;
      scope.postMessage({ type: 'ready', ran: device, loadMs: Math.round(performance.now() - t0), fetchedBytes: bytes, warmMs, warmAudioMs });
      return;
    } catch (e) {
      lastErr = e;
      tts = null;
    }
  }
  scope.postMessage({ type: 'error', message: String((lastErr as Error)?.message ?? lastErr) });
}

async function speak(m: Extract<BrowserVoiceRequest, { type: 'speak' }>): Promise<void> {
  if (!tts) {
    scope.postMessage({ type: 'error', id: m.id, message: 'not_loaded' });
    return;
  }
  const t0 = performance.now();
  try {
    const out = await tts.generate(m.text, { voice: m.speaker, speed: m.speed });
    const samples = out.audio instanceof Float32Array ? out.audio : Float32Array.from(out.audio);
    scope.postMessage({ type: 'audio', id: m.id, samples, sampleRate: out.sampling_rate, ms: Math.round(performance.now() - t0) }, [samples.buffer]);
  } catch (e) {
    scope.postMessage({ type: 'error', id: m.id, message: String((e as Error)?.message ?? e) });
  }
}

scope.onmessage = (ev) => {
  const m = ev.data;
  queue = queue.then(() => (m.type === 'load' ? load(m) : speak(m))).catch(() => undefined);
};
