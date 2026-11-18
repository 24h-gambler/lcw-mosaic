/**
 * Browser neural voice (docs/04 4.8 "브라우저 신경 음성", Dan 11-16 R2627 "pc에 기계음"): when the server voice
 * (edge `/v1/tts`) refuses a line (quota meter 429), fails or is slower than its wait, the line is read by Kokoro-82M
 * running in this browser (kokoro-js, ONNX Runtime Web: WebGPU where the browser has it, else WASM) instead of the
 * device's speechSynthesis voice. It costs nothing (no neurons, no server), nothing leaves the device, and the model
 * sentences come out in the model voice's own Kokoro speaker (af_sarah), the one the operator's GPU prebuilt them with
 * (tools/tts-local).
 *
 * - The engine runs in a Web Worker (`browser-voice.worker.ts`), so loading (~90 MB) and synthesis never block the
 *   world's frame loop. The model and the voice files come from the Hugging Face CDN and stay in Cache Storage
 *   (`transformers-cache`, `kokoro-voices`): nothing is added to the site's own assets.
 * - Devices that cannot keep up (too little memory or cores, or a first line slower than real time) keep the device
 *   voice: the verdict is stored per browser (`BROWSER_VOICE.storageKey`) and tried again after `retestAfterMs`.
 * - Only this module's caller decides when (sound.ts / site sound.ts); this file is the engine and its policy.
 */

/** Structural voice (the cast pack's NpcVoice: engine + speaker), so this package needs no content dependency. */
export interface VoiceRef {
  engine: string;
  speaker: string;
}

export type BrowserVoiceTier = 'webgpu' | 'wasm' | 'off';
export type BrowserVoiceDtype = 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16';

export const BROWSER_VOICE = {
  modelId: 'onnx-community/Kokoro-82M-v1.0-ONNX',
  /** kokoro-js web build (Apache-2.0, 2.1 MB, transformers.js + phonemizer inside), pinned; loaded by the worker only. */
  libUrl: 'https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.web.js',
  /** SHA-256 of that file (identical to dist/kokoro.web.js in the npm 1.2.1 tarball, checked 11-18); anything else never runs. */
  libSha256: '6067712fe4c43cdb36c762f860a5ab8d96ea1d9c8882466438eb9f3d0d20be8f',
  /**
   * Weights per backend (measured 11-16 in headless Chrome 157 on an RTX 3080, tools/browser-voice-probe.mjs): WASM
   * runs the 8-bit model (92 MB; log-mel distance to fp32 1.2-1.3 dB, the same speech). WebGPU runs fp32 (326 MB):
   * fp16 and q4f16 compiled there but output all zeros, and q8 there garbled (6.3-6.8 dB) at 5-8 s a line.
   */
  dtype: { webgpu: 'fp32', wasm: 'q8' } as Record<Exclude<BrowserVoiceTier, 'off'>, BrowserVoiceDtype>,
  /** Below these the 3D world already uses most of the device; the device voice stays (navigator.deviceMemory is capped at 8). */
  minMemoryGb: 4,
  minCores: 4,
  /**
   * A first line slower than this many times its own length (synthesis ms / audio ms) marks the device too slow:
   * a 3 s sentence would keep the child waiting more than 3 s after the server already failed.
   */
  maxRealTimeFactor: 1,
  /** How long a failed line may wait for the browser voice (load from cache + synthesis) before the device voice reads it. */
  lineWaitMs: 8000,
  /** A slow-device verdict is tried again after a week (browsers and drivers update). */
  retestAfterMs: 7 * 24 * 3600 * 1000,
  /** Synthesised lines kept in memory (a 🔊 tap again plays at once). */
  cacheLines: 24,
  /** Idle preload starts this long after the page asked for it (the world's first frames come first). */
  idleDelayMs: 10_000,
  /** With the model already in Cache Storage loading is a disk read (2.9-10.6 s measured): start it sooner. */
  cachedIdleDelayMs: 2_000,
  storageKey: 'lcw.browserVoice.v1'
} as const;

