import { GUEST_PASS_HEADER } from '@lcw/schemas';
// Building on my plot in the client (docs/03 D13, WP-201/205/207), the seat stop mid-play (docs/19 6장) and 쇼룸 공개
// (docs/19 7장): rules applied at once, server answers win, nothing lost on reload, no error screens for a paused seat.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BK, VoxelWorld, blockRef, buildTown, cellKey, furnitureRef } from '@lcw/sim-core';
import { PlotBuilder, type PlotOp, type RoomCheckEvent } from '../build.js';
import { PASS_CHECK_EVENT, PLOT_QUEUE_KEY, PlotSync, plotQueueKey } from '../plot-sync.js';
import { SEAT_INACTIVE_EVENT, noteSeatResponse, onSeatInactive } from '../seat.js';
import { DEVICE_PLAY_BLOCKED_KEY, DEVICE_TOKEN_KEY, type KeyStore } from '../identity.js';
import { blockTokenMap, nearestToken, plotSnapshot, publishShowroom } from '../showroom.js';
import { buildAtlasPixels } from '../atlas.js';
import { buildAccessOf, withSeatStopped } from '../../App.js';
import { parseShowroomSnapshot } from '../../../../web/src/site/showroom.js';
import { SubmitError, createSoloSubmitWith } from '../../dialog/submit.js';
import { BUILD_REASONS_KO } from '../strings.js';

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

  it("a friend on a guest pass places with the host's blocks, breaks only their own, never opens the host's chest (docs/19 §8)", () => {
    const { b } = builder();
    b.applySnapshot({ cells: [[X + 1, 1, Z, BK.glass]], furniture: [], inv: { slots: [{ ref: 'b18', n: 5 }], chest: { b4: 3 } }, rev: 1 });
    b.guestCells = new Set();
    b.applySnapshot({ cells: [[X + 1, 1, Z, BK.glass], [X + 2, 1, Z, BK.glass]], furniture: [], inv: { slots: [{ ref: 'b18', n: 5 }], chest: { b4: 3 } }, rev: 2, guest_cells: [[X + 2, 1, Z]] });
    const sent: unknown[] = [];
    b.onOp = (op) => sent.push(op);
    const me = { x: X + 0.5, y: 1, z: Z - 1.5 };
    // the host's glass: red aim with the reason, and the break never leaves the device
    expect(b.aim({ x: X + 1, y: 1, z: Z, nx: 0, ny: 1, nz: 0 }, me, 0).breakReason).toBe('not_yours');
    expect(b.breakAt({ x: X + 1, y: 1, z: Z }, 0)).toEqual({ ok: false, reason: 'not_yours' });
    expect(b.world.getBlock(X + 1, 1, Z)).toBe(BK.glass);
    // the friend's own glass (from an earlier visit on this pass) may go
    expect(b.aim({ x: X + 2, y: 1, z: Z, nx: 0, ny: 1, nz: 0 }, me, 0).breakReason).toBeNull();
    expect(b.breakAt({ x: X + 2, y: 1, z: Z }, 0).ok).toBe(true);
    // a new block is theirs at once
    expect(b.place({ x: X, y: 1, z: Z }, 0, 0).ok).toBe(true);
    expect(b.breakAt({ x: X, y: 1, z: Z }, 0).ok).toBe(true);
    // the chest and the slots stay the host's
    expect(b.take('b4', 1, undefined, 0)).toEqual({ ok: false, reason: 'not_yours' });
    expect(b.store(0, 0)).toEqual({ ok: false, reason: 'not_yours' });
    expect(b.swap(0, 1, 0)).toEqual({ ok: false, reason: 'not_yours' });
    expect(sent.map((o: any) => o.op)).toEqual(['break', 'place', 'break']);
    expect(BUILD_REASONS_KO.not_yours).toBeTruthy();
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
    expect(JSON.parse(store.getItem(plotQueueKey('t'.repeat(40)))!).queue).toHaveLength(3);
    await sync.flush();
    const posts = srv.calls.filter((c) => c.url.endsWith('/ops'));
    expect(posts.map((c) => c.body.ops.map((o: any) => o.x))).toEqual([[110, 111, 112], [112]]);
    expect(store.getItem(plotQueueKey('t'.repeat(40)))).toBeNull();
    expect(sync.sent).toBe(3);

    // a tab closed with a batch in flight: the next start sends it again with the same id, then loads
    store.setItem(plotQueueKey('t'.repeat(40)), JSON.stringify({ inFlight: { id: 'abc-123456789', ops: [{ op: 'swap', a: 0, b: 1 }] }, queue: [] }));
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

  it('any other 403 refuses that batch only: no seat card, no stop, the plot comes back from the server (review L1)', async () => {
    const store = new MemStore();
    const seen = vi.fn();
    const off = onSeatInactive(seen);
    const denied = vi.fn();
    const resync = vi.fn();
    let first = true;
    const srv = fakeServer((c) => {
      if (c.url.endsWith('/v1/plot')) return { status: 200, body: { ...snap, rev: 4 } };
      if (first) {
        first = false;
        return { status: 403, body: { error: 'forbidden' } };
      }
      return { status: 200, body: { results: [{ ok: true }], processed: 1, inv: {}, rev: 5 } };
    });
    const sync = new PlotSync({ token: 't'.repeat(40), store, fetchFn: srv.fetchFn, onResync: resync, onDenied: denied });
    sync.push({ op: 'place', x: 110, y: 1, z: 170, slot: 0 });
    await sync.flush();
    expect(denied).not.toHaveBeenCalled();
    expect(seen).not.toHaveBeenCalled();
    expect(store.getItem(DEVICE_PLAY_BLOCKED_KEY)).toBeNull();
    expect(resync).toHaveBeenCalledWith({ ...snap, rev: 4 });
    expect(sync.status).toBe('saved');
    // still saving afterwards
    sync.push({ op: 'place', x: 111, y: 1, z: 170, slot: 0 });
    await sync.flush();
    off();
    expect(srv.calls.filter((c) => c.url.endsWith('/ops')).map((c) => c.body.ops[0].x)).toEqual([110, 111]);
    expect(sync.status).toBe('saved');
  });

  it('keeps unsent ops per token: one child queue never goes out under another child token (review L3)', async () => {
    const store = new MemStore();
    const lesson = 'L'.repeat(48);
    const device = 'D'.repeat(48);
    const offline = async (): Promise<Response> => {
      throw new Error('offline');
    };
    const a = new PlotSync({ token: lesson, store, fetchFn: offline, onResync: () => undefined });
    a.push({ op: 'place', x: 110, y: 1, z: 170, slot: 0 });
    a.stop();
    expect(plotQueueKey(lesson)).not.toBe(plotQueueKey(device));
    expect(plotQueueKey(lesson)).not.toContain(lesson.slice(0, 8));
    const srv = fakeServer((c) => (c.url.endsWith('/v1/plot') ? { status: 200, body: snap } : { status: 200, body: { results: [], processed: 0 } }));
    const b = new PlotSync({ token: device, store, fetchFn: srv.fetchFn, onResync: () => undefined });
    expect(b.pending).toBe(0);
    await b.start();
    expect(srv.calls.filter((c) => c.url.endsWith('/ops'))).toHaveLength(0);
    expect(JSON.parse(store.getItem(plotQueueKey(lesson))!).queue).toHaveLength(1);

    // the queue saved before per-token keys belongs to this device's own linked token, and only that token takes it
    store.setItem(PLOT_QUEUE_KEY, JSON.stringify({ inFlight: null, queue: [{ op: 'swap', a: 0, b: 1 }] }));
    store.setItem(DEVICE_TOKEN_KEY, device);
    expect(new PlotSync({ token: lesson, store, fetchFn: offline, onResync: () => undefined }).pending).toBe(1); // its own op only
    expect(store.getItem(PLOT_QUEUE_KEY)).not.toBeNull();
    expect(new PlotSync({ token: device, store, fetchFn: offline, onResync: () => undefined }).pending).toBe(1);
    expect(store.getItem(PLOT_QUEUE_KEY)).toBeNull();
    expect(JSON.parse(store.getItem(plotQueueKey(device))!).queue).toEqual([{ op: 'swap', a: 0, b: 1 }]);
  });
});

