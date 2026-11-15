// Live-lesson watch (coordinator 11-16): during a real lesson, every N minutes read the production operator views and
// the worker's error stream, and write a short summary plus alerts. Read only: the only HTTP verb used is GET, and
// `wrangler tail` only listens.
//
//   node tools/lesson-watch.mjs [--from 15:00] [--to 17:00] [--every 15] [--once] [--include-test] [--no-tail]
//                               [--base https://lcw.worldwidesomething.com] [--token-file <path>] [--out <dir>]
//
// - The operator token is read from --token-file (default: LCW_OPERATOR_TOKEN_FILE, else the automation secrets file)
//   and is never printed or written.
// - Times are local (KST). Before --from it waits; it ticks at --from and every --every minutes until --to, plus one
//   tick at start so a launch is checked at once. --once: one tick, then exit (exit code 1 if that tick has an alert).
// - Output (no child utterances or nicknames, ids and counts only):
//     <out>/lesson-watch-YYYYMMDD.jsonl   one row per tick (health, lessons, tail summary)
//     <out>/lesson-watch-alerts.jsonl     one row per alert
//     <out>/lesson-watch-tail.jsonl       worker errors from wrangler tail (5xx, exceptions, error logs; tokens masked)
//   and one line per tick on stdout ("OK ..." or "ALERT ...").
// - wrangler tail restarts by itself if it exits (network drop, session expiry), so the watch keeps running.
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : dflt;
};
const flag = (name) => args.includes(`--${name}`);

const BASE = opt('base', 'https://lcw.worldwidesomething.com').replace(/\/$/, '');
const TOKEN_FILE = opt('token-file', process.env.LCW_OPERATOR_TOKEN_FILE || 'C:/Users/2idki/automation/secrets/lcw-operator.token');
const OUT = opt('out', 'Z:/tmp/lcw-watch');
const EVERY_MIN = Math.max(1, Number(opt('every', '15')) || 15);
const FROM = opt('from', '15:00');
const TO = opt('to', '17:00');
const ONCE = flag('once');
const INCLUDE_TEST = flag('include-test');
const TAIL = !flag('no-tail');
const WORKER = opt('worker', 'lcw');

/** Thresholds for alerts. */
export const WATCH_LIMITS = {
  slowMs: 3000,
  /** A live lesson whose student screen has not polled for this long. */
  studentGoneMs: 60_000,
  /** A live lesson (older than quietAfterMs) with no answer for this long: maybe the mic/answer path is stuck. */
  quietMs: 15 * 60_000,
  quietAfterMs: 10 * 60_000
};

const day = () => {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
};
const write = (file, row) => appendFileSync(join(OUT, file), `${JSON.stringify(row)}\n`, 'utf8');
const stamp = () => new Date().toISOString();

/** Read in main() (importing this file for tests touches no secret and no disk). */
let TOKEN = '';

/** The only request this tool makes. */
async function get(path) {
  const t0 = Date.now();
  try {
    const r = await fetch(BASE + path, { method: 'GET', headers: { authorization: `Bearer ${TOKEN}`, accept: 'application/json' } });
    const body = await r.json().catch(() => null);
    return { status: r.status, ms: Date.now() - t0, body };
  } catch (e) {
    return { status: 0, ms: Date.now() - t0, body: null, error: String(e?.message ?? e).slice(0, 120) };
  }
}

