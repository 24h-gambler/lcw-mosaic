import { describe, expect, it } from 'vitest';
import { createLessonApi, type FetchLike } from '../lessonApi.js';

describe('report preview (director) is not a parent open', () => {
  it('getReport with the operator token asks for ?preview=1 and sends the token; without it, neither', async () => {
    const seen: Array<{ url: string; auth: string | null }> = [];
    const fetch: FetchLike = async (url, init) => {
      seen.push({ url, auth: new Headers(init?.headers).get('authorization') });
      return new Response(JSON.stringify({ kind: 'lesson', ref_id: 'l', facts: {}, body: '', clips: [], created_at: 1 }));
    };
    const api = createLessonApi({ fetch });
    await api.getReport('tok123', 'op-secret');
    await api.getReport('tok123');
    expect(seen).toEqual([
      { url: '/v1/reports/tok123?preview=1', auth: 'Bearer op-secret' },
      { url: '/v1/reports/tok123', auth: null }
    ]);
  });
});
