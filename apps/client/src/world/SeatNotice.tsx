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