/**
 * Which Kokoro speaker reads a line meant for a cast voice. Local Kokoro voices read as themselves (the model voice
 * is kokoro af_sarah, R2627); each Aura-2 speaker maps to a Kokoro speaker chosen on the same 8 cached lines (11-16:
 * DTW log-mel distance, long-term spectrum, median F0, pitch spread, pace; PR text), every one different from the
 * others and from the model voice so a child still tells the NPCs apart:
 * - luna (old model voice) -> af_sarah, the model sentences' own speaker
 * - hera (cafe owner Hannah, the highest and steadiest) -> af_heart (closest spectrum 4.18 dB, nearest high F0)
 * - athena (guide Luna) -> af_kore (closest of all 19 by DTW, 6.49)
 * - delia (neighbour Mia, cheerful) -> af_aoede (nearest F0 of the rest, -3 st, liveliest pitch 4.35 st)
 * - apollo (shop owner Toby) -> am_fenrir (spectrum 2.72 dB like am_michael, but -3.1 st instead of -7.7 and the same pace)
 */
export const BROWSER_SPEAKERS: Readonly<Record<string, string>> = {
  'aura2-luna': 'af_sarah',
  'aura2-hera': 'af_heart',
  'aura2-athena': 'af_kore',
  'aura2-delia': 'af_aoede',
  'aura2-apollo': 'am_fenrir'
};
export const BROWSER_DEFAULT_SPEAKER = 'af_sarah';

export function browserSpeakerFor(voice: VoiceRef | undefined): string {
  if (!voice) return BROWSER_DEFAULT_SPEAKER;
  if (voice.engine === 'kokoro') return voice.speaker;
  return BROWSER_SPEAKERS[`${voice.engine}-${voice.speaker}`] ?? BROWSER_DEFAULT_SPEAKER;
}

/** What the browser offers (read once from navigator; injected in tests). */
export interface DeviceFacts {
  worker: boolean;
  wasm: boolean;
  webgpu: boolean;
  /** navigator.deviceMemory (Chromium only; undefined on Safari and Firefox). */
  memoryGb?: number;
  cores?: number;
  /**
   * A phone or tablet (coarse pointer): device voice. Measured 11-16 on a Galaxy S7 (Chrome 138, 4 GB, 8 cores, WASM
   * single thread): 50 s to load, 71-90 s for a 2.5-3.5 s line (24-29x real time), renderer 407 MB — and the 326 MB
   * WebGPU weights are no download for a phone. A phone several times faster would still be well past real time.
   */
  mobile?: boolean;
}

/** Stored per browser after a measured first line. */
export interface BrowserVoiceVerdict {
  tier: BrowserVoiceTier;
  /** The backend that loaded (WebGPU falls back to WASM inside the worker). */
  ran?: Exclude<BrowserVoiceTier, 'off'>;
  rtf?: number;
  reason?: string;
  atMs: number;
  /** The model is in Cache Storage (a later visit loads it from disk). */
  cached?: boolean;
  /** Slow warm-ups in a row: one busy moment (the world booting, another tab) does not switch a PC off for a week. */
  slowRuns?: number;
}

/** Slow warm-ups in a row before the device is remembered as too slow. */
export const SLOW_RUNS_TO_REMEMBER = 2;

