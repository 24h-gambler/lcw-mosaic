import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FORBIDDEN_PLAYER_UI_PATTERNS } from '@lcw/ui';
import { ADVENTURE_STAGE_ID, FIRST_LESSON_PLAN, LESSON_PLANS } from '@lcw/content';
import { PlatformDO, type LcwEnv } from '../../../edge/src/platform.js';
import { fakeDurableStorage } from '../../../edge/src/__tests__/fake-do.js';
import { LessonHttpError, codeFromSearch, createStudentLessonApi, getStudentToken, type KeyValue } from '../lesson/api.js';
import { LESSON_BANNER_MS, LESSON_POLL_MS, LESSON_RETRY_MAX_MS, LESSON_RETRY_START_MS, LessonController, goalTargetEn, initialLessonView, type LessonTimers, type LessonWorld } from '../lesson/controller.js';
import { maskTarget, micUnreliable, pickHeard } from '../lesson/hint.js';
import { FOLD_HINT_MIN_LEFT_PX, FOLD_HINT_ROOM_PX, FoldHint, LessonLayer, StatusPill, foldHintPlace, lessonGoneInWorld, lessonTalkAction, openingLine, pinOpeningLine, teacherAsksNow } from '../lesson/LessonLayer.js';
import type { LessonLayerProps as AppLessonSlotProps } from '../App.js';
import { SubmitError } from '../dialog/submit.js';
import { TEACHER_STOCK, isTradeAskLine, tradeAskItemKey, tradeAskLine, tradeOffers } from '@lcw/content';

// App mounts the layer through import.meta.glob (no compile-time check there): pin the docs/19 §5 contract here.
const _slot: React.ComponentType<AppLessonSlotProps> = LessonLayer;
void _slot;
import { LESSON_STRINGS, LESSON_STRINGS_KO } from '../lesson/strings.js';

const TOKEN = 'op-token-0123456789abcdef';
const op = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };

function memStore(): KeyValue & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

function fakeTimers(clock: { now: number }) {
  const queue: Array<{ at: number; fn: () => void; id: number }> = [];
  let n = 0;
  const t: LessonTimers & { run(ms: number): Promise<void>; pending(): number } = {
    setTimeout: (fn, ms) => {
      const id = ++n;
      queue.push({ at: clock.now + ms, fn, id });
      return id;
    },
    clearTimeout: (h) => {
      const i = queue.findIndex((q) => q.id === h);
      if (i >= 0) queue.splice(i, 1);
    },
    now: () => clock.now,
    async run(ms: number) {
      const until = clock.now + ms;
      for (;;) {
        queue.sort((a, b) => a.at - b.at);
        const next = queue[0];
        if (!next || next.at > until) break;
        queue.shift();
        clock.now = next.at;
        await next.fn();
      }
      clock.now = Math.max(clock.now, until);
    },
    pending: () => queue.length
  };
  return t;
}

function fakeWorld() {
  const calls: string[] = [];
  const world: LessonWorld = {
    // R325: a stage change puts its NPC on the spot; the child is never moved (no goToScene in the lesson)
    placeSceneNpc: (id) => void calls.push(`scene:${id}`),
    npcSay: (n, t, o) => void calls.push(`say:${n}:${t}:${o?.possessed ? 'sparkle' : 'plain'}`),
    setGoal: (g, t) => void calls.push(`goal:${g}|${t ?? ''}`),
    celebrate: (s) => void calls.push(`celebrate:${s}`),
    setPossessed: (n) => void calls.push(`possess:${n}`),
    playDirectorEvent: (k) => void calls.push(`event:${k}`),
    setCoins: (n) => void calls.push(`coins:${n}`),
    setStars: (n) => void calls.push(`stars:${n}`)
  };
  return { world, calls };
}

/** The real lesson server (PlatformDO) behind the client's fetch: the controller is tested against the actual API. */
function server(clock: { now: number }) {
  vi.spyOn(Date, 'now').mockImplementation(() => clock.now);
  const p = new PlatformDO({ storage: fakeDurableStorage() }, { PLATFORM: undefined as never, LCW_OPERATOR_TOKEN: TOKEN } as LcwEnv);
  const fetch = (input: string, init?: RequestInit) => p.fetch(new Request(`https://x${input}`, init));
  const admin = async (method: string, path: string, body?: unknown) => {
    const r = await p.fetch(new Request(`https://x${path}`, { method, headers: op, body: body === undefined ? undefined : JSON.stringify(body) }));
    return (await r.json()) as any;
  };
  return { fetch, admin };
}

async function openLesson(admin: ReturnType<typeof server>['admin']) {
  await admin('POST', '/v1/admin/players', { family_id: 'fam-1', guardian_id: 'g-1', player_id: 'kid-1', nickname: 'Juno', level: 'L1' });
  return (await admin('POST', '/v1/admin/lessons/start', { player_id: 'kid-1' })) as { lesson_id: string; join_code: string };
}

