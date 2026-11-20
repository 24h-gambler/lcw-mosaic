/**
 * My plot and my world's free build, saved by the server (WP-201/205/207, docs/03 D13, R326; AGENTS 4: the client is
 * never trusted for saves).
 *
 * The child's home world keeps every cell that differs from the town builder's town (a delta, the plot and — R326 —
 * the open ground the child dug or built on, at most TUNING.building.freeMaxCells outside the plot), the furniture
 * on cells, the five carried slots and the chest. In memory the world is an OverlayWorld over one shared town per
 * isolate, so a resident world costs its changed cells, not a copy of the town. Every request's ops are re-run through the same
 * sim-core rules the client ran (`applyPlotOp`), then the touched rows are written in one SQLite transaction with
 * a journal entry; if the write fails the in-memory plot is rebuilt from the database, so memory and disk never
 * drift apart (crash-safe).
 */
import {
  EditBucket,
  OPS_PER_REQUEST_MAX,
  OverlayWorld,
  VoxelWorld,
  applyPlotOp,
  buildCellRule,
  buildTown,
  cellKey,
  cleanInventory,
  parsePlotOp,
  parseRef,
  starterInventory,
  stowInInventory,
  blockRef,
  type BuildScope,
  type FurnitureKey,
  type ItemRef,
  type PlotFurniture,
  type PlotEditReason,
  type PlotInventory,
  type PlotState
} from '@lcw/sim-core';
import { BLOCK_PALETTE, shopItem } from '@lcw/content';
import { runInTransaction, type SqliteExecutor } from './storage.js';

const BLOCK_ID_BY_KEY = new Map(BLOCK_PALETTE.map((b) => [b.key, b.id] as const));
/** Where a bought thing can sit before it is opened (an item offered in a trade has left `items`: escrow). */
const UNOPENED_PLACES = ['bag', 'hotbar', 'chest'];
function readSpec(raw: string): { kind?: unknown; item?: unknown } | null {
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === 'object' ? (v as { kind?: unknown; item?: unknown }) : null;
  } catch {
    return null;
  }
}

export const PLOT_SCHEMA_SQL = `
create table if not exists plot_cells (x integer not null, y integer not null, z integer not null, id integer not null, primary key (x, y, z));
create table if not exists plot_furniture (x integer not null, y integer not null, z integer not null, k text not null, rot integer not null, primary key (x, y, z));
create table if not exists plot_inv (player text primary key, data text not null, rev integer not null);
create table if not exists plot_journal (seq integer primary key autoincrement, at integer not null, actor text not null, batch text, ops text not null, results text not null);
create table if not exists plot_guest_cells (grant_id text not null, x integer not null, y integer not null, z integer not null, primary key (grant_id, x, y, z))
`;

let baseTown: VoxelWorld | null = null;
/**
 * The town builder's town (the same `buildTown` the client runs), built once per isolate and never written again:
 * every child's world reads through it (measured: 516 chunks, ~6.7 MB, ~65 ms to build).
 */
export function baseTownWorld(): VoxelWorld {
  if (!baseTown) {
    const town = new VoxelWorld();
    buildTown(town);
    baseTown = town;
  }
  return baseTown;
}
/** @deprecated name kept for callers from before R326: the plot is part of the whole town now. */
export const baseTownPlot = baseTownWorld;

/**
 * A short tag naming one world on the wire (R326 block relay): the host and a friend on a guest pass in that world get
 * the same tag from their snapshots, siblings in one family room get different ones. FNV-1a of the world id, so the id
 * itself never reaches a device.
 */
export function worldTag(worldId: string): string {
  let h = 0x811c9dc5;
  let g = 0x01000193;
  for (let i = 0; i < worldId.length; i++) {
    const c = worldId.charCodeAt(i);
    h = Math.imul(h ^ c, 0x01000193) >>> 0;
    g = Math.imul(g ^ c, 0x85ebca6b) >>> 0;
  }
  return `w${h.toString(36)}${g.toString(36)}`;
}

