/**
 * The browser voice engine (browser-voice.ts): Kokoro-82M through kokoro-js in a dedicated worker. WebGPU first when
 * asked, WASM when WebGPU will not load. Lines are made one at a time (one ONNX session); a line the child asked for
 * (a 🔊 tap, the NPC speaking now) goes ahead of background prefetches.
 *
 * kokoro-js is not bundled: its pinned web build is fetched from jsDelivr (BROWSER_VOICE.libUrl), checked against its
 * SHA-256 (the same bytes as the npm 1.2.1 tarball) and only then run, from a blob URL. Bundling the npm package put a
 * 2.2 MB worker chunk and a never-used 21.6 MB ONNX Runtime wasm into the site's assets (transformers.js fetches its
 * wasm from jsDelivr anyway) and pulled Node-only packages with install scripts into the workspace.
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
let lib: Promise<KokoroModule> | null = null;

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Fetch, verify, then import the library (a changed or tampered file never runs). */
function importLib(url: string, sha256: string): Promise<KokoroModule> {
  lib ??= (async () => {
    const r = await fetch(url, { referrerPolicy: 'no-referrer', credentials: 'omit' });
    if (!r.ok) throw new Error(`lib_http_${r.status}`);
    const bytes = await r.arrayBuffer();
    const got = hex(await crypto.subtle.digest('SHA-256', bytes));
    if (got !== sha256) throw new Error('lib_hash_mismatch');
    const blobUrl = URL.createObjectURL(new Blob([bytes], { type: 'text/javascript' }));
    return (await import(/* @vite-ignore */ blobUrl)) as KokoroModule;
  })();
  lib.catch(() => (lib = null));
  return lib;
}

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
      const k = await importLib(m.libUrl, m.libSha256);
      tts = await k.KokoroTTS.from_pretrained(m.modelId, { dtype: m.dtype[device], device, progress_callback: progress as (p: unknown) => void });
      // Two warm-up lines: the first pays the graph and shader compilation, the second is the speed test the engine
      // judges (a child's first line pays neither). A silent or NaN line means the backend does not work here.
      const first = await tts.generate('Hi there.', { voice: 'af_sarah' });
      if (!audible(first.audio)) throw new Error(`silent output on ${device}`);
      const w0 = performance.now();
      const warm = await tts.generate('Hi there, how are you today?', { voice: 'af_sarah' });
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

/** Load first, then lines the child is waiting for, then background prefetches. */
const pending: BrowserVoiceRequest[] = [];
let busy = false;

function next(): BrowserVoiceRequest | undefined {
  const i = pending.findIndex((r) => r.type === 'load');
  if (i >= 0) return pending.splice(i, 1)[0];
  const u = pending.findIndex((r) => r.type === 'speak' && !r.background);
  return pending.splice(u >= 0 ? u : 0, 1)[0];
}

async function drain(): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    for (let m = next(); m; m = next()) {
      try {
        await (m.type === 'load' ? load(m) : speak(m));
      } catch {
        /* each step reports its own error */
      }
    }
  } finally {
    busy = false;
  }
}

scope.onmessage = (ev) => {
  pending.push(ev.data);
  void drain();
};
