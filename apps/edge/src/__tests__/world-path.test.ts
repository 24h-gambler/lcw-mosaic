// /game/ → /world/ (docs/21-glossary.md). Lesson links from the director console were `/game/?code=123456` until
// 2026-11-16 and may sit in a chat or a bookmark, so the redirect must keep the whole query string.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import worker from '../worker.js';
import type { LcwEnv } from '../platform.js';
import { legacyWorldLocation, WORLD_PATH } from '../world-path.js';
import { codeFromSearch } from '../../../client/src/lesson/api.js';
import { studentJoinLinks } from '../../../web/src/lessonFlow.js';

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

  it('keeps the console links from #63 working: lite=1 survives the redirect, /join is never redirected', () => {
    const at = (u: string) => legacyWorldLocation(new URL(u));
    // an old 3D link someone added lite=1 to, and the /world/ hand-off of a 3D-capable device
    expect(at('https://lcw/game/?code=482913&lite=1')).toBe('/world/?code=482913&lite=1');
    expect(at('https://lcw/game?lite=1&code=482913')).toBe('/world/?lite=1&code=482913');
    // the teacher's fallback link and the 3D link the console prints today are not under /game at all
    for (const l of studentJoinLinks('https://lcw', '482913', true)) expect(at(l.url), l.url).toBeNull();
    expect(studentJoinLinks('https://lcw', '482913', true).map((l) => l.url)).toEqual(['https://lcw/world/?code=482913', 'https://lcw/join?code=482913&lite=1']);
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

describe('R329: the entrance order — first visit to the introduction, revisit to the world', () => {
  it('a first visit to `/` answers 302 to /about (with its query) and sets the revisit marker; other pages are left alone', async () => {
    const { e, hits } = env();
    const res = await worker.fetch(new Request('https://lcw.worldwidesomething.com/?from=wws'), e);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/about?from=wws');
    expect(res.headers.get('set-cookie') ?? '').toContain('lcw_seen=1');
    const bare = await worker.fetch(new Request('https://lcw.worldwidesomething.com/'), e);
    expect(bare.headers.get('location')).toBe('/about');
    expect(bare.headers.get('set-cookie') ?? '').toContain('lcw_seen=1');
    expect(hits).toEqual([]);
    for (const p of ['/about', '/pricing', '/try', '/world/']) {
      const r = await worker.fetch(new Request(`https://lcw.worldwidesomething.com${p}`), e);
      expect(r.status, p).toBe(200);
    }
  });

  it('a revisit (the marker cookie present) answers 302 to /world/ with its query', async () => {
    const { e, hits } = env();
    const res = await worker.fetch(new Request('https://lcw.worldwidesomething.com/?from=wws', { headers: { cookie: 'lcw_seen=1; other=2' } }), e);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/world/?from=wws');
    expect(res.headers.get('set-cookie')).toBeNull();
    const bare = await worker.fetch(new Request('https://lcw.worldwidesomething.com/', { headers: { cookie: 'lcw_seen=1' } }), e);
    expect(bare.headers.get('location')).toBe('/world/');
    expect(hits).toEqual([]);
  });

  it('a lesson code always opens the world, even without the marker (a class never waits on /about)', async () => {
    const { e, hits } = env();
    const res = await worker.fetch(new Request('https://lcw.worldwidesomething.com/?code=482913'), e);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/world/?code=482913');
    expect(hits).toEqual([]);
  });

  it('a page view sets the marker once, so the next `/` opens the world', async () => {
    const { e } = env();
    const page = await worker.fetch(new Request('https://lcw.worldwidesomething.com/about'), e);
    expect(page.status).toBe(200);
    expect(page.headers.get('set-cookie') ?? '').toContain('lcw_seen=1');
    const again = await worker.fetch(new Request('https://lcw.worldwidesomething.com/about', { headers: { cookie: 'lcw_seen=1' } }), e);
    expect(again.headers.get('set-cookie')).toBeNull();
  });
});
