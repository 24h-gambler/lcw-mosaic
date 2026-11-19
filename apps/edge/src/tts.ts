import { NEURAL_TTS, ttsNeurons, type QuotaMeter, type TtsEngine } from '@lcw/quota';
import { castVoices, fixedTtsLines, isLocalTtsEngine, localTtsLines, normalizeTtsText, npcCast, ttsVoiceId, type NpcVoice } from '@lcw/content';

/**
 * Neural NPC voice (docs/04 4.8, Dan 11-16 "목소리 자연스러움"): `GET /v1/tts?v=<engine-speaker>&t=<text>` answers
 * the line as audio (mp3) in that voice.
 *
 * - One sentence in one voice is made once: R2 `tts/v1/<voice>/<sha256(text)>.mp3` (VOICE bucket; the children's
 *   clip retention only ever deletes the keys it queued, never this prefix). A cached line is served to anyone with a
 *   year-long immutable cache header, so the second child hears it from the browser or the edge cache.
 * - A missing line is made only through the quota meter (AGENTS 4.8) by Workers AI (AGENTS 4.4): the fixed lines
 *   (NPC lines and bank sentences, `fixedTtsLines`) for anyone, since the set is finite; any other text (a teacher's
 *   possession line) only for a child's own lesson or device token. Voices outside the cast pack are refused.
 * - Off unless `TTS_NEURAL=on` (the operator can still try and prebuild): the client asks `GET /v1/tts/status` once
 *   and keeps the device voice while it is off, and whenever a line fails or takes too long.
 * - The text never names who asked; nothing about the child goes to the model (AGENTS 4.6).
 * - Local open-weights voices (npc-cast.ts LOCAL_TTS_ENGINES, R2625: the model voice reads ~1,400 fixed lines, a week
 *   of free neurons on Aura-2) are never made here: the operator's GPU makes them and uploads each fixed line
 *   (`handleTtsUpload`), stored under its own engine's key and served like any cached line. A local line not uploaded
 *   yet is read by the voice's Workers AI stand-in, stored under the stand-in's key and answered with a short cache and
 *   `x-lcw-tts-voice` naming who spoke, so the upload is heard as soon as it lands.
 */

