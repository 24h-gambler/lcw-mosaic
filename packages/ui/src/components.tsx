import React from 'react';
import { TOKENS, type ColorTokenName } from './tokens.js';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'brand' | 'sky' | 'leaf' | 'danger' | 'paper';
  size?: 'standard' | 'game' | 'mic';
  children?: React.ReactNode;
}

export function Button({
  variant = 'brand',
  size = 'standard',
  style,
  children,
  ...rest
}: ButtonProps): React.ReactElement {
  const palette: Record<
    NonNullable<ButtonProps['variant']>,
    { bg: ColorTokenName; fg: ColorTokenName }
  > = {
    brand: { bg: 'brand-d', fg: 'paper-0' },
    sky: { bg: 'sky-d', fg: 'paper-0' },
    leaf: { bg: 'leaf-d', fg: 'paper-0' },
    danger: { bg: 'danger-d', fg: 'paper-0' },
    paper: { bg: 'paper-0', fg: 'ink-900' }
  };

  const minHeight =
    size === 'mic'
      ? TOKENS.shape.micButtonPx
      : size === 'game'
        ? TOKENS.shape.gameButtonMinPx
        : TOKENS.shape.touchTargetMinPx;

  const chosen = palette[variant];
  return React.createElement(
    'button',
    {
      ...rest,
      style: {
        backgroundColor: TOKENS.colors[chosen.bg],
        color: TOKENS.colors[chosen.fg],
        border: `${TOKENS.shape.borderWidthPx}px solid ${TOKENS.colors['ink-900']}`,
        borderRadius: `${TOKENS.shape.radiusButtonPx}px`,
        boxShadow: TOKENS.shape.shadowDefault,
        minHeight: `${minHeight}px`,
        minWidth: `${minHeight}px`,
        padding: `${TOKENS.spacing[2]}px ${TOKENS.spacing[3]}px`,
        fontFamily: TOKENS.typography.fonts.ui,
        fontSize: `${TOKENS.typography.scale.body.sizePx}px`,
        fontWeight: 700,
        cursor: 'pointer',
        ...style
      }
    },
    children
  );
}

export interface CardProps {
  title?: string;
  tone?: 'paper' | 'tinted' | 'night';
  children?: React.ReactNode;
}

export function Card({ title, tone = 'paper', children }: CardProps): React.ReactElement {
  const bg =
    tone === 'night'
      ? TOKENS.colors['night-900']
      : tone === 'tinted'
        ? TOKENS.colors['paper-100']
        : TOKENS.colors['paper-0'];
  const fg = tone === 'night' ? TOKENS.colors['paper-0'] : TOKENS.colors['ink-900'];

  return React.createElement(
    'section',
    {
      style: {
        backgroundColor: bg,
        color: fg,
        border: `${TOKENS.shape.borderWidthPx}px solid ${TOKENS.colors['ink-900']}`,
        borderRadius: `${TOKENS.shape.radiusCardPx}px`,
        boxShadow: TOKENS.shape.shadowDefault,
        padding: `${TOKENS.spacing[3]}px`
      }
    },
    title
      ? React.createElement(
          'h3',
          {
            style: {
              margin: `0 0 ${TOKENS.spacing[2]}px 0`,
              fontSize: `${TOKENS.typography.scale.h3.sizePx}px`,
              lineHeight: `${TOKENS.typography.scale.h3.lineHeightPx}px`
            }
          },
          title
        )
      : null,
    children
  );
}

export interface PanelProps {
  children?: React.ReactNode;
}

export function Panel({ children }: PanelProps): React.ReactElement {
  return React.createElement(
    'div',
    {
      style: {
        backgroundColor: TOKENS.colors['paper-50'],
        color: TOKENS.colors['ink-900'],
        border: `${TOKENS.shape.borderWidthPx}px solid ${TOKENS.colors['ink-900']}`,
        borderRadius: `${TOKENS.shape.radiusCardPx}px`,
        padding: `${TOKENS.spacing[4]}px`,
        fontFamily: TOKENS.typography.fonts.ui
      }
    },
    children
  );
}

