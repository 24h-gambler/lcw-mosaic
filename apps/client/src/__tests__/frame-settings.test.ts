import { afterEach, describe, expect, it } from 'vitest';
import { BUS_DEFAULT_VOLUMES } from '@lcw/audio';
import { COLOR_ASSIST_TOKENS } from '@lcw/ui';
import {
  DEFAULT_KEYS,
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  SETTINGS_CSS,
  busVolumesFor,
  documentStateFor,
  frameSettings,
  keyRoutes,
  loadSettings,
  normalizeSettings,
  onFrameSettings,
  parseSettings,
  pickEnglishVoice,
  rebindKey,
  resetFrameSettingsForTest,
  routeKey,
  savedTier,
  saveSettings,
  updateFrameSettings,
  keyScopeOf,
  lookSettingsOf,
  type SettingsStore
} from '../frame/settings.js';
import { fitsServer, fromServerSettings, otherKeys, pickNewer, putServerSettings, startSettingsSync, toMs, toServerSettings } from '../frame/settings-sync.js';
import { createAudioRuntime } from '../audio/runtime.js';
import { pickTier } from '../App.js';

/** G14 설정 (docs/08 8.6, 11장; docs/12 2장): store, restore, ranges, bus gains, key remap, server copy. */

function memStore(init: Record<string, string> = {}): SettingsStore & { data: Record<string, string> } {
  const data = { ...init };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
}

afterEach(() => resetFrameSettingsForTest());

describe('settings record', () => {
  it('saves to the device and comes back the same', () => {
    const st = memStore();
    const s = normalizeSettings({ ...DEFAULT_SETTINGS, textScale: 1.3, lookMouse: 1.5, invertY: true, autoJump: true, volume: { master: 0.5, music: 0, effects: 1, voice: 0.8 } });
    expect(saveSettings(s, st)).toBe(true);
    expect(JSON.parse(st.data[SETTINGS_KEY]!)).toMatchObject({ textScale: 1.3, lookMouse: 1.5, invertY: true, autoJump: true });
    expect(loadSettings(st)).toEqual(s);
  });

  it('clamps and snaps every range (text 100~150%, look 50~200%, volume 0~100%, voice speed 60~120%)', () => {
    const s = normalizeSettings({ textScale: 9, lookMouse: 0.01, lookTouch: 1.26, voiceRate: 0.1, volume: { master: -2, music: 1.7, effects: 0.333, voice: 'x' } });
    expect(s.textScale).toBe(1.5);
    expect(s.lookMouse).toBe(0.5);
    expect(s.lookTouch).toBe(1.3);
    expect(s.voiceRate).toBe(0.6);
    expect(s.volume).toEqual({ master: 0, music: 1, effects: 0.35, voice: 1 });
    expect(normalizeSettings({ textScale: 0.5 }).textScale).toBe(1);
  });

  it('garbage, old or broken records fall back to defaults instead of breaking the page', () => {
    expect(parseSettings('{not json')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings([1, 2])).toEqual(DEFAULT_SETTINGS);
    const s = normalizeSettings({ quality: 'ultra', micMode: 'shout', reduceMotion: 'yes', showFps: 1 });
    expect(s.quality).toBe('auto');
    expect(s.micMode).toBe('toggle');
    expect(s.reduceMotion).toBeNull();
    expect(s.showFps).toBe(false);
    // a key used twice or a reserved key: the whole key map goes back to the defaults
    expect(normalizeSettings({ keys: { ...DEFAULT_KEYS, jump: 'KeyW' } }).keys).toEqual(DEFAULT_KEYS);
    expect(normalizeSettings({ keys: { ...DEFAULT_KEYS, jump: 'Escape' } }).keys.jump).toBe('Space');
    const store = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(loadSettings(store)).toEqual(DEFAULT_SETTINGS);
    expect(saveSettings(DEFAULT_SETTINGS as never, store)).toBe(false);
  });

  it('a change is normalised, stamped, kept and announced; early readers (pickTier) see the stored choice', () => {
    const st = memStore({ [SETTINGS_KEY]: JSON.stringify({ quality: 'low' }) });
    expect(pickTier('', { hardwareConcurrency: 16, deviceMemory: 16 }, false, loadSettings(st).quality === 'auto' ? null : 'low')).toBe('low');
    expect(pickTier('?tier=high', {}, false, 'low')).toBe('high'); // the address still wins
    const seen: number[] = [];
    onFrameSettings((s) => seen.push(s.textScale));
    const next = updateFrameSettings({ textScale: 1.24 }, { store: st, audio: null, doc: null }, 1234);
    expect(next.textScale).toBe(1.2);
    expect(next.updatedAt).toBe(1234);
    expect(seen).toEqual([1.2]);
    expect(JSON.parse(st.data[SETTINGS_KEY]!).textScale).toBe(1.2);
    updateFrameSettings({ quality: 'high' }, { store: st, audio: null, doc: null });
    expect(savedTier()).toBe('high');
    expect(frameSettings().quality).toBe('high');
  });
});