/** Pure policy: which backend to try, or off with the reason. */
export function chooseTier(f: DeviceFacts, verdict: BrowserVoiceVerdict | null, nowMs: number): { tier: BrowserVoiceTier; reason: string } {
  if (!f.worker || !f.wasm) return { tier: 'off', reason: 'no_worker_or_wasm' };
  if (f.memoryGb !== undefined && f.memoryGb < BROWSER_VOICE.minMemoryGb) return { tier: 'off', reason: 'memory' };
  if (f.cores !== undefined && f.cores < BROWSER_VOICE.minCores) return { tier: 'off', reason: 'cores' };
  if (f.mobile) return { tier: 'off', reason: 'mobile' };
  if (verdict && verdict.tier === 'off' && nowMs - verdict.atMs < BROWSER_VOICE.retestAfterMs) return { tier: 'off', reason: verdict.reason ?? 'verdict' };
  if (verdict?.ran === 'wasm' && verdict.tier !== 'off' && nowMs - verdict.atMs < BROWSER_VOICE.retestAfterMs) return { tier: 'wasm', reason: 'verdict' };
  return f.webgpu ? { tier: 'webgpu', reason: 'webgpu' } : { tier: 'wasm', reason: 'wasm' };
}

/** After the first line: keep the engine, or mark the device too slow. */
export function judgeFirstLine(synthMs: number, audioMs: number): { ok: boolean; rtf: number } {
  const rtf = audioMs > 0 ? synthMs / audioMs : Infinity;
  return { ok: rtf <= BROWSER_VOICE.maxRealTimeFactor, rtf: Math.round(rtf * 1000) / 1000 };
}

export { audible } from './browser-voice-check.js';

// ---- worker protocol ----

export type BrowserVoiceRequest =
  | { type: 'load'; tier: Exclude<BrowserVoiceTier, 'off'>; dtype: Readonly<Record<Exclude<BrowserVoiceTier, 'off'>, BrowserVoiceDtype>>; modelId: string; libUrl: string; libSha256: string }
  /** `background`: a prefetch; a line the child is waiting for goes ahead of it in the worker. */
  | { type: 'speak'; id: number; text: string; speaker: string; speed: number; background?: boolean };

export type BrowserVoiceReply =
  | { type: 'progress'; loaded: number; total: number }
  | { type: 'ready'; ran: Exclude<BrowserVoiceTier, 'off'>; loadMs: number; fetchedBytes: number; warmMs: number; warmAudioMs: number }
  | { type: 'audio'; id: number; samples: Float32Array; sampleRate: number; ms: number }
  | { type: 'error'; id?: number; message: string };

