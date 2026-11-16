/**
 * G06 지도 (docs/08 8.6): the 3 x 3 sectors with the zone legend (docs/08 2.3: colour + pattern, never colour alone),
 * unexplored sectors as silhouettes, the walkable places (press one to walk there; hidden during a lesson, where the
 * teacher picks the place), where I stand and face, and the vertical band elevator (docs/03 3.2).
 *
 * The menu pauses the world, so the map is read once when the panel opens (world.getMap / getStats).
 */
import React, { useCallback, useId, useMemo, useState } from 'react';
import { TUNING } from '@lcw/sim-core';
import type { ColorTokenName } from '@lcw/ui';
import type { SceneId, WorldHandle, WorldMapInfo } from '../../world/api.js';
import { FRAME_STRINGS as F, FRAME_STRINGS_EN as E } from '../strings.js';
import { bandOf, type BandId } from '../status.js';
import {
  MAP_UNITS,
  ZONE_ORDER,
  areasIn,
  arrowDeg,
  bandStops,
  cellAt,
  goLabel,
  knownScenes,
  labelPlace,
  mapNowLine,
  mapSummary,
  nearestScene,
  placeEn,
  placeKo,
  project,
  projectRect,
  scenesIn,
  sectorCells,
  zoneLook,
  type MapScene,
  type Rect,
  type SectorCell,
  type ZoneId
} from './map-model.js';
import { ensureMapStyle } from './map-styles.js';
import type { MenuPanelProps } from './types.js';
import { KoHelp } from './ko-help.js';

const cv = (c: ColorTokenName): string => `var(--c-${c})`;

interface MapSnapshot {
  info: WorldMapInfo;
  y: number;
  scene: SceneId | null;
}

/** One read when the panel opens (the world is paused while the menu is up). */
export function readMapSnapshot(world: WorldHandle | null): MapSnapshot | null {
  const info = world?.getMap?.();
  if (!world || !info) return null;
  const stats = world.getStats?.();
  return { info, y: stats?.player.y ?? 1, scene: world.getScene?.() ?? stats?.scene ?? null };
}

/**
 * Walk to a picked place and close the menu. Unpause first: a walk started while paused stops at once and jumps
 * behind the fade card instead. During a lesson the teacher picks the place, so nothing moves.
 */
export function startTrip(world: WorldHandle | null, id: SceneId, lessonOn: boolean, close: () => void): boolean {
  if (!world || lessonOn) return false;
  world.setPaused(false);
  void world.goToScene(id);
  close();
  return true;
}

/** Detail-map arrow: its scale, its halo radius in map units, and how close a place pin must be to move its label clear. */
const ARROW_SCALE = 0.7;
const ARROW_R = 6.2 * ARROW_SCALE;
const ARROW_CLEAR = ARROW_R * 1.5;

type Fill = ZoneId | 'fog';

