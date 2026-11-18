/**
 * Player settings G14 (docs/08 8.6, 11장 접근성; docs/12 2장 버스 음량), frame domain.
 *
 * One record on the device (`localStorage['lcw.settings']`, JSON). Every setting reaches something real:
 * - volumes        -> the page's audio runtime bus gains (`applyVolumes` -> AudioRuntime.setBusVolume), and the device
 *                     voice through the voice_npc bus value (dialog/sound.ts)
 * - text size      -> `--lcw-fs` on <html>: the player menu and the dialog window (`.lcw-dlg --fs`) both read it
 * - motion, font, colour assist, focus ring -> attributes on <html> + one global stylesheet (`SETTINGS_CSS`)
 * - look           -> WorldHandle.setLookSettings({ mouse, touch, invertY }) (FrameLayer, at start and on change)
 * - motion, FPS    -> WorldHandle.setReduceMotion / setShowFps (FrameLayer)
 * - NPC voice      -> dialog/sound.ts speakEnglish reads `voiceRate()` and picks a voice with `pickEnglishVoice`
 * - quality        -> `savedTier()` is what App.pickTier starts the next world with (the `?tier=` address still wins)
 * - keys           -> `installKeyRemap` turns a re-bound key into the world's own key before anyone hears it
 * - mic button     -> `micHoldMode()` for the dialog mic (hold to talk instead of tap on / tap off)
 * - syllables      -> `syllableHints()` for the dialog's target sentence
 *
 * A linked child or a lesson student also keeps the record on the server (frame/settings-sync.ts), newest wins.
 *
 * The pure parts (normalise, clamp, bus volumes, key routes, document state) take plain values so they run in tests.
 */
import { BUS_DEFAULT_VOLUMES, type AudioBusName } from '@lcw/audio';
import { COLOR_ASSIST_TOKENS, COLOR_TOKENS, SHAPE_TOKENS, TYPOGRAPHY_TOKENS } from '@lcw/ui';
import type { WorldTier } from '../world/api.js';

export const SETTINGS_KEY = 'lcw.settings';

/** Ranges of the sliders (docs/08 11장: text 100~150%). */
export const SETTINGS_LIMITS = {
  textScale: { min: 1, max: 1.5, step: 0.1 },
  look: { min: 0.5, max: 2, step: 0.1 },
  /** NPC voice speed multiplier on top of the level's rate (0.6 = slow for young children) */
  voiceRate: { min: 0.6, max: 1.2, step: 0.1 },
  /** graphics overrides (null = the tier's own value; docs/08 6.6 view 4~8 chunks, scale 0.5~1.0) */
  viewChunks: { min: 3, max: 8, step: 1 },
  renderScale: { min: 0.5, max: 1, step: 0.05 },
  volume: { min: 0, max: 1, step: 0.05 }
} as const;

// ---- keys (docs/08 7.1 "모든 키는 설정에서 바꿀 수 있습니다")

export type KeyAction =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'jump'
  | 'run'
  | 'talk'
  | 'view'
  | 'mirror'
  | 'bag'
  | 'map'
  | 'book'
  | 'rotate'
  | 'undo'
  | 'chest';

/** The world's own keys (world/engine.ts keyDown, frame/menu/PlayerMenu.tsx tabForKey). Re-bound keys turn into these. */
export const DEFAULT_KEYS: Readonly<Record<KeyAction, string>> = {
  forward: 'KeyW',
  back: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  jump: 'Space',
  run: 'ShiftLeft',
  talk: 'KeyE',
  view: 'F5',
  mirror: 'Tab',
  bag: 'KeyI',
  map: 'KeyM',
  book: 'KeyK',
  rotate: 'KeyR',
  undo: 'KeyZ',
  chest: 'KeyC'
};

export const KEY_ACTIONS = Object.keys(DEFAULT_KEYS) as readonly KeyAction[];

/** Actions that still work while the player menu is open (switch tab / close it). */
export const MENU_KEY_ACTIONS: ReadonlySet<KeyAction> = new Set(['bag', 'map', 'book']);

