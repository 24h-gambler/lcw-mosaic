import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibleChartWithTable,
  BilateralTradePanel,
  Button,
  Card,
  GuestPassEndModal,
  Panel,
  TOKENS,
  TeacherScriptBanner
} from '@lcw/ui';
import { TEACHER_STUDENT_TRADE_SCENARIOS } from '@lcw/content';
import {
  buildFactualWeeklySummary,
  verifyOrReplaceReportBody,
  type ReportFacts
} from '@lcw/metrics';
import {
  LessonProgressionTracker,
  calculateTradeSettlement,
  evaluateMentorDungeonGate
} from '@lcw/sim-core';
import type { LessonBookmark } from '@lcw/metrics';
import {
  DirectorBookmarkPanel,
  GuestClaimCard,
  GuestPassEndScreen,
  ParentLessonWindowView,
  PossessionPanel,
  TryExperience
} from './WebUx.js';
import { handleDirectorKeydown } from './director.js';
import { WEB_UX_STRINGS_KO as UX } from './strings.js';
import { LessonDirectorConsole } from './LessonDirector.js';
import { StudentJoin } from './StudentJoin.js';
import { ParentReportPage } from './ParentReportPage.js';
import { DeviceLinkPage, FamilyPage } from './FamilyPage.js';
import { reportTokenFromPath } from './lessonFlow.js';

/** Public site menu (docs/14 §2). Signed-in screens (dashboard, report, window, director, claim) are reached by link, not listed. */
export const PUBLIC_NAV: ReadonlyArray<{ route: AppRoute; label: string }> = [
  { route: '/', label: UX.site.nav.home },
  { route: '/try', label: UX.site.nav.try },
  { route: '/parents', label: UX.site.nav.parents },
  { route: '/teachers', label: UX.site.nav.teachers },
  { route: '/safety', label: UX.site.nav.safety },
  { route: '/worlds', label: UX.site.nav.worlds }
];

function shareToParent(): void {
  const url = typeof window !== 'undefined' ? `${window.location.origin}/parents` : '/parents';
  const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { share?: (d: { url: string; title?: string }) => Promise<void> }) : undefined;
  if (nav?.share) {
    void nav.share({ url, title: 'LCW' }).catch(() => undefined);
    return;
  }
  void nav?.clipboard?.writeText(url).then(() => {
    if (typeof window !== 'undefined') window.alert(UX.site.linkCopied);
  });
}

export interface ParentReportState {
  reportId: string;
  lessonDateLabel: string;
  clipTitle: string;
  clipDurationLabel: string;
  studentMinutes: number;
  freeWordsCount: number;
  exchangesPer10Min: number;
  densityBand: string;
  anchorBeforeText: string;
  anchorAfterText: string;
  todayExpressions: string[];
  soloReusedCount: number;
  totalTrackedExpressions: number;
  verifiedBody: string;
  teacherComment: string;
  nextLessonAt: string;
  deliveryStatus: 'draft' | 'sent' | 'opened' | 'reminder_sent';
  shareToken: string;
  sentAtMs: number | null;
  openedAtMs: number | null;
  reminderSentAtMs: number | null;
  nextTargetsUpdated: boolean;
}

export type AppRoute =
  | '/'
  | '/try'
  | '/play'
  | '/parents'
  | '/safety'
  | '/teachers'
  | '/worlds'
  | '/pass'
  | '/report'
  | '/dashboard'
  | '/director'
  | '/guest-end'
  | '/claim'
  | '/window'
  | '/join'
  | '/r'
  | '/family'
  | '/link';

export type ConsentScope = 'voice_store' | 'ai_report_draft' | 'peer_multiplayer' | 'clip_share';

export const CONSENT_SCOPE_LABELS: ReadonlyArray<{
  scope: ConsentScope;
  title: string;
  description: string;
}> = [
  {
    scope: 'voice_store',
    title: '음성 발화 성장 기록 저장 (선택)',
    description: '전후 발화 비교(Voice Museum)에 한해 암호화 보관하며 외부 학습에 쓰지 않습니다.'
  },
  {
    scope: 'ai_report_draft',
    title: '주간 리포트 초안 작성 (선택)',
    description: '익명 통계 수치만 바탕으로 사실 확인 문장을 작성합니다.'
  },
  {
    scope: 'peer_multiplayer',
    title: '친구 초대 멀티플레이 (선택)',
    description: '보호자가 승인한 친구와 초대 코드로 함께 건축합니다.'
  },
  {
    scope: 'clip_share',
    title: '가족 공유 링크 생성 (선택)',
    description: '보호자가 직접 만든 공유 링크를 통해서만 열람할 수 있습니다.'
  }
];

export const DIRECTOR_EVENTS = [
  { id: 'weather_shift', label: '날씨 전환 (폭풍/눈)' },
  { id: 'blackout', label: '정전 이벤트' },
  { id: 'npc_prompt', label: 'NPC 즉흥 질문' },
  { id: 'mentor_dungeon_gate', label: '멘토 던전 문 열기' },
  { id: 'review_chest', label: '밀봉 복습 상자 소환' },
  { id: 'star_celebration', label: '별빛 축하 폭죽' }
] as const;

export interface AppProps {
  initialRoute?: AppRoute;
  initialShowChartTables?: boolean;
  initialReportState?: ParentReportState;
  /** Token from a /r/<token> parent report link. */
  initialReportToken?: string | null;
}

const SAMPLE_WEEKLY_FACTS: ReportFacts = {
  free_utterances: 42,
  total_valid_utterances: 60,
  weekly_free_ratio: 0.7,
  active_speaking_minutes: 18,
  mean_words_per_utterance: 5.5,
  think_speak_index: 118.4
};

