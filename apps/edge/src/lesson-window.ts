/**
 * Parent lesson window (WP-307, docs/08 P04, docs/12 "보호자 청취"): what a guardian sees while their child's lesson
 * runs. Text only — a one-line status (place · situation), the scene icon, the goal sentence on screen, the talk
 * density band and captions — rebuilt from what lesson mode already stores. No video, and the guardian's microphone
 * is never part of it: the listen-only audio contract is `audio.direction = 'recvonly'`.
 *
 * Gate: the guardian's session, the family's required service consent, the child belongs to the family, and the
 * child's `lesson_window` consent (docs/16 §3, row 6). Without it the route answers 403 `lesson_window_consent_required`
 * and returns nothing about the lesson.
 */
import { getLessonNpc, getLessonPlan, type LessonSceneId } from '@lcw/content';
import type { LessonWindowStatus } from '@lcw/schemas';
import type { SqliteExecutor } from './storage.js';

/** The window asks again this often (docs/08 P04: the status refreshes every 10 s). */
export const LESSON_WINDOW_POLL_MS = 10_000;
/** Captions kept on screen / returned per poll. */
export const LESSON_WINDOW_MAX_CAPTIONS = 12;
/** Density band: at most this many minutes (a 120-minute lesson plus overtime). */
export const LESSON_WINDOW_MAX_MINUTES = 240;

const SCENE_PLACE_KO: Record<LessonSceneId, string> = {
  plaza: '광장',
  honey_cafe: '꿀차 카페',
  trade_shop: '물물교환 상점',
  build_plot: '건축 부지',
  open_hill: '열린 언덕'
};
const SCENE_ICON: Record<LessonSceneId, LessonWindowStatus['scene_icon']> = {
  plaza: 'plaza',
  honey_cafe: 'cafe',
  trade_shop: 'shop',
  build_plot: 'build',
  open_hill: 'hill'
};

export interface LessonWindowCaption {
  id: string;
  at: number;
  /** Who spoke: the child, or the teacher speaking as an NPC. */
  who: 'child' | 'teacher';
  /** Korean label shown before the caption ("아이", "카페 주인(선생님)"). */
  speaker_ko: string;
  text: string;
  /** Child lines only: whether the sentence passed and its stars. */
  pass?: boolean;
  stars?: number;
}

export interface LessonWindowMinute {
  minute: number;
  student_ms: number;
  teacher_ms: number;
}

export interface LessonWindowPayload {
  live: boolean;
  status: LessonWindowStatus | null;
  started_at: number | null;
  minutes: LessonWindowMinute[];
  captions: LessonWindowCaption[];
  /** Latest teacher-entered next lesson text, shown when no lesson is running. */
  next_lesson_at: string | null;
  /** Live sound (lesson-audio.ts): receive-only; `stream_id` changes when the teacher republishes. family.ts fills it. */
  audio: {
    direction: 'recvonly';
    available: boolean;
    reason: string | null;
    stream_id: string | null;
    /** The polling window's own listener: still open, or closed by the server (republish, consent off). */
    listener?: 'open' | 'closed' | null;
  };
  poll_ms: number;
  server_now: number;
}

