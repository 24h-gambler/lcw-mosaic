// Building on my plot in the client (docs/03 D13, WP-201/205/207), the seat stop mid-play (docs/19 6장) and 쇼룸 공개
// (docs/19 7장): rules applied at once, server answers win, nothing lost on reload, no error screens for a paused seat.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BK, VoxelWorld, blockRef, buildTown, cellKey, furnitureRef } from '@lcw/sim-core';
import { PlotBuilder, type PlotOp, type RoomCheckEvent } from '../build.js';
import { PLOT_QUEUE_KEY, PlotSync } from '../plot-sync.js';
import { SEAT_INACTIVE_EVENT, noteSeatResponse, onSeatInactive } from '../seat.js';
import { DEVICE_PLAY_BLOCKED_KEY, type KeyStore } from '../identity.js';
import { blockTokenMap, nearestToken, plotSnapshot, publishShowroom } from '../showroom.js';
import { buildAtlasPixels } from '../atlas.js';
import { buildAccessOf, withSeatStopped } from '../../App.js';
import { parseShowroomSnapshot } from '../../../../web/src/site/showroom.js';
import { SubmitError, createSoloSubmitWith } from '../../dialog/submit.js';

class MemStore implements KeyStore {
  m = new Map<string, string>();
  getItem(k: string): string | null {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, v);
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
}

function freshWorld(): VoxelWorld {
  const w = new VoxelWorld();
  buildTown(w);
  return w;
}

function builder() {
  const changed: string[] = [];
  const rooms: RoomCheckEvent[] = [];
  let inv = 0;
  const b = new PlotBuilder(
    freshWorld(),
    {
      blockChanged: (x, y, z) => changed.push(cellKey(x, y, z)),
      furnitureChanged: () => undefined,
      inventoryChanged: () => inv++,
      roomChecked: (r) => rooms.push(r)
    },
    0
  );
  return { b, changed, rooms, invChanges: () => inv };
}

const X = 126;
const Z = 170;
const me = { x: X + 0.5, y: 1, z: Z - 2.5 };
const hitFloor = (x: number, z: number) => ({ x, y: 0, z, nx: 0, ny: 1, nz: 0 });

