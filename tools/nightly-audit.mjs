// Nightly real-screen audit of the production site against docs/spec-coverage.json (docs/README.md "설계서 대조").
//
//   PLAYWRIGHT_CORE=<path to playwright-core/index.mjs> node tools/nightly-audit.mjs [--base https://lcw.worldwidesomething.com] [--out shots/nightly/<date>]
//
// Opens every route the coverage list names (e2e.route and plain routes, site features too) at 1440×900 and 390×844,
// headless with audio muted, and records per route and size: HTTP status, where it landed, console errors, page errors,
// horizontal overflow, banned words (tools/forbidden-words.mjs), internal ids shown to users (WP-305, T01, R2553),
// Korean line breaking (word-break: keep-all), and the frame of the internal screens (font, background, width), plus a
// screenshot. Then it joins the result with the coverage list:
//   - regression: an id marked `done` (or a feature `live`) whose screen does not open or misses its expected marker
//   - gaps: every `missing`/`partial` id, by owner (the same list `node tools/spec-coverage.mjs` prints)
// Output: <out>/report.json and <out>/summary.md (Korean). Exit 0 when the audit ran (findings are data), 1 when it
// could not run. The home-PC task (automation repo, Dan-LCW-Nightly-Audit) turns the report into one hub card.
// Credentials: with LCW_OPERATOR_TOKEN set (the home-PC runner reads secrets/lcw-operator.token), screens behind the
// operator key (`auth: operator`) are opened a second time signed in (desktop, read-only: the pages only load) and must
// show their `authExpect` markers. Other keys (guardian, lesson, report link) and the operator screens without a token
// are checked as the anonymous visitor sees them; the report lists them as "열쇠 화면만 확인", never as passed.
// Markers count only when visible (not display:none, visibility:hidden or opacity 0 up the tree); the audit waits up to
// 20 s for them and opens a page once more before it calls a done screen a regression.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { bannedIn } from './forbidden-words.mjs';
import { loadCoverage, runCheck } from './spec-coverage.mjs';
import { spawn } from 'node:child_process';
import { playLines, playNotRun, playRegressions } from './real-play-judge.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const VIEWPORTS = [
  { name: 'd', width: 1440, height: 900, mobile: false },
  { name: 'm', width: 390, height: 844, mobile: true }
];
/** Screens for the teacher and guardians: one shared frame is expected (docs/08 9장, 디자인 일관성). */
export const INTERNAL_ROUTES = ['/director', '/seats', '/dashboard', '/family', '/window', '/link', '/join'];
/** Internal numbers that must never reach a user's screen. */
export const INTERNAL_ID_RE = /\b(?:WP-\d{3}|[GTPW](?:0[1-9]|1[0-9])|R\d{4})\b/g;
/** Pages every audit opens even if no coverage entry names them (docs/14 2장). */
export const SITE_ROUTES = ['/', '/parents', '/play', '/tutoring', '/pricing', '/try', '/learn', '/safety', '/terms', '/privacy'];
/** apps/web/src/lessonApi.ts OPERATOR_TOKEN_KEY: where the console keeps the operator key. */
export const OPERATOR_KEY_STORAGE = 'lcw.operatorToken';
const MARK_WAIT_MS = 20000;
/**
 * One route at one size never takes longer than this. page.evaluate and page.screenshot have no limit of their own: on
 * a starved machine the 3D world's main thread (software WebGL) blocked an evaluate and the whole audit ran into the
 * task's one-hour limit with one screenshot taken (first run 11-16 19:39). Past the limit the context is closed, which
 * rejects whatever was pending, and the route is recorded as a timeout (a done route then gets its second look).
 */
export const ROUTE_LIMIT_MS = 90_000;
/**
 * The whole audit never runs past this (the nightly task has 60 minutes for fetch, install, audit and card). On a machine
 * starved end to end every route could use its full ROUTE_LIMIT_MS: 66 opens x 95 s is about 104 minutes. Routes not
 * opened by then are reported as not checked (`skipped`), never as regressions, and the report is still written.
 */