describe('PlotSync on a guest pass (docs/19 §8)', () => {
  beforeEach(() => vi.stubGlobal('window', new EventTarget()));
  afterEach(() => vi.unstubAllGlobals());

  it('sends the pass header (never a bearer), and a 410 at the end of the pass stops saving like an unlinked token', async () => {
    const pass = 'p'.repeat(43);
    const seen: Array<{ url: string; headers: Record<string, string> }> = [];
    let ended = false;
    const fetchFn = async (url: string, init?: RequestInit): Promise<Response> => {
      seen.push({ url, headers: { ...(init?.headers as Record<string, string>) } });
      if (ended) return new Response(JSON.stringify({ error: 'pass_ended' }), { status: 410 });
      if (url.endsWith('/v1/plot')) return new Response(JSON.stringify(snap), { status: 200 });
      return new Response(JSON.stringify({ results: [{ ok: true }], processed: 1, inv: {}, rev: 1 }), { status: 200 });
    };
    const denied = vi.fn();
    const sync = new PlotSync({ token: pass, pass: true, store: new MemStore(), fetchFn, onResync: () => undefined, onDenied: denied });
    expect(await sync.start()).toEqual(snap);
    sync.push({ op: 'place', x: 110, y: 1, z: 170, slot: 0 });
    await sync.flush();
    expect(seen.length).toBeGreaterThanOrEqual(2);
    for (const c of seen) {
      expect(c.headers[GUEST_PASS_HEADER]).toBe(pass);
      expect(c.headers.authorization).toBeUndefined();
    }
    ended = true;
    const asked = vi.fn();
    window.addEventListener(PASS_CHECK_EVENT, asked);
    sync.push({ op: 'place', x: 111, y: 1, z: 170, slot: 0 });
    await sync.flush();
    expect(denied).toHaveBeenCalledWith('unlinked');
    // the pass layer is asked to check the pass now (it sends the friend to /guest-end)
    expect(asked).toHaveBeenCalledTimes(1);
    expect(await sync.load()).toBeNull();
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
    // a lesson saves with the student's own lesson token (the server picks that child's plot), never the device's
    expect(buildAccessOf({ kind: 'lesson', code: '123456' }, 'y'.repeat(48))).toEqual({ kind: 'saved', token: 'y'.repeat(48), lesson: true });
    expect(buildAccessOf({ kind: 'lesson', code: '123456' }, null)).toEqual({ kind: 'local' });
    expect(buildAccessOf({ kind: 'guest' }, null)).toEqual({ kind: 'local' });
    // a lesson joined without ?code= (/join hand-off, code typed in the world) on a linked tablet: the student's
    // token wins while the lesson is live, so building never lands on the linked child's plot
    expect(buildAccessOf(child, 'y'.repeat(48), true)).toEqual({ kind: 'saved', token: 'y'.repeat(48), lesson: true });
    expect(buildAccessOf({ ...child, playAllowed: false }, 'y'.repeat(48), true)).toEqual({ kind: 'saved', token: 'y'.repeat(48), lesson: true });
    expect(buildAccessOf({ kind: 'guest' }, 'y'.repeat(48), true)).toEqual({ kind: 'saved', token: 'y'.repeat(48), lesson: true });
    expect(buildAccessOf(child, 'y'.repeat(48), false)).toEqual({ kind: 'saved', token: child.token });
    // a friend on a guest pass builds on the host's plot (docs/19 §8), even on a linked tablet; a live lesson still wins
    const pass = 'p'.repeat(43);
    expect(buildAccessOf({ kind: 'guest' }, null, false, pass)).toEqual({ kind: 'saved', token: pass, pass: true });
    expect(buildAccessOf(child, null, false, pass)).toEqual({ kind: 'saved', token: pass, pass: true });
    expect(buildAccessOf({ ...child, playAllowed: false }, null, false, pass)).toEqual({ kind: 'saved', token: pass, pass: true });
    expect(buildAccessOf(child, 'y'.repeat(48), true, pass)).toEqual({ kind: 'saved', token: 'y'.repeat(48), lesson: true });
    expect(buildAccessOf({ kind: 'guest' }, null, false, 'short')).toEqual({ kind: 'local' });
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
    // only consent_required shows the guardian notice (review L2)
    expect(await publishShowroom('t', s, answer(403, { error: 'forbidden' }))).toEqual({ ok: false, reason: 'server' });
    expect(await publishShowroom('t', s, answer(403, {}))).toEqual({ ok: false, reason: 'server' });
    expect(await publishShowroom('t', s, answer(404, { error: 'not_found' }))).toEqual({ ok: false, reason: 'server' });
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
