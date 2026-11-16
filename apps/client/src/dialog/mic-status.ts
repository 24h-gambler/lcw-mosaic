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
  // every issue ends a turn that opened (MicController calls this from its session's onError only)
  noteTurnLost(issue, now);
  if (issue === 'no_speech') return noteMicTurn(false, now);
  // a dropped connection right after a turn that heard words is a blip, not "no mic" (review of #122)
  if (issue === 'network' && now - lastHeardAt < MIC_QUIET_GRACE_MS) return;
  if (NO_MIC.has(issue)) set(MIC_STATUS_KEY, 'none');
}

/**
 * Every mic turn's fate (R2627, Oreo lesson 11-16: 25 minutes open, two answers on the server, and nobody could say
 * whether the child stopped talking or her turns were lost on the way). `lcw.micTurns` = "<started>.<sent>.<lost>" with
 * "|<cause>:<epoch ms>" of the last lost one: started when the mic opens, sent when the server answered the turn's
 * sentence (or kept it in the lesson outbox), lost when a turn ended without reaching it (no voice heard, the
 * recogniser refused or failed, the send failed). A lesson sends it with the state poll; the console shows it next
 * to the mic line. Turns that are not sent by design (an ECHO piece, free talk turned into choices) are neither.
 */
export const MIC_TURNS_KEY = 'lcw.micTurns';
export interface MicTurns {
  started: number;
  sent: number;
  lost: number;
  lastLost: { cause: string; at: number } | null;
}
const TURNS_RE = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})(?:\|([a-z_]{1,20}):(\d{10,14}))?$/;

export function readMicTurns(): MicTurns {
  let v: string | null = null;
  try {
    v = store()?.getItem(MIC_TURNS_KEY) ?? null;
  } catch {
    v = null;
  }
  const m = v ? TURNS_RE.exec(v) : null;
  if (!m) return { started: 0, sent: 0, lost: 0, lastLost: null };
  return { started: Number(m[1]), sent: Number(m[2]), lost: Number(m[3]), lastLost: m[4] ? { cause: m[4], at: Number(m[5]) } : null };
}

function writeTurns(t: MicTurns): void {
  set(MIC_TURNS_KEY, `${t.started}.${t.sent}.${t.lost}${t.lastLost ? `|${t.lastLost.cause}:${t.lastLost.at}` : ''}`);
}

/** The mic opened for a turn. */
export function noteTurnStart(): void {
  const t = readMicTurns();
  writeTurns({ ...t, started: t.started + 1 });
}

/** The turn's sentence reached the server (or the lesson outbox that sends it later). */
export function noteTurnSent(): void {
  const t = readMicTurns();
  writeTurns({ ...t, sent: t.sent + 1 });
}

/** The turn ended without reaching the server: `cause` is a MicIssue or 'submit_failed'. */
export function noteTurnLost(cause: string, now = Date.now()): void {
  const t = readMicTurns();
  const c = /^[a-z_]{1,20}$/.test(cause) ? cause : 'other';
  writeTurns({ ...t, lost: t.lost + 1, lastLost: { cause: c, at: now } });
}

/** A new lesson starts its own count. */
export function resetMicTurns(): void {
  try {
    store()?.removeItem(MIC_TURNS_KEY);
  } catch {
    /* nothing kept */
  }
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
