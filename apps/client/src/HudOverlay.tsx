import React from 'react';
import {
  BilateralTradePanel,
  Button,
  Card,
  GaugeBar,
  GuestPassEndModal,
  Panel,
  StarOfferCard,
  TOKENS,
  calculateDialogBoxHeightPx,
  type BilateralTradeOfferOption
} from '@lcw/ui';
import type { Offer } from '@lcw/schemas';
import type { PlayerState } from '@lcw/sim-core';

export interface HudTradeWindowProps {
  open: boolean;
  title: string;
  npcRoleLabel: string;
  studentGivesLabel: string;
  teacherGivesLabel: string;
  baseValueCoins: number;
  selectedStars: 1 | 2 | 3;
  offers: readonly BilateralTradeOfferOption[];
  teacherPromptEn: string;
  teacherSpoken: boolean;
  studentSpoken: boolean;
  settled: boolean;
  settlementNotice?: string;
  onToggleOpen: () => void;
  onSelectStars: (stars: 1 | 2 | 3) => void;
  onStudentSpeak: () => void;
  onExecuteTrade: () => void;
}

export interface HudOverlayProps {
  player: PlayerState;
  zoneLabel: string;
  npcPrompt?: string;
  offers: Offer[];
  selectedStars: 1 | 2 | 3;
  fontScale: number;
  micActive: boolean;
  thoughtBoardOpen: boolean;
  tryMode?: {
    active: boolean;
    secondsRemaining: number;
    ended: boolean;
  };
  tradeWindow?: HudTradeWindowProps;
  onSelectOffer: (stars: 1 | 2 | 3) => void;
  onToggleMic: () => void;
  onToggleThoughtBoard: () => void;
  onSelectBoardItem: (item: string, modifier?: string) => void;
  onChangeFontScale: (next: number) => void;
  onSendToParent?: (shareUrl: string) => void;
}

export const HUD_THOUGHT_BOARD_CARDS = [
  { item: 'honey tea', modifier: 'warm', label: '따뜻한 꿀차' },
  { item: 'bread', modifier: 'fresh', label: '갓 구운 빵' },
  { item: 'water', modifier: 'cool', label: '시원한 물' }
] as const;

/**
 * Pure Token-only Game HUD (WP-109, AGENTS.md 4.9 & 6).
 * Strictly contains zero pricing/payment/deadline text on child viewports.
 */
