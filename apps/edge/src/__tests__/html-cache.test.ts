// Cloudflare Web Analytics injects a third-party beacon into proxied HTML unless the response says no-transform
// (docs/14 §11 forbids third-party scripts; seen on / and /game/ in production 11-16). Static pages get it from the
// _headers file (tools/site-headers.mjs), Worker-built pages from html-cache.ts.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HTML_CACHE_CONTROL, htmlEncodingFor, htmlForClient, htmlNoTransform } from '../html-cache.js';
import { workerHandler, type LcwEnv } from '../platform.js';
import { HTML_CACHE_CONTROL as STATIC_HTML_CACHE_CONTROL, NON_HTML_CACHE, siteHeadersFile } from '../../../../tools/site-headers.mjs';

/** Parses the _headers text into path -> header lines. */
function rules(text: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  let current: string[] | null = null;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    if (!line.startsWith(' ')) {
      current = [];
      out.set(line.trim(), current);
    } else current?.push(line.trim());
  }
  return out;
}

function listFiles(dir: string, prefix = ''): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? listFiles(join(dir, e.name), `${prefix}/${e.name}`) : [`${prefix}/${e.name}`]
  );
}

describe('HTML responses opt out of Cloudflare rewrites (no analytics beacon)', () => {
  it('static HTML gets no-transform on /* and still revalidates every visit', () => {
    expect(STATIC_HTML_CACHE_CONTROL).toBe(HTML_CACHE_CONTROL);
    const all = rules(siteHeadersFile()).get('/*') ?? [];
    expect(all).toContain(`Cache-Control: ${HTML_CACHE_CONTROL}`);
    expect(HTML_CACHE_CONTROL).toMatch(/max-age=0/);
    expect(HTML_CACHE_CONTROL).toMatch(/must-revalidate/);
    expect(all).toContain('X-Content-Type-Options: nosniff');
  });

  it('every non-HTML path detaches the HTML value first, so hashed files keep their year untouched', () => {
    const parsed = rules(siteHeadersFile());
    for (const path of ['/assets/*', '/game/assets/*', '/media/*', '/og/*', '/og-report.png', '/robots.txt', '/sitemap.xml', '/version.json']) {
      const lines = parsed.get(path);
      expect(lines, path).toBeDefined();
      expect(lines?.[0], path).toBe('! Cache-Control');
      expect(lines?.join(' '), path).not.toMatch(/no-transform/);
      expect(lines?.[1], path).toMatch(/^Cache-Control: public, max-age=/);
    }
    for (const path of ['/assets/*', '/game/assets/*', '/media/*']) {
      expect(parsed.get(path)).toContain('Cache-Control: public, max-age=31536000, immutable');
    }
  });

  it('every public file outside the detached paths is HTML', () => {
    // A new non-HTML file at an open path would silently pick up the HTML cache value: list it in site-headers.mjs
    // (and in wrangler.toml run_worker_first, checked below).
    const covered = NON_HTML_CACHE.map(([path]) => path);
    const isCovered = (p: string) => covered.some((c) => (c.endsWith('/*') ? p.startsWith(c.slice(0, -1)) : p === c));
    const files = [
      ['../../../web/public/', ''],
      ['../../../client/public/', '/game']
    ].flatMap(([dir, mount]) => {
      const base = fileURLToPath(new URL(dir as string, import.meta.url));
      return existsSync(base) ? listFiles(base).map((f) => `${mount}${f}`) : [];
    });
    expect(files.length).toBeGreaterThan(0);
    expect(files.filter((f) => !f.endsWith('.html') && !isCovered(f))).toEqual([]);
  });

  it('the Worker adds no-transform to HTML it builds or passes through, and leaves other responses alone', async () => {
    const html = (cc?: string) =>
      new Response('<!doctype html><title>x</title>', {
        headers: { 'content-type': 'text/html; charset=utf-8', ...(cc ? { 'cache-control': cc } : {}) }
      });
    expect(htmlNoTransform(html('private, no-store')).headers.get('cache-control')).toBe('private, no-store, no-transform');
    expect(htmlNoTransform(html()).headers.get('cache-control')).toBe(HTML_CACHE_CONTROL);
    expect(htmlNoTransform(html('no-transform, public')).headers.get('cache-control')).toBe('no-transform, public');
    const json = Response.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
    expect(htmlNoTransform(json)).toBe(json);

    const shell = '<!doctype html><html lang="ko"><head><title>LCW</title></head><body><div id="root"></div></body></html>';
    const env = {
      PLATFORM: undefined as never,
      ASSETS: { fetch: async () => new Response(shell, { headers: { 'content-type': 'text/html' } }) }
    } as LcwEnv;
    const report = await workerHandler.fetch(new Request('https://lcw.example/r/abcdef0123456789abcdef0123456789'), env);
    expect(report.headers.get('cache-control')).toBe('private, no-store, no-transform');
    expect(await report.text()).toContain('<title>');
    const demo = await workerHandler.fetch(new Request('https://lcw.example/s/demo'), env);
    expect(demo.headers.get('cache-control')).toBe('public, max-age=60, no-transform');
    const fallback = await workerHandler.fetch(new Request('https://lcw.example/s/a/b'), env);
    expect(fallback.headers.get('cache-control')).toBe(HTML_CACHE_CONTROL);
  });

  it('the Worker compresses HTML itself, because no-transform also stops Cloudflare compressing it', async () => {
    expect(htmlEncodingFor('gzip, deflate, br, zstd')).toBe('br');
    expect(htmlEncodingFor('gzip;q=1.0, br;q=0')).toBe('gzip');
    expect(htmlEncodingFor('identity')).toBeNull();
    expect(htmlEncodingFor(null)).toBeNull();
    const page = () => new Response('<!doctype html><p>x</p>', { headers: { 'content-type': 'text/html', 'content-length': '22' } });
    const get = (ae?: string) => new Request('https://lcw.example/play', { headers: ae ? { 'accept-encoding': ae } : {} });
    const br = htmlForClient(page(), get('gzip, br'));
    expect(br.headers.get('content-encoding')).toBe('br');
    expect(br.headers.get('content-length')).toBeNull();
    expect(br.headers.get('vary')).toBe('Accept-Encoding');
    expect(br.headers.get('cache-control')).toBe(HTML_CACHE_CONTROL);
    expect(await br.text()).toBe('<!doctype html><p>x</p>');
    const plain = htmlForClient(page(), get());
    expect(plain.headers.get('content-encoding')).toBeNull();
    expect(plain.headers.get('vary')).toBe('Accept-Encoding');
    // HEAD, 304 and non-HTML keep their bytes and headers.
    expect(htmlForClient(page(), new Request('https://lcw.example/', { method: 'HEAD', headers: { 'accept-encoding': 'br' } })).headers.get('content-encoding')).toBeNull();
    expect(htmlForClient(new Response(null, { status: 304, headers: { 'content-type': 'text/html' } }), get('br')).headers.get('content-encoding')).toBeNull();
    const js = new Response('x', { headers: { 'content-type': 'text/javascript' } });
    expect(htmlForClient(js, get('br'))).toBe(js);
    const pre = new Response('x', { headers: { 'content-type': 'text/html', 'content-encoding': 'gzip' } });
    expect(htmlForClient(pre, get('br')).headers.get('content-encoding')).toBe('gzip');

    const env = {
      PLATFORM: undefined as never,
      ASSETS: { fetch: async () => new Response('<!doctype html><title>LCW</title>', { headers: { 'content-type': 'text/html' } }) }
    } as LcwEnv;
    const res = await workerHandler.fetch(new Request('https://lcw.example/parents', { headers: { 'accept-encoding': 'gzip' } }), env);
    expect(res.headers.get('content-encoding')).toBe('gzip');
    expect(res.headers.get('cache-control')).toBe(HTML_CACHE_CONTROL);
  });

  it('every path the Worker skips (wrangler run_worker_first) is a detached non-HTML path, and the other way round', () => {
    const toml = readFileSync(fileURLToPath(new URL('../../wrangler.toml', import.meta.url)), 'utf8');
    const line = toml.split(/\r?\n/).find((l) => l.startsWith('run_worker_first'));
    const patterns = JSON.parse(line?.split('=')[1]?.trim() ?? '[]') as string[];
    expect(patterns[0]).toBe('/*');
    const skipped = patterns.filter((p) => p.startsWith('!')).map((p) => p.slice(1)).sort();
    expect(skipped).toEqual(NON_HTML_CACHE.map(([path]) => path).sort());
  });
});
