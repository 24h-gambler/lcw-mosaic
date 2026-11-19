import { describe, expect, it } from 'vitest';
import { QuotaMeter, NEURAL_TTS, ttsNeurons } from '@lcw/quota';
import { FIRST_ERRAND, LESSON_PLANS, NPC_OPENING_LINES, castVoices, chunkPhrases, fixedTtsLines, getLessonNpc, isLocalTtsEngine, localTtsLines, npcCast, ttsVoiceId, voiceForCtx } from '@lcw/content';
import { TTS_CRON, TTS_UPLOAD, handleTts, handleTtsUpload, localLinesList, parseTryVoice, prebuildFixedLines, runTtsCron, ttsCacheKey, ttsStatus, type TtsCaller, type TtsDeps } from '../tts.js';

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
    // the local voice's lines are uploaded by the operator, never prebuilt on the day's neurons
    const all = fixedTtsLines().filter((l) => !isLocalTtsEngine(l.voice.engine));
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

  it('a cached line plays in the neural voice at every stage, even with the day used up (11-16 "기계음")', async () => {
    const r = rig({ limit: 1000 });
    const line = NPC_OPENING_LINES.cafe!;
    const hera = ttsVoiceId(voiceForCtx('cafe'));
    expect((await handleTts(url(hera, line), guest, r.deps)).status).toBe(200); // made at stage 0
    r.meter.consumeNeurons('x', r.meter.getStatus(0).neuronsLimit - r.meter.getStatus(0).neuronsUsed, 'llm'); // 100%
    expect(r.meter.getStatus(r.deps.nowMs()).stage).toBe(3);
    for (const who of [guest, child, { ...child, lesson: true }]) {
      const res = await handleTts(url(hera, line), who, r.deps);
      expect(res.status).toBe(200);
      expect(res.headers.get('x-lcw-tts')).toBe('hit');
    }
    expect(r.calls).toHaveLength(1);
  });

  it('smoke/demo students and `c=1` (headless checks) get cached lines only and never spend neurons', async () => {
    const r = rig();
    const hera = ttsVoiceId(voiceForCtx('cafe'));
    const made = NPC_OPENING_LINES.cafe!;
    await handleTts(url(hera, made), guest, r.deps);
    const fresh = NPC_OPENING_LINES.guide!;
    const athena = ttsVoiceId(voiceForCtx('guide'));
    const smoke: TtsCaller = { operator: false, player_id: 'smoke-kid', lesson: true, cachedOnly: true };
    const miss = await handleTts(url(athena, fresh), smoke, r.deps);
    expect(miss.status).toBe(404);
    expect(await miss.json()).toMatchObject({ error: 'tts_not_cached', fallback: 'device' });
    const c1 = new URL(url(athena, fresh));
    c1.searchParams.set('c', '1');
    expect((await handleTts(c1, guest, r.deps)).status).toBe(404);
    expect((await handleTts(url(hera, made), smoke, r.deps)).headers.get('x-lcw-tts')).toBe('hit');
    expect(r.calls).toHaveLength(1);
    expect(r.meter.getStatus(r.deps.nowMs()).neuronsUsed).toBe(ttsNeurons('aura2', made.length));
  });

  it('the lesson plans are fixed lines: scripts and follow-ups in the stage NPC voice, targets in the model voice', () => {
    const priority = fixedTtsLines('en', { priorityOnly: true });
    const all = fixedTtsLines();
    expect(priority.length).toBeLessThan(all.length);
    for (const plan of LESSON_PLANS) {
      for (const st of plan.stages) {
        const v = voiceForCtx(getLessonNpc(st.npcId)?.ctx ?? 'guide');
        for (const t of [st.teacherScriptEn, ...(st.followUpsEn ?? [])]) {
          expect(priority.some((l) => l.text === t.replace(/\s+/g, ' ').trim() && ttsVoiceId(l.voice) === ttsVoiceId(v))).toBe(true);
        }
        for (const tg of st.targets) expect(priority.some((l) => l.text === tg.text.replace(/\s+/g, ' ').trim() && l.voice === npcCast().modelVoice)).toBe(true);
      }
    }
  });

  it('the hourly cron prebuilds the lesson and NPC lines at 00 UTC and the bank on the leftovers at 23 UTC', async () => {
    const at = (h: number) => Date.parse(`2026-11-16T${String(h).padStart(2, '0')}:00:00Z`);
    const off = rig({ enabled: false });
    expect(await runTtsCron(off.deps, at(0))).toBeNull();
    const r = rig({ limit: 1_000_000 });
    expect(await runTtsCron(r.deps, at(5))).toBeNull();
    const morning = await runTtsCron(r.deps, at(TTS_CRON.morningHourUtc));
    expect(morning).toMatchObject({ task: 'tts_morning' });
    expect(morning!.neurons!).toBeLessThanOrEqual(TTS_CRON.morningBudgetNeurons);
    const priority = fixedTtsLines('en', { priorityOnly: true }).map((l) => l.text);
    for (const c of r.calls) expect(priority).toContain(String(c.input.text));
    // night: what is left minus the reserve, nothing when the day is spent
    const n = rig({ limit: 10_000 });
    n.meter.consumeNeurons('x', 6_000, 'llm');
    const night = await runTtsCron(n.deps, at(TTS_CRON.nightHourUtc));
    expect(night).toMatchObject({ task: 'tts_night' });
    expect(night!.neurons!).toBeGreaterThan(0);
    expect(night!.neurons!).toBeLessThanOrEqual(10_000 - 6_000 - TTS_CRON.nightReserveNeurons);
    const spent = rig({ limit: 10_000 });
    spent.meter.consumeNeurons('x', 9_500, 'llm');
    expect(await runTtsCron(spent.deps, at(TTS_CRON.nightHourUtc))).toEqual({ task: 'tts_night', made: 0, neurons: 0 });
  }, 30_000);
});

