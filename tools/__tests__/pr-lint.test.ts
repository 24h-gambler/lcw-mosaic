// PR text check (AGENTS.md 0.7): postponing or narrowing in a PR needs the operator's decision id in the same paragraph.
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs tool without types
import { lintPrText } from '../pr-lint.mjs';

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

  it('quotes and code are not the author postponing', () => {
    expect(ids('> Dan 원문: 왜 수업뒤에 넣어요? 제 말이 제대로 전달이 안되고 있나요?')).toEqual([]);
    // an unattributed quote or a long code span is the author's own text
    expect(ids('> 로그인은 나중에 붙입니다')).toEqual(['later']);
    expect(ids('`로그인은 다음 PR 에서 붙이겠습니다`')).toEqual(['later']);
    expect(ids('```\nnode tools/pr-lint.mjs 69 # 나중에\n```')).toEqual([]);
    expect(ids('검사 문구 `수업 뒤` 를 막는 규칙을 넣었습니다.')).toEqual([]);
  });

  it('catches the ways around it found in review (fault injection)', () => {
    for (const t of ['이번 PR에 넣지 않았습니다', '다음 작업으로 넘깁니다', '별도 PR로 분리', '이번엔 수업 모드만 합니다', '17시 이후에 머지', '오후 5시 넘어서',
      '수업이 끝난 다음 배포합니다', '2차로 미룹니다', '범위 밖이라 제외', 'subsequent PR', 'Not included: login',
      'Login will be added later.', 'deferred to the next PR', 'merge after 5pm', '## Not in this PR',
      '로그인은 미루고 링크만', '배포는 늦춥니다', '로그인을 늦춰서 넣습니다'])
      expect(ids(t).length, t).toBeGreaterThan(0);
  });

  it('does not flag the lesson domain words or plain engineering lines', () => {
    for (const t of ['수업 후 리포트가 학부모에게 갑니다', '일단 실패하면 다시 시도', '임시로 만든 토큰', 'stub 서버', 'TODO 주석을 지웠습니다', '2시간 후 다시 시도',
      '15:00 수업 경로를 실측했습니다', '비밀은 저장소에 넣지 않았습니다', '30 days later, 0 signs', 'A later full run on a loaded machine', 'after 7 days',
      'A provider without settings is left out', '이 PR 만 먼저 배포되면 그 경로는 404 입니다', '결정 없는 deferred 는 실패합니다',
      '결정 id 없이 미루거나 줄이는 표현을 찾습니다', '미루는 말이 든 note 는 실패합니다'])
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
