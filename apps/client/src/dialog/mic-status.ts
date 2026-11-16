import type { MicIssue } from './speech.js';

/**
 * The mic status the teacher console shows (sessionStorage 'lcw.micStatus', read by lesson/api.ts readLessonMicStatus
 * and sent with the lesson state poll), kept live by every mic turn rather than only the one-time "Hello!" check.
 *
 * Oreo lesson 11-16 (les-20261116-fdbe87bf): the check ended 'none', the console said "no mic" for 25 minutes, yet
 * two voiced ★3 turns came in at minute 2 — the check's single result was never corrected by the turns that worked,
 * and which error the check hit was lost. Now a turn that heard words sets 'ok', a refused / missing mic sets 'none',
 * a silent turn sets 'quiet' (unless the last turn heard words in the last minute), and the last mic error with the
 * browser's own code is kept next to it (`lcw.micIssue`: "<issue>:<raw>|<epoch ms>") for the console and for us.
 */

export const MIC_STATUS_KEY = 'lcw.micStatus';
export const MIC_ISSUE_KEY = 'lcw.micIssue';
/** A silent turn shortly after one that heard words does not turn the console to 'quiet' (a pause, not a mic). */
export const MIC_QUIET_GRACE_MS = 60_000;

/** Issues that mean the mic cannot be used here (the console's 'none'); 'aborted' is a cut, not a verdict. */
const NO_MIC: ReadonlySet<MicIssue> = new Set<MicIssue>(['unsupported', 'in_app', 'insecure', 'denied', 'network']);

let lastHeardAt = 0;

function store(): Storage | null {
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
  } catch {
    return null;
  }
}

function set(k: string, v: string): void {
  try {
    store()?.setItem(k, v);
  } catch {
    /* private mode: the console keeps the check's result */
  }
}

/** A mic turn ended: words heard (true) or nothing (false). */
export function noteMicTurn(heard: boolean, now = Date.now()): void {
  if (heard) {
    lastHeardAt = now;
    set(MIC_STATUS_KEY, 'ok');
    return;
  }
  if (now - lastHeardAt < MIC_QUIET_GRACE_MS) return;
  set(MIC_STATUS_KEY, 'quiet');
}

/** A mic turn failed with `issue` (`raw`: the browser's error code, e.g. 'audio-capture'). */
export function noteMicIssue(issue: MicIssue, raw?: string, now = Date.now()): void {
  set(MIC_ISSUE_KEY, `${issue}:${raw ?? issue}|${now}`);
  if (issue === 'no_speech') return noteMicTurn(false, now);
  if (NO_MIC.has(issue)) set(MIC_STATUS_KEY, 'none');
}

/** The last mic error kept by noteMicIssue, or null. */
export function readMicIssue(): { issue: string; raw: string; at: number } | null {
  let v: string | null = null;
  try {
    v = store()?.getItem(MIC_ISSUE_KEY) ?? null;
  } catch {
    v = null;
  }
  const m = v ? /^([a-z_]+):([^|]*)\|(\d+)$/.exec(v) : null;
  return m ? { issue: m[1]!, raw: m[2]!, at: Number(m[3]) } : null;
}

/** Tests only. */
export function resetMicStatusForTest(): void {
  lastHeardAt = 0;
}
