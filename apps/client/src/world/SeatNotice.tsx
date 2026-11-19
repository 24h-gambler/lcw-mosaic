/**
 * Child-facing notice when the guardian's seat no longer allows solo play (docs/19 6장, play_allowed=false).
 * The world stays walkable (look around only); talking to NPCs shows this card again. No price or payment words:
 * this is a child screen, the guardian handles the seat in the family pages.
 */
import React from 'react';
import { COLOR_TOKENS as C, SHAPE_TOKENS as S, TYPOGRAPHY_TOKENS as T } from '@lcw/ui';
import { WORLD_STRINGS as W } from './strings.js';

export function SeatPausedChip(props: { onOpen: () => void }): React.ReactElement {
  return (
    <button
      type="button"
      onClick={props.onOpen}
      style={{
        position: 'absolute',
        top: 52,
        left: 12,
        pointerEvents: 'auto',
        background: C['paper-0'],
        color: C['ink-900'],
        border: `2px solid ${C['ink-900']}`,
        borderRadius: S.radiusButtonPx,
        boxShadow: S.shadowDefault,
        padding: '6px 12px',
        minHeight: 44,
        fontFamily: T.fonts.ui,
        fontSize: T.scale.small.sizePx,
        fontWeight: 700,
        cursor: 'pointer'
      }}
    >
      {W.seatPausedChip}
    </button>
  );
}

export function SeatPausedCard(props: { onClose: () => void }): React.ReactElement {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="lcw-seat-title"
      style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, pointerEvents: 'auto', background: `${C['night-900']}66` }}
    >
      <div
        style={{
          maxWidth: 420,
          width: '100%',
          background: C['paper-50'],
          border: `2px solid ${C['ink-900']}`,
          borderRadius: S.radiusCardPx,
          boxShadow: S.shadowDefault,
          padding: 24,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          fontFamily: T.fonts.ui,
          color: C['ink-900']
        }}
      >
        <h2 id="lcw-seat-title" style={{ margin: 0, fontSize: T.scale.h3.sizePx, lineHeight: `${T.scale.h3.lineHeightPx}px` }}>
          {W.seatPausedTitle}
        </h2>
        <p style={{ margin: 0, color: C['ink-700'], fontSize: T.scale['body-l'].sizePx, lineHeight: `${T.scale['body-l'].lineHeightPx}px` }}>{W.seatPausedBody}</p>
        <button
          type="button"
          autoFocus
          onClick={props.onClose}
          style={{
            alignSelf: 'flex-end',
            background: C['brand-d'],
            color: C['paper-0'],
            border: `2px solid ${C['ink-900']}`,
            borderRadius: S.radiusButtonPx,
            boxShadow: S.shadowDefault,
            padding: '12px 20px',
            minHeight: 48,
            fontWeight: 800,
            fontSize: T.scale['body-l'].sizePx,
            cursor: 'pointer'
          }}
        >
          {W.seatPausedOk}
        </button>
      </div>
    </div>
  );
}

/** Where the trial card sends the grown-up (R326): the plans step of the public pricing page (adults' page). */
export const TRIAL_PLANS_PATH = '/pricing?from=world#plans';

/**
 * R326 free trial over (server clock, `trial: 'ended'`): the world stays walkable, talking and building stop, and the
 * card points to the plans page for the grown-up. Still a child screen: no price, payment word or time here (AGENTS
 * 4.9) — the prices are on /pricing, which is the guardians' page.
 */
export function TrialEndedCard(props: { onClose: () => void; plansHref?: string }): React.ReactElement {
  const btn = {
    border: `2px solid ${C['ink-900']}`,
    borderRadius: S.radiusButtonPx,
    boxShadow: S.shadowDefault,
    padding: '12px 20px',
    minHeight: 48,
    fontWeight: 800,
    fontSize: T.scale['body-l'].sizePx,
    cursor: 'pointer',
    textDecoration: 'none',
    textAlign: 'center' as const
  };
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="lcw-trial-title"
      data-testid="trial-ended"
      style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, pointerEvents: 'auto', background: `${C['night-900']}66` }}
    >
      <div
        style={{
          maxWidth: 440,
          width: '100%',
          maxHeight: '100%',
          overflowY: 'auto',
          background: C['paper-50'],
          border: `2px solid ${C['ink-900']}`,
          borderRadius: S.radiusCardPx,
          boxShadow: S.shadowDefault,
          padding: 20,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          fontFamily: T.fonts.ui,
          color: C['ink-900']
        }}
      >
        <h2 id="lcw-trial-title" style={{ margin: 0, fontSize: T.scale.h3.sizePx, lineHeight: `${T.scale.h3.lineHeightPx}px` }}>
          {W.trialEndedTitle}
        </h2>
        <p style={{ margin: 0, color: C['ink-700'], fontSize: T.scale['body-l'].sizePx, lineHeight: `${T.scale['body-l'].lineHeightPx}px` }}>{W.trialEndedBody}</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={props.onClose} style={{ ...btn, background: C['paper-0'], color: C['ink-900'] }}>
            {W.trialEndedLater}
          </button>
          <a href={props.plansHref ?? TRIAL_PLANS_PATH} autoFocus data-cta="plans" style={{ ...btn, background: C['brand-d'], color: C['paper-0'] }}>
            {W.trialEndedCta}
          </a>
        </div>
      </div>
    </div>
  );
}
