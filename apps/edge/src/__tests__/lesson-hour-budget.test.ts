import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FREE_TIER_LIMITS, LESSON_HOUR_BUDGET, SEAT_FAIR_USE_LIMITS, serverSttNeurons } from '@lcw/quota';
import { TUNING } from '@lcw/sim-core';

/**
 * R2735 (11-20): what one lesson hour costs on Cloudflare, counted from the code the screens run. The operator's free
 * account stopped for a day when another app's polling read too much; this test keeps LCW's periodic requests,
 * room messages and Workers AI per lesson hour under `LESSON_HOUR_BUDGET` (packages/quota), so a faster poll or a new
 * loop fails here instead of on the bill. Periods are read from each loop's own constant, and the line that wires the
 * constant into its timer must still be there (a loop rewired to a literal fails too).
 */

const ROOT = path.resolve(__dirname, '../../../..');
const src = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const HOUR_MS = 3_600_000;

function constMs(rel: string, name: string): number {
  const m = src(rel).match(new RegExp(`(?:export )?const ${name}(?::\\s*number)? = ([0-9_]+);`));
  expect(m, `${rel}: const ${name} = <number>`).toBeTruthy();
  return Number(m![1]!.replace(/_/g, ''));
}

interface Loop {
  file: string;
  name: string;
  /** The line that puts the constant into the timer (setInterval, a worker ticker or a recursive setTimeout). */
  wire: RegExp;
  /** Where that line is when the constant is defined elsewhere. */
  wireFile?: string;
  /** Requests one tick sends. */
  perTick: number;
  what: string;
}

/** The student's /world/ (apps/client) while a lesson is live. */
const STUDENT: Loop[] = [
  { file: 'apps/client/src/lesson/controller.ts', name: 'LESSON_POLL_MS', wire: /LESSON_POLL_MS - \(this\.timers\.now\(\) - startedAt\)/, perTick: 1, what: 'GET /v1/lesson/state' },
  { file: 'apps/client/src/start/StartFlow.tsx', name: 'LIVE_POLL_MS', wire: /setInterval\(ask, LIVE_POLL_MS\)/, perTick: 1, what: 'GET /v1/device/lesson (LessonAutoJoin keeps asking during a lesson)' }
];

/** The teacher: director console (apps/web) plus the teacher's own world (TeacherBar) and the 1PC panel, all at once. */
const TEACHER: Loop[] = [
  { file: 'apps/web/src/lessonFlow.ts', wireFile: 'apps/web/src/LessonDirector.tsx', name: 'LESSON_POLL_MS', wire: /setInterval\(\(\) => void poll\(\), LESSON_POLL_MS\)/, perTick: 1, what: 'GET /v1/admin/lessons/:id/feed' },
  { file: 'apps/web/src/LessonDirector.tsx', name: 'WORLD_PRESENCE_POLL_MS', wire: /setInterval\(\(\) => void tick\(\), WORLD_PRESENCE_POLL_MS\)/, perTick: 1, what: 'GET /v1/admin/lessons/live' },
  { file: 'apps/web/src/teacherPresence.tsx', name: 'TEACHER_BEAT_MS', wire: /ticker\(\(\) => void beat\(\), TEACHER_BEAT_MS\)/, perTick: 1, what: 'POST presence (console)' },
  { file: 'apps/web/src/DirectorSignups.tsx', name: 'SIGNUP_QUEUE_POLL_MS', wire: /setInterval\(\(\) => void refresh\(\), pollMs\)/, perTick: 3, what: 'sign-up queue: pending + students + recent' },
  { file: 'apps/web/src/lessonAudio.ts', name: 'LESSON_AUDIO_BEAT_MS', wire: /setInterval\(\(\) => void beat\(\), LESSON_AUDIO_BEAT_MS\)/, perTick: 1, what: 'POST lesson audio beat' },
  { file: 'apps/client/src/world/TeacherBar.tsx', name: 'TEACH_BEAT_MS', wire: /let next = TEACH_BEAT_MS/, perTick: 1, what: 'POST presence (world)' },
  { file: 'apps/client/src/world/TeacherBar.tsx', name: 'TEACH_FEED_MS', wire: /setInterval\(\(\) => void read\(\), TEACH_FEED_MS\)/, perTick: 1, what: 'GET feed (world)' },
  { file: 'apps/client/src/lesson/TeacherPanel.tsx', name: 'PANEL_BEAT_MS', wire: /setInterval\(\(\) => void beat\(\), PANEL_BEAT_MS\)/, perTick: 1, what: 'POST presence (1PC panel)' }
];

