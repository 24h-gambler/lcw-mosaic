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
    expect(s.body.teacher).toMatchObject({ present: true, name: null });
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
    expect(s.body.teacher).toMatchObject({ present: true, name: null });
    await say(p, st);
    expect(lastInterlocutor(p)).toBe('teacher');
    expect((await call(p, 'GET', `/v1/admin/lessons/${lessonId}/feed`)).body.teacher).toMatchObject({ present: true, tracked: false });
  });

  it('panel open/closed is kept (1PC); the beat is operator-only, checked, and stops after the lesson ends', async () => {
    const p = platform();
    const { lessonId, st } = await start(p, true);
    const closed = await call(p, 'POST', `/v1/admin/lessons/${lessonId}/presence`, { panel: 'closed', source: 'panel' });
    expect(closed.body.teacher).toMatchObject({ present: true, panel: 'closed' });
    // A console on the same PC beating 'open' does not reopen the panel state (review #70 ①).
    const consoleBeat = await call(p, 'POST', `/v1/admin/lessons/${lessonId}/presence`, { panel: 'open' });
    expect(consoleBeat.body.teacher).toMatchObject({ present: true, panel: 'closed' });
    expect((await call(p, 'POST', `/v1/admin/lessons/${lessonId}/presence`, { panel: 'open', source: 'phone' })).status).toBe(400);
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
    // The console left open on the same PC keeps beating: it must not undo the leave (review #70 ①).
    const consoleBeat = await call(p, 'POST', `/v1/admin/lessons/${lessonId}/presence`, { panel: 'open' });
    expect(consoleBeat.body).toMatchObject({ left: true, teacher: { present: false } });
    expect((await call(p, 'POST', `/v1/admin/lessons/${lessonId}/presence`, {})).body.left).toBe(true);
    expect((await call(p, 'GET', '/v1/lesson/state', undefined, st)).body.teacher.present).toBe(false);
    // An unlocked panel still beating does not undo it either (review #70, second pass).
    expect((await call(p, 'POST', `/v1/admin/lessons/${lessonId}/presence`, { panel: 'closed', source: 'panel' })).body.left).toBe(true);
    // Unlocking the panel again (its first beat says resume) brings the teacher back, and the console counts again.
    const back = await call(p, 'POST', `/v1/admin/lessons/${lessonId}/presence`, { panel: 'closed', source: 'panel', resume: true });
    expect(back.body).toMatchObject({ left: false, teacher: { present: true, panel: 'closed' } });
    expect((await call(p, 'POST', `/v1/admin/lessons/${lessonId}/presence`, {})).body.left).toBe(false);
    expect((await call(p, 'GET', '/v1/lesson/state', undefined, st)).body.teacher.present).toBe(true);
  });

  it('after "teacher leaves", the console comes back only on purpose (resume)', async () => {
    const p = platform();
    const { lessonId, st } = await start(p, true);
    await call(p, 'POST', `/v1/admin/lessons/${lessonId}/presence/leave`, {});
    expect((await call(p, 'POST', `/v1/admin/lessons/${lessonId}/presence`, { panel: 'open' })).body.teacher.present).toBe(false);
    const resumed = await call(p, 'POST', `/v1/admin/lessons/${lessonId}/presence`, { panel: 'open', resume: true });
    // The leave folded the panel away; coming back from the console opens it again in the record.
    expect(resumed.body).toMatchObject({ left: false, teacher: { present: true, panel: 'open' } });
    expect((await call(p, 'GET', '/v1/lesson/state', undefined, st)).body.teacher.present).toBe(true);
  });

  it('"teacher leaves" also works for a lesson from a console without heartbeat (it becomes tracked)', async () => {
    const p = platform();
    const { lessonId, st } = await start(p);
    await call(p, 'POST', `/v1/admin/lessons/${lessonId}/presence/leave`, {});
    expect((await call(p, 'GET', '/v1/lesson/state', undefined, st)).body.teacher.present).toBe(false);
  });

  it('the child device reports its one-time mic check on the poll; the console sees it (only the four values)', async () => {
    const p = platform();
    const { lessonId, st } = await start(p, true);
    const mic = async () => (await call(p, 'GET', `/v1/admin/lessons/${lessonId}/feed`)).body.student_view.mic;
    await call(p, 'GET', '/v1/lesson/state', undefined, st);
    expect(await mic()).toBeNull();
    await call(p, 'GET', '/v1/lesson/state?mic=quiet', undefined, st);
    expect(await mic()).toBe('quiet');
    await call(p, 'GET', '/v1/lesson/state?mic=loud', undefined, st); // not one of the four: kept as it was
    expect(await mic()).toBe('quiet');
    await call(p, 'GET', '/v1/lesson/state?mic=ok', undefined, st);
    expect(await mic()).toBe('ok');
  });

  // The real sign-in (#87, operator-login.ts): the account's name lives in operators, the session label is the device.
  // Only the platform's exchange sets x-lcw-op-session, from a Google session token; a header the client sends is dropped.
  const googleSignIn = async (p: PlatformDO, id: string, name: string): Promise<Record<string, string>> => {
    const session = 'lcwop_' + id.padEnd(64, id.slice(-1));
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(session));
    const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    p.sql.run('insert into operators (id, google_sub, email, name, created_at, last_login_at) values (?, ?, ?, ?, 1, 1)', [
      `op-${id}`,
      `g-${id}`,
      'teacher@example.com',
      name
    ]);
    p.sql.run(
      'insert into operator_sessions (id, token_hash, operator_id, label, created_at, expires_at, last_seen_at, revoked_at) values (?, ?, ?, ?, ?, ?, ?, null)',
      [`ops-${id}`, hash, `op-${id}`, 'Chrome on Windows', 1, Date.now() + 86_400_000, 1]
    );
    return { authorization: `Bearer ${session}`, 'content-type': 'application/json' };
  };
  const googlePlatform = () =>
    new PlatformDO(
      { storage: fakeDurableStorage() },
      { PLATFORM: undefined as never, LCW_OPERATOR_TOKEN: TOKEN, LCW_OPERATOR_GOOGLE_EMAILS: 'teacher@example.com' } as LcwEnv
    );

  it('a Google-signed-in console (operator session) names the teacher with the account name, not the device label', async () => {
    const p = googlePlatform();
    const google = await googleSignIn(p, 'a', 'Dan');
    const { lessonId, st } = await start(p, true);
    // A header the client sends itself is dropped (only the exchange sets it): no name, the child sees "선생님".
    await call(p, 'POST', `/v1/admin/lessons/${lessonId}/presence`, {}, { ...op, 'x-lcw-op-session': 'ops-a' });
    expect((await call(p, 'GET', '/v1/lesson/state', undefined, st)).body.teacher.name).toBeNull();
    // The console signed in with Google beats with its session token: the exchange names the session.
    const b = await call(p, 'POST', `/v1/admin/lessons/${lessonId}/presence`, {}, google);
    expect(b.status).toBe(200);
    expect((await call(p, 'GET', '/v1/lesson/state', undefined, st)).body.teacher.name).toBe('Dan');
  });

  it('teacher name: the name alone; typed > account > none (the screen shows 선생님); blank clears; nameless beats keep', async () => {
    const p = googlePlatform();
    const { lessonId, st } = await start(p, true);
    const nameNow = async () => (await call(p, 'GET', '/v1/lesson/state', undefined, st)).body.teacher.name;
    const beat = (body: unknown, headers: Record<string, string> = op) => call(p, 'POST', `/v1/admin/lessons/${lessonId}/presence`, body, headers);
    // No name anywhere: null, the child's screen says "선생님" (teacherLabel).
    expect(await nameNow()).toBeNull();
    // The title typed anyway is dropped: never "김민지 선생님 선생님" on the child's screen.
    await beat({ name: '  김민지 선생님 ' });
    expect(await nameNow()).toBe('김민지');
    // The 1PC panel's beats say nothing about the name: it stays.
    await beat({ panel: 'closed', source: 'panel' });
    expect(await nameNow()).toBe('김민지');
    for (const bad of ['x'.repeat(17), 'a<b>', `tab${String.fromCharCode(9)}here`]) expect((await beat({ name: bad })).status).toBe(400);
    // Signed in with Google: the typed name still wins over the account name (review #80: typed > account > default).
    const google = await googleSignIn(p, 'b', 'Dan');
    await beat({ name: '김민지' }, google);
    expect(await nameNow()).toBe('김민지');
    // Emptying the field clears the typed name: back to the account name...
    await beat({ name: '' }, google);
    expect(await nameNow()).toBe('Dan');
    // ...and "선생님" alone counts as blank too.
    await beat({ name: '선생님' }, google);
    expect(await nameNow()).toBe('Dan');
  });

  it('no operator tables (a platform without Google sign-in): a beat still works and no name is reported', async () => {
    const p = platform();
    const { lessonId, st } = await start(p, true);
    expect((await call(p, 'POST', `/v1/admin/lessons/${lessonId}/presence`, {}, { ...op, 'x-lcw-op-session': 'ops-x' })).status).toBe(200);
    expect((await call(p, 'GET', '/v1/lesson/state', undefined, st)).body.teacher.name).toBeNull();
  });

  it('an untracked lesson (old console) reports no name: the child sees the plain "선생님"', async () => {
    const p = platform();
    const { st } = await start(p);
    expect((await call(p, 'GET', '/v1/lesson/state', undefined, st)).body.teacher).toMatchObject({ present: true, name: null });
  });
});