export interface StarOfferCardProps {
  stars: 1 | 2 | 3;
  sentence: string;
  price: number;
  bonus?: string | null;
  selected?: boolean;
  fontScale?: number;
  onSelect?: () => void;
}

export function StarOfferCard({
  stars,
  sentence,
  price,
  bonus,
  selected = false,
  fontScale = 1,
  onSelect
}: StarOfferCardProps): React.ReactElement {
  const starMeta = TOKENS.semantic.stars[stars];
  const targetPx = Math.max(
    TOKENS.typography.targetSentenceMinPx,
    Math.round(TOKENS.typography.scale.h3.sizePx * fontScale)
  );

  return React.createElement(
    'button',
    {
      type: 'button',
      onClick: onSelect,
      'aria-pressed': selected,
      style: {
        display: 'flex',
        width: '100%',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: `${TOKENS.spacing[2]}px`,
        textAlign: 'left',
        backgroundColor: selected ? TOKENS.colors[starMeta.color] : TOKENS.colors['paper-0'],
        color: TOKENS.colors['ink-900'],
        border: `${starMeta.borderWidthPx + 1}px solid ${TOKENS.colors['ink-900']}`,
        borderRadius: `${TOKENS.shape.radiusButtonPx}px`,
        padding: `${TOKENS.spacing[2]}px ${TOKENS.spacing[3]}px`,
        cursor: 'pointer'
      }
    },
    React.createElement(
      'span',
      { style: { fontWeight: 700, minWidth: '88px' } },
      `${'★'.repeat(starMeta.starCount)} ${price} 코인`
    ),
    React.createElement(
      'span',
      {
        style: {
          flex: 1,
          fontFamily: TOKENS.typography.fonts.target,
          fontSize: `${targetPx}px`,
          lineHeight: `${Math.round(targetPx * 1.3)}px`
        }
      },
      sentence
    ),
    bonus
      ? React.createElement(
          'span',
          {
            style: {
              backgroundColor: TOKENS.colors['grape-d'],
              color: TOKENS.colors['paper-0'],
              padding: `2px ${TOKENS.spacing[1]}px`,
              borderRadius: `${TOKENS.shape.radiusButtonPx}px`,
              fontSize: `${TOKENS.typography.scale.micro.sizePx}px`
            }
          },
          bonus
        )
      : null
  );
}

export interface GaugeBarProps {
  kind: keyof typeof TOKENS.semantic.gauge;
  label: string;
  value: number;
}

export function GaugeBar({ kind, label, value }: GaugeBarProps): React.ReactElement {
  const clamped = Math.max(0, Math.min(100, value));
  const meta = TOKENS.semantic.gauge[kind];
  const low = clamped <= 20;
  return React.createElement(
    'div',
    {
      role: 'meter',
      'aria-label': label,
      'aria-valuenow': clamped,
      'aria-valuemin': 0,
      'aria-valuemax': 100,
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: `${TOKENS.spacing[1]}px`,
        opacity: clamped <= 30 ? 1 : 0.85,
        color: TOKENS.colors['paper-0'],
        backgroundColor: TOKENS.colors['night-900'],
        padding: `${TOKENS.spacing[0]}px ${TOKENS.spacing[1]}px`,
        border: low
          ? `${TOKENS.shape.borderWidthPx}px solid ${TOKENS.colors['danger']}`
          : `${TOKENS.shape.borderWidthPx}px solid ${TOKENS.colors['ink-900']}`
      }
    },
    React.createElement('span', null, `[${meta.icon}] ${label}`),
    React.createElement(
      'div',
      {
        style: {
          width: '80px',
          height: '10px',
          backgroundColor: TOKENS.colors['night-700'],
          border: `1px solid ${TOKENS.colors['paper-0']}`
        }
      },
      React.createElement('div', {
        style: {
          width: `${clamped}%`,
          height: '100%',
          backgroundColor: TOKENS.colors[meta.color]
        }
      })
    ),
    React.createElement('span', null, `${Math.round(clamped)}%`)
  );
}

export interface ChartDataPoint {
  label: string;
  value: number;
  note?: string;
}

export interface AccessibleChartWithTableProps {
  title: string;
  unit: string;
  points: readonly ChartDataPoint[];
  showTable?: boolean;
  onToggleTable?: () => void;
}

