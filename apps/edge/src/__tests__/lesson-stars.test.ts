import { describe, expect, it } from 'vitest';
import { PlatformDO, type LcwEnv } from '../platform.js';
import { FEEDBACK_EN, parseMicTurns } from '../lesson-mode.js';
import { bestBefore, starsOnce, wordOverlap } from '../lesson-stars.js';
import { fakeDurableStorage } from './fake-do.js';

const TOKEN = 'op-token-0123456789abcdef';
const op = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };

function platform() {
  return new PlatformDO({ storage: fakeDurableStorage() }, { PLATFORM: undefined as never, LCW_OPERATOR_TOKEN: TOKEN } as LcwEnv);
}
async function call(p: PlatformDO, method: string, path: string, body?: unknown, headers: Record<string, string> = op) {
  const res = await p.fetch(new Request(`https://x${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
  return { status: res.status, body: (await res.json()) as any };
}
async function startLesson(p: PlatformDO) {
  await call(p, 'POST', '/v1/admin/players', { family_id: 'fam-s', guardian_id: 'g-s', player_id: 'kid-s', nickname: 'Juno', birth_year: 2016, level: 'L1' });
  const s = await call(p, 'POST', '/v1/admin/lessons/start', { player_id: 'kid-s' });
  const j = await call(p, 'POST', '/v1/join', { code: s.body.join_code }, { 'content-type': 'application/json' });
  return { lessonId: s.body.lesson_id as string, st: { authorization: `Bearer ${j.body.student_token}`, 'content-type': 'application/json' } };
}

// The Oreo lesson's two warm-up answers (les-20261116-fdbe87bf, minute 2), as Whisper heard them.
const OREO_1 = 'my name is Ariel I like playing soccer at the school I like drawing because it makes me happy';
const OREO_2 = 'my name is Ariel I like playing soccer after school I like drawing because it makes me happy';

describe('stars once per goal (R2627)', () => {
  it('pure rule: a repeat adds nothing, a better try adds the difference, a new sentence counts whole', () => {
    expect(wordOverlap(OREO_1, OREO_2)).toBeGreaterThan(0.7);
    expect(wordOverlap('I like cats', 'My brother plays the piano every day')).toBeLessThan(0.2);
    const prev = [{ target_text: '', transcript: OREO_1, stars: 3 }];
    expect(starsOnce(prev, { pass: true, stars: 3, targetText: '', transcript: OREO_2 })).toEqual({ stars: 0, repeat: true });
    expect(starsOnce(prev, { pass: true, stars: 2, targetText: '', transcript: 'I have a little brother and a dog' })).toEqual({ stars: 2, repeat: false });
    const guided = [{ target_text: 'Can I have a warm honey tea?', transcript: 'can I have a honey tea', stars: 1 }];
    expect(bestBefore(guided, 'Can I have a warm honey tea?', 'anything')).toBe(1);
    expect(starsOnce(guided, { pass: true, stars: 3, targetText: 'Can I have a warm honey tea?', transcript: 'x' })).toEqual({ stars: 2, repeat: false });
    expect(starsOnce(guided, { pass: true, stars: 1, targetText: 'Can I have a warm honey tea?', transcript: 'x' })).toEqual({ stars: 0, repeat: true });
    // a miss is never a repeat; a guided target never matches a free answer
    expect(starsOnce(guided, { pass: false, stars: 0, targetText: 'Can I have a warm honey tea?', transcript: 'x' })).toEqual({ stars: 0, repeat: false });
    expect(bestBefore(guided, '', 'can I have a honey tea')).toBe(0);
  });

  it('the Oreo warm-up replayed: the second telling earns 0 stars and 0 coins, a new thing earns again', async () => {
    const p = platform();
    const { lessonId, st } = await startLesson(p);
    const say = (transcript: string) => call(p, 'POST', '/v1/lesson/utterance', { target_text: '', transcript, chosen_stars: 1, dur_ms: 20_000, stt_source: 'workers_ai' }, st);
    const a = await say(OREO_1);
    expect(a.body).toMatchObject({ pass: true, stars: 3, lesson_stars: 3 });
    expect(a.body.repeat).toBeUndefined();
    const b = await say(OREO_2);
    expect(b.body).toMatchObject({ pass: true, stars: 0, repeat: true, lesson_stars: 3, coins_total: a.body.coins_total, feedback_en: FEEDBACK_EN.repeat });
    const c = await say('I have a little brother and we play games on Sunday with my dad');
    expect(c.body).toMatchObject({ pass: true, stars: 3, lesson_stars: 6 });
    expect(c.body.coins_total).toBeGreaterThan(a.body.coins_total);
    // the console shows the repeat as said right (not a miss), marked as a repeat
    const feed = await call(p, 'GET', `/v1/admin/lessons/${lessonId}/feed`);
    expect(feed.body.utterances.map((u: any) => [u.pass, u.stars, u.repeat ?? false])).toEqual([[true, 3, false], [true, 0, true], [true, 3, false]]);
  });

  it('guided: the same target again tops up to its best only; the stage change starts the goals over', async () => {
    const p = platform();
    const { lessonId, st } = await startLesson(p);
    await call(p, 'POST', `/v1/admin/lessons/${lessonId}/stage`, { stage_id: 'cafe_order', targets: ['Can I have a warm honey tea?'] });
    const say = (stars: 1 | 2 | 3) =>
      call(p, 'POST', '/v1/lesson/utterance', { target_text: 'Can I have a warm honey tea?', transcript: 'can I have a warm honey tea', chosen_stars: stars, dur_ms: 2000 }, st);
    const one = await say(1);
    expect(one.body).toMatchObject({ stars: 1, lesson_stars: 1 });
    const two = await say(2);
    // shown as the stars this answer reached; the lesson sum grows by the difference only
    expect(two.body).toMatchObject({ stars: 2, lesson_stars: 2 });
    const again = await say(2);
    expect(again.body).toMatchObject({ pass: true, stars: 0, repeat: true, lesson_stars: 2, coins_total: two.body.coins_total });
  });
});

describe('mic turns reach the console (R2627 lcw.micTurns)', () => {
  it('parses the device count and keeps the last good one', async () => {
    expect(parseMicTurns('7.5.2|stt_quota:1794816185609')).toEqual({ started: 7, sent: 5, lost: 2, last_lost: { cause: 'stt_quota', at: 1794816185609 } });
    expect(parseMicTurns('3.3.0')).toEqual({ started: 3, sent: 3, lost: 0, last_lost: null });
    expect(parseMicTurns('<x>')).toBeNull();
    const p = platform();
    const { lessonId, st } = await startLesson(p);
    await call(p, 'GET', `/v1/lesson/state?mic_turns=${encodeURIComponent('4.2.2|no_speech:1794816185609')}`, undefined, st);
    let feed = await call(p, 'GET', `/v1/admin/lessons/${lessonId}/feed`);
    expect(feed.body.student_view.mic_turns).toEqual({ started: 4, sent: 2, lost: 2, last_lost: { cause: 'no_speech', at: 1794816185609 } });
    await call(p, 'GET', `/v1/lesson/state?mic_turns=${encodeURIComponent('drop table')}`, undefined, st);
    feed = await call(p, 'GET', `/v1/admin/lessons/${lessonId}/feed`);
    expect(feed.body.student_view.mic_turns.started).toBe(4);
  });
});
