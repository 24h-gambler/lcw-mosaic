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