const SAMPLE_CHART_POINTS = [
  { label: '1주', value: 24, note: '표본 수집 중' },
  { label: '2주', value: 34, note: '기준선 달성' },
  { label: '3주', value: 42, note: '카페·건축 주문 확대' }
];

export function ChildPlayPortal(): React.ReactElement {
  return React.createElement(
    'section',
    { 'data-testid': 'child-play-portal', style: { display: 'grid', gap: `${TOKENS.spacing[2]}px` } },
    React.createElement(
      Card,
      { title: '모험 시작하기' },
      React.createElement(
        'p',
        { style: { marginBottom: `${TOKENS.spacing[2]}px` } },
        '영어로 말해서 꿀차를 주문하고 내 부지에 집을 지어 보세요.'
      ),
      React.createElement(
        'div',
        { style: { display: 'flex', flexWrap: 'wrap', gap: `${TOKENS.spacing[2]}px` } },
        React.createElement(
          Button,
          {
            variant: 'brand',

            onClick: () => {
              if (typeof window !== 'undefined') window.location.assign('/game/');
            }
          },
          UX.site.openGame
        ),
        React.createElement(Button, { variant: 'paper', onClick: shareToParent }, UX.site.sendToParent)
      )
    )
  );
}

export function ParentDashboardView({
  initialShowTables = false
}: {
  initialShowTables?: boolean;
}): React.ReactElement {
  const [showTable, setShowTable] = useState(initialShowTables);
  const [consents, setConsents] = useState<Record<ConsentScope, boolean>>({
    voice_store: false,
    ai_report_draft: false,
    peer_multiplayer: false,
    clip_share: false
  });

  const summaryText = buildFactualWeeklySummary(SAMPLE_WEEKLY_FACTS);

  return React.createElement(
    'section',
    { 'data-testid': 'parent-dashboard', style: { display: 'grid', gap: `${TOKENS.spacing[3]}px` } },
    React.createElement(
      Card,
      { title: 'P01 주간 성장 요약' },
      React.createElement('p', null, summaryText)
    ),
    React.createElement(AccessibleChartWithTable, {
      title: 'P02 주간 스스로 발화 추이',
      unit: '문장',
      points: SAMPLE_CHART_POINTS,
      showTable,
      onToggleTable: () => setShowTable((prev) => !prev)
    }),
    React.createElement(
      Card,
      { title: 'P04 듣기 전용 수업 창 (Listen-Only)' },
      React.createElement(
        'p',
        null,
        '수업 진행 중에는 보호자의 듣기만 허용되며 마이크 송신 채널은 생성되지 않습니다.'
      )
    ),
    React.createElement(
      Card,
      { title: 'P05 Voice Museum (발화 기록 박물관)' },
      React.createElement(
        'p',
        null,
        consents.voice_store
          ? '동의된 전/후 비교 발화 클립 2건을 안전하게 재생할 수 있습니다.'
          : '음성 저장 동의를 켜면 첫 수업과 오늘의 문장을 나란히 들을 수 있습니다.'
      )
    ),
    React.createElement(
      Card,
      { title: 'P06 항목별 개별 동의 설정' },
      React.createElement(
        'div',
        { style: { display: 'grid', gap: `${TOKENS.spacing[1]}px` } },
        CONSENT_SCOPE_LABELS.map((item) =>
          React.createElement(
            'label',
            {
              key: item.scope,
              style: {
                display: 'flex',
                alignItems: 'center',
                gap: `${TOKENS.spacing[1]}px`,
                padding: `${TOKENS.spacing[1]}px`,
                border: `1px solid ${TOKENS.colors['line-200']}`
              }
            },
            React.createElement('input', {
              type: 'checkbox',
              checked: consents[item.scope],
              onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
                setConsents((prev) => ({ ...prev, [item.scope]: e.target.checked }))
            }),
            React.createElement(
              'span',
              null,
              `${item.title} — ${item.description}`
            )
          )
        )
      )
    )
  );
}

export const DEFAULT_PARENT_REPORT_STATE: ParentReportState = {
  reportId: 'rep_weekly_default',
  lessonDateLabel: '2026-11-15 (토) 120분 아크 수업',
  clipTitle: '찻집 물물교환 · 철광석 3개 ⇄ 따뜻한 꿀차 2잔 성사 순간',
  clipDurationLabel: '18초 (보호자 동의 시 재생)',
  studentMinutes: 22,
  freeWordsCount: 44,
  exchangesPer10Min: 4.8,
  densityBand: '목표 구간 달성 (20~35%)',
  anchorBeforeText: '1주 기준선: "I want warm honey tea please." (단문 요청)',
  anchorAfterText:
    '4주 현재: "Could we trade three iron ores for two warm honey teas so I stay warm?" (조건·목적 복문)',
  todayExpressions: [
    'If I trade three iron ores, could I get two warm honey teas so that I can stay warm?',
    'Would you trade four lanterns for my ruby so that I can light up my new room?',
    'Pull the red lever first so that the bridge opens safely.',
    'Wait! Let me check my floor map before pressing the blue switch.',
    'Please add a warm lantern beside my cozy workshop.'
  ],
  soloReusedCount: 4,
  totalTrackedExpressions: 6,
  verifiedBody:
    '이번 주 인식된 발화는 60건이며 직접 만들어 말한 발화는 42건(70%)입니다.',
  teacherComment:
    '오늘 물물교환과 멘토 던전 협동에서 because / so that 절을 스스로 연결해 말했습니다. 다음 수업 전 밀봉 상자 열기를 연습해 보세요.',
  nextLessonAt: '2026-11-22 (토) 오전 10:00',
  deliveryStatus: 'sent',
  shareToken: 'share-lcw-parent-01',
  sentAtMs: 1_763_200_000_000,
  openedAtMs: null,
  reminderSentAtMs: null,
  nextTargetsUpdated: false
};

