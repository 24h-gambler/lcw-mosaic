/**
 * Settings on the server for players who have an account (G14, frame domain): a linked child's device token or a
 * lesson student's own token. `GET /v1/settings` -> `{ settings, updated_at }`, `PUT /v1/settings` `{ settings }`.
 * The server stores a flat object as is (<= 40 keys, number / boolean / string <= 32 chars, 4 KB). The newest copy
 * wins at start; later changes are sent after a short pause. No token, no route (404) or offline: the device copy only.
 */
import {
  DEFAULT_KEYS,
  KEY_ACTIONS,
  frameSettings,
  normalizeSettings,
  onFrameSettings,
  replaceFrameSettings,
  type FrameSettings
} from './settings.js';

export const SETTINGS_PATH = '/v1/settings';
/** Changes are sent once the player stops moving a slider for this long. */
export const SETTINGS_PUT_DEBOUNCE_MS = 800;
export const SERVER_SETTINGS_LIMITS = { maxKeys: 40, maxString: 32, maxBytes: 4096 } as const;

export type FlatSettings = Record<string, number | boolean | string>;

/** The record as the server keeps it: one level, short keys. `reduceMotion: null` becomes 'auto'. */
export function toServerSettings(s: Readonly<FrameSettings>): FlatSettings {
  const out: FlatSettings = {};
  for (const a of KEY_ACTIONS) out[`key_${a}`] = s.keys[a];
  out.lookMouse = s.lookMouse;
  out.lookTouch = s.lookTouch;
  out.invertY = s.invertY;
  out.micMode = s.micMode;
  out.volMaster = s.volume.master;
  out.volMusic = s.volume.music;
  out.volEffects = s.volume.effects;
  out.volVoice = s.volume.voice;
  out.voiceRate = s.voiceRate;
  out.neuralVoice = s.neuralVoice;
  out.textScale = s.textScale;
  out.reduceMotion = s.reduceMotion === null ? 'auto' : s.reduceMotion;
  out.quality = s.quality;
  out.viewChunks = s.viewChunks ?? 'tier';
  out.shadows = s.shadows ?? 'tier';
  out.renderScale = s.renderScale ?? 'tier';
  out.showFps = s.showFps;
  out.readableFont = s.readableFont;
  out.colorAssist = s.colorAssist;
  out.syllables = s.syllables;
  out.strongFocus = s.strongFocus;
  out.helpKo = s.helpKo;
  out.updatedAt = s.updatedAt;
  return out;
}

export function fromServerSettings(flat: unknown, updatedAt: number | null): FrameSettings {
  const f = typeof flat === 'object' && flat !== null ? (flat as Record<string, unknown>) : {};
  const keys: Record<string, unknown> = {};
  for (const a of KEY_ACTIONS) keys[a] = f[`key_${a}`] ?? DEFAULT_KEYS[a];
  return normalizeSettings({
    ...f,
    keys,
    volume: { master: f.volMaster, music: f.volMusic, effects: f.volEffects, voice: f.volVoice },
    reduceMotion: typeof f.reduceMotion === 'boolean' ? f.reduceMotion : null,
    viewChunks: typeof f.viewChunks === 'number' ? f.viewChunks : null,
    shadows: typeof f.shadows === 'boolean' ? f.shadows : null,
    renderScale: typeof f.renderScale === 'number' ? f.renderScale : null,
    updatedAt: typeof f.updatedAt === 'number' ? f.updatedAt : toMs(updatedAt)
  });
}

/** The server may answer in seconds or milliseconds. */
export function toMs(t: number | null | undefined): number {
  if (typeof t !== 'number' || !Number.isFinite(t) || t <= 0) return 0;
  return t < 1e12 ? Math.round(t * 1000) : Math.round(t);
}

export function fitsServer(flat: FlatSettings): boolean {
  const keys = Object.keys(flat);
  if (keys.length > SERVER_SETTINGS_LIMITS.maxKeys) return false;
  for (const k of keys) {
    const v = flat[k];
    if (typeof v === 'string' && v.length > SERVER_SETTINGS_LIMITS.maxString) return false;
    if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') return false;
  }
  return JSON.stringify({ settings: flat }).length <= SERVER_SETTINGS_LIMITS.maxBytes;
}

/** Which copy to keep: 'server' when it is newer, 'device' when the device is newer (send it), 'same' otherwise. */
export function pickNewer(device: Readonly<FrameSettings>, server: Readonly<FrameSettings> | null): 'server' | 'device' | 'same' {
  if (!server) return device.updatedAt > 0 ? 'device' : 'same';
  if (server.updatedAt > device.updatedAt) return 'server';
  if (device.updatedAt > server.updatedAt) return 'device';
  return 'same';
}

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface SyncOptions {
  token: string;
  fetchImpl?: Fetch;
  base?: string;
}

async function getServer(o: SyncOptions): Promise<FrameSettings | null | 'none'> {
  const f = o.fetchImpl ?? ((i: string, init?: RequestInit) => globalThis.fetch(i, init));
  try {
    const res = await f(`${o.base ?? ''}${SETTINGS_PATH}`, { headers: { authorization: `Bearer ${o.token}` } });
    if (!res.ok) return 'none';
    const j = (await res.json()) as { settings?: unknown; updated_at?: number | null };
    if (!j || typeof j.settings !== 'object' || j.settings === null || Object.keys(j.settings).length === 0) return null;
    return fromServerSettings(j.settings, j.updated_at ?? null);
  } catch {
    return 'none';
  }
}

export async function putServerSettings(s: Readonly<FrameSettings>, o: SyncOptions): Promise<boolean> {
  const flat = toServerSettings(s);
  if (!fitsServer(flat)) return false;
  const f = o.fetchImpl ?? ((i: string, init?: RequestInit) => globalThis.fetch(i, init));
  try {
    const res = await f(`${o.base ?? ''}${SETTINGS_PATH}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${o.token}` },
      body: JSON.stringify({ settings: flat })
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Start syncing for this token: newest copy wins now, then every change is sent (debounced). Returns the stopper.
 * `apply` is the seam for tests (default: put the record in force on the page).
 */
export function startSettingsSync(
  o: SyncOptions & { apply?: (s: FrameSettings) => void; timers?: { set: (fn: () => void, ms: number) => unknown; clear: (id: unknown) => void } }
): () => void {
  const timers = o.timers ?? { set: (fn, ms) => setTimeout(fn, ms), clear: (id) => clearTimeout(id as ReturnType<typeof setTimeout>) };
  const apply = o.apply ?? ((s: FrameSettings) => void replaceFrameSettings(s));
  let stopped = false;
  let serverAlive = true;
  let timer: unknown = null;
  let applying = false;
  void getServer(o).then((srv) => {
    if (stopped) return;
    if (srv === 'none') {
      serverAlive = false; // no route yet or offline: the device copy only, quietly
      return;
    }
    const dev = frameSettings();
    const pick = pickNewer(dev, srv);
    if (pick === 'server' && srv) {
      applying = true;
      apply(srv);
      applying = false;
    } else if (pick === 'device') void putServerSettings(dev, o);
  });
  const off = onFrameSettings((s) => {
    if (applying || !serverAlive || stopped) return;
    if (timer !== null) timers.clear(timer);
    timer = timers.set(() => {
      timer = null;
      void putServerSettings(s, o);
    }, SETTINGS_PUT_DEBOUNCE_MS);
  });
  return () => {
    stopped = true;
    off();
    if (timer !== null) timers.clear(timer);
  };
}
