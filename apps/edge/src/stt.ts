import { z } from 'zod';
import { SERVER_STT, serverSttNeurons, type QuotaMeter } from '@lcw/quota';

/**
 * Server speech recognition for a child's dialog turn (docs/02 6장, docs/04 4.4, WP-106 ladder):
 * `POST /v1/converse/stt` with the child's own lesson or device token and the recorded turn as the raw body
 * (`audio/webm` or `audio/ogg`, Opus). The platform answers the transcript; scoring stays on /v1/converse/score.
 *
 * - Only Workers AI Whisper (AGENTS 4.4), only through the quota meter (AGENTS 4.8): `canUseServerStt` decides by
 *   the degrade ladder and the seat's daily 40 minutes, and the neurons are counted from the audio length before
 *   the call, so a refused or failed call never overshoots. Refused → 429 and the dialog goes to the word cards.
 * - The audio is never stored, logged or forwarded anywhere else (AGENTS 4.5): it lives in this request only. The
 *   model gets the audio and the language, never who is speaking (AGENTS 4.6).
 */

export interface SttCaller {
  player_id: string;
  /** A lesson's student token: lesson rooms keep server recognition up to stage 2 (docs/02 5장). */
  lesson: boolean;
}

export interface SttDeps {
  quota: () => QuotaMeter;
  /** Workers AI binding (absent in local tests without a fake). */
  ai?: { run(model: string, input: unknown): Promise<unknown> };
  nowMs: () => number;
}

/** A failed Workers AI call is tried once more on the server before the child hears 'say it again'. */
export const STT_RETRIES = 1;

const WhisperOut = z
  .object({
    text: z.string(),
    segments: z.array(z.object({ avg_logprob: z.number().optional(), no_speech_prob: z.number().optional() }).passthrough()).optional()
  })
  .passthrough();

function toBase64(bytes: Uint8Array): string {
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(s);
}

/** Mean segment log-probability → 0..1 (Whisper gives no single confidence); 0.7 when the model gives none. */
export function whisperConfidence(segments: Array<{ avg_logprob?: number }> | undefined): number {
  const lp = (segments ?? []).map((s) => s.avg_logprob).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (lp.length === 0) return 0.7;
  const mean = lp.reduce((a, b) => a + b, 0) / lp.length;
  return Math.max(0, Math.min(1, Number(Math.exp(mean).toFixed(3))));
}

/** The length the meter charges: the longer of what the client says and what the size implies at 16 kbps. */
export function sttSeconds(bytes: number, claimedMs: number | null): number {
  const bySize = bytes / SERVER_STT.opusBytesPerSec;
  const claimed = claimedMs !== null && Number.isFinite(claimedMs) && claimedMs > 0 ? claimedMs / 1000 : 0;
  return Number(Math.max(bySize, claimed).toFixed(2));
}

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

export async function handleServerStt(req: Request, who: SttCaller, deps: SttDeps): Promise<Response> {
  const type = (req.headers.get('content-type') ?? '').toLowerCase();
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > SERVER_STT.maxBytes) {
    if (req.body) await req.body.cancel().catch(() => undefined);
    return json({ error: 'audio_too_large' }, 413);
  }
  const buf = new Uint8Array(await req.arrayBuffer());
  if (!type.startsWith('audio/')) return json({ error: 'audio_required' }, 415);
  if (buf.length === 0) return json({ error: 'audio_required' }, 400);
  if (buf.length > SERVER_STT.maxBytes) return json({ error: 'audio_too_large' }, 413);
  const claimed = req.headers.get('x-lcw-audio-ms');
  const sec = sttSeconds(buf.length, claimed === null ? null : Number(claimed));
  if (sec > SERVER_STT.maxSec) return json({ error: 'audio_too_long' }, 413);
  if (!deps.ai) return json({ error: 'stt_unavailable', fallback: 'board' }, 503);

  const now = deps.nowMs();
  const meter = deps.quota();
  const hasDeviceStt = req.headers.get('x-lcw-device-stt') === '1';
  if (!meter.canUseServerStt({ seatId: who.player_id, isLesson: who.lesson, hasDeviceStt, nowMs: now })) {
    return json({ error: 'stt_quota', fallback: 'board', stage: meter.getStatus(now).stage }, 429);
  }
  if (!meter.consumeNeurons(who.player_id, serverSttNeurons(sec), 'stt', sec)) {
    return json({ error: 'stt_quota', fallback: 'board', stage: meter.getStatus(now).stage }, 429);
  }
  // Workers AI now and then fails a call (an 'InferenceUpstreamError' 502; 11-19 measurement): one more try on the
  // server before the child is asked to say it again (coordinator 11-19). The second call costs the model again, so
  // it goes through the meter again; a refused meter keeps the first failure. A turn that still fails is the client's
  // 'stt_failed' 'http_502' as before, so the mic-turn ledger (lcw.micTurns, R2627) records it unchanged.
  const audio = toBase64(buf);
  const call = async (): Promise<z.infer<typeof WhisperOut> | null> => {
    try {
      const parsed = WhisperOut.safeParse(await deps.ai!.run(SERVER_STT.model, { audio, language: 'en', task: 'transcribe', vad_filter: true }));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  };
  let out = await call();
  let retried = false;
  if (!out && STT_RETRIES > 0 && meter.consumeNeurons(who.player_id, serverSttNeurons(sec), 'stt', sec)) {
    retried = true;
    out = await call();
  }
  if (!out) return json({ error: 'stt_failed', fallback: 'board', retried }, 502);
  const transcript = out.text.replace(/\s+/g, ' ').trim().slice(0, SERVER_STT.maxTranscriptChars);
  // Whisper's own "was there speech at all" per segment (the highest), when the model gives it: the client keeps a
  // silence line ("Thank you.") from becoming an answer with it (server-stt.ts WHISPER_HALLUCINATIONS).
  const noSpeech = (out.segments ?? []).map((x) => x.no_speech_prob).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  return json({
    transcript,
    confidence: transcript ? whisperConfidence(out.segments) : 0,
    stt_sec: sec,
    source: 'workers_ai',
    ...(noSpeech.length ? { no_speech_prob: Number(Math.max(...noSpeech).toFixed(3)) } : {}),
    ...(retried ? { retried: true } : {})
  });
}
