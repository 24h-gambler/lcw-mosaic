// G06 지도 (docs/08 8.6, 2.3; docs/03 3.1~3.2): projection, the 3 x 3 sector grid, silhouettes for unexplored
// sectors, zone colour + pattern, the band elevator, the screen-reader summary, and the rendered panel.
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { TUNING, VoxelWorld } from '@lcw/sim-core';
import { FORBIDDEN_PLAYER_UI_PATTERNS } from '@lcw/ui';
import type { SceneId, WorldHandle, WorldMapInfo } from '../world/api.js';
import { buildMapInfo } from '../world/map-info.js';
import { SCENES } from '../world/town.js';
import { BAND_NAMES_KO, SCENE_TITLES_KO, SECTOR_NAMES_KO } from '../world/strings.js';
import { FRAME_STRINGS as F, withCopula, withDirection } from '../frame/strings.js';
import { resetLangForTest, setHelpKo } from '../world/lang.js';
import {
  areasIn,
  arrowDeg,
  bandStops,
  cellAt,
  compassKo,
  goLabel,
  knownScenes,
  labelPlace,
  mapSummary,
  nearestScene,
  project,
  projectRect,
  sectorCells,
  zoneLook,
  zoneOfKind,
  type Rect
} from '../frame/menu/map-model.js';
import { MapPanel, readMapSnapshot, startTrip } from '../frame/menu/MapPanel.js';
import type { FrameAuth, MenuPanelProps } from '../frame/menu/types.js';

const plot = new VoxelWorld().plot;
const townInfo = (player = { x: 144.5, z: 152.3, yaw: Math.PI }): WorldMapInfo => buildMapInfo({ player, plot });

/** What the world generator will report: nine sectors on the 96 m grid, visited ones explored. */
function nineSectors(explored: (i: number) => boolean): WorldMapInfo {
  const s = TUNING.world.sectorSize;
  const kinds = ['biome', 'city', 'biome', 'ruin', 'town', 'city', 'biome', 'biome', 'ruin'];
  const base = townInfo();
  return {
    ...base,
    sectors: [
      ...kinds.map((kind, i) => ({
        id: `s${i}`,
        nameKo: `섹터${i}`,
        kind,
        explored: explored(i),
        rect: [(i % 3) * s, Math.floor(i / 3) * s, ((i % 3) + 1) * s, (Math.floor(i / 3) + 1) * s] as [number, number, number, number]
      })),
      ...base.sectors.filter((q) => q.kind === 'plot')
    ]
  };
}

describe('getMap read-out (world/map-info)', () => {
  it('fills the agreed contract from the town: one town sector, my plot, the five scenes and the player', () => {
    const info = townInfo({ x: 150, z: 140, yaw: 0.5 });
    expect(info.size_m).toBe(TUNING.world.sizeX);
    expect(info.sectors).toEqual([
      { id: 'town', nameKo: SECTOR_NAMES_KO.town, kind: 'town', explored: true, rect: [96, 96, 192, 192] },
      { id: 'plot', nameKo: SCENE_TITLES_KO.build_plot, kind: 'plot', explored: true, rect: [plot.x0, plot.z0, plot.x1, plot.z1] }
    ]);
    expect(info.scenes.map((s) => s.id).sort()).toEqual(Object.keys(SCENES).sort());
    const plaza = info.scenes.find((s) => s.id === 'plaza')!;
    expect([plaza.x, plaza.z]).toEqual([SCENES.plaza.player.x, SCENES.plaza.player.z]);
    expect(info.player).toEqual({ x: 150, z: 140, yaw: 0.5 });
  });

  it('has no plot sector when the world has none', () => {
    expect(buildMapInfo({ player: { x: 0, z: 0, yaw: 0 }, plot: null }).sectors.map((s) => s.kind)).toEqual(['town']);
  });
});

describe('projection (world metres → map units)', () => {
  const view: Rect = [96, 96, 192, 192];
  it('maps the view corners to 0 and 100 with north up', () => {
    expect(project(96, 96, view)).toEqual({ u: 0, v: 0 });
    expect(project(192, 192, view)).toEqual({ u: 100, v: 100 });
    expect(project(144, 144, view)).toEqual({ u: 50, v: 50 });
    // the windy hill (z 102) is north of the plaza (z 152): higher on the map
    expect(project(144.5, 102.2, view).v).toBeLessThan(project(144.5, 152.3, view).v);
  });
  it('projects the whole world and rects', () => {
    expect(project(288, 0, [0, 0, 288, 288])).toEqual({ u: 100, v: 0 });
    const r = projectRect([100, 156, 132, 188], view);
    expect(r.u).toBeCloseTo(100 * (4 / 96));
    expect(r.v).toBeCloseTo(100 * (60 / 96));
    expect(r.w).toBeCloseTo(100 / 3);
    expect(r.h).toBeCloseTo(100 / 3);
  });
});