export const AUDIT_LIMIT_MS = 40 * 60_000;
/**
 * The child's own play (tools/real-play.mjs, PC 1440 and touch 390 side by side, smoke students only, needs the operator
 * key): at most this long, and never more than PLAY_SHARE of the night's limit; the screens get what is left.
 */
export const PLAY_LIMIT_MS = 24 * 60_000;
export const PLAY_SHARE = 0.6;
/** the touch run starts a little after the PC one: two device links at the same instant collided once (11-18, 404) */
const PLAY_STAGGER_MS = 20_000;

/** below this night (a slow install ate it) the play is skipped: the screens keep their time and the task its hour */
export const PLAY_MIN_NIGHT_MS = 15 * 60_000;

/** How long the play may take out of the night's `limitMs` (0 = skip it). */
export function playBudget(limitMs) {
  if (limitMs < PLAY_MIN_NIGHT_MS) return 0;
  return Math.min(PLAY_LIMIT_MS, Math.round(limitMs * PLAY_SHARE));
}

/** Adds the play reports to an audit report: their regressions join the list, `play` keeps the lines and paths. */
export function mergePlay(rep, reports, extra = {}, runs = {}) {
  return {
    ...rep,
    regressions: [...(rep.regressions ?? []), ...playRegressions(reports)],
    play: { ...extra, lines: playLines(reports), notRun: playNotRun(reports, runs) }
  };
}

/**
 * Runs tools/real-play.mjs for pc and touch on `base` into `<out>/play-<view>`, both within `limitMs` (a run past it
 * is killed and reported as not run). Resolves to { reports: { pc, touch }, runs: { pc: { killed, code } }, seconds }.
 */
export async function runPlay({ base, out, limitMs, env = process.env, log = () => {} }) {
  const t0 = Date.now();
  const runs = {};
  const one = (view, delay) =>
    new Promise((resolve) => {
      setTimeout(() => {
        const dir = path.join(out, `play-${view}`);
        fs.mkdirSync(dir, { recursive: true });
        const logFile = fs.openSync(path.join(out, `play-${view}.log`), 'w');
        const child = spawn(process.execPath, [path.join(ROOT, 'tools', 'real-play.mjs'), base, dir, view], {
          cwd: ROOT,
          env: { ...env, LCW_KID_PREFIX: 'smoke' },
          stdio: ['ignore', logFile, logFile],
          windowsHide: true
        });
        runs[view] = { killed: false, code: null };
        child.on('error', (e) => {
          log(`play ${view}: could not start - ${e.message}`);
          runs[view].code = 'spawn';
          resolve(null);
        });
        const kill = setTimeout(() => {
          runs[view].killed = true;
          log(`play ${view}: past ${Math.round(limitMs / 60000)} min - stopped`);
          if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
          else child.kill('SIGKILL');
        }, Math.max(60_000, limitMs - delay));
        child.on('exit', (code) => {
          clearTimeout(kill);
          runs[view].code = code;
          fs.closeSync(logFile);
          const file = path.join(dir, `real-play-${view}.json`);
          let r = null;
          try {
            r = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
          } catch {
            r = null;
          }
          if (!r) {
            // the bot's stall watchdog names the step it stopped after (real-play.mjs, exit 3)
            const m = /"name":"stalled","after":"([^"]+)"/.exec(fs.readFileSync(path.join(out, `play-${view}.log`), 'utf8'));
            if (m) runs[view].stalledAfter = m[1];
          }
          log(`play ${view}: exit ${code}${r ? '' : ' - no report'}${runs[view].stalledAfter ? ` (stalled after ${runs[view].stalledAfter})` : ''}`);
          resolve(r);
        });
      }, delay);
    });
  const [pc, touch] = await Promise.all([one('pc', 0), one('touch', PLAY_STAGGER_MS)]);
  return { reports: { pc, touch }, runs, seconds: Math.round((Date.now() - t0) / 1000) };
}

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