/** Fixed keys: arrows walk too, 1~5 pick a slot, Esc closes, Enter presses; OS keys stay the OS's. */
export const RESERVED_CODES: ReadonlySet<string> = new Set([
  'Escape',
  'Enter',
  'NumpadEnter',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Digit1',
  'Digit2',
  'Digit3',
  'Digit4',
  'Digit5',
  'MetaLeft',
  'MetaRight',
  'OSLeft',
  'OSRight',
  'ContextMenu',
  'F11',
  'F12'
]);

// ---- the record

export type VolumeGroup = 'master' | 'music' | 'effects' | 'voice';
export type Quality = 'auto' | WorldTier;
export type MicMode = 'toggle' | 'hold';

/** Which buses each volume slider moves (docs/12 2장): background = music + ambience, effects = effects + UI. */
export const VOLUME_BUSES: Readonly<Record<Exclude<VolumeGroup, 'master'>, readonly AudioBusName[]>> = {
  music: ['bgm', 'amb'],
  effects: ['sfx', 'ui'],
  voice: ['voice_npc', 'voice_lesson']
};

export interface FrameSettings {
  keys: Record<KeyAction, string>;
  /** drag-to-look speed multipliers (mouse, touch) and up/down inversion */
  lookMouse: number;
  lookTouch: number;
  invertY: boolean;
  micMode: MicMode;
  /** 0..1 of the docs/12 default level (1 = the bus default, 0 = silent) */
  volume: Record<VolumeGroup, number>;
  /** NPC voice: speed multiplier and the natural voice (server neural voice in dialog/neural-voice.ts; the device
   *  fallback then prefers the browser's natural voices) */
  voiceRate: number;
  neuralVoice: boolean;
  textScale: number;
  /** null: follow the device (prefers-reduced-motion) */
  reduceMotion: boolean | null;
  quality: Quality;
  /** graphics overrides on top of the quality tier; null = the tier's default */
  viewChunks: number | null;
  shadows: boolean | null;
  renderScale: number | null;
  showFps: boolean;
  readableFont: boolean;
  colorAssist: boolean;
  syllables: boolean;
  strongFocus: boolean;
  /** when the player last changed something (ms since epoch; 0 = never): newest wins against the server copy */
  updatedAt: number;
}

export const DEFAULT_SETTINGS: Readonly<FrameSettings> = Object.freeze({
  keys: { ...DEFAULT_KEYS },
  lookMouse: 1,
  lookTouch: 1,
  invertY: false,
  micMode: 'toggle',
  volume: { master: 1, music: 1, effects: 1, voice: 1 },
  voiceRate: 1,
  // on by default: the server NPC voice (neural-voice.ts) plays unless the player turns it off
  neuralVoice: true,
  textScale: 1,
  reduceMotion: null,
  quality: 'auto',
  viewChunks: null,
  shadows: null,
  renderScale: null,
  showFps: false,
  readableFont: false,
  colorAssist: false,
  syllables: false,
  strongFocus: false,
  updatedAt: 0
});

export function cloneSettings(s: Readonly<FrameSettings>): FrameSettings {
  return { ...s, keys: { ...s.keys }, volume: { ...s.volume } };
}

