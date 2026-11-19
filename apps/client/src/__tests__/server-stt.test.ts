import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PlatformDO, type LcwEnv } from '../../../edge/src/platform.js';
import { fakeDurableStorage } from '../../../edge/src/__tests__/fake-do.js';
import { MicController, type Clock } from '../dialog/mic-controller.js';
import { readMicIssue, readMicTurns, resetMicStatusForTest } from '../dialog/mic-status.js';
import { createDialogSpeechEngine, createServerSpeechEngine, pickRecorderType, HALLUCINATION_NO_SPEECH_PROB, HALLUCINATION_PEAK_RMS, hallucinationKey, METER_MIN_FRAMES, SERVER_STT_PATH, VOICE_RMS, VOICE_RMS_BORDER, WHISPER_HALLUCINATIONS, type ServerSttEnv } from '../dialog/server-stt.js';

/**
 * The Workers AI Whisper rung from the child's side: the mic controller drives the server engine, the recorded turn
 * goes to the real PlatformDO route (fake Workers AI), and the transcript comes back as the turn's final result.
 */

const TOKEN = 'op-token-0123456789abcdef';

class ManualClock implements Clock {
  t = 0;
  private timers: Array<{ id: number; every: number; next: number; fn: () => void }> = [];
  private seq = 0;
  now = () => this.t;
  every = (ms: number, fn: () => void) => {
    const id = ++this.seq;
    this.timers.push({ id, every: ms, next: this.t + ms, fn });
    return () => {
      this.timers = this.timers.filter((x) => x.id !== id);
    };
  };
  advance(ms: number) {
    const end = this.t + ms;
    while (this.t < end) {
      this.t += 10;
      for (const x of [...this.timers]) {
        if (this.timers.includes(x) && this.t >= x.next) {
          x.next += x.every;
          x.fn();
        }
      }
    }
  }
}

const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 5));
};

class FakeRecorder {
  static isTypeSupported = (t: string) => t === 'audio/webm;codecs=opus';
  static last: FakeRecorder | null = null;
  state = 'inactive';
  mimeType: string;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(_s: MediaStream, opts?: { mimeType?: string; audioBitsPerSecond?: number }) {
    this.mimeType = opts?.mimeType ?? '';
    expect(opts?.audioBitsPerSecond).toBe(16_000);
    FakeRecorder.last = this;
  }
  start() {
    this.state = 'recording';
  }
  stop() {
    if (this.state === 'inactive') return;
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob([new Uint8Array(5000)], { type: this.mimeType }) });
    this.onstop?.();
  }
}

async function harness(opts: { level: () => number; running?: () => boolean; ai?: LcwEnv['AI']; token?: string }) {
  // the mic status and turn count live in sessionStorage (node has none): a fresh one per harness
  const mem = new Map<string, string>();
  (globalThis as { sessionStorage?: unknown }).sessionStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear()
  };
  resetMicStatusForTest();
  const aiCalls: unknown[] = [];
  const p = new PlatformDO(
    { storage: fakeDurableStorage() },
    {
      PLATFORM: undefined as never,
      LCW_OPERATOR_TOKEN: TOKEN,
      BUILD_SHA: 'test', // a deployed Worker: without it there is no AI (platform.ts workersAi)
      AI: opts.ai ?? ({ run: async (_m: string, input: unknown) => { aiCalls.push(input); return { text: 'Cold water, please.', segments: [{ avg_logprob: -0.1 }] }; } } as LcwEnv['AI'])
    } as LcwEnv
  );
  await p.fetch(new Request('https://lcw.test/v1/admin/players', { method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ family_id: 'f', guardian_id: 'g', player_id: 'kid', nickname: 'K', level: 'L1' }) }));
  const tok = 'v'.repeat(48);
  p.sql.run('insert into devices (id, player_id, family_id, token_hash, label, created_at, last_seen_at, revoked_at) values (?, ?, ?, ?, ?, ?, ?, null)', ['d', 'kid', 'f', createHash('sha256').update(tok).digest('hex'), 't', Date.now(), Date.now()]);
  const requests: Array<{ url: string; headers: Record<string, string>; bytes: number }> = [];
  const clock = new ManualClock();
  let tracksStopped = 0;
  const env: Partial<ServerSttEnv> = {
    isSecureContext: true,
    getUserMedia: async () => ({ getTracks: () => [{ stop: () => (tracksStopped += 1) }] }) as unknown as MediaStream,
    MediaRecorder: FakeRecorder as unknown as ServerSttEnv['MediaRecorder'],
    createLevelMeter: () => ({ rms: opts.level, close: () => undefined, ...(opts.running ? { running: opts.running } : {}) }),
    token: () => opts.token ?? tok,
    now: clock.now,
    every: clock.every,
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(`https://lcw.test${String(input)}`, init);
      const body = await req.clone().arrayBuffer();
      requests.push({ url: String(input), headers: Object.fromEntries(req.headers.entries()), bytes: body.byteLength });
      return p.fetch(req);
    }) as typeof fetch
  };
  const engine = createServerSpeechEngine({ env });
  const finals: Array<{ transcript: string } | null> = [];
  const issues: string[] = [];
  const views: string[] = [];
  const ctrl = new MicController(engine, { onView: (v) => views.push(v.interim), onFinal: (r) => finals.push(r), onIssue: (i) => issues.push(i) }, clock);
  return { p, engine, ctrl, clock, finals, issues, views, requests, aiCalls, tracks: () => tracksStopped };
}

