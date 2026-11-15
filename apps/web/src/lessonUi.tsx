/** Small building blocks shared by the lesson-mode screens. Colours, spacing and type come from @lcw/ui tokens only. */
import React from 'react';
import { Button, TOKENS } from '@lcw/ui';

const C = TOKENS.colors;
export const sp = (i: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7) => `${TOKENS.spacing[i]}px`;
export const border = `${TOKENS.shape.borderWidthPx}px solid ${C['ink-900']}`;

/** Focus ring (docs/08 §11: 3px sky-d), pop and pulse motion, and the reduced-motion switch for every lesson screen. */
export const LESSON_BASE_CSS = `
.lcw-lesson :focus-visible { outline: ${TOKENS.shape.focusOutlineWidthPx}px solid ${C['sky-d']}; outline-offset: 2px; }
.lcw-lesson button:active { box-shadow: ${TOKENS.shape.shadowPressed} !important; transform: translate(3px, 3px); }
.lcw-lesson button:disabled { opacity: 0.6; cursor: default; }
@keyframes lcw-pop { 0% { transform: scale(1); } 50% { transform: scale(1.15); } 100% { transform: scale(1); } }
@keyframes lcw-star-in { 0% { transform: scale(0.2); opacity: 0; } 60% { transform: scale(1.15); opacity: 1; } 100% { transform: scale(1); opacity: 1; } }
@keyframes lcw-pulse { 0% { box-shadow: 0 0 0 0 ${C.brand}; } 100% { box-shadow: 0 0 0 18px transparent; } }
@keyframes lcw-dots { 0%, 20% { opacity: 0.2; } 50% { opacity: 1; } 100% { opacity: 0.2; } }
.lcw-pop { animation: lcw-pop ${TOKENS.motion.popMs}ms ease-out; }
.lcw-star-in { display: inline-block; animation: lcw-star-in ${TOKENS.motion.slowMs}ms ease-out both; }
.lcw-pulse { animation: lcw-pulse 1.2s ease-out infinite; }
.lcw-dots span { animation: lcw-dots 1.2s infinite; }
.lcw-dots span:nth-child(2) { animation-delay: 0.2s; }
.lcw-dots span:nth-child(3) { animation-delay: 0.4s; }
@media (prefers-reduced-motion: reduce) {
  .lcw-pop, .lcw-star-in, .lcw-pulse, .lcw-dots span { animation: none !important; }
}
`;

export function LessonStyle(): React.ReactElement {
  return <style>{LESSON_BASE_CSS}</style>;
}

export const inputStyle: React.CSSProperties = {
  border,
  borderRadius: `${TOKENS.shape.radiusButtonPx}px`,
  padding: `${sp(1)} ${sp(2)}`,
  minHeight: `${TOKENS.shape.touchTargetMinPx}px`,
  fontSize: `${TOKENS.typography.scale.body.sizePx}px`,
  fontFamily: TOKENS.typography.fonts.ui,
  backgroundColor: C['paper-0'],
  color: C['ink-900'],
  boxSizing: 'border-box',
  width: '100%'
};

export const labelStyle: React.CSSProperties = {
  display: 'grid',
  gap: sp(0),
  fontSize: `${TOKENS.typography.scale.small.sizePx}px`,
  fontWeight: 700,
  color: C['ink-700']
};

export const boxStyle = (tone: 'paper' | 'tinted' | 'night' = 'paper'): React.CSSProperties => ({
  backgroundColor: tone === 'night' ? C['night-900'] : tone === 'tinted' ? C['paper-100'] : C['paper-0'],
  color: tone === 'night' ? C['paper-0'] : C['ink-900'],
  border,
  borderRadius: `${TOKENS.shape.radiusCardPx}px`,
  boxShadow: TOKENS.shape.shadowDefault,
  padding: sp(3),
  minWidth: 0
});

export function Box({
  title,
  tone,
  children,
  testId,
  right
}: {
  title?: string;
  tone?: 'paper' | 'tinted' | 'night';
  children?: React.ReactNode;
  testId?: string;
  right?: React.ReactNode;
}): React.ReactElement {
  return (
    <section data-testid={testId} style={boxStyle(tone)}>
      {title || right ? (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: sp(2),
            flexWrap: 'wrap',
            marginBottom: sp(2)
          }}
        >
          {title ? (
            <h2
              style={{
                margin: 0,
                fontSize: `${TOKENS.typography.scale.h3.sizePx}px`,
                lineHeight: `${TOKENS.typography.scale.h3.lineHeightPx}px`
              }}
            >
              {title}
            </h2>
          ) : (
            <span />
          )}
          {right}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** Visible error or info line with an optional retry — errors are never silent (docs/18 task). */
export function Notice({
  kind = 'error',
  children,
  onRetry,
  retryLabel,
  testId
}: {
  kind?: 'error' | 'info' | 'ok';
  children: React.ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  testId?: string;
}): React.ReactElement {
  const bg = kind === 'error' ? C['danger-d'] : kind === 'ok' ? C['leaf-d'] : C['sky-d'];
  return (
    <div
      role={kind === 'error' ? 'alert' : 'status'}
      data-testid={testId}
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: sp(2),
        backgroundColor: bg,
        color: C['paper-0'],
        border,
        borderRadius: `${TOKENS.shape.radiusButtonPx}px`,
        padding: `${sp(1)} ${sp(2)}`,
        fontWeight: 700
      }}
    >
      <span style={{ flex: '1 1 200px' }}>{children}</span>
      {onRetry ? (
        <Button type="button" variant="paper" onClick={onRetry}>
          {retryLabel ?? '다시 시도'}
        </Button>
      ) : null}
    </div>
  );
}

export function Stat({ label, value, testId }: { label: string; value: string | number; testId?: string }): React.ReactElement {
  return (
    <div
      data-testid={testId}
      style={{
        border,
        borderRadius: `${TOKENS.shape.radiusButtonPx}px`,
        backgroundColor: C['paper-50'],
        padding: `${sp(1)} ${sp(2)}`,
        display: 'grid',
        gap: sp(0),
        minWidth: '88px'
      }}
    >
      <span style={{ fontSize: `${TOKENS.typography.scale.small.sizePx}px`, color: C['ink-700'] }}>{label}</span>
      <strong
        style={{
          fontSize: `${TOKENS.typography.scale.h2.sizePx}px`,
          lineHeight: `${TOKENS.typography.scale.h2.lineHeightPx}px`,
          fontVariantNumeric: 'tabular-nums'
        }}
      >
        {value}
      </strong>
    </div>
  );
}

/** Clipboard write with a boolean result so the screen can say whether it worked. */
export async function copyText(text: string): Promise<boolean> {
  try {
    const nav = (globalThis as { navigator?: Navigator }).navigator;
    if (!nav?.clipboard?.writeText) return false;
    await nav.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function currentOrigin(): string {
  try {
    const loc = (globalThis as { location?: Location }).location;
    return loc?.origin && loc.origin !== 'null' ? loc.origin : '';
  } catch {
    return '';
  }
}
