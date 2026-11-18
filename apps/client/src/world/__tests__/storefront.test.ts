import { afterEach, describe, expect, it } from 'vitest';
import { VoxelWorld } from '@lcw/sim-core';
import { UI_STRINGS_EN } from '@lcw/content';
import { POST_HALF_W, SIGN_Y0, SIGN_Y1, STORES, nightAmount, signPost, storeName, storeWindows } from '../storefront.js';
import { MINIMAP_AREA, edgePoint, minimapPixels, minimapSteps, storeOfNpc } from '../wayfinding.js';
import { SCENES, WANDERERS, buildTown, sceneRoute } from '../town.js';
import { setHelpKo } from '../lang.js';

const world = new VoxelWorld();
buildTown(world);
const GLASS = 9;

/** distance from (px, pz) to the segment a-b */
function segDist(px: number, pz: number, a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / l2));
  return Math.hypot(px - (a[0] + t * dx), pz - (a[1] + t * dz));
}

describe('store fronts (R2627: a store reads as a store at a glance)', () => {
  it('each store has a fascia on its front wall above the awning, its front facing the road it is reached from', () => {
    for (const s of STORES) {
      const wallX = s.front.facing === 1 ? s.front.x - 1 : s.front.x;
      // the fascia's rows are wall blocks (not air): the board is fixed to a wall, not floating
      for (let z = Math.ceil(s.fascia.z0); z < Math.floor(s.fascia.z1); z++) {
        for (let y = Math.floor(s.fascia.y0); y < Math.floor(s.fascia.y1); y++) {
          expect(world.getBlock(wallX, y, z), `${s.id} wall at ${wallX},${y},${z}`).not.toBe(0);
        }
      }
      // in front of the board at the fascia height there is open air for at least two blocks (seen from the street)
      const outX = s.front.facing === 1 ? s.front.x : s.front.x - 1;
      const mid = Math.floor((s.fascia.z0 + s.fascia.z1) / 2);
      expect(world.getBlock(outX, 6, mid)).toBe(0);
      expect(world.getBlock(outX + s.front.facing, 6, mid)).toBe(0);
      // the scene's player spot (the counter) faces the store front
      const sc = SCENES[s.scene];
      expect(Math.sign(Math.sin(sc.player.yaw))).toBe(-s.front.facing);
    }
  });

  it('the road sign hangs over the curb, its one post clear of every auto-walk path and walker route', () => {
    const routes: Array<{ name: string; pts: Array<[number, number]> }> = [];
    for (const from of Object.keys(SCENES) as Array<keyof typeof SCENES>) {
      for (const to of Object.keys(SCENES) as Array<keyof typeof SCENES>) {
        routes.push({ name: `${from}->${to}`, pts: sceneRoute(from, to, SCENES[from].player.x, SCENES[from].player.z) as Array<[number, number]> });
      }
    }
    for (const w of WANDERERS) routes.push({ name: w.id, pts: [...w.route, w.route[0]!] as Array<[number, number]> });
    for (const s of STORES) {
      for (const r of routes) {
        for (let i = 0; i + 1 < r.pts.length; i++) {
          // a child (0.3 m half width) walking the path never brushes the post (0.09 m half width)
          const pp = signPost(s);
          expect(segDist(pp.x, pp.z, r.pts[i]!, r.pts[i + 1]!), `${s.id} post vs ${r.name}`).toBeGreaterThan(0.6);
        }
      }
      // the board is beside the road, not over it (the road is z 142..145 by both stores)
      expect(s.post.z + POST_HALF_W).toBeLessThanOrEqual(142.8);
      // the post stands on the ground with open air around it up to the arm
      const pp = signPost(s);
      expect(world.getBlock(Math.floor(pp.x), 0, Math.floor(pp.z))).not.toBe(0);
      for (let y = 1; y <= Math.floor(SIGN_Y1); y++) expect(world.getBlock(Math.floor(pp.x), y, Math.floor(pp.z)), `${s.id} post at y ${y}`).toBe(0);
    }
  });

  it('the road sign board hangs over head height and runs through no block', () => {
    // ground top is y 1; the collision box is 1.8 m: the board's underside is 2 m up
    expect(SIGN_Y0 - 1).toBeGreaterThanOrEqual(2);
    for (const s of STORES) {
      for (let z = Math.floor(s.post.z - POST_HALF_W); z <= Math.floor(s.post.z + POST_HALF_W); z++) {
        for (let y = Math.floor(SIGN_Y0); y <= Math.floor(SIGN_Y1); y++) {
          expect(world.getBlock(Math.floor(s.post.x), y, z), `${s.id} board at ${Math.floor(s.post.x)},${y},${z}`).toBe(0);
        }
      }
    }
  });

  it('the badge floats above the roof ridge', () => {
    for (const s of STORES) {
      let top = -1;
      for (let y = 0; y < 30; y++) if (world.getBlock(Math.floor(s.badge.x), y, Math.floor(s.badge.z)) !== 0) top = y;
      expect(top).toBeGreaterThan(8);
      expect(s.badge.y - 1.7).toBeGreaterThan(top + 1);
    }
  });

  it('every store window gets a light plane, only glass (door and counter openings stay clear)', () => {
    for (const s of STORES) {
      const w = storeWindows(world, s);
      expect(w.length).toBeGreaterThanOrEqual(6);
      for (const o of w) {
        expect(world.getBlock(o.x, o.y, o.z)).toBe(GLASS);
        expect(Math.abs(o.nx) + Math.abs(o.nz)).toBe(1);
      }
    }
  });

  it('the sign says the name the goal line uses (a child matches the words)', () => {
    const cafe = STORES.find((s) => s.id === 'honey_cafe')!;
    const shop = STORES.find((s) => s.id === 'trade_shop')!;
    expect(storeName(shop)).toBe('Trade Shop');
    expect(storeName(cafe)).toBe('Honey Cafe');
    const goals = (UI_STRINGS_EN as unknown as { firstVisit: Record<string, string> }).firstVisit;
    expect(goals.goalAskWay!.toLowerCase()).toContain(storeName(shop).toLowerCase());
    expect(goals.goalTrade!.toLowerCase()).toContain(storeName(shop).toLowerCase());
    expect(goals.goalOrder!.toLowerCase()).toContain(storeName(cafe).toLowerCase());
    expect(goals.goalCafeStars!.toLowerCase()).toContain(storeName(cafe).toLowerCase());
  });

  it('the sign stays in the learning language with the Korean help on (no help line on a sign)', () => {
    setHelpKo(true);
    for (const s of STORES) expect(storeName(s)).not.toMatch(/[\u3131-\uD79D]/);
    expect(storeName(STORES.find((s) => s.id === 'trade_shop')!)).toBe('Trade Shop');
  });
  afterEach(() => setHelpKo(false));

  it('night amount: 0 by day, 1 at night, a smooth dusk and dawn', () => {
    expect(nightAmount(12)).toBe(0);
    expect(nightAmount(10.5)).toBe(0);
    expect(nightAmount(22)).toBe(1);
    expect(nightAmount(2)).toBe(1);
    expect(nightAmount(18)).toBeCloseTo(0.5, 5);
    expect(nightAmount(6)).toBeCloseTo(0.5, 5);
  });
});