describe('server Whisper engine through the mic controller and the real route', () => {
  it('records a spoken turn, stops on silence, uploads once and delivers the transcript', async () => {
    let loud = true;
    const h = await harness({ level: () => (loud ? 0.1 : 0.001) });
    expect(h.engine.availability()).toEqual({ ok: true });
    h.ctrl.tap();
    await settle();
    h.clock.advance(1500); // speaking
    loud = false;
    h.clock.advance(3000); // silence → auto-stop
    await settle();
    expect(h.requests).toHaveLength(1);
    expect(h.requests[0]).toMatchObject({ url: SERVER_STT_PATH, bytes: 5000 });
    expect(h.requests[0]!.headers['content-type']).toBe('audio/webm;codecs=opus');
    expect(Number(h.requests[0]!.headers['x-lcw-audio-ms'])).toBeGreaterThan(1000);
    expect(h.requests[0]!.headers.authorization).toBe(`Bearer ${'v'.repeat(48)}`);
    expect(h.finals).toEqual([{ transcript: 'Cold water, please.', confidence: expect.any(Number) }]);
    expect(h.aiCalls).toHaveLength(1);
    expect(h.tracks()).toBe(1); // the mic is released
    // the live caption only showed the speaking dots, never words
    expect(h.views.filter(Boolean).every((v) => /^·+$/.test(v) || v === 'Cold water, please.')).toBe(true);
  });

  it('silence: nothing is uploaded or charged, the turn ends with nothing heard', async () => {
    const h = await harness({ level: () => 0 });
    h.ctrl.tap();
    await settle();
    h.clock.advance(7000); // first-speech wait
    await settle();
    expect(h.requests).toHaveLength(0);
    // a no-speech turn with its cause: the mic heard nothing above the voice level (R2627)
    expect(h.finals).toEqual([]);
    expect(h.issues).toEqual(['no_speech']);
    expect(readMicIssue()).toMatchObject({ issue: 'no_speech', raw: 'vad_quiet' });
    expect(readMicTurns()).toMatchObject({ started: 1, sent: 0, lost: 1, lastLost: { cause: 'no_speech' } });
    expect(h.p.quota.getStatus(Date.now()).neuronsUsed).toBe(0);
  });

  it('a meter that cannot hear (suspended AudioContext) does not drop the turn as quiet: it is uploaded (R2627)', async () => {
    const h = await harness({ level: () => 0, running: () => false });
    h.ctrl.tap();
    await settle();
    h.clock.advance(2000);
    h.ctrl.tap(); // the child taps to finish
    await settle();
    expect(h.requests).toHaveLength(1);
    expect(h.finals).toEqual([{ transcript: 'Cold water, please.', confidence: expect.any(Number) }]);
  });

  it('a meter that starts suspended and then runs decides from its running frames: a quiet child is not uploaded', async () => {
    let running = false;
    const h = await harness({ level: () => 0.001, running: () => running });
    h.ctrl.tap();
    await settle();
    h.clock.advance(300); // the first frames before resume() landed
    running = true;
    h.clock.advance(2000);
    h.ctrl.tap();
    await settle();
    expect(h.requests).toHaveLength(0);
    expect(readMicIssue()).toMatchObject({ issue: 'no_speech', raw: 'vad_quiet' });
  });

  const says = (text: string, noSpeech?: number) =>
    ({ run: async () => ({ text, segments: [{ avg_logprob: -0.2, ...(noSpeech === undefined ? {} : { no_speech_prob: noSpeech }) }] }) }) as unknown as LcwEnv['AI'];

  it("Whisper's silence line (Thank you.) with no speech in the turn is no_speech stt_hallucination: no answer, no pass (11-19)", async () => {
    // a meter that never ran: no sign of speech at all
    const blind = await harness({ level: () => 0, running: () => false, ai: says('Thank you.') });
    blind.ctrl.tap();
    await settle();
    blind.clock.advance(2000);
    blind.ctrl.tap();
    await settle();
    expect(blind.requests).toHaveLength(1);
    expect(blind.finals).toEqual([]);
    expect(readMicIssue()).toMatchObject({ issue: 'no_speech', raw: 'stt_hallucination' });
    expect(readMicTurns()).toMatchObject({ started: 1, sent: 0, lost: 1, lastLost: { cause: 'no_speech' } });
  });

  it('noise near the voice level that Whisper turns into a silence line is not an answer either', async () => {
    for (const text of ['Thank you.', 'Thanks for watching!', 'you', 'Bye.']) {
      const h = await harness({ level: () => (VOICE_RMS_BORDER + VOICE_RMS) / 2, ai: says(text) });
      h.ctrl.tap();
      await settle();
      h.clock.advance(2000);
      h.ctrl.tap();
      await settle();
      expect(h.requests).toHaveLength(1);
      expect(h.finals).toEqual([]);
      expect(readMicIssue()).toMatchObject({ raw: 'stt_hallucination' });
    }
  });

  it('a real "Thank you." (voiced frames at the voice level) is an answer; Whisper saying the turn had no speech still drops it', async () => {
    const h = await harness({ level: () => HALLUCINATION_PEAK_RMS * 3, ai: says('Thank you.', 0.05) });
    h.ctrl.tap();
    await settle();
    h.clock.advance(1500);
    h.ctrl.tap();
    await settle();
    expect(h.finals).toEqual([{ transcript: 'Thank you.', confidence: expect.any(Number) }]);
    const ns = await harness({ level: () => HALLUCINATION_PEAK_RMS * 3, ai: says('Thank you.', HALLUCINATION_NO_SPEECH_PROB + 0.1) });
    ns.ctrl.tap();
    await settle();
    ns.clock.advance(1500);
    ns.ctrl.tap();
    await settle();
    expect(ns.finals).toEqual([]);
    expect(readMicIssue()).toMatchObject({ raw: 'stt_hallucination' });
    // any other sentence is words, even from a quiet turn
    const other = await harness({ level: () => 0, running: () => false, ai: says('Thank you for the tea.') });
    other.ctrl.tap();
    await settle();
    other.clock.advance(2000);
    other.ctrl.tap();
    await settle();
    expect(other.finals).toEqual([{ transcript: 'Thank you for the tea.', confidence: expect.any(Number) }]);
    expect([...WHISPER_HALLUCINATIONS].every((l) => l === hallucinationKey(l))).toBe(true);
  });

  it('a soft voice near the voice level (between VOICE_RMS_BORDER and VOICE_RMS) is not called quiet by the meter: it goes to Whisper', async () => {
    const h = await harness({ level: () => (VOICE_RMS_BORDER + VOICE_RMS) / 2, ai: says('Can I have tea?') });
    h.ctrl.tap();
    await settle();
    h.clock.advance(2000);
    h.ctrl.tap();
    await settle();
    expect(h.requests).toHaveLength(1);
    expect(h.finals).toEqual([{ transcript: 'Can I have tea?', confidence: expect.any(Number) }]);
  });

  it('a meter that ran too briefly to judge (under METER_MIN_FRAMES) sends the turn; Whisper hearing nothing is the silence verdict', async () => {
    const h = await harness({ level: () => 0, ai: { run: async () => ({ text: '', segments: [] }) } as unknown as LcwEnv['AI'] });
    h.ctrl.tap();
    await settle();
    h.clock.advance((METER_MIN_FRAMES - 4) * 100);
    h.ctrl.tap();
    await settle();
    expect(h.requests).toHaveLength(1);
    expect(h.finals).toEqual([]);
    expect(readMicIssue()).toMatchObject({ issue: 'no_speech', raw: 'stt_empty' });
  });

  it('Whisper hears no words in a voiced turn: no_speech with its own cause, not a silent null', async () => {
    const h = await harness({ level: () => 0.1, ai: { run: async () => ({ text: '  ', segments: [] }) } as unknown as LcwEnv['AI'] });
    h.ctrl.tap();
    await settle();
    h.clock.advance(1000);
    h.ctrl.tap();
    await settle();
    expect(h.requests).toHaveLength(1);
    expect(h.issues).toEqual(['no_speech']);
    expect(readMicIssue()).toMatchObject({ issue: 'no_speech', raw: 'stt_empty' });
  });

  it('a failed model call says try again (stt_failed, http_502), never "no mic"', async () => {
    const h = await harness({ level: () => 0.1, ai: { run: async () => { throw new Error('boom'); } } as unknown as LcwEnv['AI'] });
    h.ctrl.tap();
    await settle();
    h.clock.advance(1000);
    h.ctrl.tap();
    await settle();
    expect(h.issues).toEqual(['stt_failed']);
    expect(readMicIssue()).toMatchObject({ issue: 'stt_failed', raw: 'http_502' });
    expect(sessionStorage.getItem('lcw.micStatus')).not.toBe('none');
  });

  it('a bank-only day (429) closes the server rung: the panel gets "quota" (word cards), the console does not read "no mic"', async () => {
    const h = await harness({ level: () => 0.1 });
    await h.p.fetch(new Request('https://lcw.test/v1/admin/quota', { method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ daily_neurons: 0 }) }));
    h.ctrl.tap();
    await settle();
    h.clock.advance(1000);
    h.ctrl.tap(); // second tap ends the turn
    await settle();
    expect(h.requests).toHaveLength(1);
    expect(h.issues).toEqual(['quota']);
    expect(h.aiCalls).toHaveLength(0);
    expect(readMicIssue()).toMatchObject({ issue: 'quota', raw: 'http_429' });
    expect(sessionStorage.getItem('lcw.micStatus')).not.toBe('none');
    expect(readMicTurns()).toMatchObject({ started: 1, lost: 1, lastLost: { cause: 'quota' } });
  });

  it('closing the window mid-turn uploads nothing and releases the mic', async () => {
    const h = await harness({ level: () => 0.1 });
    h.ctrl.tap();
    await settle();
    h.clock.advance(800);
    h.ctrl.dispose();
    await settle();
    expect(h.requests).toHaveLength(0);
    expect(h.tracks()).toBe(1);
  });

  it('a slow server is waited for (the long stop grace), and its late answer is not replaced by the dots', async () => {
    let release: (() => void) | null = null;
    const slowAi = { run: () => new Promise((r) => { release = () => r({ text: 'Here you are.' }); }) } as unknown as LcwEnv['AI'];
    const h = await harness({ level: () => 0.1, ai: slowAi });
    h.ctrl.tap();
    await settle();
    h.clock.advance(1000);
    h.ctrl.tap();
    await settle();
    h.clock.advance(5000); // longer than the browser engine's 3 s grace
    expect(h.finals).toEqual([]);
    // R2627: 12 s later (the old 9 s grace gave the turn up as "not heard") the words still come through
    h.clock.advance(12_000);
    expect(h.finals).toEqual([]);
    expect(h.issues).toEqual([]);
    release!();
    await settle();
    expect(h.finals).toEqual([{ transcript: 'Here you are.', confidence: 0.7 }]);
    expect(readMicTurns()).toMatchObject({ started: 1, lost: 0 });
  });

  it('while the words are on the way the panel is told (processing), not left on an idle mic', async () => {
    let release: (() => void) | null = null;
    const slowAi = { run: () => new Promise((r) => { release = () => r({ text: 'Here you are.' }); }) } as unknown as LcwEnv['AI'];
    const h = await harness({ level: () => 0.1, ai: slowAi });
    const seen: boolean[] = [];
    const ctrl = new MicController(h.engine, { onView: (v) => seen.push(!!v.processing), onFinal: () => undefined, onIssue: () => undefined }, h.clock);
    ctrl.tap();
    await settle();
    h.clock.advance(1000);
    ctrl.tap();
    await settle();
    expect(seen[seen.length - 1]).toBe(true);
    release!();
    await settle();
    expect(seen[seen.length - 1]).toBe(false);
  });

  it('is only offered with a secure page, a recorder and a child token', () => {
    const base = { getUserMedia: async () => ({}) as MediaStream, MediaRecorder: FakeRecorder as unknown as ServerSttEnv['MediaRecorder'], token: () => 'x'.repeat(48) };
    expect(createServerSpeechEngine({ env: { ...base, token: () => '' } }).availability()).toEqual({ ok: false, issue: 'unsupported' });
    expect(createServerSpeechEngine({ env: { ...base, isSecureContext: false } }).availability()).toEqual({ ok: false, issue: 'insecure' });
    expect(createServerSpeechEngine({ env: { ...base, MediaRecorder: undefined } }).availability()).toEqual({ ok: false, issue: 'unsupported' });
    expect(pickRecorderType(FakeRecorder as unknown as Parameters<typeof pickRecorderType>[0])).toBe('audio/webm;codecs=opus');
    // in node there is neither browser recognition nor a recorder: the default stays the browser engine (→ word cards)
    expect(createDialogSpeechEngine().source).toBe('browser');
  });
});