/** Clamp to [min, max] and snap to the slider step (no 1.2000000002 in storage). */
export function clampStep(v: unknown, lim: { min: number; max: number; step: number }, fallback: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  const snapped = Math.round((n - lim.min) / lim.step) * lim.step + lim.min;
  return Number(Math.min(lim.max, Math.max(lim.min, snapped)).toFixed(4));
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Valid key map: every action bound, no key twice, nothing reserved. Anything else falls back to the defaults. */
export function normalizeKeys(raw: unknown): Record<KeyAction, string> {
  const keys = { ...DEFAULT_KEYS };
  if (!isObj(raw)) return keys;
  for (const a of KEY_ACTIONS) {
    const c = raw[a];
    if (typeof c === 'string' && /^[A-Za-z0-9]{1,24}$/.test(c) && !RESERVED_CODES.has(c)) keys[a] = c;
  }
  const used = new Set(Object.values(keys));
  return used.size === KEY_ACTIONS.length ? keys : { ...DEFAULT_KEYS };
}

/** Any stored value (old, hand-edited, garbage) -> a whole valid record. */
export function normalizeSettings(raw: unknown): FrameSettings {
  const d = DEFAULT_SETTINGS;
  if (!isObj(raw)) return cloneSettings(d);
  const vol = isObj(raw.volume) ? raw.volume : {};
  const bool = (v: unknown, f: boolean): boolean => (typeof v === 'boolean' ? v : f);
  return {
    keys: normalizeKeys(raw.keys),
    lookMouse: clampStep(raw.lookMouse, SETTINGS_LIMITS.look, d.lookMouse),
    lookTouch: clampStep(raw.lookTouch, SETTINGS_LIMITS.look, d.lookTouch),
    invertY: bool(raw.invertY, d.invertY),
    micMode: raw.micMode === 'hold' ? 'hold' : 'toggle',
    volume: {
      master: clampStep(vol.master, SETTINGS_LIMITS.volume, 1),
      music: clampStep(vol.music, SETTINGS_LIMITS.volume, 1),
      effects: clampStep(vol.effects, SETTINGS_LIMITS.volume, 1),
      voice: clampStep(vol.voice, SETTINGS_LIMITS.volume, 1)
    },
    voiceRate: clampStep(raw.voiceRate, SETTINGS_LIMITS.voiceRate, d.voiceRate),
    neuralVoice: bool(raw.neuralVoice, d.neuralVoice),
    textScale: clampStep(raw.textScale, SETTINGS_LIMITS.textScale, d.textScale),
    reduceMotion: typeof raw.reduceMotion === 'boolean' ? raw.reduceMotion : null,
    quality: raw.quality === 'low' || raw.quality === 'mid' || raw.quality === 'high' ? raw.quality : 'auto',
    viewChunks: raw.viewChunks === null || raw.viewChunks === undefined ? null : clampStep(raw.viewChunks, SETTINGS_LIMITS.viewChunks, 6),
    shadows: typeof raw.shadows === 'boolean' ? raw.shadows : null,
    renderScale: raw.renderScale === null || raw.renderScale === undefined ? null : clampStep(raw.renderScale, SETTINGS_LIMITS.renderScale, 1),
    showFps: bool(raw.showFps, d.showFps),
    readableFont: bool(raw.readableFont, d.readableFont),
    colorAssist: bool(raw.colorAssist, d.colorAssist),
    syllables: bool(raw.syllables, d.syllables),
    strongFocus: bool(raw.strongFocus, d.strongFocus),
    updatedAt: typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) && raw.updatedAt > 0 ? Math.round(raw.updatedAt) : 0
  };
}

export function parseSettings(json: string | null | undefined): FrameSettings {
  if (!json) return cloneSettings(DEFAULT_SETTINGS);
  try {
    return normalizeSettings(JSON.parse(json));
  } catch {
    return cloneSettings(DEFAULT_SETTINGS);
  }
}

export type SettingsStore = Pick<Storage, 'getItem' | 'setItem'>;

export function browserSettingsStore(): SettingsStore | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function loadSettings(store: SettingsStore | null = browserSettingsStore()): FrameSettings {
  try {
    return parseSettings(store?.getItem(SETTINGS_KEY));
  } catch {
    return cloneSettings(DEFAULT_SETTINGS);
  }
}

/** false when the device would not keep it (private mode, storage full): the settings still apply for this visit. */
export function saveSettings(s: FrameSettings, store: SettingsStore | null = browserSettingsStore()): boolean {
  if (!store) return false;
  try {
    store.setItem(SETTINGS_KEY, JSON.stringify(s));
    return true;
  } catch {
    return false;
  }
}

// ---- keys: re-binding and routing

export type RebindResult = { ok: true; keys: Record<KeyAction, string>; swappedWith: KeyAction | null } | { ok: false; reason: 'reserved' };

/** Bind `code` to `action`. A key another action had moves over and that action gets this one's old key (a swap). */
export function rebindKey(keys: Readonly<Record<KeyAction, string>>, action: KeyAction, code: string): RebindResult {
  if (RESERVED_CODES.has(code)) return { ok: false, reason: 'reserved' };
  const next = { ...keys };
  const other = KEY_ACTIONS.find((a) => a !== action && keys[a] === code) ?? null;
  if (other) next[other] = keys[action];
  next[action] = code;
  return { ok: true, keys: next, swappedWith: other };
}

