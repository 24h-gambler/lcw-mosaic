import { describe, expect, it } from 'vitest';
// The live-lesson watch tool (tools/lesson-watch.mjs): importing it touches no token and no disk.
import {
  LESSON_CARD_IMPORTANCE,
  LESSON_SETTLE,
  SUMMARY_IMPORTANCE,
  SUMMARY_SETTLE,
  TEST_CARD_IMPORTANCE,
  WATCH_LIMITS,
  checkLesson,
  adjustFromFeedback,
  emptyCardState,
  maskUrl,
  planTick,
  planWindowEnd,
  recordPosted,
  relayOnce,
  RELAY_MAX_IMPORTANCE,
  readAdjust,
  planSettle,
  scopeRef,
  settleImportance,
  tailVerdict
} from '../../../../tools/lesson-watch.mjs';

const now = Date.parse('2026-11-16T15:30:00+09:00');
const lesson = { lesson_id: 'les-1', player_id: 'kid-1', plan_id: 'first_lesson_v1', stage_id: 'cafe_order', started_at: now - 30 * 60_000, stage_started_at: now - 5 * 60_000 };
const feed = (sv: Record<string, unknown>, utterances = 4) => ({
  status: 200,
  body: { lesson: { stage_id: 'cafe_order' }, live: { utterances, passes: 3, stars_total: 6 }, student_view: sv }
});

