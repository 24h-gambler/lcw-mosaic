/**
 * Showroom snapshot (WP-703, docs/01 §3): a static picture of a build and an avatar — no live position, no voice,
 * no real name. The parser is strict: any field outside the allow-list rejects the whole snapshot, so a server
 * bug cannot leak extra data into a public page.
 */
import { COLOR_TOKENS, type ColorTokenName } from '@lcw/ui';
import { character, grass, house, merge, placeAt, shift, tree, type Vox } from './voxel.js';

export const SHOWROOM_MAX_BLOCKS = 20_000;
export const SHOWROOM_ENDPOINT = '/v1/showroom/';

export interface ShowroomSnapshot {
  v: 1;
  /** World name chosen by the player (nickname-level, never a real name). */
  title: string;
  blocks: Vox[];
  avatar: { shirt: ColorTokenName; pants: ColorTokenName; hair: ColorTokenName };
  sample?: boolean;
}

const TOP_KEYS = new Set(['v', 'title', 'blocks', 'avatar', 'sample']);
const AVATAR_KEYS = new Set(['shirt', 'pants', 'hair']);
const COLOR_NAMES = Object.keys(COLOR_TOKENS) as ColorTokenName[];

const isColor = (c: unknown): c is ColorTokenName => typeof c === 'string' && (COLOR_NAMES as string[]).includes(c);
const isInt = (n: unknown, lo: number, hi: number) => typeof n === 'number' && Number.isInteger(n) && n >= lo && n <= hi;

export function parseShowroomSnapshot(raw: unknown): ShowroomSnapshot | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!TOP_KEYS.has(k)) return null;
  if (o.v !== 1) return null;
  if (typeof o.title !== 'string' || o.title.length < 1 || o.title.length > 40) return null;
  if (!Array.isArray(o.blocks) || o.blocks.length > SHOWROOM_MAX_BLOCKS) return null;
  const blocks: Vox[] = [];
  for (const b of o.blocks) {
    if (!Array.isArray(b) || b.length !== 4) return null;
    const [x, y, z, c] = b as unknown[];
    if (!isInt(x, -512, 512) || !isInt(y, -512, 512) || !isInt(z, -64, 512) || !isColor(c)) return null;
    blocks.push({ x: x as number, y: y as number, z: z as number, c });
  }
  const a = o.avatar;
  if (!a || typeof a !== 'object' || Array.isArray(a)) return null;
  const av = a as Record<string, unknown>;
  for (const k of Object.keys(av)) if (!AVATAR_KEYS.has(k)) return null;
  if (!isColor(av.shirt) || !isColor(av.pants) || !isColor(av.hair)) return null;
  return {
    v: 1,
    title: o.title,
    blocks,
    avatar: { shirt: av.shirt, pants: av.pants, hair: av.hair },
    ...(o.sample === true ? { sample: true } : {})
  };
}

export function snapshotVoxels(s: ShowroomSnapshot): Vox[] {
  return merge(s.blocks, placeAt(character(s.avatar), 6, 12));
}

function toRaw(v: Vox[]): [number, number, number, ColorTokenName][] {
  return v.map((b) => [b.x, b.y, b.z, b.c]);
}

/** Sample world shown on /worlds and /s/demo until real snapshots are published (marked 예시). */
export const SAMPLE_SNAPSHOTS: Readonly<Record<string, unknown>> = {
  demo: {
    v: 1,
    title: '하늘 카페 마을',
    sample: true,
    avatar: { shirt: 'brand', pants: 'sky-d', hair: 'ink-700' },
    blocks: toRaw(merge(grass(16, 15), shift(house(), 3, 2, 0), shift(tree(), 13, 3, 0), shift(tree(), 1, 11, 0)))
  }
};

export async function loadShowroom(token: string, fetcher: typeof fetch | undefined): Promise<ShowroomSnapshot | null> {
  if (token in SAMPLE_SNAPSHOTS) return parseShowroomSnapshot(SAMPLE_SNAPSHOTS[token]);
  if (!fetcher) return null;
  try {
    const r = await fetcher(`${SHOWROOM_ENDPOINT}${encodeURIComponent(token)}`, { credentials: 'omit' });
    if (!r.ok) return null;
    return parseShowroomSnapshot(await r.json());
  } catch {
    return null;
  }
}