export interface TtsAi {
  run(model: string, input: unknown): Promise<unknown>;
}
export interface TtsStore {
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  put(key: string, value: Uint8Array, opts?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
}

export interface TtsDeps {
  enabled: boolean;
  quota: () => QuotaMeter;
  ai?: TtsAi;
  store?: TtsStore;
  nowMs: () => number;
  sha256Hex: (s: string) => Promise<string>;
}

/** Who asks: an operator (try/prebuild, flag ignored), a child's own token, or nobody (fixed lines only). */
export interface TtsCaller {
  operator: boolean;
  player_id: string | null;
  lesson: boolean;
  /**
   * Cached lines only, never a new one (11-16 quota ladder: prebuild plus every lane's checks made so many new lines
   * that the day reached 86%). Set for smoke-check and demo students, and when the page asks with `c=1` (the client
   * does under automation: headless measurements). A missing line answers 404 and the device voice reads it.
   */
  cachedOnly?: boolean;
}

export const TTS_CACHE_PREFIX = 'tts/v1/';
const AUDIO_TYPE = 'audio/mpeg';

/**
 * Operator upload of a local engine's line: an mp3 of one fixed line. The longest fixed line (300 chars max) is about
 * 20 s, 160 kB at 64 kbps; anything bigger is not one line. Smaller than `minBytes` is not audio.
 */
export const TTS_UPLOAD = { maxBytes: 256 * 1024, minBytes: 512 } as const;

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

let fixedIndex: Set<string> | null = null;
function isFixedLine(voice: NpcVoice, text: string): boolean {
  if (!fixedIndex) fixedIndex = new Set(fixedTtsLines().map((l) => `${ttsVoiceId(l.voice)}|${l.text}`));
  return fixedIndex.has(`${ttsVoiceId(voice)}|${text}`);
}

export function parseVoice(id: string | null | undefined): NpcVoice | null {
  if (!id) return null;
  return castVoices().find((v) => ttsVoiceId(v) === id) ?? null;
}

/** Every Aura speaker Workers AI offers (operator try only: picking the cast's voices). */
export const AURA_SPEAKERS = ['angus', 'asteria', 'arcas', 'orion', 'orpheus', 'athena', 'luna', 'zeus', 'perseus', 'helios', 'hera', 'stella'] as const;

/** Aura-2 English speakers (Deepgram aura-2-en on Workers AI). */
export const AURA2_SPEAKERS = ['amalthea', 'andromeda', 'apollo', 'arcas', 'aries', 'asteria', 'athena', 'atlas', 'aurora', 'callista', 'cora', 'cordelia', 'delia', 'draco', 'electra', 'harmonia', 'helena', 'hera', 'hermes', 'hyperion', 'iris', 'janus', 'juno', 'jupiter', 'luna', 'mars', 'minerva', 'neptune', 'odysseus', 'ophelia', 'orion', 'orpheus', 'pandora', 'phoebe', 'pluto', 'saturn', 'selene', 'thalia', 'theia', 'vesta', 'zeus'] as const;

/** A voice the operator may try: any Aura / Aura-2 speaker or MeloTTS ("melo-en"). */
export function parseTryVoice(id: string | null | undefined): NpcVoice | null {
  const m = /^(aura2|aura|melo)-([a-z]+)$/.exec(id ?? '');
  if (!m) return null;
  if (m[1] === 'aura' && !(AURA_SPEAKERS as readonly string[]).includes(m[2]!)) return null;
  if (m[1] === 'aura2' && !(AURA2_SPEAKERS as readonly string[]).includes(m[2]!)) return null;
  return { engine: m[1] as NpcVoice['engine'], speaker: m[2]! };
}

export async function ttsCacheKey(voice: NpcVoice, text: string, sha: (s: string) => Promise<string>): Promise<string> {
  return `${TTS_CACHE_PREFIX}${ttsVoiceId(voice)}/${(await sha(text)).slice(0, 40)}.mp3`;
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Workers AI answers Aura with an audio stream and MeloTTS with `{ audio: base64 }`; both become mp3 bytes. */
export async function audioBytes(out: unknown): Promise<Uint8Array | null> {
  if (!out) return null;
  if (out instanceof Uint8Array) return out;
  if (out instanceof ArrayBuffer) return new Uint8Array(out);
  if (typeof ReadableStream !== 'undefined' && out instanceof ReadableStream) return new Uint8Array(await new Response(out).arrayBuffer());
  if (out instanceof Response) return new Uint8Array(await out.arrayBuffer());
  if (typeof out === 'object' && typeof (out as { audio?: unknown }).audio === 'string') return b64ToBytes((out as { audio: string }).audio);
  return null;
}

/** One synthesis call (no cache, no meter): the operator's try route and `makeLine` share it. */
export async function synthesize(ai: TtsAi, voice: NpcVoice, text: string): Promise<Uint8Array | null> {
  if (isLocalTtsEngine(voice.engine)) return null; // made on the operator's GPU and uploaded, never here
  const engine = voice.engine as TtsEngine;
  const input = engine === 'melo' ? { prompt: text, lang: 'en' } : { text, speaker: voice.speaker, encoding: 'mp3' };
  const bytes = await audioBytes(await ai.run(NEURAL_TTS.models[engine], input));
  return bytes && bytes.length > 64 ? bytes : null;
}

/**
 * `spoke`: the voice that made the audio. When a stand-in read a local line, the answer is cached for minutes only:
 * the same URL plays the local engine's line once it is uploaded.
 */
function audio(bytes: Uint8Array, hit: 'hit' | 'miss', ms: number, spoke: string, standIn: boolean): Response {
  return new Response(bytes as unknown as BodyInit, {
    status: 200,
    headers: {
      'content-type': AUDIO_TYPE,
      'cache-control': standIn ? 'public, max-age=600' : 'public, max-age=31536000, immutable',
      'x-lcw-tts': hit,
      'x-lcw-tts-voice': spoke,
      'x-lcw-tts-ms': String(ms)
    }
  });
}

export function ttsStatus(deps: Pick<TtsDeps, 'enabled' | 'ai'>): Response {
  return Response.json(
    { enabled: deps.enabled && !!deps.ai, voices: castVoices().map(ttsVoiceId) },
    { headers: { 'cache-control': 'public, max-age=60' } }
  );
}

/** Cached audio, or a new line made through the meter (null + reason when it may not or could not be made). */
export async function makeLine(
  voice: NpcVoice,
  text: string,
  who: TtsCaller,
  deps: TtsDeps,
  known?: { key?: string; cachedChecked?: boolean; fixed?: boolean }
): Promise<{ bytes: Uint8Array; hit: 'hit' | 'miss'; ms: number; spoke: string; standIn: boolean } | { error: string; status: number }> {
  const t0 = deps.nowMs();
  const key = known?.key ?? (await ttsCacheKey(voice, text, deps.sha256Hex));
  const cached = deps.store && !known?.cachedChecked ? await deps.store.get(key).catch(() => null) : null;
  const spoke = ttsVoiceId(voice);
  if (cached) return { bytes: new Uint8Array(await cached.arrayBuffer()), hit: 'hit', ms: deps.nowMs() - t0, spoke, standIn: false };
  const fixed = known?.fixed ?? isFixedLine(voice, text);
  if (isLocalTtsEngine(voice.engine)) {
    // not uploaded yet: the stand-in reads it under its own key (same rules: a fixed line for anyone), else the device
    if (!voice.standIn || isLocalTtsEngine(voice.standIn.engine)) return { error: 'tts_not_made', status: 404 };
    const r = await makeLine(voice.standIn, text, who, deps, { fixed });
    return 'error' in r ? r : { ...r, ms: deps.nowMs() - t0, standIn: true };
  }
  if (!deps.ai) return { error: 'tts_unavailable', status: 503 };
  if (who.cachedOnly && !who.operator) return { error: 'tts_not_cached', status: 404 };
  if (!who.operator && !who.player_id && !fixed) return { error: 'child_token_required', status: 401 };
  const meter = deps.quota();
  if (!who.operator && !meter.canUseTts({ isLesson: who.lesson, nowMs: t0 })) return { error: 'tts_quota', status: 429 };
  if (!meter.consumeNeurons(who.player_id ?? (who.operator ? 'operator' : 'anon'), ttsNeurons(voice.engine as TtsEngine, text.length), 'tts')) {
    return { error: 'tts_quota', status: 429 };
  }
  let bytes: Uint8Array | null = null;
  try {
    bytes = await synthesize(deps.ai, voice, text);
  } catch {
    bytes = null;
  }
  if (!bytes) return { error: 'tts_failed', status: 502 };
  if (deps.store) await deps.store.put(key, bytes, { httpMetadata: { contentType: AUDIO_TYPE } }).catch(() => undefined);
  return { bytes, hit: 'miss', ms: deps.nowMs() - t0, spoke, standIn: false };
}

export async function handleTts(url: URL, who: TtsCaller, deps: TtsDeps): Promise<Response> {
  if (!deps.enabled && !who.operator) return json({ error: 'tts_off', fallback: 'device' }, 404);
  const voice = parseVoice(url.searchParams.get('v'));
  if (!voice) return json({ error: 'unknown_voice', fallback: 'device' }, 400);
  const text = normalizeTtsText(url.searchParams.get('t') ?? '');
  if (!text) return json({ error: 'text_required', fallback: 'device' }, 400);
  if (text.length > NEURAL_TTS.maxChars) return json({ error: 'text_too_long', fallback: 'device' }, 413);
  const cachedOnly = who.cachedOnly || url.searchParams.get('c') === '1';
  const r = await makeLine(voice, text, cachedOnly ? { ...who, cachedOnly } : who, deps);
  if ('error' in r) return json({ error: r.error, fallback: 'device' }, r.status);
  return audio(r.bytes, r.hit, r.ms, r.spoke, r.standIn);
}

/** An mp3 file: an ID3 tag or an MPEG audio frame sync at the start. */
export function isMp3(b: Uint8Array): boolean {
  if (b.length >= 3 && b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) return true;
  return b.length >= 2 && b[0] === 0xff && (b[1]! & 0xe0) === 0xe0;
}

/**
 * Operator upload of one local-engine line (`PUT /v1/admin/tts/line?v=<engine-speaker>&t=<text>`, body = mp3; the
 * route checks the operator token). Only a cast voice of a local engine (a Workers AI key always holds that engine's
 * own audio), only a fixed line of that voice (`localTtsLines`), only an mp3 within `TTS_UPLOAD`. Stored under the
 * same key `/v1/tts` reads, so it is served like any cached line; the quota meter is not touched. Uploading the same
 * line again replaces it (a better take).
 */
export async function handleTtsUpload(url: URL, body: Uint8Array, deps: Pick<TtsDeps, 'store' | 'sha256Hex'>): Promise<Response> {
  const voice = parseVoice(url.searchParams.get('v'));
  if (!voice) return json({ error: 'unknown_voice' }, 400);
  if (!isLocalTtsEngine(voice.engine)) return json({ error: 'not_local_engine' }, 400);
  const text = normalizeTtsText(url.searchParams.get('t') ?? '');
  if (!text) return json({ error: 'text_required' }, 400);
  if (!isFixedLine(voice, text)) return json({ error: 'not_fixed_line' }, 422);
  if (body.length > TTS_UPLOAD.maxBytes) return json({ error: 'too_large', max_bytes: TTS_UPLOAD.maxBytes }, 413);
  if (body.length < TTS_UPLOAD.minBytes || !isMp3(body)) return json({ error: 'not_mp3' }, 415);
  if (!deps.store) return json({ error: 'store_unavailable' }, 503);
  const key = await ttsCacheKey(voice, text, deps.sha256Hex);
  await deps.store.put(key, body, { httpMetadata: { contentType: AUDIO_TYPE } });
  return json({ ok: true, key, bytes: body.length });
}

/**
 * The lines a local engine speaks, for the operator's nightly generator (`GET /v1/admin/tts/local-lines`), and the
 * cast's names: the generator hears each new line back through Whisper and re-makes a misheard one, and a name like
 * Rootle (also a real word) must not count as misheard when Whisper writes "riddle".
 */
export function localLinesList(): { lines: Array<{ v: string; t: string }>; names: string[] } {
  const cast = npcCast('en');
  const names = new Set([...Object.keys(cast.islanders), ...Object.values(cast.npcs).map((p) => p.nameEn)]);
  return { lines: localTtsLines().map((l) => ({ v: ttsVoiceId(l.voice), t: l.text })), names: [...names].sort() };
}

/**
 * Operator prebuild: makes missing fixed lines in order (the 46 NPC lines first, ~2,200 neurons; then the ~700 bank
 * sentences, ~37,000 neurons in all, so they spread over days or come one by one on the first 🔊 tap) until the call's
 * neuron budget is spent; call again to continue. `left` = lines not reached in this call.
 */
export async function prebuildFixedLines(deps: TtsDeps, opts: { budgetNeurons?: number; voice?: string; priorityOnly?: boolean } = {}) {
  const budget = Math.max(0, opts.budgetNeurons ?? NEURAL_TTS.prebuildBudgetNeurons);
  // local-engine lines come from the operator's upload, never from the day's neurons
  const lines = fixedTtsLines('en', { priorityOnly: opts.priorityOnly }).filter(
    (l) => !isLocalTtsEngine(l.voice.engine) && (!opts.voice || ttsVoiceId(l.voice) === opts.voice)
  );
  let spent = 0;
  let made = 0;
  let cached = 0;
  let failed = 0;
  let left = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    const cost = ttsNeurons(l.voice.engine as TtsEngine, l.text.length);
    if (spent + cost > budget) {
      left = lines.length - i;
      break;
    }
    const key = await ttsCacheKey(l.voice, l.text, deps.sha256Hex);
    if (deps.store && (await deps.store.get(key).catch(() => null))) {
      cached += 1;
      continue;
    }
    const r = await makeLine(l.voice, l.text, { operator: true, player_id: null, lesson: false }, deps, { key, cachedChecked: true });
    if ('error' in r) {
      failed += 1;
      if (r.error === 'tts_quota') break;
      continue;
    }
    spent += cost;
    made += 1;
  }
  return { lines: lines.length, made, cached, failed, left, neurons: spent };
}

/**
 * The daily prebuild on the hourly cron (11-16, "기계음"): the Workers AI day starts at 00:00 UTC (09:00 KST).
 * - 00 UTC: the NPC lines and the lesson plans first, before the day's lessons ask for them (budget
 *   `morningBudgetNeurons`; what is cached costs nothing, so most days this makes nothing).
 * - 23 UTC: the bank sentences on what the day left over (neurons expire at 00 UTC), keeping `nightReserveNeurons`
 *   for the last hour's play.
 * Other hours do nothing. Off with the neural voice.
 */
export const TTS_CRON = { morningHourUtc: 0, nightHourUtc: 23, morningBudgetNeurons: 4_500, nightReserveNeurons: 1_200 } as const;

export async function runTtsCron(deps: TtsDeps, nowMs: number): Promise<{ task: string; made?: number; neurons?: number; left?: number } | null> {
  if (!deps.enabled || !deps.ai) return null;
  const hour = new Date(nowMs).getUTCHours();
  if (hour === TTS_CRON.morningHourUtc) {
    const r = await prebuildFixedLines(deps, { budgetNeurons: TTS_CRON.morningBudgetNeurons, priorityOnly: true });
    return { task: 'tts_morning', made: r.made, neurons: r.neurons, left: r.left };
  }
  if (hour === TTS_CRON.nightHourUtc) {
    const st = deps.quota().getStatus(nowMs);
    const budget = st.neuronsLimit - st.neuronsUsed - TTS_CRON.nightReserveNeurons;
    if (budget <= 0) return { task: 'tts_night', made: 0, neurons: 0 };
    const r = await prebuildFixedLines(deps, { budgetNeurons: budget });
    return { task: 'tts_night', made: r.made, neurons: r.neurons, left: r.left };
  }
  return null;
}
