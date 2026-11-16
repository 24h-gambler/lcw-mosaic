/**
 * My plot, saved by the server (WP-201/205/207, docs/03 D13; AGENTS 4: the client is never trusted for saves).
 *
 * The child's home world keeps the plot: only the cells that differ from the town builder's plot (a delta), the
 * furniture on cells, the five carried slots and the chest. Every request's ops are re-run through the same
 * sim-core rules the client ran (`applyPlotOp`), then the touched rows are written in one SQLite transaction with
 * a journal entry; if the write fails the in-memory plot is rebuilt from the database, so memory and disk never
 * drift apart (crash-safe).
 */
import {
  EditBucket,
  OPS_PER_REQUEST_MAX,
  VoxelWorld,
  applyPlotOp,
  buildTown,
  cellKey,
  cleanInventory,
  createPlotWorld,
  parsePlotOp,
  parseRef,
  plotRegion,
  starterInventory,
  type FurnitureKey,
  type ItemRef,
  type PlotFurniture,
  type PlotEditReason,
  type PlotInventory,
  type PlotState
} from '@lcw/sim-core';
import { runInTransaction, type SqliteExecutor } from './storage.js';

export const PLOT_SCHEMA_SQL = `
create table if not exists plot_cells (x integer not null, y integer not null, z integer not null, id integer not null, primary key (x, y, z));
create table if not exists plot_furniture (x integer not null, y integer not null, z integer not null, k text not null, rot integer not null, primary key (x, y, z));
create table if not exists plot_inv (player text primary key, data text not null, rev integer not null);
create table if not exists plot_journal (seq integer primary key autoincrement, at integer not null, actor text not null, batch text, ops text not null, results text not null);
create table if not exists plot_guest_cells (grant_id text not null, x integer not null, y integer not null, z integer not null, primary key (grant_id, x, y, z))
`;

let basePlot: VoxelWorld | null = null;
/** The town builder's plot (the same `buildTown` the client runs), built once per isolate. */
export function baseTownPlot(): VoxelWorld {
  if (!basePlot) {
    const town = new VoxelWorld();
    buildTown(town);
    basePlot = createPlotWorld(town);
  }
  return basePlot;
}

export interface PlotSnapshot {
  /** cells that differ from the town's plot: [x, y, z, blockId] */
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
    const world = createPlotWorld(baseTownPlot());
    const sys = { id: 'plot_load', isSystemGen: true };
    for (const r of this.sql.all<{ x: number; y: number; z: number; id: number }>('select x, y, z, id from plot_cells')) {
      world.setBlock(sys, Number(r.x), Number(r.y), Number(r.z), Number(r.id));
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
    return { world, furniture, inv };
  }

  snapshot(): PlotSnapshot {
    const base = baseTownPlot();
    const r = plotRegion(base);
    const cells: Array<[number, number, number, number]> = [];
    for (const row of this.sql.all<{ x: number; y: number; z: number; id: number }>('select x, y, z, id from plot_cells order by y, z, x')) {
      const x = Number(row.x);
      const y = Number(row.y);
      const z = Number(row.z);
      if (x < r.x0 || x >= r.x1 || z < r.z0 || z >= r.z1) continue;
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
  applyOps(rawOps: unknown[], nowMs: number, opts: { simulateCrashMidTx?: boolean; batch?: string; guestGrant?: string } = {}): PlotOpsResult {
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
      if ((op.op === 'place' || op.op === 'break') && !this.bucket.take(nowMs)) break;
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
    const base = baseTownPlot();
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

  /** The cells a guest pass placed here and may break again (the snapshot a friend gets carries them). */
  guestCells(grant: string): Array<[number, number, number]> {
    return this.sql
      .all<{ x: number; y: number; z: number }>('select x, y, z from plot_guest_cells where grant_id = ? order by y, z, x', [grant])
      .map((r) => [Number(r.x), Number(r.y), Number(r.z)]);
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
