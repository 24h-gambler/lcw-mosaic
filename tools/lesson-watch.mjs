// Live-lesson watch (coordinator 11-16): during a real lesson, every N minutes read the production operator views and
// the worker's error stream, and write a short summary plus alerts. Read only toward LCW: the only HTTP verb sent to
// the LCW app is GET, and `wrangler tail` only listens (the one write is the alert card to our own spine, below).
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
// - Alerts also go to the spine as hub cards (a session or lane may be gone by the time an alert fires): one card per
//   lesson (and one per day for alerts of no lesson), source 'outsourcing', ref
//   'outsourcing:lcw:watch:<lesson_id | site-YYYYMMDD>:alerts', rewritten in place when its alerts change, so the same
//   alert never makes a second card and the spine's per-source caps are not used up. During the lesson the cards are
//   importance 1: in the hub, but the phone (which polls cards at importance 2 and up) does not ring the teacher; the
//   spine's /notify push is never called. When the window ends, the alerts still standing (plus any worker errors) go
//   into one summary card at importance 2 (P2) and the lesson cards are closed. The card state is kept in
//   <out>/lesson-watch-cards-YYYYMMDD.json, so a restarted watch carries on where it stopped.
//   Spine token: --spine-token-file (default DANOS_TOKEN_FILE, else the automation secrets file), never printed.
//   --no-cards turns cards off; --once posts none unless --cards. --test-card posts one P3 card, closes it, and exits.
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
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
const SPINE = opt('spine', 'https://home-pc-vm.tail0c44c8.ts.net').replace(/\/$/, '');
const SPINE_TOKEN_FILE = opt('spine-token-file', process.env.DANOS_TOKEN_FILE || 'C:/Users/2idki/automation/secrets/danos-automation.token');
const TEST_CARD = flag('test-card');
const CARDS = !TEST_CARD && (ONCE ? flag('cards') : !flag('no-cards'));

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
/** For the tail's stream handlers: a failed log write must not break the event split or the restart. */
const safeWrite = (file, row) => {
  try {
    write(file, row);
  } catch (e) {
    console.error('log write failed', file, String(e?.message ?? e).slice(0, 120));
  }
};
const stamp = () => new Date().toISOString();

/** Read in main() (importing this file for tests touches no secret and no disk). */
let TOKEN = '';

