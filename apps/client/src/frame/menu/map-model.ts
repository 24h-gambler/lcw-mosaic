/**
 * Map screen G06 read-outs (docs/08 8.6, 2.3; docs/03 3.1~3.2): the 3 x 3 sector grid, zone of each sector, the
 * projection from world metres to map units, the vertical band elevator, and the screen-reader summary. Pure, so the
 * rules are tested without a DOM; `MapPanel` only draws what these return.
 */
import { TUNING } from '@lcw/sim-core';
import { COLOR_TOKENS, SEMANTIC_TOKENS, type ColorTokenName } from '@lcw/ui';
import type { WorldMapInfo } from '../../world/api.js';
import { BAND_NAMES_KO, joinHelp, nameBi } from '../../world/strings.js';
import { bandOf, type BandId } from '../status.js';
import { FRAME_STRINGS as F, FRAME_STRINGS_EN, FRAME_STRINGS_KO, type FrameStrings } from '../strings.js';

/** Map drawings use a 0..MAP_UNITS square viewBox; HTML labels over it use the same numbers as percentages. */
export const MAP_UNITS = 100;

export type Rect = readonly [number, number, number, number];
export type ZoneId = keyof typeof SEMANTIC_TOKENS.zone;
/** Legend order of docs/08 2.3: 보호 / 도시 / 내 부지 / 자유. */
export const ZONE_ORDER: readonly ZoneId[] = ['core', 'city', 'plot', 'wild'];

/**
 * Sector kind (WorldMapInfo) → zone of the legend. The central town is the protected zone (public breakage restores
 * itself, docs/03 3.5); city-type biome packs are 도시; my plot is 내 부지; every other biome or ruin is 자유.
 */
export function zoneOfKind(kind: string): ZoneId {
  switch (kind) {
    case 'town':
    case 'core':
      return 'core';
    case 'city':
      return 'city';
    case 'plot':
      return 'plot';
    default:
      return 'wild';
  }
}

export interface ZoneLook {
  fill: ColorTokenName;
  line: ColorTokenName;
  pattern: (typeof SEMANTIC_TOKENS.zone)[ZoneId]['pattern'];
}

/** Fill colour, the darker line colour for its pattern and border, and the pattern name (never colour alone). */
export function zoneLook(zone: ZoneId): ZoneLook {
  const z = SEMANTIC_TOKENS.zone[zone];
  const dark = `${z.color}-d`;
  const line: ColorTokenName = dark in COLOR_TOKENS ? (dark as ColorTokenName) : 'ink-700';
  return { fill: z.color, line, pattern: z.pattern };
}

/** World metres → map units inside `view` ([x0, z0, x1, z1]); north (−z) is up, east (+x) is right. */
export function project(x: number, z: number, view: Rect, units = MAP_UNITS): { u: number; v: number } {
  const [x0, z0, x1, z1] = view;
  return { u: ((x - x0) / (x1 - x0)) * units, v: ((z - z0) / (z1 - z0)) * units };
}

export function projectRect(r: Rect, view: Rect, units = MAP_UNITS): { u: number; v: number; w: number; h: number } {
  const a = project(r[0], r[1], view, units);
  const b = project(r[2], r[3], view, units);
  return { u: a.u, v: a.v, w: b.u - a.u, h: b.v - a.v };
}

export function contains(r: Rect, x: number, z: number): boolean {
  return x >= r[0] && x < r[2] && z >= r[1] && z < r[3];
}

export interface SectorCell {
  index: number;
  col: number;
  row: number;
  rect: Rect;
  /** the world's sector id here, null while nothing is generated in this cell */
  id: string | null;
  /** shown only once explored; an unexplored cell is a silhouette without its name */
  nameKo: string | null;
  zone: ZoneId;
  explored: boolean;
}

/**
 * The 3 x 3 grid (docs/03 3.1: 96 m sectors on a 288 m world). Each cell takes the world sector whose rect holds the
 * cell's centre; plots are smaller areas drawn on top, never a cell. A cell with no sector yet counts as unexplored.
 */