/** Zone patterns for one SVG; `t` = tile size in that SVG's own units. */
function ZoneDefs({ id, t }: { id: string; t: number }): React.ReactElement {
  const core = zoneLook('core');
  const city = zoneLook('city');
  const plot = zoneLook('plot');
  const sw = (k: number): number => t * k;
  return (
    <defs>
      <pattern id={`${id}-core`} width={t} height={t} patternUnits="userSpaceOnUse">
        <rect width={t} height={t} style={{ fill: cv(core.fill), fillOpacity: 0.3 }} />
        <path
          d={`M${t * 0.5} ${t * 0.2}L${t * 0.78} ${t * 0.32}Q${t * 0.76} ${t * 0.68} ${t * 0.5} ${t * 0.84}Q${t * 0.24} ${t * 0.68} ${t * 0.22} ${t * 0.32}Z`}
          style={{ fill: 'none', stroke: cv(core.line), strokeWidth: sw(0.07) }}
        />
      </pattern>
      <pattern id={`${id}-city`} width={t} height={t} patternUnits="userSpaceOnUse">
        <rect width={t} height={t} style={{ fill: cv(city.fill), fillOpacity: 0.35 }} />
        <path
          d={`M0 ${t * 0.02}H${t}M0 ${t * 0.5}H${t}M${t * 0.5} 0V${t * 0.5}M${t * 0.02} ${t * 0.5}V${t}`}
          style={{ fill: 'none', stroke: cv(city.line), strokeWidth: sw(0.06) }}
        />
      </pattern>
      <pattern id={`${id}-plot`} width={t} height={t} patternUnits="userSpaceOnUse">
        <rect width={t} height={t} style={{ fill: cv(plot.fill), fillOpacity: 0.3 }} />
        <path
          d={`M${t * 0.25} ${t * 0.95}V${t * 0.25}L${t * 0.32} ${t * 0.15}M${t * 0.75} ${t * 0.95}V${t * 0.25}L${t * 0.82} ${t * 0.15}M0 ${t * 0.45}H${t}M0 ${t * 0.75}H${t}`}
          style={{ fill: 'none', stroke: cv(plot.line), strokeWidth: sw(0.08) }}
        />
      </pattern>
      <pattern id={`${id}-fog`} width={t} height={t} patternUnits="userSpaceOnUse">
        <rect width={t} height={t} style={{ fill: cv('ink-500'), fillOpacity: 0.22 }} />
        <path
          d={`M0 ${t}L${t} 0M${-t / 4} ${t / 4}L${t / 4} ${-t / 4}M${(t * 3) / 4} ${(t * 5) / 4}L${(t * 5) / 4} ${(t * 3) / 4}`}
          style={{ fill: 'none', stroke: cv('ink-500'), strokeWidth: sw(0.08) }}
        />
      </pattern>
    </defs>
  );
}

/**
 * A zone area: pattern fill plus its border pattern (docs/08 2.3 "테두리 무늬"): 보호 = double line, 도시 = long dash,
 * 내 부지 = fence posts, 자유 = thin line, unexplored = dotted. `k` = stroke unit in this SVG's units.
 */
function ZoneRect({ id, fill, u, v, w, h, k }: { id: string; fill: Fill; u: number; v: number; w: number; h: number; k: number }): React.ReactElement {
  const look = fill === 'fog' ? { line: 'ink-500' as ColorTokenName } : zoneLook(fill);
  const paint = fill === 'wild' ? cv('paper-0') : `url(#${id}-${fill})`;
  const border = (sw: number, dash?: string, inset = sw / 2): React.ReactElement => (
    <rect
      x={u + inset}
      y={v + inset}
      width={Math.max(0, w - inset * 2)}
      height={Math.max(0, h - inset * 2)}
      style={{ fill: 'none', stroke: cv(look.line), strokeWidth: sw, strokeDasharray: dash }}
    />
  );
  return (
    <g>
      <rect x={u} y={v} width={w} height={h} style={{ fill: paint }} />
      {fill === 'core' ? (
        <>
          {border(k * 1.4)}
          {border(k * 0.6, undefined, k * 2.6)}
        </>
      ) : fill === 'city' ? (
        border(k * 1.4, `${k * 3} ${k * 1.5}`)
      ) : fill === 'plot' ? (
        border(k * 1.8, `${k * 1} ${k * 0.8}`)
      ) : fill === 'fog' ? (
        border(k * 0.8, `${k * 0.8} ${k * 1.6}`)
      ) : (
        border(k * 0.6)
      )}
    </g>
  );
}

function Arrow({ u, v, yaw, s }: { u: number; v: number; yaw: number; s: number }): React.ReactElement {
  return (
    <g transform={`translate(${u} ${v}) rotate(${arrowDeg(yaw)}) scale(${s})`}>
      <circle r={6.2} style={{ fill: cv('paper-0'), fillOpacity: 0.85, stroke: cv('ink-900'), strokeWidth: 0.6 }} />
      <path d="M0 -5.2L3.9 3.8L0 1.8L-3.9 3.8Z" style={{ fill: cv('brand'), stroke: cv('ink-900'), strokeWidth: 0.8, strokeLinejoin: 'round' }} />
    </g>
  );
}

function Swatch({ id, fill }: { id: string; fill: Fill }): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <ZoneDefs id={id} t={8} />
      <ZoneRect id={id} fill={fill} u={0} v={0} w={24} h={24} k={1} />
    </svg>
  );
}

const cellFill = (c: SectorCell): Fill => (c.explored ? c.zone : 'fog');

