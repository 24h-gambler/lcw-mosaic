// Spec coverage (docs/README.md "설계서 대조", R2553): every promised screen, flow step and core promise is on the
// list with an honest status; "done" needs a test and a real-screen check; narrowing the scope needs an operator decision.
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs tools without types
import { checkCoverage, parseTestRef, runCheck, specWordsLost, testExists } from '../spec-coverage.mjs';
// @ts-expect-error plain .mjs tools without types
import { brokenRefs, specIds } from '../spec-ids.mjs';
// @ts-expect-error plain .mjs tools without types
import { auditPlan, browserPool, frameOutliers, PAGE_FUNCTIONS, runPlan, summarize, withRouteLimit } from '../nightly-audit.mjs';
import { readFileSync } from 'node:fs';
import { FEATURE_IDS } from '../../apps/web/src/site/featureStatus';
import coverageFile from '../../docs/spec-coverage.json';

type Check = { errors: string[]; gaps: Record<string, { id: string; status: string }[]>; counts: Record<string, number> };
type Doc = { id: string; kind: string; title: string; sources: string[] };

const doc = (id: string, kind = 'screen'): Doc => ({ id, kind, title: id, sources: ['docs/x.md:1'] });
const files: Record<string, string> = {
  'a.test.ts': [
    "// it('a commented-out test', () => {})",
    "it('opens the map', () => {})",
    "const s = 'opens the arena';",
    "it.skip('a skipped test', () => {})",
    "it.todo('a test to write')",
    "it.fails('a failing test', () => {})",
    "foo(); // it('after code on the line', () => {})",
    "const t = \"it('inside a string', () => {})\";"
  ].join('\n'),
  'b.test.ts': ["describe.skip('all of it', () => {", "  it('looks real', () => {})", '});'].join('\n'),
  'tools/smoke-live.mjs': "const res = await fetch(new URL('/', base));",
  'tools/e2e.mjs': "// drives playwright\nconst pw = await import('playwright-core');",
  'tools/helper.mjs': 'export const x = 1;',
  'docs/08.md': '| G07 | 월드 고르기 |'
};
const read = (f: string) => files[f] ?? null;
const done = { status: 'done', owner: 'world', title: 'G06', tests: ['a.test.ts::opens the map'], e2e: { route: '/world/', expect: ['canvas'] }, evidence: ['x:1'] };
const run = (over: Partial<Parameters<typeof checkCoverage>[0]>) =>
  checkCoverage({ docs: [doc('G06')], coverage: { ids: { G06: done }, features: [], broken_refs: [] }, base: null, broken: [], readFile: read, ...over }) as Check;