/** The only request this tool makes. */
async function get(path) {
  const t0 = Date.now();
  try {
    const r = await fetch(BASE + path, {
      method: 'GET',
      headers: { authorization: `Bearer ${TOKEN}`, accept: 'application/json' },
      // A hung server fails the call in 10 s (an alert), instead of holding the tick for minutes.
      signal: AbortSignal.timeout(10_000)
    });
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

const tailBuf = { events: 0, s5xx: 0, s4xx: 0, exceptions: 0, errorLogs: 0, killed: 0, samples: [] };
let tailProc = null;
let tailRestarts = 0;
let tailUp = false;
let lastTailRestarts = 0;
/** Set by stopTail(): a restart timer already waiting must not bring tail back. */
let tailStopped = false;

function startTail() {
  if (!TAIL || tailStopped) return;
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
  const me = tailProc;
  let down = false;
  const restart = (kind, detail) => {
    if (down) return;
    down = true;
    tailUp = false;
    tailRestarts++;
    // Resume where it stopped: a dropped tail is restarted, with a growing pause (not after stopTail()). The timer is
    // set before the log write, so a failing disk cannot keep tail down.
    if (tailProc === me) setTimeout(startTail, Math.min(60_000, 5_000 * tailRestarts));
    safeWrite('lesson-watch-tail.jsonl', { at: stamp(), kind, ...detail });
  };
  // A spawn failure (no wrangler, no npx on PATH) is an 'error' with no 'exit': handled the same way, never a crash.
  tailProc.on('error', (e) => restart('tail_error', { error: maskUrl(String(e?.message ?? e).slice(0, 200)) }));
  // Decode as a stream, so a Korean character split across two chunks stays whole.
  tailProc.stdout.setEncoding('utf8');
  tailProc.stderr.setEncoding('utf8');
  let carry = '';
  tailProc.stdout.on('data', (chunk) => {
    carry += chunk;
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
    errTail = (errTail + chunk).slice(-400);
  });
  tailProc.on('exit', (code) => restart('tail_exit', { code, stderr: maskUrl(errTail.trim()) }));
}

/** Outcomes that mean the client went away, not that the worker failed. */
const CLIENT_OUTCOMES = new Set(['ok', 'canceled', 'responseStreamDisconnected', 'clientDisconnected']);

/** What one tail event says (pure, for tests): masked request, errors, and whether the server was at fault. */
export function tailVerdict(ev) {
  const status = ev?.event?.response?.status ?? null;
  const exceptions = (ev?.exceptions ?? []).map((x) => maskUrl(`${x.name ?? ''}: ${String(x.message ?? '').slice(0, 200)}`));
  const errorLogs = (ev?.logs ?? [])
    .filter((l) => l.level === 'error')
    .map((l) => maskUrl((Array.isArray(l.message) ? l.message.join(' ') : String(l.message ?? '')).slice(0, 200)));
  const outcome = ev?.outcome ?? null;
  // The worker itself died (exceededCpu, exceededMemory, ...): usually no status and no exception list. The client's
  // side going away (a tab closed, a dropped stream) is not a server fault, and an 'exception' outcome already counts
  // through its exception list.
  const killed =
    outcome !== null && !CLIENT_OUTCOMES.has(outcome) && !(outcome === 'exception' && exceptions.length > 0);
  const s5xx = typeof status === 'number' && status >= 500;
  return {
    status,
    outcome,
    method: ev?.event?.request?.method ?? '',
    url: maskUrl(ev?.event?.request?.url),
    exceptions,
    /** Names only: what goes onto a hub card (the messages stay in the local tail log). */
    exceptionNames: (ev?.exceptions ?? []).map((x) => String(x.name ?? 'Error').slice(0, 60)),
    errorLogs,
    s5xx,
    s4xx: !s5xx && typeof status === 'number' && status >= 400,
    killed,
    serverBad: s5xx || exceptions.length > 0 || errorLogs.length > 0 || killed
  };
}

function onTailEvent(text) {
  let ev;
  try {
    ev = JSON.parse(text);
  } catch {
    return;
  }
  const v = tailVerdict(ev);
  tailBuf.events++;
  if (v.s5xx) tailBuf.s5xx++;
  if (v.s4xx) tailBuf.s4xx++;
  if (v.killed) tailBuf.killed++;
  tailBuf.exceptions += v.exceptions.length;
  tailBuf.errorLogs += v.errorLogs.length;
  if (v.serverBad || v.outcome !== 'ok') {
    const { status, outcome, method, url, exceptions, errorLogs } = v;
    safeWrite('lesson-watch-tail.jsonl', { at: stamp(), outcome, status, method, url, exceptions, errorLogs });
    // The sample reaches the alert and the hub card: status, method, masked path and the exception name, never a
    // message text (a parse error can quote stored data).
    if (v.serverBad && tailBuf.samples.length < 5)
      tailBuf.samples.push(
        `${status ?? outcome} ${method} ${url} ${v.exceptionNames[0] ?? (errorLogs.length ? 'error log' : v.killed ? outcome : '')}`.trim()
      );
  }
}

function stopTail() {
  tailStopped = true;
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
  Object.assign(tailBuf, { events: 0, s5xx: 0, s4xx: 0, exceptions: 0, errorLogs: 0, killed: 0, samples: [] });
  return s;
}

/** One live lesson's summary row and alerts from its console feed (pure, for tests). */
export function checkLesson(l, f, now, prev) {
  const alerts = [];
  const alert = (key, msg) => alerts.push({ key, msg, lesson: l.lesson_id });
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
      alert('student_gone', `${tag}: 학생 화면이 ${row.student_seen_s === null ? '한 번도' : `${row.student_seen_s}초째`} 서버에 접속하지 않음`);
    if (row.scene && row.expected_scene && row.scene !== row.expected_scene)
      alert('scene', `${tag}: 학생 화면 장소 ${row.scene} ≠ 지금 단계 장소 ${row.expected_scene}`);
    if (now - (l.started_at ?? now) > WATCH_LIMITS.quietAfterMs && (!lastAt || now - lastAt > WATCH_LIMITS.quietMs))
      alert('quiet', `${tag}: ${row.last_answer_s === null ? '아직 답이 하나도 없음' : `${Math.round(row.last_answer_s / 60)}분째 답 없음`} (단계 ${row.stage})`);
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
    if (r.status !== 200) alert('http', `${maskUrl(path)} 응답 ${r.status || '없음'}${r.error ? ` ${r.error}` : ''}`);
    else if (r.ms > WATCH_LIMITS.slowMs) alert('slow', `${maskUrl(path)} ${r.ms}ms 걸림`);
    return r;
  };

  const health = await call('/v1/admin/health');
  const h = health.body ?? {};
  if (health.status === 200 && h.ok !== true) alert('health', 'health 의 ok 가 true 가 아님');
  const q = h.quota ?? {};
  if (q.alert || q.over_85) alert('quota', `사용량 경보 (단계 ${q.stage ?? q.status ?? '?'})`);

  const live = await call(`/v1/admin/lessons/live${INCLUDE_TEST ? '?include_test=1' : ''}`);
  const now = live.body?.server_now ?? Date.now();
  const lessons = [];
  for (const l of live.body?.lessons ?? []) {
    const f = await call(`/v1/admin/lessons/${encodeURIComponent(l.lesson_id)}/feed`);
    const prev = lastCount.get(l.lesson_id);
    const c = checkLesson(l, f, now, prev);
    lastCount.set(l.lesson_id, c.row.utterances);
    lessons.push(c.row);
    alerts.push(...c.alerts);
  }

  const tail = takeTail();
  if (TAIL && (tail.up === false || tail.restarts > lastTailRestarts))
    alert('tail_down', `wrangler tail 끊김 (다시 시작 ${tail.restarts}번, lesson-watch-tail.jsonl 참고)`);
  lastTailRestarts = tail.restarts;
  if (tail.s5xx > 0 || tail.exceptions > 0 || tail.errorLogs > 0 || tail.killed > 0)
    alert(
      'worker_errors',
      `5xx ${tail.s5xx}건 · 예외 ${tail.exceptions}건 · 오류 로그 ${tail.errorLogs}건 · 워커 강제 종료 ${tail.killed}건: ${tail.samples[0] ?? ''}`
    );

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
  if (CARDS) await postTickCards(alerts, row.at);
  const brief = lessons
    .map((x) => `${x.lesson_id.slice(-8)} ${x.stage} ${x.utterances}발화(+${x.new_utterances ?? '?'}) 마지막답 ${x.last_answer_s ?? '-'}s 학생 ${x.student_connected ? '연결' : '끊김'}`)
    .join(' | ');
  const head = alerts.length ? `ALERT ${alerts.map((a) => a.msg).join(' ; ')}` : 'OK';
  console.log(`${new Date().toTimeString().slice(0, 8)} ${head} · 수업 ${lessons.length}개${brief ? ` · ${brief}` : ''} · tail ${tail.events}건/5xx ${tail.s5xx}`);
  return row;
}

/* ---------- spine cards (hub only during the lesson) ---------- */

export const CARD_SOURCE = 'outsourcing';
/**
 * During the lesson: importance 1. The hub lists it (its default floor is 1), but the phone's card poller reads
 * min_importance=2 and does not ring, and the teacher in the lesson is the phone's owner. /notify is never called.
 */
export const LESSON_CARD_IMPORTANCE = 1;
/** After the lesson: the summary card at importance 2 (P2); the lesson is over, so the phone may chime. */
export const SUMMARY_IMPORTANCE = 2;
/** P3 for the test card. */
export const TEST_CARD_IMPORTANCE = 1;
/** Kinds that record something that happened (not a state that can clear): they count as standing at the end. */
export const EVENT_ALERTS = new Set(['worker_errors']);
const KIND_KO = {
  student_gone: '학생 화면 끊김',
  scene: '학생이 다른 장소',
  quiet: '15분째 답 없음',
  http: '운영 API 응답 이상',
  slow: '운영 API 느림',
  health: '서버 상태 이상',
  quota: '사용량 경보',
  tail_down: '서버 로그 감시 끊김',
  worker_errors: '서버 오류(5xx·예외)'
};
const kindKo = (k) => KIND_KO[k] ?? k;
const hhmm = (iso) => new Date(iso).toTimeString().slice(0, 5);

/** A lesson's alerts share one card; alerts that belong to no lesson share one card per day. */
export const alertScope = (a, dayStr) => a.lesson ?? `site-${dayStr}`;
/** The card ref of a scope: rewritten in place (a spine update, not a new card), so a bad lesson is one card. */
export const scopeRef = (scope) => `${CARD_SOURCE}:lcw:watch:${scope}:alerts`.slice(0, 200);

const consoleAction = (base) => [{ type: 'open', url: `${base}/director`, label: '디렉터 콘솔 열기' }, { type: 'dismiss' }];
const isStanding = (st, key, s) => st.lastTick.includes(key) || EVENT_ALERTS.has(s.kind);

/** A fresh card state for one day and one spine. */
export const emptyCardState = (dayStr, spine) => ({ day: dayStr, spine, seen: {}, posted: {}, lastTick: [], summary: null, boost: 0 });

/** The card of one scope: every kind seen there today, standing or cleared (ids and counts only, nothing a child said). */
export function scopeCard(st, scope, { base, out }) {
  const rows = Object.entries(st.seen).filter(([, s]) => s.scope === scope);
  const standing = rows.filter(([k, s]) => isStanding(st, k, s));
  const lesson = scope.startsWith('site-') ? null : scope;
  const lines = rows.map(
    ([k, s]) =>
      `· ${kindKo(s.kind)} — ${isStanding(st, k, s) ? '지금 남음' : '풀림'} · ${s.count}번 · ${hhmm(s.first)}–${hhmm(s.last)} · ${s.msg}`
  );
  return {
    source: CARD_SOURCE,
    ref: scopeRef(scope),
    title: `⚠️ LCW 수업 감시 · ${lesson ? `수업 …${lesson.slice(-8)}` : '서버'} · 지금 경보 ${standing.length}건${
      standing.length ? ` (${standing.map(([, s]) => kindKo(s.kind)).join(', ')})` : ' (모두 풀림)'
    }`.slice(0, 300),
    body: [
      lesson ? `수업 ${lesson}` : '서버 전체(특정 수업이 아닌 경보)',
      ...lines,
      '',
      '수업 중에는 폰이 울리지 않게 허브에만 올렸어요(중요도 낮음). 디렉터 콘솔에서 학생 화면을 확인해 주세요.',
      `같은 수업의 경보는 이 카드 한 장을 고쳐 씁니다. 수업이 끝나면 남은 경보만 요약 카드로 모아요. 기록: ${out}/lesson-watch-alerts.jsonl`
    ]
      .join('\n')
      .slice(0, 4000),
    importance: LESSON_CARD_IMPORTANCE,
    actions: consoleAction(base)
  };
}

/** The card's content signature: a card is posted again (rewritten) only when what it says changes. */
const scopeSig = (st, scope) =>
  Object.entries(st.seen)
    .filter(([, s]) => s.scope === scope)
    .map(([k, s]) => `${s.kind}:${isStanding(st, k, s) ? 1 : 0}`)
    .sort()
    .join(',');

/**
 * One tick's alerts into the card state (pure apart from mutating `st`, for tests): which scope cards to post or
 * rewrite now. A card that failed to post keeps its old signature in `st.posted` and comes back next tick.
 */
export function planTick(st, alerts, at, ctx) {
  const now = new Map();
  for (const a of alerts) {
    const scope = alertScope(a, st.day);
    const key = `${scope}:${a.key}`;
    const m = now.get(key);
    now.set(key, m ? { ...m, msg: `${m.msg} ; ${a.msg}` } : { scope, kind: a.key, msg: a.msg });
  }
  st.lastTick = [...now.keys()];
  for (const [key, a] of now) {
    const s = st.seen[key];
    st.seen[key] = { scope: a.scope, kind: a.kind, msg: a.msg.slice(0, 300), first: s?.first ?? at, last: at, count: (s?.count ?? 0) + 1 };
  }
  const scopes = new Set(Object.values(st.seen).map((s) => s.scope));
  const out = [];
  for (const scope of scopes) {
    const sig = scopeSig(st, scope);
    if (st.posted[scopeRef(scope)]?.sig !== sig) out.push({ card: scopeCard(st, scope, ctx), sig });
  }
  return out;
}

/** After the window: the summary card (null when nothing stands) and the scope cards to close. Pure, for tests. */
export function planWindowEnd(st, { base, from, to, out }) {
  const all = Object.entries(st.seen);
  const standing = all.filter(([k, s]) => isStanding(st, k, s)).map(([, s]) => s);
  const cleared = all.filter(([k, s]) => !isStanding(st, k, s)).map(([, s]) => s);
  const where = (s) => (s.scope.startsWith('site-') ? '서버' : `수업 ${s.scope}`);
  const summary = standing.length
    ? {
        source: CARD_SOURCE,
        ref: `${CARD_SOURCE}:lcw:watch:site-${st.day}:summary`,
        title: `📋 LCW 수업 감시 ${from}–${to} · 남은 경보 ${standing.length}건`.slice(0, 300),
        body: [
          `수업 시간 ${from}–${to} 동안 난 경보 중 끝까지 남은 것(서버 오류는 한 번이라도 나면 남김):`,
          ...standing.map((s) => `· ${kindKo(s.kind)} — ${where(s)} · ${s.count}번 · ${hhmm(s.first)}–${hhmm(s.last)} · ${s.msg}`),
          '',
          cleared.length
            ? `수업 중 났다가 스스로 풀린 경보 ${cleared.length}건: ${cleared.map((s) => `${kindKo(s.kind)}(${where(s)})`).join(', ')}`
            : '스스로 풀린 경보 없음',
          `수업 중 경보 카드는 이 요약 한 장으로 합치고 닫았어요. 기록: ${out}/lesson-watch-${st.day}.jsonl · lesson-watch-tail.jsonl`
        ]
          .join('\n')
          .slice(0, 4000),
        importance: SUMMARY_IMPORTANCE,
        actions: consoleAction(base)
      }
    : null;
  const closeRefs = Object.entries(st.posted)
    .filter(([, p]) => !p.closed)
    .map(([ref]) => ref);
  return { summary, closeRefs, standing: standing.length, cleared: cleared.length };
}

let SPINE_TOKEN = '';
const cardsFile = () => join(OUT, `lesson-watch-cards-${day()}.json`);
let cardState = null;
/** Today's card state for this spine. A broken file, or one written for another spine, is set aside, not reused. */
function loadCards() {
  if (cardState && cardState.day === day()) return cardState;
  const f = cardsFile();
  let st = null;
  if (existsSync(f)) {
    try {
      st = JSON.parse(readFileSync(f, 'utf8'));
    } catch {
      st = null;
    }
    if (!st || st.day !== day() || st.spine !== SPINE || typeof st.seen !== 'object' || typeof st.posted !== 'object') {
      const aside = `${f}.aside-${Date.now()}`;
      try {
        renameSync(f, aside);
      } catch {
        /* keep going with a fresh state */
      }
      safeWrite('lesson-watch-alerts.jsonl', { at: stamp(), key: 'card_state_reset', aside });
      st = null;
    }
  }
  cardState = st ?? emptyCardState(day(), SPINE);
  return cardState;
}
/** Written whole to a temp file, then renamed over: a crash mid-write cannot leave half a file. */
function saveCards() {
  const f = cardsFile();
  try {
    writeFileSync(`${f}.tmp`, JSON.stringify(cardState, null, 1), 'utf8');
    renameSync(`${f}.tmp`, f);
  } catch (e) {
    // The state stays in memory (this run keeps going right); only a restart would lose it, so say so and go on.
    console.error('card state save failed', String(e?.message ?? e).slice(0, 120));
  }
}

async function spine(method, path, body) {
  try {
    const r = await fetch(SPINE + path, {
      method,
      headers: { authorization: `Bearer ${SPINE_TOKEN}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000)
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  } catch (e) {
    return { status: 0, body: null, error: String(e?.message ?? e).slice(0, 120) };
  }
}
const spineError = (r) => r.error ?? (r.body?.detail ? JSON.stringify(r.body.detail).slice(0, 200) : null);

/** Post the scope cards that changed this tick; on a first post, read the card back to see the hub really shows it. */
/**
 * How the spine really holds a card: state and importance after its own adjustments. The spine answers 201 even when
 * it parks the card (open-card cap -> queued, daily cap -> folded) or lowers it (a quiet source gets -1, and an
 * importance-0 card is not listed in the hub). The list with ids= returns pinned ids whatever their importance.
 */
async function readBack(id) {
  const q = `/proposals?ids=${encodeURIComponent(id)}&min_importance=0&folded=true&hours=1&limit=1`;
  const r = await spine('GET', q);
  const p = (r.body?.proposals ?? []).find((x) => x.id === id);
  if (p) return { state: p.state ?? null, importance: typeof p.importance === 'number' ? p.importance : null };
  const one = await spine('GET', `/proposals/one?id=${encodeURIComponent(id)}`);
  return { state: one.body?.state ?? null, importance: null };
}

/** Post a card and check it landed as asked; a card the spine lowered is posted again, raised by what it lost. */
async function postChecked(st, card, max) {
  const asked = Math.min(max, card.importance + (st.boost ?? 0));
  let r = await spine('POST', '/proposals', { ...card, importance: asked });
  if (r.status !== 201 || !r.body?.id) return { r };
  let rb = await readBack(r.body.id);
  if (typeof rb.importance === 'number' && rb.importance < card.importance && asked < max) {
    st.boost = Math.min(2, (st.boost ?? 0) + (card.importance - rb.importance));
    const again = Math.min(max, card.importance + st.boost);
    write('lesson-watch-alerts.jsonl', { at: stamp(), key: 'card_lowered', ref: card.ref, asked, got: rb.importance, repost: again });
    r = await spine('POST', '/proposals', { ...card, importance: again });
    if (r.status === 201 && r.body?.id) rb = await readBack(r.body.id);
  }
  if (rb.state !== 'open' || (typeof rb.importance === 'number' && rb.importance < 1)) {
    write('lesson-watch-alerts.jsonl', { at: stamp(), key: 'card_hidden', ref: card.ref, id: r.body?.id ?? null, ...rb });
    console.log(`card ${r.body?.id ?? '?'} is ${rb.state ?? 'unknown'} (importance ${rb.importance ?? '?'}) on the spine, not shown in the hub`);
  }
  return { r, rb };
}

/** Post the scope cards that changed this tick; a first post is read back (see postChecked). */
async function postTickCards(alerts, at) {
  const st = loadCards();
  for (const { card, sig } of planTick(st, alerts, at, { base: BASE, out: OUT })) {
    const first = !st.posted[card.ref];
    // Lesson cards never go above 2: 2 after a -1 lands as 1 (listed, no ring); 3 would ring the phone.
    const { r, rb } = first
      ? await postChecked(st, card, 2)
      : { r: await spine('POST', '/proposals', { ...card, importance: Math.min(2, card.importance + (st.boost ?? 0)) }) };
    if (r.status !== 201 || !r.body?.id) {
      write('lesson-watch-alerts.jsonl', { at: stamp(), key: 'card_error', ref: card.ref, status: r.status, error: spineError(r) });
      continue;
    }
    st.posted[card.ref] = { ...st.posted[card.ref], id: r.body.id, sig, at, ...(rb ? { state: rb.state, importance: rb.importance } : {}) };
  }
  saveCards();
}

/** After the window: the summary card (retried), then the scope cards close. If the summary fails, nothing closes. */
async function closeWindowCards() {
  const st = loadCards();
  const plan = planWindowEnd(st, { base: BASE, from: FROM, to: TO, out: OUT });
  if (plan.summary && !st.summary) {
    for (const wait of [0, 10_000, 30_000, 60_000]) {
      await sleep(wait);
      const { r, rb } = await postChecked(st, plan.summary, 3);
      if (r.status === 201 && r.body?.id) {
        st.summary = { id: r.body.id, at: stamp(), state: rb?.state ?? null, importance: rb?.importance ?? null };
        break;
      }
      write('lesson-watch-alerts.jsonl', { at: stamp(), key: 'card_error', ref: plan.summary.ref, status: r.status, error: spineError(r) });
    }
    if (!st.summary) {
      saveCards();
      return { ok: false, summary: null, standing: plan.standing, cleared: plan.cleared, closed: 0 };
    }
  }
  let closed = 0;
  for (const ref of plan.closeRefs) {
    const r = await spine('POST', '/proposals/close', { source: CARD_SOURCE, ref });
    if (r.status === 200) {
      st.posted[ref].closed = stamp();
      closed++;
    } else write('lesson-watch-alerts.jsonl', { at: stamp(), key: 'card_close_error', ref, status: r.status, error: spineError(r) });
  }
  saveCards();
  return { ok: closed === plan.closeRefs.length, summary: st.summary?.id ?? null, standing: plan.standing, cleared: plan.cleared, closed };
}

/** The P3 test card: post, read back, close, read back. Prints states only. */
async function testCard() {
  const ref = `${CARD_SOURCE}:lcw:watch:test-${Date.now()}:test`;
  const made = await spine('POST', '/proposals', {
    source: CARD_SOURCE,
    ref,
    title: '🧪 LCW 수업 감시 시험 카드 (바로 닫힘)',
    body: '수업 감시 도구의 척추 카드 연결 시험이에요. 만들자마자 닫습니다.',
    importance: TEST_CARD_IMPORTANCE,
    actions: consoleAction(BASE)
  });
  const id = made.body?.id ?? null;
  // The same read-back the lesson cards use: state and importance after the spine's own adjustments.
  const before = id ? await readBack(id) : null;
  const shut = await spine('POST', '/proposals/close', { source: CARD_SOURCE, ref });
  const after = id ? await spine('GET', `/proposals/one?id=${encodeURIComponent(id)}`) : null;
  const res = {
    post: made.status,
    id,
    state_after_post: before?.state ?? null,
    importance_after_post: before?.importance ?? null,
    close: shut.status,
    closed_rows: shut.body?.closed ?? null,
    state_after_close: after?.body?.state ?? null
  };
  console.log(JSON.stringify(res));
  return res.state_after_close === 'closed';
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
  if (CARDS || TEST_CARD) {
    if (!existsSync(SPINE_TOKEN_FILE)) {
      console.error(`spine token file not found: ${SPINE_TOKEN_FILE} (or run with --no-cards)`);
      process.exit(2);
    }
    SPINE_TOKEN = readFileSync(SPINE_TOKEN_FILE, 'utf8').trim();
  }
  if (TEST_CARD) process.exit((await testCard()) ? 0 : 1);
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
  await tick().catch((e) => console.error('tick failed', e));
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
  const cards = CARDS ? await closeWindowCards() : null;
  if (cards) console.log(`cards: ${JSON.stringify(cards)}`);
  console.log('watch window ended');
  // Exit 1 when the summary or a close did not reach the spine (the alerts file says which).
  process.exit(cards && !cards.ok ? 1 : 0);
}

// Run when started as a script (also from a copy elsewhere), not when imported by a test.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // One stray error must not end a two-hour watch: log it and keep the schedule. Whatever ends the process, the
  // tail process tree goes with it.
  process.on('uncaughtException', (e) => console.error('uncaught', e));
  process.on('unhandledRejection', (e) => console.error('unhandled', e));
  process.on('exit', stopTail);
  main().catch((e) => {
    console.error('watch failed', e);
    stopTail();
    process.exit(2);
  });
}
