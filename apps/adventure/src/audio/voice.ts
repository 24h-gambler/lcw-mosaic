import { normalizeTtsText, ttsVoiceId, type NpcVoice } from '@lcw/content';
import { ADV } from '../core/tuning.js';
import type { Sound } from './sound.js';

/**
 * Spoken English (docs/22 3장): the neural voice `/v1/tts` (cast voices, R2-cached) while the server says it is on, the
 * device voice otherwise and whenever a line is refused, fails or takes longer than 1.5 s. The child's own token rides
 * along when there is one, so document sentences can be made too; without it only the fixed lines are made.
 */

function childToken(): string {
  try {
    return sessionStorage.getItem('lcw.studentToken') || localStorage.getItem('lcw.deviceToken') || '';
  } catch {
    return '';
  }
}

export class Voice {
  private status: Promise<boolean> | null = null;
  private cache = new Map<string, Promise<ArrayBuffer | null>>();
  private playing: AudioBufferSourceNode | null = null;
  enabled = true;
  /** For the checks: last line and which voice read it. */
  last: { text: string; by: 'neural' | 'device' | 'none' } = { text: '', by: 'none' };

  constructor(
    private readonly sound: Sound,
    private readonly base = ''
  ) {}

  private neural(): Promise<boolean> {
    const o = new URLSearchParams(location.search).get('voice');
    if (o === 'device') return Promise.resolve(false);
    if (!this.status)
      this.status = fetch(`${this.base}/v1/tts/status`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j: { enabled?: boolean } | null) => Boolean(j?.enabled))
        .catch(() => false);
    return this.status;
  }

  private load(voice: NpcVoice, text: string): Promise<ArrayBuffer | null> {
    const url = `${this.base}/v1/tts?v=${encodeURIComponent(ttsVoiceId(voice))}&t=${encodeURIComponent(normalizeTtsText(text))}`;
    const hit = this.cache.get(url);
    if (hit) return hit;
    const t = childToken();
    const p = fetch(url, t ? { headers: { authorization: `Bearer ${t}` } } : undefined)
      .then((r) => (r.ok && (r.headers.get('content-type') ?? '').startsWith('audio/') ? r.arrayBuffer() : null))
      .catch(() => null);
    this.cache.set(url, p);
    void p.then((b) => {
      if (!b) this.cache.delete(url);
    });
    while (this.cache.size > 32) this.cache.delete(this.cache.keys().next().value!);
    return p;
  }

  /** Start fetching lines that will be spoken soon. */
  prefetch(lines: Array<{ voice: NpcVoice; text: string }>): void {
    if (!this.enabled) return;
    void this.neural().then((on) => {
      if (on) for (const l of lines) if (l.text.trim()) void this.load(l.voice, l.text);
    });
  }

  stop(): void {
    try {
      this.playing?.stop();
    } catch {
      // already stopped
    }
    this.playing = null;
    try {
      speechSynthesis.cancel();
    } catch {
      // no device voice
    }
    this.sound.duck(false);
  }

  async speak(voice: NpcVoice, text: string, rate = 0.92): Promise<void> {
    if (!this.enabled || !text.trim()) return;
    this.stop();
    const ctx = this.sound.ctx;
    if (ctx && this.sound.voiceBus && (await this.neural())) {
      const bytes = await new Promise<ArrayBuffer | null>((resolve) => {
        const id = setTimeout(() => resolve(null), ADV.voiceWaitMs);
        void this.load(voice, text).then((b) => {
          clearTimeout(id);
          resolve(b);
        });
      });
      if (bytes) {
        try {
          const buf = await ctx.decodeAudioData(bytes.slice(0));
          const src = ctx.createBufferSource();
          src.buffer = buf;
          src.connect(this.sound.voiceBus);
          this.sound.duck(true);
          src.onended = () => {
            if (this.playing === src) {
              this.playing = null;
              this.sound.duck(false);
            }
          };
          this.playing = src;
          src.start();
          this.last = { text, by: 'neural' };
          return;
        } catch {
          // fall through to the device voice
        }
      }
    }
    this.device(text, rate);
  }

  private device(text: string, rate: number) {
    try {
      if (!('speechSynthesis' in window)) return;
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-US';
      u.rate = rate;
      const en = speechSynthesis.getVoices().find((v) => v.lang.startsWith('en-US')) ?? speechSynthesis.getVoices().find((v) => v.lang.startsWith('en'));
      if (en) u.voice = en;
      u.onend = () => this.sound.duck(false);
      this.sound.duck(true);
      speechSynthesis.speak(u);
      this.last = { text, by: 'device' };
    } catch {
      this.last = { text, by: 'none' };
    }
  }
}
