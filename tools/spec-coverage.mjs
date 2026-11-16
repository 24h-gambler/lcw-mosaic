// Spec coverage check (docs/README.md "설계서 대조"): docs/spec-coverage.json against what the docs promise.
//   node tools/spec-coverage.mjs           → errors (exit 1) and the gap list by owner
//   node tools/spec-coverage.mjs --json    → the same as JSON (tools/nightly-audit.mjs reads it)
// Run inside `pnpm test` by tools/__tests__/spec-coverage.test.ts.
//
// What fails (operator instruction 2026-11-16, R2553: screens in the spec were reported "done" without existing):
//   1. an id the docs promise (tools/spec-ids.mjs) that the coverage list does not carry
//   2. `done` (or a site feature `live`) without a test that exists, or without a real-screen check (`e2e`)
//   3. narrowing the scope without an operator decision: an id or feature dropped from the list, or set to
//      `deferred`/`retired` (or a feature lowered to `planned`), with no `decision` (d_… decision card or R… ledger line)
//   3b. postponing is narrowing too (operator 2026-11-16: "왜 수업뒤에 넣어요?"): any timing field on an id or feature
//      (deferred_until, later, after, after_lesson, not_before, eta, target_date, phase, …) needs the same decision id
//   3c. a field the list does not define (a new way to postpone, a "deadline", "target"…): only ID_FIELDS/FEATURE_FIELDS
//   3d. a `note` that postpones or narrows in words ("17:00 뒤", "다음 PR") without a decision (tools/pr-lint.mjs rules)
//   3e. a title that no longer matches the spec: the spec moved (a line was added above a position-numbered id) or
//       changed, so the status has to be judged again
//   4. a reference to a doc that does not exist (`06` while docs/ has no 06-*.md) that is not on the known list
// `missing` and `partial` are honest states, not failures: they show up as the gap list per owner.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintPrText } from './pr-lint.mjs';
import { brokenRefs, specIds } from './spec-ids.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const COVERAGE_FILE = 'docs/spec-coverage.json';
export const STATUSES = ['done', 'partial', 'missing', 'deferred', 'retired'];
export const FEATURE_STATUSES = ['live', 'building', 'planned'];
export const OWNERS = ['world', 'talk', 'lesson', 'parent', 'outsider', 'ops'];
export const DECISION = /^(d_[0-9a-f]{6,}|R\d{3,})$/;
const NARROWED = new Set(['deferred', 'retired']);
/** Fields that move work to a later time. Any of them, on an id or a feature, needs `decision` (postponing = narrowing). */
export const TIMING_FIELDS = ['deferred_until', 'defer_until', 'later', 'after', 'after_lesson', 'not_before', 'eta', 'target_date', 'phase', 'milestone', 'until', 'when'];
const timingOf = (e) => TIMING_FIELDS.filter((k) => e[k] !== undefined && e[k] !== null && e[k] !== '');
/** The only fields an entry may carry; anything else fails (a new way to postpone cannot slip in under another name). */
export const ID_FIELDS = ['kind', 'title', 'status', 'owner', 'route', 'e2e', 'tests', 'evidence', 'note', 'decision'];
export const FEATURE_FIELDS = ['id', 'status', 'owner', 'route', 'e2e', 'tests', 'evidence', 'note', 'decision'];
export const E2E_FIELDS = ['route', 'expect', 'auth', 'authExpect'];

/** "path/to/file.test.ts::exact it() name" → { file, name } */
export function parseTestRef(ref) {
  const i = ref.indexOf('::');
  return i < 0 ? { file: ref, name: '' } : { file: ref.slice(0, i), name: ref.slice(i + 2) };
}

function defaultReadFile(rel) {
  const abs = path.join(ROOT, rel);
  return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
}

/** Titles of the it()/test() calls in a test file (first argument, quotes unescaped; comments ignored). */
export function testTitles(src) {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const out = new Set();
  const re = /\b(?:it|test)(?:\.(?:only|skip|todo|concurrent|fails))?\s*\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
  for (const m of code.matchAll(re)) out.add(m[2].replace(/\\(.)/g, '$1'));
  return out;
}

