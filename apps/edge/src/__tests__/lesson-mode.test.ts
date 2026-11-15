import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlatformDO, type LcwEnv } from '../platform.js';
import {
  JOIN_FAILS_PER_HOUR,
  STUDENT_PRESENCE_TTL_MS,
  TEACHER_MS_PER_WORD,
  makeJoinCode,
  scoreFreeTalk
} from '../lesson-mode.js';
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

  describe('director: possession, events, progress table, pin windows (WP-304/305)', () => {
    afterEach(() => vi.restoreAllMocks());

    it('runs a 3-minute lesson with npc lines, events and pins and puts lesson-only facts in the report', async () => {
      let now = Date.parse('2026-11-16T15:00:00+09:00');
      vi.spyOn(Date, 'now').mockImplementation(() => now);
      const p = platform();
      const { lessonId, st } = await startLesson(p);
      const T0 = now;

      const s0 = await call(p, 'GET', '/v1/lesson/state?scene=plaza&ui=3d', undefined, st);
      expect(s0.body).toMatchObject({ scene_id: 'plaza', npc_id: 'guide', hint: 'full', possessed_npc_id: null });
      expect(s0.body.offers[0]).toMatchObject({ stars: 1, text: 'My name is ___.' });
      expect(s0.body.npc_lines).toEqual([]);

      // minute 0: the teacher speaks as the guide, the student answers freely
      now = T0 + 10_000;
      const say = await call(p, 'POST', `/v1/admin/lessons/${lessonId}/npc-say`, { npc_id: 'guide', text: 'Hi! What is your name?' });
      expect(say.status).toBe(201);
      now = T0 + 15_000;
      await call(p, 'POST', '/v1/lesson/utterance', { transcript: 'My name is Juno and I like games', dur_ms: 3000 }, st);

      const s1 = await call(p, 'GET', `/v1/lesson/state?cursor=${s0.body.cursor}`, undefined, st);
      expect(s1.body.possessed_npc_id).toBe('guide');
      expect(s1.body.npc_lines).toHaveLength(1);
      expect(s1.body.npc_lines[0]).toMatchObject({ npc_id: 'guide', text: 'Hi! What is your name?' });
      const s1b = await call(p, 'GET', `/v1/lesson/state?cursor=${s1.body.cursor}`, undefined, st);
      expect(s1b.body.npc_lines).toEqual([]);

      // minute 1: cafe stage, a blackout, an F2 pin right after a good sentence
      now = T0 + 70_000;
      await call(p, 'POST', `/v1/admin/lessons/${lessonId}/stage`, {
        stage_id: 'cafe_order',
        targets: ['Can I have a warm honey tea?', 'My own line']
      });
      const ev = await call(p, 'POST', `/v1/admin/lessons/${lessonId}/event`, { kind: 'blackout', detail: '' });
      expect(ev.status).toBe(201);
      expect((await call(p, 'POST', `/v1/admin/lessons/${lessonId}/event`, { kind: 'disco' })).status).toBe(400);
      now = T0 + 80_000;
      await call(p, 'POST', `/v1/admin/lessons/${lessonId}/npc-say`, { npc_id: 'cafe_owner', text: 'Welcome! What would you like?' });
      now = T0 + 90_000;
      const ok = await call(
        p,
        'POST',
        '/v1/lesson/utterance',
        { target_text: 'Can I have a warm honey tea?', transcript: 'can I have a warm honey tea', chosen_stars: 2, dur_ms: 2000 },
        st
      );
      expect(ok.body.pass).toBe(true);
      now = T0 + 92_000;
      await call(p, 'POST', `/v1/admin/lessons/${lessonId}/pins`, { kind: 'expression', at_ms: 92_000, note: '' });
      await call(p, 'POST', `/v1/admin/lessons/${lessonId}/pins`, { kind: 'coaching', at_ms: 85_000, note: '천천히 말하기' });

      const s2 = await call(p, 'GET', `/v1/lesson/state?cursor=${s1b.body.cursor}&scene=honey_cafe`, undefined, st);
      expect(s2.body).toMatchObject({
        stage_id: 'cafe_order',
        scene_id: 'honey_cafe',
        npc_id: 'cafe_owner',
        possessed_npc_id: 'cafe_owner'
      });
      expect(s2.body.events.map((e: any) => e.kind)).toEqual(['blackout']);
      expect(s2.body.offers).toEqual([
        { stars: 2, text: 'Can I have a warm honey tea?', hintTags: ['can i have'] },
        { stars: 2, text: 'My own line', hintTags: [] }
      ]);

      // minute 2 is silent: the director sees every minute, and what the student's screen shows
      now = T0 + 148_000;
      await call(p, 'GET', `/v1/lesson/state?cursor=${s2.body.cursor}`, undefined, st);
      now = T0 + 150_000;
      const feed = await call(p, 'GET', `/v1/admin/lessons/${lessonId}/feed`);
      expect(feed.body.minutes).toHaveLength(3);
      expect(feed.body.minutes[0]).toMatchObject({
        minute: 0,
        student_ms: 3000,
        teacher_ms: 5 * TEACHER_MS_PER_WORD,
        exchanges: 1,
        activity: 'warmup_anchor'
      });
      expect(feed.body.minutes[1]).toMatchObject({ minute: 1, student_ms: 2000, exchanges: 1, activity: 'cafe_order' });
      expect(feed.body.minutes[2]).toMatchObject({ minute: 2, student_ms: 0, exchanges: 0 });
      // the running minute 2 is not yet a silent minute
      expect(feed.body.progress).toMatchObject({ student_ms: 5000, exchanges: 2, long_silence_minutes: 0 });
      expect(feed.body.npc_lines).toHaveLength(2);
      expect(feed.body.events).toHaveLength(1);
      expect(feed.body.stage_log.map((x: any) => x.stage_id)).toEqual(['warmup_anchor', 'cafe_order']);
      expect(feed.body.student_view).toMatchObject({
        connected: true,
        scene_id: 'honey_cafe',
        ui: '3d',
        expected_scene_id: 'honey_cafe',
        goal_ko: expect.stringContaining('카페')
      });
      expect(feed.body.student_view.last_utterance).toMatchObject({ transcript: 'can I have a warm honey tea', pass: true });
      now += STUDENT_PRESENCE_TTL_MS + 1;
      expect((await call(p, 'GET', `/v1/admin/lessons/${lessonId}/feed`)).body.student_view.connected).toBe(false);

      // the hub's day list and catalogues
      const day = await call(p, 'GET', '/v1/admin/lessons?day=2026-11-16');
      expect(day.body.lessons).toHaveLength(1);
      expect(day.body.lessons[0]).toMatchObject({ id: lessonId, nickname: 'Juno', utterances: 2, passes: 2, report_path: null });
      expect((await call(p, 'GET', '/v1/admin/lesson-plans')).body[0].stages[1].sceneId).toBe('honey_cafe');
      expect((await call(p, 'GET', '/v1/admin/director-events')).body).toHaveLength(6);

      const end = await call(p, 'POST', `/v1/admin/lessons/${lessonId}/end`, { teacher_comment: '잘했어요' });
      expect(end.status).toBe(200);
      const w = end.body.pin_windows.find((x: any) => x.kind === 'expression');
      expect(w.window_start_ms).toBe(62_000);
      expect(w.lines.map((l: any) => l.speaker)).toEqual(['teacher', 'student']);
      expect(w.candidate_expressions[0]).toBe('can I have a warm honey tea');
      expect((await call(p, 'GET', `/v1/admin/lessons/${lessonId}/pin-windows`)).body).toHaveLength(2);
      const report = await call(p, 'GET', `/v1/reports/${end.body.share_token}`, undefined, {});
      expect(report.body.facts.progress).toMatchObject({ student_ms: 5000, exchanges: 2, long_silence_minutes: 1 });
      // the public report carries numbers, not pin transcripts or the teacher's coaching notes
      expect(report.body.facts.pin_windows).toBeUndefined();
      expect(JSON.stringify(report.body)).not.toContain('천천히 말하기');
      expect(JSON.stringify(report.body)).not.toContain('Welcome! What would you like?');
      expect(report.body.facts.new_expressions).toBe(1);
      expect((await call(p, 'GET', '/v1/admin/lessons?day=2026-11-16')).body.lessons[0].report_path).toBe(end.body.report_path);

      // after the end nothing more can be said or triggered
      expect((await call(p, 'POST', `/v1/admin/lessons/${lessonId}/npc-say`, { npc_id: 'guide', text: 'hi' })).status).toBe(409);
      expect((await call(p, 'POST', `/v1/admin/lessons/${lessonId}/event`, { kind: 'star_celebration' })).status).toBe(409);
    });

    it('typed or card-built sentences earn two stars at most (docs/04 §4.1)', async () => {
      const p = platform();
      const { lessonId, st } = await startLesson(p);
      const three = 'Can I have a warm honey tea so that I stay warm?';
      await call(p, 'POST', `/v1/admin/lessons/${lessonId}/stage`, { stage_id: 'cafe_order', targets: [three] });
      const typed = await call(
        p,
        'POST',
        '/v1/lesson/utterance',
        { target_text: three, transcript: three, chosen_stars: 3, stt_source: 'keyboard' },
        st
      );
      expect(typed.body).toMatchObject({ pass: true, stars: 2 });
      expect(typed.body.feedback_ko).toContain('목소리');
      const spoken = await call(p, 'POST', '/v1/lesson/utterance', { target_text: three, transcript: three, chosen_stars: 3 }, st);
      expect(spoken.body.stars).toBe(3);
    });

    it('validates npc ids and text, and a fresh client only sees recent lines', async () => {
      let now = Date.parse('2026-11-16T15:00:00+09:00');
      vi.spyOn(Date, 'now').mockImplementation(() => now);
      const p = platform();
      const { lessonId, st } = await startLesson(p);
      expect((await call(p, 'POST', `/v1/admin/lessons/${lessonId}/npc-say`, { npc_id: 'Bad Id', text: 'x' })).status).toBe(400);
      expect((await call(p, 'POST', `/v1/admin/lessons/${lessonId}/npc-say`, { npc_id: 'dragon', text: 'x' })).status).toBe(400);
      expect((await call(p, 'POST', `/v1/admin/lessons/${lessonId}/npc-say`, { npc_id: 'guide', text: '   ' })).status).toBe(400);
      expect((await call(p, 'POST', '/v1/admin/lessons/nope/npc-say', { npc_id: 'guide', text: 'hi' })).status).toBe(404);
      await call(p, 'POST', `/v1/admin/lessons/${lessonId}/npc-say`, { npc_id: 'guide', text: 'old line' });
      now += 60_000;
      await call(p, 'POST', `/v1/admin/lessons/${lessonId}/npc-say`, { npc_id: 'guide', text: 'new line' });
      const fresh = await call(p, 'GET', '/v1/lesson/state', undefined, st);
      expect(fresh.body.npc_lines.map((l: any) => l.text)).toEqual(['new line']);
      expect((await call(p, 'POST', `/v1/admin/lessons/${lessonId}/possess`, { npc_id: null })).body.possessed_npc_id).toBe(null);
      expect((await call(p, 'GET', '/v1/lesson/state', undefined, st)).body.possessed_npc_id).toBe(null);
      expect((await call(p, 'POST', `/v1/admin/lessons/${lessonId}/npc-say`, { npc_id: 'guide', text: 'hack' }, st)).status).toBe(401);
    });

    it('delivers rows written in the same millisecond once each and never replays events on a cursorless poll', async () => {
      const now = Date.parse('2026-11-16T15:00:00+09:00');
      vi.spyOn(Date, 'now').mockImplementation(() => now);
      const p = platform();
      const { lessonId, st } = await startLesson(p);
      const first = await call(p, 'GET', '/v1/lesson/state', undefined, st);
      await call(p, 'POST', `/v1/admin/lessons/${lessonId}/npc-say`, { npc_id: 'guide', text: 'one' });
      await call(p, 'POST', `/v1/admin/lessons/${lessonId}/npc-say`, { npc_id: 'guide', text: 'two' });
      await call(p, 'POST', `/v1/admin/lessons/${lessonId}/event`, { kind: 'blackout' });
      const next = await call(p, 'GET', `/v1/lesson/state?cursor=${first.body.cursor}`, undefined, st);
      expect(next.body.npc_lines.map((l: any) => l.text)).toEqual(['one', 'two']);
      expect(next.body.events.map((e: any) => e.kind)).toEqual(['blackout']);
      const again = await call(p, 'GET', `/v1/lesson/state?cursor=${next.body.cursor}`, undefined, st);
      expect(again.body.npc_lines).toEqual([]);
      expect(again.body.events).toEqual([]);
      const reload = await call(p, 'GET', '/v1/lesson/state', undefined, st);
      expect(reload.body.events).toEqual([]);
      expect(reload.body.cursor).toBe(next.body.cursor);
      const feed = await call(p, 'GET', `/v1/admin/lessons/${lessonId}/feed?live_cursor=1`);
      expect(feed.body.npc_lines.map((l: any) => l.text)).toEqual(['two']);
      expect(feed.body.live_cursor).toBe(3);
    });
  });
});
