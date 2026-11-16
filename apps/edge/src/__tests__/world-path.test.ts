// /game/ → /world/ (docs/21-glossary.md). Lesson links from the director console were `/game/?code=123456` until
// 2026-11-16 and may sit in a chat or a bookmark, so the redirect must keep the whole query string.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import worker from '../worker.js';
import type { LcwEnv } from '../platform.js';
import { legacyWorldLocation, WORLD_PATH } from '../world-path.js';
import { codeFromSearch } from '../../../client/src/lesson/api.js';

const env = () => {
  const hits: string[] = [];
  const e = {
    PLATFORM: { idFromName: (n: string) => n, get: () => ({ fetch: async () => new Response('{}') }) },
    ASSETS: { fetch: async (r: Request) => { hits.push(new URL(r.url).pathname + new URL(r.url).search); return new Response('<html>', { headers: { 'content-type': 'text/html' } }); } }
  } as unknown as LcwEnv;
  return { e, hits };
};

describe('/game/ redirects to /world/ with the query intact', () => {
  it('maps every /game path and keeps the query string byte for byte', () => {
    const at = (u: string) => legacyWorldLocation(new URL(u));
    expect(WORLD_PATH).toBe('/world/');
    expect(at('https://lcw/game/?code=482913')).toBe('/world/?code=482913');
    expect(at('https://lcw/game?code=482913')).toBe('/world/?code=482913');
    expect(at('https://lcw/game/')).toBe('/world/');
    expect(at('https://lcw/game')).toBe('/world/');
    expect(at('https://lcw/game/?pass=ab-12&scene=honey_cafe&tier=high')).toBe('/world/?pass=ab-12&scene=honey_cafe&tier=high');
    expect(at('https://lcw/game/?q=%ED%95%9C%EA%B8%80')).toBe('/world/?q=%ED%95%9C%EA%B8%80');
  });

  it('leaves the old build chunks under /game/assets/ to the asset folder (a tab opened before a deploy still needs them)', () => {
    expect(legacyWorldLocation(new URL('https://lcw/game/assets/DialogPanel-OLDHASH.js'))).toBeNull();
    const toml = readFileSync(new URL('../../wrangler.toml', import.meta.url), 'utf8');
    expect(toml).toContain('"!/game/assets/*"');
  });

  it('leaves other paths alone (no /games, /gamer, /world)', () => {
    for (const u of ['https://lcw/world/?code=1', 'https://lcw/games', 'https://lcw/gamer/', 'https://lcw/', 'https://lcw/join?code=482913'])
      expect(legacyWorldLocation(new URL(u)), u).toBeNull();
  });

  it('the Worker answers /game/?code= with a 302 to /world/?code= before touching assets', async () => {
    const { e, hits } = env();
    const res = await worker.fetch(new Request('https://lcw.worldwidesomething.com/game/?code=482913'), e);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/world/?code=482913');
    expect(hits).toEqual([]);
    const res2 = await worker.fetch(new Request('https://lcw.worldwidesomething.com/world/?code=482913'), e);
    expect(res2.status).toBe(200);
    expect(hits).toEqual(['/world/?code=482913']);
  });

  it('following the redirect lands on the same lesson code the 3D client reads', async () => {
    const { e } = env();
    const res = await worker.fetch(new Request('https://lcw.worldwidesomething.com/game/?code=123456&scene=plaza'), e);
    const landed = new URL(res.headers.get('location') ?? '', 'https://lcw.worldwidesomething.com');
    expect(landed.pathname).toBe('/world/');
    expect(landed.searchParams.get('code')).toBe('123456');
    expect(landed.searchParams.get('scene')).toBe('plaza');
    expect(codeFromSearch(landed.search)).toBe('123456');
  });
});
