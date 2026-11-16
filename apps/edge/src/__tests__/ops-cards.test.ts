import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlatformDO, type LcwEnv } from '../platform.js';
import { LESSON_SUMMARY_IMPORTANCE, OPS_CARD_SOURCE, STUDENT_DAILY_IMPORTANCE } from '../ops-cards.js';
import { fakeDurableStorage } from './fake-do.js';

const TOKEN = 'op-token-0123456789abcdef';
const op = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };

function platform() {
  return new PlatformDO({ storage: fakeDurableStorage() }, { PLATFORM: undefined as never, LCW_OPERATOR_TOKEN: TOKEN } as LcwEnv);
}
async function call(p: PlatformDO, method: string, path: string, body?: unknown, headers: Record<string, string> = op) {
  const res = await p.fetch(new Request(`https://lcw.test${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
  return { status: res.status, body: (await res.json()) as any };
}
async function lessonWithSpeech(p: PlatformDO, n: number) {
  const s = await call(p, 'POST', '/v1/admin/lessons/start', { player_id: 'kid-o' });
  const j = await call(p, 'POST', '/v1/join', { code: s.body.join_code }, { 'content-type': 'application/json' });
  const st = { authorization: `Bearer ${j.body.student_token}`, 'content-type': 'application/json' };
  await call(p, 'POST', `/v1/admin/lessons/${s.body.lesson_id}/stage`, { stage_id: 'cafe_order', targets: ['Can I have a warm honey tea?'] });
  for (let i = 0; i < n; i++) {
    const r = await call(
      p,
      'POST',
      '/v1/lesson/utterance',
      { target_text: 'Can I have a warm honey tea?', transcript: 'can I have a warm honey tea', chosen_stars: 2, dur_ms: 2000, client_id: `u${s.body.lesson_id.slice(-6)}${i}abc` },
      st
    );
    expect(r.status).toBe(200);
  }
  return s.body.lesson_id as string;
}

describe('hub cards from the server (ops-cards.ts outbox)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('a lesson end queues the summary (2) and the daily record (1): numbers and nickname only, operator only', async () => {
    let now = Date.parse('2026-11-16T15:00:00+09:00');
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const p = platform();
    await call(p, 'POST', '/v1/admin/players', { family_id: 'fam-o', guardian_id: 'g-o', player_id: 'kid-o', nickname: 'Ollie', level: 'L1' });
    const id = await lessonWithSpeech(p, 3);
    expect((await call(p, 'GET', '/v1/admin/outbox/cards')).body.cards).toEqual([]); // nothing before the end
    now += 40 * 60_000;
    const end = await call(p, 'POST', `/v1/admin/lessons/${id}/end`, {});
    expect(end.status).toBe(200);

    expect((await call(p, 'GET', '/v1/admin/outbox/cards', undefined, { 'content-type': 'application/json' })).status).toBe(401);
    const box = await call(p, 'GET', '/v1/admin/outbox/cards');
    expect(box.status).toBe(200);
    const cards = box.body.cards as Array<{ ref: string; updated_at: number; card: any }>;
    expect(cards.map((c) => c.ref).sort()).toEqual([`${OPS_CARD_SOURCE}:lcw:lesson:${id}:summary`, `${OPS_CARD_SOURCE}:lcw:student:kid-o:2026-11-16`]);
    const summary = cards.find((c) => c.ref.endsWith(':summary'))!.card;
    expect(summary).toMatchObject({ source: OPS_CARD_SOURCE, importance: LESSON_SUMMARY_IMPORTANCE });
    expect(summary.title).toContain('Ollie');
    expect(summary.title).toContain('40분');
    expect(summary.title).toContain('말 3번');
    expect(summary.actions[0]).toMatchObject({ type: 'open', url: 'https://lcw.test/director' });
    const daily = cards.find((c) => c.ref.includes(':student:'))!.card;
    expect(daily).toMatchObject({ importance: STUDENT_DAILY_IMPORTANCE });
    expect(daily.body).toContain('수업 1번');
    // nothing a child said, and no parent share token
    const text = JSON.stringify(cards);
    expect(text).not.toMatch(/honey|can i have/i);
    expect(text).not.toContain(end.body.share_token);
  });

  it('ack takes the version it posted; a rewrite after the pull goes again; an unchanged card is not resent', async () => {
    let now = Date.parse('2026-11-16T15:00:00+09:00');
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const p = platform();
    await call(p, 'POST', '/v1/admin/players', { family_id: 'fam-o', guardian_id: 'g-o', player_id: 'kid-o', nickname: 'Ollie', level: 'L1' });
    const first = await lessonWithSpeech(p, 1);
    now += 10 * 60_000;
    await call(p, 'POST', `/v1/admin/lessons/${first}/end`, {});
    const pulled = (await call(p, 'GET', '/v1/admin/outbox/cards')).body.cards as Array<{ ref: string; updated_at: number }>;
    const dailyRef = pulled.find((c) => c.ref.includes(':student:'))!.ref;
    const stale = pulled.find((c) => c.ref === dailyRef)!.updated_at;

    // a second lesson the same day rewrites the daily record before the first pull is acked
    now += 5 * 60_000;
    const second = await lessonWithSpeech(p, 2);
    now += 10 * 60_000;
    await call(p, 'POST', `/v1/admin/lessons/${second}/end`, {});
    const ack = await call(p, 'POST', '/v1/admin/outbox/cards/ack', { items: pulled.map((c) => ({ ref: c.ref, updated_at: c.updated_at, spine_id: 'p_aaaaaaaaaaaa' })) });
    expect(ack.body.acked).toBe(1); // the first summary; the daily record changed since (stale version)
    const left = (await call(p, 'GET', '/v1/admin/outbox/cards')).body.cards as Array<{ ref: string; updated_at: number; card: any }>;
    expect(left.map((c) => c.ref).sort()).toEqual([`${OPS_CARD_SOURCE}:lcw:lesson:${second}:summary`, dailyRef].sort());
    const daily = left.find((c) => c.ref === dailyRef)!;
    expect(daily.updated_at).toBeGreaterThan(stale);
    expect(daily.card.body).toContain('수업 2번');
    expect(daily.card.body).toContain('말한 횟수 3');
    expect((await call(p, 'POST', '/v1/admin/outbox/cards/ack', { items: left.map((c) => ({ ref: c.ref, updated_at: c.updated_at })) })).body.acked).toBe(2);
    expect((await call(p, 'GET', '/v1/admin/outbox/cards')).body.cards).toEqual([]);

    // ending again (another device, a double tap) hands back the report and queues nothing new
    const again = await call(p, 'POST', `/v1/admin/lessons/${second}/end`, {});
    expect(again.body.already_ended).toBe(true);
    expect((await call(p, 'GET', '/v1/admin/outbox/cards')).body.cards).toEqual([]);
    expect((await call(p, 'POST', '/v1/admin/outbox/cards/ack', { items: [] })).status).toBe(400);
  });
});
