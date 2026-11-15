import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CAFE_MENU, lookupPhraseBank, starPrice } from '@lcw/content';
import { FREE_TIER_LIMITS } from '@lcw/quota';
import { PlatformDO, type LcwEnv } from '../platform.js';
import { fakeDurableStorage } from './fake-do.js';

/**
 * WP-112 acceptance (docs/11): with the daily limit at 0 an order still completes from the bank. Plus the ladder on
 * the real platform object: durable counters, operator settings, the lesson reserve and the hourly alert day.
 */

const TOKEN = 'op-token-0123456789abcdef';
const op = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };

async function setup(env: Partial<LcwEnv> = {}, storage = fakeDurableStorage()) {
  const p = new PlatformDO({ storage }, { PLATFORM: undefined as never, LCW_OPERATOR_TOKEN: TOKEN, ...env } as LcwEnv);
  const call = (path: string, init: RequestInit = {}) => p.fetch(new Request(`https://lcw.test${path}`, init));
  return { p, call, storage };
}

async function linkChild(p: PlatformDO, call: (path: string, init?: RequestInit) => Promise<Response>) {
  await call('/v1/admin/players', { method: 'POST', headers: op, body: JSON.stringify({ family_id: 'fam', guardian_id: 'g', player_id: 'kid', nickname: 'Kid', level: 'L2' }) });
  const tok = 'q'.repeat(48);
  p.sql.run(
    'insert into devices (id, player_id, family_id, token_hash, label, created_at, last_seen_at, revoked_at) values (?, ?, ?, ?, ?, ?, ?, null)',
    ['dev-1', 'kid', 'fam', createHash('sha256').update(tok).digest('hex'), 'tablet', Date.now(), Date.now()]
  );
  return tok;
}

const setQuota = (call: (path: string, init?: RequestInit) => Promise<Response>, body: unknown) =>
  call('/v1/admin/quota', { method: 'POST', headers: op, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, j: (await r.json()) as Record<string, any> }));

describe('WP-112: limit 0 still completes the order from the bank', () => {
  it('bank only at limit 0: the solo order is scored, charged and granted; understand answers from the bank; no AI call', async () => {
    let aiCalls = 0;
    const { p, call } = await setup({ AI: { run: async () => { aiCalls++; return {}; } } });
    const tok = await linkChild(p, call);

    const set = await setQuota(call, { daily_neurons: 0 });
    expect(set.status).toBe(200);
    expect(set.j).toMatchObject({ stage: 3, bank_only: true, neurons_limit: 0, settings: { dailyNeurons: 0, outage: false } });

    const text = lookupPhraseBank({ ctx: 'cafe', level: 'L2', item: 'smoothie', modifiers: ['cold'] })!.offers[1]!.text;
    const res = await call('/v1/converse/score', {
      method: 'POST',
      headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
      body: JSON.stringify({ dialog_id: 'd-zero', chosen_stars: 2, hint_level: 'full', npc_ctx: 'cafe', target_text: text, transcript: text })
    });
    expect(res.status).toBe(200);
    const j = (await res.json()) as Record<string, any>;
    const price = starPrice(CAFE_MENU.find((d) => d.key === 'smoothie')!.basePrice, 2);
    expect(j.pass).toBe(true);
    expect(j.granted).toMatchObject({ item_id: 'smoothie', coins_delta: -price });

    const u = await call('/v1/converse/understand', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dialog_id: 'd-u', npc_ctx: 'cafe', level: 'L2', transcript: 'cold smoothie please', stt: { source: 'keyboard', confidence: 1 } })
    });
    const uj = (await u.json()) as Record<string, any>;
    expect(uj.source).toBe('bank');
    expect(uj.offers).toHaveLength(3);

    expect(await p.runAiCapped('@cf/meta/llama-3.1-8b-instruct-fast', {} as never, { isLesson: true })).toBeNull();
    expect(aiCalls).toBe(0);
  });

  it('a provider outage is stage 4 and bank only; clearing it brings the ladder back', async () => {
    const { call } = await setup();
    expect((await setQuota(call, { outage: true })).j).toMatchObject({ stage: 4, bank_only: true });
    expect((await setQuota(call, { outage: false, daily_neurons: null })).j).toMatchObject({ stage: 0, bank_only: false, neurons_limit: FREE_TIER_LIMITS.dailyNeurons });
  });

  it('settings are operator only', async () => {
    const { call } = await setup();
    const anon = await call('/v1/admin/quota', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ daily_neurons: 0 }) });
    expect(anon.status).toBe(401);
    expect((await setQuota(call, { daily_neurons: -1 })).status).toBe(400);
  });
});

