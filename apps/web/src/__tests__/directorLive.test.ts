import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LESSON_DIRECTOR_EVENTS } from '@lcw/content';
import { LessonDirectorConsole } from '../LessonDirector.js';
import type { DirectorLessonRecord, LessonFeed } from '../lessonApi.js';
import {
  EMPTY_DIRECTOR_LIVE,
  currentSilenceMinutes,
  eventForKey,
  mergeDirectorLive,
  progressBars,
  stageBands,
  type FeedLiveExtra,
  type FeedMinute
} from '../directorLiveState.js';
import { DIRECTOR_LIVE_STRINGS_KO as L } from '../directorLiveStrings.js';

const T0 = Date.parse('2026-11-16T15:00:00+09:00');
const REC: DirectorLessonRecord = {
  lesson_id: 'les-20261116-live',
  join_code: '204816',
  expires_at: T0 + 12 * 3_600_000,
  plan_id: 'first_lesson_v1',
  player_id: 'stu-1',
  nickname: '하늘',
  started_at: T0,
  stage_id: 'cafe_order',
  stage_started_at: T0 + 15 * 60_000,
  stage_ms: { warmup_anchor: 15 * 60_000 },
  report_path: null
};
const minute = (m: number, student_ms: number, teacher_ms: number, exchanges: number, activity: string): FeedMinute => ({
  minute: m,
  student_ms,
  teacher_ms,
  exchanges,
  activity
});
const FEED: LessonFeed & FeedLiveExtra = {
  lesson: {
    id: REC.lesson_id,
    player_id: 'stu-1',
    nickname: '하늘',
    started_at: T0,
    ended_at: null,
    stage_id: 'cafe_order',
    targets: ['Can I have a warm honey tea?'],
    possessed_npc_id: 'cafe_owner'
  } as LessonFeed['lesson'],
  utterances: [],
  pins: [],
  live: { utterances: 4, passes: 3, stars_total: 7, words_total: 22, student_speaking_ms: 9000 },
  npc_lines: [{ id: 'npc-1', seq: 1, at: T0 + 16 * 60_000, npc_id: 'cafe_owner', text: 'Welcome! What would you like?' }],
  events: [{ id: 'evt-1', seq: 2, at: T0 + 16 * 60_000 + 5000, kind: 'blackout', detail: '' }],
  live_cursor: 2,
  minutes: [
    minute(0, 4000, 2000, 2, 'warmup_anchor'),
    minute(1, 0, 0, 0, 'warmup_anchor'),
    minute(2, 0, 0, 0, 'cafe_order'),
    minute(3, 0, 0, 0, 'cafe_order')
  ],
  progress: { student_ms: 9000, teacher_ms: 2000, student_talk_ratio: 0.8182, exchanges: 4, long_silence_minutes: 2 },
  student_view: {
    connected: true,
    last_seen_at: T0 + 17 * 60_000 - 2000,
    scene_id: 'honey_cafe',
    ui: '3d',
    expected_scene_id: 'honey_cafe',
    goal_ko: '카페에서 영어로 음료를 주문해요. 별 3개에 도전!',
    targets: ['Can I have a warm honey tea?'],
    last_utterance: { at: T0 + 16 * 60_000 + 30_000, target_text: 'Can I have a warm honey tea?', transcript: 'can I have a warm honey tea', stars: 2, pass: true }
  },
  server_now: T0 + 17 * 60_000
};

describe('director live layer (WP-305)', () => {
  it('merges lines and events by id after the cursor and keeps the newest snapshot of the rest', () => {
    const a = mergeDirectorLive(EMPTY_DIRECTOR_LIVE, FEED, T0 + 17 * 60_000 - 500);
    expect(a.npcLines).toHaveLength(1);
    expect(a.events).toHaveLength(1);
    expect(a.liveCursor).toBe(2);
    expect(a.possessedNpcId).toBe('cafe_owner');
    expect(a.clockSkewMs).toBe(500);
    const b = mergeDirectorLive(a, { npc_lines: FEED.npc_lines, events: [], live_cursor: 2, lesson: { possessed_npc_id: null } }, T0);
    expect(b.npcLines).toHaveLength(1);
    expect(b.possessedNpcId).toBeNull();
    expect(b.minutes).toBe(a.minutes);
  });

  it('digit shortcuts fire events only when the teacher is not typing', () => {
    expect(eventForKey('2', { tagName: 'BODY' })?.kind).toBe('blackout');
    expect(eventForKey('2', { tagName: 'INPUT' })).toBeNull();
    expect(eventForKey('9', { tagName: 'BODY' })).toBeNull();
    expect(new Set(LESSON_DIRECTOR_EVENTS.map((e) => e.hotkey)).size).toBe(6);
  });

  it('progress bars, stage bands and the silence nudge ignore the running minute', () => {
    const bars = progressBars(FEED.minutes!, 3);
    expect(bars[0]).toMatchObject({ studentPct: 7, teacherPct: 3, silent: false });
    expect(bars[1]!.silent).toBe(true);
    expect(bars[3]!.silent).toBe(false);
    expect(stageBands(FEED.minutes!)).toEqual([
      { activity: 'warmup_anchor', from: 0, to: 1 },
      { activity: 'cafe_order', from: 2, to: 3 }
    ]);
    expect(currentSilenceMinutes(FEED.minutes!, 3)).toBe(2);
    expect(currentSilenceMinutes(FEED.minutes!, null)).toBe(3);
  });

  it('the console shows the student screen, possession, six event buttons, the progress chart and what the platform does', () => {
    const html = renderToStaticMarkup(
      React.createElement(LessonDirectorConsole, { initialToken: 'op', initialLesson: REC, initialFeed: FEED, now: () => T0 + 17 * 60_000 - 500 })
    );
    expect(html).toContain('data-testid="director-student-screen"');
    expect(html).toContain(L.sceneNames.honey_cafe);
    expect(html).toContain('can I have a warm honey tea');
    expect(html).toContain(L.possessing('카페 주인'));
    expect(html).toContain('data-testid="npc-say-script"');
    expect(html).toContain('Welcome to the honey cafe! What would you like today?');
    for (const ev of LESSON_DIRECTOR_EVENTS) expect(html).toContain(`data-testid="event-${ev.kind}"`);
    expect(html).toContain('data-testid="director-progress"');
    expect(html).toContain('<svg');
    expect(html).toContain('data-testid="silence-nudge"');
    expect(html).toContain('data-testid="director-helps"');
    expect(html).toContain(L.helps.record(4));
    expect(html).toContain('data-testid="director-next-lesson"');
  });
});
