import { browserVoice, encodeWavBytes } from '@lcw/audio';

/**
 * Dev-only measurement page for the browser voice (vite dev: /world/voice-probe.html, tools/browser-voice-probe.mjs).
 * Not part of the build. Query: bvoice=wasm|webgpu, bdtype=fp32|fp16|q8|q4|q4f16, speakers=af_heart,am_michael (kokoro ids), wav=1 (returns each
 * line as base64 WAV for pitch comparison), text=<one line> (repeatable).
 * Result: window.__probe = { stats, lines: [{ speaker, text, ms, audioMs }], wavs? }.
 */

const q = new URLSearchParams(location.search);
const speakers = (q.get('speakers') ?? 'af_heart').split(',').filter(Boolean);
const texts = q.getAll('text').length
  ? q.getAll('text')
  : ['Welcome back! What can I get you this time?', 'Hi again! Where do you want to go this time?', 'I would like a glass of milk, please.', 'Can I have the red one?'];
const wantWav = q.get('wav') === '1';
const out = document.getElementById('out')!;

function b64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function run(): Promise<void> {
  const e = browserVoice();
  const t0 = performance.now();
  const ok = await e.load();
  const loadWallMs = Math.round(performance.now() - t0);
  const lines: Array<{ speaker: string; text: string; ms: number; audioMs: number }> = [];
  const wavs: Record<string, string> = {};
  if (ok) {
    for (const sp of speakers) {
      for (const text of texts) {
        const s0 = performance.now();
        const l = await e.speak(text, { engine: 'kokoro', speaker: sp }, 1, 120_000);
        const ms = Math.round(performance.now() - s0);
        lines.push({ speaker: sp, text, ms, audioMs: l ? Math.round((l.samples.length / l.sampleRate) * 1000) : -1 });
        if (l && wantWav) wavs[`${sp}|${text}`] = b64(encodeWavBytes(l.samples, l.sampleRate));
      }
    }
  }
  const res = { ok, loadWallMs, stats: e.stats(), lines, wavs: wantWav ? wavs : undefined, crossOriginIsolated: self.crossOriginIsolated, done: true };
  (window as unknown as { __probe: unknown }).__probe = res;
  out.textContent = JSON.stringify({ ...res, wavs: undefined }, null, 1);
}

void run().catch((err) => {
  (window as unknown as { __probe: unknown }).__probe = { done: true, error: String(err) };
  out.textContent = String(err);
});
