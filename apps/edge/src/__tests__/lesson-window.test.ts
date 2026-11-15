import { describe, expect, it } from 'vitest';
import { LessonWindowStatusSchema } from '@lcw/schemas';
import { PlatformDO, isPublicRoute, type LcwEnv } from '../platform.js';
import { LESSON_WINDOW_MAX_CAPTIONS, LESSON_WINDOW_POLL_MS, lessonWindowStatus } from '../lesson-window.js';
import { fakeDurableStorage } from './fake-do.js';

const TOKEN = 'op-token-0123456789abcdef';
const op = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
const anon = { 'content-type': 'application/json' };
const bearer = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const platform = () => new PlatformDO({ storage: fakeDurableStorage() }, { PLATFORM: undefined as never, LCW_OPERATOR_TOKEN: TOKEN } as LcwEnv);
async function call(p: PlatformDO, method: string, path: string, body?: unknown, headers: Record<string, string> = op) {
  const res = await p.fetch(new Request(`https://x${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
  return { status: res.status, body: (await res.json()) as any, headers: res.headers };
}
async function family(p: PlatformDO, playerId: string, fam: string) {
  await call(p, 'POST', '/v1/admin/players', { family_id: fam, guardian_id: `g-${fam}`, player_id: playerId, nickname: 'Juno', birth_year: 2016, level: 'L1' });
  const inv = await call(p, 'POST', '/v1/admin/family-invites', { player_id: playerId });
  const s = await call(p, 'POST', '/v1/family/session', { invite: inv.body.invite_path.split('#k=')[1] }, anon);
  const g = bearer(s.body.guardian_token);
  await call(p, 'POST', '/v1/family/service-consent', { granted: true }, g);
  return g;
}
const win = (p: PlatformDO, pid: string, g: Record<string, string>, after = 0) =>
  call(p, 'GET', `/v1/family/children/${pid}/lesson-window${after ? `?after=${after}` : ''}`, undefined, g);

describe('parent lesson window (WP-307, docs/08 P04, docs/16 §3)', () => {
  it('closed without the lesson_window consent: 403 and nothing about the lesson', async () => {
    const p = platform();
    const g = await family(p, 'kid-1', 'fam-a');
    await call(p, 'POST', '/v1/admin/lessons/start', { player_id: 'kid-1' });
    const r = await win(p, 'kid-1', g);
    expect(r.status).toBe(403);
    expect(r.body).toEqual({ error: 'lesson_window_consent_required' });
    // no guardian token, operator token, other family → no window either
    expect((await win(p, 'kid-1', anon)).status).toBe(401);
    expect((await win(p, 'kid-1', op)).status).toBe(401);
    const g2 = await family(p, 'kid-2', 'fam-b');
    await call(p, 'PUT', '/v1/family/children/kid-2/consents/lesson_window', { granted: true }, g2);
    expect((await win(p, 'kid-1', g2)).status).toBe(404);
    // without service consent → 403 service_consent_required
    await call(p, 'POST', '/v1/admin/players', { family_id: 'fam-c', guardian_id: 'g-c', player_id: 'kid-3', nickname: 'Mina', birth_year: 2016 });
    const inv = await call(p, 'POST', '/v1/admin/family-invites', { player_id: 'kid-3' });
    const s = await call(p, 'POST', '/v1/family/session', { invite: inv.body.invite_path.split('#k=')[1] }, anon);
    expect((await win(p, 'kid-3', bearer(s.body.guardian_token))).body.error).toBe('service_consent_required');
  });

  it('live lesson: text status (schema-valid), density band, captions from both sides; listen-only audio contract', async () => {
    const p = platform();
    const g = await family(p, 'kid-1', 'fam-a');
    expect((await call(p, 'PUT', '/v1/family/children/kid-1/consents/lesson_window', { granted: true }, g)).body.active).toBe(true);
    const idle = await win(p, 'kid-1', g);
    expect(idle.status).toBe(200);
    expect(idle.body).toMatchObject({ live: false, status: null, captions: [], minutes: [] });

    const s = await call(p, 'POST', '/v1/admin/lessons/start', { player_id: 'kid-1' });
    const lessonId = s.body.lesson_id as string;
    const j = await call(p, 'POST', '/v1/join', { code: s.body.join_code }, anon);
    const st = bearer(j.body.student_token);
    await call(p, 'POST', `/v1/admin/lessons/${lessonId}/stage`, { stage_id: 'cafe_order', targets: ['Can I have a tea?', 'Can I have a warm honey tea so I stay warm?'] });
    await call(p, 'POST', `/v1/admin/lessons/${lessonId}/possess`, { npc_id: 'cafe_owner' });
    await call(p, 'POST', `/v1/admin/lessons/${lessonId}/npc-say`, { npc_id: 'cafe_owner', text: 'Welcome! What would you like?' });
    await call(p, 'POST', '/v1/lesson/utterance', { target_text: 'Can I have a tea?', transcript: 'can i have a tea', chosen_stars: 1, dur_ms: 1800 }, st);

    const r = await win(p, 'kid-1', g);
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('private, no-store');
    expect(r.body.live).toBe(true);
    expect(LessonWindowStatusSchema.safeParse(r.body.status).success).toBe(true);
    expect(r.body.status).toMatchObject({
      type: 'lesson.window_status',
      lesson_id: lessonId,
      place: '꿀차 카페',
      situation: '선생님이 카페 주인 역할 중 · 카페 주문',
      target_sentence: 'Can I have a warm honey tea so I stay warm?',
      scene_icon: 'cafe'
    });
    expect(r.body.poll_ms).toBe(LESSON_WINDOW_POLL_MS);
    expect(r.body.audio).toEqual({ direction: 'recvonly', available: false, reason: 'realtime_not_configured' });
    expect(r.body.minutes.length).toBeGreaterThanOrEqual(1);
    expect(r.body.minutes[0].student_ms).toBeGreaterThan(0);
    expect(r.body.minutes[0].teacher_ms).toBeGreaterThan(0);
    expect(r.body.captions.map((c: any) => `${c.who}:${c.text}`)).toEqual(['teacher:Welcome! What would you like?', 'child:can i have a tea']);
    expect(r.body.captions[0].speaker_ko).toBe('카페 주인(선생님)');
    expect(r.body.captions[1]).toMatchObject({ speaker_ko: '아이', pass: true });
    // nothing in the payload identifies the guardian or carries media
    const raw = JSON.stringify(r.body);
    expect(raw).not.toMatch(/guardian_id|family_id|player_id|video|mic/);

    // incremental: after the last caption only newer lines come back
    const last = r.body.captions[1].at as number;
    await new Promise((res) => setTimeout(res, 5));
    await call(p, 'POST', '/v1/lesson/utterance', { target_text: 'Can I have a tea?', transcript: 'can i have a warm tea please', chosen_stars: 2, dur_ms: 2100 }, st);
    const r2 = await win(p, 'kid-1', g, last);
    expect(r2.body.captions.map((c: any) => c.text)).toEqual(['can i have a warm tea please']);

    // revoking the consent closes the window at once
    await call(p, 'PUT', '/v1/family/children/kid-1/consents/lesson_window', { granted: false }, g);
    expect((await win(p, 'kid-1', g)).status).toBe(403);
    await call(p, 'PUT', '/v1/family/children/kid-1/consents/lesson_window', { granted: true }, g);

    // after the lesson ends: idle with the teacher's next-lesson text
    await call(p, 'POST', `/v1/admin/lessons/${lessonId}/end`, { teacher_comment: '잘했어요.', next_lesson_at: '11월 19일 목요일 17:30' });
    const after = await win(p, 'kid-1', g);
    expect(after.body).toMatchObject({ live: false, status: null, next_lesson_at: '11월 19일 목요일 17:30' });
  });

  it('status builder: guide is not "playing" a role, "___" templates are not goals, captions are capped', () => {
    const s = lessonWindowStatus({ lessonId: 'l', planId: 'first_lesson_v1', stageId: 'warmup_anchor', targets: ['My name is ___.'], possessedNpcId: 'guide', nowMs: 5 });
    expect(s).toMatchObject({ place: '광장', situation: '인사와 고정 과제', target_sentence: null, scene_icon: 'plaza', sent_at: 5 });
    const t = lessonWindowStatus({ lessonId: 'l', planId: 'first_lesson_v1', stageId: 'trade_roleplay', targets: [], possessedNpcId: null, nowMs: 1 });
    expect(LessonWindowStatusSchema.safeParse(t).success).toBe(true);
    expect(LESSON_WINDOW_MAX_CAPTIONS).toBeLessThanOrEqual(20);
  });

  it('the window route is guardian-authenticated, exact-matched among public routes', () => {
    expect(isPublicRoute('GET', '/v1/family/children/kid-1/lesson-window')).toBe(true);
    expect(isPublicRoute('POST', '/v1/family/children/kid-1/lesson-window')).toBe(false);
    expect(isPublicRoute('GET', '/v1/family/children/kid-1/lesson-window/x')).toBe(false);
  });
});
