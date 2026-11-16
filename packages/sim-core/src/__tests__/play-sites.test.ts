import { describe, expect, it } from 'vitest';
import {
  BK,
  TERRAIN_MAX,
  TERRAIN_MIN,
  TUNING,
  VoxelWorld,
  buildTown,
  clockIn,
  counterSpots,
  customerSpot,
  elevatorSpot,
  hallDoor,
  interviewOutcome,
  marketAfterSale,
  marketRecovered,
  mineVeins,
  newJob,
  officeHours,
  oreMarketPrice,
  promoteIfReady,
  toolTierOf,
  veinById,
  PLAY_SITE_BOXES,
  MINE_FLOORS,
  PLAY_COUNTERS
} from '../index.js';

/** Play places (play-sites.ts): world lane constraints 2026-11-16 and docs/03 D2 ore depths. */

const ORIGIN = { x: 144, z: 144 };
// lesson route (world lane): plaza, honey cafe, trade shop spots and the walks between them (town.ts SCENES paths)
const LESSON_ROUTE: Array<[number, number]> = [
  [144.5, 152.3],
  [152, 144],
  [160.5, 144],
  [163.5, 141],
  [163.5, 136.5],
  [165.2, 134.5],
  [167.5, 134.5],
  [136, 144],
  [127, 144],
  [123, 140],
  [123, 135]
];

function segDist(px: number, pz: number, a: [number, number], b: [number, number]): number {
  const [ax, az] = a;
  const [bx, bz] = b;
  const l2 = (bx - ax) ** 2 + (bz - az) ** 2;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (pz - az) * (bz - az)) / l2));
  return Math.hypot(px - (ax + t * (bx - ax)), pz - (az + t * (bz - az)));
}

describe('play sites (world lane placement rules)', () => {
  const box = PLAY_SITE_BOXES[0];
  const x0 = ORIGIN.x + box.dx0;
  const x1 = ORIGIN.x + box.dx1;
  const z0 = ORIGIN.z + box.dz0;
  const z1 = ORIGIN.z + box.dz1;

  it('the hall keeps 8 m from the lesson route and 6 m inside the terrain edge', () => {
    let nearest = Infinity;
    for (let x = x0; x <= x1; x += 0.5)
      for (let z = z0; z <= z1; z += 0.5)
        for (let i = 0; i + 1 < LESSON_ROUTE.length; i++) nearest = Math.min(nearest, segDist(x, z, LESSON_ROUTE[i]!, LESSON_ROUTE[i + 1]!));
    expect(nearest).toBeGreaterThanOrEqual(8);
    expect(x0 - TERRAIN_MIN).toBeGreaterThanOrEqual(6);
    expect(z0 - TERRAIN_MIN).toBeGreaterThanOrEqual(6);
    expect(TERRAIN_MAX - x1).toBeGreaterThanOrEqual(6);
    expect(TERRAIN_MAX - z1).toBeGreaterThanOrEqual(6);
  });

  it('counters, the customer and the elevator stand inside the hall; the keeper is 2.2 m in front of the child', () => {
    const inside = (p: { x: number; z: number }) => p.x > x0 && p.x < x1 && p.z > z0 && p.z < z1;
    for (const c of PLAY_COUNTERS) {
      const s = counterSpots(c.id);
      expect(inside(s.npc) && inside(s.player), c.id).toBe(true);
      expect(Math.hypot(s.npc.x - s.player.x, s.npc.z - s.player.z)).toBeCloseTo(2.2, 5);
    }
    expect(inside(customerSpot())).toBe(true);
    expect(inside(elevatorSpot('hall'))).toBe(true);
    expect(inside({ x: hallDoor().x, z: hallDoor().z + 2 })).toBe(true);
  });

  it('veins: each floor ore lies in its docs/03 D2 depth band, ids are unique and stable', () => {
    const veins = mineVeins();
    expect(new Set(veins.map((v) => v.id)).size).toBe(veins.length);
    for (const f of MINE_FLOORS) expect(veins.filter((v) => v.floor === f.id).length).toBeGreaterThanOrEqual(8);
    for (const v of veins) {
      const o = TUNING.mining.ores[v.ore]!;
      expect(v.y, `${v.id} ${v.ore}`).toBeGreaterThanOrEqual(o.minY);
      expect(v.y, `${v.id} ${v.ore}`).toBeLessThanOrEqual(o.maxY);
      expect(veinById(v.id)).toEqual(v);
    }
    // every ore of the exchange can be found somewhere
    expect(new Set(veins.map((v) => v.ore))).toEqual(new Set(['coal', 'iron', 'gold', 'ruby', 'diamond']));
  });

  it('the built town carries the hall and the vein blocks (all through setBlock)', () => {
    const w = new VoxelWorld();
    buildTown(w);
    const oreBlock: Record<string, number> = { coal: BK.oreCoal, iron: BK.oreIron, gold: BK.oreGold, ruby: BK.oreRuby, diamond: BK.oreDiamond };
    for (const v of mineVeins()) expect(w.getBlock(v.x, v.y, v.z), v.id).toBe(oreBlock[v.ore]);
    // each mine floor: the elevator stop is open air with ground under it
    for (const f of MINE_FLOORS) {
      const e = elevatorSpot(f.id);
      const [ex, ez] = [Math.floor(e.x), Math.floor(e.z)];
      expect(w.getBlock(ex, f.floorY, ez), f.id).not.toBe(0);
      expect(w.getBlock(ex, f.floorY + 1, ez), f.id).toBe(0);
      expect(w.getBlock(ex, f.floorY + 2, ez), f.id).toBe(0);
    }
    // the counter spots stand on floor with headroom
    for (const c of PLAY_COUNTERS) {
      const s = counterSpots(c.id).player;
      expect(w.getBlock(Math.floor(s.x), 0, Math.floor(s.z)), c.id).not.toBe(0);
      expect(w.getBlock(Math.floor(s.x), 1, Math.floor(s.z)), c.id).toBe(0);
      expect(w.getBlock(Math.floor(s.x), 2, Math.floor(s.z)), c.id).toBe(0);
    }
  });
});

