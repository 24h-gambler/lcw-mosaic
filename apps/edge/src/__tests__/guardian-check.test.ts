import { describe, expect, it, vi, afterEach } from 'vitest';
import { PlatformDO, type LcwEnv } from '../platform.js';
import { fakeDurableStorage } from './fake-do.js';
// The production guardian check (tools/guardian-check.mjs): importing it touches no token, no network.
import { checkGuardian, maskShare } from '../../../../tools/guardian-check.mjs';

const TOKEN = 'op-token-0123456789abcdef';
const op = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
const anon = { 'content-type': 'application/json' };
const bearer = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const platform = () => new PlatformDO({ storage: fakeDurableStorage() }, { PLATFORM: undefined as never, LCW_OPERATOR_TOKEN: TOKEN } as LcwEnv);
async function call(p: PlatformDO, method: string, path: string, body?: unknown, headers: Record<string, string> = op) {
  const res = await p.fetch(new Request(`https://x${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
  const t = await res.text();
  return { status: res.status, body: (t ? JSON.parse(t) : null) as any };
}
const level = (rows: Array<{ key: string; level: string }>, key: string) => rows.find((r) => r.key === key)?.level;
const html = { status: 200, type: 'text/html; charset=utf-8' };

afterEach(() => vi.useRealTimers());

describe('tools/guardian-check.mjs on a real platform run', () => {
  it('before: no session and no invite fails; an open invite warns; signed in with consent is ok', async () => {
    const p = platform();
    await call(p, 'POST', '/v1/admin/players', { family_id: 'fam-o', guardian_id: 'g-o', player_id: 'stu-o', nickname: 'Oreo', birth_year: 2016, level: 'L1' });
    const view = async () => (await call(p, 'GET', '/v1/admin/children/stu-o/guardian-view')).body;
    expect(level(checkGuardian(await view(), null, null, { before: true }), 'signin')).toBe('fail');
    const inv = await call(p, 'POST', '/v1/admin/family-invites', { player_id: 'stu-o' });
    expect(level(checkGuardian(await view(), null, null, { before: true }), 'signin')).toBe('warn');
    const s = await call(p, 'POST', '/v1/family/session', { invite: inv.body.invite_path.split('#k=')[1] }, anon);
    await call(p, 'POST', '/v1/family/service-consent', { granted: true }, bearer(s.body.guardian_token));
    await call(p, 'PUT', '/v1/family/children/stu-o/consents/lesson_window', { granted: true }, bearer(s.body.guardian_token));
    const rows = checkGuardian(await view(), null, null, { before: true });
    expect(level(rows, 'signin')).toBe('ok');
    expect(level(rows, 'consent_window')).toBe('ok');
    expect(rows.some((r) => r.key === 'lesson')).toBe(false);
  });

  it('after a lesson: every check passes on the real routes; a leak, a missing notice or a dead page fails', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-16T06:00:00Z'));
    const p = platform();
    await call(p, 'POST', '/v1/admin/players', { family_id: 'fam-o', guardian_id: 'g-o', player_id: 'stu-o', nickname: 'Oreo', birth_year: 2016, level: 'L1' });
    const start = await call(p, 'POST', '/v1/admin/lessons/start', { player_id: 'stu-o' });
    const j = await call(p, 'POST', '/v1/join', { code: start.body.join_code }, anon);
    await call(p, 'POST', '/v1/lesson/utterance', { target_text: 'Can I have a warm honey tea?', transcript: 'can I have a warm honey tea', chosen_stars: 2, dur_ms: 2000 }, bearer(j.body.student_token));
    vi.setSystemTime(new Date('2026-11-16T06:50:00Z'));
    const end = await call(p, 'POST', `/v1/admin/lessons/${start.body.lesson_id}/end`, { teacher_comment: 'Oreo 가 주문을 끝까지 했어요', next_lesson_at: '11-19 15:00' });
    const view = (await call(p, 'GET', '/v1/admin/children/stu-o/guardian-view')).body;
    const report = await call(p, 'GET', `/v1/reports/${end.body.share_token}`);
    const rows = checkGuardian(view, report, html);
    expect(rows.filter((r) => r.level === 'fail')).toEqual([]);
    for (const k of ['lesson', 'report_link', 'home_card', 'delivery', 'report_open', 'report_numbers', 'report_privacy', 'report_page', 'push_notice'])
      expect([k, level(rows, k)]).toEqual([k, 'ok']);
    expect(rows.find((r) => r.key === 'push_notice')!.msg).toContain('held');
    // nothing it prints carries the whole share token
    expect(JSON.stringify(rows)).not.toContain(end.body.share_token);
    expect(maskShare(end.body.report_path)).toMatch(/^\/r\/[0-9a-f]{6}…$/);

    expect(level(checkGuardian(view, { status: 200, body: { ...report.body, teacher_comment: 'Oreo 잘했어요' } }, html), 'report_privacy')).toBe('fail');
    expect(level(checkGuardian(view, { status: 200, body: { ...report.body, player_id: 'x' } }, html), 'report_privacy')).toBe('fail');
    expect(level(checkGuardian({ ...view, push: { ...view.push, outbox: [] } }, report, html), 'push_notice')).toBe('fail');
    expect(level(checkGuardian(view, report, { status: 404, type: 'text/html' }), 'report_page')).toBe('fail');
    expect(level(checkGuardian(view, { status: 410, body: { error: 'report_revoked' } }, html), 'report_open')).toBe('fail');
  });
});
