import { describe, expect, it } from 'vitest';
import { QuotaMeter, NEURAL_TTS, ttsNeurons } from '@lcw/quota';
import { FIRST_ERRAND, castVoices, fixedTtsLines, npcCast, ttsVoiceId, voiceForCtx } from '@lcw/content';
import { handleTts, parseTryVoice, prebuildFixedLines, ttsCacheKey, ttsStatus, type TtsCaller, type TtsDeps } from '../tts.js';

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

function rig(opts: { enabled?: boolean; limit?: number } = {}) {
  const calls: Array<{ model: string; input: Record<string, unknown> }> = [];
  const store = new Map<string, Uint8Array>();
  const meter = new QuotaMeter('2026-11-16', opts.limit ?? 10_000);
  const deps: TtsDeps = {
    enabled: opts.enabled ?? true,
    quota: () => meter,
    ai: {
      async run(model, input) {
        calls.push({ model, input: input as Record<string, unknown> });
        // Aura answers a stream, MeloTTS base64 in JSON (Workers AI shapes)
        const bytes = new Uint8Array(400).fill(7);
        if (model.includes('melotts')) return { audio: btoa(String.fromCharCode(...bytes)) };
        return new Response(bytes).body;
      }
    },
    store: {
      async get(k) {
        const v = store.get(k);
        return v ? { arrayBuffer: async () => v.slice().buffer } : null;
      },
      async put(k, v) {
        store.set(k, v);
      }
    },
    nowMs: () => Date.parse('2026-11-16T03:00:00Z'),
    sha256Hex
  };
  return { deps, calls, store, meter };
}

const guest: TtsCaller = { operator: false, player_id: null, lesson: false };
const child: TtsCaller = { operator: false, player_id: 'kid-1', lesson: false };
const url = (v: string, t: string) => new URL(`https://x/v1/tts?v=${encodeURIComponent(v)}&t=${encodeURIComponent(t)}`);
const mia = ttsVoiceId(voiceForCtx('errand'));

describe('neural NPC voice (tts.ts)', () => {
  it('is off for players unless TTS_NEURAL=on, and says so in the status', async () => {
    const { deps } = rig({ enabled: false });
    const r = await handleTts(url(mia, FIRST_ERRAND.lines.ask), guest, deps);
    expect(r.status).toBe(404);
    expect(await r.json()).toMatchObject({ error: 'tts_off', fallback: 'device' });
    expect(await ttsStatus(deps).json()).toMatchObject({ enabled: false });
    expect(await ttsStatus(rig().deps).json()).toMatchObject({ enabled: true, voices: castVoices().map(ttsVoiceId) });
  });

  it('a fixed line is made once for anyone, then served from R2 with a long cache', async () => {
    const { deps, calls, store, meter } = rig();
    const r1 = await handleTts(url(mia, FIRST_ERRAND.lines.ask), guest, deps);
    expect(r1.status).toBe(200);
    expect(r1.headers.get('content-type')).toBe('audio/mpeg');
    expect(r1.headers.get('x-lcw-tts')).toBe('miss');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ model: NEURAL_TTS.models.aura2, input: { speaker: 'delia', encoding: 'mp3' } });
    expect(meter.getStatus(deps.nowMs()).neuronsUsed).toBe(ttsNeurons('aura2', FIRST_ERRAND.lines.ask.length));
    const key = await ttsCacheKey(voiceForCtx('errand'), FIRST_ERRAND.lines.ask, sha256Hex);
    expect(key.startsWith('tts/v1/aura2-delia/')).toBe(true);
    expect(store.has(key)).toBe(true);
    const r2 = await handleTts(url(mia, `  ${FIRST_ERRAND.lines.ask}  `), guest, deps);
    expect(r2.headers.get('x-lcw-tts')).toBe('hit');
    expect(r2.headers.get('cache-control')).toContain('immutable');
    expect(calls).toHaveLength(1);
  });

  it('other text (a teacher possession line) needs a child token; unknown voices and long text are refused', async () => {
    const { deps, calls } = rig();
    const line = 'Great job today, everyone! Who wants to visit the bakery next?';
    expect((await handleTts(url(mia, line), guest, deps)).status).toBe(401);
    expect((await handleTts(url(mia, line), child, deps)).status).toBe(200);
    expect((await handleTts(url('aura-zeus', line), child, deps)).status).toBe(400);
    expect((await handleTts(url(mia, 'a'.repeat(NEURAL_TTS.maxChars + 1)), child, deps)).status).toBe(413);
    expect(calls).toHaveLength(1);
  });

  it('goes through the quota ladder: solo play stops at stage 2, lessons at 3, never past the limit', async () => {
    const line = 'Welcome back! What would you like today?';
    const two = rig({ limit: 1000 });
    two.meter.consumeNeurons('x', 860, 'llm'); // 86% -> stage 2
    expect((await handleTts(url(mia, line), child, two.deps)).status).toBe(429);
    expect((await handleTts(url(mia, line), { ...child, lesson: true }, two.deps)).status).toBe(200);
    const full = rig({ limit: 100 });
    expect((await handleTts(url(mia, 'x'.repeat(90)), { ...child, lesson: true }, full.deps)).status).toBe(429);
    expect(full.calls).toHaveLength(0);
  });

  it('MeloTTS answers base64 JSON; the operator may try any Aura speaker', async () => {
    expect(parseTryVoice('aura-orion')).toEqual({ engine: 'aura', speaker: 'orion' });
    expect(parseTryVoice('melo-en')).toEqual({ engine: 'melo', speaker: 'en' });
    expect(parseTryVoice('aura-nobody')).toBeNull();
    expect(parseTryVoice('aura2-thalia')).toEqual({ engine: 'aura2', speaker: 'thalia' });
    const { deps, calls } = rig();
    const op: TtsCaller = { operator: true, player_id: null, lesson: false };
    const r = await handleTts(url('aura2-luna', 'Can I have some cold water, please?'), op, deps);
    expect(r.status).toBe(200);
    expect(calls.at(-1)!.input).toMatchObject({ speaker: 'luna' });
  });

  it('prebuild makes the missing fixed lines within its neuron budget and skips cached ones next time', async () => {
    const { deps, calls } = rig({ limit: 1_000_000 });
    const all = fixedTtsLines();
    const first = await prebuildFixedLines(deps, { budgetNeurons: 1200 });
    expect(first.made).toBeGreaterThan(0);
    expect(first.neurons).toBeLessThanOrEqual(1200);
    expect(first.made + first.left + first.cached).toBe(all.length);
    const second = await prebuildFixedLines(deps, { budgetNeurons: 1200 });
    expect(second.cached).toBe(first.made);
    expect(calls.length).toBe(first.made + second.made);
    // the NPC lines come first: the first small budget already covers Mia's ask
    expect(all.findIndex((l) => l.text === FIRST_ERRAND.lines.ask)).toBeLessThan(first.made);
  }, 20_000);

  it('every NPC line is in its own NPC voice and every bank sentence in the model voice', () => {
    const lines = fixedTtsLines();
    const ask = lines.find((l) => l.text === FIRST_ERRAND.lines.ask)!;
    expect(ask.voice).toEqual(npcCast().npcs.errand_neighbor!.voice);
    const model = npcCast().modelVoice;
    expect(lines.filter((l) => l.voice === model).length).toBeGreaterThan(100);
  });
});
