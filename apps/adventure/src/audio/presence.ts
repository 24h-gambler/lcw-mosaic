import { ADV } from '../core/tuning.js';
import { lessonTokenRefused } from './listen.js';

/**
 * In a lesson (a student token in this tab, from the world's lesson or the class code box), the adventure tells the
 * lesson it is still here: `GET /v1/lesson/state?away=adventure` now and then (docs/22 1.3). Without it a child who
 * plays an island for a while in the 1PC lesson (the teacher panel and the world are not on screen) would look gone,
 * the idle sweep would close the lesson after 15 min (edge LESSON_IDLE_CLOSE_MS), and the 🎤 token would stop working.
 * The server counts it as a sign of life and shows the console the child is on the adventure; the world stage's
 * minutes do not run meanwhile. Nothing in the answer is used. A refused token asks for the class code again.
 */
export function readLessonToken(): string {
  try {
    return sessionStorage.getItem('lcw.studentToken') ?? '';
  } catch {
    return '';
  }
}

export async function pingLesson(fetchImpl: typeof fetch = (...a) => fetch(...a)): Promise<'ok' | 'none' | 'refused' | 'error'> {
  const t = readLessonToken();
  if (!t) return 'none';
  try {
    const r = await fetchImpl('/v1/lesson/state?away=adventure', { headers: { authorization: `Bearer ${t}` }, cache: 'no-store' });
    if (r.status === 401 || r.status === 403) {
      lessonTokenRefused();
      return 'refused';
    }
    return r.ok ? 'ok' : 'error';
  } catch {
    return 'error';
  }
}

/** Starts the pings (only while the page is shown); returns a stop function. */
export function startLessonPresence(): () => void {
  const tick = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    void pingLesson();
  };
  tick();
  const id = setInterval(tick, ADV.lessonPingMs);
  return () => clearInterval(id);
}
