import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SEAT_FAIR_USE_LIMITS, SERVER_STT, serverSttNeurons } from '@lcw/quota';
import { PlatformDO, type LcwEnv } from '../platform.js';
import { sttSeconds, whisperConfidence } from '../stt.js';
import { fakeDurableStorage } from './fake-do.js';

/** Server speech recognition (docs/02 6장): child tokens only, Workers AI through the quota meter, audio never kept. */

const TOKEN = 'op-token-0123456789abcdef';
const op = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };

function audio(sec: number): Uint8Array {
  // stand-in for an Opus turn: 16 kbps = 2,000 bytes a second
  return new Uint8Array(Math.round(sec * 2000)).map((_, i) => (i * 31) & 0xff);
}

async function setup(ai?: LcwEnv['AI']) {
  const seen: Array<{ model: string; input: Record<string, unknown> }> = [];
  const p = new PlatformDO(
    { storage: fakeDurableStorage() },
    {
      PLATFORM: undefined as never,
      LCW_OPERATOR_TOKEN: TOKEN,
      AI:
        ai ??
        ({
          run: async (model: string, input: unknown) => {
            seen.push({ model, input: input as Record<string, unknown> });
            return { text: '  Cold water,   please. ', segments: [{ avg_logprob: -0.2 }, { avg_logprob: -0.3 }] };
          }
        } as LcwEnv['AI'])
    } as LcwEnv
  );
  const call = (path: string, init: RequestInit = {}) => p.fetch(new Request(`https://lcw.test${path}`, init));
  await call('/v1/admin/players', { method: 'POST', headers: op, body: JSON.stringify({ family_id: 'fam', guardian_id: 'g', player_id: 'kid', nickname: 'Kid', level: 'L1' }) });
  const tok = 's'.repeat(48);
  p.sql.run(
    'insert into devices (id, player_id, family_id, token_hash, label, created_at, last_seen_at, revoked_at) values (?, ?, ?, ?, ?, ?, ?, null)',
    ['dev-1', 'kid', 'fam', createHash('sha256').update(tok).digest('hex'), 'tablet', Date.now(), Date.now()]
  );
  const stt = (body: Uint8Array, headers: Record<string, string> = {}, token: string | null = tok) =>
    call('/v1/converse/stt', {
      method: 'POST',
      headers: { 'content-type': 'audio/webm;codecs=opus', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
      body: body.slice().buffer as ArrayBuffer
    });
  return { p, call, stt, seen };
}

describe('POST /v1/converse/stt', () => {
  it('transcribes a child turn with Whisper in English, charges the meter by length, keeps no audio', async () => {
    const { p, stt, seen } = await setup();
    const res = await stt(audio(3), { 'x-lcw-audio-ms': '2800' });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const j = (await res.json()) as Record<string, any>;
    expect(j).toMatchObject({ transcript: 'Cold water, please.', source: 'workers_ai', stt_sec: 3 });
    expect(j.confidence).toBeCloseTo(Math.exp(-0.25), 2);

    expect(seen).toHaveLength(1);
    expect(seen[0]!.model).toBe(SERVER_STT.model);
    expect(seen[0]!.input).toMatchObject({ language: 'en', task: 'transcribe' });
    expect(Object.keys(seen[0]!.input).sort()).toEqual(['audio', 'language', 'task', 'vad_filter']); // no who
    expect(typeof seen[0]!.input.audio).toBe('string');

    const st = p.quota.getStatus(Date.now());
    expect(st.neuronsUsed).toBe(serverSttNeurons(3));
    // nothing audio-like was written anywhere
    const tables = p.sql.all<{ name: string }>("select name from sqlite_master where type = 'table'").map((t) => t.name);
    for (const t of tables) {
      const cols = p.sql.all<{ name: string }>(`pragma table_info(${t})`).map((c) => c.name);
      if (cols.some((c) => /audio/.test(c))) {
        const rows = p.sql.all(`select * from ${t}`);
        for (const r of rows) for (const [k, v] of Object.entries(r)) if (/audio/.test(k)) expect(v ?? null).toBeNull();
      }
    }
  });

  it('refuses callers without a child token, non-audio bodies and turns that are too long or too large', async () => {
    const { stt, seen } = await setup();
    expect((await stt(audio(1), {}, null)).status).toBe(401);
    expect((await stt(audio(1), {}, 'x'.repeat(48))).status).toBe(401);
    expect((await stt(audio(1), { 'content-type': 'application/json' })).status).toBe(415);
    expect((await stt(new Uint8Array(0))).status).toBe(400);
    expect((await stt(audio(2), { 'x-lcw-audio-ms': '20000' })).status).toBe(413);
    expect((await stt(new Uint8Array(SERVER_STT.maxBytes + 1))).status).toBe(413);
    expect(seen).toHaveLength(0);
  });

  it('the meter decides: bank-only days and a used-up seat get 429 with the word-card fallback, no model call', async () => {
    const { p, call, stt, seen } = await setup();
    await call('/v1/admin/quota', { method: 'POST', headers: op, body: JSON.stringify({ daily_neurons: 0 }) });
    const r = await stt(audio(2));
    expect(r.status).toBe(429);
    expect(await r.json()).toMatchObject({ error: 'stt_quota', fallback: 'board', stage: 3 });
    await call('/v1/admin/quota', { method: 'POST', headers: op, body: JSON.stringify({ daily_neurons: null }) });
    // the seat's 40 minutes a day
    p.quota.consumeNeurons('kid', 1, 'stt', SEAT_FAIR_USE_LIMITS.serverSttMinutesPerDay * 60);
    expect((await stt(audio(2))).status).toBe(429);
    expect(seen).toHaveLength(0);
  });

  it('stage 2: a device that has its own recognition is sent back to it; one without keeps the server', async () => {
    const { p, stt, seen } = await setup();
    p.quota.consumeNeurons('x', 8_600, 'llm');
    expect((await stt(audio(2), { 'x-lcw-device-stt': '1' })).status).toBe(429);
    expect((await stt(audio(2))).status).toBe(200);
    expect(seen).toHaveLength(1);
  });

  it('a model failure or a malformed answer is a 502 with the fallback (the neurons stay counted)', async () => {
    const bad = await setup({ run: async () => ({ nope: true }) } as LcwEnv['AI']);
    expect((await bad.stt(audio(1))).status).toBe(502);
    const boom = await setup({ run: async () => { throw new Error('down'); } } as LcwEnv['AI']);
    const r = await boom.stt(audio(1));
    expect(r.status).toBe(502);
    expect(await r.json()).toMatchObject({ fallback: 'board' });
    expect(boom.p.quota.getStatus(Date.now()).neuronsUsed).toBe(serverSttNeurons(0.5));
  });

  it('no AI binding: 503 so the client falls back', async () => {
    const p = new PlatformDO({ storage: fakeDurableStorage() }, { PLATFORM: undefined as never, LCW_OPERATOR_TOKEN: TOKEN } as LcwEnv);
    await p.fetch(new Request('https://lcw.test/v1/admin/players', { method: 'POST', headers: op, body: JSON.stringify({ family_id: 'f', guardian_id: 'g', player_id: 'kid', nickname: 'K', level: 'L1' }) }));
    const tok = 'n'.repeat(48);
    p.sql.run('insert into devices (id, player_id, family_id, token_hash, label, created_at, last_seen_at, revoked_at) values (?, ?, ?, ?, ?, ?, ?, null)', ['d', 'kid', 'f', createHash('sha256').update(tok).digest('hex'), 't', Date.now(), Date.now()]);
    const r = await p.fetch(new Request('https://lcw.test/v1/converse/stt', { method: 'POST', headers: { authorization: `Bearer ${tok}`, 'content-type': 'audio/webm' }, body: audio(1).slice().buffer as ArrayBuffer }));
    expect(r.status).toBe(503);
  });
});

describe('stt helpers', () => {
  it('charges the longer of the claimed length and the size at 16 kbps', () => {
    expect(sttSeconds(4000, 1000)).toBe(2);
    expect(sttSeconds(4000, 5000)).toBe(5);
    expect(sttSeconds(4000, null)).toBe(2);
    expect(serverSttNeurons(0)).toBe(1);
    expect(serverSttNeurons(12)).toBe(Math.ceil((12 * SERVER_STT.neuronsPerMinute) / 60));
  });
  it('confidence from segment log-probabilities', () => {
    expect(whisperConfidence(undefined)).toBe(0.7);
    expect(whisperConfidence([{ avg_logprob: 0 }])).toBe(1);
    expect(whisperConfidence([{ avg_logprob: -10 }])).toBeLessThan(0.001);
  });
});
