import { BUS_DEFAULT_VOLUMES, MASTER_DEFAULT_VOLUME, dbToGain } from '@lcw/audio';
import { TRACKS, type TrackId } from './tracks.js';

/**
 * Sound for the adventure, all synthesised with Web Audio (docs/22 1장: no recorded music or effect files). Effects are
 * short oscillator/noise envelopes; music is a small step sequencer playing the tracks in tracks.ts. A hard limiter at
 * −1 dBFS sits before the speakers (docs/12 hearing protection).
 */

export type SfxName =
  | 'select'
  | 'move'
  | 'hurt'
  | 'catch'
  | 'wordDone'
  | 'wrong'
  | 'calm'
  | 'heal'
  | 'poke'
  | 'miss'
  | 'friend'
  | 'ready'
  | 'down'
  | 'bell'
  | 'stone'
  | 'encounter'
  | 'clear';

const NOTE: Record<string, number> = { C: -9, 'C#': -8, D: -7, 'D#': -6, E: -5, F: -4, 'F#': -3, G: -2, 'G#': -1, A: 0, 'A#': 1, B: 2 };

export function noteHz(n: string): number {
  const m = /^([A-G]#?)(\d)$/.exec(n);
  if (!m) return 0;
  const semis = NOTE[m[1]!]! + (Number(m[2]) - 4) * 12;
  return 440 * Math.pow(2, semis / 12);
}

export class Sound {
  ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  bgmBus: GainNode | null = null;
  voiceBus: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private track: TrackId | null = null;
  private seqTimer: number | null = null;
  private nextTime = 0;
  private step = 0;
  enabled = true;
  musicOn = true;

  /** Must run inside a user gesture (browsers start audio only then). */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) as typeof AudioContext | undefined;
    if (!AC) return;
    try {
      this.ctx = new AC();
    } catch {
      return;
    }
    const ctx = this.ctx;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -1;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.12;
    limiter.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = MASTER_DEFAULT_VOLUME;
    this.master.connect(limiter);
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = BUS_DEFAULT_VOLUMES.sfx;
    this.sfxBus.connect(this.master);
    this.bgmBus = ctx.createGain();
    this.bgmBus.gain.value = BUS_DEFAULT_VOLUMES.bgm * 0.55;
    this.bgmBus.connect(this.master);
    this.voiceBus = ctx.createGain();
    this.voiceBus.gain.value = BUS_DEFAULT_VOLUMES.voice_npc;
    this.voiceBus.connect(this.master);
    const len = ctx.sampleRate * 0.5;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let seed = 1;
    for (let i = 0; i < len; i++) {
      seed = (seed * 16807) % 2147483647;
      d[i] = (seed / 2147483647) * 2 - 1;
    }
    if (this.track) this.startSeq();
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(on ? MASTER_DEFAULT_VOLUME : 0, this.ctx.currentTime, 0.05);
  }

  /** Lower the music while a voice line plays (docs/12 ducking). */
  duck(on: boolean) {
    if (!this.bgmBus || !this.ctx) return;
    const base = BUS_DEFAULT_VOLUMES.bgm * 0.55;
    this.bgmBus.gain.setTargetAtTime(on ? base * dbToGain(-9) : base, this.ctx.currentTime, on ? 0.04 : 0.25);
  }

  private tone(type: OscillatorType, f0: number, f1: number, t0: number, dur: number, vol: number, bus: GainNode | null = this.sfxBus) {
    if (!this.ctx || !bus) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(bus);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  private hiss(t0: number, dur: number, vol: number, freq: number, bus: GainNode | null = this.sfxBus) {
    if (!this.ctx || !bus || !this.noise) return;
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = 0.8;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f).connect(g).connect(bus);
    s.start(t0);
    s.stop(t0 + dur + 0.02);
  }

  sfx(name: SfxName): void {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime + 0.005;
    const seq = (notes: string[], gap: number, type: OscillatorType, vol: number, len = gap * 1.6) =>
      notes.forEach((n, i) => this.tone(type, noteHz(n), noteHz(n), t + i * gap, len, vol));
    switch (name) {
      case 'select':
        this.tone('square', 880, 1320, t, 0.06, 0.08);
        break;
      case 'move':
        this.tone('square', 660, 660, t, 0.03, 0.05);
        break;
      case 'hurt':
        this.hiss(t, 0.18, 0.35, 900);
        this.tone('square', 240, 90, t, 0.22, 0.12);
        break;
      case 'catch':
        seq(['C6', 'E6'], 0.05, 'triangle', 0.16);
        break;
      case 'wordDone':
        seq(['C6', 'E6', 'G6', 'C7'], 0.06, 'triangle', 0.16);
        break;
      case 'wrong':
        this.tone('square', 330, 247, t, 0.16, 0.08);
        break;
      case 'calm':
        seq(['G5', 'B5', 'D6'], 0.07, 'sine', 0.14, 0.4);
        break;
      case 'heal':
        this.tone('sine', 400, 820, t, 0.35, 0.14);
        break;
      case 'poke':
        this.hiss(t, 0.06, 0.4, 2400);
        this.tone('sine', 170, 70, t, 0.16, 0.25);
        break;
      case 'miss':
        this.hiss(t, 0.25, 0.18, 600);
        break;
      case 'friend':
        seq(['E5', 'G5', 'C6', 'E6', 'D6', 'G6'], 0.11, 'triangle', 0.15, 0.3);
        break;
      case 'ready':
        seq(['A5', 'E6'], 0.12, 'sine', 0.15, 0.6);
        break;
      case 'down':
        seq(['G5', 'E5', 'C5', 'G4'], 0.14, 'triangle', 0.13, 0.25);
        break;
      case 'bell':
        this.tone('sine', 1568, 1568, t, 1.4, 0.13);
        this.tone('sine', 2093, 2093, t, 0.9, 0.05);
        break;
      case 'stone':
        seq(['D6', 'A6'], 0.09, 'sine', 0.12, 0.5);
        break;
      case 'encounter':
        seq(['C5', 'C6', 'G5', 'C6'], 0.05, 'square', 0.07, 0.07);
        break;
      case 'clear':
        seq(['C5', 'E5', 'G5', 'C6', 'G5', 'C6', 'E6'], 0.12, 'triangle', 0.15, 0.3);
        break;
    }
  }

  /** Text blip for typing dialogue; pitch per speaker. */
  blip(hz: number): void {
    if (!this.ctx || !this.enabled) return;
    this.tone('triangle', hz, hz * 0.97, this.ctx.currentTime + 0.002, 0.035, 0.035);
  }

  music(id: TrackId | null): void {
    if (id === this.track) return;
    this.track = id;
    this.stopSeq();
    if (id && this.ctx) this.startSeq();
  }

  private startSeq() {
    if (!this.ctx || !this.track || this.seqTimer !== null) return;
    this.nextTime = this.ctx.currentTime + 0.08;
    this.step = 0;
    this.seqTimer = window.setInterval(() => this.schedule(), 30);
  }

  private stopSeq() {
    if (this.seqTimer !== null) window.clearInterval(this.seqTimer);
    this.seqTimer = null;
  }

  private schedule() {
    const ctx = this.ctx;
    if (!ctx || !this.track) return;
    const tr = TRACKS[this.track];
    const stepDur = 60 / tr.bpm / 2;
    while (this.nextTime < ctx.currentTime + 0.25) {
      if (this.musicOn && this.enabled) {
        const i = this.step;
        const lead = tr.lead[i % tr.lead.length]!;
        const bass = tr.bass[i % tr.bass.length]!;
        if (lead !== '.' && lead !== '-') {
          let len = 1;
          while (tr.lead[(i + len) % tr.lead.length] === '-' && len < 8) len++;
          this.tone(tr.leadWave, noteHz(lead), noteHz(lead), this.nextTime, stepDur * len * 0.92, 0.07, this.bgmBus);
        }
        if (bass !== '.' && bass !== '-') {
          let len = 1;
          while (tr.bass[(i + len) % tr.bass.length] === '-' && len < 8) len++;
          this.tone('triangle', noteHz(bass), noteHz(bass), this.nextTime, stepDur * len * 0.95, 0.12, this.bgmBus);
        }
        const hat = tr.drums[i % tr.drums.length]!;
        if (hat === 'x') this.hiss(this.nextTime, 0.03, 0.05, 7000, this.bgmBus);
        if (hat === 'o') {
          this.hiss(this.nextTime, 0.05, 0.07, 1800, this.bgmBus);
          this.tone('sine', 120, 50, this.nextTime, 0.12, 0.18, this.bgmBus);
        }
      }
      this.nextTime += stepDur;
      this.step += 1;
    }
  }

  dispose() {
    this.stopSeq();
    void this.ctx?.close();
    this.ctx = null;
  }
}
