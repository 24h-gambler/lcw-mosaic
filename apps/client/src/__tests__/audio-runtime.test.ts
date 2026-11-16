import { describe, expect, it } from 'vitest';
import { BUS_DEFAULT_VOLUMES, DUCK_RELEASE_MS, PROCEDURAL_SFX_PRESETS, dbToGain } from '@lcw/audio';
import { createAudioRuntime, onPageActivation, type RuntimeClock } from '../audio/runtime.js';

/**
 * WP-110 / docs/12 on the client: one graph (buses -> master 70% -> high-pass 40 Hz -> limiter -1 dB), the NPC voice
 * and the open mic duck the game buses, and recording starts only after NPC end + 150 ms + the cue.
 */

function fakeClock() {
  let now = 0;
  const timers: Array<{ at: number; fn: () => void; id: number }> = [];
  let seq = 0;
  const clock: RuntimeClock = {
    now: () => now,
    setTimeout: (fn, ms) => {
      const id = ++seq;
      timers.push({ at: now + ms, fn, id });
      return id;
    },
    clearTimeout: (id) => {
      const i = timers.findIndex((t) => t.id === id);
      if (i >= 0) timers.splice(i, 1);
    }
  };
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const t = timers[0];
      if (!t || t.at > end) break;
      timers.shift();
      now = t.at;
      t.fn();
    }
    now = end;
  };
  return { clock, advance, now: () => now };
}

type Param = { value: number; calls: Array<[string, ...number[]]>; setTargetAtTime(v: number, t: number, tc: number): void; setValueAtTime(v: number, t: number): void; cancelScheduledValues(t: number): void };
function param(v = 1): Param {
  const p: Param = {
    value: v,
    calls: [],
    setTargetAtTime(val, t, tc) {
      p.calls.push(['target', val, t, tc]);
      p.value = val;
    },
    setValueAtTime(val, t) {
      p.calls.push(['set', val, t]);
      p.value = val;
    },
    cancelScheduledValues() {}
  };
  return p;
}

function fakeContext() {
  const edges: Array<[string, string]> = [];
  let n = 0;
  const node = (kind: string, extra: Record<string, unknown> = {}) => {
    const name = `${kind}#${++n}`;
    const self: Record<string, unknown> = {
      name,
      ...extra,
      connect(to: { name: string }) {
        edges.push([name, to.name]);
        return to;
      },
      disconnect() {}
    };
    return self;
  };
  const destination = { name: 'destination' };
  const played: string[] = [];
  const ctx = {
    currentTime: 0,
    state: 'running',
    destination,
    resume: async () => undefined,
    createGain: () => node('gain', { gain: param(1) }),
    createBiquadFilter: () => node('biquad', { type: 'lowpass', frequency: param(350), Q: param(1) }),
    createDynamicsCompressor: () => node('limiter', { threshold: param(-24), knee: param(30), ratio: param(12), attack: param(0.003), release: param(0.25) }),
    createBuffer: (_c: number, len: number) => ({ getChannelData: () => new Float32Array(len) }),
    createBufferSource: () => {
      const s = node('source', { buffer: null as unknown });
      (s as { start: () => void }).start = () => played.push(String(s.name));
      return s;
    }
  };
  return { ctx: ctx as unknown as AudioContext, edges, played };
}

describe('audio runtime graph (docs/12 2장)', () => {
  it('every bus feeds master 70% -> high-pass 40 Hz -> limiter -1 dB -> output, at the default volumes', () => {
    const f = fakeContext();
    const rt = createAudioRuntime({ clock: fakeClock().clock, createContext: () => f.ctx });
    expect(rt.unlock()).toBe(f.ctx);
    const master = f.edges.find(([, to]) => to.startsWith('biquad'))![0];
    const masterNode = f.edges.filter(([, to]) => to === master).map(([from]) => from);
    expect(masterNode).toHaveLength(6);
    const hp = f.edges.find(([from]) => from === master)![1];
    const lim = f.edges.find(([from]) => from === hp)![1];
    expect(lim.startsWith('limiter')).toBe(true);
    expect(f.edges.find(([from]) => from === lim)![1]).toBe('destination');
    for (const b of ['bgm', 'amb', 'sfx', 'ui', 'voice_npc', 'voice_lesson'] as const) {
      expect((rt.bus(b) as unknown as { gain: Param }).gain.value).toBeCloseTo(Math.min(0.89125, BUS_DEFAULT_VOLUMES[b]), 4);
    }
  });

  it('no context before the first tap (no "AudioContext was not allowed to start" warning); built on the unlock after it', () => {
    const f = fakeContext();
    let made = 0;
    let tapped = false;
    const rt = createAudioRuntime({ clock: fakeClock().clock, createContext: () => (made++, f.ctx), activated: () => tapped });
    expect(rt.unlock()).toBeNull();
    expect(rt.bus('ui')).toBeNull();
    expect(made).toBe(0);
    tapped = true;
    expect(rt.unlock()).toBe(f.ctx);
    expect(rt.unlock()).toBe(f.ctx);
    expect(made).toBe(1);
  });

  it('opens on the first activating event (pointerup/click/touchend/keydown), once, and stops cleanly', () => {
    const t = new EventTarget();
    let n = 0;
    const stop = onPageActivation(() => n++, t as unknown as Window);
    t.dispatchEvent(new Event('pointerdown'));
    expect(n).toBe(0);
    t.dispatchEvent(new Event('pointerup'));
    t.dispatchEvent(new Event('click'));
    expect(n).toBe(1);
    stop();
    let m = 0;
    const stop2 = onPageActivation(() => m++, t as unknown as Window);
    stop2();
    t.dispatchEvent(new Event('keydown'));
    expect(m).toBe(0);
  });

  it('no WebAudio: nothing throws, buses are null and the mic still opens on time', async () => {
    const c = fakeClock();
    const rt = createAudioRuntime({ clock: c.clock, createContext: () => null });
    expect(rt.unlock()).toBeNull();
    expect(rt.bus('sfx')).toBeNull();
    const p = rt.micCue();
    c.advance(1000);
    expect(await p).toBe(true);
  });
});