/**
 * A test reference is real when it names a test file (`*.test.ts(x)`) and one of its it()/test() titles exactly, or a
 * real-screen tool under tools/ (a script that drives a browser or the live site: playwright or fetch against a base).
 */
export function testExists(ref, readFile = defaultReadFile) {
  const { file, name } = parseTestRef(ref);
  const src = readFile(file);
  if (src === null) return false;
  if (!name) return /^tools\/[\w-]+\.mjs$/.test(file) && /playwright|chromium|smoke-live|fetch\(\s*(?:base|new URL)/.test(src);
  if (!/\.test\.tsx?$/.test(file)) return false;
  return testTitles(src).has(name);
}

function e2eOk(e2e) {
  return Boolean(e2e && typeof e2e.route === 'string' && e2e.route.startsWith('/') && Array.isArray(e2e.expect) && e2e.expect.length > 0);
}

/**
 * Pure check. `docs` = spec-ids list, `coverage` = parsed docs/spec-coverage.json, `base` = the same file at the merge
 * base with main (null when there is none), `broken` = brokenRefs(). Returns { errors, gaps, counts }.
 */
export function checkCoverage({ docs, coverage, base, broken, readFile = defaultReadFile }) {
  const errors = [];
  const ids = coverage?.ids ?? {};
  const docIds = new Map(docs.map((d) => [d.id, d]));

  for (const d of docs) if (!ids[d.id]) errors.push(`[목록 누락] ${d.id} (${d.sources?.[0] ?? ''}) "${(d.title ?? '').slice(0, 60)}" 이 docs/spec-coverage.json 에 없습니다`);

  for (const [id, e] of Object.entries(ids)) {
    if (!STATUSES.includes(e.status)) errors.push(`[상태] ${id}: status "${e.status}" 는 ${STATUSES.join('|')} 중 하나여야 합니다`);
    if (!OWNERS.includes(e.owner)) errors.push(`[소유] ${id}: owner "${e.owner}" 는 ${OWNERS.join('|')} 중 하나여야 합니다`);
    if (!docIds.has(id) && e.status !== 'retired') errors.push(`[설계서에 없음] ${id}: 설계서에서 사라진 id 는 status "retired" 와 decision 으로만 남깁니다`);
    if (NARROWED.has(e.status) && !DECISION.test(e.decision ?? '')) errors.push(`[범위 축소] ${id}: "${e.status}" 는 운영자 결정 id(d_… 또는 R…)가 decision 에 있어야 합니다`);
    for (const k of timingOf(e)) if (!DECISION.test(e.decision ?? '')) errors.push(`[시점 미루기] ${id}: ${k}="${e[k]}" — 시점 미루기도 범위 축소입니다. 운영자 결정 id(d_… 또는 R…)가 decision 에 있어야 합니다`);
    for (const k of Object.keys(e)) if (!ID_FIELDS.includes(k) && !TIMING_FIELDS.includes(k)) errors.push(`[모르는 필드] ${id}: "${k}" — 쓸 수 있는 필드는 ${ID_FIELDS.join(', ')}`);
    for (const k of Object.keys(e.e2e ?? {})) if (!E2E_FIELDS.includes(k)) errors.push(`[모르는 필드] ${id}: e2e.${k}`);
    if (e.note && !DECISION.test(e.decision ?? '')) for (const h of lintPrText(e.note)) errors.push(`[시점 미루기] ${id}: note 의 "${h.phrase}" — 미루거나 줄이는 말은 운영자 결정 id 가 decision 에 있어야 합니다`);
    const spec = docIds.get(id);
    if (spec && e.title !== undefined && e.title !== (spec.title ?? '').slice(0, 140)) errors.push(`[설계서 바뀜] ${id}: 목록의 title 이 설계서와 다릅니다 — 설계서 "${(spec.title ?? '').slice(0, 60)}" / 목록 "${String(e.title).slice(0, 60)}". 상태를 다시 판정하고 title 을 맞추세요`);
    if (e.status === 'done') {
      const tests = e.tests ?? [];
      if (!tests.length) errors.push(`[거짓 done] ${id}: done 인데 tests 가 비었습니다`);
      for (const t of tests) if (!testExists(t, readFile)) errors.push(`[거짓 done] ${id}: 시험 "${t}" 를 찾을 수 없습니다(파일 또는 이름)`);
      if (!e2eOk(e.e2e)) errors.push(`[거짓 done] ${id}: done 인데 실화면 확인(e2e.route + e2e.expect)이 없습니다 — tools/nightly-audit.mjs 가 운영에서 여는 주소`);
    }
    if (e.status === 'partial' && !(e.evidence ?? []).length) errors.push(`[근거] ${id}: partial 은 있는 부분의 근거(파일:줄)가 있어야 합니다`);
    if ((e.status === 'partial' || e.status === 'missing') && !e.note) errors.push(`[빈틈 설명] ${id}: ${e.status} 는 무엇이 빠졌는지 note 가 있어야 합니다`);
  }

  const feats = coverage?.features ?? [];
  const seen = new Set();
  for (const f of feats) {
    if (seen.has(f.id)) errors.push(`[기능 중복] ${f.id}`);
    seen.add(f.id);
    if (!FEATURE_STATUSES.includes(f.status)) errors.push(`[기능 상태] ${f.id}: "${f.status}" 는 ${FEATURE_STATUSES.join('|')} 중 하나`);
    if (!OWNERS.includes(f.owner)) errors.push(`[기능 소유] ${f.id}: owner "${f.owner}"`);
    if (!f.evidence) errors.push(`[기능 근거] ${f.id}: evidence 가 없습니다`);
    for (const k of timingOf(f)) if (!DECISION.test(f.decision ?? '')) errors.push(`[시점 미루기] 기능 ${f.id}: ${k}="${f[k]}" — 운영자 결정 id 가 decision 에 있어야 합니다`);
    for (const k of Object.keys(f)) if (!FEATURE_FIELDS.includes(k) && !TIMING_FIELDS.includes(k)) errors.push(`[모르는 필드] 기능 ${f.id}: "${k}"`);
    if (f.note && !DECISION.test(f.decision ?? '')) for (const h of lintPrText(f.note)) errors.push(`[시점 미루기] 기능 ${f.id}: note 의 "${h.phrase}"`);
    if (f.status === 'live') {
      if (!(f.tests ?? []).length) errors.push(`[거짓 live] ${f.id}: live 인데 tests 가 비었습니다`);
      for (const t of f.tests ?? []) if (!testExists(t, readFile)) errors.push(`[거짓 live] ${f.id}: 시험 "${t}" 를 찾을 수 없습니다`);
      if (!e2eOk(f.e2e)) errors.push(`[거짓 live] ${f.id}: live 인데 실화면 확인(e2e.route + e2e.expect)이 없습니다`);
    }
  }

  if (base) {
    for (const [id, old] of Object.entries(base.ids ?? {})) {
      const now = ids[id];
      if (!now) errors.push(`[범위 축소] ${id}: 목록에서 지웠습니다(이전 상태 ${old.status}). 지우지 말고 status "retired"/"deferred" + decision 으로 남기세요`);
    }
    const nowFeat = new Map(feats.map((f) => [f.id, f]));
    const rank = { planned: 0, building: 1, live: 2 };
    for (const old of base.features ?? []) {
      const now = nowFeat.get(old.id);
      if (!now) errors.push(`[범위 축소] 기능 ${old.id}: 목록에서 지웠습니다. decision 과 함께 planned 로 두세요`);
      else if (now.status === 'planned' && rank[old.status] > 0 && !DECISION.test(now.decision ?? '')) errors.push(`[범위 축소] 기능 ${old.id}: ${old.status} → planned 는 decision 이 있어야 합니다`);
    }
  }

  const known = coverage?.broken_refs ?? [];
  const key = (b) => `${b.doc}#${b.ref}`;
  const knownKeys = new Set(known.map(key));
  const nowKeys = new Set(broken.map(key));
  for (const b of broken) if (!knownKeys.has(key(b))) errors.push(`[끊긴 참조] ${b.doc}:${b.line} 이 없는 문서 \`${b.ref}\` 를 가리킵니다: ${b.text}`);
  for (const k of known) {
    if (!nowKeys.has(key(k))) errors.push(`[끊긴 참조 목록 정리] ${key(k)} 는 더 이상 끊기지 않았습니다 — broken_refs 에서 빼세요`);
    if (!OWNERS.includes(k.owner) || !k.note) errors.push(`[끊긴 참조] ${key(k)}: owner 와 note(무엇을 할지)가 있어야 합니다`);
  }

  const counts = { done: 0, partial: 0, missing: 0, deferred: 0, retired: 0 };
  const byKind = {};
  const gaps = {};
  for (const [id, e] of Object.entries(ids)) {
    counts[e.status] = (counts[e.status] ?? 0) + 1;
    const kind = docIds.get(id)?.kind ?? e.kind ?? '?';
    byKind[kind] ??= { done: 0, partial: 0, missing: 0, deferred: 0, retired: 0 };
    byKind[kind][e.status] = (byKind[kind][e.status] ?? 0) + 1;
    if (e.status === 'partial' || e.status === 'missing') (gaps[e.owner] ??= []).push({ id, status: e.status, title: docIds.get(id)?.title ?? e.title ?? '', note: e.note ?? '' });
  }
  return { errors, gaps, counts, byKind, features: feats.reduce((a, f) => ((a[f.status] = (a[f.status] ?? 0) + 1), a), {}) };
}

/**
 * docs/spec-coverage.json as it was where this branch left main. { base: null } only when main did not have the file
 * yet (the first version); a git failure (no origin/main, shallow clone, bad LCW_COVERAGE_BASE) is an error, never a
 * silent pass: without the base the removal check cannot run.
 */
export function baseCoverage() {
  const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  let ref;
  try {
    ref = process.env.LCW_COVERAGE_BASE || git('merge-base', 'HEAD', 'origin/main');
    git('rev-parse', '--verify', `${ref}^{commit}`);
  } catch (e) {
    return { base: null, error: `[대조 기준 없음] main 과 갈라진 지점을 찾지 못했습니다(${String(e.message ?? e).split('\n')[0].slice(0, 120)}). git fetch origin 뒤 다시 돌리세요 — 기준 없이 통과시키지 않습니다` };
  }
  try {
    git('cat-file', '-e', `${ref}:${COVERAGE_FILE}`);
  } catch {
    return { base: null }; // main had no list yet
  }
  try {
    return { base: JSON.parse(git('show', `${ref}:${COVERAGE_FILE}`)) };
  } catch (e) {
    return { base: null, error: `[대조 기준 없음] ${ref}:${COVERAGE_FILE} 를 읽지 못했습니다(${String(e.message ?? e).slice(0, 120)})` };
  }
}

export function loadCoverage() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, COVERAGE_FILE), 'utf8'));
}

export function runCheck() {
  const b = baseCoverage();
  const r = checkCoverage({ docs: specIds(), coverage: loadCoverage(), base: b.base, broken: brokenRefs() });
  if (b.error) r.errors.unshift(b.error);
  return r;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = runCheck();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(r, null, 2));
  } else {
    console.log(`상태: ${JSON.stringify(r.counts)} · 종류별 ${JSON.stringify(r.byKind)} · 사이트 기능 ${JSON.stringify(r.features)}`);
    for (const [owner, list] of Object.entries(r.gaps)) {
      console.log(`\n[${owner}] 빈틈 ${list.length}`);
      for (const g of list) console.log(`  ${g.status === 'missing' ? '✗' : '◐'} ${g.id} ${g.title.slice(0, 50)} — ${g.note}`);
    }
    if (r.errors.length) console.log(`\n오류 ${r.errors.length}:\n${r.errors.map((e) => `  ${e}`).join('\n')}`);
  }
  process.exit(r.errors.length ? 1 : 0);
}
