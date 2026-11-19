import { describe, expect, it } from 'vitest';
import { BK, FREE_MAX_CELLS, OverlayWorld, terrainHeight } from '@lcw/sim-core';
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
  return { dev: bearer(link.body.device_token) };
}

const MX = 210;
const MZ = 214;
const H = terrainHeight(MX, MZ);

describe('free build through the gateway (R326)', () => {
  it('builds a tower on the meadow, digs a hole, refuses the shop; all of it is there after a restart', async () => {
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
          { op: 'break', x: 116, y: 1, z: 128 }, // the trade shop's wall
          { op: 'place', x: 144, y: 3, z: 143, slot: 0 } // over the east-west road
        ],
        // a forged scope in the body changes nothing: the platform sets it from the token
        plot_only: false
      },
      dev
    );
    expect(r.status).toBe(200);
    expect(r.body.results.map((x: any) => x.reason ?? 'ok')).toEqual(['ok', 'ok', 'ok', 'ok', 'protected', 'protected']);
    const p2 = new PlatformDO({ storage }, env);
    const again = await call(p2, 'GET', '/v1/plot', undefined, dev);
    expect(again.body.cells).toEqual([
      [MX + 2, H, MZ, 0],
      [MX, H + 1, MZ, BK.brick],
      [MX, H + 2, MZ, BK.brick],
      [MX, H + 3, MZ, BK.brick]
    ]);
    // the dug grass went to the carried stacks or the chest
    const grass = (again.body.inv.chest['b3'] ?? 0) + again.body.inv.slots.reduce((n: number, s: any) => n + (s?.ref === 'b3' ? s.n : 0), 0);
    expect(grass).toBe(17);
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
        for (let dy = 1; dy <= 2 && n < FREE_MAX_CELLS; dy++) {
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