describe('client lesson module (docs/19 §4)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('joins with the code, follows the teacher through stages, possession lines and events against the real API', async () => {
    const clock = { now: Date.parse('2026-11-16T15:00:00+09:00') };
    const { fetch, admin } = server(clock);
    const { lesson_id, join_code } = await openLesson(admin);
    const timers = fakeTimers(clock);
    const store = memStore();
    const { world, calls } = fakeWorld();
    const views: string[] = [];
    const ctl = new LessonController({ api: createStudentLessonApi({ fetch }), world, store, timers, onChange: (v) => views.push(v.phase) });

    await ctl.start(join_code);
    expect(ctl.state.phase).toBe('live');
    expect(ctl.state.nickname).toBe('Juno');
    expect(getStudentToken(store)).toMatch(/^[0-9a-f]{48}$/);
    expect(calls).toContain('scene:plaza');
    // the ledger balance is on the HUD from the first poll (starter purse), before any answer
    expect(calls).toContain('coins:200');
    expect(ctl.state.coins).toBe(200);
    // R326 ⑫: the HUD card is the mission only (the sentence is an idea in the side panel, never an order)
    expect(calls.find((c) => c.startsWith('goal:'))).not.toContain('My name is ___.');

    // the teacher moves to the cafe, possesses the owner, speaks and fires a blackout
    await admin('POST', `/v1/admin/lessons/${lesson_id}/stage`, { stage_id: 'cafe_order', targets: ['Can I have a warm honey tea?'] });
    await admin('POST', `/v1/admin/lessons/${lesson_id}/npc-say`, { npc_id: 'cafe_owner', text: 'Welcome! What would you like?' });
    await admin('POST', `/v1/admin/lessons/${lesson_id}/event`, { kind: 'blackout' });
    await timers.run(LESSON_POLL_MS);
    expect(calls).toContain('scene:honey_cafe');
    expect(calls).toContain('possess:cafe_owner');
    expect(calls).toContain('say:cafe_owner:Welcome! What would you like?:sparkle');
    expect(calls).toContain('event:blackout');
    expect(ctl.state).toMatchObject({ stageId: 'cafe_order', sceneId: 'honey_cafe', npcId: 'cafe_owner', hint: 'full' });
    expect(ctl.state.offers).toEqual([{ stars: 2, text: 'Can I have a warm honey tea?', hintTags: ['can i have'] }]);
    expect(ctl.state.banner?.kind).toBe('blackout');
    expect(ctl.state.bubbles.at(-1)).toMatchObject({ npcNameKo: '카페 주인 해나', npcNameEn: 'Hannah', possessed: true });

    // nothing is replayed on the next polls; the banner goes away by itself
    const before = calls.length;
    await timers.run(LESSON_BANNER_MS + LESSON_POLL_MS);
    expect(calls.slice(before).filter((c) => c.startsWith('say:') || c.startsWith('event:'))).toEqual([]);
    expect(ctl.state.banner).toBeNull();

    // the dialog submit goes to /v1/lesson/utterance; the server scores and the world celebrates
    const r = await ctl.submit({
      target_text: 'Can I have a warm honey tea?',
      transcript: 'can I have a warm honey tea',
      chosen_stars: 2,
      hint_level: 'full',
      latency_ms: 900,
      dur_ms: 2100.4,
      stt_source: 'browser',
      confidence: 0.92
    });
    expect(r).toMatchObject({ pass: true, stars: 2, coinsTotal: 220 }); // the child's one ledger: starting 200 + 2★ × 10
    expect(calls.filter((c) => c.startsWith('coins:'))).toEqual(['coins:200', 'coins:220']); // once per change
    // the HUD star chip counts this lesson's stars as the answer lands (not when "done" is tapped)
    expect(calls).toContain('stars:2');
    expect(ctl.state.lessonStars).toBe(2);
    // the dialog window opens with the stage script
    expect(ctl.state.npcLineEn).toBe('Welcome to the honey cafe! What would you like today?');
    // the DialogPanel's payload carries solo meta; the strict lesson body must not (it would be a 400)
    const viaPanel = await ctl.submit({
      target_text: 'Can I have a warm honey tea?',
      transcript: 'can I have a warm honey tea',
      chosen_stars: 2,
      hint_level: 'full',
      latency_ms: 700,
      dur_ms: 2000,
      stt_source: 'browser',
      confidence: 0.9,
      echo: false,
      attempt: 2,
      dialogId: 'dlg_lesson_1'
    });
    // the same sentence again is a repeat (R2627 stars once per goal): passed, no stars, the balance unchanged
    expect(viaPanel).toMatchObject({ pass: true, stars: 0, repeat: true, coinsTotal: 220 });
    // the panel that shows the result celebrates (App's DialogHost or the layer's own), not the controller: no double stars
    expect(calls.filter((c) => c.startsWith('celebrate:'))).toEqual([]);
    expect(ctl.state.lastResult?.utterancesToday).toBe(2);

    // the director sees the student's screen
    const feed = await admin('GET', `/v1/admin/lessons/${lesson_id}/feed`);
    expect(feed.student_view).toMatchObject({ connected: true, scene_id: 'honey_cafe', ui: '3d' });

    // a reload in the same tab resumes the session without the code and without replaying the blackout
    const { world: w2, calls: c2 } = fakeWorld();
    const ctl2 = new LessonController({ api: createStudentLessonApi({ fetch }), world: w2, store, timers: fakeTimers(clock) });
    await ctl2.start(null);
    expect(ctl2.state.phase).toBe('live');
    // the cafe's one sentence on screen passed, so the server moved on by itself (docs/18 §9): the reload opens the next stage
    expect(c2).toContain(`scene:${FIRST_LESSON_PLAN.stages[2]!.sceneId}`);
    expect(c2.filter((c) => c.startsWith('event:'))).toEqual([]);
    ctl2.stop();

    await admin('POST', `/v1/admin/lessons/${lesson_id}/end`, {});
    await timers.run(LESSON_POLL_MS);
    expect(ctl.state.phase).toBe('ended');
    expect(timers.pending()).toBe(0);
    expect(views).toContain('joining');
  });

  it("the teacher's stage move shows on the child's screen within 2 s, even when each poll answers slowly (11-19)", async () => {
    const clock = { now: Date.parse('2026-11-16T15:00:00+09:00') };
    const { fetch, admin } = server(clock);
    const { lesson_id, join_code } = await openLesson(admin);
    const timers = fakeTimers(clock);
    const { world, calls } = fakeWorld();
    const ROUND_TRIP_MS = 500;
    const starts: number[] = [];
    let moveDuring: (() => Promise<unknown>) | null = null;
    let movedAt = 0;
    // every state poll takes half a second to come back (a slow tablet on a busy network); the server answers at its start
    const slow = async (i: string, init?: RequestInit) => {
      if (!i.startsWith('/v1/lesson/state')) return fetch(i, init);
      starts.push(clock.now);
      const r = await fetch(i, init);
      if (moveDuring) {
        // the worst case: the teacher moves the stage just after the server answered this poll with the old one
        const move = moveDuring;
        moveDuring = null;
        movedAt = clock.now;
        await move();
      }
      clock.now += ROUND_TRIP_MS;
      return r;
    };
    const ctl = new LessonController({ api: createStudentLessonApi({ fetch: slow }), world, store: memStore(), timers });
    await ctl.start(join_code);
    await timers.run(5 * LESSON_POLL_MS);
    // the polls keep their beat from each start: the slow answer does not stretch the gap
    const gaps = starts.slice(1).map((t, i) => t - starts[i]!);
    expect(gaps.length).toBeGreaterThanOrEqual(4);
    expect(gaps.every((g) => g === LESSON_POLL_MS)).toBe(true);
    const cafe = `scene:${FIRST_LESSON_PLAN.stages.find((st) => st.id === 'cafe_order')!.sceneId}`;
    calls.length = 0;
    moveDuring = () => admin('POST', `/v1/admin/lessons/${lesson_id}/stage`, { stage_id: 'cafe_order', targets: ['Can I have a warm honey tea?'] });
    let shownAfter: number | null = null;
    for (let t = 0; t < 4000 && shownAfter === null; t += 50) {
      await timers.run(50);
      if (calls.includes(cafe)) shownAfter = clock.now - movedAt;
    }
    expect(shownAfter).not.toBeNull();
    expect(movedAt).toBeGreaterThan(0);
    expect(shownAfter!).toBeLessThanOrEqual(LESSON_POLL_MS + ROUND_TRIP_MS);
    expect(LESSON_POLL_MS + ROUND_TRIP_MS).toBeLessThan(2000);
    ctl.stop();
  });

  it('a wrong code asks again with a kind message; a lost connection retries with backoff and recovers', async () => {
    const clock = { now: Date.parse('2026-11-16T15:00:00+09:00') };
    const { fetch, admin } = server(clock);
    const { join_code } = await openLesson(admin);
    const timers = fakeTimers(clock);
    let offline = false;
    const flaky = (i: string, init?: RequestInit) => (offline ? Promise.reject(new Error('offline')) : fetch(i, init));
    const ctl = new LessonController({ api: createStudentLessonApi({ fetch: flaky }), world: null, store: memStore(), timers });
    await ctl.start('123456');
    expect(ctl.state).toMatchObject({ phase: 'needs_code', errorCode: 'invalid_code' });
    expect(LESSON_STRINGS_KO.code.errors.invalid_code).toBeTruthy();
    await ctl.join(join_code);
    expect(ctl.state.phase).toBe('live');
    offline = true;
    await timers.run(LESSON_POLL_MS);
    expect(ctl.state.connection).toBe('retrying');
    offline = false;
    await timers.run(15_000);
    expect(ctl.state.connection).toBe('ok');
    ctl.stop();
  });

  it('restarts cleanly after stop (StrictMode/HMR), drops answers of an older run, and asks for a code when the token expires', async () => {
    const clock = { now: Date.parse('2026-11-16T15:00:00+09:00') };
    const { fetch, admin } = server(clock);
    const { lesson_id, join_code } = await openLesson(admin);
    const timers = fakeTimers(clock);
    const store = memStore();
    let stateCalls = 0;
    let hold: (() => void) | null = null;
    const counting = async (i: string, init?: RequestInit) => {
      if (i.startsWith('/v1/lesson/state')) {
        stateCalls++;
        if (hold === null && stateCalls === 3) await new Promise<void>((r) => (hold = r));
      }
      return fetch(i, init);
    };
    const ctl = new LessonController({ api: createStudentLessonApi({ fetch: counting }), world: null, store, timers });
    await ctl.start(join_code);
    ctl.stop();
    expect(timers.pending()).toBe(0);
    // effect cleanup + effect again: the same controller polls again
    await ctl.start(null);
    expect(ctl.state.phase).toBe('live');
    expect(stateCalls).toBe(2);
    expect(timers.pending()).toBe(1);

    // a poll is in flight when the child leaves: its late answer must not bring the lesson back
    const late = timers.run(LESSON_POLL_MS);
    await new Promise((r) => setTimeout(r, 0));
    expect(hold).not.toBeNull();
    ctl.leave();
    hold!();
    await late;
    expect(ctl.state.phase).toBe('needs_code');
    expect(ctl.state.stageId).toBeNull();
    expect(timers.pending()).toBe(0);

    // rejoin, then the lesson ends and the token is refused later: the screen asks for a new code
    await ctl.join(join_code);
    expect(ctl.state.phase).toBe('live');
    await admin('POST', `/v1/admin/lessons/${lesson_id}/end`, {});
    const expired = new LessonController({
      api: { ...createStudentLessonApi({ fetch }), state: async () => Promise.reject(new LessonHttpError(401, 'student_only')) },
      world: null,
      store,
      timers: fakeTimers(clock)
    });
    await expired.start(null);
    expect(expired.state).toMatchObject({ phase: 'needs_code', errorCode: 'expired' });
    expect(getStudentToken(store)).toBeNull();
    ctl.stop();
  });

  it('backs off 6 s, 12 s, 15 s while offline and keeps 3 s once back', async () => {
    const clock = { now: Date.parse('2026-11-16T15:00:00+09:00') };
    const { fetch, admin } = server(clock);
    const { join_code } = await openLesson(admin);
    const timers = fakeTimers(clock);
    const at: number[] = [];
    let offline = false;
    const t0 = clock.now;
    const flaky = (i: string, init?: RequestInit) => {
      if (i.startsWith('/v1/lesson/state')) at.push(clock.now - t0);
      return offline ? Promise.reject(new Error('offline')) : fetch(i, init);
    };
    const ctl = new LessonController({ api: createStudentLessonApi({ fetch: flaky }), world: null, store: memStore(), timers });
    await ctl.start(join_code);
    offline = true;
    await timers.run(LESSON_POLL_MS + 6000 + 12000 + 15000 - 1);
    offline = false;
    await timers.run(1 + LESSON_POLL_MS + LESSON_POLL_MS);
    // the first miss comes at the regular poll; the retries wait 6, 12, then 15 s (the ceiling); back online, the regular poll again
    const p = LESSON_POLL_MS;
    expect(LESSON_RETRY_START_MS).toBe(3000);
    expect(at).toEqual([0, p, p + 6000, p + 18000, p + 33000, p + 33000 + p, p + 33000 + 2 * p]);
    ctl.stop();
  });

  it('speech: the alternative closest to the sentence wins; iOS in-app web views type instead', () => {
    const alts = [
      { transcript: 'can I have a warm honey', confidence: 0.9 },
      { transcript: 'can I have a warm honey tea', confidence: 0.7 }
    ];
    expect(pickHeard(alts, 'Can I have a warm honey tea?', false)?.transcript).toBe('can I have a warm honey tea');
    expect(pickHeard(alts, '', true)?.transcript).toBe('can I have a warm honey');
    expect(pickHeard([{ transcript: '  ', confidence: 1 }], 'hi', false)).toBeNull();
    const kakao = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 10.4.5';
    const wk = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
    const safari = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
    const android = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36 KAKAOTALK';
    expect([kakao, wk, safari, android].map(micUnreliable)).toEqual([true, true, false, false]);
  });

  it('the teacher (R325): E or a tap on the teacher opens the trade window, before the lesson NPC and passers-by', () => {
    expect(lessonTalkAction('teacher', 'cafe_owner', false)).toBe('trade');
    expect(lessonTalkAction('teacher', 'teacher', true)).toBe('trade');
    expect(lessonTalkAction('cafe_owner', 'cafe_owner', false)).toBe('reopen');
  });

  it("R331: E at the teacher answers the teacher's open sentence first, then (or after a newer trade proposal) trades", () => {
    expect(lessonTalkAction('teacher', 'guide', false, true)).toBe('reopen');
    expect(lessonTalkAction('teacher', 'guide', false, false)).toBe('trade');
    // sentences waiting, not passed, no proposal after them → the sentence
    expect(teacherAsksNow({ offers: 2, panelKey: '3:a|b', answeredKey: null, tradeAsked: false })).toBe(true);
    // passed (the pass came on these sentences) → trade
    expect(teacherAsksNow({ offers: 2, panelKey: '3:a|b', answeredKey: '3:a|b', tradeAsked: false })).toBe(false);
    // a pass on older sentences does not answer new ones
    expect(teacherAsksNow({ offers: 1, panelKey: '4:c', answeredKey: '3:a|b', tradeAsked: false })).toBe(true);
    // a trade proposal newer than the sentences → trade; no sentences → trade
    expect(teacherAsksNow({ offers: 2, panelKey: '3:a|b', answeredKey: null, tradeAsked: true })).toBe(false);
    expect(teacherAsksNow({ offers: 0, panelKey: '3:', answeredKey: null, tradeAsked: false })).toBe(false);
  });

  it("R331: the panel's trade proposal line names the thing so the child's trade window opens with it picked", () => {
    for (const it of TEACHER_STOCK) {
      const line = tradeAskLine(tradeOffers({ getKey: it.key })[1]!.text, it.label);
      expect(isTradeAskLine(line)).toBe(true);
      expect(tradeAskItemKey(line)).toBe(it.key);
    }
    expect(isTradeAskLine('I like playing soccer.')).toBe(false);
    expect(tradeAskItemKey('Say "hi" and the dragon is yours!')).toBeNull();
  });

  it("the dialog's first line: the teacher's newest line as this stage's NPC, else the stage script", () => {
    const bubble = (id: string, npcId: string, text: string, at: number, possessed = true) => ({ id, npcId, npcNameKo: npcId, text, possessed, at });
    const base = { npcId: 'guide', npcLineEn: 'Hi! What is your name?', stageStartedAt: 1000 };
    expect(openingLine({ ...base, bubbles: [] })).toBe('Hi! What is your name?');
    // a line from the last stage or another NPC does not count
    expect(openingLine({ ...base, bubbles: [bubble('a', 'guide', 'Old stage line', 900), bubble('b', 'cafe_owner', 'Welcome!', 1200)] })).toBe('Hi! What is your name?');
    // the follow-up the teacher just sent is what the window opens with after an answer
    expect(openingLine({ ...base, bubbles: [bubble('c', 'guide', 'Hi! What is your name?', 1100), bubble('d', 'guide', 'How old are you?', 1500)] })).toBe('How old are you?');
  });
  it('an open dialog window keeps its first line when a teacher line arrives (no swap or read-aloud over the mic)', () => {
    const bubble = (id: string, npcId: string, text: string, at: number) => ({ id, npcId, npcNameKo: '', text, possessed: true, at });
    const base = { npcId: 'guide', npcLineEn: 'Hi! What is your name?', stageStartedAt: 1000, bubbles: [] as ReturnType<typeof bubble>[] };
    const open = pinOpeningLine(null, '1:a:0:open', base);
    expect(open.line).toBe('Hi! What is your name?');
    const later = { ...base, bubbles: [bubble('x', 'guide', 'How old are you?', 1500)] };
    // the same window (recording, scoring, result): unchanged
    expect(pinOpeningLine(open, '1:a:0:open', later)).toBe(open);
    // after "완료" (doneSeq) or reopening after ✕, the new window says the teacher's newest line
    expect(pinOpeningLine(open, '1:a:1:open', later).line).toBe('How old are you?');
    expect(pinOpeningLine(open, '1:a:0:folded', later).line).toBe('How old are you?');
  });

  it('the star chip takes the server sum from the answer, so a poll in between cannot count a star twice', async () => {
    const calls: string[] = [];
    const world = { ...fakeWorld().world, setStars: (n: number | null) => void calls.push(`stars:${n}`) };
    const state = (lesson_stars: number) => ({
      lesson_id: 'l', stage_id: 'cafe_order', stage_goal_ko: 'g', mode: 'guided', scene_id: 'honey_cafe', npc_id: 'cafe_owner', hint: 'full',
      targets: ['Can I have a warm honey tea?'], offers: [{ stars: 2, text: 'Can I have a warm honey tea?', hintTags: ['can i have'] }],
      possessed_npc_id: null, npc_lines: [], events: [], cursor: 1, ended: false, lesson_stars, server_now: 1
    });
    const api = {
      join: async () => ({ student_token: 't'.repeat(48), lesson_id: 'l', player_id: 'p', nickname: 'n', level: 'L1' }),
      state: async () => state(2),
      utterance: async () => ({ pass: true, score: 1, stars: 2, feedback_ko: 'ok', coins_total: 220, lesson_stars: 2, utterances_today: 1 })
    } as unknown as ConstructorParameters<typeof LessonController>[0]['api'];
    const ctl = new LessonController({ api, world, store: memStore(), timers: fakeTimers({ now: 0 }) });
    await ctl.start('123456');
    // the poll already counted this answer (stored before the poll was read): the answer must not add it again
    ctl.apply(state(2) as never);
    await ctl.submit({ target_text: 'Can I have a warm honey tea?', transcript: 'can I have a warm honey tea', chosen_stars: 2, hint_level: 'full', latency_ms: 1, dur_ms: 1, stt_source: 'keyboard', confidence: 1 });
    expect(ctl.state.lessonStars).toBe(2);
    expect(calls.filter((c) => c.startsWith('stars:'))).toEqual(['stars:2']);
  });

  it('the goal line is the English goal the server sends (Korean only from an older server)', async () => {
    const goals: string[] = [];
    const world = { ...fakeWorld().world, setGoal: (g: string) => void goals.push(g) };
    const state = (en: string | undefined) => ({
      lesson_id: 'l', stage_id: 'cafe_order', stage_goal_ko: '카페에서 주문해요', ...(en === undefined ? {} : { stage_goal_en: en }), mode: 'guided', scene_id: 'honey_cafe', npc_id: 'cafe_owner', hint: 'full',
      targets: [], offers: [], possessed_npc_id: null, npc_lines: [], events: [], cursor: 1, ended: false, lesson_stars: 0, server_now: 1
    });
    const api = {
      join: async () => ({ student_token: 't'.repeat(48), lesson_id: 'l', player_id: 'p', nickname: 'n', level: 'L1' }),
      state: async () => state('Order a drink at the cafe')
    } as unknown as ConstructorParameters<typeof LessonController>[0]['api'];
    const ctl = new LessonController({ api, world, store: memStore(), timers: fakeTimers({ now: 0 }) });
    await ctl.start('123456');
    expect(goals.at(-1)).toBe('Order a drink at the cafe');
    expect(ctl.state.goalEn).toBe('Order a drink at the cafe');
    ctl.apply(state(undefined) as never);
    expect(goals.at(-1)).toBe('카페에서 주문해요');
  });

  it("the answer's English feedback reaches the dialog result (the Korean stays for the help line; older servers send none)", async () => {
    const state = {
      lesson_id: 'l', stage_id: 'cafe_order', stage_goal_ko: 'g', mode: 'guided', scene_id: 'honey_cafe', npc_id: 'cafe_owner', hint: 'full',
      targets: ['Can I have a warm honey tea?'], offers: [{ stars: 1, text: 'Can I have a warm honey tea?', hintTags: [] }],
      possessed_npc_id: null, npc_lines: [], events: [], cursor: 1, ended: false, lesson_stars: 0, server_now: 1
    };
    let en: string | undefined = 'You passed!';
    const api = {
      join: async () => ({ student_token: 't'.repeat(48), lesson_id: 'l', player_id: 'p', nickname: 'n', level: 'L1' }),
      state: async () => state,
      utterance: async () => ({ pass: true, score: 1, stars: 1, feedback_ko: '통과했어요!', ...(en ? { feedback_en: en } : {}), coins_total: 210, lesson_stars: 1, utterances_today: 1 })
    } as unknown as ConstructorParameters<typeof LessonController>[0]['api'];
    const ctl = new LessonController({ api, world: fakeWorld().world, store: memStore(), timers: fakeTimers({ now: 0 }) });
    await ctl.start('123456');
    const u = { target_text: 'Can I have a warm honey tea?', transcript: 'can I have a warm honey tea', chosen_stars: 1, hint_level: 'full', latency_ms: 1, dur_ms: 1, stt_source: 'keyboard', confidence: 1 } as const;
    expect(await ctl.submit(u)).toMatchObject({ feedbackKo: '통과했어요!', feedbackEn: 'You passed!' });
    en = undefined;
    const old = await ctl.submit(u);
    expect(old.feedbackKo).toBe('통과했어요!');
    expect('feedbackEn' in old).toBe(false);
  });

  it('after a reload the window opens with the stage line the server names (older than the bubbles)', () => {
    const base = { npcId: 'cafe_owner', npcLineEn: 'Welcome to the honey cafe!', stageStartedAt: 1000, bubbles: [] };
    expect(openingLine({ ...base, stageLastLineEn: 'Anything else?' })).toBe('Anything else?');
    expect(openingLine({ ...base, stageLastLineEn: '' })).toBe('Welcome to the honey cafe!');
  });

  it('A → B → A between two polls is a new stage start (fresh window), and a late answer after leaving moves no chip', async () => {
    const state = (stage_started_at: number) => ({
      lesson_id: 'l', stage_id: 'cafe_order', stage_goal_ko: 'g', mode: 'guided', scene_id: 'honey_cafe', npc_id: 'cafe_owner', hint: 'full',
      targets: ['Can I have a warm honey tea?'], offers: [{ stars: 2, text: 'Can I have a warm honey tea?', hintTags: [] }],
      possessed_npc_id: null, npc_lines: [], events: [], cursor: 1, ended: false, lesson_stars: 0, stage_started_at, server_now: stage_started_at
    });
    let release: (v: unknown) => void = () => undefined;
    const api = {
      join: async () => ({ student_token: 't'.repeat(48), lesson_id: 'l', player_id: 'p', nickname: 'n', level: 'L1' }),
      state: async () => state(1000),
      utterance: () => new Promise((r) => (release = r))
    } as unknown as ConstructorParameters<typeof LessonController>[0]['api'];
    const calls: string[] = [];
    const world = { ...fakeWorld().world, setStars: (n: number | null) => void calls.push(`stars:${n}`), setCoins: (n: number | null) => void calls.push(`coins:${n}`) };
    const ctl = new LessonController({ api, world, store: memStore(), timers: fakeTimers({ now: 0 }) });
    await ctl.start('123456');
    const seq = ctl.state.stageSeq;
    ctl.apply(state(1000) as never);
    expect(ctl.state.stageSeq).toBe(seq);
    ctl.apply(state(5000) as never);
    expect(ctl.state.stageSeq).toBe(seq + 1);
    expect(ctl.state.stageStartedAt).toBe(5000);

    calls.length = 0;
    const pending = ctl.submit({ target_text: 'Can I have a warm honey tea?', transcript: 'can I have a warm honey tea', chosen_stars: 2, hint_level: 'full', latency_ms: 1, dur_ms: 1, stt_source: 'keyboard', confidence: 1 });
    ctl.leave();
    release({ pass: true, score: 1, stars: 2, feedback_ko: 'ok', coins_total: 220, lesson_stars: 2, utterances_today: 1 });
    expect((await pending).stars).toBe(2);
    expect(calls).toEqual([]);
    expect(ctl.state.lessonStars).toBe(0);
  });

  it('a new code in the same tab (another lesson) starts the star chip from 0', async () => {
    let lesson = 'l1';
    const state = (lesson_stars: number) => ({
      lesson_id: lesson, stage_id: 'warmup', stage_goal_ko: 'g', mode: 'guided', scene_id: 'plaza', npc_id: 'guide', hint: 'full',
      targets: [], offers: [], possessed_npc_id: null, npc_lines: [], events: [], cursor: 1, ended: false, lesson_stars, server_now: 1
    });
    let stars = 5;
    const api = {
      join: async () => ({ student_token: 't'.repeat(48), lesson_id: lesson, player_id: 'p', nickname: 'n', level: 'L1' }),
      state: async () => state(stars)
    } as unknown as ConstructorParameters<typeof LessonController>[0]['api'];
    const ctl = new LessonController({ api, world: fakeWorld().world, store: memStore(), timers: fakeTimers({ now: 0 }) });
    await ctl.start('123456');
    expect(ctl.state.lessonStars).toBe(5);
    lesson = 'l2';
    stars = 1;
    await ctl.join('654321');
    expect(ctl.state.lessonStars).toBe(1);
  });

  it('the HUD goal shows the English sentence only with the full hint (recall must not give it away)', () => {
    const offers = [{ text: 'Can I have a warm honey tea?' }];
    expect(goalTargetEn('full', offers)).toBe('Can I have a warm honey tea?');
    for (const h of ['keyword', 'initial', 'picture', 'none'] as const) expect(goalTargetEn(h, offers)).toBeUndefined();
    expect(goalTargetEn('full', [])).toBeUndefined();
  });

  it("the adventure stage (the day's last box) lights the status bar's same-tab 🗺 button; other stages leave it plain", () => {
    const view = (stageId: string) => ({ ...initialLessonView(), phase: 'live' as const, connection: 'ok' as const, nickname: 'Oreo', stageId });
    const now = renderToStaticMarkup(React.createElement(StatusPill, { view: view(ADVENTURE_STAGE_ID), onLeave: () => undefined }));
    expect(now).toContain('data-testid="lesson-adventure"');
    expect(now).toContain('data-now="1"');
    expect(now).toContain(LESSON_STRINGS.status.adventure);
    const cafe = renderToStaticMarkup(React.createElement(StatusPill, { view: view('cafe_order'), onLeave: () => undefined }));
    expect(cafe).toContain('data-testid="lesson-adventure"');
    expect(cafe).not.toContain('data-now');
    // the goal card the world shows for that stage points at the same button
    for (const plan of LESSON_PLANS) expect(plan.stages.at(-1)!.studentGoalEn).toContain('🗺 Adventure');
  });

  it('in the adventure stage the order is ✕ first, then 🗺: goal, teacher guide and the card over the open window say so', () => {
    // 🗺 lives in the status bar, which shows only while the dialog window is folded (adventure lane, 390 run 11-19 17:04)
    for (const plan of LESSON_PLANS) {
      const s = plan.stages.at(-1)!;
      expect(s.id).toBe(ADVENTURE_STAGE_ID);
      for (const text of [s.studentGoalEn, s.studentGoalKo, s.teacherGuideKo, s.stepsKo![0]!]) {
        expect(text).toContain('✕');
        expect(text.indexOf('✕')).toBeLessThan(text.indexOf('🗺'));
      }
    }
    for (const S of [LESSON_STRINGS, LESSON_STRINGS_KO]) {
      expect(S.status.adventureFold.indexOf('✕')).toBeGreaterThanOrEqual(0);
      expect(S.status.adventureFold.indexOf('✕')).toBeLessThan(S.status.adventureFold.indexOf('🗺'));
    }
    const html = renderToStaticMarkup(React.createElement(FoldHint));
    expect(html).toContain('data-testid="lesson-adventure-fold"');
    expect(html).toContain(LESSON_STRINGS.status.adventureFold);
    expect(html).toContain('pointer-events:none'); // the ✕ under the arrow stays tappable
  });

  it('the fold card points at the ✕ from beside it (not over the NPC line), else above, else below, else top right', () => {
    // 390 bottom sheet, measured: ✕ 336–376 x 558–598 -> the card ends 4 px left of the ✕, centred on its row
    expect(foldHintPlace({ top: 558, bottom: 598, left: 336, right: 376 }, 390)).toEqual({ top: 578, right: 58, side: 'left' });
    // no room on the left (a narrow window flush left): above the ✕, its arrow over it
    const narrow = { top: 300, bottom: 340, left: FOLD_HINT_MIN_LEFT_PX - 1, right: FOLD_HINT_MIN_LEFT_PX + 39 };
    expect(foldHintPlace(narrow, 390)).toEqual({ top: 292, right: 390 - (FOLD_HINT_MIN_LEFT_PX + 39), side: 'above' });
    // and near the top as well: under it, arrow up
    const low = foldHintPlace({ ...narrow, top: FOLD_HINT_ROOM_PX - 1, bottom: FOLD_HINT_ROOM_PX + 39 }, 390);
    expect(low.side).toBe('below');
    expect(low.top).toBeGreaterThan(FOLD_HINT_ROOM_PX + 39);
    expect(foldHintPlace(null, 1280).side).toBe('none');
    // never off the right edge
    expect(foldHintPlace({ top: 200, bottom: 240, left: 20, right: 400 }, 390).right).toBeGreaterThan(0);
  });

  it('hints follow the stage ladder and the layer draws nothing outside a lesson', () => {
    expect(maskTarget('Can I have a warm honey tea?', 'full')).toBe('Can I have a warm honey tea?');
    expect(maskTarget('I want to trade my blue stone', 'keyword', ['i want'])).toBe('I want __ _____ __ ____ _____');
    expect(maskTarget('Can I have a warm honey tea?', 'initial')).toBe('C__ I h___ a w___ h____ t__?');
    expect(maskTarget('anything', 'none')).toBe('');
    expect(codeFromSearch('?code=042117')).toBe('042117');
    expect(codeFromSearch('?code=42117')).toBeNull();
    // Outside a lesson (bare /world/): nothing at all — no code button, no panel, no code card. A lesson is the teacher
    // coming into the child's world (Dan 11-16 12:10); 6-digit codes are world invites on the title.
    const solo = renderToStaticMarkup(React.createElement(LessonLayer, { world: null, search: '' }));
    expect(solo).toBe('');
    expect(solo).not.toContain('lesson-code-open');
    // A saved session resumed in the world (the lesson came to the child): the first render still says 'needs_code'
    // but the controller is live — the session stays. Only when both say 'needs_code' is the lesson gone.
    const base = { code: null, active: true } as const;
    expect(lessonGoneInWorld({ ...base, viewPhase: 'needs_code', controllerPhase: 'live' })).toBe(false);
    expect(lessonGoneInWorld({ ...base, viewPhase: 'needs_code', controllerPhase: 'needs_code' })).toBe(true);
    expect(lessonGoneInWorld({ ...base, code: '123456', viewPhase: 'needs_code', controllerPhase: 'needs_code' })).toBe(false);
    expect(lessonGoneInWorld({ ...base, active: false, viewPhase: 'needs_code', controllerPhase: 'needs_code' })).toBe(false);
    // a slow device hands the same session to /join?lite=1: the session must survive until that move
    expect(lessonGoneInWorld({ ...base, lowTier: true, viewPhase: 'needs_code', controllerPhase: 'needs_code' })).toBe(false);
    const html = renderToStaticMarkup(React.createElement(LessonLayer, { world: null, search: '?code=123456' }));
    expect(html).toContain(LESSON_STRINGS.code.title);
    const all = JSON.stringify(LESSON_STRINGS_KO);
    for (const bad of FORBIDDEN_PLAYER_UI_PATTERNS) expect(all).not.toContain(bad);
    expect(all).not.toMatch(/원|결제|구매|가격/);
  });
});