export interface ParentReportViewProps {
  report: ParentReportState;
  onMarkOpened?: () => void;
  onBackToDirector?: () => void;
}

export function ParentReportView({
  report,
  onMarkOpened,
  onBackToDirector
}: ParentReportViewProps): React.ReactElement {
  useEffect(() => {
    if (
      onMarkOpened &&
      (report.deliveryStatus === 'sent' || report.deliveryStatus === 'reminder_sent') &&
      report.openedAtMs === null
    ) {
      onMarkOpened();
    }
  }, [onMarkOpened, report.deliveryStatus, report.openedAtMs]);

  const statusBadgeText =
    report.deliveryStatus === 'opened'
      ? '열람 확인됨 (교사 다음 수업 타깃 자동 갱신 완료)'
      : report.deliveryStatus === 'reminder_sent'
        ? '48시간 미열람 리마인드 발송됨'
        : report.deliveryStatus === 'sent'
          ? '발송 완료 (학부모 수신 확인 대기)'
          : '초안 작성 중';

  const statusBg =
    report.deliveryStatus === 'opened'
      ? TOKENS.colors.leaf
      : report.deliveryStatus === 'reminder_sent'
        ? TOKENS.colors.sun
        : TOKENS.colors.sky;

  return React.createElement(
    'section',
    {
      'data-testid': 'parent-report-view',
      style: { maxWidth: '640px', margin: '0 auto', display: 'grid', gap: `${TOKENS.spacing[2]}px` }
    },
    React.createElement(
      Card,
      { title: 'W09 주간·수업 성장 리포트', tone: 'tinted' },
      React.createElement(
        'div',
        {
          style: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: `${TOKENS.spacing[1]}px`,
            flexWrap: 'wrap',
            marginBottom: `${TOKENS.spacing[1]}px`
          }
        },
        React.createElement('span', null, `${report.lessonDateLabel} · 토큰 ${report.shareToken}`),
        React.createElement(
          'span',
          {
            'data-testid': 'report-delivery-badge',
            style: {
              padding: `2px ${TOKENS.spacing[1]}px`,
              backgroundColor: statusBg,
              color: TOKENS.colors['ink-900'],
              borderRadius: `${TOKENS.shape.radiusButtonPx}px`,
              border: `1px solid ${TOKENS.colors['ink-900']}`,
              fontWeight: 700
            }
          },
          statusBadgeText
        )
      ),
      report.deliveryStatus !== 'opened' && onMarkOpened
        ? React.createElement(
            Button,
            { variant: 'leaf', onClick: onMarkOpened },
            '수신 및 열람 확인 완료'
          )
        : null
    ),
    React.createElement(
      Card,
      { title: '1. 오늘의 대표 발화 클립' },
      React.createElement('strong', null, report.clipTitle),
      React.createElement('p', null, `재생 정보: ${report.clipDurationLabel}`)
    ),
    React.createElement(
      Card,
      { title: '2. 수업 핵심 숫자 지표' },
      React.createElement(
        'ul',
        null,
        React.createElement('li', null, `직접 말한 시간: ${report.studentMinutes}분`),
        React.createElement('li', null, `자유 말 뭉치(발화 단어 수): ${report.freeWordsCount}단어`),
        React.createElement('li', null, `10분당 영어 주고받기: ${report.exchangesPer10Min}회`),
        React.createElement('li', null, `발화 밀도 밴드: ${report.densityBand}`),
        React.createElement(
          'li',
          null,
          `혼자 플레이 재사용률: ${report.soloReusedCount}/${report.totalTrackedExpressions}`
        )
      )
    ),
    React.createElement(
      Card,
      { title: '3. 4주 고정 과제 전·후 비교' },
      React.createElement('p', null, report.anchorBeforeText),
      React.createElement('p', null, report.anchorAfterText)
    ),
    React.createElement(
      Card,
      { title: '4. 오늘 배운 핵심 표현 5개' },
      React.createElement(
        'ol',
        null,
        report.todayExpressions.map((expr) =>
          React.createElement(
            'li',
            { key: expr, style: { fontFamily: TOKENS.typography.fonts.target } },
            expr
          )
        )
      )
    ),
    React.createElement(
      Card,
      { title: '5. 사실 검증 리포트 & 선생님 코멘트' },
      React.createElement('p', null, `검증 요약: ${report.verifiedBody}`),
      React.createElement('p', null, `선생님 한마디: ${report.teacherComment}`),
      React.createElement(
        'p',
        null,
        `다음 수업 일정: ${report.nextLessonAt} | 다음 수업 타깃 반영: ${
          report.nextTargetsUpdated ? '완료' : '열람 시 자동 갱신'
        }`
      ),
      onBackToDirector
        ? React.createElement(
            Button,
            { variant: 'sky', onClick: onBackToDirector },
            '디렉터 콘솔(/director)로 돌아가기'
          )
        : null
    )
  );
}

type NpcId = 'cafe' | 'boutique' | 'makers_lab';
const NPC_IDS: readonly NpcId[] = ['cafe', 'boutique', 'makers_lab'];
const NPC_LABELS: Readonly<Record<string, string>> = {
  cafe: '카페 주인',
  boutique: '옷가게 주인',
  makers_lab: '메이커스 랩 주인'
};

