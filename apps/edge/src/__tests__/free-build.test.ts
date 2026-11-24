import { describe, expect, it } from 'vitest';
import { BK, FREE_MAX_CELLS, OverlayWorld, blockRef, naturalBlock, recoveredBlock, naturalHeight, starterInventory, terrainHeight } from '@lcw/sim-core';
import { shopItem } from '@lcw/content';
import { PlatformDO, homeWorldId, type LcwEnv } from '../platform.js';
import { PlotStore, baseTownWorld, worldTag } from '../plot.js';
import { createNodeSqliteExecutor } from '../node-sqlite.js';
import { fakeDurableStorage } from './fake-do.js';

/**
 * R326 free build (docs/03 D13 자유 건축) on the server: a child builds and digs anywhere in their own world the
 * town rules allow, the server re-judges every op with the same sim-core rule, keeps the cells that differ from the
 * town across a restart, refuses the town's places, and a lesson token builds on the plot only.
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
  return { dev: bearer(link.body.device_token), g };
}

const MX = 210;
const MZ = 214;
const H = terrainHeight(MX, MZ);

describe('free build through the gateway (R326)', () => {
  it('builds a tower on the meadow, digs a hole, breaks the shop wall, digs deep and far (R2861①); all of it is there after a restart', async () => {
    const storage = fakeDurableStorage();
    const p = new PlatformDO({ storage }, env);
    const { dev } = await linkedChild(p);
    const first = await call(p, 'GET', '/v1/plot', undefined, dev);
    expect(first.body.scope).toBe('world');
    expect(first.body.world_tag).toBe(worldTag(homeWorldId('kid-1')));
    const r = await call(
      p,
      'POST',
      '/v1/plot/ops',
      {
        ops: [
          { op: 'place', x: MX, y: H + 1, z: MZ, slot: 1 },
          { op: 'place', x: MX, y: H + 2, z: MZ, slot: 1 },
          { op: 'place', x: MX, y: H + 3, z: MZ, slot: 1 },
          { op: 'break', x: MX + 2, y: H, z: MZ },
          { op: 'break', x: 116, y: 1, z: 128 }, // the trade shop's wall (R2861①: the town breaks too)
          { op: 'place', x: 144, y: 3, z: 143, slot: 0 }, // over the east-west road
          { op: 'break', x: MX + 4, y: -450, z: MZ }, // deep under the meadow (the old floor was y -1)
          { op: 'break', x: 9000, y: naturalHeight(9000, -7000), z: -7000 } // 9 km out, past the old edge
        ],
        // a forged scope in the body changes nothing: the platform sets it from the token
        plot_only: false
      },
      dev
    );
    expect(r.status).toBe(200);
    expect(r.body.results.map((x: any) => x.reason ?? 'ok')).toEqual(['ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok']);
    const p2 = new PlatformDO({ storage }, env);
    const again = await call(p2, 'GET', '/v1/plot', undefined, dev);
    const cells = new Set(again.body.cells.map((c: number[]) => c.join(',')));
    for (const c of [
      [MX + 2, H, MZ, 0],
      [MX, H + 1, MZ, BK.brick],
      [MX, H + 2, MZ, BK.brick],
      [MX, H + 3, MZ, BK.brick],
      [116, 1, 128, 0],
      [MX + 4, -450, MZ, 0],
      [9000, naturalHeight(9000, -7000), -7000, 0]
    ]) {
      expect(cells.has(c.join(','))).toBe(true);
    }
    expect(again.body.cells.length).toBe(8);
    // the deep cell dug was the natural stone of the deep, given back to the bag
    expect(naturalBlock(MX + 4, -450, MZ)).not.toBe(0);
    // the dug grass went to the carried stacks or the chest
    const grass = (again.body.inv.chest['b3'] ?? 0) + again.body.inv.slots.reduce((n: number, s: any) => n + (s?.ref === 'b3' ? s.n : 0), 0);
    expect(grass).toBe(18); // the meadow dig and the far surface dig (9 km out) each gave a grass
  });

  it('a lesson token builds on the plot only, also when the body says otherwise', async () => {
    const p = new PlatformDO({ storage: fakeDurableStorage() }, env);
    await call(p, 'POST', '/v1/admin/players', { family_id: 'fam-lee', guardian_id: 'g-lee', player_id: 'kid-2', nickname: 'Mia', birth_year: 2016, level: 'L1' });
    const st = await call(p, 'POST', '/v1/admin/lessons/start', { player_id: 'kid-2' });
    const join = await call(p, 'POST', '/v1/join', { code: st.body.join_code }, anon);
    const stu = bearer(join.body.student_token);
    expect((await call(p, 'GET', '/v1/plot?plot_only=', undefined, stu)).body.scope).toBe('plot');
    const r = await call(p, 'POST', '/v1/plot/ops', { ops: [{ op: 'place', x: MX, y: H + 1, z: MZ, slot: 0 }, { op: 'place', x: 126, y: 1, z: 170, slot: 0 }], plot_only: false }, stu);
    expect(r.body.results).toEqual([{ ok: false, reason: 'not_my_plot' }, { ok: true }]);
  });

  it('in a lesson the home world free build stays out of the class town (the snapshot holds the plot only)', async () => {
    const p = new PlatformDO({ storage: fakeDurableStorage() }, env);
    const { dev } = await linkedChild(p);
    await call(p, 'POST', '/v1/plot/ops', { ops: [{ op: 'place', x: MX, y: H + 1, z: MZ, slot: 1 }, { op: 'place', x: 126, y: 1, z: 170, slot: 0 }] }, dev);
    expect((await call(p, 'GET', '/v1/plot', undefined, dev)).body.cells).toHaveLength(2);
    const st = await call(p, 'POST', '/v1/admin/lessons/start', { player_id: 'kid-1' });
    const stu = bearer((await call(p, 'POST', '/v1/join', { code: st.body.join_code }, anon)).body.student_token);
    const inLesson = await call(p, 'GET', '/v1/plot', undefined, stu);
    expect(inLesson.body.scope).toBe('plot');
    expect(inLesson.body.cells).toEqual([[126, 1, 170, BK.oakPlank]]);
  });
});

describe('the town comes back from the server record (R2861① "마을도 부술 수 있게")', () => {
  async function brokeTown() {
    const storage = fakeDurableStorage();
    const p = new PlatformDO({ storage }, env);
    const { dev } = await linkedChild(p);
    await call(p, 'GET', '/v1/plot', undefined, dev);
    const r = await call(
      p,
      'POST',
      '/v1/plot/ops',
      {
        ops: [
          { op: 'break', x: 116, y: 1, z: 128 }, // the trade shop's wall
          { op: 'break', x: 116, y: 2, z: 128 },
          { op: 'place', x: 144, y: 3, z: 143, slot: 1 }, // a brick over the road
          { op: 'break', x: MX + 4, y: -450, z: MZ }, // deep
          { op: 'place', x: 126, y: 1, z: 170, slot: 0 } // on the child's own plot: never restored
        ]
      },
      dev
    );
    expect(r.body.results.every((x: any) => x.ok)).toBe(true);
    return { p, storage, dev };
  }
  const town = baseTownWorld();

  it("the child puts their own town back: the town cells are the town builder's again, the plot is kept, nothing minted", async () => {
    const { p, storage, dev } = await brokeTown();
    const before = await call(p, 'GET', '/v1/plot', undefined, dev);
    expect(before.body.cells).toHaveLength(5);
    const res = await call(p, 'POST', '/v1/plot/restore', {}, dev);
    expect(res.status).toBe(200);
    expect(res.body.restored).toBe(4);
    const after = await call(new PlatformDO({ storage }, env), 'GET', '/v1/plot', undefined, dev);
    expect(after.body.cells).toEqual([[126, 1, 170, BK.oakPlank]]);
    // the brick placed over the road came back to the chest; the wall blocks dug were taken back from the hand
    const count = (inv: any, ref: string) => (inv.chest[ref] ?? 0) + inv.slots.reduce((n: number, s: any) => n + (s?.ref === ref ? s.n : 0), 0);
    // each town block dug (the two wall cells, the deep stone) is taken back once
    const owed = new Map<string, number>();
    for (const [x, y, z] of [[116, 1, 128], [116, 2, 128], [MX + 4, -450, MZ]] as const) {
      const id = town.getBlock(x, y, z);
      expect(id).not.toBe(0);
      const ref = blockRef(recoveredBlock(id)!);
      owed.set(ref, (owed.get(ref) ?? 0) + 1);
    }
    if (!owed.has(blockRef(BK.brick))) owed.set(blockRef(BK.brick), 0);
    for (const [ref, n] of owed) expect(count(after.body.inv, ref)).toBe(count(before.body.inv, ref) - n + (ref === blockRef(BK.brick) ? 1 : 0));
  });

  it("the teacher puts a child's town back by name, inside a circle only", async () => {
    const { p, dev } = await brokeTown();
    const res = await call(p, 'POST', '/v1/plot/restore', { player_id: 'kid-1', x: 116, z: 128, r: 6 });
    expect(res.status).toBe(200);
    expect(res.body.restored).toBe(2);
    const after = await call(p, 'GET', '/v1/plot', undefined, dev);
    const left = after.body.cells.map((c: number[]) => c.slice(0, 3).join(',')).sort();
    expect(left).toEqual([`${MX + 4},-450,${MZ}`, '126,1,170', '144,3,143'].sort());
    // bad circles and unknown children are refused; a child's token without a device (a lesson) may not
    expect((await call(p, 'POST', '/v1/plot/restore', { player_id: 'kid-1', x: 1, z: 1, r: 0 })).status).toBe(400);
    expect((await call(p, 'POST', '/v1/plot/restore', { player_id: 'nobody' })).status).toBe(404);
    expect((await call(p, 'POST', '/v1/plot/restore', {}, anon)).status).toBe(401);
    const st = await call(p, 'POST', '/v1/admin/lessons/start', { player_id: 'kid-1' });
    const stu = bearer((await call(p, 'POST', '/v1/join', { code: st.body.join_code }, anon)).body.student_token);
    expect((await call(p, 'POST', '/v1/plot/restore', {}, stu)).status).toBe(403);
  });

  it('a restore is one journal line with its actor; a world with nothing out there writes nothing', () => {
    const db = createNodeSqliteExecutor(':memory:');
    const s = new PlotStore(db, 'kid', 0);
    expect(s.restoreTown(500, 'teacher')).toEqual({ restored: 0, furniture: 0, rev: 0 });
    s.applyOps([{ op: 'break', x: 116, y: 1, z: 128 }], 1000);
    expect(s.plotState.world.getBlock(116, 1, 128)).toBe(0);
    const out = s.restoreTown(4000, 'teacher', { x: 116, z: 128, r: 3 });
    expect(out.restored).toBe(1);
    expect(s.plotState.world.getBlock(116, 1, 128)).toBe(baseTownWorld().getBlock(116, 1, 128));
    const j = db.all<{ actor: string; ops: string }>('select actor, ops from plot_journal order by seq');
    expect(j.at(-1)).toEqual({ actor: 'teacher', ops: JSON.stringify([{ op: 'restore', n: 1, furniture: 0, area: { x: 116, z: 128, r: 3 } }]) });
    expect(db.all('select * from plot_cells')).toEqual([]);
    // and it can be broken again after (the restore is not a lock)
    expect(s.applyOps([{ op: 'break', x: 116, y: 1, z: 128 }], 9000).results[0]).toEqual({ ok: true });
  });
});

describe('PlotStore over the shared town (R326)', () => {
  const sql = () => createNodeSqliteExecutor(':memory:');

  it('reads through one shared town and holds only its own changes', () => {
    const a = new PlotStore(sql(), 'kid-a', 0);
    const b = new PlotStore(sql(), 'kid-b', 0);
    expect(a.plotState.world).toBeInstanceOf(OverlayWorld);
    a.applyOps([{ op: 'place', x: MX, y: H + 1, z: MZ, slot: 0 }], 1000);
    expect(a.plotState.world.getBlock(MX, H + 1, MZ)).toBe(BK.oakPlank);
    expect(b.plotState.world.getBlock(MX, H + 1, MZ)).toBe(0);
    expect(baseTownWorld().getBlock(MX, H + 1, MZ)).toBe(0);
    expect((a.plotState.world as OverlayWorld).changedCount).toBe(1);
  });

  it('breaking a placed block back to the town drops the row; at the cap one cell more is refused (memory measured)', () => {
    const db = sql();
    const s = new PlotStore(db, 'kid', 0);
    s.applyOps([{ op: 'place', x: MX, y: H + 1, z: MZ, slot: 0 }], 1000);
    s.applyOps([{ op: 'break', x: MX, y: H + 1, z: MZ }], 3000);
    expect(db.all('select * from plot_cells')).toEqual([]);
    // fill a world to the cap directly in storage (real edits are paced) and load it again
    const rows: string[] = [];
    let n = 0;
    for (let z = 30; z < 260 && n < FREE_MAX_CELLS; z++) {
      for (let x = 200; x < 262 && n < FREE_MAX_CELLS; x++) {
        for (let dy = 1; dy <= 4 && n < FREE_MAX_CELLS; dy++) {
          rows.push(`(${x}, ${terrainHeight(x, z) + dy}, ${z}, ${BK.glass})`);
          n++;
        }
      }
    }
    for (let i = 0; i < rows.length; i += 500) db.exec(`insert into plot_cells (x, y, z, id) values ${rows.slice(i, i + 500).join(',')}`);
    const before = process.memoryUsage().heapUsed;
    const full = new PlotStore(db, 'kid', 0);
    const mb = (process.memoryUsage().heapUsed - before) / 1e6;
    expect((full.plotState.world as OverlayWorld).changedOutsidePlot).toBe(FREE_MAX_CELLS);
    // what a resident world keeps: one Map entry per changed cell and no chunk of its own (a full town copy would be
    // 516 chunks, ~6.7 MB per world). The heap figure below is a single-run read-out (GC timing makes it noisy).
    expect(full.plotState.world.chunks.size).toBe(0);
    expect((full.plotState.world as OverlayWorld).changedCount).toBe(FREE_MAX_CELLS);
    const out = full.applyOps([{ op: 'place', x: 30, y: terrainHeight(30, 30) + 1, z: 30, slot: 0 }, { op: 'place', x: 126, y: 1, z: 170, slot: 0 }], 9000);
    expect(out.results).toEqual([{ ok: false, reason: 'too_many' }, { ok: true }]);
    console.log(`[R326] world at the cap: ${FREE_MAX_CELLS} cells, heap +${mb.toFixed(2)} MB, snapshot ${JSON.stringify(full.snapshot()).length} bytes`);
  });
});

describe('shop block bundles become build stock (R326, docs/19 9장)', () => {
  const total = (inv: { slots: Array<{ ref: string; n: number } | null>; chest: Record<string, number> }, ref: string) =>
    inv.slots.reduce((n, s) => n + (s?.ref === ref ? s.n : 0), 0) + (inv.chest[ref] ?? 0);

  it('a bought bundle opens once into the hand and chest at the next plot read, and is gone from the bag', async () => {
    const p = new PlatformDO({ storage: fakeDurableStorage() }, env);
    const { dev } = await linkedChild(p);
    const before = await call(p, 'GET', '/v1/plot', undefined, dev);
    const pack = shopItem('mat_plank')!;
    expect(pack.block).toEqual({ key: 'plank', count: 16 });
    const shop = await call(p, 'GET', '/v1/shop', undefined, dev);
    expect(shop.body.coins_total).toBeGreaterThanOrEqual(shop.body.prices.mat_plank);
    const buy = await call(p, 'POST', '/v1/shop/buy', { item_key: 'mat_plank', request_id: 'req-plank-001' }, dev);
    expect(buy.status).toBe(201);
    const after = await call(p, 'GET', '/v1/plot', undefined, dev);
    expect(total(after.body.inv, blockRef(BK.plank)) - total(before.body.inv, blockRef(BK.plank))).toBe(16);
    expect(after.body.rev).toBe(before.body.rev + 1);
    expect(after.body.inv.slots.some((x: { ref: string } | null) => x?.ref === blockRef(BK.plank))).toBe(true); // in the hotbar
    // read again (and a resent purchase): nothing opens twice
    await call(p, 'POST', '/v1/shop/buy', { item_key: 'mat_plank', request_id: 'req-plank-001' }, dev);
    const again = await call(p, 'GET', '/v1/plot', undefined, dev);
    expect(total(again.body.inv, blockRef(BK.plank))).toBe(total(after.body.inv, blockRef(BK.plank)));
    expect((await call(p, 'GET', '/v1/shop', undefined, dev)).body.owned.mat_plank ?? 0).toBe(0);
    // one bought mid-play opens with the next edit, and the answer says so
    await call(p, 'POST', '/v1/shop/buy', { item_key: 'mat_plank', request_id: 'req-plank-002' }, dev);
    const ops = await call(p, 'POST', '/v1/plot/ops', { ops: [{ op: 'place', x: MX, y: H + 1, z: MZ, slot: 0 }] }, dev);
    expect(ops.body.unpacked).toBe(1);
    expect(total(ops.body.inv, blockRef(BK.plank))).toBe(total(again.body.inv, blockRef(BK.plank)) + 16);
  });

  it('a bundle opens after the batch: the slot numbers the device chose still mean what it showed', async () => {
    const p = new PlatformDO({ storage: fakeDurableStorage() }, env);
    const { dev } = await linkedChild(p);
    expect((await call(p, 'POST', '/v1/shop/buy', { item_key: 'mat_plank', request_id: 'req-plank-101' }, dev)).status).toBe(201);
    // the hand is full (five starter stacks) and slot 4 shows the torches
    const r = await call(p, 'POST', '/v1/plot/ops', { ops: [{ op: 'place', x: MX, y: H + 1, z: MZ, slot: 4 }] }, dev);
    expect(r.body.results).toEqual([{ ok: true }]);
    expect(r.body.unpacked).toBe(1);
    const after = await call(p, 'GET', '/v1/plot', undefined, dev);
    expect(after.body.cells).toEqual([[MX, H + 1, MZ, BK.torch]]);
    expect(after.body.inv.slots[4]).toEqual({ ref: blockRef(BK.plank), n: 16 });
    // the torch stack (8 in hand, one placed) went to the chest beside the starter torches: none lost
    expect(total(after.body.inv, blockRef(BK.torch))).toBe(total(starterInventory() as never, blockRef(BK.torch)) - 1);
    expect(after.body.inv.chest[blockRef(BK.torch)]).toBe(total(starterInventory() as never, blockRef(BK.torch)) - 1);
  });

  it('a read-only seat looks at its plot without opening a bundle (opening is a write)', async () => {
    const p = new PlatformDO({ storage: fakeDurableStorage() }, env);
    const { dev, g } = await linkedChild(p);
    // bought before the seat (a used seat cannot be refunded), then the seat is refunded: play stops, looking stays
    expect((await call(p, 'POST', '/v1/shop/buy', { item_key: 'mat_plank', request_id: 'req-plank-201' }, dev)).status).toBe(201);
    const issued = await call(p, 'POST', '/v1/admin/seats', { payer_guardian_id: 'g-kim', plan: 'solo', term: 'month', player_ids: ['kid-1'] });
    const sid = issued.body.seat_ids[0];
    await call(p, 'POST', `/v1/family/seats/${sid}/refund-request`, {}, g);
    await call(p, 'POST', `/v1/admin/seats/${sid}/refund`, {});
    expect((await call(p, 'GET', '/v1/device/me', undefined, dev)).body.play_allowed).toBe(false);
    const look = await call(p, 'GET', '/v1/plot', undefined, dev);
    expect(look.status).toBe(200);
    expect(total(look.body.inv, blockRef(BK.plank))).toBe(16);
    expect((await call(p, 'GET', '/v1/shop', undefined, dev)).body.owned.mat_plank).toBe(1);
  });

  it('opens only unopened bundles of the owner, the count from the catalog, in one transaction', () => {
    const db = createNodeSqliteExecutor(':memory:');
    db.exec('create table if not exists items (id text primary key, owner text not null, spec text not null, location text not null, durability integer not null, card_id text)');
    const s = new PlotStore(db, 'kid', 0);
    const put = (id: string, owner: string, spec: unknown, loc = 'bag') => db.run('insert into items (id, owner, spec, location, durability) values (?, ?, ?, ?, 100)', [id, owner, JSON.stringify(spec), loc]);
    put('a', 'kid', { kind: 'shop', item: 'mat_brick', block: 'brick', count: 999 }); // a forged count: the catalog's wins
    put('b', 'kid', { kind: 'shop', item: 'mat_glass' }, 'chest');
    put('c', 'kid', { kind: 'shop', item: 'hat_red' }); // not a bundle
    put('d', 'other', { kind: 'shop', item: 'mat_brick' }); // someone else's
    put('e', 'kid', { kind: 'shop', item: 'mat_brick' }, 'equipped');
    put('f', 'kid', 'not json');
    const brick0 = total(s.plotState.inv as never, blockRef(BK.brick));
    expect(s.unpackShopBlocks(10)).toBe(2);
    expect(total(s.plotState.inv as never, blockRef(BK.brick)) - brick0).toBe(shopItem('mat_brick')!.block!.count);
    expect(db.all<{ id: string }>('select id from items order by id').map((r) => r.id)).toEqual(['c', 'd', 'e', 'f']);
    expect(s.unpackShopBlocks(20)).toBe(0);
    // all or nothing: a failure inside the transaction leaves the item rows and the stock as they were
    put('g', 'kid', { kind: 'shop', item: 'mat_brick' });
    const rows0 = db.all<{ id: string }>('select id from items').length;
    const stock0 = JSON.stringify(s.plotState.inv);
    const realRun = db.run.bind(db);
    (db as { run: typeof db.run }).run = (q: string, a?: unknown[]) => {
      if (/plot_inv/.test(q)) throw new Error('disk gone');
      return realRun(q, a as never);
    };
    expect(() => s.unpackShopBlocks(30)).toThrow();
    (db as { run: typeof db.run }).run = realRun;
    expect(db.all<{ id: string }>('select id from items').length).toBe(rows0);
    expect(JSON.stringify(new PlotStore(db, 'kid', 0).plotState.inv)).toBe(stock0);
    // saved: a new store over the same storage has the same stock
    expect(total(new PlotStore(db, 'kid', 0).plotState.inv as never, blockRef(BK.glass))).toBe(total(s.plotState.inv as never, blockRef(BK.glass)));
  });
});
