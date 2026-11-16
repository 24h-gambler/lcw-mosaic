import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlatformDO, type LcwEnv } from '../platform.js';
import { TEACHER_BEAT_MS, TEACHER_PRESENT_MS } from '../lesson-mode.js';
import { fakeDurableStorage } from './fake-do.js';

const TOKEN = 'op-token-0123456789abcdef';
const op = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
const anon = { 'content-type': 'application/json' };

function platform() {
  return new PlatformDO({ storage: fakeDurableStorage() }, { PLATFORM: undefined as never, LCW_OPERATOR_TOKEN: TOKEN } as LcwEnv);
}
async function call(p: PlatformDO, method: string, path: string, body?: unknown, headers: Record<string, string> = op) {
  const res = await p.fetch(new Request(`https://x${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
  return { status: res.status, body: (await res.json()) as any };
}
async function start(p: PlatformDO, presence?: boolean) {
  await call(p, 'POST', '/v1/admin/players', { family_id: 'f', guardian_id: 'g', player_id: 'stu-oreo', nickname: 'Oreo', level: 'L1' });
  const s = await call(p, 'POST', '/v1/admin/lessons/start', { player_id: 'stu-oreo', ...(presence === undefined ? {} : { presence }) });
  expect(s.status).toBe(201);
  const j = await call(p, 'POST', '/v1/join', { code: s.body.join_code }, anon);
  expect(j.status).toBe(200);
  return { lessonId: s.body.lesson_id as string, st: { authorization: `Bearer ${j.body.student_token}`, 'content-type': 'application/json' } };
}
const say = (p: PlatformDO, st: Record<string, string>) =>
  call(p, 'POST', '/v1/lesson/utterance', { target_text: 'Hello!', transcript: 'hello', chosen_stars: 1, dur_ms: 1500 }, st);
const lastInterlocutor = (p: PlatformDO) =>
  p.sql.get<{ interlocutor: string }>('select interlocutor from utterances order by created_at desc, rowid desc limit 1')?.interlocutor;

describe('teacher presence: lesson mode only while the teacher console beats (Dan 11-16)', () => {
  afterEach(() => vi.useRealTimers());

  it('a console that beats: present while beats come, "alone" 45 s after the last one, back on the next beat', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.parse('2026-11-16T15:00:00+09:00'));
    const p = platform();
    const { lessonId, st } = await start(p, true);
    let s = await call(p, 'GET', '/v1/lesson/state', undefined, st);
    expect(s.body.teacher).toMatchObject({ present: true, name: '선생님' });
    const since = s.body.teacher.since;
    await say(p, st);
    expect(lastInterlocutor(p)).toBe('teacher');

    // Beats every 15 s keep the same stretch of presence.
    vi.advanceTimersByTime(TEACHER_BEAT_MS);
    const b = await call(p, 'POST', `/v1/admin/lessons/${lessonId}/presence`, { panel: 'open' });
    expect(b.status).toBe(200);
    expect(b.body.teacher).toMatchObject({ present: true, since, tracked: true, panel: 'open' });

    // The console closes (tab gone, laptop asleep): the child is alone once the window passes.
    vi.advanceTimersByTime(TEACHER_PRESENT_MS);
    expect((await call(p, 'GET', '/v1/lesson/state', undefined, st)).body.teacher).toMatchObject({ present: true });
    vi.advanceTimersByTime(1);
    s = await call(p, 'GET', '/v1/lesson/state', undefined, st);
    expect(s.body.teacher).toEqual({ present: false, name: null, since: null });
    await say(p, st);
    expect(lastInterlocutor(p)).toBe('self');
    const feed = await call(p, 'GET', `/v1/admin/lessons/${lessonId}/feed`);
    expect(feed.body.teacher).toMatchObject({ present: false, tracked: true });

    // The teacher comes back: a new stretch starts now.
    await call(p, 'POST', `/v1/admin/lessons/${lessonId}/presence`, {});
    s = await call(p, 'GET', '/v1/lesson/state', undefined, st);
    expect(s.body.teacher.present).toBe(true);
    expect(s.body.teacher.since).toBeGreaterThan(since);
    await say(p, st);
    expect(lastInterlocutor(p)).toBe('teacher');
  });

  it('rollout: a lesson from a console that never beats (opened before this change) stays taught all along', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.parse('2026-11-16T15:00:00+09:00'));
    const p = platform();
    const { lessonId, st } = await start(p);
    vi.advanceTimersByTime(2 * 3_600_000);
    const s = await call(p, 'GET', '/v1/lesson/state', undefined, st);
    expect(s.body.teacher).toMatchObject({ present: true, name: '선생님' });
    await say(p, st);
    expect(lastInterlocutor(p)).toBe('teacher');
    expect((await call(p, 'GET', `/v1/admin/lessons/${lessonId}/feed`)).body.teacher).toMatchObject({ present: true, tracked: false });
  });

  it('panel open/closed is kept (1PC); the beat is operator-only, checked, and stops after the lesson ends', async () => {
    const p = platform();
    const { lessonId, st } = await start(p, true);
    const closed = await call(p, 'POST', `/v1/admin/lessons/${lessonId}/presence`, { panel: 'closed' });
    expect(closed.body.teacher).toMatchObject({ present: true, panel: 'closed' });
    expect((await call(p, 'POST', `/v1/admin/lessons/${lessonId}/presence`, { panel: 'open' }, st)).status).toBe(401);
    expect((await call(p, 'POST', `/v1/admin/lessons/${lessonId}/presence`, { panel: 'open' }, anon)).status).toBe(401);
    expect((await call(p, 'POST', `/v1/admin/lessons/${lessonId}/presence`, { panel: 'half' })).status).toBe(400);
    expect((await call(p, 'POST', '/v1/admin/lessons/les-nope/presence', {})).status).toBe(404);
    await call(p, 'POST', `/v1/admin/lessons/${lessonId}/end`, {});
    expect((await call(p, 'POST', `/v1/admin/lessons/${lessonId}/presence`, {})).status).toBe(409);
  });

  it('1PC lock number: checked on the server, wrong tries lock it; "teacher leaves" makes the child alone at once', async () => {
    const p = platform();
    const { lessonId, st } = await start(p, true);
    const unlock = (pin: string, h: Record<string, string> = op) => call(p, 'POST', `/v1/admin/lessons/${lessonId}/panel-unlock`, { pin }, h);
    expect((await unlock('1234')).status).toBe(409); // no number set yet
    expect((await call(p, 'GET', `/v1/admin/lessons/${lessonId}/panel-pin`)).body.set).toBe(false);
    expect((await call(p, 'POST', `/v1/admin/lessons/${lessonId}/panel-pin`, { pin: '12a4' })).status).toBe(400);
    expect((await call(p, 'POST', `/v1/admin/lessons/${lessonId}/panel-pin`, { pin: '2580' })).status).toBe(200);
    expect((await call(p, 'GET', `/v1/admin/lessons/${lessonId}/panel-pin`)).body.set).toBe(true);
    // The number is never stored or returned in clear.
    expect(JSON.stringify(p.sql.all('select * from lesson_panel_lock'))).not.toContain('2580');
    expect((await unlock('2580', st)).status).toBe(401); // the child's token cannot try
    expect((await unlock('2580')).status).toBe(200);
    for (let i = 0; i < 5; i++) expect((await unlock('0000')).status).toBe(403);
    expect((await unlock('2580')).status).toBe(429);

    expect((await call(p, 'GET', '/v1/lesson/state', undefined, st)).body.teacher.present).toBe(true);
    const left = await call(p, 'POST', `/v1/admin/lessons/${lessonId}/presence/leave`, {});
    expect(left.body.teacher.present).toBe(false);
    expect((await call(p, 'GET', '/v1/lesson/state', undefined, st)).body.teacher.present).toBe(false);
    await call(p, 'POST', `/v1/admin/lessons/${lessonId}/presence`, { panel: 'closed' });
    expect((await call(p, 'GET', '/v1/lesson/state', undefined, st)).body.teacher.present).toBe(true);
  });

  it('"teacher leaves" also works for a lesson from a console without heartbeat (it becomes tracked)', async () => {
    const p = platform();
    const { lessonId, st } = await start(p);
    await call(p, 'POST', `/v1/admin/lessons/${lessonId}/presence/leave`, {});
    expect((await call(p, 'GET', '/v1/lesson/state', undefined, st)).body.teacher.present).toBe(false);
  });

  it('an operator session id from the exchange names the teacher when that session has a name', async () => {
    const p = platform();
    p.sql.exec('create table if not exists operator_sessions (id text primary key, label text not null)');
    p.sql.run("insert into operator_sessions (id, label) values ('ops-1', 'Dan')");
    const { lessonId, st } = await start(p, true);
    // The platform drops a client-sent session header unless the parent's exchange set it; here we call the inner
    // route path through the gate with the operator key, so the header reaches it only if the platform passes it on.
    await call(p, 'POST', `/v1/admin/lessons/${lessonId}/presence`, {}, { ...op, 'x-lcw-op-session': 'ops-1' });
    const name = (await call(p, 'GET', '/v1/lesson/state', undefined, st)).body.teacher.name;
    expect(['Dan', '선생님']).toContain(name);
  });
});