/**
 * Every parent dashboard chart must provide a Table View toggle (docs/08 11, WP-309).
 */
export function AccessibleChartWithTable({
  title,
  unit,
  points,
  showTable = false,
  onToggleTable
}: AccessibleChartWithTableProps): React.ReactElement {
  const maxVal = Math.max(1, ...points.map((p) => p.value));
  return React.createElement(
    Card,
    { title },
    React.createElement(
      'div',
      { style: { marginBottom: `${TOKENS.spacing[1]}px` } },
      React.createElement(
        Button,
        { variant: 'paper', onClick: onToggleTable },
        showTable ? '그래프 보기' : '표 보기'
      )
    ),
    showTable
      ? React.createElement(
          'table',
          { style: { width: '100%', borderCollapse: 'collapse' } },
          React.createElement(
            'thead',
            null,
            React.createElement(
              'tr',
              null,
              React.createElement('th', { align: 'left' }, '기간'),
              React.createElement('th', { align: 'right' }, `값 (${unit})`),
              React.createElement('th', { align: 'left' }, '비고')
            )
          ),
          React.createElement(
            'tbody',
            null,
            points.map((p, idx) =>
              React.createElement(
                'tr',
                { key: `${p.label}-${idx}` },
                React.createElement('td', null, p.label),
                React.createElement('td', { align: 'right' }, String(p.value)),
                React.createElement('td', null, p.note ?? '')
              )
            )
          )
        )
      : React.createElement(
          'div',
          { style: { display: 'flex', alignItems: 'flex-end', gap: '6px', height: '120px' } },
          points.map((p, idx) =>
            React.createElement('div', {
              key: `${p.label}-${idx}`,
              title: `${p.label}: ${p.value} ${unit}`,
              style: {
                flex: 1,
                height: `${Math.max(8, Math.round((p.value / maxVal) * 100))}%`,
                backgroundColor: TOKENS.colors['brand'],
                border: `1px solid ${TOKENS.colors['ink-900']}`
              }
            })
          )
        )
  );
}

export interface GuestPassEndModalProps {
  shareUrl: string;
  onSendToParent?: (url: string) => void;
}

/**
 * Child screen end-of-guest-pass prompt (AGENTS.md 4.9 & docs/10 7).
 * Strictly displays ONLY "부모님께 소개 보내기" with zero prices, payments, or deadlines.
 */
export function GuestPassEndModal({
  shareUrl,
  onSendToParent
}: GuestPassEndModalProps): React.ReactElement {
  return React.createElement(
    Card,
    { title: '오늘 체험이 끝났어요' },
    React.createElement(
      'p',
      { style: { marginBottom: `${TOKENS.spacing[2]}px` } },
      '친구와 만든 시간을 부모님께 보여 드릴 수 있어요.'
    ),
    React.createElement(
      Button,
      {
        variant: 'brand',
        size: 'game',
        onClick: () => {
          onSendToParent?.(shareUrl);
        }
      },
      '부모님께 소개 보내기'
    )
  );
}

/**
 * Verifies dialogue layout fits within a standard viewport (720px height) even at 150% font scale (WP-109).
 */
export function calculateDialogBoxHeightPx(fontScale: number): number {
  const clampedScale = Math.max(1, Math.min(1.5, fontScale));
  const previewRow = 180;
  const promptRow = Math.round(48 * clampedScale);
  const offersRow = Math.round(3 * (52 * clampedScale));
  const micRow = TOKENS.shape.micButtonPx + 24;
  return previewRow + promptRow + offersRow + micRow;
}

export interface TeacherScriptBannerProps {
  stageTitle: string;
  teacherLineEn: string;
  coachingTipKo: string;
  hintPhrases?: readonly string[];
  spokenDone?: boolean;
  onMarkSpoken?: () => void;
}

/**
 * Displays what the teacher should say aloud during live tutoring and barter steps.
 */