/** Share tokens, join codes in paths and long hex/base64 runs are masked before anything is written. */
export function maskUrl(u) {
  return String(u ?? '')
    .replace(/(\/r\/|\/v1\/reports\/)[^/?#]+/g, '$1***')
    .replace(/([?&](code|token|t)=)[^&#]+/gi, '$1***')
    .replace(/[A-Za-z0-9_-]{24,}/g, '***');
}

/* ---------- wrangler tail ---------- */

const tailBuf = { events: 0, s5xx: 0, s4xx: 0, exceptions: 0, errorLogs: 0, samples: [] };
let tailProc = null;
let tailRestarts = 0;
let tailUp = false;
let lastTailRestarts = 0;

function startTail() {
  if (!TAIL) return;
  const env = { ...process.env };
  delete env.NO_COLOR;
  // The installed wrangler through this same node (no npx, no shell in between): it starts at once, and the process
  // tree can be taken down from its root. Else npx (slow first start).
  const globalWrangler = join(process.env.APPDATA ?? '', 'npm', 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  const npxCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
  const [cmd, pre] = existsSync(globalWrangler)
    ? [process.execPath, [globalWrangler]]
    : existsSync(npxCli)
      ? [process.execPath, [npxCli, '--yes', 'wrangler@4']]
      : ['npx', ['--yes', 'wrangler@4']];
  tailProc = spawn(cmd, [...pre, 'tail', WORKER, '--format', 'json'], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  // Up while the process lives (a quiet minute prints nothing); the exit handler below sets it down and restarts.
  tailUp = true;
  let carry = '';
  tailProc.stdout.on('data', (chunk) => {
    carry += chunk.toString('utf8');
    // wrangler prints one JSON object per event, pretty-printed: split on top-level object boundaries.
    let depth = 0;
    let start = -1;
    let inStr = false;
    let esc = false;
    let consumed = 0;
    for (let i = 0; i < carry.length; i++) {
      const ch = carry[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '{') {
        if (depth === 0) start = i;
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0 && start >= 0) {
          onTailEvent(carry.slice(start, i + 1));
          consumed = i + 1;
          start = -1;
        }
      }
    }
    carry = carry.slice(consumed);
    if (carry.length > 1_000_000) carry = '';
  });
  let errTail = '';
  tailProc.stderr.on('data', (chunk) => {
    errTail = (errTail + chunk.toString('utf8')).slice(-400);
  });
  tailProc.on('exit', (code) => {
    tailUp = false;
    tailRestarts++;
    write('lesson-watch-tail.jsonl', { at: stamp(), kind: 'tail_exit', code, stderr: maskUrl(errTail.trim()) });
    // Resume where it stopped: a dropped tail is restarted, with a growing pause.
    setTimeout(startTail, Math.min(60_000, 5_000 * tailRestarts));
  });
}

function onTailEvent(text) {
  let ev;
  try {
    ev = JSON.parse(text);
  } catch {
    return;
  }
  tailBuf.events++;
  const status = ev?.event?.response?.status ?? null;
  const url = maskUrl(ev?.event?.request?.url);
  const method = ev?.event?.request?.method ?? '';
  const exceptions = (ev?.exceptions ?? []).map((x) => `${x.name ?? ''}: ${String(x.message ?? '').slice(0, 200)}`);
  const errorLogs = (ev?.logs ?? [])
    .filter((l) => l.level === 'error')
    .map((l) => maskUrl((Array.isArray(l.message) ? l.message.join(' ') : String(l.message ?? '')).slice(0, 200)));
  if (typeof status === 'number' && status >= 500) tailBuf.s5xx++;
  else if (typeof status === 'number' && status >= 400) tailBuf.s4xx++;
  tailBuf.exceptions += exceptions.length;
  tailBuf.errorLogs += errorLogs.length;
  const bad = (typeof status === 'number' && status >= 500) || exceptions.length > 0 || errorLogs.length > 0 || ev?.outcome !== 'ok';
  if (bad) {
    const row = { at: stamp(), outcome: ev?.outcome ?? null, status, method, url, exceptions, errorLogs };
    write('lesson-watch-tail.jsonl', row);
    if (tailBuf.samples.length < 5) tailBuf.samples.push(`${status ?? ev?.outcome} ${method} ${url} ${exceptions[0] ?? errorLogs[0] ?? ''}`.trim());
  }
}

function stopTail() {
  const p = tailProc;
  tailProc = null;
  if (!p || p.exitCode !== null) return;
  p.removeAllListeners('exit');
  // npx starts wrangler through cmd.exe on Windows: take the whole tree down (and wait, so nothing outlives us).
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(p.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  else p.kill();
}
process.on('SIGINT', () => {
  stopTail();
  process.exit(130);
});

function takeTail() {
  const s = { ...tailBuf, up: TAIL ? tailUp : null, restarts: tailRestarts };
  Object.assign(tailBuf, { events: 0, s5xx: 0, s4xx: 0, exceptions: 0, errorLogs: 0, samples: [] });
  return s;
}

/** One live lesson's summary row and alerts from its console feed (pure, for tests). */
export function checkLesson(l, f, now, prev) {
  const alerts = [];
  const alert = (key, msg) => alerts.push({ key, msg });
  const b = f.body ?? {};
  const sv = b.student_view ?? {};
  const total = Number(b.live?.utterances ?? 0);
  const lastAt = sv.last_utterance?.at ?? null;
  const row = {
    lesson_id: l.lesson_id,
    player_id: l.player_id,
    plan: l.plan_id,
    stage: b.lesson?.stage_id ?? l.stage_id,
    stage_min: Math.round((now - (l.stage_started_at ?? now)) / 60_000),
    lesson_min: Math.round((now - (l.started_at ?? now)) / 60_000),
    utterances: total,
    new_utterances: prev === undefined ? null : total - prev,
    passes: Number(b.live?.passes ?? 0),
    stars: Number(b.live?.stars_total ?? 0),
    last_answer_s: lastAt ? Math.round((now - lastAt) / 1000) : null,
    student_connected: sv.connected ?? null,
    student_seen_s: sv.last_seen_at ? Math.round((now - sv.last_seen_at) / 1000) : null,
    ui: sv.ui ?? null,
    scene: sv.scene_id ?? null,
    expected_scene: sv.expected_scene_id ?? null
  };
  const tag = l.lesson_id;
  if (f.status === 200) {
    if (!sv.last_seen_at || now - sv.last_seen_at > WATCH_LIMITS.studentGoneMs)
      alert('student_gone', `${tag}: student screen not polling for ${row.student_seen_s ?? '∞'} s`);
    if (row.scene && row.expected_scene && row.scene !== row.expected_scene)
      alert('scene', `${tag}: student scene ${row.scene} ≠ stage scene ${row.expected_scene}`);
    if (now - (l.started_at ?? now) > WATCH_LIMITS.quietAfterMs && (!lastAt || now - lastAt > WATCH_LIMITS.quietMs))
      alert('quiet', `${tag}: no answer for ${row.last_answer_s ?? '∞'} s (stage ${row.stage})`);
  }
  return { row, alerts };
}

/* ---------- one tick ---------- */

const lastCount = new Map();

export async function tick() {
  const alerts = [];
  const alert = (key, msg) => alerts.push({ key, msg });
  const calls = [];
  const call = async (path) => {
    const r = await get(path);
    calls.push({ path: maskUrl(path), status: r.status, ms: r.ms });
    if (r.status !== 200) alert('http', `${maskUrl(path)} → ${r.status}${r.error ? ` ${r.error}` : ''}`);
    else if (r.ms > WATCH_LIMITS.slowMs) alert('slow', `${maskUrl(path)} ${r.ms}ms`);
    return r;
  };

  const health = await call('/v1/admin/health');
  const h = health.body ?? {};
  if (health.status === 200 && h.ok !== true) alert('health', 'health.ok is not true');
  const q = h.quota ?? {};
  if (q.alert || q.over_85 || q.ops_alert) alert('quota', `quota alert (${q.stage ?? q.status ?? 'stage?'})`);

  const live = await call(`/v1/admin/lessons/live${INCLUDE_TEST ? '?include_test=1' : ''}`);
  const now = live.body?.server_now ?? Date.now();
  const lessons = [];
  for (const l of live.body?.lessons ?? []) {
    const f = await call(`/v1/admin/lessons/${encodeURIComponent(l.lesson_id)}/feed`);
    const prev = lastCount.get(l.lesson_id);
    const c = checkLesson(l, f, now, prev);
    lastCount.set(l.lesson_id, c.row.utterances);
    lessons.push(c.row);
    for (const a of c.alerts) alert(a.key, a.msg);
  }

  const tail = takeTail();
  if (TAIL && (tail.up === false || tail.restarts > lastTailRestarts))
    alert('tail_down', `wrangler tail dropped (restarts ${tail.restarts}, see lesson-watch-tail.jsonl)`);
  lastTailRestarts = tail.restarts;
  if (tail.s5xx > 0 || tail.exceptions > 0 || tail.errorLogs > 0)
    alert('worker_errors', `5xx ${tail.s5xx} · exceptions ${tail.exceptions} · error logs ${tail.errorLogs}: ${tail.samples[0] ?? ''}`);

  const row = {
    at: stamp(),
    base: BASE,
    calls,
    health: { ok: h.ok ?? null, operator_token: h.operator_token ?? null, quota: q.stage ?? q.status ?? null },
    lessons,
    tail,
    alerts
  };
  write(`lesson-watch-${day()}.jsonl`, row);
  for (const a of alerts) write('lesson-watch-alerts.jsonl', { at: row.at, ...a });
  const brief = lessons
    .map((x) => `${x.lesson_id.slice(-8)} ${x.stage} ${x.utterances}발화(+${x.new_utterances ?? '?'}) 마지막답 ${x.last_answer_s ?? '-'}s 학생 ${x.student_connected ? '연결' : '끊김'}`)
    .join(' | ');
  const head = alerts.length ? `ALERT ${alerts.map((a) => a.msg).join(' ; ')}` : 'OK';
  console.log(`${new Date().toTimeString().slice(0, 8)} ${head} · 수업 ${lessons.length}개${brief ? ` · ${brief}` : ''} · tail ${tail.events}건/5xx ${tail.s5xx}`);
  return row;
}

/* ---------- schedule ---------- */

function atToday(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

async function main() {
  if (!existsSync(TOKEN_FILE)) {
    console.error(`operator token file not found: ${TOKEN_FILE}`);
    process.exit(2);
  }
  TOKEN = readFileSync(TOKEN_FILE, 'utf8').trim();
  mkdirSync(OUT, { recursive: true });
  if (ONCE) {
    // One look (no tail unless asked to listen): exit 1 when that look has an alert.
    if (TAIL) {
      startTail();
      await sleep(20_000);
    }
    const r = await tick();
    stopTail();
    await sleep(500);
    process.exit(r.alerts.length ? 1 : 0);
  }
  const from = atToday(FROM);
  const to = atToday(TO);
  if (Date.now() > to) {
    console.error(`--to ${TO} has already passed today`);
    process.exit(2);
  }
  startTail();
  await sleep(15_000);
  await tick();
  let next = Math.max(from, Date.now() + 1000);
  // Align to from + k·every so the ticks land on :00, :15, :30, :45 for a 15:00 start.
  const step = EVERY_MIN * 60_000;
  if (next > from) next = from + Math.ceil((next - from) / step) * step;
  while (next <= to) {
    await sleep(next - Date.now());
    await tick().catch((e) => console.error('tick failed', e));
    next += step;
  }
  stopTail();
  console.log('watch window ended');
  process.exit(0);
}

// Run when started as a script (also from a copy elsewhere), not when imported by a test.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