export interface TeacherDirectorViewProps {
  reportState?: ParentReportState;
  onSendReportToParent?: (params: {
    verifiedBody: string;
    teacherComment: string;
    nextLessonAt: string;
    trackedExpressions: string[];
  }) => void;
  onTriggerReminder?: () => void;
  onOpenParentReportView?: () => void;
}

export function TeacherDirectorView({
  reportState,
  onSendReportToParent,
  onTriggerReminder,
  onOpenParentReportView
}: TeacherDirectorViewProps): React.ReactElement {
  const [possessedNpc, setPossessedNpc] = useState<NpcId | null>('cafe');
  const [bookmarks, setBookmarks] = useState<LessonBookmark[]>([]);
  const lessonStartRef = useRef<number>(Date.now());
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      handleDirectorKeydown(e, Date.now() - lessonStartRef.current, (b) =>
        setBookmarks((prev) => [...prev, b])
      );
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const trackerRef = useRef<LessonProgressionTracker | null>(null);
  if (!trackerRef.current) {
    trackerRef.current = new LessonProgressionTracker();
  }
  const tracker = trackerRef.current;
  const [, setTrackerTick] = useState(0);
  const [stageScriptSpoken, setStageScriptSpoken] = useState(false);
  const [soloChestNotice, setSoloChestNotice] = useState(
    '수업 말미에 봉인 상자를 심으면 학생의 주간 솔로 복습으로 이어집니다.'
  );

  const [scenarioIdx, setScenarioIdx] = useState(0);
  const [tradeStageIdx, setTradeStageIdx] = useState(0);
  const [selectedStars, setSelectedStars] = useState<1 | 2 | 3>(3);
  const [teacherSpoken, setTeacherSpoken] = useState(false);
  const [studentSpoken, setStudentSpoken] = useState(false);
  const [tradeSettled, setTradeSettled] = useState(false);
  const [studentCoins, setStudentCoins] = useState(300);
  const [tradeNotice, setTradeNotice] = useState(
    '선생님 회화 대본을 읽고 발화 완료를 누른 뒤, 학생 발화와 함께 물물교환을 확정하세요.'
  );

  const [pins, setPins] = useState<Array<{ kind: 'E' | 'C' | 'H'; note: string }>>([
    { kind: 'E', note: 'Can I have a warm honey tea so I stay warm?' }
  ]);
  const [triggeredEvents, setTriggeredEvents] = useState<string[]>([]);
  const [dungeonTeacherClue, setDungeonTeacherClue] = useState(
    'Pull the red lever first so that the bridge opens.'
  );
  const [dungeonStudentAction, setDungeonStudentAction] = useState(
    'I will pull the red lever carefully.'
  );
  const [dungeonNotice, setDungeonNotice] = useState(
    '교사(지도 단서)와 학생(행동 발화) 양쪽이 모두 말하면 던전 문이 열립니다.'
  );

  const [reportDraft, setReportDraft] = useState(
    '이번 주 인식된 발화는 60건이며 직접 만들어 말한 발화는 42건(70%)입니다.'
  );
  const [teacherComment, setTeacherComment] = useState(DEFAULT_PARENT_REPORT_STATE.teacherComment);
  const [nextLessonAt, setNextLessonAt] = useState(DEFAULT_PARENT_REPORT_STATE.nextLessonAt);
  const [localReport, setLocalReport] = useState<ParentReportState>(DEFAULT_PARENT_REPORT_STATE);

  const effectiveReport = reportState ?? localReport;
  const reportVerify = verifyOrReplaceReportBody(SAMPLE_WEEKLY_FACTS, reportDraft);

  const scenario = TEACHER_STUDENT_TRADE_SCENARIOS[scenarioIdx] ?? TEACHER_STUDENT_TRADE_SCENARIOS[0]!;
  const tradeGuide =
    scenario.teacherGuideStages[tradeStageIdx] ?? scenario.teacherGuideStages[0]!;
  const currentArcGuide = tracker.getCurrentGuide();
  const arcStages = tracker.getAllProgress();

  const handleCompleteStage = () => {
    tracker.completeCurrentStage(`NPC=${possessedNpc ?? 'none'} 확인 완료`);
    setStageScriptSpoken(false);
    setTrackerTick((n) => n + 1);
  };

  const handlePlantChest = () => {
    const chestExpr = scenario.studentOffers[2]?.text ?? scenario.studentOffers[0]!.text;
    tracker.plantSealedChest({
      id: `chest_${tracker.sealedChests.length + 1}`,
      expression: chestExpr,
      rewardCoins: 25
    });
    tracker.setCampaignNote(`${scenario.titleKo} 차기 솔로 연계`);
    setSoloChestNotice(`봉인 상자 매설 완료: "${chestExpr}" (보상 25코인)`);
    setTrackerTick((n) => n + 1);
  };

  const handleSimulateSoloUnlock = () => {
    if (tracker.sealedChests.length === 0) {
      handlePlantChest();
    }
    const targetExpr =
      tracker.sealedChests[0]?.expression ??
      scenario.studentOffers[2]?.text ??
      scenario.studentOffers[0]!.text;
    const res = tracker.unlockSealedChestByExpression(targetExpr, 1_763_250_000_000);
    setSoloChestNotice(
      res.unlockedCount > 0
        ? `솔로 복습 해금 성공: ${res.unlockedIds.join(', ')} (+${res.rewardCoins}코인)`
        : '이미 모든 봉인 상자가 해금되었습니다.'
    );
    setTrackerTick((n) => n + 1);
  };

  const handleExecuteTrade = () => {
    const settlement = calculateTradeSettlement({
      baseValueCoins: scenario.teacherGives.baseValueCoins,
      stars: selectedStars,
      teacherSpoken,
      studentSpoken,
      studentPassed: true,
      studentCoins
    });
    if (!settlement.settled) {
      setTradeNotice(
        settlement.reason === 'insufficient_coins_for_fee'
          ? `코인이 부족합니다 (필요 수수료 ${settlement.feeCoins}코인).`
          : '교사와 학생 양쪽 발화가 모두 완료되어야 물물교환이 성사됩니다.'
      );
      return;
    }
    const nextCoins = studentCoins - settlement.feeCoins;
    setStudentCoins(nextCoins);
    setTradeSettled(true);
    const chosenOffer =
      scenario.studentOffers.find((o) => o.stars === selectedStars) ?? scenario.studentOffers[0]!;
    setPins((prev) => [...prev, { kind: 'E', note: chosenOffer.text }]);
    setTradeNotice(
      `물물교환 성사: ${scenario.studentGives.nameKo} ⇄ ${scenario.teacherGives.nameKo} | 수수료 ${settlement.feeCoins}코인 (남은 코인 ${nextCoins})`
    );
  };

  const handleEvaluateDungeon = () => {
    const res = evaluateMentorDungeonGate({
      hazardCode: 'switch_maze_01',
      teacherPromptText: dungeonTeacherClue,
      studentActionText: dungeonStudentAction
    });
    setDungeonNotice(
      res.gateOpened
        ? `멘토 던전 문 개방 완료 (${res.hazardCode}) — 교사 단서와 학생 행동 발화 동기화됨`
        : `아직 닫혀 있음 (${res.reason})`
    );
  };

  const handleSendReport = () => {
    const trackedExpressions = pins.filter((p) => p.kind === 'E').map((p) => p.note).slice(0, 5);
    if (onSendReportToParent) {
      onSendReportToParent({
        verifiedBody: reportVerify.body,
        teacherComment,
        nextLessonAt,
        trackedExpressions
      });
      return;
    }
    setLocalReport((prev) => ({
      ...prev,
      verifiedBody: reportVerify.body,
      teacherComment,
      nextLessonAt,
      todayExpressions: trackedExpressions.length > 0 ? trackedExpressions : prev.todayExpressions,
      deliveryStatus: 'sent',
      sentAtMs: 1_763_200_000_000,
      openedAtMs: null,
      nextTargetsUpdated: false
    }));
  };

  const handleReminder = () => {
    if (onTriggerReminder) {
      onTriggerReminder();
      return;
    }
    setLocalReport((prev) => ({
      ...prev,
      deliveryStatus: prev.openedAtMs ? prev.deliveryStatus : 'reminder_sent',
      reminderSentAtMs: 1_763_373_000_000
    }));
  };

  return React.createElement(
    'section',
    { 'data-testid': 'teacher-director-console', style: { display: 'grid', gap: `${TOKENS.spacing[3]}px` } },
    React.createElement(
      Card,
      { title: 'T01 120분 7단계 연속 수업 아크 & NPC 빙의' },
      React.createElement(
        'div',
        { style: { display: 'flex', gap: `${TOKENS.spacing[1]}px`, flexWrap: 'wrap', marginBottom: `${TOKENS.spacing[2]}px` } },
        NPC_IDS.map((ctx) =>
          React.createElement(
            Button,
            {
              key: ctx,
              variant: possessedNpc === ctx ? 'brand' : 'paper',
              onClick: () => setPossessedNpc(ctx)
            },
            `NPC 빙의: ${ctx}`
          )
        )
      ),
      React.createElement(PossessionPanel, {
        possessedNpc,
        npcIds: NPC_IDS,
        npcLabels: NPC_LABELS,
        onRelease: () => setPossessedNpc(null)
      }),
      React.createElement(DirectorBookmarkPanel, { bookmarks }),
      React.createElement(
        'div',
        {
          style: {
            display: 'flex',
            gap: `${TOKENS.spacing[1]}px`,
            flexWrap: 'wrap',
            marginBottom: `${TOKENS.spacing[2]}px`
          }
        },
        arcStages.map((stage) =>
          React.createElement(
            'span',
            {
              key: stage.id,
              style: {
                padding: `2px ${TOKENS.spacing[1]}px`,
                borderRadius: `${TOKENS.shape.radiusButtonPx}px`,
                border: `1px solid ${TOKENS.colors['ink-900']}`,
                backgroundColor:
                  stage.status === 'completed'
                    ? TOKENS.colors.leaf
                    : stage.status === 'current'
                      ? TOKENS.colors.sun
                      : TOKENS.colors['paper-100']
              }
            },
            `${stage.titleKo} (${stage.minuteRange}) · ${
              stage.status === 'completed' ? '완료' : stage.status === 'current' ? '진행중' : '대기'
            }`
          )
        )
      ),
      React.createElement(TeacherScriptBanner, {
        stageTitle: `${currentArcGuide.titleKo} (${currentArcGuide.minuteRange})`,
        teacherLineEn: currentArcGuide.teacherScriptEn,
        coachingTipKo: `${currentArcGuide.studentGoalKo} · 완료 기준: ${currentArcGuide.completionCriteriaKo}`,
        hintPhrases: [currentArcGuide.id],
        spokenDone: stageScriptSpoken,
        onMarkSpoken: () => setStageScriptSpoken(true)
      }),
      React.createElement(
        'div',
        { style: { display: 'flex', gap: `${TOKENS.spacing[1]}px`, flexWrap: 'wrap', marginTop: `${TOKENS.spacing[2]}px` } },
        React.createElement(
          Button,
          { variant: 'brand', onClick: handleCompleteStage },
          '현재 단계 완료 → 다음 단계'
        ),
        React.createElement(
          Button,
          { variant: 'sky', onClick: handlePlantChest },
          '봉인 복습 상자 심기 (차기 솔로 복습용)'
        ),
        React.createElement(
          Button,
          { variant: 'leaf', onClick: handleSimulateSoloUnlock },
          '솔로 복습 발화로 상자 해금 시뮬레이션'
        )
      ),
      React.createElement(
        'p',
        { style: { marginTop: `${TOKENS.spacing[1]}px` } },
        `매설된 봉인 상자: ${tracker.sealedChests.length}개 | 다음 수업 자동 타깃: ${
          tracker.nextLessonTargets.length
        }건 | ${soloChestNotice}`
      )
    ),
    React.createElement(
      Card,
      { title: '선생-학생 물물교환 & 회화 대본 콘솔' },
      React.createElement(
        'div',
        { style: { display: 'flex', gap: `${TOKENS.spacing[1]}px`, flexWrap: 'wrap', marginBottom: `${TOKENS.spacing[2]}px` } },
        TEACHER_STUDENT_TRADE_SCENARIOS.map((item, idx) =>
          React.createElement(
            Button,
            {
              key: item.id,
              variant: scenarioIdx === idx ? 'brand' : 'paper',
              onClick: () => {
                setScenarioIdx(idx);
                setTradeStageIdx(0);
                setTeacherSpoken(false);
                setStudentSpoken(false);
                setTradeSettled(false);
              }
            },
            item.titleKo
          )
        )
      ),
      React.createElement(
        'div',
        { style: { display: 'flex', gap: `${TOKENS.spacing[1]}px`, flexWrap: 'wrap', marginBottom: `${TOKENS.spacing[2]}px` } },
        scenario.teacherGuideStages.map((st, idx) =>
          React.createElement(
            Button,
            {
              key: st.stage,
              variant: tradeStageIdx === idx ? 'sky' : 'paper',
              onClick: () => setTradeStageIdx(idx)
            },
            st.titleKo
          )
        )
      ),
      React.createElement(TeacherScriptBanner, {
        stageTitle: `${scenario.npcRoleKo} · ${tradeGuide.titleKo}`,
        teacherLineEn: tradeGuide.teacherLineEn,
        coachingTipKo: tradeGuide.coachingTipKo,
        hintPhrases: [scenario.openFollowUpEn],
        spokenDone: teacherSpoken,
        onMarkSpoken: () => setTeacherSpoken(true)
      }),
      React.createElement(
        'div',
        { style: { marginTop: `${TOKENS.spacing[2]}px` } },
        React.createElement(BilateralTradePanel, {
          role: 'teacher',
          title: scenario.titleKo,
          npcRoleLabel: scenario.npcRoleKo,
          studentGivesLabel: scenario.studentGives.nameKo,
          teacherGivesLabel: scenario.teacherGives.nameKo,
          baseValueCoins: scenario.teacherGives.baseValueCoins,
          selectedStars,
          offers: scenario.studentOffers,
          teacherSpoken,
          studentSpoken,
          settled: tradeSettled,
          settlementNotice: tradeNotice,
          onSelectStars: (stars) => {
            setSelectedStars(stars);
            setTradeSettled(false);
          },
          onTeacherSpeak: () => setTeacherSpoken(true),
          onStudentSpeak: () => setStudentSpoken(true),
          onExecuteTrade: handleExecuteTrade
        })
      )
    ),
    React.createElement(
      Card,
      { title: 'T02 디렉터 이벤트 6종 & E/C/H 핀 & 멘토 던전 정보 격차 (WP-311)' },
      React.createElement(
        'div',
        { style: { display: 'flex', gap: `${TOKENS.spacing[1]}px`, flexWrap: 'wrap', marginBottom: `${TOKENS.spacing[2]}px` } },
        DIRECTOR_EVENTS.map((ev) =>
          React.createElement(
            Button,
            {
              key: ev.id,
              variant: 'sky',
              onClick: () => setTriggeredEvents((prev) => [...prev, ev.label])
            },
            ev.label
          )
        )
      ),
      React.createElement(
        'div',
        { style: { display: 'flex', gap: `${TOKENS.spacing[1]}px`, flexWrap: 'wrap', marginBottom: `${TOKENS.spacing[2]}px` } },
        (['E', 'C', 'H'] as const).map((kind) =>
          React.createElement(
            Button,
            {
              key: kind,
              variant: 'leaf',
              onClick: () =>
                setPins((prev) => [...prev, { kind, note: `${kind} 핀 기록 (${prev.length + 1})` }])
            },
            `${kind} 핀 추가`
          )
        )
      ),
      React.createElement(
        'p',
        { style: { marginBottom: `${TOKENS.spacing[2]}px` } },
        `활성 이벤트: ${triggeredEvents.join(', ') || '없음'} | 핀 수: ${pins.length}`
      ),
      React.createElement(
        'div',
        {
          style: {
            display: 'grid',
            gap: `${TOKENS.spacing[1]}px`,
            padding: `${TOKENS.spacing[2]}px`,
            backgroundColor: TOKENS.colors['paper-50'],
            border: `1px solid ${TOKENS.colors['line-200']}`,
            borderRadius: `${TOKENS.shape.radiusButtonPx}px`
          }
        },
        React.createElement('strong', null, '멘토 던전 정보 격차 협동 검증'),
        React.createElement('input', {
          type: 'text',
          'aria-label': '교사 지도 단서 문장',
          value: dungeonTeacherClue,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDungeonTeacherClue(e.target.value)
        }),
        React.createElement('input', {
          type: 'text',
          'aria-label': '학생 행동 응답 문장',
          value: dungeonStudentAction,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDungeonStudentAction(e.target.value)
        }),
        React.createElement(
          Button,
          { variant: 'brand', onClick: handleEvaluateDungeon },
          '정보 격차 던전 게이트 판정 (WP-311)'
        ),
        React.createElement('p', null, dungeonNotice)
      )
    ),
    React.createElement(
      Card,
      { title: 'T03 사실 검증 리포트 & 학부모 발송/수신 추적' },
      React.createElement('textarea', {
        value: reportDraft,
        onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => setReportDraft(e.target.value),
        rows: 3,
        style: { width: '100%' }
      }),
      React.createElement(
        'p',
        null,
        `검증 결과: ${reportVerify.ok ? '사실 일치' : `자동 치환됨 (${reportVerify.reasons.join(', ')})`} -> ${reportVerify.body}`
      ),
      React.createElement(
        'div',
        { style: { display: 'grid', gap: `${TOKENS.spacing[1]}px`, marginTop: `${TOKENS.spacing[1]}px` } },
        React.createElement('input', {
          type: 'text',
          'aria-label': '선생님 코멘트',
          value: teacherComment,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setTeacherComment(e.target.value)
        }),
        React.createElement('input', {
          type: 'text',
          'aria-label': '다음 수업 일정',
          value: nextLessonAt,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setNextLessonAt(e.target.value)
        })
      ),
      React.createElement(
        'div',
        { style: { display: 'flex', gap: `${TOKENS.spacing[1]}px`, flexWrap: 'wrap', marginTop: `${TOKENS.spacing[2]}px` } },
        React.createElement(
          Button,
          { variant: 'brand', onClick: handleSendReport },
          '학부모에게 리포트 발송'
        ),
        React.createElement(
          Button,
          { variant: 'sky', onClick: handleReminder },
          '48시간 미열람 재알림 테스트'
        ),
        onOpenParentReportView
          ? React.createElement(
              Button,
              { variant: 'leaf', onClick: onOpenParentReportView },
              '학부모 수신 화면(/report) 열어서 열람 확인하기'
            )
          : null
      ),
      React.createElement(
        'p',
        { style: { marginTop: `${TOKENS.spacing[1]}px` } },
        `발송 상태: ${effectiveReport.deliveryStatus} | 공유 토큰: ${effectiveReport.shareToken} | 열람 여부: ${
          effectiveReport.openedAtMs ? '열람 완료' : '미열람'
        } | 다음 수업 타깃 갱신: ${effectiveReport.nextTargetsUpdated ? '완료' : '대기'}`
      )
    )
  );
}