export interface PlotSnapshot {
  /** cells that differ from the town (plot and open ground): [x, y, z, blockId] */
  cells: Array<[number, number, number, number]>;
  furniture: Array<[number, number, number, FurnitureKey, number]>;
  inv: PlotInventory;
  rev: number;
}

export interface PlotOpsResult {
  /** one per processed op, in order */
  results: Array<{ ok: boolean; reason?: PlotEditReason }>;
  /**
   * How many ops were processed. Fewer than sent when the child's edit pace ran out (D13 four a second): the client
   * sends the rest again a moment later, in the same order, so nothing is reordered or lost.
   */
  processed: number;
  inv: PlotInventory;
  rev: number;
}

/** One child's plot in their home world (`sql` is that world's prefixed executor). */
export class PlotStore {
  private state: PlotState;
  private rev = 0;
  private readonly bucket: EditBucket;
  /** each guest pass builds at its own pace, so a friend never spends the host's (docs/19 §8) */
  private readonly guestBuckets = new Map<string, EditBucket>();

  constructor(
    private readonly sql: SqliteExecutor,
    private readonly playerId: string,
    nowMs: number
  ) {
    this.sql.exec(PLOT_SCHEMA_SQL);
    this.bucket = new EditBucket(nowMs);
    this.state = this.load();
  }

  private load(): PlotState {
    const base = baseTownWorld();
    const world = new OverlayWorld(base);
    const sys = { id: 'plot_load', isSystemGen: true };
    for (const r of this.sql.all<{ x: number; y: number; z: number; id: number }>('select x, y, z, id from plot_cells')) {
      const x = Number(r.x);
      const y = Number(r.y);
      const z = Number(r.z);
      // a cell the town rules no longer allow (a place made protected later) stays out, here and in the snapshot
      if (buildCellRule(world, x, y, z, 'world')) continue;
      world.setBlock(sys, x, y, z, Number(r.id));
    }
    const furniture = new Map<string, PlotFurniture>();
    for (const r of this.sql.all<{ x: number; y: number; z: number; k: string; rot: number }>('select x, y, z, k, rot from plot_furniture')) {
      const what = parseRef(`f${r.k}`);
      if (what?.kind === 'furniture') furniture.set(cellKey(Number(r.x), Number(r.y), Number(r.z)), { key: what.key, rot: Number(r.rot) });
    }
    const row = this.sql.get<{ data: string; rev: number }>('select data, rev from plot_inv where player = ?', [this.playerId]);
    let inv: PlotInventory | null = null;
    if (row) {
      try {
        inv = cleanInventory(JSON.parse(row.data));
      } catch {
        inv = null;
      }
      this.rev = Number(row.rev);
    }
    if (!inv) {
      inv = starterInventory();
      this.sql.run('insert or replace into plot_inv (player, data, rev) values (?, ?, ?)', [this.playerId, JSON.stringify(inv), 0]);
      this.rev = 0;
    }
    return { world, furniture, inv, scope: 'world', budget: { townAt: (x, y, z) => base.getBlock(x, y, z), get used() { return world.changedOutsidePlot; } } };
  }

  /**
   * The saved cells a device draws. A lesson token (scope 'plot') gets the plot only: the class shares one town, so a
   * tower or a hole the child made at home must not appear there (classmates would walk on air on this screen).
   */
  snapshot(scope: BuildScope = 'world'): PlotSnapshot {
    const cells: Array<[number, number, number, number]> = [];
    const world = this.state.world;
    for (const row of this.sql.all<{ x: number; y: number; z: number; id: number }>('select x, y, z, id from plot_cells order by y, z, x')) {
      const x = Number(row.x);
      const y = Number(row.y);
      const z = Number(row.z);
      if (buildCellRule(world, x, y, z, scope)) continue;
      cells.push([x, y, z, Number(row.id)]);
    }
    const furniture: PlotSnapshot['furniture'] = [];
    for (const [k, f] of this.state.furniture) {
      const [x, y, z] = k.split(',').map(Number) as [number, number, number];
      furniture.push([x, y, z, f.key, f.rot]);
    }
    return { cells, furniture, inv: this.state.inv, rev: this.rev };
  }