export interface KeyRoutes {
  /** pressed key -> the world key it stands for */
  to: Map<string, { code: string; action: KeyAction }>;
  /** a world key whose action moved elsewhere (and is not someone's new key) */
  blocked: Map<string, KeyAction>;
}

export function keyRoutes(keys: Readonly<Record<KeyAction, string>>): KeyRoutes {
  const to = new Map<string, { code: string; action: KeyAction }>();
  const blocked = new Map<string, KeyAction>();
  for (const a of KEY_ACTIONS) if (keys[a] !== DEFAULT_KEYS[a]) to.set(keys[a], { code: DEFAULT_KEYS[a], action: a });
  for (const a of KEY_ACTIONS) if (keys[a] !== DEFAULT_KEYS[a] && !to.has(DEFAULT_KEYS[a])) blocked.set(DEFAULT_KEYS[a], a);
  return { to, blocked };
}

/** Where key events are routed now: the whole world, the menu's own keys only, or nowhere (a dialog has the keys). */
export type KeyScope = 'world' | 'menu' | 'off';

export type KeyRoute = { kind: 'pass' } | { kind: 'to'; code: string } | { kind: 'block' };

export function routeKey(code: string, routes: KeyRoutes, scope: KeyScope): KeyRoute {
  if (scope === 'off') return { kind: 'pass' };
  const inScope = (a: KeyAction): boolean => scope === 'world' || MENU_KEY_ACTIONS.has(a);
  const t = routes.to.get(code);
  if (t && inScope(t.action)) return { kind: 'to', code: t.code };
  const b = routes.blocked.get(code);
  if (b && inScope(b)) return { kind: 'block' };
  return { kind: 'pass' };
}

/** `KeyboardEvent.key` for a code we synthesise (only the world's own keys are ever synthesised). */
export function keyValueOf(code: string): string {
  if (code.startsWith('Key')) return code.slice(3).toLowerCase();
  if (code === 'Space') return ' ';
  if (code === 'ShiftLeft' || code === 'ShiftRight') return 'Shift';
  return code;
}

// ---- audio

/** Bus volumes the engine gets: docs/12 default x the group slider x the master slider, clamped to 0..1. */
export function busVolumesFor(vol: Readonly<Record<VolumeGroup, number>>): Record<AudioBusName, number> {
  const out = {} as Record<AudioBusName, number>;
  for (const group of Object.keys(VOLUME_BUSES) as Array<Exclude<VolumeGroup, 'master'>>) {
    for (const bus of VOLUME_BUSES[group]) {
      out[bus] = Math.min(1, Math.max(0, BUS_DEFAULT_VOLUMES[bus] * vol[group] * vol.master));
    }
  }
  return out;
}

export function applyVolumes(rt: { setBusVolume(bus: AudioBusName, v: number): void }, vol: Readonly<Record<VolumeGroup, number>>): void {
  const v = busVolumesFor(vol);
  for (const bus of Object.keys(v) as AudioBusName[]) rt.setBusVolume(bus, v[bus]);
}

// ---- document (text size, motion, font, colour assist, focus ring)

export interface DocumentState {
  vars: Record<string, string>;
  /** attribute -> value, or null to remove */
  attrs: Record<string, string | null>;
}

export function documentStateFor(s: Readonly<FrameSettings>, deviceReducesMotion: boolean): DocumentState {
  const reduce = s.reduceMotion ?? deviceReducesMotion;
  return {
    vars: { '--lcw-fs': String(s.textScale) },
    attrs: {
      'data-lcw-motion': reduce ? 'reduce' : null,
      'data-lcw-font': s.readableFont ? 'readable' : null,
      'data-lcw-palette': s.colorAssist ? 'assist' : null,
      'data-lcw-focus': s.strongFocus ? 'strong' : null
    }
  };
}

export const SETTINGS_STYLE_ID = 'lcw-frame-settings-style';
/** OpenDyslexic (SIL OFL 1.1, docs/08 3장 "읽기 쉬운 글자 옵션"), fetched only when the option is on. */
export const READABLE_FONT_HREFS: readonly string[] = [
  'https://cdn.jsdelivr.net/npm/@fontsource/opendyslexic@5.3.0/400.css',
  'https://cdn.jsdelivr.net/npm/@fontsource/opendyslexic@5.3.0/700.css'
];