export function App({
  initialRoute = '/',
  initialShowChartTables = false,
  initialReportState,
  initialReportToken = null
}: AppProps): React.ReactElement {
  const [route, setRouteState] = useState<AppRoute>(initialRoute);
  const [reportToken, setReportToken] = useState<string | null>(initialReportToken);
  const [tryPassed, setTryPassed] = useState(false);
  const setRoute = (r: AppRoute) => {
    setRouteState(r);
    if (typeof window !== 'undefined' && window.location.pathname !== r) window.history.pushState(null, '', r);
  };
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onPop = () => {
      const p = (window.location.pathname.replace(/\/+$/, '') || '/') as AppRoute;
      const token = reportTokenFromPath(window.location.pathname);
      setRouteState(token ? '/r' : p);
      setReportToken(token);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const [reportState, setReportState] = useState<ParentReportState>(
    initialReportState ?? DEFAULT_PARENT_REPORT_STATE
  );

  const isPublic = PUBLIC_NAV.some((n) => n.route === route);
  const navItems = PUBLIC_NAV;

  const handleMarkReportOpened = () => {
    setReportState((prev) => ({
      ...prev,
      deliveryStatus: 'opened',
      openedAtMs: prev.openedAtMs ?? 1_763_205_000_000,
      nextTargetsUpdated: true
    }));
  };

  return React.createElement(
    'div',
    {
      style: {
        minHeight: '100vh',
        backgroundColor: TOKENS.colors['paper-50'],
        color: TOKENS.colors['ink-900'],
        fontFamily: TOKENS.typography.fonts.ui,
        padding: `${TOKENS.spacing[3]}px`
      }
    },
    route !== '/play' && route !== '/try' && route !== '/guest-end' && route !== '/join' && route !== '/r'
      ? React.createElement(
          'nav',
          {
            'aria-label': '주요 메뉴',
            style: {
              display: 'flex',
              flexWrap: 'wrap',
              gap: `${TOKENS.spacing[1]}px`,
              marginBottom: `${TOKENS.spacing[3]}px`
            }
          },
          isPublic
            ? navItems.map((item) =>
                React.createElement(
                  Button,
                  {
                    key: item.route,
                    variant: route === item.route ? 'brand' : 'paper',
                    onClick: () => setRoute(item.route)
                  },
                  item.label
                )
              )
            : React.createElement(Button, { variant: 'paper', onClick: () => setRoute('/') }, UX.site.backHome)
        )
      : null,
    route === '/play' && React.createElement(ChildPlayPortal),
    route === '/join' && React.createElement(StudentJoin, null),
    route === '/family' && React.createElement(FamilyPage, null),
    route === '/link' && React.createElement(DeviceLinkPage, null),
    route === '/r' &&
      (reportToken
        ? React.createElement(ParentReportPage, { key: reportToken, token: reportToken })
        : React.createElement(ParentReportPage, {
            token: '',
            initial: { status: 'not_found' }
          })),
    route === '/try' &&
      React.createElement(
        Panel,
        null,
        React.createElement('h1', null, '가입 없이 5분 브라우저 체험'),
        React.createElement('p', null, '찻집에서 영어로 주문하고 내 부지에 집을 지어 보세요.'),
        React.createElement(TryExperience, { onPassed: () => setTryPassed(true) }),
        tryPassed ? React.createElement(GuestPassEndModal, { shareUrl: '/parents' }) : null
      ),
    route === '/guest-end' && React.createElement(GuestPassEndScreen, null),
    route === '/claim' && React.createElement(GuestClaimCard, null),
    route === '/window' && React.createElement(ParentLessonWindowView, null),
    route === '/parents' &&
      React.createElement(
        Card,
        { title: 'W04 부모·가족 요금 및 7일 환불 정책' },
        React.createElement(
          'ul',
          null,
          React.createElement('li', null, 'Solo (1좌석): 월 14,900원 / 연 119,000원 (언제든 마이페이지에서 즉시 해지 가능)'),
          React.createElement(
            'li',
            null,
            'Duo (2좌석): 월 19,900원 / 연 159,000원 (좌석 추가: 월 7,000원 / 연 59,000원)'
          ),
          React.createElement('li', null, '결제 후 7일 이내 전액 환불 및 연간 갱신 7일 전 사전 알림')
        )
      ),
    route === '/safety' &&
      React.createElement(
        Card,
        { title: 'W05 5중 안전 장치 및 아동 개인정보 보호' },
        React.createElement(
          'p',
          null,
          '모든 AI 생성 규칙은 G1-G5 검문과 격자 경계를 통과하며, 아이의 음성은 개별 동의 없이 저장되거나 모델 학습에 쓰이지 않습니다.'
        )
      ),
    route === '/teachers' &&
      React.createElement(
        Card,
        { title: 'W06 선생님 디렉터 좌석 안내' },
        React.createElement(
          'p',
          null,
          '튜터 좌석은 월 25,000원 정액이며, 선생님이 직접 학생과 진행하는 수업료 수수료는 0%입니다.'
        )
      ),
    route === '/worlds' &&
      React.createElement(
        Card,
        { title: 'W07 정적 쇼룸 월드 둘러보기' },
        React.createElement(
          'p',
          null,
          '차분한 파스텔 블록 건축 샘플과 잉글리시 코어 광장 건축물을 살펴볼 수 있습니다.'
        )
      ),
    route === '/pass' &&
      React.createElement(
        Card,
        { title: 'W08 친구 게스트 패스 (60분)' },
        React.createElement('p', null, '승인된 친구 월드로 안전하게 입장합니다.')
      ),
    route === '/report' &&
      React.createElement(ParentReportView, {
        report: reportState,
        onMarkOpened: handleMarkReportOpened,
        onBackToDirector: () => setRoute('/director')
      }),
    route === '/dashboard' &&
      React.createElement(ParentDashboardView, { initialShowTables: initialShowChartTables }),
    route === '/director' &&
      React.createElement(LessonDirectorConsole, {
        demo: React.createElement(TeacherDirectorView, {
        reportState,
        onSendReportToParent: ({ verifiedBody, teacherComment, nextLessonAt, trackedExpressions }) => {
          setReportState((prev) => ({
            ...prev,
            verifiedBody,
            teacherComment,
            nextLessonAt,
            todayExpressions:
              trackedExpressions.length > 0 ? trackedExpressions : prev.todayExpressions,
            deliveryStatus: 'sent',
            sentAtMs: 1_763_200_000_000,
            openedAtMs: null,
            nextTargetsUpdated: false
          }));
        },
        onTriggerReminder: () => {
          setReportState((prev) => ({
            ...prev,
            deliveryStatus: prev.openedAtMs ? prev.deliveryStatus : 'reminder_sent',
            reminderSentAtMs: 1_763_373_000_000
          }));
        },
        onOpenParentReportView: () => setRoute('/report')
        })
      }),
    route === '/' &&
      React.createElement(
        Panel,
        null,
        React.createElement('h1', null, UX.site.heroTitle),
        React.createElement('p', { style: { marginBottom: `${TOKENS.spacing[3]}px` } }, UX.site.heroBody),
        React.createElement(
          'div',
          { style: { display: 'flex', flexWrap: 'wrap', gap: `${TOKENS.spacing[2]}px`, marginBottom: `${TOKENS.spacing[3]}px` } },
          React.createElement(Button, { variant: 'brand', onClick: () => setRoute('/parents') }, UX.site.forParents),
          React.createElement(Button, { variant: 'sky', onClick: () => setRoute('/play') }, UX.site.forPlayers)
        ),
        React.createElement(
          'div',
          {
            style: {
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
              gap: `${TOKENS.spacing[2]}px`,
              marginBottom: `${TOKENS.spacing[3]}px`
            }
          },
          UX.site.steps.map((st) =>
            React.createElement(Card, { key: st.title, title: st.title }, React.createElement('p', { lang: 'en' }, st.body))
          )
        ),
        React.createElement(Button, { variant: 'leaf', onClick: () => setRoute('/try') }, UX.site.tryCta)
      )
  );
}