export function TeacherScriptBanner({
  stageTitle,
  teacherLineEn,
  coachingTipKo,
  hintPhrases = [],
  spokenDone = false,
  onMarkSpoken
}: TeacherScriptBannerProps): React.ReactElement {
  return React.createElement(
    Panel,
    null,
    React.createElement(
      'div',
      {
        'data-testid': 'teacher-script-banner',
        style: {
          display: 'grid',
          gap: `${TOKENS.spacing[1]}px`
        }
      },
      React.createElement(
        'div',
        {
          style: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: `${TOKENS.spacing[1]}px`,
            flexWrap: 'wrap'
          }
        },
        React.createElement(
          'strong',
          { style: { color: TOKENS.colors['sky-d'] } },
          `선생님 회화 대본 · ${stageTitle}`
        ),
        React.createElement(
          'span',
          {
            style: {
              padding: `2px ${TOKENS.spacing[1]}px`,
              borderRadius: `${TOKENS.shape.radiusButtonPx}px`,
              backgroundColor: spokenDone ? TOKENS.colors.leaf : TOKENS.colors.sun,
              color: TOKENS.colors['ink-900'],
              border: `1px solid ${TOKENS.colors['ink-900']}`
            }
          },
          spokenDone ? '선생님 발화 완료' : '발화 안내 중'
        )
      ),
      React.createElement(
        'div',
        {
          style: {
            fontFamily: TOKENS.typography.fonts.target,
            fontSize: `${TOKENS.typography.targetSentenceMinPx}px`,
            fontWeight: 700,
            color: TOKENS.colors['ink-900'],
            backgroundColor: TOKENS.colors['paper-50'],
            padding: `${TOKENS.spacing[2]}px`,
            borderRadius: `${TOKENS.shape.radiusButtonPx}px`,
            border: `${TOKENS.shape.borderWidthPx}px solid ${TOKENS.colors['sky-d']}`
          }
        },
        `"${teacherLineEn}"`
      ),
      React.createElement(
        'div',
        { style: { color: TOKENS.colors['ink-700'] } },
        `코칭 포인트: ${coachingTipKo}`
      ),
      hintPhrases.length > 0
        ? React.createElement(
            'div',
            { style: { display: 'flex', gap: `${TOKENS.spacing[1]}px`, flexWrap: 'wrap' } },
            hintPhrases.map((h) =>
              React.createElement(
                'span',
                {
                  key: h,
                  style: {
                    padding: `2px ${TOKENS.spacing[1]}px`,
                    backgroundColor: TOKENS.colors['paper-100'],
                    border: `1px solid ${TOKENS.colors['line-200']}`,
                    borderRadius: `${TOKENS.shape.radiusButtonPx}px`
                  }
                },
                h
              )
            )
          )
        : null,
      onMarkSpoken
        ? React.createElement(
            'div',
            null,
            React.createElement(
              Button,
              { variant: spokenDone ? 'leaf' : 'brand', onClick: onMarkSpoken },
              spokenDone ? '선생님 대사 발화 확인됨' : '이 대사로 선생님 발화 완료'
            )
          )
        : null
    )
  );
}

export interface BilateralTradeOfferOption {
  stars: 1 | 2 | 3;
  text: string;
  feePct: number;
  bonus: string | null;
}

export interface BilateralTradePanelProps {
  role: 'teacher' | 'student';
  title: string;
  npcRoleLabel: string;
  studentGivesLabel: string;
  teacherGivesLabel: string;
  baseValueCoins: number;
  selectedStars: 1 | 2 | 3;
  offers: readonly BilateralTradeOfferOption[];
  teacherSpoken: boolean;
  studentSpoken: boolean;
  settled: boolean;
  settlementNotice?: string;
  onSelectStars: (stars: 1 | 2 | 3) => void;
  onStudentSpeak?: () => void;
  onTeacherSpeak?: () => void;
  onExecuteTrade?: () => void;
}

/**
 * Bilateral barter window shared by teacher director console and student HUD (WP-509, docs/03 D11).
 * Contains zero real-money pricing/payment copy so it remains safe on child viewports.
 */