describe('the degrade ladder on the platform object (docs/02 5장)', () => {
  it('counters survive a restart of the object (one durable counter per day)', async () => {
    const storage = fakeDurableStorage();
    const a = await setup({}, storage);
    expect(a.p.quota.consumeNeurons('seat-1', 6_000, 'llm')).toBe(true);
    const b = await setup({}, storage);
    const v = (await (await b.call('/v1/admin/quota', { headers: op })).json()) as Record<string, any>;
    expect(v).toMatchObject({ neurons_used: 6_000, stage: 0 });
    b.p.quota.consumeNeurons('seat-1', 1_000, 'llm');
    expect(b.p.quota.getStatus(Date.now()).stage).toBe(1);
  });

  it('stage 1 keeps creative AI for lessons only; stage 3 stops it for everyone; the meter counts before calling', async () => {
    let calls = 0;
    const { p } = await setup({ AI: { run: async () => { calls++; return {}; } } });
    p.quota.consumeNeurons('x', 7_000, 'llm'); // 70%
    expect(await p.runAiCapped('m', {} as never)).toBeNull();
    expect(await p.runAiCapped('m', {} as never, { isLesson: true })).not.toBeNull();
    expect(calls).toBe(1);
    p.quota.consumeNeurons('x', 2_400, 'llm'); // 95%
    expect(await p.runAiCapped('m', {} as never, { isLesson: true })).toBeNull();
    expect(calls).toBe(1);
    expect(p.quota.getStatus(Date.now()).neuronsUsed).toBe(9_500);
  });

  it('a running lesson holds the last 3,000 neurons: solo AI stops at the reserve, the lesson keeps it', async () => {
    let calls = 0;
    const { p, call } = await setup({ AI: { run: async () => { calls++; return {}; } } });
    // limit 5,000 with 2,500 used: stage 0 (50%), but only 2,500 remain, under the 3,000 lesson share
    await setQuota(call, { daily_neurons: 5_000 });
    p.quota.consumeNeurons('x', 2_500, 'llm');
    expect(await p.runAiCapped('m', {} as never)).not.toBeNull(); // no lesson yet: solo may use it
    p.sql.run('insert into lessons (id, player_id, world_id, started_at, ended_at, plan) values (?, ?, ?, ?, null, ?)', ['L-1', 'kid', 'w', Date.now() - 5 * 60_000, '{}']);
    const v = (await (await call('/v1/admin/quota', { headers: op })).json()) as Record<string, any>;
    expect(v).toMatchObject({ stage: 0, lesson_reserve_active: true });
    expect(await p.runAiCapped('m', {} as never)).toBeNull(); // solo stops at the reserve
    expect(await p.runAiCapped('m', {} as never, { isLesson: true })).not.toBeNull();
    expect(calls).toBe(2);
  });

  it('the hourly cron records the stage and keeps a day that reached 85% as an alert day', async () => {
    const { p, call } = await setup();
    const quiet = p.runCron('0 * * * *');
    expect(quiet.detail).toMatchObject({ quota: { stage: 0, alert: false } });
    p.quota.consumeNeurons('x', 8_600, 'stt', 60);
    const loud = p.runCron('0 * * * *');
    expect(loud.detail).toMatchObject({ quota: { stage: 2, used: 8_600, alert: true } });
    const v = (await (await call('/v1/admin/quota', { headers: op })).json()) as Record<string, any>;
    expect(v.alert_days).toEqual([{ day: p.quota.getDay(), stage: 2 }]);
    const health = (await (await call('/v1/admin/health', { headers: op })).json()) as Record<string, any>;
    expect(health.quota).toMatchObject({ stage: 2, neurons_used: 8_600, bank_only: false });
  });
});
