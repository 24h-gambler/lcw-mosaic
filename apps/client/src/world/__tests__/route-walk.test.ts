import { describe, expect, it } from 'vitest';
import { VoxelWorld } from '@lcw/sim-core';
import { SCENE_IDS } from '../api.js';
import { STEP_UP_SMALL, makeBody, stepBody, type BlockAt } from '../physics.js';
import { SCENES, buildTown, sceneRoute, standHeight } from '../town.js';

/**
 * Dan 11-16 R2625 ②: with auto jump off (the default) the body climbs half a block only. A child walking by keys from
 * the plaza to every scene along the town's own route must still get there without pressing jump (a missed curb would
 * be a wall nobody expects). Simulated with the real physics, 60 steps a second.
 */
describe('town routes walk without auto jump', () => {
  const world = new VoxelWorld();
  buildTown(world);
  const blockAt: BlockAt = (x, y, z) => world.getBlock(x, y, z);

  for (const to of SCENE_IDS.filter((s) => s !== 'plaza')) {
    it(`plaza -> ${to}`, () => {
      const p = SCENES.plaza.player;
      const body = makeBody(p.x, standHeight(world, p.x, p.z), p.z);
      const route = sceneRoute('plaza', to, body.x, body.z);
      const end = route[route.length - 1]!;
      let stuck = 0;
      let lastX = body.x;
      let lastZ = body.z;
      for (let i = 0; i < 60 * 90 && route.length > 0; i++) {
        const [tx, tz] = route[0]!;
        const dx = tx - body.x;
        const dz = tz - body.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.6) {
          route.shift();
          continue;
        }
        stepBody(body, { dx: dx / d, dz: dz / d, run: false, jump: false }, 1 / 60, blockAt, [], STEP_UP_SMALL);
        if (i % 60 === 0) {
          stuck = Math.hypot(body.x - lastX, body.z - lastZ) < 0.3 ? stuck + 1 : 0;
          lastX = body.x;
          lastZ = body.z;
          if (stuck > 3) break;
        }
      }
      const left = Math.hypot(end[0] - body.x, end[1] - body.z);
      expect({ to, left: Math.round(left * 10) / 10, at: [Math.round(body.x), Math.round(body.y * 10) / 10, Math.round(body.z)] }).toMatchObject({ to });
      expect(left).toBeLessThan(1.5);
    });
  }
});