export function BilateralTradePanel({
  role,
  title,
  npcRoleLabel,
  studentGivesLabel,
  teacherGivesLabel,
  baseValueCoins,
  selectedStars,
  offers,
  teacherSpoken,
  studentSpoken,
  settled,
  settlementNotice,
  onSelectStars,
  onStudentSpeak,
  onTeacherSpeak,
  onExecuteTrade
}: BilateralTradePanelProps): React.ReactElement {
  const readyToSettle = teacherSpoken && studentSpoken;

  return React.createElement(
    Card,
    { title: `${title} (${npcRoleLabel})`, tone: role === 'student' ? 'paper' : 'tinted' },
    React.createElement(
      'div',
      {
        'data-testid': `bilateral-trade-${role}`,
        style: { display: 'grid', gap: `${TOKENS.spacing[1]}px` }
      },
      React.createElement(
        'div',
        {
          style: {
            display: 'flex',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: `${TOKENS.spacing[1]}px`,
            padding: `${TOKENS.spacing[1]}px`,
            backgroundColor: TOKENS.colors['paper-50'],
            border: `1px solid ${TOKENS.colors['line-200']}`,
            borderRadius: `${TOKENS.shape.radiusButtonPx}px`
          }
        },
        React.createElement('strong', null, `학생 제시: ${studentGivesLabel} ⇄ 교사 제시: ${teacherGivesLabel}`),
        React.createElement(
          'span',
          null,
          `교사 발화: ${teacherSpoken ? '완료' : '대기'} · 학생 발화: ${studentSpoken ? '완료' : '대기'}`
        )
      ),
      React.createElement(
        'div',
        { style: { display: 'grid', gap: `${TOKENS.spacing[1]}px` } },
        offers.map((offer) => {
          const feeCoins = Math.round((baseValueCoins * offer.feePct) / 100);
          return React.createElement(
            'button',
            {
              key: offer.stars,
              type: 'button',
              onClick: () => onSelectStars(offer.stars),
              style: {
                textAlign: 'left',
                padding: `${TOKENS.spacing[1]}px`,
                backgroundColor:
                  selectedStars === offer.stars ? TOKENS.colors.sun : TOKENS.colors['paper-0'],
                color: TOKENS.colors['ink-900'],
                border: `${TOKENS.shape.borderWidthPx}px solid ${TOKENS.colors['ink-900']}`,
                borderRadius: `${TOKENS.shape.radiusButtonPx}px`,
                cursor: 'pointer'
              }
            },
            React.createElement(
              'div',
              { style: { fontWeight: 700 } },
              `${'★'.repeat(offer.stars)} · 교환 수수료 ${offer.feePct}% (${feeCoins} 코인)${offer.bonus ? ` · 보너스 ${offer.bonus}` : ''}`
            ),
            React.createElement(
              'div',
              { style: { fontFamily: TOKENS.typography.fonts.target } },
              offer.text
            )
          );
        })
      ),
      React.createElement(
        'div',
        { style: { display: 'flex', gap: `${TOKENS.spacing[1]}px`, flexWrap: 'wrap' } },
        role === 'teacher' && onTeacherSpeak
          ? React.createElement(
              Button,
              { variant: teacherSpoken ? 'leaf' : 'sky', onClick: onTeacherSpeak },
              teacherSpoken ? '선생님 발화 완료' : '선생님 제안 말하기'
            )
          : null,
        onStudentSpeak
          ? React.createElement(
              Button,
              {
                variant: studentSpoken ? 'leaf' : 'brand',
                size: role === 'student' ? 'game' : 'standard',
                onClick: onStudentSpeak
              },
              studentSpoken ? '학생 교환 문장 발화 완료' : '고른 문장으로 교환 말하기'
            )
          : null,
        onExecuteTrade
          ? React.createElement(
              Button,
              {
                variant: settled ? 'leaf' : 'sky',
                disabled: !readyToSettle || settled,
                onClick: onExecuteTrade
              },
              settled ? '물물교환 성사됨' : readyToSettle ? '양쪽 발화 확인 · 물물교환 확정' : '양쪽 모두 말하면 성사'
            )
          : null
      ),
      settlementNotice
        ? React.createElement(
            'div',
            { style: { fontWeight: 700, color: TOKENS.colors['leaf-d'] } },
            settlementNotice
          )
        : null
    )
  );
}
