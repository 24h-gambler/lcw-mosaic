import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlatformDO, type LcwEnv } from '../platform.js';
import { fakeDurableStorage } from './fake-do.js';

const TOKEN = 'op-token-0123456789abcdef';
const op = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };

function platform() {
  return new PlatformDO({ storage: fakeDurableStorage() }, { PLATFORM: undefined as never, LCW_OPERATOR_TOKEN: TOKEN } as LcwEnv);
}
async function call(p: PlatformDO, method: string, path: string, body?: unknown, headers: Record<string, string> = op) {
  const res = await p.fetch(new Request(`https://x${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
  return { status: res.status, body: (await res.json()) as any };
}
async function startLesson(p: PlatformDO) {
  await call(p, 'POST', '/v1/admin/players', { family_id: 'fam-o', guardian_id: 'g-o', player_id: 'kid-o', nickname: 'Ollie', level: 'L1' });
  const s = await call(p, 'POST', '/v1/admin/lessons/start', { player_id: 'kid-o' });
  const join = async () => {
    const j = await call(p, 'POST', '/v1/join', { code: s.body.join_code }, { 'content-type': 'application/json' });
    return { authorization: `Bearer ${j.body.student_token}`, 'content-type': 'application/json' };
  };
  return { lessonId: s.body.lesson_id as string, st: await join(), join };
}
const answer = (extra: Record<string, unknown> = {}) => ({
  target_text: 'Can I have a warm honey tea?',
  transcript: 'can I have a warm honey tea',
  chosen_stars: 2,
  dur_ms: 2000,
  ...extra
});

describe('lesson answers through a disconnect (client_id, stage_id)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('a resend with the same client_id is the same answer: one utterance, one credit, the same stars', async () => {
    const p = platform();
    const { lessonId, st, join } = await startLesson(p);
    await call(p, 'POST', `/v1/admin/lessons/${lessonId}/stage`, { stage_id: 'cafe_order', targets: ['Can I have a warm honey tea?'] });
    const first = await call(p, 'POST', '/v1/lesson/utterance', answer({ client_id: 'uabc12345' }), st);
    expect(first.status).toBe(200);
    expect(first.body.coins_total).toBe(220);
    // the response was lost; the device sends it again, even after a refresh re-joined with a new token
    const st2 = await join();
    const again = await call(p, 'POST', '/v1/lesson/utterance', answer({ client_id: 'uabc12345' }), st2);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ pass: first.body.pass, stars: first.body.stars, coins_total: 220, lesson_stars: 2, replayed: true });
    const state = await call(p, 'GET', '/v1/lesson/state', undefined, st2);
    expect(state.body.lesson_stars).toBe(2);
    expect(state.body.coins_balance).toBe(220);
    // a different id is a new answer (stored, not replayed) — the same sentence again, so a repeat: no stars, no coins
    // (R2627 stars once per goal)
    const other = await call(p, 'POST', '/v1/lesson/utterance', answer({ client_id: 'uabc99999' }), st2);
    expect(other.body.replayed).toBeUndefined();
    expect(other.body).toMatchObject({ repeat: true, stars: 0, coins_total: 220, lesson_stars: 2 });
    // two copies arriving together (a retry racing the lost first send) are stored once
    const [x, y] = await Promise.all([
      call(p, 'POST', '/v1/lesson/utterance', answer({ client_id: 'urace0001' }), st2),
      call(p, 'POST', '/v1/lesson/utterance', answer({ client_id: 'urace0001' }), st2)
    ]);
    expect([x.status, y.status].sort()).toEqual(x.status === 409 || y.status === 409 ? [200, 409] : [200, 200]);
    const feed = await call(p, 'GET', `/v1/admin/lessons/${lessonId}/feed`);
    expect(feed.body.utterances).toHaveLength(3);
    // ids outside the rule are refused, not silently treated as new
    expect((await call(p, 'POST', '/v1/lesson/utterance', answer({ client_id: 'bad id!' }), st2)).status).toBe(400);
  });

  it('an answer sent late is scored in the stage it was said in and reaches the console feed', async () => {
    let now = Date.parse('2026-11-16T15:00:00+09:00');
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const p = platform();
    const { lessonId, st } = await startLesson(p);
    await call(p, 'POST', `/v1/admin/lessons/${lessonId}/stage`, { stage_id: 'cafe_order', targets: ['Can I have a warm honey tea?'] });
    now += 60_000;
    // the console looked at the feed just now; the child answered offline, then the teacher moved on to free talk
    const seenAt = now;
    now += 30_000;
    await call(p, 'POST', `/v1/admin/lessons/${lessonId}/stage`, { stage_id: 'open_question', targets: [] });
    now += 10_000;
    const late = await call(p, 'POST', '/v1/lesson/utterance', answer({ client_id: 'ulate0001', stage_id: 'cafe_order' }), st);
    expect(late.status).toBe(200);
    expect(late.body.pass).toBe(true);
    expect(late.body.stars).toBe(2);
    const feed = await call(p, 'GET', `/v1/admin/lessons/${lessonId}/feed?since=${seenAt}`);
    // scored against the cafe sentence (guided), not as free talk of the new stage; stored at arrival, so it shows
    expect(feed.body.utterances.map((u: any) => [u.transcript, u.mode])).toEqual([['can I have a warm honey tea', 'guided']]);
    // a stage the teacher never opened in this lesson is not taken: the current stage (free talk) scores it
    now += 1_000;
    const odd = await call(p, 'POST', '/v1/lesson/utterance', answer({ client_id: 'uodd00001', stage_id: 'recall_today' }), st);
    expect(odd.status).toBe(200);
    const feed2 = await call(p, 'GET', `/v1/admin/lessons/${lessonId}/feed?since=${now - 1}`);
    expect(feed2.body.utterances.map((u: any) => u.mode)).toEqual(['free']);
  });
});
