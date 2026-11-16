import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FIRST_LESSON_PLAN } from '@lcw/content';
import { PlatformDO, type LcwEnv } from '../../../edge/src/platform.js';
import { fakeDurableStorage } from '../../../edge/src/__tests__/fake-do.js';
import { createStudentLessonApi, readLessonMicStatus, type KeyValue } from '../lesson/api.js';
import { LessonController, type LessonTimers, type LessonWorld } from '../lesson/controller.js';
import { TeacherPanel, createPanelApi, isPanelShortcut, stageContext } from '../lesson/TeacherPanel.js';

const TOKEN = 'op-token-0123456789abcdef';
const op = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };

function memStore(): KeyValue {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}
function fakeTimers(clock: { now: number }) {
  const queue: Array<{ at: number; fn: () => void | Promise<void>; id: number }> = [];
  let n = 0;
  const t: LessonTimers & { run(ms: number): Promise<void> } = {
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
    }
  };
  return t;
}
function server(clock: { now: number }) {
  vi.spyOn(Date, 'now').mockImplementation(() => clock.now);
  const p = new PlatformDO({ storage: fakeDurableStorage() }, { PLATFORM: undefined as never, LCW_OPERATOR_TOKEN: TOKEN } as LcwEnv);
  const fetch = (input: string, init?: RequestInit) => p.fetch(new Request(`https://x${input}`, init));
  const admin = async (method: string, path: string, body?: unknown) =>
    (await (await p.fetch(new Request(`https://x${path}`, { method, headers: op, body: body === undefined ? undefined : JSON.stringify(body) }))).json()) as any;
  return { p, fetch, admin };
}
function world() {
  const teacher: Array<{ present: boolean; name: string | null } | null> = [];
  const w: LessonWorld = {
    goToScene: async () => undefined,
    npcSay: () => undefined,
    setGoal: () => undefined,
    celebrate: () => undefined,
    setTeacher: (t) => void teacher.push(t)
  };
  return { w, teacher };
}

describe('teacher presence in the child world (Dan 11-16: the child knows whether the teacher is there)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('name tag while the console beats; "혼자 놀기" 45 s after it stops; back on the next beat', async () => {
    const clock = { now: Date.parse('2026-11-16T15:00:00+09:00') };
    const { fetch, admin } = server(clock);
    await admin('POST', '/v1/admin/players', { family_id: 'f', guardian_id: 'g', player_id: 'stu-oreo', nickname: 'Oreo', level: 'L1' });
    const s = await admin('POST', '/v1/admin/lessons/start', { player_id: 'stu-oreo', presence: true });
    const timers = fakeTimers(clock);
    const { w, teacher } = world();
    const ctl = new LessonController({ api: createStudentLessonApi({ fetch }), world: w, store: memStore(), timers });
    await ctl.start(s.join_code);
    expect(teacher.at(-1)).toEqual({ present: true, name: '선생님' });
    expect(ctl.state.teacher.present).toBe(true);
    expect(ctl.state.lessonId).toBe(s.lesson_id);
    expect(ctl.state.planId).toBe('first_lesson_v1');

    // No beat for 49 s: the first poll past the 45 s window (polls every 3 s) says alone.
    await timers.run(49_000);
    expect(ctl.state.teacher.present).toBe(false);
    expect(teacher.at(-1)).toEqual({ present: false, name: null });
    // Only changes reach the world (no tag flicker every poll).
    const n = teacher.length;
    await timers.run(9_000);
    expect(teacher.length).toBe(n);

    await admin('POST', `/v1/admin/lessons/${s.lesson_id}/presence`, { panel: 'open' });
    await timers.run(4_000);
    expect(ctl.state.teacher.present).toBe(true);
    expect(teacher.at(-1)).toEqual({ present: true, name: '선생님' });
    ctl.stop();
  });

  it('a lesson from an old console (no presence at start) keeps the teacher tag all along', async () => {
    const clock = { now: Date.parse('2026-11-16T15:00:00+09:00') };
    const { fetch, admin } = server(clock);
    await admin('POST', '/v1/admin/players', { family_id: 'f', guardian_id: 'g', player_id: 'stu-oreo', nickname: 'Oreo', level: 'L1' });
    const s = await admin('POST', '/v1/admin/lessons/start', { player_id: 'stu-oreo' });
    const timers = fakeTimers(clock);
    const { w } = world();
    const ctl = new LessonController({ api: createStudentLessonApi({ fetch }), world: w, store: memStore(), timers });
    await ctl.start(s.join_code);
    await timers.run(120_000);
    expect(ctl.state.teacher.present).toBe(true);
    ctl.stop();
  });

  it('mic check value: only the four known values are read', () => {
    const st = (v: string | null) => ({ getItem: () => v });
    expect(readLessonMicStatus(st('quiet'))).toBe('quiet');
    expect(readLessonMicStatus(st('skipped'))).toBe('skipped');
    expect(readLessonMicStatus(st('loud'))).toBeNull();
    expect(readLessonMicStatus(st(null))).toBeNull();
    expect(readLessonMicStatus(null)).toBeNull();
  });
});