describe('the repository coverage list (docs/spec-coverage.json)', () => {
  it('carries every id the docs promise and breaks no rule', () => {
    const r = runCheck() as Check;
    expect(r.errors).toEqual([]);
  });

  it('fails, never passes silently, when the main it compares against cannot be found', () => {
    const was = process.env.LCW_COVERAGE_BASE;
    process.env.LCW_COVERAGE_BASE = 'no-such-ref-for-the-test';
    try {
      expect((runCheck() as Check).errors[0]).toContain('[대조 기준 없음]');
    } finally {
      if (was === undefined) delete process.env.LCW_COVERAGE_BASE;
      else process.env.LCW_COVERAGE_BASE = was;
    }
  });

  it('reads the screen list of docs/08 §8.6 and the site map of docs/14 §2 completely', () => {
    const ids = (specIds() as Doc[]).filter((d) => d.kind === 'screen').map((d) => d.id);
    for (let n = 1; n <= 15; n++) expect(ids).toContain(`G${String(n).padStart(2, '0')}`);
    for (const id of ['T01', 'T02', 'T03', 'T04', 'P01', 'P07', 'W01', 'W09']) expect(ids).toContain(id);
    // docs/22 adds the adventure screens A01–A06 (their own ID | 화면 table)
    for (let n = 1; n <= 6; n++) expect(ids).toContain(`A0${n}`);
    expect(ids).toHaveLength(41);
  });

  it('extracts the docs/10 flows and the docs/01–02 promises (the login row included)', () => {
    const all = specIds() as Doc[];
    expect(all.filter((d) => d.kind === 'flow').length).toBeGreaterThan(100);
    expect(all.map((d) => d.id)).toContain('C02.2.로그인');
    expect(all.map((d) => d.id)).toContain('C01.6.탐험가');
  });

  it('extracts the empty/error states, the docs/10 §1 role edges and the docs/11 work packages', () => {
    const all = specIds() as Doc[];
    const ids = all.map((d) => d.id);
    expect(all.filter((d) => d.kind === 'state').length).toBe(17);
    expect(ids).toContain('A06.state');
    for (const id of ['G07.state', 'P04.state', 'F10.1.S-F', 'F10.1.F-W', 'WP-001', 'WP-503', 'WP-706']) expect(ids).toContain(id);
    expect(all.filter((d) => d.kind === 'wp').length).toBe(72);
  });

  it('lists exactly the features the site reads (apps/web/src/site/featureStatus.ts FEATURE_IDS)', () => {
    const listed = (coverageFile as { features: { id: string }[] }).features.map((f) => f.id).sort();
    expect(listed).toEqual([...FEATURE_IDS].sort());
  });

  it('reports the missing docs/06 as a known broken reference, owned by a domain', () => {
    expect((brokenRefs() as { ref: string }[]).some((b) => b.ref === '06')).toBe(true);
  });
});

