import { describe, expect, it } from 'vitest';
import { VoxelWorld } from '@lcw/sim-core';
import { UI_STRINGS_EN } from '@lcw/content';
import { POST_HALF_W, STORES, nightAmount, storeName, storeWindows } from '../storefront.js';
import { MINIMAP_AREA, edgePoint, minimapPixels, storeOfNpc } from '../wayfinding.js';
import { SCENES, buildTown, sceneRoute } from '../town.js';

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

  it('the road signs stand clear of every auto-walk path and of the building', () => {
    for (const s of STORES) {
      for (const from of Object.keys(SCENES) as Array<keyof typeof SCENES>) {
        for (const to of Object.keys(SCENES) as Array<keyof typeof SCENES>) {
          const pts = sceneRoute(from, to, SCENES[from].player.x, SCENES[from].player.z);
          for (let i = 0; i + 1 < pts.length; i++) {
            expect(segDist(s.post.x, s.post.z, pts[i]!, pts[i + 1]!), `${s.id} post vs ${from}->${to}`).toBeGreaterThan(1.2);
          }
        }
      }
      // the two posts stand on open ground (not in a wall, a barrel or the curb's lamp)
      for (const dz of [-(POST_HALF_W - 0.12), POST_HALF_W - 0.12]) {
        expect(world.getBlock(Math.floor(s.post.x), 1, Math.floor(s.post.z + dz))).toBe(0);
        expect(world.getBlock(Math.floor(s.post.x), 0, Math.floor(s.post.z + dz))).not.toBe(0);
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
    expect(storeName(shop).toLowerCase()).toBe('trade shop');
    expect(storeName(cafe).toLowerCase()).toBe('honey cafe');
    const goals = UI_STRINGS_EN as unknown as { firstVisit?: Record<string, string> };
    const lines = JSON.stringify(goals).toLowerCase();
    expect(lines).toContain('trade shop');
  });

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
});
