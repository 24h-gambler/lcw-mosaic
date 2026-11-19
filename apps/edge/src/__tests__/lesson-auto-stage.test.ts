import { afterEach, describe, expect, it, vi } from 'vitest';
import { FIRST_LESSON_PLAN } from '@lcw/content';
import { PlatformDO, type LcwEnv } from '../platform.js';
import { LESSON_AUTO_ADVANCE_PASSES, LESSON_CHILD_GAP_MS } from '../lesson-mode.js';
import { fakeDurableStorage } from './fake-do.js';

/**
 * Stages move on by themselves (Dan 11-16 R2625/R2627: "별도로 조종 안해도 됩니다", "진행 자체가 안되고 계속 있는점" —
 * the Oreo lesson's stage log had warmup_anchor only for 25 minutes). docs/18 §9.
 */

const TOKEN = 'op-token-0123456789abcdef';
const op = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
const T0 = Date.parse('2026-11-16T07:38:00Z');
let now = T0;
afterEach(() => vi.restoreAllMocks());

function platform() {
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  return new PlatformDO({ storage: fakeDurableStorage() }, { PLATFORM: undefined as never, LCW_OPERATOR_TOKEN: TOKEN } as LcwEnv);
}
async function call(p: PlatformDO, method: string, path: string, body?: unknown, headers: Record<string, string> = op) {
  const res = await p.fetch(new Request(`https://x${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
  return { status: res.status, body: (await res.json()) as any };
}
async function lesson(p: PlatformDO) {
  await call(p, 'POST', '/v1/admin/players', { family_id: 'fam-1', guardian_id: 'g-1', player_id: 'kid-1', nickname: 'Oreo', birth_year: 2016, level: 'L1' });
  const s = await call(p, 'POST', '/v1/admin/lessons/start', { player_id: 'kid-1', presence: true });
  const j = await call(p, 'POST', '/v1/join', { code: s.body.join_code }, { 'content-type': 'application/json' });
  return { lessonId: s.body.lesson_id as string, st: { authorization: `Bearer ${j.body.student_token}`, 'content-type': 'application/json' } };
}
const STAGES = FIRST_LESSON_PLAN.stages;
const say = (p: PlatformDO, st: Record<string, string>, target: string, transcript = target) =>
  call(p, 'POST', '/v1/lesson/utterance', { target_text: target, transcript, chosen_stars: 1, dur_ms: 2000 }, st);
const state = (p: PlatformDO, st: Record<string, string>) => call(p, 'GET', '/v1/lesson/state', undefined, st);
/** The child's screen stays for `ms`, polling every 3 s like the client (LESSON_POLL_MS); returns the last answer. */
async function stay(p: PlatformDO, st: Record<string, string>, ms: number) {
  const until = now + ms;
  let last = await state(p, st);
  while (now + 3000 <= until) {
    now += 3000;
    last = await state(p, st);
  }
  now = until;
  return last;
}
const log = (p: PlatformDO, id: string) => call(p, 'GET', `/v1/admin/lessons/${id}/feed`).then((r) => r.body.stage_log as Array<{ stage_id: string; source: string | null }>);

describe('stages move on by themselves (R2625, R2627)', () => {
  it(`passing ${LESSON_AUTO_ADVANCE_PASSES} different sentences moves the stage on; the answer says so and the child's poll shows the next stage`, async () => {
    now = T0;
    const p = platform();
    const { lessonId, st } = await lesson(p);
    // the state carries the stage NPC's follow-up questions for the dialog (talk lane followUps)
    const s0 = await state(p, st);
    expect(s0.body).toMatchObject({ stage_id: STAGES[0]!.id, follow_ups_en: STAGES[0]!.followUpsEn, auto_advanced: null });
    now += 60_000;
    const a = await say(p, st, STAGES[0]!.targets[0]!.text, 'my name is oreo');
    expect(a.body.pass).toBe(true);
    expect(a.body.auto_advanced).toBeUndefined();
    // the same sentence again is not a second sentence
    now += 30_000;
    expect((await say(p, st, STAGES[0]!.targets[0]!.text, 'my name is oreo')).body.auto_advanced).toBeUndefined();
    now += 30_000;
    const b = await say(p, st, STAGES[0]!.targets[1]!.text);
    expect(b.body.pass).toBe(true);
    expect(b.body.auto_advanced).toEqual({ from: STAGES[0]!.id, to: STAGES[1]!.id, why: 'passes' });
    const s1 = await state(p, st);
    expect(s1.body).toMatchObject({ stage_id: STAGES[1]!.id, scene_id: STAGES[1]!.sceneId, npc_line_en: STAGES[1]!.teacherScriptEn });
    expect(s1.body.offers.map((o: any) => o.text)).toEqual(STAGES[1]!.targets.map((t) => t.text));
    // the console sees who moved it
    expect((await log(p, lessonId)).map((x) => [x.stage_id, x.source])).toEqual([
      [STAGES[0]!.id, null],
      [STAGES[1]!.id, 'auto:passes']
    ]);
  });

  it("the teacher's own sentence on the same stage (Dan 11-19) is not swept off by passes from before it; passing it moves on", async () => {
    now = T0;
    const p = platform();
    const { lessonId, st } = await lesson(p);
    await state(p, st);
    now += 60_000;
    expect((await say(p, st, STAGES[0]!.targets[0]!.text, 'my name is oreo')).body.pass).toBe(true);
    // the teacher puts one sentence of their own on the running stage (console 「학생 화면에 내 문장 띄우기」)
    now += 10_000;
    const own = 'I like cookies.';
    expect((await call(p, 'POST', `/v1/admin/lessons/${lessonId}/stage`, { stage_id: STAGES[0]!.id, targets: [own] })).status).toBe(200);
    // the child's next polls keep it on screen: the earlier pass does not count against the one new sentence
    now += 1_200;
    const s1 = await state(p, st);
    expect(s1.body.stage_id).toBe(STAGES[0]!.id);
    expect(s1.body.auto_advanced).toBeNull();
    expect(s1.body.offers.map((o: any) => o.text)).toEqual([own]);
    now += 1_200;
    expect((await state(p, st)).body.stage_id).toBe(STAGES[0]!.id);
    // saying the teacher's sentence is the pass that moves on
    now += 20_000;
    const r = await say(p, st, own);
    expect(r.body.pass).toBe(true);
    expect(r.body.auto_advanced).toEqual({ from: STAGES[0]!.id, to: STAGES[1]!.id, why: 'passes' });
  });

  it("the console's own sentence changes the running stage only: a stage the server moved on answers 409 stage_moved and stays", async () => {
    now = T0;
    const p = platform();
    const { lessonId, st } = await lesson(p);
    await state(p, st);
    // the server moved to stage 2 while the console still showed stage 1
    now += 60_000;
    await say(p, st, STAGES[0]!.targets[0]!.text);
    now += 30_000;
    expect((await say(p, st, STAGES[0]!.targets[1]!.text)).body.auto_advanced?.to).toBe(STAGES[1]!.id);
    const late = await call(p, 'POST', `/v1/admin/lessons/${lessonId}/stage`, { stage_id: STAGES[0]!.id, targets: ['Hello, teacher.'], only_if_stage: true });
    expect(late.status).toBe(409);
    expect(late.body).toEqual({ error: 'stage_moved', stage_id: STAGES[1]!.id });
    const s = await state(p, st);
    expect(s.body.stage_id).toBe(STAGES[1]!.id);
    expect(s.body.offers.map((o: any) => o.text)).toEqual(STAGES[1]!.targets.map((t) => t.text));
    // on the running stage it goes through
    const ok = await call(p, 'POST', `/v1/admin/lessons/${lessonId}/stage`, { stage_id: STAGES[1]!.id, targets: ['Two cookies, please.'], only_if_stage: true });
    expect(ok.status).toBe(200);
    expect((await state(p, st)).body.offers.map((o: any) => o.text)).toEqual(['Two cookies, please.']);
    // the stage button (no flag) still moves the stage as before
    expect((await call(p, 'POST', `/v1/admin/lessons/${lessonId}/stage`, { stage_id: STAGES[2]!.id, targets: STAGES[2]!.targets.map((t) => t.text) })).status).toBe(200);
  });

  it('free talk with no sentence on screen does not count as a pass (a free stage moves on by follow-ups or time)', async () => {
    now = T0;
    const p = platform();
    const { st } = await lesson(p);
    expect(STAGES[0]!.mode).toBe('free');
    for (const t of ['i like playing soccer with my dad', 'my favourite food is pizza and noodles', 'i have a little sister at home']) {
      now += 30_000;
      const r = await call(p, 'POST', '/v1/lesson/utterance', { transcript: t, chosen_stars: 1, dur_ms: 3000 }, st);
      expect(r.body.auto_advanced).toBeUndefined();
    }
    expect((await state(p, st)).body.stage_id).toBe(STAGES[0]!.id);
  });

  it("the stage's planned minutes of the child's own time over: the child's poll moves it on", async () => {
    now = T0;
    const p = platform();
    const { lessonId, st } = await lesson(p);
    const mins = STAGES[0]!.minutes * 60_000;
    // R326: the minutes count only for a child who said something in the stage
    await state(p, st);
    await call(p, 'POST', '/v1/lesson/utterance', { transcript: 'hello', chosen_stars: 1, dur_ms: 1000 }, st);
    expect((await stay(p, st, mins - 3000)).body.stage_id).toBe(STAGES[0]!.id);
    const s = await stay(p, st, 3000);
    expect(s.body).toMatchObject({ stage_id: STAGES[1]!.id, auto_advanced: { from: STAGES[0]!.id, to: STAGES[1]!.id, why: 'time' } });
    // its clock starts again in the new stage
    expect((await stay(p, st, 60_000)).body).toMatchObject({ stage_id: STAGES[1]!.id, auto_advanced: null });
    expect((await log(p, lessonId)).at(-1)).toMatchObject({ stage_id: STAGES[1]!.id, source: 'auto:time' });
  });

  it('R326: a child who says nothing and only skips is not moved on by the minutes; the console sees quiet and the skips', async () => {
    now = T0;
    const p = platform();
    const { lessonId, st } = await lesson(p);
    const mins = STAGES[0]!.minutes * 60_000;
    for (let i = 0; i < 3; i++) {
      const k = await call(p, 'POST', '/v1/lesson/skip', { client_id: `skip-0000-${i}`, stage_id: STAGES[0]!.id, kind: 'follow_up', question: 'What did you do?', tried: false }, st);
      expect(k.body).toMatchObject({ ok: true, skips: i + 1 });
    }
    // the same note again is one note
    expect((await call(p, 'POST', '/v1/lesson/skip', { client_id: 'skip-0000-0', stage_id: STAGES[0]!.id, kind: 'follow_up', tried: false }, st)).body.skips).toBe(3);
    expect((await stay(p, st, mins + 60_000)).body.stage_id).toBe(STAGES[0]!.id);
    const f = (await call(p, 'GET', `/v1/admin/lessons/${lessonId}/feed`)).body;
    expect(f.stage_hold).toMatchObject({ ready: null, quiet: true });
    expect(f.skips).toMatchObject({ total: 3, untried: 3, stage: 3, stage_untried: 3, heavy: true });
    expect(f.skips.recent[0]).toMatchObject({ kind: 'follow_up', tried: false, question: 'What did you do?' });
    // one word from the child and the minutes move it on; the teacher could anyway
    await call(p, 'POST', '/v1/lesson/utterance', { transcript: 'i went to the park', chosen_stars: 1, dur_ms: 2000 }, st);
    expect((await stay(p, st, 3000)).body.stage_id).toBe(STAGES[1]!.id);
    expect((await call(p, 'POST', '/v1/lesson/skip', { client_id: 'skip-0000-9', stage_id: 'x', kind: 'nope' }, st)).status).toBe(400);
    expect((await call(p, 'POST', '/v1/lesson/skip', { client_id: 'skip-0000-8', stage_id: 'x', kind: 'close' })).status).toBe(401);
  });

  it('R326 ⑫: in a guided stage the child own words that carry a stage sentence do the mission (that sentence passes)', async () => {
    now = T0;
    const p = platform();
    const { lessonId, st } = await lesson(p);
    const cafe = STAGES[1]!;
    expect(cafe.mode).not.toBe('free');
    await call(p, 'POST', `/v1/admin/lessons/${lessonId}/stage`, { stage_id: cafe.id, targets: cafe.targets.map((t) => t.text) });
    now += 5_000;
    const top = [...cafe.targets].sort((a, b) => a.stars - b.stars)[0]!;
    const r = await call(p, 'POST', '/v1/lesson/utterance', { transcript: top.text.replace(/[.?!]$/, ''), chosen_stars: 1, dur_ms: 2000 }, st);
    expect(r.body).toMatchObject({ pass: true, mission_text: expect.any(String) });
    expect(r.body.stars).toBeGreaterThan(0);
    // talk that carries none of them is free talk: no mission, still heard
    now += 5_000;
    const other = await call(p, 'POST', '/v1/lesson/utterance', { transcript: 'i like my dog very much', chosen_stars: 1, dur_ms: 2000 }, st);
    expect(other.body.mission_text).toBeUndefined();
  });

  it('a child who joins late does not skip the warm-up; time away does not count', async () => {
    now = T0;
    const p = platform();
    const { st } = await lesson(p);
    const mins = STAGES[0]!.minutes * 60_000;
    // the teacher started the lesson; the child's screen first comes long after the stage's minutes
    now = T0 + mins + 10 * 60_000;
    expect((await state(p, st)).body).toMatchObject({ stage_id: STAGES[0]!.id, auto_advanced: null });
    await call(p, 'POST', '/v1/lesson/utterance', { transcript: 'hello', chosen_stars: 1, dur_ms: 1000 }, st);
    expect((await stay(p, st, mins / 2)).body.stage_id).toBe(STAGES[0]!.id);
    // the child goes away for 20 minutes (a gap over LESSON_CHILD_GAP_MS): the gap is not stage time
    now += 20 * 60_000;
    expect(20 * 60_000).toBeGreaterThan(LESSON_CHILD_GAP_MS);
    expect((await state(p, st)).body.stage_id).toBe(STAGES[0]!.id);
    expect((await stay(p, st, mins / 2 - 6000)).body.stage_id).toBe(STAGES[0]!.id);
    expect((await stay(p, st, 9000)).body.stage_id).toBe(STAGES[1]!.id);
  });

  it('the dialog says the follow-ups are done: the stage moves on once the child answered one; a stale or wrong stage changes nothing', async () => {
    now = T0;
    const p = platform();
    const { st } = await lesson(p);
    const free = (t: string) => call(p, 'POST', '/v1/lesson/utterance', { transcript: t, chosen_stars: 1, dur_ms: 3000 }, st);
    expect((await call(p, 'POST', '/v1/lesson/stage-done', { stage_id: STAGES[2]!.id }, st)).body).toMatchObject({ auto_advanced: null, stage_id: STAGES[0]!.id });
    // the opening line answered, every follow-up skipped: the dialog ends with "done", the stage stays
    now += 30_000;
    expect((await free('my name is oreo and i like dogs')).body.pass).toBe(true);
    expect((await call(p, 'POST', '/v1/lesson/stage-done', { stage_id: STAGES[0]!.id }, st)).body).toMatchObject({ auto_advanced: null, stage_id: STAGES[0]!.id });
    // one follow-up answered too: "done" moves it on
    now += 30_000;
    expect((await free('after school i play soccer with my dad')).body.pass).toBe(true);
    const r = await call(p, 'POST', '/v1/lesson/stage-done', { stage_id: STAGES[0]!.id }, st);
    expect(r.body).toMatchObject({ ok: true, auto_advanced: { from: STAGES[0]!.id, to: STAGES[1]!.id, why: 'followups' }, stage_id: STAGES[1]!.id });
    // a resend of the same 'done' for the stage that is over does not skip the next one
    expect((await call(p, 'POST', '/v1/lesson/stage-done', { stage_id: STAGES[0]!.id }, st)).body.stage_id).toBe(STAGES[1]!.id);
    expect((await call(p, 'POST', '/v1/lesson/stage-done', { stage_id: STAGES[0]!.id })).status).toBe(401);
    expect((await call(p, 'POST', '/v1/lesson/stage-done', { stage: 'x' }, st)).status).toBe(400);
  });

  it("the teacher's move wins: passes before it do not count, the clock starts from the teacher's stage", async () => {
    now = T0;
    const p = platform();
    const { lessonId, st } = await lesson(p);
    await say(p, st, STAGES[0]!.targets[0]!.text, 'my name is oreo');
    // the teacher goes to the cafe; one pass there is not yet enough
    now += 60_000;
    const cafe = STAGES[1]!;
    await call(p, 'POST', `/v1/admin/lessons/${lessonId}/stage`, { stage_id: cafe.id, targets: cafe.targets.map((t) => t.text) });
    now += 60_000;
    expect((await say(p, st, cafe.targets[0]!.text)).body.auto_advanced).toBeUndefined();
    // the teacher takes the child back to the cafe start (same stage again): the count starts over
    now += 60_000;
    await call(p, 'POST', `/v1/admin/lessons/${lessonId}/stage`, { stage_id: STAGES[0]!.id, targets: STAGES[0]!.targets.map((t) => t.text) });
    await call(p, 'POST', `/v1/admin/lessons/${lessonId}/stage`, { stage_id: cafe.id, targets: cafe.targets.map((t) => t.text) });
    now += 60_000;
    expect((await say(p, st, cafe.targets[1]!.text)).body.auto_advanced).toBeUndefined();
    now += 60_000;
    expect((await say(p, st, cafe.targets[2]!.text)).body.auto_advanced).toMatchObject({ from: cafe.id, to: STAGES[2]!.id, why: 'passes' });
  });

  it('the last stage never moves on, and an ended lesson never moves', async () => {
    now = T0;
    const p = platform();
    const { lessonId, st } = await lesson(p);
    const last = STAGES.at(-1)!;
    await call(p, 'POST', `/v1/admin/lessons/${lessonId}/stage`, { stage_id: last.id, targets: last.targets.map((t) => t.text) });
    now += (last.minutes + 5) * 60_000;
    expect((await state(p, st)).body).toMatchObject({ stage_id: last.id, auto_advanced: null });
    expect((await call(p, 'POST', '/v1/lesson/stage-done', { stage_id: last.id }, st)).body.auto_advanced).toBeNull();
    await call(p, 'POST', `/v1/admin/lessons/${lessonId}/stage`, { stage_id: STAGES[0]!.id, targets: [] });
    await call(p, 'POST', `/v1/admin/lessons/${lessonId}/end`, { send: true });
    expect((await call(p, 'POST', '/v1/lesson/stage-done', { stage_id: STAGES[0]!.id }, st)).body?.auto_advanced ?? null).toBeNull();
  });

  it('a resent answer (same client id) does not move the stage a second time', async () => {
    now = T0;
    const p = platform();
    const { st } = await lesson(p);
    await say(p, st, STAGES[0]!.targets[0]!.text, 'my name is oreo');
    const body = { target_text: STAGES[0]!.targets[1]!.text, transcript: STAGES[0]!.targets[1]!.text, chosen_stars: 1, dur_ms: 2000, client_id: 'client-resend-1' };
    const first = await call(p, 'POST', '/v1/lesson/utterance', body, st);
    expect(first.body.auto_advanced).toMatchObject({ to: STAGES[1]!.id });
    const again = await call(p, 'POST', '/v1/lesson/utterance', body, st);
    expect(again.body.replayed).toBe(true);
    expect(again.body.auto_advanced).toBeUndefined();
    expect((await state(p, st)).body.stage_id).toBe(STAGES[1]!.id);
  });
});
