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
  const textShown = (t) => {
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) if ((n.textContent || '').includes(t) && shown(n.parentElement)) return true;
    // a phrase split over inline elements: fall back to the visible text of the page
    return document.body.innerText.includes(t) && [...document.querySelectorAll('body *')].some((e) => (e.innerText || '').includes(t) && e.childElementCount > 0 && shown(e));
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
function readPage(markers) {
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
    marks: readMarks(markers)
  };
}

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
async function openOnce(browser, base, out, p, vp, { token = null, markers = p.expect, tag = vp.name } = {}) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.mobile, hasTouch: vp.mobile, deviceScaleFactor: 1 });
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
    Object.assign(r, await page.evaluate(readPage, markers));
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
  await ctx.close();
  return r;
}

const missed = (r, markers) => Boolean(r.error) || !(r.status > 0 && r.status < 400) || markers.some((m) => r.marks && r.marks[m] === false);

export async function audit({ base, out, chromium, token = process.env.LCW_OPERATOR_TOKEN || null }) {
  const coverage = loadCoverage();
  const plan = auditPlan(coverage);
  fs.mkdirSync(out, { recursive: true });
  let sha = null;
  try {
    sha = (await (await fetch(`${base}/version.json`)).json()).sha ?? null;
  } catch {
    // version.json missing — keep null
  }
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--mute-audio', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
  });
  const results = [];
  try {
    for (const p of plan) {
      const doneHere = p.who.some((w) => w.status === 'done');
      for (const vp of VIEWPORTS) {
        let r = await openOnce(browser, base, out, p, vp);
        // a done screen gets a second look before it is called a regression (slow first paint, a cold Worker)
        if (doneHere && missed(r, p.expect)) {
          const again = await openOnce(browser, base, out, p, vp);
          again.retried = true;
          r = again;
        }
        results.push(r);
      }
      if (token && p.auth === 'operator' && p.authExpect.length) {
        let r = await openOnce(browser, base, out, p, VIEWPORTS[0], { token, markers: p.authExpect, tag: 'key' });
        if (missed(r, p.authExpect)) r = { ...(await openOnce(browser, base, out, p, VIEWPORTS[0], { token, markers: p.authExpect, tag: 'key' })), retried: true };
        results.push(r);
      }
    }
  } finally {
    await browser.close();
  }
  return summarize({ base, sha, plan, results, coverage });
}

/** Joins screen results with the coverage list (pure, tested). */
export function summarize({ base, sha, plan, results, coverage, check = runCheck() }) {
  const ok = (r) => !r.error && r.status > 0 && r.status < 400 && !r.pageErrors?.length;
  const regressions = [];
  const unverified = [];
  for (const p of plan) {
    const anon = results.filter((r) => r.route === p.route && !r.signedIn);
    const keyed = results.filter((r) => r.route === p.route && r.signedIn);
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
      } else if (p.auth && !(keyed.length && w.authExpect.length)) unverified.push({ id: w.id, owner: w.owner, route: p.route, auth: p.auth });
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
    screens: results.length,
    counts: check.counts,
    byKind: check.byKind,
    features: check.features,
    coverageErrors: check.errors,
    gaps: check.gaps,
    regressions,
    unverified,
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
  lines.push(`- 디자인: 넘침 ${rep.design.overflow.length} · 금지어 ${rep.design.banned.length} · 내부 번호 노출 ${rep.design.internalIds.length} · keep-all 빠짐 ${rep.design.keepAll.length} · 공통 틀 벗어남 ${rep.design.frame.length}`);
  if (rep.coverageErrors.length) lines.push(`- 목록 오류 ${rep.coverageErrors.length}: ${rep.coverageErrors.slice(0, 3).join(' / ')}`);
  if (rep.regressions.length) {
    lines.push('', '## 회귀');
    for (const r of rep.regressions) lines.push(`- [${r.owner}] ${r.id} ${r.route} (${r.sizes.join('·')}): ${r.why.join(' / ')}`);
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
    const rep = await audit({ base, out, chromium });
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(rep, null, 2));
    fs.writeFileSync(path.join(out, 'summary.md'), summaryMarkdown(rep));
    console.log(summaryMarkdown(rep));
    console.log(`report: ${path.join(out, 'report.json')}`);
  } catch (e) {
    console.error(`nightly audit could not run: ${e?.stack ?? e}`);
    process.exit(1);
  }
}
