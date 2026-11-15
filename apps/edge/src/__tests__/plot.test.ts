import { describe, expect, it } from 'vitest';
import { BK, PLOT_CHEST_POS, blockRef, furnitureRef } from '@lcw/sim-core';
import { PlatformDO, homeWorldId, type LcwEnv } from '../platform.js';
import { PlotStore, baseTownPlot } from '../plot.js';
import { createNodeSqliteExecutor } from '../node-sqlite.js';
import { fakeDurableStorage } from './fake-do.js';

/**
 * WP-201/205/207 (docs/03 D13): my plot through the real gateway — the child's device token picks the home world,
 * the server re-judges every op (AGENTS 4: never trust the client), saves only the delta, survives a restart and a
 * failed write, and a paused seat stops building but not looking.
 */

const TOKEN = 'op-token-0123456789abcdef';
const op = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
const anon = { 'content-type': 'application/json' };
const bearer = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const env = { PLATFORM: undefined as never, LCW_OPERATOR_TOKEN: TOKEN } as LcwEnv;

async function call(p: PlatformDO, method: string, path: string, body?: unknown, headers: Record<string, string> = op) {
  const res = await p.fetch(new Request(`https://x${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as any };
}

async function linkedChild(p: PlatformDO) {
  await call(p, 'POST', '/v1/admin/players', { family_id: 'fam-kim', guardian_id: 'g-kim', player_id: 'kid-1', nickname: 'Juno', birth_year: 2016, level: 'L1' });
  const inv = await call(p, 'POST', '/v1/admin/family-invites', { player_id: 'kid-1' });
  const s = await call(p, 'POST', '/v1/family/session', { invite: inv.body.invite_path.split('#k=')[1] }, anon);
  const g = bearer(s.body.guardian_token);
  await call(p, 'POST', '/v1/family/service-consent', { granted: true }, g);
  const code = await call(p, 'POST', '/v1/family/children/kid-1/device-code', {}, g);
  const link = await call(p, 'POST', '/v1/device/link', { code: code.body.code, label: '태블릿' }, anon);
  expect(link.status).toBe(200);
  return { dev: bearer(link.body.device_token), g };
}

const X = 126;
const Z = 170;

describe('my plot on the server (WP-201/205/207)', () => {
  it('starts from the town plot with the starter bag, saves only what changed, and survives a restart', async () => {
    const storage = fakeDurableStorage();
    const p = new PlatformDO({ storage }, env);
    const { dev } = await linkedChild(p);
    const first = await call(p, 'GET', '/v1/plot', undefined, dev);
    expect(first.status).toBe(200);
    expect(first.body.cells).toEqual([]);
    expect(first.body.inv.slots[0]).toEqual({ ref: blockRef(BK.oakPlank), n: 32 });

    const r = await call(
      p,
      'POST',
      '/v1/plot/ops',
      {
        ops: [
          { op: 'place', x: X, y: 1, z: Z, slot: 0 },
          { op: 'place', x: X, y: 2, z: Z, slot: 1 },
          { op: 'place', x: 140, y: 1, z: 140, slot: 0 }, // the plaza: not my plot
          { op: 'break', x: PLOT_CHEST_POS.x, y: PLOT_CHEST_POS.y, z: PLOT_CHEST_POS.z },
          { op: 'take', ref: furnitureRef('furn_chair_wood'), n: 1, slot: 4 },
          { op: 'place', x: X + 1, y: 1, z: Z, slot: 4 },
          // a forged op cannot name a player, a world, or a free block
          { op: 'take', ref: 'b10', n: 50 },
          { op: 'place', x: X, y: 3, z: Z, slot: 0, player_id: 'kid-2', block_id: 10 }
        ],
        player_id: 'kid-2',
        world_id: homeWorldId('kid-2')
      },
      dev
    );
    expect(r.status).toBe(200);
    expect(r.body.results.map((x: any) => x.reason ?? 'ok')).toEqual(['ok', 'ok', 'not_my_plot', 'chest', 'ok', 'ok', 'bad_op', 'ok']);
    expect(r.body.inv.slots[0]).toEqual({ ref: blockRef(BK.oakPlank), n: 30 });
    expect(r.body.rev).toBe(1);

    // a new DO instance over the same storage (eviction / deploy) loads the same plot
    const p2 = new PlatformDO({ storage }, env);
    const again = await call(p2, 'GET', '/v1/plot', undefined, dev);
    expect(again.body.cells).toEqual([
      [X, 1, Z, BK.oakPlank],
      [X, 2, Z, BK.brick],
      [X, 3, Z, BK.oakPlank]
    ]);
    expect(again.body.furniture).toEqual([[X + 1, 1, Z, 'furn_chair_wood', 0]]);
    expect(again.body.inv).toEqual(r.body.inv);
    expect(again.body.rev).toBe(1);
    // and only the child's own home world holds it
    const kid2 = await call(p2, 'GET', `/v1/plot?player_id=kid-2&world_id=${homeWorldId('kid-2')}`);
    expect(kid2.status).toBe(404);

    // breaking back to the town block removes the saved row (delta only)
    await call(p2, 'POST', '/v1/plot/ops', { ops: [{ op: 'break', x: X, y: 3, z: Z }, { op: 'break', x: X, y: 2, z: Z }] }, dev);
    expect((await call(p2, 'GET', '/v1/plot', undefined, dev)).body.cells).toEqual([[X, 1, Z, BK.oakPlank]]);
  });

  it('needs a child token (or the operator); a paused seat may look but not build', async () => {
    const p = new PlatformDO({ storage: fakeDurableStorage() }, env);
    const { dev, g } = await linkedChild(p);
    expect((await call(p, 'GET', '/v1/plot', undefined, anon)).status).toBe(401);
    expect((await call(p, 'POST', '/v1/plot/ops', { ops: [{ op: 'swap', a: 0, b: 1 }] }, anon)).status).toBe(401);
    expect((await call(p, 'POST', '/v1/plot/ops', { ops: [] }, dev)).status).toBe(400);
    expect((await call(p, 'POST', '/v1/plot/ops', { ops: Array.from({ length: 65 }, () => ({ op: 'swap', a: 0, b: 1 })) }, dev)).status).toBe(400);

    const issued = await call(p, 'POST', '/v1/admin/seats', { payer_guardian_id: 'g-kim', plan: 'solo', term: 'month', player_ids: ['kid-1'] });
    expect(issued.status).toBe(201);
    const sid = issued.body.seat_ids[0];
    await call(p, 'POST', `/v1/family/seats/${sid}/refund-request`, {}, g);
    await call(p, 'POST', `/v1/admin/seats/${sid}/refund`, {});
    expect((await call(p, 'GET', '/v1/device/me', undefined, dev)).body.play_allowed).toBe(false);
    expect((await call(p, 'GET', '/v1/plot', undefined, dev)).status).toBe(200);
    const blocked = await call(p, 'POST', '/v1/plot/ops', { ops: [{ op: 'place', x: X, y: 1, z: Z, slot: 0 }] }, dev);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toBe('seat_inactive');
  });
});

describe('PlotStore (WP-205 crash safety, pace)', () => {
  const sql = () => createNodeSqliteExecutor(':memory:');

  it('a write that fails mid-transaction leaves neither disk nor memory changed', () => {
    const db = sql();
    const s = new PlotStore(db, 'kid', 0);
    expect(() => s.applyOps([{ op: 'place', x: X, y: 1, z: Z, slot: 0 }], 1000, { simulateCrashMidTx: true })).toThrow('simulated_tx_abort');
    expect(db.all('select * from plot_cells')).toEqual([]);
    expect(s.plotState.world.getBlock(X, 1, Z)).toBe(0);
    expect(s.plotState.inv.slots[0]?.n).toBe(32);
    expect(s.snapshot().rev).toBe(0);
    // the same op then goes through normally
    expect(s.applyOps([{ op: 'place', x: X, y: 1, z: Z, slot: 0 }], 2000).results).toEqual([{ ok: true }]);
    expect(new PlotStore(db, 'kid', 0).plotState.world.getBlock(X, 1, Z)).toBe(BK.oakPlank);
  });

  it('holds a flood of place ops to the D13 pace without reordering or losing any', () => {
    const s = new PlotStore(sql(), 'kid', 0);
    const ops = Array.from({ length: 30 }, (_v, i) => ({ op: 'place', x: 102 + (i % 20), y: 1, z: 180 + Math.floor(i / 20), slot: 1 }));
    const out = s.applyOps(ops, 0, { batch: 'batch-0001' });
    // stops where the pace ran out; the client sends the rest again, in order
    expect(out.processed).toBe(10);
    expect(out.results.every((r) => r.ok)).toBe(true);
    expect(s.plotState.inv.slots[1]?.n).toBe(32 - 10);
    // the same batch again (lost reply) is answered from the journal, not applied twice
    expect(s.applyOps(ops, 100, { batch: 'batch-0001' }).processed).toBe(10);
    expect(s.plotState.inv.slots[1]?.n).toBe(32 - 10);
    // two seconds later the remainder goes through at the pace
    const rest = s.applyOps(ops.slice(10), 2000, { batch: 'batch-0002' });
    expect(rest.processed).toBe(10);
    expect(s.plotState.inv.slots[1]?.n).toBe(32 - 20);
  });

  it('a shop grant lands in the chest and is saved', () => {
    const db = sql();
    const s = new PlotStore(db, 'kid', 0);
    expect(s.grant(furnitureRef('furn_bed_single'), 1, 5, 'shop:trade_shop')).toBe(true);
    expect(s.grant('b6' as never, 1, 5, 'x')).toBe(false);
    expect(new PlotStore(db, 'kid', 0).plotState.inv.chest[furnitureRef('furn_bed_single')]).toBe(2);
  });

  it('the town plot builds once per isolate', () => {
    const t0 = performance.now();
    baseTownPlot();
    expect(performance.now() - t0).toBeLessThan(50);
  });
});