describe('auto jump (Dan 11-16 R2625)', () => {
  it('is off by default, reaches the world with the look settings and the server copy', () => {
    expect(DEFAULT_SETTINGS.autoJump).toBe(false);
    expect(normalizeSettings({ autoJump: 'yes' }).autoJump).toBe(false);
    expect(lookSettingsOf(normalizeSettings({ autoJump: true }))).toMatchObject({ autoJump: true });
    const back = fromServerSettings(toServerSettings(normalizeSettings({ autoJump: true })), null);
    expect(back.autoJump).toBe(true);
  });
});

describe('sound: volumes reach the audio runtime buses (docs/12 2장)', () => {
  it('bus volume = docs/12 default x group slider x master', () => {
    const v = busVolumesFor({ master: 0.5, music: 0.5, effects: 1, voice: 0 });
    expect(v.bgm).toBeCloseTo(BUS_DEFAULT_VOLUMES.bgm * 0.25, 6);
    expect(v.amb).toBeCloseTo(BUS_DEFAULT_VOLUMES.amb * 0.25, 6);
    expect(v.sfx).toBeCloseTo(BUS_DEFAULT_VOLUMES.sfx * 0.5, 6);
    expect(v.ui).toBeCloseTo(BUS_DEFAULT_VOLUMES.ui * 0.5, 6);
    expect(v.voice_npc).toBe(0);
    expect(v.voice_lesson).toBe(0);
    expect(busVolumesFor(DEFAULT_SETTINGS.volume)).toEqual(BUS_DEFAULT_VOLUMES);
  });

  it('updateFrameSettings moves the real bus gain nodes of the runtime', () => {
    const gains: Array<{ value: number }> = [];
    const param = (v: number) => {
      const p = { value: v, setTargetAtTime: (x: number) => void (p.value = x), setValueAtTime: (x: number) => void (p.value = x), cancelScheduledValues: () => undefined };
      return p;
    };
    const node = (extra: Record<string, unknown>) => ({ ...extra, connect: (to: unknown) => to, disconnect: () => undefined });
    const ctx = {
      currentTime: 0,
      state: 'running',
      destination: {},
      resume: async () => undefined,
      createGain: () => {
        const g = node({ gain: param(1) });
        gains.push((g as unknown as { gain: { value: number } }).gain);
        return g;
      },
      createBiquadFilter: () => node({ type: '', frequency: param(0) }),
      createDynamicsCompressor: () => node({ threshold: param(0), knee: param(0), ratio: param(0), attack: param(0), release: param(0) })
    } as unknown as AudioContext;
    const rt = createAudioRuntime({ createContext: () => ctx });
    rt.unlock();
    updateFrameSettings({ volume: { master: 1, music: 0, effects: 0.5, voice: 1 } }, { audio: rt, store: null, doc: null });
    expect((rt.bus('bgm') as unknown as { gain: { value: number } }).gain.value).toBe(0);
    expect((rt.bus('sfx') as unknown as { gain: { value: number } }).gain.value).toBeCloseTo(BUS_DEFAULT_VOLUMES.sfx * 0.5, 4);
    expect(rt.engine.getSnapshot().busVolumes.voice_npc).toBe(BUS_DEFAULT_VOLUMES.voice_npc);
    expect(rt.targets().amb).toBe(0);
  });
});