  /**
   * Run a batch of raw ops from the child's device. Each op is judged on its own (a refused op does not undo the
   * ones before it); the whole batch's effect is saved in one transaction.
   *
   * `guestGrant`: the ops come from a friend on a guest pass in this child's world (docs/19 §8). The friend builds with
   * the host's carried blocks and may break only what they placed under this pass: the host's own build, the chest
   * and the slots are never theirs to change ('not_yours'). Their cells are remembered per pass.
   */
  applyOps(rawOps: unknown[], nowMs: number, opts: { simulateCrashMidTx?: boolean; batch?: string; guestGrant?: string; scope?: BuildScope } = {}): PlotOpsResult {
    const batch = typeof opts.batch === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(opts.batch) ? opts.batch : null;
    if (batch) {
      // The same batch sent again (the reply was lost, or the app closed mid-request): answer what it did then.
      const actor = opts.guestGrant ? `guest:${opts.guestGrant}` : this.playerId;
      const seen = this.sql.get<{ results: string }>('select results from plot_journal where batch = ? and actor = ?', [batch, actor]);
      if (seen) {
        const results = JSON.parse(seen.results) as PlotOpsResult['results'];
        return { results, processed: results.length, inv: this.state.inv, rev: this.rev };
      }
    }
    const ops = rawOps.slice(0, OPS_PER_REQUEST_MAX);
    // R326: a lesson builds on the plot only (the platform sets the scope from the token, never the body)
    this.state.scope = opts.scope ?? 'world';
    const results: PlotOpsResult['results'] = [];
    const touched = new Set<string>();
    const touchedFurniture = new Set<string>();
    /** cells this guest placed (true) or broke again (false) in this batch */
    const guestPlaced = new Map<string, boolean>();
    for (const raw of ops) {
      const op = parsePlotOp(raw);
      if (!op) {
        results.push({ ok: false, reason: 'bad_op' });
        continue;
      }
      const guest = opts.guestGrant;
      if (guest) {
        const mine = op.op === 'break' && (guestPlaced.get(cellKey(op.x, op.y, op.z)) ?? this.guestCell(guest, op.x, op.y, op.z));
        if (op.op !== 'place' && !mine) {
          results.push({ ok: false, reason: 'not_yours' });
          continue;
        }
      }
      const pace = guest ? this.guestBucket(guest, nowMs) : this.bucket;
      if ((op.op === 'place' || op.op === 'break') && !pace.take(nowMs)) break;
      const r = applyPlotOp(this.state, this.playerId, op);
      results.push(r.ok ? { ok: true } : { ok: false, reason: r.reason });
      if (r.ok && (op.op === 'place' || op.op === 'break')) {
        const k = cellKey(op.x, op.y, op.z);
        touched.add(k);
        touchedFurniture.add(k);
        if (guest) guestPlaced.set(k, op.op === 'place');
      }
    }
    const processed = results.length;
    const changed = results.some((r) => r.ok);
    if (!changed) return { results, processed, inv: this.state.inv, rev: this.rev };
    const base = baseTownWorld();
    try {
      runInTransaction(this.sql, () => {
        for (const k of touched) {
          const [x, y, z] = k.split(',').map(Number) as [number, number, number];
          const id = this.state.world.getBlock(x, y, z);
          if (id === base.getBlock(x, y, z)) this.sql.run('delete from plot_cells where x = ? and y = ? and z = ?', [x, y, z]);
          else
            this.sql.run(
              'insert into plot_cells (x, y, z, id) values (?, ?, ?, ?) on conflict(x, y, z) do update set id = excluded.id',
              [x, y, z, id]
            );
        }
        for (const k of touchedFurniture) {
          const [x, y, z] = k.split(',').map(Number) as [number, number, number];
          const f = this.state.furniture.get(k);
          if (!f) this.sql.run('delete from plot_furniture where x = ? and y = ? and z = ?', [x, y, z]);
          else
            this.sql.run(
              'insert into plot_furniture (x, y, z, k, rot) values (?, ?, ?, ?, ?) on conflict(x, y, z) do update set k = excluded.k, rot = excluded.rot',
              [x, y, z, f.key, f.rot]
            );
        }
        // the host changed a cell a friend had placed: it is the host's again (no friend may break what the host rebuilt)
        if (!opts.guestGrant) {
          for (const k of touched) {
            const [x, y, z] = k.split(',').map(Number) as [number, number, number];
            this.sql.run('delete from plot_guest_cells where x = ? and y = ? and z = ?', [x, y, z]);
          }
        }
        for (const [k, placed] of guestPlaced) {
          const [x, y, z] = k.split(',').map(Number) as [number, number, number];
          if (placed) this.sql.run('insert or ignore into plot_guest_cells (grant_id, x, y, z) values (?, ?, ?, ?)', [opts.guestGrant!, x, y, z]);
          else this.sql.run('delete from plot_guest_cells where grant_id = ? and x = ? and y = ? and z = ?', [opts.guestGrant!, x, y, z]);
        }
        if (opts.simulateCrashMidTx) throw new Error('simulated_tx_abort');
        const nextRev = this.rev + 1;
        this.sql.run('insert or replace into plot_inv (player, data, rev) values (?, ?, ?)', [this.playerId, JSON.stringify(this.state.inv), nextRev]);
        this.sql.run('insert into plot_journal (at, actor, batch, ops, results) values (?, ?, ?, ?, ?)', [
          nowMs,
          opts.guestGrant ? `guest:${opts.guestGrant}` : this.playerId,
          // a resent batch is answered from here (a partial one again says how many ops it took)
          batch,
          JSON.stringify(ops.slice(0, processed)),
          JSON.stringify(results)
        ]);
        this.rev = nextRev;
      });
    } catch (err) {
      // Nothing was written: drop the in-memory changes so the plot matches the database again.
      this.state = this.load();
      throw err;
    }
    return { results, processed, inv: this.state.inv, rev: this.rev };
  }

