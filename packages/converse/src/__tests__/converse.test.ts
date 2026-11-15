import { describe, expect, it } from 'vitest';
import { QuotaMeter } from '@lcw/quota';
import {
  classifyUtteranceMode,
  computeLevelAdjustment,
  ConversationMachine,
  evaluateOpenEndedAnswer,
  filterSpeechBubble,
  normalizeMixedUtterance,
  recognizeVoiceSkill,
  scoreUtterance,
  selectSttChannel,
  understandUtterance
} from '../index.js';

describe('@lcw/converse WP-105, WP-106, WP-108, WP-302, WP-410, WP-502, WP-508 acceptance', () => {
  it('WP-105: normalizes 20 mixed Korean-English utterances', () => {
    const samples: Array<[string, string]> = [
      ['I want 빨간색 jetpack', 'red jetpack'],
      ['차가운 물 주세요', 'cold water please'],
      ['따뜻한 차 주세요', 'warm tea please'],
      ['달콤한 스무디 one 잔 please', 'sweet smoothie one please'],
      ['큰 사과주스 주세요', 'large apple juice please'],
      ['작은 레모네이드 주세요', 'small lemonade please'],
      ['신선한 주스 주세요', 'fresh juice please'],
      ['파란색 우비 원해요', 'blue raincoat want'],
      ['노란색 우산 사고싶어요', 'yellow umbrella want to buy'],
      ['튼튼한 철곡괭이 만들어주세요', 'strong iron pickaxe build'],
      ['빠른 드릴 원해요', 'fast drill want'],
      ['초록색 부츠 주세요', 'green boots please'],
      ['빛나는 헬멧 만들어주세요', 'glowing helmet build'],
      ['호박 헬멧 원해요', 'pumpkin helmet want'],
      ['파란 물폭탄 다섯 개 주세요', 'blue water balloon five please'],
      ['빨간색 벽돌 열 개 주세요', 'red brick ten please'],
      ['차가운 아이스티 주세요', 'cold iced tea please'],
      ['따뜻한 핫초코 주세요', 'warm hot chocolate please'],
      ['달콤한 딸기스무디 주세요', 'sweet berry smoothie please'],
      ['금 판매 원해요', 'gold']
    ];

    expect(samples).toHaveLength(20);
    for (const [input, expectedSub] of samples) {
      const res = normalizeMixedUtterance(input);
      expect(res.normalized.toLowerCase()).toContain(expectedSub);
    }
  });

  it('WP-105 & WP-106: runs state machine transitions and completes order via Thought Board without mic', () => {
    const quota = new QuotaMeter('2026-11-15', 0); // quota=0 -> board/bank works
    expect(
      selectSttChannel({
        micAvailable: false,
        deviceSttSupported: false,
        seatId: 's1',
        isLesson: false,
        quotaMeter: quota,
        nowMs: 1000
      })
    ).toBe('board');

    const machine = new ConversationMachine('cafe', 'L2');
    expect(machine.start()).toBe('PROMPT');
    expect(machine.onPromptAudioComplete()).toBe('CAPTURE');

    // 6s silence returns to PROMPT with hint tags
    expect(machine.onCaptureSilenceTimeout6s()).toBe('PROMPT');
    expect(machine.hintTagsVisible).toBe(true);
    expect(machine.onPromptAudioComplete()).toBe('CAPTURE');

    // 2 consecutive unparseable utterances open BOARD
    expect(machine.submitCapture('???').state).toBe('CAPTURE');
    expect(machine.submitCapture('알수없는단어').state).toBe('BOARD');

    const boardRes = machine.submitBoardSelection({
      item: 'water',
      modifier: 'cold'
    });
    expect(boardRes.state).toBe('OFFER');
    expect(boardRes.understand.source).toBe('board');

    expect(machine.chooseOffer(3, 'board')).toBe('REPEAT');

    // 3 repeat failures trigger ECHO and still grant 1+ star reward
    machine.submitRepeat('uh');
    machine.submitRepeat('water');
    const third = machine.submitRepeat('uh');
    expect(third.state).toBe('ECHO');
    expect(machine.completeEcho()).toBe('REWARD');
    const done = machine.commitRewardAndLog();
    expect(done.state).toBe('IDLE');
    expect(done.grantedStars).toBe(2);
  });

  it('WP-108 & WP-112: scores deterministically and works with quota set to 0', () => {
    const a = scoreUtterance({
      targetText: "I'm looking for a fuel-efficient red jetpack so that I can fly to the space station.",
      spokenTranscript: "I'm looking for a fuel efficient red jetpack so I can fly to the space station",
      level: 'L3'
    });
    const b = scoreUtterance({
      targetText: "I'm looking for a fuel-efficient red jetpack so that I can fly to the space station.",
      spokenTranscript: "I'm looking for a fuel efficient red jetpack so I can fly to the space station",
      level: 'L3'
    });
    expect(a).toEqual(b);
    expect(a.pass).toBe(true);
    expect(a.missed).toEqual(['that']);
    expect(a.score).toBeGreaterThanOrEqual(0.85);

    const zeroQuota = new QuotaMeter('2026-11-15', 0);
    const res = understandUtterance({
      ctx: 'cafe',
      level: 'L1',
      transcript: '차가운 물 주세요',
      quotaMeter: zeroQuota,
      seatId: 's1',
      nowMs: 1000
    });
    expect(res.source).toBe('bank');
    expect(res.offers).toHaveLength(3);
  });

  it('WP-302, WP-410, WP-502, WP-508: classifies modes, adjusts levels, matches voice skills <400ms, and filters bubbles', () => {
    expect(
      classifyUtteranceMode({
        screenHasTargetSentence: false,
        usedBoardOrHintTags: false,
        isReviewRecall: false
      })
    ).toBe('free');
    expect(
      classifyUtteranceMode({
        screenHasTargetSentence: true,
        usedBoardOrHintTags: false,
        isReviewRecall: false
      })
    ).toBe('read');

    const open = evaluateOpenEndedAnswer({
      level: 'L2',
      ctx: 'cafe',
      transcript: 'Because I am thirsty after mining'
    });
    expect(open.pass).toBe(true);
    expect(open.mode).toBe('free');
    expect(open.tipCoins).toBe(12);

    const up = computeLevelAdjustment({
      currentLevel: 'L2',
      locked: false,
      recent20: Array.from({ length: 20 }, () => ({ chosenStars: 3, attempts: 1, passed: true }))
    });
    expect(up).toBe('L3');

    const t0 = performance.now();
    const skill = recognizeVoiceSkill('Freeze the big slime so that I can escape!');
    const elapsedMs = performance.now() - t0;
    expect(skill.matched).toBe(true);
    expect(skill.verb).toBe('freeze');
    expect(skill.target).toBe('slime');
    expect(skill.grade).toBe('sentence');
    expect(elapsedMs).toBeLessThan(400);

    // <70% target language blocked (3/5 = 0.60)
    const koBubble = filterSpeechBubble('안녕 친구들 let us go');
    expect(koBubble.allowed).toBe(false);
    expect(koBubble.targetLangRatio).toBe(0.6);
  });

  it('WP-502: blocks speech bubbles under 70% target language or with PII', () => {
    const lowRatio = filterSpeechBubble('안녕 내 빨간색 집 봐봐 cool');
    expect(lowRatio.allowed).toBe(false);
    expect(lowRatio.targetLangRatio).toBeLessThan(0.7);

    const pii = filterSpeechBubble('Call me at 010-1234-5678 please');
    expect(pii.allowed).toBe(false);
    expect(pii.reason).toBe('pii');

    const ok = filterSpeechBubble('Look at my big red house!');
    expect(ok.allowed).toBe(true);
    expect(ok.targetLangRatio).toBe(1);
  });
});