describe('screen and access: the document state', () => {
  it('text size, motion, readable font, colour assist and focus ring become <html> state', () => {
    const on = documentStateFor({ ...DEFAULT_SETTINGS, textScale: 1.5, reduceMotion: true, readableFont: true, colorAssist: true, strongFocus: true }, false);
    expect(on.vars['--lcw-fs']).toBe('1.5');
    expect(on.attrs).toEqual({ 'data-lcw-motion': 'reduce', 'data-lcw-font': 'readable', 'data-lcw-palette': 'assist', 'data-lcw-focus': 'strong' });
    const off = documentStateFor(DEFAULT_SETTINGS, false);
    expect(Object.values(off.attrs).every((v) => v === null)).toBe(true);
    // "follow the device" honours prefers-reduced-motion; an explicit off overrides it
    expect(documentStateFor(DEFAULT_SETTINGS, true).attrs['data-lcw-motion']).toBe('reduce');
    expect(documentStateFor({ ...DEFAULT_SETTINGS, reduceMotion: false }, true).attrs['data-lcw-motion']).toBeNull();
  });

  it('the stylesheet swaps palette tokens on the menu and dialog roots and uses the dyslexic face', () => {
    for (const [k, v] of Object.entries(COLOR_ASSIST_TOKENS)) expect(SETTINGS_CSS).toContain(`--c-${k}:${v};`);
    expect(SETTINGS_CSS).toContain('html[data-lcw-palette="assist"] .lcw-menu');
    expect(SETTINGS_CSS).toContain('html[data-lcw-palette="assist"] .lcw-dlg');
    expect(SETTINGS_CSS).toContain('"OpenDyslexic"');
    expect(SETTINGS_CSS).toMatch(/data-lcw-focus="strong"\] :focus:not\(canvas\)\{outline:5px/);
  });
});

describe('keys: re-binding and routing (docs/08 7.1 모든 키는 설정에서 바꿀 수 있습니다)', () => {
  it('re-binding to a free key routes it to the world key and blocks the old one', () => {
    const r = rebindKey(DEFAULT_KEYS, 'jump', 'KeyJ');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.swappedWith).toBeNull();
    const routes = keyRoutes(r.keys);
    expect(routeKey('KeyJ', routes, 'world')).toEqual({ kind: 'to', code: 'Space' });
    expect(routeKey('Space', routes, 'world')).toEqual({ kind: 'block' });
    expect(routeKey('KeyW', routes, 'world')).toEqual({ kind: 'pass' });
    expect(routeKey('KeyJ', routes, 'off')).toEqual({ kind: 'pass' }); // a dialog has the keys
    expect(routeKey('KeyJ', routes, 'menu')).toEqual({ kind: 'pass' }); // jumping is not a menu key
  });

  it('a key another action had is swapped, so no key ever does two things', () => {
    const r = rebindKey(DEFAULT_KEYS, 'talk', 'Space');
    if (!r.ok) throw new Error('expected ok');
    expect(r.swappedWith).toBe('jump');
    expect(r.keys.talk).toBe('Space');
    expect(r.keys.jump).toBe('KeyE');
    const routes = keyRoutes(r.keys);
    expect(routeKey('Space', routes, 'world')).toEqual({ kind: 'to', code: 'KeyE' });
    expect(routeKey('KeyE', routes, 'world')).toEqual({ kind: 'to', code: 'Space' });
    expect(routes.blocked.size).toBe(0);
  });

  it('menu keys still work inside the menu; reserved keys cannot be taken', () => {
    const r = rebindKey(DEFAULT_KEYS, 'bag', 'KeyB');
    if (!r.ok) throw new Error('expected ok');
    const routes = keyRoutes(r.keys);
    expect(routeKey('KeyB', routes, 'menu')).toEqual({ kind: 'to', code: 'KeyI' });
    expect(routeKey('KeyI', routes, 'menu')).toEqual({ kind: 'block' });
    for (const c of ['Escape', 'Digit3', 'ArrowUp', 'Enter']) expect(rebindKey(DEFAULT_KEYS, 'jump', c)).toEqual({ ok: false, reason: 'reserved' });
  });

  it('scope follows what is open: dialog > menu > world', () => {
    const doc = (sel: string[]) => ({ querySelector: (q: string) => (q.split(',').some((x) => sel.includes(x.trim())) ? {} : null) }) as unknown as Document;
    expect(keyScopeOf(doc([]))).toBe('world');
    expect(keyScopeOf(doc(['.lcw-menu']))).toBe('menu');
    expect(keyScopeOf(doc(['.lcw-menu', '.lcw-firstvisit']))).toBe('off');
    expect(keyScopeOf(doc(['.lcw-dlg']))).toBe('off');
  });
});

describe('NPC voice', () => {
  const voices = [
    { name: 'Microsoft David', lang: 'en-US', localService: true },
    { name: 'Microsoft Aria Online (Natural) - English (United States)', lang: 'en-US', localService: false },
    { name: 'Google UK English Female', lang: 'en-GB', localService: false },
    { name: 'Yuna', lang: 'ko-KR', localService: true }
  ];
  it('natural voice on picks a neural US voice, off picks a device voice; never a non-English one', () => {
    expect(pickEnglishVoice(voices, true)?.name).toContain('Aria');
    expect(pickEnglishVoice(voices, false)?.name).toBe('Microsoft David');
    expect(pickEnglishVoice([voices[3]!], true)).toBeUndefined();
    expect(pickEnglishVoice([voices[2]!], false)?.name).toContain('Google'); // only one English voice: still speaks
    expect(DEFAULT_SETTINGS.neuralVoice).toBe(true);
  });
});

