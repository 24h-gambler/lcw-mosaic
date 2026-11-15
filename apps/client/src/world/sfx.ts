/**
 * Procedural placeholder sounds (docs/12 6.4 "임시 소리 만들기") played with WebAudio until recorded files land.
 * IDs follow docs/12 6.2. Footsteps and the build ladder vary pitch so repetition does not sound mechanical (6.1, 6.3).
 * Silent (no-op) where WebAudio is missing; nothing plays before the first user gesture (autoplay rules).
 */
import { PROCEDURAL_SFX_PRESETS, getLadderSemitoneOffset } from '@lcw/audio';

type Ctx = AudioContext;

export class Sfx {
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private ambient: { stop(): void } | null = null;
  private ladderStep = 0;
  private ladderAt = 0;
  private lastBubble = 0;
  muted = false;

  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC: typeof AudioContext | undefined =
      typeof window !== 'undefined'
        ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
        : undefined;
    if (!AC) return;
    try {
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      // Gentle limiter so stacked effects never clip (docs/12 4장 청력 보호).
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -10;
      comp.ratio.value = 8;
      this.master.connect(comp).connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      let s = 12345;
      for (let i = 0; i < len; i++) {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        d[i] = (s / 0x7fffffff) * 2 - 1;
      }
    } catch {
      this.ctx = null;
    }
  }

  private tone(freqStart: number, freqEnd: number, dur: number, type: OscillatorType, gain: number, delay = 0): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.muted) return;
    const t0 = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freqStart, t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  private noise(dur: number, gain: number, filter: BiquadFilterType, freq: number, delay = 0, q = 1): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noiseBuf || this.muted) return;
    const t0 = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.8 + ((t0 * 977) % 1) * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t0, (t0 * 0.37) % 0.5);
    src.stop(t0 + dur + 0.02);
  }

  play(id: string, opts: { pitch?: number } = {}): void {
    if (!this.ctx) return;
    const p = Math.pow(2, (opts.pitch ?? 0) / 12);
    switch (id) {
      case 'ui.click':
        this.tone(1200 * p, 1100 * p, 0.03, 'square', 0.08);
        return;
      case 'ui.open':
        this.noise(0.12, 0.12, 'bandpass', 1800, 0, 0.8);
        return;
      case 'dlg.pass.1':
        this.tone(523.25, 523.25, 0.16, 'triangle', 0.32);
        return;
      case 'dlg.pass.2':
        [523.25, 659.25].forEach((f, i) => this.tone(f, f, 0.16, 'triangle', 0.32, i * 0.08));
        return;
      case 'dlg.pass.3':
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone(f, f, 0.2, 'triangle', 0.32, i * 0.08));
        this.tone(2093, 2093, 0.4, 'sine', 0.06, 0.34);
        return;
      case 'dlg.again':
        this.noise(0.05, 0.25, 'lowpass', 800);
        return;
      case 'item.get':
        this.tone(1318.5, 1760, 0.12, 'sine', 0.22);
        this.tone(1760, 2349, 0.14, 'sine', 0.16, 0.07);
        this.noise(0.08, 0.06, 'highpass', 5000, 0.02);
        return;
      case 'eco.coin_gain':
        this.tone(988, 988, 0.06, 'square', 0.08);
        this.tone(1319, 1319, 0.12, 'square', 0.08, 0.06);
        return;
      case 'mp.bubble': {
        const now = this.ctx.currentTime;
        if (now - this.lastBubble < 0.15) return;
        this.lastBubble = now;
        this.tone(660, 990, 0.07, 'sine', 0.18);
        return;
      }
      case 'wld.door':
        this.noise(0.35, 0.12, 'bandpass', 600, 0, 0.6);
        this.tone(880, 880, 0.25, 'sine', 0.07, 0.12);
        return;
      case 'body.jump':
        this.noise(0.12, 0.06, 'bandpass', 1400, 0, 0.7);
        return;
      case 'body.land':
        this.noise(0.08, 0.12, 'lowpass', 500);
        return;
      case 'dir.chime':
        [659.25, 783.99, 987.77].forEach((f, i) => this.tone(f, f, 0.3, 'sine', 0.18, i * 0.11));
        return;
      case 'dir.wind':
        this.noise(2.5, 0.14, 'bandpass', 500, 0, 0.4);
        return;
      case 'dir.blackout':
        this.tone(220, 90, 0.18, 'square', 0.12);
        return;
      default: {
        if (id.startsWith('step.')) {
          const mat = id.slice(5);
          const f = mat === 'stone' ? 900 : mat === 'wood' ? 600 : mat === 'sand' ? 2200 : mat === 'metal' ? 1800 : 400;
          this.noise(0.06, 0.07, 'bandpass', f * p, 0, 1.2);
          return;
        }
        if (id.startsWith('blk.place')) {
          const now = this.ctx.currentTime;
          this.ladderStep = now - this.ladderAt < 2 ? Math.min(7, this.ladderStep + 1) : 0;
          this.ladderAt = now;
          const semi = getLadderSemitoneOffset(this.ladderStep);
          const preset = PROCEDURAL_SFX_PRESETS['blk.place']!;
          const k = Math.pow(2, semi / 12);
          this.tone(preset.freqStart * k * 2, preset.freqEnd * k * 2, preset.durationMs / 1000, 'triangle', 0.25);
          this.noise(0.06, 0.12, 'bandpass', 400 * k, 0, 1.5);
          return;
        }
        if (id.startsWith('blk.break') || id.startsWith('blk.dig')) {
          this.noise(0.12, 0.18, 'bandpass', 700, 0, 0.9);
          return;
        }
        if (id.startsWith('exp.boom')) {
          this.tone(110, 40, 0.6, 'sine', 0.5);
          this.noise(0.6, 0.35, 'lowpass', 600);
          return;
        }
      }
    }
  }

  /** Soft outdoor bed: wind and an occasional bird (docs/12 5장 앰비언스 대체). */
  startAmbient(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noiseBuf || this.ambient) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 420;
    const g = ctx.createGain();
    g.gain.value = 0.035;
    src.connect(f).connect(g).connect(this.master);
    src.start();
    const birds = setInterval(() => {
      if (this.muted || !this.ctx) return;
      const base = 2200 + ((this.ctx.currentTime * 331) % 1) * 1400;
      for (let i = 0; i < 3; i++) this.tone(base, base * 1.25, 0.07, 'sine', 0.035, i * 0.11);
    }, 5200);
    this.ambient = {
      stop: () => {
        clearInterval(birds);
        try {
          src.stop();
        } catch {
          // already stopped
        }
      }
    };
  }

  dispose(): void {
    this.ambient?.stop();
    this.ambient = null;
    void this.ctx?.close();
    this.ctx = null;
  }
}
