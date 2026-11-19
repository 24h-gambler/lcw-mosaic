// PR text check (AGENTS.md 0.7): postponing or narrowing in a PR needs the operator's decision id in the same paragraph.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs tool without types
import { lintPrMeta, lintPrTextFull, lintPrText } from '../pr-lint.mjs';

const ids = (t: string) => (lintPrText(t) as { id: string }[]).map((f) => f.id);

describe('pr-lint: postponing is narrowing (fault injection)', () => {
  it('catches the four ways an instruction was cut on 11-16', () => {
    expect(ids('이 PR 은 15:00 수업 경로를 건드리므로 17:00 뒤에 머지합니다.')).toContain('after-time');
    expect(ids('수업 뒤에 배포합니다.')).toContain('after-time');
    expect(ids('오늘은 3D 전체 대신 수업 모드를 먼저 만듭니다.')).toContain('instead');
    expect(ids('우선 일회용 링크만 넣고 로그인은 나중에 붙입니다.')).toEqual(expect.arrayContaining(['only-first', 'later']));
    expect(ids('World picker (G07) is left for a follow-up PR.')).toContain('later');
    expect(ids('Merge after the lesson.')).toContain('after-time');
  });

  it('passes when the same paragraph cites a decision card or a ledger line', () => {
    expect(ids('17:00 뒤에 머지합니다 (Dan 결정 d_17656aefc718).')).toEqual([]);
    expect(ids('월드 고르기는 다음 PR 에서.\n원장 R2553 에서 Dan 이 정함.')).toEqual([]);
  });

  it('a citation in another paragraph does not count', () => {
    expect(ids('결정 d_17656aefc718 참고.\n\n로그인은 나중에 붙입니다.')).toEqual(['later']);
  });

  it('lists the decision ids that excuse a phrase (the lane gate checks they exist), not every id in the text', () => {
    const r = lintPrTextFull('로그인은 다음 PR 에서 (R2555).\n\n관련: R1198 머지 규칙.') as { hits: unknown[]; cited: string[] };
    expect(r.hits).toEqual([]);
    expect(r.cited).toEqual(['R2555']);
  });

  it('quotes and code are not the author postponing', () => {
    expect(ids('> Dan 11-16 원문: 왜 수업뒤에 넣어요? 제 말이 제대로 전달이 안되고 있나요?')).toEqual([]);
    // an unattributed or undated quote, or a long code span, is the author's own text
    expect(ids('> Dan 원문: 로그인은 나중에 붙입니다')).toEqual(['later']);
    expect(ids('> 로그인은 나중에 붙입니다')).toEqual(['later']);
    expect(ids('`로그인은 다음 PR 에서 붙이겠습니다`')).toEqual(['later']);
    expect(ids('```\nnode tools/pr-lint.mjs 69 # 나중에\n```')).toEqual([]);
    expect(ids('검사 문구 `수업 뒤` 를 막는 규칙을 넣었습니다.')).toEqual([]);
  });

  it('catches the ways around it found in review (fault injection)', () => {
    for (const t of ['이번 PR에 넣지 않았습니다', '다음 작업으로 넘깁니다', '별도 PR로 분리', '이번엔 수업 모드만 합니다', '17시 이후에 머지', '오후 5시 넘어서 머지',
      '수업이 끝난 다음 배포합니다', '2차로 미룹니다', '범위 밖이라 제외', 'subsequent PR', 'Not included: login',
      'Login will be added later.', 'deferred to the next PR', 'merge after 5pm', '## Not in this PR',
      '로그인은 미루고 링크만', '배포는 늦춥니다', '로그인을 늦춰서 넣습니다',
      // review 11-16 round 2
      '향후 추가 예정', '로그인은 보류', '후순위로 둡니다', '차후 붙입니다', '12/1 이후 배포합니다', '다음 달에 넣습니다', 'v2 에서 지원', 'phase 2',
      'TBD', '당분간 숨김', '일단 빼둠', '수업 마치고 넣음', 'next sprint', '> 원문: 다음 PR 에서 붙입니다', '로그인은 `다음 PR` 에서',
      // real ones from the sweep
      '시작 화면(가입 먼저·언어 단계·영어 화면)은 다음 PR 입니다.', '### 다음 PR', "## Follow-ups for #79's lane (server, not in this PR)",
      '집 PC(나중에는 척추 수집기)가 가져갑니다', 'v2 에서 추가합니다', 'ship only the link first',
      // review 11-16 round 3
      '언젠가 붙입니다', '여유 될 때 넣습니다', '다음 회차에', '두 번째 PR 로', 'in a follow-up', '이 PR 범위가 아님', '이후에 연결합니다', '이어서 하겠습니다',
      '여기까지만 합니다', 'leave the map out'])
      expect(ids(t).length, t).toBeGreaterThan(0);
  });

  it('does not flag the lesson domain words or plain engineering lines', () => {
    for (const t of ['수업 후 리포트가 학부모에게 갑니다', '일단 실패하면 다시 시도', '임시로 만든 토큰', 'stub 서버', 'TODO 주석을 지웠습니다', '2시간 후 다시 시도',
      '15:00 수업 경로를 실측했습니다', '비밀은 저장소에 넣지 않았습니다', '30 days later, 0 signs', 'A later full run on a loaded machine', 'after 7 days',
      'A provider without settings is left out', '이 PR 만 먼저 배포되면 그 경로는 404 입니다', '결정 없는 deferred 는 실패합니다',
      '결정 id 없이 미루거나 줄이는 표현을 찾습니다', '미루는 말이 든 note 는 실패합니다',
      '오후 3시 이후 접속 시 수업 창문이 열립니다', '설계서에서 범위 밖으로 정한 구역은 거절합니다', 'kept for later use', '> Dan 11-16 09:20: 다음 PR 로 미루지 마세요',
      // sweep of PRs #55–#106: domain words, not postponing
      'uuid v4 에 맞춘 id', "이 PR 만 먼저 배포되면 그 경로들은 404 를 받아 '연결이 잠깐 끊겼어요' 문구만 보입니다",
      'counts passes first entered this KST month + codes still waiting; issuing keeps the sum ≤ 2 only', 'a waiting pass enters next month',
      '다음 달에 다시 생깁니다'])
      expect(ids(t), t).toEqual([]);
  });

  it('plain PR text passes (a lesson "next stage" is not postponing)', () => {
    expect(ids('- 패널은 대본·정답·다음 단계를 보여 줍니다.')).toEqual([]);
    expect(ids('Follow-up to #61: /join sends students to /world/.')).toEqual([]);
    expect(ids('The console shows the live lesson instead of the old prototype.')).toEqual([]);
    expect(ids('Lesson mode instead of the 3D world for now.')).toContain('instead');
    expect(ids('게이지는 다음 단계에서 붙입니다.')).toContain('later');
    expect(ids('G07 월드 고르기 화면을 만들고 spec-coverage 를 done 으로 바꿨습니다. 시험 12개, 1440/390 실화면 확인.')).toEqual([]);
  });
});