export function sectorCells(info: WorldMapInfo, sectorSize: number = TUNING.world.sectorSize): SectorCell[] {
  const n = Math.max(1, Math.round(info.size_m / sectorSize));
  const cells: SectorCell[] = [];
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const rect: Rect = [col * sectorSize, row * sectorSize, (col + 1) * sectorSize, (row + 1) * sectorSize];
      const cx = rect[0] + sectorSize / 2;
      const cz = rect[1] + sectorSize / 2;
      const s = info.sectors.find((q) => q.kind !== 'plot' && contains(q.rect, cx, cz));
      const explored = s?.explored ?? false;
      cells.push({
        index: row * n + col,
        col,
        row,
        rect,
        id: s?.id ?? null,
        nameKo: s && explored ? s.nameKo : null,
        zone: s ? zoneOfKind(s.kind) : 'wild',
        explored
      });
    }
  }
  return cells;
}

/** Cell index under (x, z); positions just outside the world clamp to the edge cell. */
export function cellAt(cells: readonly SectorCell[], x: number, z: number): number {
  const n = Math.round(Math.sqrt(cells.length));
  const size = cells[0] ? cells[0].rect[2] - cells[0].rect[0] : 1;
  const col = Math.min(n - 1, Math.max(0, Math.floor(x / size)));
  const row = Math.min(n - 1, Math.max(0, Math.floor(z / size)));
  return row * n + col;
}

export interface MapArea {
  id: string;
  nameKo: string;
  zone: ZoneId;
  rect: Rect;
}

/** Explored areas smaller than a sector (my plot) that overlap `view`, clipped to it. */
export function areasIn(info: WorldMapInfo, view: Rect): MapArea[] {
  const out: MapArea[] = [];
  for (const s of info.sectors) {
    if (s.kind !== 'plot' || !s.explored) continue;
    const r: Rect = [Math.max(s.rect[0], view[0]), Math.max(s.rect[1], view[1]), Math.min(s.rect[2], view[2]), Math.min(s.rect[3], view[3])];
    if (r[2] <= r[0] || r[3] <= r[1]) continue;
    out.push({ id: s.id, nameKo: s.nameKo, zone: zoneOfKind(s.kind), rect: r });
  }
  return out;
}

export type MapScene = WorldMapInfo['scenes'][number];

/** Places the child may pick: only those in explored sectors (an unexplored sector keeps its places hidden). */
export function knownScenes(info: WorldMapInfo, cells: readonly SectorCell[]): MapScene[] {
  return info.scenes.filter((s) => cells[cellAt(cells, s.x, s.z)]?.explored);
}

export function scenesIn(scenes: readonly MapScene[], view: Rect): MapScene[] {
  return scenes.filter((s) => contains(view, s.x, s.z));
}

export function nearestScene(scenes: readonly MapScene[], x: number, z: number): MapScene | null {
  let best: MapScene | null = null;
  let d = Infinity;
  for (const s of scenes) {
    const k = Math.hypot(s.x - x, s.z - z);
    if (k < d) {
      d = k;
      best = s;
    }
  }
  return best;
}

export interface LabelPlace {
  /** label above the dot (near the bottom edge) instead of below */
  above: boolean;
  /** horizontal anchor: centred, or flush to the dot near the left / right edge so the label never leaves the map */
  align: 'center' | 'start' | 'end';
}

export function labelPlace(u: number, v: number, units = MAP_UNITS): LabelPlace {
  return {
    above: v > units * 0.82,
    align: u < units * 0.16 ? 'start' : u > units * 0.84 ? 'end' : 'center'
  };
}

/**
 * Arrow rotation in degrees, clockwise from map-up (north). World facing is (sin yaw, cos yaw) on (x, z) and +z is
 * south (down on the map), so yaw 0 points down (180°) and yaw π/2 (east) points right (90°).
 */
export function arrowDeg(yaw: number): number {
  const d = 180 - (yaw * 180) / Math.PI;
  return ((d % 360) + 360) % 360;
}

/** Eight-way compass word for the facing in the screen language ("north", "southeast", ...). */
export function compassKo(yaw: number): string {
  return FRAME_STRINGS_EN.compass[compassIndex(yaw)]!;
}
function compassIndex(yaw: number): number {
  return Math.round(arrowDeg(yaw) / 45) % 8;
}

