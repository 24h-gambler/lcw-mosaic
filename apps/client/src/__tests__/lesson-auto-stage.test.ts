import { afterEach, describe, expect, it, vi } from 'vitest';
import { FIRST_LESSON_PLAN } from '@lcw/content';
import { PlatformDO, type LcwEnv } from '../../../edge/src/platform.js';
import { fakeDurableStorage } from '../../../edge/src/__tests__/fake-do.js';
import { createStudentLessonApi, type KeyValue } from '../lesson/api.js';
import { LESSON_ADVANCE_POLL_MS, LessonController, type LessonTimers } from '../lesson/controller.js';

/**
 * The child's screen follows the server's auto-advance at once (docs/18 §9, R2627 "진행 자체가 안되고 계속 있는점"):
 * the answer that finishes a stage brings the next stage in LESSON_ADVANCE_POLL_MS, and the dialog's "follow-ups done"
 * moves it too. Against the real lesson server (PlatformDO).
 */
const TOKEN = 'op-token-0123456789abcdef';
const op = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
const STAGES = FIRST_LESSON_PLAN.stages;

function memStore(): KeyValue {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}
function fakeTimers(clock: { now: number }) {
  const queue: Array<{ at: number; fn: () => void; id: number }> = [];
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
async function setup() {
  const clock = { now: Date.parse('2026-11-16T15:00:00+09:00') };
  vi.spyOn(Date, 'now').mockImplementation(() => clock.now);
  const p = new PlatformDO({ storage: fakeDurableStorage() }, { PLATFORM: undefined as never, LCW_OPERATOR_TOKEN: TOKEN } as LcwEnv);
  const fetch = (input: string, init?: RequestInit) => p.fetch(new Request(`https://x${input}`, init));
  const admin = async (method: string, path: string, body?: unknown) =>
    (await (await p.fetch(new Request(`https://x${path}`, { method, headers: op, body: body === undefined ? undefined : JSON.stringify(body) }))).json()) as any;
  await admin('POST', '/v1/admin/players', { family_id: 'fam-1', guardian_id: 'g-1', player_id: 'kid-1', nickname: 'Oreo', level: 'L1' });
  const s = await admin('POST', '/v1/admin/lessons/start', { player_id: 'kid-1' });
  const timers = fakeTimers(clock);
  const scenes: string[] = [];
  const ctl = new LessonController({
    api: createStudentLessonApi({ fetch }),
    world: { goToScene: async (id) => void scenes.push(id), npcSay: () => undefined, setGoal: () => undefined, celebrate: () => undefined },
    store: memStore(),
    timers
  });
  await ctl.start(s.join_code);
  return { ctl, timers, scenes, admin, lessonId: s.lesson_id as string };
}

describe('the child screen follows auto-advance (docs/18 §9)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('the answer that finishes the stage shows the next stage within LESSON_ADVANCE_POLL_MS; the follow-ups ride along', async () => {
    const { ctl, timers, scenes } = await setup();
    expect(ctl.state.stageId).toBe(STAGES[0]!.id);
    expect(ctl.state.followUpsEn).toEqual(STAGES[0]!.followUpsEn);
    await ctl.submit({ target_text: STAGES[0]!.targets[0]!.text, transcript: 'my name is oreo', chosen_stars: 1, dur_ms: 1500 });
    await ctl.submit({ target_text: STAGES[0]!.targets[1]!.text, transcript: STAGES[0]!.targets[1]!.text, chosen_stars: 1, dur_ms: 1500 });
    await timers.run(LESSON_ADVANCE_POLL_MS);
    expect(ctl.state).toMatchObject({ stageId: STAGES[1]!.id, sceneId: STAGES[1]!.sceneId, npcLineEn: STAGES[1]!.teacherScriptEn });
    expect(ctl.state.followUpsEn).toEqual(STAGES[1]!.followUpsEn);
    expect(scenes.at(-1)).toBe(STAGES[1]!.sceneId);
  });

  it("the dialog's follow-ups done moves the stage on and the next stage shows at once", async () => {
    const { ctl, timers, lessonId, admin } = await setup();
    await ctl.stageDone();
    await timers.run(1);
    expect(ctl.state.stageId).toBe(STAGES[1]!.id);
    const feed = await admin('GET', `/v1/admin/lessons/${lessonId}/feed`);
    expect(feed.stage_log.at(-1)).toMatchObject({ stage_id: STAGES[1]!.id, source: 'auto:followups' });
    // a late "done" for the stage that is over changes nothing
    await ctl.stageDone(STAGES[0]!.id);
    await timers.run(1);
    expect(ctl.state.stageId).toBe(STAGES[1]!.id);
  });
});
