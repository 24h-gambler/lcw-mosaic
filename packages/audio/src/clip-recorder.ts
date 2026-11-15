/**
 * The child's spoken turn as a short audio clip (edge voice.ts, docs/02 §10, docs/19 3).
 *
 * Recorded only when the guardian turned `voice_store` on (the world passes `recordClip`, from /v1/device/me or the
 * /v1/join answer) and only while the mic button is on. The clip stays in memory; it leaves the device only when the
 * server answers the scored turn with `audio_upload` (consent checked again there), then it is POSTed once.
 * Speech recognition always wins: if the recorder cannot start, or recognition failed right after the recorder took
 * the mic, the turn simply has no clip and this device stops recording for good (`lcw.clip.off`).
 */

export interface ClipRecorder {
  /** Mic button on. Opening the mic is async; stop() waits for it. */
  start(): void;
  /** Mic button off: the recorded turn, or null (nothing recorded, unsupported, aborted). */
  stop(): Promise<Blob | null>;
  /** Panel closed / recognition error: drop everything. */
  abort(): void;
}

/** One turn is at most 12 s (docs/04 4.1); the recorder stops itself a little after that. */
export const CLIP_MAX_MS = 12_500;
/** Opus at 24 kbps: ~36 KB for 12 s — speech stays clear for a parent's ear, uploads stay small. */
export const CLIP_BITS_PER_SECOND = 24_000;
/** Waiting longer than this for the recorder's last chunk gives up (the turn is never held up by the clip). */
export const CLIP_STOP_WAIT_MS = 1_500;
export const CLIP_OFF_KEY = 'lcw.clip.off';

export function pickClipMime(isTypeSupported: (t: string) => boolean): string | null {
  for (const t of ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm']) {
    try {
      if (isTypeSupported(t)) return t;
    } catch {
      /* some engines throw on unknown types */
    }
  }
  return null;
}

interface RecorderLike {
  state: string;
  start(timesliceMs?: number): void;
  stop(): void;
  ondataavailable: ((ev: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
}
type RecorderCtor = (new (stream: MediaStream, opts: { mimeType: string; audioBitsPerSecond: number }) => RecorderLike) & {
  isTypeSupported(t: string): boolean;
};

export interface ClipEnv {
  getUserMedia?: (c: MediaStreamConstraints) => Promise<MediaStream>;
  MediaRecorder?: RecorderCtor;
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
}

function browserClipEnv(): ClipEnv {
  const g = globalThis as unknown as {
    navigator?: { mediaDevices?: { getUserMedia?: (c: MediaStreamConstraints) => Promise<MediaStream> } };
    MediaRecorder?: RecorderCtor;
    localStorage?: Storage;
  };
  let storage: ClipEnv['storage'] = null;
  try {
    storage = g.localStorage ?? null;
  } catch {
    storage = null;
  }
  const md = g.navigator?.mediaDevices;
  return {
    getUserMedia: md?.getUserMedia ? (c) => md.getUserMedia!.call(md, c) : undefined,
    MediaRecorder: g.MediaRecorder,
    storage
  };
}

export function clipRecordingOff(storage: ClipEnv['storage']): boolean {
  try {
    return storage?.getItem(CLIP_OFF_KEY) === '1';
  } catch {
    return false;
  }
}

/** Recognition failed while the recorder held the mic: stop recording on this device from now on. */
export function turnClipRecordingOff(storage: ClipEnv['storage'] = browserClipEnv().storage): void {
  try {
    storage?.setItem(CLIP_OFF_KEY, '1');
  } catch {
    /* private mode: just this session */
  }
}

/** null when this browser cannot record (no MediaRecorder / getUserMedia / usable type) or recording is off here. */
export function createMediaClipRecorder(override?: ClipEnv): ClipRecorder | null {
  const env = { ...browserClipEnv(), ...override };
  const Ctor = env.MediaRecorder;
  if (!env.getUserMedia || !Ctor || clipRecordingOff(env.storage ?? null)) return null;
  const mime = pickClipMime((t) => Ctor.isTypeSupported(t));
  if (!mime) return null;
  const setTimer = env.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = env.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));

  let opening: Promise<{ stream: MediaStream; rec: RecorderLike; chunks: Blob[] } | null> | null = null;
  let cap: unknown = null;
  let dropped = false;

  const release = (stream: MediaStream | undefined) => {
    for (const t of stream?.getTracks() ?? []) t.stop();
  };

  return {
    start() {
      dropped = false;
      opening = env.getUserMedia!({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } })
        .then((stream) => {
          if (dropped) {
            release(stream);
            return null;
          }
          const chunks: Blob[] = [];
          const rec = new Ctor(stream, { mimeType: mime, audioBitsPerSecond: CLIP_BITS_PER_SECOND });
          rec.ondataavailable = (ev) => {
            if (ev.data && ev.data.size > 0) chunks.push(ev.data);
          };
          rec.start();
          cap = setTimer(() => {
            if (rec.state === 'recording') rec.stop();
          }, CLIP_MAX_MS);
          return { stream, rec, chunks };
        })
        .catch(() => null);
    },
    async stop() {
      const o = await (opening ?? Promise.resolve(null));
      opening = null;
      clearTimer(cap);
      if (!o || dropped) {
        release(o?.stream);
        return null;
      }
      return new Promise<Blob | null>((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          release(o.stream);
          const type = mime.split(';')[0]!;
          resolve(o.chunks.length > 0 ? new Blob(o.chunks, { type }) : null);
        };
        o.rec.onstop = finish;
        setTimer(finish, CLIP_STOP_WAIT_MS);
        if (o.rec.state === 'recording') o.rec.stop();
        else finish();
      });
    },
    abort() {
      dropped = true;
      clearTimer(cap);
      const o = opening;
      opening = null;
      void o?.then((x) => {
        if (!x) return;
        x.rec.onstop = null;
        if (x.rec.state === 'recording') x.rec.stop();
        release(x.stream);
      });
    }
  };
}

/** POSTs a recorded turn once to the upload URL the server gave. Never throws; a lost clip only loses the replay. */
export async function uploadClip(
  offer: { token: string; max_bytes: number; expires_at: number },
  clip: Promise<Blob | null> | undefined,
  opts: { baseUrl?: string; fetchImpl?: typeof fetch; nowMs?: () => number } = {}
): Promise<boolean> {
  try {
    const blob = clip ? await clip : null;
    const now = (opts.nowMs ?? Date.now)();
    if (!blob || blob.size === 0 || blob.size > offer.max_bytes || now >= offer.expires_at) return false;
    const f = opts.fetchImpl ?? fetch.bind(globalThis);
    const res = await f(`${opts.baseUrl ?? ''}/v1/voice/upload/${offer.token}`, {
      method: 'POST',
      headers: { 'content-type': blob.type || 'application/octet-stream' },
      body: blob
    });
    return res.status === 201;
  } catch {
    return false;
  }
}
