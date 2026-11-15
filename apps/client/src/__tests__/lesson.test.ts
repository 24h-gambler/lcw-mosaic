import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FORBIDDEN_PLAYER_UI_PATTERNS } from '@lcw/ui';
import { PlatformDO, type LcwEnv } from '../../../edge/src/platform.js';
import { fakeDurableStorage } from '../../../edge/src/__tests__/fake-do.js';
import { LessonHttpError, codeFromSearch, createStudentLessonApi, getStudentToken, type KeyValue } from '../lesson/api.js';
import { LESSON_BANNER_MS, LESSON_POLL_MS, LessonController, goalTargetEn, type LessonTimers, type LessonWorld } from '../lesson/controller.js';
import { maskTarget, micUnreliable, pickHeard } from '../lesson/hint.js';
import { LessonLayer, goToSceneChecked } from '../lesson/LessonLayer.js';
import type { LessonLayerProps as AppLessonSlotProps } from '../App.js';

// App mounts the layer through import.meta.glob (no compile-time check there): pin the docs/19 §5 contract here.
const _slot: React.ComponentType<AppLessonSlotProps> = LessonLayer;
void _slot;
import { LESSON_STRINGS_KO } from '../lesson/strings.js';

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
      clock.now = until;
    },
    pending: () => queue.length
  };
  return t;
}

function fakeWorld() {
  const calls: string[] = [];
  const world: LessonWorld = {
    goToScene: async (id) => void calls.push(`scene:${id}`),
    npcSay: (n, t, o) => void calls.push(`say:${n}:${t}:${o?.possessed ? 'sparkle' : 'plain'}`),
    setGoal: (g, t) => void calls.push(`goal:${g}|${t ?? ''}`),
    celebrate: (s) => void calls.push(`celebrate:${s}`),
    setPossessed: (n) => void calls.push(`possess:${n}`),
    playDirectorEvent: (k) => void calls.push(`event:${k}`)
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
    expect(calls.find((c) => c.startsWith('goal:'))).toContain('My name is ___.');

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
    expect(ctl.state.bubbles.at(-1)).toMatchObject({ npcNameKo: '카페 주인', possessed: true });

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
    expect(viaPanel).toMatchObject({ pass: true, coinsTotal: 240 });
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
    expect(c2).toContain('scene:honey_cafe');
    expect(c2.filter((c) => c.startsWith('event:'))).toEqual([]);
    ctl2.stop();

    await admin('POST', `/v1/admin/lessons/${lesson_id}/end`, {});
    await timers.run(LESSON_POLL_MS);
    expect(ctl.state.phase).toBe('ended');
    expect(timers.pending()).toBe(0);
    expect(views).toContain('joining');
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
    await timers.run(3000 + 6000 + 12000 + 15000 - 1);
    offline = false;
    await timers.run(1 + 3000 + 3000);
    expect(at).toEqual([0, 3000, 9000, 21000, 36000, 39000, 42000]);
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

  it('a scene walk that ends without arriving (dialog pausing the world) is tried once more', async () => {
    let scene = 'plaza';
    let calls = 0;
    const w = {
      ...fakeWorld().world,
      getScene: () => scene,
      goToScene: async (id: string) => {
        calls++;
        if (calls > 1) scene = id; // the first walk is cut short
      }
    };
    await goToSceneChecked(w, 'honey_cafe');
    expect(scene).toBe('honey_cafe');
    expect(calls).toBe(2);
    await goToSceneChecked(w, 'honey_cafe');
    expect(calls).toBe(3); // arrived: no extra walk
  });

  it('the HUD goal shows the English sentence only with the full hint (recall must not give it away)', () => {
    const offers = [{ text: 'Can I have a warm honey tea?' }];
    expect(goalTargetEn('full', offers)).toBe('Can I have a warm honey tea?');
    for (const h of ['keyword', 'initial', 'picture', 'none'] as const) expect(goalTargetEn(h, offers)).toBeUndefined();
    expect(goalTargetEn('full', [])).toBeUndefined();
  });

  it('hints follow the stage ladder and the layer draws nothing outside a lesson', () => {
    expect(maskTarget('Can I have a warm honey tea?', 'full')).toBe('Can I have a warm honey tea?');
    expect(maskTarget('I want to trade my blue stone', 'keyword', ['i want'])).toBe('I want __ _____ __ ____ _____');
    expect(maskTarget('Can I have a warm honey tea?', 'initial')).toBe('Can …');
    expect(maskTarget('anything', 'none')).toBe('');
    expect(codeFromSearch('?code=042117')).toBe('042117');
    expect(codeFromSearch('?code=42117')).toBeNull();
    expect(renderToStaticMarkup(React.createElement(LessonLayer, { world: null, search: '' }))).toBe('');
    const html = renderToStaticMarkup(React.createElement(LessonLayer, { world: null, search: '?code=123456' }));
    expect(html).toContain(LESSON_STRINGS_KO.code.title);
    const all = JSON.stringify(LESSON_STRINGS_KO);
    for (const bad of FORBIDDEN_PLAYER_UI_PATTERNS) expect(all).not.toContain(bad);
    expect(all).not.toMatch(/원|결제|구매|가격/);
  });
});
