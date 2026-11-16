import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlatformDO, isPublicRoute, type LcwEnv } from '../platform.js';
import { fakeDurableStorage } from './fake-do.js';

/** Operator guardian view (guardian-view.ts): what one child's guardian receives, read without changing anything. */
const TOKEN = 'op-token-0123456789abcdef';
const op = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
const anon = { 'content-type': 'application/json' };
const bearer = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const platform = () => new PlatformDO({ storage: fakeDurableStorage() }, { PLATFORM: undefined as never, LCW_OPERATOR_TOKEN: TOKEN } as LcwEnv);
async function call(p: PlatformDO, method: string, path: string, body?: unknown, headers: Record<string, string> = op) {
  const res = await p.fetch(new Request(`https://x${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
  const t = await res.text();
  return { status: res.status, headers: res.headers, body: (t ? JSON.parse(t) : null) as any };
}

afterEach(() => vi.useRealTimers());

describe('operator guardian view: the /family home card, dashboard, report deliveries and push notices of one child', () => {
  it('after a lesson it shows exactly what the guardian sees, names no guardian, and reading it changes nothing', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-16T06:00:00Z'));
    const p = platform();
    await call(p, 'POST', '/v1/admin/players', { family_id: 'fam-oreo', guardian_id: 'g-oreo-parent', player_id: 'stu-1', nickname: 'Oreo', birth_year: 2016, level: 'L1' });

    // before the guardian signs in: no sessions, an open invite, no lessons
    const before = await call(p, 'GET', '/v1/admin/children/stu-1/guardian-view');
    expect(before.status).toBe(200);
    expect(before.body.signin).toEqual({ invites_open: 0, invites_used: 0, sessions_active: 0, service_consented: false });
    expect(before.body.home.reports).toEqual([]);
    expect(before.body.dashboard.lessons).toEqual([]);
    expect(before.body.seat).toMatchObject({ state: null });

    const inv = await call(p, 'POST', '/v1/admin/family-invites', { player_id: 'stu-1' });
    expect((await call(p, 'GET', '/v1/admin/children/stu-1/guardian-view')).body.signin.invites_open).toBe(1);
    const s = await call(p, 'POST', '/v1/family/session', { invite: inv.body.invite_path.split('#k=')[1] }, anon);
    const g = bearer(s.body.guardian_token);
    await call(p, 'POST', '/v1/family/service-consent', { granted: true }, g);

    // a lesson: two answers, the teacher's comment, the report
    const start = await call(p, 'POST', '/v1/admin/lessons/start', { player_id: 'stu-1' });
    const j = await call(p, 'POST', '/v1/join', { code: start.body.join_code }, anon);
    const st = bearer(j.body.student_token);
    vi.setSystemTime(new Date('2026-11-16T06:10:00Z'));
    await call(p, 'POST', '/v1/lesson/utterance', { target_text: 'Can I have a warm honey tea?', transcript: 'can I have a warm honey tea', chosen_stars: 2, dur_ms: 2000 }, st);
    await call(p, 'POST', '/v1/lesson/utterance', { target_text: 'Can I have a warm honey tea?', transcript: 'banana', chosen_stars: 1, dur_ms: 900 }, st);
    vi.setSystemTime(new Date('2026-11-16T06:50:00Z'));
    const end = await call(p, 'POST', `/v1/admin/lessons/${start.body.lesson_id}/end`, { teacher_comment: '주문을 끝까지 했어요', next_lesson_at: '11-19 15:00' });
    expect(end.status).toBe(200);

    const v = await call(p, 'GET', '/v1/admin/children/stu-1/guardian-view');
    expect(v.headers.get('cache-control')).toBe('private, no-store');
    const me = await call(p, 'GET', '/v1/family/me', undefined, g);
    const dash = await call(p, 'GET', '/v1/family/children/stu-1/dashboard', undefined, g);
    // the same functions as the guardian's own routes: equal, not "similar"
    expect(v.body.home).toEqual(me.body.children[0]);
    expect(v.body.dashboard).toEqual(dash.body);
    expect(v.body.signin).toEqual({ invites_open: 0, invites_used: 1, sessions_active: 1, service_consented: true });
    expect(v.body.home.reports).toHaveLength(1);
    expect(v.body.home.reports[0]).toMatchObject({ share_path: end.body.report_path, opened: false, expired: false, revoked: false, lesson_day: '2026-11-16' });
    expect(v.body.dashboard.lessons[0]).toMatchObject({ id: start.body.lesson_id, utterances: 2, passes: 1, report_path: end.body.report_path, duration_min: 50 });
    expect(v.body.dashboard.next_lesson_at).toBe('11-19 15:00');
    expect(v.body.deliveries).toEqual([
      {
        report_id: `rep-${start.body.lesson_id}`,
        kind: 'lesson',
        share_path: end.body.report_path,
        status: 'sent',
        sent_at: Date.parse('2026-11-16T06:50:00Z'),
        opened_at: null,
        reminder_sent_at: null,
        next_lesson_at: '11-19 15:00',
        teacher_comment: true
      }
    ]);
    expect(v.body.push).toMatchObject({ sending: false, devices: 0 });
    expect(v.body.push.outbox).toEqual([
      expect.objectContaining({ kind: 'lesson_report', ref: `report:rep-${start.body.lesson_id}`, status: 'queued', sent_at: null })
    ]);
    // no guardian id and no teacher comment text (the comment belongs to the report page)
    const text = JSON.stringify(v.body);
    expect(text).not.toContain('g-oreo-parent');
    expect(text).not.toContain('주문을 끝까지');

    // reading the view, and the teacher's preview of the report, record no parent open
    expect((await call(p, 'GET', `/v1/reports/${end.body.share_token}`)).status).toBe(200);
    const again = await call(p, 'GET', '/v1/admin/children/stu-1/guardian-view');
    expect(again.body.home.reports[0].opened).toBe(false);
    expect(again.body.deliveries[0].opened_at).toBeNull();
    // the guardian opening it is seen
    await call(p, 'GET', `/v1/reports/${end.body.share_token}`, undefined, anon);
    const opened = await call(p, 'GET', '/v1/admin/children/stu-1/guardian-view');
    expect(opened.body.home.reports[0].opened).toBe(true);
    expect(opened.body.deliveries[0]).toMatchObject({ status: 'opened', opened_at: Date.parse('2026-11-16T06:50:00Z') });
  });

  it('operator only; unknown child is 404', async () => {
    expect(isPublicRoute('GET', '/v1/admin/children/stu-1/guardian-view')).toBe(false);
    const p = platform();
    await call(p, 'POST', '/v1/admin/players', { family_id: 'fam-a', guardian_id: 'g-a', player_id: 'kid-1', nickname: 'Juno', birth_year: 2016, level: 'L1' });
    const inv = await call(p, 'POST', '/v1/admin/family-invites', { player_id: 'kid-1' });
    const s = await call(p, 'POST', '/v1/family/session', { invite: inv.body.invite_path.split('#k=')[1] }, anon);
    expect((await call(p, 'GET', '/v1/admin/children/kid-1/guardian-view', undefined, anon)).status).toBe(401);
    expect((await call(p, 'GET', '/v1/admin/children/kid-1/guardian-view', undefined, bearer(s.body.guardian_token))).status).toBe(401);
    expect((await call(p, 'GET', '/v1/admin/children/nobody/guardian-view')).status).toBe(404);
  });
});
