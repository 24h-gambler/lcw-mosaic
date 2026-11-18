import { afterEach, describe, expect, it, vi } from 'vitest';
import { FIRST_LESSON_PLAN } from '@lcw/content';
import { PlatformDO, type LcwEnv } from '../../../edge/src/platform.js';
import { fakeDurableStorage } from '../../../edge/src/__tests__/fake-do.js';
import { createStudentLessonApi, type KeyValue } from '../lesson/api.js';
import { LESSON_ADVANCE_POLL_MS, LessonController, type LessonTimers } from '../lesson/controller.js';
import { LESSON_STAGE_EVENT } from '../world/events.js';

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
async function setup(opts: { holdState?: { gate: Promise<void> | null } } = {}) {
  const clock = { now: Date.parse('2026-11-16T15:00:00+09:00') };
  vi.spyOn(Date, 'now').mockImplementation(() => clock.now);
  const p = new PlatformDO({ storage: fakeDurableStorage() }, { PLATFORM: undefined as never, LCW_OPERATOR_TOKEN: TOKEN } as LcwEnv);
  const fetch = async (input: string, init?: RequestInit) => {
    const res = await p.fetch(new Request(`https://x${input}`, init));
    // a state poll whose answer is held back (the poll stays in flight while an answer comes in)
    if (input.includes('/v1/lesson/state') && opts.holdState?.gate) await opts.holdState.gate;
    return res;
  };
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

  it('a stage move that comes in while a poll is in flight still shows within LESSON_ADVANCE_POLL_MS', async () => {
    const hold: { gate: Promise<void> | null } = { gate: null };
    const { ctl, timers } = await setup({ holdState: hold });
    await ctl.submit({ target_text: STAGES[0]!.targets[0]!.text, transcript: 'my name is oreo', chosen_stars: 1, dur_ms: 1500 });
    let release!: () => void;
    hold.gate = new Promise<void>((r) => (release = r));
    const inFlight = ctl.poll();
    await ctl.submit({ target_text: STAGES[0]!.targets[1]!.text, transcript: STAGES[0]!.targets[1]!.text, chosen_stars: 1, dur_ms: 1500 });
    hold.gate = null;
    release();
    await inFlight;
    await timers.run(LESSON_ADVANCE_POLL_MS);
    expect(ctl.state.stageId).toBe(STAGES[1]!.id);
  });

  it("the dialog's follow-ups done moves the stage on (one follow-up answered) and the next stage shows at once", async () => {
    const { ctl, timers, lessonId, admin } = await setup();
    // the child answered the opening line and one follow-up (free talk: no sentence on screen)
    await ctl.submit({ target_text: '', transcript: 'my name is oreo and i like dogs', chosen_stars: 1, dur_ms: 1500 });
    await ctl.submit({ target_text: '', transcript: 'after school i play soccer with my dad', chosen_stars: 1, dur_ms: 1500 });
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

  it('a stage move tells the window (the mic check card closes on it); the first state of the lesson does not', async () => {
    const g = globalThis as unknown as { window?: EventTarget };
    const had = g.window;
    const win = new EventTarget();
    const got: string[] = [];
    win.addEventListener(LESSON_STAGE_EVENT, (e) => got.push((e as CustomEvent<{ stageId: string }>).detail.stageId));
    g.window = win;
    try {
      const { ctl, timers, lessonId, admin } = await setup();
      expect(ctl.state.stageId).toBe(STAGES[0]!.id);
      expect(got).toEqual([]);
      // the server's auto move (passes) and the teacher's move both reach the window once
      await ctl.submit({ target_text: STAGES[0]!.targets[0]!.text, transcript: 'my name is oreo', chosen_stars: 1, dur_ms: 1500 });
      await ctl.submit({ target_text: STAGES[0]!.targets[1]!.text, transcript: STAGES[0]!.targets[1]!.text, chosen_stars: 1, dur_ms: 1500 });
      await timers.run(LESSON_ADVANCE_POLL_MS);
      expect(got).toEqual([STAGES[1]!.id]);
      await admin('POST', `/v1/admin/lessons/${lessonId}/stage`, { stage_id: STAGES[3]!.id, targets: STAGES[3]!.targets.slice(0, 3).map((t) => t.text) });
      await timers.run(4000);
      expect(got).toEqual([STAGES[1]!.id, STAGES[3]!.id]);
      // polls with no move send nothing
      await timers.run(10_000);
      expect(got).toHaveLength(2);
    } finally {
      g.window = had;
    }
  });
});