describe('1PC teacher panel (TeacherPanel.tsx)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('locked (the state after load): only the small toggle is in the page, no script or answer text', () => {
    const stage = FIRST_LESSON_PLAN.stages[0]!;
    const html = renderToStaticMarkup(
      <TeacherPanel lessonId="les-1" planId={FIRST_LESSON_PLAN.id} stageId={stage.id} operatorToken="op" api={createPanelApi('', (async () => new Response('{}')) as never)} />
    );
    expect(html).toContain('teacher-panel-toggle');
    expect(html).not.toContain(stage.teacherScriptEn);
    for (const t of stage.targets) expect(html).not.toContain(t.text);
    expect(html).not.toContain('teacher-panel"');
  });

  it('2PC: the child device has no operator sign-in, so no teacher button at all (review #70 ②)', () => {
    const stage = FIRST_LESSON_PLAN.stages[0]!;
    const html = renderToStaticMarkup(
      <TeacherPanel lessonId="les-1" planId={FIRST_LESSON_PLAN.id} stageId={stage.id} operatorToken={null} api={createPanelApi('', (async () => new Response('{}')) as never)} />
    );
    expect(html).toBe('');
  });

  it('shortcut is Ctrl+Alt+T: Ctrl+Shift+T stays the browser reopen-closed-tab key (review #70)', () => {
    const k = (o: Partial<KeyboardEvent>) => ({ ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, code: 'KeyT', key: 't', ...o });
    expect(isPanelShortcut(k({ ctrlKey: true, altKey: true }))).toBe(true);
    expect(isPanelShortcut(k({ ctrlKey: true, altKey: true, key: 'ㅅ' }))).toBe(true); // Korean layout, same key
    expect(isPanelShortcut(k({ ctrlKey: true, shiftKey: true, key: 'T' }))).toBe(false);
    expect(isPanelShortcut(k({ ctrlKey: true }))).toBe(false);
    expect(isPanelShortcut(k({ ctrlKey: true, altKey: true, code: 'KeyR', key: 'r' }))).toBe(false);
  });

  it('stage context: the server plan first, next stage, last stage has none', () => {
    const plan = FIRST_LESSON_PLAN;
    const c = stageContext(plan.id, plan.stages[0]!.id)!;
    expect(c.index).toBe(0);
    expect(c.next?.id).toBe(plan.stages[1]!.id);
    expect(stageContext(plan.id, plan.stages.at(-1)!.id)!.next).toBeNull();
    expect(stageContext(null, plan.stages[0]!.id)?.stage.id).toBe(plan.stages[0]!.id);
    expect(stageContext(plan.id, 'nope')).toBeNull();
    expect(stageContext(plan.id, null)).toBeNull();
  });

  it('panel calls against the real server: lock number, beat open/closed, next stage, teacher leaves', async () => {
    const clock = { now: Date.parse('2026-11-16T15:00:00+09:00') };
    const { p, admin } = server(clock);
    await admin('POST', '/v1/admin/players', { family_id: 'f', guardian_id: 'g', player_id: 'stu-oreo', nickname: 'Oreo', level: 'L1' });
    const s = await admin('POST', '/v1/admin/lessons/start', { player_id: 'stu-oreo', presence: true });
    const api = createPanelApi('https://x', ((input: string, init?: RequestInit) => p.fetch(new Request(input, init))) as never);
    expect(await api.unlock(TOKEN, s.lesson_id, '1357')).toBe('no_pin');
    await admin('POST', `/v1/admin/lessons/${s.lesson_id}/panel-pin`, { pin: '1357' });
    expect(await api.unlock(TOKEN, s.lesson_id, '0000')).toBe('wrong_pin');
    expect(await api.unlock('not-the-key-but-long', s.lesson_id, '1357')).toBe('error');
    expect(await api.unlock(TOKEN, s.lesson_id, '1357')).toBe('ok');
    expect(await api.beat(TOKEN, s.lesson_id, 'closed')).toBe(true);
    expect((await admin('GET', `/v1/admin/lessons/${s.lesson_id}/feed`)).teacher).toMatchObject({ present: true, panel: 'closed' });
    expect(await api.pushStage(TOKEN, s.lesson_id, FIRST_LESSON_PLAN.stages[1]!)).toBe(true);
    expect((await admin('GET', `/v1/admin/lessons/${s.lesson_id}/feed`)).lesson.stage_id).toBe(FIRST_LESSON_PLAN.stages[1]!.id);
    expect(await api.leave(TOKEN, s.lesson_id)).toBe(true);
    expect((await admin('GET', `/v1/admin/lessons/${s.lesson_id}/feed`)).teacher.present).toBe(false);
  });
});