export function MapPanel({ world, lessonOn, close }: MenuPanelProps): React.ReactElement {
  ensureMapStyle();
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const snap = useMemo(() => readMapSnapshot(world), [world]);
  const cells = useMemo(() => (snap ? sectorCells(snap.info) : []), [snap]);
  const playerCell = snap ? cellAt(cells, snap.info.player.x, snap.info.player.z) : 0;
  const [sel, setSel] = useState(playerCell);

  const go = useCallback((id: SceneId) => startTrip(world, id, lessonOn, close), [world, lessonOn, close]);

  const onPinKeys = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const pins = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button.lcw-map__pin')];
    const i = pins.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0 || pins.length === 0) return;
    e.preventDefault();
    e.stopPropagation();
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
    pins[(i + d + pins.length) % pins.length]!.focus();
  }, []);

  if (!snap) {
    return (
      <div className="lcw-map">
        <h2>{E.mapTitle}<KoHelp of={E.mapTitle} /></h2>
        <p className="note">{world ? E.loading : E.mapNoWorld}<KoHelp of={world ? E.loading : E.mapNoWorld} /></p>
      </div>
    );
  }

  const { info, y, scene } = snap;
  const places = knownScenes(info, cells);
  const band: BandId = bandOf(y);
  const near = nearestScene(places, info.player.x, info.player.z);
  const summary = mapSummary({ cells, playerCell, near, band, yaw: info.player.yaw, places, lessonOn });
  const nowLine = mapNowLine(near?.nameKo ?? cells[playerCell]?.nameKo ?? null, band, info.player.yaw);
  const cell = cells[sel] ?? cells[playerCell]!;
  const view: Rect = cell.rect;
  const here = project(info.player.x, info.player.z, view);
  const playerInView = sel === playerCell;
  const pins = cell.explored ? scenesIn(places, view) : [];
  const areas = cell.explored ? areasIn(info, view) : [];
  const chunk = TUNING.world.chunkSize;
  const worldView: Rect = [0, 0, info.size_m, info.size_m];
  const meWorld = project(info.player.x, info.player.z, worldView);
  const stops = bandStops(y);
  const ids = { main: `${uid}m`, ov: `${uid}o`, sum: `${uid}s`, title: `${uid}t` };

  const gridLines: React.ReactElement[] = [];
  for (let m = view[0] + chunk; m < view[2]; m += chunk) {
    const p = project(m, view[1], view).u;
    gridLines.push(<line key={`x${m}`} x1={p} y1={0} x2={p} y2={MAP_UNITS} />);
  }
  for (let m = view[1] + chunk; m < view[3]; m += chunk) {
    const p = project(view[0], m, view).v;
    gridLines.push(<line key={`z${m}`} x1={0} y1={p} x2={MAP_UNITS} y2={p} />);
  }

  const pinEl = (s: MapScene): React.ReactElement => {
    const p = project(s.x, s.z, view);
    const place = labelPlace(p.u, p.v);
    const byMe = playerInView && Math.hypot(p.u - here.u, p.v - here.v) < ARROW_CLEAR;
    const cls = `lcw-map__pin${place.above ? ' above' : ''}${place.align !== 'center' ? ` ${place.align}` : ''}${s.id === scene ? ' is-here' : ''}${byMe ? ' by-me' : ''}`;
    const style = { left: `${p.u}%`, top: `${p.v}%` };
    const inner = (
      <>
        <i className="lcw-map__dot" aria-hidden="true" />
        <span className="lcw-map__label">{placeEn(s.nameKo)}</span>
      </>
    );
    return lessonOn ? (
      <span key={s.id} className={`${cls} is-static`} style={style}>
        {inner}
      </span>
    ) : (
      <button key={s.id} type="button" className={cls} style={style} data-scene={s.id} aria-label={goLabel(s.nameKo)} onClick={() => go(s.id)}>
        {inner}
      </button>
    );
  };

  return (
    <div className="lcw-map">
      <h2>{E.mapTitle}<KoHelp of={E.mapTitle} /></h2>
      <p className="lcw-map__now">
        {nowLine.en}
        <KoHelp text={nowLine.ko} />
      </p>
      <p className="lcw-map__sr" id={ids.sum}>
        {summary}
      </p>
      <div className="lcw-map__grid">
        <section className="lcw-map__main" aria-labelledby={ids.title} aria-describedby={ids.sum}>
          <div className="lcw-map__head">
            <h3 id={ids.title}>
              {cell.nameKo ? placeEn(cell.nameKo) : E.unexplored}
              {cell.nameKo ? <KoHelp text={placeKo(cell.nameKo)} /> : <KoHelp of={E.unexplored} />}
            </h3>
            {cell.explored ? (
              <span className="lcw-map__chip">
                <Swatch id={`${uid}h`} fill={cell.zone} />
                {F.zones[cell.zone]}
              </span>
            ) : null}
            {sel !== playerCell ? (
              <button type="button" className="btn lcw-map__me" onClick={() => setSel(playerCell)}>
                {F.mapBackToMe}
              </button>
            ) : null}
          </div>
          <div className="lcw-map__stage">
            <svg viewBox={`0 0 ${MAP_UNITS} ${MAP_UNITS}`} aria-hidden="true" focusable="false">
              <ZoneDefs id={ids.main} t={6} />
              <ZoneRect id={ids.main} fill={cellFill(cell)} u={0} v={0} w={MAP_UNITS} h={MAP_UNITS} k={0.5} />
              <g style={{ stroke: cv('line-200'), strokeWidth: 0.25 }}>{gridLines}</g>
              {areas.map((a) => {
                const r = projectRect(a.rect, view);
                return <ZoneRect key={a.id} id={ids.main} fill={a.zone} u={r.u} v={r.v} w={r.w} h={r.h} k={0.5} />;
              })}
            </svg>
            <div className="lcw-map__pins" onKeyDown={onPinKeys}>
              {pins.map(pinEl)}
            </div>
            {playerInView ? (
              <>
                <svg className="lcw-map__top" viewBox={`0 0 ${MAP_UNITS} ${MAP_UNITS}`} aria-hidden="true" focusable="false">
                  <Arrow u={here.u} v={here.v} yaw={info.player.yaw} s={ARROW_SCALE} />
                </svg>
                <span className="lcw-map__you" style={{ left: `${here.u}%`, top: `${here.v - ARROW_R}%` }} aria-hidden="true">
                  {F.youAreHere}
                </span>
              </>
            ) : null}
            <span className="lcw-map__north" aria-hidden="true">
              <span>▲</span>
              {F.mapNorth}
            </span>
            {cell.explored ? null : (
              <div className="lcw-map__fog" aria-hidden="true">
                <b>?</b>
                <span>{F.mapUnexploredDetail}</span>
              </div>
            )}
          </div>
        </section>

        <section className="lcw-map__world" aria-labelledby={`${ids.ov}h`}>
          <h3 id={`${ids.ov}h`}>{E.mapWorldTitle}<KoHelp of={E.mapWorldTitle} /></h3>
          <div className="lcw-map__ov">
            <svg viewBox={`0 0 ${MAP_UNITS} ${MAP_UNITS}`} aria-hidden="true" focusable="false">
              <ZoneDefs id={ids.ov} t={4} />
              {cells.map((c) => {
                const r = projectRect(c.rect, worldView);
                return <ZoneRect key={c.index} id={ids.ov} fill={cellFill(c)} u={r.u} v={r.v} w={r.w} h={r.h} k={0.6} />;
              })}
              {areasIn(info, worldView).map((a) => {
                const r = projectRect(a.rect, worldView);
                return <ZoneRect key={a.id} id={ids.ov} fill={a.zone} u={r.u} v={r.v} w={r.w} h={r.h} k={0.35} />;
              })}
              {places.map((s) => {
                const p = project(s.x, s.z, worldView);
                return <circle key={s.id} cx={p.u} cy={p.v} r={1.4} style={{ fill: cv('brand'), stroke: cv('ink-900'), strokeWidth: 0.4 }} />;
              })}
              <Arrow u={meWorld.u} v={meWorld.v} yaw={info.player.yaw} s={0.42} />
            </svg>
            <div className="lcw-map__ovgrid" role="group" aria-label={F.mapWorldTitle}>
              {cells.map((c) => (
                <button
                  key={c.index}
                  type="button"
                  className={`lcw-map__cell${c.explored ? '' : ' is-fog'}`}
                  aria-pressed={c.index === sel}
                  aria-label={`${c.nameKo ? placeEn(c.nameKo) : F.unexplored}${c.index === playerCell ? ` · ${F.youAreHere}` : ''}`}
                  onClick={() => setSel(c.index)}
                >
                  {c.explored ? null : <b aria-hidden="true">?</b>}
                  {c.nameKo ? (
                    <span aria-hidden="true">{placeEn(c.nameKo)}</span>
                  ) : (
                    <span aria-hidden="true">
                      {F.unexploredLines.map((l) => (
                        <i key={l}>{l}</i>
                      ))}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
          <p className="muted lcw-map__hint">{E.mapWorldHint}<KoHelp of={E.mapWorldHint} /></p>
        </section>

        <section className="lcw-map__places" aria-labelledby={`${uid}ph`}>
          <h3 id={`${uid}ph`}>{E.mapPlaces}<KoHelp of={E.mapPlaces} /></h3>
          {lessonOn ? <p className="note">{E.mapLessonNote}<KoHelp of={E.mapLessonNote} /></p> : null}
          {places.length === 0 ? <p className="muted">{E.mapNoPlaces}<KoHelp of={E.mapNoPlaces} /></p> : null}
          <ul className="lcw-map__list">
            {places.map((s) =>
              lessonOn ? (
                <li key={s.id} className="lcw-map__place">
                  <i className="lcw-map__dot" aria-hidden="true" />
                  {placeEn(s.nameKo)}
                  <KoHelp text={placeKo(s.nameKo)} />
                  {s.id === scene ? <small className="muted">· {F.mapHereScene}</small> : null}
                </li>
              ) : (
                <li key={s.id}>
                  <button type="button" className={`btn lcw-map__go${s.id === scene ? ' is-here' : ''}`} aria-label={goLabel(s.nameKo)} onClick={() => go(s.id)}>
                    <span>
                      {placeEn(s.nameKo)}
                      <KoHelp text={placeKo(s.nameKo)} />
                    </span>
                    <small aria-hidden="true">{s.id === scene ? F.mapHereScene : F.goThere}</small>
                  </button>
                </li>
              )
            )}
          </ul>
        </section>

        <section className="lcw-map__bands" aria-labelledby={`${uid}bh`}>
          <h3 id={`${uid}bh`}>{E.bandsTitle}<KoHelp of={E.bandsTitle} /></h3>
          <ol className="lcw-map__shaft" aria-label={F.bandsAria}>
            {stops.map((b) => (
              <li key={b.id} className={`lcw-map__stop is-${b.state}`} aria-current={b.state === 'here' ? 'location' : undefined}>
                <span className="lcw-map__car" aria-hidden="true">
                  {b.state === 'here' ? F.youAreHere : b.state === 'locked' ? '🔒' : '○'}
                </span>
                <span>
                  <b>{b.nameKo}</b>
                  <small>{b.range}</small>
                </span>
                {b.state === 'here' ? <em>{F.bandHere}</em> : null}
                {b.state === 'locked' ? <span className="lcw-map__sr">{F.bandLocked}</span> : null}
              </li>
            ))}
          </ol>
          <p className="muted">{E.bandsHint}<KoHelp of={E.bandsHint} /></p>
        </section>

        <section className="lcw-map__legend" aria-labelledby={`${uid}lh`}>
          <h3 id={`${uid}lh`}>{E.legend}<KoHelp of={E.legend} /></h3>
          <ul className="lcw-map__keys">
            {ZONE_ORDER.map((z) => (
              <li key={z}>
                <Swatch id={`${uid}k${z}`} fill={z} />
                {F.zones[z]}
              </li>
            ))}
            <li>
              <Swatch id={`${uid}kf`} fill="fog" />
              {F.unexplored}
            </li>
            <li>
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <circle cx={12} cy={12} r={6} style={{ fill: cv('brand'), stroke: cv('ink-900'), strokeWidth: 2 }} />
              </svg>
              {F.legendPlace}
            </li>
            <li>
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <Arrow u={12} v={12} yaw={Math.PI} s={1.7} />
              </svg>
              {F.legendYou}
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}