/** The part of a Worker the engine uses (a fake in tests). */
export interface VoiceWorkerLike {
  postMessage(msg: BrowserVoiceRequest): void;
  onmessage: ((ev: { data: BrowserVoiceReply }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  terminate(): void;
}

export interface BrowserVoiceLine {
  samples: Float32Array;
  sampleRate: number;
}

export type BrowserVoiceState = 'idle' | 'loading' | 'ready' | 'off';

export interface BrowserVoiceStats {
  state: BrowserVoiceState;
  tier: BrowserVoiceTier;
  reason: string;
  ran?: Exclude<BrowserVoiceTier, 'off'>;
  loadMs?: number;
  fetchedBytes?: number;
  /** The judged warm-up line (synthesis ms, its real-time factor). */
  warmMs?: number;
  warmRtf?: number;
  firstLineMs?: number;
  rtf?: number;
  lines: number;
}

export interface BrowserVoiceDeps {
  facts: () => DeviceFacts;
  makeWorker: () => VoiceWorkerLike;
  storage: { get(): BrowserVoiceVerdict | null; set(v: BrowserVoiceVerdict): void };
  nowMs: () => number;
  /** Weights override (measurements: `?bdtype=`). */
  dtype?: Readonly<Record<Exclude<BrowserVoiceTier, 'off'>, BrowserVoiceDtype>>;
  /** Judge the first line's speed (off for forced measurements: a busy probe machine must not switch it off). */
  judge?: boolean;
}

export interface BrowserVoiceEngine {
  /** Whether this device may use the browser voice at all (cheap, no loading). */
  available(): boolean;
  state(): BrowserVoiceState;
  /** Starts loading (once); resolves true when ready, false when off or failed. */
  load(): Promise<boolean>;
  /** Synthesises a line (loads first if needed); null when off, failed or slower than `waitMs`. */
  speak(text: string, voice: VoiceRef | undefined, speed?: number, waitMs?: number, opts?: { background?: boolean }): Promise<BrowserVoiceLine | null>;
  /** The model is already in this browser's Cache Storage (a load is a disk read, seconds rather than a download). */
  modelCached(): boolean;
  /** Already synthesised (memory cache) — no work. */
  cached(text: string, voice: VoiceRef | undefined, speed?: number): BrowserVoiceLine | null;
  stats(): BrowserVoiceStats;
}

const lineKey = (text: string, speaker: string, speed: number) => `${speaker}|${speed.toFixed(2)}|${text.trim()}`;

export function createBrowserVoice(deps: BrowserVoiceDeps): BrowserVoiceEngine {
  let worker: VoiceWorkerLike | null = null;
  let st: BrowserVoiceState = 'idle';
  let loadP: Promise<boolean> | null = null;
  let nextId = 1;
  const pending = new Map<number, { resolve: (l: BrowserVoiceLine | null) => void; t0: number }>();
  const lines = new Map<string, Promise<BrowserVoiceLine | null>>();
  const done = new Map<string, BrowserVoiceLine>();
  const choice = (() => {
    let c: { tier: BrowserVoiceTier; reason: string } | null = null;
    return () => (c ??= chooseTier(deps.facts(), deps.storage.get(), deps.nowMs()));
  })();
  const stats: BrowserVoiceStats = { state: 'idle', tier: 'off', reason: '', lines: 0 };

  /** `remember`: store the verdict (a measured slow device); a failed download or worker is off for this page only. */
  function off(reason: string, extra: Partial<BrowserVoiceVerdict> = {}, remember = false): void {
    st = 'off';
    stats.reason = reason;
    for (const [, p] of pending) p.resolve(null);
    pending.clear();
    try {
      worker?.terminate();
    } catch {
      /* ignore */
    }
    worker = null;
    if (remember) deps.storage.set({ tier: 'off', reason, atMs: deps.nowMs(), ...extra });
  }

  function load(): Promise<boolean> {
    if (loadP) return loadP;
    const c = choice();
    stats.tier = c.tier;
    stats.reason = c.reason;
    if (c.tier === 'off') {
      st = 'off';
      return (loadP = Promise.resolve(false));
    }
    const tier = c.tier;
    st = 'loading';
    loadP = new Promise<boolean>((resolve) => {
      try {
        worker = deps.makeWorker();
      } catch {
        st = 'off';
        stats.reason = 'worker_failed';
        resolve(false);
        return;
      }
      const w = worker;
      w.onmessage = (ev) => {
        const m = ev.data;
        if (m.type === 'ready') {
          // The worker's warm-up line is the speed test: a backend slower than real time is off before any real
          // line burns the device's CPU next to the 3D world.
          const warm = judgeFirstLine(m.warmMs, m.warmAudioMs);
          stats.ran = m.ran;
          stats.loadMs = m.loadMs;
          stats.fetchedBytes = m.fetchedBytes;
          stats.warmMs = m.warmMs;
          stats.warmRtf = warm.rtf;
          const prev = deps.storage.get();
          if (deps.judge !== false && !warm.ok) {
            // Off for this page; remembered only after SLOW_RUNS_TO_REMEMBER slow warm-ups in a row.
            const slowRuns = (prev?.slowRuns ?? 0) + 1;
            if (slowRuns >= SLOW_RUNS_TO_REMEMBER) off('slow', { rtf: warm.rtf, ran: m.ran, slowRuns, cached: true }, true);
            else {
              off('slow');
              deps.storage.set({ ...(prev?.tier === 'off' ? {} : prev), tier: m.ran, ran: m.ran, atMs: deps.nowMs(), cached: true, slowRuns, rtf: warm.rtf });
            }
            resolve(false);
            return;
          }
          st = 'ready';
          deps.storage.set({ tier: m.ran, ran: m.ran, rtf: warm.rtf, atMs: deps.nowMs(), cached: true, slowRuns: 0 });
          resolve(true);
        } else if (m.type === 'audio') {
          const p = pending.get(m.id);
          pending.delete(m.id);
          if (!p) return;
          if (stats.firstLineMs === undefined) {
            // Recorded for measurement; the speed verdict comes from the warm-up line (no compile cost, no contention).
            stats.firstLineMs = m.ms;
            stats.rtf = judgeFirstLine(m.ms, (m.samples.length / m.sampleRate) * 1000).rtf;
          }
          stats.lines += 1;
          p.resolve({ samples: m.samples, sampleRate: m.sampleRate });
        } else if (m.type === 'error') {
          if (m.id !== undefined) {
            pending.get(m.id)?.resolve(null);
            pending.delete(m.id);
          } else {
            off('load_failed');
            resolve(false);
          }
        }
      };
      w.onerror = () => {
        off('worker_error');
        resolve(false);
      };
      w.postMessage({ type: 'load', tier, dtype: deps.dtype ?? BROWSER_VOICE.dtype, modelId: BROWSER_VOICE.modelId, libUrl: BROWSER_VOICE.libUrl, libSha256: BROWSER_VOICE.libSha256 });
    });
    stats.state = st;
    return loadP;
  }

  function synth(text: string, speaker: string, speed: number, background: boolean): Promise<BrowserVoiceLine | null> {
    return load().then((ok) => {
      if (!ok || !worker || st !== 'ready') return null;
      const id = nextId++;
      return new Promise<BrowserVoiceLine | null>((resolve) => {
        pending.set(id, { resolve, t0: deps.nowMs() });
        worker!.postMessage({ type: 'speak', id, text, speaker, speed, ...(background ? { background } : {}) });
      });
    });
  }

  return {
    available: () => st !== 'off' && choice().tier !== 'off',
    state: () => st,
    load,
    cached(text, voice, speed = 1) {
      return done.get(lineKey(text, browserSpeakerFor(voice), speed)) ?? null;
    },
    modelCached: () => deps.storage.get()?.cached === true,
    speak(text, voice, speed = 1, waitMs = BROWSER_VOICE.lineWaitMs, opts = {}) {
      if (!text.trim() || st === 'off' || choice().tier === 'off') return Promise.resolve(null);
      const speaker = browserSpeakerFor(voice);
      const key = lineKey(text, speaker, speed);
      const have = done.get(key);
      if (have) return Promise.resolve(have);
      let p = lines.get(key);
      if (!p) {
        p = synth(text, speaker, speed, opts.background === true).then((l) => {
          if (l) {
            done.set(key, l);
            while (done.size > BROWSER_VOICE.cacheLines) done.delete(done.keys().next().value!);
          }
          lines.delete(key);
          return l;
        });
        lines.set(key, p);
      }
      // The line keeps being made past the wait (the next tap plays it from memory); this caller stops waiting.
      return new Promise((resolve) => {
        const t = setTimeout(() => resolve(null), waitMs);
        void p!.then((l) => {
          clearTimeout(t);
          resolve(l);
        });
      });
    },
    stats: () => ({ ...stats, state: st })
  };
}

// ---- the page's one engine ----

function readFacts(): DeviceFacts {
  const nav = (typeof navigator !== 'undefined' ? navigator : {}) as Navigator & { deviceMemory?: number; gpu?: unknown };
  return {
    worker: typeof Worker !== 'undefined',
    wasm: typeof WebAssembly !== 'undefined',
    webgpu: Boolean(nav.gpu),
    memoryGb: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : undefined,
    cores: typeof nav.hardwareConcurrency === 'number' && nav.hardwareConcurrency > 0 ? nav.hardwareConcurrency : undefined,
    mobile: typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
  };
}

const verdictStore = {
  get(): BrowserVoiceVerdict | null {
    try {
      const raw = localStorage.getItem(BROWSER_VOICE.storageKey);
      return raw ? (JSON.parse(raw) as BrowserVoiceVerdict) : null;
    } catch {
      return null;
    }
  },
  set(v: BrowserVoiceVerdict): void {
    try {
      localStorage.setItem(BROWSER_VOICE.storageKey, JSON.stringify(v));
    } catch {
      /* private mode: the verdict is only kept for this page */
    }
  }
};

/** `?voice=device` keeps the device voice; `?bvoice=off|wasm|webgpu` forces a backend, `?bdtype=` its weights (checks, measurements). */
function forcedDtype(): BrowserVoiceDtype | null {
  try {
    const d = new URLSearchParams(location.search).get('bdtype');
    return d === 'fp32' || d === 'fp16' || d === 'q8' || d === 'q4' || d === 'q4f16' ? d : null;
  } catch {
    return null;
  }
}

function forcedTier(): BrowserVoiceTier | null {
  try {
    const q = new URLSearchParams(location.search);
    if (q.get('voice') === 'device') return 'off';
    const b = q.get('bvoice');
    return b === 'off' || b === 'wasm' || b === 'webgpu' ? b : null;
  } catch {
    return null;
  }
}

/**
 * Automated browsers (headless checks set navigator.webdriver) never load the 90-300 MB model unless a check asks for
 * it with `?bvoice=`: the nightly audit and perf probes must not download it on every run or measure it as the world.
 */
function automated(): boolean {
  try {
    return typeof navigator !== 'undefined' && navigator.webdriver === true;
  } catch {
    return false;
  }
}

let engine: BrowserVoiceEngine | null = null;

/** The page's browser voice (one worker per page). */
export function browserVoice(): BrowserVoiceEngine {
  if (engine) return engine;
  const forced = forcedTier();
  engine = createBrowserVoice({
    facts: () => {
      const f = readFacts();
      if (forced === 'off' || (!forced && automated())) return { ...f, worker: false };
      if (forced === 'wasm') return { ...f, webgpu: false, memoryGb: undefined, cores: undefined };
      if (forced === 'webgpu') return { ...f, memoryGb: undefined, cores: undefined };
      return f;
    },
    makeWorker: () => new Worker(new URL('./browser-voice.worker.ts', import.meta.url), { type: 'module' }) as unknown as VoiceWorkerLike,
    storage: forced ? { get: () => null, set: () => undefined } : verdictStore,
    judge: !forced,
    ...(forcedDtype() ? { dtype: { webgpu: forcedDtype()!, wasm: forcedDtype()! } } : {}),
    nowMs: () => Date.now()
  });
  if (typeof window !== 'undefined') (window as unknown as { __lcwBrowserVoice?: BrowserVoiceEngine }).__lcwBrowserVoice = engine;
  return engine;
}

/**
 * Idle preload: a browser that already has the model (a verdict says cached) loads it after the page settles (a disk
 * read). `eager` (the server voice is off on this page): load now, download included unless the line is metered.
 * Otherwise the first download starts only when a line actually needs it (sound.ts), so a classroom whose server
 * voice works never pulls 30 x 326 MB through the school network.
 */
export function preloadBrowserVoiceWhenIdle(opts: { eager?: boolean } = {}): void {
  if (typeof window === 'undefined') return;
  const e = browserVoice();
  if (!e.available() || e.state() !== 'idle') return;
  const v = verdictStore.get();
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean; type?: string; effectiveType?: string } }).connection;
  // A metered or slow line never downloads the model ahead (a failed line still loads it when it is needed).
  const metered = Boolean(conn?.saveData) || conn?.type === 'cellular' || /(^|-)2g|3g/.test(conn?.effectiveType ?? '');
  if (!v?.cached && (metered || coarse || !opts.eager)) return;
  const start = () => void e.load();
  setTimeout(() => {
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    if (ric) ric(start, { timeout: 5000 });
    else start();
  }, opts.eager ? 0 : v?.cached ? BROWSER_VOICE.cachedIdleDelayMs : BROWSER_VOICE.idleDelayMs);
}