describe('rules (fault injection: each one must fail)', () => {
  it('passes a well-formed done entry', () => {
    expect(run({}).errors).toEqual([]);
  });

  it('① an id in the docs but not on the list', () => {
    expect(run({ docs: [doc('G06'), doc('G07')] }).errors.join()).toContain('[목록 누락] G07');
  });

  it('② done without tests, with a test that does not exist, or without a real-screen check', () => {
    const noTests = run({ coverage: { ids: { G06: { ...done, tests: [] } } } });
    expect(noTests.errors.join()).toContain('[거짓 done] G06');
    const ghost = run({ coverage: { ids: { G06: { ...done, tests: ['a.test.ts::opens the arena'] } } } });
    expect(ghost.errors.join()).toContain('opens the arena');
    const noFile = run({ coverage: { ids: { G06: { ...done, tests: ['gone.test.ts::x'] } } } });
    expect(noFile.errors.join()).toContain('gone.test.ts');
    const noScreen = run({ coverage: { ids: { G06: { ...done, e2e: undefined } } } });
    expect(noScreen.errors.join()).toContain('실화면 확인');
  });

  it('③ dropping an id, or deferring it, needs an operator decision id', () => {
    const base = { ids: { G06: done, G07: { title: 'G07', status: 'missing', owner: 'world' } } };
    const dropped = run({ base });
    expect(dropped.errors.join()).toContain('[범위 축소] G07');
    const deferred = run({ coverage: { ids: { G06: { ...done, status: 'deferred' } } } });
    expect(deferred.errors.join()).toContain('[범위 축소] G06');
    const decided = run({ coverage: { ids: { G06: { title: 'G06', status: 'deferred', owner: 'world', decision: 'd_17656aefc718' } } } });
    expect(decided.errors).toEqual([]);
    const ledger = run({ coverage: { ids: { G06: { title: 'G06', status: 'deferred', owner: 'world', decision: 'R2553' } } } });
    expect(ledger.errors).toEqual([]);
    const words = run({ coverage: { ids: { G06: { title: 'G06', status: 'deferred', owner: 'world', decision: '수업 당일 최소' } } } });
    expect(words.errors.join()).toContain('[범위 축소]');
  });

  it('③b postponing is narrowing: a timing field (deferred_until, after_lesson, later…) needs a decision id too', () => {
    for (const field of ['deferred_until', 'after_lesson', 'later', 'not_before', 'phase']) {
      const r = run({ docs: [doc('G06'), doc('G07')], coverage: { ids: { G06: done, G07: { title: 'G07', status: 'missing', owner: 'world', note: 'x', [field]: '17:00' } } } });
      expect(r.errors.join(), field).toContain('[시점 미루기] G07');
    }
    const decided = run({ docs: [doc('G06'), doc('G07')], coverage: { ids: { G06: done, G07: { title: 'G07', status: 'missing', owner: 'world', note: 'x', deferred_until: '2026-12-01', decision: 'd_17656aefc718' } } } });
    expect(decided.errors).toEqual([]);
    const feat = run({ coverage: { ids: { G06: done }, features: [{ id: 'jetpack', status: 'building', owner: 'world', evidence: 'x', after_lesson: true }] } });
    expect(feat.errors.join()).toContain('[시점 미루기] 기능 jetpack');
  });

  it('a site feature: live needs tests and a screen check; lowering it to planned or dropping it needs a decision', () => {
    const live = { id: 'jetpack', status: 'live', owner: 'world', evidence: 'x', tests: [] };
    expect(run({ coverage: { ids: { G06: done }, features: [live] } }).errors.join()).toContain('[거짓 live] jetpack');
    const base = { ids: { G06: done }, features: [{ id: 'jetpack', status: 'building', owner: 'world', evidence: 'x' }] };
    const lowered = run({ base, coverage: { ids: { G06: done }, features: [{ id: 'jetpack', status: 'planned', owner: 'world', evidence: 'x' }] } });
    expect(lowered.errors.join()).toContain('building → planned');
    const gone = run({ base, coverage: { ids: { G06: done }, features: [] } });
    expect(gone.errors.join()).toContain('기능 jetpack');
  });

  it('④ a new broken doc reference fails; a known one needs an owner and goes away once fixed', () => {
    const b = { doc: 'docs/08-design-system.md', line: 426, ref: '06', text: '| T01 | 디렉터 콘솔 | 교사 | `06`의 3장 |' };
    expect(run({ broken: [b] }).errors.join()).toContain('[끊긴 참조]');
    const known = { ids: { G06: done }, broken_refs: [{ doc: b.doc, ref: '06', owner: 'lesson', note: '06 복원' }] };
    expect(run({ broken: [b], coverage: known }).errors).toEqual([]);
    expect(run({ broken: [], coverage: known }).errors.join()).toContain('더 이상 끊기지 않았습니다');
  });

  it('missing and partial are not failures: they are the gap list by owner', () => {
    const r = run({ docs: [doc('G06'), doc('G07')], coverage: { ids: { G06: done, G07: { title: 'G07', status: 'missing', owner: 'world', note: '월드 고르기 없음' } } } });
    expect(r.errors).toEqual([]);
    expect(r.gaps.world?.map((g) => g.id)).toEqual(['G07']);
  });

  it('test references: an exact it() title in a test file, or a real-screen tool — nothing else counts', () => {
    expect(parseTestRef('a.test.ts::opens the map')).toEqual({ file: 'a.test.ts', name: 'opens the map' });
    expect(testExists('a.test.ts::opens the map', read)).toBe(true);
    expect(testExists('tools/smoke-live.mjs', read)).toBe(true);
    // review 11-16 round 2: skipped/todo/failing tests, a test in a comment after code or in a string, a skipped suite,
    // and a tool that only mentions playwright (not on REAL_SCREEN_TOOLS) do not count
    for (const n of ['a skipped test', 'a test to write', 'a failing test', 'after code on the line', 'inside a string'])
      expect(testExists(`a.test.ts::${n}`, read), n).toBe(false);
    expect(testExists('b.test.ts::looks real', read)).toBe(false);
    expect(testExists('tools/e2e.mjs', read)).toBe(false);
    // review 11-16: a substring, a string that is not a test title, a commented-out test, a doc, a helper all passed before
    expect(testExists('a.test.ts::opens', read)).toBe(false);
    expect(testExists('a.test.ts::opens the arena', read)).toBe(false);
    expect(testExists('a.test.ts::a commented-out test', read)).toBe(false);
    expect(testExists('docs/08.md::G07', read)).toBe(false);
    expect(testExists('tools/helper.mjs', read)).toBe(false);
    expect(testExists('a.test.ts', read)).toBe(false);
  });

  it('③f a done whose note names a gap, a missing title, and markers that always pass all fail', () => {
    const gap = run({ coverage: { ids: { G06: { ...done, note: '지도는 있음. 수직 밴드는 없음' } } } });
    expect(gap.errors.join()).toContain('[거짓 done] G06: note 가 빠진 것을 말합니다');
    const only = run({ coverage: { ids: { G06: { ...done, note: '방 판정 문구뿐' } } } });
    expect(only.errors.join()).toContain('[거짓 done] G06');
    // review 11-16 round 3: words that stepped around the first list
    for (const note of ['아직 지도 화면은', '버튼 표시만 있음', '서버 쪽만', '함수만', '미작성', '미지원', '안 쓰고 자체 흐름', '음성은 SFU 비밀 없으면 텍스트',
      '운영자 스위치가 켜져야 발송', '리포트 숫자 수준', 'no London sector', 'not wired to the dialog', 'only the button'])
      expect(run({ coverage: { ids: { G06: { ...done, note } } } }).errors.join(), note).toContain('[거짓 done] G06');
    const fine = run({ coverage: { ids: { G06: { ...done, note: '좌석마다 기능이 같음' } } } });
    expect(fine.errors).toEqual([]);
    const { title: _t, ...untitled } = done;
    expect(run({ coverage: { ids: { G06: untitled } } }).errors.join()).toContain('[설계서 바뀜] G06: title 이 없습니다');
    for (const expect_ of [['text:'], ['testid:'], ['notext:선생님'], ['x'], ['canvas', 'text:']]) {
      const r = run({ coverage: { ids: { G06: { ...done, e2e: { route: '/world/', expect: expect_ } } } } });
      expect(r.errors.join(), expect_.join()).toContain('[거짓 done] G06: done 인데 실화면 확인');
    }
    const authBad = run({ coverage: { ids: { G06: { ...done, e2e: { route: '/world/', expect: ['canvas'], auth: 'operator', authExpect: ['notext:x'] } } } } });
    expect(authBad.errors.join()).toContain('실화면 확인');
  });

  it('③g cutting the spec line since main needs a decision on that id', () => {
    const base = { ids: { G06: { ...done, title: '지도: 9칸 섹터, 수직 밴드, 구역 범례' } }, features: [] };
    const cut = run({ docs: [{ ...doc('G06'), title: '지도: 9칸 섹터' }], coverage: { ids: { G06: { ...done, title: '지도: 9칸 섹터' } }, features: [] }, base });
    expect(cut.errors.join()).toContain('[설계서 줄임] G06');
    expect(cut.errors.join()).toContain('수직');
    const decided = run({ docs: [{ ...doc('G06'), title: '지도: 9칸 섹터' }], coverage: { ids: { G06: { ...done, title: '지도: 9칸 섹터', decision: 'R2555' } }, features: [] }, base });
    expect(decided.errors).toEqual([]);
    const grown = run({ docs: [{ ...doc('G06'), title: '지도: 9칸 섹터, 수직 밴드, 구역 범례, 확대' }], coverage: { ids: { G06: { ...done, title: '지도: 9칸 섹터, 수직 밴드, 구역 범례, 확대' } }, features: [] }, base });
    expect(grown.errors).toEqual([]);
    expect(specWordsLost('친구 월드에 60분 입장', '친구 월드에 30분 입장')).toEqual(['60분']);
  });

  it('③c ③d ③e unknown fields, postponing in the note, and a spec line that moved all fail', () => {
    const extra = run({ coverage: { ids: { G06: { ...done, deadline: '17:00' } } } });
    expect(extra.errors.join()).toContain('[모르는 필드] G06');
    const said = run({ docs: [doc('G06'), doc('G07')], coverage: { ids: { G06: done, G07: { title: 'G07', status: 'missing', owner: 'world', note: '월드 고르기는 다음 PR 에서' } } } });
    expect(said.errors.join()).toContain('[시점 미루기] G07');
    const moved = run({ coverage: { ids: { G06: { ...done, title: '예전 문장' } } } });
    expect(moved.errors.join()).toContain('[설계서 바뀜] G06');
  });
});

