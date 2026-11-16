import { describe, expect, it } from 'vitest';
import { LessonHttpError } from '../lesson/api.js';
import { deviceLessonApi } from '../lesson/deviceInvite.js';

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('deviceLessonApi (signed-in student device joins without a code)', () => {
  it('polls with the device token and reads live / not live', async () => {
    const seen: Array<{ url: string; init?: RequestInit }> = [];
    let next: Response = reply(200, { live: false });
    const api = deviceLessonApi('https://x', async (url, init) => {
      seen.push({ url, init });
      return next;
    });
    expect(await api.live('d'.repeat(64))).toEqual({ live: false });
    next = reply(200, { live: true, lesson_id: 'les-1', started_at: 5 });
    expect(await api.live('d'.repeat(64))).toEqual({ live: true, lesson_id: 'les-1', started_at: 5 });
    expect(seen[0]).toMatchObject({ url: 'https://x/v1/device/lesson', init: { method: 'GET', headers: { authorization: `Bearer ${'d'.repeat(64)}` } } });
  });

  it('join answers like /v1/join; failures are LessonHttpError', async () => {
    const join = { student_token: 's'.repeat(48), lesson_id: 'les-1', player_id: 'stu-29ddc960', nickname: 'Oreo', level: 'L1', voice_store: false };
    const ok = deviceLessonApi('', async (url, init) => {
      expect([url, init?.method]).toEqual(['/v1/device/lesson/join', 'POST']);
      return reply(200, join);
    });
    expect(await ok.join('d'.repeat(64))).toEqual(join);
    const none = deviceLessonApi('', async () => reply(404, { error: 'no_live_lesson' }));
    await expect(none.join('d'.repeat(64))).rejects.toMatchObject({ status: 404, code: 'no_live_lesson' });
    const off = deviceLessonApi('', async () => {
      throw new TypeError('offline');
    });
    const e = await off.live('d'.repeat(64)).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(LessonHttpError);
    expect(e).toMatchObject({ status: 0, code: 'network' });
  });
});