describe('local open-weights model voice (R2625: the bank in a natural voice for 0 neurons)', () => {
  const op: TtsCaller = { operator: true, player_id: null, lesson: false };
  const model = npcCast().modelVoice;
  const modelId = ttsVoiceId(model);
  const standInId = ttsVoiceId(model.standIn!);
  const bankLine = localTtsLines().find((l) => l.text.length > 40)!.text;
  const mp3 = (n = 4096) => {
    const b = new Uint8Array(n).fill(0x55);
    b.set([0x49, 0x44, 0x33, 0x04]); // ID3v2.4 tag
    return b;
  };
  const put = (v: string, t: string) => new URL(`https://x/v1/admin/tts/line?v=${encodeURIComponent(v)}&t=${encodeURIComponent(t)}`);

  it('the model voice is a local engine with a Workers AI stand-in, and both are cast voices', () => {
    expect(isLocalTtsEngine(model.engine)).toBe(true);
    expect(model.standIn && isLocalTtsEngine(model.standIn.engine)).toBe(false);
    expect(castVoices().map(ttsVoiceId)).toEqual(expect.arrayContaining([modelId, standInId]));
    // every offer sentence, lesson target and echo piece of the model voice is a local line, and so is every
    // /adventure/ islander line (their own Kokoro voices, npc-cast islanders); no world NPC line is
    const local = localTtsLines();
    const islanders = new Set(Object.values(npcCast().islanders).map(ttsVoiceId));
    expect(local.every((l) => l.voice === model || islanders.has(ttsVoiceId(l.voice)))).toBe(true);
    expect(fixedTtsLines().filter((l) => l.voice === model || islanders.has(ttsVoiceId(l.voice)))).toHaveLength(local.length);
    for (const piece of chunkPhrases(bankLine)) expect(local.some((l) => l.text === piece)).toBe(true);
    for (const plan of LESSON_PLANS) for (const st of plan.stages) for (const tg of st.targets) expect(local.some((l) => l.text === tg.text)).toBe(true);
    expect(localLinesList().lines).toHaveLength(local.length);
  });

  it('an uploaded line is served like any cached line: same key the client asks, long cache, no neurons, no AI call', async () => {
    const { deps, calls, store, meter } = rig({ limit: 1000 });
    const up = await handleTtsUpload(put(modelId, `  ${bankLine} `), mp3(), deps);
    expect(up.status).toBe(200);
    const key = await ttsCacheKey(model, bankLine, sha256Hex);
    expect(key.startsWith(`tts/v1/${modelId}/`)).toBe(true); // the engine that spoke is in the key
    expect(await up.json()).toMatchObject({ ok: true, key, bytes: 4096 });
    expect(store.has(key)).toBe(true);
    meter.consumeNeurons('x', 1000, 'llm'); // the day used up: a cached line still plays
    for (const who of [guest, child, { ...guest, cachedOnly: true }]) {
      const r = await handleTts(url(modelId, bankLine), who, deps);
      expect(r.status).toBe(200);
      expect(r.headers.get('x-lcw-tts')).toBe('hit');
      expect(r.headers.get('x-lcw-tts-voice')).toBe(modelId);
      expect(r.headers.get('cache-control')).toContain('immutable');
      expect(new Uint8Array(await r.arrayBuffer())).toEqual(mp3());
    }
    expect(calls).toHaveLength(0);
    expect(meter.getStatus(deps.nowMs()).neuronsUsed).toBe(1000); // only the test's own spend
  });

  it('upload checks: local cast voice only, fixed line only, mp3 within the size limit', async () => {
    const { deps, store } = rig();
    expect((await handleTtsUpload(put('kokoro-af_river', bankLine), mp3(), deps)).status).toBe(400); // not in the cast
    expect(await (await handleTtsUpload(put(standInId, bankLine), mp3(), deps)).json()).toMatchObject({ error: 'not_local_engine' });
    expect((await handleTtsUpload(put(ttsVoiceId(voiceForCtx('cafe')), NPC_OPENING_LINES.cafe!), mp3(), deps)).status).toBe(400);
    const odd = await handleTtsUpload(put(modelId, 'Give me all your coins right now.'), mp3(), deps);
    expect(odd.status).toBe(422);
    expect(await odd.json()).toMatchObject({ error: 'not_fixed_line' });
    // an NPC's line in the model voice is not one of the model voice's lines either
    expect((await handleTtsUpload(put(modelId, NPC_OPENING_LINES.cafe!), mp3(), deps)).status).toBe(422);
    expect((await handleTtsUpload(put(modelId, bankLine), mp3(TTS_UPLOAD.maxBytes + 1), deps)).status).toBe(413);
    expect((await handleTtsUpload(put(modelId, bankLine), new Uint8Array(4096).fill(0x55), deps)).status).toBe(415); // not mp3
    expect((await handleTtsUpload(put(modelId, bankLine), mp3(100), deps)).status).toBe(415); // too small to be a line
    const frame = new Uint8Array(4096).fill(0);
    frame.set([0xff, 0xf3]); // MPEG-2 layer III frame sync, no tag
    expect((await handleTtsUpload(put(modelId, bankLine), frame, deps)).status).toBe(200);
    expect([...store.keys()].every((k) => k.startsWith(`tts/v1/${modelId}/`))).toBe(true);
  });

  it('a local line not uploaded yet is read by the stand-in under its own key, with a short cache; the upload wins', async () => {
    const { deps, calls, store } = rig();
    const r1 = await handleTts(url(modelId, bankLine), guest, deps); // a fixed line: anyone, through the meter
    expect(r1.status).toBe(200);
    expect(r1.headers.get('x-lcw-tts-voice')).toBe(standInId);
    expect(r1.headers.get('cache-control')).toBe('public, max-age=600');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ model: NEURAL_TTS.models.aura2, input: { speaker: model.standIn!.speaker } });
    expect(store.has(await ttsCacheKey(model.standIn!, bankLine, sha256Hex))).toBe(true);
    expect(store.has(await ttsCacheKey(model, bankLine, sha256Hex))).toBe(false); // never filed under the local engine
    const again = await handleTts(url(modelId, bankLine), { ...guest, cachedOnly: true }, deps);
    expect(again.headers.get('x-lcw-tts')).toBe('hit');
    expect(again.headers.get('x-lcw-tts-voice')).toBe(standInId);
    await handleTtsUpload(put(modelId, bankLine), mp3(), deps);
    const after = await handleTts(url(modelId, bankLine), guest, deps);
    expect(after.headers.get('x-lcw-tts-voice')).toBe(modelId);
    expect(calls).toHaveLength(1);
    // other text in the model voice still needs a child's token; checks (c=1) never make one
    expect((await handleTts(url(modelId, 'Something no bank has, like purple llamas.'), guest, deps)).status).toBe(401);
    const nb = 'Water, please.';
    expect((await handleTts(new URL(`${url(modelId, nb).href}&c=1`), guest, deps)).status).toBe(404);
    expect(calls).toHaveLength(1);
  });

  it('checks of a local line (c=1, smoke students) never make a new line, not even through the stand-in', async () => {
    const { deps, calls, meter } = rig();
    const smoke: TtsCaller = { operator: false, player_id: 'smoke-kid', lesson: true, cachedOnly: true };
    const c1 = new URL(`${url(modelId, bankLine).href}&c=1`);
    for (const [u, who] of [[c1, guest], [c1, child], [url(modelId, bankLine), smoke]] as const) {
      const r = await handleTts(u, who, deps);
      expect(r.status).toBe(404);
      expect(await r.json()).toMatchObject({ error: 'tts_not_cached', fallback: 'device' });
    }
    expect(calls).toHaveLength(0);
    expect(meter.getStatus(deps.nowMs()).neuronsUsed).toBe(0);
    // once the stand-in has it (a child's tap), checks hear it from cache, still for 0 neurons, labeled as the stand-in
    expect((await handleTts(url(modelId, bankLine), child, deps)).status).toBe(200);
    const used = meter.getStatus(deps.nowMs()).neuronsUsed;
    for (const [u, who] of [[c1, guest], [url(modelId, bankLine), smoke]] as const) {
      const r = await handleTts(u, who, deps);
      expect(r.headers.get('x-lcw-tts')).toBe('hit');
      expect(r.headers.get('x-lcw-tts-voice')).toBe(standInId);
    }
    expect(calls).toHaveLength(1);
    expect(meter.getStatus(deps.nowMs()).neuronsUsed).toBe(used);
  });

  it('prebuild and the cron never spend neurons on local lines', async () => {
    const { deps, calls } = rig({ limit: 10_000_000 });
    const r = await prebuildFixedLines(deps, { budgetNeurons: 10_000_000 });
    expect(r.lines).toBe(fixedTtsLines().length - localTtsLines().length);
    expect(calls.every((c) => c.input.speaker !== model.speaker && c.input.speaker !== model.standIn!.speaker)).toBe(true);
    expect(await prebuildFixedLines(deps, { voice: modelId })).toMatchObject({ lines: 0, made: 0 });
  }, 30_000);
});
