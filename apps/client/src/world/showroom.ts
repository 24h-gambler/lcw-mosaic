/**
 * 쇼룸 공개 from the game (docs/19 7장, WP-703): the world turns my plot into the showroom snapshot — blocks as
 * [x, y, height, colour token name], the avatar as three colour names — and posts it with the child's device token.
 * Only allow-listed fields leave the device (no position, nickname or ids); the server checks the guardian's
 * `showroom_public` consent and filters the title.
 */
import { COLOR_TOKENS, type ColorTokenName } from '@lcw/ui';
import { BK, furnitureDef, isInPlot, type VoxelWorld, type PlotFurniture } from '@lcw/sim-core';
import { TILE_LAYER, blockLook } from './blocks.js';
import { tileAverageColor } from './atlas.js';
import { noteSeatResponse } from './seat.js';
import type { FetchLike } from './identity.js';

export const SHOWROOM_MAX_BLOCKS = 20_000;

export interface ShowroomSnapshotOut {
  v: 1;
  title: string;
  blocks: Array<[number, number, number, ColorTokenName]>;
  avatar: { shirt: ColorTokenName; pants: ColorTokenName; hair: ColorTokenName };
}

const TOKENS = (Object.keys(COLOR_TOKENS) as ColorTokenName[]).map((name) => {
  const hex = COLOR_TOKENS[name].slice(1);
  return { name, r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16) };
});

/** Nearest design-token colour (the showroom draws only token colours). */
export function nearestToken(r: number, g: number, b: number): ColorTokenName {
  let best = TOKENS[0]!;
  let bd = Infinity;
  for (const t of TOKENS) {
    // weighted RGB distance (green counts most for the eye)
    const d = 2 * (t.r - r) ** 2 + 4 * (t.g - g) ** 2 + 3 * (t.b - b) ** 2;
    if (d < bd) {
      bd = d;
      best = t;
    }
  }
  return best.name;
}

/** Block id → token from its atlas tile (top face for ground blocks, side face otherwise), cached. */
export function blockTokenMap(atlas: Uint8Array): (id: number) => ColorTokenName {
  const cache = new Map<number, ColorTokenName>();
  return (id) => {
    const hit = cache.get(id);
    if (hit) return hit;
    const look = blockLook(id);
    const tile = id === BK.grass || id === BK.path || look.shape === 'boxes' ? look.top : look.side;
    const [r, g, b] = tileAverageColor(atlas, TILE_LAYER[tile] ?? 0);
    const t = nearestToken(r * 255, g * 255, b * 255);
    cache.set(id, t);
    return t;
  };
}

const FURN_TOKEN: Record<string, ColorTokenName> = { light: 'sun', rest: 'brand', flat: 'sun-d', job: 'sky', decor: 'leaf' };

/**
 * The plot as a snapshot: everything inside the fence from the ground layer up (ground at height -1, like the site's
 * voxel art), plus one voxel per piece of furniture. Lowest layers first; at most 20,000 blocks.
 */
export function plotSnapshot(
  world: VoxelWorld,
  furniture: ReadonlyMap<string, PlotFurniture>,
  tokenOf: (id: number) => ColorTokenName,
  title: string,
  avatar: { shirt: number; pants: number; hair: number }
): ShowroomSnapshotOut {
  const p = world.plot;
  const blocks: ShowroomSnapshotOut['blocks'] = [];
  for (let y = 0; y <= 40 && blocks.length < SHOWROOM_MAX_BLOCKS; y++) {
    for (let z = p.z0 + 1; z < p.z1 - 1; z++) {
      for (let x = p.x0 + 1; x < p.x1 - 1; x++) {
        if (!isInPlot(world, x, z)) continue;
        const id = world.getBlock(x, y, z);
        let tok: ColorTokenName | null = id === 0 || id === BK.water ? null : tokenOf(id);
        if (!tok) {
          const f = furniture.get(`${x},${y},${z}`);
          if (f) tok = FURN_TOKEN[furnitureDef(f.key)?.role ?? 'decor'] ?? 'leaf';
        }
        if (!tok) continue;
        blocks.push([x - (p.x0 + 1), z - (p.z0 + 1), y - 1, tok]);
        if (blocks.length >= SHOWROOM_MAX_BLOCKS) break;
      }
      if (blocks.length >= SHOWROOM_MAX_BLOCKS) break;
    }
  }
  const tok = (c: number): ColorTokenName => nearestToken((c >> 16) & 255, (c >> 8) & 255, c & 255);
  return { v: 1, title: title.trim().slice(0, 40), blocks, avatar: { shirt: tok(avatar.shirt), pants: tok(avatar.pants), hair: tok(avatar.hair) } };
}

export type ShowroomResult =
  | { ok: true; path: string }
  | { ok: false; reason: 'consent' | 'seat' | 'title' | 'busy' | 'offline' | 'unlinked' | 'server' };

/** POST /v1/showroom with the child's device token. */
export async function publishShowroom(token: string, snapshot: ShowroomSnapshotOut, fetchFn: FetchLike = (i, init) => globalThis.fetch(i, init), base = ''): Promise<ShowroomResult> {
  let res: Response;
  try {
    res = await fetchFn(`${base}/v1/showroom`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ snapshot })
    });
  } catch {
    return { ok: false, reason: 'offline' };
  }
  if (await noteSeatResponse(res)) return { ok: false, reason: 'seat' };
  if (res.status === 401) return { ok: false, reason: 'unlinked' };
  // no guardian consent: 403 consent_required (or 404 where the route hides itself)
  if (res.status === 403 || res.status === 404) return { ok: false, reason: 'consent' };
  if (res.status === 422) return { ok: false, reason: 'title' };
  if (res.status === 429) return { ok: false, reason: 'busy' };
  if (!res.ok) return { ok: false, reason: 'server' };
  const body = (await res.json().catch(() => null)) as { path?: unknown } | null;
  return typeof body?.path === 'string' ? { ok: true, path: body.path } : { ok: false, reason: 'server' };
}
