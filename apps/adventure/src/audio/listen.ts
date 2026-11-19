/**
 * The 🎤 in a TALK (docs/22 1.3): the browser's speech recogniser, English, interim text shown as the child speaks.
 * The adventure never records or uploads audio itself; the browser may send it to its maker's recogniser (docs/22 3장),
 * and only the recognised words are graded. Anything that is missing, refused or silent ends
 * with a reason, and the panel turns to typing at once.
 */
export type ListenEnd = { kind: 'heard'; alternatives: string[] } | { kind: 'unsupported' | 'denied' | 'silent' | 'error' };

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}

type Ctor = new () => SpeechRecognitionLike;

function ctor(): Ctor | null {
  const w = window as unknown as { SpeechRecognition?: Ctor; webkitSpeechRecognition?: Ctor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function canListen(): boolean {
  try {
    return Boolean(ctor()) && !localStorageFlag('lcw.adventure.micOff');
  } catch {
    return false;
  }
}

function localStorageFlag(k: string): boolean {
  try {
    return localStorage.getItem(k) === '1';
  } catch {
    return false;
  }
}

export function markMicDenied(): void {
  try {
    localStorage.setItem('lcw.adventure.micOff', '1');
  } catch {
    // remembered for this page only
  }
}

export class Listener {
  private rec: SpeechRecognitionLike | null = null;
  private finals: string[] = [];
  private alts: string[] = [];
  private done = false;

  start(onInterim: (text: string) => void, onEnd: (r: ListenEnd) => void, maxMs = 9000): void {
    const C = ctor();
    if (!C) {
      onEnd({ kind: 'unsupported' });
      return;
    }
    const rec = new C();
    this.rec = rec;
    this.finals = [];
    this.alts = [];
    this.done = false;
    rec.lang = 'en-US';
    rec.interimResults = true;
    rec.maxAlternatives = 3;
    rec.continuous = false;
    const finish = (r: ListenEnd) => {
      if (this.done) return;
      this.done = true;
      clearTimeout(timer);
      onEnd(r);
    };
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]!;
        if (res.isFinal) {
          this.finals.push(res[0]!.transcript);
          for (let k = 0; k < res.length; k++) this.alts.push(res[k]!.transcript);
        } else interim += res[0]!.transcript;
      }
      onInterim([...this.finals, interim].join(' ').trim());
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        markMicDenied();
        finish({ kind: 'denied' });
      } else if (e.error === 'no-speech') finish({ kind: 'silent' });
      else if (e.error !== 'aborted') finish({ kind: 'error' });
    };
    rec.onend = () => {
      const all = [this.finals.join(' ').trim(), ...this.alts].filter(Boolean);
      finish(all.length ? { kind: 'heard', alternatives: all } : { kind: 'silent' });
    };
    const timer = setTimeout(() => {
      try {
        rec.stop();
      } catch {
        // ended already
      }
    }, maxMs);
    try {
      rec.start();
    } catch {
      finish({ kind: 'error' });
    }
  }

  stop(): void {
    try {
      this.rec?.stop();
    } catch {
      // not started
    }
  }

  abort(): void {
    this.done = true;
    try {
      this.rec?.abort();
    } catch {
      // not started
    }
  }
}