  /**
   * Things bought in a shop (talk domain) or given by the world land in the chest. Saved at once; the server is
   * the only caller (never a client body).
   */
  grant(ref: ItemRef, n: number, nowMs: number, reason: string): boolean {
    if (!parseRef(ref) || !Number.isInteger(n) || n <= 0 || n > 999) return false;
    const inv = this.state.inv;
    const before = inv.chest[ref] ?? 0;
    inv.chest[ref] = before + n;
    try {
      runInTransaction(this.sql, () => {
        const nextRev = this.rev + 1;
        this.sql.run('insert or replace into plot_inv (player, data, rev) values (?, ?, ?)', [this.playerId, JSON.stringify(inv), nextRev]);
        this.sql.run('insert into plot_journal (at, actor, ops, results) values (?, ?, ?, ?)', [
          nowMs,
          'system',
          JSON.stringify([{ op: 'grant', ref, n, reason }]),
          '[{"ok":true}]'
        ]);
        this.rev = nextRev;
      });
    } catch (err) {
      this.state = this.load();
      throw err;
    }
    return true;
  }

  /**
   * A shop's block bundles (`mat_<block>`, docs/19 9장, `ShopItemDef.block {key, count}`) become build stock (R326): each
   * unopened bundle the child owns leaves `items` and its blocks go into the carried stacks (the rest to the chest), in
   * one transaction with a journal line, so a bundle is opened once and never twice (the row is gone with the same
   * commit that adds the blocks). The count comes from the catalog, never from the stored spec. Returns how many opened.
   */
  unpackShopBlocks(nowMs: number): number {
    const hasItems = this.sql.get<{ n: number }>("select count(*) as n from sqlite_master where type = 'table' and name = 'items'");
    if (!hasItems || Number(hasItems.n) === 0) return 0;
    const rows = this.sql.all<{ id: string; spec: string }>(
      `select id, spec from items where owner = ? and location in (${UNOPENED_PLACES.map(() => '?').join(', ')})`,
      [this.playerId, ...UNOPENED_PLACES]
    );
    const open: Array<{ id: string; ref: ItemRef; n: number; key: string }> = [];
    for (const r of rows) {
      const spec = readSpec(r.spec);
      if (spec?.kind !== 'shop' || typeof spec.item !== 'string') continue;
      const b = shopItem(spec.item)?.block;
      const id = b ? BLOCK_ID_BY_KEY.get(b.key) : undefined;
      if (!b || id === undefined || !parseRef(blockRef(id)) || !Number.isInteger(b.count) || b.count <= 0) continue;
      open.push({ id: r.id, ref: blockRef(id), n: b.count, key: spec.item });
    }
    if (open.length === 0) return 0;
    try {
      runInTransaction(this.sql, () => {
        for (const o of open) {
          this.sql.run('delete from items where id = ? and owner = ?', [o.id, this.playerId]);
          stowInInventory(this.state.inv, o.ref, o.n);
        }
        const nextRev = this.rev + 1;
        this.sql.run('insert or replace into plot_inv (player, data, rev) values (?, ?, ?)', [this.playerId, JSON.stringify(this.state.inv), nextRev]);
        this.sql.run('insert into plot_journal (at, actor, ops, results) values (?, ?, ?, ?)', [
          nowMs,
          'system',
          JSON.stringify(open.map((o) => ({ op: 'unpack', item: o.id, key: o.key, ref: o.ref, n: o.n }))),
          JSON.stringify(open.map(() => ({ ok: true })))
        ]);
        this.rev = nextRev;
      });
    } catch (err) {
      this.state = this.load();
      throw err;
    }
    return open.length;
  }

