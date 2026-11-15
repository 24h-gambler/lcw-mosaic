import { describe, expect, it } from 'vitest';
import { PlatformDO, isPublicRoute, type LcwEnv } from '../platform.js';
import { CONSULTS_PER_HOUR_PER_CLIENT, SITE_EVENTS, counterPath } from '../site.js';
import { SITE_EVENTS as WEB_SITE_EVENTS } from '../../../web/src/site/track.js';
import { fakeDurableStorage } from './fake-do.js';
import { rewriteReportShell } from '../report-page.js';
import { injectShowroomShareMeta, showroomTokenFromPath } from '../showroom-page.js';
import { fillShell, prerenderPage } from '../../../web/src/site/prerender.js';

const TOKEN = 'op-token-0123456789abcdef';
const op = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
const anon = { 'content-type': 'application/json' };

function platform() {
  return new PlatformDO({ storage: fakeDurableStorage() }, { PLATFORM: undefined as never, LCW_OPERATOR_TOKEN: TOKEN } as LcwEnv);
}
async function call(p: PlatformDO, method: string, path: string, body?: unknown, headers: Record<string, string> = anon) {
  const res = await p.fetch(new Request(`https://x${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as any, headers: res.headers };
}

describe('public site counters (docs/14 §10)', () => {
  it('counts an event per day and page without cookies or visitor data, and folds showroom tokens', async () => {
    const p = platform();
    expect((await call(p, 'POST', '/v1/site/event', { event: 'try_start', path: '/try' })).status).toBe(204);
    await call(p, 'POST', '/v1/site/event', { event: 'try_start', path: '/try?utm=x' });
    await call(p, 'POST', '/v1/site/event', { event: 'send_to_parent', path: '/s/AbCdEf123' });
    const res = await p.fetch(new Request('https://x/v1/site/event', { method: 'POST', headers: anon, body: JSON.stringify({ event: 'order_done', path: '/try' }) }));
    expect(res.headers.get('set-cookie')).toBeNull();
    const rows = (await call(p, 'GET', '/v1/admin/site/events', undefined, op)).body as Array<{ event: string; path: string; n: number }>;
    expect(rows.find((r) => r.event === 'try_start')).toMatchObject({ path: '/try', n: 2 });
    expect(rows.find((r) => r.event === 'send_to_parent')?.path).toBe('/s/*');
    expect(Object.keys(rows[0]!).sort()).toEqual(['day', 'event', 'n', 'path']);
  });

  it('rejects unknown events, and only the operator reads the counters', async () => {
    const p = platform();
    expect((await call(p, 'POST', '/v1/site/event', { event: 'anything', path: '/' })).status).toBe(400);
    expect((await call(p, 'GET', '/v1/admin/site/events')).status).toBe(401);
  });

  it('accepts exactly the events the site sends', () => {
    expect([...SITE_EVENTS]).toEqual([...WEB_SITE_EVENTS]);
  });

  it('folds odd paths into one bucket', () => {
    expect(counterPath('/learn/order-a-drink')).toBe('/learn/order-a-drink');
    expect(counterPath('/Learn/<script>')).toBe('/other');
    expect(counterPath('/pricing/')).toBe('/pricing');
  });
});

describe('report links on top of the pre-rendered landing file', () => {
  it('keep only the report preview tags: no landing title, description, og or canonical', () => {
    const page = prerenderPage('/');
    const shell = fillShell('<!doctype html><html><head><title>x</title></head><body><div id="root"></div></body></html>', page);
    const out = rewriteReportShell(shell, 'https://lcw.example');
    expect(out).not.toContain('rel="canonical"');
    expect(out).not.toContain(page.title);
    expect(out.match(/<title>/g)).toHaveLength(1);
    expect(out.match(/property="og:title"/g)).toHaveLength(1);
    expect(out).toContain('noindex');
  });
});

describe('tutoring consult form (W04)', () => {
  const form = { name: '김민지', contact: '010-1234-5678', grade: '초3', days: ['화', '목'], note: '처음이에요' };

  it('stores a valid request and lists it to the operator only', async () => {
    const p = platform();
    expect((await call(p, 'POST', '/v1/site/consult', form)).status).toBe(201);
    expect((await call(p, 'GET', '/v1/admin/site/consults')).status).toBe(401);
    const list = await call(p, 'GET', '/v1/admin/site/consults', undefined, op);
    expect(list.status).toBe(200);
    expect(list.body[0]).toMatchObject({ name: '김민지', contact: '010-1234-5678', days: ['화', '목'], handled_at: null });
    expect(list.headers.get('cache-control')).toContain('no-store');
    const id = list.body[0].id as string;
    expect((await call(p, 'POST', `/v1/admin/site/consults/${id}/handled`, {}, op)).status).toBe(200);
  });

  it('needs a name and a phone number or e-mail, like the page checks', async () => {
    const p = platform();
    expect((await call(p, 'POST', '/v1/site/consult', { ...form, contact: 'call me' })).status).toBe(400);
    expect((await call(p, 'POST', '/v1/site/consult', { ...form, name: ' ' })).status).toBe(400);
    expect((await call(p, 'POST', '/v1/site/consult', { ...form, contact: 'mom@example.com' })).status).toBe(201);
    expect((await call(p, 'POST', '/v1/site/consult', { ...form, note: 'x'.repeat(501) })).status).toBe(400);
  });

  it('caps requests per address per hour', async () => {
    const p = platform();
    const h = { ...anon, 'cf-connecting-ip': '203.0.113.7' };
    for (let i = 0; i < CONSULTS_PER_HOUR_PER_CLIENT; i++) expect((await call(p, 'POST', '/v1/site/consult', form, h)).status).toBe(201);
    expect((await call(p, 'POST', '/v1/site/consult', form, h)).status).toBe(429);
    expect((await call(p, 'POST', '/v1/site/consult', form, { ...anon, 'cf-connecting-ip': '203.0.113.8' })).status).toBe(201);
  });

  it('opens only the two public site routes', () => {
    expect(isPublicRoute('POST', '/v1/site/event')).toBe(true);
    expect(isPublicRoute('POST', '/v1/site/consult')).toBe(true);
    expect(isPublicRoute('GET', '/v1/site/consult')).toBe(false);
    expect(isPublicRoute('GET', '/v1/admin/site/consults')).toBe(false);
  });
});

describe('showroom share links (WP-703)', () => {
  const shell = () => new Response(fillShell('<!doctype html><html><head><title>x</title></head><body><div id="root"></div></body></html>', prerenderPage('/')), { status: 200 });
  const token = 'a'.repeat(32);

  it("previews the world's own title with noindex and no landing tags", async () => {
    const res = await injectShowroomShareMeta(shell(), new URL(`https://lcw.example/s/${token}`), async () => ({ title: '하늘 <카페> 마을' }));
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('<title>하늘 &lt;카페&gt; 마을 — LCW 쇼룸</title>');
    expect(html).toContain('og:image" content="https://lcw.example/og/showroom.jpg"');
    expect(html).toContain('noindex');
    expect(html).not.toContain('rel="canonical"');
    expect(html.match(/property="og:title"/g)).toHaveLength(1);
    expect(res.headers.get('x-robots-tag')).toContain('noindex');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('answers 404 with a neutral title once the link is gone (consent withdrawn or unknown)', async () => {
    const res = await injectShowroomShareMeta(shell(), new URL(`https://lcw.example/s/${token}`), async () => null);
    expect(res.status).toBe(404);
    const html = await res.text();
    expect(html).toContain('찾을 수 없는 쇼룸');
    expect(res.headers.get('cache-control')).toContain('no-store');
    const bad = await injectShowroomShareMeta(shell(), new URL('https://lcw.example/s/not-a-token'), async () => ({ title: 'x' }));
    expect(bad.status).toBe(404);
  });

  it('serves the sample world without a lookup, and only matches /s/<one segment>', async () => {
    let asked = false;
    const res = await injectShowroomShareMeta(shell(), new URL('https://lcw.example/s/demo'), async () => ((asked = true), null));
    expect(res.status).toBe(200);
    expect(asked).toBe(false);
    expect(showroomTokenFromPath('/s/abc/')).toBe('abc');
    expect(showroomTokenFromPath('/s/abc/def')).toBeNull();
    expect(showroomTokenFromPath('/showroom')).toBeNull();
  });
});
