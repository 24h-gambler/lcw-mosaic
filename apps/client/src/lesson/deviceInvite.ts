import { LessonHttpError, type FetchLike, type JoinResult } from './api.js';

/**
 * A signed-in student world (device token from /signup or /link, `lcw.deviceToken`) gets the teacher's lesson by
 * itself (edge student-account.ts): `live` is polled while the world is open (it also marks the student '접속 중'
 * in the console), and once the teacher presses 수업 시작 the lesson layer calls `join` with no tap; it answers
 * exactly like `/v1/join` with a code, so the lesson controller keeps one session shape. Calling `join` again
 * (refresh, restart) leaves the earlier session working.
 */
export type DeviceLessonLive = { live: false } | { live: true; lesson_id: string; started_at: number };

export function deviceLessonApi(base = '', fetchFn?: FetchLike) {
  const f: FetchLike = fetchFn ?? ((i, init) => globalThis.fetch(i, init));
  async function request<T>(method: string, path: string, deviceToken: string): Promise<T> {
    let res: Response;
    try {
      res = await f(`${base}${path}`, { method, headers: { authorization: `Bearer ${deviceToken}` } });
    } catch {
      throw new LessonHttpError(0, 'network');
    }
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new LessonHttpError(res.status, data.error ?? `http_${res.status}`);
    return data as T;
  }
  return {
    live: async (deviceToken: string): Promise<DeviceLessonLive> => {
      const r = await request<{ live?: boolean; lesson_id?: string; started_at?: number }>('GET', '/v1/device/lesson', deviceToken);
      return r.live === true && typeof r.lesson_id === 'string'
        ? { live: true, lesson_id: r.lesson_id, started_at: Number(r.started_at ?? 0) }
        : { live: false };
    },
    join: (deviceToken: string) => request<JoinResult>('POST', '/v1/device/lesson/join', deviceToken)
  };
}

export type DeviceLessonApi = ReturnType<typeof deviceLessonApi>;
