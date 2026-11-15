/**
 * 12 weeks of one synthetic child through the real routes (docs/07 §2–§4, WP-309), on a fake clock:
 * the guardian links a device and pays for a seat; the child speaks through POST /v1/converse/score (free talk,
 * bank orders, read-aloud, recognition noise), reviews memory cards through /v1/review/due + /v1/review/attempt,
 * joins a weekly lesson (/v1/admin/lessons/start → /v1/join → /v1/lesson/utterance → end); the daily, hourly and
 * Monday crons run every day; the seat is extended when its 1-day notice appears. At the end the guardian opens
 * GET /v1/family/children/:pid/dashboard and every curve is compared with plain sums over what was actually sent.
 *
 * With LCW_SIM_DUMP=<file> the rows are written out for the local-screen check (seed a wrangler DO, take shots).
 */
import { writeFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { bankEntriesFor } from '@lcw/content';
import { buildDashboardSeries } from '@lcw/metrics';
import { PlatformDO, type LcwEnv } from '../platform.js';
import { fakeDurableStorage } from './fake-do.js';
import {
  SIM_DAY,
  SIM_WEEK,
  simKstDay,
  simTruth,
  simulate,
  type SimPersona,
  type SimRun,
  type SimUtterance
} from '../../../../packages/metrics/src/synthetic.js';

const TOKEN = 'op-token-0123456789abcdef';
const op = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
const anon = { 'content-type': 'application/json' };
const cronH = { 'x-lcw-internal': 'cron', 'content-type': 'application/json' };
const bearer = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const platform = () => new PlatformDO({ storage: fakeDurableStorage() }, { PLATFORM: undefined as never, LCW_OPERATOR_TOKEN: TOKEN } as LcwEnv);
async function call(p: PlatformDO, method: string, path: string, body?: unknown, headers: Record<string, string> = op) {
  const res = await p.fetch(new Request(`https://x${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
  const text = await res.text();
  let b: any = text;
  try {
    b = JSON.parse(text);
  } catch {
    /* plain text */
  }
  return { status: res.status, body: b };
}
const sqlOf = (p: PlatformDO) => (p as any).sql;

// Monday 2026-08-17 00:00 KST … the guardian looks on Sunday 2026-11-08 22:00 KST (end of week 12).
const START = Date.parse('2026-08-16T15:00:00Z');
const NOW = START + 12 * SIM_WEEK - 2 * 3_600_000;
const PID = 'kid-sim12';
const weekdays = [0, 1, 2, 3, 4];

const PERSONA: SimPersona = {
  name: PID,
  seed: 23,
  start: START,
  weeks: 12,
  // a holiday in week 5, a two-day week 9, Saturdays now and then
  playDays: (w) => (w === 4 ? [] : w === 8 ? [1, 3] : w % 3 === 0 ? [...weekdays, 5] : weekdays),
  freePerDay: (w) => 8 + Math.floor(w / 4),
  wordsPerFree: (w) => (w < 6 ? 4 + w * 0.4 : 7 + (w - 6) * 0.3),
  prepMsPerWord: () => 600,
  wpm: (w) => 90 + w * 3,
  connectorShare: (w) => 0.1 + w * 0.04,
  vocab: (w) => 60 + w * 25,
  guidedPerDay: 2,
  readPerDay: 1,
  lowConfPerDay: 2,
  lessonWeekday: 2,
  lessonFromWeek: 1,
  lessonOn: (w) => w !== 4,
  lessonFree: 6
};


interface Sent extends SimUtterance {
  via: string;
}

/** Plays the 12 weeks; every request goes through PlatformDO.fetch on the fake clock. */
async function twelveWeeks() {
  {
    vi.useFakeTimers({ toFake: ['Date'] });
    const at = (t: number) => vi.setSystemTime(t);
    at(START - SIM_DAY + 10 * 3_600_000);

    const plan: SimRun = simulate(PERSONA);
    const p = platform();
    const sql = sqlOf(p);

    // Guardian: family, service consent, a paid month, the child's device.
    await call(p, 'POST', '/v1/admin/players', { family_id: 'fam-sim12', guardian_id: 'g-sim12', player_id: PID, nickname: 'Sora', birth_year: 2016, level: 'L2' });
    const inv = await call(p, 'POST', '/v1/admin/family-invites', { player_id: PID });
    const g = bearer((await call(p, 'POST', '/v1/family/session', { invite: inv.body.invite_path.split('#k=')[1] }, anon)).body.guardian_token);
    expect((await call(p, 'POST', '/v1/family/service-consent', { granted: true }, g)).status).toBeLessThan(300);
    const seat = await call(p, 'POST', '/v1/admin/seats', { payer_player_id: PID, plan: 'solo', term: 'month', player_ids: [PID], amount_krw: 19_900, paid_at: Date.now() });
    expect(seat.status).toBe(201);
    const seatId = seat.body.seat_ids[0];
    const code = await call(p, 'POST', `/v1/family/children/${PID}/device-code`, {}, g);
    const dev = bearer((await call(p, 'POST', '/v1/device/link', { code: code.body.code }, anon)).body.device_token);

    // Bank orders the child places (2-star offers with a price, so a passed order buys an item and makes a card).
    const offers = ['cafe', 'shop']
      .flatMap((ctx) => bankEntriesFor(ctx, 'L2').map((e) => ({ ctx, offer: e.offers.find((o) => o.stars >= 2 && o.price > 0) })))
      .filter((x): x is { ctx: string; offer: NonNullable<typeof x.offer> } => Boolean(x.offer));
    expect(offers.length).toBeGreaterThan(10);

    const sent: Sent[] = [];
    const mastered: number[] = [];
    const lessonStarts: number[] = [];
    const statuses = new Map<string, number>();
    const count = (k: string) => statuses.set(k, (statuses.get(k) ?? 0) + 1);
    let extended = 0;
    let order = 0;
    const days = new Map<number, SimUtterance[]>();
    for (const u of plan.utterances) {
      const list = days.get(u.day_index) ?? [];
      list.push(u);
      days.set(u.day_index, list);
    }

    for (let d = 0; d < 7 * 12; d++) {
      const dayStart = START + d * SIM_DAY;
      // Night jobs: daily at 03:00 KST, Monday reports at 06:00, the hourly sweep (seat notices, push) at 10:00.
      at(dayStart + 3 * 3_600_000);
      expect((await call(p, 'POST', '/internal/cron', { cron: '0 3 * * *' }, cronH)).status).toBe(200);
      if (d % 7 === 0) {
        at(dayStart + 6 * 3_600_000);
        expect((await call(p, 'POST', '/internal/cron', { cron: '0 6 * * 1' }, cronH)).status).toBe(200);
      }
      at(dayStart + 10 * 3_600_000);
      expect((await call(p, 'POST', '/internal/cron', { cron: '0 * * * *' }, cronH)).status).toBe(200);
      // The guardian renews when the "1 day left" notice is there (it also sits in the push outbox, held).
      if (sql.get("select count(*) as n from seat_notices where seat_id = ? and kind = '1d'", [seatId]).n > 0) {
        expect((await call(p, 'POST', `/v1/admin/seats/${seatId}/extend`, { days: 30, amount_krw: 19_900 })).status).toBe(200);
        extended++;
      }

      const today = days.get(d) ?? [];
      let lastAt = 0;
      let lesson: { id: string; stu: Record<string, string> } | null = null;
      for (const u of today) {
        at(u.created_at);
        lastAt = u.created_at;
        if (u.session_kind === 'lesson') {
          if (!lesson) {
            const t0 = plan.lessonStarts.find((t) => simKstDay(t) === simKstDay(u.created_at))!;
            at(t0);
            const st = await call(p, 'POST', '/v1/admin/lessons/start', { player_id: PID });
            expect(st.status).toBe(201);
            expect(st.body.plan.stages[0].mode).toBe('free');
            const join = await call(p, 'POST', '/v1/join', { code: st.body.join_code }, anon);
            lesson = { id: st.body.lesson_id, stu: bearer(join.body.student_token) };
            lessonStarts.push(t0);
            at(u.created_at);
          }
          const r = await call(p, 'POST', '/v1/lesson/utterance', { transcript: u.final_text, latency_ms: u.latency_ms, dur_ms: u.dur_ms, confidence: u.confidence }, lesson.stu);
          count(`lesson:${r.status}`);
          // stars and score are the server's decision; the rest is what the child sent
          sent.push({ ...u, stars: Number(r.body.stars ?? 0), score: Number(r.body.score ?? 0), via: 'lesson' });
          continue;
        }
        let body: Record<string, unknown>;
        let row: SimUtterance = u;
        if (u.mode === 'guided') {
          const o = offers[order++ % offers.length]!;
          row = { ...u, final_text: o.offer.text, words: o.offer.text.trim().split(/\s+/).length, ctx: o.ctx, connectors: 0 };
          body = { dialog_id: `ord-${order}`, chosen_stars: o.offer.stars, hint_level: 'keyword', transcript: o.offer.text, npc_ctx: o.ctx, target_text: o.offer.text, mode: 'guided' };
        } else {
          body = { dialog_id: `talk-${u.id}`, chosen_stars: 1, hint_level: u.mode === 'read' ? 'full' : 'none', transcript: u.final_text, npc_ctx: 'cafe', target_text: '', mode: u.mode };
        }
        const r = await call(p, 'POST', '/v1/converse/score', { ...body, latency_ms: row.latency_ms, dur_ms: row.dur_ms, confidence: row.confidence, stt_source: 'device' }, dev);
        count(`score:${r.status}`);
        sent.push({ ...row, stars: Number(r.body.stars ?? 0), score: Number(r.body.score ?? 0), via: 'score' });
      }
      if (lesson) {
        at(lastAt + 5 * 60_000);
        expect((await call(p, 'POST', `/v1/admin/lessons/${lesson.id}/end`, {})).status).toBe(200);
      }
      // Review session 25 minutes after the last sentence of a play day: answer every sign with its sentence.
      if (today.some((u) => u.session_kind !== 'lesson')) {
        const rt = lastAt + 25 * 60_000;
        at(rt);
        const due = await call(p, 'GET', '/v1/review/due', undefined, dev);
        expect(due.status).toBe(200);
        let k = 0;
        for (const sign of due.body.signs as Array<{ card_id: string; text: string; box: number }>) {
          const t = rt + ++k * 30_000;
          at(t);
          const words = sign.text.trim().split(/\s+/).length;
          const r = await call(p, 'POST', '/v1/review/attempt', { card_id: sign.card_id, transcript: sign.text, latency_ms: words * 500, dur_ms: words * 400, confidence: 0.9, stt_source: 'device' }, dev);
          count(`review:${r.status}`);
          if (r.status !== 200) continue;
          if (r.body.mastered) mastered.push(t);
          sent.push({
            ...plan.utterances[0]!,
            id: `review-${sign.card_id}-${t}`,
            mode: sign.box >= 2 ? 'recall' : 'read',
            final_text: sign.text,
            words,
            dur_ms: words * 400,
            latency_ms: words * 500,
            confidence: 0.9,
            stars: r.body.stars,
            score: r.body.score,
            session_kind: 'solo',
            created_at: t,
            connectors: 0,
            day_index: d,
            via: 'review'
          });
        }
      }
    }

    // The guardian opens the dashboard.
    at(NOW);
    const res = await call(p, 'GET', `/v1/family/children/${PID}/dashboard`, undefined, g);
    const truth = simTruth({ ...plan, utterances: [...sent].sort((a, b) => a.created_at - b.created_at), lessonStarts, masteredAt: mastered });
    const cards = sql.all('select box, mastered_at from memory_cards where player_id = ?', [PID]) as Array<{ box: number; mastered_at: number | null }>;
    const outbox = sql.all('select kind, status from push_outbox') as Array<{ kind: string; status: string }>;
    const s = res.body.series;
    if (process.env.LCW_SIM_DUMP) {
      writeFileSync(
        process.env.LCW_SIM_DUMP,
        JSON.stringify({
          now: NOW,
          player_id: PID,
          utterances: sql.all('select * from utterances where player_id = ?', [PID]),
          memory_cards: sql.all('select * from memory_cards where player_id = ?', [PID]),
          lessons: sql.all('select * from lessons where player_id = ?', [PID]),
          truth: { weeks: truth.weeks, calendar: [...truth.perDay.entries()] },
          series: s
        })
      );
    }
    vi.useRealTimers();
    return { res, s, sent, mastered, lessonStarts, truth, statuses, extended, cards, outbox };
  }
}

let R: Awaited<ReturnType<typeof twelveWeeks>>;

describe('12 weeks through the real routes (docs/07, WP-309)', () => {
  beforeAll(async () => {
    R = await twelveWeeks();
    // ~1,000 requests on a fake clock: about 40 s on an idle machine, longer when the PC is busy
  }, 600_000);
  afterAll(() => vi.useRealTimers());

  it('nothing was refused for 12 weeks: the seat was renewed on its 1-day notice; the notices stayed held in the push outbox', () => {
    expect([...R.statuses.keys()].filter((k) => !k.endsWith(':200') && !k.endsWith(':201'))).toEqual([]);
    expect(R.statuses.get('score:200')).toBeGreaterThan(700);
    expect(R.statuses.get('lesson:200')).toBe(60);
    expect(R.statuses.get('review:200')).toBeGreaterThan(100);
    expect(R.extended).toBeGreaterThanOrEqual(2);
    expect(R.outbox.some((o) => o.kind === 'seat_1d')).toBe(true);
    // sending is off by default and no device subscribed: nothing went to a person
    expect(R.outbox.filter((o) => o.status === 'sent')).toEqual([]);
  });

  it('stored = sent: the guardian dashboard equals the series computed straight from what the child sent', () => {
    expect(R.res.status).toBe(200);
    const fromSent = buildDashboardSeries({ utterances: R.sent, masteredAt: R.mastered, lessonStarts: R.lessonStarts, nowMs: NOW });
    expect(R.s).toEqual(JSON.parse(JSON.stringify(fromSent)));
  });

  it('every curve is the plain sum over what was sent: weekly amounts, cumulative lines, calendar, lesson ticks', () => {
    const s = R.s;
    s.weeks.forEach((w: any, i: number) => {
      const x = R.truth.weeks[i]!;
      const tag = `week ${i + 1}`;
      expect({ tag, v: [w.free_words, w.free_utterances, w.play_days, w.lesson_days, w.cum_free_words, w.cum_vocab, w.cum_mastered] }).toEqual({
        tag,
        v: [x.free_words, x.free_utterances, x.play_days, x.lesson_days, x.cum_free_words, x.cum_vocab, x.cum_mastered]
      });
      expect({ tag, v: w.think_status === 'short' }).toEqual({ tag, v: x.free_utterances < 30 });
      if (i) expect(w.cum_free_words).toBeGreaterThanOrEqual(s.weeks[i - 1].cum_free_words);
    });
    expect(s.calendar).toHaveLength(84);
    for (const day of s.calendar as Array<{ day: string; free_words: number }>) expect({ day: day.day, v: day.free_words }).toEqual({ day: day.day, v: R.truth.perDay.get(day.day) ?? 0 });
  });

  it('shapes a parent reads: holiday week empty (no dot, not a zero), two-day week short, index rising from its own start', () => {
    const s = R.s;
    expect(s.weeks[4]).toMatchObject({ play_days: 0, free_words: 0, think_speak: null });
    // two play days plus the Wednesday lesson: 26 free sentences, under the 30 the index needs
    expect(s.weeks[8]).toMatchObject({ play_days: 3, free_utterances: 26, think_speak: null, think_status: 'short' });
    expect(s.weeks.map((w: any) => w.lesson_days)).toEqual([0, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1]);
    expect(s.baseline.week_starts).toEqual([START, START + SIM_WEEK]);
    const dots = s.weeks.map((w: any) => w.think_speak).filter((v: number | null) => v !== null);
    expect(dots[dots.length - 1]).toBeGreaterThan(115);
    expect(s.weeks[11].think_speak_4w).toBeGreaterThan(s.weeks[3].think_speak_4w);
    expect(s.projection.cum_free_words).toHaveLength(12);
    // "이번 주의 한 마디" is the longest valid free sentence of this week (same rows, docs/07 §6)
    expect(R.res.body.week_line.words).toBe(
      Math.max(...R.sent.filter((u) => u.mode === 'free' && u.created_at >= s.weeks[11].week_start && u.confidence >= 0.5).map((u) => u.words))
    );
  });

  it('memory cards climb the boxes through review signs (20 min → 1 day → 3 days → 7 days)', () => {
    expect(R.cards.length).toBeGreaterThan(30);
    expect(R.cards.filter((c) => c.box >= 3).length).toBeGreaterThan(20);
  });

  /*
   * Known gap found by this simulation (reported to the world/review owner): review signs only appear for gear
   * equipped or used in the last 7 days (docs/09 P4), the server has no equip state and no repair-NPC pick route,
   * and the only "use" it records is the previous review. A card at box 3 (7-day interval) is therefore due exactly
   * when its item drops out of the 7-day window, so no card can reach the 16- and 35-day reviews and the
   * "마스터 문장" curve stays at 0 for every child. it.fails keeps this visible: when mastery becomes reachable this
   * test starts failing and should become a plain `it`.
   */
  it.fails('a child who plays five days a week masters at least one card in 12 weeks (blocked: see the note above)', () => {
    expect(R.mastered.length).toBeGreaterThan(0);
    expect(R.s.weeks[11].cum_mastered).toBeGreaterThan(0);
  });
});
