#!/usr/bin/env node
// End-to-end smoke of a running LCW Worker (local `wrangler dev` or production).
//   node tools/smoke-live.mjs <base_url> [--token <operator token>] [--json]
// Without a token only the public checks run. Exit code 0 = every check passed.
// Used by the operator after each deploy and by the daily outsourcing keeper (read-only mode).

const args = process.argv.slice(2);
const base = (args.find((a) => /^https?:\/\//.test(a)) ?? '').replace(/\/+$/, '');
const ti = args.indexOf('--token');
const token = ti >= 0 ? args[ti + 1] : process.env.LCW_OPERATOR_TOKEN;
const asJson = args.includes('--json');
if (!base) {
  console.error('usage: node tools/smoke-live.mjs <base_url> [--token T] [--json]');
  process.exit(2);
}

const results = [];
async function check(name, fn) {
  const t0 = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true, ms: Date.now() - t0, detail });
  } catch (err) {
    results.push({ name, ok: false, ms: Date.now() - t0, detail: String(err?.message ?? err) });
  }
}
async function req(path, init = {}, { auth = false } = {}) {
  const headers = { 'content-type': 'application/json', ...(init.headers ?? {}) };
  if (auth) headers.authorization = `Bearer ${token}`;
  return fetch(base + path, { ...init, headers });
}
function expect(cond, msg) {
  if (!cond) throw new Error(msg);
}

await check('health', async () => {
  const r = await req('/health');
  expect(r.status === 200, `status ${r.status}`);
  const j = await r.json();
  expect(j.ok === true, 'unexpected health body');
  if (!token) return { build: j.build };
  const a = await req('/v1/admin/health', {}, { auth: true });
  expect(a.status === 200, `admin health ${a.status}`);
  const d = await a.json();
  expect(d.storage === 'durable-object-sqlite' && d.operator_token === true, 'admin health body');
  return { build: d.build, counts: d.counts, last_runs: d.last_runs, quota: d.quota };
});
// docs/09 P9: the day's quota ladder. Fails (so the keeper raises it) when today reached 85% / bank only.
if (token) {
  await check('quota ladder', async () => {
    const a = await req('/v1/ops/health', {}, { auth: true });
    expect(a.status === 200, `ops health ${a.status}`);
    const q = (await a.json()).quota;
    expect(q && typeof q.stage === 'number', 'no quota block');
    expect(!q.alert, `quota stage ${q.stage} (max today ${q.max_stage_today}), ${Math.round(q.usage_ratio * 100)}% of ${q.neurons_limit}${q.bank_only ? ', bank only' : ''}`);
    return q;
  });
}
// Lesson links sent before 2026-11-16 say /game/?code=…; they must land on the world with the code intact (world-path.ts).
await check('old lesson link /game/?code= → /world/?code=', async () => {
  const r = await req('/game/?code=058779&scene=plaza', { redirect: 'manual', headers: { accept: 'text/html' } });
  expect(r.status === 302, `status ${r.status}`);
  const location = r.headers.get('location');
  expect(location === '/world/?code=058779&scene=plaza', `location ${location}`);
  return { location };
});
const BROWSER_UA ='Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
for (const page of ['/', '/try', '/parents', '/world/']) {
  await check(`page ${page}`, async () => {
    const r = await req(page, { headers: { accept: 'text/html', 'user-agent': BROWSER_UA, 'accept-encoding': 'gzip, br' } });
    expect(r.status === 200, `status ${r.status}`);
    // no-transform also stops Cloudflare compressing, so the Worker must (html-cache.ts htmlForClient).
    const encoding = r.headers.get('content-encoding');
    expect(encoding === 'br' || encoding === 'gzip', `html not compressed (content-encoding ${encoding})`);
    const html = await r.text();
    expect(html.includes('<div id="root"'), 'no app root in html');
    // docs/14 §11: no third-party script. Cloudflare's zone analytics injects one unless HTML says no-transform
    // (tools/site-headers.mjs, apps/edge/src/html-cache.ts).
    const cacheControl = r.headers.get('cache-control') ?? '';
    expect(/no-transform/.test(cacheControl), `html cache-control "${cacheControl}" lacks no-transform`);
    expect(!/cloudflareinsights|beacon\.min\.js/.test(html), 'Cloudflare analytics beacon injected into the page');
    const asset = html.match(/src="([^"]+\.js)"/)?.[1];
    expect(asset, 'no script tag');
    const a = await fetch(new URL(asset, base + page));
    expect(a.status === 200, `asset ${asset} → ${a.status}`);
    const assetCache = a.headers.get('cache-control') ?? '';
    expect(/max-age=31536000/.test(assetCache) && !/no-transform|max-age=0/.test(assetCache), `asset cache-control "${assetCache}"`);
    return { asset, cacheControl, encoding };
  });
}
// App-screen HTML the Worker builds or falls back to (share links, single-page routes): same three rules.
for (const page of ['/join', '/s/demo', '/r/00000000000000000000000000000000']) {
  await check(`app html ${page.split('/').slice(0, 2).join('/')}`, async () => {
    const r = await req(page, { headers: { accept: 'text/html', 'user-agent': BROWSER_UA, 'accept-encoding': 'gzip, br' } });
    expect(r.status === 200, `status ${r.status}`);
    const encoding = r.headers.get('content-encoding');
    expect(encoding === 'br' || encoding === 'gzip', `html not compressed (content-encoding ${encoding})`);
    const cacheControl = r.headers.get('cache-control') ?? '';
    expect(/no-transform/.test(cacheControl), `html cache-control "${cacheControl}" lacks no-transform`);
    const html = await r.text();
    expect(html.includes('<div id="root"'), 'no app root in html');
    expect(!/cloudflareinsights|beacon\.min\.js/.test(html), 'Cloudflare analytics beacon injected into the page');
    return { cacheControl, encoding };
  });
}
await check('version.json', async () => {
  const r = await req('/version.json');
  expect(r.status === 200, `status ${r.status}`);
  return r.json();
});
await check('public scenarios', async () => {
  const r = await req('/v1/trades/scenarios');
  expect(r.status === 200, `status ${r.status}`);
  const j = await r.json();
  return { count: Array.isArray(j) ? j.length : Object.keys(j).length };
});
await check('understand (bank path)', async () => {
  const r = await req('/v1/converse/understand', {
    method: 'POST',
    body: JSON.stringify({
      dialog_id: 'smoke',
      npc_ctx: 'cafe',
      level: 'L1',
      transcript: 'Water, please.',
      stt: { source: 'keyboard', confidence: 1 }
    })
  });
  expect(r.status === 200, `status ${r.status}`);
  const j = await r.json();
  return { source: j.source, intent: j.intent };
});
await check('writes need operator token', async () => {
  const r = await req('/v1/consents', { method: 'POST', body: '{}' });
  expect(r.status === 401, `anonymous write returned ${r.status}`);
  return { status: r.status };
});