describe('play rules (play.ts, docs/03 D2 D4, docs/04 4.2)', () => {
  it('interview: the weakest turn decides; 3 stars hires one rank up, 2 stars adds a contract bonus', () => {
    expect(interviewOutcome([3, 3, 3])).toEqual({ rank: 'staff', contractBonus: 0 });
    expect(interviewOutcome([3, 2, 3])).toEqual({ rank: 'intern', contractBonus: Math.round(TUNING.career.ranks.intern.dailyPay * 0.25) });
    expect(interviewOutcome([1, 3, 3])).toEqual({ rank: 'intern', contractBonus: 0 });
  });

  it('office hours and clock-in: late 1 star halves the pay, late 3 stars earns a promotion point', () => {
    expect(officeHours(479)).toBe('before_open');
    expect(officeHours(480)).toBe('on_time');
    expect(officeHours(540)).toBe('on_time');
    expect(officeHours(541)).toBe('late');
    expect(officeHours(1020)).toBe('closed');
    expect(clockIn(0, 'late', 1).shift.payFactor).toBe(0.5);
    expect(clockIn(0, 'late', 3).promoPoint).toBe(true);
    expect(clockIn(0, 'on_time', 3).promoPoint).toBe(false);
  });

  it('promotion: intern after 3 paid days, counters restart at the new rank', () => {
    const j = { ...newJob(), rank: 'intern' as const, daysWorked: 2 };
    expect(promoteIfReady(j).promotedTo).toBeNull();
    const p = promoteIfReady({ ...j, daysWorked: 3 });
    expect(p.promotedTo).toBe('staff');
    expect(p.job.daysWorked).toBe(0);
  });

  it('market: selling presses the price, time brings it back toward 1', () => {
    const after = marketAfterSale(1, 10);
    expect(after).toBeLessThan(1);
    expect(marketRecovered(after, 0)).toBe(after);
    expect(marketRecovered(after, 48 * 3_600_000)).toBeGreaterThan(0.99);
    expect(oreMarketPrice('coal', 1)).toBe(TUNING.mining.ores.coal!.price);
  });

  it('tools: everyone has tier 1; the iron pickaxe and the drill raise it', () => {
    expect(toolTierOf([])).toBe(1);
    expect(toolTierOf(['pickaxe'])).toBe(2);
    expect(toolTierOf(['pickaxe', 'drill'])).toBe(3);
  });
});

describe('mining income (docs/03 D3: 채굴 초반 10분 300 ~ 500)', () => {
  it('floor 1 cleared as often as it grows back in 10 minutes of play pays 300 ~ 500 coins at the exchange', () => {
    const floor1 = mineVeins().filter((v) => v.floor === 'mine');
    const rounds = Math.floor((10 * 60 * 1000) / TUNING.play.mine.veinRespawnPlayMs);
    const base = floor1.reduce((s, v) => s + TUNING.mining.ores[v.ore]!.price, 0) * rounds;
    expect(base).toBeGreaterThanOrEqual(300);
    expect(Math.round(base * (1 + TUNING.play.exchangeBonusByStars[3]))).toBeLessThanOrEqual(500);
  });
});