// Review lanes are read-only (2026-11-17: a review lane merged ten zz-* probe tests as #147 and broke the edge build).
const meta = (title: string, files: { path: string; changeType?: string }[] = []) =>
  (lintPrMeta({ title, files }) as { id: string }[]).map((f) => f.id);

describe('pr-lint: a review lane makes a verdict, not a PR', () => {
  it('refuses the #147 title and the probe tests it added', () => {
    const files = [
      'apps/edge/src/__tests__/zz-final-verify.test.ts',
      'apps/edge/src/__tests__/zz-indep-check.test.ts',
      'apps/edge/src/__tests__/zz-review-probe.test.ts',
      'apps/web/src/__tests__/zz-review-html.test.ts'
    ].map((path) => ({ path, changeType: 'ADDED' }));
    const found = meta('LCW PR #131(dom/guardian-ko, db391f6) 보호자 화면 독립 검토 — 읽기 전용, 고치지 않고 판정만', files);
    expect(found.filter((x) => x === 'review-title')).toHaveLength(1);
    expect(found.filter((x) => x === 'probe-test')).toHaveLength(4);
  });

  it('refuses review titles and probe/verify test files under any name', () => {
    expect(meta('보호자 화면 검토')).toEqual(['review-title']);
    expect(meta('Read-only review of the lesson route')).toEqual(['review-title']);
    expect(meta('LCW #131 검토 — 읽기 전용')).toEqual(['review-title']);
    expect(meta('review only: guardian page')).toEqual(['review-title']);
    expect(meta('lesson fix', [{ path: 'apps/edge/src/lesson-probe.test.ts', changeType: 'ADDED' }])).toEqual(['probe-test']);
    expect(meta('lesson fix', [{ path: 'apps/web/src/__tests__/opus-verify2.test.ts', changeType: 'ADDED' }])).toEqual(['probe-test']);
    // review of #153: titles that slipped through
    expect(meta('LCW PR #131 독립 검증(읽기 전용)')).toEqual(['review-title']);
    expect(meta('Independent review of PR #131 (verdict only)')).toEqual(['review-title']);
    expect(meta('Opus independent check of #131, no changes')).toEqual(['review-title']);
    expect(meta('lesson fix', [{ path: 'apps/edge/src/__tests__/helpers/zz-x.ts' }])).toEqual(['probe-test']);
    // re-review of #153: a review task's own words ('머지 또는 고칠 것', '재현 시험 추가', '수정 필요') are not a fix
    for (const t of ['LCW PR #153 독립 검토 — 머지 또는 고칠 것 판정', 'PR #160 독립 검토: 고칠 것 3건', '#131 보호자 화면 검토 — 파일 고치지 마세요',
      '#131 검토: 재현 시험 추가', 'PR #160 독립 검토 (수정 필요 지적)', 'Independent review of #160: add probes', 'Review PR #131',
      'Review of PR #131', 'Independent verification of PR #131', 'Opus verification: guardian page #131', 'LCW #131 Opus 검증',
      '#131 교차 검증 결과', '#131 재검증', 'PR #131 검수', 'Audit of PR #131, no changes']) expect(meta(t), t).toEqual(['review-title']);
    // zz-* anywhere, and a verify test brought in by a rename
    for (const path of ['tools/zz-review.mjs', 'apps/edge/test/zz-review.ts', 'e2e/zz-check.e2e.ts'])
      expect(meta('lesson fix', [{ path, changeType: 'ADDED' }]), path).toEqual(['probe-test']);
    expect(meta('lesson fix', [{ path: 'apps/web/src/__tests__/opus-verify.test.ts', changeType: 'RENAMED' }])).toEqual(['probe-test']);
  });

  it('the CLI exits 1 on a review-lane PR with nothing to postpone (the lane merge gate reads the exit code)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-lint-'));
    const run = (pr: object) => {
      const f = path.join(dir, 'pr.json');
      fs.writeFileSync(f, JSON.stringify(pr));
      return spawnSync(process.execPath, [path.resolve(__dirname, '../pr-lint.mjs'), '--meta-file', f], { encoding: 'utf8' });
    };
    const bad = run({ title: 'PR #131 독립 검토 — 읽기 전용', body: 'verdict', files: [{ path: 'apps/edge/src/__tests__/zz-a.test.ts', changeType: 'ADDED' }] });
    expect(bad.status).toBe(1);
    expect(bad.stdout).toContain('[review-title]');
    expect(bad.stdout).toContain('[probe-test]');
    const ok = run({ title: 'world: faster hill', body: 'plain', files: [{ path: 'apps/web/src/hill.ts', changeType: 'MODIFIED' }] });
    expect(ok.status).toBe(0);
  });

  it('lets through fixes, reverts and real past PR titles', () => {
    expect(meta('Revert the review probes PR 147 committed to main (they break the edge build)', [
      { path: 'apps/edge/src/__tests__/zz-final-verify.test.ts', changeType: 'DELETED' }
    ])).toEqual([]);
    expect(meta("Review fixes: keys on buttons, plot ops body order, lesson builds to the student's own plot")).toEqual([]);
    expect(meta('review: memory cards with 20 min / 1 day reviews and HUD review signs (WP-310, WP-406)')).toEqual([]);
    expect(meta('fix(seats): review fixes for WP-704 money paths')).toEqual([]);
    expect(meta('보호자 화면 독립 검토 지적 반영')).toEqual([]);
    expect(meta('tools: live-lesson watch (read-only, operator GET + wrangler tail)')).toEqual([]);
    expect(meta('Dialog preview: item, price per sentence, NPC face (audit G02)')).toEqual([]);
    expect(meta('perf: faster world load', [{ path: 'tools/perf-probe.mjs', changeType: 'MODIFIED' }])).toEqual([]);
    expect(meta('ops: student day cards catch up (2-day window)', [{ path: 'apps/edge/src/ops-cards.test.ts' }])).toEqual([]);
    // review of #153: fixes and follow-ups of a review, and review-named features
    for (const t of ['#131 검토 지적 고치기', '보호자 화면 검토 후속: 쉼표 규칙', '리뷰 지적 처리 (#154)', '검토 의견 대응',
      '교사용 리포트 검토 단계 추가', '보호자 화면 독립 검토 지적 반영']) expect(meta(t)).toEqual([]);
    // 'verify' in a test that already exists is a real feature test; fixtures under __tests__ are data
    expect(meta('pay: receipts', [{ path: 'apps/edge/src/__tests__/receipt-verify.test.ts', changeType: 'MODIFIED' }])).toEqual([]);
    expect(meta('world: data', [{ path: 'apps/web/src/__tests__/fixtures/probe-data.json', changeType: 'ADDED' }])).toEqual([]);
  });
});
