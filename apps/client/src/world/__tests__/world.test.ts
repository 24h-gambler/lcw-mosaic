import { describe, expect, it } from 'vitest';
import { VoxelWorld } from '@lcw/sim-core';
import { BLOCK_PALETTE } from '@lcw/content';
import { NpcContextSchema } from '@lcw/schemas';
import { SCENE_IDS, type WorldHandle } from '../api.js';
import { BK, BLOCK_LOOKS, TILE_LAYER, TILE_NAMES, blockLook, collideHeight, isOpaqueCube } from '../blocks.js';
import { TILE_PX, buildAtlasPixels } from '../atlas.js';
import { AO_CURVE, PAD, meshChunk, padIndex } from '../mesher.js';
import { makeBody, pickVoxel, raycastDistance, stepBody, type BlockAt } from '../physics.js';
import { NPCS, SCENES, WANDERERS, buildTown, npcTalkable, standHeight, talkSpotFor, terrainHeight, type Spot } from '../town.js';
import { PAGE_KEYS_ON_BUTTONS, TALK_RANGE, keyIsPressable, keyIsTyping } from '../engine.js';
import { extractPadded } from '../chunks.js';
import { skyAt } from '../sky.js';
import { pickTier } from '../../App.js';
import { WORLD_STRINGS, objectParticle } from '../strings.js';

function vox(fill: (x: number, y: number, z: number) => number): Uint16Array {
  const v = new Uint16Array(PAD * PAD * PAD);
  for (let y = -1; y < PAD - 1; y++) for (let z = -1; z < PAD - 1; z++) for (let x = -1; x < PAD - 1; x++) v[padIndex(x, y, z)] = fill(x, y, z);
  return v;
}

describe('world api contract (docs/19 §2)', () => {
  it('lists the five handcrafted scenes', () => {
    expect([...SCENE_IDS]).toEqual(['plaza', 'honey_cafe', 'trade_shop', 'build_plot', 'open_hill']);
    for (const id of SCENE_IDS) expect(SCENES[id].id).toBe(id);
  });

  it('keeps the required WorldHandle members (compile-time shape)', () => {
    const keys: Array<keyof WorldHandle> = [
      'goToScene', 'onNpcInteract', 'npcSay', 'playerSay', 'giveItem', 'celebrate', 'setGoal', 'setPaused', 'dispose'
    ];
    expect(keys).toHaveLength(9);
  });

  it('gives every NPC a ctx the dialog schema accepts', () => {
    const ids = NPCS.map((n) => n.id).sort();
    expect(ids).toEqual(['cafe_owner', 'errand_neighbor', 'guide', 'shop_owner']);
    for (const n of NPCS) {
      expect(NpcContextSchema.safeParse(n.ctx).success).toBe(true);
      expect(n.nameKo.length).toBeGreaterThan(0);
      expect(n.nameEn.length).toBeGreaterThan(0);
    }
  });
});

describe('keys and focus (review M1)', () => {
  const el = (tagName: string, extra: { type?: string; role?: string; editable?: boolean } = {}): HTMLElement =>
    ({ tagName, type: extra.type, isContentEditable: extra.editable === true, getAttribute: (k: string) => (k === 'role' ? (extra.role ?? null) : null) }) as unknown as HTMLElement;

  it('a text box takes every key; a focused button or link keeps only Space, Enter and Tab', () => {
    for (const t of [el('INPUT'), el('INPUT', { type: 'text' }), el('INPUT', { type: 'range' }), el('TEXTAREA'), el('SELECT'), el('DIV', { editable: true })]) {
      expect(keyIsTyping(t)).toBe(true);
      expect(keyIsPressable(t)).toBe(false);
    }
    for (const t of [el('BUTTON'), el('A'), el('INPUT', { type: 'checkbox' }), el('INPUT', { type: 'submit' }), el('DIV', { role: 'button' })]) {
      expect(keyIsTyping(t)).toBe(false);
      expect(keyIsPressable(t)).toBe(true);
    }
    for (const t of [null, el('CANVAS'), el('BODY'), el('DIV')]) {
      expect(keyIsTyping(t)).toBe(false);
      expect(keyIsPressable(t)).toBe(false);
    }
    // walking, talking, slots and the build keys are never page keys, so they play with a button focused
    for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'KeyE', 'Digit1', 'KeyZ', 'KeyR', 'KeyC', 'Escape', 'F5']) expect(PAGE_KEYS_ON_BUTTONS.has(code)).toBe(false);
    for (const code of ['Space', 'Enter', 'Tab']) expect(PAGE_KEYS_ON_BUTTONS.has(code)).toBe(true);
  });
});