const dyslexicFamily = TYPOGRAPHY_TOKENS.fonts.dyslexic.split(',')[0]!.trim();
/** Hangul has no OpenDyslexic glyphs: Korean falls through to the UI face. */
const READABLE_STACK = `${dyslexicFamily}, ${TYPOGRAPHY_TOKENS.fonts.ui}`;
/** Elements whose colour tokens are CSS variables (`--c-*`): the assist palette swaps them there. */
const TOKEN_ROOTS = ['.lcw-menu', '.lcw-dlg', '.lw-hud'];
const assistVars = Object.entries(COLOR_ASSIST_TOKENS)
  .map(([k, v]) => `--c-${k}:${v};`)
  .join('');
const focusW = SHAPE_TOKENS.focusOutlineWidthPx;
const sel = (attr: string, inner: string): string =>
  inner
    .split(',')
    .map((x) => `html[${attr}] ${x.trim()}`)
    .join(',');

export const SETTINGS_CSS = `
:where(button,a,input,select,textarea,summary,[tabindex],[role="button"],[role="tab"],[role="switch"]):focus-visible{outline:${focusW}px solid ${COLOR_TOKENS['sky-d']};outline-offset:2px}
${sel('data-lcw-focus="strong"', ':focus:not(canvas)')}{outline:${focusW + 2}px solid ${COLOR_TOKENS['sky-d']} !important;outline-offset:2px !important;box-shadow:0 0 0 ${focusW + 5}px ${COLOR_TOKENS['paper-0']} !important}
${sel('data-lcw-motion="reduce"', '*, *::before, *::after')}{animation-duration:1ms !important;animation-delay:0ms !important;animation-iteration-count:1 !important;transition-duration:1ms !important;transition-delay:0ms !important;scroll-behavior:auto !important}
${sel('data-lcw-font="readable"', 'body, body *')}{font-family:${READABLE_STACK} !important;letter-spacing:.01em}
${sel('data-lcw-palette="assist"', TOKEN_ROOTS.join(','))}{${assistVars}}
`;

export function applyDocumentState(doc: Document, st: DocumentState): void {
  const root = doc.documentElement;
  for (const [k, v] of Object.entries(st.vars)) root.style.setProperty(k, v);
  for (const [k, v] of Object.entries(st.attrs)) {
    if (v === null) root.removeAttribute(k);
    else root.setAttribute(k, v);
  }
  if (!doc.getElementById(SETTINGS_STYLE_ID)) {
    const el = doc.createElement('style');
    el.id = SETTINGS_STYLE_ID;
    el.textContent = SETTINGS_CSS;
    doc.head.appendChild(el);
  }
  if (st.attrs['data-lcw-font']) {
    READABLE_FONT_HREFS.forEach((href, i) => {
      const id = `lcw-readable-font-${i}`;
      if (doc.getElementById(id)) return;
      const link = doc.createElement('link');
      link.id = id;
      link.rel = 'stylesheet';
      link.href = href;
      doc.head.appendChild(link);
    });
  }
}

// ---- live state (one per page)

let current: FrameSettings | null = null;
let routes: KeyRoutes = keyRoutes(DEFAULT_KEYS);
const listeners = new Set<(s: Readonly<FrameSettings>) => void>();
let motionQuery: MediaQueryList | null | undefined;

function deviceReducesMotion(): boolean {
  if (motionQuery === undefined) {
    try {
      motionQuery = typeof matchMedia !== 'undefined' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
    } catch {
      motionQuery = null;
    }
  }
  return motionQuery?.matches ?? false;
}

/** The settings now in force (read from the device on first use, so early readers such as pickTier see them). */
export function frameSettings(): Readonly<FrameSettings> {
  if (!current) {
    current = loadSettings();
    routes = keyRoutes(current.keys);
  }
  return current;
}