/** Routes to open, each with the ids/features that rely on it and the markers they expect. */
export function auditPlan(coverage) {
  const plan = new Map();
  const add = (route, who, e2e = {}) => {
    if (!route || !route.startsWith('/') || /[<>]/.test(route)) return;
    const p = plan.get(route) ?? { route, who: [], expect: new Set(), authExpect: new Set(), auth: null };
    p.who.push(who);
    for (const m of e2e.expect ?? []) p.expect.add(m);
    for (const m of e2e.authExpect ?? []) p.authExpect.add(m);
    if (e2e.auth) p.auth = e2e.auth;
    plan.set(route, p);
  };
  const who = (id, status, owner, e2e) => ({ id, status, owner, expect: e2e?.expect ?? [], authExpect: e2e?.authExpect ?? [] });
  for (const [id, e] of Object.entries(coverage.ids ?? {})) {
    if (e.e2e?.route) add(e.e2e.route, who(id, e.status, e.owner, e.e2e), e.e2e);
    else if (e.route) add(e.route, who(id, e.status, e.owner));
  }
  for (const f of coverage.features ?? []) {
    if (f.e2e?.route) add(f.e2e.route, who(`feature:${f.id}`, f.status === 'live' ? 'done' : f.status, f.owner, f.e2e), f.e2e);
  }
  for (const r of SITE_ROUTES) add(r, who(`site:${r}`, 'site', 'outsider'));
  return [...plan.values()].map((p) => ({ ...p, expect: [...p.expect], authExpect: [...p.authExpect] }));
}

/** Runs inside the page: are the markers on screen now (visible, not faded out)? */
function readMarks(markers) {
  const shown = (el) => {
    if (!el || el.getClientRects().length === 0) return false;
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    }
    return true;
  };
  // The visible text of the page: text nodes whose element is shown, in order (a phrase split over <b>…</b> still
  // reads whole; innerText is not used because it keeps opacity-0 text).
  let visible = null;
  const textShown = (t) => {
    if (visible === null) {
      const parts = [];
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) if ((n.textContent || '').trim() && shown(n.parentElement)) parts.push(n.textContent);
      visible = parts.join('').replace(/\s+/g, ' ');
    }
    return visible.includes(t.replace(/\s+/g, ' ')) || visible.replace(/ /g, '').includes(t.replace(/\s+/g, ''));
  };
  const one = (m) => {
    if (m === 'canvas') return [...document.querySelectorAll('canvas')].some(shown);
    if (m.startsWith('text:')) return textShown(m.slice(5));
    if (m.startsWith('testid:')) return [...document.querySelectorAll(`[data-testid^="${m.slice(7)}"]`)].some(shown);
    if (m.startsWith('notext:')) return !document.body.innerText.includes(m.slice(7));
    return textShown(m);
  };
  const marks = {};
  // "a || b": either marker is enough (a console that shows the plan picker or a running lesson)
  for (const m of markers) marks[m] = m.split('||').map((x) => x.trim()).some(one);
  return marks;
}