describe('block table and atlas', () => {
  it('has a look for every palette block and a layer for every tile it uses', () => {
    for (const b of BLOCK_PALETTE) {
      const look = BLOCK_LOOKS[b.id];
      expect(look, `block ${b.id} ${b.key}`).toBeDefined();
      for (const t of [look!.top, look!.side, look!.bottom]) {
        if (t) expect(TILE_LAYER[t], `tile ${t}`).toBeTypeOf('number');
      }
    }
    expect(isOpaqueCube(BK.stone)).toBe(true);
    expect(isOpaqueCube(BK.glass)).toBe(false);
    expect(isOpaqueCube(BK.air)).toBe(false);
    expect(collideHeight(BK.air)).toBe(0);
    expect(collideHeight(BK.stone)).toBe(1);
    expect(blockLook(9999)).toBeDefined(); // unknown ids still draw (as a fallback cube) instead of crashing
  });

  it('paints one 16x16 RGBA layer per tile, deterministically', () => {
    const a = buildAtlasPixels();
    const b = buildAtlasPixels();
    expect(a.length).toBe(TILE_NAMES.length * TILE_PX * TILE_PX * 4);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });
});

describe('greedy mesher', () => {
  it('merges a flat floor into one quad per exposed face and culls hidden faces', () => {
    const m = meshChunk(vox((x, y, z) => (y === 0 && x >= 0 && x < 16 && z >= 0 && z < 16 ? BK.stone : 0)));
    // top + bottom are one quad each; the 4 sides are one quad each (neighbours are air).
    expect(m.opaque.quads).toBe(6);
    expect(m.translucent.quads).toBe(0);
    expect(m.opaque.index.length).toBe(6 * 6);
  });

  it('does not emit faces between two solid neighbours and splits by texture', () => {
    const solid = meshChunk(vox((x, y, z) => (x >= 0 && x < 16 && y >= 0 && y < 16 && z >= 0 && z < 16 ? BK.stone : 0)));
    expect(solid.opaque.quads).toBe(6);
    const mixed = meshChunk(vox((x, y, z) => (y === 0 && x >= 0 && x < 16 && z >= 0 && z < 16 ? (x < 8 ? BK.stone : BK.brick) : 0)));
    expect(mixed.opaque.quads).toBeGreaterThan(6);
  });

  it('darkens corners with ambient occlusion', () => {
    // a single block in a corner formed by two walls: some vertices must be darker than full light
    const m = meshChunk(vox((x, y, z) => ((x === 4 && z === 4 && y <= 1) || (y === 0 && x >= 3 && x <= 5 && z >= 3 && z <= 5) || (x === 5 && z === 4 && y === 1) ? BK.stone : 0)));
    let min = 1;
    for (let i = 0; i < m.opaque.color.length; i++) min = Math.min(min, m.opaque.color[i]!);
    expect(min).toBeLessThan(1);
    expect(min).toBeGreaterThanOrEqual(AO_CURVE[0]);
  });

  it('routes glass and water to the translucent pass and plants to cross quads', () => {
    const m = meshChunk(vox((x, y, z) => (x === 2 && y === 2 && z === 2 ? BK.glass : x === 6 && y === 2 && z === 6 ? BK.water : x === 9 && y === 2 && z === 9 ? BK.flowerRed : 0)));
    expect(m.translucent.quads).toBeGreaterThan(0);
    expect(m.opaque.quads).toBeGreaterThanOrEqual(4); // plant cross quads (both windings)
  });
});