describe('PlotBuilder: aim, one input one block, undo (WP-201)', () => {
  it('aims within 5 m and names the reason when it cannot (red outline + reason)', () => {
    const { b } = builder();
    const ok = b.aim(hitFloor(X, Z), me, 0);
    expect(ok.placeReason).toBeNull();
    expect(ok.place).toEqual({ x: X, y: 1, z: Z });
    expect(b.aim(hitFloor(X, Z + 9), me, 0).placeReason).toBe('far');
    expect(b.aim(hitFloor(140, 140), { x: 140, y: 1, z: 137 }, 0).placeReason).toBe('not_my_plot');
    // the cell the child stands in
    expect(b.aim(hitFloor(X, Z - 3), me, 0).placeReason).toBe('self');
    b.access = 'paused';
    expect(b.aim(hitFloor(X, Z), me, 0).placeReason).toBe('paused');
  });

  it('places and breaks one block per input through setBlock, remeshes it, and undoes the last 20', () => {
    const { b, changed } = builder();
    const ops: PlotOp[] = [];
    b.onOp = (op) => ops.push(op);
    expect(b.place({ x: X, y: 1, z: Z }, 0, 0).ok).toBe(true);
    expect(b.world.getBlock(X, 1, Z)).toBe(BK.oakPlank);
    expect(changed).toContain(cellKey(X, 1, Z));
    expect(b.place({ x: X, y: 2, z: Z }, 1, 300).ok).toBe(true);
    expect(b.breakAt({ x: X, y: 2, z: Z }, 600).ok).toBe(true);
    expect(ops.map((o) => o.op)).toEqual(['place', 'place', 'break']);
    // undo the break: the brick comes back from the hand into the same cell
    expect(b.undoLast(900).ok).toBe(true);
    expect(b.world.getBlock(X, 2, Z)).toBe(BK.brick);
    expect(b.undoLast(1200).ok).toBe(true);
    expect(b.world.getBlock(X, 2, Z)).toBe(0);
    expect(b.undoLast(1500).ok).toBe(true);
    expect(b.world.getBlock(X, 1, Z)).toBe(0);
    expect(b.inv.slots[0]?.n).toBe(32);
    expect(b.undoDepth).toBe(0);
  });

  it('paces a flood of taps like the server (D13 4 a second) instead of letting the server refuse them', () => {
    const { b } = builder();
    let ok = 0;
    for (let i = 0; i < 30; i++) if (b.place({ x: 102 + (i % 20), y: 1, z: 180 + Math.floor(i / 20) }, 1, 0).ok) ok++;
    expect(ok).toBe(10);
    expect(b.place({ x: 110, y: 1, z: 182 }, 1, 0).reason).toBe('rate');
  });

  it('runs the room check when a nameplate goes up, then 1 s after the room changes', () => {
    vi.useFakeTimers();
    try {
      const { b, rooms } = builder();
      const sys = { id: 'sys', isSystemGen: true };
      for (let x = X - 1; x <= X + 5; x++) {
        for (let z = Z - 1; z <= Z + 4; z++) {
          for (let y = 0; y <= 4; y++) {
            const wall = x === X - 1 || x === X + 5 || z === Z - 1 || z === Z + 4 || y === 0 || y === 4;
            b.world.setBlock(sys, x, y, z, wall ? BK.brick : 0);
          }
        }
      }
      b.world.setBlock(sys, X + 5, 1, Z + 1, BK.door);
      b.world.setBlock(sys, X - 1, 2, Z + 1, 0); // hole where the nameplate goes
      b.inv.slots[2] = { ref: blockRef(BK.nameplate), n: 1 };
      expect(b.place({ x: X - 1, y: 2, z: Z + 1 }, 2, 0).ok).toBe(true);
      vi.advanceTimersByTime(10);
      expect(rooms.at(-1)).toMatchObject({ missing: ['light', 'rest', 'flat'], sentence: 'This room needs a light source.' });
      b.inv.slots[3] = { ref: blockRef(BK.torch), n: 4 };
      expect(b.place({ x: X + 2, y: 1, z: Z + 2 }, 3, 400).ok).toBe(true);
      vi.advanceTimersByTime(900);
      expect(rooms.length).toBe(1);
      vi.advanceTimersByTime(200);
      expect(rooms.at(-1)).toMatchObject({ missing: ['rest', 'flat'], sentence: 'This room needs a bed or a chair.' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('a server snapshot puts the plot back exactly (town + saved delta), furniture and bag included', () => {
    const { b } = builder();
    b.place({ x: X, y: 1, z: Z }, 0, 0);
    b.applySnapshot({
      cells: [[X + 1, 1, Z, BK.glass]],
      furniture: [[X + 2, 1, Z, 'furn_chair_wood', 1]],
      inv: { slots: [{ ref: 'b18', n: 5 }], chest: { b4: 3 } },
      rev: 7
    });
    expect(b.world.getBlock(X, 1, Z)).toBe(0);
    expect(b.world.getBlock(X + 1, 1, Z)).toBe(BK.glass);
    expect(b.state.furniture.get(cellKey(X + 2, 1, Z))).toEqual({ key: 'furn_chair_wood', rot: 1 });
    expect(b.inv.slots[0]).toEqual({ ref: 'b18', n: 5 });
    expect(b.inv.chest).toEqual({ b4: 3 });
  });
});

type Call = { url: string; body: any };
function fakeServer(answer: (call: Call) => { status: number; body: unknown }) {
  const calls: Call[] = [];
  const fetchFn = async (url: string, init?: RequestInit): Promise<Response> => {
    const call = { url, body: init?.body ? JSON.parse(String(init.body)) : null };
    calls.push(call);
    const a = answer(call);
    return new Response(JSON.stringify(a.body), { status: a.status, headers: { 'content-type': 'application/json' } });
  };
  return { calls, fetchFn };
}
const snap = { cells: [], furniture: [], inv: { slots: [], chest: {} }, rev: 0 };

describe('PlotSync: server answers win, nothing lost (WP-205/207)', () => {
  beforeEach(() => vi.stubGlobal('window', new EventTarget()));
  afterEach(() => vi.unstubAllGlobals());

  it('sends queued ops in order, resends the remainder when the pace ran out, and survives a reload', async () => {
    const store = new MemStore();
    let first = true;
    const srv = fakeServer((c) => {
      if (c.url.endsWith('/v1/plot')) return { status: 200, body: snap };
      const n = c.body.ops.length;
      const processed = first ? Math.min(2, n) : n;
      first = false;
      return { status: 200, body: { results: Array.from({ length: processed }, () => ({ ok: true })), processed, inv: {}, rev: 1 } };
    });
    const sync = new PlotSync({ token: 't'.repeat(40), store, fetchFn: srv.fetchFn, onResync: () => undefined });
    for (let i = 0; i < 3; i++) sync.push({ op: 'place', x: 110 + i, y: 1, z: 170, slot: 0 });
    expect(JSON.parse(store.getItem(PLOT_QUEUE_KEY)!).queue).toHaveLength(3);
    await sync.flush();
    const posts = srv.calls.filter((c) => c.url.endsWith('/ops'));
    expect(posts.map((c) => c.body.ops.map((o: any) => o.x))).toEqual([[110, 111, 112], [112]]);
    expect(store.getItem(PLOT_QUEUE_KEY)).toBeNull();
    expect(sync.sent).toBe(3);

    // a tab closed with a batch in flight: the next start sends it again with the same id, then loads
    store.setItem(PLOT_QUEUE_KEY, JSON.stringify({ inFlight: { id: 'abc-123456789', ops: [{ op: 'swap', a: 0, b: 1 }] }, queue: [] }));
    const srv2 = fakeServer((c) =>
      c.url.endsWith('/v1/plot') ? { status: 200, body: snap } : { status: 200, body: { results: [{ ok: true }], processed: 1, inv: {}, rev: 2 } }
    );
    const again = new PlotSync({ token: 't'.repeat(40), store, fetchFn: srv2.fetchFn, onResync: () => undefined });
    expect(await again.start()).toEqual(snap);
    expect(srv2.calls[0]!.body).toEqual({ ops: [{ op: 'swap', a: 0, b: 1 }], batch: 'abc-123456789' });
    expect(srv2.calls[1]!.url).toBe('/v1/plot');
  });

  it('a refused op reloads the plot from the server (the client never keeps what the server did not)', async () => {
    const srv = fakeServer((c) =>
      c.url.endsWith('/v1/plot') ? { status: 200, body: { ...snap, rev: 9 } } : { status: 200, body: { results: [{ ok: false, reason: 'occupied' }], processed: 1 } }
    );
    const resync = vi.fn();
    const sync = new PlotSync({ token: 't'.repeat(40), store: new MemStore(), fetchFn: srv.fetchFn, onResync: resync });
    sync.push({ op: 'place', x: 110, y: 1, z: 170, slot: 0 });
    await sync.flush();
    expect(resync).toHaveBeenCalledWith({ ...snap, rev: 9 });
    expect(sync.refused).toBe(1);
  });

  it('403 seat_inactive stops building, remembers the seat and tells the shell (no error)', async () => {
    const store = new MemStore();
    const seen = vi.fn();
    const off = onSeatInactive(seen);
    const denied = vi.fn();
    const srv = fakeServer(() => ({ status: 403, body: { error: 'seat_inactive', seat: { state: 'read_only' } } }));
    const sync = new PlotSync({ token: 't'.repeat(40), store, fetchFn: srv.fetchFn, onResync: () => undefined, onDenied: denied });
    sync.push({ op: 'place', x: 110, y: 1, z: 170, slot: 0 });
    await sync.flush();
    off();
    expect(denied).toHaveBeenCalledWith('paused');
    expect(seen).toHaveBeenCalledTimes(1);
    expect(store.getItem(DEVICE_PLAY_BLOCKED_KEY)).toBe('1');
    expect(sync.status).toBe('paused');
    expect(sync.pending).toBe(0);
  });
});

describe('seat stop mid-play (docs/19 6장, #23 seat_inactive)', () => {
  beforeEach(() => vi.stubGlobal('window', new EventTarget()));
  afterEach(() => vi.unstubAllGlobals());

  it('only a seat_inactive 403 counts (a plain auth 403 does not), and the body stays readable', async () => {
    const store = new MemStore();
    const seen = vi.fn();
    window.addEventListener(SEAT_INACTIVE_EVENT, seen);
    const plain = new Response(JSON.stringify({ error: 'operator_only' }), { status: 403 });
    expect(await noteSeatResponse(plain, store)).toBe(false);
    const seat = new Response(JSON.stringify({ error: 'seat_inactive', seat: { state: 'refunded' } }), { status: 403 });
    expect(await noteSeatResponse(seat, store)).toBe(true);
    expect(await seat.json()).toMatchObject({ error: 'seat_inactive' });
    expect(seen).toHaveBeenCalledTimes(1);
    expect(store.getItem(DEVICE_PLAY_BLOCKED_KEY)).toBe('1');
  });

  it('a solo order (POST /v1/converse/score) answered seat_inactive raises the seat card, not an error line', async () => {
    const seen = vi.fn();
    const off = onSeatInactive(seen);
    const submit = createSoloSubmitWith({
      token: 'x'.repeat(40),
      npc: { id: 'cafe_owner', ctx: 'cafe', nameKo: '카페', nameEn: 'Cafe' },
      fetchImpl: (async () => new Response(JSON.stringify({ error: 'seat_inactive', seat: { state: 'read_only' } }), { status: 403 })) as typeof fetch
    });
    const err = await submit({ transcript: 'Can I get a honey tea?', stt_source: 'typed', confidence: 1, dur_ms: 900, latency_ms: 10 } as never).catch((e: unknown) => e);
    off();
    expect(err).toBeInstanceOf(SubmitError);
    expect((err as SubmitError).message).toBe('seat_inactive');
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('the shell treats it as play_allowed=false for a linked child; lessons are never gated', () => {
    const child = { kind: 'child' as const, token: 'x'.repeat(40), nickname: 'Juno', level: 'L1' as const, voiceStore: false, offline: false, playAllowed: true, seat: null };
    expect(withSeatStopped(child)).toMatchObject({ kind: 'child', playAllowed: false });
    expect(withSeatStopped({ kind: 'lesson', code: '123456' })).toEqual({ kind: 'lesson', code: '123456' });
    expect(buildAccessOf(child, null)).toEqual({ kind: 'saved', token: child.token });
    expect(buildAccessOf({ ...child, playAllowed: false }, null)).toEqual({ kind: 'paused' });
    expect(buildAccessOf({ kind: 'lesson', code: '123456' }, 'y'.repeat(40))).toEqual({ kind: 'saved', token: 'y'.repeat(40), pausedFallback: 'local' });
    expect(buildAccessOf({ kind: 'guest' }, null)).toEqual({ kind: 'local' });
  });
});

describe('쇼룸 공개 from the game (docs/19 7장, WP-703)', () => {
  beforeEach(() => vi.stubGlobal('window', new EventTarget()));
  afterEach(() => vi.unstubAllGlobals());

  it('the plot snapshot is exactly what the site parser accepts: token colours, no extra fields, ≤ 20,000 blocks', () => {
    const { b } = builder();
    b.place({ x: X, y: 1, z: Z }, 0, 0);
    b.state.furniture.set(cellKey(X + 1, 1, Z), { key: 'furn_bed_single', rot: 0 });
    const s = plotSnapshot(b.world, b.state.furniture, blockTokenMap(buildAtlasPixels()), '  나의 꿀벌 집  ', { shirt: 0x3fa9f5, pants: 0x2f3b52, hair: 0x2a2320 });
    expect(Object.keys(s).sort()).toEqual(['avatar', 'blocks', 'title', 'v']);
    expect(s.title).toBe('나의 꿀벌 집');
    expect(s.blocks.length).toBeGreaterThan(900);
    expect(s.blocks.length).toBeLessThanOrEqual(20_000);
    expect(parseShowroomSnapshot(s)).not.toBeNull();
    // ground layer at height -1, my plank one above it
    const plank = s.blocks.find(([x, y, h]) => x === X - 101 && y === Z - 157 && h === 0);
    expect(plank).toBeTruthy();
    expect(s.avatar.shirt).toBe('sky');
    expect(nearestToken(0x3d, 0xbe, 0x6b)).toBe('leaf');
  });

  it('maps every server answer to a child-safe reason; a paused seat goes to the seat card', async () => {
    const answer = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status });
    const s = { v: 1 as const, title: 't', blocks: [], avatar: { shirt: 'sky' as const, pants: 'ink-700' as const, hair: 'ink-900' as const } };
    expect(await publishShowroom('t', s, answer(201, { token: 'a'.repeat(32), path: '/s/abc' }))).toEqual({ ok: true, path: '/s/abc' });
    expect(await publishShowroom('t', s, answer(403, { error: 'consent_required' }))).toEqual({ ok: false, reason: 'consent' });
    expect(await publishShowroom('t', s, answer(404, { error: 'not_found' }))).toEqual({ ok: false, reason: 'consent' });
    expect(await publishShowroom('t', s, answer(422, { error: 'title' }))).toEqual({ ok: false, reason: 'title' });
    expect(await publishShowroom('t', s, answer(429, {}))).toEqual({ ok: false, reason: 'busy' });
    const seen = vi.fn();
    const off = onSeatInactive(seen);
    expect(await publishShowroom('t', s, answer(403, { error: 'seat_inactive', seat: { state: 'archived' } }))).toEqual({ ok: false, reason: 'seat' });
    off();
    expect(seen).toHaveBeenCalledTimes(1);
    expect(furnitureRef('furn_bed_single')).toBe('ffurn_bed_single');
  });
});
