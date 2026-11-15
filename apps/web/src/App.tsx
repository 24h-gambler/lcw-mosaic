import React, { useState } from 'react';
import {
  AccessibleChartWithTable,
  Button,
  Card,
  GuestPassEndModal,
  Panel,
  TOKENS
} from '@lcw/ui';
import {
  buildFactualWeeklySummary,
  verifyOrReplaceReportBody,
  type ReportFacts
} from '@lcw/metrics';

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
  | '/director';

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
      React.createElement(GuestPassEndModal, { shareUrl: '/report' })
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

export function TeacherDirectorView(): React.ReactElement {
  const [possessedNpc, setPossessedNpc] = useState<'cafe' | 'boutique' | 'makers_lab'>('cafe');
  const [pins, setPins] = useState<Array<{ kind: 'E' | 'C' | 'H'; note: string }>>([
    { kind: 'E', note: 'Can I have a warm honey tea so I stay warm?' }
  ]);
  const [triggeredEvents, setTriggeredEvents] = useState<string[]>([]);
  const [reportDraft, setReportDraft] = useState(
    '이번 주 인식된 발화는 60건이며 직접 만들어 말한 발화는 42건(70%)입니다.'
  );
  const reportVerify = verifyOrReplaceReportBody(SAMPLE_WEEKLY_FACTS, reportDraft);

  return React.createElement(
    'section',
    { 'data-testid': 'teacher-director-console', style: { display: 'grid', gap: `${TOKENS.spacing[3]}px` } },
    React.createElement(
      Card,
      { title: 'T01 120분 디렉터 콘솔 & NPC 빙의' },
      React.createElement(
        'div',
        { style: { display: 'flex', gap: `${TOKENS.spacing[1]}px`, flexWrap: 'wrap' } },
        (['cafe', 'boutique', 'makers_lab'] as const).map((ctx) =>
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
      )
    ),
    React.createElement(
      Card,
      { title: 'T02 디렉터 이벤트 6종 & E/C/H 타임라인 핀' },
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
        { style: { display: 'flex', gap: `${TOKENS.spacing[1]}px` } },
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
        { style: { marginTop: `${TOKENS.spacing[1]}px` } },
        `활성 이벤트: ${triggeredEvents.join(', ') || '없음'} | 핀 수: ${pins.length}`
      )
    ),
    React.createElement(
      Card,
      { title: 'T03 사실 검증 리포트 초안 편집기' },
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
      )
    )
  );
}

export function App({
  initialRoute = '/',
  initialShowChartTables = false
}: AppProps): React.ReactElement {
  const [route, setRoute] = useState<AppRoute>(initialRoute);

  const navItems: Array<{ route: AppRoute; label: string }> = [
    { route: '/', label: '소개 (W01)' },
    { route: '/try', label: '5분 바로 체험 (W02)' },
    { route: '/play', label: '아이 화면 (W03)' },
    { route: '/parents', label: '부모 안내 (W04)' },
    { route: '/safety', label: '안전·개인정보 (W05)' },
    { route: '/teachers', label: '선생님 안내 (W06)' },
    { route: '/worlds', label: '월드 구경 (W07)' },
    { route: '/dashboard', label: '부모 대시보드 (P01)' },
    { route: '/director', label: '디렉터 콘솔 (T02)' }
  ];

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
    route !== '/play' && route !== '/try'
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
          navItems.map((item) =>
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
        )
      : null,
    route === '/play' && React.createElement(ChildPlayPortal),
    route === '/try' &&
      React.createElement(
        Panel,
        null,
        React.createElement('h1', null, '가입 없이 5분 브라우저 체험'),
        React.createElement('p', null, '찻집에서 영어로 주문하고 내 부지에 집을 지어 보세요.'),
        React.createElement(GuestPassEndModal, { shareUrl: '/report' })
      ),
    route === '/parents' &&
      React.createElement(
        Card,
        { title: 'W04 부모·가족 요금 및 14일 환불 정책' },
        React.createElement(
          'ul',
          null,
          React.createElement('li', null, '솔로 패스: 월 19,900원 (언제든 마이페이지에서 즉시 해지 가능)'),
          React.createElement('li', null, '듀오 패스: 월 29,900원 (동반 가족 추가 +9,900원)'),
          React.createElement('li', null, '14일 이내 무조건 전액 환불 및 갱신 7일 전 사전 알림')
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
      React.createElement(
        Card,
        { title: 'W09 주간 성장 리포트 공유 카드' },
        React.createElement('p', null, buildFactualWeeklySummary(SAMPLE_WEEKLY_FACTS))
      ),
    route === '/dashboard' &&
      React.createElement(ParentDashboardView, { initialShowTables: initialShowChartTables }),
    route === '/director' && React.createElement(TeacherDirectorView),
    route === '/' &&
      React.createElement(
        Panel,
        null,
        React.createElement('h1', null, '모자이크 월드 — 3D 영어 회화 샌드박스'),
        React.createElement(
          'p',
          null,
          '필요할 때 직접 영어로 주문하고, 블록을 쌓고, 안전하게 다시 쓰는 개방형 세계입니다.'
        )
      )
  );
}
