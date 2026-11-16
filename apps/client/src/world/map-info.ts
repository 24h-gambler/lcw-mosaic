/**
 * The map read-out behind `WorldHandle.getMap` (docs/08 G06, docs/19 2장). Pure so the shape is tested without a
 * WebGL world: the engine passes where the body stands, which way the view faces, and the plot bounds.
 *
 * Until world generation lands there is one hand-built sector, the central town (docs/03 3.5), plus my plot inside it.
 * The 3 x 3 layout itself comes from TUNING.world (sectorSize, sizeX): the map draws all nine cells and shows the
 * ones without a sector here as not yet visited. When the generator adds the other eight, it lists them in `sectors`
 * with the same fields (rect on the 96 m grid, explored per visit) and the map follows without changes.
 */
import { TUNING } from '@lcw/sim-core';
import type { SceneId, WorldMapInfo } from './api.js';
import { SCENE_TITLES_KO, SECTOR_NAMES_KO } from './strings.js';
import { SCENES } from './town.js';

export interface MapInfoInput {
  player: { x: number; z: number; yaw: number };
  /** my plot bounds in metres (VoxelWorld.plot); null when this world has none */
  plot: { x0: number; x1: number; z0: number; z1: number } | null;
}

export function buildMapInfo(input: MapInfoInput): WorldMapInfo {
  const s = TUNING.world.sectorSize;
  const mid = Math.floor(TUNING.world.sizeX / s / 2);
  const sectors: WorldMapInfo['sectors'] = [
    { id: 'town', nameKo: SECTOR_NAMES_KO.town, kind: 'town', explored: true, rect: [mid * s, mid * s, (mid + 1) * s, (mid + 1) * s] }
  ];
  if (input.plot) {
    const p = input.plot;
    sectors.push({ id: 'plot', nameKo: SCENE_TITLES_KO.build_plot, kind: 'plot', explored: true, rect: [p.x0, p.z0, p.x1, p.z1] });
  }
  const scenes = (Object.keys(SCENES) as SceneId[]).map((id) => ({ id, nameKo: SCENES[id].titleKo, x: SCENES[id].player.x, z: SCENES[id].player.z }));
  return {
    size_m: TUNING.world.sizeX,
    sectors,
    scenes,
    player: { x: input.player.x, z: input.player.z, yaw: input.player.yaw }
  };
}
