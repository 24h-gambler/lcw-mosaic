import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  VoxelWorld,
  calculateTradeSettlement,
  createInitialPlayerState,
  populateInitialWorld
} from '@lcw/sim-core';
import { TEACHER_STUDENT_TRADE_SCENARIOS } from '@lcw/content';
import { understandUtterance } from '@lcw/converse';
import { GameCanvas } from './GameCanvas.js';
import { HudOverlay } from './HudOverlay.js';

export function ClientApp(): React.ReactElement {
  const world = useMemo(() => {
    const w = new VoxelWorld();
    populateInitialWorld(w, 'lcw-client-default', 1);
    return w;
  }, []);
  const [player, setPlayer] = useState(() => createInitialPlayerState('local-explorer'));
  const [fontScale, setFontScale] = useState(1);
  const [micActive, setMicActive] = useState(false);
  const [thoughtBoardOpen, setThoughtBoardOpen] = useState(false);
  const [selectedStars, setSelectedStars] = useState<1 | 2 | 3>(2);
  const initialUnderstand = useMemo(
    () =>
      understandUtterance({
        ctx: 'cafe',
        level: 'L2',
        transcript: 'warm honey tea please'
      }),
    []
  );
  const [offers, setOffers] = useState(initialUnderstand.offers);

  const tradeScenario = TEACHER_STUDENT_TRADE_SCENARIOS[0]!;
  const [tradeOpen, setTradeOpen] = useState(false);
  const [tradeStars, setTradeStars] = useState<1 | 2 | 3>(3);
  const [tradeTeacherSpoken] = useState(true);
  const [tradeStudentSpoken, setTradeStudentSpoken] = useState(false);
  const [tradeSettled, setTradeSettled] = useState(false);
  const [tradeNotice, setTradeNotice] = useState<string | undefined>(undefined);

  const executeBilateralTrade = () => {
    const res = calculateTradeSettlement({
      baseValueCoins: tradeScenario.teacherGives.baseValueCoins,
      stars: tradeStars,
      teacherSpoken: tradeTeacherSpoken,
      studentSpoken: tradeStudentSpoken,
      studentPassed: tradeStudentSpoken,
      studentCoins: player.coins
    });
    if (!res.settled) {
      setTradeNotice('선생님과 학생 양쪽 모두 말해야 물물교환이 성사됩니다.');
      return;
    }
    setPlayer((prev) => {
      const nextHotbar = [...prev.hotbar] as typeof prev.hotbar;
      nextHotbar[1] = {
        itemId: tradeScenario.teacherGives.itemId,
        name: tradeScenario.teacherGives.nameKo,
        kind: 'drink',
        count: tradeScenario.teacherGives.count
      };
      return {
        ...prev,
        coins: prev.coins - res.feeCoins,
        hotbar: nextHotbar
      };
    });
    setTradeSettled(true);
    setTradeNotice(
      `교환 성사! ${tradeScenario.teacherGives.nameKo} 수령 (수수료 ${res.feeCoins} 코인${res.bonusGranted ? ' · 보너스 적용' : ''})`
    );
  };

  return React.createElement(
    'main',
    null,
    React.createElement(GameCanvas, { world, player }),
    React.createElement(HudOverlay, {
      player,
      zoneLabel: '잉글리시 코어 플라자 (보호 구역)',
      offers,
      selectedStars,
      fontScale,
      micActive,
      thoughtBoardOpen,
      tradeWindow: {
        open: tradeOpen,
        title: tradeScenario.titleKo,
        npcRoleLabel: tradeScenario.npcRoleKo,
        studentGivesLabel: tradeScenario.studentGives.nameKo,
        teacherGivesLabel: tradeScenario.teacherGives.nameKo,
        baseValueCoins: tradeScenario.teacherGives.baseValueCoins,
        selectedStars: tradeStars,
        offers: tradeScenario.studentOffers,
        teacherPromptEn: tradeScenario.teacherGuideStages[1]!.teacherLineEn,
        teacherSpoken: tradeTeacherSpoken,
        studentSpoken: tradeStudentSpoken,
        settled: tradeSettled,
        settlementNotice: tradeNotice,
        onToggleOpen: () => setTradeOpen((o) => !o),
        onSelectStars: setTradeStars,
        onStudentSpeak: () => setTradeStudentSpoken(true),
        onExecuteTrade: executeBilateralTrade
      },
      onSelectOffer: setSelectedStars,
      onToggleMic: () => setMicActive((m) => !m),
      onToggleThoughtBoard: () => setThoughtBoardOpen((o) => !o),
      onSelectBoardItem: (item, modifier) => {
        const res = understandUtterance({
          ctx: 'cafe',
          level: 'L2',
          transcript: `${modifier ?? ''} ${item}`.trim()
        });
        setOffers(res.offers);
      },
      onChangeFontScale: setFontScale
    })
  );
}

if (typeof document !== 'undefined') {
  const rootEl = document.getElementById('root');
  if (rootEl) {
    createRoot(rootEl).render(React.createElement(ClientApp));
  }
}
