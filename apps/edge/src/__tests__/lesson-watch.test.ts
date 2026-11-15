import { describe, expect, it } from 'vitest';
// The live-lesson watch tool (tools/lesson-watch.mjs): importing it touches no token and no disk.
import { WATCH_LIMITS, checkLesson, maskUrl } from '../../../../tools/lesson-watch.mjs';

const now = Date.parse('2026-11-16T15:30:00+09:00');
const lesson = { lesson_id: 'les-1', player_id: 'kid-1', plan_id: 'first_lesson_v1', stage_id: 'cafe_order', started_at: now - 30 * 60_000, stage_started_at: now - 5 * 60_000 };
const feed = (sv: Record<string, unknown>, utterances = 4) => ({
  status: 200,
  body: { lesson: { stage_id: 'cafe_order' }, live: { utterances, passes: 3, stars_total: 6 }, student_view: sv }
});

describe('live-lesson watch (tools/lesson-watch.mjs)', () => {
  it('a healthy lesson: a summary row with counts only, no alert', () => {
    const { row, alerts } = checkLesson(
      lesson,
      feed({ connected: true, last_seen_at: now - 2_000, scene_id: 'honey_cafe', expected_scene_id: 'honey_cafe', ui: '3d', last_utterance: { at: now - 40_000, transcript: 'secret words', stars: 2 } }),
      now,
      1
    );
    expect(alerts).toEqual([]);
    expect(row).toMatchObject({ stage: 'cafe_order', utterances: 4, new_utterances: 3, last_answer_s: 40, student_connected: true, lesson_min: 30, stage_min: 5 });
    // nothing a child said goes into the log row
    expect(JSON.stringify(row)).not.toContain('secret words');
  });

  it('alerts when the student screen stops polling, sits in another scene, or no answer comes for 15 minutes', () => {
    const { alerts } = checkLesson(
      lesson,
      feed({ connected: false, last_seen_at: now - WATCH_LIMITS.studentGoneMs - 1_000, scene_id: 'plaza', expected_scene_id: 'honey_cafe', last_utterance: { at: now - WATCH_LIMITS.quietMs - 1_000 } }),
      now,
      undefined
    );
    expect(alerts.map((a) => a.key)).toEqual(['student_gone', 'scene', 'quiet']);
    // a lesson in its first minutes is not "quiet" yet
    const young = { ...lesson, started_at: now - 5 * 60_000 };
    expect(checkLesson(young, feed({ connected: true, last_seen_at: now }), now, undefined).alerts).toEqual([]);
  });

  it('masks share tokens, join codes and long ids in logged URLs', () => {
    expect(maskUrl('https://lcw.worldwidesomething.com/r/abcdefghijklmnopqrstuvwxyz0123')).toBe('https://lcw.worldwidesomething.com/r/***');
    expect(maskUrl('https://x/game/?code=123456&scene=plaza')).toBe('https://x/game/?code=***&scene=plaza');
    expect(maskUrl('/v1/lesson/state?cursor=3')).toBe('/v1/lesson/state?cursor=3');
  });
});
