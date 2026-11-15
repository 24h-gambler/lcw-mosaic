import { describe, expect, it } from 'vitest';
import { PlatformDO, type LcwEnv } from '../platform.js';
import { JOIN_FAILS_PER_HOUR, makeJoinCode, scoreFreeTalk } from '../lesson-mode.js';
import { fakeDurableStorage } from './fake-do.js';

const TOKEN = 'op-token-0123456789abcdef';
const op = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };

function platform() {
  return new PlatformDO({ storage: fakeDurableStorage() }, { PLATFORM: undefined as never, LCW_OPERATOR_TOKEN: TOKEN } as LcwEnv);
}
async function call(p: PlatformDO, method: string, path: string, body?: unknown, headers: Record<string, string> = op) {
  const res = await p.fetch(
    new Request(`https://x${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  );
  return { status: res.status, body: (await res.json()) as any };
}

async function startLesson(p: PlatformDO) {
  await call(p, 'POST', '/v1/admin/players', {
    family_id: 'fam-kim',
    guardian_id: 'g-kim',
    player_id: 'kid-1',
    nickname: 'Juno',
    birth_year: 2016,
    level: 'L1'
  });
  const s = await call(p, 'POST', '/v1/admin/lessons/start', { player_id: 'kid-1' });
  expect(s.status).toBe(201);
  const j = await call(p, 'POST', '/v1/join', { code: s.body.join_code }, { 'content-type': 'application/json' });
  expect(j.status).toBe(200);
  const st = { authorization: `Bearer ${j.body.student_token}`, 'content-type': 'application/json' };
  return { lessonId: s.body.lesson_id as string, code: s.body.join_code as string, st, plan: s.body.plan };
}

describe('lesson mode (docs/18)', () => {
  it('join codes are 6 digits and free talk scores by length', () => {
    expect(makeJoinCode(new Uint8Array([0, 0, 0, 7]))).toBe('000007');
    expect(scoreFreeTalk('hi').pass).toBe(false);
    expect(scoreFreeTalk('I like playing soccer with my dad').stars).toBe(2);
  });

  it('runs a whole lesson: start, join, stage, utterances, feed, pins, daily, end → parent report', async () => {
    const p = platform();
    const { lessonId, st, plan } = await startLesson(p);
    expect(plan.id).toBe('first_lesson_v1');

    const state0 = await call(p, 'GET', '/v1/lesson/state', undefined, st);
    expect(state0.body.stage_id).toBe('warmup_anchor');
    expect(state0.body.targets.length).toBeGreaterThan(0);

    expect((await call(p, 'POST', `/v1/admin/lessons/${lessonId}/stage`, { stage_id: 'cafe_order', targets: ['Can I have a warm honey tea?'] })).status).toBe(200);
    const pass = await call(
      p,
      'POST',
      '/v1/lesson/utterance',
      { target_text: 'Can I have a warm honey tea?', transcript: 'can I have a warm honey tea', chosen_stars: 2, dur_ms: 2500 },
      st
    );
    expect(pass.body.pass).toBe(true);
    expect(pass.body.stars).toBe(2);
    expect(pass.body.coins_total).toBe(20);
    expect(pass.body.utterances_today).toBe(1);
    expect(pass.body.feedback_ko).toMatch(/통과|완벽/);

    // 3-star sentence without the connector is capped (docs/04 §4.6)
    const capped = await call(
      p,
      'POST',
      '/v1/lesson/utterance',
      { target_text: 'Can I have a warm honey tea so that I stay warm?', transcript: 'can I have a warm honey tea I stay warm', chosen_stars: 3 },
      st
    );
    expect(capped.body.pass).toBe(false);
    expect(capped.body.feedback_ko).toContain('연결어');

    const fail = await call(p, 'POST', '/v1/lesson/utterance', { target_text: 'Can I have a warm honey tea?', transcript: 'banana', chosen_stars: 1 }, st);
    expect(fail.body.pass).toBe(false);
    expect(fail.body.stars).toBe(0);
    expect(fail.body.utterances_today).toBe(3);

    expect((await call(p, 'POST', `/v1/admin/lessons/${lessonId}/pins`, { kind: 'expression', at_ms: 1000, note: 'honey tea' })).status).toBe(201);

    const feed = await call(p, 'GET', `/v1/admin/lessons/${lessonId}/feed`);
    expect(feed.body.lesson.nickname).toBe('Juno');
    expect(feed.body.lesson.stage_id).toBe('cafe_order');
    expect(feed.body.utterances).toHaveLength(3);
    expect(feed.body.live.utterances).toBe(3);
    expect(feed.body.live.passes).toBe(1);
    expect(feed.body.pins).toHaveLength(1);
    const since = feed.body.utterances[1].at;
    expect((await call(p, 'GET', `/v1/admin/lessons/${lessonId}/feed?since=${since}`)).body.utterances.length).toBeLessThanOrEqual(1);

    const students = await call(p, 'GET', '/v1/admin/students');
    expect(students.body.find((s: any) => s.player_id === 'kid-1').utterances_7d).toBe(3);
    const daily = await call(p, 'GET', '/v1/admin/daily');
    expect(daily.body.students[0]).toMatchObject({ player_id: 'kid-1', nickname: 'Juno', utterances: 3, passes: 1, lessons: 1 });
    const kidDaily = await call(p, 'GET', '/v1/admin/students/kid-1/daily?days=3');
    expect(kidDaily.body).toHaveLength(3);
    expect(kidDaily.body[2].utterances).toBe(3);

    const end = await call(p, 'POST', `/v1/admin/lessons/${lessonId}/end`, { teacher_comment: '카페 주문을 끝까지 했어요', next_lesson_at: '11-19 17:30' });
    expect(end.status).toBe(200);
    expect(end.body.share_token.length).toBeGreaterThanOrEqual(32);
    const report = await call(p, 'GET', `/v1/reports/${end.body.share_token}`, undefined, {});
    expect(report.status).toBe(200);
    expect(report.body.kind).toBe('lesson');
    expect(report.body.ref_id).toBe(lessonId);
    expect(JSON.stringify(report.body)).not.toContain('kid-1');

    const after = await call(p, 'GET', '/v1/lesson/state', undefined, st);
    expect(after.body.ended).toBe(true);
  });

  it('guards: student token cannot reach admin routes; anonymous cannot speak; bad codes rate-limited', async () => {
    const p = platform();
    const { st } = await startLesson(p);
    expect((await call(p, 'GET', '/v1/admin/students', undefined, st)).status).toBe(401);
    expect((await call(p, 'POST', '/v1/lesson/utterance', { transcript: 'hello there friend' }, { 'content-type': 'application/json' })).status).toBe(401);
    expect((await call(p, 'POST', '/v1/admin/lessons/start', { player_id: 'kid-1' }, { 'content-type': 'application/json' })).status).toBe(401);
    const anon = { 'content-type': 'application/json' };
    let last = 0;
    for (let i = 0; i <= JOIN_FAILS_PER_HOUR; i++) last = (await call(p, 'POST', '/v1/join', { code: '999999' }, anon)).status;
    expect(last).toBe(429);
  });
});