describe('nightly audit joins production screens with the list', () => {
  const coverage = {
    ids: {
      G02: { title: 'G02', status: 'done', owner: 'talk', e2e: { route: '/world/', expect: ['canvas'] } },
      T01: { title: 'T01', status: 'done', owner: 'lesson', e2e: { route: '/director', expect: ['text:선생님 열쇠'], auth: 'operator' } },
      G07: { title: 'G07', status: 'missing', owner: 'world' }
    },
    features: [{ id: 'showroom', status: 'live', owner: 'outsider', e2e: { route: '/s/demo', expect: ['text:하늘 카페 마을'] } }]
  };
  const check = { errors: [], gaps: { world: [{ id: 'G07', status: 'missing', title: '', note: '' }] }, counts: { done: 2, missing: 1 }, byKind: {}, features: {} };

  it('plans every e2e route once, plus the site pages', () => {
    const plan = auditPlan(coverage) as { route: string; who: { id: string }[] }[];
    expect(plan.find((p) => p.route === '/world/')?.who.map((w) => w.id)).toEqual(['G02']);
    expect(plan.map((p) => p.route)).toContain('/s/demo');
    expect(plan.map((p) => p.route)).toContain('/pricing');
  });

  it('a done screen that does not open or misses its marker is a regression; a key screen is only "unverified"', () => {
    const plan = auditPlan(coverage);
    const results = [
      { route: '/world/', size: 'd', status: 200, marks: { canvas: false }, pageErrors: [] },
      { route: '/world/', size: 'm', status: 200, marks: { canvas: true }, pageErrors: [] },
      { route: '/director', size: 'd', status: 200, marks: { 'text:선생님 열쇠': true }, pageErrors: [] },
      { route: '/s/demo', size: 'd', status: 500, marks: {}, pageErrors: [] }
    ];
    const rep = summarize({ base: 'https://x', sha: 'abc', plan, results, coverage, check });
    expect(rep.regressions.map((r: { id: string; sizes: string[] }) => `${r.id}:${r.sizes.join('')}`)).toEqual(['G02:d', 'feature:showroom:d']);
    expect(rep.unverified.map((u: { id: string }) => u.id)).toEqual(['T01']);
  });

  it('the functions run inside the page call no module code (each is serialized alone; 11-16 readMarks was undefined there)', () => {
    const src = readFileSync(new URL('../nightly-audit.mjs', import.meta.url), 'utf8');
    const top = [...src.matchAll(/^(?:export\s+)?(?:async\s+)?function\s+(\w+)|^(?:export\s+)?const\s+(\w+)\s*=/gm)].map((m) => m[1] ?? m[2]);
    for (const [name, fn] of Object.entries(PAGE_FUNCTIONS as Record<string, () => unknown>)) {
      const body = String(fn);
      const used = top.filter((t) => t !== name && new RegExp(`\\b${t}\\b`).test(body));
      expect(used, name).toEqual([]);
    }
  });

  it('flags internal screens whose font, background or width differ from the rest; a tie names nobody', () => {
    const f = (route: string, font: string, maxWidth = '') => ({ route, size: 'd', frame: { font, bg: 'rgb(255, 249, 238)', maxWidth } });
    const out = frameOutliers([f('/director', 'Pretendard'), f('/family', 'Pretendard'), f('/seats', 'Arial')]) as { route: string }[];
    expect(out.map((o) => o.route)).toEqual(['/seats']);
    const wide = frameOutliers([f('/director', 'Pretendard'), f('/family', 'Pretendard'), f('/window', 'Pretendard', '1200px')]) as { route: string }[];
    expect(wide.map((o) => o.route)).toEqual(['/window']);
    expect(frameOutliers([f('/director', 'Pretendard'), f('/seats', 'Arial')])).toEqual([]);
  });

  it('with the operator key, a key screen is checked signed in and is no longer "unverified"; a missing key marker is a regression', () => {
    const cov = { ids: { T01: { title: 'T01', status: 'done', owner: 'lesson', e2e: { route: '/director', expect: ['text:선생님 열쇠'], auth: 'operator', authExpect: ['testid:director-plan'] } } }, features: [] };
    const plan = auditPlan(cov);
    const anon = { route: '/director', size: 'd', status: 200, marks: { 'text:선생님 열쇠': true }, pageErrors: [] };
    const ok = summarize({ base: 'x', sha: 's', plan, coverage: cov, check, results: [anon, { route: '/director', size: 'key', signedIn: true, status: 200, marks: { 'testid:director-plan': true }, pageErrors: [] }] });
    expect(ok.unverified).toEqual([]);
    expect(ok.regressions).toEqual([]);
    const bad = summarize({ base: 'x', sha: 's', plan, coverage: cov, check, results: [anon, { route: '/director', size: 'key', signedIn: true, status: 200, marks: { 'testid:director-plan': false }, pageErrors: [] }] });
    expect(bad.regressions.map((r: { id: string; sizes: string[] }) => `${r.id}:${r.sizes.join('')}`)).toEqual(['T01:key']);
  });
});