export function HudOverlay({
  player,
  zoneLabel,
  npcPrompt = 'What would you like today?',
  offers,
  selectedStars,
  fontScale,
  micActive,
  thoughtBoardOpen,
  tryMode,
  tradeWindow,
  onSelectOffer,
  onToggleMic,
  onToggleThoughtBoard,
  onSelectBoardItem,
  onChangeFontScale,
  onSendToParent
}: HudOverlayProps): React.ReactElement {
  const dialogHeight = calculateDialogBoxHeightPx(fontScale);

  return React.createElement(
    'div',
    {
      style: {
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        minHeight: '720px',
        padding: `${TOKENS.spacing[2]}px`,
        backgroundColor: TOKENS.colors['night-900'],
        color: TOKENS.colors['paper-0'],
        fontFamily: TOKENS.typography.fonts.ui,
        overflowX: 'hidden'
      }
    },
    // Top HUD row: Survival Gauges + Zone Badge + Child-Safe Font Scale Controls
    React.createElement(
      'div',
      {
        style: {
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: `${TOKENS.spacing[2]}px`
        }
      },
      React.createElement(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: `${TOKENS.spacing[0]}px` } },
        React.createElement(GaugeBar, { kind: 'hunger', label: '배고픔', value: player.gauges.hunger }),
        React.createElement(GaugeBar, { kind: 'thirst', label: '갈증', value: player.gauges.thirst }),
        React.createElement(GaugeBar, {
          kind: 'temperature',
          label: '체온',
          value: player.gauges.temperature
        })
      ),
      React.createElement(
        'div',
        {
          style: {
            backgroundColor: TOKENS.colors['night-700'],
            color: TOKENS.colors['paper-0'],
            border: `${TOKENS.shape.borderWidthPx}px solid ${TOKENS.colors['paper-0']}`,
            borderRadius: `${TOKENS.shape.radiusButtonPx}px`,
            padding: `${TOKENS.spacing[1]}px ${TOKENS.spacing[2]}px`
          }
        },
        `${zoneLabel} | 카메라: ${player.cameraMode} | 코인: ${player.coins}`
      ),
      React.createElement(
        'div',
        { style: { display: 'flex', gap: `${TOKENS.spacing[1]}px` } },
        [1, 1.25, 1.5].map((scale) =>
          React.createElement(
            Button,
            {
              key: String(scale),
              variant: fontScale === scale ? 'brand' : 'paper',
              onClick: () => onChangeFontScale(scale)
            },
            `${Math.round(scale * 100)}%`
          )
        )
      )
    ),

    // Center Dialog Box (verified <= 720px even at 150% font scale)
    tryMode?.ended
      ? React.createElement(GuestPassEndModal, {
          shareUrl: '/r/try-preview',
          onSendToParent
        })
      : React.createElement(
          'div',
          { style: { maxHeight: `${dialogHeight}px`, maxWidth: '680px', width: '100%', margin: '0 auto' } },
          React.createElement(
            Panel,
            null,
            React.createElement(
              'div',
              {
                style: {
                  fontFamily: TOKENS.typography.fonts.target,
                  fontSize: `${Math.max(
                    TOKENS.typography.targetSentenceMinPx,
                    Math.round(TOKENS.typography.scale.h3.sizePx * fontScale)
                  )}px`,
                  fontWeight: 700,
                  marginBottom: `${TOKENS.spacing[2]}px`
                }
              },
              npcPrompt
            ),
            React.createElement(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: `${TOKENS.spacing[1]}px` } },
              offers.map((offer) =>
                React.createElement(StarOfferCard, {
                  key: offer.stars,
                  stars: offer.stars,
                  sentence: offer.text,
                  price: offer.price,
                  bonus: offer.bonus,
                  selected: selectedStars === offer.stars,
                  fontScale,
                  onSelect: () => onSelectOffer(offer.stars)
                })
              )
            ),
            thoughtBoardOpen
              ? React.createElement(
                  'div',
                  { style: { marginTop: `${TOKENS.spacing[2]}px`, display: 'flex', gap: `${TOKENS.spacing[1]}px`, flexWrap: 'wrap' } },
                  HUD_THOUGHT_BOARD_CARDS.map((card) =>
                    React.createElement(
                      Button,
                      {
                        key: card.item,
                        variant: 'sky',
                        size: 'game',
                        onClick: () => onSelectBoardItem(card.item, card.modifier)
                      },
                      card.label
                    )
                  )
                )
              : null,
            React.createElement(
              'div',
              {
                style: {
                  marginTop: `${TOKENS.spacing[2]}px`,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: `${TOKENS.spacing[2]}px`,
                  flexWrap: 'wrap'
                }
              },
              React.createElement(
                'div',
                { style: { display: 'flex', gap: `${TOKENS.spacing[1]}px`, flexWrap: 'wrap' } },
                React.createElement(
                  Button,
                  { variant: 'paper', onClick: onToggleThoughtBoard },
                  thoughtBoardOpen ? '생각 보드 닫기' : '말이 안 나오면 그림으로 고르기'
                ),
                tradeWindow
                  ? React.createElement(
                      Button,
                      { variant: 'sky', onClick: tradeWindow.onToggleOpen },
                      tradeWindow.open ? '물물교환 닫기' : '선생님과 물물교환'
                    )
                  : null
              ),
              React.createElement(
                Button,
                {
                  variant: micActive ? 'danger' : 'brand',
                  size: 'mic',
                  onClick: onToggleMic,
                  'aria-label': micActive ? '마이크 끄기' : '마이크 켜고 말하기'
                },
                micActive ? '말하는 중' : '말하기'
              )
            ),
            tradeWindow?.open
              ? React.createElement(
                  'div',
                  { style: { marginTop: `${TOKENS.spacing[2]}px`, display: 'grid', gap: `${TOKENS.spacing[1]}px` } },
                  React.createElement(
                    'div',
                    {
                      style: {
                        padding: `${TOKENS.spacing[1]}px`,
                        backgroundColor: TOKENS.colors['paper-100'],
                        borderRadius: `${TOKENS.shape.radiusButtonPx}px`,
                        border: `1px solid ${TOKENS.colors['sky-d']}`
                      }
                    },
                    `선생님 말씀: "${tradeWindow.teacherPromptEn}"`
                  ),
                  React.createElement(BilateralTradePanel, {
                    role: 'student',
                    title: tradeWindow.title,
                    npcRoleLabel: tradeWindow.npcRoleLabel,
                    studentGivesLabel: tradeWindow.studentGivesLabel,
                    teacherGivesLabel: tradeWindow.teacherGivesLabel,
                    baseValueCoins: tradeWindow.baseValueCoins,
                    selectedStars: tradeWindow.selectedStars,
                    offers: tradeWindow.offers,
                    teacherSpoken: tradeWindow.teacherSpoken,
                    studentSpoken: tradeWindow.studentSpoken,
                    settled: tradeWindow.settled,
                    settlementNotice: tradeWindow.settlementNotice,
                    onSelectStars: tradeWindow.onSelectStars,
                    onStudentSpeak: tradeWindow.onStudentSpeak,
                    onExecuteTrade: tradeWindow.onExecuteTrade
                  })
                )
              : null
          )
        ),

    // Bottom 5-Slot Hotbar (docs/08)
    React.createElement(
      Card,
      { tone: 'night' },
      React.createElement(
        'div',
        {
          style: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: `${TOKENS.spacing[1]}px`
          }
        },
        player.hotbar.map((item, idx) =>
          React.createElement(
            'div',
            {
              key: idx,
              style: {
                flex: 1,
                minHeight: `${TOKENS.shape.gameButtonMinPx}px`,
                padding: `${TOKENS.spacing[1]}px`,
                border:
                  player.selectedSlot === idx
                    ? `${TOKENS.shape.borderWidthPx}px solid ${TOKENS.colors['sun']}`
                    : `1px solid ${TOKENS.colors['silver']}`,
                borderRadius: `${TOKENS.shape.radiusButtonPx}px`,
                backgroundColor: TOKENS.colors['night-700'],
                color: TOKENS.colors['paper-0']
              }
            },
            `${idx + 1}. ${item ? `${item.name} (${item.count})` : '빈 칸'}`
          )
        )
      )
    )
  );
}
