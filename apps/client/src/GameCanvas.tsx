import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import {
  VoxelWorld,
  greedyMeshChunk,
  placeBlockSingleInput,
  toggleMirrorCamera,
  toggleThirdPersonCamera,
  undoLastBlock,
  useSelectedSlot,
  type CubicChunk,
  type PlayerState
} from '@lcw/sim-core';

/** docs/08 §6.3 Day lighting palette */
export const SCENE_LIGHTING = {
  skyDayHex: 0x7ec8f8,
  sunHex: 0xfff3d1,
  hemiSkyHex: 0x9ad7ff,
  hemiGroundHex: 0x6b5b4b,
  ambientHex: 0x404a68
} as const;

export const BLOCK_COLOR_BY_ID: Record<number, number> = {
  1: 0x58a55c, // grass
  2: 0x8b6245, // oak_wood
  3: 0x8b93a1, // stone
  4: 0x4ea8de, // water / glass accent
  5: 0xe2c785, // sand / sandstone
  6: 0x353b48, // bedrock
  7: 0xffd166 // glow lantern / brass
};

export function buildChunkThreeGeometry(chunk: CubicChunk): THREE.BufferGeometry {
  const mesh = greedyMeshChunk(chunk);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
  geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  return geometry;
}

export function createVoxelThreeScene(world: VoxelWorld): {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  chunkMeshCount: number;
} {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SCENE_LIGHTING.skyDayHex);

  const camera = new THREE.PerspectiveCamera(72, 16 / 9, 0.1, 260);
  camera.position.set(144, 8, 152);

  const hemi = new THREE.HemisphereLight(
    SCENE_LIGHTING.hemiSkyHex,
    SCENE_LIGHTING.hemiGroundHex,
    0.85
  );
  scene.add(hemi);

  const ambient = new THREE.AmbientLight(SCENE_LIGHTING.ambientHex, 0.45);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight(SCENE_LIGHTING.sunHex, 1.15);
  sun.position.set(60, 120, 40);
  scene.add(sun);

  let chunkMeshCount = 0;
  const material = new THREE.MeshLambertMaterial({ color: BLOCK_COLOR_BY_ID[2] });
  for (const chunk of world.chunks.values()) {
    const geom = buildChunkThreeGeometry(chunk);
    if (geom.getAttribute('position').count === 0) {
      geom.dispose();
      continue;
    }
    const mesh = new THREE.Mesh(geom, material);
    mesh.position.set(chunk.cx * 16, chunk.cy * 16, chunk.cz * 16);
    scene.add(mesh);
    chunkMeshCount++;
  }

  return { scene, camera, chunkMeshCount };
}

export type ClientInputCommand =
  | { type: 'camera_third_person' }
  | { type: 'camera_mirror' }
  | { type: 'select_slot'; slot: 0 | 1 | 2 | 3 | 4 }
  | { type: 'place_block'; x: number; y: number; z: number; blockId: number }
  | { type: 'undo_block' }
  | { type: 'use_slot' };

export function handleClientInputCommand(
  world: VoxelWorld,
  player: PlayerState,
  cmd: ClientInputCommand,
  nowMs: number
): { ok: boolean; statusText: string } {
  if (cmd.type === 'camera_third_person') {
    const mode = toggleThirdPersonCamera(player);
    return { ok: true, statusText: `camera:${mode}` };
  }
  if (cmd.type === 'camera_mirror') {
    const mode = toggleMirrorCamera(player);
    return { ok: true, statusText: `camera:${mode}` };
  }
  if (cmd.type === 'select_slot') {
    player.selectedSlot = cmd.slot;
    return { ok: true, statusText: `slot:${cmd.slot + 1}` };
  }
  if (cmd.type === 'place_block') {
    const res = placeBlockSingleInput(world, player, cmd.x, cmd.y, cmd.z, cmd.blockId, nowMs);
    return { ok: res.ok, statusText: res.reason ?? 'placed' };
  }
  if (cmd.type === 'undo_block') {
    const res = undoLastBlock(world, player);
    return { ok: res.ok, statusText: res.ok ? 'undone' : 'empty_undo' };
  }
  const used = useSelectedSlot(player);
  return { ok: used.used, statusText: used.effect ?? 'empty_slot' };
}

export interface GameCanvasProps {
  world: VoxelWorld;
  player: PlayerState;
  onCameraUpdate?: (mode: PlayerState['cameraMode']) => void;
}

export function GameCanvas({ world, player, onCameraUpdate }: GameCanvasProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof window === 'undefined') return;

    const { scene, camera } = createVoxelThreeScene(world);
    let renderer: THREE.WebGLRenderer | null = null;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setSize(el.clientWidth || 1280, el.clientHeight || 720);
      el.appendChild(renderer.domElement);
      renderer.render(scene, camera);
    } catch {
      // Headless environment without WebGL context falls back cleanly
    }

    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.code === 'F5') {
        ev.preventDefault();
        toggleThirdPersonCamera(player);
        onCameraUpdate?.(player.cameraMode);
      } else if (ev.code === 'Tab') {
        ev.preventDefault();
        toggleMirrorCamera(player);
        onCameraUpdate?.(player.cameraMode);
      }
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      if (renderer) {
        renderer.dispose();
        renderer.domElement.remove();
      }
    };
  }, [world, player, onCameraUpdate]);

  return React.createElement('div', {
    ref: containerRef,
    'data-testid': 'game-canvas-viewport',
    style: { width: '100%', height: '100%', minHeight: '720px' }
  });
}