export function onFrameSettings(cb: (s: Readonly<FrameSettings>) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Puts every setting into effect: audio buses, the document, (the world and dialog read the getters below). */
export function applyFrameSettings(s: Readonly<FrameSettings>, deps: ApplyDeps = defaultDeps()): void {
  if (deps.audio) applyVolumes(deps.audio, s.volume);
  if (deps.doc) applyDocumentState(deps.doc, documentStateFor(s, deviceReducesMotion()));
}

export interface ApplyDeps {
  audio?: { setBusVolume(bus: AudioBusName, v: number): void } | null;
  doc?: Document | null;
  store?: SettingsStore | null;
}

let audioProvider: (() => { setBusVolume(bus: AudioBusName, v: number): void } | null) | null = null;

/** The frame wires the page's audio runtime here (kept out of this module's imports so tests stay DOM- and audio-free). */
export function setSettingsAudio(p: () => { setBusVolume(bus: AudioBusName, v: number): void } | null): void {
  audioProvider = p;
}

function defaultDeps(): ApplyDeps {
  return {
    audio: audioProvider?.() ?? null,
    doc: typeof document !== 'undefined' ? document : null,
    store: browserSettingsStore()
  };
}

/** Change settings: normalise, keep on the device, put into effect, tell listeners. Returns what is now in force. */
export function updateFrameSettings(patch: Partial<FrameSettings>, deps: ApplyDeps = defaultDeps(), now: number = Date.now()): Readonly<FrameSettings> {
  return replaceFrameSettings(normalizeSettings({ ...frameSettings(), ...patch, updatedAt: now }), deps);
}

/** Put a whole record in force as it is (the server's newer copy keeps its own updatedAt). */
export function replaceFrameSettings(rec: FrameSettings, deps: ApplyDeps = defaultDeps()): Readonly<FrameSettings> {
  const next = normalizeSettings(rec);
  current = next;
  routes = keyRoutes(next.keys);
  saveSettings(next, deps.store ?? null);
  applyFrameSettings(next, deps);
  for (const cb of listeners) cb(next);
  return next;
}

/** Test seam: forget the in-memory record (the next read loads from the device again). */
export function resetFrameSettingsForTest(): void {
  current = null;
  routes = keyRoutes(DEFAULT_KEYS);
  listeners.clear();
}

// Getters other domains read (cheap: no allocation, safe every frame).

/** world: what WorldHandle.setLookSettings gets */
export function lookSettingsOf(s: Readonly<FrameSettings>): { mouse: number; touch: number; invertY: boolean } {
  return { mouse: s.lookMouse, touch: s.lookTouch, invertY: s.invertY };
}
/** The graphics contract of the performance lane: `WorldHandle.setGraphics?(g)`, applied live (world/engine.ts). */
export interface GraphicsSettings {
  quality: Quality;
  viewChunks: number | null;
  shadows: boolean | null;
  renderScale: number | null;
}
export function graphicsOf(s: Readonly<FrameSettings>): GraphicsSettings {
  return { quality: s.quality, viewChunks: s.viewChunks, shadows: s.shadows, renderScale: s.renderScale };
}
export function sameGraphics(a: GraphicsSettings, b: GraphicsSettings): boolean {
  return a.quality === b.quality && a.viewChunks === b.viewChunks && a.shadows === b.shadows && a.renderScale === b.renderScale;
}

/** dialog: NPC voice speed multiplier */
export function voiceRate(): number {
  return frameSettings().voiceRate;
}

/**
 * dialog: which English voice speaks. "Natural voice" on prefers the browser's neural voices (online ones such as
 * "… Online (Natural)" or Google's), off prefers voices made on this device. US English first, then any English.
 */
export function pickEnglishVoice<V extends { lang: string; name: string; localService: boolean }>(voices: readonly V[], neural: boolean): V | undefined {
  const en = voices.filter((v) => v.lang.replace('_', '-').toLowerCase().startsWith('en'));
  const isNeural = (v: V): boolean => /natural|neural|online|google|premium|enhanced/i.test(v.name) || !v.localService;
  const rank = (v: V): number => (isNeural(v) === neural ? 0 : 2) + (v.lang.replace('_', '-').toLowerCase() === 'en-us' ? 0 : 1);
  return [...en].sort((a, b) => rank(a) - rank(b))[0];
}
/** world/menus/dialog: fewer moving effects (the setting, else the device preference) */
export function motionReduced(): boolean {
  return frameSettings().reduceMotion ?? deviceReducesMotion();
}
/** App.pickTier: the quality picked in settings (null = decide from the device) */
export function savedTier(): WorldTier | null {
  const q = frameSettings().quality;
  return q === 'auto' ? null : q;
}
/** dialog: hold the mic button / Space while talking instead of tap on, tap off */
export function micHoldMode(): boolean {
  return frameSettings().micMode === 'hold';
}
/** dialog: split the target sentence into syllables (docs/08 11장 읽기) */
export function syllableHints(): boolean {
  return frameSettings().syllables;
}

// ---- key remap on the page

/** A key-capture UI (the settings panel) takes every key while it waits for one. */
let capturing = false;
export function setKeyCapture(on: boolean): void {
  capturing = on;
}

function typingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  if (el.tagName === 'INPUT') {
    const type = ((el as HTMLInputElement).type || 'text').toLowerCase();
    return !['button', 'submit', 'reset', 'checkbox', 'radio', 'image', 'color', 'file'].includes(type);
  }
  return el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable === true;
}

function pressableTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  return el.tagName === 'BUTTON' || el.tagName === 'A' || el.tagName === 'INPUT' || el.getAttribute?.('role') === 'button';
}

/** Space, Enter and Tab stay with a focused button (same rule as the world's PAGE_KEYS_ON_BUTTONS). */
const BUTTON_KEYS: ReadonlySet<string> = new Set(['Space', 'Enter', 'NumpadEnter', 'Tab']);

export function keyScopeOf(doc: Pick<Document, 'querySelector'>): KeyScope {
  if (doc.querySelector('.lcw-dlg, .lcw-firstvisit, [data-lcw-keys="off"]')) return 'off';
  if (doc.querySelector('.lcw-menu')) return 'menu';
  return 'world';
}

/**
 * Re-bound keys for the whole page without touching the world's input code: a capture listener on window (first in
 * line) swallows the pressed key and dispatches the world's own key from the same target. Returns the remover.
 */
export function installKeyRemap(win: Window = window): () => void {
  const synthetic = new WeakSet<Event>();
  const handler = (e: KeyboardEvent): void => {
    if (synthetic.has(e) || capturing) return;
    if (routes.to.size === 0 && routes.blocked.size === 0) return;
    if (typingTarget(e.target)) return;
    const held = e.type === 'keyup' ? routes.to.get(e.code) : undefined;
    const r: KeyRoute = held ? { kind: 'to', code: held.code } : routeKey(e.code, routes, keyScopeOf(win.document));
    if (r.kind === 'pass') return;
    if (r.kind === 'block' && pressableTarget(e.target) && BUTTON_KEYS.has(e.code)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (r.kind !== 'to') return;
    const ev = new KeyboardEvent(e.type, {
      code: r.code,
      key: keyValueOf(r.code),
      repeat: e.repeat,
      bubbles: true,
      cancelable: true,
      composed: true,
      shiftKey: e.shiftKey,
      ctrlKey: e.ctrlKey,
      altKey: e.altKey,
      metaKey: e.metaKey
    });
    synthetic.add(ev);
    (e.target ?? win).dispatchEvent(ev);
  };
  win.addEventListener('keydown', handler, true);
  win.addEventListener('keyup', handler, true);
  return () => {
    win.removeEventListener('keydown', handler, true);
    win.removeEventListener('keyup', handler, true);
  };
}

/**
 * App start (FrameLayer): load the record, put it into effect, start the key remap; also re-apply when the device's
 * own reduced-motion preference changes. Returns the cleanup.
 */
export function startFrameSettings(audio: () => { setBusVolume(bus: AudioBusName, v: number): void } | null): () => void {
  setSettingsAudio(audio);
  current = loadSettings();
  routes = keyRoutes(current.keys);
  applyFrameSettings(current);
  const off = typeof window !== 'undefined' ? installKeyRemap(window) : () => undefined;
  deviceReducesMotion();
  const onMq = (): void => applyFrameSettings(frameSettings());
  motionQuery?.addEventListener?.('change', onMq);
  return () => {
    off();
    motionQuery?.removeEventListener?.('change', onMq);
  };
}