/** A place name as the screen shows it: the English of a known name (a world table may hand it with its Korean). */
export function placeEn(name: string): string {
  return nameBi(name)?.en ?? name;
}
/** The Korean of a known place name (for the help line), or null. */
export function placeKo(name: string): string | null {
  return nameBi(name)?.ko ?? null;
}

/**
 * Builds one frame sentence on each side with that side's own names: English from `FRAME_STRINGS_EN`, Korean from
 * `FRAME_STRINGS_KO` with the Korean names. The Korean side is null when a name has no Korean (an English name never
 * gets a Korean particle).
 */
function bothSides(build: (t: FrameStrings, name: (n: string) => string | null, side: 'en' | 'ko') => string | null): { en: string; ko: string | null } {
  const en = build(FRAME_STRINGS_EN, (n) => placeEn(n), 'en') ?? '';
  const ko = build(FRAME_STRINGS_KO as FrameStrings, (n) => placeKo(n), 'ko');
  return { en, ko: ko && ko !== en ? ko : null };
}

/** The line over the map: "Town Square · Ground · facing north", and its Korean for the help line. */
export function mapNowLine(place: string | null, band: BandId, yaw: number): { en: string; ko: string | null } {
  return bothSides((t, name) => {
    const p = place === null ? t.unexplored : name(place);
    const b = name(BAND_NAMES_KO[band]);
    return p === null || b === null ? null : t.mapNow(p, b, t.compass[compassIndex(yaw)]!);
  });
}

export type BandState = 'here' | 'open' | 'locked';

export interface BandStop {
  id: BandId;
  nameKo: string;
  /** altitude range as on docs/03 3.2 ("+600 ~ +1,000m") */
  range: string;
  state: BandState;
}

function signed(n: number): string {
  const s = Math.abs(n).toLocaleString('en-US');
  return n > 0 ? `+${s}` : n < 0 ? `−${s}` : s;
}

/**
 * Elevator stops, top band first (docs/03 3.2). The band at height y is `here`; a band reached before is `open` (an
 * elevator stop, docs/03 3.2 "한 번 도달한 밴드는 정류장이 열립니다"); the rest are locked. Until vertical travel lands
 * the world reports no reached bands, and the surface counts as reached.
 */
export function bandStops(y: number, reached: readonly BandId[] = ['surface']): BandStop[] {
  const here = bandOf(y);
  const bands = TUNING.verticalBands;
  return bands.map((b, i) => {
    const top = i > 0 && b.maxY >= 0 ? b.maxY + 1 : b.maxY;
    return {
      id: b.id,
      nameKo: BAND_NAMES_KO[b.id],
      range: `${signed(b.minY)} ~ ${signed(top)}m`,
      state: b.id === here ? 'here' : reached.includes(b.id) ? 'open' : 'locked'
    };
  });
}

export interface MapSummaryInput {
  cells: readonly SectorCell[];
  playerCell: number;
  near: MapScene | null;
  band: BandId;
  yaw: number;
  places: readonly MapScene[];
  lessonOn: boolean;
}

/** One paragraph for screen readers: how much is explored, where I am and face, and where I can go. */
export function mapSummary(p: MapSummaryInput): string {
  const explored = p.cells.filter((c) => c.explored).length;
  const s = bothSides((t, name) => {
    const cell = p.cells[p.playerCell];
    const where = cell?.nameKo ? name(cell.nameKo) : t.unexplored;
    const near = p.near ? name(p.near.nameKo) : '';
    const band = name(BAND_NAMES_KO[p.band]);
    if (where === null || near === null || band === null) return null;
    const parts = [t.mapSummaryIntro(p.cells.length, explored), t.mapSummaryHere(where, near ? t.mapSummaryNear(near) : '', band, t.compass[compassIndex(p.yaw)]!)];
    if (p.lessonOn) parts.push(t.mapLessonNote);
    else if (p.places.length > 0) {
      const names = p.places.map((x) => name(x.nameKo));
      if (names.some((n) => n === null)) return null;
      parts.push(t.mapSummaryPlaces(names as string[]));
    }
    return parts.join(' ');
  });
  return joinHelp(s.en, s.ko ?? undefined);
}

/** "Go to Town Square" (with "중앙 광장으로 가기" after it while the help is on): the accessible name of a place button. */
export function goLabel(name: string): string {
  return F.goTo(nameBi(name) ?? placeEn(name));
}