describe('server copy (GET/PUT /v1/settings, newest wins)', () => {
  it('flattens within the server limits and comes back equal', () => {
    const s = normalizeSettings({ ...DEFAULT_SETTINGS, keys: { ...DEFAULT_KEYS, jump: 'KeyJ', run: 'KeyQ' }, textScale: 1.4, reduceMotion: true, updatedAt: 5000 });
    const flat = toServerSettings(s);
    expect(Object.keys(flat).length).toBeLessThanOrEqual(40);
    expect(fitsServer(flat)).toBe(true);
    expect(Object.values(flat).every((v) => ['number', 'boolean', 'string'].includes(typeof v))).toBe(true);
    expect(fromServerSettings(flat, 5)).toEqual(s);
    expect(fromServerSettings({ ...flat, reduceMotion: 'auto' }, null).reduceMotion).toBeNull();
    expect(toMs(1_700_000_000)).toBe(1_700_000_000_000);
    expect(toMs(1_700_000_000_000)).toBe(1_700_000_000_000);
  });

  it('pickNewer: the newer copy wins, an empty server gets the device copy', () => {
    const dev = { ...DEFAULT_SETTINGS, updatedAt: 100 } as never;
    expect(pickNewer(dev, { ...DEFAULT_SETTINGS, updatedAt: 200 })).toBe('server');
    expect(pickNewer(dev, { ...DEFAULT_SETTINGS, updatedAt: 50 })).toBe('device');
    expect(pickNewer(dev, null)).toBe('device');
    expect(pickNewer(DEFAULT_SETTINGS, null)).toBe('same');
  });

  it('start: a newer server copy is applied; later changes are PUT once after the pause; 404 stays quiet', async () => {
    const calls: Array<{ url: string; method: string; body?: string; auth?: string }> = [];
    const server = toServerSettings(normalizeSettings({ textScale: 1.5, updatedAt: 9_000 }));
    const fetchImpl = async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body as string | undefined, auth: (init?.headers as Record<string, string>)?.authorization });
      return new Response(JSON.stringify(init?.method === 'PUT' ? { ok: true } : { settings: server, updated_at: 9 }), { status: 200 });
    };
    const timers: Array<() => void> = [];
    let applied: number | null = null;
    const stop = startSettingsSync({ token: 't'.repeat(40), fetchImpl, apply: (s) => (applied = s.textScale), timers: { set: (fn) => timers.push(fn), clear: () => undefined } });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(applied).toBe(1.5);
    expect(calls[0]).toMatchObject({ url: '/v1/settings', method: 'GET', auth: `Bearer ${'t'.repeat(40)}` });
    updateFrameSettings({ showFps: true }, { store: null, audio: null, doc: null });
    updateFrameSettings({ showFps: false }, { store: null, audio: null, doc: null });
    expect(timers.length).toBe(2); // debounced: the first is cleared by the second
    timers.at(-1)!();
    await new Promise((r) => setTimeout(r, 0));
    const put = calls.find((c) => c.method === 'PUT')!;
    expect(JSON.parse(put.body!).settings.showFps).toBe(false);
    stop();

    const quiet: string[] = [];
    const stop2 = startSettingsSync({
      token: 'x'.repeat(40),
      fetchImpl: async (u, init) => {
        quiet.push(init?.method ?? 'GET');
        return new Response('', { status: 404 });
      },
      timers: { set: (fn) => fn(), clear: () => undefined }
    });
    await new Promise((r) => setTimeout(r, 0));
    updateFrameSettings({ showFps: true }, { store: null, audio: null, doc: null });
    await new Promise((r) => setTimeout(r, 0));
    expect(quiet).toEqual(['GET']); // no route yet: device only, no PUT storm
    stop2();
  });
});

