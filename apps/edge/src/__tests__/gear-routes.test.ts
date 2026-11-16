/**
 * The child's things, the repair NPC, collection books and settings through the platform gateway (docs/09 P4,
 * docs/03 D12·D13, docs/19): who comes from the token, the bag holds five, another child's thing is not found,
 * a paused seat stops play writes (not reads, not settings), and a stored thing reaches mastery through the repair pick.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bankEntriesFor } from '@lcw/content';
import { TUNING } from '@lcw/sim-core';
import { PlatformDO, type LcwEnv } from '../platform.js';
import { fakeDurableStorage } from './fake-do.js';

const TOKEN = 'op-token-0123456789abcdef';
const op = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
const anon = { 'content-type': 'application/json' };
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
async function child(p: PlatformDO, playerId: string, fam: string) {
  await call(p, 'POST', '/v1/admin/players', { family_id: fam, guardian_id: `g-${fam}`, player_id: playerId, nickname: 'Juno', birth_year: 2016, level: 'L2' });
  const inv = await call(p, 'POST', '/v1/admin/family-invites', { player_id: playerId });
  const g = bearer((await call(p, 'POST', '/v1/family/session', { invite: inv.body.invite_path.split('#k=')[1] }, anon)).body.guardian_token);
  await call(p, 'POST', '/v1/family/service-consent', { granted: true }, g);
  const seat = await call(p, 'POST', '/v1/admin/seats', { payer_player_id: playerId, plan: 'solo', term: 'month', player_ids: [playerId], amount_krw: 19_900, paid_at: Date.now() });
  const code = await call(p, 'POST', `/v1/family/children/${playerId}/device-code`, {}, g);
  const dev = bearer((await call(p, 'POST', '/v1/device/link', { code: code.body.code }, anon)).body.device_token);
  return { dev, seatId: seat.body.seat_ids[0] as string };
}
const OFFERS = bankEntriesFor('cafe', 'L2')
  .map((e) => e.offers.find((o) => o.stars >= 2 && o.price > 0)!)
  .filter(Boolean);
async function buy(p: PlatformDO, dev: Record<string, string>, i: number) {
  const o = OFFERS[i]!;
  const r = await call(
    p,
    'POST',
    '/v1/converse/score',
    { dialog_id: `buy-${i}`, chosen_stars: o.stars, hint_level: 'keyword', transcript: o.text, npc_ctx: 'cafe', target_text: o.text, mode: 'guided', stt_source: 'device', confidence: 0.95, dur_ms: 2000, latency_ms: 800 },
    dev
  );
  expect(r.status).toBe(200);
  expect(r.body.granted).not.toBeNull();
  return r.body;
}
type Item = { item_id: string; item_key: string; location: string; socket: string | null; durability: number; card: { box: number; due: boolean; mastered: boolean } | null };

afterEach(() => vi.useRealTimers());

describe('items, repair, collection, settings (docs/09 P4, docs/19)', () => {
  it('the bag holds five, the rest lands in the chest; carry/store; another child sees 404; coins come from the ledger', async () => {
    const p = platform();
    const a = await child(p, 'kid-a', 'fam-a');
    const b = await child(p, 'kid-b', 'fam-b');
    for (let i = 0; i < 7; i++) await buy(p, a.dev, i);
    const list = await call(p, 'GET', '/v1/items', undefined, a.dev);
    expect(list.status).toBe(200);
    expect(list.body.bag_slots).toBe(5);
    expect(typeof list.body.coins_total).toBe('number');
    const items = list.body.items as Item[];
    expect(items).toHaveLength(7);
    expect(items.filter((x) => x.location === 'bag')).toHaveLength(5);
    expect(items.filter((x) => x.location === 'chest')).toHaveLength(2);
    expect(items.every((x) => x.socket === null && x.card?.box === 0 && x.card.due === false && x.card.mastered === false)).toBe(true);
    expect(items[0]).toMatchObject({ item_name_ko: expect.any(String), emoji: expect.any(String), durability: 100 });

    const stored = items.find((x) => x.location === 'chest')!;
    const carried = items.find((x) => x.location === 'bag')!;
    expect(await call(p, 'POST', '/v1/items/equip', { item_id: stored.item_id, to: 'bag' }, a.dev)).toMatchObject({ status: 409, body: { error: 'bag_full', bag_slots: 5 } });
    expect(await call(p, 'POST', '/v1/items/equip', { item_id: carried.item_id, to: 'chest' }, a.dev)).toMatchObject({ status: 200, body: { ok: true, location: 'chest' } });
    expect(await call(p, 'POST', '/v1/items/equip', { item_id: stored.item_id, to: 'bag' }, a.dev)).toMatchObject({ status: 200, body: { ok: true, location: 'bag' } });
    // moving within the bag never counts against the limit
    expect((await call(p, 'POST', '/v1/items/equip', { item_id: stored.item_id, to: 'bag' }, a.dev)).status).toBe(200);
    expect((await call(p, 'POST', '/v1/items/equip', { item_id: stored.item_id, to: 'socket' }, a.dev)).status).toBe(400);

    // another child cannot see, move or pick it
    expect((await call(p, 'POST', '/v1/items/equip', { item_id: stored.item_id, to: 'chest' }, b.dev)).status).toBe(404);
    expect((await call(p, 'POST', '/v1/review/repair/pick', { item_id: carried.item_id }, b.dev)).status).toBe(404);
    expect((await call(p, 'GET', '/v1/items', undefined, b.dev)).body.items).toEqual([]);
    // a body cannot pick whose things these are
    expect((await call(p, 'POST', '/v1/items/equip', { item_id: stored.item_id, to: 'chest', player_id: 'kid-a' }, b.dev)).status).toBe(404);

    // holding a carried thing is a use; a stored or unknown thing changes nothing
    const held = await call(p, 'POST', '/v1/items/use', { item_key: stored.item_key }, a.dev);
    expect(held).toMatchObject({ status: 200, body: { ok: true } });
    // one use per unmastered card about that thing (two orders of the same drink are two cards)
    expect(held.body.uses).toBe(items.filter((x) => x.item_key === stored.item_key).length);
    expect(await call(p, 'POST', '/v1/items/use', { item_key: 'not_a_thing' }, a.dev)).toMatchObject({ status: 200, body: { ok: true, uses: 0 } });
    expect((await call(p, 'POST', '/v1/items/use', { item_key: carried.item_key }, b.dev)).body.uses).toBe(0);
  });

  it('auth: no token 401; a paused seat stops pick/carry/hold (403) but not reads or settings; a lesson token reads too', async () => {
    const p = platform();
    const a = await child(p, 'kid-a', 'fam-a');
    await buy(p, a.dev, 0);
    for (const [m, path, body] of [
      ['GET', '/v1/items'],
      ['GET', '/v1/review/repair'],
      ['GET', '/v1/collection'],
      ['GET', '/v1/settings'],
      ['POST', '/v1/items/equip', { item_id: 'x', to: 'bag' }],
      ['POST', '/v1/items/use', { item_key: 'water' }],
      ['POST', '/v1/review/repair/pick', { item_id: 'x' }],
      ['PUT', '/v1/settings', { settings: { volume: 1 } }]
    ] as Array<[string, string, unknown?]>) {
      expect({ path, m, status: (await call(p, m, path, body, anon)).status }).toEqual({ path, m, status: 401 });
    }
    const item = ((await call(p, 'GET', '/v1/items', undefined, a.dev)).body.items as Item[])[0]!;
    await call(p, 'POST', `/v1/admin/seats/${a.seatId}/refund`, {});
    expect(await call(p, 'POST', '/v1/items/equip', { item_id: item.item_id, to: 'chest' }, a.dev)).toMatchObject({ status: 403, body: { error: 'seat_inactive' } });
    expect((await call(p, 'POST', '/v1/items/use', { item_key: item.item_key }, a.dev)).status).toBe(403);
    expect((await call(p, 'POST', '/v1/review/repair/pick', { item_id: item.item_id }, a.dev)).status).toBe(403);
    for (const path of ['/v1/items', '/v1/review/repair', '/v1/collection', '/v1/settings']) {
      expect({ path, status: (await call(p, 'GET', path, undefined, a.dev)).status }).toEqual({ path, status: 200 });
    }
    expect((await call(p, 'PUT', '/v1/settings', { settings: { volume: 0.5 } }, a.dev)).status).toBe(200);

    const st = await call(p, 'POST', '/v1/admin/lessons/start', { player_id: 'kid-a' });
    const stu = bearer((await call(p, 'POST', '/v1/join', { code: st.body.join_code }, anon)).body.student_token);
    const viaLesson = await call(p, 'GET', '/v1/items', undefined, stu);
    expect(viaLesson.status).toBe(200);
    expect(viaLesson.body.items.map((x: Item) => x.item_id)).toEqual([item.item_id]);
    expect((await call(p, 'POST', '/v1/items/equip', { item_id: item.item_id, to: 'chest' }, stu)).status).toBe(200);
  });

  it('a stored thing is reviewed at the repair NPC and reaches mastery (20 min → … → 35 days), paying the bonus once', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    let now = Date.parse('2026-09-01T01:00:00Z');
    vi.setSystemTime(now);
    const p = platform();
    const a = await child(p, 'kid-a', 'fam-a');
    // 35 days and more of reviews: the guardian keeps the seat paid
    expect((await call(p, 'POST', `/v1/admin/seats/${a.seatId}/extend`, { days: 90, amount_krw: 59_700 })).status).toBe(200);
    for (let i = 0; i < 6; i++) await buy(p, a.dev, i);
    const stored = ((await call(p, 'GET', '/v1/items', undefined, a.dev)).body.items as Item[]).find((x) => x.location === 'chest')!;
    expect((await call(p, 'POST', '/v1/review/repair/pick', { item_id: stored.item_id }, a.dev))).toMatchObject({ status: 409, body: { error: 'not_due' } });
    expect((await call(p, 'POST', '/v1/review/repair/pick', { item_id: 'buy-nope|water' }, a.dev)).status).toBe(404);

    let mastered = false;
    let bonus = 0;
    for (let step = 0; step < 6 && !mastered; step++) {
      now += TUNING.memory.intervalsMs[step]! + 60_000;
      vi.setSystemTime(now);
      const repair = await call(p, 'GET', '/v1/review/repair', undefined, a.dev);
      expect(repair.status).toBe(200);
      expect(repair.body.items).toContainEqual(expect.objectContaining({ item_id: stored.item_id, item_key: stored.item_key, due: true }));
      const pick = await call(p, 'POST', '/v1/review/repair/pick', { item_id: stored.item_id }, a.dev);
      expect(pick.status).toBe(200);
      expect(pick.body).toMatchObject({ ok: true, sign: { item_key: stored.item_key, box: step, text: expect.any(String) } });
      const r = await call(p, 'POST', '/v1/review/attempt', { card_id: pick.body.sign.card_id, transcript: pick.body.sign.text, stt_source: 'device', confidence: 0.95 }, a.dev);
      expect(r.status).toBe(200);
      expect(r.body.pass).toBe(true);
      mastered = r.body.mastered;
      bonus += r.body.bonus_coins;
    }
    expect(mastered).toBe(true);
    expect(bonus).toBe(TUNING.memory.masterBonusCoins);
    const after = ((await call(p, 'GET', '/v1/items', undefined, a.dev)).body.items as Item[]).find((x) => x.item_id === stored.item_id)!;
    expect(after.card).toEqual({ box: 6, due: false, mastered: true });
    expect((await call(p, 'GET', '/v1/review/repair', undefined, a.dev)).body.items.map((x: Item) => x.item_id)).not.toContain(stored.item_id);
    expect(await call(p, 'POST', '/v1/review/repair/pick', { item_id: stored.item_id }, a.dev)).toMatchObject({ status: 409, body: { error: 'already_mastered' } });
  });

  it('collection: six books from content, found only from server records', async () => {
    const p = platform();
    const a = await child(p, 'kid-a', 'fam-a');
    await buy(p, a.dev, 0);
    await buy(p, a.dev, 1);
    const r = await call(p, 'GET', '/v1/collection', undefined, a.dev);
    expect(r.status).toBe(200);
    const books = r.body.books as Array<{ id: string; total: number; found: number; entries: Array<{ key: string; name_ko: string; found: boolean }> }>;
    expect(books.map((b) => b.id)).toEqual(['blocks', 'minerals', 'enemies', 'food', 'outfits', 'expressions']);
    const by = Object.fromEntries(books.map((b) => [b.id, b]));
    expect(by.blocks!.total).toBe(40);
    expect(by.minerals!.total).toBe(7);
    expect(by.enemies).toMatchObject({ total: 8, found: 0 });
    expect(by.food!.found).toBeGreaterThanOrEqual(1);
    expect(by.expressions!.found).toBeGreaterThanOrEqual(1);
    for (const b of books) expect(b.found).toBe(b.entries.filter((e) => e.found).length);
    // the other child found nothing
    const other = await child(p, 'kid-b', 'fam-b');
    const empty = (await call(p, 'GET', '/v1/collection', undefined, other.dev)).body.books as Array<{ found: number }>;
    expect(empty.map((b) => b.found)).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('settings: saved per child and read back on another device; shape checked; another child reads only their own', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.parse('2026-09-01T01:00:00Z'));
    const p = platform();
    const a = await child(p, 'kid-a', 'fam-a');
    const b = await child(p, 'kid-b', 'fam-b');
    expect((await call(p, 'GET', '/v1/settings', undefined, a.dev)).body).toEqual({ settings: {}, updated_at: null });
    const put = await call(p, 'PUT', '/v1/settings', { settings: { volume: 0.4, 'sound.music': false, hand: 'left' } }, a.dev);
    expect(put).toMatchObject({ status: 200, body: { ok: true, updated_at: Date.parse('2026-09-01T01:00:00Z') } });
    expect((await call(p, 'GET', '/v1/settings', undefined, a.dev)).body).toEqual({
      settings: { volume: 0.4, 'sound.music': false, hand: 'left' },
      updated_at: Date.parse('2026-09-01T01:00:00Z')
    });
    // the same child on a lesson token reads the same row
    const st = await call(p, 'POST', '/v1/admin/lessons/start', { player_id: 'kid-a' });
    const stu = bearer((await call(p, 'POST', '/v1/join', { code: st.body.join_code }, anon)).body.student_token);
    expect((await call(p, 'GET', '/v1/settings', undefined, stu)).body.settings).toEqual({ volume: 0.4, 'sound.music': false, hand: 'left' });
    // another child: their own (empty) row, and a body player_id does not reach someone else's
    expect((await call(p, 'GET', '/v1/settings?player_id=kid-a', undefined, b.dev)).body).toEqual({ settings: {}, updated_at: null });
    await call(p, 'PUT', '/v1/settings', { settings: { volume: 1 }, player_id: 'kid-a' }, b.dev);
    expect((await call(p, 'GET', '/v1/settings', undefined, a.dev)).body.settings.volume).toBe(0.4);

    const many = Object.fromEntries(Array.from({ length: 41 }, (_, i) => [`k${i}`, i]));
    for (const bad of [
      { nested: { a: 1 } },
      { list: [1] },
      { long: 'x'.repeat(33) },
      { Bad: 1 },
      { '1st': 1 },
      many,
      { nothing: null }
    ]) {
      const r = await call(p, 'PUT', '/v1/settings', { settings: bad }, a.dev);
      expect({ bad: Object.keys(bad)[0], status: r.status, error: r.body.error }).toEqual({ bad: Object.keys(bad)[0], status: 400, error: 'invalid_settings' });
    }
    expect((await call(p, 'PUT', '/v1/settings', { settings: [1, 2] }, a.dev)).status).toBe(400);
    expect((await call(p, 'PUT', '/v1/settings', {}, a.dev)).status).toBe(400);
    expect((await call(p, 'GET', '/v1/settings', undefined, a.dev)).body.settings.volume).toBe(0.4);
  });
});
