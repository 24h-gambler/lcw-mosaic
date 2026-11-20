/**
 * Independent review of PR #16 (WP-704), R1–R10, kept as regression tests with the expected outcomes after the fixes:
 * money never exceeds what was paid, only the payer settles a Duo, the KST refund window, paid extensions, atomic
 * writes, notices once, and the server-side seat gate for solo play (lessons unaffected).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlatformDO, type LcwEnv } from '../platform.js';
import { sweepSeatNotices } from '../seats.js';
import { fakeDurableStorage } from './fake-do.js';

const TOKEN = 'op-token-0123456789abcdef';
const op = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
const anon = { 'content-type': 'application/json' };
const bearer = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const DAY = 86_400_000;
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
async function family(p: PlatformDO, playerId: string, fam: string, nickname = 'Juno', guardian = `g-${fam}`) {
  await call(p, 'POST', '/v1/admin/players', { family_id: fam, guardian_id: guardian, player_id: playerId, nickname, birth_year: 2016, level: 'L2' });
  const inv = await call(p, 'POST', '/v1/admin/family-invites', { player_id: playerId });
  const s = await call(p, 'POST', '/v1/family/session', { invite: inv.body.invite_path.split('#k=')[1] }, anon);
  const g = bearer(s.body.guardian_token);
  await call(p, 'POST', '/v1/family/service-consent', { granted: true }, g);
  return g;
}
async function linkDevice(p: PlatformDO, g: Record<string, string>, playerId: string) {
  const code = await call(p, 'POST', `/v1/family/children/${playerId}/device-code`, {}, g);
  const link = await call(p, 'POST', '/v1/device/link', { code: code.body.code }, anon);
  return bearer(link.body.device_token);
}
const sqlOf = (p: PlatformDO) => (p as any).sql;
const totalRefund = (p: PlatformDO, oid: string) =>
  Number(sqlOf(p).get("select coalesce(sum(refund_krw),0) as s from seat_refunds where order_id = ? and status = 'done'", [oid]).s);
const kst = (ms: number) => new Date(ms + 9 * 3_600_000).toISOString().slice(0, 16);

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as any).__boom;
  delete (globalThis as any).__boom2;
});

describe('review WP-704 (R1–R10)', () => {
  it('R1 repeated / concurrent rule refunds on a Duo never exceed what was paid', async () => {
    const p = platform();
    const ga = await family(p, 'kid-a', 'fam-a');
    await family(p, 'kid-b', 'fam-b');
    const issued = await call(p, 'POST', '/v1/admin/seats', { payer_guardian_id: 'g-fam-a', plan: 'duo', term: 'month', player_ids: ['kid-a', 'kid-b'] });
    const [a, b] = issued.body.seat_ids;
    await call(p, 'POST', `/v1/family/seats/${a}/refund-request`, { mode: 'refund_difference' }, ga);
    const rs = await Promise.all([
      call(p, 'POST', `/v1/admin/seats/${a}/refund`, {}),
      call(p, 'POST', `/v1/admin/seats/${a}/refund`, {}),
      call(p, 'POST', `/v1/admin/seats/${b}/refund`, {}),
      call(p, 'POST', `/v1/admin/seats/${b}/refund`, {})
    ]);
    expect(rs.map((r) => [r.status, r.body.refund_krw ?? r.body.error])).toEqual([
      [200, 5_000],
      [409, 'already_refunded'],
      [200, 14_900],
      [409, 'already_refunded']
    ]);
    expect(totalRefund(p, issued.body.order_id)).toBe(19_900);
  });

  it('R2 payment time cannot be far ahead; a rule refund closes the open review item, so no exception can follow', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const t0 = Date.UTC(2026, 10, 1, 6, 0, 0);
    vi.setSystemTime(t0);
    const p = platform();
    const g = await family(p, 'kid-1', 'fam-a');
    expect(
      (await call(p, 'POST', '/v1/admin/seats', { payer_guardian_id: 'g-fam-a', plan: 'solo', term: 'month', player_ids: ['kid-1'], paid_at: t0 + 3_600_000 })).body.error
    ).toBe('paid_at_in_future');
    const issued = await call(p, 'POST', '/v1/admin/seats', { payer_guardian_id: 'g-fam-a', plan: 'solo', term: 'month', player_ids: ['kid-1'], paid_at: t0 + 5 * 60_000 });
    const sid = issued.body.seat_ids[0];
    // asked before the stated payment time → outside the rule
    expect((await call(p, 'POST', `/v1/family/seats/${sid}/refund-request`, {}, g)).body.status).toBe('review');
    expect((await call(p, 'POST', `/v1/admin/seats/${sid}/refund`, {})).status).toBe(409);
    vi.setSystemTime(t0 + 2 * 3_600_000);
    const rule = await call(p, 'POST', `/v1/admin/seats/${sid}/refund`, {});
    expect(rule.body.refund_krw).toBe(14_900);
    expect((await call(p, 'GET', '/v1/admin/seat-inbox')).body.requests).toHaveLength(0);
    expect(totalRefund(p, issued.body.order_id)).toBe(14_900);
  });

  it('R3 Duo: exception on A after a rule refund on B stays within what was paid', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const t0 = Date.UTC(2026, 10, 1, 6, 0, 0);
    vi.setSystemTime(t0);
    const p = platform();
    const ga = await family(p, 'kid-a', 'fam-a');
    await family(p, 'kid-b', 'fam-b');
    const issued = await call(p, 'POST', '/v1/admin/seats', { payer_guardian_id: 'g-fam-a', plan: 'duo', term: 'month', player_ids: ['kid-a', 'kid-b'], paid_at: t0 + 5 * 60_000 });
    const [a, b] = issued.body.seat_ids;
    await call(p, 'POST', `/v1/family/seats/${a}/refund-request`, {}, ga); // before payment time → review
    expect((await call(p, 'POST', `/v1/admin/seats/${a}/refund`, {})).status).toBe(409);
    vi.setSystemTime(t0 + 2 * 3_600_000);
    await call(p, 'POST', `/v1/family/seats/${b}/refund-request`, { mode: 'refund_difference' }, ga);
    const rb = await call(p, 'POST', `/v1/admin/seats/${b}/refund`, {});
    expect(rb.body).toMatchObject({ refund_krw: 5_000, remaining_seat: { id: a, plan: 'solo' } });
    const inbox = (await call(p, 'GET', '/v1/admin/seat-inbox')).body.requests;
    expect(inbox.map((r: any) => [r.seat_id === a ? 'A' : 'B', r.status])).toEqual([['A', 'review']]);
    const tooBig = await call(p, 'POST', `/v1/admin/seat-refunds/${inbox[0].id}/decide`, { decision: 'refund', refund_krw: 99_999 });
    expect(tooBig.body).toMatchObject({ error: 'refund_exceeds_paid', max_krw: 14_900 });
    const max = await call(p, 'POST', `/v1/admin/seat-refunds/${inbox[0].id}/decide`, { decision: 'refund', refund_krw: tooBig.body.max_krw });
    expect(max.status).toBe(200);
    expect(totalRefund(p, issued.body.order_id)).toBe(19_900);
  });

  it('R4 window: KST, day after payment through 24:00 of the 7th day; the screen shows the same moment', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const paid = Date.UTC(2026, 10, 1, 6, 0, 0); // 2026-11-01 15:00 KST
    const cases = [
      ['exact 7d', paid + 7 * DAY, 200],
      ['7d+1ms', paid + 7 * DAY + 1, 200],
      ['11-08 23:59 KST', Date.UTC(2026, 10, 8, 14, 59, 0), 200],
      ['11-09 00:00 KST', Date.UTC(2026, 10, 8, 15, 0, 0), 409]
    ] as const;
    for (const [label, at, want] of cases) {
      vi.setSystemTime(paid);
      const p = platform();
      const g = await family(p, 'kid-1', 'fam-a');
      const issued = await call(p, 'POST', '/v1/admin/seats', { payer_guardian_id: 'g-fam-a', plan: 'solo', term: 'month', player_ids: ['kid-1'], paid_at: paid });
      expect(kst(issued.body.refund_until)).toBe('2026-11-09T00:00');
      vi.setSystemTime(at);
      const view = (await call(p, 'GET', '/v1/family/seats', undefined, g)).body.seats[0];
      expect(kst(view.refund_until), label).toBe('2026-11-09T00:00');
      const r = await call(p, 'POST', `/v1/admin/seats/${issued.body.seat_ids[0]}/refund`, {});
      expect(r.status, label).toBe(want);
      if (want === 200) expect(r.body.refund_krw).toBe(14_900);
    }
  });

  it('R5 Duo year numbers; converting to Solo days keeps a paid extension', async () => {
    const p = platform();
    const ga = await family(p, 'kid-a', 'fam-a');
    await family(p, 'kid-b', 'fam-b');
    const yr = await call(p, 'POST', '/v1/admin/seats', { payer_guardian_id: 'g-fam-a', plan: 'duo', term: 'year', player_ids: ['kid-a', 'kid-b'] });
    const view = (await call(p, 'GET', '/v1/family/seats', undefined, ga)).body.seats[0];
    expect(view.duo_options).toEqual({ refund_difference_krw: 40_000, solo_days: 243 });
    const [a, b] = yr.body.seat_ids;
    const ext = await call(p, 'POST', `/v1/admin/seats/${a}/extend`, { days: 30, amount_krw: 5_000 });
    expect(ext.status).toBe(200);
    const before = sqlOf(p).get('select ends_at, starts_at from seats where id = ?', [a]);
    expect((before.ends_at - before.starts_at) / DAY).toBe(395);
    await call(p, 'POST', `/v1/family/seats/${b}/refund-request`, { mode: 'convert_to_solo_days' }, ga);
    const r = await call(p, 'POST', `/v1/admin/seats/${b}/refund`, {});
    expect(r.body).toMatchObject({ refund_krw: 0, mode: 'convert_to_solo_days', remaining_seat: { id: a, solo_days: 243 } });
    const after = sqlOf(p).get('select ends_at, starts_at from seats where id = ?', [a]);
    expect((after.ends_at - after.starts_at) / DAY).toBe(243 + 30);
    // the extension is its own payment in the payer's history
    const pays = (await call(p, 'GET', '/v1/family/seats', undefined, ga)).body.seats.find((s: any) => s.id === a).payments;
    expect(pays.map((x: any) => [x.kind, x.amount_krw])).toEqual([
      ['extend', 5_000],
      ['issue', 159_000]
    ]);
  });

  it('R6 a non-payer request waits for the payer, who then chooses the settlement', async () => {
    const p = platform();
    const ga = await family(p, 'kid-a', 'fam-a');
    const gb = await family(p, 'kid-b', 'fam-b');
    const issued = await call(p, 'POST', '/v1/admin/seats', { payer_guardian_id: 'g-fam-a', plan: 'duo', term: 'month', player_ids: ['kid-a', 'kid-b'] });
    const [, b] = issued.body.seat_ids;
    const friend = await call(p, 'POST', `/v1/family/seats/${b}/refund-request`, { mode: 'refund_difference' }, gb);
    expect(friend.body).toMatchObject({ status: 'pending', awaiting_payer_choice: true });
    expect((await call(p, 'GET', '/v1/admin/seat-inbox')).body.requests[0]).toMatchObject({ mode: null, awaiting_payer_choice: true });
    expect((await call(p, 'POST', `/v1/admin/seats/${b}/refund`, {})).body.error).toBe('awaiting_payer_choice');
    const payerTry = await call(p, 'POST', `/v1/family/seats/${b}/refund-request`, { mode: 'convert_to_solo_days' }, ga);
    expect(payerTry).toMatchObject({ status: 200, body: { mode: 'convert_to_solo_days' } });
    const payerView = (await call(p, 'GET', '/v1/family/seats', undefined, ga)).body.seats.find((s: any) => s.id === b);
    expect(payerView).toMatchObject({ can_choose_mode: false, pending_request: { awaiting_payer_choice: false } });
    expect((await call(p, 'GET', '/v1/admin/seat-inbox')).body.requests.map((r: any) => r.mode)).toEqual(['convert_to_solo_days']);
    // the friend family cannot change it afterwards
    expect((await call(p, 'POST', `/v1/family/seats/${b}/refund-request`, { mode: 'refund_difference' }, gb)).status).toBe(409);
    const r = await call(p, 'POST', `/v1/admin/seats/${b}/refund`, {});
    expect(r.body).toMatchObject({ refund_krw: 0, remaining_seat: { solo_days: 20 } });
  });

  it('R7 no leaks: device token, friend family, payer view, child device payload', async () => {
    const p = platform();
    const ga = await family(p, 'kid-a', 'fam-a', 'Juno');
    const gb = await family(p, 'kid-b', 'fam-b', 'Mina');
    const devB = await linkDevice(p, gb, 'kid-b');
    const issued = await call(p, 'POST', '/v1/admin/seats', { payer_guardian_id: 'g-fam-a', plan: 'duo', term: 'month', player_ids: ['kid-a', 'kid-b'] });
    const [, b] = issued.body.seat_ids;
    expect((await call(p, 'GET', '/v1/family/seats', undefined, devB)).status).toBe(401);
    expect((await call(p, 'POST', `/v1/family/seats/${b}/refund-request`, {}, devB)).status).toBe(401);
    expect((await call(p, 'GET', '/v1/admin/seats', undefined, devB)).status).toBe(401);
    const fb = JSON.stringify((await call(p, 'GET', '/v1/family/seats', undefined, gb)).body);
    for (const x of ['Juno', 'kid-a', 'g-fam-a', '19900', '19,900']) expect(fb).not.toContain(x);
    const fa = JSON.stringify((await call(p, 'GET', '/v1/family/seats', undefined, ga)).body);
    expect(fa.includes('kid-b') || fa.includes('Mina')).toBe(false);
    await call(p, 'POST', `/v1/family/seats/${b}/refund-request`, { note: 'Mina 엄마 010-1234-5678' }, gb);
    // the child device payload: state only (opened after the request, so the refund is still judged as of the request)
    const me = (await call(p, 'GET', '/v1/device/me', undefined, devB)).body;
    expect(me).toEqual({ nickname: 'Mina', level: 'L2', voice_store: false, play_allowed: true, seat: { state: 'active' }, trial: null });
    const fa2 = JSON.stringify((await call(p, 'GET', '/v1/family/seats', undefined, ga)).body);
    expect(fa2).not.toContain('010-1234');
    expect(fa2).not.toContain('g-fam-b');
    await call(p, 'POST', `/v1/family/seats/${b}/refund-request`, { mode: 'refund_difference' }, ga);
    expect((await call(p, 'POST', `/v1/admin/seats/${b}/refund`, {})).status).toBe(200);
    const fb2 = (await call(p, 'GET', '/v1/family/seats', undefined, gb)).body.seats[0];
    expect(fb2).toMatchObject({ state: 'refunded', payments: null, duo_options: null });
    expect(JSON.stringify(fb2)).not.toContain('5000');
  });

  it('R8 a failure while recording rolls back the rule refund and the exception refund', async () => {
    const p = platform();
    const ga = await family(p, 'kid-a', 'fam-a');
    await family(p, 'kid-b', 'fam-b');
    const issued = await call(p, 'POST', '/v1/admin/seats', { payer_guardian_id: 'g-fam-a', plan: 'duo', term: 'month', player_ids: ['kid-a', 'kid-b'] });
    const [, b] = issued.body.seat_ids;
    await call(p, 'POST', `/v1/family/seats/${b}/refund-request`, { mode: 'refund_difference' }, ga);
    const sql = sqlOf(p);
    const orig = sql.run.bind(sql);
    sql.run = (q: string, params?: unknown[]) => {
      if (/insert into seat_refunds/.test(q) && (globalThis as any).__boom) throw new Error('boom');
      if (/update seat_refunds set status = 'done', refund_krw/.test(q) && (globalThis as any).__boom2) throw new Error('boom2');
      return orig(q, params);
    };
    (globalThis as any).__boom = true;
    expect((await call(p, 'POST', `/v1/admin/seats/${b}/refund`, {})).status).toBe(500);
    (globalThis as any).__boom = false;
    expect(sql.all('select plan, status from seats order by id', [])).toEqual([
      { plan: 'duo', status: 'active' },
      { plan: 'duo', status: 'active' }
    ]);
    expect(sql.all('select status from seat_refunds', [])).toEqual([{ status: 'pending' }]);
    // exception path: a request outside the 7 days goes straight to review; a failure mid-decision changes nothing
    const gc = await family(p, 'kid-c', 'fam-c');
    const t = await call(p, 'POST', '/v1/admin/seats', { payer_guardian_id: 'g-fam-c', plan: 'tutoring', term: 'month', player_ids: ['kid-c'], amount_krw: 50_000, paid_at: Date.now() - 8 * 86_400_000 });
    const rq = await call(p, 'POST', `/v1/family/seats/${t.body.seat_ids[0]}/refund-request`, {}, gc);
    expect(rq.body.status).toBe('review');
    (globalThis as any).__boom2 = true;
    expect((await call(p, 'POST', `/v1/admin/seat-refunds/${rq.body.id}/decide`, { decision: 'refund', refund_krw: 10_000 })).status).toBe(500);
    (globalThis as any).__boom2 = false;
    expect(sql.get('select status from seats where id = ?', [t.body.seat_ids[0]])).toEqual({ status: 'active' });
    expect(sql.get('select status, refund_krw from seat_refunds where id = ?', [rq.body.id])).toEqual({ status: 'review', refund_krw: null });
    // and a 'pending' (in-rule) request is not decided by hand
    const pend = sql.get("select id from seat_refunds where status = 'pending'", []);
    expect((await call(p, 'POST', `/v1/admin/seat-refunds/${pend.id}/decide`, { decision: 'refund', refund_krw: 1 })).body.error).toBe('use_rule_refund');
  });

  it('R9 notices: once per kind, also when swept twice an hour; the cron run is recorded on its own', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const t0 = Date.UTC(2026, 10, 1, 0, 0, 0);
    vi.setSystemTime(t0);
    const p = platform();
    await family(p, 'kid-1', 'fam-a');
    const issued = await call(p, 'POST', '/v1/admin/seats', { payer_guardian_id: 'g-fam-a', plan: 'solo', term: 'month', player_ids: ['kid-1'] });
    const sid = issued.body.seat_ids[0];
    const sql = sqlOf(p);
    const out: Array<[number, number]> = [];
    for (let h = 0; h < 24 * 62; h++) {
      const now = t0 + h * 3_600_000;
      vi.setSystemTime(now);
      const n = sweepSeatNotices(sql, now);
      if (n) out.push([h / 24, n]);
      expect(sweepSeatNotices(sql, now)).toBe(0);
    }
    expect(out).toEqual([
      [23, 1],
      [29, 1],
      [30, 1]
    ]);
    expect(sql.all('select kind, count(*) as n from seat_notices where seat_id = ? group by kind order by kind', [sid])).toEqual([
      { kind: '1d', n: 1 },
      { kind: '7d', n: 1 },
      { kind: 'expired', n: 1 }
    ]);
    p.runCron('0 * * * *');
    expect(sql.get("select ok from ops_runs where task = 'hourly_seat_notices' order by at desc limit 1")).toEqual({ ok: 1 });
  });

  it('R10 a refunded seat stops solo writes on the server; reads and lessons stay open', async () => {
    const p = platform();
    const g = await family(p, 'kid-1', 'fam-a');
    const dev = await linkDevice(p, g, 'kid-1');
    const issued = await call(p, 'POST', '/v1/admin/seats', { payer_guardian_id: 'g-fam-a', plan: 'solo', term: 'month', player_ids: ['kid-1'] });
    // asked before the first play, so the rule refund below still applies (seats.ts usedPayment asOf)
    await call(p, 'POST', `/v1/family/seats/${issued.body.seat_ids[0]}/refund-request`, {}, g);
    const before = await call(p, 'POST', '/v1/converse/score', { text: 'hello', context: {} }, dev);
    expect(before.status).not.toBe(403);
    await call(p, 'POST', `/v1/admin/seats/${issued.body.seat_ids[0]}/refund`, {});
    expect((await call(p, 'GET', '/v1/device/me', undefined, dev)).body).toMatchObject({ play_allowed: false, seat: { state: 'refunded' } });
    const sc = await call(p, 'POST', '/v1/converse/score', { text: 'hello', context: {} }, dev);
    expect(sc).toMatchObject({ status: 403, body: { error: 'seat_inactive', seat: { state: 'refunded' } } });
    expect((await call(p, 'POST', '/v1/review/attempt', { card_id: 'x', transcript: 'hi' }, dev)).status).toBe(403);
    expect((await call(p, 'POST', '/v1/showroom', { snapshot: {} }, dev)).status).toBe(403);
    // reading stays open (read-only days), removing a share stays open
    expect((await call(p, 'GET', '/v1/review/due', undefined, dev)).status).toBe(200);
    expect((await call(p, 'DELETE', '/v1/showroom', undefined, dev)).status).toBe(200);
    // lessons do not look at seats
    const st = await call(p, 'POST', '/v1/admin/lessons/start', { player_id: 'kid-1' });
    const join = await call(p, 'POST', '/v1/join', { code: st.body.join_code }, anon);
    expect(join.status).toBe(200);
    const stu = bearer(join.body.student_token);
    expect((await call(p, 'POST', '/v1/lesson/utterance', { transcript: 'i like pizza because it is cheesy', dur_ms: 3000 }, stu)).status).toBeLessThan(300);
    // the lesson token may still score solo orders inside the lesson
    expect((await call(p, 'POST', '/v1/converse/score', { text: 'hello', context: {} }, stu)).status).not.toBe(403);
  });
});
