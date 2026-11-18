import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { OPS_SHARE, ttsNeurons } from '@lcw/quota';
import { FIRST_ERRAND, NPC_OPENING_LINES, ttsVoiceId, voiceForCtx } from '@lcw/content';
import { readFileSync, readdirSync } from 'node:fs';
import { PlatformDO, workersAi, type LcwEnv } from '../platform.js';
import { fakeDurableStorage } from './fake-do.js';

/**
 * R2627 (11-16): one operator prebuild at 16:02 KST made 48 Aura-2 lines (5,100 neurons) and took the day from 2,957
 * to 8,122, so the children's new lines went back to the device voice. Operator and smoke/demo traffic now spends a
 * small share of its own (OPS_SHARE), the operator try goes through the meter, and a Worker without a deploy's
 * BUILD_SHA (a local `wrangler dev`, whose AI binding is the real account) gets no AI.
 */

const TOKEN = 'op-token-0123456789abcdef';
const op = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };

function setup(opts: { deployed?: boolean; localAi?: string } = {}) {
  const calls: Array<{ model: string; input: Record<string, unknown> }> = [];
  const store = new Map<string, Uint8Array>();
  const env = {
    PLATFORM: undefined as never,
    LCW_OPERATOR_TOKEN: TOKEN,
    TTS_NEURAL: 'on',
    BUILD_SHA: opts.deployed === false ? undefined : 'eb975ed',
    LCW_LOCAL_AI: opts.localAi,
    AI: {
      run: async (model: string, input: unknown) => {
        calls.push({ model, input: input as Record<string, unknown> });
        if (model.includes('whisper')) return { text: 'Cold water, please.', segments: [{ avg_logprob: -0.2 }] };
        return new Response(new Uint8Array(400).fill(7)).body;
      }
    },
    VOICE: {
      async get(k: string) {
        const v = store.get(k);
        return v ? { arrayBuffer: async () => v.slice().buffer } : null;
      },
      async put(k: string, v: Uint8Array) {
        store.set(k, v);
      },
      async delete() {}
    }
  } as unknown as LcwEnv;
  const p = new PlatformDO({ storage: fakeDurableStorage() }, env);
  // wrangler dev rewrites the URL to the route's host, so a local run looks like this too
  const call = (path: string, init: RequestInit = {}) => p.fetch(new Request(`https://lcw.worldwidesomething.com${path}`, init));
  const device = async (playerId: string) => {
    await call('/v1/admin/players', { method: 'POST', headers: op, body: JSON.stringify({ family_id: `fam-${playerId}`, guardian_id: 'g', player_id: playerId, nickname: playerId, level: 'L1' }) });
    const tok = `${playerId}-`.padEnd(48, 't');
    p.sql.run(
      'insert into devices (id, player_id, family_id, token_hash, label, created_at, last_seen_at, revoked_at) values (?, ?, ?, ?, ?, ?, ?, null)',
      [`dev-${playerId}`, playerId, `fam-${playerId}`, createHash('sha256').update(tok).digest('hex'), 'tablet', Date.now(), Date.now()]
    );
    return { authorization: `Bearer ${tok}` };
  };
  const tts = (voice: string, text: string, headers: Record<string, string> = {}) =>
    call(`/v1/tts?v=${encodeURIComponent(voice)}&t=${encodeURIComponent(text)}`, { headers });
  return { p, call, tts, device, calls, store };
}

/** stand-in for a 2 s Opus turn (16 kbps), as in stt.test.ts */
const turn = () => new Uint8Array(4000).map((_, i) => (i * 31) & 0xff);
const hera = ttsVoiceId(voiceForCtx('cafe'));
const mia = ttsVoiceId(voiceForCtx('errand'));