describe('town build (all through setBlock)', () => {
  const world = new VoxelWorld();
  const calls = buildTown(world);

  it('places blocks only through the setter and is deterministic', () => {
    expect(calls).toBeGreaterThan(50_000);
    const again = new VoxelWorld();
    expect(buildTown(again)).toBe(calls);
    for (const [x, y, z] of [[144, 1, 144], [170, 3, 134], [116, 2, 133], [118, 1, 158], [144, 9, 102]] as const) {
      expect(again.getBlock(x, y, z)).toBe(world.getBlock(x, y, z));
    }
  });

  it('stands every scene spot on solid ground with headroom (not on roofs or awnings)', () => {
    for (const id of SCENE_IDS) {
      const s = SCENES[id];
      const spots = [s.player, ...(s.npc ? [s.npc.spot] : [])];
      for (const spot of spots) {
        const y = standHeight(world, spot.x, spot.z, Math.ceil(spot.y) + 1);
        expect(Math.abs(y - spot.y), `${id} at ${spot.x},${spot.z} stands at ${y}`).toBeLessThan(1.01);
        const by = Math.ceil(y - 0.01); // first cell above the surface (paths are 15/16 tall)
        expect(collideHeight(world.getBlock(Math.floor(spot.x), by, Math.floor(spot.z)))).toBe(0);
        expect(collideHeight(world.getBlock(Math.floor(spot.x), by + 1, Math.floor(spot.z)))).toBe(0);
      }
    }
  });

  it('stands the errand neighbour by the honey cafe door, off the walk to the counter (docs/03 D1)', () => {
    const n = NPCS.find((d) => d.ctx === 'errand')!;
    expect(n.spot).toBeDefined();
    const spot = n.spot!;
    const y = standHeight(world, spot.x, spot.z, Math.ceil(spot.y) + 1);
    expect(Math.abs(y - spot.y)).toBeLessThan(1.01);
    const by = Math.ceil(y - 0.01);
    expect(collideHeight(world.getBlock(Math.floor(spot.x), by, Math.floor(spot.z)))).toBe(0);
    expect(collideHeight(world.getBlock(Math.floor(spot.x), by + 1, Math.floor(spot.z)))).toBe(0);
    // the cafe door is the opening in the west wall at (166, 1..2, 138)
    expect(world.getBlock(166, 1, 138)).toBe(0);
    expect(Math.hypot(spot.x - 166, spot.z - 138)).toBeLessThan(6);
    // at least 2 m from every point of the cafe walk and from the counter spot, so the two-shot stays clear
    const walk = [...(SCENES.honey_cafe.path ?? []), [SCENES.honey_cafe.player.x, SCENES.honey_cafe.player.z]] as Array<[number, number]>;
    for (let i = 1; i < walk.length; i++) {
      const [ax, az] = walk[i - 1]!;
      const [bx, bz] = walk[i]!;
      for (let t = 0; t <= 1; t += 0.05) expect(Math.hypot(ax + (bx - ax) * t - spot.x, az + (bz - az) * t - spot.z)).toBeGreaterThanOrEqual(2);
    }
  });

  it('in a lesson only the stage NPC is in reach where each scene starts: the errand giver steps out (review L4)', () => {
    // where everyone stands while the lesson is in scene `id`: its NPC on the scene spot, the rest at home
    const homeSpot = (npcId: string): Spot | undefined => {
      const d = NPCS.find((n) => n.id === npcId)!;
      return d.spot ?? (SCENES[d.home].npc?.id === npcId ? SCENES[d.home].npc!.spot : undefined);
    };
    expect(NPCS.filter((n) => n.soloOnly).map((n) => n.id)).toEqual(['errand_neighbor']);
    expect(npcTalkable(NPCS.find((n) => n.id === 'errand_neighbor')!, false)).toBe(true);
    for (const id of SCENE_IDS) {
      const s = SCENES[id];
      if (!s.npc) continue;
      const stage = Math.hypot(s.npc.spot.x - s.player.x, s.npc.spot.z - s.player.z);
      for (const n of NPCS) {
        if (n.id === s.npc.id || !npcTalkable(n, true)) continue;
        const at = homeSpot(n.id);
        if (!at) continue;
        const d = Math.hypot(at.x - s.player.x, at.z - s.player.z);
        // clearly farther than the stage NPC and out of E reach from the scene spot
        expect(d, `${id}: ${n.id} vs ${s.npc.id}`).toBeGreaterThan(Math.max(stage + 2, TALK_RANGE + 1));
      }
    }
  });

  it('finds a talk spot in front of every fixed-place NPC, inside the talk range and reachable from its scene (walkToNpc)', () => {
    // counter NPCs are reached by their scene walk (paths tested below); fixed places need their own spot
    const fixed = NPCS.filter((n) => n.spot);
    expect(fixed.length).toBeGreaterThan(0);
    for (const n of fixed) {
      const at = n.spot!;
      const y = standHeight(world, at.x, at.z, Math.ceil(at.y) + 1);
      const spot = talkSpotFor(world, { x: at.x, y, z: at.z, yaw: at.yaw });
      expect(spot, n.id).not.toBeNull();
      expect(Math.hypot(spot!.x - at.x, spot!.z - at.z)).toBeLessThan(TALK_RANGE - 1);
      // a straight walk from where the NPC's scene starts, no wall taller than a step
      const from = SCENES[n.home].player;
      let prevY = standHeight(world, from.x, from.z, Math.ceil(from.y) + 1);
      const steps = Math.ceil(Math.hypot(spot!.x - from.x, spot!.z - from.z) / 0.25);
      for (let i = 1; i <= steps; i++) {
        const x = from.x + ((spot!.x - from.x) * i) / steps;
        const z = from.z + ((spot!.z - from.z) * i) / steps;
        const yy = standHeight(world, x, z, Math.ceil(prevY) + 2);
        expect(yy - prevY, `${n.id} near ${x.toFixed(1)},${z.toFixed(1)}`).toBeLessThanOrEqual(1.05);
        prevY = yy;
      }
    }
    // 미나: in front of her (facing the road, +z), not behind the cafe wall
    const mina = NPCS.find((n) => n.id === 'errand_neighbor')!.spot!;
    const spot = talkSpotFor(world, { ...mina, y: standHeight(world, mina.x, mina.z, 2) })!;
    expect(spot.z).toBeGreaterThan(mina.z);
  });

  it('keeps the auto-walk paths from the plaza walkable (no wall taller than a step)', () => {
    for (const id of SCENE_IDS) {
      let [px, pz] = [SCENES.plaza.player.x, SCENES.plaza.player.z];
      let prevY = standHeight(world, px, pz, 3);
      for (const [wx, wz] of SCENES[id].path) {
        const n = Math.ceil(Math.hypot(wx - px, wz - pz) / 0.25);
        for (let i = 1; i <= n; i++) {
          const x = px + ((wx - px) * i) / n;
          const z = pz + ((wz - pz) * i) / n;
          const y = standHeight(world, x, z, Math.ceil(prevY) + 2);
          expect(y - prevY, `${id} near ${x.toFixed(1)},${z.toFixed(1)}`).toBeLessThanOrEqual(1.05);
          prevY = y;
        }
        [px, pz] = [wx, wz];
      }
    }
  });

  it('starts wanderers on the ground, and the plaza is flat at the town centre', () => {
    expect(terrainHeight(144, 144)).toBe(0);
    expect(terrainHeight(144, 102)).toBeGreaterThan(5);
    for (const w of WANDERERS) {
      const [x, z] = w.route[0]!;
      expect(standHeight(world, x, z, terrainHeight(x, z) + 2)).toBeLessThan(3);
    }
  });

  it('extracts padded chunk volumes the mesher can turn into geometry', () => {
    const padded = extractPadded(world, 9, 0, 9); // plaza chunk (x/z 144..160)
    const m = meshChunk(padded, [144, 0, 144]);
    expect(m.opaque.quads).toBeGreaterThan(10);
  });
});