describe('way-finding', () => {
  it('the edge arrow sits on the inset rectangle along the direction to the goal', () => {
    const inset = { top: 120, right: 40, bottom: 110, left: 40 };
    const right = edgePoint(500, 0, 1440, 900, inset);
    expect(right.x).toBeCloseTo(1400, 5);
    expect(right.y).toBeCloseTo(450, 5);
    expect(right.angle).toBeCloseTo(0, 5);
    const up = edgePoint(0, -10, 1440, 900, inset);
    expect(up.y).toBeCloseTo(120, 5);
    const corner = edgePoint(-1000, 1000, 1440, 900, inset);
    expect(corner.y).toBeLessThanOrEqual(900 - 110 + 1e-6);
    expect(corner.x).toBeGreaterThanOrEqual(40 - 1e-6);
  });

  it('the goal NPC highlights its store', () => {
    expect(storeOfNpc('cafe_owner')?.id).toBe('honey_cafe');
    expect(storeOfNpc('shop_owner')?.id).toBe('trade_shop');
    expect(storeOfNpc('guide')).toBeNull();
    expect(storeOfNpc(null)).toBeNull();
  });

  it('the minimap ground shows the buildings brighter than the street', () => {
    const colorOf = (id: number): readonly [number, number, number] | null => (id === 0 ? null : [100, 100, 100]);
    const px = minimapPixels((x, y, z) => world.getBlock(x, y, z), colorOf);
    const w = MINIMAP_AREA.x1 - MINIMAP_AREA.x0;
    const at = (x: number, z: number): number => px[((z - MINIMAP_AREA.z0) * w + (x - MINIMAP_AREA.x0)) * 4]!;
    expect(px.length).toBe(w * (MINIMAP_AREA.z1 - MINIMAP_AREA.z0) * 4);
    expect(at(116, 134)).toBeGreaterThan(at(116, 143)); // the trade shop's roof vs the west road
  });

  it('the minimap ground is built in steps (no long start-up task) and gives the same picture', () => {
    const colorOf = (id: number): readonly [number, number, number] | null => (id === 0 ? null : [100, 120, 140]);
    const steps = minimapSteps((x, y, z) => world.getBlock(x, y, z), colorOf);
    let n = 0;
    let r = steps.next();
    while (!r.done) {
      n++;
      r = steps.next();
    }
    expect(n).toBeGreaterThanOrEqual(8);
    expect(Buffer.from(r.value).equals(Buffer.from(minimapPixels((x, y, z) => world.getBlock(x, y, z), colorOf)))).toBe(true);
  });
});