  /** The cells a guest pass placed here and may break again (the snapshot a friend gets carries them). */
  guestCells(grant: string): Array<[number, number, number]> {
    return this.sql
      .all<{ x: number; y: number; z: number }>('select x, y, z from plot_guest_cells where grant_id = ? order by y, z, x', [grant])
      .map((r) => [Number(r.x), Number(r.y), Number(r.z)]);
  }

  private guestBucket(grant: string, nowMs: number): EditBucket {
    let b = this.guestBuckets.get(grant);
    if (!b) {
      // a few passes a month per seat: keep only the latest handful
      if (this.guestBuckets.size >= 8) this.guestBuckets.delete(this.guestBuckets.keys().next().value!);
      b = new EditBucket(nowMs);
      this.guestBuckets.set(grant, b);
    }
    return b;
  }

  private guestCell(grant: string, x: number, y: number, z: number): boolean {
    return !!this.sql.get('select 1 as one from plot_guest_cells where grant_id = ? and x = ? and y = ? and z = ?', [grant, x, y, z]);
  }

  /** For tests and the room check on the server. */
  get plotState(): PlotState {
    return this.state;
  }
}

const stores = new WeakMap<object, Map<string, PlotStore>>();
/** One PlotStore per (home world object, player) while that world stays resident. */
export function plotStoreFor(owner: object, sql: SqliteExecutor, playerId: string, nowMs: number): PlotStore {
  let m = stores.get(owner);
  if (!m) {
    m = new Map();
    stores.set(owner, m);
  }
  let s = m.get(playerId);
  if (!s) {
    s = new PlotStore(sql, playerId, nowMs);
    m.set(playerId, s);
  }
  return s;
}