/** Runs inside the page: everything the audit reads from a loaded screen. */
function readPage() {
  const text = document.body ? document.body.innerText : '';
  const meta = [...document.querySelectorAll('meta[content]')].map((m) => m.getAttribute('content') || '').join(' \n ');
  const body = document.body ? getComputedStyle(document.body) : null;
  const main = document.querySelector('main') || document.getElementById('root') || document.body;
  const shown = (el) => {
    if (!el || el.getClientRects().length === 0) return false;
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    }
    return true;
  };
  const hasKorean = /[가-힣]/.test(text);
  // Korean keep-all on every visible text run of 4+ Hangul (any element: a, label, td, inline children included).
  const breakAll = [];
  const seen = new Set();
  if (document.body) {
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n && breakAll.length < 5; n = w.nextNode()) {
      const el = n.parentElement;
      const t = (n.textContent || '').trim();
      if (!el || seen.has(el) || !/[가-힣]{4,}/.test(t) || /^(SCRIPT|STYLE|NOSCRIPT)$/.test(el.tagName)) continue;
      seen.add(el);
      if (shown(el) && getComputedStyle(el).wordBreak !== 'keep-all') breakAll.push(t.slice(0, 40));
    }
  }
  return {
    title: document.title,
    text: text.slice(0, 20000),
    meta,
    overflowX: document.documentElement.scrollWidth - window.innerWidth,
    keepAll: body ? body.wordBreak === 'keep-all' : false,
    hasKorean,
    breakAll,
    frame: body
      ? { font: body.fontFamily.split(',')[0].replace(/["']/g, '').trim(), bg: body.backgroundColor, maxWidth: main ? getComputedStyle(main).maxWidth : '' }
      : null,
  };
}

/** Functions sent to the page with page.evaluate: each is serialized alone, so it must not call module code. */
export const PAGE_FUNCTIONS = { readMarks, readPage };

/** Polls until every marker is on screen or the wait runs out; returns the last reading. */
async function waitMarks(page, markers, ms) {
  const until = Date.now() + ms;
  let marks = {};
  for (;;) {
    marks = await page.evaluate(readMarks, markers);
    if (Object.values(marks).every(Boolean) || Date.now() > until) return marks;
    await page.waitForTimeout(1000);
  }
}

/** Opens one route at one size and reads it. `token` signs the console in (operator key in localStorage). */
async function openOnce(browser, base, out, p, vp, { token = null, markers = p.expect, tag = vp.name, hold = {} } = {}) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.mobile, hasTouch: vp.mobile, deviceScaleFactor: 1 });
  hold.ctx = ctx;
  if (token) await ctx.addInitScript(([k, v]) => { try { localStorage.setItem(k, v); } catch {} }, [OPERATOR_KEY_STORAGE, token]);
  const page = await ctx.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const httpErrors = [];
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text().slice(0, 200)));
  page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 200)));
  page.on('response', (r) => r.status() >= 400 && r.url().startsWith(base) && httpErrors.push(`${r.status()} ${r.url().slice(base.length, base.length + 120)}`));
  const r = { route: p.route, size: tag, who: p.who.map((w) => w.id), auth: p.auth, signedIn: Boolean(token) };
  try {
    const res = await page.goto(base + p.route, { waitUntil: 'load', timeout: 45000 });
    r.status = res ? res.status() : 0;
    await page.waitForTimeout(p.route.startsWith('/world') ? 4000 : 1500);
    await waitMarks(page, markers, MARK_WAIT_MS);
    r.landed = page.url().slice(base.length);
    // two evaluations: each function is sent to the page on its own, so readPage cannot call readMarks there
    Object.assign(r, await page.evaluate(readPage));
    r.marks = await page.evaluate(readMarks, markers);
    const shot = `${p.route.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'root'}-${tag}.png`;
    await page.screenshot({ path: path.join(out, shot) });
    r.shot = shot;
  } catch (e) {
    r.status = r.status ?? 0;
    r.error = String(e.message ?? e).slice(0, 200);
  }
  r.consoleErrors = consoleErrors.slice(0, 8);
  r.pageErrors = pageErrors.slice(0, 8);
  r.httpErrors = httpErrors.slice(0, 8);
  r.banned = [...new Set([...bannedIn(r.text ?? '', { prose: true }), ...bannedIn(`${r.title ?? ''}\n${r.meta ?? ''}`, { prose: true })])];
  r.internalIds = [...new Set((r.text ?? '').match(INTERNAL_ID_RE) ?? [])].slice(0, 10);
  delete r.text;
  delete r.meta;
  await ctx.close().catch(() => {});
  return r;
}

/** Waits for `promise` at most `ms`; true when it settled in time (a rejection counts as settled). */
async function settles(promise, ms) {
  let timer;
  const t = new Promise((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
  });
  const done = Promise.resolve(promise).then(() => true, () => true);
  const r = await Promise.race([done, t]);
  clearTimeout(timer);
  return r;
}

/**
 * openOnce under ROUTE_LIMIT_MS (see there). `run` is the opener (openOnce in the audit, a fake in tests); it gets a
 * `hold` object to put its context in, so a run past the limit can be cut by closing that context.
 * Past the limit the close and the opener's own end each get `graceMs`, never more: a starved renderer may not answer
 * the close either. When the opener has not ended by then (the close hung, or it was still in newContext and there was no
 * context to close) the result says `browserBroken`: the audit then drops that browser and starts a new one, so the
 * stuck opener cannot run on beside the next route or write over its screenshot later.
 */
