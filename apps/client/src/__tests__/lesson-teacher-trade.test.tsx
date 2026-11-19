import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TEACHER_STOCK, tradeOffers } from '@lcw/content';
import { PlatformDO, type LcwEnv } from '../../../edge/src/platform.js';
import { fakeDurableStorage } from '../../../edge/src/__tests__/fake-do.js';
import { createStudentLessonApi, type KeyValue } from '../lesson/api.js';
import { LESSON_POLL_MS, LessonController, initialLessonView, type LessonTimers, type LessonWorld } from '../lesson/controller.js';
import { LessonSidePanel, SIDE_FOLD_HEIGHT_PX, TradeWindow, sideStartsFolded, teacherLatest, teacherNpcRef, tradeOfferCards } from '../lesson/LessonSide.js';
import { LESSON_STRINGS } from '../lesson/strings.js';

/**
 * R325 (Dan 11-19 lesson): no teleport on a stage change, the lesson's info on a side panel, the teacher's gifts and
 * trades reach the child's world once. docs/18 §11.
 */

const TOKEN = 'op-token-0123456789abcdef';
const op = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };

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
      clock.now = Math.max(clock.now, until);
    }
  };
  return t;
}

async function setup() {
  const clock = { now: Date.parse('2026-11-19T17:30:00+09:00') };
  vi.spyOn(Date, 'now').mockImplementation(() => clock.now);
  const p = new PlatformDO({ storage: fakeDurableStorage() }, { PLATFORM: undefined as never, LCW_OPERATOR_TOKEN: TOKEN } as LcwEnv);
  const fetch = (input: string, init?: RequestInit) => p.fetch(new Request(`https://x${input}`, init));
  const admin = async (method: string, path: string, body?: unknown) =>
    (await (await p.fetch(new Request(`https://x${path}`, { method, headers: op, body: body === undefined ? undefined : JSON.stringify(body) }))).json()) as any;
  await admin('POST', '/v1/admin/players', { family_id: 'fam-1', guardian_id: 'g-1', player_id: 'kid-1', nickname: 'Kid', level: 'L1' });
  const s = (await admin('POST', '/v1/admin/lessons/start', { player_id: 'kid-1' })) as { lesson_id: string; join_code: string };
  const calls: string[] = [];
  const world: LessonWorld = {
    placeSceneNpc: (id) => void calls.push(`npc-to:${id}`),
    giveItem: (k) => void calls.push(`give:${k}`),
    takeItem: (k) => (calls.push(`take:${k}`), true),
    whereNow: () => 'plaza',
    npcSay: (n, t) => void calls.push(`say:${n}:${t}`),
    setGoal: () => undefined,
    celebrate: () => undefined
  };
  const timers = fakeTimers(clock);
  const ctl = new LessonController({ api: createStudentLessonApi({ fetch }), world, store: memStore(), timers });
  await ctl.start(s.join_code);
  return { ctl, calls, timers, admin, lessonId: s.lesson_id, clock };
}

describe('the lesson walks with the child (R325)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('a stage change only places the stage NPC: the world API has no teleport left in the lesson', async () => {
    const { ctl, calls, timers, admin, lessonId } = await setup();
    await admin('POST', `/v1/admin/lessons/${lessonId}/stage`, { stage_id: 'cafe_order', targets: ['Can I have a warm honey tea?'] });
    await timers.run(LESSON_POLL_MS);
    expect(ctl.state.sceneId).toBe('honey_cafe');
    expect(calls).toContain('npc-to:honey_cafe');
    expect(calls.some((c) => c.startsWith('goto') || c.startsWith('scene:'))).toBe(false);
    ctl.stop();
  });

  it('the teacher speaks as the teacher and hands over a thing: the bubble and the hand, once', async () => {
    const { ctl, calls, timers, admin, lessonId } = await setup();
    await admin('POST', `/v1/admin/lessons/${lessonId}/npc-say`, { npc_id: 'teacher', text: 'Follow me!' });
    await admin('POST', `/v1/admin/lessons/${lessonId}/give`, { item_key: 'lantern', client_id: 'c1763541000000-0001' });
    await timers.run(LESSON_POLL_MS);
    await timers.run(LESSON_POLL_MS * 3);
    expect(calls).toContain('say:teacher:Follow me!');
    expect(calls.filter((c) => c === 'give:lantern')).toHaveLength(1);
    expect(teacherLatest(ctl.state)?.text).toMatch(/lantern/);
    ctl.stop();
  });

  it('a trade: the dialog answer goes to the trade route; the got thing comes back as the dialog itemKey, the given one leaves the hotbar', async () => {
    const { ctl, calls, admin, lessonId } = await setup();
    await admin('POST', `/v1/admin/lessons/${lessonId}/give`, { item_key: 'rope', client_id: 'c1763541000000-0002' });
    const info = await ctl.tradeInfo();
    expect(info.stock).toHaveLength(TEACHER_STOCK.length);
    const rope = info.owned.find((o) => o.item_key === 'rope')!;
    const offer = tradeOffers({ getKey: 'boots', giveKey: 'rope', level: 'L1' })[1]!;
    const r = await ctl.trade({ target_text: offer.text, transcript: offer.text, chosen_stars: 2 }, { getKey: 'boots', giveItemId: rope.item_id });
    expect(r.result).toMatchObject({ pass: true, itemKey: 'boots' });
    expect(r.trade).toMatchObject({ done: true, give_key: 'rope' });
    expect(calls).toContain('take:rope');
    const bad = await ctl.trade({ target_text: offer.text, transcript: 'banana' }, { getKey: 'boots', giveItemId: null }).catch((e) => e);
    // the no-give offer list differs: this sentence is not one of that trade's
    expect(String(bad)).toMatch(/not_a_trade_sentence/);
    ctl.stop();
  });

  it("R326 ⑫: a trade in the child's own words (no sentence picked) goes through when the words carry a trade sentence", async () => {
    const { ctl, calls } = await setup();
    const own = await ctl.trade({ target_text: '', transcript: 'can i have the lantern please', chosen_stars: 1 }, { getKey: 'lantern', giveItemId: null });
    expect(own.result).toMatchObject({ pass: true, itemKey: 'lantern' });
    expect(own.trade).toMatchObject({ done: true, get_key: 'lantern' });
    // words that ask for nothing: no trade, the teacher says how (not an error)
    const none = await ctl.trade({ target_text: '', transcript: 'i like dogs', chosen_stars: 1 }, { getKey: 'map', giveItemId: null });
    expect(none.result.pass).toBe(false);
    expect(none.trade.done).toBe(false);
    expect(calls.filter((c) => c === 'take:map')).toHaveLength(0);
    ctl.stop();
  });

  it('R326 ④: skips reach the console (follow-up skipped without a try, a window closed with nothing said)', async () => {
    const { ctl, admin, lessonId } = await setup();
    await ctl.skip({ kind: 'follow_up', question: 'What did you do?', tried: false });
    await ctl.skip({ kind: 'close', question: '', tried: false });
    const f = await admin('GET', `/v1/admin/lessons/${lessonId}/feed`);
    expect(f.skips).toMatchObject({ total: 2, untried: 2 });
    expect(f.skips.recent.map((r: { kind: string }) => r.kind).sort()).toEqual(['close', 'follow_up']);
    ctl.stop();
  });
});