const stageTitle = (t: string) =>
  t
    .replace(/^[①-⑳\d.\s]+/, '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim();

const teacherLabel = (name: string | undefined) => (!name || name.includes('선생님') ? name ?? '선생님' : `${name}(선생님)`);

/** Pure status builder so the console, the window and tests agree on one shape. */
export function lessonWindowStatus(input: {
  lessonId: string;
  planId: string | null | undefined;
  stageId: string | null | undefined;
  targets: readonly string[];
  possessedNpcId: string | null;
  nowMs: number;
}): LessonWindowStatus {
  const plan = getLessonPlan(input.planId ?? undefined);
  const stage = plan.stages.find((s) => s.id === input.stageId) ?? plan.stages[0]!;
  const npc = getLessonNpc(input.possessedNpcId);
  const situation =
    npc && !npc.nameKo.includes('선생님') ? `선생님이 ${npc.nameKo} 역할 중 · ${stageTitle(stage.titleKo)}` : stageTitle(stage.titleKo);
  // The hardest sentence on the child's screen is the goal; a "___" template is not a sentence to show.
  const target = [...input.targets].reverse().find((t) => !t.includes('___')) ?? null;
  return {
    type: 'lesson.window_status',
    lesson_id: input.lessonId,
    place: SCENE_PLACE_KO[stage.sceneId].slice(0, 40),
    situation: situation.slice(0, 80),
    target_sentence: target ? target.slice(0, 200) : null,
    scene_icon: SCENE_ICON[stage.sceneId],
    sent_at: input.nowMs
  };
}

export function buildLessonWindow(
  sql: SqliteExecutor,
  playerId: string,
  nowMs: number,
  opts: { after?: number; audioConfigured?: boolean } = {}
): LessonWindowPayload {
  const lesson = sql.get<{ id: string; started_at: number; plan: string }>(
    'select id, started_at, plan from lessons where player_id = ? and ended_at is null order by started_at desc limit 1',
    [playerId]
  );
  const next = sql.get<{ next_lesson_at: string | null }>(
    'select next_lesson_at from report_deliveries where player_id = ? and next_lesson_at is not null order by sent_at desc limit 1',
    [playerId]
  );
  const audio = {
    direction: 'recvonly' as const,
    available: false,
    reason: opts.audioConfigured ? 'no_teacher_stream' : 'realtime_not_configured',
    stream_id: null
  };
  const base = { next_lesson_at: next?.next_lesson_at ?? null, audio, poll_ms: LESSON_WINDOW_POLL_MS, server_now: nowMs };
  if (!lesson) return { live: false, status: null, started_at: null, minutes: [], captions: [], ...base };

  const st = sql.get<{ plan_id: string; stage_id: string; targets: string }>(
    'select plan_id, stage_id, targets from lesson_state where lesson_id = ?',
    [lesson.id]
  );
  const possessed =
    sql.get<{ possessed_npc_id: string | null }>('select possessed_npc_id from lesson_director where lesson_id = ?', [lesson.id])
      ?.possessed_npc_id ?? null;
  let targets: string[] = [];
  try {
    targets = st ? (JSON.parse(st.targets) as string[]) : [];
  } catch {
    targets = [];
  }
  const status = lessonWindowStatus({
    lessonId: lesson.id,
    planId: st?.plan_id ?? lesson.plan,
    stageId: st?.stage_id,
    targets,
    possessedNpcId: possessed,
    nowMs
  });

  // Density band: every minute since the start, 0 where nothing was said, so silences show (docs/08 §9.2).
  const stored = new Map(
    sql
      .all<{ minute: number; student_ms: number; teacher_ms: number }>(
        'select minute, student_ms, teacher_ms from lesson_minutes where lesson_id = ? order by minute',
        [lesson.id]
      )
      .map((m) => [m.minute, m])
  );
  const last = Math.min(LESSON_WINDOW_MAX_MINUTES - 1, Math.max(0, Math.floor((nowMs - lesson.started_at) / 60_000)));
  const minutes: LessonWindowMinute[] = [];
  for (let m = 0; m <= last; m++) {
    const r = stored.get(m);
    minutes.push({ minute: m, student_ms: Number(r?.student_ms ?? 0), teacher_ms: Number(r?.teacher_ms ?? 0) });
  }

  const after = Math.max(0, Number(opts.after ?? 0) || 0);
  const child = sql
    .all<{ id: string; at: number; text: string; stars: number }>(
      `select id, created_at as at, final_text as text, stars from utterances
       where session_id = ? and created_at > ? order by created_at desc limit ?`,
      [lesson.id, after, LESSON_WINDOW_MAX_CAPTIONS]
    )
    .map<LessonWindowCaption>((u) => ({
      id: u.id,
      at: u.at,
      who: 'child',
      speaker_ko: '아이',
      text: u.text,
      pass: Number(u.stars) > 0,
      stars: Number(u.stars)
    }));
  const teacher = sql
    .all<{ id: string; at: number; text: string; npc_id: string | null }>(
      "select id, at, text, npc_id from lesson_live where lesson_id = ? and type = 'line' and at > ? order by seq desc limit ?",
      [lesson.id, after, LESSON_WINDOW_MAX_CAPTIONS]
    )
    .map<LessonWindowCaption>((l) => ({
      id: l.id,
      at: l.at,
      who: 'teacher',
      speaker_ko: teacherLabel(getLessonNpc(l.npc_id)?.nameKo),
      text: l.text
    }));
  const captions = [...child, ...teacher]
    .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))
    .slice(-LESSON_WINDOW_MAX_CAPTIONS);

  return { live: true, status, started_at: lesson.started_at, minutes, captions, ...base };
}