describe('sector grid (3 x 3, docs/03 3.1)', () => {
  it('lays out nine 96 m cells; only the town is explored today; the plot is never a cell', () => {
    const cells = sectorCells(townInfo());
    expect(cells).toHaveLength(9);
    expect(cells.map((c) => [c.col, c.row])).toEqual([0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => [c, r])));
    expect(cells[4]).toMatchObject({ rect: [96, 96, 192, 192], id: 'town', nameKo: SECTOR_NAMES_KO.town, explored: true, zone: 'core' });
    for (const c of cells.filter((q) => q.index !== 4)) expect(c).toMatchObject({ id: null, nameKo: null, explored: false });
  });

  it('follows the generator: explored flags, hidden names on silhouettes, zones by kind', () => {
    const cells = sectorCells(nineSectors((i) => i === 4 || i === 1));
    expect(cells.filter((c) => c.explored).map((c) => c.index)).toEqual([1, 4]);
    expect(cells[1]).toMatchObject({ nameKo: '섹터1', zone: 'city' });
    // unexplored: silhouette, the name stays hidden but the id is known
    expect(cells[5]).toMatchObject({ id: 's5', nameKo: null, explored: false });
    expect(cells[0]!.zone).toBe('wild');
  });

  it('finds the cell under a position and clamps outside the world', () => {
    const cells = sectorCells(townInfo());
    expect(cellAt(cells, 144, 144)).toBe(4);
    expect(cellAt(cells, 10, 280)).toBe(6);
    expect(cellAt(cells, -5, -5)).toBe(0);
    expect(cellAt(cells, 999, 999)).toBe(8);
  });

  it('draws my plot inside the town view only, and hides places in unexplored sectors', () => {
    const info = townInfo();
    expect(areasIn(info, [96, 96, 192, 192]).map((a) => [a.id, a.zone])).toEqual([['plot', 'plot']]);
    expect(areasIn(info, [0, 0, 96, 96])).toEqual([]);
    const cells = sectorCells(info);
    expect(knownScenes(info, cells)).toHaveLength(5);
    const fogged = { ...info, sectors: info.sectors.map((s) => ({ ...s, explored: false })) };
    expect(knownScenes(fogged, sectorCells(fogged))).toEqual([]);
    expect(areasIn(fogged, [96, 96, 192, 192])).toEqual([]);
  });
});

describe('zones (docs/08 2.3: colour plus pattern)', () => {
  it('maps sector kinds to the four zones', () => {
    expect(['town', 'city', 'plot', 'biome', 'ruin', 'moon'].map(zoneOfKind)).toEqual(['core', 'city', 'plot', 'wild', 'wild', 'wild']);
  });
  it('gives each zone its colour token, a darker line and a pattern, never colour alone', () => {
    expect(zoneLook('core')).toEqual({ fill: 'sky', line: 'sky-d', pattern: 'shield' });
    expect(zoneLook('city')).toEqual({ fill: 'sun', line: 'sun-d', pattern: 'bricks' });
    expect(zoneLook('plot')).toEqual({ fill: 'leaf', line: 'leaf-d', pattern: 'fence' });
    expect(zoneLook('wild')).toEqual({ fill: 'ink-500', line: 'ink-700', pattern: 'none' });
  });
});

describe('player arrow and labels', () => {
  it('turns the arrow clockwise from north; yaw 0 faces south (+z)', () => {
    expect(arrowDeg(0)).toBe(180);
    expect(arrowDeg(Math.PI / 2)).toBe(90);
    expect(arrowDeg(Math.PI)).toBe(0);
    expect(arrowDeg(-Math.PI / 2)).toBe(270);
    expect([0, Math.PI / 2, Math.PI, -Math.PI / 2, Math.PI * 0.75].map(compassKo)).toEqual(['south', 'east', 'north', 'west', 'northeast']);
  });
  it('keeps labels inside the map near the edges', () => {
    expect(labelPlace(50, 50)).toEqual({ above: false, align: 'center' });
    expect(labelPlace(5, 95)).toEqual({ above: true, align: 'start' });
    expect(labelPlace(95, 10)).toEqual({ above: false, align: 'end' });
  });
  it('finds the nearest place', () => {
    const info = townInfo();
    expect(nearestScene(info.scenes, 160, 136)?.id).toBe('honey_cafe');
    expect(nearestScene([], 0, 0)).toBeNull();
  });
});