describe('live-lesson watch (tools/lesson-watch.mjs)', () => {
  it('a healthy lesson: a summary row with counts only, no alert', () => {
    const { row, alerts } = checkLesson(
      lesson,
      feed({ connected: true, last_seen_at: now - 2_000, scene_id: 'honey_cafe', expected_scene_id: 'honey_cafe', ui: '3d', last_utterance: { at: now - 40_000, transcript: 'secret words', stars: 2 } }),
      now,
      1
    );
    expect(alerts).toEqual([]);
    expect(row).toMatchObject({ stage: 'cafe_order', utterances: 4, new_utterances: 3, last_answer_s: 40, student_connected: true, lesson_min: 30, stage_min: 5 });
    // nothing a child said goes into the log row
    expect(JSON.stringify(row)).not.toContain('secret words');
  });

  it('alerts when the student screen stops polling, sits in another scene, or no answer comes for 15 minutes', () => {
    const { alerts } = checkLesson(
      lesson,
      feed({ connected: false, last_seen_at: now - WATCH_LIMITS.studentGoneMs - 1_000, scene_id: 'plaza', expected_scene_id: 'honey_cafe', last_utterance: { at: now - WATCH_LIMITS.quietMs - 1_000 } }),
      now,
      undefined
    );
    expect(alerts.map((a) => a.key)).toEqual(['student_gone', 'scene', 'quiet']);
    // a lesson in its first minutes is not "quiet" yet
    const young = { ...lesson, started_at: now - 5 * 60_000 };
    expect(checkLesson(young, feed({ connected: true, last_seen_at: now }), now, undefined).alerts).toEqual([]);
  });

  it('lesson cards: one card per lesson rewritten in place, importance 1 (hub, the phone does not ring), nothing a child said', () => {
    const ctx = { base: 'https://lcw.example', out: 'Z:/tmp/lcw-watch' };
    const st = emptyCardState('20261116', 'https://spine.example');
    const at1 = new Date(now).toISOString();
    const { alerts } = checkLesson(
      lesson,
      feed({ connected: false, last_seen_at: now - WATCH_LIMITS.studentGoneMs - 1_000, last_utterance: { at: now - 1_000, transcript: 'secret words' } }),
      now,
      undefined
    );
    expect(alerts).toEqual([expect.objectContaining({ key: 'student_gone', lesson: 'les-1' })]);
    const t1 = planTick(st, [...alerts, { key: 'http', msg: '/v1/admin/health 응답 500' }], at1, ctx);
    expect(t1.map((x) => x.card.ref).sort()).toEqual(['outsourcing:lcw:watch:les-1:alerts', 'outsourcing:lcw:watch:site-20261116:alerts']);
    const card = t1.find((x) => x.card.ref === scopeRef('les-1'))!.card;
    expect(card).toMatchObject({ source: 'outsourcing', importance: LESSON_CARD_IMPORTANCE });
    expect(LESSON_CARD_IMPORTANCE).toBe(1);
    expect(TEST_CARD_IMPORTANCE).toBe(1);
    expect(card.title).toContain('지금 경보 1건');
    expect(card.actions[0]).toEqual({ type: 'open', url: 'https://lcw.example/director', label: '디렉터 콘솔 열기' });
    expect(card).not.toHaveProperty('priority');
    expect(JSON.stringify(t1)).not.toContain('secret words');
    // posted: the same alerts next tick change nothing, so nothing is posted again
    for (const x of t1) st.posted[x.card.ref] = { id: 'p_x', sig: x.sig, at: at1 };
    const at2 = new Date(now + 15 * 60_000).toISOString();
    expect(planTick(st, [...alerts, { key: 'http', msg: '/v1/admin/health 응답 500' }], at2, ctx)).toEqual([]);
    // a new kind in the same lesson rewrites the same card; the cleared site alert rewrites its card as cleared
    const t3 = planTick(st, [...alerts, { key: 'quiet', msg: 'les-1: 16분째 답 없음', lesson: 'les-1' }], at2, ctx);
    expect(t3.map((x) => x.card.ref).sort()).toEqual(['outsourcing:lcw:watch:les-1:alerts', 'outsourcing:lcw:watch:site-20261116:alerts']);
    expect(t3.find((x) => x.card.ref === scopeRef('les-1'))!.card.title).toContain('지금 경보 2건');
    expect(t3.find((x) => x.card.ref === scopeRef('site-20261116'))!.card.title).toContain('모두 풀림');
    // a card that failed to post (old signature kept) comes back next tick
    expect(planTick(st, [...alerts, { key: 'quiet', msg: 'les-1: 31분째 답 없음', lesson: 'les-1' }], at2, ctx).length).toBe(2);
    expect(st.seen['les-1:student_gone']).toMatchObject({ count: 4 });
  });

  it('after the window: one P2 summary of what still stands (last tick, or any worker error), every lesson card closes', () => {
    const ctx = { base: 'https://lcw.example', from: '15:00', to: '17:00', out: 'Z:/tmp/lcw-watch' };
    const st = emptyCardState('20261116', 'https://spine.example');
    const at = new Date(now).toISOString();
    planTick(st, [{ key: 'student_gone', msg: 'a', lesson: 'les-1' }, { key: 'worker_errors', msg: '5xx 1건' }], at, { base: ctx.base, out: ctx.out });
    planTick(st, [{ key: 'quiet', msg: 'b', lesson: 'les-1' }], at, { base: ctx.base, out: ctx.out });
    st.posted[scopeRef('les-1')] = { id: 'p_1', sig: 'x', at };
    st.posted[scopeRef('site-20261116')] = { id: 'p_2', sig: 'y', at, closed: at };
    const end = planWindowEnd(st, ctx);
    expect(end).toMatchObject({ standing: 2, cleared: 1, closeRefs: [scopeRef('les-1')] });
    expect(end.summary).toMatchObject({ ref: 'outsourcing:lcw:watch:site-20261116:summary', importance: SUMMARY_IMPORTANCE });
    expect(SUMMARY_IMPORTANCE).toBe(2);
    expect(end.summary!.title).toContain('남은 경보 2건');
    expect(end.summary!.body).toContain('스스로 풀린 경보 1건');
    // nothing standing: no summary, the cards still close
    const calm = emptyCardState('20261116', 'https://spine.example');
    planTick(calm, [{ key: 'student_gone', msg: 'a', lesson: 'les-1' }], at, { base: ctx.base, out: ctx.out });
    planTick(calm, [], at, { base: ctx.base, out: ctx.out });
    calm.posted[scopeRef('les-1')] = { id: 'p_1', sig: 'x', at };
    expect(planWindowEnd(calm, ctx)).toMatchObject({ summary: null, standing: 0, cleared: 1, closeRefs: [scopeRef('les-1')] });
  });

  it('tail: a worker killed for CPU/memory counts as a server fault; a client hang-up does not', () => {
    const cpu = tailVerdict({ outcome: 'exceededCpu', event: { request: { method: 'POST', url: 'https://x/v1/lesson/utterance' } }, exceptions: [], logs: [] });
    expect(cpu).toMatchObject({ killed: true, serverBad: true, status: null });
    const gone = tailVerdict({ outcome: 'canceled', event: { request: { method: 'GET', url: 'https://x/v1/lesson/state' } } });
    expect(gone).toMatchObject({ killed: false, serverBad: false });
    const e500 = tailVerdict({
      outcome: 'ok',
      event: { request: { method: 'GET', url: 'https://x/r/abcdefghijklmnopqrstuvwxyz0123' }, response: { status: 500 } },
      exceptions: [{ name: 'Error', message: 'bad token abcdefghijklmnopqrstuvwxyz0123' }]
    });
    expect(e500).toMatchObject({ s5xx: true, serverBad: true, url: 'https://x/r/***' });
    expect(e500.exceptions[0]).toBe('Error: bad token ***');
    expect(tailVerdict({ outcome: 'ok', event: { response: { status: 404 } } })).toMatchObject({ s4xx: true, serverBad: false });
    // an 'exception' outcome counts once (through its exception), a dropped client stream is not a fault,
    // and only the exception name is kept for the card
    const ex = tailVerdict({ outcome: 'exception', exceptions: [{ name: 'SyntaxError', message: 'Unexpected token in "honey tea please"' }] });
    expect(ex).toMatchObject({ killed: false, serverBad: true, exceptionNames: ['SyntaxError'] });
    expect(tailVerdict({ outcome: 'responseStreamDisconnected' })).toMatchObject({ killed: false, serverBad: false });
  });

  it('masks share tokens, join codes and long ids in logged URLs', () => {
    expect(maskUrl('https://lcw.worldwidesomething.com/r/abcdefghijklmnopqrstuvwxyz0123')).toBe('https://lcw.worldwidesomething.com/r/***');
    expect(maskUrl('https://x/game/?code=123456&scene=plaza')).toBe('https://x/game/?code=***&scene=plaza');
    expect(maskUrl('/v1/lesson/state?cursor=3')).toBe('/v1/lesson/state?cursor=3');
  });

  // A fake spine that adds the source correction the way danos proposals.add does: muted -> 0, else clamp(asked + delta, 0, 3),
  // then (a newer spine) min(that, ceiling) when the post carries one.
  const fakeSpine = (delta: number | 'mute', o: { failPost?: number; deltaAfterFirst?: number; ceiling?: boolean } = {}) => {
    const landed: number[] = [];
    let posts = 0;
    let state = 'open';
    let imp = 0;
    let ceiling: number | undefined;
    return {
      landed,
      get posts() {
        return posts;
      },
      setCeiling(c: number | undefined) {
        ceiling = o.ceiling ? c : undefined;
      },
      post: async (importance: number) => {
        posts++;
        if (o.failPost === posts) return { status: 503, body: null };
        const d = posts > 1 && o.deltaAfterFirst !== undefined ? o.deltaAfterFirst : delta;
        imp = d === 'mute' ? 0 : Math.max(0, Math.min(3, importance + d));
        if (ceiling !== undefined) imp = Math.min(imp, ceiling);
        state = 'open';
        landed.push(imp);
        return { status: 201, body: { id: 'p_1' } };
      },
      read: async () => ({ state, importance: imp }),
      close: async () => {
        state = 'closed';
        return { status: 200 };
      }
    };
  };
  type Adj = { hi: number; delta: number | null; muted: boolean; known: string; ceiling: boolean };
  const exact = (delta: number | 'mute', ceiling = false): Adj =>
    delta === 'mute' ? { hi: 0, delta: 0, muted: true, known: 'exact', ceiling } : { hi: delta, delta, muted: false, known: 'exact', ceiling };
  // What postChecked does, against the fake spine.
  const run = async (target: number, adj: Adj, how: typeof LESSON_SETTLE, sp: ReturnType<typeof fakeSpine>, log?: (r: Record<string, unknown>) => void) => {
    const plan = planSettle(target, adj, how);
    if (plan.skip) return { skipped: true as const, plan };
    sp.setCeiling(plan.ceiling);
    const out = await settleImportance({ ...how, start: plan.start, tries: plan.tries, target, post: sp.post, read: sp.read, close: how.closeTooHigh ? sp.close : undefined, log });
    return { skipped: false as const, plan, ...out };
  };
  const DELTAS: Array<number | 'mute'> = [-2, -1, 0, 1, 2, 'mute'];

  it('the adjustment bound from Dan\'s correction rows (as danos source_adjust reads them)', () => {
    const now = Date.parse('2026-11-16T08:00:00Z');
    const row = (id: number, rating: string, daysAgo = 1, pkg = 'source:outsourcing') => ({ id, rating, pkg, created: new Date(now - daysAgo * 86_400_000).toISOString() });
    const other = [row(1, 'up', 1, 'source:sori'), row(2, 'up', 1, 'com.kakao.talk')];
    expect(adjustFromFeedback(other, now, 500)).toMatchObject({ hi: 0, known: 'bound', muted: false });
    expect(adjustFromFeedback([row(4, 'up'), row(3, 'up'), ...other], now, 500)).toMatchObject({ hi: 2, delta: 2, known: 'exact' });
    expect(adjustFromFeedback([row(5, 'up'), row(4, 'down'), row(3, 'up')], now, 500)).toMatchObject({ hi: 1, known: 'exact' });
    expect(adjustFromFeedback([row(5, 'mute'), row(4, 'up')], now, 500)).toMatchObject({ muted: true, hi: 0 });
    expect(adjustFromFeedback([row(5, 'up'), row(4, 'mute')], now, 500)).toMatchObject({ muted: false, hi: 1 });
    expect(adjustFromFeedback([row(5, 'up', 91), row(4, 'up', 95)], now, 500)).toMatchObject({ hi: 0, known: 'bound' }); // 90-day window
    const eleven = Array.from({ length: 11 }, (_, i) => row(100 - i, i === 10 ? 'up' : i < 5 ? 'up' : 'down'));
    expect(adjustFromFeedback(eleven, now, 500)).toMatchObject({ hi: 0, known: 'exact' }); // the latest 10 only: 5 up, 5 down
    const full = Array.from({ length: 500 }, (_, i) => row(1000 - i, 'up', 1, 'source:sori'));
    expect(adjustFromFeedback(full, now, 500)).toMatchObject({ hi: 2, known: 'unknown' });
    expect(adjustFromFeedback([row(2000, 'down'), ...full.slice(1)], now, 500)).toMatchObject({ hi: 2, known: 'bound' }); // older rows may add
  });

  it('readAdjust: the newer spine answers exactly (with ceiling), an older one through the rows, neither: unknown', async () => {
    const now = Date.now();
    const newer = await readAdjust(async (p) => (p.startsWith('/proposals/source-adjust') ? { status: 200, body: { delta: 1, muted: false, ceiling: true } } : { status: 500, body: null }), now);
    expect(newer).toMatchObject({ hi: 1, known: 'exact', ceiling: true });
    const older = await readAdjust(async (p) => (p.startsWith('/feedback/importance') ? { status: 200, body: { items: [] } } : { status: 404, body: { detail: 'Not Found' } }), now);
    expect(older).toMatchObject({ hi: 0, known: 'bound', ceiling: false });
    expect(await readAdjust(async () => ({ status: 0, body: null }), now)).toMatchObject({ hi: 2, known: 'unknown', ceiling: false });
  });

  it('lesson cards: no post lands above 1 for any correction -2..+2 or mute, with or without the spine ceiling', async () => {
    for (const ceiling of [false, true]) {
      for (const delta of DELTAS) {
        const sp = fakeSpine(delta, { ceiling });
        const out = await run(LESSON_CARD_IMPORTANCE, exact(delta, ceiling), LESSON_SETTLE, sp);
        const tag = `delta ${delta} ceiling ${ceiling}`;
        expect(sp.landed.every((x) => x <= 1), tag).toBe(true);
        if (delta === 2 && !ceiling) {
          expect(out.skipped, tag).toBe(true); // an older spine would land it at 2: not posted at all
          expect(sp.posts, tag).toBe(0);
        } else if (delta === 'mute') {
          expect(sp.posts, tag).toBe(1);
          expect(out.skipped ? null : out.rb?.importance, tag).toBe(0);
        } else {
          expect(out.skipped ? null : out.rb, tag).toEqual({ state: 'open', importance: 1 });
          expect(sp.posts, tag).toBe(1); // known exactly: one post lands at 1
        }
      }
    }
  });

  it('the summary never passes 2 for any correction, and lands at 2 for -1..+2', async () => {
    for (const ceiling of [false, true]) {
      for (const delta of DELTAS) {
        const sp = fakeSpine(delta, { ceiling });
        const out = await run(SUMMARY_IMPORTANCE, exact(delta, ceiling), SUMMARY_SETTLE, sp);
        const tag = `delta ${delta} ceiling ${ceiling}`;
        expect(out.skipped, tag).toBe(false);
        expect(sp.landed.every((x) => x <= 2), tag).toBe(true);
        const want = delta === 'mute' ? 0 : delta === -2 ? 1 : 2; // -2: even 3 lands 1 (seen in the hub, no chime)
        expect(out.skipped ? null : out.rb?.importance, tag).toBe(want);
      }
    }
  });

  it('only a bound known (no correction rows: 0 or -1): walks up from the target, never above it', async () => {
    for (const actual of [-1, 0]) {
      const sp = fakeSpine(actual);
      const out = await run(1, { hi: 0, delta: null, muted: false, known: 'bound', ceiling: false }, LESSON_SETTLE, sp);
      expect(Math.max(...sp.landed)).toBeLessThanOrEqual(1);
      expect(out.skipped ? null : out.rb?.importance).toBe(1);
    }
  });

  it('nothing known: lesson cards are not posted on an older spine; the summary walks up from 0 and stays at most 2', async () => {
    const unknown = { hi: 2, delta: null, muted: false, known: 'unknown', ceiling: false };
    expect(planSettle(1, unknown, LESSON_SETTLE).skip).toBe(true);
    for (const actual of [-2, -1, 0, 1, 2]) {
      const sp = fakeSpine(actual);
      await run(2, unknown, SUMMARY_SETTLE, sp);
      expect(Math.max(...sp.landed), `actual ${actual}`).toBeLessThanOrEqual(2);
    }
  });

  it('a failed raise leaves a lesson card lower (hidden), never higher', async () => {
    for (const actual of [-2, -1]) {
      const sp = fakeSpine(actual, { failPost: 2 });
      const out = await run(1, { hi: 0, delta: null, muted: false, known: 'bound', ceiling: false }, LESSON_SETTLE, sp);
      expect(Math.max(...sp.landed)).toBeLessThanOrEqual(1);
      expect(out.skipped ? null : out.rb?.importance).toBe(0);
    }
  });

  it('a correction that rose after the read: brought down, and a lesson card still above 1 is closed at once', async () => {
    const down = fakeSpine(0, { deltaAfterFirst: 1 });
    const a = await run(1, exact(0), LESSON_SETTLE, down);
    expect(a.skipped ? null : a.rb?.importance).toBe(1);
    const rows: Array<Record<string, unknown>> = [];
    const sp = fakeSpine(2);
    const b = await run(1, exact(0), LESSON_SETTLE, sp, (r) => rows.push(r)); // read 0, really +2
    expect(b.skipped ? null : b.tooHigh).toBe(true);
    expect(b.skipped ? null : b.rb?.state).toBe('closed');
    expect(rows.map((r) => r.key)).toContain('card_too_high');
  });

  it('a new card id drops the old closed mark; the same id keeps it', () => {
    const prev = { id: 'p_old', sig: 'a', at: 't0', closed: 't1' };
    expect(recordPosted(prev, 'p_new', { sig: 'b', at: 't2' })).toEqual({ id: 'p_new', sig: 'b', at: 't2' });
    expect(recordPosted(prev, 'p_old', { sig: 'b', at: 't2' })).toEqual({ id: 'p_old', sig: 'b', at: 't2', closed: 't1' });
    expect(recordPosted(undefined, 'p_1', { sig: 'c', at: 't3' })).toEqual({ id: 'p_1', sig: 'c', at: 't3' });
  });

  it('relay: posts the outbox cards, acks what reached the spine (its version), never above 2, never a foreign card', async () => {
    const card = (ref: string, importance: number, source = 'outsourcing') => ({ source, ref, title: 't', body: 'b', importance, actions: [] });
    const box = {
      status: 200,
      body: {
        cards: [
          { ref: 'outsourcing:lcw:lesson:les-1:summary', updated_at: 11, card: card('outsourcing:lcw:lesson:les-1:summary', 2) },
          { ref: 'outsourcing:lcw:student:kid-1:2026-11-16', updated_at: 12, card: card('outsourcing:lcw:student:kid-1:2026-11-16', 1) },
          { ref: 'outsourcing:lcw:x:urgent', updated_at: 13, card: card('outsourcing:lcw:x:urgent', 3) },
          { ref: 'other:x', updated_at: 14, card: card('other:x', 1, 'sori') },
          { ref: 'outsourcing:lcw:mismatch', updated_at: 15, card: card('outsourcing:lcw:else', 1) },
          { ref: 'outsourcing:lcw:skip', updated_at: 16, card: card('outsourcing:lcw:skip', 1) },
          { ref: 'outsourcing:lcw:fail', updated_at: 17, card: card('outsourcing:lcw:fail', 1) }
        ]
      }
    };
    const posted: Array<{ ref: string; importance: number }> = [];
    let acked: Array<{ ref: string; updated_at: number; spine_id: string }> = [];
    const logs: Array<Record<string, unknown>> = [];
    const out = await relayOnce({
      pull: async () => box,
      postCard: async (c: { ref: string; importance: number }) => {
        posted.push({ ref: c.ref, importance: c.importance });
        if (c.ref.endsWith(':skip')) return { skipped: true, r: { status: 0, body: null } };
        if (c.ref.endsWith(':fail')) return { r: { status: 503, body: null } };
        return { r: { status: 201, body: { id: `p_${posted.length}` } } };
      },
      ack: async (items: typeof acked) => {
        acked = items;
        return { status: 200, body: { acked: items.length } };
      },
      log: (r: Record<string, unknown>) => logs.push(r)
    });
    expect(posted.map((x) => x.ref)).toEqual([
      'outsourcing:lcw:lesson:les-1:summary',
      'outsourcing:lcw:student:kid-1:2026-11-16',
      'outsourcing:lcw:x:urgent',
      'outsourcing:lcw:skip',
      'outsourcing:lcw:fail'
    ]);
    expect(posted.find((x) => x.ref.endsWith(':urgent'))?.importance).toBe(RELAY_MAX_IMPORTANCE);
    expect(acked).toEqual([
      { ref: 'outsourcing:lcw:lesson:les-1:summary', updated_at: 11, spine_id: 'p_1' },
      { ref: 'outsourcing:lcw:student:kid-1:2026-11-16', updated_at: 12, spine_id: 'p_2' },
      { ref: 'outsourcing:lcw:x:urgent', updated_at: 13, spine_id: 'p_3' }
    ]);
    expect(out).toEqual({ ok: false, pulled: 7, posted: 3, skipped: 1, failed: 3, acked: 3 });
    expect(logs.map((r) => r.key)).toEqual(['relay_bad_card', 'relay_bad_card', 'card_error']);
  });

  it('relay: a pull or ack failure acks nothing and says so', async () => {
    const down = await relayOnce({ pull: async () => ({ status: 0, body: null }), postCard: async () => ({ r: { status: 201, body: { id: 'p' } } }), ack: async () => ({ status: 200, body: {} }) });
    expect(down).toMatchObject({ ok: false, pulled: 0 });
    const one = { status: 200, body: { cards: [{ ref: 'outsourcing:a', updated_at: 1, card: { source: 'outsourcing', ref: 'outsourcing:a', title: 't', body: '', importance: 1, actions: [] } }] } };
    const noAck = await relayOnce({ pull: async () => one, postCard: async () => ({ r: { status: 201, body: { id: 'p_1' } } }), ack: async () => ({ status: 503, body: null }) });
    expect(noAck).toMatchObject({ ok: false, posted: 1, acked: 0 });
    const empty = await relayOnce({ pull: async () => ({ status: 200, body: { cards: [] } }), postCard: async () => ({ r: { status: 201, body: {} } }), ack: async () => ({ status: 200, body: {} }) });
    expect(empty).toEqual({ ok: true, pulled: 0, posted: 0, skipped: 0, failed: 0, acked: 0 });
  });
});