describe('the side panel and the trade window (R325)', () => {
  const npc = { id: 'cafe_owner', ctx: 'cafe' as const, nameEn: 'Hannah', nameKo: '해나' };
  const view = { ...initialLessonView(), phase: 'live' as const, stageId: 'cafe_order', npcId: 'cafe_owner', goalEn: 'Order a drink', goalKo: '음료를 주문해요', offers: [{ stars: 2 as const, text: 'Can I have a warm honey tea?', hintTags: [] }] };

  it('starts folded on a phone on its side (844×390), open on a taller screen', () => {
    expect(sideStartsFolded(390)).toBe(true);
    expect(sideStartsFolded(SIDE_FOLD_HEIGHT_PX + 1)).toBe(false);
  });

  it('says where to go and how far, the sentences, and has talk and trade; never covers the bottom middle', () => {
    vi.stubGlobal('innerHeight', 800);
    const html = renderToStaticMarkup(
      <LessonSidePanel view={view} npc={npc} distance={() => 23.4} onTalk={() => undefined} onTrade={() => undefined} status={null} windowOpen={false} />
    );
    vi.unstubAllGlobals();
    expect(html).toContain('data-testid="lesson-side"');
    expect(html).toContain(LESSON_STRINGS.side.goTo(npc));
    expect(html).toContain(LESSON_STRINGS.side.far(23));
    expect(html).toContain('Can I have a warm honey tea?');
    // R326 ⑫: a mission list (the stage goal as a mission, talk to anyone, trade), the sentence only as an idea
    expect(html).toContain('data-testid="lesson-missions"');
    expect(html).toContain(LESSON_STRINGS.side.ideas);
    expect(html).toContain(LESSON_STRINGS.side.anyone);
    expect(html).toContain('data-testid="lesson-reopen"');
    expect(html).toContain('data-testid="lesson-trade-open"');
    // pinned right, under the HUD's right column; nothing at the bottom
    expect(html).toMatch(/position:fixed;top:calc\(max\(var\(--lcw-hud-right-b, 92px\), var\(--lcw-hud-top-b, 0px\)\) \+ 8px\);right:max\(var\(--lcw-hud-talk-w, 12px\), 92px\)/);
    expect(html).not.toMatch(/bottom:/);
  });

  it('folds away while a talk or trade window is open', () => {
    const html = renderToStaticMarkup(<LessonSidePanel view={view} npc={npc} distance={() => null} onTalk={() => undefined} onTrade={() => undefined} status={null} windowOpen />);
    expect(html).toBe('');
  });

  it('the trade window: the teacher as the dialog NPC, the trade sentences as offer cards', () => {
    expect(teacherNpcRef('Kim')).toMatchObject({ id: 'teacher', nameEn: 'Kim' });
    expect(teacherNpcRef(null).nameEn).toBe('Teacher');
    expect(tradeOfferCards(tradeOffers({ getKey: 'map' })).map((o) => o.stars)).toEqual([1, 2, 3]);
    const html = renderToStaticMarkup(
      <TradeWindow view={view} teacherName="Kim" load={() => new Promise(() => undefined)} trade={async () => ({ result: { pass: false, stars: 0, feedbackKo: '' }, trade: { done: false, get_key: null, give_key: null } })} onClose={() => undefined} />
    );
    expect(html).toContain('data-testid="lesson-trade"');
    expect(html).toContain(LESSON_STRINGS.trade.loading);
  });
});