describe('disconnect recovery: answers kept on the device (lesson outbox)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('an answer said offline is kept, said once, and reaches the teacher after the next good poll; a lost response is not counted twice', async () => {
    const clock = { now: Date.parse('2026-11-16T15:00:00+09:00') };
    const { fetch, admin } = server(clock);
    const { lesson_id, join_code } = await openLesson(admin);
    await admin('POST', `/v1/admin/lessons/${lesson_id}/stage`, { stage_id: 'cafe_order', targets: ['Can I have a warm honey tea?'] });
    let mode: 'up' | 'down' | 'lose-response' = 'up';
    const net = async (input: string, init?: RequestInit) => {
      if (mode === 'down') throw new TypeError('Failed to fetch');
      const res = await fetch(input, init);
      if (mode === 'lose-response' && input.startsWith('/v1/lesson/utterance')) throw new TypeError('connection reset');
      return res;
    };
    const store = memStore();
    const timers = fakeTimers(clock);
    const { world, calls } = fakeWorld();
    const ctl = new LessonController({ api: createStudentLessonApi({ fetch: net }), world, store, timers });
    await ctl.start(join_code);
    const say = (transcript: string) =>
      ctl.submit({ target_text: 'Can I have a warm honey tea?', transcript, chosen_stars: 2, hint_level: 'full', latency_ms: 1, dur_ms: 1500, stt_source: 'browser', confidence: 0.9 });

    // wifi drops; the child answers: kept, the panel hears "queued" (no retry button)
    mode = 'down';
    const err = await say('can I have a warm honey tea').catch((e) => e);
    expect(err).toBeInstanceOf(SubmitError);
    expect(err.kind).toBe('queued');
    expect(ctl.state.outbox).toBe(1);
    expect(ctl.state.connection).toBe('retrying');
    // the teacher moves on meanwhile (this screen still shows the cafe: no poll got through)
    await admin('POST', `/v1/admin/lessons/${lesson_id}/stage`, { stage_id: 'open_question', targets: [] });
    // the answer reached the server but its response was lost: kept too
    mode = 'lose-response';
    await say('can I have a warm honey tea please').catch(() => undefined);
    expect(ctl.state.outbox).toBe(2);
    // back online: the next poll sends both, in order; the second is the same answer, not a new one
    mode = 'up';
    await timers.run(LESSON_RETRY_MAX_MS + 100);
    expect(ctl.state.outbox).toBe(0);
    expect(ctl.state.connection).toBe('ok');
    expect(ctl.state.stageId).toBe('open_question');
    const feed = await admin('GET', `/v1/admin/lessons/${lesson_id}/feed`);
    // both scored as the cafe answers the child gave (not as the new free-talk stage), the lost-response one once
    expect(feed.utterances.map((u: any) => [u.transcript, u.mode]).sort()).toEqual([
      ['can I have a warm honey tea please', 'guided'],
      ['can I have a warm honey tea', 'guided']
    ]);
    // HUD from the server: the stars of both answers, coins credited once each
    expect(ctl.state.lessonStars).toBe(feed.utterances.reduce((n: number, u: any) => n + Number(u.stars), 0));
    expect(calls.some((c) => c.startsWith('coins:'))).toBe(true);
    expect(store.data.has(`lcw.lesson.outbox:${lesson_id}`)).toBe(false);
  });

  it('a refresh keeps the answers: a new controller on the same tab (session storage) sends them', async () => {
    const clock = { now: Date.parse('2026-11-16T15:00:00+09:00') };
    const { fetch, admin } = server(clock);
    const { lesson_id, join_code } = await openLesson(admin);
    await admin('POST', `/v1/admin/lessons/${lesson_id}/stage`, { stage_id: 'cafe_order', targets: ['Can I have a warm honey tea?'] });
    let down = false;
    const net = async (input: string, init?: RequestInit) => {
      if (down) throw new TypeError('Failed to fetch');
      return fetch(input, init);
    };
    const store = memStore();
    const first = new LessonController({ api: createStudentLessonApi({ fetch: net }), world: fakeWorld().world, store, timers: fakeTimers(clock) });
    await first.start(join_code);
    down = true;
    await first
      .submit({ target_text: 'Can I have a warm honey tea?', transcript: 'can I have a warm honey tea', chosen_stars: 2, hint_level: 'full', latency_ms: 1, dur_ms: 1, stt_source: 'browser', confidence: 0.9 })
      .catch(() => undefined);
    first.stop();
    // the tab reloads (same session storage) once the wifi is back
    down = false;
    const again = new LessonController({ api: createStudentLessonApi({ fetch: net }), world: fakeWorld().world, store, timers: fakeTimers(clock) });
    await again.start(null);
    await again.flushOutbox();
    expect(again.state.stageId).toBe('cafe_order');
    expect(again.state.outbox).toBe(0);
    const feed = await admin('GET', `/v1/admin/lessons/${lesson_id}/feed`);
    expect(feed.utterances).toHaveLength(1);
    expect(again.state.lessonStars).toBe(2);
  });
});

describe('an NPC tap in a running lesson (Dan 11-19 "자유도도 없앴다")', () => {
  it('the lesson NPC reopens the lesson window; a passer-by gets its own free talk only when the app can open one', () => {
    expect(lessonTalkAction('cafe_owner', 'cafe_owner', false)).toBe('reopen');
    expect(lessonTalkAction(undefined, 'cafe_owner', true)).toBe('reopen');
    expect(lessonTalkAction('shop_owner', 'cafe_owner', true)).toBe('free');
    // a paused seat or the dialog module not loaded yet: the lesson window is left alone (not folded for nothing)
    expect(lessonTalkAction('shop_owner', 'cafe_owner', false)).toBe('none');
    expect(lessonTalkAction('shop_owner', 'cafe_owner', undefined)).toBe('none');
  });
});