describe('nightly audit: one route never holds the whole night (first run 11-16 hit the one-hour task limit)', () => {
  it('a route past its limit is recorded as a timeout and its browser context is closed; a quick one passes through', async () => {
    let closed = 0;
    const lines: string[] = [];
    const stuck = (hold: { ctx?: unknown }) => {
      hold.ctx = { close: async () => void closed++ };
      return new Promise(() => {}); // an evaluate on a starved 3D page that never answers
    };
    const r = await withRouteLimit(stuck, { route: '/world/', tag: 'm', limitMs: 50, graceMs: 20, log: (l: string) => lines.push(l) });
    expect(r.error).toMatch(/^route_timeout/);
    expect(r.status).toBe(0);
    expect(closed).toBe(1);
    expect(lines[0]).toContain('/world/ m timeout');
    const ok = await withRouteLimit(async () => ({ route: '/', size: 'd', status: 200 }), { route: '/', tag: 'd', limitMs: 1000 });
    expect(ok).toEqual({ route: '/', size: 'd', status: 200 });
    const thrown = await withRouteLimit(async () => { throw new Error('net::ERR_CONNECTION_RESET'); }, { route: '/x', tag: 'd', limitMs: 1000 });
    expect(thrown.error).toContain('ERR_CONNECTION_RESET');
  });

  it('a close that never answers still returns within the grace, and the browser is marked to be dropped', async () => {
    const hung = (hold: { ctx?: unknown }) => {
      hold.ctx = { close: () => new Promise(() => {}) }; // a starved renderer does not answer the close either
      return new Promise(() => {});
    };
    const t0 = Date.now();
    const r = await withRouteLimit(hung, { route: '/world/', tag: 'd', limitMs: 30, graceMs: 30 });
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(r.timedOut).toBe(true);
    expect(r.browserBroken).toBe(true);
    // stuck in newContext: nothing to close - the browser has to go too
    const noCtx = await withRouteLimit(() => new Promise(() => {}), { route: '/x', tag: 'd', limitMs: 20, graceMs: 20 });
    expect(noCtx.browserBroken).toBe(true);
    // the context closed and the opener ended: the browser stays
    const clean = await withRouteLimit(
      (hold: { ctx?: unknown }) =>
        new Promise((_, reject) => {
          hold.ctx = { close: async () => reject(new Error('Target closed')) };
        }),
      { route: '/y', tag: 'd', limitMs: 20, graceMs: 50 }
    );
    expect(clean.timedOut).toBe(true);
    expect(clean.browserBroken).toBe(false);
  });

  it('a dead or dropped browser is started again before the next route; a failed start is that route only', async () => {
    let n = 0;
    const made: { connected: boolean; closed: boolean }[] = [];
    const launch = async () => {
      n++;
      if (n === 3) throw new Error('spawn chrome ENOMEM');
      const b = { connected: true, closed: false, isConnected: () => b.connected, close: async () => void (b.closed = true) };
      made.push(b);
      return b;
    };
    const pool = browserPool({ launch, graceMs: 20 });
    const a = await pool.get();
    expect(await pool.get()).toBe(a); // healthy: reused
    made[0]!.connected = false; // died (out of memory)
    const b = await pool.get();
    expect(b).not.toBe(a);
    expect(made[0]!.closed).toBe(true);
    pool.drop(); // a timed-out route left it stuck
    await expect(pool.get()).rejects.toThrow('ENOMEM'); // third start fails: only this route
    const c = await pool.get(); // the next route starts one again
    expect(made[1]!.closed).toBe(true);
    expect(c).toBe(made[2]);
    // a close that hangs does not hold the next start
    made[2]!.close = () => new Promise(() => {});
    pool.drop();
    const t0 = Date.now();
    await pool.get();
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it('the whole audit has a limit: what is left is not opened and is reported as not checked, never as a regression', async () => {
    const plan = [
      { route: '/a', who: [{ id: 'A.1', owner: 'world', status: 'done', expect: [], authExpect: [] }], expect: [], authExpect: [], auth: null },
      { route: '/b', who: [{ id: 'B.1', owner: 'talk', status: 'done', expect: [], authExpect: [] }], expect: [], authExpect: [], auth: null }
    ];
    const viewports = [{ name: 'd' }, { name: 'm' }];
    let clock = 0;
    const opened: string[] = [];
    const open = async (p: { route: string }, vp: { name: string }) => {
      opened.push(`${p.route} ${vp.name}`);
      clock += 60; // every open uses a minute of a 2.5-minute limit
      return { route: p.route, size: vp.name, status: 0, error: 'route_timeout 90000ms', timedOut: true };
    };
    const results = await runPlan({ plan, viewports, open, limitMs: 150, now: () => clock });
    expect(opened).toEqual(['/a d', '/a m', '/b d']); // a route_timeout gets no second look
    expect(results.map((r: { skipped?: string }) => r.skipped ?? null)).toEqual([null, null, null, 'audit_deadline']);
    const rep = summarize({ base: 'x', sha: null, plan, results, coverage: { ids: {}, features: [] }, check: { counts: {}, byKind: {}, features: {}, errors: [], gaps: {} } });
    expect(rep.skippedScreens).toBe(1);
    expect(rep.screens).toBe(3);
    expect(rep.regressions.map((r: { id: string }) => r.id)).toEqual(['A.1', 'B.1']); // both opened and timed out
    expect(rep.regressions[1].sizes).toEqual(['d']); // the skipped size is not part of the regression
    // a route never opened at all is not checked, not a regression
    clock = 0;
    const none = await runPlan({ plan, viewports, open, limitMs: 0, now: () => clock });
    const rep2 = summarize({ base: 'x', sha: null, plan, results: none, coverage: { ids: {}, features: [] }, check: { counts: {}, byKind: {}, features: {}, errors: [], gaps: {} } });
    expect(rep2.regressions).toEqual([]);
    expect(rep2.notChecked.map((x: { id: string }) => x.id)).toEqual(['A.1', 'B.1']);
  });
});