if (token) {
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const pid = `smoke-kid-${day}`;
  await check('operator: create player', async () => {
    const r = await req(
      '/v1/admin/players',
      { method: 'POST', body: JSON.stringify({ family_id: `smoke-fam-${day}`, guardian_id: `smoke-g-${day}`, player_id: pid, nickname: 'Smoke' }) },
      { auth: true }
    );
    expect(r.status === 201, `status ${r.status}`);
  });
  await check('operator: score utterance', async () => {
    const r = await req(
      '/v1/converse/score',
      {
        method: 'POST',
        body: JSON.stringify({
          dialog_id: 'smoke',
          chosen_stars: 1,
          hint_level: 'full',
          transcript: 'Water please',
          player_id: pid,
          world_id: 'world-demo',
          session_id: `smoke-${day}`,
          npc_ctx: 'cafe',
          level: 'L1',
          target_text: 'Water, please.'
        })
      },
      { auth: true }
    );
    const text = await r.text();
    expect(r.status === 200, `status ${r.status} ${text.slice(0, 200)}`);
    const j = JSON.parse(text);
    expect(j.pass === true, 'expected pass for exact target');
    return { score: j.score, stars: j.stars };
  });
  const shareToken = `smoke-${day}-${crypto.randomUUID()}`;
  await check('operator: weekly report', async () => {
    const r = await req(
      '/v1/reports/weekly',
      { method: 'POST', body: JSON.stringify({ id: `rep-${shareToken}`, player_id: pid, week: day, share_token: shareToken }) },
      { auth: true }
    );
    expect(r.status === 200, `status ${r.status}`);
    return { replaced: (await r.json()).replaced };
  });
  await check('public: open shared report', async () => {
    const r = await req(`/v1/reports/${shareToken}`);
    expect(r.status === 200, `status ${r.status}`);
    const j = await r.json();
    return { kind: j.kind ?? j.report?.kind ?? 'ok' };
  });
  // Showroom share link as KakaoTalk's scraper sees it (WP-703, src/showroom-page.ts): a consenting test family
  // publishes a small world, the link previews with the world's own title and the showroom picture, then the consent
  // is withdrawn and the same link must be gone (404). One fixed test child, so reruns update one row.
  await check('operator: showroom share preview', async () => {
    const sp = 'smoke-show';
    const title = 'Smoke Showroom';
    const created = await req(
      '/v1/admin/players',
      { method: 'POST', body: JSON.stringify({ family_id: 'smoke-show-fam', guardian_id: 'smoke-show-g', player_id: sp, nickname: 'Smoke' }) },
      { auth: true }
    );
    expect(created.status === 201, `player ${created.status}`);
    const inv = await req('/v1/admin/family-invites', { method: 'POST', body: JSON.stringify({ player_id: sp }) }, { auth: true });
    expect(inv.status === 201, `invite ${inv.status}`);
    const code = (await inv.json()).invite_path.split('#k=')[1];
    const session = await req('/v1/family/session', { method: 'POST', body: JSON.stringify({ invite: code }) });
    expect(session.status === 200, `guardian session ${session.status}`);
    const g = { authorization: `Bearer ${(await session.json()).guardian_token}` };
    const consent = (granted) =>
      req(`/v1/family/children/${sp}/consents/showroom_public`, { method: 'PUT', headers: g, body: JSON.stringify({ granted }) });
    try {
      expect((await req('/v1/family/service-consent', { method: 'POST', headers: g, body: JSON.stringify({ granted: true }) })).status === 200, 'service consent');
      expect((await consent(true)).status === 200, 'showroom consent');
      const blocks = [];
      for (let x = 0; x < 6; x++) for (let y = 0; y < 6; y++) blocks.push([x, y, 0, 'leaf']);
      for (let z = 1; z <= 3; z++) blocks.push([2, 2, z, 'brand'], [3, 2, z, 'brand']);
      const pub = await req(
        '/v1/showroom',
        { method: 'POST', body: JSON.stringify({ player_id: sp, snapshot: { v: 1, title, blocks, avatar: { shirt: 'brand', pants: 'sky-d', hair: 'ink-700' } } }) },
        { auth: true }
      );
      expect(pub.status === 200 || pub.status === 201, `publish ${pub.status} ${(await pub.clone().text()).slice(0, 120)}`);
      const path = (await pub.json()).path;
      const kakao = { 'user-agent': 'facebookexternalhit/1.1; kakaotalk-scrap/1.0', accept: 'text/html' };
      const page = await fetch(base + path, { headers: kakao });
      const html = await page.text();
      expect(page.status === 200, `share page ${page.status}`);
      const meta = (prop) => html.match(new RegExp(`<meta[^>]+(?:property|name)="${prop}"[^>]+content="([^"]*)"`))?.[1] ?? null;
      expect(meta('og:title')?.includes(title) && meta('og:title')?.includes('쇼룸'), `og:title ${meta('og:title')}`);
      expect(meta('og:image')?.endsWith('/og/showroom.jpg'), `og:image ${meta('og:image')}`);
      expect(/noindex/.test(meta('robots') ?? ''), `robots ${meta('robots')}`);
      expect(!html.includes(path.slice(3)), 'share token leaked into the page');
      expect(/no-transform/.test(page.headers.get('cache-control') ?? ''), `cache-control ${page.headers.get('cache-control')}`);
      expect((await fetch(new URL(meta('og:image'), base))).status === 200, 'showroom share picture missing');
      expect((await consent(false)).status === 200, 'withdraw consent');
      const gone = await fetch(base + path, { headers: kakao });
      expect(gone.status === 404, `link after withdrawal ${gone.status}`);
      return { og_title: meta('og:title'), withdrawn: gone.status };
    } finally {
      await consent(false).catch(() => null);
      await req('/v1/family/logout', { method: 'POST', headers: g }).catch(() => null);
    }
  });
}

const failed = results.filter((r) => !r.ok);
if (asJson) {
  console.log(JSON.stringify({ base, ok: failed.length === 0, checks: results }, null, 2));
} else {
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.name} (${r.ms}ms)${r.ok ? '' : ' — ' + r.detail}`);
  console.log(`${results.length - failed.length}/${results.length} passed`);
}
process.exit(failed.length === 0 ? 0 : 1);
