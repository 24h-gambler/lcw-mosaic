import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  VoxelWorld,
  createInitialPlayerState,
  populateInitialWorld
} from '@lcw/sim-core';
import { understandUtterance } from '@lcw/converse';
import { FORBIDDEN_PLAYER_UI_PATTERNS, calculateDialogBoxHeightPx } from '@lcw/ui';
import {
  buildChunkThreeGeometry,
  createVoxelThreeScene,
  handleClientInputCommand
} from '../GameCanvas.js';
import { HudOverlay } from '../HudOverlay.js';

describe('apps/client (WP-004, WP-109)', () => {
  it('builds Three.js voxel scene from generated chunks and supports F5/Tab/slot/place/undo', () => {
    const world = new VoxelWorld();
    populateInitialWorld(world, 'client-test-seed', 1);
    const { scene, camera, chunkMeshCount } = createVoxelThreeScene(world);

    expect(scene.children.length).toBeGreaterThanOrEqual(3);
    expect(camera.fov).toBe(72);
    expect(chunkMeshCount).toBeGreaterThan(0);

    const anyChunk = world.chunks.values().next().value;
    expect(anyChunk).toBeDefined();
    const geom = buildChunkThreeGeometry(anyChunk!);
    expect(geom.getAttribute('position')).toBeDefined();

    const player = createInitialPlayerState('p1');
    const c1 = handleClientInputCommand(world, player, { type: 'camera_third_person' }, 100);
    expect(c1.statusText).toBe('camera:third_person');

    const c2 = handleClientInputCommand(world, player, { type: 'camera_mirror' }, 200);
    expect(c2.statusText).toBe('camera:mirror');

    handleClientInputCommand(world, player, { type: 'select_slot', slot: 3 }, 250);
    expect(player.selectedSlot).toBe(3);

    // Move inside own plot and test place + undo
    player.x = 112.5;
    player.y = 2;
    player.z = 166.5;
    if (world.getBlock(113, 2, 166) !== 0) {
      world.setBlock({ id: 'p1', isOwner: true }, 113, 2, 166, 0);
    }
    const placed = handleClientInputCommand(
      world,
      player,
      { type: 'place_block', x: 113, y: 2, z: 166, blockId: 2 },
      300
    );
    expect(placed.ok).toBe(true);
    expect(world.getBlock(113, 2, 166)).toBe(2);

    const undone = handleClientInputCommand(world, player, { type: 'undo_block' }, 400);
    expect(undone.ok).toBe(true);
    expect(world.getBlock(113, 2, 166)).toBe(0);
  });

  it('fits dialog layout within 720px at 150% font scale and excludes pricing/payment copy on child HUD (WP-109)', () => {
    expect(calculateDialogBoxHeightPx(1.0)).toBeLessThanOrEqual(720);
    expect(calculateDialogBoxHeightPx(1.5)).toBeLessThanOrEqual(720);

    const player = createInitialPlayerState('child-hud');
    const understand = understandUtterance({
      ctx: 'cafe',
      level: 'L2',
      transcript: 'warm honey tea please'
    });

    const activeHtml = renderToStaticMarkup(
      React.createElement(HudOverlay, {
        player,
        zoneLabel: '브릭 플라자',
        offers: understand.offers,
        selectedStars: 2,
        fontScale: 1.5,
        micActive: false,
        thoughtBoardOpen: true,
        onSelectOffer: () => {},
        onToggleMic: () => {},
        onToggleThoughtBoard: () => {},
        onSelectBoardItem: () => {},
        onChangeFontScale: () => {}
      })
    );
    expect(activeHtml).toContain('따뜻한 꿀차');
    for (const pattern of FORBIDDEN_PLAYER_UI_PATTERNS) {
      expect(activeHtml).not.toContain(pattern);
    }
    expect(/[0-9,]+\s*원|결제|할인|구독|만료/.test(activeHtml)).toBe(false);

    const endedHtml = renderToStaticMarkup(
      React.createElement(HudOverlay, {
        player,
        zoneLabel: '브릭 플라자',
        offers: understand.offers,
        selectedStars: 2,
        fontScale: 1.0,
        micActive: false,
        thoughtBoardOpen: false,
        tryMode: { active: true, secondsRemaining: 0, ended: true },
        onSelectOffer: () => {},
        onToggleMic: () => {},
        onToggleThoughtBoard: () => {},
        onSelectBoardItem: () => {},
        onChangeFontScale: () => {}
      })
    );
    expect(endedHtml).toContain('부모님께 소개 보내기');
    for (const pattern of FORBIDDEN_PLAYER_UI_PATTERNS) {
      expect(endedHtml).not.toContain(pattern);
    }
    expect(/[0-9,]+\s*원|결제|할인|구독|만료/.test(endedHtml)).toBe(false);

    const tradeHtml = renderToStaticMarkup(
      React.createElement(HudOverlay, {
        player,
        zoneLabel: '브릭 플라자',
        offers: understand.offers,
        selectedStars: 3,
        fontScale: 1.0,
        micActive: false,
        thoughtBoardOpen: false,
        tradeWindow: {
          open: true,
          title: '철광석 3개 ↔ 따뜻한 꿀차 2잔 물물교환',
          npcRoleLabel: '찻집 주인 (교사 빙의)',
          studentGivesLabel: '철광석 3개',
          teacherGivesLabel: '따뜻한 꿀차 2잔',
          baseValueCoins: 100,
          selectedStars: 3,
          offers: [
            {
              stars: 1,
              text: 'I want to trade three iron ores for warm honey tea please.',
              feePct: 10,
              bonus: null
            },
            {
              stars: 2,
              text: 'Could we swap three iron ores for two warm honey teas?',
              feePct: 5,
              bonus: null
            },
            {
              stars: 3,
              text: 'If I trade three iron ores, could I get two warm honey teas so that I can stay warm?',
              feePct: 0,
              bonus: 'warmth_grace_x2'
            }
          ],
          teacherPromptEn: 'Welcome! What would you like to trade for this warm honey tea?',
          teacherSpoken: true,
          studentSpoken: false,
          settled: false,
          onToggleOpen: () => {},
          onSelectStars: () => {},
          onStudentSpeak: () => {},
          onExecuteTrade: () => {}
        },
        onSelectOffer: () => {},
        onToggleMic: () => {},
        onToggleThoughtBoard: () => {},
        onSelectBoardItem: () => {},
        onChangeFontScale: () => {}
      })
    );
    expect(tradeHtml).toContain('선생님 말씀:');
    expect(tradeHtml).toContain('물물교환');
    for (const pattern of FORBIDDEN_PLAYER_UI_PATTERNS) {
      expect(tradeHtml).not.toContain(pattern);
    }
    expect(/[0-9,]+\s*원|결제|할인|구독|만료/.test(tradeHtml)).toBe(false);
  });
});