describe('vertical band elevator (docs/03 3.2)', () => {
  it('lists six stops top first, marks where I am and locks unreached bands', () => {
    const stops = bandStops(1);
    expect(stops.map((s) => s.id)).toEqual(TUNING.verticalBands.map((b) => b.id));
    expect(stops.map((s) => s.state)).toEqual(['locked', 'locked', 'locked', 'here', 'locked', 'locked']);
    // the band names are the world domain's (they follow the learn language, world/lang.ts)
    expect(stops.map((s) => s.nameKo)).toEqual(TUNING.verticalBands.map((b) => BAND_NAMES_KO[b.id as keyof typeof BAND_NAMES_KO]));
    expect(stops.map((s) => s.range)).toEqual(['+600 ~ +1,000m', '+300 ~ +600m', '+80 ~ +300m', '−8 ~ +80m', '−150 ~ −9m', '−400 ~ −151m']);
  });
  it('opens a stop for each reached band; the band under the player is "here"', () => {
    const stops = bandStops(-50, ['surface', 'mine', 'sky_island']);
    expect(stops.find((s) => s.id === 'mine')!.state).toBe('here');
    expect(stops.find((s) => s.id === 'surface')!.state).toBe('open');
    expect(stops.find((s) => s.id === 'sky_island')!.state).toBe('open');
    expect(stops.find((s) => s.id === 'deep_core')!.state).toBe('locked');
  });
});

describe('screen-reader summary and particles', () => {
  const info = townInfo();
  const cells = sectorCells(info);
  const places = knownScenes(info, cells);
  it('says how much is explored, where I am and face, and where I can go', () => {
    const s = mapSummary({ cells, playerCell: 4, near: places.find((p) => p.id === 'plaza')!, band: 'surface', yaw: Math.PI, places, lessonOn: false });
    // the screen speaks the learn language: names from the world tables, the sentence around them from the frame's
    expect(s).toBe(
      [
        'This is the map. You have been to 1 of all 9 squares.',
        F.mapSummaryHere(SECTOR_NAMES_KO.town, F.mapSummaryNear(SCENE_TITLES_KO.plaza), BAND_NAMES_KO.surface, 'north'),
        F.mapSummaryPlaces(places.map((p) => p.nameKo))
      ].join(' ')
    );
    // with the Korean help on, the Korean paragraph follows with its own Korean names (no particle on English names)
    setHelpKo(true);
    try {
      const both = mapSummary({ cells, playerCell: 4, near: places.find((p) => p.id === 'plaza')!, band: 'surface', yaw: Math.PI, places, lessonOn: false });
      expect(both).toBe(
        `${s} · 지도예요. 온 세상 9칸 중 1칸을 가 봤어요. 나는 중앙 마을 중앙 광장 근처, 지상에서 북쪽을 보고 있어요. 갈 수 있는 곳은 중앙 광장, 꿀 카페, 물물교환 상점, 내 부지, 바람 언덕이에요.`
      );
    } finally {
      resetLangForTest();
    }
    expect(places.map((p) => p.id)).toEqual(['plaza', 'honey_cafe', 'trade_shop', 'build_plot', 'open_hill']);
  });
  it('in a lesson says the teacher picks the place instead of listing places', () => {
    const s = mapSummary({ cells, playerCell: 4, near: null, band: 'surface', yaw: 0, places, lessonOn: true });
    expect(s).toContain(F.mapLessonNote);
    expect(s).not.toContain('You can go to');
  });
  it('picks 로/으로 and 예요/이에요 by the last syllable', () => {
    expect(['중앙 광장', '꿀 카페', '바람 언덕', '내 부지', '물물교환 상점', '골목길'].map(withDirection)).toEqual([
      '중앙 광장으로',
      '꿀 카페로',
      '바람 언덕으로',
      '내 부지로',
      '물물교환 상점으로',
      '골목길로'
    ]);
    expect(withCopula('바람 언덕')).toBe('바람 언덕이에요');
    expect(withCopula('꿀 카페')).toBe('꿀 카페예요');
    // the place button speaks English; the Korean sentence (with its own Korean name) comes with the help
    expect(goLabel('꿀 카페')).toBe('Go to Honey Cafe');
    expect(goLabel(SCENE_TITLES_KO.honey_cafe)).toBe('Go to Honey Cafe');
    setHelpKo(true);
    try {
      expect(goLabel(SCENE_TITLES_KO.honey_cafe)).toBe('Go to Honey Cafe · 꿀 카페로 가기');
    } finally {
      resetLangForTest();
    }
  });
});

