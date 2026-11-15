import { describe, expect, it } from 'vitest';
import { DASHBOARD_WEEKS } from '@lcw/metrics';
import { PlatformDO, isPublicRoute, type LcwEnv } from '../platform.js';
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
  await call(p, 'POST', '/v1/admin/players', { family_id: fam, guardian_id: `g-${fam}`, player_id: playerId, nickname: 'Juno', birth_year: 2016, level: 'L2' });
  const inv = await call(p, 'POST', '/v1/admin/family-invites', { player_id: playerId });
  const s = await call(p, 'POST', '/v1/family/session', { invite: inv.body.invite_path.split('#k=')[1] }, anon);
  const g = bearer(s.body.guardian_token);
  await call(p, 'POST', '/v1/family/service-consent', { granted: true }, g);
  return g;
}

describe('guardian dashboard (WP-309, docs/07 §4)', () => {
  it('own child only; empty child waits; after a lesson the numbers match what was said', async () => {
    const p = platform();
    const g = await family(p, 'kid-1', 'fam-a');
    const g2 = await family(p, 'kid-2', 'fam-b');
    expect((await call(p, 'GET', '/v1/family/children/kid-1/dashboard', undefined, anon)).status).toBe(401);
    expect((await call(p, 'GET', '/v1/family/children/kid-1/dashboard', undefined, op)).status).toBe(401);
    expect((await call(p, 'GET', '/v1/family/children/kid-1/dashboard', undefined, g2)).status).toBe(404);

    const empty = await call(p, 'GET', '/v1/family/children/kid-1/dashboard', undefined, g);
    expect(empty.status).toBe(200);
    expect(empty.headers.get('cache-control')).toBe('private, no-store');
    expect(empty.body.series.has_data).toBe(false);
    expect(empty.body.series.weeks).toHaveLength(DASHBOARD_WEEKS);
    expect(empty.body.child).toEqual({ nickname: 'Juno', level: 'L2' });

    const s = await call(p, 'POST', '/v1/admin/lessons/start', { player_id: 'kid-1' });
    const j = await call(p, 'POST', '/v1/join', { code: s.body.join_code }, anon);
    const st = bearer(j.body.student_token);
    // warmup stage is free talk
    await call(p, 'POST', '/v1/lesson/utterance', { transcript: 'i like drawing because it makes me happy', dur_ms: 4000 }, st);
    await call(p, 'POST', '/v1/lesson/utterance', { transcript: 'i want a jetpack so that i can fly', dur_ms: 3000 }, st);
    await call(p, 'POST', `/v1/admin/lessons/${s.body.lesson_id}/stage`, { stage_id: 'cafe_order', targets: ['Can I have a tea?'] });
    await call(p, 'POST', '/v1/lesson/utterance', { target_text: 'Can I have a tea?', transcript: 'can i have a tea', chosen_stars: 1, dur_ms: 2000 }, st);
    const live = await call(p, 'GET', '/v1/family/children/kid-1/dashboard', undefined, g);
    expect(live.body.lesson_live).toBe(true);
    expect(live.body.lessons[0].ended_at).toBeNull();
    await call(p, 'POST', `/v1/admin/lessons/${s.body.lesson_id}/end`, { teacher_comment: '좋아요', next_lesson_at: '11월 19일 목요일 17:30' });

    const r = await call(p, 'GET', '/v1/family/children/kid-1/dashboard', undefined, g);
    const week = r.body.series.weeks[DASHBOARD_WEEKS - 1];
    expect(r.body.series.has_data).toBe(true);
    expect(week.free_words).toBe(8 + 9);
    expect(week.free_utterances).toBe(2);
    expect(week.speaking_min).toBe(0.2); // 9 s → 0.15 → 0.2 (one decimal)
    expect(week.modes.lesson).toEqual({ free: 2, guided: 1, read: 0, recall: 0 });
    expect(week.lesson_days).toBe(1);
    expect(week.think_speak).toBeNull();
    expect(r.body.series.connectors.map((c: any) => c.expr).sort()).toEqual(['because', 'so that']);
    expect(r.body.week_line).toMatchObject({ text: 'i want a jetpack so that i can fly', words: 9 });
    expect(r.body.lessons).toHaveLength(1);
    expect(r.body.lessons[0]).toMatchObject({ utterances: 3, passes: expect.any(Number) });
    expect(r.body.lessons[0].report_path).toMatch(/^\/r\/[A-Za-z0-9_-]+$/);
    expect(r.body.next_lesson_at).toBe('11월 19일 목요일 17:30');
    expect(r.body.lesson_live).toBe(false);
    expect(r.body.lesson_window_on).toBe(false);
    expect(JSON.stringify(r.body)).not.toMatch(/guardian_id|family_id|audio_/);

    // revoked report → no link on the dashboard
    await call(p, 'POST', `/v1/family/reports/${r.body.lessons[0].report_path.slice(3)}/revoke`, {}, g);
    const r2 = await call(p, 'GET', '/v1/family/children/kid-1/dashboard', undefined, g);
    expect(r2.body.lessons[0].report_path).toBeNull();
  });

  it('review sentences come from unmastered memory cards, soonest first', async () => {
    const p = platform();
    const g = await family(p, 'kid-1', 'fam-a');
    const now = Date.now();
    const utt = (id: string, target: string, final: string) =>
      p.db.logUtterance({
        id, player_id: 'kid-1', world_id: 'w', session_id: 's', session_kind: 'solo', ctx: 'cafe', mode: 'guided', interlocutor: 'npc',
        first_text: final, target_text: target, final_text: final, words: 3, l1_words: 0, dur_ms: 1000, latency_ms: 500, stars: 2,
        hint_level: 'full', attempts: 1, score: 0.9, confidence: 1, source: 'device', created_at: now - 1000
      } as any);
    utt('u1', 'so that I can fly', 'so that i can fly');
    utt('u2', '', 'instead of walking');
    utt('u3', 'I did not mean to', 'i did not mean to');
    const card = (id: string, u: string, due: number, mastered: number | null) =>
      p.sql.run('insert into memory_cards (id, player_id, utterance_id, item_id, origin, box, next_review_at, lapses, mastered_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)', [id, 'kid-1', u, 'it', 'npc', 1, due, 0, mastered]);
    card('c1', 'u1', now + 3000, null);
    card('c2', 'u2', now + 1000, null);
    card('c3', 'u3', now + 2000, now - 10);
    const r = await call(p, 'GET', '/v1/family/children/kid-1/dashboard', undefined, g);
    expect(r.body.review.map((x: any) => x.text)).toEqual(['instead of walking', 'so that I can fly']);
    expect(r.body.series.weeks[DASHBOARD_WEEKS - 1].cum_mastered).toBe(1);
  });

  it('the dashboard route is exact-matched among guardian routes', () => {
    expect(isPublicRoute('GET', '/v1/family/children/kid-1/dashboard')).toBe(true);
    expect(isPublicRoute('POST', '/v1/family/children/kid-1/dashboard')).toBe(false);
    expect(isPublicRoute('GET', '/v1/family/children/kid-1/dashboard/x')).toBe(false);
  });
});
