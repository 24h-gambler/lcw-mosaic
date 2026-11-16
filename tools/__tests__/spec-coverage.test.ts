// Spec coverage (docs/README.md "설계서 대조", R2553): every promised screen, flow step and core promise is on the
// list with an honest status; "done" needs a test and a real-screen check; narrowing the scope needs an operator decision.
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs tools without types
import { checkCoverage, parseTestRef, runCheck, testExists } from '../spec-coverage.mjs';
// @ts-expect-error plain .mjs tools without types
import { brokenRefs, specIds } from '../spec-ids.mjs';
// @ts-expect-error plain .mjs tools without types
import { auditPlan, frameOutliers, summarize } from '../nightly-audit.mjs';

type Check = { errors: string[]; gaps: Record<string, { id: string; status: string }[]>; counts: Record<string, number> };
type Doc = { id: string; kind: string; title: string; sources: string[] };

const doc = (id: string, kind = 'screen'): Doc => ({ id, kind, title: id, sources: ['docs/x.md:1'] });
const files: Record<string, string> = { 'a.test.ts': "it('opens the map', () => {})", 'tools/e2e.mjs': '// e2e' };
const read = (f: string) => files[f] ?? null;
const done = { status: 'done', owner: 'world', tests: ['a.test.ts::opens the map'], e2e: { route: '/world/', expect: ['canvas'] }, evidence: ['x:1'] };
const run = (over: Partial<Parameters<typeof checkCoverage>[0]>) =>
  checkCoverage({ docs: [doc('G06')], coverage: { ids: { G06: done }, features: [], broken_refs: [] }, base: null, broken: [], readFile: read, ...over }) as Check;

describe('the repository coverage list (docs/spec-coverage.json)', () => {
  it('carries every id the docs promise and breaks no rule', () => {
    const r = runCheck() as Check;
    expect(r.errors).toEqual([]);
  });

  it('reads the screen list of docs/08 §8.6 and the site map of docs/14 §2 completely', () => {
    const ids = (specIds() as Doc[]).filter((d) => d.kind === 'screen').map((d) => d.id);
    for (let n = 1; n <= 15; n++) expect(ids).toContain(`G${String(n).padStart(2, '0')}`);
    for (const id of ['T01', 'T02', 'T03', 'T04', 'P01', 'P07', 'W01', 'W09']) expect(ids).toContain(id);
    expect(ids).toHaveLength(35);
  });

  it('extracts the docs/10 flows and the docs/01–02 promises (the login row included)', () => {
    const all = specIds() as Doc[];
    expect(all.filter((d) => d.kind === 'flow').length).toBeGreaterThan(100);
    expect(all.map((d) => d.id)).toContain('C02.2.로그인');
    expect(all.map((d) => d.id)).toContain('C01.6.탐험가');
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
    const base = { ids: { G06: done, G07: { status: 'missing', owner: 'world' } } };
    const dropped = run({ base });
    expect(dropped.errors.join()).toContain('[범위 축소] G07');
    const deferred = run({ coverage: { ids: { G06: { ...done, status: 'deferred' } } } });
    expect(deferred.errors.join()).toContain('[범위 축소] G06');
    const decided = run({ coverage: { ids: { G06: { status: 'deferred', owner: 'world', decision: 'd_17656aefc718' } } } });
    expect(decided.errors).toEqual([]);
    const ledger = run({ coverage: { ids: { G06: { status: 'deferred', owner: 'world', decision: 'R2553' } } } });
    expect(ledger.errors).toEqual([]);
    const words = run({ coverage: { ids: { G06: { status: 'deferred', owner: 'world', decision: '수업 당일 최소' } } } });
    expect(words.errors.join()).toContain('[범위 축소]');
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
    const r = run({ docs: [doc('G06'), doc('G07')], coverage: { ids: { G06: done, G07: { status: 'missing', owner: 'world', note: '월드 고르기 없음' } } } });
    expect(r.errors).toEqual([]);
    expect(r.gaps.world?.map((g) => g.id)).toEqual(['G07']);
  });

  it('test references: exact it() name in the file, or a tools/*.mjs e2e script', () => {
    expect(parseTestRef('a.test.ts::opens the map')).toEqual({ file: 'a.test.ts', name: 'opens the map' });
    expect(testExists('a.test.ts::opens the map', read)).toBe(true);
    expect(testExists('tools/e2e.mjs', read)).toBe(true);
    expect(testExists('a.test.ts', read)).toBe(false);
  });
});

describe('nightly audit joins production screens with the list', () => {
  const coverage = {
    ids: {
      G02: { status: 'done', owner: 'talk', e2e: { route: '/world/', expect: ['canvas'] } },
      T01: { status: 'done', owner: 'lesson', e2e: { route: '/director', expect: ['text:선생님 열쇠'], auth: 'operator' } },
      G07: { status: 'missing', owner: 'world' }
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

  it('flags internal screens whose frame differs from the rest', () => {
    const f = (route: string, font: string) => ({ route, size: 'd', frame: { font, bg: 'rgb(255, 249, 238)', maxWidth: '' } });
    const out = frameOutliers([f('/director', 'Pretendard'), f('/family', 'Pretendard'), f('/seats', 'Arial')]) as { route: string }[];
    expect(out.map((o) => o.route)).toEqual(['/seats']);
  });
});