describe('server row shared with other parts (the adventure keeps adv there)', () => {
  const tok = 'k'.repeat(40);
  const own = () => toServerSettings(normalizeSettings({ textScale: 1.2, updatedAt: 7_000 }));

  it('otherKeys keeps only the keys this record does not write, plain values only', () => {
    expect(otherKeys({ ...own(), adv: 'd3s12', extra: 2, bad: { x: 1 }, nan: Number.NaN })).toEqual({ adv: 'd3s12', extra: 2 });
    expect(otherKeys(null)).toEqual({});
  });

  it('a PUT reads the row again and sends its other keys back as they are now', async () => {
    let adv = 'd1s3';
    const puts: Array<Record<string, unknown>> = [];
    const fetchImpl = async (_u: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        puts.push(JSON.parse(init.body as string).settings);
        return new Response('{"ok":true}', { status: 200 });
      }
      return new Response(JSON.stringify({ settings: { ...own(), adv }, updated_at: 7 }), { status: 200 });
    };
    const timers: Array<() => void> = [];
    const stop = startSettingsSync({ token: tok, fetchImpl, apply: () => undefined, timers: { set: (fn) => timers.push(fn), clear: () => undefined } });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    adv = 'd2s9'; // the adventure wrote after the start
    updateFrameSettings({ showFps: true }, { store: null, audio: null, doc: null });
    timers.at(-1)!();
    for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
    expect(puts).toHaveLength(1);
    expect(puts[0]).toMatchObject({ adv: 'd2s9', showFps: true });
    stop();
  });

  it('the start PUT of a newer device copy keeps the other keys of the row it just read', async () => {
    const puts: Array<Record<string, unknown>> = [];
    const fetchImpl = async (_u: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        puts.push(JSON.parse(init.body as string).settings);
        return new Response('{"ok":true}', { status: 200 });
      }
      return new Response(JSON.stringify({ settings: { adv: 'd1s3' }, updated_at: 1 }), { status: 200 }); // only the adventure's key
    };
    updateFrameSettings({ textScale: 1.3 }, { store: null, audio: null, doc: null }); // the device copy has a time
    const stop = startSettingsSync({ token: tok, fetchImpl, apply: () => undefined, timers: { set: () => 0, clear: () => undefined } });
    for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
    expect(puts).toHaveLength(1);
    expect(puts[0]).toMatchObject({ adv: 'd1s3', textScale: 1.3 });
    stop();
  });

  it('nothing is sent when the row cannot be read, or when the merged row would not fit the server', async () => {
    const methods: string[] = [];
    const down = await putServerSettings(normalizeSettings({}), {
      token: tok,
      fetchImpl: async (_u, init) => {
        methods.push(init?.method ?? 'GET');
        return new Response('', { status: 503 });
      }
    });
    expect(down).toBe(false);
    expect(methods).toEqual(['GET']);

    const full: Record<string, string> = {};
    for (let i = 0; i < 30; i++) full[`x${i}`] = 'v';
    const sent: string[] = [];
    const over = await putServerSettings(normalizeSettings({}), {
      token: tok,
      fetchImpl: async (_u, init) => {
        sent.push(init?.method ?? 'GET');
        return new Response(JSON.stringify({ settings: full, updated_at: 1 }), { status: 200 });
      }
    });
    expect(over).toBe(false);
    expect(sent).toEqual(['GET']);
  });
});

describe('graphics contract (WorldHandle.setGraphics, performance lane)', () => {
  it('quality + view distance + shadows + render scale, null = the tier default, clamped', async () => {
    const { graphicsOf, sameGraphics } = await import('../frame/settings.js');
    const s = normalizeSettings({ quality: 'low', viewChunks: 12, shadows: true, renderScale: 0.3 });
    expect(graphicsOf(s)).toEqual({ quality: 'low', viewChunks: 8, shadows: true, renderScale: 0.5 });
    expect(graphicsOf(DEFAULT_SETTINGS)).toEqual({ quality: 'auto', viewChunks: null, shadows: null, renderScale: null });
    expect(sameGraphics(graphicsOf(s), graphicsOf({ ...s }))).toBe(true);
    const flat = toServerSettings(s);
    expect(Object.keys(flat).length).toBeLessThanOrEqual(40);
    expect(fromServerSettings(flat, null)).toEqual(s);
    expect(fromServerSettings(toServerSettings(DEFAULT_SETTINGS as never), null).viewChunks).toBeNull();
  });
});

describe('natural voice switch reaches the server neural voice (dialog/neural-voice.ts)', () => {
  it('off in settings: neuralVoiceOn() is false even when the server says on', async () => {
    const nv = await import('../dialog/neural-voice.js');
    nv.resetNeuralVoice();
    await nv.neuralVoiceStatus('', (async () => new Response(JSON.stringify({ enabled: true }), { status: 200 })) as typeof fetch);
    updateFrameSettings({ neuralVoice: true }, { store: null, audio: null, doc: null });
    expect(nv.neuralVoiceOn()).toBe(true);
    updateFrameSettings({ neuralVoice: false }, { store: null, audio: null, doc: null });
    expect(nv.neuralVoiceOn()).toBe(false);
    nv.resetNeuralVoice();
  });
});