describe('operator and test share (R2627)', () => {
  it('an operator prebuild spends only the share; the children still make new lines afterwards', async () => {
    const { p, call, tts, device, calls } = setup();
    const res = await call('/v1/admin/tts/prebuild', { method: 'POST', headers: op, body: JSON.stringify({ budget_neurons: 50_000 }) });
    expect(res.status).toBe(200);
    const j = (await res.json()) as { made: number; neurons: number; ops: { used: number; limit: number; left: number } };
    expect(j.made).toBeGreaterThan(0);
    expect(j.neurons).toBeLessThanOrEqual(OPS_SHARE.dailyNeurons);
    expect(j.ops.used).toBe(j.neurons);
    const day = p.quota.getStatus(Date.now());
    expect(day.neuronsUsed).toBe(j.neurons);
    expect(day.stage).toBe(0);
    // a second prebuild the same day adds nothing past the share
    const again = (await (await call('/v1/admin/tts/prebuild', { method: 'POST', headers: op, body: '{}' })).json()) as { neurons: number };
    expect(j.neurons + again.neurons).toBeLessThanOrEqual(OPS_SHARE.dailyNeurons);
    const before = calls.length;
    // a child's line that the prebuild did not reach is still made (the day is the children's)
    const kid = await device('kid');
    const r = await tts(hera, 'Here is your cold water. Enjoy your day!', kid);
    expect(r.status).toBe(200);
    expect(r.headers.get('x-lcw-tts')).toBe('miss');
    expect(calls.length).toBe(before + 1);
    // the operator view shows the share
    const q = (await (await call('/v1/admin/quota', { headers: op })).json()) as { ops: { used: number; limit: number } };
    expect(q.ops).toMatchObject({ used: j.neurons + again.neurons, limit: OPS_SHARE.dailyNeurons });
  }, 30_000);

  it('the operator try goes through the meter and stops at the share (no model call once refused)', async () => {
    const { p, call, calls } = setup();
    const text = 'Can I have some cold water, please?';
    const one = ttsNeurons('aura2', text.length);
    const tries = Math.floor(OPS_SHARE.dailyNeurons / one);
    for (let i = 0; i < tries; i++) {
      const r = await call('/v1/admin/tts/try', { method: 'POST', headers: op, body: JSON.stringify({ voice: 'aura2-luna', text }) });
      expect(r.status).toBe(200);
    }
    expect(p.quota.getStatus(Date.now()).neuronsUsed).toBe(tries * one);
    const refused = await call('/v1/admin/tts/try', { method: 'POST', headers: op, body: JSON.stringify({ voice: 'aura2-luna', text }) });
    expect(refused.status).toBe(429);
    expect(await refused.json()).toMatchObject({ error: 'ops_quota' });
    expect(calls).toHaveLength(tries);
  });

  it("an operator's own /v1/tts and a smoke student's server speech spend the share, not the day", async () => {
    const { p, tts, device, call, calls } = setup();
    // the day is just under 70%: the share may not take it into stage 1
    p.quota.consumeNeurons('kid', 6_999, 'tts');
    const line = FIRST_ERRAND.lines.ask;
    const r = await tts(mia, line, { authorization: op.authorization });
    expect(r.status).toBe(429);
    expect(calls).toHaveLength(0);
    // a smoke student's turn: same share
    const smoke = await device('smoke-ops-1');
    const stt = await call('/v1/converse/stt', {
      method: 'POST',
      headers: { ...smoke, 'content-type': 'audio/webm;codecs=opus', 'x-lcw-audio-ms': '2000' },
      body: turn().buffer as ArrayBuffer
    });
    expect(stt.status).toBe(429);
    expect(calls).toHaveLength(0);
    // a real child's turn at the same moment still goes through
    const kid = await device('kid');
    const ok = await call('/v1/converse/stt', {
      method: 'POST',
      headers: { ...kid, 'content-type': 'audio/webm;codecs=opus', 'x-lcw-audio-ms': '2000' },
      body: turn().buffer as ArrayBuffer
    });
    expect(ok.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(p.quota.opsStatus().used).toBe(0);
  });

  it('without a deploy (local wrangler dev: no BUILD_SHA) there is no AI unless LCW_LOCAL_AI=on', async () => {
    const ai = { run: async () => null };
    expect(workersAi({ AI: ai })).toBeUndefined();
    expect(workersAi({ AI: ai, LCW_LOCAL_AI: 'on' })).toBe(ai);
    expect(workersAi({ AI: ai, BUILD_SHA: 'eb975ed' })).toBe(ai);
    expect(workersAi({ BUILD_SHA: 'eb975ed' })).toBeUndefined();

    const local = setup({ deployed: false });
    expect(await (await local.call('/v1/tts/status')).json()).toMatchObject({ enabled: false });
    const kid = await local.device('kid');
    const miss = await local.tts(hera, NPC_OPENING_LINES.cafe!, kid);
    expect(miss.status).toBe(503);
    expect(await miss.json()).toMatchObject({ fallback: 'device' });
    const prebuild = (await (await local.call('/v1/admin/tts/prebuild', { method: 'POST', headers: op, body: '{}' })).json()) as { made: number };
    expect(prebuild.made).toBe(0);
    const tried = await local.call('/v1/admin/tts/try', { method: 'POST', headers: op, body: JSON.stringify({ voice: 'aura2-luna', text: 'Hi' }) });
    expect(tried.status).toBe(400);
    const cron = await local.call('/internal/cron', { method: 'POST', headers: { 'x-lcw-internal': 'cron', 'content-type': 'application/json' }, body: JSON.stringify({ cron: '0 * * * *' }) });
    expect(cron.status).toBe(200);
    expect(((await cron.json()) as { tts: unknown }).tts).toBeNull();
    expect(local.calls).toHaveLength(0);

    const allowed = setup({ deployed: false, localAi: 'on' });
    expect(await (await allowed.call('/v1/tts/status')).json()).toMatchObject({ enabled: true });
    const made = await allowed.tts(hera, NPC_OPENING_LINES.cafe!, await allowed.device('kid'));
    expect(made.status).toBe(200);
    expect(allowed.calls).toHaveLength(1);
  });

  it('every Workers AI call in the edge takes the binding from workersAi (no env.AI.run elsewhere)', () => {
    const dir = new URL('../', import.meta.url);
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.ts'))) {
      const src = readFileSync(new URL(f, dir), 'utf8');
      const uses = src.split('\n').filter((l) => /\benv\.AI\b/.test(l) && !/Boolean\(this\.env\.AI\)/.test(l));
      const allowed = f === 'platform.ts' ? uses.filter((l) => !/^\s*(if \(!env\.AI\)|return env\.AI;)/.test(l)) : uses;
      expect(allowed, f).toEqual([]);
    }
  });
});
