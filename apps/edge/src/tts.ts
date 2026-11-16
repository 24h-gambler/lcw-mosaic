import { NEURAL_TTS, ttsNeurons, type QuotaMeter, type TtsEngine } from '@lcw/quota';
import { castVoices, fixedTtsLines, normalizeTtsText, ttsVoiceId, type NpcVoice } from '@lcw/content';

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
}

export const TTS_CACHE_PREFIX = 'tts/v1/';
const AUDIO_TYPE = 'audio/mpeg';

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
  const engine = voice.engine as TtsEngine;
  const input = engine === 'melo' ? { prompt: text, lang: 'en' } : { text, speaker: voice.speaker, encoding: 'mp3' };
  const bytes = await audioBytes(await ai.run(NEURAL_TTS.models[engine], input));
  return bytes && bytes.length > 64 ? bytes : null;
}

function audio(bytes: Uint8Array, hit: 'hit' | 'miss', ms: number): Response {
  return new Response(bytes as unknown as BodyInit, {
    status: 200,
    headers: {
      'content-type': AUDIO_TYPE,
      'cache-control': 'public, max-age=31536000, immutable',
      'x-lcw-tts': hit,
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
  known?: { key: string; cachedChecked: boolean }
): Promise<{ bytes: Uint8Array; hit: 'hit' | 'miss'; ms: number } | { error: string; status: number }> {
  const t0 = deps.nowMs();
  const key = known?.key ?? (await ttsCacheKey(voice, text, deps.sha256Hex));
  const cached = deps.store && !known?.cachedChecked ? await deps.store.get(key).catch(() => null) : null;
  if (cached) return { bytes: new Uint8Array(await cached.arrayBuffer()), hit: 'hit', ms: deps.nowMs() - t0 };
  if (!deps.ai) return { error: 'tts_unavailable', status: 503 };
  if (!who.operator && !who.player_id && !isFixedLine(voice, text)) return { error: 'child_token_required', status: 401 };
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
  return { bytes, hit: 'miss', ms: deps.nowMs() - t0 };
}

export async function handleTts(url: URL, who: TtsCaller, deps: TtsDeps): Promise<Response> {
  if (!deps.enabled && !who.operator) return json({ error: 'tts_off', fallback: 'device' }, 404);
  const voice = parseVoice(url.searchParams.get('v'));
  if (!voice) return json({ error: 'unknown_voice', fallback: 'device' }, 400);
  const text = normalizeTtsText(url.searchParams.get('t') ?? '');
  if (!text) return json({ error: 'text_required', fallback: 'device' }, 400);
  if (text.length > NEURAL_TTS.maxChars) return json({ error: 'text_too_long', fallback: 'device' }, 413);
  const r = await makeLine(voice, text, who, deps);
  if ('error' in r) return json({ error: r.error, fallback: 'device' }, r.status);
  return audio(r.bytes, r.hit, r.ms);
}

/**
 * Operator prebuild: makes missing fixed lines in order (the 46 NPC lines first, ~2,200 neurons; then the ~700 bank
 * sentences, ~37,000 neurons in all, so they spread over days or come one by one on the first 🔊 tap) until the call's
 * neuron budget is spent; call again to continue. `left` = lines not reached in this call.
 */
export async function prebuildFixedLines(deps: TtsDeps, opts: { budgetNeurons?: number; voice?: string } = {}) {
  const budget = Math.max(0, opts.budgetNeurons ?? NEURAL_TTS.prebuildBudgetNeurons);
  const lines = fixedTtsLines().filter((l) => !opts.voice || ttsVoiceId(l.voice) === opts.voice);
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