function fakeWorld(info: WorldMapInfo, y = 1, scene: SceneId = 'plaza'): WorldHandle & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    getMap: () => info,
    getScene: () => scene,
    getStats: () => ({ fps: 60, frameMs: 16, drawCalls: 0, triangles: 0, chunksMeshed: 0, chunksVisible: 0, scene, player: { x: info.player.x, y, z: info.player.z } }),
    setPaused: (p: boolean) => void calls.push(`paused:${p}`),
    goToScene: async (id: SceneId) => void calls.push(`go:${id}`)
  } as unknown as WorldHandle & { calls: string[] };
}

const guest: FrameAuth = { token: null, kind: 'guest' };
const render = (p: Partial<MenuPanelProps>): string =>
  renderToStaticMarkup(React.createElement(MapPanel, { world: null, identity: null, auth: guest, lessonOn: false, go: () => {}, close: () => {}, ...p }));

describe('MapPanel render', () => {
  it('draws nine sector buttons, five place pins and list buttons, six elevator stops and the legend', () => {
    const html = render({ world: fakeWorld(townInfo()) });
    expect(html.match(/class="lcw-map__cell/g)).toHaveLength(9);
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html.match(/data-scene="/g)).toHaveLength(5);
    expect(html.match(/class="btn lcw-map__go/g)).toHaveLength(5);
    expect(html).toContain(`aria-label="${goLabel(SCENE_TITLES_KO.open_hill)}"`);
    expect(html.match(/class="lcw-map__stop /g)).toHaveLength(6);
    expect(html).toContain('aria-current="location"');
    for (const z of Object.values(F.zones)) expect(html).toContain(z);
    // eight silhouettes, each saying it is not visited yet
    expect(html.match(/lcw-map__cell is-fog/g)).toHaveLength(8);
    expect(html).toContain(F.unexplored);
    expect(html).toContain('This is the map. You have been to 1 of all 9 squares.');
    // the player arrow and "나" are drawn when the town (the player's sector) is open
    expect(html).toContain('lcw-map__you');
  });

  it('hides every place button during a lesson and says why', () => {
    const html = render({ world: fakeWorld(townInfo()), lessonOn: true });
    expect(html).not.toContain('data-scene=');
    expect(html).not.toContain('lcw-map__go');
    expect(html).toContain(F.mapLessonNote);
    expect(html.match(/lcw-map__pin[^"]*is-static/g)).toHaveLength(5);
  });

  it('marks the elevator stop for the band I am in', () => {
    const html = render({ world: fakeWorld(townInfo(), -40) });
    expect(html).toMatch(new RegExp(`lcw-map__stop is-here[^>]*><span class="lcw-map__car"[^>]*>${F.youAreHere}</span><span><b>${BAND_NAMES_KO.mine}</b>`));
  });

  it('says the map comes with the world when there is none', () => {
    expect(render({ world: null })).toContain(F.mapNoWorld);
    expect(readMapSnapshot(null)).toBeNull();
  });

  it('never shows a forbidden word on the child screen', () => {
    const html = render({ world: fakeWorld(townInfo()) }) + render({ world: fakeWorld(townInfo()), lessonOn: true });
    expect(html).not.toMatch(/게임|game/i);
    for (const w of FORBIDDEN_PLAYER_UI_PATTERNS) expect(html).not.toContain(w);
  });
});

describe('going to a place', () => {
  it('unpauses, starts the walk, then closes the menu', () => {
    const w = fakeWorld(townInfo());
    const close = vi.fn(() => w.calls.push('close'));
    expect(startTrip(w, 'honey_cafe', false, close)).toBe(true);
    expect(w.calls).toEqual(['paused:false', 'go:honey_cafe', 'close']);
  });
  it('does nothing during a lesson or without a world', () => {
    const w = fakeWorld(townInfo());
    const close = vi.fn();
    expect(startTrip(w, 'honey_cafe', true, close)).toBe(false);
    expect(startTrip(null, 'honey_cafe', false, close)).toBe(false);
    expect(w.calls).toEqual([]);
    expect(close).not.toHaveBeenCalled();
  });
});