describe('NPC voice and mic ducking (docs/12 3장)', () => {
  it('NPC talking ducks music -12 dB; a tap cuts the voice, waits 150 ms + cue; the open mic ducks -24 dB; closing returns over 400 ms', async () => {
    const c = fakeClock();
    const f = fakeContext();
    let cut = 0;
    const rt = createAudioRuntime({ clock: c.clock, createContext: () => f.ctx, cutNpcVoice: () => cut++ });
    rt.unlock();
    const bgm = rt.bus('bgm') as unknown as { gain: Param };
    const base = rt.targets().bgm;
    rt.npcVoiceStarted(2000);
    expect(rt.targets().bgm).toBeCloseTo(base * dbToGain(-12), 5);

    c.advance(500);
    let started = false;
    const p = rt.micCue().then((ok) => (started = ok));
    expect(cut).toBe(1); // the voice is cut first
    c.advance(149);
    await Promise.resolve();
    expect(started).toBe(false);
    expect(f.played).toHaveLength(0);
    c.advance(1); // 150 ms after the cut: the cue plays
    expect(f.played).toHaveLength(1);
    c.advance(PROCEDURAL_SFX_PRESETS['dlg.mic_on']!.durationMs - 1);
    await Promise.resolve();
    expect(started).toBe(false); // the cue is still sounding
    c.advance(1);
    await p;
    expect(started).toBe(true);
    expect(rt.targets().bgm).toBeCloseTo(base * dbToGain(-24), 5);
    expect(rt.targets().amb).toBeCloseTo(BUS_DEFAULT_VOLUMES.amb * dbToGain(-18), 5);
    // UI sounds do not play while recording; the mic cues themselves do
    expect(rt.admit('ui.click', 'ui', 30).ok).toBe(false);
    expect(rt.admit('dlg.mic_off', 'ui', 85).ok).toBe(true);

    rt.micClosed();
    expect(rt.targets().bgm).toBeCloseTo(base, 5);
    const last = bgm.gain.calls.filter((x) => x[0] === 'target').pop()!;
    expect(last[3]).toBeCloseTo(DUCK_RELEASE_MS.mic_open / 3000, 6);
  });

  it('a second tap during the cue cancels the start; the NPC voice ending on its own lifts its duck', async () => {
    const c = fakeClock();
    const rt = createAudioRuntime({ clock: c.clock, createContext: () => null });
    const p = rt.micCue(); // no NPC voice: the cue plays now, recording would start after its 60 ms
    c.advance(30);
    rt.cancelMic();
    expect(await p).toBe(false);
    c.advance(1000);
    expect(rt.engine.getSnapshot().micOpen).toBe(false);

    const base = rt.targets().sfx;
    rt.npcVoiceStarted(800);
    expect(rt.targets().sfx).toBeCloseTo(base * dbToGain(-6), 5);
    rt.npcVoiceEnded();
    expect(rt.targets().sfx).toBeCloseTo(base, 5);
  });

  it('a hidden tab stops music and ambience; the call bus keeps playing', () => {
    const rt = createAudioRuntime({ clock: fakeClock().clock, createContext: () => null });
    rt.setHidden(true);
    expect(rt.targets().bgm).toBe(0);
    expect(rt.targets().amb).toBe(0);
    expect(rt.targets().voice_lesson).toBeGreaterThan(0);
    rt.setHidden(false);
    expect(rt.targets().bgm).toBeGreaterThan(0);
  });

  it('explosions through the runtime: 20 inside 100 ms are admitted once', () => {
    const c = fakeClock();
    const rt = createAudioRuntime({ clock: c.clock, createContext: () => null });
    let ok = 0;
    for (let i = 0; i < 20; i++) {
      if (rt.admit('exp.boom.m', 'sfx', 600).ok) ok++;
      c.advance(5);
    }
    expect(ok).toBe(1);
  });
});