function perHour(loops: Loop[]) {
  return loops.map((l) => {
    const ms = constMs(l.file, l.name);
    expect(src(l.wireFile ?? l.file), `${l.wireFile ?? l.file}: ${l.name} wired into its timer`).toMatch(l.wire);
    return { ...l, ms, perHour: Math.ceil(HOUR_MS / ms) * l.perTick };
  });
}

/** Extra ticks a loop sends besides its period (read from the code so a change shows here). */
function extras() {
  const linked = constMs('apps/web/src/LessonDirector.tsx', 'LINKED_REFRESH_TICKS');
  const presence = constMs('apps/web/src/LessonDirector.tsx', 'WORLD_PRESENCE_POLL_MS');
  // The review dock asks again after a minute when nothing is due (dialog/review.ts nextPollDelay fallback).
  const review = src('apps/client/src/dialog/review.ts').match(/fallbackMs = ([0-9_]+)\)/);
  expect(review, 'review.ts nextPollDelay fallback').toBeTruthy();
  return {
    teacher: Math.ceil(HOUR_MS / presence / linked), // GET /v1/admin/students every LINKED_REFRESH_TICKS presence ticks
    student: Math.ceil(HOUR_MS / Number(review![1]!.replace(/_/g, '')))
  };
}

describe('R2735: Cloudflare cost of one lesson hour', () => {
  it('the student stays under studentRequests (periodic loops + events)', () => {
    const rows = perHour(STUDENT);
    const total = rows.reduce((s, r) => s + r.perHour, 0) + extras().student + LESSON_HOUR_BUDGET.eventAllowance;
    console.log(rows.map((r) => `${r.name} ${r.ms} ms → ${r.perHour}/h (${r.what})`).join('\n'), `\nstudent lesson hour: ${total} requests`);
    expect(total).toBeLessThanOrEqual(LESSON_HOUR_BUDGET.studentRequests);
  });

  it('the teacher stays under teacherRequests (console + world + panel together)', () => {
    const rows = perHour(TEACHER);
    const total = rows.reduce((s, r) => s + r.perHour, 0) + extras().teacher;
    console.log(rows.map((r) => `${r.name} ${r.ms} ms ×${r.perTick} → ${r.perHour}/h (${r.what})`).join('\n'), `\nteacher lesson hour: ${total} requests`);
    expect(total).toBeLessThanOrEqual(LESSON_HOUR_BUDGET.teacherRequests);
  });

  it('room messages: one member sends at most wsMessagesPerMember an hour, and the ping is answered without waking the room', () => {
    const m = TUNING.multi;
    const poses = Math.ceil(m.poseBudgetHz * 3600);
    expect(poses).toBeLessThanOrEqual(LESSON_HOUR_BUDGET.wsMessagesPerMember);
    expect(src('apps/edge/src/room.ts')).toMatch(/setWebSocketAutoResponse\?\.\(new WebSocketRequestResponsePair\('ping', 'pong'\)\)/);
  });

  it('Workers AI: one student at the server speech fair-use cap stays under studentNeurons', () => {
    const n = serverSttNeurons(SEAT_FAIR_USE_LIMITS.serverSttMinutesPerDay * 60);
    expect(n).toBeLessThanOrEqual(LESSON_HOUR_BUDGET.studentNeurons);
    // Students who can use server speech at the cap on one free day (on-device recognition costs none).
    console.log(`server STT at the cap: ${n} neurons a day → ${Math.floor(FREE_TIER_LIMITS.dailyNeurons / n)} students on the free 10k`);
  });

  it('a lesson hour fits the free daily DO requests many times (docs/02: two people, two hours under 100k)', () => {
    const http = LESSON_HOUR_BUDGET.studentRequests + LESSON_HOUR_BUDGET.teacherRequests;
    const ws = Math.ceil((2 * LESSON_HOUR_BUDGET.wsMessagesPerMember) / LESSON_HOUR_BUDGET.wsMessagesPerDoRequest);
    const hours = FREE_TIER_LIMITS.dailyDoRequests / (http + ws);
    console.log(`lesson hour at the caps: ${http} HTTP + ${ws} room = ${http + ws} DO requests → ${hours.toFixed(1)} lesson hours a free day`);
    expect(hours).toBeGreaterThanOrEqual(2);
  });

  it('every file with setInterval is counted above or marked as making no request', () => {
    const counted = new Set([...STUDENT, ...TEACHER].flatMap((l) => [l.file, l.wireFile ?? l.file]));
    /** Loops outside a lesson or without a request (why). Adding a polling loop means counting it above. */
    const other: Record<string, string> = {
      'apps/adventure/src/audio/presence.ts': 'adventure: 60 s lesson ping, skipped while hidden (not in a lesson screen)',
      'apps/adventure/src/audio/sound.ts': 'sound sequencer',
      'apps/client/src/App.tsx': 'frame floor watch, no request',
      'apps/client/src/dialog/FirstVisitGuide.tsx': 'guide animation',
      'apps/client/src/dialog/mic-controller.ts': 'mic level meter',
      'apps/client/src/dialog/server-stt.ts': 'mic level meter (the upload is one request per turn)',
      'apps/client/src/frame/useGauges.ts': 'gauges in localStorage',
      'apps/client/src/lesson/LessonLayer.tsx': 'hint animation',
      'apps/client/src/lesson/LessonSide.tsx': 'side panel distance',
      'apps/client/src/start/PassLayer.tsx': 'guest pass friend only (30 s), not in a lesson',
      'apps/client/src/world/seat.ts': 'free-trial beat: 60 s, only a trial child outside a lesson (a seat or lesson never beats), skipped while hidden',
      'apps/client/src/world/engine.ts': 'pointer-lock watch (local, no request; R326 world input)',
      'apps/client/src/world/sfx.ts': 'birds',
      'apps/web/src/FamilyPage.tsx': 'clock',
      'apps/web/src/LessonAudioBox.tsx': 'audio level meter',
      'apps/web/src/LessonWindowPage.tsx': 'guardian lesson window (10 s, a family screen, not the lesson pair) and its clock',
      'apps/web/src/StudentJoin.tsx': 'web /join lite student: 3 s, used instead of /world/ (never both)',
      'apps/web/src/StudentSignup.tsx': 'sign-up waiting screen, before any lesson',
      'apps/web/src/WebUx.tsx': 'animations and the lesson window clock',
      'apps/web/src/lessonWindow.ts': 'demo lesson window, no request',
      'apps/web/src/site/TryScene.tsx': 'site demo',
      'apps/web/src/site/TrySpeak.tsx': 'site demo',
      'apps/web/src/site/pages/Play.tsx': 'site page, skipped while hidden'
    };
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(path.join(ROOT, dir))) {
        const rel = `${dir}/${f}`;
        if (f === '__tests__' || f === 'node_modules' || f === 'dist') continue;
        if (statSync(path.join(ROOT, rel)).isDirectory()) walk(rel);
        else if (/\.tsx?$/.test(f) && src(rel).includes('setInterval(')) found.push(rel);
      }
    };
    for (const app of ['apps/client/src', 'apps/web/src', 'apps/adventure/src']) walk(app);
    const unknown = found.filter((f) => !counted.has(f) && !(f in other));
    expect(unknown, 'a new setInterval: count it in STUDENT/TEACHER or say why it sends nothing').toEqual([]);
    const stale = Object.keys(other).filter((f) => !found.includes(f));
    expect(stale, 'listed files that no longer use setInterval').toEqual([]);
  });
});
