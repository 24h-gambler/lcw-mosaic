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
  return { build: d.build, counts: d.counts, last_runs: d.last_runs };
});
for (const page of ['/', '/try', '/parents', '/game/']) {
  await check(`page ${page}`, async () => {
    const r = await req(page, { headers: { accept: 'text/html' } });
    expect(r.status === 200, `status ${r.status}`);
    const html = await r.text();
    expect(html.includes('<div id="root"'), 'no app root in html');
    const asset = html.match(/src="([^"]+\.js)"/)?.[1];
    expect(asset, 'no script tag');
    const a = await fetch(new URL(asset, base + page));
    expect(a.status === 200, `asset ${asset} → ${a.status}`);
    return { asset };
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
}

const failed = results.filter((r) => !r.ok);
if (asJson) {
  console.log(JSON.stringify({ base, ok: failed.length === 0, checks: results }, null, 2));
} else {
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.name} (${r.ms}ms)${r.ok ? '' : ' — ' + r.detail}`);
  console.log(`${results.length - failed.length}/${results.length} passed`);
}
process.exit(failed.length === 0 ? 0 : 1);