describe('player physics', () => {
  const floor: BlockAt = (_x, y) => (y < 0 ? BK.stone : 0);

  it('falls under gravity and lands on the floor', () => {
    const b = makeBody(0.5, 3, 0.5);
    for (let i = 0; i < 120; i++) stepBody(b, { dx: 0, dz: 0, run: false, jump: false }, 1 / 60, floor);
    expect(b.onGround).toBe(true);
    expect(b.y).toBeCloseTo(0, 3);
  });

  it('steps up one block and is stopped by a two-block wall', () => {
    const step: BlockAt = (x, y) => (y < 0 || (x >= 3 && y === 0) ? BK.stone : 0);
    const a = makeBody(0.5, 0, 0.5);
    for (let i = 0; i < 180; i++) stepBody(a, { dx: 1, dz: 0, run: false, jump: false }, 1 / 60, step);
    expect(a.x).toBeGreaterThan(3.5);
    expect(a.y).toBeCloseTo(1, 1);

    const wall: BlockAt = (x, y) => (y < 0 || (x >= 3 && y <= 1) ? BK.stone : 0);
    const w = makeBody(0.5, 0, 0.5);
    for (let i = 0; i < 180; i++) stepBody(w, { dx: 1, dz: 0, run: false, jump: false }, 1 / 60, wall);
    expect(w.x).toBeLessThan(3);
  });

  it('jumps about a block high', () => {
    const b = makeBody(0.5, 0, 0.5);
    stepBody(b, { dx: 0, dz: 0, run: false, jump: false }, 1 / 60, floor);
    let peak = 0;
    stepBody(b, { dx: 0, dz: 0, run: false, jump: true }, 1 / 60, floor);
    for (let i = 0; i < 90; i++) {
      stepBody(b, { dx: 0, dz: 0, run: false, jump: false }, 1 / 60, floor);
      peak = Math.max(peak, b.y);
    }
    expect(peak).toBeGreaterThan(1.1);
    expect(peak).toBeLessThan(1.6);
  });

  it('casts camera rays and picks the first voxel with its face normal', () => {
    const wall: BlockAt = (x) => (x === 5 ? BK.stone : 0);
    expect(raycastDistance(wall, 0.5, 0.5, 0.5, 1, 0, 0, 10)).toBeCloseTo(4.5, 0);
    const hit = pickVoxel(wall, 0.5, 0.5, 0.5, 1, 0, 0, 10);
    expect(hit).toMatchObject({ x: 5, y: 0, z: 0, nx: -1, ny: 0, nz: 0 });
    expect(pickVoxel(wall, 0.5, 0.5, 0.5, -1, 0, 0, 10)).toBeNull();
  });
});

describe('tier choice and sky', () => {
  it('honours ?tier= and falls back by device class (docs/08 6.6)', () => {
    expect(pickTier('?tier=low', { hardwareConcurrency: 16, deviceMemory: 16 }, false)).toBe('low');
    expect(pickTier('', { hardwareConcurrency: 16, deviceMemory: 16 }, false)).toBe('high');
    expect(pickTier('', { hardwareConcurrency: 8, deviceMemory: 8 }, true)).toBe('mid');
    expect(pickTier('', { hardwareConcurrency: 4, deviceMemory: 2 }, true)).toBe('low');
  });

  it('interpolates the sky table across the day', () => {
    const noon = skyAt(12);
    const night = skyAt(23);
    expect(noon.ambient).toBeGreaterThan(night.ambient);
  });
});

describe('player-facing strings', () => {
  it('picks 을/를 from the final consonant', () => {
    expect(objectParticle('꿀차')).toBe('를');
    expect(objectParticle('헬멧')).toBe('을');
    expect(WORLD_STRINGS.itemGot('따뜻한 꿀차')).toBe('따뜻한 꿀차를 받았어요');
    expect(objectParticle('ABC')).toBe('을(를)');
  });
});
