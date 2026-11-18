/**
 * Director console live layer (WP-305, docs/18 §3): possession lines, director events, the per-minute progress table
 * and the student-screen summary from the feed. Pure merging and shaping so the console stays thin and testable.
 */
import { LESSON_DIRECTOR_EVENTS, type LessonDirectorEvent, type LessonDirectorEventKind } from '@lcw/content';

export interface FeedNpcLine {
  id: string;
  seq: number;
  at: number;
  npc_id: string;
  text: string;
}

export interface FeedEvent {
  id: string;
  seq: number;
  at: number;
  kind: LessonDirectorEventKind;
  detail: string;
}

export interface FeedMinute {
  minute: number;
  student_ms: number;
  teacher_ms: number;
  exchanges: number;
  activity: string;
}

export interface FeedProgress {
  student_ms: number;
  teacher_ms: number;
  student_talk_ratio: number;
  exchanges: number;
  long_silence_minutes: number;
}

export interface FeedStudentView {
  connected: boolean;
  last_seen_at: number | null;
  scene_id: string | null;
  ui: '3d' | 'cards' | null;
  /** The child's one-time mic check (talk lane); absent on an older server. */
  mic?: 'ok' | 'quiet' | 'none' | 'skipped' | null;
  /** The last mic error on the child's device with the browser's own code (talk lane PR 122); absent on an older server. */
  mic_issue?: { issue: string; raw: string; at: number } | null;
  expected_scene_id: string | null;
  goal_ko: string;
  targets: string[];
  last_utterance: { at: number; target_text: string; transcript: string; stars: number; pass: boolean } | null;
}

/** The fields the lesson server added to the feed (docs/18 §3). Optional so an older server still renders. */
export interface FeedLiveExtra {
  npc_lines?: FeedNpcLine[];
  events?: FeedEvent[];
  live_cursor?: number;
  minutes?: FeedMinute[];
  progress?: FeedProgress;
  student_view?: FeedStudentView;
  /** source: null = the teacher (or the start), 'auto:passes' | 'auto:followups' | 'auto:time' = moved by itself. */
  stage_log?: Array<{ at: number; stage_id: string; source?: string | null }>;
  server_now?: number;
  lesson?: { possessed_npc_id?: string | null; [k: string]: unknown };
}

export interface DirectorLiveView {
  npcLines: FeedNpcLine[];
  events: FeedEvent[];
  liveCursor: number;
  minutes: FeedMinute[];
  progress: FeedProgress | null;
  studentView: FeedStudentView | null;
  possessedNpcId: string | null;
  /** server_now minus local now when the feed arrived, for "seen 3 s ago" without trusting the device clock. */
  clockSkewMs: number;
}

export const EMPTY_DIRECTOR_LIVE: DirectorLiveView = {
  npcLines: [],
  events: [],
  liveCursor: 0,
  minutes: [],
  progress: null,
  studentView: null,
  possessedNpcId: null,
  clockSkewMs: 0
};

const LIVE_KEEP = 200;

/** Lines and events arrive after `live_cursor`; minutes, progress and the student view are replaced each poll. */
export function mergeDirectorLive(prev: DirectorLiveView, f: FeedLiveExtra, localNow: number): DirectorLiveView {
  const seenL = new Set(prev.npcLines.map((x) => x.id));
  const seenE = new Set(prev.events.map((x) => x.id));
  const npcLines = [...prev.npcLines, ...(f.npc_lines ?? []).filter((x) => !seenL.has(x.id))].slice(-LIVE_KEEP);
  const events = [...prev.events, ...(f.events ?? []).filter((x) => !seenE.has(x.id))].slice(-LIVE_KEEP);
  return {
    npcLines,
    events,
    liveCursor: Math.max(prev.liveCursor, f.live_cursor ?? 0),
    minutes: f.minutes ?? prev.minutes,
    progress: f.progress ?? prev.progress,
    studentView: f.student_view ?? prev.studentView,
    possessedNpcId: f.lesson?.possessed_npc_id !== undefined ? (f.lesson.possessed_npc_id ?? null) : prev.possessedNpcId,
    clockSkewMs: f.server_now ? f.server_now - localNow : prev.clockSkewMs
  };
}

/** Director event shortcut: digits 1-6 when the teacher is not typing. */
export function eventForKey(key: string, target: { tagName?: string; isContentEditable?: boolean } | null): LessonDirectorEvent | null {
  const tag = (target?.tagName ?? '').toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return null;
  return LESSON_DIRECTOR_EVENTS.find((e) => e.hotkey === key) ?? null;
}

export interface ChartBar {
  minute: number;
  studentPct: number;
  teacherPct: number;
  exchanges: number;
  activity: string;
  silent: boolean;
}

/** Bars for the progress chart: each minute's talk as a share of 60 s, student above the line and teacher below. */
export function progressBars(minutes: readonly FeedMinute[], runningMinute: number | null): ChartBar[] {
  return minutes.map((m) => ({
    minute: m.minute,
    studentPct: Math.min(100, Math.round((m.student_ms / 60_000) * 100)),
    teacherPct: Math.min(100, Math.round((m.teacher_ms / 60_000) * 100)),
    exchanges: m.exchanges,
    activity: m.activity,
    silent: m.minute !== runningMinute && m.exchanges === 0 && m.student_ms === 0
  }));
}

/** Runs of the same stage across minutes, for the colored band under the chart. */
export function stageBands(minutes: readonly FeedMinute[]): Array<{ activity: string; from: number; to: number }> {
  const out: Array<{ activity: string; from: number; to: number }> = [];
  for (const m of minutes) {
    const last = out[out.length - 1];
    if (last && last.activity === m.activity && last.to === m.minute - 1) last.to = m.minute;
    else out.push({ activity: m.activity, from: m.minute, to: m.minute });
  }
  return out;
}

/** Minutes in a row without the student speaking, ending now — the console nudges the teacher after two. */
export function currentSilenceMinutes(minutes: readonly FeedMinute[], runningMinute: number | null): number {
  let n = 0;
  for (let i = minutes.length - 1; i >= 0; i--) {
    const m = minutes[i]!;
    if (m.minute === runningMinute) continue;
    if (m.exchanges === 0 && m.student_ms === 0) n++;
    else break;
  }
  return n;
}
