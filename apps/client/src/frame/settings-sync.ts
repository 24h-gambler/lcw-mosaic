/**
 * Settings on the server for players who have an account (G14, frame domain): a linked child's device token or a
 * lesson student's own token. `GET /v1/settings` -> `{ settings, updated_at }`, `PUT /v1/settings` `{ settings }`.
 * The server stores a flat object as is (<= 40 keys, number / boolean / string <= 32 chars, 4 KB). The newest copy
 * wins at start; later changes are sent after a short pause. No token, no route (404) or offline: the device copy only.
 * The row is shared: PUT replaces it whole, so keys this record does not write (the adventure's progress 'adv', ...)
 * are read again just before each PUT and sent back as they are; when that read fails nothing is sent (the next change
 * tries again) rather than drop or roll back someone else's key.
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
  out.autoJump = s.autoJump;
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

/** Keys this record writes; the rest of the server row belongs to other parts of the app. */
const OWN_KEYS: ReadonlySet<string> = new Set(Object.keys(toServerSettings(normalizeSettings({}))));

/** The keys of a server row this record does not write (plain values only), kept as they are on every PUT. */
export function otherKeys(flat: unknown): FlatSettings {
  const out: FlatSettings = {};
  if (typeof flat !== 'object' || flat === null) return out;
  for (const [k, v] of Object.entries(flat as Record<string, unknown>)) {
    if (OWN_KEYS.has(k)) continue;
    if (typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) out[k] = v;
  }
  return out;
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
  // UTF-8 bytes like the server (apps/edge/src/settings.ts): another part's Korean value counts double or triple
  return new TextEncoder().encode(JSON.stringify(flat)).length <= SERVER_SETTINGS_LIMITS.maxBytes;
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

type Row = { settings: Record<string, unknown> | null; updatedAt: number | null };

/** The server row as it is now; 'none' = no route, not allowed or offline. */
async function getRow(o: SyncOptions): Promise<Row | 'none'> {
  const f = o.fetchImpl ?? ((i: string, init?: RequestInit) => globalThis.fetch(i, init));
  try {
    const res = await f(`${o.base ?? ''}${SETTINGS_PATH}`, { headers: { authorization: `Bearer ${o.token}` } });
    if (!res.ok) return 'none';
    const j = (await res.json()) as { settings?: unknown; updated_at?: number | null };
    const settings = j && typeof j.settings === 'object' && j.settings !== null ? (j.settings as Record<string, unknown>) : null;
    return { settings, updatedAt: j?.updated_at ?? null };
  } catch {
    return 'none';
  }
}

/** This record on top of the row's other keys; false when it would not fit the server limits or the PUT failed. */
async function putOnRow(s: Readonly<FrameSettings>, row: Row, o: SyncOptions): Promise<boolean> {
  const flat = { ...otherKeys(row.settings), ...toServerSettings(s) };
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

/** Read the row again (its other keys may have changed since the start), then PUT; nothing is sent when the read fails. */
export async function putServerSettings(s: Readonly<FrameSettings>, o: SyncOptions): Promise<boolean> {
  const row = await getRow(o);
  if (row === 'none') return false;
  return putOnRow(s, row, o);
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
  void getRow(o).then((row) => {
    if (stopped) return;
    if (row === 'none') {
      serverAlive = false; // no route yet or offline: the device copy only, quietly
      return;
    }
    // a row with only other parts' keys (say the adventure's) holds no settings record yet
    const srv = row.settings && Object.keys(row.settings).some((k) => OWN_KEYS.has(k)) ? fromServerSettings(row.settings, row.updatedAt) : null;
    const dev = frameSettings();
    const pick = pickNewer(dev, srv);
    if (pick === 'server' && srv) {
      applying = true;
      apply(srv);
      applying = false;
    } else if (pick === 'device') void putOnRow(dev, row, o);
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
