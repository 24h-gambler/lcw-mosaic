import { describe, expect, it } from 'vitest';
import { LESSON_MIC_ISSUE_KEY, createStudentLessonApi, readLessonMicIssue } from '../lesson/api.js';

/**
 * The child's last mic error goes to the teacher console with the state poll. The talk lane (PR 122 dialog/mic-status.ts)
 * writes sessionStorage 'lcw.micIssue' as "<issue>:<browser code>|<epoch ms>"; this side reads the same key and format.
 */
describe('lesson mic issue (talk lane lcw.micIssue)', () => {
  const store = (v: string | null) => ({ getItem: (k: string) => (k === 'lcw.micIssue' ? v : null) });

  it('same key and format as the talk lane', () => {
    expect(LESSON_MIC_ISSUE_KEY).toBe('lcw.micIssue');
    expect(readLessonMicIssue(store('denied:audio-capture|1794812345678'))).toBe('denied:audio-capture|1794812345678');
    expect(readLessonMicIssue(store('no_speech:no_speech|1794812345678'))).toBe('no_speech:no_speech|1794812345678');
    expect(readLessonMicIssue(store('denied:<b>|1'))).toBeNull();
    expect(readLessonMicIssue(store(null))).toBeNull();
    expect(readLessonMicIssue({ getItem: () => { throw new Error('blocked'); } })).toBeNull();
    expect(readLessonMicIssue(null)).toBeNull();
  });

  it('the state poll carries it as mic_issue next to mic', async () => {
    const urls: string[] = [];
    const api = createStudentLessonApi({
      fetch: async (u: string) => {
        urls.push(u);
        return new Response('{}', { status: 200 });
      }
    } as never);
    await api.state('tok', { mic: 'none', micIssue: 'denied:not-allowed|1794812345678' });
    await api.state('tok', { mic: 'ok' });
    expect(urls[0]).toContain('mic=none');
    expect(urls[0]).toContain(`mic_issue=${encodeURIComponent('denied:not-allowed|1794812345678')}`);
    expect(urls[1]).not.toContain('mic_issue');
  });
});