export async function withRouteLimit(run, { route, tag, limitMs = ROUTE_LIMIT_MS, graceMs = 5000, log = () => {} }) {
  const hold = {};
  const t0 = Date.now();
  let timer;
  const late = new Promise((resolve) => {
    timer = setTimeout(() => resolve('timeout'), limitMs);
  });
  const work = run(hold).catch((e) => ({ route, size: tag, status: 0, error: String(e?.message ?? e).slice(0, 200) }));
  const first = await Promise.race([work, late]);
  clearTimeout(timer);
  if (first !== 'timeout') {
    log(`${route} ${tag} ${Date.now() - t0}ms${first?.error ? ` error ${String(first.error).slice(0, 120)}` : ''}`);
    return first;
  }
  const closed = hold.ctx ? await settles(hold.ctx.close(), graceMs) : false;
  const ended = await settles(work, graceMs);
  const browserBroken = !closed || !ended;
  log(`${route} ${tag} timeout after ${limitMs}ms${browserBroken ? ' - browser dropped' : ''}`);
  return { route, size: tag, status: 0, error: `route_timeout ${limitMs}ms`, timedOut: true, browserBroken, consoleErrors: [], pageErrors: [], httpErrors: [], banned: [], internalIds: [] };
}

/**
 * The browser the routes share. A browser that died (out of memory on a busy machine: 11-16 every route after the third
 * failed in 0.1 s), or one a timed-out route left `browserBroken`, is closed (at most `graceMs`) and started again before
 * the next route. A start that fails is that route's error, not the end of the night: the next route tries again.
 */
export function browserPool({ launch, graceMs = 5000, log = () => {} }) {
  let browser = null;
  let broken = false;
  return {
    async get() {
      if (browser && !broken && browser.isConnected()) return browser;
      if (browser) {
        log(broken ? 'browser left stuck by a timed-out route - starting a new one' : 'browser gone - starting it again');
        await settles(browser.close(), graceMs);
      }
      browser = null;
      broken = false;
      browser = await launch();
      return browser;
    },
    drop() {
      broken = true;
    },
    async close() {
      if (browser) await settles(browser.close(), graceMs);
    }
  };
}

const missed = (r, markers) => Boolean(r.error) || !(r.status > 0 && r.status < 400) || markers.some((m) => r.marks && r.marks[m] === false);

/**
 * Opens every planned screen (pure but for `open`, tested with a fake). A done screen that missed gets one second look
 * (slow first paint, a cold Worker) - not after a route_timeout: that route already had its full limit, and looking again
 * doubles a starved night. Past `limitMs` (from the start) the rest is recorded as `skipped`, never opened.
 */
export async function runPlan({ plan, viewports, open, token = null, limitMs = AUDIT_LIMIT_MS, log = () => {}, now = Date.now }) {
  const end = now() + limitMs;
  const results = [];
  let skipped = 0;
  const skip = (p, size, signedIn) => {
    skipped++;
    results.push({ route: p.route, size, status: 0, skipped: 'audit_deadline', signedIn });
  };
  const second = (r, markers) => missed(r, markers) && !r.timedOut && now() < end;
  for (const p of plan) {
    const doneHere = p.who.some((w) => w.status === 'done');
    for (const vp of viewports) {
      if (now() >= end) {
        skip(p, vp.name, false);
        continue;
      }
      let r = await open(p, vp);
      if (doneHere && second(r, p.expect)) r = { ...(await open(p, vp)), retried: true };
      results.push(r);
    }
    if (token && p.auth === 'operator' && p.authExpect.length) {
      if (now() >= end) {
        skip(p, 'key', true);
        continue;
      }
      const opts = { token, markers: p.authExpect, tag: 'key' };
      let r = await open(p, viewports[0], opts);
      if (second(r, p.authExpect)) r = { ...(await open(p, viewports[0], opts)), retried: true };
      results.push(r);
    }
  }
  if (skipped) log(`audit limit ${Math.round(limitMs / 60000)} min reached - ${skipped} screens not opened (reported as not checked)`);
  return results;
}

export async function audit({ base, out, chromium, token = process.env.LCW_OPERATOR_TOKEN || null, limitMs = AUDIT_LIMIT_MS }) {
  const coverage = loadCoverage();
  const plan = auditPlan(coverage);
  fs.mkdirSync(out, { recursive: true });
  let sha = null;
  try {
    sha = (await (await fetch(`${base}/version.json`)).json()).sha ?? null;
  } catch {
    // version.json missing — keep null
  }
  const launch = () =>
    chromium.launch({
      channel: 'chrome',
      headless: true,
      args: ['--mute-audio', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
    });
  // one progress line per route on stderr: the runner keeps it in its log, so a slow night shows where the time went
  const log = (line) => console.error(`[audit ${new Date().toISOString().slice(11, 19)}] ${line}`);
  const pool = browserPool({ launch, log });
  const open = async (p, vp, opts = {}) => {
    const tag = opts.tag ?? vp.name;
    let browser;
    try {
      browser = await pool.get();
    } catch (e) {
      log(`${p.route} ${tag} browser could not start: ${String(e?.message ?? e).slice(0, 120)}`);
      return { route: p.route, size: tag, status: 0, error: `browser_start ${String(e?.message ?? e).slice(0, 160)}`, signedIn: Boolean(opts.token) };
    }
    const r = await withRouteLimit((hold) => openOnce(browser, base, out, p, vp, { ...opts, hold }), { route: p.route, tag, log });
    if (r.browserBroken) pool.drop();
    return r;
  };
  let results = [];
  try {
    results = await runPlan({ plan, viewports: VIEWPORTS, open, token, limitMs, log });
  } finally {
    await pool.close();
  }
  return { ...summarize({ base, sha, plan, results, coverage }), limitMin: Math.round(limitMs / 60000) };
}

/** Joins screen results with the coverage list (pure, tested). */
export function summarize({ base, sha, plan, results, coverage, check = runCheck() }) {
  const ok = (r) => !r.error && r.status > 0 && r.status < 400 && !r.pageErrors?.length;
  const regressions = [];
  const unverified = [];
  const notChecked = [];
  for (const p of plan) {
    const mine = results.filter((r) => r.route === p.route);
    const anon = mine.filter((r) => !r.signedIn && !r.skipped);
    const keyed = mine.filter((r) => r.signedIn && !r.skipped);
    const notOpened = mine.filter((r) => r.skipped).map((r) => r.size);
    for (const w of p.who) {
      if (w.status !== 'done') continue;
      const want = (r) => (r.signedIn ? w.authExpect : w.expect);
      const bad = [...anon, ...(w.authExpect.length ? keyed : [])].filter((r) => !ok(r) || want(r).some((m) => r.marks && r.marks[m] === false));
      if (bad.length) {
        regressions.push({
          id: w.id,
          owner: w.owner,
          route: p.route,
          sizes: bad.map((r) => r.size),
          why: bad.map((r) => r.error || (r.status >= 400 ? `HTTP ${r.status}` : '') || (r.pageErrors?.[0] ?? '') || `표시 없음: ${want(r).filter((m) => r.marks?.[m] === false).join(', ')}`)
        });
      } else if (notOpened.length) notChecked.push({ id: w.id, owner: w.owner, route: p.route, sizes: notOpened });
      else if (p.auth && !(keyed.length && w.authExpect.length)) unverified.push({ id: w.id, owner: w.owner, route: p.route, auth: p.auth });
    }
  }
  const design = {
    overflow: results.filter((r) => r.overflowX > 1).map((r) => ({ route: r.route, size: r.size, px: r.overflowX })),
    banned: results.filter((r) => r.banned?.length).map((r) => ({ route: r.route, size: r.size, words: r.banned })),
    internalIds: results.filter((r) => r.internalIds?.length).map((r) => ({ route: r.route, size: r.size, ids: r.internalIds })),
    keepAll: results.filter((r) => r.hasKorean && (!r.keepAll || r.breakAll?.length)).map((r) => ({ route: r.route, size: r.size, body: r.keepAll, samples: r.breakAll })),
    frame: frameOutliers(results)
  };
  // /r/x is opened with a made-up report token on purpose (the "link not found" screen): its 404 is the expected answer.
  const expected = (r, m) => r.route === '/r/x' && /404/.test(m);
  for (const r of results) for (const k of ['consoleErrors', 'httpErrors']) if (r[k]) r[k] = r[k].filter((m) => !expected(r, m));
  const consoleErrors = results.filter((r) => r.consoleErrors?.length || r.pageErrors?.length || r.httpErrors?.length).map((r) => ({ route: r.route, size: r.size, console: r.consoleErrors, page: r.pageErrors, http: r.httpErrors }));
  return {
    at: new Date().toISOString(),
    base,
    sha,
    routes: plan.length,
    screens: results.filter((r) => !r.skipped).length,
    counts: check.counts,
    byKind: check.byKind,
    features: check.features,
    coverageErrors: check.errors,
    gaps: check.gaps,
    regressions,
    unverified,
    notChecked,
    skippedScreens: results.filter((r) => r.skipped).length,
    design,
    consoleErrors,
    results
  };
}

/** Internal screens whose font, background or width differ from the most common frame (a tie has no majority). */
export function frameOutliers(results) {
  const internal = results.filter((r) => r.frame && !r.signedIn && INTERNAL_ROUTES.some((x) => r.route === x || r.route.startsWith(`${x}?`)) && r.size === 'd');
  const sig = (f) => `${f.font}|${f.bg}|${f.maxWidth || 'none'}`;
  const tally = {};
  for (const r of internal) tally[sig(r.frame)] = (tally[sig(r.frame)] ?? 0) + 1;
  const ranked = Object.entries(tally).sort((a, b) => b[1] - a[1]);
  if (!ranked.length || (ranked[1] && ranked[1][1] === ranked[0][1])) return [];
  const common = ranked[0][0];
  return internal.filter((r) => sig(r.frame) !== common).map((r) => ({ route: r.route, frame: r.frame, common }));
}

export function summaryMarkdown(rep) {
  const lines = [];
  const c = rep.counts;
  lines.push(`# LCW 야간 실화면 감사 ${rep.at.slice(0, 10)}`);
  lines.push('');
  lines.push(`- 운영 ${rep.base} · 배포 ${rep.sha ?? '?'} · 경로 ${rep.routes}개 × 2크기 = 화면 ${rep.screens}개`);
  lines.push(`- 설계서 대조: done ${c.done} · partial ${c.partial} · missing ${c.missing}${c.deferred ? ` · deferred ${c.deferred}` : ''}`);
  lines.push(`- 회귀(done 인데 운영에서 안 열림): ${rep.regressions.length} · 열쇠 화면만 확인: ${rep.unverified.length}`);
  if (rep.skippedScreens) lines.push(`- 감사 시간 ${rep.limitMin ?? Math.round(AUDIT_LIMIT_MS / 60000)}분이 넘어 열지 못한 화면 ${rep.skippedScreens}개 — 이번에는 확인 안 됨(done ${rep.notChecked.length}개): ${rep.notChecked.slice(0, 8).map((x) => x.id).join(', ')}${rep.notChecked.length > 8 ? ' …' : ''}`);
  lines.push(`- 디자인: 넘침 ${rep.design.overflow.length} · 금지어 ${rep.design.banned.length} · 내부 번호 노출 ${rep.design.internalIds.length} · keep-all 빠짐 ${rep.design.keepAll.length} · 공통 틀 벗어남 ${rep.design.frame.length}`);
  if (rep.play) lines.push(`- 아이 실플레이(운영, smoke 학생): 회귀 ${rep.regressions.filter((r) => r.id.startsWith('play:')).length}${rep.play.notRun?.length ? ` · 확인 안 됨 ${rep.play.notRun.map((x) => `${x.view}(${x.why})`).join(', ')}` : ''}${rep.play.skipped ? ` · ${rep.play.skipped}` : ''}`);
  if (rep.coverageErrors.length) lines.push(`- 목록 오류 ${rep.coverageErrors.length}: ${rep.coverageErrors.slice(0, 3).join(' / ')}`);
  if (rep.regressions.length) {
    lines.push('', '## 회귀');
    for (const r of rep.regressions) lines.push(`- [${r.owner}] ${r.id} ${r.route} (${r.sizes.join('·')}): ${r.why.join(' / ')}`);
  }
  if (rep.play?.lines?.length) {
    lines.push('', '## 아이 실플레이 (tools/real-play.mjs)');
    for (const l of rep.play.lines) lines.push(l);
  }
  lines.push('', '## 빈틈(소유 도메인별)');
  for (const [owner, list] of Object.entries(rep.gaps)) {
    const miss = list.filter((g) => g.status === 'missing').length;
    lines.push(`- **${owner}** ${list.length}개 (없음 ${miss}, 일부 ${list.length - miss}): ${list.slice(0, 8).map((g) => g.id).join(', ')}${list.length > 8 ? ' …' : ''}`);
  }
  const d = rep.design;
  if (d.overflow.length || d.banned.length || d.internalIds.length || d.keepAll.length || d.frame.length) {
    lines.push('', '## 디자인 일관성');
    for (const o of d.overflow) lines.push(`- 가로 넘침 ${o.route} (${o.size}) ${o.px}px`);
    for (const o of d.banned) lines.push(`- 금지어 ${o.route} (${o.size}): ${o.words.join(', ')}`);
    for (const o of d.internalIds) lines.push(`- 내부 번호 노출 ${o.route} (${o.size}): ${o.ids.join(', ')}`);
    for (const o of d.keepAll) lines.push(`- keep-all 빠짐 ${o.route} (${o.size})${o.samples?.length ? `: "${o.samples[0]}"` : ''}`);
    for (const o of d.frame) lines.push(`- 공통 틀 벗어남 ${o.route}: ${o.frame.font} / ${o.frame.bg} / 폭 ${o.frame.maxWidth || 'none'} (다수: ${o.common})`);
  }
  if (rep.consoleErrors.length) {
    lines.push('', '## 콘솔·요청 오류');
    for (const e of rep.consoleErrors.slice(0, 15)) lines.push(`- ${e.route} (${e.size}): ${[...e.page, ...e.console, ...e.http].slice(0, 2).join(' / ')}`);
  }
  return `${lines.join('\n')}\n`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const base = arg('--base', 'https://lcw.worldwidesomething.com').replace(/\/+$/, '');
  const out = path.resolve(arg('--out', path.join(ROOT, 'shots', 'nightly', new Date().toISOString().slice(0, 10))));
  try {
    const pw = process.env.PLAYWRIGHT_CORE ? await import(pathToFileURL(process.env.PLAYWRIGHT_CORE).href) : await import('playwright-core');
    const chromium = pw.chromium ?? pw.default.chromium;
    const limitMin = Number(arg('--limit-min', String(AUDIT_LIMIT_MS / 60000)));
    const limitMs = (Number.isFinite(limitMin) && limitMin > 0 ? limitMin : AUDIT_LIMIT_MS / 60000) * 60000;
    fs.mkdirSync(out, { recursive: true });
    // the child's play first (it needs the operator key to make smoke students and start a lesson), then the screens
    // with what is left of the night (never under 5 min)
    let play = null;
    let playSkipped = null;
    const t0 = Date.now();
    if (arg('--play', 'on') === 'off') playSkipped = '실플레이 끔(--play off)';
    else if (!process.env.LCW_OPERATOR_TOKEN) playSkipped = '운영자 열쇠 없음 - 실플레이 안 함';
    else if (!playBudget(limitMs)) playSkipped = `밤 시간 ${Math.round(limitMs / 60000)}분 - 실플레이 건너뜀(15분 미만)`;
    else play = await runPlay({ base, out, limitMs: playBudget(limitMs), log: (m) => console.log(m) });
    const left = Math.max(5 * 60000, limitMs - (Date.now() - t0));
    let rep = await audit({ base, out, chromium, limitMs: left });
    if (play) rep = mergePlay(rep, play.reports, { seconds: play.seconds }, play.runs);
    else rep = { ...rep, play: { lines: [], skipped: playSkipped } };
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(rep, null, 2));
    fs.writeFileSync(path.join(out, 'summary.md'), summaryMarkdown(rep));
    console.log(summaryMarkdown(rep));
    console.log(`report: ${path.join(out, 'report.json')}`);
  } catch (e) {
    console.error(`nightly audit could not run: ${e?.stack ?? e}`);
    process.exit(1);
  }
}
